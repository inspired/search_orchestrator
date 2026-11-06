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


# Final review I1: a reused job id must not expose the old owner's runs.

def test_reused_job_id_refused_while_runs_retained(w):
    saved(w)
    run_id = start(w)
    fail_run(w, run_id)
    assert w.call("alice", "DELETE", "/orchestrator/jobs/daily")[0] == 200
    assert w.call("bob", "GET", "/orchestrator/runs/" + run_id)[0] == 404
    status, out = w.call("bob", "POST", "/orchestrator/jobs", job_body(run_roles=[]))
    assert status == 409 and error(out) == "job_id_in_use"
    assert out["error"]["message"] == ("Runs of a deleted job with this id are still retained; "
                                       "choose another id")
    assert w.store.get_job("daily") is None
    assert w.call("bob", "GET", "/orchestrator/runs/" + run_id)[0] == 404
    assert w.call("bob", "GET", "/orchestrator/runs")[1]["runs"] == []
    status, _ = w.call("bob", "POST", "/orchestrator/runs/%s/rerun" % run_id,
                       {"step": "b", "definition": "original"})
    assert status == 404
    # The snapshot's owner, its run_roles members and admins still see the run.
    for user in ("alice", "carol", "root"):
        assert w.call(user, "GET", "/orchestrator/runs/" + run_id)[0] == 200
        assert [r["id"] for r in w.call(user, "GET", "/orchestrator/runs")[1]["runs"]] == [run_id]


def test_generated_job_id_skips_ids_with_retained_runs(w):
    saved(w, body=job_body(None, name="Daily"))
    run_id = start(w)
    fail_run(w, run_id)
    assert w.call("alice", "DELETE", "/orchestrator/jobs/daily")[0] == 200
    status, out = w.call("bob", "POST", "/orchestrator/jobs", job_body(None, name="Daily"))
    assert status == 201 and out["job"]["id"].startswith("daily_")


def test_missing_job_run_visibility_uses_snapshot_owner_and_roles_only(w):
    saved(w)
    run_id = start(w)
    fail_run(w, run_id)
    run = w.store.get_run(run_id)
    run["definition"]["owner"] = "bob"  # a stray field in the snapshot is never trusted
    w.store.save_run(run)
    assert w.call("alice", "DELETE", "/orchestrator/jobs/daily")[0] == 200
    assert w.call("bob", "GET", "/orchestrator/runs/" + run_id)[0] == 404
    assert w.call("dave", "GET", "/orchestrator/runs/" + run_id)[0] == 404


# Final review I3: GET runs pushes filters, sort, limit and a projection into KV.

def test_list_runs_pushes_query_limit_and_projection_into_kv(w):
    saved(w)
    ids = []
    for i in range(5):
        w.now = T0 + i
        ids.append(start(w, body={"params": {}, "scheduled_time": T0 + i}))
    calls = []
    real = w.gw.kv_query

    def spy(collection, query=None, sort=None, limit=0, skip=0, fields=None):
        calls.append((collection, query, sort, limit, skip, fields))
        return real(collection, query, sort=sort, limit=limit, skip=skip, fields=fields)
    w.gw.kv_query = spy
    status, out = w.call("root", "GET", "/orchestrator/runs",
                         {"job_id": "daily", "state": "queued", "limit": "2"})
    assert status == 200
    run_calls = [c for c in calls if c[0] == RUNS]
    assert run_calls == [(RUNS, {"job_id": "daily", "state": "queued"}, "created_at:-1", 2, 0,
                          "definition:0")]
    assert len(out["runs"]) == 2 and all("definition" not in r for r in out["runs"])
    calls.clear()
    status, out = w.call("carol", "GET", "/orchestrator/runs", {"limit": "3"})
    run_calls = [c for c in calls if c[0] == RUNS]
    assert len(run_calls) == 1 and run_calls[0][3] == 3 and run_calls[0][5] == "definition:0"
    assert len(out["runs"]) == 3
    calls.clear()
    assert w.call("bob", "GET", "/orchestrator/runs")[1]["runs"] == []


