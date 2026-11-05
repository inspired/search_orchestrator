"""Pure run-state evaluator (spec section 5). No I/O.

``evaluate(run, now)`` looks at one run and returns the effects that should
happen next. It never mutates ``run``. Effects, in the order returned:

    ("set_step", step_id, fields)      merge fields into run["steps"][step_id]
    ("cancel_search", step_id, sid)
    ("set_run", fields)                merge fields into the run
    ("hook", "step"|"job", hook, step_id|None)
    ("notify_fallback_check", hook, step_id|None)   after on_delayed/on_failure
    ("start_step", step_id)            every ready or due step, in topo order

Concurrency limits (global 10, per job 4) are NOT applied here: the engine
trims the start_step list. A step it does not start stays ``ready`` (or
``retrying`` and due) and is offered again on the next evaluation.

Contract with the engine (Task 6)
---------------------------------
Step states: waiting, ready, starting, running, retrying, succeeded, failed,
skipped, cancelled, abandoned. ``starting`` is set by the engine while
dispatching and is treated exactly like ``running`` (never re-started).

* evaluate owns ``attempt`` (1-based number of the current search attempt),
  ``next_attempt_at``, ``skip_kind`` ("run_when" | "not_taken"),
  ``delay_alerted`` and ``hooks_fired`` (list of hook names, step and run).
* The engine reports the end of an attempt by setting ``outcome`` on a
  starting/running step, and evaluate clears it once handled:
    - "succeeded": with ``result_count``, ``first``, ``ended_at``.
    - "failed": with ``error`` (search failed, missing, finalized...).
    - "dispatch_error": the search never started. The engine has already
      incremented ``dispatch_errors``. Errors 1-3 are retried with the same
      backoff and do not use ``retries``; the 4th consecutive error counts as
      one failed attempt. A step with ``outcome`` set must not be adopted.
* ``max_runtime`` is measured from ``started_at``; exceeding it cancels the
  search and counts as a failed attempt.
* Backoff after failure n (attempt or dispatch error): ``backoff(n)``.

Run fields read: state, scheduled_time, params, delay_base, giveup_base,
paused_seconds, paused_at, hooks_fired, delay_alerted. Written: state,
ended_at, gave_up, hooks_fired, delay_alerted. ``held`` belongs to the engine.

* Delay: per step, ``now - delay_base >= delayed_after`` on an unfinished step
  fires step on_delayed once; the first such step also fires job on_delayed
  once. Never while paused (paused time still counts toward the delay).
* Give-up: ``now - giveup_base - paused time >= give_up_after`` on an
  unfinished step (or an unhandled failed step of a blocked run) gives the run
  up: running searches are cancelled, expired unfinished steps fail, the other
  unfinished steps are abandoned, and the run fails with ``gave_up=True``.
* A run whose failures were all handled ends ``failed``; steps still waiting
  behind a failure are then ``abandoned``. An unhandled failure makes the run
  ``blocked`` once nothing is ready, starting, running or retrying.
* Hooks fire once per occurrence. Step on_start fires when the first attempt
  starts; on_complete follows on_success or a final on_failure. Job on_failure
  fires when the run becomes blocked or failed (once); on_complete fires on
  succeeded, failed or cancelled.
* A run whose state the engine set to ``cancelled`` gets its running searches
  cancelled and its unfinished steps ``cancelled``.
"""
import copy

from . import cron as cronmod
from . import expr as exprmod
from . import model

DISPATCH_RETRIES = 3
ACTIVE = ("ready", "starting", "running", "retrying")
UNFINISHED = ("waiting",) + ACTIVE
IN_FLIGHT = ("starting", "running")
TERMINAL_RUN = ("succeeded", "failed", "cancelled")
_RESET_RUN_HOOKS = ("on_success", "on_failure", "on_complete", "on_delayed")
_FRESH_STEP = {"state": "waiting", "skip_kind": None, "attempt": 0, "sid": None,
               "started_at": None, "ended_at": None, "next_attempt_at": None,
               "delay_alerted": False, "result_count": None, "first": None,
               "error": None, "dispatch_errors": 0, "outcome": None, "hooks_fired": []}


def backoff(n):
    """Seconds to wait after the n-th failure (n >= 1)."""
    return min(30 * 2 ** (max(n, 1) - 1), 900)


def downstream(definition, step_id):
    """Every step reachable from step_id along edges, excluding step_id."""
    succ = {}
    for e in definition.get("edges", []) or []:
        succ.setdefault(e.get("from"), []).append(e.get("to"))
    seen, stack = set(), list(succ.get(step_id, []))
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        stack.extend(succ.get(n, []))
    seen.discard(step_id)
    return seen


