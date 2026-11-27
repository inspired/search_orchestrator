"""Run health routes, dispatched from ``api.handle``, for the Run health page. Every number
comes from searches of the app's audit events (``_audit``, sourcetype
``orchestrator:audit``), ``_internal`` and ``_introspection``, run as the viewer, so Splunk's
own index access decides what they see (by default only admins may search ``_audit``).

``GET runhealth/<section>``, with ``job_id`` (one job, or every job) and ``range`` (24h, 7d or
30d; default 24h):

* ``runs``: one search of the runs with activity in the range, summed up here: the tiles
  (``kpi``), runs over time by state (``over_time``) and the runs that need attention.
* ``steps``: the steps that fail most and the slowest steps.
* ``actions``: actions sent and failed per type, and the latest failures.
* ``late``: runs that missed their deadline.
* ``engine``: when the engine was last seen, errors and warnings of the app's scripts in
  splunkd.log, and Python tracebacks.
* ``performance``: runtime and events scanned per job over time, the slowest steps by
  runtime, and peak CPU and memory per job.

Each answer has ``searches`` (the SPL behind each part, for Open in search), ``notes`` and
``names`` (job and step names for the jobs the viewer may see).
"""
import re
import statistics

from . import authz
from .api import ApiError
from .gateway import GatewayError, oneshot_search
from .logs_api import names

# The app's macros (macros.conf); a side-by-side copy renames them.
INDEX = "`orchestrator_index`"
INTERNAL = "`orchestrator_internal`"
ENGINE_PROCESS = "`orchestrator_engine_process`"
SEARCH_PROCESS = "`orchestrator_search_process`"

ID_RE = re.compile(r"^[A-Za-z0-9_.:@-]{1,200}$")
RANGES = {"24h": "-24h", "7d": "-7d", "30d": "-30d"}
SPANS = {"24h": 3600, "7d": 6 * 3600, "30d": 86400}
SPAN_SPL = {"24h": "1h", "7d": "6h", "30d": "1d"}
DEFAULT_RANGE = "24h"
SEARCH_SECONDS = 25  # in all, per request: within the page's 30-second request timeout
MAX_RUNS = 10000
ATTENTION = 50

NOTE_EMPTY = ("No audit events in this time range. Reading them needs search access to the "
              "_audit index, which by default only admins have; ask an admin if you expected "
              "some.")
NOTE_DENIED = ("Splunk refused a search: reading these numbers needs search access to the "
               "_audit, _internal and _introspection indexes; ask an admin.")
NOTE_RUNS_LIMIT = "Only the newest %d runs are counted; narrow the time range or pick a job." % MAX_RUNS

ACTION_NAME = ('eval action=case(action_type="fallback", "Fallback notification", '
               'action_type="webhook", "Webhook (removed)", action_type="email", "Email", '
               'action_type="event", "Event", action_type="alert_action", "Alert action", '
               'action_type="start_job", "Start job", true(), coalesce(action_type, "other"))')

SCRIPT_LINES = (
    '| eval script=case(component="ExecProcessor", "engine", component="PersistentScript", '
    '"REST handler", component="sendmodalert", "alert action", component="ChunkedExternProcessor", '
    '"search command", true(), component)'
    ' | rex field=_raw "(?:message from \\"[^\\"]+\\"|From \\{[^}]*\\}:|STDERR -|'
    'ChunkedExternProcessor \\[[^\\]]*\\] -)\\s*(?<message>.*)$"'
    ' | eval message=coalesce(message, _raw)'
    ' | rex field=message "^(?:orchestrator_rest\\w*:\\s*)?(?<script_level>DEBUG|INFO|WARN|WARNING|'
    'ERROR|CRITICAL|FATAL)\\b"'
    ' | eval level=upper(coalesce(script_level, log_level)), level=case(in(level, "WARN", '
    '"WARNING"), "warning", in(level, "ERROR", "CRITICAL", "FATAL"), "error", true(), lower(level))')


