"""SPL conditions on lines (1.17.0): edge expression_kind "eval" and "search", and $run.now$.
See docs/superpowers/specs/2026-11-17-spl-conditions-design.md."""
import calendar

from fakes import FakeGateway
from so import hidden, model, names, state, tokens
from so.engine import first_fields

from test_engine import World, cron_run, make_job

T0 = calendar.timegm((2026, 12, 1, 1, 0, 0))


# --- tokens -------------------------------------------------------------------

def test_run_now_is_a_token():
    assert tokens.is_valid_name("run.now", ["a"])
    assert "run.now" in tokens.find_tokens("| eval t=$run.now$", ["a"])


def test_run_now_rendered_from_the_context():
    run = {"_key": "r", "scheduled_time": T0, "definition": {"steps": []}, "steps": {}}
    ctx = tokens.run_context(run, now=T0 + 42)
    assert ctx["run"]["now"] == str(T0 + 42)
    assert tokens.render_args(["run__now"], ctx) == {"run__now": str(T0 + 42)}
    assert tokens.render_text("at $run.now$", ctx) == "at %d" % (T0 + 42)


def test_run_context_now_defaults_to_the_clock():
    run = {"_key": "r", "scheduled_time": T0, "definition": {"steps": []}, "steps": {}}
    assert int(tokens.run_context(run)["run"]["now"]) > T0 - 10 ** 9


def test_eval_condition_compiles_numeric_tokens_with_tonumber():
    spl, args = tokens.compile_condition(
        '$a.resultCount$ > 0 AND $run.now$ - $run.scheduled_time$ < 3600 AND x="$a.status$"'
        ' AND $a.status$="succeeded"', ["a"], "eval")
    assert spl == ('| makeresults | where tonumber("$args.a__resultCount$") > 0 AND '
                   'tonumber("$args.run__now$") - tonumber("$args.run__scheduled_time$") < 3600 '
                   'AND x="$args.a__status$" AND "$args.a__status$"="succeeded"')
    assert args == ["a__resultCount", "run__now", "run__scheduled_time", "a__status"]


def test_search_condition_compiles_like_a_step():
    spl, args = tokens.compile_condition("index=main host=$a.first.host$ | where count > 0",
                                         ["a"], "search")
    assert spl == 'index=main host="$args.a__first__host$" | where count > 0\n| head 1'
    assert args == ["a__first__host"]


# --- hidden searches ------------------------------------------------------------

def cjob(**edge):
    e = {"from": "a", "to": "b", "condition": "expression"}
    e.update(edge)
    return {"id": "daily", "owner": "alice", "params": [],
            "steps": [{"id": "a", "type": "inline", "spl": "| makeresults", "earliest": "-1d",
                       "latest": "now"},
                      {"id": "b", "type": "inline", "spl": "| makeresults", "earliest": "-1d",
                       "latest": "now"}],
            "edges": [e], "actions": []}


def test_eval_condition_gets_a_hidden_search():
    gw = FakeGateway()
    out = hidden.sync(gw, cjob(expression_kind="eval", expression="$a.resultCount$ > 0"), None)
    edge = out["edges"][0]
    name = edge["hidden_search"]
    assert name.startswith("_so_daily_cond_") and len(name) == len("_so_daily_cond_") + 8
    saved = gw.saved_searches[("alice", name)]
    assert saved["search"] == '| makeresults | where tonumber("$args.a__resultCount$") > 0'
    assert {"owner": "alice", "name": name} in out["hidden_searches"]
    assert ("alice", name) in hidden.used(out, "alice")


def test_search_condition_default_time_range_and_content_hash():
    gw = FakeGateway()
    one = hidden.sync(gw, cjob(expression_kind="search", expression="index=main error"), None)
    saved = gw.saved_searches[("alice", one["edges"][0]["hidden_search"])]
    assert (saved["search"], saved["earliest"], saved["latest"]) == ("index=main error\n| head 1",
                                                                      "-24h", "now")
    two = hidden.sync(gw, cjob(expression_kind="search", expression="index=main error",
                               earliest="-1h", latest="now"), one)
    assert two["edges"][0]["hidden_search"] != one["edges"][0]["hidden_search"]
    hidden.sync(gw, cjob(expression_kind="search", expression="index=main error",
                         earliest="", latest=""), two)
    assert ("index=main error\n| head 1", "", "") in {(v["search"], v["earliest"], v["latest"])
                                             for v in gw.saved_searches.values()}


