"""Schedule routes: the global timeline (``GET schedule``) and the builder's busy-times
strip (``POST schedule/preview``). The projection itself is in ``schedule.py``.

``GET schedule?from=&to=`` (epochs; default 8 hours back to 16 hours ahead; at most
``schedule.MAX_WINDOW``) returns::

    {"from", "to", "now", "max_searches", "load": [[t, searches], ...],
     "jobs": [{"key", "name", "hidden", "upstream", "next_run", "bars": [...]}],
     "idle_jobs": n, "partial": bool}

A bar is a run ``{"id", "state", "start", "started", "end", "delayed"}``, a projected
run ``{"state": "scheduled", "start", "end", "estimated": true, "dependent"}`` or a merged
``{"kind": "span", "state", "start", "end", "count"}``. Jobs the caller may not view are
listed as ``"Hidden job N"`` with an opaque key and bars without ids; the load counts
every job, so it is the true load.

``POST schedule/preview`` ``{"job": <draft>}`` (the caller must be allowed to edit the
job) returns the load of every *other* job over the next 24 hours (7 days when the job
doesn't run every day), in the job's time zone, plus per cron trigger
``{"index", "runs": [{"start", "end"}], "suggestion": {"hour", "minute", "peak",
"base_peak"} | null}``.
"""
from . import authz, schedule
from .api import ApiError, LIST_FIELDS, _deleted_job_run_visible, _is_job_id, _job_id, _settings_view
from .store import ACTIVE_RUN_STATES

PAST_SCAN = 20000  # runs read for one window
HISTORY_SCAN = 1000  # newest succeeded runs read for step profiles
DEFAULT_BACK = 8 * 3600
DEFAULT_AHEAD = 16 * 3600
DAY = 86400


