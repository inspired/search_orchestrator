"""Step preview routes (spec section 9a), dispatched from ``api.handle``, which gives each
route its ``api._Ctx`` and turns an ``api.ApiError`` into the reply.

Step previews (``preview.py``) are for callers who may edit the job: the stored job if
its id exists and they may see it, else ``can_edit(None)``. A preview is an ad hoc search
started with ``user_gateway`` as the caller, never the owner or the system session;
nothing about it is stored. ``job_ref`` in its sid is the definition's id, or ``new``.

* ``POST preview/defaults`` ``{"job"}``: ``{"scheduled_time", "result_retention"}``: the
  latest cron slot, and the seconds a run's step results are kept after it ends (the
  editor greys out runs past it in "Input from").
* ``POST preview`` ``{"job", "step_id", "scheduled_time", "params", "input", "anyway"}``,
  ``input`` ``{"mode": "live", "previews": {step: {"sid"} | {"skipped": kind}}}`` or
  ``{"mode": "run", "run_id"}``: 201 ``{"status": "started", "sid", "spl"}`` (plus
  ``"anyway": true`` when it bypassed a skip), 200 ``{"status": "skipped", "skip_kind",
  "reason"}``, 409 ``needs_preview`` (``steps``), ``upstream_failed`` (``step``: a failed
  step behind an on_success edge, as a run decides) or ``run_step_missing`` (``step``), 410
  ``run_results_expired`` (``step``), 403 ``run_results_forbidden`` (``step``: splunkd
  won't let the caller read that run's result), 400 ``invalid`` (errors in the step, the
  steps it reads, the edges into them, params or time zone; or anywhere in the job for a
  cycle or a malformed job) or ``bad_param``. The sid of a live input is checked
  statically (``preview.own_sid``) before splunkd is asked about it. Audited as
  ``preview_dispatched``.
* ``GET preview/<sid>`` (query ``limit``, seconds, capped at ``preview.MAX_RUNTIME``):
  ``{"state", "result_count", "error", "truncated", "run_duration", "messages"}``; a
  running search past the limit is cancelled and reported failed, otherwise touched.
  The caller's own sid that splunkd no longer has (expired, deleted) is 200 with
  ``"state": "missing"``.
* ``GET preview/<sid>/results``: ``{"fields", "rows", "total"}``, at most
  ``preview.TABLE_ROWS`` rows. ``POST preview/<sid>/cancel``: ``{"cancelled": true}``.
  A sid that is not the caller's own preview is 404 (results and cancel: also a gone one).
"""
import uuid

from . import authz, hidden, model, preview, scheduler, tokens
from . import state as statemod
from .api import (ApiError, _errors, _is_job_id, _issue, _prepare, _run_job, _scheduled_time,
                  _visible_run)
from .engine import DEFAULT_SETTINGS, first_fields
from .gateway import GatewayError


SKIP_REASONS = {
    "run_when": "its run when condition doesn't match at this time",
    "not_taken": "none of the edges into it would be taken"}
POLL_FIELDS = ("state", "result_count", "error", "truncated", "run_duration", "messages")
_UPSTREAM = ("state", "skip_kind", "sid", "result_count", "first")
RUN_ENDED = ("succeeded", "failed", "skipped")  # step states a preview can read from a run


def _preview_target(ctx, body):
    """``(job, job_ref)`` for a preview request once the caller may edit the job:
    the stored job if its id exists and the caller may see it, else as a new job."""
    definition = body.get("job")
    if not isinstance(definition, dict):
        raise ApiError(400, "bad_request", "job must be a job definition object")
    job_id = definition.get("id")
    job_ref = job_id if isinstance(job_id, str) and _is_job_id(job_id) else "new"
    stored = ctx.store.get_job(job_id) if job_ref == job_id else None
    if stored is not None and not ctx.allowed(authz.can_view, stored):
        stored = None  # as if new: never reveal that the id is taken
    if not ctx.allowed(authz.can_edit, stored):
        raise ctx.deny("preview_job", job_id=job_ref)
    return _prepare(definition, job_ref, ctx.user), job_ref


def _invalid(issues):
    return ApiError(400, "invalid", "the step or a step it depends on has errors", issues)


def _blocks_every_preview(message, issues):
    return ApiError(400, "invalid", "%s; fix it before previewing" % message, issues)


