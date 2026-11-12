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
doesn't run every day; the 7 days around its next run when that is further away), in the job's time zone, plus per cron trigger
``{"index", "runs": [{"start", "end"}], "suggestion": {"hour", "minute", "peak",
"base_peak"} | null}``, and axis ``ticks`` ``[[t, label]]`` in that time zone (the
server's own when the job has none, which is what its cron uses).

Active runs count until their estimated end (not just until now), and the runs they will
trigger are projected too. Rows of jobs the caller may not view never name an
``upstream``, and visible rows never point at a hidden one.
"""
from . import authz, schedule
from . import cron as cronmod
from .api import ApiError, LIST_FIELDS, _deleted_job_run_visible, _is_job_id, _job_id, _settings_view
from .store import ACTIVE_RUN_STATES

PAST_SCAN = 20000  # runs read for one window
HISTORY_SCAN = 1000  # newest succeeded runs read for step profiles
PROFILE_LOOKUPS = 50  # jobs the scan missed, looked up one at a time per request
PROFILE_RUNS = 5  # succeeded runs read per looked-up job
DEFAULT_BACK = 8 * 3600
DEFAULT_AHEAD = 16 * 3600
DAY = 86400
NEXT_SLOT_DAYS = 400  # how far ahead the builder looks for a schedule's next run


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


def _scheduled(job):
    """Does anything start ``job`` on its own: a cron or completion trigger?"""
    return bool(schedule.scheduler.cron_specs(job) or schedule._completion_upstreams(job))


def _profiles(ctx, jobs, per_job, wanted):
    """Profiles for ``jobs``. One read of the newest succeeded runs covers most jobs; a
    frequent job can crowd the others out of it, so up to ``PROFILE_LOOKUPS`` of the
    ``wanted`` jobs it missed are read one at a time. The rest fall back to the graph."""
    history = {}
    for run in ctx.store.list_runs({"state": "succeeded"}, limit=HISTORY_SCAN, fields=LIST_FIELDS):
        history.setdefault(run.get("job_id"), []).append(run)
    missing = sorted(j for j in wanted if j not in history)[:PROFILE_LOOKUPS]
    for jid in missing:
        history[jid] = ctx.store.list_runs({"job_id": jid, "state": "succeeded"}, limit=PROFILE_RUNS,
                                           fields=LIST_FIELDS)
    return {jid: schedule.profile(job, history.get(jid, []), per_job) for jid, job in jobs.items()}


def _projection(ctx, jobs, start, end, per_job, active_runs=()):
    """``(projected, remaining)``: ``projected`` is ``{job_id: [runs]}``, cron and
    completion-triggered runs together (including runs triggered by ``active_runs``);
    ``remaining`` is ``{job_id: [rest of each active run]}``."""
    wanted = {jid for jid, job in jobs.items() if _scheduled(job)}
    wanted |= {r.get("job_id") for r in active_runs if r.get("job_id") in jobs}
    profiles = _profiles(ctx, jobs, per_job, wanted)
    projected = {jid: schedule.project(job, profiles[jid], start, end, ctx.now) for jid, job in jobs.items()}
    projected = {k: v for k, v in projected.items() if v}
    rest = {}
    for run in active_runs:
        jid = run.get("job_id")
        if jid in jobs:
            rest.setdefault(jid, []).append(schedule.remaining(jobs[jid], profiles[jid], run, ctx.now))
    for jid, runs in schedule.project_dependents(jobs, profiles, projected, end, rest).items():
        for r in runs:
            r["dependent"] = True
        projected[jid] = sorted(projected.get(jid, []) + runs, key=lambda r: r["start"])
    return projected, rest


def _active(runs):
    return [r for r in runs if r.get("state") in ACTIVE_RUN_STATES]


def _load(ctx, past, projected, rest, start, end, skip_job=None):
    intervals = [iv for r in past if r.get("job_id") != skip_job for iv in schedule.run_intervals(r, ctx.now)]
    intervals += [iv for runs in projected.values() for r in runs for iv in r["steps"]]
    intervals += [iv for runs in rest.values() for r in runs for iv in r["steps"]]
    return schedule.load_series(intervals, start, end)


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
    past, partial = _past_runs(ctx, start, end)
    projected, rest = _projection(ctx, enabled, start, end, per_job, _active(past))
    load = _load(ctx, past, projected, rest, start, end)

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
        # Nesting tells how jobs are chained, so only between two jobs the caller may view.
        upstreams = [] if not entry["visible"] else sorted(
            (u for u in schedule._completion_upstreams(jobs.get(jid) or {}) if u in keys and bars[u]["visible"]),
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
    draft = _clean_draft(body.get("job"))
    job_id = draft.get("id")
    job_ref = job_id if isinstance(job_id, str) and _is_job_id(job_id) else None
    stored = ctx.store.get_job(job_ref) if job_ref else None
    if stored is not None and not ctx.allowed(authz.can_view, stored):
        stored, job_ref = None, None  # as if new: never reveal that the id is taken
    if not ctx.allowed(authz.can_edit, stored):
        raise ctx.deny("schedule_preview", job_id=job_ref or "new")
    draft = dict(draft, enabled=True)
    start, end = _preview_window(draft, ctx.now)
    max_searches, per_job = _limits(ctx)

    jobs = {_job_id(j): j for j in ctx.store.list_jobs()
            if _job_id(j) != job_ref and j.get("enabled") is not False}
    past, _ = _past_runs(ctx, start, end)
    active = [r for r in _active(past) if r.get("job_id") != job_ref]
    projected, rest = _projection(ctx, jobs, start, end, per_job, active)
    load = _load(ctx, past, projected, rest, start, end, skip_job=job_ref)

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
    tz = draft.get("timezone") if isinstance(draft.get("timezone"), str) and draft.get("timezone") else None
    return 200, {"from": start, "to": end, "now": ctx.now, "timezone": tz,
                 "ticks": schedule.local_ticks(start, end, tz),
                 "max_searches": max_searches, "load": load, "schedules": schedules}


def _preview_window(draft, now):
    """The next 24 hours for a daily job, else the next 7 days; when no schedule runs in
    those 7 days (a monthly job, say), the 7 days around the next run, so the strip still
    shows that run and can suggest a time."""
    if schedule.is_daily(draft):
        return now, now + DAY
    specs = schedule.scheduler.cron_specs(dict(draft, triggers=[dict(t, enabled=True) for t in draft["triggers"]]))
    nexts = [n for n in (cronmod.next_slot(spec, now, draft.get("timezone"), NEXT_SLOT_DAYS) for spec in specs)
             if n is not None]
    if nexts and min(nexts) >= now + 7 * DAY:
        start = max(now, min(nexts) - 3 * DAY)
        return start, start + 7 * DAY
    return now, now + 7 * DAY


def _clean_draft(draft):
    """A draft job with only the shapes the projection reads; an unsaved draft may hold
    anything, and a malformed one must not reach the projection."""
    if not isinstance(draft, dict):
        raise ApiError(400, "bad_request", "job must be a job definition object")

    def dicts(key):
        value = draft.get(key)
        return [x for x in value if isinstance(x, dict)] if isinstance(value, list) else []

    steps = [s for s in dicts("steps") if isinstance(s.get("id"), str)]
    for s in steps:
        if not isinstance(s.get("run_when"), dict):
            s.pop("run_when", None)
    edges = [e for e in dicts("edges") if isinstance(e.get("from"), str) and isinstance(e.get("to"), str)]
    triggers = [t for t in dicts("triggers") if isinstance(t.get("type"), str)]
    tz = draft.get("timezone") if isinstance(draft.get("timezone"), str) else None
    out = {k: draft.get(k) for k in ("id", "name")}
    out.update(steps=steps, edges=edges, triggers=triggers, timezone=tz)
    return out
