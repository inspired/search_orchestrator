#!/usr/bin/env python3
"""``| orchestrate``: a generating search command (commands.conf, chunked).

    | orchestrate start job=<id> [param.<name>=<value>]... [scheduled_time=<epoch>]
    | orchestrate status [run=<run id>] [job=<id>] [limit=<n, at most 20>]
    | orchestrate cancel run=<run id>
    | orchestrate rerun run=<run id> step=<step> [definition=latest|original]
                        [restart_downstream_jobs=true|false]
    | orchestrate jobs
    | orchestrate selftest [scenario=basic|rollup_late|rollup_fail|probe]
                           [slow_n=<number>] [delayed_after=<seconds>] [scheduled_time=<epoch>]

Every action calls the app's REST endpoint (``/services/orchestrator/...``)
over loopback with the caller's own session, so ``api.py`` does all checks
and work exactly as for the screens. A search command has no system session,
and KV Store needs one. Nothing here writes files or starts processes.

``status`` returns a row per step with ``STATUS_FIELDS``, after one row for
the run itself (``step = "(run)"``, the run's state and times).
"""
import os
import sys

_BIN = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_BIN, "..", "lib"))
sys.path.insert(0, _BIN)

from splunklib.searchcommands import Configuration, GeneratingCommand, dispatch  # noqa: E402

from so import model, selftest  # noqa: E402
from so.gateway import SplunkGateway  # noqa: E402

ACTIONS = ("start", "status", "cancel", "rerun", "jobs", "selftest")
STATUS_FIELDS = ["run_id", "job", "step", "state", "skip_kind", "delayed", "attempts", "sid",
                 "result_count", "error", "scheduled_time", "started_at", "ended_at"]
OPTIONS = {"start": ("job", "scheduled_time"), "status": ("run", "job", "limit"),
           "cancel": ("run",), "rerun": ("run", "step", "definition", "restart_downstream_jobs"),
           "jobs": (), "selftest": ("scenario", "slow_n", "delayed_after", "scheduled_time")}
REQUIRED = {"start": ("job",), "cancel": ("run",), "rerun": ("run", "step")}
STATUS_LIMIT = 5
STATUS_MAX_RUNS = 20  # each run is one more loopback call
RUN_ROW = "(run)"
_TRUE = ("1", "true", "t", "yes", "y")
_FALSE = ("0", "false", "f", "no", "n")


class CommandError(Exception):
    """Shown to the user as the search's error message."""


def _unquote(value):
    if len(value) >= 2 and value[0] == value[-1] == '"':
        return value[1:-1].replace('\\"', '"')
    return value


def parse_args(argv):
    """``(action, options, params)`` from the command's arguments."""
    if not argv or argv[0] not in ACTIONS:
        raise CommandError("orchestrate: the first argument must be one of %s"
                           % ", ".join(ACTIONS))
    action, options, params = argv[0], {}, {}
    for arg in argv[1:]:
        name, sep, value = arg.partition("=")
        if not sep or not name:
            raise CommandError("orchestrate: expected name=value, got %r" % arg)
        value = _unquote(value)
        if action == "start" and name.startswith("param.") and len(name) > len("param."):
            params[name[len("param."):]] = value
        elif name in OPTIONS[action]:
            options[name] = value
        else:
            raise CommandError("orchestrate %s: unknown argument %r" % (action, name))
    missing = [n for n in REQUIRED.get(action, ()) if not options.get(n)]
    if missing:
        raise CommandError("orchestrate %s: %s is required" % (action, ", ".join(missing)))
    return action, options, params


def _check(status, payload, ok=(200, 201, 202)):
    if status in ok:
        return payload
    err = (payload or {}).get("error") or {}
    message = "orchestrate: %s (%s)" % (err.get("message") or "HTTP %s" % status,
                                       err.get("code") or status)
    issues = [i.get("message") for i in err.get("issues") or [] if i.get("message")]
    if issues:
        message += ": " + "; ".join(issues[:3])
    choices = [c.get("definition") for c in err.get("choices") or [] if c.get("available")]
    if choices:
        message += "; add definition=%s" % " or definition=".join(choices)
    raise CommandError(message)


def _bool(value, name):
    text = str(value).strip().lower()
    if text in _TRUE:
        return True
    if text in _FALSE:
        return False
    raise CommandError("orchestrate: %s must be true or false" % name)


def _flag(value):
    return 1 if value else 0


def _order(run):
    definition = run.get("definition") or {}
    try:
        order = model.topo_order(definition)
    except ValueError:
        order = []
    steps = run.get("steps") or {}
    return order + [s for s in steps if s not in order]