def test_simple_condition_has_no_hidden_search_and_request_value_is_dropped():
    gw = FakeGateway()
    out = hidden.sync(gw, cjob(expression="$a.resultCount$ > 0", hidden_search="_so_evil"), None)
    assert "hidden_search" not in out["edges"][0]
    assert [e for e in out["hidden_searches"] if "cond" in e["name"]] == []


# --- validation -----------------------------------------------------------------

def vjob(**edge):
    j = cjob(**edge)
    j["actions"] = [{"hook": "on_failure", "type": "webhook"}]
    return j


def errors(job):
    return [i for i in model.validate_job(job) if i["level"] == "error"]


def codes(job):
    return {i["code"] for i in errors(job)}


def test_valid_spl_conditions():
    assert errors(vjob(expression_kind="eval",
                       expression='$a.resultCount$ > 0 AND match("$a.status$", "succ") '
                                  'AND now() - $run.now$ < 60')) == []
    assert errors(vjob(expression_kind="search", expression="index=main | stats count",
                       earliest="-1h", latest="now")) == []


def test_simple_condition_still_uses_expr_language():
    assert "bad_expression" in codes(vjob(expression="match(x)"))
    assert errors(vjob(expression="$a.resultCount$ > 0")) == []
    assert errors(vjob(expression_kind="simple", expression="$run.now$ > 0")) == []


def test_spl_condition_needs_text_and_known_kind():
    assert "bad_expression" in codes(vjob(expression_kind="eval", expression="  "))
    assert "bad_expression" in codes(vjob(expression_kind="search"))
    assert "bad_edge" in codes(vjob(expression_kind="python", expression="1"))


def test_spl_condition_unknown_token():
    found = errors(vjob(expression_kind="eval", expression="$a.resultCont$ > 0"))
    assert [i["code"] for i in found] == ["unknown_token"]
    assert found[0]["step"] == "b"
    assert "unknown_token" in codes(vjob(expression_kind="search",
                                         expression='index=x p="$run.param.nope$"'))


def test_spl_condition_must_not_write():
    found = errors(vjob(expression_kind="search", expression="index=main | collect index=x"))
    assert [i["code"] for i in found] == ["condition_writes"]
    assert "collect" in found[0]["message"] and "step" in found[0]["message"]
    for cmd in ("outputlookup", "outputcsv", "tscollect", "mcollect", "meventcollect",
                "sendemail", "delete"):
        assert "condition_writes" in codes(vjob(expression_kind="search",
                                                expression="index=main | %s x" % cmd)), cmd
    assert "condition_writes" in codes(vjob(expression_kind="search",
                                            expression="| orchestrate start job=x"))
    # A quoted word is not a command.
    assert errors(vjob(expression_kind="search", expression='index=main "| collect"')) == []


def test_eval_condition_rejects_a_pipe():
    found = errors(vjob(expression_kind="eval", expression="1=1 | collect index=x"))
    assert "bad_expression" in {i["code"] for i in found}
    assert errors(vjob(expression_kind="eval", expression='x="a|b" OR y==1 OR 1=1 || 2=2')) == []


def test_spl_condition_unsafe_token_position():
    assert "unsafe_token_position" in codes(
        vjob(expression_kind="search", expression="index=x ```$a.sid$```"))


def test_first_fields_include_spl_condition_tokens():
    j = cjob(expression_kind="eval", expression='"$a.first.host$"="x"')
    assert first_fields(j) == {"a": {"host"}}


# --- state ------------------------------------------------------------------------

def sjob(kind="eval"):
    return {"id": "j", "timezone": "UTC", "defaults": {}, "actions": [],
            "steps": [{"id": "a", "type": "inline", "spl": "x"},
                      {"id": "b", "type": "inline", "spl": "x"}],
            "edges": [{"from": "a", "to": "b", "condition": "expression",
                       "expression_kind": kind, "expression": "1=1",
                       "hidden_search": "_so_j_cond_12345678"}]}