def _bad(message):
    return ApiError(400, "bad_request", message)


def _filters(body):
    job = body.get("job_id")
    if job in (None, "", "*"):
        job = None
    elif not isinstance(job, str) or not ID_RE.fullmatch(job):
        raise _bad("job_id must be a plain job id")
    span = body.get("range") or DEFAULT_RANGE
    if span not in RANGES:
        raise _bad("range must be one of %s" % ", ".join(RANGES))
    return {"job_id": job, "range": span}


def _job(filters):
    job = filters["job_id"]
    return 'job_id="%s"' % job if job else "job_id=*"


# -- the searches ----------------------------------------------------------------

def runs_query(f):
    return (
        INDEX + " %s type IN (\"run_created\", \"run_state\", \"run_held\", \"run_dismissed\", "
        "\"step_attempt\")"
        " | eval state_to=if(type=\"run_state\", 'to', null()), started=if(type=\"run_state\" AND "
        "'to'=\"running\", _time, null()), ended=if(type=\"run_state\" AND in('to', \"succeeded\", "
        "\"failed\", \"cancelled\"), _time, null()), held_at=if(type=\"run_held\", _time, null()), "
        "dismissed_at=if(type=\"run_dismissed\", _time, null()), gave_up_at=if(type=\"run_state\" "
        "AND gave_up=\"true\", _time, null()), fail_error=if(type=\"step_attempt\" AND "
        "outcome=\"failed\", step_id . \": \" . error, null())"
        " | stats latest(state_to) as state, max(started) as started, max(ended) as ended, "
        "max(held_at) as held_at, max(dismissed_at) as dismissed_at, max(gave_up_at) as gave_up_at, "
        "latest(fail_error) as reason, min(_time) as first_seen, max(_time) as last_seen "
        "by run_id, job_id"
        " | eval state=case(state=\"failed\" AND isnotnull(held_at) AND (isnull(dismissed_at) OR "
        "held_at>dismissed_at), \"held\", in(state, \"succeeded\", \"failed\", \"blocked\", "
        "\"cancelled\"), state, true(), \"in progress\")"
        " | eval duration=if(isnotnull(ended) AND isnotnull(started) AND ended>=started AND "
        "in(state, \"succeeded\", \"failed\", \"held\", \"cancelled\"), ended-started, null())"
        " | eval reason=case(isnotnull(reason), substr(reason, 1, 300), isnotnull(gave_up_at), "
        "\"gave up before every step finished\", true(), \"\")"
        " | sort - last_seen"
        " | fields run_id, job_id, state, duration, reason, first_seen, last_seen" % _job(f))


def step_failures_query(f):
    return (
        INDEX + ' %s type="step_attempt"'
        ' | eval fail_error=if(outcome="failed", error, null()), failed_at=if(outcome="failed", '
        '_time, null())'
        ' | stats count as attempts, count(eval(outcome="failed")) as failures, '
        'latest(fail_error) as latest_error, max(failed_at) as failed_at by job_id, step_id'
        ' | where failures>0'
        ' | eval failure_pct=round(100*failures/attempts, 1), latest_error=substr(latest_error, 1, 300)'
        ' | sort - failures, - failed_at | head 20'
        ' | table job_id, step_id, failures, attempts, failure_pct, failed_at, latest_error' % _job(f))


