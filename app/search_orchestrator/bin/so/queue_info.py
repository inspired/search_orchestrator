"""Why a run or a step is waiting, for the Runs page and the run page.

``engine_status(ctx)``: ``{"running": bool, "last_seen": epoch | None}`` from the engine's
leader lease (``so_locks``/``engine``; renewed every tick, lasting ``lease.LEASE_SECONDS``).
Its expiry passing means no engine has ticked for that long: nothing starts or moves.

``queue_reasons(ctx, runs)``: ``{run_id: reason}`` for the queued runs among ``runs``,
as the engine's promotion (``engine._promote``) decides. Reasons, first that applies:

* ``{"kind": "engine_stopped", "last_seen"}``: no engine is ticking.
* ``{"kind": "held", "run_id"}``: a run of the job gave up and is held (``after_give_up``
  ``hold``); it blocks the job until it is re-run or dismissed.
* ``{"kind": "waiting_for_run", "run_id", "state"}``: another run of the job is active;
  a job runs one run at a time.
* ``{"kind": "behind", "ahead", "next_run_id"}``: other queued runs of the job go first
  (re-runs, then the earliest scheduled time).
* ``{"kind": "next_tick"}``: nothing holds it; the engine starts it on its next tick.

``step_reasons(ctx, run)``: ``{step_id: reason}`` for a running run's steps that wait:
``{"kind": "waiting_for", "steps": [...]}`` (steps before it that haven't finished) and,
for a ``ready`` step, ``{"kind": "search_slots", "job_running", "job_max", "all_running",
"all_max"}`` when a limit in Settings is full, else ``{"kind": "next_tick"}``.
"""
from . import lease as leasemod
from .engine import DEFAULT_SETTINGS, IN_FLIGHT, LIVE, _inflight, promotion_order

_RUN_FIELDS = None


def engine_status(ctx):
    doc = ctx.sys_gw.kv_get(leasemod.COLLECTION, leasemod.KEY) or {}
    expires = doc.get("expires")
    if not isinstance(expires, (int, float)):
        return {"running": False, "last_seen": None}
    return {"running": expires > ctx.now, "last_seen": int(expires) - leasemod.LEASE_SECONDS}


def _rid(run):
    return run.get("_key") or run.get("id")


def queue_reasons(ctx, runs, engine=None):
    queued = [r for r in runs if r.get("state") == "queued"]
    if not queued:
        return {}
    engine = engine or engine_status(ctx)
    out = {}
    by_job = {}
    for run in queued:
        by_job.setdefault(run.get("job_id"), []).append(run)
    for job_id, mine in by_job.items():
        others = ctx.store.list_runs({"job_id": job_id, "$or": [{"state": {"$in": list(LIVE) + ["queued"]}},
                                                                 {"state": "failed", "held": True}]},
                                     limit=500, fields="definition:0")
        job = ctx.store.get_job(job_id) or {}
        policy = job.get("after_give_up") or "hold"
        held = [r for r in others if r.get("state") == "failed" and r.get("held")]
        live = [r for r in others if r.get("state") in LIVE]
        waiting = sorted((r for r in others if r.get("state") == "queued"), key=promotion_order)
        for run in mine:
            if not engine["running"]:
                reason = {"kind": "engine_stopped", "last_seen": engine["last_seen"]}
            elif held and policy == "hold":
                reason = {"kind": "held", "run_id": _rid(held[0])}
            elif live:
                reason = {"kind": "waiting_for_run", "run_id": _rid(live[0]), "state": live[0].get("state")}
            else:
                ahead = [r for r in waiting if promotion_order(r) < promotion_order(run)]
                reason = ({"kind": "behind", "ahead": len(ahead), "next_run_id": _rid(ahead[0])}
                          if ahead else {"kind": "next_tick"})
            out[_rid(run)] = reason
    return out


def step_reasons(ctx, run):
    if run.get("state") != "running":
        return {}
    definition = run.get("definition") or {}
    steps = run.get("steps") or {}
    names = {s.get("id"): s.get("name") or s.get("id") for s in definition.get("steps") or []}
    edges = definition.get("edges") or []
    out = {}
    slots = None
    for sid, st in steps.items():
        state = st.get("state")
        if state == "waiting":
            before = [e.get("from") for e in edges if e.get("to") == sid]
            pending = [names.get(b, b) for b in before
                       if (steps.get(b) or {}).get("state") not in ("succeeded", "failed", "skipped")]
            if pending:
                out[sid] = {"kind": "waiting_for", "steps": pending}
        elif state == "ready":
            if slots is None:
                settings = dict(DEFAULT_SETTINGS, **(ctx.store.get_settings() or {}))
                active = ctx.store.list_runs({"state": {"$in": list(LIVE)}}, limit=1000, fields="definition:0")
                slots = {"job_running": _inflight(run),
                         "job_max": int(settings["max_searches_per_job"]),
                         "all_running": sum(_inflight(r) for r in active),
                         "all_max": int(settings["max_searches"])}
            full = slots["job_running"] >= slots["job_max"] or slots["all_running"] >= slots["all_max"]
            out[sid] = dict(slots, kind="search_slots") if full else {"kind": "next_tick"}
    return out


__all__ = ["engine_status", "queue_reasons", "step_reasons", "IN_FLIGHT"]