class _Eval:
    def __init__(self, run, now):
        self.run = run
        self.now = now
        self.job = run.get("definition") or {}
        self.order = model.topo_order(self.job)
        self.defs = {s["id"]: model.resolve_step(self.job, s) for s in self.job.get("steps", [])}
        self.steps = {}
        for sid in self.order:
            st = dict(_FRESH_STEP)
            st["hooks_fired"] = []
            st.update(copy.deepcopy((run.get("steps") or {}).get(sid) or {}))
            self.steps[sid] = st
        self.incoming = {sid: [] for sid in self.order}
        self.outgoing = {sid: [] for sid in self.order}
        for e in self.job.get("edges", []) or []:
            if e.get("from") in self.steps and e.get("to") in self.steps:
                self.incoming[e["to"]].append(e)
                self.outgoing[e["from"]].append(e)
        self.changes = {}
        self.cancels = []
        self.run_changes = {}
        self.hooks = []
        self.run_hooks = list(run.get("hooks_fired") or [])
        self.paused = run.get("state") == "paused"

    # -- helpers --
    def set(self, step_id, **fields):
        self.steps[step_id].update(fields)
        self.changes.setdefault(step_id, {}).update(fields)

    def step_hook(self, sid, hook):
        fired = list(self.steps[sid].get("hooks_fired") or [])
        if hook in fired:
            return
        fired.append(hook)
        self.set(sid, hooks_fired=fired)
        self.hooks.append(("hook", "step", hook, sid))
        if hook in ("on_delayed", "on_failure"):
            self.hooks.append(("notify_fallback_check", hook, sid))

    def job_hook(self, hook):
        if hook in self.run_hooks:
            return
        self.run_hooks.append(hook)
        self.run_changes["hooks_fired"] = list(self.run_hooks)
        self.hooks.append(("hook", "job", hook, None))
        if hook in ("on_delayed", "on_failure"):
            self.hooks.append(("notify_fallback_check", hook, None))

    def cancel(self, sid):
        st = self.steps[sid]
        if st.get("state") in IN_FLIGHT and st.get("sid"):
            self.cancels.append(("cancel_search", sid, st["sid"]))

    def handled(self, sid):
        return any((e.get("condition") or "on_success") in ("on_failure", "always")
                   for e in self.outgoing[sid])

    def lookup(self, name):
        parts = name.split(".")
        if parts[0] == "run":
            if name == "run.id":
                return self.run.get("id") or self.run.get("_key")
            if name == "run.scheduled_time":
                return self.run.get("scheduled_time")
            if len(parts) == 3 and parts[1] == "param":
                return (self.run.get("params") or {}).get(parts[2])
            return None
        st = self.steps.get(parts[0])
        if st is None or len(parts) < 2:
            return None
        prop = parts[1]
        if prop == "status":
            return st.get("state")
        if prop == "sid":
            return st.get("sid")
        if st.get("state") != "succeeded":
            return None  # a skipped or failed step has no results
        if prop == "resultCount" and len(parts) == 2:
            return st.get("result_count")
        if prop == "first" and len(parts) == 3:
            row = st.get("first")
            return row.get(parts[2]) if isinstance(row, dict) else None
        return None

    def expression(self, text):
        try:
            return bool(exprmod.evaluate(exprmod.parse(text), self.lookup))
        except exprmod.ExprError:
            return False

    # -- edges and readiness --
    def edge(self, e):
        """None if unresolved, else True (satisfied) / False (not satisfied)."""
        up = self.steps[e["from"]]
        cond = e.get("condition") or "on_success"
        s, kind = up.get("state"), up.get("skip_kind")
        if s == "succeeded":
            if cond == "on_success" or cond == "always":
                return True
            if cond == "on_failure":
                return False
            return self.expression(e.get("expression"))
        if s == "failed":
            if cond == "on_success":
                return None
            if cond in ("on_failure", "always"):
                return True
            return self.expression(e.get("expression"))
        if s == "skipped":
            if cond == "always":
                return True
            return cond == "on_success" and kind == "run_when"
        return None

    def run_when_applies(self, sid):
        rw = self.defs[sid].get("run_when") or {}
        kind, value = rw.get("kind"), rw.get("value")
        if not kind or not value:
            return True
        if kind == "cron":
            spec = cronmod.parse(value)
            return cronmod.matches(spec, int(self.run["scheduled_time"]), self.job.get("timezone"))
        if kind == "expression":
            return self.expression(value)
        raise ValueError("unknown run_when kind %r" % kind)

    def resolve(self):
        changed = True
        while changed:
            changed = False
            for sid in self.order:
                if self.steps[sid].get("state") != "waiting":
                    continue
                results = [self.edge(e) for e in self.incoming[sid]]
                if any(r is None for r in results):
                    continue
                if results and not any(results):
                    self.set(sid, state="skipped", skip_kind="not_taken")
                else:
                    try:
                        applies = self.run_when_applies(sid)
                    except (cronmod.CronError, ValueError, TypeError) as err:
                        self.set(sid, state="failed", error="run_when: %s" % err, ended_at=self.now)
                        self.final_failure(sid)
                        changed = True
                        continue
                    if applies:
                        self.set(sid, state="ready", attempt=1)
                    else:
                        self.set(sid, state="skipped", skip_kind="run_when")
                changed = True

    # -- attempts --
    def final_failure(self, sid):
        self.step_hook(sid, "on_failure")
        self.step_hook(sid, "on_complete")

    def failed_attempt(self, sid, error):
        st = self.steps[sid]
        attempt = st.get("attempt") or 1
        if attempt <= (self.defs[sid].get("retries") or 0):
            self.set(sid, state="retrying", attempt=attempt + 1, error=error, outcome=None,
                     dispatch_errors=0, sid=None, started_at=None, ended_at=None,
                     next_attempt_at=self.now + backoff(attempt))
        else:
            self.set(sid, state="failed", error=error, outcome=None, next_attempt_at=None,
                     ended_at=st.get("ended_at") or self.now)
            self.final_failure(sid)

    def attempts(self):
        for sid in self.order:
            st = self.steps[sid]
            if st.get("state") not in IN_FLIGHT:
                continue
            if st.get("state") == "running" or st.get("started_at"):
                self.step_hook(sid, "on_start")
            outcome = st.get("outcome")
            if outcome == "succeeded":
                self.set(sid, state="succeeded", outcome=None, next_attempt_at=None,
                         ended_at=st.get("ended_at") or self.now)
                self.step_hook(sid, "on_success")
                self.step_hook(sid, "on_complete")
            elif outcome == "failed":
                self.failed_attempt(sid, st.get("error") or "search failed")
            elif outcome == "dispatch_error":
                n = st.get("dispatch_errors") or 1
                err = "dispatch failed: %s" % (st.get("error") or "unknown error")
                if n <= DISPATCH_RETRIES:
                    self.set(sid, state="retrying", outcome=None, sid=None,
                             next_attempt_at=self.now + backoff(n))
                else:
                    self.set(sid, ended_at=self.now)
                    self.failed_attempt(sid, err)
            elif st.get("started_at") is not None:  # running or starting
                limit = self.defs[sid].get("max_runtime")
                if limit and self.now - int(st["started_at"]) >= limit:
                    self.cancel(sid)
                    self.set(sid, ended_at=self.now)
                    self.failed_attempt(sid, "exceeded max_runtime of %d seconds" % limit)

    # -- clocks --
    def paused_total(self):
        total = self.run.get("paused_seconds") or 0
        if self.run.get("paused_at") is not None:
            total += max(0, self.now - int(self.run["paused_at"]))
        return total

    def give_up(self):
        base = self.run.get("giveup_base")
        if base is None:
            return False
        elapsed = self.now - int(base) - self.paused_total()
        # An unhandled failure's deadline counts only once the run is blocked:
        # it must not cut short a parallel branch that can still progress.
        blocked = self.run.get("state") == "blocked" or not any(
            self.steps[s].get("state") in ACTIVE for s in self.order)
        expired = []
        for sid in self.order:
            s = self.steps[sid].get("state")
            if s in UNFINISHED or (blocked and s == "failed" and not self.handled(sid)):
                if elapsed >= self.defs[sid]["give_up_after"]:
                    expired.append(sid)
        if not expired:
            return False
        for sid in self.order:
            if self.steps[sid].get("state") not in UNFINISHED:
                continue
            self.cancel(sid)
            if sid in expired:
                self.set(sid, state="failed", outcome=None, next_attempt_at=None, ended_at=self.now,
                         error="gave up after %d seconds" % self.defs[sid]["give_up_after"])
                self.final_failure(sid)
            else:
                self.set(sid, state="abandoned", next_attempt_at=None, ended_at=self.now)
        self.finish("failed", gave_up=True)
        return True

    def delays(self):
        base = self.run.get("delay_base")
        if base is None or self.paused:
            return
        for sid in self.order:
            st = self.steps[sid]
            if st.get("state") in UNFINISHED and not st.get("delay_alerted") \
                    and self.now - int(base) >= self.defs[sid]["delayed_after"]:
                self.set(sid, delay_alerted=True)
                self.step_hook(sid, "on_delayed")
                if not self.run.get("delay_alerted"):
                    self.run_changes["delay_alerted"] = True
                    self.job_hook("on_delayed")

    # -- run state --
    def finish(self, state, **extra):
        self.run_changes.update(extra)
        self.run_changes.update(state=state, ended_at=self.now)
        if state == "failed":
            self.job_hook("on_failure")
        elif state == "succeeded":
            self.job_hook("on_success")
        self.job_hook("on_complete")

    def run_state(self):
        states = [self.steps[s].get("state") for s in self.order]
        if any(s in ACTIVE for s in states):
            return
        failed = [s for s in self.order if self.steps[s].get("state") == "failed"]
        if any(not self.handled(s) for s in failed):
            if not self.paused and self.run.get("state") != "blocked":
                self.run_changes["state"] = "blocked"
            if not self.paused:
                self.job_hook("on_failure")
            return
        if failed:
            for sid in self.order:
                if self.steps[sid].get("state") == "waiting":
                    self.set(sid, state="abandoned", ended_at=self.now)
            self.finish("failed")
        elif all(s in ("succeeded", "skipped") for s in states):
            self.finish("succeeded")

    def cancelled(self):
        for sid in self.order:
            if self.steps[sid].get("state") in UNFINISHED:
                self.cancel(sid)
                self.set(sid, state="cancelled", outcome=None, next_attempt_at=None, ended_at=self.now)
        if "on_complete" not in self.run_hooks:
            self.job_hook("on_complete")
            if self.run.get("ended_at") is None:
                self.run_changes["ended_at"] = self.now

    def effects(self, starts=()):
        out = [("set_step", sid, self.changes[sid]) for sid in self.order if sid in self.changes]
        out.extend(self.cancels)
        if self.run_changes:
            out.append(("set_run", self.run_changes))
        out.extend(self.hooks)
        out.extend(("start_step", sid) for sid in starts)
        return out

    def evaluate(self):
        rs = self.run.get("state")
        if rs == "cancelled":
            self.cancelled()
            return self.effects()
        if rs not in ("running", "blocked", "paused"):
            return []  # queued, or already ended
        self.job_hook("on_start")
        self.attempts()
        self.resolve()
        if self.give_up():
            return self.effects()
        self.delays()
        starts = []
        if not self.paused:
            for sid in self.order:
                st = self.steps[sid]
                if st.get("state") == "ready" or (
                        st.get("state") == "retrying"
                        and int(st.get("next_attempt_at") or 0) <= self.now):
                    starts.append(sid)
        self.run_state()
        if not self.paused and rs == "blocked" and self.run_changes.get("state") is None \
                and any(self.steps[s].get("state") in ACTIVE for s in self.order):
            self.run_changes["state"] = "running"
        return self.effects(starts)


