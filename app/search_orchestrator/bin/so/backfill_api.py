"""Backfill routes (features-2 spec section 6), dispatched from ``api.handle``.

* ``POST jobs/<job_id>/backfills`` ``{"from", "to", "source", "step", "params",
  "concurrency", "dry_run"}``: ``from``/``to`` are epoch seconds or Splunk times
  (``-30d@d``) resolved as the caller. ``source`` is ``schedule`` (the default without
  ``step``) or ``step``. 201 ``{"backfill"}``; ``dry_run: true``: 200 ``{"slots",
  "count"}`` and nothing is stored. Needs ``can_run``; audited as ``backfill_created``.
* ``GET backfills`` (query ``job_id``, ``state``): ``{"backfills"}`` newest first,
  without ``slots`` but with ``count``, of jobs the caller may see.
* ``GET backfills/<backfill_id>``: ``{"backfill", "runs": [{id, state, scheduled_time}]}``.
* ``POST backfills/<backfill_id>/cancel``: the engine command ``{"type":
  "cancel_backfill", "backfill_id", "user"}``, 202 ``{"command_id"}``. Allowed for the
  creator, anyone who may edit the job, and admins, while the backfill is ``running``.

A backfill of a deleted job is visible to its creator and admins only.
"""
import uuid

from . import authz, backfill, scheduler, tokens
from .api import LIST_FIELDS, ApiError, _enqueue, _issue, _visible_job
from .gateway import GatewayError

DAY = 86400


def _bounded(body, key, default, lo, hi, unit=""):
    value = body.get(key)
    if value is None or value == "":
        return default
    out = _epoch(value)
    if out is None or not lo <= out <= hi:
        raise ApiError(400, "bad_request", "%s must be a whole number from %d to %d%s"
                       % (key, lo, hi, unit))
    return out


