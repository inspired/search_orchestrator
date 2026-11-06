"""Webhook body presets and default messages (spec section 10).

``render(preset, ctx)`` returns a JSON-able dict. ``ctx`` keys: ``job``,
``run_id``, ``hook``, ``scope`` (``job`` or ``step``), ``step`` (name or
None), ``status``, ``run_url``, ``failed`` (list of ``{"step", "url"}``).
Only names, statuses and links: never result data.
"""
import re

from . import tokens

_VERB = {"on_start": "started", "on_success": "succeeded", "on_failure": "failed",
         "on_complete": "completed", "on_delayed": "is delayed"}
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


def _slack(ctx):
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


def _generic(ctx):
    return {"job": ctx.get("job"), "run_id": ctx.get("run_id"), "hook": ctx.get("hook"),
            "scope": ctx.get("scope"), "step": ctx.get("step"), "status": ctx.get("status"),
            "message": default_message(ctx), "run_url": ctx.get("run_url"),
            "failed_searches": list(ctx.get("failed") or [])}


PRESETS = {"slack": _slack, "generic": _generic}


def render(preset, ctx):
    try:
        return PRESETS[preset or "generic"](ctx)
    except KeyError:
        raise ValueError("unknown webhook preset %r" % (preset,))


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
