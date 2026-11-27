"""Approval steps in the pure evaluator (spec section 8, Behaviour)."""
import copy

from so import approval, state
from test_state import T0, engine_finish, engine_start, ev, hooks, make_run, starts, step


def gate_job(approval_cfg=None, after=True, failure_edge=False, **over):
    steps = [{"id": "daily", "type": "inline", "spl": "| makeresults"},
             {"id": "gate", "type": "approval", "approval": dict(approval_cfg or {})}]
    edges = [{"from": "daily", "to": "gate", "condition": "on_success"}]
    if after:
        steps.append({"id": "after", "type": "inline", "spl": "| makeresults"})
        edges.append({"from": "gate", "to": "after", "condition": "on_success"})
    if failure_edge:
        steps.append({"id": "tidy", "type": "inline", "spl": "| makeresults"})
        edges.append({"from": "gate", "to": "tidy", "condition": "on_failure"})
    j = {"id": "j", "timezone": "UTC", "defaults": {}, "steps": steps, "edges": edges,
         "actions": []}
    j.update(over)
    return j


def waiting_run(approval_cfg=None, now=T0, **over):
    """A run whose daily step succeeded (12 rows) and whose gate now awaits approval."""
    r, _ = ev(make_run(gate_job(approval_cfg, **over)), now)
    r = engine_start(r, "daily", now, "s_daily")
    r = engine_finish(r, "daily", now, result_count=12)
    r, eff = ev(r, now)
    return r, eff


def decide(run, decision, by="bob", comment="ok"):
    r = copy.deepcopy(run)
    r["steps"]["gate"]["approval_state"].update(decision=decision, by=by, comment=comment)
    return r


def test_ready_approval_waits():
    r, eff = waiting_run()
    gate = step(r, "gate")
    assert gate["state"] == approval.AWAITING == "awaiting_approval"
    assert gate["started_at"] == T0 and gate["attempt"] == 1
    assert gate["approval_state"] == {"requested_at": T0, "message": "", "decision": None}
    assert ("step", "on_start", "gate") in hooks(eff)
    assert ("step", "on_approval_requested", "gate") in hooks(eff)
    assert hooks(eff).index(("step", "on_start", "gate")) < \
        hooks(eff).index(("step", "on_approval_requested", "gate"))
    assert "gate" not in starts(eff)
    # Later evaluations neither start it nor ask again.
    r2, eff2 = ev(r, T0 + 60)
    assert "gate" not in starts(eff2) and not [h for h in hooks(eff2) if h[2] == "gate"]
    assert step(r2, "gate")["state"] == "awaiting_approval"


def test_waiting_is_activity():
    r, _ = waiting_run()
    r, eff = ev(r, T0 + 3600)
    assert r["state"] == "running"
    assert not [e for e in eff if e[0] == "set_run" and e[1].get("state") == "blocked"]
    # A blocked run whose only activity is a waiting gate goes back to running.
    r2, _ = ev(dict(r, state="blocked"), T0 + 3601)
    assert r2["state"] == "running"


def test_approve():
    r, _ = waiting_run()
    r, eff = ev(decide(r, "approve"), T0 + 100)
    gate = step(r, "gate")
    assert gate["state"] == "succeeded" and gate["result_count"] == 0
    assert gate["first"] == {"decision": "approve", "by": "bob", "comment": "ok"}
    assert gate["ended_at"] == T0 + 100
    assert ("step", "on_success", "gate") in hooks(eff)
    assert ("step", "on_complete", "gate") in hooks(eff)
    assert step(r, "after")["state"] == "ready" and starts(eff) == ["after"]