def evaluate(run, now):
    """Effects for one run at epoch ``now``; see the module docstring."""
    return _Eval(run, now).evaluate()


def reset_for_rerun(run, step_id, now, definition=None):
    """New run reset from step_id: that step, everything downstream, and any
    cancelled or abandoned step start again; completed upstream steps are kept.
    Allowed on blocked, failed and cancelled runs (ValueError otherwise). A
    blocked run stays the active run (``running``); an ended run is ``queued``
    again and subject to the one-active-run rule. Clocks restart at ``now``.
    ``definition`` (the job's latest definition) replaces the snapshot."""
    if run.get("state") not in ("blocked", "failed", "cancelled"):
        raise ValueError("re-run is allowed only on blocked, failed or cancelled runs")
    new = copy.deepcopy(run)
    if definition is not None:
        new["definition"] = copy.deepcopy(definition)
    job = new["definition"]
    ids = [s["id"] for s in job.get("steps", [])]
    if step_id not in ids:
        raise ValueError("unknown step %r" % step_id)
    old_steps = new.get("steps") or {}
    steps = {sid: old_steps[sid] for sid in ids if sid in old_steps}
    reset = {step_id} | downstream(job, step_id)
    for sid in ids:
        st = steps.get(sid)
        if st is None or sid in reset or st.get("state") not in ("succeeded", "skipped", "failed"):
            fresh = copy.deepcopy(_FRESH_STEP)
            steps[sid] = dict(st or {}, **fresh)
    new["steps"] = steps
    new["state"] = "running" if run.get("state") == "blocked" else "queued"
    new.update(ended_at=None, gave_up=False, held=False, delay_alerted=False,
               delay_base=now, giveup_base=now, paused_seconds=0, paused_at=None)
    new["hooks_fired"] = [h for h in (run.get("hooks_fired") or []) if h not in _RESET_RUN_HOOKS]
    return new
