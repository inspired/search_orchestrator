"""The engine tick (spec section 8): applies ``state.evaluate``'s decisions to
Splunk and KV Store. It is the only component that advances runs.

``Engine.tick()`` runs spec section 8's steps in order:

1. Take or renew the leader lease; a non-leader does nothing.
2. Fire due cron slots (``scheduler``), then apply pending commands
   (pause, resume, cancel, rerun, dismiss) from ``so_commands``.
3. Send the daily hold alert, then promote queued runs: one active run per
   job, re-runs first, then oldest ``scheduled_time``. A held run (failed by
   give-up with ``after_give_up = hold``) blocks promotion until a re-run or
   dismiss.
4-5. For each active run, oldest first: poll in-flight searches and record
   each outcome on the step, evaluate, apply the effects, and start ready
   steps within the global and per-job limits, in topo order.
6. Touch results of non-terminal runs (live, and queued re-runs with kept
   results) every 5 minutes; at run end, set their TTL to the result-retention
   setting.
7. ``actions.pump(now, keep_lease)``.
8. Each run is saved as one document; audit events are emitted after the
   save that made them true. Ended runs are pruned at most once an hour.

Crash safety
------------
* Step start: save ``state="starting"`` with ``intent_at``, render args,
  dispatch, save the search ID. A ``starting`` step with no search ID (and no
  ``outcome``) found later asks ``gateway.history(owner, name, intent_at)``,
  adopts the newest job, or dispatches if there is none. Adoption runs before
  evaluate, so a cancel or give-up cancels the adopted search; re-dispatch runs
  after evaluate, only if the step is still wanted. A transient history
  error leaves the step ``starting`` (in flight) and evaluate still runs, so
  give-up, cancel and max_runtime proceed; an unknown that lasts 300 s from
  the dispatch try (``try_at``) fails the attempt. A non-transient history
  error fails the attempt at once. A step that ends while its search could
  not be confirmed is audited as ``possible_orphan_search``.
* Dispatch errors: a transient error checks history before counting a
  dispatch error; if history cannot answer, the step stays ``starting`` with
  no outcome (bounded as above). A dispatch-error retry of the same attempt
  keeps its first ``intent_at`` and checks history before dispatching again.
* Commands are isolated: one that raises stays queued (``command_retry``)
  and is dropped after 10 failures (``command_failed``).
* Re-runs record ``kept_sids``. A step whose kept upstream results have
  expired fails with "Results of step <id> have expired; re-run from <id>".
* Long ticks renew the lease every 10 s between steps and stop if another
  member took it. Pruning deletes at most 200 runs per tick.
* Hooks: every hook effect is submitted (an idempotent ``so_action_runs`` row)
  before the run recording it in ``hooks_fired`` is saved, so a replayed tick
  never submits twice.
* Searches are cancelled before the run that records the cancellation is
  saved; a failed cancel skips the run's save so it is retried.
* A KV Store error aborts the tick without raising. Every write is a whole
  document, so a run is never half-written; the next tick re-derives the same
  decisions. An HTTP 401 (expired session key) raises ``AuthExpired`` and
  never fails a run: the modular input reloads its session key.

Settings (``so_settings`` document ``settings``, defaults in
``DEFAULT_SETTINGS``): ``max_searches``, ``max_searches_per_job``,
``queue_cap``, ``result_retention`` (seconds), ``run_retention_days``.
The engine's own bookkeeping lives in the ``engine_state`` document.
"""
import logging
import time

from . import expr as exprmod
from . import model, scheduler, tokens
from . import state as statemod
from .gateway import DispatchError, GatewayError, KvError
from .lease import Lease
from .store import ACTIVE_RUN_STATES, TERMINAL_RUN_STATES

log = logging.getLogger(__name__)

DEFAULT_SETTINGS = {"max_searches": 10, "max_searches_per_job": 4, "queue_cap": 20,
                    "result_retention": 86400, "run_retention_days": 90}
TOUCH_EVERY = 300
PRUNE_EVERY = 3600
STATE_SAVE_EVERY = 60
HOLD_ALERT_EVERY = 86400
DAY = 86400
IN_FLIGHT = ("starting", "running")
LIVE = ("running", "blocked", "paused")
PRUNE_BATCH = 200
LEASE_RENEW_EVERY = 10
UNKNOWN_LIMIT = 300  # seconds a dispatch's fate may stay unknown before the attempt fails
COMMAND_ATTEMPTS = 10


class LeaseLost(Exception):
    """The lease could not be renewed mid-tick: another member may lead now."""