def test_list_runs_newest_first(w):
    saved(w)
    first = start(w)
    w.now += 10
    second = start(w)
    out = w.call("alice", "GET", "/orchestrator/runs")[1]
    assert [r["id"] for r in out["runs"]] == [second, first]


# Final review M9: enable or disable a job without taking it over.

def test_enabled_route_keeps_owner_and_audits(w):
    saved(w)
    status, out = w.call("root", "POST", "/orchestrator/jobs/daily/enabled", {"enabled": False})
    assert status == 200 and out["job"]["enabled"] is False and out["job"]["owner"] == "alice"
    job = w.store.get_job("daily")
    assert job["enabled"] is False and job["owner"] == "alice"
    assert job["steps"][0]["hidden_search"]  # untouched definition
    events = w.audit.of("job_enabled")
    assert events and events[-1]["enabled"] is False and events[-1]["owner"] == "alice"
    assert not w.audit.of("job_owner_changed")
    assert w.call("alice", "POST", "/orchestrator/jobs/daily/enabled", {"enabled": True})[0] == 200
    assert w.store.get_job("daily")["enabled"] is True


def test_enabled_route_needs_edit_rights_and_bool(w):
    saved(w)
    status, out = w.call("carol", "POST", "/orchestrator/jobs/daily/enabled", {"enabled": False})
    assert status == 403 and error(out) == "forbidden"
    assert w.call("bob", "POST", "/orchestrator/jobs/daily/enabled", {"enabled": False})[0] == 404
    status, out = w.call("alice", "POST", "/orchestrator/jobs/daily/enabled", {"enabled": "no"})
    assert status == 400
    assert w.store.get_job("daily")["enabled"] is True


def test_next_run_walk_is_capped(w):
    # Final review M18: a rare cron (29 February) would walk a year or more of windows.
    import time as _time
    saved(w, body=job_body(triggers=[{"type": "cron", "cron": "0 0 29 2 *"}]))
    started = _time.monotonic()
    job = w.call("alice", "GET", "/orchestrator/jobs")[1]["jobs"][0]
    assert _time.monotonic() - started < 1.0
    # T0 is 1 December 2026; the next 29 February is in 2028, over 400 days away.
    assert job["next_run"] is None and job["next_run_beyond"] is True
    saved(w, body=job_body("monthly", triggers=[{"type": "cron", "cron": "0 3 1 * *"}]))
    jobs = {j["id"]: j for j in w.call("alice", "GET", "/orchestrator/jobs")[1]["jobs"]}
    assert jobs["monthly"]["next_run"] == T0 + 2 * 3600 and jobs["monthly"]["next_run_beyond"] is False
    assert jobs["daily"]["next_run_beyond"] is True


def test_next_run_found_within_400_days(w):
    import calendar as _cal
    w.now = _cal.timegm((2027, 3, 1, 0, 0, 0))
    saved(w, body=job_body(triggers=[{"type": "cron", "cron": "0 0 29 2 *"}]))
    job = w.call("alice", "GET", "/orchestrator/jobs")[1]["jobs"][0]
    assert job["next_run"] == _cal.timegm((2028, 2, 29, 0, 0, 0)) and not job["next_run_beyond"]