def _preview_scope(job, step_id):
    """The steps ``step_id`` reads, after checking the step, those steps, the edges into
    them, the params and the time zone. Errors elsewhere (other steps and edges, the
    schedule, actions) don't block a preview, except two anywhere in the job, since
    finding the steps a step reads needs a well-formed job whose edges form a DAG: a
    malformed job (``bad_shape``) and a dependency cycle. Both are 400 ``invalid`` with a
    message naming the problem ("the job has a cycle: a → b → a; fix it before
    previewing")."""
    shape = [i for i in _errors(model.validate_job(job)) if i.get("code") == "bad_shape"]
    if shape:
        raise _blocks_every_preview("the job is malformed: %s" % shape[0]["message"], shape)
    if step_id not in [s.get("id") for s in job.get("steps") or []]:
        raise ApiError(400, "unknown_step", "the job has no step %r" % (step_id,))
    cycle = model.find_cycle(job)
    if cycle:
        message = "the job has a cycle: %s" % " → ".join(cycle)
        raise _blocks_every_preview(message, [_issue("error", "cycle", message)])
    scope = preview.closure(job, step_id)
    keep = set(scope) | {step_id}
    part = dict(job, steps=[s for s in job.get("steps") or [] if s.get("id") in keep],
                edges=[e for e in job.get("edges") or [] if e.get("to") in keep], triggers=[])
    found = _errors(model.validate_job(part))
    if found:
        raise _invalid(found)
    return scope


def _preview_params(job, body):
    params = body.get("params") or {}
    if not isinstance(params, dict):
        raise ApiError(400, "bad_request", "params must be an object")
    try:
        return scheduler.validate_params(job, params)
    except tokens.TokenError as err:
        message = "parameter %s: %s" % (err.token, err.reason)
        raise ApiError(400, "bad_param", message, [_issue("error", "bad_param", message)])


def _touch(ctx, sid):
    try:
        ctx.user_gw.control(sid, "touch")
    except GatewayError:  # the TTL is only extended; the next poll reports a gone job
        pass


def _live_state(ctx, job, job_ref, up, entry, fields):
    """One upstream step's state from the caller's live preview, or None (needs one)."""
    if not isinstance(entry, dict):
        return None
    if entry.get("skipped") in SKIP_REASONS:
        return {"state": "skipped", "skip_kind": entry["skipped"]}
    sid = entry.get("sid")
    if not preview.own_sid(sid, ctx.user, job_ref, up):
        return None  # checked before splunkd is asked anything about the sid
    info = ctx.user_gw.preview_info(sid)
    if not preview.own_preview(info, sid, ctx.user, job_ref, up):
        return None
    kind = next((s.get("type") for s in job["steps"] if s.get("id") == up), None)
    if info.get("state") == "failed" or (info.get("state") == "done" and kind == "previous"
                                         and info.get("truncated")):
        return {"state": "failed", "sid": sid}
    if info.get("state") != "done":
        return None
    count = int(info.get("result_count") or 0)
    first = None
    if fields and count > 0:
        row = ctx.user_gw.first_row(sid)
        if row:
            first = {f: _scalar(row.get(f)) for f in sorted(fields)}
    _touch(ctx, sid)
    return {"state": "succeeded", "sid": sid, "result_count": count, "first": first}


def _scalar(value):
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _live_upstream(ctx, job, job_ref, scope, previews, scheduled, params):
    """Upstream states from the caller's live previews. Each upstream step is decided again
    (``state.preview_decision``, in topological order, from the states before it): a step a
    run would skip is skipped downstream whatever the client sends, even with a sid from
    Preview anyway. A step a run would not reach past a failure is ``upstream_failed``."""
    if not isinstance(previews, dict):
        raise ApiError(400, "bad_request", "input previews must be an object")
    wanted = first_fields(job)
    upstream, needs = {}, []
    for up in scope:
        if not needs:
            decision, detail = _decide(job, up, scheduled, params, upstream)
            if decision == "skipped":
                upstream[up] = {"state": "skipped", "skip_kind": detail}
                continue
            if decision == "needs":
                raise _needs(upstream, detail.split(","))
            entry = previews.get(up)
            if isinstance(entry, dict) and "skipped" in entry:
                needs.append(up)  # a run would run it, so a client claim of skipped is stale
                continue
        st = _live_state(ctx, job, job_ref, up, previews.get(up), wanted.get(up))
        if st is None:
            needs.append(up)
        else:
            upstream[up] = st
    if needs:
        raise ApiError(409, "needs_preview", "preview %s first" % ", ".join(needs), steps=needs)
    return upstream


