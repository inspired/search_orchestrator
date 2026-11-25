"""Every Splunk search over time, for the Runs timeline's All Splunk searches row:
``GET schedule/splunk`` with ``from`` and ``to`` (epoch seconds, as ``GET schedule``).

* **Past** (up to now): each search Splunk finished, from its ``_audit`` event
  (``action=search info=completed``, with ``total_run_time``), as the time it ran. They are
  split into this app's searches (hidden ``_so_`` saved searches and previews), Splunk's
  scheduled searches and every other search (ad hoc, dashboards, other apps' REST calls).
* **Future** (from now): Splunk's scheduled saved searches the viewer may read, from their
  ``cron_schedule``, each lasting its median run time in the scheduler's log over the last 7
  days (60 seconds when it has none). This app's own projected searches are in ``GET
  schedule``'s ``load``.
* **Limit**: splunkd's own concurrent search limits (``server/status/limits/search-concurrency``).

Each bucket (5 minutes, or 30 minutes for a window over two days) holds the most searches
that ran at the same moment in it. Every search runs as the viewer, so what they may read
decides what they see: by default only admins may search ``_audit`` and ``_internal``. Only
counts are returned, never search names or text.
"""
from . import authz, cron
from .api import ApiError
from .gateway import GatewayError, oneshot_search
from .schedule_api import _window

SHORT_BUCKET = 300
LONG_BUCKET = 1800
DEFAULT_RUNTIME = 60
MAX_PAST = 50000  # finished searches read for one window
MAX_SAVED = 2000  # scheduled saved searches projected
MAX_SLOTS = 50000  # their projected runs in one window
SEARCH_SECONDS = 9  # each of the three searches: within the page's 30-second request timeout
KINDS = ("app", "scheduled", "other")

NOTE_EMPTY = ("No searches found in this window. Seeing them needs search access to Splunk's "
              "_audit and _internal indexes, which by default only admins have.")
NOTE_DENIED = ("Splunk refused a search: seeing every Splunk search needs search access to the "
               "_audit and _internal indexes and to the server's search limits; ask an admin.")
NOTE_PAST_LIMIT = "Only the first %d finished searches are counted; narrow the window." % MAX_PAST
NOTE_SLOTS_LIMIT = "Only the first %d projected runs are counted." % MAX_SLOTS


def past_query():
    return ('search index=_audit action=search info=completed total_run_time=*'
            ' | eval end=_time, start=_time-tonumber(total_run_time)'
            ' | eval kind=case(match(savedsearch_name, "^_so_") OR match(search_id, "so_preview_"), '
            '"app", match(search_id, "scheduler_"), "scheduled", true(), "other")'
            ' | fields start, end, kind | fields - _*')


def saved_query():
    return ('| rest splunk_server=local count=0 /servicesNS/-/-/saved/searches '
            'search="is_scheduled=1" search="disabled=0"'
            ' | fields title, eai:acl.app, cron_schedule'
            ' | join type=left title eai:acl.app [search index=_internal sourcetype=scheduler '
            'status=success earliest=-7d | stats median(run_time) as runtime by savedsearch_name, app'
            ' | rename savedsearch_name as title, app as "eai:acl.app"]'
            ' | head %d' % MAX_SAVED)


def limits_query():
    return ('| rest splunk_server=local /services/server/status/limits/search-concurrency'
            ' | fields max_hist_searches, max_hist_scheduled_searches')


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _busiest(intervals, start, end, bucket, kinds):
    """``[[bucket start, count per kind...], ...]``: per bucket from ``start``, the counts at
    the moment the most searches ran at once; buckets with none are left out."""
    events = []
    for s, e, kind in intervals:
        if e > s and e > start and s < end:
            events.append((s, 1, kind))
            events.append((e, -1, kind))
    events.sort(key=lambda x: (x[0], x[1]))  # an end before a start at the same time
    now = dict.fromkeys(kinds, 0)
    out = []
    i = 0
    t = start
    while t < end:
        while i < len(events) and events[i][0] < t:
            now[events[i][2]] += events[i][1]
            i += 1
        best = dict(now)
        while i < len(events) and events[i][0] < t + bucket:
            now[events[i][2]] += events[i][1]
            i += 1
            if sum(now.values()) > sum(best.values()):
                best = dict(now)
        if sum(best.values()) > 0:
            out.append([t] + [best[k] for k in kinds])
        t += bucket
    return out


