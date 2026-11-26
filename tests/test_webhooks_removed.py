"""1.50.1 removes Webhook, Slack, Teams, PagerDuty and ServiceNow actions and webhook
destinations; an Alert action does it instead, and is also the fallback notification's
second kind (next to email)."""
from so import actions as actionsmod
from so import hidden, retired
from test_actions import W
from test_api import job_body, w  # noqa: F401  (w is a fixture)
from test_follows import _follower

ALERTS = [{"name": "slack", "label": "Slack"}, {"name": "logevent", "label": "Log Event"}]


# -- saving --------------------------------------------------------------------

def test_a_job_with_a_webhook_action_is_refused_with_what_to_use_instead(w):
    for action in ({"hook": "on_failure", "type": "webhook", "destination": "ops"},
                   {"hook": "on_failure", "type": "webhook", "preset": "slack", "destination": "ops"}):
        status, out = w.call("alice", "POST", "/orchestrator/jobs/validate", job_body(actions=[action]))
        errors = [i for i in out["issues"] if i["level"] == "error"]
        assert [i["code"] for i in errors] == ["action_removed"], errors
        assert "Alert action" in errors[0]["message"]


def test_destination_routes_are_gone(w):
    for method, path in (("GET", "destinations"), ("POST", "destinations"), ("DELETE", "destinations/ops")):
        status, out = w.call("root", method, "/orchestrator/" + path, {})
        assert status == 404, (method, path)


def test_following_by_webhook_is_refused(w):
    w.gw.users["alice"]["email"] = "alice@example.com"
    w.call("alice", "POST", "/orchestrator/jobs", job_body())
    status, out = w.call("alice", "PUT", "/orchestrator/jobs/daily/follow",
                         {"on": ["failure"], "notify": {"type": "webhook", "destination": "ops"}})
    assert status == 400


# -- running -------------------------------------------------------------------

def test_a_webhook_action_from_before_is_skipped_and_the_fallback_steps_in():
    w = W(actions=[{"hook": "on_failure", "type": "webhook", "preset": "slack", "destination": "ops"}],
          settings={"fallback": {"type": "email", "to": "me@example.com"}})
    w.gw.script_job("_so_fallback_email", ["done"])
    w.submit("on_failure", "job")
    w.pump()
    assert [d["name"] for d in w.gw.dispatch_log] == ["_so_fallback_email"]
    skipped = w.audit.of("action_skipped")
    assert len(skipped) == 1 and skipped[0]["action_type"] == "webhook"
    assert "removed" in skipped[0]["reason"]


def test_a_follower_who_chose_a_webhook_gets_an_email_instead():
    w = W()
    _follower(w, notify={"type": "webhook", "destination": "ops"})
    w.gw.script_job("_so_fallback_email", ["done"])
    w.submit("on_failure", "job")
    w.pump()
    d = [x for x in w.gw.dispatch_log if x["name"] == "_so_fallback_email"][0]
    assert d["args"]["to"] == "bob@example.com"


def test_the_runner_has_no_webhook_code_left():
    for name in ("_post", "_webhook", "_destination", "_body_secret"):
        assert not hasattr(actionsmod.ActionRunner, name), name


# -- what an earlier version stored ----------------------------------------------

def test_stored_destinations_and_their_secrets_are_removed_once(w):
    gw = w.gw
    gw.kv_insert("so_settings", {"_key": "destinations", "destinations": [
        {"name": "ops", "url_secret_ref": "destination_ops_url", "headers_secret_ref": "destination_ops_headers",
         "body_secret_ref": None, "preset": "slack"}]})
    gw.kv_insert("so_settings", {"_key": "settings", "fallback": {"type": "webhook", "destination": "ops"}})
    gw.secrets.update(destination_ops_url="https://hooks.example.com/x", destination_ops_headers="{}",
                      other="keep me")
    events = []
    assert retired.forget_destinations(gw, events.append) is True
    assert gw.secrets == {"other": "keep me"}
    assert gw.kv_get("so_settings", "destinations") is None
    assert gw.kv_get("so_settings", "settings")["fallback"] is None
    assert [e["type"] for e in events] == ["destinations_removed"]
    assert events[0]["destinations"] == ["ops"] and events[0]["fallback_cleared"] is True
    assert retired.forget_destinations(gw, events.append) is False  # nothing left: says nothing
    assert len(events) == 1


# -- the fallback as an alert action ---------------------------------------------

def test_fallback_alert_action_is_checked_and_writes_the_apps_own_search(w):
    w.gw.alert_action_list = ALERTS
    put = lambda value: w.call("root", "PUT", "/orchestrator/settings", {"fallback": value})  # noqa: E731
    assert put({"type": "alert_action", "action": "nope"})[0] == 400  # not installed
    assert put({"type": "alert_action", "action": "slack", "params": {"bad name": "x"}})[0] == 400
    assert put({"type": "webhook", "destination": "ops"})[0] == 400
    status, out = put({"type": "alert_action", "action": "slack",
                       "params": {"channel": "#ops", "message": "{{job}} {{hook}}"}})
    assert status == 200, out
    assert out["settings"]["fallback"] == {"type": "alert_action", "action": "slack",
                                           "params": {"channel": "#ops", "message": "{{job}} {{hook}}"}}
    saved = w.gw.saved_searches[("nobody", hidden.FALLBACK_ALERT_SEARCH)]
    assert saved["search"] == ('| makeresults | sendalert $args.action$ param.channel="$args.param.channel$" '
                               'param.message="$args.param.message$"')
    status, out = w.call("alice", "GET", "/orchestrator/health")
    assert out["health"]["fallback_set"] is True


def test_fallback_alert_action_is_sent_as_nobody_with_its_values_filled_in():
    w = W(settings={"fallback": {"type": "alert_action", "action": "slack",
                                 "params": {"channel": "#ops", "message": "{{job}} {{hook}}"}}})
    w.gw.script_job(hidden.FALLBACK_ALERT_SEARCH, ["done"])
    w.submit("on_failure", "job")
    w.pump()
    d = w.gw.dispatch_log[0]
    assert d["owner"] == "nobody" and d["name"] == hidden.FALLBACK_ALERT_SEARCH
    assert d["args"]["action"] == "slack" and d["args"]["param.channel"] == "#ops"
    assert d["args"]["param.message"] == "Nightly on_failure"
