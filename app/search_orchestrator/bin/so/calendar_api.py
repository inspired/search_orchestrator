"""Calendar route (features-2 spec section 12), dispatched from ``api.handle``.

``GET calendar`` (query ``from``, ``to`` epoch seconds, at most 8 days apart; optional
``job_id``): ``{"items", "truncated"}`` of jobs the caller may see, sorted by time:

* ``scheduled``: future slots (``time >= now``) of enabled jobs' enabled cron triggers.
* ``run``: runs whose scheduled time is in the range.
* ``backfill``: slots of running backfills that have no run yet.

At most ``MAX_PER_JOB`` scheduled slots per job and ``MAX_ITEMS`` items in all (then
``truncated``). Needs any of the three app capabilities.
"""
from . import authz, backfill, scheduler
from . import cron as cronmod
from .api import ApiError, _visible_runs
from .backfill_api import _epoch

MAX_RANGE = 8 * 86400
MAX_PER_JOB = 300
MAX_ITEMS = 2000


def _range(body):
    start, end = _epoch(body.get("from")), _epoch(body.get("to"))
    if start is None or end is None:
        raise ApiError(400, "bad_range", "from and to must be epoch seconds")
    if start >= end:
        raise ApiError(400, "bad_range", "From must be before To")
    if end - start > MAX_RANGE:
        raise ApiError(400, "bad_range", "Pick a range of at most 8 days")
    return start, end


def _scheduled(job, start, end):
    slots = set()
    for spec in scheduler.cron_specs(job):
        slots.update(cronmod.slots_between(spec, start, end, job.get("timezone")))
    return sorted(slots)[:MAX_PER_JOB]


def calendar(ctx, body):
    if not any(c in authz.CAPABILITIES for c in ctx.access["capabilities"]):
        raise ctx.deny("read_calendar")
    start, end = _range(body)
    only = body.get("job_id") if isinstance(body.get("job_id"), str) and body.get("job_id") else None
    jobs = {j.get("id") or j.get("_key"): j for j in ctx.store.list_jobs()}
    jobs = {k: j for k, j in jobs.items() if (only in (None, k)) and ctx.allowed(authz.can_view, j)}

    def name(job_id):
        return (jobs.get(job_id) or {}).get("name") or job_id

    out = []
    for job_id, job in jobs.items():
        if job.get("enabled") is not False:
            out.extend({"kind": "scheduled", "job_id": job_id, "job_name": name(job_id), "time": t}
                       for t in _scheduled(job, max(start, ctx.now), end))
    query = {"scheduled_time": {"$gte": start, "$lt": end}}
    if only:
        query["job_id"] = only
    for run in _visible_runs(ctx, query, MAX_ITEMS + 1):
        job_id = run.get("job_id")
        out.append({"kind": "run", "job_id": job_id, "job_name": name(job_id),
                    "run_id": run.get("id") or run.get("_key"), "state": run.get("state"),
                    "trigger": run.get("trigger"), "scheduled_time": run.get("scheduled_time"),
                    "started_at": run.get("started_at"), "ended_at": run.get("ended_at"),
                    "late": run.get("late_at") is not None, "backfill_id": run.get("backfill")})
    bquery = {"state": "running"}
    if only:
        bquery["job_id"] = only
    for doc in ctx.sys_gw.kv_query(backfill.BACKFILLS, bquery):
        if doc.get("job_id") in jobs:
            out.extend({"kind": "backfill", "job_id": doc["job_id"], "job_name": name(doc["job_id"]),
                        "backfill_id": doc.get("id") or doc["_key"], "time": t}
                       for t in (doc.get("slots") or [])[int(doc.get("next") or 0):]
                       if start <= t < end)
    out.sort(key=lambda i: i.get("time") or i.get("scheduled_time") or 0)
    return 200, {"items": out[:MAX_ITEMS], "truncated": len(out) > MAX_ITEMS}
