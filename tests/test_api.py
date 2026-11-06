"""REST API route tests: api.handle(user, method, path, body, deps) with FakeGateway."""
import calendar

import pytest

from fakes import FakeGateway
from so import api
from so.actions import ActionRunner
from so.engine import Engine
from so.store import COMMANDS, JOBS, RUNS, Store

T0 = calendar.timegm((2026, 12, 1, 1, 0, 0))
RUN = ["orchestrator_run"]
BUILD = ["orchestrator_build", "orchestrator_run"]
ADMIN = ["orchestrator_admin", "orchestrator_build", "orchestrator_run"]


class Audit:
    def __init__(self):
        self.events = []

    def emit(self, event):
        self.events.append(dict(event))

    def of(self, kind):
        return [e for e in self.events if e.get("type") == kind]


class Session:
    """One session's view of the shared fake server: records the calls made through it."""

    def __init__(self, gw, label, log):
        self._gw, self._label, self._log = gw, label, log

    def __getattr__(self, name):
        target = getattr(self._gw, name)
        if not callable(target):
            return target

        def call(*a, **kw):
            self._log.append((self._label, name))
            return target(*a, **kw)
        return call


class World:
    def __init__(self):
        self.gw = FakeGateway()
        self.gw.users = {
            "alice": {"roles": ["builder"], "capabilities": BUILD},
            "bob": {"roles": ["builder"], "capabilities": BUILD},
            "carol": {"roles": ["ops"], "capabilities": RUN},
            "dave": {"roles": ["ops"], "capabilities": []},
            "root": {"roles": ["admin"], "capabilities": ADMIN},
        }
        self.audit = Audit()
        self.now = T0
        self.calls = []
        self.store = Store(self.gw)

    def deps(self, user):
        return {"user_gateway": Session(self.gw, "user:" + user, self.calls),
                "system_gateway": Session(self.gw, "system", self.calls),
                "audit": self.audit, "clock": lambda: self.now}

    def call(self, user, method, path, body=None):
        return api.handle(user, method, path, body, self.deps(user))

    def engine_tick(self):
        clock = lambda: self.now  # noqa: E731
        Engine(self.gw, self.store, self.audit, ActionRunner(self.gw, self.store, self.audit, clock),
               clock, "h1").tick()


def job_body(job_id="daily", **over):
    body = {"id": job_id, "name": "Daily summary", "enabled": True, "timezone": "UTC",
            "params": [{"name": "p", "type": "number", "default": "1"}],
            "steps": [{"id": "a", "type": "inline", "spl": '| makeresults | eval p="$run.param.p$"'},
                      {"id": "b", "type": "inline", "spl": "| makeresults count=2"}],
            "edges": [{"from": "a", "to": "b"}], "triggers": [],
            "actions": [{"hook": "on_failure", "type": "email", "to": "ops@example.com"}],
            "run_roles": ["ops"]}
    body.update(over)
    return body


@pytest.fixture
def w():
    return World()


def saved(w, user="alice", body=None):
    status, out = w.call(user, "POST", "/orchestrator/jobs", body or job_body())
    assert status == 201, out
    return out["job"]


def start(w, user="alice", job_id="daily", body=None):
    status, out = w.call(user, "POST", "/orchestrator/jobs/%s/runs" % job_id, body or {"params": {}})
    assert status == 201, out
    return out["run_id"]


def fail_run(w, run_id, failed_step="b"):
    run = w.store.get_run(run_id)
    run["state"] = "failed"
    run["ended_at"] = w.now
    for sid in run["steps"]:
        run["steps"][sid] = {"state": "succeeded", "sid": "sid_" + sid, "result_count": 1}
    run["steps"][failed_step] = {"state": "failed", "error": "boom"}
    w.store.save_run(run)


def error(out):
    return out["error"]["code"]


# Permissions.

def test_run_only_user_cannot_edit(w):
    saved(w)
    assert w.call("carol", "GET", "/orchestrator/jobs/daily")[0] == 200
    status, out = w.call("carol", "PUT", "/orchestrator/jobs/daily", job_body(name="x"))
    assert status == 403 and error(out) == "forbidden"
    assert w.audit.of("permission_denied")
    assert start(w, "carol")
    assert w.call("carol", "POST", "/orchestrator/jobs", job_body("other"))[0] == 403


def test_build_user_cannot_see_others(w):
    saved(w)
    status, out = w.call("bob", "GET", "/orchestrator/jobs")
    assert status == 200 and out["jobs"] == []
    assert w.call("bob", "GET", "/orchestrator/jobs/daily")[0] == 404
    run_id = start(w)
    assert w.call("bob", "GET", "/orchestrator/runs")[1]["runs"] == []
    assert w.call("bob", "GET", "/orchestrator/runs/" + run_id)[0] == 404
    assert w.call("bob", "POST", "/orchestrator/runs/%s/cancel" % run_id)[0] == 404
    assert [j["id"] for j in w.call("alice", "GET", "/orchestrator/jobs")[1]["jobs"]] == ["daily"]


