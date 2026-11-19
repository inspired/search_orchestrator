"""Logs routes, dispatched from ``api.handle``, for the Troubleshooting page. They search the
app's own log lines (``so.logs``) in ``_internal`` as the caller:

* ``GET logs``: the lines, each with its ``key=value`` fields parsed (``fields``), its free
  text (``message``) and any traceback, plus ``names`` (job and step names for the ids in
  the lines, for jobs the caller may see). ``sort`` is ``newest`` (default) or ``oldest``.
* ``GET logs/summary``: counts per time bucket for the graphs (lines per level, requests
  per status class and their 95th percentile time, engine tick time and active runs), the
  totals for the health tiles, the most frequent events, the engine's lease status and
  the log level.
* ``GET logs/breakdown``: the slowest API routes and the slowest splunkd calls.
* ``GET logs/problems``: errors and warnings grouped by what went wrong (the event, the
  error code and the error text with ids and numbers taken out), most frequent first.

Filters (all optional): ``run_id``, ``job_id``, ``step_id``, ``event``, ``process`` (engine
or rest), ``level`` (the lowest level to show: ERROR, WARNING, INFO or DEBUG), ``text`` (a
phrase), ``range`` (15m, 1h, 24h or 7d; default 24h) and ``limit`` (1 to 1000; default
200). Ids must be plain names; the phrase is quoted, so none of them can change the search.

Splunk answers a search of an index the caller may not read with no rows, not an error, so
no lines comes with a note about access and the log level.
"""
import re
from collections import OrderedDict

from . import authz, queue_info
from .api import ApiError
from .gateway import APP, GatewayError, oneshot_search
from .logs import DEFAULT_LEVEL, FAILURE_EVENTS, LEVELS

ID_RE = re.compile(r"^[A-Za-z0-9_.:@-]{1,200}$")
EVENT_RE = re.compile(r"^[a-z][a-z0-9_]{0,60}(,[a-z][a-z0-9_]{0,60}){0,9}$")
PROCESSES = ("engine", "rest")
RANGES = {"15m": "-15m", "1h": "-1h", "24h": "-24h", "7d": "-7d"}
SPANS = {"15m": "30s", "1h": "1m", "24h": "30m", "7d": "4h"}
DEFAULT_RANGE = "24h"
DEFAULT_LIMIT = 200
MAX_LIMIT = 1000
MAX_TEXT = 300
SEARCH_SECONDS = 20  # within the page's 30-second request timeout
PROBLEM_LINES = 2000
TOP_EVENTS = 15
TOP_ROUTES = 15
FIELDS = ("_time", "level", "process", "logger", "event", "run_id", "job_id", "step_id", "_raw")
NOTE_EMPTY = ("No log lines match. Reading them needs read access to the _internal index "
              "(ask an admin if you expected some), and lines below the log level in Settings "
              "are not written.")
NOTE_DENIED = "Reading the logs needs read access to the _internal index; ask an admin."
NOTE_LIMIT = "Only the %s %d lines are shown; narrow the filters to see others."
NOTE_PROBLEMS_LIMIT = "Grouped from the newest %d errors and warnings." % PROBLEM_LINES

# One line: "<date> <time>,<ms> <zone> level=.. process=.. logger=.. <rest>"
LINE_RE = re.compile(r"^\S+ \S+ \S+ level=(\S+) process=(\S+) logger=(\S+) ?(.*)$")
KV_RE = re.compile(r'([A-Za-z_][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|\S+)')


def source():
    """The log files of this app (``<app>.<process>.log``), not a side-by-side copy's."""
    return 'source="*%s.*.log"' % APP


def _bad(message):
    return ApiError(400, "bad_request", message)


def _quoted(text):
    return '"%s"' % text.replace("\\", "\\\\").replace('"', '\\"')


def base_terms(filters, levels=True):
    """``index=_internal source=... [filters]``: the search every route starts from."""
    terms = ["index=_internal", source()]
    if filters.get("process"):
        terms.append("process=%s" % filters["process"])
    level = filters.get("level")
    if levels and level and level != "DEBUG":
        terms.append("level IN (%s)" % ", ".join(LEVELS[:LEVELS.index(level) + 1]))
    for key in ("run_id", "job_id", "step_id"):
        if filters.get(key):
            terms.append("%s=%s" % (key, _quoted(filters[key])))
    if filters.get("event"):
        events = filters["event"].split(",")
        terms.append("event=%s" % events[0] if len(events) == 1 else "event IN (%s)" % ", ".join(events))
    if filters.get("text"):
        terms.append(_quoted(filters["text"]))
    return " ".join(terms)