def srun(a_state="succeeded", conditions=None, **over):
    r = {"_key": "r1", "id": "r1", "definition": sjob(), "state": "running",
         "scheduled_time": T0, "params": {}, "delay_base": T0, "giveup_base": T0,
         "paused_seconds": 0, "paused_at": None, "hooks_fired": ["on_start"],
         "steps": {"a": {"state": a_state, "hooks_fired": ["on_start", "on_success",
                                                           "on_complete"]},
                   "b": {"state": "waiting"}}}
    if conditions is not None:
        r["conditions"] = conditions
    r.update(over)
    return r


def kinds(effects):
    return [e[0] for e in effects]


def test_spl_condition_starts_when_source_finished_and_target_waits():
    effects = state.evaluate(srun(), T0 + 10)
    assert ("start_condition", "a>b") in effects
    assert not any(e[0] == "set_step" and e[1] == "b" for e in effects)
    assert not any(e[0] == "set_run" and e[1].get("state") for e in effects)


def test_spl_condition_also_starts_after_a_failed_source():
    run = srun("failed")
    run["steps"]["a"]["hooks_fired"] = ["on_start", "on_failure", "on_complete"]
    effects = state.evaluate(run, T0 + 10)
    assert ("start_condition", "a>b") in effects
    # The pending condition counts as activity: the run isn't blocked yet.
    assert not any(e[0] == "set_run" and e[1].get("state") == "blocked" for e in effects)


def test_spl_condition_running_does_not_start_again():
    effects = state.evaluate(srun(conditions={"a>b": {"state": "running", "sid": "s"}}), T0 + 10)
    assert "start_condition" not in kinds(effects)
    assert not any(e[0] == "set_step" and e[1] == "b" for e in effects)


def test_spl_condition_met_starts_target():
    effects = state.evaluate(srun(conditions={"a>b": {"state": "met"}}), T0 + 10)
    assert ("start_step", "b") in effects


def test_spl_condition_not_met_or_failed_skips_target():
    for result in ("not_met", "failed"):
        effects = state.evaluate(srun(conditions={"a>b": {"state": result}}), T0 + 10)
        sets = [e[2] for e in effects if e[0] == "set_step" and e[1] == "b"]
        assert sets and sets[0]["state"] == "skipped" and sets[0]["skip_kind"] == "not_taken"


def test_spl_condition_from_skipped_source_is_not_met_without_a_search():
    effects = state.evaluate(srun("skipped"), T0 + 10)
    assert "start_condition" not in kinds(effects)
    sets = [e[2] for e in effects if e[0] == "set_step" and e[1] == "b"]
    assert sets[0]["state"] == "skipped"


def test_spl_condition_not_started_while_paused():
    effects = state.evaluate(srun(state="paused", paused_at=T0), T0 + 10)
    assert "start_condition" not in kinds(effects)


def test_simple_condition_still_evaluated_in_place():
    run = srun()
    run["definition"]["edges"][0].update(expression_kind="simple",
                                         expression="$run.now$ > %d" % T0)
    effects = state.evaluate(run, T0 + 10)
    assert ("start_step", "b") in effects
    run["definition"]["edges"][0].pop("expression_kind")
    assert ("start_step", "b") in state.evaluate(run, T0 + 10)


def test_rerun_drops_condition_results_into_reset_steps():
    run = srun(conditions={"a>b": {"state": "not_met"}}, state="failed")
    run["steps"]["b"] = {"state": "skipped", "skip_kind": "not_taken"}
    new = state.reset_for_rerun(run, "b", T0 + 100)
    assert new.get("conditions") == {}
    new = state.reset_for_rerun(run, "a", T0 + 100)
    assert new.get("conditions") == {}


def test_preview_decision_assumes_spl_condition_met():
    decision = state.preview_decision(sjob(), "b", T0, {}, {"a": {"state": "succeeded"}})
    assert decision == ("run", None)


# --- engine -----------------------------------------------------------------------

COND = names.step_search_name("j", "cond", "c0ffee0000000000")  # _so_j_cond_c0ffee00


