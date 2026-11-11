# Dependent Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Saved search step read the results of the one step connected before it, in real runs and previews.

**Architecture:** A new boolean step field, `read_previous`, on `saved_search` steps. The report's SPL reads `$args.so_input$`. The engine fills that with the upstream step's search ID, using the existing From previous steps helpers, and re-checks the report before each dispatch.

**Tech Stack:** Python 3 with pytest (`so` package), TypeScript and React with Jest (`ui/`), Splunk REST through `FakeGateway` in tests.

**Spec:** `docs/superpowers/specs/2026-11-09-dependent-reports-design.md`

## Global Constraints

- Field: `read_previous`, boolean, default false, valid only on `saved_search` steps.
- Report placeholder, exact text: `$args.so_input$` (argument name is the existing `tokens.INPUT_ARG`).
- Wrapper text, exact: `| savedsearch "<ref>" args.so_input="$args.so_input$"`, with `<ref>` escaped by `tokens.escape_spl_string`.
- Argument value: direct is `tokens.input_spl(sids)`; wrapped and previews are `tokens.escape_spl_string(tokens.input_spl(sids))`.
- Only a validated search ID reaches a report through this feature.
- Exactly one distinct upstream step per `read_previous` step.
- The truncation check stays limited to `previous` steps. Runs keep dispatching through saved searches only.
- Baseline before Task 1: `python3 -m pytest -q` gives 682 passed.

## Review Focus

