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


def test_approval_requested_default_message():
    ctx = _ctx(hook="on_approval_requested", scope="step", step_id="gate", step="Sign-off",
               status="awaiting_approval")
    assert presets.default_message(ctx).startswith(
        'Step "Sign-off" of job "Daily summary" is waiting for approval (run r1')


def _approval_ctx(message="Check the totals before the weekly report"):
    return _ctx(hook="on_approval_requested", scope="step", step_id="gate", step="Sign-off",
                status="awaiting_approval", approval_message=message)