def test_listed_role_needs_capability(w):
    saved(w)
    assert w.call("dave", "GET", "/orchestrator/jobs/daily")[0] == 404
    assert w.call("dave", "POST", "/orchestrator/jobs/daily/runs", {"params": {}})[0] == 404
    assert w.call("carol", "GET", "/orchestrator/jobs/daily")[0] == 200


def test_admin_edit_takes_ownership_and_audits(w):
    saved(w)
    status, out = w.call("root", "PUT", "/orchestrator/jobs/daily", job_body(name="Renamed"))
    assert status == 200, out
    job = w.store.get_job("daily")
    assert job["owner"] == "root" and job["name"] == "Renamed"
    changed = w.audit.of("job_owner_changed")
    assert changed and changed[0]["from"] == "alice" and changed[0]["to"] == "root"
    assert changed[0]["user"] == "root"
    for st in job["steps"]:
        assert ("root", st["hidden_search"]) in w.gw.saved_searches
    # alice can still see it only if she may run it; she is not in ops
    assert w.call("alice", "GET", "/orchestrator/jobs/daily")[0] == 404


def test_owner_field_in_body_is_ignored(w):
    saved(w, body=job_body(owner="root"))
    assert w.store.get_job("daily")["owner"] == "alice"


def test_delete_with_active_run_409(w):
    saved(w)
    start(w)
    status, out = w.call("alice", "DELETE", "/orchestrator/jobs/daily")
    assert status == 409 and error(out) == "job_has_active_runs"
    assert w.store.get_job("daily") is not None


def test_delete_removes_job_and_hidden_searches(w):
    job = saved(w)
    status, _ = w.call("alice", "DELETE", "/orchestrator/jobs/daily")
    assert status == 200
    assert w.store.get_job("daily") is None
    for st in job["steps"]:
        assert ("alice", st["hidden_search"]) not in w.gw.saved_searches
    assert ("alice", job["actions"][0]["hidden_search"]) not in w.gw.saved_searches
    assert w.gw.saved_searches == {}
    assert w.audit.of("job_deleted")


def test_job_validation_errors_block_save(w):
    body = job_body(edges=[{"from": "a", "to": "b"}, {"from": "b", "to": "a"}])
    status, out = w.call("alice", "POST", "/orchestrator/jobs", body)
    assert status == 400 and error(out) == "job_invalid"
    assert any(i["code"] == "cycle" and i["level"] == "error" for i in out["error"]["issues"])
    assert w.store.get_job("daily") is None
    assert w.gw.saved_searches == {}
    saved(w)
    status, out = w.call("alice", "PUT", "/orchestrator/jobs/daily", body)
    assert status == 400 and error(out) == "job_invalid"
    assert w.store.get_job("daily")["edges"] == [{"from": "a", "to": "b"}]


def test_validate_does_not_save(w):
    status, out = w.call("alice", "POST", "/orchestrator/jobs/validate", job_body())
    assert status == 200 and out["valid"] is True
    assert isinstance(out["issues"], list)
    assert w.store.get_job("daily") is None and w.gw.saved_searches == {}


def test_save_returns_warnings(w):
    status, out = w.call("alice", "POST", "/orchestrator/jobs", job_body(actions=[]))
    assert status == 201
    assert any(i["code"] == "no_failure_notification" for i in out["issues"])


def test_create_existing_id_409(w):
    saved(w)
    status, out = w.call("alice", "POST", "/orchestrator/jobs", job_body())
    assert status == 409 and error(out) == "job_exists"


def test_start_job_cycle_warns(w):
    saved(w, body=job_body("one", actions=[{"hook": "on_success", "type": "start_job", "job": "two"}]))
    status, out = w.call("alice", "POST", "/orchestrator/jobs", job_body(
        "two", actions=[{"hook": "on_success", "type": "start_job", "job": "one"}]))
    assert status == 201
    cyc = [i for i in out["issues"] if i["code"] == "job_chain_cycle"]
    assert cyc and cyc[0]["level"] == "warning" and "one" in cyc[0]["message"]
    status, out = w.call("alice", "POST", "/orchestrator/jobs", job_body("self"))
    assert not [i for i in out["issues"] if i["code"] == "job_chain_cycle"]
    body = job_body("self")
    body["steps"][1]["actions"] = [{"hook": "on_success", "type": "start_job", "job": "self"}]
    status, out = w.call("alice", "PUT", "/orchestrator/jobs/self", body)
    assert status == 200
    assert [i for i in out["issues"] if i["code"] == "job_chain_cycle"]


def test_unknown_destination_blocks_save(w):
    body = job_body(actions=[{"hook": "on_failure", "type": "webhook", "destination": "nope"}])
    status, out = w.call("alice", "POST", "/orchestrator/jobs", body)
    assert status == 400 and any(i["code"] == "unknown_destination" for i in out["error"]["issues"])