- A report whose only `$args.so_input$` sits inside a ```` ``` ```` comment: treated as missing, because the report would otherwise succeed without reading A (test in Task 1).
- The same two steps connected twice: counts as one upstream step and saves cleanly (test in Task 1).
- Step A succeeds with zero rows: B still runs and gets A's search ID, since an empty result is a valid input (test in Task 2).
- A re-run from step A: B receives A's new search ID, never the old one (test in Task 2).
- B fails and retries: the retry receives the same input (test in Task 2).

---

### Task 1: Report contract and save-time validation

**Files:**
- Modify: `app/search_orchestrator/bin/so/tokens.py`, `gateway.py` (`MISSING_SAVED_SEARCH`, `parse_saved_search_info`), `model.py` (`_shape_issues`, `_validate`), `hidden.py` (`_saved_search`), all under `app/search_orchestrator/bin/so/`
- Modify: `tests/fakes.py` (`saved_search_info` returns `search`, both branches)
- Test: `tests/test_tokens.py`, `tests/test_gateway_parsing.py`, `tests/test_model.py`, `tests/test_hidden.py`

**Interfaces:**
- Produces, in `tokens.py`:
  - `report_input_issue(ref: str, spl: Optional[str]) -> Optional[Tuple[str, str]]`: `(code, message)` or None.
  - `report_input_value(sids: List[str], wrapped: bool) -> str`.
- Produces: `saved_search_info(...)` result has `"search": str | None`.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_tokens.py
def test_report_input_issue():
    ok = "| loadjob $args.so_input$ | stats count"
    assert tokens.report_input_issue("rep", ok) is None
    assert tokens.report_input_issue("rep", "index=a")[0] == "report_missing_input"
    assert tokens.report_input_issue("rep", None)[0] == "report_missing_input"
    assert tokens.report_input_issue("rep", '| loadjob "$args.so_input$"')[0] == "report_input_quoted"
    commented = "``` | loadjob $args.so_input$ ``` index=a"
    assert tokens.report_input_issue("rep", commented)[0] == "report_missing_input"
    assert "| loadjob $args.so_input$" in tokens.report_input_issue("rep", "index=a")[1]
    assert "rep" in tokens.report_input_issue("rep", "index=a")[1]

def test_report_input_value():
    assert tokens.report_input_value(["s.1"], False) == '"s.1"'
    assert tokens.report_input_value(["s.1"], True) == '\\"s.1\\"'
    with pytest.raises(tokens.TokenError):
        tokens.report_input_value(['s" | delete'], True)

# tests/test_model.py
def report_job(edges=(("a", "b"),), **step):
    j = job(edges=edges)
    j["steps"][1] = dict({"id": "b", "type": "saved_search", "saved_search_ref": "rep",
                          "read_previous": True}, **step)
    return j

def test_read_previous_rules():
    assert not [i for i in validate_job(report_job()) if i["level"] == "error"]
    assert "bad_shape" in codes(validate_job(report_job(read_previous="true")))
    assert "report_input_needs_one" in codes(validate_job(report_job(edges=())))
    three = job(steps=("a", "c", "b"), edges=[("a", "b"), ("c", "b")])
    three["steps"][2] = report_job()["steps"][1]
    assert "report_input_needs_one" in codes(validate_job(three))
    inline = job(edges=[("a", "b")])
    inline["steps"][1]["read_previous"] = True
    assert "bad_step" in codes(validate_job(inline))
    off = job(edges=())
    off["steps"][1] = {"id": "b", "type": "saved_search", "saved_search_ref": "rep",
                       "read_previous": False}
    assert "report_input_needs_one" not in codes(validate_job(off))

def test_same_two_steps_connected_twice_is_one_input():
    j = report_job(edges=[("a", "b"), ("a", "b")])
    assert "report_input_needs_one" not in codes(validate_job(j))

def test_report_input_warning():
    warned = lambda j: "report_input_may_be_missing" in codes(validate_job(j))  # noqa: E731
    assert not warned(report_job())
    failing = report_job()
    failing["edges"][0]["condition"] = "on_failure"
    assert warned(failing)
    skippable = report_job()
    skippable["steps"][0]["run_when"] = {"kind": "cron", "value": "0 0 1 * *"}
    assert warned(skippable)

# tests/test_hidden.py
REPORT = "| loadjob $args.so_input$ | stats count"

def _report_gw(search=REPORT, **entry):
    gw = FakeGateway()
    gw.upsert_saved_search("bob", 'my "rep"', search, "-1h", "now")
    gw.saved_searches[("bob", 'my "rep"')].update(dict({"sharing": "global"}, **entry))
    return gw

def _report(ref='my "rep"', **over):
    return job(steps=[{"id": "a", "type": "inline", "spl": "| makeresults"},
                      dict({"id": "b", "type": "saved_search", "saved_search_ref": ref,
                            "read_previous": True}, **over)],
               edges=[{"from": "a", "to": "b"}])

def test_read_previous_wrapper_text_and_name():
    gw = _report_gw()
    out = hidden.sync(gw, _report(), None)
    b = out["steps"][1]
    assert b["mode"] == "wrapped"
    assert gw.saved_searches[("alice", b["hidden_search"])]["search"] == \
        '| savedsearch "my \\"rep\\"" args.so_input="$args.so_input$"'
    plain = hidden.sync(gw, _report(read_previous=False), None)
    assert plain["steps"][1]["hidden_search"] != b["hidden_search"]

def test_read_previous_direct_stays_the_report():
    gw = FakeGateway()
    gw.upsert_saved_search("alice", "mine", REPORT, "-1h", "now")
    b = hidden.sync(gw, _report(ref="mine"), None)["steps"][1]
    assert b["mode"] == "direct" and b["hidden_search"] == "mine"

def test_read_previous_placeholder_errors_block_the_search():
    for search, code in (("index=a", "report_missing_input"),
                         ('| loadjob "$args.so_input$"', "report_input_quoted")):
        _, searches, issues = hidden.plan(_report_gw(search), _report())
        assert code in [i["code"] for i in issues]
        assert all(i["level"] == "error" for i in issues if i["code"] == code)
        assert [s for s in searches if "savedsearch" in s["search"]] == []
```