def test_gc_keeps_previous_empty_variant_while_used(w):
    steps = [{"id": "a", "type": "inline", "spl": "| makeresults"},
             {"id": "m", "type": "previous", "spl": "| stats count"}]
    job = saved(w, body=job_body(steps=steps, edges=[{"from": "a", "to": "m"}]))
    m = job["steps"][1]
    main, empty = m["hidden_search"], m["hidden_search_empty"]
    assert {("alice", main), ("alice", empty)} <= set(w.gw.saved_searches)
    tracked = {e["name"] for e in w.store.get_job("daily")["hidden_searches"]}
    assert {main, empty} <= tracked
    run_id = start(w)
    status, out = w.call("alice", "PUT", "/orchestrator/jobs/daily",
                         job_body(steps=steps[:1], edges=[]))
    assert status == 200, out
    assert ("alice", empty) in w.gw.saved_searches  # the active run still uses it
    run = w.store.get_run(run_id)
    run.update(state="cancelled", ended_at=0)
    w.store.save_run(run)
    status, out = w.call("alice", "PUT", "/orchestrator/jobs/daily",
                         job_body(steps=steps[:1], edges=[]))
    assert status == 200, out
    assert ("alice", empty) not in w.gw.saved_searches
    assert ("alice", main) not in w.gw.saved_searches


# Previews.

def preview_body(job=None, step_id="a", **over):
    body = {"job": job or job_body(), "step_id": step_id, "scheduled_time": T0, "params": {},
            "input": {"mode": "live", "previews": {}}}
    body.update(over)
    return body


def preview(w, user="alice", **kw):
    return w.call(user, "POST", "/orchestrator/preview", preview_body(**kw))


def live(**previews):
    return {"mode": "live", "previews": previews}


def chain_job(**over):
    """a -> b, where b reads a's sid and first host."""
    return job_body(steps=[{"id": "a", "type": "inline", "spl": "| makeresults", "earliest": "-1d",
                            "latest": "now"},
                           {"id": "b", "type": "inline",
                            "spl": '| loadjob $a.sid$ | eval h="$a.first.host|none$"'}], **over)


def run_with(w, job, steps):
    """A stored run of ``job`` (saved by alice) whose steps ended as ``steps``."""
    saved(w, body=job)
    run_id = start(w, job_id=job["id"])
    run = w.store.get_run(run_id)
    run["state"] = "succeeded"
    run["steps"].update(steps)
    w.store.save_run(run)
    return run_id


def kept(w, *sids):
    for sid in sids:
        w.gw.jobs[sid] = {"states": ["done"], "idx": 0, "result_count": 1, "first": None,
                          "error": None}


def test_preview_runs_as_caller_with_scheduled_now(w):
    status, out = preview(w)
    assert status == 201, out
    assert out["status"] == "started"
    log = w.gw.preview_log
    assert len(log) == 1
    assert log[0]["user"] == "alice" and log[0]["now"] == T0
    assert log[0]["sid"] == out["sid"] and out["sid"].startswith("so_preview_")
    assert ".daily.a." in out["sid"]
    assert out["spl"] == log[0]["spl"] == '| makeresults | eval p="1"'
    assert ("user:alice", "preview_dispatch") in w.calls
    assert not [c for c in w.calls if c[0] == "system" and c[1].startswith("preview")]
    assert not w.gw.dispatch_log
    events = w.audit.of("preview_dispatched")
    assert len(events) == 1
    assert {k: events[0][k] for k in ("job_id", "step_id", "sid", "user")} == \
        {"job_id": "daily", "step_id": "a", "sid": out["sid"], "user": "alice"}


def test_preview_time_window_and_params(w):
    status, out = preview(w, job=chain_job())
    assert status == 201, out
    assert (w.gw.preview_log[0]["earliest"], w.gw.preview_log[0]["latest"]) == ("-1d", "now")
    status, out = preview(w, params={"p": "x"})
    assert status == 400 and error(out) == "bad_param"
    status, out = preview(w, params={"p": "7"})
    assert status == 201 and out["spl"] == '| makeresults | eval p="7"'


def test_preview_defaults_route(w):
    job = job_body(triggers=[{"type": "cron", "cron": "0 2 * * *"}])
    status, out = w.call("alice", "POST", "/orchestrator/preview/defaults", {"job": job})
    assert status == 200 and out == {"scheduled_time": T0 - 23 * 3600}
    status, out = w.call("alice", "POST", "/orchestrator/preview/defaults", {"job": job_body()})
    assert out == {"scheduled_time": T0}
    assert w.call("carol", "POST", "/orchestrator/preview/defaults", {"job": job})[0] == 403