def ejob(kind="eval", expression="$a.resultCount$ > 0", **edge):
    e = {"from": "a", "to": "b", "condition": "expression", "expression_kind": kind,
         "expression": expression, "hidden_search": COND}
    e.update(edge)
    j = make_job(steps=["a", "b"])
    j["edges"] = [e]
    return j


def cond_dispatches(w):
    return [d for d in w.gw.dispatch_log if d["name"] == COND]


def setup(w, job, cond_script):
    w.add_job(job, scripts={"a": {"states": ["done"], "result_count": 3}})
    w.gw.script_job(COND, **cond_script)
    return cron_run(w, job)


def test_engine_met_condition_starts_target_and_audits():
    w = World()
    run_id = setup(w, ejob(), {"states": ["running", "done"], "result_count": 1})
    w.tick(advance=5)  # a done -> condition dispatched
    [d] = cond_dispatches(w)
    assert d["owner"] == "alice" and d["now"] == T0 and d["trigger_actions"] is False
    assert d["args"] == {"a__resultCount": "3"}
    assert w.run(run_id)["conditions"]["a>b"]["state"] == "running"
    assert w.step(run_id, "b")["state"] == "waiting"
    w.tick(advance=5)  # still running
    w.tick(advance=5)  # done -> met -> b starts
    run = w.run(run_id)
    assert run["conditions"]["a>b"]["state"] == "met"
    assert run["steps"]["b"]["state"] in ("starting", "running", "succeeded")
    [ev] = w.audit.of("condition_evaluated")
    assert ev["edge"] == "a>b" and ev["result"] is True and ev["run_id"] == run_id
    for _ in range(3):
        w.tick(advance=5)
    assert w.run(run_id)["state"] == "succeeded"
    assert len(cond_dispatches(w)) == 1  # evaluated once per edge per run


def test_engine_not_met_condition_skips_target():
    w = World()
    run_id = setup(w, ejob(kind="search", expression="index=main"),
                   {"states": ["done"], "result_count": 0})
    for _ in range(4):
        w.tick(advance=5)
    run = w.run(run_id)
    assert run["conditions"]["a>b"]["state"] == "not_met"
    assert run["steps"]["b"]["state"] == "skipped"
    assert run["state"] == "succeeded"
    assert w.audit.of("condition_evaluated")[0]["result"] is False


def test_engine_search_condition_uses_its_time_range():
    w = World()
    setup(w, ejob(kind="search", expression="index=main", earliest="-1h", latest="now"),
          {"states": ["done"], "result_count": 1})
    for _ in range(3):
        w.tick(advance=5)
    [d] = cond_dispatches(w)
    assert (d["earliest"], d["latest"]) == ("-1h", "now")


def test_engine_failed_condition_is_not_met_and_audited():
    w = World()
    run_id = setup(w, ejob(), {"states": ["failed"], "error": "Error in 'where' command"})
    for _ in range(4):
        w.tick(advance=5)
    run = w.run(run_id)
    c = run["conditions"]["a>b"]
    assert c["state"] == "failed" and "where" in c["error"]
    assert run["steps"]["b"]["state"] == "skipped"
    [ev] = w.audit.of("condition_failed")
    assert ev["edge"] == "a>b" and ev["run_id"] == run_id and "where" in ev["error"]


def test_engine_condition_times_out_after_300s():
    w = World()
    run_id = setup(w, ejob(), {"states": ["running"]})
    w.tick(advance=5)
    sid = w.run(run_id)["conditions"]["a>b"]["sid"]
    w.tick(advance=200)
    assert w.run(run_id)["conditions"]["a>b"]["state"] == "running"
    w.tick(advance=101)
    c = w.run(run_id)["conditions"]["a>b"]
    assert c["state"] == "failed" and "300" in c["error"]
    assert (sid, "cancel", {}) in w.gw.control_log
    assert w.audit.of("condition_failed")


def test_engine_condition_with_missing_token_fails():
    w = World()
    run_id = setup(w, ejob(expression='"$a.first.host$"="x"'), {"states": ["done"]})
    for _ in range(3):
        w.tick(advance=5)
    c = w.run(run_id)["conditions"]["a>b"]
    assert c["state"] == "failed" and "a.first.host" in c["error"]
    assert cond_dispatches(w) == []