def status_rows(run):
    """One row for the run, then one per step in topological order."""
    run_id = run.get("id") or run.get("_key")
    base = {"run_id": run_id, "job": run.get("job_id"),
            "scheduled_time": run.get("scheduled_time")}
    rows = [dict(base, step=RUN_ROW, state=run.get("state"), skip_kind=None,
                 delayed=_flag(run.get("delay_alerted")), attempts=None, sid=None,
                 result_count=None, error=None, started_at=run.get("started_at"),
                 ended_at=run.get("ended_at"))]
    steps = run.get("steps") or {}
    for step_id in _order(run):
        st = steps.get(step_id) or {}
        rows.append(dict(base, step=step_id, state=st.get("state"),
                         skip_kind=st.get("skip_kind"), delayed=_flag(st.get("delay_alerted")),
                         attempts=st.get("attempt") or 0, sid=st.get("sid"),
                         result_count=st.get("result_count"), error=st.get("error"),
                         started_at=st.get("started_at"), ended_at=st.get("ended_at")))
    return [{f: row.get(f) for f in STATUS_FIELDS} for row in rows]


def _run_path(run_id):
    return "runs/" + run_id  # splunklib percent-encodes the path once


def _status(call, options):
    if options.get("run"):
        return status_rows(_check(*call("GET", _run_path(options["run"]), None))["run"])
    try:
        limit = int(options.get("limit") or STATUS_LIMIT)
    except ValueError:
        raise CommandError("orchestrate status: limit must be a number")
    query = {"limit": max(1, min(STATUS_MAX_RUNS, limit))}
    if options.get("job"):
        query["job_id"] = options["job"]
    rows = []
    for summary in _check(*call("GET", "runs", query))["runs"]:
        run = _check(*call("GET", _run_path(summary["id"]), None))["run"]
        rows.extend(status_rows(run))
    return rows


def _selftest(call, options):
    scenario = options.get("scenario") or "basic"
    body = {k: options[k] for k in ("slow_n", "delayed_after", "scheduled_time") if k in options}
    body["scenario"] = scenario
    if scenario == "probe":
        first = selftest.me_check(call)
        out = _check(*call("POST", "selftest", body))
        return [first] + out["checks"]
    out = _check(*call("POST", "selftest", body))
    return [{"ok": 1, "scenario": out["scenario"], "job_id": out["job_id"],
             "run_id": out["run_id"], "scheduled_time": out.get("scheduled_time"),
             "message": "poll with | orchestrate status run=\"%s\"" % out["run_id"]}]


def execute(argv, gateway):
    """Rows for one invocation. ``gateway.orchestrator_api(method, path, body)`` is the
    caller-session REST call. Raises CommandError for anything the user should see."""
    action, options, params = parse_args(argv)

    def call(method, path, body):
        return gateway.orchestrator_api(method, path, body)

    if action == "start":
        body = {"params": params}
        if options.get("scheduled_time"):
            body["scheduled_time"] = options["scheduled_time"]
        out = _check(*call("POST", "jobs/%s/runs" % options["job"], body))
        return [{"ok": 1, "job": options["job"], "run_id": out["run_id"]}]
    if action == "status":
        return _status(call, options)
    if action == "cancel":
        out = _check(*call("POST", _run_path(options["run"]) + "/cancel", {}))
        return [{"ok": 1, "run_id": options["run"], "command_id": out.get("command_id"),
                 "message": "cancel requested; the engine applies it on its next tick"}]
    if action == "rerun":
        body = {"step": options["step"]}
        if options.get("definition"):
            body["definition"] = options["definition"]
        if "restart_downstream_jobs" in options:
            body["restart_downstream_jobs"] = _bool(options["restart_downstream_jobs"],
                                                    "restart_downstream_jobs")
        out = _check(*call("POST", _run_path(options["run"]) + "/rerun", body))
        return [{"ok": 1, "run_id": options["run"], "step": options["step"],
                 "definition": out.get("definition"), "command_id": out.get("command_id"),
                 "message": "re-run requested; the engine applies it on its next tick"}]
    if action == "jobs":
        jobs = _check(*call("GET", "jobs", None))["jobs"]
        return [{"job": j.get("id"), "name": j.get("name"), "enabled": _flag(j.get("enabled"))}
                for j in jobs if (j.get("permissions") or {}).get("can_run")]
    return _selftest(call, options)


def _literal(text):
    """splunklib's write_error runs str.format on its text; a JSON error body has braces."""
    return text.replace("{", "{{").replace("}", "}}")


@Configuration(type="reporting")
class OrchestrateCommand(GeneratingCommand):
    """Start, inspect and control Search Orchestrator runs."""

    def _protocol_v2_option_parser(self, arg):
        return [arg]  # every argument is parsed by parse_args, including param.<name>=...

    def generate(self):
        info = self.metadata.searchinfo
        try:
            gateway = SplunkGateway.from_session(info.splunkd_uri, info.session_key)
            rows = execute(list(self.fieldnames or []), gateway)
        except CommandError as err:
            self.write_error(_literal(str(err)))
            return
        except Exception as err:  # no traceback, and never a session key
            self.write_error(_literal(selftest.scrub("orchestrate failed: %s: %s" % (
                type(err).__name__, err), [getattr(info, "session_key", None)])))
            return
        for row in rows:
            yield row


if __name__ == "__main__":
    dispatch(OrchestrateCommand, sys.argv, sys.stdin, sys.stdout, __name__)
