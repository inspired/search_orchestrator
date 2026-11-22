"""Backfill planning (features-2 spec section 6).

A backfill runs one job once per slot of a past range, oldest first. Its document in
``so_backfills`` (key ``bf<12 hex>``) holds the planned ``slots`` and the engine's
progress (``next``, ``run_ids``, ``state``). The REST routes are in ``backfill_api.py``.

The engine calls ``feed`` once a tick, after the commands, and ``apply_cancel`` for the
``cancel_backfill`` command. Restart safety: every change is one whole-document save,
made right after the run it records exists (a run key is deterministic, so a restart
that finds the run moves ``next`` on instead of creating it again), and a cancel is
saved before the runs are cancelled (a replayed command finishes it).
"""
import re

from . import cron as cronmod
from . import scheduler, tokens
from .store import ACTIVE_RUN_STATES

BACKFILLS = "so_backfills"
MAX_SLOTS = 100
MAX_RANGE = 400 * 86400
STEP_MIN = 60
STEP_MAX = 2678400  # 31 days
MAX_CONCURRENCY = 5
ID_RE = re.compile(r"^bf[0-9a-f]{12}$")
SOURCES = ("schedule", "step")


class BackfillError(Exception):
    def __init__(self, code, message):
        Exception.__init__(self, message)
        self.code = code
        self.message = message


def plan_slots(job, start, end, source, step):
    """The scheduled times in ``[start, end)``, oldest first. ``schedule``: every slot of
    the job's enabled cron triggers, in the job's time zone. ``step``: ``start``,
    ``start + step``, ... (``step`` in seconds). Raises BackfillError ``no_schedule``
    when ``schedule`` is asked of a job without an enabled cron trigger."""
    start, end = int(start), int(end)
    if source == "step":
        return list(range(start, end, int(step)))
    specs = scheduler.cron_specs(job)
    if not specs:
        raise BackfillError("no_schedule", "The job has no schedule; add one or use Every …")
    slots = set()
    for spec in specs:
        slots.update(cronmod.slots_between(spec, start, end, job.get("timezone")))
    return sorted(slots)


def _save(engine, doc):
    engine.gw.kv_update(BACKFILLS, doc["_key"], doc)


def feed(engine, jobs, settings, now):
    """Create the next runs of each ``running`` backfill whose job exists and is on, and
    mark a backfill ``done`` once every slot has a run and none is queued or active. A
    backfill whose job was deleted is ``cancelled`` (audited with reason ``job_deleted``),
    so a new job with the same id never resumes it. A turned-off job's backfill waits."""
    for doc in engine.gw.kv_query(BACKFILLS, {"state": "running"}, sort="created_at:1"):
        engine._keep_lease()
        job = jobs.get(doc.get("job_id"))
        if job is None:
            doc.update(state="cancelled", ended_at=now)
            _save(engine, doc)
            engine._emit({"type": "backfill_cancelled", "backfill_id": doc["_key"],
                          "job_id": doc.get("job_id"), "user": None, "reason": "job_deleted"},
                         now)
        elif job.get("enabled") is not False:
            _feed_one(engine, doc, job, settings, now)


def _feed_one(engine, doc, job, settings, now):
    backfill_id, job_id = doc["_key"], doc["job_id"]
    slots = doc.get("slots") or []
    active = engine.store.list_runs({"job_id": job_id, "state": {"$in": ACTIVE_RUN_STATES}},
                                    fields="state,backfill")
    mine = sum(1 for r in active if r.get("backfill") == backfill_id)
    # Regular runs and re-runs go first: promotion by scheduled time would otherwise
    # always pick the older backfill slot.
    others = any(r.get("state") == "queued" and r.get("backfill") != backfill_id
                 for r in active)
    cap = int(settings["queue_cap"])
    while not others and mine < int(doc.get("concurrency") or 1) \
            and doc["next"] < len(slots):
        engine._keep_lease()
        slot = slots[doc["next"]]
        key = scheduler.run_key(job_id, "backfill", slot, backfill=backfill_id)
        if engine.store.get_run(key) is None:  # else made before a restart: move on
            if len(active) >= cap:
                break  # the queue is full: try again next tick, without a rejection
            try:
                created = scheduler.create_run(
                    engine.store, job, "backfill", slot, doc.get("params"), now=now,
                    audit=engine.audit, actions=engine.actions, queue_cap=cap,
                    backfill=backfill_id)
            except tokens.TokenError as err:  # the job's parameters changed: skip the slot
                engine._emit({"type": "run_rejected", "reason": "invalid_params",
                              "job_id": job_id, "run_id": key, "scheduled_time": int(slot),
                              "backfill_id": backfill_id, "error": str(err)}, now)
                key = None
            else:
                if created is None:
                    break
                mine += 1
                active.append({"state": "queued", "backfill": backfill_id})
        if key is not None and key not in doc["run_ids"]:
            doc["run_ids"].append(key)
        doc["next"] += 1
        _save(engine, doc)
    if doc["next"] >= len(slots) and mine == 0:
        counts = {}
        for run in engine.store.list_runs({"backfill": backfill_id}, fields="state"):
            counts[run.get("state")] = counts.get(run.get("state"), 0) + 1
        doc.update(state="done", ended_at=now)
        _save(engine, doc)
        engine._emit({"type": "backfill_done", "backfill_id": backfill_id, "job_id": job_id,
                      "counts": counts}, now)


def apply_cancel(engine, command, jobs, settings, now):
    """The ``cancel_backfill`` command: stop creating runs and cancel the queued and
    active ones. ``(result, detail, None)`` for the engine's command audit."""
    backfill_id = command.get("backfill_id")
    doc = None
    if isinstance(backfill_id, str) and ID_RE.fullmatch(backfill_id):
        doc = engine.gw.kv_get(BACKFILLS, backfill_id)
    if doc is None:
        return "rejected", "unknown backfill", None
    runs = engine.store.list_runs({"backfill": backfill_id,
                                   "state": {"$in": ACTIVE_RUN_STATES}}, fields="state")
    # A cancelled backfill with runs left is a cancel cut short by a restart: finish it.
    if doc.get("state") != "running" and not (doc.get("state") == "cancelled" and runs):
        return "rejected", "already ended", None
    if doc.get("state") == "running":
        doc.update(state="cancelled", cancelled_by=command.get("user"), ended_at=now)
        _save(engine, doc)
    for run in runs:
        engine._keep_lease()
        engine._apply_command({"type": "cancel", "run_id": run["_key"],
                               "user": command.get("user")}, jobs, settings, now)
    engine._emit({"type": "backfill_cancelled", "backfill_id": backfill_id,
                  "job_id": doc.get("job_id"), "user": command.get("user")}, now)
    return "ok", None, None