# Sessions.

def test_hidden_writes_use_user_session_and_kv_uses_system(w):
    saved(w)
    upserts = {label for label, name in w.calls if name == "upsert_saved_search"}
    kv = {label for label, name in w.calls if name.startswith("kv_")}
    assert upserts == {"user:alice"} and kv == {"system"}
    access = {label for label, name in w.calls if name == "user_access"}
    assert access == {"user:alice"}


# Hidden searches.

def test_saved_step_owned_direct_else_wrapped(w):
    w.gw.upsert_saved_search("alice", "mine", "index=a", "-1h", "now")
    w.gw.upsert_saved_search("bob", "theirs", "index=b", "-1h", "now")
    w.gw.saved_searches[("bob", "theirs")]["sharing"] = "app"
    body = job_body(steps=[{"id": "a", "type": "saved_search", "saved_search_ref": "mine"},
                           {"id": "b", "type": "saved_search", "saved_search_ref": "theirs"}])
    status, out = w.call("alice", "POST", "/orchestrator/jobs", body)
    assert status == 201, out
    a, b = out["job"]["steps"]
    assert a["mode"] == "direct" and a["hidden_search"] == "mine"
    assert b["mode"] == "wrapped"
    assert w.gw.saved_searches[("alice", b["hidden_search"])]["search"] == '| savedsearch "theirs"'
    wrapped = [i for i in out["issues"] if i["code"] == "saved_search_wrapped"]
    assert [i["step"] for i in wrapped] == ["b"] and wrapped[0]["level"] == "warning"
    assert "summary indexing" in wrapped[0]["message"]


def test_unreadable_saved_search_blocks_save(w):
    body = job_body(steps=[{"id": "a", "type": "saved_search", "saved_search_ref": "secret"}],
                    edges=[])
    status, out = w.call("alice", "POST", "/orchestrator/jobs", body)
    assert status == 400
    assert [i["code"] for i in out["error"]["issues"] if i["level"] == "error"] == \
        ["unknown_saved_search"]


def test_hidden_name_changes_with_spl(w):
    first = saved(w)["steps"][0]["hidden_search"]
    body = job_body()
    body["steps"][0]["spl"] = "| makeresults count=5"
    status, out = w.call("alice", "PUT", "/orchestrator/jobs/daily", body)
    second = out["job"]["steps"][0]["hidden_search"]
    assert status == 200 and first != second
    assert ("alice", second) in w.gw.saved_searches
    assert ("alice", first) not in w.gw.saved_searches  # no active run needed it


def test_gc_keeps_versions_for_active_runs(w):
    first = saved(w)["steps"][0]["hidden_search"]
    run_id = start(w)
    body = job_body()
    body["steps"][0]["spl"] = "| makeresults count=5"
    w.call("alice", "PUT", "/orchestrator/jobs/daily", body)
    assert ("alice", first) in w.gw.saved_searches
    run = w.store.get_run(run_id)
    run.update(state="succeeded", ended_at=w.now)
    w.store.save_run(run)
    body["description"] = "again"
    w.call("alice", "PUT", "/orchestrator/jobs/daily", body)
    assert ("alice", first) not in w.gw.saved_searches


def test_engine_dispatches_saved_job(w):
    saved(w)
    start(w)
    w.engine_tick()
    run = w.store.list_runs()[0]
    assert run["state"] == "running" and run["steps"]["a"]["state"] == "running"
    assert w.gw.dispatch_log[0]["args"] == {"run__param__p": "1"}


# Runs.

def test_param_validated_on_start(w):
    saved(w)
    status, out = w.call("carol", "POST", "/orchestrator/jobs/daily/runs", {"params": {"p": "abc"}})
    assert status == 400 and error(out) == "bad_param"
    assert out["error"]["issues"][0]["code"] == "bad_param"
    assert w.store.list_runs() == []
    run_id = start(w, "carol", body={"params": {"p": "007", "junk": "x"}, "scheduled_time": T0 - 60})
    run = w.store.get_run(run_id)
    assert run["params"] == {"p": "7"} and run["scheduled_time"] == T0 - 60
    assert run["trigger"] == "manual" and run["chain_depth"] == 0 and run["owner"] == "alice"


def test_start_disabled_job_409(w):
    saved(w, body=job_body(enabled=False))
    status, out = w.call("alice", "POST", "/orchestrator/jobs/daily/runs", {"params": {}})
    assert status == 409 and error(out) == "job_disabled"


def test_run_detail_and_list(w):
    saved(w)
    run_id = start(w)
    status, out = w.call("carol", "GET", "/orchestrator/runs")
    assert status == 200 and [r["id"] for r in out["runs"]] == [run_id]
    assert "definition" not in out["runs"][0]
    status, out = w.call("carol", "GET", "/orchestrator/runs/" + run_id)
    assert status == 200 and out["run"]["definition"]["id"] == "daily"
    assert out["run"]["definition_changed"] is False


