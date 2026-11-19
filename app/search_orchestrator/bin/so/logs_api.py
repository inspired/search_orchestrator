"""Logs route, dispatched from ``api.handle``: ``GET logs`` searches the app's own log lines
(``so.logs``) in ``_internal``, as the caller, for the Troubleshooting page.

Filters (all optional): ``run_id``, ``job_id``, ``step_id``, ``process`` (engine or rest),
``level`` (the lowest level to show: ERROR, WARNING, INFO or DEBUG), ``text`` (a phrase),
``range`` (15m, 1h, 24h or 7d; default 24h) and ``limit`` (1 to 1000; default 200). Ids
must be plain names; the phrase is quoted, so none of them can change the search.

The reply has ``lines`` (newest first), the runnable ``spl`` with its time range to open in
Search, and ``notes``. Splunk answers a search of an index the caller may not read with no
rows, not an error, so no lines comes with a note about access and the log level.
"""
import re

from .api import ApiError
from .gateway import APP, GatewayError, oneshot_search
from .logs import LEVELS

ID_RE = re.compile(r"^[A-Za-z0-9_.:@-]{1,200}$")
PROCESSES = ("engine", "rest")
RANGES = {"15m": "-15m", "1h": "-1h", "24h": "-24h", "7d": "-7d"}
DEFAULT_RANGE = "24h"
DEFAULT_LIMIT = 200
MAX_LIMIT = 1000
MAX_TEXT = 300
SEARCH_SECONDS = 20  # within the page's 30-second request timeout
FIELDS = ("_time", "level", "process", "logger", "event", "run_id", "job_id", "step_id", "_raw")
NOTE_EMPTY = ("No log lines match. Reading them needs read access to the _internal index "
              "(ask an admin if you expected some), and lines below the log level in Settings "
              "are not written.")
NOTE_DENIED = "Reading the logs needs read access to the _internal index; ask an admin."
NOTE_LIMIT = "Only the newest %d lines are shown; narrow the filters to see others."


def source():
    """The log files of this app (``<app>.<process>.log``), not a side-by-side copy's."""
    return 'source="*%s.*.log"' % APP


def _bad(message):
    return ApiError(400, "bad_request", message)


def _quoted(text):
    return '"%s"' % text.replace("\\", "\\\\").replace('"', '\\"')


def logs_query(filters):
    """The SPL for ``filters`` (already checked by ``_filters``)."""
    terms = ["index=_internal", source()]
    if filters.get("process"):
        terms.append("process=%s" % filters["process"])
    level = filters.get("level")
    if level and level != "DEBUG":
        shown = LEVELS[:LEVELS.index(level) + 1]
        terms.append("level IN (%s)" % ", ".join(shown))
    for key in ("run_id", "job_id", "step_id"):
        if filters.get(key):
            terms.append("%s=%s" % (key, _quoted(filters[key])))
    if filters.get("text"):
        terms.append(_quoted(filters["text"]))
    return "%s | head %d | fields %s" % (" ".join(terms), filters["limit"], " ".join(FIELDS))


def _filters(body):
    out = {}
    for key in ("run_id", "job_id", "step_id"):
        value = body.get(key)
        if value not in (None, ""):
            if not isinstance(value, str) or not ID_RE.fullmatch(value):
                raise _bad("%s must be a plain id" % key)
            out[key] = value
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
    try:
        out["limit"] = max(1, min(MAX_LIMIT, int(body.get("limit") or DEFAULT_LIMIT)))
    except (TypeError, ValueError):
        raise _bad("limit must be a number")
    return out


def _line(row):
    return {k.lstrip("_") if k != "_time" else "time": row.get(k) for k in FIELDS}


def search_logs(ctx, body):
    filters = _filters(body)
    spl = logs_query(filters)
    earliest = RANGES[filters["range"]]
    notes = []
    try:
        rows = ctx.user_gw.search_oneshot(ctx.user, spl, earliest, "now", count=filters["limit"],
                                          max_time=SEARCH_SECONDS)
    except GatewayError as err:
        if err.status not in (401, 403):
            raise ApiError(502, "search_failed", "Splunk could not search the logs (%s); "
                                                 "try again." % (str(err).strip()[:200] or "error"))
        rows = []
        notes.append(NOTE_DENIED)
    lines = [_line(r) for r in rows or []]
    if not lines and not notes:
        notes.append(NOTE_EMPTY)
    if len(lines) >= filters["limit"]:
        notes.append(NOTE_LIMIT % filters["limit"])
    return 200, {"lines": lines, "notes": notes, "spl": oneshot_search(spl),
                 "earliest": earliest, "latest": "now"}