def test_preview_requires_edit(w):
    assert preview(w, "carol")[0] == 403
    assert preview(w, "dave")[0] == 403
    assert w.audit.of("permission_denied")
    saved(w)
    assert preview(w, "carol")[0] == 403  # carol may run the stored job, not edit it
    status, out = preview(w, "bob")  # alice's job is hidden from bob: as if new
    assert status == 201, out
    status, out = preview(w, job=job_body("nosuch"))
    assert status == 201 and ".nosuch.a." in out["sid"]
    status, out = preview(w, job=job_body("bad id!"))
    assert status == 201 and ".new.a." in out["sid"]
    assert preview(w, "root")[0] == 201
    status, out = preview(w, step_id="zz")
    assert status == 400


def test_preview_downstream_uses_live_upstream_sid(w):
    w.gw.script_job("so_preview_", ["done"], result_count=3, first={"host": "h1"})
    status, out = preview(w, job=chain_job())
    a_sid = out["sid"]
    status, out = preview(w, job=chain_job(), step_id="b", input=live(a={"sid": a_sid}))
    assert status == 201, out
    assert out["spl"] == '| loadjob "%s" | eval h="h1"' % a_sid
    assert w.gw.preview_log[-1]["spl"] == out["spl"]
    assert (w.gw.preview_log[-1]["earliest"], w.gw.preview_log[-1]["latest"]) == (None, None)
    assert (a_sid, "touch", {}) in w.gw.control_log
    status, out = preview(w, job=chain_job(), step_id="b", input=live())
    assert status == 409 and error(out) == "needs_preview" and out["error"]["steps"] == ["a"]


def test_preview_live_running_upstream_needs_preview(w):
    w.gw.script_job("so_preview_", ["running"])
    _, out = preview(w, job=chain_job())
    status, out = preview(w, job=chain_job(), step_id="b", input=live(a={"sid": out["sid"]}))
    assert status == 409 and error(out) == "needs_preview"


def test_preview_live_skipped_upstream(w):
    # A run_when skip still takes an on_success edge, as in a run: $a.sid$ has no default.
    status, out = preview(w, job=chain_job(), step_id="b",
                          input=live(a={"skipped": "run_when"}))
    assert status == 400 and error(out) == "invalid"
    assert out["error"]["issues"][0]["step"] == "b" and "$a.sid$" in out["error"]["issues"][0][
        "message"]
    status, out = preview(w, job=chain_job(), step_id="b",
                          input=live(a={"skipped": "not_taken"}))
    assert status == 200 and out["status"] == "skipped" and out["skip_kind"] == "not_taken"
    assert out["reason"] == "none of the edges into it would be taken"
    job = chain_job()
    job["steps"][1]["spl"] = '| makeresults | eval s="$a.sid|none$"'
    status, out = preview(w, job=job, step_id="b", anyway=True,
                          input=live(a={"skipped": "not_taken"}))
    assert status == 201 and out["anyway"] is True and out["spl"].endswith('s="none"')


def _previous_job():
    steps = [{"id": "a", "type": "inline", "spl": "| makeresults"},
             {"id": "b", "type": "inline", "spl": "| makeresults"},
             {"id": "c", "type": "inline", "spl": "| makeresults"},
             {"id": "s", "type": "inline", "spl": "| makeresults",
              "run_when": {"kind": "cron", "value": "* * * * 1"}},
             {"id": "p", "type": "previous", "spl": "| stats count"}]
    edges = [{"from": "a", "to": x} for x in ("b", "c", "s")] + \
        [{"from": x, "to": "p", "condition": "always"} for x in ("b", "s", "c")]
    return job_body(steps=steps, edges=edges)


