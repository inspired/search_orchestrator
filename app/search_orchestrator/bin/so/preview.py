"""Step preview helpers (pure). No I/O.

A preview runs one step of a job as the caller, through the caller's own session, with
an ad-hoc search job whose sid this module names. Nothing is stored: a preview is
recognised by its sid (``PREFIX``, the caller's name hash and the job) and the job's
owner as splunkd reports it.
"""
import hashlib
import re

from . import cron as cronmod
from . import model
from . import tokens

PREFIX = "so_preview_"
MAX_RUNTIME = 600   # seconds a preview search may run before it is cancelled
TABLE_ROWS = 100    # rows shown in the preview table
TTL = 1800          # seconds a finished preview job is kept
LOOKBACK_DAYS = 400


SID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
JOB_REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")  # api.JOB_ID_RE; "new" matches
RAND_RE = re.compile(r"^[A-Za-z0-9]{1,32}$")
_HASH_RE = re.compile(r"^[0-9a-f]{8}$")


def _user_hash(user):
    return hashlib.sha1(str(user).encode("utf-8")).hexdigest()[:8]


def _valid_step(step_id):
    return isinstance(step_id, str) and bool(model.STEP_ID_RE.fullmatch(step_id)) \
        and "__" not in step_id


def _parts(sid):
    """``(hash, job_ref, step_id, rand)`` of a well-formed preview sid, else None. ``.``
    separates the parts: it is legal in a sid and absent from job, step and rand parts."""
    if not isinstance(sid, str) or not SID_RE.fullmatch(sid) or not sid.startswith(PREFIX):
        return None
    parts = sid[len(PREFIX):].split(".")
    if len(parts) != 4:
        return None
    h, job_ref, step_id, rand = parts
    if not (_HASH_RE.fullmatch(h) and JOB_REF_RE.fullmatch(job_ref) and _valid_step(step_id)
            and RAND_RE.fullmatch(rand)):
        return None
    return h, job_ref, step_id, rand


def parts(sid):
    """``(hash, job_ref, step_id, rand)`` of a well-formed preview sid, else None."""
    return _parts(sid)


def make_sid(user, job_ref, step_id, rand):
    """``so_preview_<sha1(user)[:8]>.<job_ref>.<step_id>.<rand>``. ``job_ref`` is the job
    id, or ``new`` for an unsaved job. Raises ValueError for a malformed part."""
    if not isinstance(job_ref, str) or not JOB_REF_RE.fullmatch(job_ref):
        raise ValueError("bad job reference %r" % (job_ref,))
    if not _valid_step(step_id):
        raise ValueError("bad step id %r" % (step_id,))
    if not isinstance(rand, str) or not RAND_RE.fullmatch(rand):
        raise ValueError("bad random part %r" % (rand,))
    return "%s%s.%s.%s.%s" % (PREFIX, _user_hash(user), job_ref, step_id, rand)


def own_preview(info, sid, user, job_ref, step_id=None):
    """True when ``sid`` is a well-formed preview sid made for ``user`` and ``job_ref``
    (and ``step_id``, if given), and splunkd says ``user`` owns the job (``info`` is
    ``preview_info``)."""
    parts = _parts(sid)
    if parts is None:
        return False
    h, ref, step, _ = parts
    return (h == _user_hash(user) and ref == job_ref
            and (step_id is None or step == step_id)
            and (info or {}).get("owner") == user)


def _step_refs(step, step_ids):
    """Step ids ``step``'s SPL names in tokens (``previous`` steps too)."""
    out = set()
    for name in tokens.find_tokens(step.get("spl") or "", step_ids):
        ref = name.split(".")[0]
        if ref != "run" and ref in step_ids:
            out.add(ref)
    return out