Also update `test_parse_saved_search_info` so the expected dict includes `"search": "index=x"`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_tokens.py tests/test_gateway_parsing.py tests/test_model.py tests/test_hidden.py -q`
Expected: FAIL, with `AttributeError` for `report_input_issue` and failed save-rule assertions.

- [ ] **Step 3: Implement**

- `tokens.report_input_issue`: remove ```` ``` ```` comments with `re.sub(r"```.*?```", "", spl, flags=re.S)` first, then check presence, then the exact substring `"$args.so_input$"` with its double quotes. Messages: `Saved search '<ref>' must read its input with | loadjob $args.so_input$` and `Saved search '<ref>' must use $args.so_input$ without quotes: | loadjob $args.so_input$`.
- `tokens.report_input_value`: per Global Constraints.
- `gateway`: `search` from `content.get("search")`; `None` in `MISSING_SAVED_SEARCH`.
- `model._shape_issues`: `read_previous must be true or false` as `bad_shape`, when present and not a bool.
- `model._validate`: for a step with `read_previous` true, `bad_step` ("Only a Saved search step can read the previous step's results") unless `saved_search`; otherwise `report_input_needs_one` ("A report that reads the previous step needs exactly one step before it") unless `len(tk.previous_inputs(job, sid)) == 1`. After `skippable` is computed, warn `report_input_may_be_missing` ("Step <up> can be skipped or fail while this step still runs; this step then fails") per spec section 5.
- `hidden._saved_search`: after the visible check, return `(None, False, [error issue])` when `tokens.report_input_issue(ref, info.get("search"))` finds a problem and `read_previous` is true. Then append ` args.so_input="$args.so_input$"` to `spl`.

- [ ] **Step 4: Run the full Python suite**

Run: `python3 -m pytest -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/search_orchestrator/bin/so tests
git commit -m "feat(reports): validate a saved search that reads the previous step"
```

### Task 2: Engine dispatch

**Files:**
- Modify: `app/search_orchestrator/bin/so/engine.py` (`_dispatch`, `_render_args`, `_direct_problem`)
- Test: `tests/test_engine.py`

**Interfaces:**
- Consumes: `tokens.report_input_issue`, `tokens.report_input_value`, `saved_search_info(...)["search"]` from Task 1.
- Produces: `Engine._saved_info(run, name) -> Tuple[Optional[dict], Optional[str]]`: `(info, None)`, or `(None, problem)` on a non-transient error. A transient error is re-raised. `Engine._direct_problem(run, name, info)` now takes the looked-up `info`.

- [ ] **Step 1: Write the failing tests**

