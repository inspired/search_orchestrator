"""Cron slots, catch-up and run creation (spec sections 6, 8 and 10).

``due_runs(job, last_checked, now)`` lists the cron slots in
``(last_checked, now]`` to create runs for, oldest first:

* A slot at most ``ONTIME_GRACE`` seconds old is on time. Older slots were
  missed (engine or Splunk down) and follow the job's ``catchup`` policy:
  ``all`` (default) keeps the newest ``CATCHUP_CAP`` slots, ``latest`` only
  the newest slot, ``none`` only on-time slots.
* The work is bounded: slots are generated one day-long window at a time,
  walking back from ``now``, and the walk stops once enough are found. A long
  outage with a ``* * * * *`` cron never builds a list of every missed minute.

``create_run`` inserts a queued run with a deterministic key, so a restart can
never create one slot or one chained trigger twice: ``job:scheduled_time`` for
cron, ``job:upstream_run_id:trigger`` for chained runs (start_job actions add
``:a<action index>``), and a random suffix
otherwise. A re-run with "start downstream jobs again" ticked deliberately
starts them once more: its chained keys add ``:rerun<rerun_count>``, which is
still deterministic, so a restart cannot create that run twice either. It snapshots the job definition (spec section 4) and enforces the
per-job queue cap: a rejected run is audited and reported through the job's
``on_failure`` actions. While the job is held, rejections fold into the held
run's daily hold alert instead (keyed per day), so they never notify per slot.
"""
import copy
import logging
import re
import time
import uuid

from . import cron as cronmod
from . import tokens
from .store import ACTIVE_RUN_STATES

log = logging.getLogger(__name__)

CATCHUP_CAP = 7
ONTIME_GRACE = 300
WINDOW = 86400
DAY = 86400
QUEUE_CAP = 20
_SNAPSHOT_SKIP = ("_key", "_user")
# Everything run_key produces: a job id, then ":"-separated parts (a slot, a trigger, a
# random suffix, or a chained upstream run id, which itself contains ":").
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?::[A-Za-z0-9_-]{1,64})+$")
RUN_ID_MAX = 2048


def is_run_id(value):
    return isinstance(value, str) and len(value) <= RUN_ID_MAX and bool(RUN_ID_RE.fullmatch(value))


def cron_specs(job):
    specs = []
    for t in job.get("triggers") or []:
        if t.get("type") != "cron" or t.get("enabled") is False:
            continue
        try:
            specs.append(cronmod.parse(t.get("cron")))
        except cronmod.CronError as err:
            log.warning("job %s: ignoring bad cron %r: %s", job.get("id"), t.get("cron"), err)
    return specs


def due_runs(job, last_checked, now):
    """Slots in (last_checked, now] to create runs for, oldest first."""
    if last_checked is None or job.get("enabled") is False:
        return []
    specs = cron_specs(job)
    if not specs:
        return []
    now = int(now)
    lo, hi = int(last_checked) + 1, now + 1
    policy = job.get("catchup") or "all"
    want = 1 if policy == "latest" else CATCHUP_CAP
    floor = max(lo, now - ONTIME_GRACE) if policy == "none" else lo
    tz = job.get("timezone")
    found = []
    end = hi
    while end > floor and len(found) < want:
        start = max(floor, end - WINDOW)
        window = set()
        for spec in specs:
            window.update(cronmod.slots_between(spec, start, end, tz))
        for slot in sorted(window, reverse=True):
            if len(found) >= want:
                break
            found.append(slot)
        end = start
    return sorted(found)


def is_catchup(slot, now):
    return int(now) - int(slot) > ONTIME_GRACE


