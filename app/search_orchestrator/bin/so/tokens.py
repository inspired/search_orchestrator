"""SPL tokens, saved-search argument compilation and parameter validation.

Token grammar (optionally ``|default`` before the closing ``$``)::

    $run.id$  $run.scheduled_time$  $run.param.<name>$
    $<step>.sid$  $<step>.resultCount$  $<step>.status$  $<step>.first.<field>$

``compile_spl`` rewrites known tokens into Splunk saved-search arguments
(``$daily.sid$`` -> ``"$args.daily__sid$"``; ``.`` becomes ``__``). Every token
is placed as one quoted SPL string value: a token outside a double-quoted
string gets the quotes added, one inside a string is left in it. Values are
escaped, so a token can never inject SPL commands or field names. Anything
else, including a literal ``$`` or an unknown ``$foo$``, is left untouched.

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


def _scan(spl, i, end, in_q, in_c):
    """Advance the lexer state from index i to end. ``in_q``: inside a double-quoted
    string, where a backslash escapes the next character. ``in_c``: inside a ```` ``` ````
    comment, whose contents don't affect quoting."""
    while i < end:
        if in_c:
            if spl.startswith("```", i):
                in_c = False
                i += 3
            else:
                i += 1
            continue
        c = spl[i]
        if c == "\\":
            i += 2
            continue
        if c == '"':
            in_q = not in_q
        elif not in_q and spl.startswith("```", i):
            in_c = True
            i += 3
            continue
        i += 1
    return i, in_q, in_c


def _backslashes_before(spl, index):
    n = 0
    while index - n - 1 >= 0 and spl[index - n - 1] == "\\":
        n += 1
    return n


def compile_spl(spl, step_ids):
    """Rewrite known tokens to ``$args.x$``. A token inside a double-quoted SPL
    string stays ``$args.x$``; a token outside one becomes ``"$args.x$"``, so
    every value lands in SPL as one quoted string, never as raw SPL.

    Raises TokenError for a token inside a ```` ``` ```` comment, or right after an
    odd run of backslashes: in both places a value could escape its quotes."""
    names = []
    out = []
    pos, i, in_q, in_c = 0, 0, False, False
    for m in _regex(step_ids).finditer(spl):
        i, in_q, in_c = _scan(spl, i, m.start(), in_q, in_c)
        token = m.group(0)
        if in_c:
            raise TokenError(token, "tokens can't be used inside a ``` comment")
        if _backslashes_before(spl, m.start()) % 2:
            raise TokenError(token, "a token can't follow a backslash; put the backslash "
                                    "in the value instead")
        a = arg_name(m.group("name"))
        if a not in names:
            names.append(a)
        tok = "$args.%s$" % a
        out.append(spl[pos:m.start()])
        out.append(tok if in_q else '"%s"' % tok)
        pos = m.end()
        i = max(i, m.end())
    out.append(spl[pos:])
    return "".join(out), names


def token_defaults(spl, step_ids):
    out = {}
    for m in _regex(step_ids).finditer(spl):
        if m.group("default") is not None:
            out[arg_name(m.group("name"))] = m.group("default")
    return out


def escape_spl_string(value):
    """Escape for use inside a double-quoted SPL string. Backticks become ``'`` so a
    value can never name a macro or close a comment."""
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("`", "'")


def _search_value(value, token):
    if "`" in str(value):
        raise TokenError(token, "value contains a backtick, which search values can't contain")
    return escape_spl_string(value)


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
                value = _search_value(value, token)
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
                        value = _search_value(value, token)
        if value is None:
            if arg in defaults:
                value = defaults[arg]
            else:
                raise TokenError(token, reason)
        out[arg] = str(value)
    return out


def run_context(run):
    """The ``render_args``/``render_text`` ctx for a run document."""
    definition = run.get("definition") or {}
    steps = {}
    for s in definition.get("steps") or []:
        st = (run.get("steps") or {}).get(s.get("id")) or {}
        steps[s.get("id")] = {"status": st.get("state"), "sid": st.get("sid"),
                              "resultCount": st.get("result_count"), "first": st.get("first")}
    scheduled = run.get("scheduled_time")
    return {"run": {"id": run.get("_key") or run.get("id"),
                    "scheduled_time": str(int(scheduled)) if scheduled is not None else None,
                    "params": run.get("params") or {}},
            "steps": steps}


def text_pattern(step_ids):
    """The compiled token regex (groups ``name`` and ``default``)."""
    return _regex(step_ids)


def text_value(match, ctx):
    """The raw value of one token match for an action template: its value, else its
    ``|default``, else an empty string. A skipped step still has its status. Values are
    not escaped here: the caller escapes for the target (JSON or SPL string)."""
    kind, sid, extra = _decode(arg_name(match.group("name")), ctx)
    run = ctx.get("run", {})
    value = None
    if kind == "run":
        value = run.get(extra)
    elif kind == "param":
        value = (run.get("params") or {}).get(extra)
    else:
        st = ctx["steps"][sid]
        if kind == "step" and extra == "status":
            value = st.get("status")
        elif st.get("status") != "skipped":
            if kind == "step":
                value = st.get(extra)
            else:
                value = (st.get("first") or {}).get(extra)
    if value is None:
        value = match.group("default") or ""
    return str(value)


def render_text(text, ctx):
    """Fill ``$run.*$`` and ``$<step>.*$`` tokens in an action template with raw values."""
    return _regex(ctx.get("steps") or {}).sub(lambda m: text_value(m, ctx), text)


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
