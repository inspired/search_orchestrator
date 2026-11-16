"""Job model: validation, topological order and default resolution.

Issue = {"level": "error"|"warning", "code", "message", "step"}.
Codes beyond the brief's list (reported to the controller): bad_step,
unknown_saved_search, bad_edge, bad_run_when, bad_timezone, bad_shape, previous_needs_pipe,
previous_needs_dependency; warnings timezone_fallback, previous_old_time_range.
``workload_pool`` was removed from the first version and is ignored.
"""
import re

from . import cron as cronmod
from . import expr as exprmod
from . import tokens as tk

JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")  # job ids; also preview sids' job part
STEP_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")  # and no "__": arg names use it
PARAM_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,39}$")
BUILTIN_DEFAULTS = {"delayed_after": 3600, "give_up_after": 86400,
                    "max_runtime": 14400, "retries": 0}
_EDGE_CONDITIONS = ("on_success", "on_failure", "always", "expression")
_PARAM_TYPES = ("string", "number", "enum", "time")
# A dotted reference whose first segment is run or a step id but that is not valid.
_DOTTED_RE = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_.]+)(?:\|[^$]*)?\$")
_ORCHESTRATE_RE = re.compile(r"\|\s*orchestrate\b", re.IGNORECASE)
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


def find_cycle(job):
    """A dependency cycle as a path ``[a, b, ..., a]`` (edges only, steps taken in step
    order), or None when the edges form a DAG."""
    ids, succ = _graph(job)
    color, path = {}, []

    def visit(n):
        color[n] = 1
        path.append(n)
        for b in succ[n]:
            if color.get(b) == 1:
                return path[path.index(b):] + [b]
            if b not in color:
                found = visit(b)
                if found:
                    return found
        color[n] = 2
        path.pop()
        return None

    for s in _step_ids(job):
        if s in ids and s not in color:
            found = visit(s)
            if found:
                return found
    return None


def old_time_range_issues(job):
    """Warnings for From previous steps steps that still carry earliest/latest: saved
    before 1.1.0, their hidden saved search keeps that time range until the job is
    re-saved (a save strips it)."""
    return [_issue("warning", "previous_old_time_range",
                   "re-save the job to drop this step's old time range", s.get("id"))
            for s in job.get("steps") or []
            if isinstance(s, dict) and s.get("type") == "previous"
            and (s.get("earliest") or s.get("latest"))]


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
        if not isinstance(n, str) or not PARAM_NAME_RE.fullmatch(n):
            issues.append(_issue("error", "bad_param", "parameter name %r isn't valid; use letters, numbers and _, starting with a letter" % (n,)))
            continue
        if n in names:
            issues.append(_issue("error", "bad_param", "parameter %r is listed twice; give each parameter its own name" % n))
        names.add(n)
        t = p.get("type", "string")
        if t not in _PARAM_TYPES:
            issues.append(_issue("error", "bad_param", "parameter %r has an unknown type %r; pick Text, Number, One of a list or Time" % (n, t)))
            continue
        if t == "enum" and not p.get("values"):
            issues.append(_issue("error", "bad_param", "parameter %r is a list with no values; add values separated by commas" % n))
        if p.get("regex"):
            try:
                re.compile(p["regex"])
            except re.error as e:
                issues.append(_issue("error", "bad_param", "parameter %r: the pattern isn't valid (%s); fix it or clear it" % (n, e)))
                continue
        if p.get("default") is not None:
            try:
                tk.validate_param(p, p["default"])
            except tk.TokenError as e:
                issues.append(_issue("error", "bad_param", "parameter %r: the default breaks the parameter's own rules (%s); change or clear it" % (n, e.reason)))
    return names


def _check_expr_tokens(text, ids, params, issues, step, what):
    try:
        node = exprmod.parse(text)
    except exprmod.ExprError as e:
        issues.append(_issue("error", "bad_expression", "%s: %s" % (what, e), step))
        return
    for name in sorted(exprmod.tokens(node)):
        if not _token_ok(name, ids, params):
            issues.append(_issue("error", "unknown_token", "%s: $%s$ isn't a token this job has; pick one with Insert value" % (what, name), step))


def _token_ok(name, ids, params):
    if not tk.is_valid_name(name, ids):
        return False
    if name.startswith("run.param."):
        return name[len("run.param."):] in params
    return True


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def _lst(job, key):
    v = job.get(key)
    return v if isinstance(v, list) else []


def _coord_ok(v):
    return (isinstance(v, (int, float)) and not isinstance(v, bool)
            and math.isfinite(v) and abs(v) <= 1_000_000)


def _layout_ok(layout):
    if not isinstance(layout, dict):
        return False
    nodes = layout.get("nodes")
    if not isinstance(nodes, dict) or len(nodes) > 1000:
        return False
    return all(isinstance(p, dict) and _coord_ok(p.get("x")) and _coord_ok(p.get("y"))
               for p in nodes.values())


