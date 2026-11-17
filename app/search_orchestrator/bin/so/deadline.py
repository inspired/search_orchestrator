"""Job deadlines (spec section 5).

A job may have ``deadline = {"finish_by": "HH:MM", "within": seconds}`` (at least
one). Only on-time scheduled runs (``cron``, not catch-up) and chained runs
(``completion``, ``start_job``, which carry the upstream scheduled time) get one:
manual, REST, alert-action, backfill and catch-up runs are often scheduled in the
past and would be late at once.

``deadline_at`` is computed once, when the run is created, and stored on the run;
a re-run keeps it. A run that ended before its deadline met it; a re-run of it
is never late (``keep_met``). ``within`` is the scheduled time plus that many seconds.
``finish_by`` is the first ``HH:MM`` in the job's time zone at or after the
scheduled time; a time that does not exist on a DST day is the first instant
after the gap. With both, the earlier wins. The deadline is wall-clock time, so
pausing does not move it.
"""
import re
from datetime import datetime, timedelta

from . import cron as cronmod

APPLIES_TO = ("cron", "completion", "start_job")
FINISH_BY_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
WITHIN_MIN = 60
WITHIN_MAX = 604800
LATE_STATES = ("queued", "running", "blocked", "paused")

_BAD_OBJECT = "deadline must be an object"
_BAD_FINISH_BY = "Finish by must be a time like 06:00"
_BAD_WITHIN = "Finish within must be between 1 minute and 7 days"
_EMPTY = "Set Finish by or Finish within, or remove the deadline"


def shape_issues(deadline):
    """Messages for a malformed ``deadline`` value (empty when it is fine)."""
    if not isinstance(deadline, dict):
        return [_BAD_OBJECT]
    finish_by, within = deadline.get("finish_by"), deadline.get("within")
    if finish_by is None and within is None:
        return [_EMPTY]
    out = []
    if finish_by is not None and not (isinstance(finish_by, str) and FINISH_BY_RE.match(finish_by)):
        out.append(_BAD_FINISH_BY)
    if within is not None and not (isinstance(within, int) and not isinstance(within, bool)
                                   and WITHIN_MIN <= within <= WITHIN_MAX):
        out.append(_BAD_WITHIN)
    return out


def _finish_by_at(hhmm, scheduled_time, tz):
    """The first local ``hhmm`` at or after ``scheduled_time`` (epoch seconds)."""
    tz = cronmod.resolve_tz(tz)
    hour, minute = int(hhmm[:2]), int(hhmm[3:])
    day = datetime.fromtimestamp(scheduled_time, tz).replace(tzinfo=None).date()
    for offset in range(3):
        naive = datetime.combine(day + timedelta(days=offset), datetime.min.time()) \
            .replace(hour=hour, minute=minute)
        at = cronmod._to_epoch(naive, tz)
        if at >= scheduled_time:
            return at
        # On the night clocks go back a time happens twice; the second may still be ahead.
        again = int(naive.replace(tzinfo=tz, fold=1).timestamp())
        if again >= scheduled_time \
                and datetime.fromtimestamp(again, tz).replace(tzinfo=None) == naive:
            return again
    return None  # unreachable: some day within three has the time


def deadline_at(definition, scheduled_time, trigger, catchup):
    """Epoch seconds a run must finish by, or None when it has no deadline."""
    deadline = (definition or {}).get("deadline")
    if trigger not in APPLIES_TO or catchup or not isinstance(deadline, dict) \
            or shape_issues(deadline):
        return None
    scheduled_time = int(scheduled_time)
    candidates = []
    if deadline.get("within") is not None:
        candidates.append(scheduled_time + int(deadline["within"]))
    if deadline.get("finish_by") is not None:
        candidates.append(_finish_by_at(deadline["finish_by"], scheduled_time,
                                        definition.get("timezone")))
    candidates = [c for c in candidates if c is not None]
    return min(candidates) if candidates else None


def keep_met(old, new):
    """Mark the re-run ``new`` as having met its deadline when ``old`` ended before it."""
    at, ended = old.get("deadline_at"), old.get("ended_at")
    if at is not None and ended is not None and int(ended) < int(at):
        new["deadline_met"] = True


def is_late(run, now):
    """True when an unfinished run has passed its deadline and was not yet marked late."""
    at = run.get("deadline_at")
    return (run.get("state") in LATE_STATES and at is not None and not run.get("deadline_met")
            and run.get("late_at") is None and int(now) >= int(at))