def _window(ctx, body):
    try:
        start = int(body.get("from") or ctx.now - DEFAULT_BACK)
        end = int(body.get("to") or ctx.now + DEFAULT_AHEAD)
    except (TypeError, ValueError):
        raise ApiError(400, "bad_request", "from and to must be epoch seconds")
    if end <= start:
        raise ApiError(400, "bad_request", "to must be after from")
    if end - start > schedule.MAX_WINDOW:
        raise ApiError(400, "bad_request", "the window may be at most %d days" % (schedule.MAX_WINDOW // DAY))
    return start, end


def _limits(ctx):
    settings = _settings_view(ctx.store.get_settings())
    return int(settings["max_searches"]), int(settings["max_searches_per_job"])


def _profiles(ctx, jobs, per_job):
    history = {}
    for run in ctx.store.list_runs({"state": "succeeded"}, limit=HISTORY_SCAN, fields=LIST_FIELDS):
        history.setdefault(run.get("job_id"), []).append(run)
    return {jid: schedule.profile(job, history.get(jid, []), per_job) for jid, job in jobs.items()}


def _projection(ctx, jobs, start, end, per_job):
    """``(profiles, projected)``: ``projected`` is ``{job_id: [runs]}``, cron and
    completion-triggered runs together."""
    profiles = _profiles(ctx, jobs, per_job)
    projected = {jid: schedule.project(job, profiles[jid], start, end, ctx.now) for jid, job in jobs.items()}
    projected = {k: v for k, v in projected.items() if v}
    for jid, runs in schedule.project_dependents(jobs, profiles, projected, end).items():
        for r in runs:
            r["dependent"] = True
        projected[jid] = sorted(projected.get(jid, []) + runs, key=lambda r: r["start"])
    return profiles, projected


def _past_runs(ctx, start, end):
    query = {"created_at": {"$lt": end},
             "$or": [{"ended_at": {"$gte": start}}, {"state": {"$in": ACTIVE_RUN_STATES}}]}
    runs = ctx.store.list_runs(query, limit=PAST_SCAN, fields=LIST_FIELDS)
    return runs, len(runs) >= PAST_SCAN


def _past_bar(run, now, visible):
    started = run.get("started_at")
    begin = run.get("queued_at") or run.get("created_at") or started or now
    active = run.get("state") in ACTIVE_RUN_STATES
    end = now if active or run.get("ended_at") is None else run["ended_at"]
    bar = {"state": run.get("state"), "start": int(begin), "started": started,
           "end": int(max(end, begin)), "delayed": bool(run.get("delay_alerted"))}
    if visible:
        bar["id"] = run.get("id") or run.get("_key")
    return bar


def _future_bar(run):
    return {"state": "scheduled", "start": run["start"], "end": run["end"], "estimated": True,
            "dependent": bool(run.get("dependent"))}


def get_schedule(ctx, body):
    start, end = _window(ctx, body)
    max_searches, per_job = _limits(ctx)
    jobs = {_job_id(j): j for j in ctx.store.list_jobs()}
    enabled = {k: j for k, j in jobs.items() if j.get("enabled") is not False}
    _, projected = _projection(ctx, enabled, start, end, per_job)
    past, partial = _past_runs(ctx, start, end)

    intervals = [iv for r in past for iv in schedule.run_intervals(r, ctx.now)]
    intervals += [iv for runs in projected.values() for r in runs for iv in r["steps"]]
    load = schedule.load_series(intervals, start, end)

    can_view = {k: ctx.allowed(authz.can_view, j) for k, j in jobs.items()}
    bars = {}
    for run in past:
        jid = run.get("job_id")
        if jid in jobs:
            visible = can_view[jid]
        else:
            visible = _deleted_job_run_visible(ctx, run)
        bars.setdefault(jid, {"visible": visible, "bars": []})["bars"].append(_past_bar(run, ctx.now, visible))
    for jid, runs in projected.items():
        entry = bars.setdefault(jid, {"visible": can_view.get(jid, False), "bars": []})
        entry["bars"] += [_future_bar(r) for r in runs]

    def name(jid):
        job = jobs.get(jid)
        return str((job or {}).get("name") or jid)

    order = sorted(bars, key=lambda k: (not bars[k]["visible"], name(k).casefold() if bars[k]["visible"] else ""))
    keys, hidden_n = {}, 0
    for jid in order:
        if bars[jid]["visible"]:
            keys[jid] = jid
        else:
            hidden_n += 1
            keys[jid] = "hidden-%d" % hidden_n
    rows = []
    for jid in order:
        entry = bars[jid]
        upstreams = sorted((u for u in schedule._completion_upstreams(jobs.get(jid) or {}) if u in keys),
                           key=lambda u: name(u).casefold())
        future = [b["start"] for b in entry["bars"] if b["state"] == "scheduled" and b["start"] > ctx.now]
        rows.append({"key": keys[jid], "name": name(jid) if entry["visible"] else "Hidden job %s" % keys[jid][7:],
                     "hidden": not entry["visible"], "upstream": keys[upstreams[0]] if upstreams else None,
                     "next_run": min(future) if future else None,
                     "bars": schedule.merge_dense(entry["bars"], start, end)})
    idle = sum(1 for k in jobs if can_view[k] and k not in bars)
    return 200, {"from": start, "to": end, "now": ctx.now, "max_searches": max_searches, "load": load,
                 "jobs": rows, "idle_jobs": idle, "partial": partial}


def schedule_preview(ctx, body):
    draft = body.get("job")
    if not isinstance(draft, dict):
        raise ApiError(400, "bad_request", "job must be a job definition object")
    job_id = draft.get("id")
    job_ref = job_id if isinstance(job_id, str) and _is_job_id(job_id) else None
    stored = ctx.store.get_job(job_ref) if job_ref else None
    if stored is not None and not ctx.allowed(authz.can_view, stored):
        stored, job_ref = None, None  # as if new: never reveal that the id is taken
    if not ctx.allowed(authz.can_edit, stored):
        raise ctx.deny("schedule_preview", job_id=job_ref or "new")
    draft = dict(draft, enabled=True)
    start = ctx.now
    end = start + (DAY if schedule.is_daily(draft) else 7 * DAY)
    max_searches, per_job = _limits(ctx)

    jobs = {_job_id(j): j for j in ctx.store.list_jobs()
            if _job_id(j) != job_ref and j.get("enabled") is not False}
    _, projected = _projection(ctx, jobs, start, end, per_job)
    past, _ = _past_runs(ctx, start, end)
    intervals = [iv for r in past if r.get("job_id") != job_ref for iv in schedule.run_intervals(r, ctx.now)]
    intervals += [iv for runs in projected.values() for r in runs for iv in r["steps"]]
    load = schedule.load_series(intervals, start, end)

    history = []
    if job_ref:
        history = ctx.store.list_runs({"job_id": job_ref, "state": "succeeded"}, limit=20, fields=LIST_FIELDS)
    prof = schedule.profile(draft, history, per_job)
    schedules = []
    for i, t in enumerate(draft.get("triggers") or []):
        if not isinstance(t, dict) or t.get("type") != "cron":
            continue
        one = dict(draft, triggers=[dict(t, enabled=True)])
        runs = schedule.project(one, prof, start, end, ctx.now)
        schedules.append({"index": i, "runs": [{"start": r["start"], "end": r["end"]} for r in runs],
                          "suggestion": schedule.suggest(draft, t.get("cron"), prof, load, start, end,
                                                         max_searches) if runs else None})
    return 200, {"from": start, "to": end, "now": ctx.now, "timezone": draft.get("timezone") or None,
                 "max_searches": max_searches, "load": load, "schedules": schedules}
