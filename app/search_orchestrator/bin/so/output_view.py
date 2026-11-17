"""View output (``POST preview/output``): a read-only search that shows what a write step
or an email or event action wrote, so it can be checked without opening Search.

Body: ``{"target", "job" | "run_id", "range"}``. ``target`` is ``{"step_id"}`` (a step with
an ``output``) or ``{"action": {"scope": "job" | <step id>, "index": n}}`` (an ``email`` or
``event`` action, by its place in ``actions``). Without ``run_id`` the caller must be
allowed to preview ``job`` (``preview_api._preview_target``) and ``range`` (``24h``, ``7d``
or ``30d``; default ``24h``) is the time searched. With ``run_id`` the caller must be
allowed to see the run, its definition is used, and the time searched is the run's own
window (from 1 minute before it started to 10 minutes after it ended, or now).

The search, run as the caller like a preview (so Splunk's own permissions decide what
they may read):

* lookup: ``| inputlookup <name>`` (a lookup has no time);
* summary index: ``index=<index>`` with ``source="<source>"`` when set and, for a run
  whose step adds the run id, ``so_run="<run id>"``;
* event action: ``index=<index>``;
* email action: splunkd's sendemail lines in ``_internal`` (``source=*python.log*``).

201 ``{"status": "started", "sid", "spl", "earliest", "latest", "kind"}``; poll and read
it with ``GET preview/<sid>`` and ``GET preview/<sid>/results``. 400 ``bad_request`` when
the target has no output to show. Audited as ``output_viewed``.
"""
import re
import uuid

from . import preview
from .api import ApiError
from .preview_api import _preview_target

RANGES = {"24h": "-24h", "7d": "-7d", "30d": "-30d"}
NAME_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.:-]*$")
RUN_ID_SAFE = re.compile(r"^[A-Za-z0-9_.:-]+$")
BEFORE = 60
AFTER = 600


def _quote(value):
    return '"%s"' % str(value).replace("\\", "\\\\").replace('"', '\\"')


def _bad(message):
    return ApiError(400, "bad_request", message)


def _step(job, step_id):
    step = next((s for s in job.get("steps") or [] if s.get("id") == step_id), None)
    if step is None:
        raise _bad("there is no step %r" % (step_id,))
    return step


def _action(job, ref):
    if not isinstance(ref, dict) or not isinstance(ref.get("index"), int) or isinstance(ref.get("index"), bool):
        raise _bad("action must be {scope, index}")
    scope = ref.get("scope")
    owner = job if scope == "job" else _step(job, scope)
    actions = owner.get("actions") or []
    if not 0 <= ref["index"] < len(actions):
        raise _bad("there is no action %r of %r" % (ref["index"], scope))
    return actions[ref["index"]]


def output_spl(job, target, run_id=None):
    """``(kind, spl, sid_step)`` for ``target`` of ``job``; raises 400 when it has no output."""
    if not isinstance(target, dict):
        raise _bad("target must be {step_id} or {action}")
    if "step_id" in target:
        step = _step(job, target["step_id"])
        out = step.get("output")
        if not isinstance(out, dict):
            raise _bad("this step writes no output; pick a Lookup or Summary index node")
        if out.get("kind") == "lookup":
            name = out.get("name") or ""
            if not NAME_RE.fullmatch(name):
                raise _bad("the lookup name isn't valid")
            return "lookup", "| inputlookup %s" % name, step["id"]
        index = out.get("index") or ""
        if not NAME_RE.fullmatch(index):
            raise _bad("the summary index name isn't valid")
        parts = ["index=%s" % index]
        if out.get("source"):
            parts.append("source=%s" % _quote(out["source"]))
        if run_id and out.get("add_run_id") is not False:
            parts.append("so_run=%s" % _quote(run_id))
        return "summary_index", " ".join(parts), step["id"]
    action = _action(job, target.get("action"))
    scope = target["action"]["scope"]
    sid_step = "job" if scope == "job" else scope
    if action.get("type") == "event":
        index = action.get("index") or ""
        if not NAME_RE.fullmatch(index):
            raise _bad("the event index name isn't valid")
        return "event", "index=%s" % index, sid_step
    if action.get("type") == "email":
        spl = "index=_internal source=*python.log* sendemail"
        to = action.get("to") or ""
        if to and "$" not in to and "{{" not in to:
            spl += " " + _quote(to.split(",")[0].strip())
        return "email", spl + "\n| table _time log_level _raw", sid_step
    raise _bad("only email and event actions write something to show")


def start(ctx, body):
    target = body.get("target")
    run_id = body.get("run_id")
    if run_id is not None:
        from .api import _visible_run
        if not isinstance(run_id, str) or not RUN_ID_SAFE.fullmatch(run_id):
            raise _bad("run_id isn't valid")
        run = _visible_run(ctx, run_id)
        job = run.get("definition") or {}
        job_ref = run.get("job_id") or "new"
        began = run.get("started_at") or run.get("scheduled_time") or ctx.now
        ended = run.get("ended_at")
        earliest = str(int(began) - BEFORE)
        latest = str(int(ended) + AFTER) if ended else "now"
    else:
        job, job_ref = _preview_target(ctx, body)
        rng = body.get("range") or "24h"
        if rng not in RANGES:
            raise _bad("range must be 24h, 7d or 30d")
        earliest, latest = RANGES[rng], "now"
    kind, spl, sid_step = output_spl(job, target, run_id)
    if kind == "lookup":
        earliest, latest = None, None
    sid = preview.make_sid(ctx.user, job_ref, sid_step, "o" + uuid.uuid4().hex[:15])
    sid = ctx.user_gw.preview_dispatch(ctx.user, spl, earliest, latest, ctx.now, sid)
    ctx.emit({"type": "output_viewed", "job_id": job_ref, "run_id": run_id, "kind": kind, "sid": sid})
    return 201, {"status": "started", "sid": sid, "spl": spl, "earliest": earliest, "latest": latest, "kind": kind}
