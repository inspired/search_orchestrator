"""Job model: validation, topological order and default resolution.

Issue = {"level": "error"|"warning", "code", "message", "step"}.
Codes beyond the brief's list (reported to the controller): bad_step,
unknown_saved_search, bad_edge, bad_run_when, bad_timezone.
``workload_pool`` was removed from the first version and is ignored.
"""
import re

from . import cron as cronmod
from . import expr as exprmod
from . import tokens as tk

STEP_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
PARAM_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,39}$")
BUILTIN_DEFAULTS = {"delayed_after": 3600, "give_up_after": 86400,
                    "max_runtime": 14400, "retries": 0}
_EDGE_CONDITIONS = ("on_success", "on_failure", "always", "expression")
_PARAM_TYPES = ("string", "number", "enum", "time")
# A dotted reference whose first segment is run or a step id but that is not valid.
_DOTTED_RE = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_.]+)(?:\|[^$]*)?\$")
_SUFFIX_RE = re.compile(r"\.(?:sid|resultCount|status|first\.[A-Za-z0-9_]+)$")


def _issue(level, code, message, step=None):
    return {"level": level, "code": code, "message": message, "step": step}


def _step_ids(job):
    return [s.get("id") for s in job.get("steps", []) if isinstance(s.get("id"), str)]


def resolve_step(job, step):
    out = {k: v for k, v in step.items() if k != "workload_pool"}
    defaults = job.get("defaults") or {}
    for k, fallback in BUILTIN_DEFAULTS.items():
        if out.get(k) is None:
            d = defaults.get(k)
            out[k] = fallback if d is None else d
    return out


def _graph(job):
    ids = set(_step_ids(job))
    succ = {i: [] for i in ids}
    for e in job.get("edges", []):
        if e.get("from") in ids and e.get("to") in ids:
            succ[e["from"]].append(e["to"])
    return ids, succ


def topo_order(job):
    ids, succ = _graph(job)
    order_ix = {}
    for s in _step_ids(job):
        order_ix.setdefault(s, len(order_ix))
    indeg = {i: 0 for i in ids}
    for a in succ:
        for b in succ[a]:
            indeg[b] += 1
    ready = sorted((i for i in ids if indeg[i] == 0), key=order_ix.get)
    out = []
    while ready:
        n = ready.pop(0)
        out.append(n)
        for b in succ[n]:
            indeg[b] -= 1
            if indeg[b] == 0:
                ready.append(b)
        ready.sort(key=order_ix.get)
    if len(out) != len(ids):
        raise ValueError("job graph has a cycle")
    return out


def _downstream(succ, starts):
    seen, stack = set(), list(starts)
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        stack.extend(succ.get(n, []))
    return seen


def _validate_params(job, issues):
    names = set()
    for p in job.get("params", []) or []:
        n = p.get("name")
        if not isinstance(n, str) or not PARAM_NAME_RE.match(n):
            issues.append(_issue("error", "bad_param", "bad parameter name %r" % (n,)))
            continue
        if n in names:
            issues.append(_issue("error", "bad_param", "duplicate parameter %r" % n))
        names.add(n)
        t = p.get("type", "string")
        if t not in _PARAM_TYPES:
            issues.append(_issue("error", "bad_param", "parameter %r: unknown type %r" % (n, t)))
            continue
        if t == "enum" and not p.get("values"):
            issues.append(_issue("error", "bad_param", "parameter %r: enum needs values" % n))
        if p.get("regex"):
            try:
                re.compile(p["regex"])
            except re.error as e:
                issues.append(_issue("error", "bad_param", "parameter %r: bad regex (%s)" % (n, e)))
                continue
        if p.get("default") is not None:
            try:
                tk.validate_param(p, p["default"])
            except tk.TokenError as e:
                issues.append(_issue("error", "bad_param", "parameter %r: bad default (%s)" % (n, e.reason)))
    return names


def _check_expr_tokens(text, ids, params, issues, step, what):
    try:
        node = exprmod.parse(text)
    except exprmod.ExprError as e:
        issues.append(_issue("error", "bad_expression", "%s: %s" % (what, e), step))
        return
    for name in sorted(exprmod.tokens(node)):
        if not _token_ok(name, ids, params):
            issues.append(_issue("error", "unknown_token", "%s: unknown token $%s$" % (what, name), step))


def _token_ok(name, ids, params):
    if not tk.is_valid_name(name, ids):
        return False
    if name.startswith("run.param."):
        return name[len("run.param."):] in params
    return True


