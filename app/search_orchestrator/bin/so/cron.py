"""5-field cron parsing and evaluation in an IANA time zone (pure Python).

Fields: minute hour day-of-month month day-of-week. Supports ``*``, lists,
ranges, steps (``*/5``, ``1-10/2``, ``5/10``) and month/weekday names.
Day-of-week accepts 0-7 (0 and 7 are Sunday). As in Vixie cron, when both
day-of-month and day-of-week are restricted a day matches if either matches.

Time zones: ``tz`` may be a name, a tzinfo, or None (server local time). If the
zone cannot be loaded (for example ``tzdata`` is missing) the server's local
time is used and a warning is logged.

DST rules (slots_between): a wall-clock time that does not exist (spring gap)
fires once, at the instant the gap ends; a wall-clock time that occurs twice
(autumn repeat) fires once, at its first occurrence. ``matches`` is a pure
wall-clock test and returns False for the second occurrence of a repeated time.
"""
import logging
import re
import time
from collections import namedtuple
from datetime import datetime, timedelta, tzinfo

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None

log = logging.getLogger(__name__)

CronSpec = namedtuple("CronSpec", "minutes hours doms months dows dom_star dow_star")


class CronError(ValueError):
    pass


_MONTHS = {n: i + 1 for i, n in enumerate(
    "jan feb mar apr may jun jul aug sep oct nov dec".split())}
_DOWS = {n: i for i, n in enumerate("sun mon tue wed thu fri sat".split())}


def _value(text, names, lo, hi, field):
    t = text.lower()
    if t in names:
        return names[t]
    if not re.fullmatch(r"[0-9]+", t):
        raise CronError("bad value %r in %s field" % (text, field))
    v = int(t)
    if v < lo or v > hi:
        raise CronError("%s value %d out of range %d-%d" % (field, v, lo, hi))
    return v


def _field(text, lo, hi, names, field):
    out = set()
    if not text:
        raise CronError("empty %s field" % field)
    for part in text.split(","):
        if not part:
            raise CronError("empty list item in %s field" % field)
        base, _, step_s = part.partition("/")
        if "/" in part:
            if not re.fullmatch(r"[0-9]+", step_s) or int(step_s) < 1:
                raise CronError("bad step %r in %s field" % (step_s, field))
            step = int(step_s)
        else:
            step = 1
        if base == "*":
            a, b = lo, hi
        elif "-" in base:
            x, _, y = base.partition("-")
            a, b = _value(x, names, lo, hi, field), _value(y, names, lo, hi, field)
            if a > b:
                raise CronError("reversed range %r in %s field" % (base, field))
        else:
            a = _value(base, names, lo, hi, field)
            b = hi if "/" in part else a
        out.update(range(a, b + 1, step))
    return out


def parse(expr):
    if not isinstance(expr, str):
        raise CronError("cron must be a string")
    parts = expr.split()
    if len(parts) != 5:
        raise CronError("cron needs 5 fields, got %d" % len(parts))
    minutes = _field(parts[0], 0, 59, {}, "minute")
    hours = _field(parts[1], 0, 23, {}, "hour")
    doms = _field(parts[2], 1, 31, {}, "day-of-month")
    months = _field(parts[3], 1, 12, _MONTHS, "month")
    dows = {d % 7 for d in _field(parts[4], 0, 7, _DOWS, "day-of-week")}
    return CronSpec(frozenset(minutes), frozenset(hours), frozenset(doms),
                    frozenset(months), frozenset(dows),
                    parts[2].startswith("*"), parts[4].startswith("*"))


_EPOCH = datetime(1970, 1, 1)


def _gmtoff(ts):
    return time.localtime(ts).tm_gmtoff