def logs_query(filters):
    """The SPL for the lines (``filters`` already checked by ``_filters``)."""
    sort = " | reverse" if filters.get("sort") == "oldest" else ""
    return "%s | head %d%s | fields %s" % (base_terms(filters), filters["limit"], sort,
                                           " ".join(FIELDS))


def summary_query(filters):
    """Per-bucket counts for the graphs; ``timechart`` keeps empty buckets (a quiet engine)."""
    return (
        base_terms(filters, levels=False) +
        " | eval st=tonumber(status), ms=tonumber(ms)"
        " | timechart span=%s"
        ' count(eval(level="ERROR" OR level="CRITICAL")) AS error'
        ' count(eval(level="WARNING")) AS warning'
        ' count(eval(level="INFO")) AS info'
        ' count(eval(level="DEBUG")) AS debug'
        ' count(eval(event="request" AND st<400)) AS req_ok'
        ' count(eval(event="request" AND st>=400 AND st<500)) AS req_4xx'
        ' count(eval(event="request" AND st>=500)) AS req_5xx'
        ' perc95(eval(if(event="request", ms, null()))) AS req_p95'
        ' count(eval(event="tick")) AS ticks'
        ' avg(eval(if(event="tick", ms, null()))) AS tick_avg'
        ' max(eval(if(event="tick", ms, null()))) AS tick_max'
        ' max(eval(if(event="tick", tonumber(active_runs), null()))) AS active_runs'
        % SPANS[filters["range"]])


def counts_query(filters):
    """Counts per event, level, process, request status class and new state (``to``)."""
    return (
        base_terms(filters, levels=False) +
        ' | eval st=tonumber(status), sc=case(event!="request", "-", st>=500, "5xx",'
        ' st>=400, "4xx", true(), "ok")'
        ' | fillnull value="-" event to'
        " | stats count by event level process sc to")


def routes_query(filters):
    """The API routes (ids taken out), slowest first, and the 95th percentile of all."""
    return (
        base_terms(filters, levels=False) + " event=request"
        " | eval ms=tonumber(ms), st=tonumber(status)"
        ' | eval route=replace(path, "^.*?/orchestrator[^/]*/?", "")'
        ' | eval route=replace(route, "^(jobs|runs|backfills|snippets|destinations)/[^/]+",'
        ' "\\1/<id>")'
        ' | eval route=replace(route, "^preview/(?!condition$|output$|defaults$)[^/]+",'
        ' "preview/<sid>")'
        " | eventstats perc95(ms) AS all_p95 count AS all_count"
        " | stats count perc95(ms) AS p95 avg(ms) AS avg max(ms) AS max"
        " count(eval(st>=400)) AS failed first(all_p95) AS all_p95 first(all_count) AS all_count"
        " by method route | sort - p95 | head %d" % TOP_ROUTES)


def calls_query(filters):
    """splunkd calls (debug level) by endpoint, ids taken out, slowest first."""
    return (
        base_terms(filters, levels=False) + " event=splunkd_call"
        " | eval ms=tonumber(ms)"
        ' | eval ep=replace(path, "^/?services(NS/[^/]+/[^/]+)?/", "")'
        ' | eval ep=replace(ep, "^(storage/collections/data/[^/]+)/.+$", "\\1/<key>")'
        ' | eval ep=replace(ep, "^saved/searches/[^/]+", "saved/searches/<name>")'
        ' | eval ep=replace(ep, "^search/jobs/[^/]+", "search/jobs/<sid>")'
        ' | eval ep=replace(ep, "^storage/passwords/.+$", "storage/passwords/<name>")'
        " | stats count perc95(ms) AS p95 avg(ms) AS avg max(ms) AS max"
        " count(eval(isnotnull(error))) AS errors by method ep | sort - p95 | head %d"
        % TOP_ROUTES)


