"""Schedule projection for the global timeline and the builder's busy-times strip
(design: docs/superpowers/specs/2026-11-11-schedule-timeline-design.md). Pure: callers
pass jobs, runs and times; nothing here reads KV Store.

* ``profile`` estimates when each step of a job starts and how long it runs, relative to
  the run's start: from each step's most recent succeeded attempt, else from the step
  graph with ``FALLBACK_STEP_SECONDS`` per step, at most ``max_per_job`` at once.
* ``steps_for_slot`` says which steps a run at a cron slot would run, honouring cron
  ``run_when`` conditions. Expression conditions and expression edges can't be judged
  ahead of time, so they count as taken (overstating load is the safe side).
* ``project`` places a job's future cron runs; ``project_dependents`` places runs of jobs
  with completion triggers at the projected end of their upstream runs.
* ``load_series`` turns search intervals into ``[[t, count], ...]`` change points.
* ``merge_dense`` merges runs packed too tightly to draw into spans.
* ``suggest`` finds a quieter start time near a single-time cron.

The load is raw demand: no queueing above ``max_searches`` is simulated, so a projection
can go over the limit, which is the point.
"""
from . import cron as cronmod
from . import model, scheduler, state
from .actions import CHAIN_LIMIT

FALLBACK_STEP_SECONDS = 60
MAX_WINDOW = 8 * 86400
MAX_BARS_PER_JOB = 500
DENSE_DIVISOR = 400  # runs closer than window/400 (about 3 px) merge into a span
SUGGEST_RANGE = 120 * 60
SUGGEST_STEP = 5 * 60
CLEARLY_QUIETER = 2
WORKING = ("ready", "starting", "running", "retrying")
MERGEABLE = ("succeeded", "scheduled")
DAY = 86400


def _steps(job):
    return [s for s in job.get("steps") or [] if isinstance(s, dict) and isinstance(s.get("id"), str)]


def _order(job):
    try:
        return model.topo_order(job)
    except ValueError:
        return [s["id"] for s in _steps(job)]


def _preds(job):
    preds = {}
    for e in job.get("edges") or []:
        if isinstance(e, dict):
            preds.setdefault(e.get("to"), []).append(e.get("from"))
    return preds


def profile(job, history_runs, max_per_job):
    """``{step_id: (offset, duration)}`` for ``job``. ``history_runs``: the job's runs,
    newest first (a run's ``steps`` map holds ``state``, ``started_at``, ``ended_at``)."""
    ids = {s["id"] for s in _steps(job)}
    out = {}
    for run in history_runs or []:
        origin = run.get("started_at")
        if origin is None:
            continue
        for sid, st in (run.get("steps") or {}).items():
            if sid in ids and sid not in out and isinstance(st, dict) and st.get("state") == "succeeded":
                s, e = st.get("started_at"), st.get("ended_at")
                if s is not None and e is not None and e >= s:
                    out[sid] = (max(0, int(s - origin)), max(1, int(e - s)))
    preds = _preds(job)
    cap = max(1, int(max_per_job or 1))
    placed = list(out.values())
    for sid in _order(job):
        if sid in out:
            continue
        ready = max([out[p][0] + out[p][1] for p in preds.get(sid, []) if p in out] or [0])
        start = ready
        while True:  # the first time at or after ready when fewer than cap steps run
            busy = [o + d for o, d in placed if o <= start < o + d]
            if len(busy) < cap:
                break
            start = min(busy)
        out[sid] = (start, FALLBACK_STEP_SECONDS)
        placed.append(out[sid])
    return out


def _judgeable(job):
    """``job`` with expression run_when conditions removed and expression edges always
    taken, so a projection can decide every step without run-time values."""
    steps = []
    for s in _steps(job):
        s = dict(s)
        if (s.get("run_when") or {}).get("kind") != "cron":
            s.pop("run_when", None)
        steps.append(s)
    edges = []
    for e in job.get("edges") or []:
        if isinstance(e, dict):
            e = dict(e)
            if (e.get("condition") or "on_success") not in ("on_success", "on_failure", "always"):
                e["condition"] = "always"
            edges.append(e)
    return dict(job, steps=steps, edges=edges)