def test_reject():
    r, _ = waiting_run(failure_edge=True)
    r, eff = ev(decide(r, "reject", comment="no"), T0 + 100)
    gate = step(r, "gate")
    assert gate["state"] == "failed" and gate["error"] == "Rejected by bob: no"
    assert gate["ended_at"] == T0 + 100
    assert ("step", "on_failure", "gate") in hooks(eff)
    assert ("step", "on_complete", "gate") in hooks(eff)
    assert step(r, "tidy")["state"] == "ready" and starts(eff) == ["tidy"]
    assert r["state"] == "running"
    # Without an on_failure line the run is blocked; a reject is never retried.
    r, _ = waiting_run(retries=2)
    r, eff = ev(decide(r, "reject", comment="no"), T0 + 100)
    assert step(r, "gate")["state"] == "failed" and r["state"] == "blocked"
    assert step(r, "after")["state"] == "waiting"


def test_timeout_reject_and_approve():
    r, _ = waiting_run({"timeout": 14400})
    r1, _ = ev(r, T0 + 14399)
    assert step(r1, "gate")["state"] == "awaiting_approval"
    r1, eff = ev(r, T0 + 14400)
    assert step(r1, "gate")["state"] == "failed"
    assert step(r1, "gate")["error"] == "No decision within 4 hours"
    assert ("step", "on_failure", "gate") in hooks(eff)
    r, _ = waiting_run({"timeout": 900, "on_timeout": "reject"})
    r1, _ = ev(r, T0 + 900)
    assert step(r1, "gate")["error"] == "No decision within 15 minutes"
    r, _ = waiting_run({"timeout": 14400, "on_timeout": "approve"})
    r2, eff = ev(r, T0 + 14400)
    gate = step(r2, "gate")
    assert gate["state"] == "succeeded" and gate["result_count"] == 0
    assert gate["first"]["by"] == "timeout" and gate["first"]["decision"] == "approve"
    assert ("step", "on_success", "gate") in hooks(eff)
    assert starts(eff) == ["after"]


def test_no_timeout_while_paused():
    r, _ = waiting_run({"timeout": 600})
    paused = dict(r, state="paused", paused_at=T0 + 100)
    p, eff = ev(paused, T0 + 5000)
    assert step(p, "gate")["state"] == "awaiting_approval"
    assert not [h for h in hooks(eff) if h[2] == "gate"]
    # A decision recorded while paused takes effect on resume.
    p, _ = ev(decide(paused, "approve"), T0 + 5001)
    assert step(p, "gate")["state"] == "awaiting_approval"
    resumed = dict(decide(paused, "approve"), state="running", paused_at=None,
                   paused_seconds=4900)
    resumed, _ = ev(resumed, T0 + 5002)
    assert step(resumed, "gate")["state"] == "succeeded"


def test_ready_approval_not_requested_while_paused():
    r, _ = ev(make_run(gate_job()), T0)
    r = engine_start(r, "daily", T0, "s_daily")
    r = engine_finish(r, "daily", T0)
    r, eff = ev(dict(r, state="paused", paused_at=T0), T0 + 1)
    assert step(r, "gate")["state"] == "ready"
    assert not [h for h in hooks(eff) if h[2] == "gate"]
    r, eff = ev(dict(r, state="running", paused_at=None, paused_seconds=9), T0 + 10)
    assert step(r, "gate")["state"] == "awaiting_approval"
    assert "gate" not in starts(eff)


def test_give_up_while_waiting():
    j_over = {"defaults": {"give_up_after": 1000}}
    r, _ = waiting_run(**j_over)
    r, eff = ev(r, T0 + 1000)
    gate = step(r, "gate")
    assert gate["state"] == "failed" and gate["error"] == "gave up after 1000 seconds"
    assert step(r, "after")["state"] == "failed"  # waiting, its deadline passed too
    assert r["state"] == "failed" and r["gave_up"] is True
    assert not [e for e in eff if e[0] == "cancel_search"]
    # A gate whose own deadline has not passed is abandoned.
    r, _ = waiting_run(**j_over)
    r["definition"]["steps"][1]["give_up_after"] = 99999
    r, _ = ev(r, T0 + 1000)
    assert step(r, "gate")["state"] == "abandoned" and r["state"] == "failed"


