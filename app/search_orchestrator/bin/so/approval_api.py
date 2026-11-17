"""Approve or reject an approval step (features-2 spec section 8), dispatched from
``api.handle``.

``POST runs/<run_id>/approve`` ``{"step_id", "decision": "approve"|"reject", "comment"}``
queues the engine command ``{"type": "approve", "run_id", "step_id", "decision",
"comment", "as_starter", "user"}`` and answers 202 ``{"command_id"}``; the engine applies it on its next
tick (``approval.apply_command``). ``comment`` is at most 1000 characters and required to
reject. A run the caller can't see is 404. The caller must pass ``authz.can_approve``, or
be the user who started the run when the step lists no ``approver_roles`` (the command
then has ``as_starter: true``, carried into ``approval_decided``); otherwise 403,
audited ``permission_denied``. A step
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
    """True when the caller decides as the user who started the run: they skip the
    ``orchestrator_approve`` capability, only for a step without ``approver_roles``."""
    roles, caps = ctx.access["roles"], ctx.access["capabilities"]
    job = _run_job(ctx, run)
    if authz.can_approve(ctx.user, job, step, roles, caps):
        return False
    listed = approval.config(step).get("approver_roles") or []
    starter = bool(ctx.user) and ctx.user == run.get("started_by") \
        and authz.can_view(ctx.user, job, roles, caps)
    if starter and not listed:
        return True
    ctx.emit({"type": "permission_denied", "action": "approve_step",
              "run_id": run.get("id"), "step_id": step.get("id")})
    if listed and not set(listed) & set(roles or ()) and (starter or authz.APPROVE in caps):
        message = "Only members of %s may approve this step" % " or ".join(listed)
    else:
        message = "You need the %s capability (ask an admin)" % authz.APPROVE
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
    as_starter = _check_access(ctx, run, step)
    decision, comment = _decision(body)
    st = (run.get("steps") or {}).get(step_id) or {}
    if st.get("state") != approval.AWAITING or (st.get("approval_state") or {}).get("decision"):
        raise ApiError(409, "not_awaiting_approval", "%s isn't waiting for approval" % step_id)
    key = _enqueue(ctx, {"type": "approve", "run_id": run.get("id") or run_id,
                         "step_id": step_id, "decision": decision, "comment": comment,
                         "as_starter": as_starter})
    return 202, {"command_id": key}