@pytest.mark.parametrize("action", ["pause", "resume", "cancel", "dismiss"])
def test_controls_enqueue_engine_commands(w, action):
    saved(w)
    run_id = start(w)
    status, out = w.call("carol", "POST", "/orchestrator/runs/%s/%s" % (run_id, action))
    assert status == 202
    cmds = w.gw.kv_query(COMMANDS)
    assert len(cmds) == 1
    assert {k: cmds[0][k] for k in ("type", "run_id", "user")} == \
        {"type": action, "run_id": run_id, "user": "carol"}
    assert out["command_id"] == cmds[0]["_key"]


def test_cancel_applied_by_engine(w):
    saved(w)
    run_id = start(w)
    w.call("carol", "POST", "/orchestrator/runs/%s/cancel" % run_id)
    w.engine_tick()
    assert w.store.get_run(run_id)["state"] == "cancelled"


def _changed(w, **over):
    body = job_body(**over)
    body["steps"][1]["spl"] = "| makeresults count=9"
    status, out = w.call("alice", "PUT", "/orchestrator/jobs/daily", body)
    assert status == 200, out


def test_rerun_requires_definition_choice_when_changed(w):
    saved(w)
    run_id = start(w)
    fail_run(w, run_id)
    _changed(w)
    status, out = w.call("carol", "POST", "/orchestrator/runs/%s/rerun" % run_id, {"step": "b"})
    assert status == 409
    err = out["error"]
    assert err["code"] == "definition_choice_required"
    assert isinstance(err["message"], str) and err["issues"] == []
    assert err["choices"] == [{"definition": "latest", "available": True, "reason": None},
                              {"definition": "original", "available": True, "reason": None}]
    assert w.gw.kv_query(COMMANDS) == []


def test_rerun_unchanged_needs_no_choice(w):
    saved(w)
    run_id = start(w)
    fail_run(w, run_id)
    status, out = w.call("carol", "POST", "/orchestrator/runs/%s/rerun" % run_id, {"step": "b"})
    assert status == 202, out
    cmd = w.gw.kv_query(COMMANDS)[0]
    assert cmd["definition"] == "original" and cmd["restart_downstream_jobs"] is False


def test_rerun_latest_unavailable_if_step_removed(w):
    saved(w)
    run_id = start(w)
    fail_run(w, run_id)
    body = job_body(steps=[{"id": "c", "type": "inline", "spl": "| makeresults"},
                           {"id": "b", "type": "inline", "spl": "| makeresults count=2"}],
                    edges=[{"from": "c", "to": "b"}])
    assert w.call("alice", "PUT", "/orchestrator/jobs/daily", body)[0] == 200
    status, out = w.call("carol", "POST", "/orchestrator/runs/%s/rerun" % run_id, {"step": "b"})
    assert status == 409
    latest = out["error"]["choices"][0]
    assert latest["definition"] == "latest" and latest["available"] is False
    assert "'a'" in latest["reason"]
    status, out = w.call("carol", "POST", "/orchestrator/runs/%s/rerun" % run_id,
                         {"step": "b", "definition": "latest"})
    assert status == 409 and error(out) == "definition_unavailable"
    assert w.gw.kv_query(COMMANDS) == []


def test_rerun_original_uses_snapshot(w):
    saved(w)
    run_id = start(w)
    fail_run(w, run_id)
    original = w.store.get_run(run_id)["definition"]
    _changed(w)
    status, _ = w.call("carol", "POST", "/orchestrator/runs/%s/rerun" % run_id,
                       {"step": "b", "definition": "original", "restart_downstream_jobs": True})
    assert status == 202
    cmd = w.gw.kv_query(COMMANDS)[0]
    assert {k: cmd[k] for k in ("type", "run_id", "step_id", "definition",
                                "restart_downstream_jobs", "user")} == \
        {"type": "rerun", "run_id": run_id, "step_id": "b", "definition": "original",
         "restart_downstream_jobs": True, "user": "carol"}
    w.engine_tick()
    run = w.store.get_run(run_id)
    assert run["rerun_count"] == 1 and run["definition"] == original
    assert run["owner"] == "alice"


def test_rerun_latest_updates_owner(w):
    saved(w)
    run_id = start(w)
    fail_run(w, run_id)
    body = job_body()
    body["steps"][1]["spl"] = "| makeresults count=9"
    assert w.call("root", "PUT", "/orchestrator/jobs/daily", body)[0] == 200
    status, _ = w.call("carol", "POST", "/orchestrator/runs/%s/rerun" % run_id,
                       {"step": "b", "definition": "latest"})
    assert status == 202
    w.engine_tick()
    run = w.store.get_run(run_id)
    assert run["owner"] == "root"
    assert run["definition"]["steps"][1]["spl"] == "| makeresults count=9"


