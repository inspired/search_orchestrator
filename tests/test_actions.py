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


SEARCH_TYPES = ("email", "event", "alert_action")


def _name_actions(actions, step_actions):
    """Give each search action the hidden_search name job save would write (flat index)."""
    flat = list(actions) + list(step_actions)
    for i, action in enumerate(flat):
        if action.get("type") in SEARCH_TYPES and "hidden_search" not in action:
            action["hidden_search"] = "_so_j_action_%d" % i


class W:
    def __init__(self, actions=None, step_actions=None, owner="alice", settings=None):
        _name_actions(actions or [], step_actions or [])
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
        for name in ["_so_fallback_email"] + ["_so_j_action_%d" % i for i in range(6)]:
            self.gw.script_job(name, ["done"])
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


# The example action: an email, which runs as a search (scripted done in W unless a test
# makes its dispatch fail).
WEBHOOK = {"hook": "on_failure", "type": "email", "to": "ops@example.com"}


def fallback_sends(w):
    return [d for d in w.gw.dispatch_log if d["name"] == "_so_fallback_email"]


def test_action_search_name():
    assert hidden.action_search_name("j", 2, "0123456789abcdef") == "_so_j_action_2_01234567"


def test_search_action_dispatches_snapshot_name_not_current_job():
    w = W(actions=[{"hook": "on_failure", "type": "email", "to": "a@b.c",
                    "hidden_search": "_so_j_action_0_aaaaaaaa"}])
    w.gw.script_job("_so_j_action_0_aaaaaaaa", ["done"])
    w.submit()
    job = w.store.get_job("j")
    job["actions"][0]["hidden_search"] = "_so_j_action_0_bbbbbbbb"  # edited after submit
    w.store.save_job(job)
    w.pump()
    assert w.gw.dispatch_log[0]["name"] == "_so_j_action_0_aaaaaaaa"


def test_search_action_without_hidden_name_fails_clearly():
    w = W(actions=[{"hook": "on_failure", "type": "email", "to": "a@b.c",
                    "hidden_search": None}])
    w.submit()
    w.pump()
    row = w.rows(kind="action")[0]
    assert row["state"] == "failed" and "re-save the job" in row["error"]
    assert not w.gw.dispatch_log


def test_action_retries_3_then_failed_without_changing_run():
    w = W(actions=[WEBHOOK])
    w.gw.fail_dispatch("_so_j_action_0", transient=True, times=99)
    w.submit()
    before = json.dumps(w.store.get_run("r1"), sort_keys=True)
    t = T
    for _ in range(6):
        w.pump(t)
        t += 1000
    row = w.rows(kind="action")[0]
    assert row["state"] == "failed" and row["attempts"] == 4 and "scripted dispatch error" in row["error"]
    assert json.dumps(w.store.get_run("r1"), sort_keys=True) == before
    assert len(w.audit.of("action_retry")) == 3 and len(
        [e for e in w.audit.of("action_failed") if not e["is_fallback"]]) == 1


def test_retry_waits_for_backoff():
    w = W(actions=[WEBHOOK])
    w.gw.fail_dispatch("_so_j_action_0", transient=True, times=99)
    w.submit()
    w.pump()
    assert w.pump(T + 5) == 0  # backoff(1) = 30 s
    assert w.pump(T + 31) == 1


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
    assert runs[0]["upstream"] == "r1" and runs[0]["_key"] == "down:r1:start_job:a0"
    w.submit(occurrence=5)  # same upstream run again: no second downstream run
    w.pump()
    assert len(w.store.list_runs({"job_id": "down"})) == 1
    assert all(r["state"] == "done" for r in w.rows(kind="action"))


def test_authz_can_run():
    from so.authz import can_run
    job = {"owner": "o", "run_roles": ["ops"]}
    assert can_run("o", job, [], ["orchestrator_run"]) and not can_run("o", job, [], [])
    assert can_run("x", job, [], ["orchestrator_admin"])
    assert can_run("x", job, ["ops"], ["orchestrator_run"])
    assert not can_run("x", job, ["ops"], [])
    assert not can_run("x", job, ["other"], ["orchestrator_run"])


FALLBACK = {"fallback": {"type": "email", "to": "fb@example.com"}}


def test_fallback_when_no_action():
    w = W(settings=FALLBACK)
    w.submit("on_failure", "job")
    w.submit("on_failure", "step", "a")  # same event: one fallback only
    assert len(w.rows(kind="fallback")) == 1
    w.pump()
    [sent] = fallback_sends(w)
    assert sent["owner"] == "nobody" and sent["args"]["to"] == "fb@example.com"
    assert "failed" in sent["args"]["subject"] and "/app/search_orchestrator/run?run_id=r1" in sent["args"]["message"]
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