def slow_steps_query(f):
    return (
        INDEX + ' %s type IN ("step_dispatched", "step_attempt", "step_delayed", "action_submitted")'
        ' | where type!="action_submitted" OR (hook="on_delayed" AND isnotnull(step_id))'
        ' | eval dispatched=if(type="step_dispatched", _time, null()), finished=if(type="step_attempt" '
        'AND isnotnull(sid), _time, null()), delayed=if(in(type, "step_delayed", "action_submitted"), '
        '1, 0), attempt=coalesce(attempt, "-")'
        ' | stats min(dispatched) as dispatched, max(finished) as finished, max(delayed) as delayed '
        'by job_id, step_id, run_id, attempt'
        ' | eval duration=if(isnotnull(dispatched) AND isnotnull(finished) AND finished>=dispatched, '
        'finished-dispatched, null()), ran=if(isnotnull(dispatched), run_id, null()), '
        'delayed_run=if(delayed=1, run_id, null())'
        ' | stats count(duration) as attempts, median(duration) as median_s, perc95(duration) as p95_s, '
        'dc(ran) as runs, dc(delayed_run) as delayed_runs by job_id, step_id'
        ' | where attempts>0 OR delayed_runs>0'
        ' | eval delayed_pct=if(runs>0, round(100*delayed_runs/runs, 0), null()), '
        'median_s=round(median_s), p95_s=round(p95_s)'
        ' | sort - p95_s | head 20'
        ' | table job_id, step_id, attempts, median_s, p95_s, delayed_runs, delayed_pct' % _job(f))


def actions_by_type_query(f):
    return (
        # ACTION_NAME has a "%" of its own: no % formatting here.
        INDEX + " " + _job(f) + ' type IN ("action_done", "action_failed") | ' + ACTION_NAME +
        ' | eval outcome=if(type="action_done", "sent", "failed")'
        ' | chart count over action by outcome | fillnull value=0 sent failed'
        ' | sort - failed, - sent | fields action, sent, failed')


def action_failures_query(f):
    return (
        INDEX + " " + _job(f) + ' type="action_failed" | ' + ACTION_NAME +
        ' | sort - _time | head 50 | eval error=substr(error, 1, 300), at=_time'
        ' | table at, job_id, run_id, action, hook, step_id, attempts, error')


def late_query(f):
    return (
        INDEX + ' %s (type=run_late OR type=run_created OR type=run_state)'
        ' | eval scheduled=if(type="run_created", scheduled_time, null()), deadline=if(type="run_late", '
        'deadline_at, null()), late_time=if(type="run_late", _time, null()), '
        "state_to=if(type=\"run_state\", 'to', null()), ended=if(type=\"run_state\" AND "
        "in('to', \"succeeded\", \"failed\", \"cancelled\"), _time, null())"
        ' | stats max(scheduled) as scheduled, max(deadline) as deadline, min(late_time) as late_time, '
        'max(ended) as ended, latest(state_to) as state by run_id, job_id'
        ' | where isnotnull(deadline)'
        ' | eval state=if(in(state, "succeeded", "failed", "blocked", "cancelled"), state, "in progress"), '
        'late_by=round(coalesce(ended, late_time) - deadline)'
        ' | sort - scheduled | head 200'
        ' | table scheduled, job_id, run_id, deadline, late_by, state') % _job(f)


def engine_last_query(f):
    return ("search (" + ENGINE_PROCESS + ") OR (" + INTERNAL + " component=ExecProcessor) OR ("
            + INDEX + ' source="orchestrator_engine*")'
            ' | stats max(_time) as last'
            ' | eval minutes=if(isnull(last), null(), round((now()-last)/60, 1))'
            ' | fields last, minutes')


def engine_errors_query(f):
    return (INTERNAL + " " + SCRIPT_LINES +
            ' | where in(level, "error", "warning")'
            ' | stats count, latest(message) as latest_message, max(_time) as last_seen by script, level'
            ' | eval latest_message=substr(latest_message, 1, 300) | sort - count'
            ' | table script, level, count, last_seen, latest_message')