class AuthExpired(GatewayError):
    """splunkd rejected the session key (HTTP 401)."""

    def __init__(self, message):
        GatewayError.__init__(self, message, status=401)


def _check_auth(err):
    if isinstance(err, AuthExpired):
        raise err
    if isinstance(err, GatewayError) and err.status == 401:
        raise AuthExpired(str(err))


def _inflight(run):
    return sum(1 for st in (run.get("steps") or {}).values() if st.get("state") in IN_FLIGHT)


def _run_id(run):
    return run.get("_key") or run.get("id")


def _scalar(value):
    if isinstance(value, list):
        return value[0] if value else None
    return value


def first_fields(definition):
    """{step_id: {field}} for every ``$step.first.field$`` the job references."""
    steps = definition.get("steps") or []
    ids = [s["id"] for s in steps]
    found = set()
    for s in steps:
        found |= tokens.find_tokens(s.get("spl") or "", ids)
    texts = [e.get("expression") for e in definition.get("edges") or [] if e.get("expression")]
    texts += [(s.get("run_when") or {}).get("value") for s in steps
              if (s.get("run_when") or {}).get("kind") == "expression"]
    for text in texts:
        try:
            found |= exprmod.tokens(exprmod.parse(text))
        except exprmod.ExprError:
            pass
    out = {}
    for name in found:
        parts = name.split(".")
        if len(parts) == 3 and parts[1] == "first" and parts[0] in ids:
            out.setdefault(parts[0], set()).add(parts[2])
    return out


class _Budget:
    """Running-search limits across all runs (global) and per job."""

    def __init__(self, runs, settings):
        self.max_global = int(settings["max_searches"])
        self.max_job = int(settings["max_searches_per_job"])
        self.total = 0
        self.jobs = {}
        for run in runs:
            n = _inflight(run)
            self.total += n
            self.jobs[run.get("job_id")] = self.jobs.get(run.get("job_id"), 0) + n

    def adjust(self, job_id, delta):
        self.total += delta
        self.jobs[job_id] = self.jobs.get(job_id, 0) + delta

    def room(self, job_id):
        return max(0, min(self.max_global - self.total, self.max_job - self.jobs.get(job_id, 0)))


class _Pending:
    """Audit events and attempt rows that become true with the next run save."""

    def __init__(self):
        self.events = []
        self.rows = []


