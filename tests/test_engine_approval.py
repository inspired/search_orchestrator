"""Approval decisions through Engine.tick() (features-2 spec section 8: Behaviour, Audit).

Two decisions for one approval, or a decision in the tick its timeout expires, give
exactly one effective decision; the other is audited ``approval_ignored`` and the step's
hooks fire once."""
from so.gateway import KvError
from test_engine import T0, World, make_job

EVENT = {"type": "event", "index": "main", "payload": "x"}


def gate_world(cfg=None, extra_steps=(), extra_edges=(), settings=None, **over):
    """A manual run whose gate awaits approval (daily succeeded first)."""
    w = World(T0)
    if settings:
        w.store.save_settings(settings)
    gate = {"id": "gate", "type": "approval", "approval": dict(cfg or {}),
            "hidden_search": None,
            "actions": [dict(EVENT, hook=h, hidden_search="_so_j_action_%s_0123abcd" % h)
                        for h in ("on_success", "on_failure", "on_approval_requested")]}
    j = make_job(steps=["daily", gate, "after"] + list(extra_steps),
                 edges=[("daily", "gate"), ("gate", "after")] + list(extra_edges), cron=None,
                 **over)
    j["steps"][1].pop("spl")
    w.add_job(j)
    r = w.manual(j)
    for _ in range(4):
        w.tick(advance=5)
        if w.step(r, "gate")["state"] == "awaiting_approval":
            return w, r
    raise AssertionError(w.run(r)["steps"])


def approve(w, r, decision="approve", user="bob", comment="ok"):
    w.command(type="approve", run_id=r, step_id="gate", decision=decision, user=user,
              comment=comment)


def test_approve_then_downstream_runs():
    w, r = gate_world()
    approve(w, r)
    w.tick(advance=5)
    gate = w.step(r, "gate")
    assert gate["state"] == "succeeded"
    assert gate["approval_state"]["decision"] == "approve"
    assert gate["approval_state"]["by"] == "bob" and gate["approval_state"]["comment"] == "ok"
    assert gate["approval_state"]["decided_at"] == w.clock.t
    decided = w.audit.of("approval_decided", run_id=r)
    assert len(decided) == 1
    assert {k: decided[0].get(k) for k in ("step_id", "decision", "user", "comment",
                                           "by_timeout")} == \
        {"step_id": "gate", "decision": "approve", "user": "bob", "comment": "ok",
         "by_timeout": False}
    assert w.dispatched("after")
    assert len(w.action_rows(hook="on_success", step_id="gate", scope="step")) == 1
    assert not w.gw.kv.get("so_commands")


def test_comment_is_always_a_string():
    w, r = gate_world()
    w.command(type="approve", run_id=r, step_id="gate", decision="approve", user="bob")
    w.tick(advance=5)
    assert w.step(r, "gate")["approval_state"]["comment"] == ""
    assert w.step(r, "gate")["first"] == {"decision": "approve", "by": "bob", "comment": ""}


def test_reject_fails_the_step():
    w, r = gate_world()
    approve(w, r, "reject", comment="not today")
    w.tick(advance=5)
    gate = w.step(r, "gate")
    assert gate["state"] == "failed" and gate["error"] == "Rejected by bob: not today"
    assert not w.dispatched("after")
    assert len(w.action_rows(hook="on_failure", step_id="gate", scope="step")) == 1


def test_second_decision_is_ignored():
    w, r = gate_world()
    approve(w, r, user="bob")
    approve(w, r, "reject", user="carol", comment="no")
    w.tick(advance=5)
    assert w.step(r, "gate")["state"] == "succeeded"
    assert w.step(r, "gate")["approval_state"]["by"] == "bob"
    assert len(w.audit.of("approval_decided", run_id=r)) == 1
    ignored = w.audit.of("approval_ignored", run_id=r)
    assert len(ignored) == 1 and ignored[0]["user"] == "carol"
    assert ignored[0]["reason"] == "already decided by bob"
    assert w.audit.of("command", command="approve", result="rejected",
                      detail="already decided by bob")
    assert len(w.action_rows(hook="on_success", step_id="gate", scope="step")) == 1
    assert not w.action_rows(hook="on_failure", step_id="gate")
    # A decision after the step settled is ignored too.
    approve(w, r, user="dave")
    w.tick(advance=5)
    assert len(w.audit.of("approval_ignored", run_id=r)) == 2
    assert len(w.action_rows(hook="on_success", step_id="gate", scope="step")) == 1


def test_decision_and_timeout_in_same_tick():
    w, r = gate_world({"timeout": 300})
    started = w.step(r, "gate")["started_at"]
    approve(w, r, "reject", comment="too risky")
    w.tick(at=started + 300)  # the timeout expires in this tick: commands apply first
    gate = w.step(r, "gate")
    assert gate["state"] == "failed" and gate["error"] == "Rejected by bob: too risky"
    decided = w.audit.of("approval_decided", run_id=r)
    assert len(decided) == 1 and decided[0]["by_timeout"] is False
    assert len(w.action_rows(hook="on_failure", step_id="gate", scope="step")) == 1


