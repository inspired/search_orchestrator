#!/usr/bin/env python3
""""Start orchestrator job" custom alert action (alert_actions.conf).

splunkd runs ``start_orchestrator_job.py --execute`` with the alert's JSON
payload on stdin. The run is started through the app's REST endpoint
(``POST /services/orchestrator/jobs/<job>/runs``) over loopback with the
alert's own session key, so ``api.py`` checks that the alert's owner may run
the job, exactly as for the screens. It refuses to act when the alert is
owned by ``nobody`` (such an alert runs with the system user's session) or
when the session's user, as ``/orchestrator/me`` reports it, is not the
alert's owner. Parameters:

* ``job``: the job id.
* ``params``: ``name=value`` pairs, one per line or comma-separated, or a JSON
  object. Alert tokens such as ``$result.host$`` are filled in by Splunk.
* ``scheduled_time``: optional epoch seconds (for example ``$trigger_time$``);
  empty means the time of the request.

Exit status 0 on success, 2 on failure, with the reason on stderr (splunkd
logs it). Nothing here writes files or starts processes.
"""
import json
import os
import re
import sys

_BIN = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_BIN, "..", "lib"))
sys.path.insert(0, _BIN)

from so.gateway import SplunkGateway  # noqa: E402
from so.selftest import scrub  # noqa: E402

JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def parse_params(text):
    """``{name: value}`` from a JSON object or ``name=value`` pairs."""
    text = (text or "").strip()
    if not text:
        return {}
    if text.startswith("{"):
        try:
            value = json.loads(text)
        except ValueError:
            raise ValueError("params is not valid JSON")
        if not isinstance(value, dict):
            raise ValueError("params must be a JSON object")
        return {str(k): v if isinstance(v, str) else json.dumps(v) if isinstance(v, (dict, list))
                else str(v) for k, v in value.items()}
    out = {}
    for part in re.split(r"[\n,]", text):
        part = part.strip()
        if not part:
            continue
        name, sep, value = part.partition("=")
        if not sep or not name.strip():
            raise ValueError("expected name=value in params, got %r" % part)
        out[name.strip()] = value.strip()
    return out


def run_alert(payload, build=SplunkGateway.from_session):
    """``(ok, message)`` for one alert firing."""
    secrets = [payload.get("session_key")]
    try:
        config = payload.get("configuration") or {}
        job = (config.get("job") or "").strip()
        if not JOB_ID_RE.fullmatch(job):
            return False, "start_orchestrator_job: no valid job id configured (%r)" % job
        body = {"params": parse_params(config.get("params"))}
        if str(config.get("scheduled_time") or "").strip():
            body["scheduled_time"] = str(config["scheduled_time"]).strip()
        owner = str(payload.get("owner") or "").strip()
        if not owner or owner == "nobody":
            return False, ("start_orchestrator_job: alert %r is owned by %r; refusing to start "
                           "job %s. An alert owned by nobody runs with the system user's "
                           "session. Assign the alert to a real user who may run the job."
                           % (payload.get("search_name"), owner or "(none)", job))
        gateway = build(payload.get("server_uri") or "https://127.0.0.1:8089",
                        payload.get("session_key"))
        me_status, me_out = gateway.orchestrator_api("GET", "me", None)
        if me_status != 200:
            return False, ("start_orchestrator_job: could not verify alert session (HTTP %s) for "
                           "alert %r; refusing to start job %s"
                           % (me_status, payload.get("search_name"), job))
        session_user = (me_out or {}).get("user")
        if session_user != owner:
            return False, ("start_orchestrator_job: the alert %r session belongs to %r, not to "
                           "the alert owner %r; refusing to start job %s"
                           % (payload.get("search_name"), session_user, owner, job))
        status, out = gateway.orchestrator_api("POST", "jobs/%s/runs" % job, body)
    except Exception as err:
        return False, scrub("start_orchestrator_job: %s: %s" % (type(err).__name__, err), secrets)
    if status == 201:
        return True, "start_orchestrator_job: job %s run %s requested by alert %r" % (
            job, out.get("run_id"), payload.get("search_name"))
    err = (out or {}).get("error") or {}
    return False, scrub("start_orchestrator_job: job %s was not started: %s (%s)" % (
        job, err.get("message") or "HTTP %s" % status, err.get("code") or status), secrets)


def main(argv, stdin, stderr, build=SplunkGateway.from_session):
    if len(argv) < 2 or argv[1] != "--execute":
        stderr.write("start_orchestrator_job: unsupported execution mode (expected --execute)\n")
        return 2
    try:
        payload = json.loads(stdin.read())
    except ValueError:
        stderr.write("start_orchestrator_job: the alert payload is not valid JSON\n")
        return 2
    ok, message = run_alert(payload, build)
    stderr.write(("INFO " if ok else "ERROR ") + message + "\n")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv, sys.stdin, sys.stderr))