```python
REPORT = "| loadjob $args.so_input$ | stats count"

def _report_world(mode="wrapped", search=REPORT, condition="on_success", a=None, **step):
    w = World()
    b = dict({"id": "b", "type": "saved_search", "saved_search_ref": "rep",
              "read_previous": True, "mode": mode}, **step)
    if mode == "direct":
        b["hidden_search"] = "rep"
    j = w.add_job(make_job(steps=[dict({"id": "a"}, **(a or {})), b],
                           edges=[("a", "b", condition)]),
                  scripts={"a": {"states": ["done"], "result_count": 1}})
    w.gw.upsert_saved_search("alice", "rep", search, "-1h", "now")
    if mode == "wrapped":
        w.gw.saved_searches[("alice", "rep")]["sharing"] = "global"
    return w, j

def _settle(w, n=6):
    for _ in range(n):
        w.tick(advance=5)

def _b_dispatches(w, a_name):
    return [d for d in w.gw.dispatch_log if d["name"] != a_name]

def test_report_input_wrapped_and_direct_arguments():
    for mode, wrap in (("wrapped", '\\"%s\\"'), ("direct", '"%s"')):
        w, j = _report_world(mode)
        run_id = cron_run(w, j)
        _settle(w)
        sid = w.step(run_id, "a")["sid"]
        [d] = _b_dispatches(w, j["steps"][0]["hidden_search"])
        assert d["args"]["so_input"] == wrap % sid
        assert d["trigger_actions"] is (mode == "direct")
        assert w.run(run_id)["state"] == "succeeded"

def test_report_time_range_still_sent():
    w, j = _report_world(earliest="-1d", latest="now")
    cron_run(w, j)
    _settle(w)
    [d] = _b_dispatches(w, j["steps"][0]["hidden_search"])
    assert (d["earliest"], d["latest"]) == ("-1d", "now")

def test_report_runs_on_zero_row_input():
    w, j = _report_world()
    w.gw.script_job(j["steps"][0]["hidden_search"], ["done"], result_count=0)
    run_id = cron_run(w, j)
    _settle(w)
    sid = w.step(run_id, "a")["sid"]
    [d] = _b_dispatches(w, j["steps"][0]["hidden_search"])
    assert sid in d["args"]["so_input"]

def test_report_no_input_fails_the_attempt():
    w, j = _report_world(condition="always",
                         a={"run_when": {"kind": "cron", "value": "0 0 1 1 *"}})
    run_id = cron_run(w, j)
    _settle(w)
    assert _b_dispatches(w, j["steps"][0]["hidden_search"]) == []
    failed = w.audit.of("step_attempt", run_id=run_id, step_id="b", outcome="failed")
    assert failed and failed[0]["error"] == \
        "Report step b needs the results of step a, which did not succeed"

@pytest.mark.parametrize("mode", ["wrapped", "direct"])
@pytest.mark.parametrize("search,text", [("index=a", "must read its input"),
                                         ('| loadjob "$args.so_input$"', "without quotes")])
def test_report_edited_after_save_fails_the_attempt(mode, search, text):
    w, j = _report_world(mode, search=search)
    run_id = cron_run(w, j)
    _settle(w)
    assert _b_dispatches(w, j["steps"][0]["hidden_search"]) == []
    failed = w.audit.of("step_attempt", run_id=run_id, step_id="b", outcome="failed")
    assert failed and text in failed[0]["error"] and "rep" in failed[0]["error"]

def test_report_lookup_transient_error_keeps_step_starting():
    w, j = _report_world()
    real = w.gw.saved_search_info
    def down(owner, name):
        if name == "rep":
            raise GatewayError("HTTP 503", status=503, transient=True)
        return real(owner, name)
    w.gw.saved_search_info = down
    run_id = cron_run(w, j)
    _settle(w, 3)
    assert w.step(run_id, "b")["state"] == "starting"
    w.gw.saved_search_info = real
    _settle(w)
    assert len(_b_dispatches(w, j["steps"][0]["hidden_search"])) == 1

def test_report_retry_gets_the_same_input():
    w, j = _report_world(retries=1)
    w.gw.script_job(j["steps"][1]["hidden_search"], ["failed"], error="boom")
    run_id = cron_run(w, j)
    _settle(w, 4)
    assert w.step(run_id, "b")["state"] == "retrying"
    w.gw.script_job(j["steps"][1]["hidden_search"], ["done"])
    for _ in range(4):
        w.tick(advance=30)
    ds = _b_dispatches(w, j["steps"][0]["hidden_search"])
    assert len(ds) == 2 and ds[0]["args"] == ds[1]["args"]
    assert w.step(run_id, "a")["sid"] in ds[1]["args"]["so_input"]

def test_report_rerun_from_a_uses_new_sid():
    w, j = _report_world()
    run_id = cron_run(w, j)
    _settle(w)
    first = w.step(run_id, "a")["sid"]
    w.command(type="rerun", run_id=run_id, step_id="a", definition="original", user="alice")
    _settle(w, 10)
    second = w.step(run_id, "a")["sid"]
    assert second != first
    last = _b_dispatches(w, j["steps"][0]["hidden_search"])[-1]
    assert second in last["args"]["so_input"] and first not in last["args"]["so_input"]

def test_report_rerun_of_b_with_expired_a_fails():
    w, j = _report_world()
    run_id = cron_run(w, j)
    _settle(w)
    del w.gw.jobs[w.step(run_id, "a")["sid"]]
    w.command(type="rerun", run_id=run_id, step_id="b", definition="original", user="alice")
    _settle(w)
    failed = w.audit.of("step_attempt", run_id=run_id, step_id="b", outcome="failed")
    assert failed and "have expired" in failed[-1]["error"]
```

Add `GatewayError` to the file's existing `so.gateway` import. If a test needs more ticks to reach a state in the fake, raise the tick count only.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_engine.py -q -k report_`
Expected: FAIL. `so_input` is missing from the dispatch arguments and no attempt fails.

- [ ] **Step 3: Implement**

- `_render_args`: when `sdef.get("read_previous")`, set `args[tokens.INPUT_ARG] = tokens.report_input_value(self._input_sids(run, sdef), sdef.get("mode") != "direct")`. A `TokenError` from a bad search ID already fails the attempt in `_dispatch`.
- `_dispatch`, after the `_expired_upstream` handling and before `_render_args`: for `read_previous` with no `_input_sids`, `_attempt_failed` with the exact message in the test, using `tokens.previous_inputs(definition, sid)[0]`.
- `_dispatch`: replace the direct-mode block with one lookup. When mode is direct or `read_previous` is true, call `_saved_info(run, sdef.get("saved_search_ref") or name)`. A returned problem fails the attempt. Then apply `_direct_problem(run, name, info)` when direct, and `tokens.report_input_issue(ref, info.get("search"))` when `read_previous`, failing the attempt with its message. Keep the "could not check saved search" wording and the transient re-raise from the current `_direct_problem`.

