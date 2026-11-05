"""Action runner and fallback tests."""
import json

import pytest
from fakes import FakeGateway
from so import hidden, presets
from so.actions import ActionRunner
from so.gateway import DispatchError
from so.store import Store

T = 1_800_000_000


class RecordingAudit:
    def __init__(self):
        self.events = []

    def emit(self, event):
        self.events.append(dict(event))

    def of(self, kind):
        return [e for e in self.events if e.get("type") == kind]


class W:
    def __init__(self, actions=None, step_actions=None, owner="alice", settings=None):
        self.gw = FakeGateway()
        self.store = Store(self.gw)
        self.audit = RecordingAudit()
        self.t = T
        self.runner = ActionRunner(self.gw, self.store, self.audit, lambda: self.t)
        steps = [{"id": "a", "name": "Step A", "actions": step_actions or []}]
        self.definition = {"id": "j", "name": "Nightly", "owner": owner, "steps": steps,
                           "actions": actions or []}
        self.run = {"_key": "r1", "id": "r1", "job_id": "j", "owner": owner, "state": "failed",
                    "scheduled_time": T - 100, "definition": self.definition, "rerun_count": 0,
                    "steps": {"a": {"state": "failed", "sid": "s1"}}}
        self.store.save_run(self.run)
        self.store.save_job(dict(self.definition, _key="j"))
        self.gw.kv_insert("so_settings", dict({"_key": "settings"}, **(settings or {})))
        self.gw.kv_insert("so_settings", {"_key": "destinations", "destinations": [
            {"name": "ops", "url_secret_ref": "ops_url", "headers_secret_ref": "ops_hdr",
             "preset": "slack"},
            {"name": "fb", "url_secret_ref": "fb_url", "headers_secret_ref": None,
             "preset": "generic"}]})
        self.gw.secrets.update(ops_url="https://hooks.example.com/T0/SECRETTOKEN",
                               ops_hdr=json.dumps({"Authorization": "Bearer TOPSECRET"}),
                               fb_url="https://fb.example.com/x")

    def submit(self, hook="on_failure", scope="job", step_id=None, **kw):
        return self.runner.submit(self.run, hook, scope, step_id, **kw)

    def pump(self, at=None):
        if at is not None:
            self.t = at
        return self.runner.pump(self.t)

    def rows(self, **match):
        return [r for r in self.gw.kv.get("so_action_runs", {}).values()
                if all(r.get(k) == v for k, v in match.items())]


WEBHOOK = {"hook": "on_failure", "type": "webhook", "destination": "ops", "preset": "slack"}


def test_action_search_name():
    assert hidden.action_search_name("j", 2) == "_so_j_action_2"


def test_webhook_posts_and_marks_done():
    w = W(actions=[WEBHOOK])
    assert w.submit() and not w.submit()
    w.pump()
    assert len(w.gw.webhook_log) == 1
    hook = w.gw.webhook_log[0]
    assert hook["headers"]["Authorization"] == "Bearer TOPSECRET"
    assert json.loads(hook["body"])["text"].startswith('Job "Nightly" failed')
    assert w.rows(kind="action")[0]["state"] == "done"
    assert not w.rows(kind="fallback")


def test_webhook_retries_3_then_failed_without_changing_run():
    w = W(actions=[WEBHOOK])
    w.gw.secrets["ops_url"] = "https://hooks.example.com/x"
    w.gw.post_webhook = lambda *a: (_ for _ in ()).throw(
        __import__("so.gateway", fromlist=["x"]).GatewayError("boom", transient=True))
    w.submit()
    before = json.dumps(w.store.get_run("r1"), sort_keys=True)
    t = T
    for _ in range(6):
        w.pump(t)
        t += 1000
    row = w.rows(kind="action")[0]
    assert row["state"] == "failed" and row["attempts"] == 4 and row["error"] == "boom"
    assert json.dumps(w.store.get_run("r1"), sort_keys=True) == before
    assert len(w.audit.of("action_retry")) == 3 and len(
        [e for e in w.audit.of("action_failed") if not e["is_fallback"]]) == 1


