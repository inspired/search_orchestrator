"""Approve and reject over REST (features-2 spec section 8, Permissions and REST)."""
import pytest

from so import approval
from so.store import COMMANDS
from test_api import RUN, error, job_body, preview, saved, start, w  # noqa: F401  (w is a fixture)

APPROVE = ["orchestrator_run", "orchestrator_approve"]


def gate_job(**cfg):
    return job_body(steps=[{"id": "a", "type": "inline", "spl": "| makeresults"},
                           {"id": "gate", "type": "approval", "approval": dict(cfg)}],
                    edges=[{"from": "a", "to": "gate"}])


def awaiting(w, user="alice", **cfg):
    """A run of the gate job whose gate step awaits approval."""
    w.gw.users.update({
        "erin": {"roles": ["ops"], "capabilities": APPROVE},
        "frank": {"roles": ["approver"], "capabilities": APPROVE},  # can't see the job
        "gina": {"roles": ["ops", "ops-leads"], "capabilities": APPROVE}})
    saved(w, body=gate_job(**cfg))
    run_id = start(w, user)
    run = w.store.get_run(run_id)
    run["state"] = "running"
    run["steps"]["a"] = {"state": "succeeded", "result_count": 1}
    run["steps"]["gate"] = {"state": approval.AWAITING, "started_at": w.now, "attempt": 1,
                            "approval_state": {"requested_at": w.now, "message": "",
                                               "decision": None}}
    w.store.save_run(run)
    return run_id


def post(w, run_id, body, user="erin"):
    return w.call(user, "POST", "/orchestrator/runs/%s/approve" % run_id, body)


def test_approver_queues_an_approve_command(w):
    run_id = awaiting(w)
    status, out = post(w, run_id, {"step_id": "gate", "decision": "approve"})
    assert status == 202, out
    cmds = w.gw.kv_query(COMMANDS)
    assert len(cmds) == 1 and out == {"command_id": cmds[0]["_key"]}
    assert {k: cmds[0].get(k) for k in ("type", "run_id", "step_id", "decision", "comment",
                                        "user")} == \
        {"type": "approve", "run_id": run_id, "step_id": "gate", "decision": "approve",
         "comment": "", "user": "erin"}
    status, _ = post(w, run_id, {"step_id": "gate", "decision": "reject", "comment": "no"})
    assert status == 202 and w.gw.kv_query(COMMANDS)[-1]["comment"] == "no"


BAD = [
    ({"step_id": "gate", "decision": "maybe"}, "decision must be approve or reject"),
    ({"step_id": "gate"}, "decision must be approve or reject"),
    ({"step_id": "gate", "decision": "reject"}, "Add a comment saying why you reject"),
    ({"step_id": "gate", "decision": "reject", "comment": "   "},
     "Add a comment saying why you reject"),
    ({"step_id": "gate", "decision": "approve", "comment": "x" * 1001},
     "The comment can be at most 1000 characters"),
    ({"step_id": "a", "decision": "approve"}, "the run has no approval step 'a'"),
    ({"step_id": "nope", "decision": "approve"}, "the run has no approval step 'nope'"),
]


@pytest.mark.parametrize("body,message", BAD)
def test_bad_requests(w, body, message):
    run_id = awaiting(w)
    status, out = post(w, run_id, body)
    assert (status, error(out), out["error"]["message"]) == (400, "bad_request", message)
    assert not w.gw.kv_query(COMMANDS)


def test_a_step_that_is_not_waiting_is_409(w):
    run_id = awaiting(w)
    run = w.store.get_run(run_id)
    run["steps"]["gate"]["state"] = "succeeded"
    w.store.save_run(run)
    status, out = post(w, run_id, {"step_id": "gate", "decision": "approve"})
    assert (status, error(out), out["error"]["message"]) == \
        (409, "not_awaiting_approval", "gate isn't waiting for approval")
    run["steps"]["gate"].update(state=approval.AWAITING, approval_state={
        "requested_at": w.now, "message": "", "decision": "approve", "by": "bob"})
    w.store.save_run(run)  # decided, not yet settled by the engine
    status, out = post(w, run_id, {"step_id": "gate", "decision": "reject", "comment": "x"})
    assert (status, error(out)) == (409, "not_awaiting_approval")


def test_without_the_capability_403(w):
    run_id = awaiting(w)
    status, out = post(w, run_id, {"step_id": "gate", "decision": "approve"}, user="carol")
    assert (status, error(out), out["error"]["message"]) == \
        (403, "forbidden", "You need the orchestrator_approve capability (ask an admin)")
    assert w.audit.of("permission_denied")[-1]["action"] == "approve_step"
    assert not w.gw.kv_query(COMMANDS)


def test_approver_roles_limit_who_decides(w):
    run_id = awaiting(w, approver_roles=["ops-leads"])
    status, out = post(w, run_id, {"step_id": "gate", "decision": "approve"})
    assert (status, error(out), out["error"]["message"]) == \
        (403, "forbidden", "Only members of ops-leads may approve this step")
    assert post(w, run_id, {"step_id": "gate", "decision": "approve"}, user="gina")[0] == 202
    assert post(w, run_id, {"step_id": "gate", "decision": "approve"}, user="root")[0] == 202


def test_approver_who_cannot_see_the_job_gets_404(w):
    run_id = awaiting(w)
    status, out = post(w, run_id, {"step_id": "gate", "decision": "approve"}, user="frank")
    assert (status, error(out)) == (404, "not_found")


def test_admin_always_decides(w):
    run_id = awaiting(w, approver_roles=["nobody"])
    assert post(w, run_id, {"step_id": "gate", "decision": "approve"}, user="root")[0] == 202


def test_the_user_who_started_the_run_may_decide(w):
    # carol holds only orchestrator_run (an ops member of run_roles) and is not in ops-leads.
    run_id = awaiting(w, user="carol", approver_roles=["ops-leads"])
    assert w.store.get_run(run_id)["started_by"] == "carol"
    status, out = post(w, run_id, {"step_id": "gate", "decision": "approve"}, user="carol")
    assert status == 202, out
    # alice, the job's owner, did not start this run and holds no orchestrator_approve.
    status, out = post(w, run_id, {"step_id": "gate", "decision": "approve"}, user="alice")
    assert (status, error(out)) == (403, "forbidden")


def test_me_says_whether_the_user_may_approve(w):
    awaiting(w)
    assert w.call("erin", "GET", "/orchestrator/me")[1]["can_approve"] is True
    assert w.call("root", "GET", "/orchestrator/me")[1]["can_approve"] is True
    assert w.call("carol", "GET", "/orchestrator/me")[1]["can_approve"] is False
    assert "orchestrator_approve" in w.call("erin", "GET", "/orchestrator/me")[1]["capabilities"]


def test_end_to_end_approve_through_the_engine(w):
    run_id = awaiting(w)
    post(w, run_id, {"step_id": "gate", "decision": "approve", "comment": "fine"})
    w.engine_tick()
    gate = w.store.get_run(run_id)["steps"]["gate"]
    assert gate["state"] == "succeeded"
    assert gate["first"] == {"decision": "approve", "by": "erin", "comment": "fine"}


def test_an_approval_step_is_never_previewed(w):
    status, out = preview(w, job=gate_job(), step_id="gate")
    assert (status, error(out)) == (400, "bad_request")
    assert out["error"]["message"] == \
        "An approval step has no search to preview; preview a step after it instead"
    assert not w.gw.preview_log