class _Searches:
    def __init__(self, ctx):
        self.ctx = ctx
        self.notes = []
        self.found = False
        self.searches = []

    def rows(self, title, spl, earliest, latest, count):
        self.searches.append({"title": title, "spl": oneshot_search(spl), "earliest": earliest,
                              "latest": latest})
        try:
            out = self.ctx.user_gw.search_oneshot(self.ctx.user, spl, earliest, latest, count=count,
                                                  max_time=SEARCH_SECONDS) or []
        except GatewayError as err:
            if err.status not in (401, 403):
                raise ApiError(502, "search_failed", "Splunk could not search for %s (%s); try "
                               "again." % (title, str(err).strip()[:200] or "error"))
            if NOTE_DENIED not in self.notes:
                self.notes.append(NOTE_DENIED)
            return []
        self.found = self.found or bool(out)
        return out


def _limit(rows):
    if not rows:
        return None
    total, scheduled = _num(rows[0].get("max_hist_searches")), _num(rows[0].get("max_hist_scheduled_searches"))
    if total is None:
        return None
    return {"searches": int(total), "scheduled": int(scheduled) if scheduled is not None else None}


def _projected(rows, start, end):
    """``(intervals, projected searches, unreadable crons, cut off)`` of the saved searches."""
    intervals, projected, skipped = [], 0, 0
    for row in rows:
        text = row.get("cron_schedule") or ""
        try:
            spec = cron.parse(text)
        except Exception:
            skipped += 1
            continue
        runtime = _num(row.get("runtime"))
        runtime = max(1.0, runtime if runtime is not None else DEFAULT_RUNTIME)
        slots = cron.slots_between(spec, max(0, int(start - runtime)), end, None)
        projected += 1
        for slot in slots:
            intervals.append((slot, slot + runtime, "scheduled"))
            if len(intervals) >= MAX_SLOTS:
                return intervals, projected, skipped, True
    return intervals, projected, skipped, False


def splunk_load(ctx, body):
    if not any(c in authz.CAPABILITIES for c in ctx.access["capabilities"]):
        raise ctx.deny("read_schedule")
    start, end = _window(ctx, body)
    bucket = SHORT_BUCKET if end - start <= 2 * 86400 else LONG_BUCKET
    now = int(ctx.now)
    run = _Searches(ctx)
    past, future = [], []
    if start < now:
        latest = min(end, now)
        rows = run.rows("the searches that ran", past_query(), str(start), str(latest), MAX_PAST)
        if len(rows) >= MAX_PAST:
            run.notes.append(NOTE_PAST_LIMIT)
        intervals = [(_num(r.get("start")), _num(r.get("end")), r.get("kind") if r.get("kind") in KINDS else "other")
                     for r in rows]
        intervals = [(s, e, k) for s, e, k in intervals if s is not None and e is not None]
        past = _busiest(intervals, start, latest, bucket, KINDS)
    projected, skipped = 0, 0
    if end > now:
        rows = run.rows("Splunk's scheduled searches", saved_query(), "-1m", "now", MAX_SAVED)
        first = start + max(0, (now - start) // bucket) * bucket if now > start else start
        intervals, projected, skipped, cut = _projected(rows, first, end)
        if cut:
            run.notes.append(NOTE_SLOTS_LIMIT)
        future = [[t, n] for t, n in _busiest(intervals, first, end, bucket, ("scheduled",))]
    limit = _limit(run.rows("Splunk's search limits", limits_query(), "-1m", "now", 1))
    if not run.found and not run.notes:
        run.notes.append(NOTE_EMPTY)
    return 200, {"from": start, "to": end, "now": now, "bucket": bucket, "past": past,
                 "future": future, "limit": limit, "projected_searches": projected,
                 "skipped_crons": skipped, "notes": run.notes, "searches": run.searches}
