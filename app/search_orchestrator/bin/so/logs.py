"""Troubleshooting logs: one file per process, ``key=value`` lines, level from Settings.

Each process (the engine, the REST handler, the alert action, the search command) writes
``$SPLUNK_HOME/var/log/splunk/<app>.<process>.log``; splunkd indexes that folder into
``_internal`` by itself, so ``index=_internal source="*<app>.*.log"`` finds every line
(the ``orchestrator_logs`` macro, the Troubleshooting page). One file per process, because
rotating one shared file from several processes loses lines.

A line looks like::

    2026-11-19 10:00:00,123 +0000 level=INFO process=engine logger=so.engine event=step_dispatched run_id="daily:1764547200" step_id="a" sid="scheduler__..."

Every audit event is also written here (``audit_line``; at WARNING when it reports a
failure, such as a failed action or step), so each feature that changes state shows up
without its own logging; modules add debug detail with ``event``. Lines
never carry secrets: values of keys that look like secrets are dropped, long values are
cut, and SPL results are never logged.

The level (ERROR, WARNING, INFO or DEBUG, default INFO) is the ``log_level`` setting;
``LevelFromSettings`` reads it at most every 30 seconds, so a change applies without a
restart.
"""
import json
import logging
import logging.handlers
import os
import time

LEVELS = ("ERROR", "WARNING", "INFO", "DEBUG")
DEFAULT_LEVEL = "INFO"
ROOT = "so"
MAX_BYTES = 10 * 1024 * 1024
BACKUPS = 5
MAX_VALUE = 500
SECRET_WORDS = ("password", "token", "secret", "authorization", "api_key", "apikey",
                "session_key", "sessionkey", "cookie", "body", "headers")
# Audit fields that hold user content (job definitions, email text): left out of log lines.
BULKY = ("definition", "params", "message_body", "results", "rows")


def log_dir():
    home = os.environ.get("SPLUNK_HOME")
    return os.path.join(home, "var", "log", "splunk") if home else None


def file_name(app, process):
    return "%s.%s.log" % (app, process)


def _quote(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list, tuple)):
        value = json.dumps(value, sort_keys=True, default=str)
    text = str(value).replace("\r", " ").replace("\n", " ")
    if len(text) > MAX_VALUE:
        text = text[:MAX_VALUE] + "…"
    return '"%s"' % text.replace("\\", "\\\\").replace('"', '\\"')


def secret_key(key):
    k = str(key).lower()
    return any(w in k for w in SECRET_WORDS)


def kv(**fields):
    """``key="value"`` pairs, sorted, without None values or secret-looking keys."""
    return " ".join("%s=%s" % (k, _quote(v)) for k, v in sorted(fields.items())
                    if v is not None and not secret_key(k))


def event(logger, level, name, **fields):
    """One ``event=<name>`` line with ``fields``; ``level`` a logging level number."""
    if logger.isEnabledFor(level):
        rest = kv(**fields)
        logger.log(level, "event=%s%s", name, " " + rest if rest else "")


_audit_log = logging.getLogger(ROOT + ".audit")

# Audit events that report something going wrong: logged at WARNING so the level filter,
# the Errors and Warnings counts and Problems find them (the app handled them, so not ERROR).
FAILURE_EVENTS = frozenset((
    "action_failed", "action_retry", "step_dispatch_error", "condition_failed", "run_rejected",
    "chain_depth_exceeded", "possible_orphan_search", "run_held", "hold_alert", "run_late",
    "step_delayed", "hidden_search_delete_failed", "job_version_failed",
    "destination_secret_delete_failed", "permission_denied", "approval_ignored"))


def audit_level(doc):
    """WARNING for an audit event that reports a failure, else INFO."""
    kind = doc.get("type")
    if kind in FAILURE_EVENTS:
        return logging.WARNING
    if kind in ("run_state", "step_state") and doc.get("to") == "failed":
        return logging.WARNING
    if kind == "step_attempt" and doc.get("outcome") == "failed":
        return logging.WARNING
    if kind == "command" and doc.get("result") == "rejected":
        return logging.WARNING
    return logging.INFO


class NotAudit(logging.Filter):
    """Keeps the audit copies out of splunkd.log: they are already in the audit index."""

    def filter(self, record):
        return record.name != _audit_log.name


def audit_line(doc):
    """Mirror an audit event into the log (never raises)."""
    try:
        doc = dict(doc)
        level = audit_level(doc)
        if not _audit_log.isEnabledFor(level):
            return
        fields = {k: v for k, v in doc.items() if k not in ("type", "_time") and k not in BULKY}
        event(_audit_log, level, str(doc.get("type") or "audit"), **fields)
    except Exception:
        pass


class Formatter(logging.Formatter):
    def __init__(self, process):
        logging.Formatter.__init__(self)
        self.process = process

    def format(self, record):
        stamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record.created))
        zone = time.strftime("%z", time.localtime(record.created))
        line = "%s,%03d %s level=%s process=%s logger=%s %s" % (
            stamp, int(record.msecs), zone, record.levelname, self.process, record.name,
            record.getMessage())
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return line


def setup(app, process, directory=None):
    """Send the ``so`` loggers to ``<directory>/<app>.<process>.log`` (once per process).
    Returns the path, or None when the folder is missing or not writable (logging then
    stays as it was)."""
    root = logging.getLogger(ROOT)
    for h in root.handlers:
        if getattr(h, "_so_file", False):
            return h.baseFilename
    directory = directory or log_dir()
    if not directory or not os.path.isdir(directory):
        return None
    path = os.path.join(directory, file_name(app, process))
    try:
        handler = logging.handlers.RotatingFileHandler(path, maxBytes=MAX_BYTES,
                                                       backupCount=BACKUPS, delay=True)
    except Exception:
        return None
    handler._so_file = True
    handler.setFormatter(Formatter(process))
    root.addHandler(handler)
    if root.level == logging.NOTSET or root.level > logging.INFO:
        root.setLevel(logging.INFO)
    return path


def level_of(value):
    """A valid level name for ``value`` (case-insensitive), else the default."""
    name = str(value or "").upper()
    return name if name in LEVELS else DEFAULT_LEVEL


def set_level(value):
    logging.getLogger(ROOT).setLevel(getattr(logging, level_of(value)))


class LevelFromSettings:
    """Applies the ``log_level`` setting, reading it at most every ``every`` seconds."""

    def __init__(self, every=30, clock=time.time):
        self.every = every
        self.clock = clock
        self.read_at = None

    def apply(self, read_settings):
        now = self.clock()
        if self.read_at is not None and now - self.read_at < self.every:
            return
        self.read_at = now
        try:
            set_level((read_settings() or {}).get("log_level"))
        except Exception:
            pass