def test_reject_beats_a_timeout_that_would_approve():
    w, r = gate_world({"timeout": 300, "on_timeout": "approve"})
    started = w.step(r, "gate")["started_at"]
    approve(w, r, "reject", comment="too risky")
    w.tick(at=started + 300)  # had the timeout won, the step would have succeeded
    gate = w.step(r, "gate")
    assert gate["state"] == "failed" and gate["error"] == "Rejected by bob: too risky"
    assert gate["approval_state"]["by"] == "bob"
    decided = w.audit.of("approval_decided", run_id=r)
    assert len(decided) == 1 and decided[0]["by_timeout"] is False
    assert not w.action_rows(hook="on_success", step_id="gate", scope="step")
    assert not w.dispatched("after")


def test_timeout_decision_is_audited():
    w, r = gate_world({"timeout": 300, "on_timeout": "approve"})
    w.tick(at=w.step(r, "gate")["started_at"] + 300)
    assert w.step(r, "gate")["state"] == "succeeded"
    decided = w.audit.of("approval_decided", run_id=r)
    assert len(decided) == 1
    assert {k: decided[0].get(k) for k in ("step_id", "decision", "user", "comment",
                                           "by_timeout")} == \
        {"step_id": "gate", "decision": "approve", "user": "timeout", "comment": "",
         "by_timeout": True}
    assert w.step(r, "gate")["approval_state"]["comment"] == ""
    assert w.step(r, "gate")["first"] == {"decision": "approve", "by": "timeout", "comment": ""}
    approve(w, r)
    w.tick(advance=5)
    assert w.audit.of("approval_ignored", run_id=r)[0]["reason"] == "already decided by timeout"


def test_decision_while_paused_applies_on_resume():
    w, r = gate_world()
    w.command(type="pause", run_id=r)
    w.tick(advance=5)
    approve(w, r)
    w.tick(advance=5)
    assert w.run(r)["state"] == "paused"
    gate = w.step(r, "gate")
    assert gate["state"] == "awaiting_approval" and gate["approval_state"]["decision"] == "approve"
    assert not w.action_rows(hook="on_success", step_id="gate")
    w.command(type="resume", run_id=r)
    w.tick(advance=5)
    assert w.step(r, "gate")["state"] == "succeeded"
    assert len(w.action_rows(hook="on_success", step_id="gate", scope="step")) == 1


def test_replayed_command_is_ignored():
    w, r = gate_world()
    real = w.store.delete_command
    calls = []

    def delete_once(key):
        calls.append(key)
        if len(calls) == 1:
            raise KvError("KV Store is restarting", status=503, transient=True)
        return real(key)

    w.store.delete_command = delete_once
    approve(w, r)
    w.tick(advance=5)  # the decision is saved, then the tick stops before the delete
    assert w.step(r, "gate")["approval_state"]["decision"] == "approve"
    assert len(w.gw.kv["so_commands"]) == 1
    w.tick(advance=5)  # the same command again
    gate = w.step(r, "gate")
    assert gate["state"] == "succeeded" and gate["approval_state"]["by"] == "bob"
    assert len(w.audit.of("approval_decided", run_id=r)) == 1
    assert len(w.audit.of("approval_ignored", run_id=r)) == 1
    assert len(w.action_rows(hook="on_success", step_id="gate", scope="step")) == 1
    assert not w.gw.kv.get("so_commands")


def test_approval_requested_once():
    w, r = gate_world()
    for _ in range(3):
        w.tick(advance=5)
    requested = w.audit.of("approval_requested", run_id=r)
    assert len(requested) == 1 and requested[0]["step_id"] == "gate"
    assert len(w.action_rows(hook="on_approval_requested", step_id="gate", scope="step")) == 1


def test_waiting_gate_uses_no_search_slot():
    w, r = gate_world(extra_steps=[{"id": "side", "type": "inline", "spl": "| makeresults"}],
                      extra_edges=[("daily", "side")], settings={"max_searches_per_job": 1})
    # daily held the job's one slot; the gate and side became ready together.
    assert w.step(r, "gate")["state"] == "awaiting_approval"
    assert w.dispatched("side")
    assert not [d for d in w.gw.dispatch_log if d["name"].split("_")[3] == "gate"]


def test_results_of_earlier_steps_after_an_approval_runs_its_empty_search():
    """An approval succeeds with no search, so a previous step after it has no input to
    load; it runs its empty-input search instead of failing on a bad search id."""
    prev = {"id": "prev", "type": "previous", "spl": '| eval by="x"'}
    w, r = gate_world(extra_steps=[prev], extra_edges=[("gate", "prev")])
    approve(w, r)
    for _ in range(4):
        w.tick(advance=5)
    sent = w.dispatched("prev")
    assert sent, w.run(r)["steps"]["prev"]
    defn = w.run(r)["definition"]
    empty = next(s for s in defn["steps"] if s["id"] == "prev")["hidden_search_empty"]
    assert sent[0]["name"] == empty
    assert w.step(r, "prev")["state"] != "failed"