def _output_ok(out):
    return (isinstance(out, dict) and out.get("kind") in ("summary_index", "lookup")
            and all(isinstance(v, (str, bool)) for v in out.values()))


def _shape_issues(job):
    out = []

    def bad(msg, step=None):
        out.append(_issue("error", "bad_shape", msg, step))

    if not isinstance(job, dict):
        return [_issue("error", "bad_shape", "job must be an object")]
    for key in ("steps", "params", "edges", "triggers", "actions"):
        v = job.get(key)
        if v is not None and not (isinstance(v, list) and all(isinstance(x, dict) for x in v)):
            bad("%s must be a list of objects" % key)
    if job.get("defaults") is not None and not isinstance(job["defaults"], dict):
        bad("defaults must be an object")
    if job.get("timezone") is not None and not isinstance(job["timezone"], str):
        bad("timezone must be a string")

    if "layout" in job and not _layout_ok(job["layout"]):
        bad("layout is broken; use Tidy up and save again")

    def check_durations(d, where, step=None):
        for k in BUILTIN_DEFAULTS:
            if d.get(k) is not None and not _is_int(d[k]):
                bad("%s %s must be a non-negative integer" % (where, k), step)

    if isinstance(job.get("defaults"), dict):
        check_durations(job["defaults"], "defaults")
    for s in _lst(job, "steps"):
        if not isinstance(s, dict):
            continue
        sid = s.get("id") if isinstance(s.get("id"), str) else None
        check_durations(s, "step", sid)
        for k in ("spl", "saved_search_ref", "type"):
            if s.get(k) is not None and not isinstance(s[k], str):
                bad("step %s must be a string" % k, sid)
        if "output" in s and not _output_ok(s["output"]):
            bad("step output must be a summary index or lookup; open the node and set it again", sid)
        rw = s.get("run_when")
        if rw is not None and not (isinstance(rw, dict) and isinstance(rw.get("kind"), (str, type(None)))
                                   and isinstance(rw.get("value"), (str, type(None)))):
            bad("run_when must be an object with string kind and value", sid)
    for p in _lst(job, "params"):
        if not isinstance(p, dict):
            continue
        if p.get("type") is not None and not isinstance(p["type"], str):
            bad("parameter type must be a string")
        if p.get("name") is not None and not isinstance(p["name"], str):
            bad("parameter name must be a string")
        if p.get("values") is not None and not isinstance(p["values"], list):
            bad("parameter values must be a list")
        if p.get("regex") is not None and not isinstance(p["regex"], str):
            bad("parameter regex must be a string")
        if isinstance(p.get("default"), (list, dict)):
            bad("parameter default must be a scalar")
    for e in _lst(job, "edges"):
        if not isinstance(e, dict):
            continue
        for k in ("from", "to", "condition", "expression"):
            if e.get(k) is not None and not isinstance(e[k], str):
                bad("edge %s must be a string" % k)
    for t in _lst(job, "triggers"):
        if isinstance(t, dict) and t.get("cron") is not None and not isinstance(t["cron"], str):
            bad("trigger cron must be a string")
    return out


def validate_job(job, known_saved_searches=None):
    shape = _shape_issues(job)
    if shape:
        return shape
    try:
        return _validate(job, known_saved_searches)
    except Exception as e:  # last-resort guard: never raise on JSON input
        return [_issue("error", "bad_shape", "job is malformed (%s)" % type(e).__name__)]


