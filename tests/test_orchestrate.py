"""``| orchestrate`` and the "Start orchestrator job" alert action.

Both reach ``api.py`` through the REST endpoint with the caller's own session
(a search command and an alert script have no system session). Here the
loopback call is routed in-process through ``orchestrator_rest.respond``.
"""
import io
import json

import pytest

import orchestrate
import orchestrator_rest
import start_orchestrator_job
from so import gateway as g
from test_api import Session, World, job_body

TOKENS = {"tok-alice": "alice", "tok-carol": "carol", "tok-dave": "dave", "tok-root": "root"}


class Splunkd:
    """Stands in for splunkd: a loopback REST call with a session token reaches the
    persistent handler as the token's user, with a system token alongside."""

    def __init__(self, world):
        self.w = world
        self.sessions = []

    def gateway(self, uri, token):
        self.sessions.append((uri, token))
        return Client(self, token)


class Client:
    def __init__(self, splunkd, token):
        self.splunkd, self.token = splunkd, token

    def orchestrator_api(self, method, path, body=None):
        w = self.splunkd.w
        request = {"session": {"user": TOKENS.get(self.token), "authtoken": self.token},
                   "system_authtoken": "tok-system", "method": method,
                   "rest_path": "/orchestrator/" + path,
                   "server": {"rest_uri": "https://127.0.0.1:8089"}}
        if method in ("GET", "DELETE"):
            request["query"] = [[k, str(v)] for k, v in (body or {}).items()]
        else:
            request["payload"] = json.dumps(body or {})

        def build(uri, token):
            return Session(w.gw, "system" if token == "tok-system" else "user:" + token, w.calls)

        reply = orchestrator_rest.respond(request, build=build, audit_factory=lambda gw: w.audit)
        return reply["status"], json.loads(reply["payload"])


@pytest.fixture
def w():
    world = World()
    world.splunkd = Splunkd(world)
    return world


def run_cmd(w, line, token="tok-alice"):
    return orchestrate.execute(line.split(), w.splunkd.gateway("https://127.0.0.1:8089", token))


def saved(w, body=None):
    status, out = w.call("alice", "POST", "/orchestrator/jobs", body or job_body())
    assert status == 201, out


def test_start_parses_params(w):
    saved(w)
    rows = run_cmd(w, "start job=daily param.p=7 scheduled_time=1700000000")
    assert len(rows) == 1 and rows[0]["ok"] == 1
    run = w.store.get_run(rows[0]["run_id"])
    assert run["params"] == {"p": "7"}
    assert run["scheduled_time"] == 1700000000
    assert run["trigger"] == "manual" and run["owner"] == "alice"
    assert orchestrate.parse_args(['start', 'job=daily', 'param.p="a b"', 'param.q=x=y']) == \
        ("start", {"job": "daily"}, {"p": "a b", "q": "x=y"})
    with pytest.raises(orchestrate.CommandError):
        orchestrate.parse_args(["start", "nonsense"])
    with pytest.raises(orchestrate.CommandError):
        orchestrate.parse_args(["explode"])
    with pytest.raises(orchestrate.CommandError) as err:
        run_cmd(w, "start job=daily param.p=notanumber")
    assert "bad_param" in str(err.value)


def test_command_denied_without_capability(w):
    saved(w, job_body(run_roles=["ops"]))
    with pytest.raises(orchestrate.CommandError) as err:
        run_cmd(w, "start job=daily", token="tok-dave")  # in role ops, no orchestrator_run
    assert "forbidden" in str(err.value) or "not_found" in str(err.value)
    assert not w.gw.kv.get("so_runs")
    rows = run_cmd(w, "start job=daily", token="tok-carol")  # ops with orchestrator_run
    assert rows[0]["ok"] == 1
    run_id = rows[0]["run_id"]
    with pytest.raises(orchestrate.CommandError):
        run_cmd(w, "cancel run=%s" % run_id, token="tok-dave")
    assert run_cmd(w, "cancel run=%s" % run_id, token="tok-carol")[0]["ok"] == 1
    with pytest.raises(orchestrate.CommandError) as err:
        run_cmd(w, "selftest", token="tok-alice")
    assert "forbidden" in str(err.value)
    # Every call went through the caller's own session for its access check.
    assert ("user:tok-dave", "user_access") in w.calls