def test_engine_condition_without_hidden_search_fails_clearly():
    w = World()
    j = ejob()
    del j["edges"][0]["hidden_search"]
    run_id = setup(w, j, {"states": ["done"]})
    for _ in range(3):
        w.tick(advance=5)
    c = w.run(run_id)["conditions"]["a>b"]
    assert c["state"] == "failed" and "re-save" in c["error"]


def test_engine_restart_mid_condition_adopts_the_search():
    w = World()
    run_id = setup(w, ejob(), {"states": ["running", "running", "done"], "result_count": 1})
    w.gw.crash_after_dispatch = True
    w.tick(advance=5)
    w.gw.crash_after_dispatch = False
    c = w.run(run_id)["conditions"]["a>b"]
    assert c["state"] == "starting" and not c.get("sid")
    w.engine = w.new_engine()
    w.tick(advance=5)
    assert len(cond_dispatches(w)) == 1  # adopted, not dispatched twice
    assert w.run(run_id)["conditions"]["a>b"]["sid"] == cond_dispatches(w)[0]["sid"]
    for _ in range(3):
        w.tick(advance=5)
    assert w.run(run_id)["conditions"]["a>b"]["state"] == "met"


def test_engine_restart_with_sid_resumes_polling():
    w = World()
    run_id = setup(w, ejob(), {"states": ["running", "running", "done"], "result_count": 1})
    w.tick(advance=5)
    w.engine = w.new_engine()
    for _ in range(3):
        w.tick(advance=5)
    assert w.run(run_id)["conditions"]["a>b"]["state"] == "met"
    assert len(cond_dispatches(w)) == 1


def test_engine_cancel_cancels_condition_search():
    w = World()
    run_id = setup(w, ejob(), {"states": ["running"]})
    w.tick(advance=5)
    sid = w.run(run_id)["conditions"]["a>b"]["sid"]
    w.command(type="cancel", run_id=run_id, user="alice")
    w.tick(advance=5)
    run = w.run(run_id)
    assert run["state"] == "cancelled"
    assert run["conditions"]["a>b"]["state"] == "cancelled"
    assert (sid, "cancel", {}) in w.gw.control_log


def test_engine_rerun_evaluates_again():
    w = World()
    j = ejob()
    j["steps"].append(dict(j["steps"][0], id="c",
                           hidden_search=names.step_search_name("j", "c", "0123456789abcdef")))
    w.add_job(j, scripts={"a": {"states": ["done"], "result_count": 3},
                          "c": {"states": ["failed"]}})
    w.gw.script_job(COND, states=["done"], result_count=0)
    run_id = cron_run(w, j)
    for _ in range(4):
        w.tick(advance=5)
    assert w.run(run_id)["steps"]["b"]["state"] == "skipped"
    assert w.run(run_id)["state"] == "blocked"  # c failed, unhandled
    w.gw.script_job(COND, states=["done"], result_count=1)
    w.command(type="rerun", run_id=run_id, step_id="b", user="alice")
    for _ in range(6):
        w.tick(advance=5)
    run = w.run(run_id)
    assert len(cond_dispatches(w)) == 2
    assert run["conditions"]["a>b"]["state"] == "met"
    assert run["steps"]["b"]["state"] == "succeeded"


def test_engine_run_now_in_step_spl_is_the_dispatch_time():
    w = World()
    j = make_job(steps=[{"id": "a", "spl": "| makeresults | eval t=$run.now$"}])
    w.add_job(j)
    cron_run(w, j)
    [d] = w.gw.dispatch_log
    assert d["args"] == {"run__now": str(T0)}


def test_action_tokens_fill_run_now_when_the_hook_fires():
    w = World(T0 + 7)
    run = {"_key": "r1", "job_id": "j", "scheduled_time": T0, "steps": {},
           "definition": {"steps": [], "actions": [{"hook": "on_success", "type": "webhook",
                                                    "destination": "d", "body": "$run.now$"}]}}
    assert w.actions.submit(run, "on_success", "job", None)
    [row] = w.action_rows(run_id="r1")
    assert row["tokens"]["run"]["now"] == str(T0 + 7)


