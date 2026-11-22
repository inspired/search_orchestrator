"""Test condition (spec section 4), dispatched from ``api.handle`` like the preview routes.

``POST preview/condition`` ``{"job", "from", "to", "scheduled_time", "params", "input"}``
runs one condition line (``condition: expression``) now, with the editor's preview context
and the same ``input`` as ``POST preview``:

* the source step skipped: 200 ``{"status": "done", "result": false, "why"}``, no search;
* an approval source step counts as approved with no comment, as in previews (with
  ``input`` from a run, its recorded decision);
* a ``simple`` comparison is evaluated here with ``expr.py``: 200 ``{"status": "done",
  "kind", "result", "filled", "values", "why"}`` (a parse error: ``result`` false, ``error``);
* an ``eval`` or ``search`` condition is dispatched as an ad hoc search as the caller, under
  a preview sid of the line's target step (``c`` + random), so ``GET preview/<sid>``, its
  results and cancel apply: 201 ``{"status": "started", "kind", "sid", "spl", "earliest",
  "latest"}``. The client polls; a row count above 0 is true.

Errors: 400 ``unknown_edge``, and the preview errors (``needs_preview``, run results gone or
forbidden, ``invalid``). Audited as ``condition_tested``.
"""
import re
import uuid

from . import expr, hidden, preview, tokens
from . import state as statemod
from .api import ApiError, _issue, _scheduled_time
from .preview_api import (RUN_ENDED, _check_run_result, _invalid, _preview_params,
                          _preview_scope, _preview_target, _preview_upstream)

TEST_LIMIT = 300  # seconds a condition search may run: the engine's condition timeout
NO_VALUE = "(no value)"
_TOKEN = re.compile(r"\$([A-Za-z0-9_.]+)\$")


def fill_simple(text, values):
    """``text`` with each ``$token$`` replaced by its value, or ``(no value)``."""
    return _TOKEN.sub(lambda m: str(values[m.group(1)]) if m.group(1) in values else NO_VALUE,
                      text)


def _find_edge(job, src, dst):
    for e in job.get("edges") or []:
        if isinstance(e, dict) and e.get("from") == src and e.get("to") == dst \
                and e.get("condition") == "expression":
            return e
    raise ApiError(400, "unknown_edge", "the job has no condition line from %s to %s"
                   % (src, dst))


def _run_source(ctx, upstream, job, src, run_id):
    """A run input must hold the source step's own result, which ``_run_upstream`` only
    checks for the steps a step reads."""
    st = upstream.get(src) or {}
    if st.get("state") not in RUN_ENDED:
        raise ApiError(409, "run_step_missing", "%s has no result in that run; switch to live "
                       "previews or pick another run" % src, step=src)
    if st.get("state") == "succeeded" and st.get("sid"):
        _check_run_result(ctx, src, st["sid"])


def _lookup(tctx):
    """The value of ``name`` as a run's expression would see it (``state._Eval.lookup``)."""
    run, steps = tctx["run"], tctx["steps"]

    def lookup(name):
        parts = name.split(".")
        if parts[0] == "run":
            if name in ("run.scheduled_time", "run.now"):
                return run.get(parts[1])
            if name == "run.id":
                return run.get("id")
            return run["params"].get(parts[2]) if len(parts) == 3 and parts[1] == "param" else None
        st = steps.get(parts[0])
        if st is None or len(parts) < 2:
            return None
        if parts[1] in ("status", "sid") and len(parts) == 2:
            return st.get(parts[1])
        if st.get("status") != "succeeded":
            return None
        if parts[1] == "resultCount" and len(parts) == 2:
            return st.get("resultCount")
        if parts[1] == "first" and len(parts) == 3:
            return (st.get("first") or {}).get(parts[2])
        return None
    return lookup


def _simple(edge, tctx):
    text = edge.get("expression") or ""
    try:
        node = expr.parse(text)
    except expr.ExprError as err:
        return {"status": "done", "kind": "simple", "result": False, "error": str(err),
                "filled": text, "values": {},
                "why": "The comparison can't be read: %s. Fix it and test again." % err}
    lookup = _lookup(tctx)
    values = {}
    for name in sorted(expr.tokens(node)):
        value = lookup(name)
        if value is not None:
            values[name] = str(value)
    result = bool(expr.evaluate(node, lookup))
    filled = fill_simple(text, values)
    return {"status": "done", "kind": "simple", "result": result, "filled": filled,
            "values": values, "why": "%s is %s" % (filled, "true" if result else "false")}


def start(ctx, body):
    job, job_ref = _preview_target(ctx, body)
    src, dst = body.get("from"), body.get("to")
    edge = _find_edge(job, src, dst)
    scope = _preview_scope(job, src, approval_ok=True)
    params = _preview_params(job, body)
    scheduled = _scheduled_time(ctx, body)
    scope = scope + [src]
    source = body.get("input")
    upstream = _preview_upstream(ctx, job, job_ref, src, scope, source, scheduled, params)
    if isinstance(source, dict) and source.get("mode") == "run":
        _run_source(ctx, upstream, job, src, source.get("run_id"))
    kind = tokens.condition_kind(edge)
    audit = {"type": "condition_tested", "job_id": job_ref, "edge": statemod.condition_key(edge),
             "kind": kind}
    step = next(s for s in job["steps"] if s.get("id") == src)
    if (upstream.get(src) or {}).get("state") == "skipped":
        ctx.emit(audit)
        return 200, {"status": "done", "kind": kind, "result": False,
                     "why": "%s would be skipped, so this line isn't taken; no condition runs."
                            % (step.get("name") or src)}
    tctx = preview.token_context(job, scheduled, params, upstream, ctx.now)
    if kind == "simple":
        ctx.emit(audit)
        return 200, _simple(edge, tctx)
    ids = [s.get("id") for s in job["steps"]]
    compiled, names = tokens.compile_condition(edge.get("expression") or "", ids, kind)
    try:
        args = tokens.render_args(names, tctx, tokens.token_defaults(edge.get("expression") or "",
                                                                     ids))
    except tokens.TokenError as err:
        raise _invalid([_issue("error", "bad_token", "token %s: %s" % (err.token, err.reason),
                               dst)])
    spl = tokens.fill(compiled, args)
    earliest, latest = hidden.condition_time_range(edge)
    sid = preview.make_sid(ctx.user, job_ref, dst, "c" + uuid.uuid4().hex[:15])
    sid = ctx.user_gw.preview_dispatch(ctx.user, spl, earliest, latest, scheduled, sid)
    ctx.emit(dict(audit, sid=sid))
    return 201, {"status": "started", "kind": kind, "sid": sid, "spl": spl,
                 "earliest": earliest, "latest": latest}