def test_retry_waits_for_backoff():
    w = W(actions=[WEBHOOK])
    w.gw.post_webhook = lambda *a: (_ for _ in ()).throw(
        __import__("so.gateway", fromlist=["x"]).GatewayError("boom", transient=True))
    w.submit()
    w.pump()
    assert w.pump(T + 5) == 0  # backoff(1) = 30 s
    assert w.pump(T + 31) == 1


def test_webhook_https_only_rejected_at_runtime():
    w = W(actions=[WEBHOOK])
    w.gw.secrets["ops_url"] = "http://internal.example.com/secretpath"
    w.submit()
    w.pump()
    row = w.rows(kind="action")[0]
    assert row["state"] == "failed" and row["attempts"] == 1
    assert not w.gw.webhook_log
    assert "secretpath" not in row["error"] and "internal.example.com" in row["error"]


def test_slack_preset_body():
    ctx = {"job": "Nightly", "run_id": "r1", "hook": "on_failure", "scope": "step",
           "step": "Step A", "status": "failed", "run_url": "/app/x/run?run_id=r1",
           "failed": [{"step": "Step A", "url": "/app/search/job_inspector?sid=s1"}]}
    body = presets.render("slack", ctx)
    assert "Step A" in body["text"] and "/app/x/run?run_id=r1" in body["text"]
    assert "job_inspector?sid=s1" in json.dumps(body["blocks"])
    assert presets.render("generic", ctx)["failed_searches"][0]["step"] == "Step A"
    with pytest.raises(ValueError):
        presets.render("nope", ctx)


def test_email_runs_as_owner():
    w = W(actions=[{"hook": "on_failure", "type": "email", "to": 'ops@example.com',
                    "subject": "{{job}} broke"}])
    w.gw.script_job("_so_j_action_0", ["done"])
    w.submit()
    w.pump()
    d = w.gw.dispatch_log[0]
    assert d["owner"] == "alice" and d["name"] == "_so_j_action_0"
    assert d["now"] == T - 100 and d["trigger_actions"] is False
    assert d["args"]["to"] == "ops@example.com" and d["args"]["subject"] == "Nightly broke"
    assert "run_id" in d["args"]
    w.pump(T + 5)
    assert w.rows(kind="action")[0]["state"] == "done"


def test_search_action_failure_retries_then_succeeds():
    w = W(actions=[{"hook": "on_failure", "type": "email", "to": "a@b.c"}])
    w.gw.script_job("_so_j_action_0", ["failed"])
    w.submit()
    w.pump()
    w.pump(T + 1)  # poll: failed -> retry scheduled
    row = w.rows(kind="action")[0]
    assert row["state"] == "pending" and row["actions"][0]["attempts"] == 1
    w.gw.script_job("_so_j_action_0", ["done"])
    w.pump(T + 100)
    w.pump(T + 101)
    assert w.rows(kind="action")[0]["state"] == "done"


def test_alert_action_search_uses_sendalert_as_owner():
    w = W(actions=[{"hook": "on_failure", "type": "alert_action", "action": "pagerduty",
                    "params": {"severity": "high"}}])
    w.gw.script_job("_so_j_action_0", ["done"])
    w.submit()
    w.pump()
    d = w.gw.dispatch_log[0]
    assert d["owner"] == "alice" and d["args"]["action"] == "pagerduty"
    assert d["args"]["param.severity"] == "high"


def test_event_action_uses_collect_as_owner():
    w = W(step_actions=[{"hook": "on_success", "type": "event", "index": "audit"}],
          actions=[{"hook": "on_failure", "type": "webhook", "destination": "ops"}])
    w.gw.script_job("_so_j_action_1", ["done"])  # flat index: job actions first
    w.submit("on_success", "step", "a")
    w.pump()
    d = w.gw.dispatch_log[0]
    assert d["owner"] == "alice" and d["name"] == "_so_j_action_1"
    assert d["args"]["index"] == "audit"
    assert json.loads(d["args"]["payload"].replace('\\"', '"'))["hook"] == "on_success"


