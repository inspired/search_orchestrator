"""Backfill planning (features-2 spec section 6).

A backfill runs one job once per slot of a past range, oldest first. Its document in
``so_backfills`` (key ``bf<12 hex>``) holds the planned ``slots`` and the engine's
progress (``next``, ``run_ids``, ``state``). The REST routes are in ``backfill_api.py``.
"""
import re

from . import cron as cronmod
from . import scheduler

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