def test_rerun_rejects_bad_state_and_step(w):
    saved(w)
    run_id = start(w)
    status, out = w.call("carol", "POST", "/orchestrator/runs/%s/rerun" % run_id, {"step": "b"})
    assert status == 409 and error(out) == "invalid_state"
    fail_run(w, run_id)
    status, out = w.call("carol", "POST", "/orchestrator/runs/%s/rerun" % run_id, {"step": "zz"})
    assert status == 400 and error(out) == "unknown_step"


# Settings and destinations.

def test_destination_secret_not_returned(w):
    status, out = w.call("root", "POST", "/orchestrator/destinations",
                         {"name": "ops", "url": "https://hooks.example.com/T/secret",
                          "headers": {"Authorization": "Bearer tok"}, "preset": "slack"})
    assert status == 201, out
    for user in ("root", "alice"):
        status, out = w.call(user, "GET", "/orchestrator/destinations")
        assert status == 200
        text = repr(out)
        assert "secret" not in text.replace("_secret_ref", "") and "tok" not in text
        assert [d["name"] for d in out["destinations"]] == ["ops"]
    doc = w.gw.kv_get("so_settings", "destinations")
    dest = doc["destinations"][0]
    assert w.gw.read_secret(dest["url_secret_ref"]) == "https://hooks.example.com/T/secret"
    assert "Bearer tok" in w.gw.read_secret(dest["headers_secret_ref"])
    assert "url" not in dest and "headers" not in dest
    secret_writes = {label for label, name in w.calls if name == "write_secret"}
    assert secret_writes == {"system"}
    assert not any("secret" in repr(e).replace("_secret_ref", "") for e in w.audit.events)


def test_non_https_destination_rejected(w):
    for url in ("http://hooks.example.com/x", "https:///nohost", "ftp://x"):
        status, out = w.call("root", "POST", "/orchestrator/destinations",
                             {"name": "ops", "url": url})
        assert status == 400 and error(out) == "bad_destination"
    assert w.gw.secrets == {}


def test_only_admin_manages_destinations(w):
    body = {"name": "ops", "url": "https://hooks.example.com/x"}
    assert w.call("alice", "POST", "/orchestrator/destinations", body)[0] == 403
    assert w.call("root", "POST", "/orchestrator/destinations", body)[0] == 201
    assert w.call("alice", "DELETE", "/orchestrator/destinations/ops")[0] == 403
    assert w.call("root", "DELETE", "/orchestrator/destinations/ops")[0] == 200
    assert w.call("root", "GET", "/orchestrator/destinations")[1]["destinations"] == []
    assert w.call("carol", "GET", "/orchestrator/destinations")[0] == 403


def test_settings_admin_only_and_validated(w):
    assert w.call("alice", "GET", "/orchestrator/settings")[0] == 403
    status, out = w.call("root", "GET", "/orchestrator/settings")
    assert status == 200 and out["settings"]["max_searches"] == 10
    status, out = w.call("root", "PUT", "/orchestrator/settings", {"max_searches": 0})
    assert status == 400
    status, out = w.call("root", "PUT", "/orchestrator/settings", {"bogus": 1})
    assert status == 400
    status, out = w.call("root", "PUT", "/orchestrator/settings",
                         {"queue_cap": 5, "fallback": {"type": "email", "to": "ops@example.com"}})
    assert status == 200 and out["settings"]["queue_cap"] == 5
    assert w.store.get_settings()["fallback"] == {"type": "email", "to": "ops@example.com"}
    status, out = w.call("root", "PUT", "/orchestrator/settings",
                         {"fallback": {"type": "webhook", "destination": "nope"}})
    assert status == 400


def test_health_and_me(w):
    status, out = w.call("alice", "GET", "/orchestrator/health")
    assert status == 200
    assert out["health"]["fallback_set"] is False and out["health"]["engine_alive"] is False
    assert "index_present" in out["health"]
    w.engine_tick()
    assert w.call("alice", "GET", "/orchestrator/health")[1]["health"]["engine_alive"] is True
    status, out = w.call("carol", "GET", "/orchestrator/me")
    assert status == 200 and out["user"] == "carol"
    assert out["can_run"] is True and out["can_build"] is False and out["can_admin"] is False


def test_unknown_route_404(w):
    status, out = w.call("alice", "GET", "/orchestrator/nope")
    assert status == 404 and set(out["error"]) == {"code", "message", "issues"}