def _run_upstream(ctx, job, step_id, scope, run_id):
    """Upstream states recorded by a past run of the job, whose results the step reads
    must still exist."""
    if not scheduler.is_run_id(run_id):
        raise ApiError(404, "not_found", "no run %r" % (run_id,))
    run = _visible_run(ctx, run_id)
    if run.get("job_id") != job["id"]:
        raise ApiError(404, "not_found", "no run %r" % run_id)
    if not ctx.allowed(authz.can_edit, _run_job(ctx, run)):
        raise ctx.deny("preview_job", job_id=job["id"], run_id=run_id)
    steps = run.get("steps") or {}
    upstream = {up: {k: (steps.get(up) or {}).get(k) for k in _UPSTREAM}
                for up in scope if steps.get(up)}
    for up in preview.reads(job, step_id):
        if (upstream.get(up) or {}).get("state") not in RUN_ENDED:
            raise ApiError(409, "run_step_missing", "%s has no result in that run; switch to "
                           "live previews or pick another run" % up, step=up)
    for up in preview.reads(job, step_id):
        st = upstream.get(up) or {}
        if st.get("state") == "succeeded" and st.get("sid"):
            _check_run_result(ctx, up, st["sid"])
    return upstream


def _check_run_result(ctx, up, sid):
    """The caller may read step ``up``'s result ``sid`` from a past run: else 410
    ``run_results_expired`` when splunkd no longer has the job, or 403
    ``run_results_forbidden`` when it refuses the caller. splunkd answers 404 for a job
    it won't show the caller as well as for a gone one, so a 404 is checked again with
    the system session (it only learns whether a sid the run recorded still exists)."""
    forbidden = ApiError(403, "run_results_forbidden", "you may not read %s's results from "
                         "that run; only its owner or an admin can" % up, step=up)
    try:
        info = ctx.user_gw.preview_info(sid)
    except GatewayError as err:
        if err.status == 403:
            raise forbidden
        raise
    if (info or {}).get("state") != "missing":
        return
    if (ctx.sys_gw.preview_info(sid) or {}).get("state") != "missing":
        raise forbidden
    raise ApiError(410, "run_results_expired", "%s's results from that run have expired; "
                   "switch to live previews or pick a newer run" % up, step=up)


def _preview_upstream(ctx, job, job_ref, step_id, scope, source, scheduled, params):
    source = source or {"mode": "live"}
    if not isinstance(source, dict) or source.get("mode") not in ("live", "run"):
        raise ApiError(400, "bad_request", "input mode must be \"live\" or \"run\"")
    if source["mode"] == "run":
        return _run_upstream(ctx, job, step_id, scope, source.get("run_id"))
    return _live_upstream(ctx, job, job_ref, scope, source.get("previews") or {}, scheduled,
                          params)


def _input_mode(source):
    return source.get("mode") if isinstance(source, dict) else "live"


def _decide(job, step_id, scheduled, params, upstream):
    try:
        return statemod.preview_decision(job, step_id, scheduled, params, upstream)
    except (ValueError, TypeError) as err:  # a run would fail the step the same way
        raise _invalid([_issue("error", "bad_run_when", "run_when: %s" % err, step_id)])


def _needs(upstream, steps, mode="live"):
    """A run would not reach the step: a failed step behind an on_success edge is
    ``upstream_failed``, the same in both input modes (only the advice differs)."""
    failed = [s for s in steps if (upstream.get(s) or {}).get("state") == "failed"]
    if failed:
        advice = ("pick another run or switch to live previews" if mode == "run"
                  else "fix it or preview it again")
        return ApiError(409, "upstream_failed", "%s failed, so a run would not reach this "
                        "step; %s" % (failed[0], advice), step=failed[0])
    return ApiError(409, "needs_preview", "preview %s first" % ", ".join(steps), steps=steps)


def _preview_search(ctx, job, step, scheduled, params, upstream):
    """``(spl, earliest, latest)``: the search a run of ``step`` would run, as the caller."""
    if step.get("type") == "saved_search":
        spl, issues = hidden.saved_search_spl(ctx.user_gw, ctx.user, step)
        if spl is None:
            raise _invalid(issues)
        return spl, step.get("earliest") or None, step.get("latest") or None
    ids = [s.get("id") for s in job.get("steps") or []]
    try:
        spl = preview.step_search(step, ids,
                                  preview.token_context(job, scheduled, params, upstream),
                                  preview.input_sids(job, step["id"], upstream))
    except tokens.TokenError as err:
        raise _invalid([_issue("error", "bad_token", "token %s: %s" % (err.token, err.reason),
                               step["id"])])
    if step.get("type") == "previous":
        return spl, None, None
    return spl, step.get("earliest") or None, step.get("latest") or None