def test_preview_previous_type_from_run_input(w):
    job = _previous_job()
    run_id = run_with(w, job, {
        "a": {"state": "succeeded", "sid": "run_a", "result_count": 1},
        "b": {"state": "succeeded", "sid": "run_b", "result_count": 1},
        "c": {"state": "succeeded", "sid": "run_c", "result_count": 1},
        "s": {"state": "skipped", "skip_kind": "run_when"}})
    kept(w, "run_a", "run_b", "run_c")
    status, out = preview(w, job=job, step_id="p", input={"mode": "run", "run_id": run_id})
    assert status == 201, out
    assert out["spl"] == '| loadjob "run_b" | append [| loadjob "run_c"] | stats count'
    entry = w.gw.preview_log[-1]
    assert entry["user"] == "alice" and (entry["earliest"], entry["latest"]) == (None, None)
    # Nothing succeeded: the empty input.
    run_id = run_with(w, job_body("other", steps=job["steps"], edges=job["edges"]), {
        "a": {"state": "succeeded", "sid": "run_a", "result_count": 1},
        "b": {"state": "failed", "sid": "run_b2"},
        "c": {"state": "skipped", "skip_kind": "not_taken"},
        "s": {"state": "skipped", "skip_kind": "run_when"}})
    status, out = preview(w, job=job_body("other", steps=job["steps"], edges=job["edges"]),
                          step_id="p", input={"mode": "run", "run_id": run_id})
    assert status == 201, out
    assert out["spl"] == "| makeresults | where 1=0 | stats count"


def test_preview_run_input_access(w):
    job = chain_job()
    run_id = run_with(w, job, {"a": {"state": "succeeded", "sid": "run_a", "result_count": 1}})
    kept(w, "run_a")
    body = {"step_id": "b", "input": {"mode": "run", "run_id": run_id}}
    assert preview(w, "bob", job=job, **body)[0] == 404  # bob cannot see the run
    status, out = preview(w, "root", job=job, **body)
    assert status == 201 and out["spl"].startswith('| loadjob "run_a"')
    assert preview(w, job=job, step_id="b", input={"mode": "run", "run_id": "nope"})[0] == 404
    assert preview(w, job=job, step_id="b", input={"mode": "x"})[0] == 400


def test_preview_rejects_foreign_sids(w):
    _, out = preview(w, "bob", job=chain_job())
    bob_sid = out["sid"]
    _, out = preview(w, job=chain_job(), step_id="a")
    alice_a = out["sid"]
    _, out = preview(w, job=chain_job(), step_id="b", input=live(a={"sid": alice_a}))
    alice_b = out["sid"]
    for sid in (bob_sid, "fake.1", "x", alice_b):
        status, out = preview(w, job=chain_job(), step_id="b", input=live(a={"sid": sid}))
        assert (status, error(out)) in ((409, "needs_preview"), (404, "not_found")), (sid, out)
    for path in ("", "/results"):
        status, out = w.call("alice", "GET", "/orchestrator/preview/" + bob_sid + path)
        assert status == 404 and error(out) == "not_found"
    assert w.call("alice", "POST", "/orchestrator/preview/%s/cancel" % bob_sid)[0] == 404
    assert (bob_sid, "cancel", {}) not in w.gw.control_log
    assert w.call("bob", "GET", "/orchestrator/preview/" + bob_sid)[0] == 200
    assert w.call("alice", "GET", "/orchestrator/preview/so_preview_x$y")[0] == 404


def test_preview_skip_and_anyway(w):
    job = job_body(steps=[{"id": "a", "type": "inline", "spl": "| makeresults",
                           "run_when": {"kind": "cron", "value": "* * * * 1"}}], edges=[])
    status, out = preview(w, job=job)  # T0 is a Tuesday
    assert status == 200 and out["status"] == "skipped" and out["skip_kind"] == "run_when"
    assert out["reason"] == "its run when condition doesn't match at this time"
    assert not w.gw.preview_log
    status, out = preview(w, job=job, anyway=True)
    assert status == 201 and out["status"] == "started" and out["anyway"] is True
    bad = job_body(steps=[{"id": "a", "type": "inline", "spl": "| makeresults",
                           "run_when": {"kind": "expression", "value": "1 +"}}], edges=[])
    status, out = preview(w, job=bad)
    assert status == 400 and error(out) == "invalid"