def test_direct_saved_step_dispatch_triggers_its_actions(w):
    w.gw.upsert_saved_search("alice", "mine", "index=a", "-1h", "now")
    w.gw.upsert_saved_search("bob", "theirs", "index=b", "-1h", "now")
    w.gw.saved_searches[("bob", "theirs")]["sharing"] = "app"
    body = job_body(steps=[{"id": "a", "type": "saved_search", "saved_search_ref": "mine"},
                           {"id": "b", "type": "saved_search", "saved_search_ref": "theirs"}],
                    edges=[], params=[])
    saved(w, body=body)
    start(w)
    w.engine_tick()
    log = {d["name"]: d for d in w.gw.dispatch_log}
    assert log["mine"]["trigger_actions"] is True and log["mine"]["earliest"] is None
    wrapped = [n for n in log if n != "mine"]
    assert len(wrapped) == 1 and log[wrapped[0]]["trigger_actions"] is False


# REST adapter (orchestrator_rest.py).

def _request(method, path, payload=None, query=None, system=True):
    req = {"method": method, "rest_path": path, "query": query or [],
           "payload": payload, "session": {"user": "alice", "authtoken": "user-token"},
           "server": {"rest_uri": "https://127.0.0.1:8089"}}
    if system:
        req["system_authtoken"] = "system-token"
    return req


def test_rest_adapter_builds_user_and_system_sessions(w):
    import json
    import orchestrator_rest

    built = []

    def build(uri, token):
        built.append((uri, token))
        return Session(w.gw, token, w.calls)

    out = orchestrator_rest.respond(_request("POST", "/orchestrator/jobs", json.dumps(job_body())),
                                    build=build, audit_factory=lambda gw: w.audit)
    assert out["status"] == 201, out
    assert json.loads(out["payload"])["job"]["owner"] == "alice"
    assert {t for _, t in built} == {"user-token", "system-token"}
    assert {label for label, name in w.calls if name == "upsert_saved_search"} == {"user-token"}
    assert {label for label, name in w.calls if name.startswith("kv_")} == {"system-token"}
    out = orchestrator_rest.respond(_request("GET", "/orchestrator/runs", query=[["job_id", "daily"]]),
                                    build=build, audit_factory=lambda gw: w.audit)
    assert out["status"] == 200 and json.loads(out["payload"]) == {"runs": []}


def test_rest_adapter_errors(w):
    import json
    import orchestrator_rest

    build = lambda uri, token: Session(w.gw, token, w.calls)  # noqa: E731
    out = orchestrator_rest.respond(_request("POST", "/orchestrator/jobs", "{bad"), build=build,
                                    audit_factory=lambda gw: w.audit)
    assert out["status"] == 400
    out = orchestrator_rest.respond(_request("GET", "/orchestrator/me", system=False), build=build,
                                    audit_factory=lambda gw: w.audit)
    assert out["status"] == 500 and json.loads(out["payload"])["error"]["code"] == "misconfigured"


def test_destination_delete_removes_its_secrets(w):
    w.call("root", "POST", "/orchestrator/destinations",
           {"name": "ops", "url": "https://hooks.example.com/x", "headers": {"A": "b"}})
    w.call("root", "POST", "/orchestrator/destinations",
           {"name": "other", "url": "https://hooks.example.com/y"})
    assert set(w.gw.secrets) == {"destination_ops_url", "destination_ops_headers",
                                 "destination_other_url"}
    assert w.call("root", "DELETE", "/orchestrator/destinations/ops")[0] == 200
    assert set(w.gw.secrets) == {"destination_other_url"}
    assert {label for label, name in w.calls if name == "delete_secret"} == {"system"}


def test_destination_headers_cleared_deletes_secret(w):
    w.call("root", "POST", "/orchestrator/destinations",
           {"name": "ops", "url": "https://hooks.example.com/x", "headers": {"A": "b"}})
    w.call("root", "POST", "/orchestrator/destinations",
           {"name": "ops", "url": "https://hooks.example.com/x", "headers": None})
    assert set(w.gw.secrets) == {"destination_ops_url"}


# Fix round 1.

@pytest.mark.parametrize("bad", ["..", "..%2Fso_runs%2Fx", "a%2Fb", "%2E%2E", "a b", "a:b"])
def test_bad_job_ids_in_path_404_without_kv_calls(w, bad):
    saved(w)
    w.calls.clear()
    for method, path in (("GET", "jobs/%s"), ("PUT", "jobs/%s"), ("DELETE", "jobs/%s"),
                         ("POST", "jobs/%s/runs")):
        status, out = w.call("root", method, "/orchestrator/" + path % bad, job_body())
        assert status == 404 and error(out) == "not_found", (method, bad)
    assert not [c for c in w.calls if c[1].startswith("kv_")]


@pytest.mark.parametrize("bad", ["..", "..%2Fso_jobs%2Fdaily", "daily%2F1", "x", ":", "a::b"])
def test_bad_run_ids_in_path_404_without_kv_calls(w, bad):
    saved(w)
    w.calls.clear()
    for method, path in (("GET", "runs/%s"), ("POST", "runs/%s/cancel"),
                         ("POST", "runs/%s/rerun")):
        status, out = w.call("root", method, "/orchestrator/" + path % bad, {"step": "a"})
        assert status == 404 and error(out) == "not_found", (method, bad)
    assert not [c for c in w.calls if c[1].startswith("kv_")]