- [ ] **Step 4: Run the full Python suite**

Run: `python3 -m pytest -q`
Expected: all pass, including the existing `test_direct_mode_*` tests.

- [ ] **Step 5: Commit**

```bash
git add app/search_orchestrator/bin/so/engine.py tests/test_engine.py
git commit -m "feat(reports): pass the previous step's search ID to a report"
```

### Task 3: Preview

**Files:**
- Modify: `app/search_orchestrator/bin/so/preview_api.py` (`_preview_search`)
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `tokens.report_input_value`, `tokens.INPUT_ARG`, `tokens.fill`, `preview.input_sids`; `hidden.saved_search_spl` already includes the placeholder checks from Task 1.

- [ ] **Step 1: Write the failing tests**

```python
REPORT = "| loadjob $args.so_input$ | stats count"

def _report_job(job_id="daily"):
    return job_body(job_id, steps=[
        {"id": "a", "type": "inline", "spl": "| makeresults", "earliest": "-1d", "latest": "now"},
        {"id": "b", "type": "saved_search", "saved_search_ref": "rep", "read_previous": True}],
        edges=[{"from": "a", "to": "b"}])

def test_preview_report_reads_run_input(w):
    w.gw.saved_searches[("alice", "rep")] = {"search": REPORT}
    job = _report_job()
    run_id = run_with(w, job, {"a": {"state": "succeeded", "sid": "run_a", "result_count": 1}})
    kept(w, "run_a")
    status, out = preview(w, job=job, step_id="b", input={"mode": "run", "run_id": run_id})
    assert status == 201, out
    assert out["spl"] == '| savedsearch "rep" args.so_input="\\"run_a\\""'

def test_preview_report_no_input(w):
    w.gw.saved_searches[("alice", "rep")] = {"search": REPORT}
    job = _report_job()
    run_id = run_with(w, job, {"a": {"state": "skipped", "skip_kind": "run_when"}})
    status, out = preview(w, job=job, step_id="b", input={"mode": "run", "run_id": run_id})
    assert status == 400 and out["error"]["issues"][0]["code"] == "no_input"
    assert out["error"]["issues"][0]["message"] == \
        "Report step b needs the results of step a, which did not succeed"

def test_preview_report_missing_placeholder(w):
    w.gw.saved_searches[("alice", "rep")] = {"search": "index=a"}
    status, out = preview(w, job=_report_job(), step_id="b",
                          input=live(a={"skipped": "run_when"}))
    assert status == 400
    assert out["error"]["issues"][0]["code"] == "report_missing_input"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_api.py -q -k preview_report`
Expected: FAIL. The first test's `spl` still has `$args.so_input$` unfilled.

- [ ] **Step 3: Implement in `_preview_search`**

In the `saved_search` branch, when `read_previous` is true: take `preview.input_sids(job, step["id"], upstream)`. With none, raise `_invalid` with a `no_input` issue and the dispatch message. Otherwise fill the wrapper with `tokens.fill(spl, {tokens.INPUT_ARG: tokens.report_input_value(sids, True)})`, turning a `TokenError` into the same `bad_token` issue the next block uses.

- [ ] **Step 4: Run the full Python suite**

Run: `python3 -m pytest -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/search_orchestrator/bin/so/preview_api.py tests/test_api.py
git commit -m "feat(reports): preview a report with the previous step's results"
```

### Task 4: Builder

**Files:**
- Modify: `ui/src/api/types.ts`, `ui/src/features/builder/StepPanel.tsx`, `reducer.ts` (`convertType`), `graphLogic.ts` (`findIssues`)
- Test: `ui/src/__tests__/StepPanel.test.tsx`, `reducer.test.tsx`, `graphLogic.test.tsx`

**Interfaces:**
- Produces: `StepDef.read_previous?: boolean`.

- [ ] **Step 1: Write the failing tests**

