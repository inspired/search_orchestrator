"""Webhook body presets and default messages (spec section 10; Teams, PagerDuty and
ServiceNow: features-2 spec section 7).

``render(preset, ctx, options)`` returns a JSON-able dict. ``options`` are the
action's per-preset options (``PRESET_OPTIONS``; checked by ``option_issues``). ``ctx`` keys: ``job``,
``run_id``, ``hook``, ``scope`` (``job`` or ``step``), ``step`` (name or
None), ``status``, ``run_url``, ``failed`` (list of ``{"step", "url"}``).
Only names, statuses and links: never result data.
"""
import json
import re
from urllib.parse import urlsplit

from . import tokens

_VERB = {"on_start": "started", "on_success": "succeeded", "on_failure": "failed",
         "on_complete": "completed", "on_delayed": "is delayed",
         "on_late": "is late", "on_approval_requested": "is waiting for approval"}
_FIELD = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def default_message(ctx):
    what = 'Job "%s"' % ctx.get("job")
    if ctx.get("scope") == "step" and ctx.get("step"):
        what = 'Step "%s" of job "%s"' % (ctx["step"], ctx.get("job"))
    text = "%s %s (run %s, status %s)." % (what, _VERB.get(ctx.get("hook"), ctx.get("hook")),
                                           ctx.get("run_id"), ctx.get("status"))
    lines = [text]
    if ctx.get("run_url"):
        lines.append("Run: %s" % ctx["run_url"])
    for f in ctx.get("failed") or []:
        lines.append("Failed search (%s): %s" % (f.get("step"), f.get("url")))
    return "\n".join(lines)


def _slack(ctx, options=None):
    what = "*%s*" % ctx.get("job")
    if ctx.get("scope") == "step" and ctx.get("step"):
        what = "step *%s* of %s" % (ctx["step"], what)
    head = "Job %s %s (status: %s)" % (what, _VERB.get(ctx.get("hook"), ctx.get("hook")),
                                      ctx.get("status"))
    links = []
    if ctx.get("run_url"):
        links.append("<%s|Open run>" % ctx["run_url"])
    for f in ctx.get("failed") or []:
        links.append("<%s|Failed search: %s>" % (f.get("url"), f.get("step")))
    blocks = [{"type": "section", "text": {"type": "mrkdwn", "text": head}}]
    if links:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(links)}})
    return {"text": default_message(ctx), "blocks": blocks}


def _generic(ctx, options=None):
    return {"job": ctx.get("job"), "run_id": ctx.get("run_id"), "hook": ctx.get("hook"),
            "scope": ctx.get("scope"), "step": ctx.get("step"), "status": ctx.get("status"),
            "message": default_message(ctx), "run_url": ctx.get("run_url"),
            "failed_searches": list(ctx.get("failed") or [])}


def _title(ctx):
    """``Daily summary failed``, or ``Daily summary: step Load failed``."""
    verb = _VERB.get(ctx.get("hook"), ctx.get("hook"))
    if ctx.get("scope") == "step" and ctx.get("step"):
        return "%s: step %s %s" % (ctx.get("job"), ctx["step"], verb)
    return "%s %s" % (ctx.get("job"), verb)


def _teams(ctx, options=None):
    """A Teams message with one Adaptive Card 1.4 (works with Teams Workflows webhooks)."""
    facts = [("Job", ctx.get("job")), ("Run", ctx.get("run_id"))]
    if ctx.get("scope") == "step" and ctx.get("step"):
        facts.append(("Step", ctx["step"]))
    facts.append(("Status", ctx.get("status")))
    actions = []
    if ctx.get("run_url"):
        actions.append({"type": "Action.OpenUrl", "title": "Open run", "url": ctx["run_url"]})
    for f in ctx.get("failed") or []:
        actions.append({"type": "Action.OpenUrl", "title": "Failed search: %s" % f.get("step"),
                        "url": f.get("url")})
    card = {"$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            "type": "AdaptiveCard", "version": "1.4",
            "body": [{"type": "TextBlock", "text": _title(ctx), "weight": "Bolder",
                      "size": "Medium", "wrap": True},
                     {"type": "FactSet", "facts": [{"title": t, "value": str(v)}
                                                   for t, v in facts]}],
            "actions": actions}
    return {"type": "message", "attachments": [
        {"contentType": "application/vnd.microsoft.card.adaptive", "contentUrl": None,
         "content": card}]}


def _pagerduty(ctx, options=None):
    """An Events API v2 event without ``routing_key``: the sender merges it in from the
    destination's secret. A succeeded run's on_success or on_complete resolves it."""
    options = options or {}
    hook = ctx.get("hook")
    resolve = hook in ("on_success", "on_complete") and ctx.get("status") == "succeeded"
    severity = options.get("severity") or (
        "warning" if hook in ("on_delayed", "on_late") else "error")
    dedup = str(ctx.get("run_id"))
    if ctx.get("scope") == "step" and ctx.get("step_id"):
        dedup += ":" + str(ctx["step_id"])
    body = {"event_action": "resolve" if resolve else "trigger", "dedup_key": dedup,
            "payload": {"summary": default_message(ctx).split("\n")[0][:1024],
                        "source": "search_orchestrator", "severity": severity,
                        "custom_details": {"job": ctx.get("job"), "run_id": ctx.get("run_id"),
                                           "step": ctx.get("step"), "status": ctx.get("status"),
                                           "hook": hook}}}
    if ctx.get("run_url"):
        body["links"] = [{"href": ctx["run_url"], "text": "Open run"}]
    return body