def test_preview_upstream_failed_and_expired(w):
    w.gw.script_job("so_preview_", ["failed"])
    _, out = preview(w, job=chain_job())
    status, out = preview(w, job=chain_job(), step_id="b", input=live(a={"sid": out["sid"]}))
    assert status == 409 and error(out) == "upstream_failed" and out["error"]["step"] == "a"
    run_id = run_with(w, chain_job(), {"a": {"state": "succeeded", "sid": "gone",
                                             "result_count": 1}})
    status, out = preview(w, job=chain_job(), step_id="b",
                          input={"mode": "run", "run_id": run_id})
    assert status == 410 and error(out) == "run_results_expired" and out["error"]["step"] == "a"


def test_preview_poll_enforces_limit_and_touches(w):
    w.gw.script_job("so_preview_", ["running"], run_duration=601)
    _, out = preview(w)
    sid = out["sid"]
    status, out = w.call("alice", "GET", "/orchestrator/preview/" + sid)
    assert status == 200
    assert out["state"] == "failed" and out["error"] == "Preview stopped after 10 minutes"
    assert (sid, "cancel", {}) in w.gw.control_log
    w.gw.script_job("so_preview_", ["running"], run_duration=100)
    _, out = preview(w)
    sid = out["sid"]
    status, out = w.call("alice", "GET", "/orchestrator/preview/" + sid, {"limit": "90"})
    assert out["state"] == "failed" and out["error"] == "Preview stopped after 1.5 minutes"
    w.gw.script_job("so_preview_", ["running"], run_duration=50)
    _, out = preview(w)
    sid = out["sid"]
    status, out = w.call("alice", "GET", "/orchestrator/preview/" + sid, {"limit": "99999"})
    assert status == 200 and out["state"] == "running" and out["error"] is None
    assert set(out) == {"state", "result_count", "error", "truncated", "run_duration", "messages"}
    assert (sid, "touch", {}) in w.gw.control_log
    assert (sid, "cancel", {}) not in w.gw.control_log
    assert w.call("alice", "GET", "/orchestrator/preview/" + sid, {"limit": "x"})[0] == 400
    status, out = w.call("alice", "POST", "/orchestrator/preview/%s/cancel" % sid)
    assert status == 200 and out == {"cancelled": True}
    assert (sid, "cancel", {}) in w.gw.control_log


def test_preview_results_capped(w):
    w.gw.script_job("so_preview_", ["done"], result_count=150,
                    rows=[{"n": str(i)} for i in range(150)])
    _, out = preview(w)
    status, out = w.call("alice", "GET", "/orchestrator/preview/%s/results" % out["sid"])
    assert status == 200
    assert len(out["rows"]) == 100 and out["total"] == 150 and out["fields"] == ["n"]


def test_preview_saved_search_step_uses_wrapper(w):
    w.gw.saved_searches[("alice", "my search")] = {"search": "| makeresults"}  # direct for a run
    job = job_body(steps=[{"id": "a", "type": "saved_search", "saved_search_ref": "my search"}],
                   edges=[])
    status, out = preview(w, job=job)
    assert status == 201 and out["spl"] == '| savedsearch "my search"'
    job["steps"][0]["saved_search_ref"] = "missing"
    status, out = preview(w, job=job)
    assert status == 400 and out["error"]["issues"][0]["code"] == "unknown_saved_search"


def test_preview_errors_only_in_closure_block(w):
    job = chain_job()
    job["steps"].append({"id": "z", "type": "inline", "spl": ""})  # invalid, unrelated
    status, out = preview(w, job=job)
    assert status == 201, out
    job["steps"][0]["spl"] = "| makeresults | orchestrate selftest"
    status, out = preview(w, job=job, step_id="b", input=live(a={"skipped": "run_when"}))
    assert status == 400 and error(out) == "invalid"
    assert {i["step"] for i in out["error"]["issues"]} == {"a"}