def test_fallback_email_runs_the_apps_own_shared_search():
    # As Splunk has it: owned by nobody, shared in this app (default/savedsearches.conf). The
    # check for a replaced private search must not refuse it.
    w = W(settings={"fallback": {"type": "email", "to": "me@example.com"}})
    w.gw.upsert_saved_search("nobody", "_so_fallback_email", "| makeresults", "", "")
    w.gw.saved_searches[("nobody", "_so_fallback_email")]["sharing"] = "app"
    w.submit("on_failure", "job")
    w.pump()
    assert [d["name"] for d in w.gw.dispatch_log] == ["_so_fallback_email"]


def test_fallback_search_from_another_app_is_not_run():
    w = W(settings={"fallback": {"type": "email", "to": "me@example.com"}})
    w.gw.upsert_saved_search("nobody", "_so_fallback_email", "| makeresults", "", "")
    w.gw.saved_searches[("nobody", "_so_fallback_email")].update(sharing="global", app="evil")
    w.submit("on_failure", "job")
    w.pump()
    assert not w.gw.dispatch_log
    assert "_so_fallback_email" in w.rows(kind="fallback")[0]["error"]


def test_fallback_when_action_exhausted():
    w = W(actions=[WEBHOOK], settings=FALLBACK)
    w.gw.fail_dispatch("_so_j_action_0", transient=False)
    w.submit()
    w.pump()
    assert w.rows(kind="action")[0]["state"] == "failed"
    assert len(w.rows(kind="fallback")) == 1
    w.pump(T + 1)
    assert len(fallback_sends(w)) == 1 and fallback_sends(w)[0]["args"]["to"] == "fb@example.com"
    w.pump(T + 2)
    assert len(fallback_sends(w)) == 1


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
    sent = json.dumps(fallback_sends(w)[0]["args"])
    assert "SENSITIVE" not in sent and "secret_col" not in sent
    assert "Nightly" in sent and "Step A" in sent
    assert "SENSITIVE" not in json.dumps(w.rows(kind="fallback"))


def test_action_failure_audited():
    w = W(actions=[WEBHOOK])
    w.gw.fail_dispatch("_so_j_action_0", transient=False)
    w.submit()
    w.pump()
    ev = w.audit.of("action_failed")[0]
    assert ev["run_id"] == "r1" and ev["action_type"] == "email"
    assert "scripted dispatch error" in ev["error"]


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
    assert not fallback_sends(w)
    w.submit("on_failure", "job")  # later unhandled run failure
    w.pump()
    assert len(w.rows(kind="fallback")) == 1 and len(fallback_sends(w)) == 1


def test_job_level_failure_action_suppresses_fallback_on_step_failures():
    w = W(actions=[WEBHOOK], settings=FALLBACK)
    w.submit("on_failure", "step", "a")
    w.submit("on_failure", "job")
    assert not w.rows(kind="fallback")


def test_step_level_action_on_unhandled_failed_step_suppresses_fallback():
    w = W(step_actions=[{"hook": "on_failure", "type": "email", "to": "a@b.c"}],
          settings=FALLBACK)
    w.submit("on_failure", "job")
    assert not w.rows(kind="fallback")


def test_delay_fallback_decided_on_job_event():
    w = W(settings=FALLBACK)
    w.submit("on_delayed", "step", "a")
    assert not w.rows(kind="fallback")
    w.submit("on_delayed", "job")
    assert len(w.rows(kind="fallback")) == 1
    w2 = W(step_actions=[{"hook": "on_delayed", "type": "email", "to": "a@b.c"}],
           settings=FALLBACK)
    w2.run["steps"]["a"]["delay_alerted"] = True
    w2.submit("on_delayed", "job")
    assert not w2.rows(kind="fallback")


def test_rejected_run_action_is_sent_from_snapshot():
    w = W(actions=[WEBHOOK], settings=FALLBACK)
    ghost = dict(w.run, _key="ghost", id="ghost", state="rejected")  # never saved
    w.runner.submit(ghost, "on_failure", "job", None)
    w.pump()
    w.pump(T + 5)
    assert w.rows(kind="action")[0]["state"] == "done"
    assert [d["name"] for d in w.gw.dispatch_log] == ["_so_j_action_0"] and not w.rows(kind="fallback")