def test_status_row_shape(w):
    saved(w)
    run_id = run_cmd(w, "start job=daily param.p=3")[0]["run_id"]
    w.engine_tick()
    rows = run_cmd(w, "status run=%s" % run_id)
    assert [r["step"] for r in rows] == ["(run)", "a", "b"]
    for row in rows:
        assert list(row) == orchestrate.STATUS_FIELDS
        assert row["run_id"] == run_id and row["job"] == "daily"
    assert rows[0]["state"] == "running"
    assert rows[1]["state"] in ("starting", "running") and rows[1]["attempts"] == 1
    assert rows[1]["sid"] and rows[2]["state"] == "waiting"
    assert rows[0]["scheduled_time"] == w.store.get_run(run_id)["scheduled_time"]
    by_job = run_cmd(w, "status job=daily")
    assert [r["step"] for r in by_job] == ["(run)", "a", "b"]
    assert run_cmd(w, "status") == by_job
    assert orchestrate.STATUS_FIELDS == [
        "run_id", "job", "step", "state", "skip_kind", "delayed", "attempts", "sid",
        "result_count", "error", "scheduled_time", "started_at", "ended_at"]


def test_rerun_requires_definition_choice_when_job_changed(w):
    saved(w)
    run_id = run_cmd(w, "start job=daily param.p=1")[0]["run_id"]
    run = w.store.get_run(run_id)
    run.update(state="failed", ended_at=w.now)
    w.store.save_run(run)
    assert w.call("alice", "PUT", "/orchestrator/jobs/daily", job_body(name="Renamed"))[0] == 200
    with pytest.raises(orchestrate.CommandError) as err:
        run_cmd(w, "rerun run=%s step=a" % run_id)
    assert "definition_choice_required" in str(err.value)
    rows = run_cmd(w, "rerun run=%s step=a definition=original restart_downstream_jobs=true"
                   % run_id)
    assert rows[0]["ok"] == 1 and rows[0]["definition"] == "original"
    command = list(w.gw.kv["so_commands"].values())[0]
    assert command["restart_downstream_jobs"] is True and command["step_id"] == "a"


def test_jobs_lists_runnable_jobs(w):
    saved(w, job_body(run_roles=["ops"]))
    rows = run_cmd(w, "jobs", token="tok-carol")
    assert rows == [{"job": "daily", "name": "Daily summary", "enabled": 1}]


def test_loopback_client_request_shape():
    calls = []

    class Body:
        def __init__(self, text):
            self.text = text

        def read(self):
            return self.text.encode()

    class Resp:
        def __init__(self, text):
            self.body = Body(text)

    class Service:
        def get(self, path, **kw):
            calls.append(("get", path, kw))
            return Resp('{"user": "alice"}')

        def post(self, path, **kw):
            calls.append(("post", path, kw))
            return Resp('{"run_id": "r:1"}')

    gw = g.SplunkGateway(Service())
    assert gw.orchestrator_api("GET", "runs", {"job_id": "x"}) == (200, {"user": "alice"})
    assert calls[-1] == ("get", "/services/orchestrator/runs", {"output_mode": "json",
                                                                "job_id": "x"})
    assert gw.orchestrator_api("POST", "jobs/x/runs", {"params": {}}) == (200, {"run_id": "r:1"})
    method, path, kw = calls[-1]
    assert (method, path) == ("post", "/services/orchestrator/jobs/x/runs")
    assert json.loads(kw["body"]) == {"params": {}}
    assert ("Content-Type", "application/json") in kw["headers"]


def test_alert_action_uses_alert_session(w):
    saved(w)
    payload = {"session_key": "tok-alice", "server_uri": "https://127.0.0.1:8089",
               "search_name": "my alert", "owner": "alice", "sid": "scheduler__x",
               "configuration": {"job": "daily", "params": "p=5", "scheduled_time": ""}}
    ok, message = start_orchestrator_job.run_alert(payload, build=w.splunkd.gateway)
    assert ok, message
    assert w.splunkd.sessions == [("https://127.0.0.1:8089", "tok-alice")]
    runs = list(w.gw.kv["so_runs"].values())
    assert len(runs) == 1 and runs[0]["params"] == {"p": "5"} and runs[0]["owner"] == "alice"
    assert w.audit.of("run_requested")[0]["user"] == "alice"
    # The alert's session decides access: dave may not run the job.
    payload.update(session_key="tok-dave", owner="dave")
    ok, message = start_orchestrator_job.run_alert(payload, build=w.splunkd.gateway)
    assert not ok and "tok-dave" not in message
    assert len(w.gw.kv["so_runs"]) == 1
    assert start_orchestrator_job.parse_params('{"p": "1", "q": 2}') == {"p": "1", "q": "2"}
    assert start_orchestrator_job.parse_params("p=1\nq = two words, r=3") == \
        {"p": "1", "q": "two words", "r": "3"}