def test_args_are_spl_escaped():
    w = W(actions=[{"hook": "on_failure", "type": "email", "to": 'a"b'}])
    w.gw.script_job("_so_j_action_0", ["done"])
    w.submit()
    w.pump()
    assert w.gw.dispatch_log[0]["args"]["to"] == 'a\\"b'


def _job(w, job_id, **over):
    w.store.save_job(dict({"_key": job_id, "id": job_id, "name": job_id, "owner": "bob",
                           "steps": [{"id": "s", "type": "inline", "spl": "x"}],
                           "params": [], "actions": []}, **over))


def test_start_job_requires_owner_permission():
    w = W(actions=[{"hook": "on_failure", "type": "start_job", "job": "down"}])
    _job(w, "down")
    w.submit()
    w.pump()
    row = w.rows(kind="action")[0]
    assert row["state"] == "failed" and "may not run" in row["error"]
    assert w.store.list_runs({"job_id": "down"}) == []
    # a listed role that also holds orchestrator_run is allowed
    w2 = W(actions=[{"hook": "on_failure", "type": "start_job", "job": "down"}])
    _job(w2, "down", run_roles=["ops"])
    w2.gw.users["alice"] = {"roles": ["ops"], "capabilities": ["orchestrator_run"]}
    w2.submit()
    w2.pump()
    assert w2.rows(kind="action")[0]["state"] == "done"


def test_start_job_inherits_scheduled_time():
    w = W(actions=[{"hook": "on_failure", "type": "start_job", "job": "down"}])
    _job(w, "down")
    w.gw.users["alice"] = {"roles": [], "capabilities": ["orchestrator_admin"]}
    w.submit()
    w.pump()
    runs = w.store.list_runs({"job_id": "down"})
    assert len(runs) == 1 and runs[0]["scheduled_time"] == T - 100
    assert runs[0]["upstream"] == "r1" and runs[0]["_key"] == "down:r1:start_job"
    w.submit(occurrence=5)  # same upstream run again: no second downstream run
    w.pump()
    assert len(w.store.list_runs({"job_id": "down"})) == 1
    assert all(r["state"] == "done" for r in w.rows(kind="action"))


def test_authz_can_run():
    from so.authz import can_run
    job = {"owner": "o", "run_roles": ["ops"]}
    assert can_run("o", job, [], [])
    assert can_run("x", job, [], ["orchestrator_admin"])
    assert can_run("x", job, ["ops"], ["orchestrator_run"])
    assert not can_run("x", job, ["ops"], [])
    assert not can_run("x", job, ["other"], ["orchestrator_run"])


FALLBACK = {"fallback": {"type": "webhook", "destination": "fb"}}


def test_fallback_when_no_action():
    w = W(settings=FALLBACK)
    w.submit("on_failure", "job")
    w.submit("on_failure", "step", "a")  # same event: one fallback only
    assert len(w.rows(kind="fallback")) == 1
    w.pump()
    assert len(w.gw.webhook_log) == 1 and w.gw.webhook_log[0]["url"].startswith("https://fb.")
    body = json.loads(w.gw.webhook_log[0]["body"])
    assert body["hook"] == "on_failure" and "/app/search_orchestrator/run?run_id=r1" in body["run_url"]
    w.submit("on_start", "job")  # not a fallback hook
    assert len(w.rows(kind="fallback")) == 1


def test_fallback_replay_after_crash_is_idempotent():
    w = W(settings=FALLBACK)
    w.submit()
    assert not w.submit()
    assert len(w.rows(kind="fallback")) == 1


def test_fallback_email_uses_system_search_as_nobody():
    w = W(settings={"fallback": {"type": "email", "to": "me@example.com"}})
    w.gw.script_job("_so_fallback_email", ["done"])
    w.submit("on_delayed", "job")
    w.pump()
    d = w.gw.dispatch_log[0]
    assert d["owner"] == "nobody" and d["name"] == "_so_fallback_email"
    assert d["args"]["to"] == "me@example.com"