def problems_query(filters):
    """Errors and warnings, and failure events of any level (lines from before 1.33.2
    logged them at INFO)."""
    levels = "ERROR" if filters.get("level") == "ERROR" else "ERROR, WARNING"
    failures = ", ".join(sorted(FAILURE_EVENTS))
    return ("%s (level IN (%s) OR event IN (%s) OR (event IN (run_state, step_state) to=\"failed\")"
            " OR (event=step_attempt outcome=\"failed\")) | head %d | fields _time _raw"
            % (base_terms(dict(filters, level="")), levels, failures, PROBLEM_LINES))


def _filters(body):
    out = {}
    for key in ("run_id", "job_id", "step_id"):
        value = body.get(key)
        if value not in (None, ""):
            if not isinstance(value, str) or not ID_RE.fullmatch(value):
                raise _bad("%s must be a plain id" % key)
            out[key] = value
    event = body.get("event")
    if event not in (None, ""):
        if not isinstance(event, str) or not EVENT_RE.fullmatch(event):
            raise _bad("event must be an event name, or up to 10 separated by commas")
        out["event"] = event
    process = body.get("process")
    if process not in (None, ""):
        if process not in PROCESSES:
            raise _bad("process must be one of %s" % ", ".join(PROCESSES))
        out["process"] = process
    level = body.get("level")
    if level not in (None, ""):
        level = str(level).upper()
        if level not in LEVELS:
            raise _bad("level must be one of %s" % ", ".join(LEVELS))
        out["level"] = level
    text = body.get("text")
    if text not in (None, ""):
        text = " ".join(str(text).split())
        if len(text) > MAX_TEXT:
            raise _bad("text may be at most %d characters" % MAX_TEXT)
        out["text"] = text
    span = body.get("range") or DEFAULT_RANGE
    if span not in RANGES:
        raise _bad("range must be one of %s" % ", ".join(RANGES))
    out["range"] = span
    sort = body.get("sort") or "newest"
    if sort not in ("newest", "oldest"):
        raise _bad("sort must be newest or oldest")
    out["sort"] = sort
    try:
        out["limit"] = max(1, min(MAX_LIMIT, int(body.get("limit") or DEFAULT_LIMIT)))
    except (TypeError, ValueError):
        raise _bad("limit must be a number")
    return out


def _unquote(value):
    if len(value) >= 2 and value[0] == value[-1] == '"':
        return re.sub(r'\\(.)', r'\1', value[1:-1])
    return value


def parse_line(raw):
    """``(fields, message, traceback)`` of one raw line: ``fields`` are the ``key=value``
    pairs of an ``event=`` line; ``message`` the free text of any other line."""
    raw = raw or ""
    first, _, rest = raw.partition("\n")
    m = LINE_RE.match(first)
    if not m:
        return {}, first, rest or None
    body = m.group(4)
    fields = {"level": m.group(1), "process": m.group(2), "logger": m.group(3)}
    message = None
    if body.startswith("event="):
        for key, value in KV_RE.findall(body):
            fields[key] = _unquote(value)
    else:
        message = body
    return fields, message, rest or None


def _line(row):
    fields, message, trace = parse_line(row.get("_raw"))
    return {"time": row.get("_time"), "level": row.get("level") or fields.get("level"),
            "process": row.get("process") or fields.get("process"),
            "event": row.get("event") or fields.get("event"),
            "run_id": row.get("run_id") or fields.get("run_id"),
            "job_id": row.get("job_id") or fields.get("job_id"),
            "step_id": row.get("step_id") or fields.get("step_id"),
            "fields": fields, "message": message, "traceback": trace, "raw": row.get("_raw")}


_PATH_JOB_RE = re.compile(r"/jobs/([^/?]+)")


def _job_ids(lines):
    ids = set()
    for line in lines:
        f = line.get("fields") or {}
        for value in (line.get("job_id"), f.get("target_job")):
            if value:
                ids.add(value)
        m = _PATH_JOB_RE.search(f.get("path") or "")
        if m:
            from urllib.parse import unquote
            ids.add(unquote(m.group(1)))
    return ids


def names(ctx, job_ids):
    """``{job_id: {"name": ..., "steps": {step_id: name}}}`` for the jobs the caller may see."""
    out = {}
    for job_id in sorted(j for j in job_ids if isinstance(j, str) and ID_RE.fullmatch(j)):
        try:
            job = ctx.store.get_job(job_id)
        except Exception:
            job = None
        if not job or not ctx.allowed(authz.can_view, job):
            continue
        out[job_id] = {"name": job.get("name") or job_id,
                       "steps": {s.get("id"): s.get("name") or s.get("id")
                                 for s in job.get("steps") or [] if s.get("id")}}
    return out


