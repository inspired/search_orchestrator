"""Approval steps (spec section 8): the step's shape and its part of the evaluator.

A step of ``type: "approval"`` runs no search. When it becomes ready the evaluator calls
``request``: the step is ``awaiting_approval`` (an active state, so the run is not blocked,
but never dispatched, polled or counted as a search) with ``approval_state``
``{"requested_at", "message", "decision"}``. A decision is written into ``approval_state``
(``decision`` "approve" | "reject", ``by``, ``comment``, ``decided_at``) by the engine's
``approve`` command (``apply_command``), which accepts only the first decision; ``settle`` derives the step's outcome from that stored decision, or from the
step's ``timeout``, so a replay never decides twice. While the run is paused nothing is
settled: a decision recorded meanwhile takes effect on resume, and the timeout does not
fire. A rejected step fails and is never retried.
"""
from . import tokens

TYPE = "approval"
AWAITING = "awaiting_approval"
TIMEOUT_MIN = 300
TIMEOUT_MAX = 604800
MESSAGE_MAX = 500
ON_TIMEOUT = ("reject", "approve")
# What a preview takes an approval step it has no state for to be: approved, no comment.
PREVIEW_STATE = {"state": "succeeded", "result_count": 0,
                 "first": {"decision": "approve", "by": "", "comment": ""}}


def is_approval(step):
    return isinstance(step, dict) and step.get("type") == TYPE


def config(step):
    cfg = step.get("approval")
    return cfg if isinstance(cfg, dict) else {}


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def shape_issues(step):
    """Error messages for an approval step's fields (``model`` reports them as
    ``bad_approval``)."""
    out = []
    if step.get("spl") or step.get("saved_search_ref"):
        out.append("An approval step has no search; remove its SPL")
    if step.get("earliest") or step.get("latest"):
        out.append("An approval step has no time range; clear its time range")
    if step.get("max_runtime") is not None:
        out.append("An approval step has no run time limit; clear Max runtime")
    if step.get("retries") not in (None, 0):
        out.append("An approval step can't retry; set Retries to 0")
    cfg = step.get("approval")
    if cfg is None:
        return out
    if not isinstance(cfg, dict):
        return out + ["The approval settings are broken; open the node and set them again"]
    timeout = cfg.get("timeout")
    if timeout is not None and not (_is_int(timeout) and TIMEOUT_MIN <= timeout <= TIMEOUT_MAX):
        out.append("Wait at most must be between 5 minutes and 7 days")
    if cfg.get("on_timeout") is not None and cfg["on_timeout"] not in ON_TIMEOUT:
        out.append("If nobody decides must be Reject or Approve")
    roles = cfg.get("approver_roles")
    if roles is not None and not (isinstance(roles, list)
                                  and all(isinstance(r, str) and r for r in roles)):
        out.append("Who may approve must be a list of role names")
    message = cfg.get("message")
    if message is not None and not (isinstance(message, str) and len(message) <= MESSAGE_MAX):
        out.append("The message can be at most 500 characters")
    return out


def message_texts(definition):
    """Every approval step's message (they may hold tokens)."""
    for s in definition.get("steps") or []:
        if is_approval(s) and isinstance(config(s).get("message"), str):
            yield config(s)["message"]


def _duration(seconds):
    if seconds >= 3600:
        n, unit = seconds / 3600.0, "hour"
    else:
        n, unit = seconds / 60.0, "minute"
    return "%g %s%s" % (n, unit, "" if n == 1 else "s")


def request(ev, sid):
    """Ask for a decision on the ready approval step ``sid`` of the evaluator ``ev``."""
    run = dict(ev.run, steps=ev.steps)  # what this evaluation has settled so far
    message = tokens.render_text(config(ev.defs[sid]).get("message") or "",
                                 tokens.run_context(run, ev.now))
    ev.set(sid, state=AWAITING, started_at=ev.now, attempt=1,
           approval_state={"requested_at": ev.now, "message": message, "decision": None})
    ev.step_hook(sid, "on_start")
    ev.step_hook(sid, "on_approval_requested")


def settle(ev, sid):
    """Decide the awaiting step ``sid`` from its stored decision or its timeout, if either
    applies; otherwise it keeps waiting."""
    if ev.paused:
        return
    st = ev.steps[sid]
    state = dict(st.get("approval_state") or {})
    cfg = config(ev.defs[sid])
    timeout = cfg.get("timeout")
    timed_out = state.get("decision") not in ON_TIMEOUT
    if timed_out:
        if not timeout or st.get("started_at") is None \
                or ev.now - int(st["started_at"]) < int(timeout):
            return
        state.update(decision=cfg.get("on_timeout") or "reject", by="timeout", comment="")
        ev.set(sid, approval_state=state)
    decision, by, comment = state["decision"], state.get("by"), state.get("comment")
    if decision == "approve":
        ev.set(sid, state="succeeded", result_count=0, ended_at=ev.now, outcome=None,
               first={"decision": "approve", "by": by, "comment": comment})
        ev.step_hook(sid, "on_success")
        ev.step_hook(sid, "on_complete")
        return
    if timed_out:
        error = "No decision within %s" % _duration(int(timeout))
    else:
        error = "Rejected by %s" % by + (": %s" % comment if comment else "")
    ev.set(sid, state="failed", error=error, ended_at=ev.now)
    ev.final_failure(sid)


def _event(run, sid, kind, now, **fields):
    return dict({"_time": now, "type": kind, "job_id": run.get("job_id"),
                 "run_id": run.get("id") or run.get("_key"), "step_id": sid}, **fields)


def apply_command(run, command, now):
    """Record the ``approve`` engine command's decision on ``run`` (not saved here).

    ``("ok", None, [approval_decided])`` once written into the step's ``approval_state``;
    ``("rejected", reason, [approval_ignored])`` when the step is not awaiting approval
    or already has a decision, so a second or replayed decision changes nothing."""
    sid, user = command.get("step_id"), command.get("user")
    st = (run.get("steps") or {}).get(sid) or {}
    state = st.get("approval_state") or {}
    decision = command.get("decision")
    if state.get("decision") in ON_TIMEOUT:
        reason = "already decided by %s" % state.get("by")
    elif st.get("state") != AWAITING:
        reason = "%s isn't waiting for approval" % sid
    elif decision not in ON_TIMEOUT:
        reason = "decision must be approve or reject"
    else:
        comment = command.get("comment")
        comment = comment if isinstance(comment, str) else ""
        st["approval_state"] = dict(state, decision=decision, by=user, comment=comment,
                                    decided_at=now)
        return "ok", None, [_event(run, sid, "approval_decided", now, decision=decision,
                                   user=user, comment=comment, by_timeout=False,
                                   as_starter=command.get("as_starter") is True)]
    return "rejected", reason, [_event(run, sid, "approval_ignored", now, user=user,
                                       decision=decision, reason=reason)]


def step_events(old_state, fields):
    """``(type, fields)`` audit events for a step change the engine records: the step
    starts waiting for approval, or its timeout decides it."""
    if fields.get("state") == AWAITING and old_state != AWAITING:
        yield "approval_requested", {}
    decided = fields.get("approval_state") or {}
    if decided.get("by") == "timeout" and decided.get("decision") in ON_TIMEOUT:
        yield "approval_decided", {"decision": decided["decision"], "user": "timeout",
                                   "comment": decided.get("comment") or "",
                                   "by_timeout": True}