def test_pump_budget_stops_new_sends():
    w = W(settings=FALLBACK)
    ticks = iter(range(0, 1000, 3))  # each clock read advances 3 s
    w.runner.monotonic = lambda: next(ticks)
    for n in range(4):
        w.run = dict(w.run, _key="r%d" % n, id="r%d" % n)
        w.submit("on_failure", "job")
    w.pump()
    assert 0 < len(fallback_sends(w)) < 4
    assert len([r for r in w.rows(kind="fallback") if r["state"] == "pending"]) > 0
    w.runner.monotonic = lambda: 0
    w.pump(T + 1)
    assert len(fallback_sends(w)) == 4


def test_pump_stops_when_lease_lost_with_rows_saved():
    w = W(settings=FALLBACK)
    for n in range(3):
        w.run = dict(w.run, _key="r%d" % n, id="r%d" % n)
        w.submit("on_failure", "job")
    calls = []

    def keep(force=False):
        if force:  # the renewal right before each send
            return
        calls.append(1)
        if len(calls) == 2:
            raise RuntimeError("lease lost")

    with pytest.raises(RuntimeError):
        w.runner.pump(T, keep_lease=keep)
    assert len(fallback_sends(w)) == 1
    assert [r["state"] for r in w.rows(kind="fallback")].count("pending") == 3  # one is sent, waiting for its search


def test_start_job_chain_depth_limit():
    w = W(actions=[{"hook": "on_failure", "type": "start_job", "job": "j"}])
    w.gw.users["alice"] = {"roles": [], "capabilities": ["orchestrator_admin"]}
    run = w.run
    for depth in range(12):
        run = dict(run, _key="c%d" % depth, id="c%d" % depth, chain_depth=depth)
        w.store.save_run(run)
        w.runner.submit(run, "on_failure", "job", None)
        w.pump(T + depth)
        child = w.store.get_run("j:c%d:start_job:a0" % depth)
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

    w.gw.fail_dispatch("_so_j_action_0", transient=True, times=99)
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


# Final review I5: $run.*$ and $step.*$ tokens in action templates.

def _token_world(actions):
    w = W(actions=actions)
    w.definition["steps"].append({"id": "daily", "name": "Daily",
                                  "spl": "| makeresults | eval h=\"$daily.first.host$\""})
    w.run["params"] = {"region": 'e"u'}
    w.run["steps"]["daily"] = {"state": "succeeded", "sid": "s9", "result_count": 42,
                               "first": {"host": 'web"1'}}
    w.store.save_run(w.run)
    return w


def test_email_tokens_rendered_and_spl_escaped():
    w = _token_world([{"hook": "on_failure", "type": "email", "to": "a@b.c",
                       "subject": "Daily rows: $daily.resultCount$",
                       "message": "Run $run.id$ at $run.scheduled_time$ for $run.param.region$, "
                                  "host $daily.first.host$, weekly $weekly.sid|none$ {{job}}"}])
    w.gw.script_job("_so_j_action_0", ["done"])
    w.submit()
    w.pump()
    args = w.gw.dispatch_log[0]["args"]
    assert args["subject"] == "Daily rows: 42"
    assert args["message"] == ('Run r1 at %d for e\\"u, host web\\"1, weekly $weekly.sid|none$ '
                               'Nightly' % (T - 100))


def test_token_default_and_missing_values_in_messages():
    w = _token_world([{"hook": "on_failure", "type": "email", "to": "a@b.c",
                       "subject": "$a.sid$ $a.resultCount|none$ $a.status$ $run.param.nope$|"}])
    w.gw.script_job("_so_j_action_0", ["done"])
    w.submit()
    w.pump()
    assert w.gw.dispatch_log[0]["args"]["subject"] == "s1 none failed |"


def test_event_and_alert_action_tokens_rendered():
    w = _token_world([{"hook": "on_failure", "type": "event", "index": "audit",
                       "payload": {"rows": "$daily.resultCount$", "host": "$daily.first.host$"}},
                      {"hook": "on_failure", "type": "alert_action", "action": "pagerduty",
                       "params": {"summary": "$daily.status$ in $run.param.region$"}}])
    w.gw.script_job("_so_j_action_0", ["done"])
    w.gw.script_job("_so_j_action_1", ["done"])
    w.submit()
    w.pump()
    event, alert = w.gw.dispatch_log
    assert event["args"]["payload"] == '{\\"rows\\": \\"42\\", \\"host\\": \\"web\\\\\\"1\\"}'
    assert alert["args"]["param.summary"] == 'succeeded in e\\"u'