def _search(ctx, spl, filters, count, notes, seconds=SEARCH_SECONDS):
    """Rows of ``spl`` over the filters' range, or [] with a note when access is refused."""
    try:
        return ctx.user_gw.search_oneshot(ctx.user, spl, RANGES[filters["range"]], "now",
                                          count=count, max_time=seconds) or []
    except GatewayError as err:
        if err.status not in (401, 403):
            raise ApiError(502, "search_failed", "Splunk could not search the logs (%s); "
                                                 "try again." % (str(err).strip()[:200] or "error"))
        if NOTE_DENIED not in notes:
            notes.append(NOTE_DENIED)
        return []


def _spl(spl, filters):
    return {"spl": oneshot_search(spl), "earliest": RANGES[filters["range"]], "latest": "now"}


def search_logs(ctx, body):
    filters = _filters(body)
    spl = logs_query(filters)
    notes = []
    lines = [_line(r) for r in _search(ctx, spl, filters, filters["limit"], notes)]
    if not lines and not notes:
        notes.append(NOTE_EMPTY)
    if len(lines) >= filters["limit"]:
        notes.append(NOTE_LIMIT % (filters["sort"], filters["limit"]))
    out = {"lines": lines, "notes": notes, "names": names(ctx, _job_ids(lines))}
    out.update(_spl(spl, filters))
    return 200, out


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


BUCKET_FIELDS = ("error", "warning", "info", "debug", "req_ok", "req_4xx", "req_5xx", "req_p95",
                 "ticks", "tick_avg", "tick_max", "active_runs")


def summary(ctx, body):
    filters = _filters(body)
    notes = []
    buckets = []
    for row in _search(ctx, summary_query(filters), filters, 1000, notes, seconds=15):
        b = {"time": row.get("_time")}
        for key in BUCKET_FIELDS:
            b[key] = _num(row.get(key))
        buckets.append(b)
    totals = {"error": 0, "warning": 0, "info": 0, "debug": 0, "requests": 0, "req_4xx": 0,
              "req_5xx": 0, "actions_failed": 0, "actions_done": 0, "runs_failed": 0,
              "runs_succeeded": 0, "steps_failed": 0, "engine": 0, "rest": 0,
              "schedules_skipped": 0, "schedules_missed": 0}
    events = {}
    for row in _search(ctx, counts_query(filters), filters, 5000, notes, seconds=15):
        n = int(_num(row.get("count")) or 0)
        event, level, sc, to = row.get("event"), row.get("level"), row.get("sc"), row.get("to")
        key = {"CRITICAL": "error"}.get(level, (level or "").lower())
        if key in totals:
            totals[key] += n
        if row.get("process") in ("engine", "rest"):
            totals[row["process"]] += n
        if event == "request":
            totals["requests"] += n
            if sc in ("4xx", "5xx"):
                totals["req_" + sc] += n
        elif event == "action_failed":
            totals["actions_failed"] += n
        elif event == "action_done":
            totals["actions_done"] += n
        elif event == "run_state" and to == "failed":
            totals["runs_failed"] += n
        elif event == "run_state" and to == "succeeded":
            totals["runs_succeeded"] += n
        elif event == "step_state" and to == "failed":
            totals["steps_failed"] += n
        elif event == "schedule_skipped":
            totals["schedules_skipped"] += n
        elif event == "schedule_missed":
            totals["schedules_missed"] += n
        name = event if event and event != "-" else "(no event)"
        e = events.setdefault(name, {"event": name, "count": 0, "levels": {}})
        e["count"] += n
        e["levels"][level] = e["levels"].get(level, 0) + n
    top = sorted(events.values(), key=lambda e: (-e["count"], e["event"]))[:TOP_EVENTS]
    engine = queue_info.engine_status(ctx)
    level = DEFAULT_LEVEL
    try:
        level = (ctx.store.get_settings() or {}).get("log_level") or DEFAULT_LEVEL
    except Exception:
        pass
    if not buckets and not events and not notes:
        notes.append(NOTE_EMPTY)
    return 200, {"range": filters["range"], "span": SPANS[filters["range"]], "buckets": buckets,
                 "totals": totals, "events": top, "engine": engine, "log_level": level,
                 "notes": notes, "searches": {"activity": _spl(summary_query(filters), filters),
                                              "counts": _spl(counts_query(filters), filters)}}