def _epoch(value):
    """``value`` (a whole number or its digits) as an int, or None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _times(ctx, body):
    raw, out = {}, {}
    for field in ("from", "to"):
        value = body.get(field)
        value = value.strip() if isinstance(value, str) else value
        if value in (None, "") or isinstance(value, bool) or not isinstance(value, (int, str)):
            raise ApiError(400, "bad_request", "%s is required: epoch seconds or a time like "
                           "-30d@d" % field, field=field)
        raw[field], out[field] = value, _epoch(value)
    relative = [f for f in ("from", "to") if out[f] is None]
    if not relative:
        return out["from"], out["to"]
    try:
        parsed = ctx.user_gw.parse_times(ctx.user, [raw[f] for f in relative], ctx.now)
    except GatewayError as err:
        if err.status != 400:
            raise
        # Name the field Splunk could not read when its message quotes it.
        field = next((f for f in relative if repr(raw[f]) in str(err)), relative[0])
        raise ApiError(400, "bad_time", "%s; use a form like -30d@d, @d or now" % err,
                       field=field)
    for f in relative:
        if parsed.get(raw[f]) is None:
            raise ApiError(502, "splunk_error", "a call to Splunk failed: its time parser "
                           "gave no time for %r" % raw[f])
        out[f] = int(parsed[raw[f]])
    return out["from"], out["to"]


def _params(job, body):
    params = body.get("params") or {}
    if not isinstance(params, dict):
        raise ApiError(400, "bad_request", "params must be an object")
    try:
        return scheduler.validate_params(job, params)
    except tokens.TokenError as err:
        message = "parameter %s: %s" % (err.token, err.reason)
        raise ApiError(400, "bad_param", message, [_issue("error", "bad_param", message)])


def _plan(ctx, job, body):
    """``(start, end, source, step, slots)`` for a request, or ApiError."""
    concurrency = _bounded(body, "concurrency", 1, 1, backfill.MAX_CONCURRENCY)
    source = body.get("source") or ("step" if body.get("step") not in (None, "") else "schedule")
    if source not in backfill.SOURCES:
        raise ApiError(400, "bad_request", "source must be \"schedule\" or \"step\"")
    step = None
    if source == "step":
        step = _bounded(body, "step", None, backfill.STEP_MIN, backfill.STEP_MAX, " seconds")
        if step is None:
            raise ApiError(400, "bad_request", "step is required to run every so often")
    params = _params(job, body)
    start, end = _times(ctx, body)
    if start >= end:
        raise ApiError(400, "bad_range", "From must be before To")
    if end - start > backfill.MAX_RANGE:
        raise ApiError(400, "bad_range", "Pick a range of at most %d days"
                       % (backfill.MAX_RANGE // DAY))
    try:
        slots = backfill.plan_slots(job, start, end, source, step)
    except backfill.BackfillError as err:
        raise ApiError(400, err.code, err.message)
    if not slots:
        raise ApiError(400, "no_slots", "No runs fall in this range; widen it or change the step")
    if len(slots) > backfill.MAX_SLOTS:
        raise ApiError(400, "too_many_slots", "This covers %d runs; the most is %d. Shorten "
                       "the range or use a longer step." % (len(slots), backfill.MAX_SLOTS))
    return {"from": start, "to": end, "source": source, "step": step, "slots": slots,
            "params": params, "concurrency": concurrency}


def _public(doc):
    out = {k: v for k, v in doc.items() if k not in ("_key", "_user")}
    out.setdefault("count", len(doc.get("slots") or []))
    return out


def create_backfill(ctx, body, job_id):
    job = _visible_job(ctx, job_id)
    if not ctx.allowed(authz.can_run, job):
        raise ctx.deny("backfill_job", job_id=job_id)
    if job.get("enabled") is False:
        raise ApiError(409, "job_disabled", "job %r is disabled" % job_id)
    plan = _plan(ctx, job, body)
    if body.get("dry_run") is True:
        return 200, {"slots": plan["slots"], "count": len(plan["slots"])}
    backfill_id = "bf" + uuid.uuid4().hex[:12]
    doc = dict(plan, _key=backfill_id, id=backfill_id, job_id=job_id, created_by=ctx.user,
               created_at=ctx.now, count=len(plan["slots"]), next=0, state="running",
               run_ids=[], ended_at=None, cancelled_by=None)
    ctx.sys_gw.kv_insert(backfill.BACKFILLS, doc)
    ctx.emit({"type": "backfill_created", "backfill_id": backfill_id, "job_id": job_id,
              "slots": doc["count"], "from": doc["from"], "to": doc["to"],
              "source": doc["source"]})
    return 201, {"backfill": _public(doc)}


def _job_of(ctx, doc, jobs=None):
    """The job a backfill's permissions come from; a deleted job's backfill belongs to
    its creator only (admins see everything)."""
    job_id = doc.get("job_id")
    job = jobs.get(job_id) if jobs is not None else ctx.store.get_job(job_id)
    return job if job is not None else {"owner": doc.get("created_by"), "run_roles": []}


def _visible_backfill(ctx, backfill_id):
    doc = ctx.sys_gw.kv_get(backfill.BACKFILLS, backfill_id)
    if doc is None or not ctx.allowed(authz.can_view, _job_of(ctx, doc)):
        raise ApiError(404, "not_found", "no backfill %r" % backfill_id)
    return doc


def list_backfills(ctx, body):
    query = {k: body[k] for k in ("job_id", "state") if isinstance(body.get(k), str) and body[k]}
    rows = ctx.sys_gw.kv_query(backfill.BACKFILLS, query, sort="created_at:-1",
                               fields="slots:0")
    if not ctx.allowed(authz.can_admin, None):
        jobs = {j.get("id") or j.get("_key"): j for j in ctx.store.list_jobs()}
        rows = [r for r in rows if ctx.allowed(authz.can_view, _job_of(ctx, r, jobs))]
    return 200, {"backfills": [_public(r) for r in rows]}


def get_backfill(ctx, body, backfill_id):
    doc = _visible_backfill(ctx, backfill_id)
    runs = ctx.store.list_runs({"backfill": backfill_id}, fields=LIST_FIELDS)
    runs = sorted(({"id": r.get("id") or r.get("_key"), "state": r.get("state"),
                    "scheduled_time": r.get("scheduled_time")} for r in runs),
                  key=lambda r: r["scheduled_time"] or 0)
    return 200, {"backfill": _public(doc), "runs": runs}


def cancel_backfill(ctx, body, backfill_id):
    doc = _visible_backfill(ctx, backfill_id)
    job = _job_of(ctx, doc)
    if doc.get("created_by") != ctx.user and not ctx.allowed(authz.can_edit, job) \
            and not ctx.allowed(authz.can_admin, None):
        raise ctx.deny("cancel_backfill", backfill_id=backfill_id)
    if doc.get("state") != "running":
        raise ApiError(409, "invalid_state", "This backfill has already ended")
    key = _enqueue(ctx, {"type": "cancel_backfill", "backfill_id": backfill_id})
    return 202, {"command_id": key}