def validate_job(job, known_saved_searches=None):
    issues = []
    steps = job.get("steps", []) or []
    params = _validate_params(job, issues)

    tz = job.get("timezone")
    if tz:
        try:
            cronmod.ZoneInfo(tz)
        except Exception:
            issues.append(_issue("error", "bad_timezone", "unknown time zone %r" % tz))
    for t in job.get("triggers", []) or []:
        if t.get("type") == "cron":
            try:
                cronmod.parse(t.get("cron"))
            except cronmod.CronError as e:
                issues.append(_issue("error", "bad_cron", "trigger cron: %s" % e))

    seen = set()
    for s in steps:
        sid = s.get("id")
        if not isinstance(sid, str) or not STEP_ID_RE.match(sid):
            issues.append(_issue("error", "bad_step_id", "bad step id %r" % (sid,), sid if isinstance(sid, str) else None))
            continue
        if sid == "run":
            issues.append(_issue("error", "reserved_step_id", "step id 'run' is reserved", sid))
        if sid in seen:
            issues.append(_issue("error", "duplicate_step", "duplicate step id %r" % sid, sid))
        seen.add(sid)
    ids = seen

    for s in steps:
        sid = s.get("id")
        if sid not in ids:
            continue
        if s.get("type") == "saved_search":
            ref = s.get("saved_search_ref")
            if not ref:
                issues.append(_issue("error", "bad_step", "saved_search step needs saved_search_ref", sid))
            elif known_saved_searches is not None and ref not in known_saved_searches:
                issues.append(_issue("error", "unknown_saved_search", "unknown saved search %r" % ref, sid))
        elif s.get("type") == "inline":
            if not (s.get("spl") or "").strip():
                issues.append(_issue("error", "bad_step", "inline step needs spl", sid))
        else:
            issues.append(_issue("error", "bad_step", "unknown step type %r" % s.get("type"), sid))
        rw = s.get("run_when")
        if rw:
            kind, val = rw.get("kind"), rw.get("value")
            if kind == "cron":
                try:
                    cronmod.parse(val)
                except cronmod.CronError as e:
                    issues.append(_issue("error", "bad_cron", "run_when: %s" % e, sid))
            elif kind == "expression":
                _check_expr_tokens(val, ids, params, issues, sid, "run_when")
            else:
                issues.append(_issue("error", "bad_run_when", "unknown run_when kind %r" % kind, sid))
        spl = s.get("spl") or ""
        for m in _DOTTED_RE.finditer(spl):
            first, rest = m.group(1), m.group(2)
            name = first + "." + rest
            if (first == "run" or first in ids or _SUFFIX_RE.search("." + rest)) \
                    and not _token_ok(name, ids, params):
                issues.append(_issue("error", "unknown_token", "unknown token %s" % m.group(0), sid))
        for name in tk.find_tokens(spl, ids):
            if name.startswith("run.param.") and not _token_ok(name, ids, params):
                issues.append(_issue("error", "unknown_token", "undeclared parameter in $%s$" % name, sid))

    edges = job.get("edges", []) or []
    for e in edges:
        a, b = e.get("from"), e.get("to")
        for end in (a, b):
            if end not in ids:
                issues.append(_issue("error", "unknown_edge_step", "edge references unknown step %r" % (end,)))
        cond = e.get("condition", "on_success")
        if cond not in _EDGE_CONDITIONS:
            issues.append(_issue("error", "bad_edge", "unknown edge condition %r" % (cond,)))
        elif cond == "expression":
            _check_expr_tokens(e.get("expression"), ids, params, issues, b if b in ids else None,
                               "edge %s->%s" % (a, b))

    _, succ = _graph(job)
    try:
        topo_order(job)
    except ValueError:
        issues.append(_issue("error", "cycle", "steps form a dependency cycle"))

    # Warnings
    for s in steps:
        if s.get("id") in ids and resolve_step(job, s)["retries"] > 0:
            issues.append(_issue("warning", "retries_duplicate_risk",
                                 "retries above 0 can write duplicates to a summary index", s["id"]))
    if not any(a.get("hook") == "on_failure" for a in job.get("actions", []) or []):
        issues.append(_issue("warning", "no_failure_notification",
                             "no on_failure action; the fallback notification will be used"))
    branch_targets = [e.get("to") for e in edges
                      if e.get("condition") in ("on_failure", "expression") and e.get("to") in ids]
    skippable = _downstream(succ, branch_targets)
    skippable |= {s.get("id") for s in steps if s.get("run_when")}
    for s in steps:
        sid = s.get("id")
        if sid not in ids:
            continue
        defaults = tk.token_defaults(s.get("spl") or "", ids)
        for name in sorted(tk.find_tokens(s.get("spl") or "", ids)):
            ref = name.split(".")[0]
            if ref != "run" and ref in skippable and arg_default_missing(name, defaults):
                issues.append(_issue("warning", "token_from_skippable_step",
                                     "$%s$ may come from a skipped step; add |default" % name, sid))
    return issues


def arg_default_missing(name, defaults):
    return tk.arg_name(name) not in defaults