def test_fallback_when_action_exhausted():
    w = W(actions=[WEBHOOK], settings=FALLBACK)
    w.gw.secrets["ops_url"] = "http://bad.example.com/x"
    w.submit()
    w.pump()
    assert w.rows(kind="action")[0]["state"] == "failed"
    assert len(w.rows(kind="fallback")) == 1
    w.pump(T + 1)
    assert len(w.gw.webhook_log) == 1 and w.gw.webhook_log[0]["url"].startswith("https://fb.")
    w.pump(T + 2)
    assert len(w.gw.webhook_log) == 1


def test_fallback_not_sent_when_action_succeeds_or_other_hook():
    w = W(actions=[WEBHOOK], settings=FALLBACK)
    w.submit()
    w.pump()
    assert not w.rows(kind="fallback")


def test_fallback_without_destination_fails_and_is_audited():
    w = W()
    w.submit()
    w.pump()
    row = w.rows(kind="fallback")[0]
    assert row["state"] == "failed" and "no fallback" in row["error"]
    assert w.audit.of("action_failed")[0]["is_fallback"] is True


def test_fallback_content_has_no_results_data():
    w = W(settings=FALLBACK)
    w.run["steps"]["a"]["first"] = {"secret_col": "SENSITIVE"}
    w.run["steps"]["a"]["result_count"] = 99
    w.submit()
    w.pump()
    sent = w.gw.webhook_log[0]["body"]
    assert "SENSITIVE" not in sent and "secret_col" not in sent
    assert "Nightly" in sent and "Step A" in sent
    assert "SENSITIVE" not in json.dumps(w.rows(kind="fallback"))


def test_action_failure_audited():
    w = W(actions=[{"hook": "on_failure", "type": "webhook", "destination": "missing"}])
    w.submit()
    w.pump()
    ev = w.audit.of("action_failed")[0]
    assert ev["run_id"] == "r1" and ev["action_type"] == "webhook"
    assert "missing" in ev["error"]


def test_action_secret_not_in_audit():
    w = W(actions=[WEBHOOK])
    w.submit()
    w.pump()
    w.gw.secrets["ops_url"] = "https://hooks.example.com/T0/SECRETTOKEN"
    w2 = W(actions=[WEBHOOK])
    w2.gw.post_webhook = lambda url, h, b: (_ for _ in ()).throw(
        __import__("so.gateway", fromlist=["x"]).GatewayError("failed for " + url, transient=False))
    w2.submit()
    w2.pump()
    for world in (w, w2):
        blob = json.dumps(world.audit.events) + json.dumps(world.rows())
        assert "SECRETTOKEN" not in blob and "TOPSECRET" not in blob
    done = w.audit.of("action_done")[0]
    assert done["scheme"] == "https" and done["host"] == "hooks.example.com"


def test_removed_owner_fails_search_action_without_raising():
    w = W(actions=[{"hook": "on_failure", "type": "email", "to": "a@b.c"}])
    w.gw.removed_users.add("alice")
    w.submit()
    w.pump()
    assert w.rows(kind="action")[0]["state"] == "failed"


# Fix round 1.

def _fail_run(w, step_state="failed"):
    w.run["steps"]["a"]["state"] = step_state


def test_handled_step_failure_does_not_consume_fallback():
    w = W(settings=FALLBACK)
    w.definition["edges"] = [{"from": "a", "to": "b", "condition": "on_failure"}]
    w.submit("on_failure", "step", "a")  # handled step failure
    assert not w.rows(kind="fallback")
    w.pump()
    assert not w.gw.webhook_log
    w.submit("on_failure", "job")  # later unhandled run failure
    w.pump()
    assert len(w.rows(kind="fallback")) == 1 and len(w.gw.webhook_log) == 1


def test_job_level_failure_action_suppresses_fallback_on_step_failures():
    w = W(actions=[WEBHOOK], settings=FALLBACK)
    w.submit("on_failure", "step", "a")
    w.submit("on_failure", "job")
    assert not w.rows(kind="fallback")


def test_step_level_action_on_unhandled_failed_step_suppresses_fallback():
    w = W(step_actions=[{"hook": "on_failure", "type": "webhook", "destination": "ops"}],
          settings=FALLBACK)
    w.submit("on_failure", "job")
    assert not w.rows(kind="fallback")