def closure(definition, step_id):
    """The upstream steps ``step_id`` reads through edges or tokens, transitively, in
    topological order, without ``step_id`` itself."""
    steps = {s.get("id"): s for s in definition.get("steps") or []}
    ids = list(steps)
    preds = {sid: set() for sid in ids}
    for e in definition.get("edges") or []:
        if e.get("from") in steps and e.get("to") in steps:
            preds[e["to"]].add(e["from"])
    token_edges = []
    for sid, s in steps.items():
        for ref in _step_refs(s, ids):
            if ref != sid:
                preds[sid].add(ref)
                token_edges.append({"from": ref, "to": sid})
    seen, stack = set(), list(preds.get(step_id, ()))
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        stack.extend(preds[n])
    seen.discard(step_id)
    graph = dict(definition, edges=list(definition.get("edges") or []) + token_edges)
    try:
        order = model.topo_order(graph)
    except ValueError:  # token refs form a cycle with the edges: order by edges only
        order = model.topo_order(definition)
    return [s for s in order if s in seen]


def default_time(job, now):
    """The latest slot before ``now`` of the job's enabled cron triggers (one without
    ``enabled`` counts as enabled), looking back at most 400 days; else ``now``."""
    best = None
    for t in job.get("triggers") or []:
        if not isinstance(t, dict) or t.get("type") != "cron" or t.get("enabled") is False:
            continue
        try:
            spec = cronmod.parse(t.get("cron"))
        except cronmod.CronError:
            continue
        slot = cronmod.prev_slot(spec, now, job.get("timezone"), LOOKBACK_DAYS)
        if slot is not None and (best is None or slot > best):
            best = slot
    return now if best is None else best


def reads(definition, step_id):
    """The steps ``step_id`` reads directly: its edge sources and the steps its SPL names
    in tokens (``Engine._expired_upstream``'s rule), in topological order."""
    steps = {s.get("id"): s for s in definition.get("steps") or []}
    used = {e.get("from") for e in definition.get("edges") or [] if e.get("to") == step_id}
    used |= _step_refs(steps.get(step_id) or {}, list(steps))
    used.discard(step_id)
    return [s for s in closure(definition, step_id) if s in used]


def input_sids(definition, step_id, upstream):
    """A ``previous`` step's input sids: its dependencies that succeeded, in edge order
    (``Engine._input_sids``'s rule). ``upstream`` is ``{step_id: {"state", "sid"}}``."""
    return [(upstream.get(up) or {}).get("sid")
            for up in tokens.previous_inputs(definition, step_id)
            if (upstream.get(up) or {}).get("state") == "succeeded"]


def token_context(definition, scheduled_time, params, upstream):
    """The ``render_args`` ctx for a preview, shaped like ``tokens.run_context``: run id
    ``preview``, the given params, and each step's state from ``upstream``."""
    steps = {}
    for s in definition.get("steps") or []:
        st = upstream.get(s.get("id")) or {}
        steps[s.get("id")] = {"status": st.get("state"), "sid": st.get("sid"),
                              "resultCount": st.get("result_count"), "first": st.get("first")}
    return {"run": {"id": "preview", "scheduled_time": str(int(scheduled_time)),
                    "params": dict(params or {})},
            "steps": steps}


def step_search(step, step_ids, ctx, sids=None):
    """The full SPL a preview of an ``inline`` or ``previous`` step sends: the saved
    search text a run would use (``tokens.step_spl``, or ``tokens.empty_step_spl`` for a
    ``previous`` step with no ``sids``), its args rendered from ``ctx`` and ``so_input``
    from ``tokens.input_spl(sids)``, filled in. Raises TokenError."""
    previous = step.get("type") == "previous"
    if previous and not sids:
        compiled, names = tokens.empty_step_spl(step, step_ids)
    else:
        compiled, names = tokens.step_spl(step, step_ids)
    args = tokens.render_args(names, ctx, tokens.token_defaults(step.get("spl") or "", step_ids))
    if previous and sids:
        args[tokens.INPUT_ARG] = tokens.input_spl(sids)
    return tokens.fill(compiled, args)