def test_alert_action_main_reads_payload_and_exits_nonzero_on_failure(w):
    payload = {"session_key": "tok-alice", "server_uri": "https://127.0.0.1:8089",
               "configuration": {"job": "nope"}}
    err = io.StringIO()
    code = start_orchestrator_job.main(["x", "--execute"], io.StringIO(json.dumps(payload)), err,
                                       build=w.splunkd.gateway)
    assert code != 0 and "nope" in err.getvalue()
    assert start_orchestrator_job.main(["x"], io.StringIO(""), err) != 0


def test_status_without_run_caps_loopback_calls_at_20_runs():
    calls = []

    class Gateway:
        def orchestrator_api(self, method, path, body=None):
            calls.append((method, path, body))
            if path == "runs":
                n = body["limit"]
                return 200, {"runs": [{"id": "r:%d" % i} for i in range(n)]}
            return 200, {"run": {"id": path[5:], "job_id": "j", "state": "succeeded",
                                 "steps": {}, "definition": {"steps": []}}}

    orchestrate.execute(["status", "limit=500"], Gateway())
    assert calls[0] == ("GET", "runs", {"limit": orchestrate.STATUS_MAX_RUNS})
    assert orchestrate.STATUS_MAX_RUNS == 20
    assert len([c for c in calls if c[1].startswith("runs/")]) == 20


def alert_payload(**over):
    payload = {"session_key": "tok-alice", "server_uri": "https://127.0.0.1:8089",
               "search_name": "my alert", "owner": "alice", "sid": "scheduler__x",
               "configuration": {"job": "daily", "params": "p=5", "scheduled_time": ""}}
    payload.update(over)
    return payload


def test_alert_action_refuses_nobody_owned_alert(w):
    saved(w)
    ok, message = start_orchestrator_job.run_alert(alert_payload(owner="nobody"),
                                                   build=w.splunkd.gateway)
    assert not ok and "nobody" in message and "tok-alice" not in message
    assert not w.gw.kv.get("so_runs")
    assert w.splunkd.sessions == []  # refused before any call with the session
    ok, message = start_orchestrator_job.run_alert(alert_payload(owner=""),
                                                   build=w.splunkd.gateway)
    assert not ok and not w.gw.kv.get("so_runs")


def test_alert_action_refuses_when_session_user_differs_from_owner(w):
    saved(w)
    # The session belongs to root, but the payload says the alert is alice's.
    ok, message = start_orchestrator_job.run_alert(alert_payload(session_key="tok-root"),
                                                   build=w.splunkd.gateway)
    assert not ok
    assert "root" in message and "alice" in message and "tok-root" not in message
    assert not w.gw.kv.get("so_runs")
    err = io.StringIO()
    code = start_orchestrator_job.main(
        ["x", "--execute"], io.StringIO(json.dumps(alert_payload(session_key="tok-root"))), err,
        build=w.splunkd.gateway)
    assert code != 0 and err.getvalue().startswith("ERROR ") and "tok-root" not in err.getvalue()


def test_alert_action_refuses_when_session_cannot_be_verified(w):
    saved(w)

    class NoMe:
        def __init__(self, inner):
            self.inner = inner

        def orchestrator_api(self, method, path, body=None):
            if path == "me":
                return 401, {"error": {"code": "unauthorized", "message": "no session"}}
            return self.inner.orchestrator_api(method, path, body)

    def build(uri, token):
        return NoMe(w.splunkd.gateway(uri, token))

    ok, message = start_orchestrator_job.run_alert(alert_payload(), build=build)
    assert not ok
    assert "could not verify alert session (HTTP 401)" in message
    assert "None" not in message and "tok-alice" not in message
    assert not w.gw.kv.get("so_runs")


def test_rest_audit_posts_absolute_receivers_path_and_drops_nulls():
    import orchestrator_rest as rest
    posted = []

    class Svc:
        def post(self, path, **kw):
            posted.append((path, kw))

    class Gw:
        service = Svc()
    rest.RestAudit(Gw()).write({"type": "job_saved", "step_id": None, "_time": 5})
    path, kw = posted[0]
    assert path == "/services/receivers/simple"
    assert '"step_id"' not in kw["body"] and '"type": "job_saved"' in kw["body"]


def test_error_text_with_braces_survives_splunklib_format():
    raw = 'HTTP 503: {"messages": [{"type": "ERROR", "text": "x"}]}'
    # splunklib's write_message calls message_text.format(); braces must come back literal.
    assert orchestrate._literal(raw).format() == raw