def tracebacks_query(f):
    return (INTERNAL + " " + SCRIPT_LINES +
            ' | rex field=message "^(?:orchestrator_rest\\w*:\\s*)?(?:(?:ERROR|CRITICAL)\\s+)?'
            '(?<exception>[A-Za-z_][\\w.]*(?:Error|Exception|Exit|Interrupt))(?::\\s*(?<detail>.*))?$"'
            ' | eval is_traceback=if(like(message, "%Traceback (most recent call last)%"), 1, 0)'
            ' | where is_traceback=1 OR isnotnull(exception)'
            ' | stats sum(is_traceback) as tracebacks, count(exception) as exceptions, '
            'latest(exception) as exception, latest(detail) as detail, max(_time) as last_seen by script'
            ' | eval detail=substr(detail, 1, 300) | sort - tracebacks'
            ' | table script, tracebacks, exceptions, exception, detail, last_seen')


def runtime_query(f):
    return (INDEX + ' %s type="step_attempt" isnotnull(run_duration)'
            ' | timechart span=%s limit=10 median(run_duration) by job_id') % (_job(f), SPAN_SPL[f["range"]])


def scanned_query(f):
    return (INDEX + ' %s type="step_attempt" isnotnull(scan_count)'
            ' | timechart span=%s limit=10 sum(scan_count) by job_id') % (_job(f), SPAN_SPL[f["range"]])


def perf_slowest_query(f):
    return (INDEX + ' %s type="step_attempt" isnotnull(run_duration)'
            ' | stats median(run_duration) as median_s, count as attempts, dc(run_id) as runs '
            'by job_id, step_id'
            ' | sort - median_s | head 10 | eval median_s=round(median_s, 1)'
            ' | table job_id, step_id, median_s, attempts, runs') % _job(f)


def peaks_query(f):
    return (INDEX + ' %s type="step_attempt" isnotnull(sid) | fields job_id, sid'
            ' | append [search ' + SEARCH_PROCESS +
            ' | stats max(data.pct_cpu) as cpu_peak, max(data.mem_used) as mem_peak_mb '
            'by data.search_props.sid | rename data.search_props.sid as sid]'
            ' | stats values(job_id) as job_id, max(cpu_peak) as cpu_peak, max(mem_peak_mb) as '
            'mem_peak_mb by sid'
            ' | where isnotnull(job_id) AND isnotnull(cpu_peak)'
            ' | stats dc(sid) as searches, max(cpu_peak) as peak_cpu_pct, max(mem_peak_mb) as '
            'peak_mem_mb by job_id'
            ' | eval peak_cpu_pct=round(peak_cpu_pct, 1), peak_mem_mb=round(peak_mem_mb, 0)'
            ' | sort - peak_cpu_pct | table job_id, searches, peak_cpu_pct, peak_mem_mb') % _job(f)


# -- running them ----------------------------------------------------------------

