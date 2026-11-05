"""SPL tokens, saved-search argument compilation and parameter validation.

Token grammar (optionally ``|default`` before the closing ``$``)::

    $run.id$  $run.scheduled_time$  $run.param.<name>$
    $<step>.sid$  $<step>.resultCount$  $<step>.status$  $<step>.first.<field>$

``compile_spl`` rewrites known tokens into Splunk saved-search arguments
(``$daily.sid$`` -> ``$args.daily__sid$``; ``.`` becomes ``__``). Anything else,
including a literal ``$`` or an unknown ``$foo$``, is left untouched.

render_args ctx shape::

    {"run":   {"id": str, "scheduled_time": str|int,
               "params": {name: value}},
     "steps": {step_id: {"status": str,          # "skipped" etc.
                         "sid": str|None,
                         "resultCount": int|None,
                         "first": dict|None}}}   # first result row, None if no rows

``render_args(names, ctx, defaults)`` returns {arg_name: str}. ``run.param`` and
``first.<field>`` values are escaped as SPL string contents. A token with no
value (skipped step, zero rows, missing field) uses its declared default, or
raises TokenError(token, reason).
"""
import math
import re
from decimal import Decimal, InvalidOperation


class TokenError(Exception):
    def __init__(self, token, reason):
        super().__init__("%s: %s" % (token, reason))
        self.token = token
        self.reason = reason


_STEP_PROPS = ("sid", "resultCount", "status")
_FIELD = r"[A-Za-z0-9_]+"


def _regex(step_ids):
    steps = "|".join(re.escape(s) for s in sorted(step_ids, key=len, reverse=True))
    alts = [r"run\.id", r"run\.scheduled_time", r"run\.param\.%s" % _FIELD]
    if steps:
        alts.append(r"(?:%s)\.(?:sid|resultCount|status)" % steps)
        alts.append(r"(?:%s)\.first\.%s" % (steps, _FIELD))
    return re.compile(r"\$(?P<name>%s)(?:\|(?P<default>[A-Za-z0-9_.:@ -]*))?\$" % "|".join(alts))


def is_valid_name(name, step_ids):
    m = _regex(step_ids).fullmatch("$%s$" % name)
    return m is not None


def find_tokens(spl, step_ids):
    return {m.group("name") for m in _regex(step_ids).finditer(spl)}


def arg_name(name):
    return name.replace(".", "__")


def compile_spl(spl, step_ids):
    names = []

    def sub(m):
        a = arg_name(m.group("name"))
        if a not in names:
            names.append(a)
        return "$args.%s$" % a

    return _regex(step_ids).sub(sub, spl), names


def token_defaults(spl, step_ids):
    out = {}
    for m in _regex(step_ids).finditer(spl):
        if m.group("default") is not None:
            out[arg_name(m.group("name"))] = m.group("default")
    return out


def escape_spl_string(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def _decode(arg, ctx):
    """Map an arg name back to (kind, step_id|None, extra)."""
    token = arg.replace("__", ".")
    if arg in ("run__id", "run__scheduled_time"):
        return "run", None, arg[5:]
    if arg.startswith("run__param__"):
        return "param", None, arg[len("run__param__"):]
    for sid in sorted(ctx.get("steps", {}), key=len, reverse=True):
        p = sid + "__"
        if arg.startswith(p):
            rest = arg[len(p):]
            if rest in _STEP_PROPS:
                return "step", sid, rest
            if rest.startswith("first__") and len(rest) > 7:
                return "first", sid, rest[7:]
    raise TokenError(token, "unknown token")


def render_args(names, ctx, defaults=None):
    defaults = defaults or {}
    out = {}
    for arg in names:
        token = "$" + arg.replace("__", ".") + "$"
        kind, sid, extra = _decode(arg, ctx)
        value, reason = None, None
        run = ctx.get("run", {})
        if kind == "run":
            value = run.get(extra)
            reason = "run has no %s" % extra
        elif kind == "param":
            value = run.get("params", {}).get(extra)
            reason = "run parameter %r has no value" % extra
            if value is not None:
                value = escape_spl_string(value)
        else:
            st = ctx["steps"][sid]
            if st.get("status") == "skipped":
                reason = "step %r was skipped" % sid
            elif kind == "step":
                value = st.get(extra)
                reason = "step %r has no %s" % (sid, extra)
            else:
                row = st.get("first")
                if not row:
                    reason = "step %r returned no result rows" % sid
                else:
                    value = row.get(extra)
                    reason = "first result row of step %r has no field %r" % (sid, extra)
                    if value is not None:
                        value = escape_spl_string(value)
        if value is None:
            if arg in defaults:
                value = defaults[arg]
            else:
                raise TokenError(token, reason)
        out[arg] = str(value)
    return out


_TIME_RE = re.compile(
    r"now|[0-9]{9,13}"
    r"|[+-]?[0-9]*(?:s|m|h|d|w|mon|q|y)(?:@[a-z]+[0-9]*(?:[+-][0-9]+[a-z]+)?)?"
    r"|@[a-z]+[0-9]*(?:[+-][0-9]+[a-z]+)?"
    r"|[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[ T][0-9]{2}:[0-9]{2}(?::[0-9]{2})?)?")
_NUM_RE = re.compile(r"-?[0-9]+(?:\.[0-9]+)?")


def _normalise_number(s):
    d = Decimal(s)
    return "0" if d == 0 else format(d.normalize(), "f")


def validate_param(decl, value):
    """Validate a run parameter value against its declaration; return it as str.

    Number values are returned normalised (``007`` -> ``7``, ``3.50`` -> ``3.5``).
    """
    name = decl.get("name", "?")
    if value is None or value == "":
        if decl.get("default") is not None:
            value = decl["default"]
        else:
            raise TokenError("run.param." + name, "value is required")
    if isinstance(value, float) and math.isfinite(value):
        s = format(Decimal(repr(value)), "f")
    else:
        s = str(value)
    t = decl.get("type", "string")
    if t == "number":
        if not _NUM_RE.fullmatch(s):
            raise TokenError("run.param." + name, "not a number: %r" % s)
        try:
            s = _normalise_number(s)
        except InvalidOperation:
            raise TokenError("run.param." + name, "not a number: %r" % s)
    elif t == "enum":
        if s not in (decl.get("values") or []):
            raise TokenError("run.param." + name, "%r is not one of the allowed values" % s)
    elif t == "time":
        if not _TIME_RE.fullmatch(s):
            raise TokenError("run.param." + name, "not a time value: %r" % s)
    elif t != "string":
        raise TokenError("run.param." + name, "unknown parameter type %r" % t)
    rx = decl.get("regex")
    if rx and not re.fullmatch(rx, s):
        raise TokenError("run.param." + name, "%r does not match the required pattern" % s)
    return s