def steps_for_slot(job, slot):
    """The step ids a run at ``slot`` would run, assuming every step that runs succeeds."""
    definition = _judgeable(job)
    upstream, out = {}, set()
    for sid in _order(definition):
        try:
            decision, kind = state.preview_decision(definition, sid, slot, {}, upstream)
        except (ValueError, TypeError, KeyError):
            decision, kind = "run", None  # a real run would fail the step; it ran briefly
        if decision == "run":
            out.add(sid)
            upstream[sid] = {"state": "succeeded"}
        else:
            upstream[sid] = {"state": "skipped", "skip_kind": kind or "not_taken"}
    return out


def _day_key(job, slot):
    """What decides ``steps_for_slot`` for ``slot``: whether each cron run_when matches."""
    key = []
    for s in _steps(job):
        rw = s.get("run_when") or {}
        if rw.get("kind") == "cron" and rw.get("value"):
            try:
                key.append(cronmod.matches(cronmod.parse(rw["value"]), int(slot), job.get("timezone")))
            except cronmod.CronError:
                key.append(None)
    return tuple(key)


def _run_at(job, prof, start, memo=None):
    memo = {} if memo is None else memo
    key = _day_key(job, start)
    if key not in memo:
        memo[key] = steps_for_slot(job, start)
    run_steps = memo[key]
    steps = sorted((start + prof[s][0], start + prof[s][0] + prof[s][1]) for s in run_steps if s in prof)
    end = max([e for _, e in steps] or [start + 1])
    return {"start": int(start), "end": int(end), "steps": steps}


def _slots(specs, start, end, tz):
    out = set()
    for spec in specs:
        out.update(cronmod.slots_between(spec, int(start), int(end), tz))
    return sorted(out)


def project(job, prof, start, end, now):
    """Projected cron runs of ``job`` starting in ``[max(start, now), end)``."""
    if job.get("enabled") is False:
        return []
    specs = scheduler.cron_specs(job)
    slots = _slots(specs, max(start, now), end, job.get("timezone"))
    memo = {}
    return [_run_at(job, prof, s, memo) for s in slots]


def _completion_upstreams(job):
    out = []
    for t in job.get("triggers") or []:
        if isinstance(t, dict) and t.get("type") == "completion" and t.get("enabled") is not False \
                and isinstance(t.get("job"), str) and t.get("job"):
            out.append(t["job"])
    return out


def project_dependents(jobs, profiles, projected, end):
    """``{job_id: [runs]}`` for jobs started by completion triggers on projected runs,
    following chains up to ``CHAIN_LIMIT``. ``jobs``: ``{job_id: job}``; ``profiles``:
    ``{job_id: profile}``; ``projected``: ``{job_id: [runs]}`` of cron runs."""
    targets = {}
    for jid, job in jobs.items():
        if job.get("enabled") is False:
            continue
        for up in _completion_upstreams(job):
            targets.setdefault(up, []).append(jid)
    out, memos = {}, {}
    frontier = [(jid, r) for jid, runs in projected.items() for r in runs]
    for _ in range(CHAIN_LIMIT):
        nxt = []
        for up_id, run in frontier:
            for jid in sorted(targets.get(up_id, [])):
                if run["end"] >= end:
                    continue
                dep = _run_at(jobs[jid], profiles.get(jid) or {}, run["end"], memos.setdefault(jid, {}))
                dep.update(dependent=True, upstream=up_id)
                out.setdefault(jid, []).append(dep)
                nxt.append((jid, dep))
        if not nxt:
            break
        frontier = nxt
    for runs in out.values():
        runs.sort(key=lambda r: r["start"])
    return out


def run_intervals(run, now):
    """Search intervals ``[(start, end)]`` of an actual run: one per step that started."""
    out = []
    for st in (run.get("steps") or {}).values():
        if not isinstance(st, dict) or st.get("started_at") is None:
            continue
        s = int(st["started_at"])
        if st.get("state") in WORKING:
            e = int(now)
        else:
            e = int(st.get("ended_at") if st.get("ended_at") is not None else s)
        if e > s:
            out.append((s, e))
    return out