def _validate(job, known_saved_searches):
    issues = []
    steps = job.get("steps", []) or []
    params = _validate_params(job, issues)

    tz = job.get("timezone")
    if tz:
        status = cronmod.tz_status(tz)
        if status == "unknown":
            issues.append(_issue("error", "bad_timezone", "unknown time zone %r; pick one from the Time zone list or clear it" % tz))
        elif status == "unavailable":
            issues.append(_issue("warning", "timezone_fallback",
                                 "the server can't look up time zones, so schedules will use its local time; ask your Splunk admin to install time zone data"))
    for t in job.get("triggers", []) or []:
        if t.get("type") == "cron":
            try:
                cronmod.parse(t.get("cron"))
            except cronmod.CronError as e:
                issues.append(_issue("error", "bad_cron", "schedule: %s; fix the cron or pick a preset" % e))

    seen = set()
    for s in steps:
        sid = s.get("id")
        if not isinstance(sid, str) or not STEP_ID_RE.fullmatch(sid) or "__" in sid:
            issues.append(_issue("error", "bad_step_id", "step id %r isn't valid; use lowercase letters, numbers and _ (no __), starting with a letter" % (sid,), sid if isinstance(sid, str) else None))
            continue
        if sid == "run":
            issues.append(_issue("error", "reserved_step_id", "step id 'run' is reserved for run tokens; choose another id", sid))
        if sid in seen:
            issues.append(_issue("error", "duplicate_step", "two steps use the id %r; give each step its own id" % sid, sid))
        seen.add(sid)
    ids = seen

    for s in steps:
        sid = s.get("id")
        if sid not in ids:
            continue
        if s.get("type") == "saved_search":
            ref = s.get("saved_search_ref")
            if not ref:
                issues.append(_issue("error", "bad_step", "pick a saved search for this step", sid))
            elif known_saved_searches is not None and ref not in known_saved_searches:
                issues.append(_issue("error", "unknown_saved_search", "saved search %r was not found; pick another" % ref, sid))
        elif s.get("type") in ("inline", "previous"):
            if s.get("type") == "inline" and not (s.get("spl") or "").strip():
                issues.append(_issue("error", "bad_step", "this step has no search; write one in Search", sid))
            if _ORCHESTRATE_RE.search(s.get("spl") or ""):
                # It would start runs outside the chain depth limit.
                issues.append(_issue("error", "orchestrate_in_step",
                                     "a step can't call | orchestrate; use a start-job action instead", sid))
            try:
                tk.compile_spl(s.get("spl") or "", ids)
            except tk.TokenError as e:
                issues.append(_issue("error", "unsafe_token_position",
                                     "%s: %s" % (e.token, e.reason), sid))
            if s.get("type") == "previous":
                if not (s.get("spl") or "").lstrip().startswith("|"):
                    issues.append(_issue("error", "previous_needs_pipe",
                                         "the search must start with |, such as | stats count", sid))
                if not any(e.get("to") == sid for e in job.get("edges", []) or []):
                    issues.append(_issue("error", "previous_needs_dependency",
                                         "this step needs a step before it to read from; add one in Depends on", sid))
                if s.get("earliest") or s.get("latest"):
                    issues.extend(old_time_range_issues({"steps": [s]}))
            elif not s.get("earliest") and not s.get("latest"):
                issues.append(_issue("warning", "all_time_search",
                                     "this step searches all time; set a time range to search less", sid))
        else:
            issues.append(_issue("error", "bad_step", "step type %r isn't supported; pick Search, Saved search or Results of earlier steps" % s.get("type"), sid))
        rw = s.get("run_when")
        if rw:
            kind, val = rw.get("kind"), rw.get("value")
            if kind == "cron":
                try:
                    cronmod.parse(val)
                except cronmod.CronError as e:
                    issues.append(_issue("error", "bad_cron", "run when: %s; fix the cron" % e, sid))
            elif kind == "expression":
                _check_expr_tokens(val, ids, params, issues, sid, "run when")
            else:
                issues.append(_issue("error", "bad_run_when", "run when type %r isn't supported; pick one in Run when" % kind, sid))
        spl = s.get("spl") or ""
        for m in _DOTTED_RE.finditer(spl):
            first, rest = m.group(1), m.group(2)
            name = first + "." + rest
            if (first == "run" or first in ids or _SUFFIX_RE.search("." + rest)) \
                    and not _token_ok(name, ids, params):
                issues.append(_issue("error", "unknown_token", "%s isn't a token this job has; pick one with Insert value or fix the spelling" % m.group(0), sid))
        for name in tk.find_tokens(spl, ids):
            if name.startswith("run.param.") and not _token_ok(name, ids, params):
                issues.append(_issue("error", "unknown_token", "$%s$ uses a parameter the job doesn't declare; add it on the Parameters tab" % name, sid))

    edges = job.get("edges", []) or []
    for e in edges:
        a, b = e.get("from"), e.get("to")
        for end in (a, b):
            if end not in ids:
                issues.append(_issue("error", "unknown_edge_step", "a dependency points at step %r, which doesn't exist; remove the dependency" % (end,)))
        cond = e.get("condition", "on_success")
        if cond not in _EDGE_CONDITIONS:
            issues.append(_issue("error", "bad_edge", "dependency condition %r isn't supported; pick on success, on failure, always or an expression" % (cond,)))
        elif cond == "expression":
            _check_expr_tokens(e.get("expression"), ids, params, issues, b if b in ids else None,
                               "dependency %s->%s" % (a, b))

    _, succ = _graph(job)
    try:
        topo_order(job)
    except ValueError:
        issues.append(_issue("error", "cycle", "steps depend on each other in a loop; remove a dependency to break it"))

    # Warnings
    for s in steps:
        if s.get("id") in ids and resolve_step(job, s)["retries"] > 0:
            issues.append(_issue("warning", "retries_duplicate_risk",
                                 "retries above 0 can write duplicates to a summary index; keep retries at 0 unless the step is safe to run twice", s["id"]))
    if not any(a.get("hook") == "on_failure" for a in job.get("actions", []) or []):
        issues.append(_issue("warning", "no_failure_notification",
                             "no failure action, so the admin's fallback notification will be used; add an on_failure action to choose who is told"))
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
                                     "$%s$ may come from a skipped step, which fails this step; add a default, as in $%s|none$" % (name, name), sid))
    return issues


def arg_default_missing(name, defaults):
    return tk.arg_name(name) not in defaults
