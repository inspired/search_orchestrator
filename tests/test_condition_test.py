"""Test condition route (spec section 4): POST preview/condition."""
from so import condition_test, preview
from test_api import T0, job_body, live, w  # noqa: F401  (w is a fixture)

URL = "/orchestrator/preview/condition"


def cond_job(kind=None, expression="$daily.resultCount$ > 0", daily=None, **edge):
    line = {"from": "daily", "to": "weekly", "condition": "expression", "expression": expression}
    if kind:
        line["expression_kind"] = kind
    line.update(edge)
    return job_body("cond", params=[], actions=[],
                    steps=[dict({"id": "daily", "type": "inline", "spl": "| makeresults"}, **(daily or {})),
                           {"id": "weekly", "type": "inline", "spl": "| makeresults count=2"}],
                    edges=[line])


def live_daily(w, count=1204):
    w.gw.script_job("so_preview_", ["done"], result_count=count)
    sid = preview.make_sid("alice", "cond", "daily", "p1")
    w.gw.preview_dispatch("alice", "| makeresults", None, None, T0, sid)
    del w.gw.preview_log[:]
    return sid


def run(w, user="alice", job=None, inp=None, **over):
    body = {"job": job or cond_job(), "from": "daily", "to": "weekly", "scheduled_time": T0,
            "params": {}, "input": inp or live(daily={"sid": live_daily(w)})}
    body.update(over)
    return w.call(user, "POST", URL, body)


def test_simple_true(w):
    status, out = run(w)
    assert status == 200, out
    assert out["status"] == "done" and out["kind"] == "simple" and out["result"] is True
    assert out["filled"] == "1204 > 0"
    assert out["values"] == {"daily.resultCount": "1204"}
    assert out["why"] == "1204 > 0 is true"


def test_simple_false_and_parse_error(w):
    status, out = run(w, job=cond_job(expression="$daily.resultCount$ > 5000"))
    assert status == 200 and out["result"] is False and out["why"] == "1204 > 5000 is false"
    status, out = run(w, job=cond_job(expression="$daily.resultCount$ >"))
    assert status == 200 and out["result"] is False and out["error"]
    assert out["why"].startswith("The comparison can't be read: ")
    assert out["why"].endswith(". Fix it and test again.")


def test_fill_simple_marks_a_missing_value():
    assert condition_test.fill_simple("$a.b$ > 0 and $c$ == 'x'", {"a.b": "3"}) \
        == "3 > 0 and (no value) == 'x'"


def test_source_skipped_is_false_without_search(w):
    status, out = run(w, job=cond_job("eval", daily={"run_when": {"kind": "cron", "value": "0 5 * * *"}}),
                     inp=live(daily={"skipped": "run_when"}))
    assert status == 200, out
    assert out["result"] is False and out["kind"] == "eval"
    assert out["why"].startswith("daily would be skipped")
    assert not w.gw.preview_log


def test_eval_dispatches_as_caller(w):
    status, out = run(w, job=cond_job("eval"))
    assert status == 201, out
    assert out["status"] == "started" and out["kind"] == "eval"
    expected = '| makeresults | where tonumber("1204") > 0'
    assert out["spl"] == expected
    assert out["earliest"] == "-1m" and out["latest"] == "now"
    log = w.gw.preview_log[-1]
    assert log["spl"].startswith(expected) and log["earliest"] == "-1m" and log["now"] == T0
    assert log["user"] == "alice" and log["sid"] == out["sid"]
    assert ("user:alice", "preview_dispatch") in w.calls
    assert preview.parts(out["sid"])[2] == "weekly"
    assert preview.parts(out["sid"])[3].startswith("c")


def test_search_uses_its_time_range(w):
    job = cond_job("search", expression="index=main | stats count")
    status, out = run(w, job=job)
    assert status == 201, out
    assert (out["earliest"], out["latest"]) == ("-24h", "now")
    assert out["spl"].endswith("| head 1")
    assert (w.gw.preview_log[-1]["earliest"], w.gw.preview_log[-1]["latest"]) == ("-24h", "now")
    status, out = run(w, job=cond_job("search", expression="index=main", earliest="-7d",
                                      latest="@d"))
    assert (out["earliest"], out["latest"]) == ("-7d", "@d")


def test_needs_preview(w):
    status, out = run(w, inp=live())
    assert status == 409 and out["error"]["code"] == "needs_preview"
    assert out["error"]["steps"] == ["daily"]


def test_unknown_edge(w):
    status, out = run(w, to="nosuch")
    assert status == 400 and out["error"]["code"] == "unknown_edge"
    assert out["error"]["message"] == "the job has no condition line from daily to nosuch"


def test_run_only_user_forbidden(w):
    assert run(w, "carol")[0] == 403
    assert not w.gw.preview_log


def test_audited(w):
    status, out = run(w, job=cond_job("eval"))
    events = w.audit.of("condition_tested")
    assert len(events) == 1
    assert {k: events[0][k] for k in ("job_id", "edge", "kind", "sid", "user")} == \
        {"job_id": "cond", "edge": "daily>weekly", "kind": "eval", "sid": out["sid"],
         "user": "alice"}
    status, out = run(w)
    assert "sid" not in w.audit.of("condition_tested")[-1]


def test_route_is_not_shadowed(w):
    assert run(w)[0] != 405


def gate_cond_job(expression="$gate.first.decision$ == 'approve'"):
    return job_body("cond", params=[], actions=[],
                    steps=[{"id": "daily", "type": "inline", "spl": "| makeresults"},
                           {"id": "gate", "type": "approval", "approval": {}},
                           {"id": "weekly", "type": "inline", "spl": "| makeresults count=2"}],
                    edges=[{"from": "daily", "to": "gate"},
                           {"from": "gate", "to": "weekly", "condition": "expression",
                            "expression": expression}])


def test_a_line_from_an_approval_step_is_tested_as_approved_with_no_comment(w):
    status, out = run(w, job=gate_cond_job(), **{"from": "gate"})
    assert status == 200, out
    assert out["result"] is True and out["filled"] == "approve == 'approve'"
    status, out = run(w, job=gate_cond_job("$gate.first.comment$ == 'x'"), **{"from": "gate"})
    assert status == 200 and out["result"] is False
    assert not w.gw.preview_log