def test_real_run_ids_accepted(w):
    saved(w)
    run_id = start(w)
    assert ":" in run_id
    from urllib.parse import quote
    assert w.call("alice", "GET", "/orchestrator/runs/" + quote(run_id, safe=""))[0] == 200


def test_bad_destination_name_in_path_404(w):
    status, out = w.call("root", "DELETE", "/orchestrator/destinations/..%2Fsettings")
    assert status == 404


def test_cycle_warning_redacts_hidden_jobs(w):
    saved(w, "bob", job_body("bobs", actions=[{"hook": "on_success", "type": "start_job",
                                               "job": "mine"}], run_roles=[]))
    status, out = w.call("alice", "POST", "/orchestrator/jobs", job_body(
        "mine", actions=[{"hook": "on_success", "type": "start_job", "job": "bobs"}]))
    assert status == 201
    msg = [i for i in out["issues"] if i["code"] == "job_chain_cycle"][0]["message"]
    assert "bobs" not in msg and "(hidden job)" in msg and "mine" in msg
    status, out = w.call("root", "PUT", "/orchestrator/jobs/mine", job_body(
        "mine", actions=[{"hook": "on_success", "type": "start_job", "job": "bobs"}]))
    assert "bobs" in [i for i in out["issues"] if i["code"] == "job_chain_cycle"][0]["message"]


def test_health_requires_orchestrator_capability(w):
    w.gw.users["eve"] = {"roles": ["user"], "capabilities": ["search"]}
    status, out = w.call("eve", "GET", "/orchestrator/health")
    assert status == 403 and error(out) == "forbidden"
    assert w.call("carol", "GET", "/orchestrator/health")[0] == 200


def test_health_reports_missing_index(w):
    w.gw.indexes.clear()
    out = w.call("alice", "GET", "/orchestrator/health")[1]["health"]
    assert out["index_present"] is False and any("index" in m for m in out["messages"])
    assert out["audit_index"] == "orchestrator"  # the screens show the name from here


def test_route_keyword_job_ids_reserved(w):
    status, out = w.call("alice", "POST", "/orchestrator/jobs", job_body("validate"))
    assert status == 400 and error(out) == "bad_job_id"
    body = job_body()
    del body["id"]
    body["name"] = "Validate"
    status, out = w.call("alice", "POST", "/orchestrator/jobs", body)
    assert status == 201 and out["job"]["id"] != "validate"
    assert w.call("alice", "GET", "/orchestrator/jobs/" + out["job"]["id"])[0] == 200


def test_delete_destination_deletes_secrets_first(w):
    w.call("root", "POST", "/orchestrator/destinations",
           {"name": "ops", "url": "https://hooks.example.com/x", "headers": {"A": "b"}})
    order = []
    real_delete, real_update = w.gw.delete_secret, w.gw.kv_update
    w.gw.delete_secret = lambda n: (order.append(("secret", n)), real_delete(n))[1]
    w.gw.kv_update = lambda c, k, d: (order.append(("doc", k)), real_update(c, k, d))[1]
    assert w.call("root", "DELETE", "/orchestrator/destinations/ops")[0] == 200
    assert [o[0] for o in order] == ["secret", "secret", "doc"]


def test_delete_destination_secret_failure_keeps_doc_and_audits(w):
    from so.gateway import GatewayError
    w.call("root", "POST", "/orchestrator/destinations",
           {"name": "ops", "url": "https://hooks.example.com/x"})

    def boom(name):
        raise GatewayError("HTTP 500", status=500)
    w.gw.delete_secret = boom
    status, out = w.call("root", "DELETE", "/orchestrator/destinations/ops")
    assert status == 502 and error(out) == "secret_delete_failed"
    assert [d["name"] for d in w.call("root", "GET", "/orchestrator/destinations")[1]
            ["destinations"]] == ["ops"]
    failed = w.audit.of("destination_secret_delete_failed")
    assert failed and failed[0]["destination"] == "ops"


@pytest.mark.parametrize("key,top", [("max_searches", 100), ("max_searches_per_job", 50),
                                     ("queue_cap", 1000), ("run_retention_days", 3650),
                                     ("result_retention", 7 * 86400)])
def test_settings_upper_bounds(w, key, top):
    assert w.call("root", "PUT", "/orchestrator/settings", {key: top})[0] == 200
    status, out = w.call("root", "PUT", "/orchestrator/settings", {key: top + 1})
    assert status == 400 and error(out) == "bad_setting"


def test_non_admin_cannot_put_settings(w):
    assert w.call("alice", "PUT", "/orchestrator/settings", {"queue_cap": 5})[0] == 403


def test_validate_requires_build(w):
    assert w.call("carol", "POST", "/orchestrator/jobs/validate", job_body())[0] == 403


