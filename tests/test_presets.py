"""Webhook presets: Teams, PagerDuty and ServiceNow bodies and their options."""
import pytest

from so import presets

URL = "https://splunk.example.com/app/search_orchestrator/run?run_id=r1"


def _ctx(**over):
    ctx = {"job": "Daily summary", "job_id": "daily", "run_id": "r1", "hook": "on_failure",
           "scope": "job", "step_id": None, "step": None, "status": "failed",
           "run_url": URL, "failed": []}
    ctx.update(over)
    return ctx


def test_teams_card():
    body = presets.render("teams", _ctx())
    assert body["type"] == "message"
    attachment = body["attachments"][0]
    assert attachment["contentType"] == "application/vnd.microsoft.card.adaptive"
    content = attachment["content"]
    assert content["type"] == "AdaptiveCard" and content["version"] == "1.4"
    texts = [b.get("text") for b in content["body"] if b.get("type") == "TextBlock"]
    assert "Daily summary failed" in texts
    facts = {f["title"]: f["value"] for b in content["body"] if b.get("type") == "FactSet"
             for f in b["facts"]}
    assert facts["Job"] == "Daily summary" and facts["Run"] == "r1"
    assert facts["Status"] == "failed"
    assert {"type": "Action.OpenUrl", "title": "Open run", "url": URL} in content["actions"]


def test_teams_card_names_the_step():
    body = presets.render("teams", _ctx(scope="step", step_id="load", step="Load"))
    content = body["attachments"][0]["content"]
    facts = {f["title"]: f["value"] for b in content["body"] if b.get("type") == "FactSet"
             for f in b["facts"]}
    assert facts["Step"] == "Load"


def test_pagerduty_trigger_and_resolve():
    body = presets.render("pagerduty", _ctx())
    assert body["event_action"] == "trigger" and body["dedup_key"] == "r1"
    assert body["payload"]["severity"] == "error"
    assert body["payload"]["source"] == "search_orchestrator"
    assert body["payload"]["summary"]
    assert body["payload"]["custom_details"] == {"job": "Daily summary", "run_id": "r1",
                                                 "step": None, "status": "failed",
                                                 "hook": "on_failure"}
    assert body["links"] == [{"href": URL, "text": "Open run"}]
    assert "routing_key" not in body  # merged from the destination's secret at send time
    step = presets.render("pagerduty", _ctx(scope="step", step_id="load", step="Load"))
    assert step["dedup_key"] == "r1:load"
    ok = presets.render("pagerduty", _ctx(hook="on_success", status="succeeded"))
    assert ok["event_action"] == "resolve" and ok["dedup_key"] == "r1"
    done = presets.render("pagerduty", _ctx(hook="on_complete", status="succeeded"))
    assert done["event_action"] == "resolve"
    still = presets.render("pagerduty", _ctx(hook="on_complete", status="failed"))
    assert still["event_action"] == "trigger"
    late = presets.render("pagerduty", _ctx(hook="on_late", status="running"))
    assert late["payload"]["severity"] == "warning"
    delayed = presets.render("pagerduty", _ctx(hook="on_delayed", status="running"))
    assert delayed["payload"]["severity"] == "warning"
    picked = presets.render("pagerduty", _ctx(hook="on_late"), {"severity": "critical"})
    assert picked["payload"]["severity"] == "critical"


def test_servicenow_incident():
    body = presets.render("servicenow", _ctx())
    assert body["urgency"] == "2" and body["impact"] == "2"
    assert body["correlation_id"] == "r1"
    assert body["short_description"] == "Search Orchestrator: Daily summary failed"
    assert URL in body["description"]
    assert "assignment_group" not in body
    picked = presets.render("servicenow", _ctx(), {"urgency": "1", "impact": "3",
                                                   "assignment_group": "Data platform"})
    assert picked["urgency"] == "1" and picked["impact"] == "3"
    assert picked["assignment_group"] == "Data platform"


def test_slack_and_generic_ignore_options():
    ctx = _ctx()
    assert presets.render("slack", ctx, {"severity": "info"}) == presets.render("slack", ctx)
    assert presets.render("generic", ctx) == presets.render(None, ctx)


def test_preset_options_table():
    assert presets.PRESET_OPTIONS == {
        "pagerduty": {"severity": ("critical", "error", "warning", "info")},
        "servicenow": {"urgency": ("1", "2", "3"), "impact": ("1", "2", "3"),
                       "assignment_group": str}}


@pytest.mark.parametrize("preset,options,message", [
    ("pagerduty", {"severity": "loud"}, "severity must be critical, error, warning or info"),
    ("servicenow", {"urgency": "4"}, "urgency must be 1, 2 or 3"),
    ("servicenow", {"impact": "0"}, "impact must be 1, 2 or 3"),
    ("servicenow", {"assignment_group": "x" * 101},
     "assignment group can be at most 100 characters"),
    ("slack", {"severity": "info"},
     "options only apply to Teams, PagerDuty and ServiceNow actions"),
    ("generic", {"urgency": "1"},
     "options only apply to Teams, PagerDuty and ServiceNow actions"),
])
def test_option_issues(preset, options, message):
    assert presets.option_issues(preset, options) == [message]


def test_option_issues_accept_good_and_empty_options():
    assert presets.option_issues("pagerduty", {"severity": "info"}) == []
    assert presets.option_issues("servicenow", {"urgency": "1", "impact": "3",
                                                "assignment_group": "x" * 100}) == []
    assert presets.option_issues("slack", None) == []
    assert presets.option_issues("generic", {}) == []
    assert presets.option_issues("teams", None) == []
    assert presets.option_issues("pagerduty", {"color": "red"})  # not an option of PagerDuty


def test_approval_requested_default_message():
    ctx = _ctx(hook="on_approval_requested", scope="step", step_id="gate", step="Sign-off",
               status="awaiting_approval")
    assert presets.default_message(ctx).startswith(
        'Step "Sign-off" of job "Daily summary" is waiting for approval (run r1')


def _approval_ctx(message="Check the totals before the weekly report"):
    return _ctx(hook="on_approval_requested", scope="step", step_id="gate", step="Sign-off",
                status="awaiting_approval", approval_message=message)


def test_approval_requested_message_reaches_every_preset():
    msg = "Check the totals before the weekly report"
    ctx = _approval_ctx(msg)
    text = presets.default_message(ctx)
    assert text.split("\n")[:2] == [
        'Step "Sign-off" of job "Daily summary" is waiting for approval (run r1).',
        "Message: " + msg]
    assert "awaiting_approval" not in text
    assert msg in presets.render("generic", ctx)["message"]
    slack = presets.render("slack", ctx)
    assert msg in slack["text"] and msg in slack["blocks"][0]["text"]["text"]
    assert "awaiting_approval" not in slack["blocks"][0]["text"]["text"]
    content = presets.render("teams", ctx)["attachments"][0]["content"]
    assert msg in [b.get("text") for b in content["body"] if b.get("type") == "TextBlock"]
    pd = presets.render("pagerduty", ctx)["payload"]
    assert pd["custom_details"]["approval_message"] == msg
    assert msg in presets.render("servicenow", ctx)["description"]


def test_approval_requested_without_a_message_adds_no_line():
    ctx = _approval_ctx("")
    assert "Message:" not in presets.default_message(ctx)
    assert "approval_message" not in presets.render("pagerduty", ctx)["payload"]["custom_details"]
    assert len(presets.render("teams", ctx)["attachments"][0]["content"]["body"]) == 2