def test_preview_token_context_has_run_now():
    from so import preview
    ctx = preview.token_context({"steps": []}, T0, {}, {}, now=T0 + 3)
    assert tokens.render_args(["run__now"], ctx) == {"run__now": str(T0 + 3)}



# --- review fixes -------------------------------------------------------------------

def test_single_quote_is_literal_for_the_writing_command_check():
    assert model.writing_command("index=main O'Brien | collect index=x") == "collect"
    assert "condition_writes" in codes(vjob(expression_kind="search",
                                            expression="index=main O'Brien | collect index=x"))


def test_eval_rejects_a_pipe_inside_single_quotes():
    assert "bad_expression" in codes(vjob(expression_kind="eval", expression="'a|b'=1"))


def test_token_after_a_double_quote_inside_single_quotes_is_refused():
    text = """'a"b'=1 AND $a.first.f$ > 2"""
    # The " inside the field name no longer makes the token look quoted: it is quoted.
    spl, _ = tokens.compile_condition(text, ["a"], "eval")
    assert spl == """| makeresults | where 'a"b'=1 AND "$args.a__first__f$" > 2"""
    spl, _ = tokens.compile_spl(text, ["a"])
    assert spl == """'a"b'=1 AND "$args.a__first__f$" > 2"""


def test_token_inside_single_quotes_is_refused():
    import pytest
    with pytest.raises(tokens.TokenError):
        tokens.compile_spl("| eval x='$a.first.f$'", ["a"])
    with pytest.raises(tokens.TokenError):
        tokens.compile_spl("search O'Brien host=$a.first.f$", ["a"])
    assert "unsafe_token_position" in codes(vjob(expression_kind="eval",
                                                 expression="'$a.first.f$'=1"))
    # A ' inside a double-quoted string is just a character.
    assert tokens.compile_spl('search "O\'Brien" host=$a.first.f$', ["a"])[0] == \
        'search "O\'Brien" host="$args.a__first__f$"'


def test_duplicate_pair_with_a_condition_is_refused():
    j = vjob(expression_kind="eval", expression="1=1")
    j["edges"].append({"from": "a", "to": "b", "condition": "on_success"})
    found = [i for i in errors(j) if i["code"] == "duplicate_edge"]
    assert len(found) == 1 and "remove the extra line" in found[0]["message"]
    assert found[0]["step"] == "b"
    j["edges"] = [{"from": "a", "to": "b"}, {"from": "a", "to": "b"}]
    assert "duplicate_edge" not in codes(j)


def test_engine_truncated_condition_search_fails():
    w = World()
    run_id = setup(w, ejob(kind="search", expression="index=main [search x]"),
                   {"states": ["done"], "result_count": 0, "truncated": "limit 10000"})
    for _ in range(3):
        w.tick(advance=5)
    c = w.run(run_id)["conditions"]["a>b"]
    assert c["state"] == "failed" and "cut short" in c["error"]
    assert "cut short" in w.audit.of("condition_failed")[0]["error"]


def test_engine_cancel_adopts_then_cancels_a_starting_condition():
    w = World()
    run_id = setup(w, ejob(), {"states": ["running"]})
    w.gw.crash_after_dispatch = True
    w.tick(advance=5)
    w.gw.crash_after_dispatch = False
    [d] = cond_dispatches(w)
    assert not w.run(run_id)["conditions"]["a>b"].get("sid")
    w.command(type="cancel", run_id=run_id, user="alice")
    w.engine = w.new_engine()
    w.tick(advance=5)
    c = w.run(run_id)["conditions"]["a>b"]
    assert c["state"] == "cancelled" and c["sid"] == d["sid"]
    assert (d["sid"], "cancel", {}) in w.gw.control_log
    assert w.audit.of("condition_cancelled", edge="a>b")