def test_owner_will_change_flag(w):
    saved(w)
    status, out = w.call("root", "POST", "/orchestrator/jobs/validate", job_body())
    assert out["owner_will_change"] is True and out["owner"] == "root"
    status, out = w.call("alice", "POST", "/orchestrator/jobs/validate", job_body())
    assert out["owner_will_change"] is False and out["owner"] == "alice"
    status, out = w.call("bob", "POST", "/orchestrator/jobs/validate", job_body())
    assert out["owner_will_change"] is False  # bob cannot see alice's job: nothing leaks
    status, out = w.call("alice", "PUT", "/orchestrator/jobs/daily", job_body())
    assert out["owner_will_change"] is False and out["owner"] == "alice"
    status, out = w.call("root", "PUT", "/orchestrator/jobs/daily", job_body())
    assert out["owner_will_change"] is True and out["owner"] == "root"


def test_action_searches_versioned_for_active_runs(w):
    first = saved(w)["actions"][0]["hidden_search"]
    run_id = start(w)
    body = job_body(actions=[{"hook": "on_failure", "type": "event", "index": "summary"}])
    out = w.call("alice", "PUT", "/orchestrator/jobs/daily", body)[1]
    second = out["job"]["actions"][0]["hidden_search"]
    assert first != second and first.startswith("_so_daily_action_0_")
    assert ("alice", first) in w.gw.saved_searches and ("alice", second) in w.gw.saved_searches
    assert w.store.get_run(run_id)["definition"]["actions"][0]["hidden_search"] == first
    run = w.store.get_run(run_id)
    run.update(state="succeeded", ended_at=w.now)
    w.store.save_run(run)
    w.call("alice", "PUT", "/orchestrator/jobs/daily", body)
    assert ("alice", first) not in w.gw.saved_searches


def test_partial_hidden_failure_tracked_for_gc(w):
    from so.gateway import GatewayError
    saved(w)
    body = job_body()
    body["steps"][0]["spl"] = "| makeresults count=3"
    body["steps"][1]["spl"] = "| makeresults count=4"
    real = w.gw.upsert_saved_search
    calls = []

    def flaky(owner, name, *a, **kw):
        calls.append(name)
        if len(calls) == 2:
            raise GatewayError("HTTP 500", status=500)
        return real(owner, name, *a, **kw)
    w.gw.upsert_saved_search = flaky
    status, _ = w.call("alice", "PUT", "/orchestrator/jobs/daily", body)
    assert status == 502
    job = w.store.get_job("daily")
    assert job["steps"][0]["spl"] != "| makeresults count=3"  # definition unchanged
    tracked = {e["name"] for e in job["hidden_searches"]}
    assert calls[0] in tracked and calls[1] in tracked
    w.gw.upsert_saved_search = real
    w.call("alice", "PUT", "/orchestrator/jobs/daily", job_body())
    assert ("alice", calls[0]) not in w.gw.saved_searches  # orphan from the failed save removed


def test_partial_hidden_failure_on_create_rolls_back(w):
    from so.gateway import GatewayError
    real = w.gw.upsert_saved_search
    calls = []

    def flaky(owner, name, *a, **kw):
        calls.append(name)
        if len(calls) == 2:
            raise GatewayError("HTTP 500", status=500)
        return real(owner, name, *a, **kw)
    w.gw.upsert_saved_search = flaky
    status, _ = w.call("alice", "POST", "/orchestrator/jobs", job_body())
    assert status == 502
    assert w.store.get_job("daily") is None and w.gw.saved_searches == {}


# Jobs list: next run and last run (Task 10, the Jobs screen).

def test_job_list_shows_next_run_and_last_run(w):
    saved(w, body=job_body(triggers=[{"type": "cron", "cron": "0 2 * * *"}]))
    status, out = w.call("alice", "GET", "/orchestrator/jobs")
    job = out["jobs"][0]
    assert status == 200 and job["next_run"] == T0 + 3600
    assert job["last_run"] is None
    run_id = start(w)
    status, out = w.call("alice", "GET", "/orchestrator/jobs/daily")
    assert out["job"]["next_run"] == T0 + 3600
    last = out["job"]["last_run"]
    assert last["id"] == run_id and last["state"] == "queued" and last["trigger"] == "manual"
    assert "definition" not in last and "steps" not in last


def test_job_list_next_run_none_without_cron_or_when_disabled(w):
    saved(w)
    assert w.call("alice", "GET", "/orchestrator/jobs")[1]["jobs"][0]["next_run"] is None
    saved(w, body=job_body("nightly", enabled=False,
                           triggers=[{"type": "cron", "cron": "0 2 * * *"}]))
    jobs = {j["id"]: j for j in w.call("alice", "GET", "/orchestrator/jobs")[1]["jobs"]}
    assert jobs["nightly"]["next_run"] is None
