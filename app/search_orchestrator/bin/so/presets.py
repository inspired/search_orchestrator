"""Message text for actions and notifications: ``default_message(ctx)`` and ``fill`` for
templates. (Webhook body presets for Slack, Teams, PagerDuty and ServiceNow were removed in
1.50.0; an Alert action from the service's own Splunk app does it.)

``ctx`` keys: ``job``, ``run_id``, ``hook``, ``scope`` (``job`` or ``step``), ``step`` (name or
None), ``status``, ``run_url``, ``failed`` (list of ``{"step", "url"}``), and for
``on_approval_requested`` the step's ``approval_message`` (shown instead of the status).
Only names, statuses, links and that message: never result data.
"""
import re

from . import tokens

_VERB = {"on_start": "started", "on_success": "succeeded", "on_failure": "failed",
         "on_complete": "completed", "on_delayed": "is delayed",
         "on_late": "is late", "on_approval_requested": "is waiting for approval"}
_FIELD = re.compile(r"\{\{\s*(\w+)\s*\}\}")
APPROVAL = "on_approval_requested"


def _approval_message(ctx):
    """The approval step's message for ``on_approval_requested``, or ''."""
    return (ctx.get("approval_message") or "") if ctx.get("hook") == APPROVAL else ""


def default_message(ctx):
    what = 'Job "%s"' % ctx.get("job")
    if ctx.get("scope") == "step" and ctx.get("step"):
        what = 'Step "%s" of job "%s"' % (ctx["step"], ctx.get("job"))
    verb = _VERB.get(ctx.get("hook"), ctx.get("hook"))
    if ctx.get("hook") == APPROVAL:
        lines = ["%s %s (run %s)." % (what, verb, ctx.get("run_id"))]
        if _approval_message(ctx):
            lines.append("Message: %s" % _approval_message(ctx))
    else:
        lines = ["%s %s (run %s, status %s)." % (what, verb, ctx.get("run_id"), ctx.get("status"))]
    if ctx.get("run_url"):
        lines.append("Run: %s" % ctx["run_url"])
    for f in ctx.get("failed") or []:
        lines.append("Failed search (%s): %s" % (f.get("step"), f.get("url")))
    return "\n".join(lines)


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