class LocalTZ(tzinfo):
    """Server local time, DST-aware: asks time.localtime for each instant."""

    def utcoffset(self, dt):
        u = int((dt.replace(tzinfo=None) - _EPOCH).total_seconds())
        before, after = _gmtoff(u - 86400), _gmtoff(u + 86400)
        valid = sorted({o for o in (before, after) if _gmtoff(u - o) == o}, reverse=True)
        if len(valid) == 2:  # repeated wall time: fold=0 is the earlier instant
            off = valid[1] if dt.fold else valid[0]
        elif valid:
            off = valid[0]
        else:  # gap: fold=0 uses the offset before it, fold=1 the one after
            off = after if dt.fold else before
        return timedelta(seconds=off)

    def dst(self, dt):
        return None

    def tzname(self, dt):
        return None

    def fromutc(self, dt):
        u = int((dt.replace(tzinfo=None) - _EPOCH).total_seconds())
        off = _gmtoff(u)
        local = dt.replace(tzinfo=None) + timedelta(seconds=off)
        res = local.replace(tzinfo=self)
        if res.utcoffset() != timedelta(seconds=off):
            res = local.replace(tzinfo=self, fold=1)
        return res


def tz_status(name):
    """'ok', 'unknown' (bad zone key) or 'unavailable' (no tz database)."""
    if ZoneInfo is None:
        return "unavailable"
    try:
        ZoneInfo(name)
        return "ok"
    except Exception:
        pass
    try:
        ZoneInfo("UTC")
    except Exception:
        return "unavailable"
    return "unknown"


def resolve_tz(tz):
    """Return a tzinfo for a name/tzinfo/None, falling back to server local time."""
    if tz is not None and not isinstance(tz, str):
        return tz
    if tz:
        try:
            return ZoneInfo(tz)
        except Exception as e:  # missing tzdata or unknown key
            log.warning("time zone %r unavailable (%s); using server local time", tz, e)
    return LocalTZ()


def _day_ok(spec, d):
    if d.month not in spec.months:
        return False
    dom = d.day in spec.doms
    dow = ((d.weekday() + 1) % 7) in spec.dows
    if spec.dom_star or spec.dow_star:
        return dom and dow
    return dom or dow


def matches(spec, epoch, tz):
    tz = resolve_tz(tz)
    d = datetime.fromtimestamp(epoch, tz)
    if d.fold:
        return False
    return (d.minute in spec.minutes and d.hour in spec.hours and _day_ok(spec, d))


def _to_epoch(naive, tz):
    """Epoch for a local wall-clock time, applying the DST rules above."""
    t0 = naive.replace(tzinfo=tz, fold=0).timestamp()
    if datetime.fromtimestamp(t0, tz).replace(tzinfo=None) == naive:
        return int(t0)  # exists; fold=0 is the first occurrence if repeated
    # Gap: find the instant the gap ends (first second with the new offset).
    t1 = naive.replace(tzinfo=tz, fold=1).timestamp()
    lo, hi = int(min(t0, t1)), int(max(t0, t1))
    after = datetime.fromtimestamp(hi, tz).utcoffset()
    while lo < hi:
        mid = (lo + hi) // 2
        if datetime.fromtimestamp(mid, tz).utcoffset() == after:
            hi = mid
        else:
            lo = mid + 1
    return lo


def slots_between(spec, start, end, tz):
    """Sorted epochs of scheduled slots with start <= slot < end."""
    tz = resolve_tz(tz)
    first = datetime.fromtimestamp(start, tz).date() - timedelta(days=1)
    last = datetime.fromtimestamp(end, tz).date() + timedelta(days=1)
    out = set()
    day = first
    while day <= last:
        if _day_ok(spec, day):
            for h in sorted(spec.hours):
                for m in sorted(spec.minutes):
                    e = _to_epoch(datetime(day.year, day.month, day.day, h, m), tz)
                    if start <= e < end:
                        out.add(e)
        day += timedelta(days=1)
    return sorted(out)


def next_slot(spec, after, tz, max_days):
    """The first slot at or after ``after``, looking at most ``max_days`` days ahead
    (one cheap day match per day), or None if there is none within that walk."""
    tz = resolve_tz(tz)
    day = datetime.fromtimestamp(after, tz).date() - timedelta(days=1)
    for _ in range(int(max_days) + 1):
        if _day_ok(spec, day):
            found = [e for e in (_to_epoch(datetime(day.year, day.month, day.day, h, m), tz)
                                 for h in spec.hours for m in spec.minutes) if e >= after]
            if found:
                return min(found)
        day += timedelta(days=1)
    return None