def test_engine_mixed_join_waits_for_every_edge():
    """c depends on a (on_success), b (simple condition) and the SPL condition from a."""
    w = World()
    j = make_job(steps=["a", "b", "c"])
    j["edges"] = [{"from": "a", "to": "c", "condition": "expression", "expression_kind": "eval",
                   "expression": "1=1", "hidden_search": COND},
                  {"from": "b", "to": "c", "condition": "expression",
                   "expression": "$b.resultCount$ > 0"},
                  {"from": "a", "to": "b", "condition": "on_success"}]
    w.add_job(j, scripts={"a": {"states": ["done"], "result_count": 1},
                          "b": {"states": ["running", "running", "running", "done"],
                                "result_count": 2}})
    w.gw.script_job(COND, states=["done"], result_count=1)
    run_id = cron_run(w, j)
    w.tick(advance=5)  # a done: condition and b start
    w.tick(advance=5)  # condition met; b still running
    run = w.run(run_id)
    assert run["conditions"]["a>c"]["state"] == "met"
    assert run["steps"]["c"]["state"] == "waiting"
    for _ in range(5):
        w.tick(advance=5)
    run = w.run(run_id)
    assert run["steps"]["c"]["state"] == "succeeded" and run["state"] == "succeeded"


def test_engine_mixed_join_not_met_and_true_still_runs():
    """An SPL condition not met next to a satisfied on_success edge: the step runs (one
    satisfied edge is enough once all resolved)."""
    w = World()
    j = make_job(steps=["a", "b", "c"])
    j["edges"] = [{"from": "a", "to": "c", "condition": "expression", "expression_kind": "eval",
                   "expression": "1=0", "hidden_search": COND},
                  {"from": "b", "to": "c", "condition": "on_success"}]
    w.add_job(j)
    w.gw.script_job(COND, states=["done"], result_count=0)
    run_id = cron_run(w, j)
    for _ in range(5):
        w.tick(advance=5)
    run = w.run(run_id)
    assert run["conditions"]["a>c"]["state"] == "not_met"
    assert run["steps"]["c"]["state"] == "succeeded"


def test_engine_condition_searches_count_toward_limits():
    w = World()
    w.store.save_settings({"max_searches_per_job": 2})
    j = make_job(steps=["a", "b", "x", "y"])
    j["edges"] = [{"from": "a", "to": "b", "condition": "expression", "expression_kind": "eval",
                   "expression": "1=1", "hidden_search": COND}]
    w.add_job(j, scripts={"a": {"states": ["done"]}, "x": {"states": ["running"]},
                          "y": {"states": ["running"]}})
    w.gw.script_job(COND, states=["running"])
    run_id = cron_run(w, j)  # a and x start (limit 2); y waits
    w.tick(advance=5)  # a done: one slot, the condition takes it before y
    run = w.run(run_id)
    assert run["conditions"]["a>b"]["state"] == "running"
    assert run["steps"]["y"]["state"] == "ready"
    assert w.in_flight() == 1  # x; the condition is the second search
    w.tick(advance=5)
    assert w.run(run_id)["steps"]["y"]["state"] == "ready"


def test_engine_transient_condition_dispatch_error_is_retried():
    w = World()
    run_id = setup(w, ejob(), {"states": ["done"], "result_count": 1})
    w.gw.fail_dispatch(COND, transient=True)
    w.tick(advance=5)
    c = w.run(run_id)["conditions"]["a>b"]
    assert c["state"] == "starting" and "trying again" in c["error"]
    for _ in range(3):
        w.tick(advance=5)
    assert w.run(run_id)["conditions"]["a>b"]["state"] == "met"
    assert len(cond_dispatches(w)) == 1


def test_engine_permanent_condition_dispatch_error_fails():
    w = World()
    run_id = setup(w, ejob(), {"states": ["done"]})
    w.gw.fail_dispatch(COND, transient=False)
    w.tick(advance=5)
    c = w.run(run_id)["conditions"]["a>b"]
    assert c["state"] == "failed" and w.audit.of("condition_failed")


def test_gc_keeps_condition_searches_in_use_and_drops_stale_ones():
    gw = FakeGateway()
    one = hidden.sync(gw, cjob(expression_kind="eval", expression="1=1"), None)
    two = hidden.sync(gw, cjob(expression_kind="eval", expression="2=2"), one)
    old, new = one["edges"][0]["hidden_search"], two["edges"][0]["hidden_search"]
    assert hidden.gc(two, []) == [{"owner": "alice", "name": old}]
    assert hidden.gc(two, [{"definition": one, "owner": "alice"}]) == []
    assert {"owner": "alice", "name": new} in two["hidden_searches"]