def preview_defaults(ctx, body):
    job, _ = _preview_target(ctx, body)
    try:
        scheduled = preview.default_time(job, ctx.now)
    except (ValueError, TypeError):
        scheduled = ctx.now
    retention = int((ctx.store.get_settings() or {}).get("result_retention")
                    or DEFAULT_SETTINGS["result_retention"])
    return 200, {"scheduled_time": int(scheduled), "result_retention": retention}


def start_preview(ctx, body):
    job, job_ref = _preview_target(ctx, body)
    step_id = body.get("step_id")
    scope = _preview_scope(job, step_id)
    params = _preview_params(job, body)
    scheduled = _scheduled_time(ctx, body)
    upstream = _preview_upstream(ctx, job, job_ref, step_id, scope, body.get("input"),
                                 scheduled, params)
    decision, detail = _decide(job, step_id, scheduled, params, upstream)
    if decision == "needs":
        raise _needs(upstream, detail.split(","), _input_mode(body.get("input")))
    anyway = decision == "skipped" and body.get("anyway") is True
    if decision == "skipped" and not anyway:
        return 200, {"status": "skipped", "skip_kind": detail, "reason": SKIP_REASONS[detail]}
    step = next(s for s in job["steps"] if s.get("id") == step_id)
    spl, earliest, latest = _preview_search(ctx, job, step, scheduled, params, upstream)
    sid = preview.make_sid(ctx.user, job_ref, step_id, uuid.uuid4().hex[:16])
    sid = ctx.user_gw.preview_dispatch(ctx.user, spl, earliest, latest, scheduled, sid)
    ctx.emit({"type": "preview_dispatched", "job_id": job_ref, "step_id": step_id, "sid": sid})
    out = {"status": "started", "sid": sid, "spl": spl}
    if anyway:
        out["anyway"] = True
    return 201, out


def _own_preview(ctx, sid, gone_ok=False):
    """``preview_info`` of the caller's own preview ``sid``; anything else is 404. With
    ``gone_ok``, a sid that passes ``own_sid`` but that splunkd no longer has returns its
    ``missing`` info instead (the sid names the caller, so this reveals nothing)."""
    parts = preview.parts(sid)
    if parts is None:  # a malformed sid (the route checks it too) is not the caller's
        raise ApiError(404, "not_found", "no preview %r" % sid)
    _, job_ref, step_id, _ = parts
    if not preview.own_sid(sid, ctx.user, job_ref, step_id):
        raise ApiError(404, "not_found", "no preview %r" % sid)
    info = ctx.user_gw.preview_info(sid)
    if gone_ok and (info or {}).get("state") == "missing":
        return info
    if not preview.own_preview(info, sid, ctx.user, job_ref, step_id):
        raise ApiError(404, "not_found", "no preview %r" % sid)
    return info


def _preview_limit(body):
    """Seconds a preview may run: the step's ``limit``, at most ``preview.MAX_RUNTIME``."""
    value = body.get("limit")
    if value is None or value == "":
        return preview.MAX_RUNTIME
    try:
        if isinstance(value, bool):
            raise ValueError
        limit = int(float(value))
    except (TypeError, ValueError):
        raise ApiError(400, "bad_request", "limit must be a number of seconds")
    if limit < 1:
        raise ApiError(400, "bad_request", "limit must be a number of seconds")
    return min(limit, preview.MAX_RUNTIME)


def poll_preview(ctx, body, sid):
    info = _own_preview(ctx, sid, gone_ok=True)
    limit = _preview_limit(body)
    if info.get("state") == "missing":
        return 200, {k: info.get(k) for k in POLL_FIELDS}
    out = {k: info.get(k) for k in POLL_FIELDS}
    duration = info.get("run_duration")
    if info.get("state") == "running" and duration is not None and float(duration) > limit:
        ctx.user_gw.control(sid, "cancel")
        minutes = "%g" % (limit / 60.0)
        out.update(state="failed", error="Preview stopped after %s minute%s"
                   % (minutes, "" if minutes == "1" else "s"))
    else:
        _touch(ctx, sid)
    return 200, out


def preview_rows(ctx, body, sid):
    info = _own_preview(ctx, sid)
    found = ctx.user_gw.preview_results(sid, preview.TABLE_ROWS)
    return 200, {"fields": list(found.get("fields") or []),
                 "rows": list(found.get("rows") or [])[:preview.TABLE_ROWS],
                 "total": int(info.get("result_count") or 0)}


def cancel_preview(ctx, body, sid):
    _own_preview(ctx, sid)
    ctx.user_gw.control(sid, "cancel")
    return 200, {"cancelled": True}