def run_key(job_id, trigger, scheduled_time, upstream=None, rerun=None, action_index=None):
    """``rerun`` (a re-run count, chained runs only) restarts downstream jobs.
    ``action_index`` (start_job actions) keeps two actions to one target apart."""
    if upstream:
        key = "%s:%s:%s" % (job_id, upstream, trigger)
        if action_index is not None:
            key += ":a%d" % int(action_index)
        return key + (":rerun%d" % int(rerun) if rerun else "")
    if trigger == "cron":
        return "%s:%d" % (job_id, int(scheduled_time))
    return "%s:%s:%s" % (job_id, trigger, uuid.uuid4().hex[:16])


def validate_params(job, params):
    """Declared parameters only, validated (raises tokens.TokenError)."""
    params = params or {}
    out = {}
    for decl in job.get("params") or []:
        out[decl["name"]] = tokens.validate_param(decl, params.get(decl["name"]))
    return out


def snapshot(job):
    return {k: copy.deepcopy(v) for k, v in job.items() if k not in _SNAPSHOT_SKIP}


def _held_run(store, job):
    """The failed run holding ``job``'s queue (``after_give_up = hold``), or None."""
    if (job.get("after_give_up") or "hold") != "hold":
        return None
    rows = store.list_runs({"job_id": job.get("id") or job.get("_key"), "held": True,
                            "state": "failed"}, limit=1)
    return rows[0] if rows else None


def create_run(store, job, trigger, scheduled_time, params, upstream=None, now=None,
               catchup=False, audit=None, actions=None, queue_cap=None, chain_depth=0,
               rerun=None, action_index=None):
    """Insert a queued run and return its ID, or None if it already exists or the
    job's queue is full. Raises tokens.TokenError for invalid parameters."""
    now = int(time.time() if now is None else now)
    job_id = job.get("id") or job.get("_key")
    key = run_key(job_id, trigger, scheduled_time, upstream, rerun, action_index)
    if store.get_run(key) is not None:
        return None
    clean = validate_params(job, params)
    definition = snapshot(job)
    run = {"_key": key, "id": key, "job_id": job_id, "owner": job.get("owner"),
           "trigger": trigger, "upstream": upstream, "scheduled_time": int(scheduled_time),
           "params": clean, "definition": definition, "state": "queued",
           "catchup": bool(catchup), "created_at": now, "queued_at": now,
           "started_at": None, "ended_at": None, "delay_base": None, "giveup_base": None,
           "paused_seconds": 0, "paused_at": None, "hooks_fired": [], "delay_alerted": False,
           "held": False, "gave_up": False, "rerun_count": 0, "chain_depth": int(chain_depth),
           "steps": {s["id"]: {"state": "waiting"} for s in definition.get("steps") or []}}
    if queue_cap is None:
        queue_cap = (store.get_settings() or {}).get("queue_cap") or QUEUE_CAP
    waiting = store.list_runs({"job_id": job_id, "state": {"$in": ACTIVE_RUN_STATES}},
                              fields="definition:0")
    if len(waiting) >= int(queue_cap):
        held = _held_run(store, job)
        if audit is not None:
            event = {"_time": now, "type": "run_rejected", "reason": "queue_cap",
                     "job_id": job_id, "run_id": key, "trigger": trigger,
                     "scheduled_time": int(scheduled_time), "queue_cap": int(queue_cap)}
            if held is not None:
                event["held"] = True
            audit.emit(event)
        if actions is not None:
            if held is None:
                actions.submit(dict(run, state="rejected"), "on_failure", "job", None)
            else:
                # Reported the same way as the hold: folded into the held run's daily hold
                # alert (same key, so at most one per job per day; none on the day of the
                # hold, whose failure was already sent).
                days = (now - int(held.get("held_at") or held.get("ended_at") or now)) // DAY
                if days >= 1:
                    actions.submit(held, "on_failure", "job", None, occurrence="hold%d" % days)
        return None
    if not store.create_run(run):
        return None
    if audit is not None:
        audit.emit({"_time": now, "type": "run_created", "job_id": job_id, "run_id": key,
                    "trigger": trigger, "scheduled_time": int(scheduled_time),
                    "upstream": upstream, "catchup": bool(catchup)})
    return key