class Engine:
    def __init__(self, gateway, store, audit, actions, clock=time.time, holder="engine"):
        self.gw = gateway
        self.store = store
        self.audit = audit
        self.actions = actions
        self.clock = clock
        self.holder = holder
        self.lease = Lease(gateway)
        self._leader = False
        self._lease_at = 0
        self._estate = None
        self._estate_saved = None
        self._estate_urgent = False

    # -- the tick -------------------------------------------------------------

    def tick(self):
        now = int(self.clock())
        try:
            if not self.lease.acquire(self.holder, now):
                self._leader = False
                return
            self._lease_at = now
            if not self._leader or self._estate is None:
                self._estate = self.store.get_engine_state()
                self._estate_saved = now
                self._leader = True
            self._tick(now)
        except LeaseLost:
            self._leader = False
            log.warning("lease lost during the tick; stopping it")
        except GatewayError as err:
            _check_auth(err)
            log.warning("tick skipped (%s): %s", type(err).__name__, err)

    def _keep_lease(self):
        """Renew the lease during a long tick; stop the tick if another member took it."""
        now = int(self.clock())
        if now - self._lease_at < LEASE_RENEW_EVERY:
            return
        if not self.lease.acquire(self.holder, now):
            raise LeaseLost()
        self._lease_at = now

    def _tick(self, now):
        settings = self._settings()
        jobs = {}
        for job in self.store.list_jobs():
            jobs[job.get("id") or job.get("_key")] = job
        self._fire_cron(jobs, settings, now)
        self._keep_lease()
        self._commands(jobs, settings, now)
        self._keep_lease()
        runs = self.store.list_active_runs()
        held = [r for r in self.store.list_runs({"held": True}) if r.get("state") == "failed"]
        self._hold_alerts(held, jobs, now)
        self._promote(runs, held, jobs, now)
        self._keep_lease()
        self._advance_all(runs, jobs, settings, now)
        self._keep_lease()
        self.actions.pump(now, keep_lease=self._keep_lease)
        self._keep_lease()
        self._prune(settings, now)
        self._save_estate(now)

    def _settings(self):
        out = dict(DEFAULT_SETTINGS)
        for key, value in (self.store.get_settings() or {}).items():
            if value is not None and not key.startswith("_"):
                out[key] = value
        return out

    def _emit(self, event, now):
        event = dict(event)
        event.setdefault("_time", now)
        self.audit.emit(event)

    def _event(self, run, kind, now, **fields):
        event = {"_time": now, "type": kind, "job_id": run.get("job_id"), "run_id": _run_id(run)}
        event.update(fields)
        return event

    # -- cron -----------------------------------------------------------------

    def _fire_cron(self, jobs, settings, now):
        checked = self._estate.setdefault("cron", {})
        for job_id, job in jobs.items():
            if not scheduler.cron_specs(job):
                if checked.pop(job_id, None) is not None:
                    self._estate_urgent = True
                continue
            last = checked.get(job_id)
            if last is None:
                self._estate_urgent = True
            elif job.get("enabled") is not False:
                slots = scheduler.due_runs(job, last, now)
                for slot in slots:
                    self._create_cron_run(job, slot, settings, now)
                if slots:
                    self._estate_urgent = True
            checked[job_id] = now  # a disabled job does not catch up later
        for job_id in [j for j in checked if j not in jobs]:
            del checked[job_id]
            self._estate_urgent = True

    def _create_cron_run(self, job, slot, settings, now):
        try:
            scheduler.create_run(self.store, job, "cron", slot, {}, now=now,
                                 catchup=scheduler.is_catchup(slot, now), audit=self.audit,
                                 actions=self.actions, queue_cap=settings["queue_cap"])
        except tokens.TokenError as err:
            job_id = job.get("id") or job.get("_key")
            self._emit({"type": "run_rejected", "reason": "invalid_params", "job_id": job_id,
                        "run_id": scheduler.run_key(job_id, "cron", slot),
                        "scheduled_time": int(slot), "error": str(err)}, now)

    def _save_estate(self, now):
        if self._estate_urgent or now - (self._estate_saved or 0) >= STATE_SAVE_EVERY:
            self.store.save_engine_state(self._estate)
            self._estate_saved = now
            self._estate_urgent = False

    # -- commands -------------------------------------------------------------

    def _commands(self, jobs, settings, now):
        for command in self.store.list_commands():
            self._keep_lease()
            try:
                result, detail, run = self._apply_command(command, jobs, settings, now)
            except LeaseLost:
                raise
            except KvError as err:
                if err.transient:
                    raise  # KV Store is down: the whole tick stops
                self._command_failed(command, err, now)
                continue
            except GatewayError as err:
                _check_auth(err)
                self._command_failed(command, err, now)
                continue
            except Exception as err:  # never let one command stall the engine
                log.exception("command %s failed", command.get("_key"))
                self._command_failed(command, err, now)
                continue
            self.store.delete_command(command["_key"])
            event = {"type": "command", "command": command.get("type"),
                     "run_id": command.get("run_id"), "step_id": command.get("step_id"),
                     "user": command.get("user"), "result": result}
            if run is not None:
                event["job_id"] = run.get("job_id")
            if detail:
                event["detail"] = detail
            self._emit(event, now)

    def _command_failed(self, command, err, now):
        """Leave a failed command queued for the next tick, or drop it after
        COMMAND_ATTEMPTS failures. Nothing it changed was saved."""
        attempts = int(command.get("attempts") or 0) + 1
        event = {"command": command.get("type"), "run_id": command.get("run_id"),
                 "step_id": command.get("step_id"), "user": command.get("user"),
                 "attempts": attempts, "error": "%s: %s" % (type(err).__name__, err)}
        if attempts >= COMMAND_ATTEMPTS:
            self.store.delete_command(command["_key"])
            event["type"] = "command_failed"
        else:
            self.store.save_command(dict(command, attempts=attempts))
            event["type"] = "command_retry"
        self._emit(event, now)

    def _apply_command(self, command, jobs, settings, now):
        kind = command.get("type")
        run = self.store.get_run(command.get("run_id")) if command.get("run_id") else None
        if run is None:
            return "rejected", "unknown run", None
        state = run.get("state")
        pending = _Pending()
        if kind == "pause":
            if state not in ("running", "blocked"):
                return "rejected", "cannot pause a %s run" % state, run
            self._set_run(run, {"state": "paused", "paused_at": now, "paused_from": state},
                          pending, now)
        elif kind == "resume":
            if state != "paused":
                return "rejected", "cannot resume a %s run" % state, run
            self._unpause(run, now)
            self._set_run(run, {"state": "running"}, pending, now)
        elif kind == "cancel":
            if state not in ACTIVE_RUN_STATES:
                return "rejected", "cannot cancel a %s run" % state, run
            self._unpause(run, now)
            self._set_run(run, {"state": "cancelled"}, pending, now)
            self._advance(run, jobs.get(run.get("job_id")), settings, now, None, pending)
            return "ok", None, run
        elif kind == "rerun":
            return self._rerun(run, command, jobs, now, pending)
        elif kind == "dismiss":
            if state != "failed" or not run.get("held"):
                return "rejected", "only a failed run holding the queue can be dismissed", run
            run.update(held=False, dismissed_at=now, dismissed_by=command.get("user"))
            pending.events.append(self._event(run, "run_dismissed", now, user=command.get("user")))
        else:
            return "rejected", "unknown command %r" % kind, run
        self._save(run, pending)
        return "ok", None, run

    @staticmethod
    def _unpause(run, now):
        if run.get("paused_at") is not None:
            run["paused_seconds"] = (run.get("paused_seconds") or 0) + max(0, now - int(run["paused_at"]))
            run["paused_at"] = None

    def _rerun(self, run, command, jobs, now, pending):
        step_id = command.get("step_id") or command.get("step")
        definition = None
        job = jobs.get(run.get("job_id"))
        if command.get("definition") == "latest":
            if job is None:
                return "rejected", "the job no longer exists", run
            definition = scheduler.snapshot(job)
        try:
            new = statemod.reset_for_rerun(run, step_id, now, definition)
        except (ValueError, KeyError) as err:
            return "rejected", str(err), run
        new.update(rerun_count=(run.get("rerun_count") or 0) + 1, rerun_at=now,
                   rerun_by=command.get("user"), closed=False, touched_at=None,
                   kept_sids={sid: st["sid"] for sid, st in new["steps"].items()
                              if st.get("sid") and st.get("state") != "waiting"})
        if definition is not None:
            new["owner"] = job.get("owner")
        if new["state"] == "queued":
            new["queued_at"] = now
        old_steps = run.get("steps") or {}
        for sid, st in new["steps"].items():
            before = (old_steps.get(sid) or {}).get("state")
            if before != st.get("state"):
                pending.events.append(self._event(new, "step_state", now, step_id=sid,
                                                  **{"from": before, "to": st.get("state")}))
        pending.events.append(self._event(new, "run_state", now, **{
            "from": run.get("state"), "to": new["state"], "reason": "rerun", "step_id": step_id,
            "definition": command.get("definition") or "original"}))
        self._save(new, pending)
        return "ok", None, new

    # -- queue ----------------------------------------------------------------

    @staticmethod
    def _policy(job, run):
        source = job if job is not None else (run.get("definition") or {})
        return source.get("after_give_up") or "hold"

    def _hold_alerts(self, held, jobs, now):
        for run in held:
            if self._policy(jobs.get(run.get("job_id")), run) != "hold":
                continue
            since = run.get("held_at") or run.get("ended_at") or now
            n = (now - int(since)) // HOLD_ALERT_EVERY
            if n < 1 or (run.get("hold_alerts") or 0) >= n:
                continue
            pending = _Pending()
            occurrence = "hold%d" % n
            if self.actions.submit(run, "on_failure", "job", None, occurrence=occurrence):
                pending.events.append(self._event(run, "action_submitted", now, hook="on_failure",
                                                  scope="job", step_id=None,
                                                  occurrence=occurrence))
            run["hold_alerts"] = n
            pending.events.append(self._event(run, "hold_alert", now, days=n))
            self._save(run, pending)

    def _promote(self, runs, held, jobs, now):
        by_job = {}
        for run in runs:
            by_job.setdefault(run.get("job_id"), []).append(run)
        held_jobs = {r.get("job_id") for r in held
                     if self._policy(jobs.get(r.get("job_id")), r) == "hold"}
        for job_id, job_runs in by_job.items():
            if any(r.get("state") in LIVE for r in job_runs) or job_id in held_jobs:
                continue
            queued = [r for r in job_runs if r.get("state") == "queued"]
            if not queued:
                continue
            run = min(queued, key=lambda r: (0 if r.get("rerun_count") else 1,
                                             int(r.get("scheduled_time") or 0),
                                             int(r.get("created_at") or 0), _run_id(r)))
            on_time = (run.get("trigger") == "cron" and not run.get("catchup")
                       and not run.get("rerun_count"))
            pending = _Pending()
            self._set_run(run, {"state": "running", "promoted_at": now,
                                "started_at": run.get("started_at") or now,
                                "delay_base": int(run["scheduled_time"]) if on_time else now,
                                "giveup_base": now, "paused_seconds": 0, "paused_at": None},
                          pending, now)
            self._save(run, pending)

    # -- runs -----------------------------------------------------------------

    def _advance_all(self, runs, jobs, settings, now):
        live = [r for r in runs if r.get("state") in LIVE]
        live.sort(key=lambda r: (int(r.get("scheduled_time") or 0), int(r.get("created_at") or 0),
                                 _run_id(r)))
        budget = _Budget(live, settings)
        for run in live:
            self._keep_lease()
            try:
                self._advance(run, jobs.get(run.get("job_id")), settings, now, budget, _Pending())
            except (KvError, LeaseLost):
                raise
            except GatewayError as err:
                _check_auth(err)
                log.warning("run %s skipped this tick: %s", _run_id(run), err)
            except Exception:  # a bug in one run must not stall the others
                log.exception("run %s skipped this tick", _run_id(run))
        self._touch_queued(runs, settings, now)

    def _touch_queued(self, runs, settings, now):
        """Keep the results a queued re-run kept from its earlier attempt alive (spec 7).

        At most ``queue_cap`` queued runs per job, the most a job can have."""
        cap = int(settings["queue_cap"])
        per_job = {}
        for run in runs:
            if run.get("state") != "queued":
                continue
            n = per_job.get(run.get("job_id"), 0)
            if n >= cap:
                continue
            per_job[run.get("job_id")] = n + 1
            self._keep_lease()
            if self._touch(run, now):
                self.store.save_run(run)

    def _advance(self, run, job, settings, now, budget, pending):
        definition = run.get("definition") or {}
        defs = {s["id"]: model.resolve_step(definition, s) for s in definition.get("steps") or []}
        before = _inflight(run)
        # A starting step without a saved search ID: adopt the search it may have
        # started before anything else (so a cancel or give-up cancels it), and
        # re-dispatch only after evaluate, if it is still wanted.
        # If history cannot say yet, the step stays starting (in flight) and evaluate
        # still runs, so give-up, cancel and max_runtime always proceed.
        redispatch, unresolved = [], []
        for sid in list(defs):
            st = run["steps"].setdefault(sid, {"state": "waiting"})
            if st.get("state") == "starting" and not st.get("sid") and not st.get("outcome"):
                found = self._resolve_untracked(run, sid, defs[sid], now, pending)
                if found == "none":
                    redispatch.append(sid)
                elif found == "pending":
                    unresolved.append(sid)
        if run.get("state") != "cancelled":
            for sid in list(defs):
                st = run["steps"][sid]
                if st.get("state") in IN_FLIGHT and st.get("sid") and not st.get("outcome"):
                    self._poll(run, sid, defs[sid], now, pending)
        starts, hooks = [], []
        for effect in statemod.evaluate(run, now):
            kind = effect[0]
            if kind == "set_step":
                self._set_step(run, effect[1], effect[2], pending, now)
            elif kind == "cancel_search":
                self._control(effect[2], "cancel", strict=True)
            elif kind == "set_run":
                self._set_run(run, effect[1], pending, now)
            elif kind == "hook":
                hooks.append(effect[1:])
            elif kind == "start_step":
                starts.append(effect[1])
        for sid in unresolved:
            if run["steps"][sid].get("state") != "starting":  # cancelled or given up meanwhile
                self._orphan(run, sid, defs[sid], now, pending, "the run ended before it could "
                             "be confirmed")
        for scope, hook, step_id in hooks:
            if self.actions.submit(run, hook, scope, step_id):
                pending.events.append(self._event(run, "action_submitted", now, hook=hook,
                                                  scope=scope, step_id=step_id,
                                                  occurrence=run.get("rerun_count") or 0))
        ttl_sids = []
        if run.get("state") in TERMINAL_RUN_STATES:
            if not run.get("closed"):
                run["closed"] = True
                ttl_sids = [st["sid"] for st in run["steps"].values() if st.get("sid")]
                if (run["state"] == "failed" and run.get("gave_up")
                        and self._policy(job, run) == "hold"):
                    run.update(held=True, held_at=now, hold_alerts=0)
                    pending.events.append(self._event(run, "run_held", now))
        else:
            self._touch(run, now)
        to_dispatch = []
        if run.get("state") not in TERMINAL_RUN_STATES:
            to_dispatch = [sid for sid in redispatch if run["steps"][sid].get("state") == "starting"
                           and not run["steps"][sid].get("sid")
                           and not run["steps"][sid].get("outcome")]
        if budget is not None:
            budget.adjust(run.get("job_id"), _inflight(run) - before)
            chosen = starts[:budget.room(run.get("job_id"))]
            if chosen:
                for sid in chosen:
                    st = run["steps"][sid]
                    # A dispatch-error retry of the same attempt keeps its first intent_at,
                    # so history still finds a search that a timed-out dispatch started.
                    keep = st.get("intent_at") if st.get("dispatch_errors") else None
                    self._set_step(run, sid, {"state": "starting", "intent_at": keep or now,
                                              "try_at": now, "sid": None, "started_at": None,
                                              "ended_at": None, "outcome": None}, pending, now)
                budget.adjust(run.get("job_id"), len(chosen))
                self._save(run, pending)
                pending = _Pending()
                to_dispatch.extend(chosen)
        for sid in to_dispatch:
            self._dispatch(run, sid, defs[sid], now, pending)
        self._save(run, pending)
        ttl = int(settings["result_retention"])
        for sid in ttl_sids:
            self._control(sid, "setttl", ttl=ttl)

    def _save(self, run, pending):
        self.store.save_run(run)
        for row in pending.rows:
            self.store.save_step_run(row)
        for event in pending.events:
            self.audit.emit(event)
        pending.rows, pending.events = [], []

    def _set_step(self, run, sid, fields, pending, now):
        st = run["steps"].setdefault(sid, {})
        old = st.get("state")
        st.update(fields)
        if "state" in fields and fields["state"] != old:
            event = self._event(run, "step_state", now, step_id=sid, attempt=st.get("attempt"),
                                **{"from": old, "to": fields["state"]})
            for key in ("sid", "error", "skip_kind"):
                if st.get(key) is not None:
                    event[key] = st[key]
            pending.events.append(event)

    def _set_run(self, run, fields, pending, now):
        old = run.get("state")
        run.update(fields)
        if "state" in fields and fields["state"] != old:
            event = self._event(run, "run_state", now, **{"from": old, "to": fields["state"]})
            if run.get("gave_up"):
                event["gave_up"] = True
            pending.events.append(event)

    def _control(self, sid, action, strict=False, **kw):
        try:
            self.gw.control(sid, action, **kw)
        except GatewayError as err:
            _check_auth(err)
            if strict and err.transient:
                raise  # cancel must succeed before the run records it
            log.warning("%s of search %s failed: %s", action, sid, err)

    def _touch(self, run, now):
        if now - int(run.get("touched_at") or 0) < TOUCH_EVERY:
            return False
        sids = [st["sid"] for st in run["steps"].values()
                if st.get("sid") and st.get("state") not in IN_FLIGHT]
        if not sids:
            return False
        for sid in sids:
            self._control(sid, "touch")
        run["touched_at"] = now
        return True

    # -- attempts -------------------------------------------------------------

    def _row(self, run, sid):
        st = run["steps"][sid]
        attempt = st.get("attempt") or 1
        rerun = run.get("rerun_count") or 0
        return {"_key": "%s:%s:%d:%d" % (_run_id(run), sid, rerun, attempt),
                "run_id": _run_id(run), "job_id": run.get("job_id"), "step_id": sid,
                "attempt": attempt, "rerun": rerun, "sid": st.get("sid"),
                "intent_at": st.get("intent_at"), "started_at": st.get("started_at"),
                "ended_at": st.get("ended_at"), "outcome": st.get("outcome"),
                "error": st.get("error"), "result_count": st.get("result_count"),
                "dispatch_errors": st.get("dispatch_errors") or 0}

    def _poll(self, run, sid, sdef, now, pending):
        st = run["steps"][sid]
        try:
            status = self.gw.job_status(st["sid"])
        except GatewayError as err:
            _check_auth(err)
            log.warning("status of search %s failed: %s", st["sid"], err)
            return
        state = status.get("state")
        if state == "running":
            return
        if state == "done" and not status.get("finalized"):
            count = int(status.get("result_count") or 0)
            first = None
            wanted = first_fields(run.get("definition") or {}).get(sid)
            if wanted and count > 0:
                try:
                    row = self.gw.first_row(st["sid"])
                except GatewayError as err:
                    _check_auth(err)
                    log.warning("results of search %s failed: %s", st["sid"], err)
                    return
                if row:
                    first = {f: _scalar(row.get(f)) for f in sorted(wanted)}
            st.update(outcome="succeeded", result_count=count, first=first, ended_at=now,
                      error=None)
        else:
            if state == "done":
                error = ("search %s was finalized (stopped early) outside the orchestrator, so "
                         "its results may be incomplete" % st["sid"])
            elif state == "failed":
                error = "search %s failed: %s" % (st["sid"], status.get("error") or "unknown error")
            else:
                error = ("search %s no longer exists: it expired, was deleted or was reaped "
                         "outside the orchestrator" % st["sid"])
            st.update(outcome="failed", error=error, ended_at=now, first=None)
        pending.rows.append(self._row(run, sid))
        pending.events.append(self._event(run, "step_attempt", now, step_id=sid,
                                          attempt=st.get("attempt"), sid=st["sid"],
                                          outcome=st["outcome"], error=st.get("error"),
                                          result_count=st.get("result_count")))

    def _adopt(self, run, sid, sdef, now, pending):
        """Adopt a job dispatched for this attempt whose search ID was never saved.

        Returns (kind, reason): "adopted", "none" (history has no such job),
        "unknown" (transient history error) or "error" (non-transient)."""
        st = run["steps"][sid]
        name = sdef.get("hidden_search")
        if not name:
            return "none", None
        try:
            found = self.gw.history(run.get("owner"), name, st.get("intent_at") or now)
        except GatewayError as err:
            _check_auth(err)
            log.warning("history of %s failed: %s", name, err)
            return ("unknown" if err.transient else "error"), str(err)
        if not found:
            return "none", None
        self._set_step(run, sid, {"state": "running", "sid": found[0],
                                  "started_at": st.get("intent_at") or now}, pending, now)
        pending.rows.append(self._row(run, sid))
        pending.events.append(self._event(run, "step_adopted", now, step_id=sid, sid=found[0],
                                          attempt=st.get("attempt")))
        return "adopted", None

    @staticmethod
    def _unknown_expired(st, now):
        """The fate of this dispatch has been unknown for UNKNOWN_LIMIT seconds."""
        since = st.get("try_at") or st.get("intent_at") or now
        return now - int(since) >= UNKNOWN_LIMIT

    def _resolve_untracked(self, run, sid, sdef, now, pending):
        """For a starting step that may have started a search we never recorded.

        "adopted" or "none" (safe to dispatch); "pending" (history is briefly
        unavailable: the step stays starting); "failed" (the attempt failed)."""
        kind, reason = self._adopt(run, sid, sdef, now, pending)
        if kind in ("adopted", "none"):
            return kind
        st = run["steps"][sid]
        if kind == "error":
            error = "Could not check whether the search for step %s started: %s" % (sid, reason)
        elif self._unknown_expired(st, now):
            error = "Could not confirm whether the search for step %s started" % sid
        else:
            return "pending"
        self._attempt_failed(run, sid, error, now, pending)
        self._orphan(run, sid, sdef, now, pending, error)
        return "failed"

    def _orphan(self, run, sid, sdef, now, pending, reason):
        st = run["steps"][sid]
        pending.events.append(self._event(run, "possible_orphan_search", now, step_id=sid,
                                          hidden_search=sdef.get("hidden_search"),
                                          owner=run.get("owner"), intent_at=st.get("intent_at"),
                                          reason=reason))

    def _render_args(self, run, sdef):
        definition = run.get("definition") or {}
        ids = [s["id"] for s in definition.get("steps") or []]
        spl = sdef.get("spl") or ""
        _, arg_names = tokens.compile_spl(spl, ids)
        steps = {}
        for i in ids:
            st = (run.get("steps") or {}).get(i) or {}
            steps[i] = {"status": st.get("state"), "sid": st.get("sid"),
                        "resultCount": st.get("result_count"), "first": st.get("first")}
        ctx = {"run": {"id": _run_id(run), "scheduled_time": str(int(run["scheduled_time"])),
                       "params": run.get("params") or {}},
               "steps": steps}
        return tokens.render_args(arg_names, ctx, tokens.token_defaults(spl, ids))

    def _attempt_failed(self, run, sid, error, now, pending):
        st = run["steps"][sid]
        st.update(outcome="failed", error=error, ended_at=now)
        pending.rows.append(self._row(run, sid))
        pending.events.append(self._event(run, "step_attempt", now, step_id=sid,
                                          attempt=st.get("attempt"), outcome="failed",
                                          error=error))

    def _dispatch(self, run, sid, sdef, now, pending):
        st = run["steps"][sid]
        name = sdef.get("hidden_search")
        if not name:
            return self._attempt_failed(run, sid, "step %r has no hidden saved search in its "
                                        "definition; re-save the job to create it" % sid,
                                        now, pending)
        if st.get("dispatch_errors"):
            # An earlier dispatch of this attempt failed transiently but may have started a
            # search: never launch a second one.
            if self._resolve_untracked(run, sid, sdef, now, pending) != "none":
                return None
        kind, up, reason = self._expired_upstream(run, sid)
        if kind == "expired":
            return self._attempt_failed(run, sid, "Results of step %s have expired; re-run from %s"
                                        % (up, up), now, pending)
        if kind == "error":
            return self._attempt_failed(run, sid, "Could not check the results of step %s: %s"
                                        % (up, reason), now, pending)
        if kind == "unknown":
            if self._unknown_expired(st, now):
                return self._attempt_failed(run, sid, "Could not confirm whether the results of "
                                            "step %s are still available" % up, now, pending)
            return None  # stays starting; checked again next tick
        try:
            args = self._render_args(run, sdef)
        except tokens.TokenError as err:
            return self._attempt_failed(run, sid, "token %s: %s" % (err.token, err.reason),
                                        now, pending)
        try:
            search_id = self.gw.dispatch(run.get("owner"), name, int(run["scheduled_time"]), args,
                                         sdef.get("earliest"), sdef.get("latest"))
        except DispatchError as err:
            _check_auth(err)
            if not err.transient:
                return self._attempt_failed(run, sid, self._dispatch_failure(run, name, err),
                                            now, pending)
            found = self._resolve_untracked(run, sid, sdef, now, pending)
            if found in ("adopted", "failed"):
                return None
            if found == "pending":
                # The search may have started: stay starting with no outcome, so the next
                # tick asks history again from the same intent_at (bounded by UNKNOWN_LIMIT).
                st["error"] = "dispatch outcome unknown: %s" % err
                return None
            st["dispatch_errors"] = (st.get("dispatch_errors") or 0) + 1
            st.update(outcome="dispatch_error", error=str(err))
            pending.rows.append(self._row(run, sid))
            pending.events.append(self._event(run, "step_dispatch_error", now, step_id=sid,
                                              attempt=st.get("attempt"), error=str(err),
                                              dispatch_errors=st["dispatch_errors"]))
            return None
        self._set_step(run, sid, {"state": "running", "sid": search_id, "started_at": now,
                                  "error": None}, pending, now)
        pending.rows.append(self._row(run, sid))
        pending.events.append(self._event(run, "step_dispatched", now, step_id=sid, sid=search_id,
                                          attempt=st.get("attempt"), hidden_search=name,
                                          owner=run.get("owner"),
                                          dispatch_now=int(run["scheduled_time"])))
        return None

    def _expired_upstream(self, run, sid):
        """For a re-run: (kind, upstream step, reason) with kind "expired", "unknown"
        (transient status error), "error" (non-transient) or None (all available)."""
        kept = run.get("kept_sids") or {}
        if not kept:
            return None, None, None
        definition = run.get("definition") or {}
        ids = [s["id"] for s in definition.get("steps") or []]
        sdef = next((s for s in definition.get("steps") or [] if s["id"] == sid), {})
        used = {e.get("from") for e in definition.get("edges") or [] if e.get("to") == sid}
        used |= {t.split(".")[0] for t in tokens.find_tokens(sdef.get("spl") or "", ids)}
        for up in ids:
            st = (run.get("steps") or {}).get(up) or {}
            if up not in used or not st.get("sid") or kept.get(up) != st.get("sid"):
                continue
            try:
                status = self.gw.job_status(st["sid"])
            except GatewayError as err:
                _check_auth(err)
                log.warning("status of kept search %s failed: %s", st["sid"], err)
                return ("unknown" if err.transient else "error"), up, str(err)
            if status.get("state") == "missing":
                return "expired", up, None
        return None, None, None

    def _dispatch_failure(self, run, name, err):
        owner = run.get("owner")
        try:
            exists = self.gw.user_exists(owner)
        except GatewayError as lookup:
            _check_auth(lookup)
            exists = None
        if exists is False:
            return ("the job owner %r no longer exists, so the step cannot run as them; an "
                    "admin can take ownership of the job (%s)" % (owner, err))
        if err.status == 404:
            return ("hidden saved search %r was not found for owner %r: it was deleted outside "
                    "the app; re-save the job to recreate it (%s)" % (name, owner, err))
        return "dispatch of %r was rejected: %s" % (name, err)

    # -- retention --------------------------------------------------------------

    def _prune(self, settings, now):
        last = self._estate.get("last_prune")
        if last is not None and now - int(last) < PRUNE_EVERY:
            return
        days = int(settings["run_retention_days"])
        deleted = [0]

        def between():
            deleted[0] += 1
            self._keep_lease()

        try:
            count = self.store.prune_runs(now - days * DAY, limit=PRUNE_BATCH, between=between)
        except LeaseLost:
            if deleted[0]:
                self._emit({"type": "runs_pruned", "count": deleted[0], "retention_days": days,
                            "partial": True}, now)
            raise
        if count < PRUNE_BATCH:  # a full batch means more may be left: continue next tick
            self._estate["last_prune"] = now
            self._estate_urgent = True
        if count:
            self._emit({"type": "runs_pruned", "count": count, "retention_days": days}, now)