def test_delay_fallback_decided_on_job_event():
    w = W(settings=FALLBACK)
    w.submit("on_delayed", "step", "a")
    assert not w.rows(kind="fallback")
    w.submit("on_delayed", "job")
    assert len(w.rows(kind="fallback")) == 1
    w2 = W(step_actions=[{"hook": "on_delayed", "type": "webhook", "destination": "ops"}],
           settings=FALLBACK)
    w2.run["steps"]["a"]["delay_alerted"] = True
    w2.submit("on_delayed", "job")
    assert not w2.rows(kind="fallback")


def test_rejected_run_action_is_sent_from_snapshot():
    w = W(actions=[WEBHOOK], settings=FALLBACK)
    ghost = dict(w.run, _key="ghost", id="ghost", state="rejected")  # never saved
    w.runner.submit(ghost, "on_failure", "job", None)
    w.pump()
    assert w.rows(kind="action")[0]["state"] == "done"
    assert len(w.gw.webhook_log) == 1 and not w.rows(kind="fallback")


def test_pump_budget_stops_new_sends():
    w = W(settings=FALLBACK)
    ticks = iter(range(0, 1000, 3))  # each clock read advances 3 s
    w.runner.monotonic = lambda: next(ticks)
    for n in range(4):
        w.run = dict(w.run, _key="r%d" % n, id="r%d" % n)
        w.submit("on_failure", "job")
    w.pump()
    assert 0 < len(w.gw.webhook_log) < 4
    assert len([r for r in w.rows(kind="fallback") if r["state"] == "pending"]) > 0
    w.runner.monotonic = lambda: 0
    w.pump(T + 1)
    assert len(w.gw.webhook_log) == 4


def test_pump_stops_when_lease_lost_with_rows_saved():
    w = W(settings=FALLBACK)
    for n in range(3):
        w.run = dict(w.run, _key="r%d" % n, id="r%d" % n)
        w.submit("on_failure", "job")
    calls = []

    def keep():
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("lease lost")

    with pytest.raises(RuntimeError):
        w.runner.pump(T, keep_lease=keep)
    assert len(w.gw.webhook_log) == 1
    assert [r["state"] for r in w.rows(kind="fallback")].count("done") == 1


def test_start_job_chain_depth_limit():
    w = W(actions=[{"hook": "on_failure", "type": "start_job", "job": "j"}])
    w.gw.users["alice"] = {"roles": [], "capabilities": ["orchestrator_admin"]}
    run = w.run
    for depth in range(12):
        run = dict(run, _key="c%d" % depth, id="c%d" % depth, chain_depth=depth)
        w.store.save_run(run)
        w.runner.submit(run, "on_failure", "job", None)
        w.pump(T + depth)
        child = w.store.get_run("j:c%d:start_job" % depth)
        if child is None:
            break
        assert child["chain_depth"] == depth + 1
        run = child
    assert depth == 10
    failed = [r for r in w.rows(kind="action") if r["state"] == "failed"]
    assert "chain depth limit (10)" in failed[0]["error"]
    assert w.audit.of("chain_depth_exceeded")


def test_invalid_url_error_text_is_scrubbed():
    import http.client
    w = W(actions=[WEBHOOK])

    def boom(url, headers, body):
        raise http.client.InvalidURL("URL can't contain control characters. '/T0/SECRETTOKEN'")

    w.gw.post_webhook = boom
    w.submit()
    w.pump()
    assert "SECRETTOKEN" not in json.dumps(w.rows()) + json.dumps(w.audit.events)


def test_event_payload_non_string_is_json_encoded():
    w = W(actions=[{"hook": "on_failure", "type": "event", "index": "i",
                    "payload": {"job": "{{job}}"}}])
    w.gw.script_job("_so_j_action_0", ["done"])
    w.submit()
    w.pump()
    assert json.loads(w.gw.dispatch_log[0]["args"]["payload"].replace('\\"', '"')) == \
        {"job": "Nightly"}