def test_first_fields_include_action_template_tokens():
    from so.engine import first_fields
    definition = {"steps": [{"id": "daily", "spl": "| makeresults"}],
                  "actions": [{"hook": "on_success", "type": "email", "to": "x",
                               "subject": "$daily.first.host$"},
                              {"hook": "on_success", "type": "webhook", "destination": "d",
                               "body": {"a": ["$daily.first.count$"]}}]}
    assert first_fields(definition) == {"daily": {"host", "count"}}


def test_failed_search_link_points_at_search_page():
    # Final review M1.
    w = W(settings=FALLBACK)
    w.submit()
    w.pump()
    assert "Failed search (Step A): /app/search/search?sid=s1" in fallback_sends(w)[0]["args"]["message"]
    w = W(settings=dict(FALLBACK, base_url="https://splunk.example.com:8000/"))
    w.submit()
    w.pump()
    assert "https://splunk.example.com:8000/app/search/search?sid=s1" in fallback_sends(w)[0]["args"]["message"]


def test_two_start_job_actions_to_one_target_start_two_runs_once():
    # Final review M15.
    from so import scheduler
    w = W(actions=[{"hook": "on_failure", "type": "start_job", "job": "down"},
                   {"hook": "on_failure", "type": "start_job", "job": "down"}])
    _job(w, "down")
    w.gw.users["alice"] = {"roles": [], "capabilities": ["orchestrator_admin"]}
    w.submit()
    w.pump()
    keys = sorted(r["_key"] for r in w.store.list_runs({"job_id": "down"}))
    assert keys == ["down:r1:start_job:a0", "down:r1:start_job:a1"]
    assert all(scheduler.is_run_id(k) for k in keys)
    # A replay (a crash before the row's save) finds the runs and creates no more.
    row = w.rows(kind="action")[0]
    for entry in row["actions"]:
        entry.update(state="pending", attempts=0)
    row["state"] = "pending"
    w.gw.kv["so_action_runs"][row["_key"]] = row
    w.pump()
    assert len(w.store.list_runs({"job_id": "down"})) == 2
    assert all(e["state"] == "done" for e in w.rows(kind="action")[0]["actions"])


def test_on_late_uses_the_fallback_without_a_job_level_on_late_action():
    w = W(settings=FALLBACK)
    w.run["state"] = "running"
    w.submit("on_late", "job", occurrence=0)
    assert [r["hook"] for r in w.rows(kind="fallback")] == ["on_late"]
    w.pump()
    assert "is late" in fallback_sends(w)[0]["args"]["subject"]


def test_on_late_has_no_fallback_with_a_job_level_on_late_action():
    w = W(actions=[dict(WEBHOOK, hook="on_late")], settings=FALLBACK)
    w.run["state"] = "running"
    assert w.submit("on_late", "job", occurrence=0)
    assert not w.rows(kind="fallback")


def test_on_late_action_out_of_retries_sends_the_fallback():
    w = W(actions=[dict(WEBHOOK, hook="on_late")], settings=FALLBACK)
    w.gw.fail_dispatch("_so_j_action_0", transient=False)
    w.submit("on_late", "job", occurrence=0)
    w.pump()
    assert len(w.rows(kind="fallback")) == 1


def test_on_late_message_verb():
    text = presets.default_message({"job": "Daily summary", "run_id": "r1", "hook": "on_late",
                                    "scope": "job", "status": "running"})
    assert text.startswith('Job "Daily summary" is late (run r1, status running).')


# Teams, PagerDuty and ServiceNow presets.


def test_ctx_has_approval_message_for_approval_requested():
    run = {"_key": "r1", "job_id": "daily", "state": "running",
           "definition": {"name": "Daily", "steps": [{"id": "gate", "name": "Sign-off",
                                                      "type": "approval"}]},
           "steps": {"gate": {"state": "awaiting_approval",
                              "approval_state": {"requested_at": 1, "message": "Rows: 12",
                                                 "decision": None}}}}
    ctx = ActionRunner._ctx(run, "on_approval_requested", "step", "gate")
    assert ctx["approval_message"] == "Rows: 12"
    assert "approval_message" not in ActionRunner._ctx(run, "on_start", "step", "gate")


def test_only_if_results_skips_the_action_when_the_step_found_nothing():
    mail = {"hook": "on_success", "type": "email", "to": "ops@example.com", "only_if_results": True}
    always = {"hook": "on_success", "type": "email", "to": "boss@example.com"}
    w = W(step_actions=[mail, always])
    w.run["steps"]["a"] = {"state": "succeeded", "sid": "s1", "result_count": 0}
    assert w.runner.submit(w.run, "on_success", "step", "a") is True
    row = w.gw.kv["so_action_runs"]["r1:step:on_success:a:0"]
    assert [e["action"]["to"] for e in row["actions"]] == ["boss@example.com"]
    w.run["steps"]["a"]["result_count"] = 3
    w.run["rerun_count"] = 1
    w.runner.submit(w.run, "on_success", "step", "a")
    row = w.gw.kv["so_action_runs"]["r1:step:on_success:a:1"]
    assert [e["action"]["to"] for e in row["actions"]] == ["ops@example.com", "boss@example.com"]