def breakdown(ctx, body):
    filters = _filters(body)
    notes = []
    routes, all_p95, all_count = [], None, 0
    for row in _search(ctx, routes_query(filters), filters, TOP_ROUTES, notes, seconds=12):
        routes.append({"method": row.get("method"), "route": row.get("route"),
                       "count": int(_num(row.get("count")) or 0), "p95": _num(row.get("p95")),
                       "avg": _num(row.get("avg")), "max": _num(row.get("max")),
                       "failed": int(_num(row.get("failed")) or 0)})
        all_p95 = _num(row.get("all_p95"))
        all_count = int(_num(row.get("all_count")) or 0)
    calls = []
    for row in _search(ctx, calls_query(filters), filters, TOP_ROUTES, notes, seconds=12):
        calls.append({"method": row.get("method"), "endpoint": row.get("ep"),
                      "count": int(_num(row.get("count")) or 0), "p95": _num(row.get("p95")),
                      "avg": _num(row.get("avg")), "max": _num(row.get("max")),
                      "errors": int(_num(row.get("errors")) or 0)})
    return 200, {"routes": routes, "requests_p95": all_p95, "requests": all_count,
                 "calls": calls, "notes": notes,
                 "searches": {"routes": _spl(routes_query(filters), filters),
                              "calls": _spl(calls_query(filters), filters)}}


_NOISE = [
    (re.compile(r"https?://\S+"), "<url>"),
    (re.compile(r"\bscheduler__\S+|\b[0-9]{9,}\.[0-9]+\b|\bmd_[0-9]+\S*"), "<sid>"),
    (re.compile(r"\b[A-Za-z0-9_.-]+:(manual|cron|completion|backfill|start_job|rerun|selftest)"
                r"\S*"), "<run>"),
    (re.compile(r"\b[0-9a-f]{8,}\b"), "<id>"),
    (re.compile(r"\b\d+(\.\d+)?\b"), "<n>"),
    (re.compile(r"'[^']*'"), "'…'"),
]


def signature(line):
    """What went wrong, without the ids and numbers that differ each time."""
    f = line.get("fields") or {}
    text = f.get("error") or line.get("message") or ""
    for pattern, repl in _NOISE:
        text = pattern.sub(repl, text)
    text = " ".join(text.split())[:200]
    parts = [line.get("event") or "", f.get("error_code") or "", f.get("action_type") or "", text]
    return "|".join(parts)


def problems(ctx, body):
    filters = _filters(body)
    notes = []
    spl = problems_query(filters)
    rows = _search(ctx, spl, filters, PROBLEM_LINES, notes)
    groups = OrderedDict()
    for row in rows:  # newest first
        line = _line(row)
        sig = signature(line)
        g = groups.get(sig)
        if g is None:
            g = groups[sig] = {"signature": sig, "count": 0, "level": line.get("level"),
                               "event": line.get("event"), "first": line.get("time"),
                               "last": line.get("time"), "jobs": [], "runs": 0, "sample": line,
                               "_runs": set()}
        g["count"] += 1
        g["first"] = line.get("time")
        if line.get("level") == "ERROR":
            g["level"] = "ERROR"
        elif g["level"] not in ("ERROR", "WARNING"):
            g["level"] = "WARNING"
        if line.get("job_id") and line["job_id"] not in g["jobs"]:
            g["jobs"].append(line["job_id"])
        if line.get("run_id"):
            g["_runs"].add(line["run_id"])
    out = []
    for g in groups.values():
        g["runs"] = len(g.pop("_runs"))
        out.append(g)
    out.sort(key=lambda g: (0 if g["level"] == "ERROR" else 1, -g["count"]))
    if len(rows) >= PROBLEM_LINES:
        notes.append(NOTE_PROBLEMS_LIMIT)
    job_ids = set()
    for g in out:
        job_ids.update(g["jobs"])
    res = {"problems": out, "notes": notes, "names": names(ctx, job_ids)}
    res.update(_spl(spl, filters))
    return 200, res
