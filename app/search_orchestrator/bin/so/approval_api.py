"""Approve or reject an approval step (features-2 spec section 8), dispatched from
``api.handle``.

``POST runs/<run_id>/approve`` ``{"step_id", "decision": "approve"|"reject", "comment"}``
queues the engine command ``{"type": "approve", "run_id", "step_id", "decision",
"comment", "user"}`` and answers 202 ``{"command_id"}``; the engine applies it on its next
tick (``approval.apply_command``). ``comment`` is at most 1000 characters and required to
reject. A run the caller can't see is 404. The caller must pass ``authz.can_approve`` or
be the user who started the run (403 otherwise, audited ``permission_denied``). A step
that isn't waiting, or already has a decision, is 409 ``not_awaiting_approval``.
"""
from . import approval, authz
from .api import ApiError, _enqueue, _run_job, _visible_run

COMMENT_MAX = 1000


def _approval_step(run, step_id):
    for s in (run.get("definition") or {}).get("steps") or []:
        if s.get("id") == step_id and approval.is_approval(s):
            return s
    raise ApiError(400, "bad_request", "the run has no approval step %r" % (step_id,))


def _check_access(ctx, run, step):
    if ctx.user and ctx.user == run.get("started_by"):
        return
    roles, caps = ctx.access["roles"], ctx.access["capabilities"]
    if authz.can_approve(ctx.user, _run_job(ctx, run), step, roles, caps):
        return
    ctx.emit({"type": "permission_denied", "action": "approve_step",
              "run_id": run.get("id"), "step_id": step.get("id")})
    if authz.APPROVE not in set(caps or ()):
        message = "You need the %s capability (ask an admin)" % authz.APPROVE
    else:
        message = "Only members of %s may approve this step" % " or ".join(
            approval.config(step).get("approver_roles") or [])
    raise ApiError(403, "forbidden", message)


def _decision(body):
    decision = body.get("decision")
    if decision not in approval.ON_TIMEOUT:
        raise ApiError(400, "bad_request", "decision must be approve or reject")
    comment = body.get("comment")
    if comment is not None and not isinstance(comment, str):
        raise ApiError(400, "bad_request", "comment must be text")
    comment = (comment or "").strip()
    if decision == "reject" and not comment:
        raise ApiError(400, "bad_request", "Add a comment saying why you reject")
    if len(comment) > COMMENT_MAX:
        raise ApiError(400, "bad_request", "The comment can be at most 1000 characters")
    return decision, comment


def approve(ctx, body, run_id):
    run = _visible_run(ctx, run_id)
    step_id = body.get("step_id")
    step = _approval_step(run, step_id)
    _check_access(ctx, run, step)
    decision, comment = _decision(body)
    st = (run.get("steps") or {}).get(step_id) or {}
    if st.get("state") != approval.AWAITING or (st.get("approval_state") or {}).get("decision"):
        raise ApiError(409, "not_awaiting_approval", "%s isn't waiting for approval" % step_id)
    key = _enqueue(ctx, {"type": "approve", "run_id": run.get("id") or run_id,
                         "step_id": step_id, "decision": decision, "comment": comment})
    return 202, {"command_id": key}