def _info_log(w):
    seen = []
    real = w.gw.preview_info

    def info(sid):
        seen.append(sid)
        return real(sid)
    w.gw.preview_info = info
    return seen


def test_preview_foreign_sids_never_reach_splunkd(w):
    _, out = preview(w, "bob", job=chain_job())
    bob_sid = out["sid"]
    _, out = preview(w, job=chain_job(id="other"))
    other_job = out["sid"]
    seen = _info_log(w)
    _, b_out = preview(w, job=job_body(steps=[{"id": "b", "type": "inline",
                                               "spl": "| makeresults"}], edges=[]), step_id="b")
    wrong_step = b_out["sid"]
    for sid in (bob_sid, other_job, wrong_step):
        status, out = preview(w, job=chain_job(), step_id="b", input=live(a={"sid": sid}))
        assert status == 409 and error(out) == "needs_preview"
    for path, method in (("", "GET"), ("/results", "GET"), ("/cancel", "POST")):
        assert w.call("root", method, "/orchestrator/preview/" + bob_sid + path)[0] == 404
    assert seen == []


def test_preview_on_failure_branch_previews_in_live_mode(w):
    job = job_body(steps=[{"id": "a", "type": "inline", "spl": "| makeresults"},
                          {"id": "b", "type": "inline", "spl": '| makeresults | eval x="$a.status$"'},
                          {"id": "p", "type": "previous", "spl": "| stats count"}],
                   edges=[{"from": "a", "to": "b", "condition": "on_failure"},
                          {"from": "a", "to": "p", "condition": "always"},
                          {"from": "b", "to": "p", "condition": "always"}])
    w.gw.script_job("so_preview_", ["failed"])
    _, out = preview(w, job=job)
    a_sid = out["sid"]
    w.gw.script_job("so_preview_", ["done"], result_count=1)
    status, out = preview(w, job=job, step_id="b", input=live(a={"sid": a_sid}))
    assert status == 201 and out["spl"] == '| makeresults | eval x="failed"', out
    b_sid = out["sid"]
    status, out = preview(w, job=job, step_id="p", input=live(a={"sid": a_sid}, b={"sid": b_sid}))
    assert status == 201 and out["spl"] == '| loadjob "%s" | stats count' % b_sid


def test_preview_failed_parent_on_success_in_run_mode(w):
    run_id = run_with(w, chain_job(), {"a": {"state": "failed", "sid": "run_a"}})
    kept(w, "run_a")
    status, out = preview(w, job=chain_job(), step_id="b", input={"mode": "run", "run_id": run_id})
    assert status == 409 and error(out) == "upstream_failed" and out["error"]["step"] == "a"


def test_preview_run_step_missing(w):
    run_id = run_with(w, chain_job(), {"a": {"state": "cancelled"}})
    status, out = preview(w, job=chain_job(), step_id="b", input={"mode": "run", "run_id": run_id})
    assert status == 409 and error(out) == "run_step_missing" and out["error"]["step"] == "a"
    assert out["error"]["message"] == ("a has no result in that run; switch to live previews "
                                       "or pick another run")
    job = chain_job()
    job["steps"].insert(0, {"id": "n", "type": "inline", "spl": "| makeresults"})
    job["steps"][2]["spl"] += ' | eval y="$n.resultCount$"'  # b reads a step added since
    w.store.save_run(dict(w.store.get_run(run_id), steps={"a": {"state": "succeeded",
                                                                "sid": "run_a"}}))
    kept(w, "run_a")
    status, out = preview(w, job=job, step_id="b", input={"mode": "run", "run_id": run_id})
    assert status == 409 and error(out) == "run_step_missing" and out["error"]["step"] == "n"


