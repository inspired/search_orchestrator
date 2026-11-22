"""POST runs/bulk: one action on many runs, each checked as on its own."""
from so.store import COMMANDS
from test_api import error, fail_run, job_body, saved, start, w  # noqa: F401  (w is a fixture)
from test_approval_api import APPROVE, awaiting


def bulk(w, body, user="alice"):
    return w.call(user, "POST", "/orchestrator/runs/bulk", body)


def test_cancel_many_reports_each_run(w):
    saved(w)
    one, two = start(w), start(w, body={"params": {"p": "2"}})
    fail_run(w, two)
    status, out = bulk(w, {"action": "cancel", "run_ids": [one, two, one]})
    assert status == 200, out
    assert [r["run_id"] for r in out["results"]] == [one, two]  # duplicates once
    assert out["results"][0] == {"run_id": one, "ok": True}
    assert out["results"][1]["ok"] is False and out["results"][1]["code"] == "invalid_state"
    assert [c["type"] for c in w.gw.kv_query(COMMANDS)] == ["cancel"]


def test_rerun_starts_from_the_first_failed_step_with_the_original_definition(w):
    saved(w)
    run_id = start(w)
    fail_run(w, run_id, failed_step="b")
    status, out = bulk(w, {"action": "rerun", "run_ids": [run_id]})
    assert out["results"] == [{"run_id": run_id, "ok": True}]
    cmd = w.gw.kv_query(COMMANDS)[-1]
    assert (cmd["type"], cmd["step_id"], cmd["definition"]) == ("rerun", "b", "original")


def test_approve_and_reject_decide_every_waiting_step(w):
    run_id = awaiting(w)
    status, out = bulk(w, {"action": "approve", "run_ids": [run_id]}, user="erin")
    assert out["results"] == [{"run_id": run_id, "ok": True}]
    cmd = w.gw.kv_query(COMMANDS)[-1]
    assert (cmd["type"], cmd["step_id"], cmd["decision"]) == ("approve", "gate", "approve")
    status, out = bulk(w, {"action": "reject", "run_ids": [run_id]}, user="erin")
    assert (status, error(out)) == (400, "bad_request")
    status, out = bulk(w, {"action": "reject", "run_ids": [run_id], "comment": "not now"},
                       user="erin")
    assert out["results"][0]["ok"] is True
    assert w.gw.kv_query(COMMANDS)[-1]["comment"] == "not now"


def test_a_run_not_waiting_for_approval_fails_alone(w):
    saved(w)
    run_id = start(w)
    status, out = bulk(w, {"action": "approve", "run_ids": [run_id]})
    assert out["results"][0]["code"] == "not_awaiting_approval"


def test_runs_the_user_may_not_see_or_run_fail_one_by_one(w):
    saved(w)
    run_id = start(w)
    status, out = bulk(w, {"action": "cancel", "run_ids": [run_id]}, user="mallory")
    assert status == 200 and out["results"][0]["ok"] is False
    assert out["results"][0]["code"] in ("not_found", "forbidden")
    assert not w.gw.kv_query(COMMANDS)


def test_bad_bulk_requests(w):
    for body in ({"action": "explode", "run_ids": ["a:1"]}, {"action": "cancel", "run_ids": []},
                 {"action": "cancel", "run_ids": "a:1"},
                 {"action": "cancel", "run_ids": ["x:%d" % i for i in range(101)]},
                 {"action": "cancel", "run_ids": ["../etc"]}):
        status, out = bulk(w, body)
        assert (status, error(out)) == (400, "bad_request"), body