```tsx
// StepPanel.test.tsx
test('a saved search step can read the previous step', () => {
    const job = threeSteps([{ from: 'a', to: 'b' }]);
    job.steps[1] = { id: 'b', type: 'saved_search', saved_search_ref: 'rep' };
    const state = renderPanel(job, 'b');
    const box = screen.getByRole('checkbox', { name: "Reads the previous step's results" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(state().job.steps[1].read_previous).toBe(true);
    expect(screen.getByText(/\| loadjob \$args\.so_input\$/)).toBeInTheDocument();
    expect(screen.getByLabelText('Earliest')).toBeInTheDocument();
});

// reducer.test.tsx
test('leaving Saved search clears read_previous', () => {
    const job: JobDefinition = { name: 'j', enabled: true, edges: [],
        steps: [{ id: 'b', type: 'saved_search', saved_search_ref: 'rep', read_previous: true }] };
    const s = reducer(initialState(job), { type: 'updateStep', id: 'b', changes: { type: 'inline' } });
    expect(s.job.steps[0].read_previous).toBeUndefined();
});

// graphLogic.test.tsx
test('findIssues needs exactly one step before a report that reads it', () => {
    const msg = 'A report that reads the previous step needs exactly one step before it';
    const r = (id: string) => ({ id, type: 'saved_search' as const, saved_search_ref: 'rep', read_previous: true });
    const job: JobDefinition = { name: 'j', enabled: true,
        steps: [{ id: 'a', type: 'inline', spl: '| x' }, { id: 'c', type: 'inline', spl: '| x' },
                r('none'), r('one'), r('twice'), r('two')],
        edges: [{ from: 'a', to: 'one' }, { from: 'a', to: 'twice' }, { from: 'a', to: 'twice' },
                { from: 'a', to: 'two' }, { from: 'c', to: 'two' }] };
    const found = findIssues(job).filter((i) => i.code === 'report_input_needs_one').map((i) => [i.step, i.message]);
    expect(found).toEqual([['none', msg], ['two', msg]]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ui && npx jest src/__tests__/StepPanel.test.tsx src/__tests__/reducer.test.tsx src/__tests__/graphLogic.test.tsx`
Expected: FAIL. The checkbox isn't found.

- [ ] **Step 3: Implement**

- `StepPanel`: inside the `saved_search` branch, a `Checkbox` as in `RerunDialog`, labelled exactly `Reads the previous step's results`. While checked, show help text with `| loadjob $args.so_input$` and "Connect exactly one step before it."
- `convertType`: when `before.type === 'saved_search'` and `after.type !== 'saved_search'`, remove `read_previous`. Keep the existing branches working.
- `findIssues`: for a `saved_search` step with `read_previous`, push `report_input_needs_one` unless the distinct `from` count of edges into it is 1.

- [ ] **Step 4: Run the UI checks**

Run: `cd ui && npx jest && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add ui/src
git commit -m "feat(builder): let a saved search step read the previous step"
```

### Task 5: Documentation

**Files:**
- Modify: `docs/user-guide.md`, `CHANGELOG.md`

- [ ] **Step 1: Add a "Reports that read a previous step" section after From previous steps in `docs/user-guide.md`**

It covers spec section 3 and its consequences: the `| loadjob $args.so_input$` line with no quotes, one connection only, B no longer running on its own, no other placeholders, wrapped reports losing their own actions, and what happens when no input succeeded.

- [ ] **Step 2: Add a `## Unreleased` entry at the top of `CHANGELOG.md`**

One bullet in the file's existing style. The version number is set at release.

- [ ] **Step 3: Run every suite**

Run: `python3 -m pytest -q && (cd ui && npx jest && npm run typecheck)`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add docs/user-guide.md CHANGELOG.md
git commit -m "docs: explain reports that read a previous step"
```

## After the tasks: live checks on real Splunk

These need the owner's Splunk server and aren't automated (spec section 9). Report each result; don't mark the feature done without them.

- [ ] A wrapped and a direct report B each read a real report A end to end.
- [ ] A direct report B with an alert action still fires it.
- [ ] A report edited to drop its placeholder fails the step.
- [ ] Record what report B's page shows after a direct run, and add it to the user guide.