class _Run:
    """The searches of one request: each runs as the viewer, sharing the time budget."""

    def __init__(self, ctx, filters, count):
        self.ctx = ctx
        self.filters = filters
        self.seconds = max(5, SEARCH_SECONDS // max(1, count))
        self.notes = []
        self.searches = []
        self.found = False

    def rows(self, key, title, spl, count=1000):
        earliest = RANGES[self.filters["range"]]
        self.searches.append({"key": key, "title": title, "spl": oneshot_search(spl),
                              "earliest": earliest, "latest": "now"})
        try:
            out = self.ctx.user_gw.search_oneshot(self.ctx.user, spl, earliest, "now",
                                                  count=count, max_time=self.seconds) or []
        except GatewayError as err:
            if err.status not in (401, 403):
                raise ApiError(502, "search_failed", "Splunk could not run the %s search (%s); "
                               "try again." % (title, str(err).strip()[:200] or "error"))
            if NOTE_DENIED not in self.notes:
                self.notes.append(NOTE_DENIED)
            return []
        self.found = self.found or bool(out)
        return out

    def answer(self, job_ids=(), **parts):
        if not self.found and not self.notes:
            self.notes.append(NOTE_EMPTY)
        out = dict(parts, searches=self.searches, notes=self.notes,
                   names=names(self.ctx, set(j for j in job_ids if j)))
        if self.searches:
            out.update(spl=self.searches[0]["spl"], earliest=self.searches[0]["earliest"])
        return 200, out


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _ids(*tables):
    return {r.get("job_id") for t in tables for r in t}


def _kpi(rows):
    states = [r.get("state") for r in rows]
    finished = sum(1 for s in states if s in ("succeeded", "failed", "held"))
    succeeded = states.count("succeeded")
    durations = [d for d in (_num(r.get("duration")) for r in rows) if d is not None]
    return {"runs": len(rows), "succeeded": succeeded, "failed": states.count("failed"),
            "held_blocked": sum(1 for s in states if s in ("held", "blocked")),
            "success_rate": round(100.0 * succeeded / finished, 1) if finished else None,
            "median_duration": int(round(statistics.median(durations))) if durations else None}


def _over_time(rows, span):
    buckets = {}
    for r in rows:
        t = _num(r.get("first_seen"))
        if t is None:
            continue
        start = int(t // span * span)
        counts = buckets.setdefault(start, {})
        state = r.get("state") or "in progress"
        counts[state] = counts.get(state, 0) + 1
    return {"span": span, "buckets": [{"t": t, "counts": buckets[t]} for t in sorted(buckets)]}


def runs(ctx, f):
    run = _Run(ctx, f, 1)
    rows = run.rows("runs", "runs", runs_query(f), count=MAX_RUNS)
    if len(rows) >= MAX_RUNS:
        run.notes.append(NOTE_RUNS_LIMIT)
    attention = sorted((r for r in rows if r.get("state") in ("failed", "held", "blocked")),
                       key=lambda r: -(_num(r.get("last_seen")) or 0))[:ATTENTION]
    return run.answer(_ids(rows), kpi=_kpi(rows), over_time=_over_time(rows, SPANS[f["range"]]),
                      attention=attention)


def steps(ctx, f):
    run = _Run(ctx, f, 2)
    failing = run.rows("failing", "steps that fail most", step_failures_query(f))
    slowest = run.rows("slowest", "slowest steps", slow_steps_query(f))
    return run.answer(_ids(failing, slowest), failing=failing, slowest=slowest)


def actions(ctx, f):
    run = _Run(ctx, f, 2)
    by_type = run.rows("by_type", "actions per type", actions_by_type_query(f))
    failures = run.rows("failures", "latest action failures", action_failures_query(f))
    return run.answer(_ids(failures), by_type=by_type, failures=failures)


def late(ctx, f):
    run = _Run(ctx, f, 1)
    rows = run.rows("late", "late runs", late_query(f))
    return run.answer(_ids(rows), late=rows, count=len(rows))


def engine(ctx, f):
    run = _Run(ctx, f, 3)
    last = run.rows("last", "last engine activity", engine_last_query(f), count=1)
    errors = run.rows("errors", "errors and warnings", engine_errors_query(f))
    tracebacks = run.rows("tracebacks", "Python tracebacks", tracebacks_query(f))
    return run.answer(last=last[0] if last else {}, errors=errors, tracebacks=tracebacks)


def performance(ctx, f):
    run = _Run(ctx, f, 4)
    runtime = run.rows("runtime", "runtime per job", runtime_query(f))
    scanned = run.rows("scanned", "events scanned per job", scanned_query(f))
    slowest = run.rows("slowest", "slowest steps by runtime", perf_slowest_query(f))
    peaks = run.rows("peaks", "peak CPU and memory per job", peaks_query(f))
    return run.answer(_ids(slowest, peaks), runtime=runtime, scanned=scanned, slowest=slowest,
                      peaks=peaks)


SECTIONS = {"runs": runs, "steps": steps, "actions": actions, "late": late, "engine": engine,
            "performance": performance}


def section(ctx, body, name):
    if not any(c in authz.CAPABILITIES for c in ctx.access["capabilities"]):
        raise ctx.deny("read_run_health")
    handler = SECTIONS.get(name)
    if handler is None:
        raise ApiError(404, "not_found", "unknown Run health section %r" % name)
    return handler(ctx, _filters(body))