def load_series(intervals, start, end):
    """``[[t, count], ...]``: the number of intervals active from each ``t`` until the
    next point, over ``[start, end)``. Always starts at ``start``."""
    delta = {}
    for s, e in intervals:
        s, e = max(int(s), int(start)), min(int(e), int(end))
        if e <= s:
            continue
        delta[s] = delta.get(s, 0) + 1
        delta[e] = delta.get(e, 0) - 1
    out, n = [[int(start), 0]], 0
    for t in sorted(delta):
        n += delta[t]
        if t >= end:
            break
        if out[-1][0] == t:
            out[-1][1] = n
        elif out[-1][1] != n:
            out.append([t, n])
    return out


def peak(series, intervals):
    """The highest count in ``series`` during any of ``intervals``."""
    best = 0
    for i, (t, n) in enumerate(series):
        t_end = series[i + 1][0] if i + 1 < len(series) else float("inf")
        if n > best and any(s < t_end and e > t for s, e in intervals):
            best = n
    return best


def merge_dense(bars, start, end):
    """Bars sorted by start, with runs of done or scheduled bars closer than
    ``(end - start) / DENSE_DIVISOR`` merged into ``{"kind": "span", "state", "start",
    "end", "count"}``. Failed, running and queued runs never merge. At most
    ``MAX_BARS_PER_JOB`` entries are kept (closest to the window start first)."""
    gap = max(1, (end - start) / DENSE_DIVISOR)
    out = []
    for bar in sorted(bars, key=lambda b: b["start"]):
        last = out[-1] if out else None
        if last is not None and bar.get("state") in MERGEABLE and last.get("state") == bar.get("state") \
                and bar["start"] - last["end"] < gap:
            if last.get("kind") != "span":
                last = out[-1] = {"kind": "span", "state": last["state"], "start": last["start"],
                                  "end": last["end"], "count": 1,
                                  "estimated": bool(last.get("estimated"))}
            last["end"] = max(last["end"], bar["end"])
            last["count"] += 1
            continue
        out.append(bar)
    return out[:MAX_BARS_PER_JOB]


def is_daily(job):
    """True when every enabled cron trigger fires every day and no step's cron run_when
    limits the days, so 24 hours show the whole pattern."""
    for spec in scheduler.cron_specs(job):
        if not (spec.dom_star and spec.dow_star and len(spec.months) == 12):
            return False
    for s in _steps(job):
        rw = s.get("run_when") or {}
        if rw.get("kind") == "cron" and rw.get("value"):
            return False
    return True


def suggest(job, cron_text, prof, other_load, start, end, max_searches):
    """A quieter start time near ``cron_text`` (one minute and one hour value only), as
    ``{"hour", "minute", "peak", "base_peak"}``, or None. Candidates lie within
    ``SUGGEST_RANGE`` on the same day, in ``SUGGEST_STEP`` steps; the closest one whose
    peak of other searches is ``CLEARLY_QUIETER`` lower, or that is no longer over
    ``max_searches``, wins."""
    try:
        spec = cronmod.parse(cron_text)
    except cronmod.CronError:
        return None
    if len(spec.minutes) != 1 or len(spec.hours) != 1:
        return None
    tz = job.get("timezone")
    base = next(iter(spec.hours)) * 3600 + next(iter(spec.minutes)) * 60
    memo = {}

    def score(t):
        variant = spec._replace(hours=frozenset([t // 3600]), minutes=frozenset([(t % 3600) // 60]))
        runs = [_run_at(job, prof, s, memo) for s in _slots([variant], start, end, tz)]
        own = [iv for r in runs for iv in r["steps"]] or [(r["start"], r["end"]) for r in runs]
        if not own:
            return None, 0
        own_peak = max(n for _, n in load_series(own, start, end))
        return peak(other_load, own), own_peak

    base_score, own_peak = score(base)
    if base_score is None:
        return None
    limit = int(max_searches or 0)
    over = limit and base_score + own_peak > limit
    candidates = [base + d for d in range(-SUGGEST_RANGE, SUGGEST_RANGE + 1, SUGGEST_STEP)
                  if d and 0 <= base + d < DAY]
    candidates.sort(key=lambda t: (abs(t - base), t))
    for t in candidates:
        s, _ = score(t)
        if s is None:
            continue
        if s <= base_score - CLEARLY_QUIETER or (over and s + own_peak <= limit):
            return {"hour": t // 3600, "minute": (t % 3600) // 60, "peak": s, "base_peak": base_score}
    return None