def _servicenow(ctx, options=None):
    """A Table API incident; auth goes in the destination's headers secret."""
    options = options or {}
    body = {"short_description": "Search Orchestrator: %s" % _title(ctx),
            "description": default_message(ctx),
            "urgency": str(options.get("urgency") or "2"),
            "impact": str(options.get("impact") or "2"),
            "correlation_id": ctx.get("run_id")}
    if options.get("assignment_group"):
        body["assignment_group"] = options["assignment_group"]
    return body


PRESETS = {"slack": _slack, "generic": _generic, "teams": _teams, "pagerduty": _pagerduty,
           "servicenow": _servicenow}
# Per-action options per preset: a tuple of allowed values, or ``str`` (free text).
PRESET_OPTIONS = {"pagerduty": {"severity": ("critical", "error", "warning", "info")},
                  "servicenow": {"urgency": ("1", "2", "3"), "impact": ("1", "2", "3"),
                                 "assignment_group": str}}
OPTION_PRESETS = ("teams", "pagerduty", "servicenow")
ASSIGNMENT_GROUP_MAX = 100
_OPTION_MESSAGES = {"severity": "severity must be critical, error, warning or info",
                    "urgency": "urgency must be 1, 2 or 3",
                    "impact": "impact must be 1, 2 or 3",
                    "assignment_group": "assignment group can be at most %d characters"
                                        % ASSIGNMENT_GROUP_MAX}
PAGERDUTY_URL = "https://events.pagerduty.com/v2/enqueue"
SERVICENOW_PATH = "/api/now/table/incident"
ROUTING_KEY_MESSAGE = ("Enter the routing key from the PagerDuty service's Events API v2 "
                       "integration")
SERVICENOW_URL_MESSAGE = "A ServiceNow URL ends in %s" % SERVICENOW_PATH


def option_issues(preset, options):
    """Messages for an action's ``options`` that don't match its preset's table row."""
    if options is None or options == {}:
        return []
    if preset not in OPTION_PRESETS:
        return ["options only apply to Teams, PagerDuty and ServiceNow actions"]
    if not isinstance(options, dict):
        return ["options must be an object; remove the action and add it again"]
    allowed = PRESET_OPTIONS.get(preset) or {}
    issues = []
    for name, value in options.items():
        rule = allowed.get(name)
        if rule is None:
            issues.append("%s is not an option of %s actions; remove it" % (name, preset))
        elif rule is str:
            if not isinstance(value, str) or len(value) > ASSIGNMENT_GROUP_MAX:
                issues.append(_OPTION_MESSAGES[name])
        elif not isinstance(value, str) or value not in rule:
            issues.append(_OPTION_MESSAGES[name])
    return issues


def destination_url(preset, url, stored=None):
    """The URL to store for a destination of ``preset``. PagerDuty fills an empty one
    with ``stored`` (the URL of the PagerDuty destination being replaced) or the
    default. Raises ValueError with the message to show when the URL doesn't fit."""
    if preset == "pagerduty" and url in (None, ""):
        return stored or PAGERDUTY_URL
    if preset == "servicenow" and isinstance(url, str) \
            and not urlsplit(url).path.rstrip("/").endswith(SERVICENOW_PATH):
        raise ValueError(SERVICENOW_URL_MESSAGE)
    return url


def routing_key_secret(routing_key):
    """The ``body_secret_ref`` value for a PagerDuty routing key (a JSON object)."""
    if not isinstance(routing_key, str) or not routing_key.strip():
        raise ValueError(ROUTING_KEY_MESSAGE)
    return json.dumps({"routing_key": routing_key.strip()})


def render(preset, ctx, options=None):
    try:
        fn = PRESETS[preset or "generic"]
    except KeyError:
        raise ValueError("unknown webhook preset %r" % (preset,))
    return fn(ctx, options if isinstance(options, dict) else None)


def fill(value, ctx):
    """Replace ``{{name}}`` in strings (recursively) with ctx values. ``{{message}}``
    is the default message. If ``ctx["tokens"]`` holds a run's token context
    (``tokens.run_context``), ``$run.*$`` and ``$<step>.*$`` tokens (with ``|default``)
    are filled too, in the same pass, so a filled value is never expanded again.
    Values are raw: the caller escapes them for the target."""
    values = dict(ctx, message=default_message(ctx))
    tctx = ctx.get("tokens")
    if tctx:
        pattern = re.compile("%s|%s" % (_FIELD.pattern, tokens.text_pattern(
            tctx.get("steps") or {}).pattern))

        def sub(m):
            if m.group(1) is not None:
                return str(values.get(m.group(1), ""))
            return tokens.text_value(m, tctx)
    else:
        pattern = _FIELD

        def sub(m):
            return str(values.get(m.group(1), ""))
    return _fill(value, pattern, sub)


def _fill(value, pattern, sub):
    if isinstance(value, str):
        return pattern.sub(sub, value)
    if isinstance(value, dict):
        return {k: _fill(v, pattern, sub) for k, v in value.items()}
    if isinstance(value, list):
        return [_fill(v, pattern, sub) for v in value]
    return value