def test_preview_unrelated_edge_error_does_not_block(w):
    job = chain_job()
    job["steps"].append({"id": "z", "type": "inline", "spl": "| makeresults"})
    job["edges"].append({"from": "a", "to": "z", "condition": "bogus"})
    job["edges"].append({"from": "z", "to": "nowhere"})
    assert preview(w, job=job)[0] == 201
    job["edges"].append({"from": "ghost", "to": "a"})
    status, out = preview(w, job=job)
    assert status == 400 and out["error"]["issues"][0]["code"] == "unknown_edge_step"
    job = chain_job(params=[{"name": "p", "type": "bogus"}])
    assert preview(w, job=job)[0] == 400
    job = chain_job(timezone="Nowhere/Land")
    assert preview(w, job=job)[0] == 400
    job = chain_job(triggers=[{"type": "cron", "cron": "bad"}])
    assert preview(w, job=job)[0] == 201


def test_job_id_new_reserved(w):
    status, out = w.call("alice", "POST", "/orchestrator/jobs", job_body("new"))
    assert status == 400 and error(out) == "bad_job_id"
    status, out = w.call("alice", "POST", "/orchestrator/jobs", job_body(None, name="New"))
    assert status == 201 and out["job"]["id"] != "new"


def _skip_b_job(c_type="inline", c_spl="| loadjob $b.sid$"):
    """a -> b -> c, where b's run_when never matches at T0 (a Tuesday)."""
    return job_body(steps=[{"id": "a", "type": "inline", "spl": "| makeresults"},
                           {"id": "b", "type": "inline", "spl": "| makeresults",
                            "run_when": {"kind": "cron", "value": "* * * * 1"}},
                           {"id": "c", "type": c_type, "spl": c_spl}],
                    edges=[{"from": "a", "to": "b"}, {"from": "b", "to": "c"}])


def test_preview_anyway_upstream_feeds_downstream_as_skipped(w):
    w.gw.script_job("so_preview_", ["done"], result_count=2)
    job = _skip_b_job()
    _, out = preview(w, job=job)
    a_sid = out["sid"]
    status, out = preview(w, job=job, step_id="b", anyway=True, input=live(a={"sid": a_sid}))
    assert status == 201 and out["anyway"] is True
    b_sid = out["sid"]
    # c reads b as a run would: skipped, so $b.sid$ without a default fails as in a run.
    status, out = preview(w, job=job, step_id="c", input=live(a={"sid": a_sid}, b={"sid": b_sid}))
    assert status == 400 and error(out) == "invalid", out
    assert out["error"]["issues"][0]["step"] == "c" and "$b.sid$" in out["error"]["issues"][0][
        "message"]
    # A step a run would skip needs no preview of its own.
    status, out = preview(w, job=job, step_id="c", input=live(a={"sid": a_sid}))
    assert status == 400 and error(out) == "invalid", out
    job = _skip_b_job("previous", "| stats count")
    status, out = preview(w, job=job, step_id="c", input=live(a={"sid": a_sid}, b={"sid": b_sid}))
    assert status == 201 and out["spl"] == "| makeresults | where 1=0 | stats count", out


def test_preview_live_failed_grandparent_is_upstream_failed(w):
    job = _skip_b_job()
    del job["steps"][1]["run_when"]
    w.gw.script_job("so_preview_", ["done"], result_count=1)
    _, out = preview(w, job=job)
    _, out = preview(w, job=job, step_id="b", input=live(a={"sid": out["sid"]}))
    b_sid = out["sid"]
    w.gw.script_job("so_preview_", ["failed"])
    _, out = preview(w, job=job)
    a_sid = out["sid"]
    # a run never reaches b (a failed behind an on_success edge), so it never reaches c.
    status, out = preview(w, job=job, step_id="c", input=live(a={"sid": a_sid}, b={"sid": b_sid}))
    assert status == 409 and error(out) == "upstream_failed" and out["error"]["step"] == "a", out