def test_only_if_results_saves_through_the_api():
    from test_api import World, job_body
    w = World()
    body = job_body()
    body["steps"][0]["actions"] = [{"hook": "on_success", "type": "email", "to": "ops@example.com",
                                    "only_if_results": True}]
    status, out = w.call("alice", "POST", "/orchestrator/jobs", body)
    assert status == 201, out
    assert out["job"]["steps"][0]["actions"][0]["only_if_results"] is True


def test_an_action_condition_leaves_the_action_out_when_false():
    big = {"hook": "on_success", "type": "email", "to": "big@example.com", "condition": "$a.resultCount$ > 100"}
    w = W(step_actions=[big])
    w.run["steps"]["a"] = {"state": "succeeded", "sid": "s1", "result_count": 5}
    assert w.runner.submit(w.run, "on_success", "step", "a") is False
    w.run["steps"]["a"]["result_count"] = 500
    w.run["rerun_count"] = 1
    assert w.runner.submit(w.run, "on_success", "step", "a") is True


def test_an_action_condition_is_checked_on_save():
    from so import model
    from test_api import job_body
    body = job_body()
    body["steps"][0]["actions"] = [{"hook": "on_success", "type": "email", "to": "x@example.com", "condition": "$nope.resultCount$ >"}]
    assert any(i["code"] in ("bad_expression", "unknown_token") and i["level"] == "error" for i in model.validate_job(body))


def test_an_action_sets_its_own_retries_and_first_wait():
    from so.actions import retry_delay, retry_plan
    assert retry_plan({}) == (3, None)
    assert retry_plan({"retries": 0, "retry_wait": 120}) == (0, 120)
    assert retry_plan({"retries": 99, "retry_wait": 5}) == (3, None)  # out of range: defaults
    assert [retry_delay(n, 120) for n in (1, 2, 3, 6)] == [120, 240, 480, 3600]
    boom = lambda *a: (_ for _ in ()).throw(
        __import__("so.gateway", fromlist=["x"]).GatewayError("boom", transient=True))
    w = W(actions=[dict(WEBHOOK, retries=1, retry_wait=60)])
    w.gw.fail_dispatch("_so_j_action_0", transient=True, times=99)
    w.submit()
    w.pump(T)
    assert w.pump(T + 31) == 0 and w.pump(T + 61) == 1  # waited its own 60 s
    row = w.rows(kind="action")[0]
    assert row["state"] == "failed" and row["attempts"] == 2
    w2 = W(actions=[dict(WEBHOOK, retries=0)])
    w2.gw.fail_dispatch("_so_j_action_0", transient=True, times=99)
    w2.submit()
    w2.pump(T)
    assert w2.rows(kind="action")[0]["state"] == "failed"  # no retry at all


def test_event_action_sets_source_sourcetype_host_and_time():
    from so import hidden
    plain = hidden.action_spl({"type": "event", "index": "main"})
    assert "sourcetype=" not in plain and "_time=$args.time$" in plain
    full = hidden.action_spl({"type": "event", "index": "main", "source": "s", "sourcetype": "st", "host": "h"})
    assert 'source="$args.source$" sourcetype="$args.sourcetype$" host="$args.host$"' in full
    w = W(actions=[{"hook": "on_failure", "type": "event", "index": "main", "payload": "x",
                    "sourcetype": "orch:event", "time": "scheduled"}])
    w.gw.script_job(w.definition["actions"][0]["hidden_search"], ["done"])
    w.submit()
    w.pump()
    args = w.gw.dispatch_log[-1]["args"]
    assert args["sourcetype"] == "orch:event" and args["time"] == str(T - 100)
    assert "host" not in args


def test_alert_search_replaced_by_someone_elses_shared_search_is_not_run():
    w = W(actions=[{"hook": "on_failure", "type": "email", "to": "a@b.c"}])
    w.gw.upsert_saved_search("mallory", "_so_j_action_0", "| sendemail to=x@evil.example", "", "")
    w.gw.saved_searches[("mallory", "_so_j_action_0")]["sharing"] = "global"
    w.submit()
    w.pump()
    assert not w.gw.dispatch_log
    row = w.rows(kind="action")[0]
    assert row["state"] == "failed" and "mallory" in row["error"]