def test_cancel_while_waiting():
    r, _ = waiting_run()
    r, eff = ev(dict(r, state="cancelled"), T0 + 50)
    assert step(r, "gate")["state"] == "cancelled"
    assert step(r, "after")["state"] == "cancelled"
    assert not [e for e in eff if e[0] == "cancel_search"]


def test_rerun_asks_again():
    r, _ = waiting_run()
    r, _ = ev(decide(r, "reject", comment="no"), T0 + 100)
    assert r["state"] == "blocked"
    n = state.reset_for_rerun(r, "gate", T0 + 200)
    assert n["steps"]["gate"]["approval_state"] is None
    assert n["steps"]["gate"]["state"] == "waiting"
    n, eff = ev(n, T0 + 200)
    gate = step(n, "gate")
    assert gate["state"] == "awaiting_approval" and gate["approval_state"]["decision"] is None
    assert ("step", "on_approval_requested", "gate") in hooks(eff)
    assert "gate" not in starts(eff)


def test_preview_after_approval_runs():
    job = gate_job()
    done = {"daily": {"state": "succeeded", "sid": "s", "result_count": 3}}
    assert state.preview_decision(job, "after", T0, {}, done) == ("run", None)
    assert state.preview_decision(job, "after", T0, {}, {}) == ("run", None)
    # A state the caller gives for the gate is used as is.
    assert state.preview_decision(job, "after", T0, {}, {"gate": {"state": "failed"}}) \
        == ("needs", "gate")


def test_message_tokens_filled():
    r, _ = waiting_run({"message": "Rows: $daily.resultCount$ for $run.id$"})
    assert step(r, "gate")["approval_state"]["message"] == "Rows: 12 for r1"


def test_job_without_approval_unchanged():
    j = {"id": "j", "timezone": "UTC", "defaults": {}, "actions": [],
         "steps": [{"id": "a", "type": "inline", "spl": "| x"}], "edges": []}
    eff = state.evaluate(make_run(j), T0)
    assert starts(eff) == ["a"]
    assert [e for e in eff if e[0] == "set_step"] == [("set_step", "a", {"state": "ready",
                                                                         "attempt": 1})]


def test_first_fields_include_approval_message_tokens():
    from so.engine import first_fields
    j = gate_job({"message": "Top host $daily.first.host$"})
    assert first_fields(j) == {"daily": {"host"}}


def test_engine_never_dispatches_or_counts_an_approval_step():
    import test_engine as te
    w = te.World()
    branches = ["b1", "b2", "b3", "b4"]
    gate = {"id": "gate", "type": "approval", "hidden_search": None,
            "approval": {"message": "Go?"},
            "actions": [{"hook": "on_approval_requested", "type": "email",
                         "to": "a@b.c", "hidden_search": "_so_gate_action"}]}
    j = w.add_job(te.make_job(steps=[gate] + branches + ["after"],
                              edges=[("gate", "after")] + [(b, "after") for b in branches]),
                  scripts={b: {"states": ["running"]} for b in branches})
    run_id = te.cron_run(w, j)
    w.tick(advance=5)
    assert w.step(run_id, "gate")["state"] == "awaiting_approval"
    assert w.in_flight() == 4  # the per-job limit, all four searches: the gate holds no slot
    assert sorted(d["name"].split("_")[3] for d in w.gw.dispatch_log) == branches
    rows = w.action_rows(hook="on_approval_requested", step_id="gate")
    assert len(rows) == 1 and rows[0]["ctx"]["approval_message"] == "Go?"
    run = w.run(run_id)
    run["steps"]["gate"]["approval_state"].update(decision="approve", by="bob", comment="ok")
    w.store.save_run(run)
    w.tick(advance=5)
    assert w.step(run_id, "gate")["state"] == "succeeded"
    assert "gate" not in [d["name"].split("_")[3] for d in w.gw.dispatch_log]
