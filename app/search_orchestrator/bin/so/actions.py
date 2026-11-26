"""Action runner (spec section 10).

The engine calls ``submit`` for every hook effect from ``state.evaluate`` (and
for the hold and queue-cap alerts) *before* it saves the run that records the
hook in ``hooks_fired``. For a hook with actions to send, ``submit`` persists
one ``so_action_runs`` row under the idempotency key ``run_id:scope:hook:step_id:occurrence``, so replaying a
tick after a crash never submits the same hook twice. ``pump(now)`` executes
due rows. Nothing here ever changes a run's state.

Row shape (``kind="action"``): ``ctx`` (names, status, failed searches: no
results data), ``state`` (``pending`` until every action is finished, then
``done`` or ``failed``), ``attempts`` (the most any action needed), ``error``
(last error) and ``actions``: one entry per matching job or step action, each
with its own ``state`` (``pending``, ``running``, ``done``, ``failed``),
``attempts``, ``error``, ``next_at`` and, for search actions, ``sid``.

Action definitions (``job["actions"]`` and ``step["actions"]``, read from the
run's definition snapshot): ``{"hook", "type", ...}`` with
* ``email``: ``to``, optional ``subject`` and ``message``
* ``event``: ``index``, optional ``payload`` (template)
* ``start_job``: ``job`` (target job ID) and optional ``params``
* ``alert_action``: ``action`` (name) and ``params``

Templates (email subject and message, event payload, alert action parameters) take
``{{job}}``, ``{{run_id}}``, ``{{message}}`` and the other ctx names, and the SPL tokens
``$run.*$`` and ``$<step>.*$`` (with ``|default``; a token with no value and no default is
left empty). Token values come from ``tokens``, the run's token context snapshotted into the
row at submit. Search action args are SPL-string escaped.

Webhook actions (and their Slack, Teams, PagerDuty and ServiceNow formats) were removed in
1.50.0: one still in a run's definition is skipped, with an ``action_skipped`` audit event,
and does not count as the job's action for a hook, so the fallback steps in.

Any step action may have ``only_if_results: true``: it is left out of the hook's firing
when the step's ``result_count`` is 0 (the Simple view's "only if it found results"), and
an optional ``condition`` (a simple comparison over tokens, as on an If… line, such as
``$count.resultCount$ > 100``): the action is left out when it doesn't hold.
Email, event and alert_action dispatch a hidden search as the run's owner,
named by the action's ``hidden_search`` in the run's definition snapshot
(content-addressed, written at job save; see ``hidden.py`` for the args contract).

Retries: a failing action is retried 3 times (4 attempts) after ``state.backoff``
seconds (30 s, doubling, at most 15 minutes). An action may set its own ``retries``
(0 to 10) and ``retry_wait`` (the first wait, 10 to 3600 seconds; it doubles each time, at
most an hour). A non-transient error (4xx, no permission) fails at once.

Fallback (spec section 10, decided here, on the job-scope event only): the run
failing (``on_failure``), being delayed (``on_delayed``) or missing its deadline
(``on_late``) is sent to
``settings.fallback`` (``{"type": "email", "to": address}`` or
``{"type": "alert_action", "action": name, "params": {...}}``) unless the job has a job-level action for
the hook, or (failure) an unhandled failed step has a step-level on_failure
action, or (delay) a delayed step has a step-level on_delayed action. Handled
step failures never use the fallback. A matching action that runs out of
retries sends it too. The key is ``run_id:fallback:hook:occurrence``, so one
event sends at most one fallback.

Rows snapshot everything they need (action definitions, owner, scheduled time,
ctx, chain depth, ``chain_rerun``, ``deadline_eligible``) at submit, so ``pump``
never re-reads the run (a queue-cap rejected run is never saved). ``pump(now, keep_lease)`` calls ``keep_lease()``
between rows and ``keep_lease(force=True)`` right before each send, and starts
no new action after ``PUMP_BUDGET`` seconds.
Fallback rows have ``kind="fallback"`` and ``scope="fallback"``. Content is only job,
run and step names, status and links. Email goes through the
system-owned hidden search ``_so_fallback_email`` under ``nobody``; an alert action through
``_so_fallback_alert``, which saving the setting writes under ``nobody`` (``hidden``).
Links are relative unless settings has ``base_url``.

Delivery is at least once: a crash between dispatching a search and saving its
sid can repeat that one action.
"""
import json
import logging
import time
from urllib.parse import quote

from . import authz, expr as exprmod, follows, hidden, presets, scheduler, tokens
from . import deadline as deadlinemod
from .gateway import DispatchError, GatewayError
from .state import backoff

log = logging.getLogger(__name__)

ACTION_RUNS = "so_action_runs"
SETTINGS = "so_settings"
MAX_RETRIES = 3
RETRIES_MAX = 10
RETRY_WAIT_MIN, RETRY_WAIT_MAX = 10, 3600
RETRY_WAIT_CAP = 3600


def retry_plan(action):
    """``(retries, first_wait or None)`` for an action: its own settings, else the defaults
    (None: ``state.backoff``). Out-of-range values (checked at save) fall back too."""
    action = action or {}
    retries, wait = action.get("retries"), action.get("retry_wait")
    ok = lambda v, lo, hi: isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi
    return (retries if ok(retries, 0, RETRIES_MAX) else MAX_RETRIES,
            wait if ok(wait, RETRY_WAIT_MIN, RETRY_WAIT_MAX) else None)


def retry_delay(attempts, first_wait):
    """Seconds to wait after the ``attempts``-th failure."""
    if first_wait is None:
        return backoff(attempts)
    return min(first_wait * 2 ** (max(attempts, 1) - 1), RETRY_WAIT_CAP)
PUMP_BUDGET = 5.0
CHAIN_LIMIT = 10
RUNNING_LIMIT = 600  # seconds a hidden action search may run
BATCH = 100
FALLBACK_HOOKS = ("on_delayed", "on_failure", "on_late")
SEARCH_TYPES = ("email", "event", "alert_action")


class _Fail(Exception):
    def __init__(self, message, transient=False):
        Exception.__init__(self, message)
        self.transient = transient


def idempotency_key(run_id, scope, hook, step_id, occurrence):
    return "%s:%s:%s:%s:%s" % (run_id, scope, hook, step_id or "-", occurrence)


def fallback_key(run_id, hook, occurrence):
    return "%s:fallback:%s:%s" % (run_id, hook, occurrence)


def indexed_actions(definition):
    """``[(index, scope, step_id, action)]``: job actions first, then each step's."""
    out = []
    for action in definition.get("actions") or []:
        out.append((len(out), "job", None, action))
    for step in definition.get("steps") or []:
        for action in step.get("actions") or []:
            out.append((len(out), "step", step.get("id"), action))
    return out


def chain_rerun(run):
    """The re-run count that start_job and completion keys carry when the run is a re-run
    with "start downstream jobs again" ticked (``restart_downstream_jobs``), else None."""
    if run.get("restart_downstream_jobs") and run.get("rerun_count"):
        return int(run["rerun_count"])
    return None


def _entry(index, action):
    return {"index": index, "type": action.get("type"), "action": dict(action),
            "state": "pending", "attempts": 0,
            "error": None, "next_at": 0, "sid": None, "started_at": None}


# Action types that were removed (1.50.0): skipped when an old definition still has one.
REMOVED_TYPES = ("webhook",)


def _live(actions):
    """The actions that still run: without the removed types."""
    return [a for a in actions or [] if a.get("type") not in REMOVED_TYPES]


def _needs_failure_fallback(run, definition):
    if any(a.get("hook") == "on_failure" for a in _live(definition.get("actions"))):
        return False
    handled = {e.get("from") for e in definition.get("edges") or []
               if e.get("condition") in ("on_failure", "always")}
    for step in definition.get("steps") or []:
        st = (run.get("steps") or {}).get(step.get("id")) or {}
        if st.get("state") == "failed" and step.get("id") not in handled \
                and any(a.get("hook") == "on_failure" for a in _live(step.get("actions"))):
            return False
    return True


def _needs_delay_fallback(run, definition):
    if any(a.get("hook") == "on_delayed" for a in _live(definition.get("actions"))):
        return False
    for step in definition.get("steps") or []:
        st = (run.get("steps") or {}).get(step.get("id")) or {}
        if st.get("delay_alerted") \
                and any(a.get("hook") == "on_delayed" for a in _live(step.get("actions"))):
            return False
    return True


def _needs_late_fallback(run, definition):
    return not any(a.get("hook") == "on_late" for a in _live(definition.get("actions")))


def _run_lookup(run, now):
    """A token lookup over ``run`` for ``expr.evaluate``, as the evaluator's (state.py)."""
    steps = run.get("steps") or {}

    def lookup(name):
        parts = name.split(".")
        if parts[0] == "run":
            if name == "run.id":
                return run.get("id") or run.get("_key")
            if name == "run.scheduled_time":
                return run.get("scheduled_time")
            if name == "run.now":
                return now
            if len(parts) == 3 and parts[1] == "param":
                return (run.get("params") or {}).get(parts[2])
            return None
        st = steps.get(parts[0])
        if st is None or len(parts) < 2:
            return None
        if parts[1] == "status":
            return st.get("state")
        if parts[1] == "sid":
            return st.get("sid")
        if st.get("state") != "succeeded":
            return None
        if parts[1] == "resultCount" and len(parts) == 2:
            return st.get("result_count")
        if parts[1] == "first" and len(parts) == 3:
            row = st.get("first")
            return row.get(parts[2]) if isinstance(row, dict) else None
        return None
    return lookup


def _condition_holds(action, run, now):
    """An action's optional ``condition`` (a simple comparison, as on an If… line): True
    when it has none or it holds; an expression that can't be read counts as false."""
    text = action.get("condition")
    if not isinstance(text, str) or not text.strip():
        return True
    try:
        return bool(exprmod.evaluate(exprmod.parse(text), _run_lookup(run, now)))
    except exprmod.ExprError:
        return False


class ActionRunner:
    def __init__(self, gateway, store=None, audit=None, clock=time.time,
                 monotonic=time.monotonic):
        self.monotonic = monotonic
        self.gw = gateway
        self.store = store
        self.audit = audit
        self.clock = clock

    # -- submit ---------------------------------------------------------------

    def submit(self, run, hook, scope, step_id, occurrence=None):
        """Record one hook firing. True if new and it has actions to send (callers audit
        ``action_submitted`` on True); False if already submitted or nothing matched.

        ``occurrence`` defaults to the run's ``rerun_count``: a hook fires once
        per run and once more per re-run.
        """
        if occurrence is None:
            occurrence = run.get("rerun_count") or 0
        run_id = run.get("_key") or run.get("id")
        key = idempotency_key(run_id, scope, hook, step_id, occurrence)
        definition = run.get("definition") or {}
        found = (((run.get("steps") or {}).get(step_id) or {}).get("result_count") or 0) \
            if scope == "step" else None
        matching = [(i, a) for i, s, sid, a in indexed_actions(definition)
                    if s == scope and sid == step_id and a.get("hook") == hook
                    and not (a.get("only_if_results") is True and scope == "step" and not found)
                    and _condition_holds(a, run, int(self.clock()))]
        for i, a in [m for m in matching if m[1].get("type") in REMOVED_TYPES]:
            self._emit({"type": "action_skipped", "run_id": run_id, "job_id": run.get("job_id"),
                        "hook": hook, "step_id": step_id, "action_index": i,
                        "action_type": a.get("type"), "preset": a.get("preset"),
                        "reason": "webhook actions were removed in 1.50.0; use an Alert action"},
                       int(self.clock()))
        matching = [(i, a) for i, a in matching if a.get("type") not in REMOVED_TYPES]
        ctx = self._ctx(run, hook, scope, step_id)
        doc = {"_key": key, "kind": "action", "run_id": run_id, "job_id": run.get("job_id"),
               "owner": run.get("owner"), "scheduled_time": run.get("scheduled_time"),
               "scope": scope, "hook": hook, "step_id": step_id, "occurrence": occurrence,
               "ctx": ctx, "tokens": tokens.run_context(run, int(self.clock())) if matching else None,
               "chain_depth": int(run.get("chain_depth") or 0),
               "chain_rerun": chain_rerun(run),
               "deadline_eligible": deadlinemod.run_eligible(run),
               "actions": [_entry(i, a) for i, a in matching],
               "state": "pending", "attempts": 0, "error": None,
               "fallback": False, "created_at": int(self.clock())}
        new = bool(matching) and self.gw.kv_insert(ACTION_RUNS, doc)  # nothing to send, no row
        needs = {"on_failure": _needs_failure_fallback,
                 "on_delayed": _needs_delay_fallback,
                 "on_late": _needs_late_fallback}.get(hook)
        if scope == "job" and needs and needs(run, definition):
            self._ensure_fallback(doc)  # also on replay: the insert is idempotent
        if scope == "job" and hook in follows.HOOK_EVENT:
            self._ensure_follows(doc)  # idempotent too: one row per follow and occurrence
        return new

    @staticmethod
    def _ctx(run, hook, scope, step_id):
        definition = run.get("definition") or {}
        names = {s.get("id"): s.get("name") or s.get("id") for s in definition.get("steps") or []}
        steps = run.get("steps") or {}
        failed = [{"step": names.get(sid, sid), "sid": st.get("sid")}
                  for sid, st in steps.items() if st.get("state") == "failed" and st.get("sid")]
        status = run.get("state")
        if scope == "step" and step_id in steps:
            status = steps[step_id].get("state")
        job_id = run.get("job_id")
        ctx = {"job": definition.get("name") or job_id, "job_id": job_id,
               "run_id": run.get("_key") or run.get("id"), "hook": hook, "scope": scope,
               "step_id": step_id, "step": names.get(step_id, step_id) if step_id else None,
               "status": status, "failed": failed}
        if hook == "on_approval_requested":
            ctx["approval_message"] = ((steps.get(step_id) or {}).get("approval_state")
                                       or {}).get("message") or ""
        return ctx

    def _ensure_fallback(self, row):
        key = fallback_key(row["run_id"], row["hook"], row["occurrence"])
        doc = {"_key": key, "kind": "fallback", "run_id": row["run_id"], "job_id": row["job_id"],
               "owner": row.get("owner"), "scheduled_time": row.get("scheduled_time"),
               "scope": "fallback", "hook": row["hook"], "step_id": row["step_id"],
               "occurrence": row["occurrence"], "ctx": row["ctx"],
               "actions": [_entry(None, {"type": "fallback"})], "state": "pending",
               "attempts": 0, "error": None, "fallback": True, "created_at": int(self.clock())}
        return self.gw.kv_insert(ACTION_RUNS, doc)

    def _ensure_follows(self, row):
        """One ``kind="follow"`` row per person following the job about this hook. It never
        triggers the fallback (``fallback`` is True)."""
        try:
            found = follows.for_hook(self.gw, row["job_id"], row["hook"])
        except GatewayError as err:
            log.warning("follows of job %s could not be read: %s", row["job_id"], err)
            return
        for f in found:
            fkey = f.get("_key") or follows.follow_key(f.get("job_id"), f.get("user"))
            doc = {"_key": "%s:follow:%s:%s:%s" % (row["run_id"], fkey[:16], row["hook"],
                                                    row["occurrence"]),
                   "kind": "follow", "run_id": row["run_id"], "job_id": row["job_id"],
                   "owner": row.get("owner"), "scheduled_time": row.get("scheduled_time"),
                   "scope": "follow", "hook": row["hook"], "step_id": None,
                   "occurrence": row["occurrence"], "ctx": row["ctx"],
                   "actions": [_entry(None, {"type": "follow", "user": f.get("user"),
                                             "notify": f.get("notify") or {"type": "email"}})],
                   "state": "pending", "attempts": 0, "error": None, "fallback": True,
                   "created_at": int(self.clock())}
            self.gw.kv_insert(ACTION_RUNS, doc)

    # -- pump -----------------------------------------------------------------

    def pump(self, now, keep_lease=None):
        """Run due actions and poll running ones. Returns the number of rows touched.

        ``keep_lease()`` is called between rows (it raises if the lease is lost; rows
        are already saved). After ``PUMP_BUDGET`` seconds no new action starts.
        """
        rows = self.gw.kv_query(ACTION_RUNS, {"state": "pending"}, sort="created_at:1",
                                limit=BATCH)
        started = self.monotonic()
        touched = 0
        settings = None
        for row in rows:
            if keep_lease is not None:
                keep_lease()
            changed = False
            for entry in row["actions"]:
                if self.monotonic() - started > PUMP_BUDGET:
                    break
                if entry["state"] == "pending" and entry["next_at"] > now:
                    continue
                if entry["state"] not in ("pending", "running"):
                    continue
                if settings is None:
                    settings = self.gw.kv_get(SETTINGS, "settings") or {}
                if keep_lease is not None and entry["state"] == "pending":
                    keep_lease(force=True)  # never send without the lease
                self._advance(row, entry, settings, now)
                changed = True
                self._save_row(row)
            if changed:
                touched += 1
            if self.monotonic() - started > PUMP_BUDGET:
                break
        return touched

    def _save_row(self, row):
        self._roll_up(row)
        if row["state"] == "failed" and row["hook"] in FALLBACK_HOOKS and not row["fallback"]:
            self._ensure_fallback(row)  # idempotent, so a crash before the save is safe
            row["fallback"] = True
        self.gw.kv_update(ACTION_RUNS, row["_key"], row)

    @staticmethod
    def _roll_up(row):
        entries = row["actions"]
        row["attempts"] = max([e["attempts"] for e in entries] or [0])
        errors = [e["error"] for e in entries if e["error"]]
        row["error"] = errors[-1] if errors else None
        if any(e["state"] in ("pending", "running") for e in entries):
            row["state"] = "pending"
        else:
            row["state"] = "failed" if any(e["state"] == "failed" for e in entries) else "done"

    def _emit(self, event, now):
        if self.audit is not None:
            self.audit.emit(dict(event, _time=int(now)))

    def _advance(self, row, entry, settings, now):
        """Start (or poll) one action entry and record the outcome on it."""
        try:
            if entry["state"] == "running":
                self._poll(row, entry, now)
            else:
                entry["attempts"] += 1
                entry["next_at"] = 0
                self._execute(row, entry, settings, now)
        except _Fail as err:
            self._failed(row, entry, str(err), err.transient, now)
        except DispatchError as err:
            self._failed(row, entry, "dispatch failed: %s" % err, err.transient, now)
        except GatewayError as err:
            self._failed(row, entry, str(err), err.transient, now)
        except tokens.TokenError as err:
            self._failed(row, entry, "invalid parameters: %s" % err, False, now)
        except Exception as err:  # one bad action must not stop the others
            log.exception("action %s failed", row["_key"])
            self._failed(row, entry, "%s: %s" % (type(err).__name__, err), False, now)

    def _done(self, row, entry, now, **extra):
        entry.update(state="done", error=None)
        self._emit(dict({"type": "action_done", "run_id": row["run_id"], "job_id": row["job_id"],
                         "hook": row["hook"], "scope": row["scope"], "step_id": row["step_id"],
                         "action_type": entry["type"], "action_index": entry["index"],
                         "attempts": entry["attempts"],
                         "is_fallback": row["kind"] == "fallback"}, **extra), now)

    def _failed(self, row, entry, error, transient, now, **extra):
        retries, first_wait = retry_plan(entry.get("action"))
        final = not transient or entry["attempts"] > retries
        entry["error"] = error[:500]
        entry["sid"] = None
        if final:
            entry["state"] = "failed"
        else:
            entry.update(state="pending", next_at=int(now) + retry_delay(entry["attempts"], first_wait))
        self._emit(dict({"type": "action_failed" if final else "action_retry",
                         "run_id": row["run_id"], "job_id": row["job_id"], "hook": row["hook"],
                         "scope": row["scope"], "step_id": row["step_id"],
                         "action_type": entry["type"], "action_index": entry["index"],
                         "attempts": entry["attempts"], "error": entry["error"],
                         "preset": (entry.get("action") or {}).get("preset"),
                         "is_fallback": row["kind"] == "fallback"}, **extra), now)

    # -- executors ------------------------------------------------------------

    def _execute(self, row, entry, settings, now):
        ctx = self._links(row["ctx"], settings)
        if row["kind"] == "fallback":
            return self._fallback(row, entry, ctx, settings, now)
        if row["kind"] == "follow":
            return self._follow(row, entry, ctx, now)
        action = entry.get("action") or {}
        kind = entry["type"]
        if row.get("tokens"):
            ctx["tokens"] = row["tokens"]  # $run.*$ and $<step>.*$ in templates
        if kind in SEARCH_TYPES:
            return self._search(row, entry, action, ctx, now)
        if kind == "start_job":
            return self._start_job(row, entry, action, now)
        raise _Fail("unknown action type %r" % (kind,))

    @staticmethod
    def _links(ctx, settings):
        base = (settings.get("base_url") or "").rstrip("/")
        out = dict(ctx)
        out["run_url"] = "%s/app/search_orchestrator/run?run_id=%s" % (base, quote(ctx["run_id"]))
        out["failed"] = [{"step": f["step"],
                          "url": "%s/app/search/search?sid=%s" % (base, quote(f["sid"]))}
                         for f in ctx.get("failed") or []]
        return out

    def _fallback(self, row, entry, ctx, settings, now):
        fb = settings.get("fallback") or {}
        if fb.get("type") == "alert_action" and fb.get("action"):
            full = dict(ctx, message=presets.default_message(ctx))
            args = {"action": fb["action"]}
            for k, v in (fb.get("params") or {}).items():
                args["param." + str(k)] = presets.fill(str(v), full)
            return self._dispatch(row, entry, hidden.FALLBACK_OWNER, hidden.FALLBACK_ALERT_SEARCH,
                                  args, now)
        if fb.get("type") == "email" and fb.get("to"):
            args = {"to": fb["to"], "subject": "Search Orchestrator: %s %s" % (
                ctx["job"], presets._VERB.get(ctx["hook"], ctx["hook"])),
                "message": presets.default_message(ctx)}
            return self._dispatch(row, entry, hidden.FALLBACK_OWNER, hidden.FALLBACK_EMAIL_SEARCH,
                                  args, now)
        raise _Fail("no fallback notification destination is configured")

    def _follow(self, row, entry, ctx, now):
        """Tell a follower: checked as them at send time (they may no longer see the job, or
        have an email address); email goes to their account's address."""
        action = entry.get("action") or {}
        user = action.get("user")
        job = self.store.get_job(row["job_id"])
        access = self.gw.user_access(user) if user else {"roles": [], "capabilities": []}
        if job is None or not authz.can_view(user, job, access["roles"], access["capabilities"]):
            raise _Fail("follower %r may no longer see the job" % (user,))
        # A follow by webhook (before 1.50.0) is told by email now.
        to = access.get("email")
        if not to:
            raise _Fail("follower %r has no email address in Splunk" % (user,))
        args = {"to": to, "subject": "Search Orchestrator: %s %s (you follow this job)" % (
            ctx["job"], presets._VERB.get(ctx["hook"], ctx["hook"])),
            "message": presets.default_message(ctx) + "\n\nYou get this because you follow "
                       "the job. To stop, open the Jobs page and choose Unfollow."}
        return self._dispatch(row, entry, hidden.FALLBACK_OWNER, hidden.FALLBACK_EMAIL_SEARCH,
                              args, now)

    def _search(self, row, entry, action, ctx, now):
        kind = entry["type"]
        full = dict(ctx, message=presets.default_message(ctx))
        args = {"job": ctx["job"], "run_id": ctx["run_id"], "hook": ctx["hook"],
                "step": ctx["step_id"] or "", "run_url": ctx["run_url"]}
        if kind == "email":
            args.update(to=action.get("to") or "",
                        subject=presets.fill(action.get("subject") or "{{job}}: {{hook}}", full),
                        message=presets.fill(action.get("message") or "{{message}}", full))
        elif kind == "event":
            payload = action.get("payload")
            if payload:
                payload = presets.fill(payload, full)
                if not isinstance(payload, str):
                    payload = json.dumps(payload)
            else:
                payload = json.dumps({"job": ctx["job"], "run_id": ctx["run_id"],
                                      "hook": ctx["hook"], "step": ctx["step_id"],
                                      "status": ctx["status"]})
            when = row.get("scheduled_time") if action.get("time") == "scheduled" else None
            args.update(index=action.get("index") or "", payload=payload,
                        time=str(int(when)) if when else str(int(now)),
                        **{k: str(action.get(k)) for k in ("source", "sourcetype", "host")
                           if action.get(k)})
        else:
            args["action"] = action.get("action") or ""
            for k, v in (action.get("params") or {}).items():
                args["param." + str(k)] = presets.fill(str(v), full)
        name = action.get("hidden_search")
        if not name:
            raise _Fail("action %s has no hidden saved search in its definition; re-save the "
                        "job to create it" % entry["index"])
        self._dispatch(row, entry, row["owner"], name, args, now)

    def _dispatch(self, row, entry, owner, name, args, now):
        problem = hidden.not_private_problem(self.gw, owner, name)
        if problem is not None:
            raise _Fail(problem)
        escaped = {k: tokens.escape_spl_string(v) for k, v in args.items()}
        sid = self.gw.dispatch(owner, name, int(row.get("scheduled_time") or now), escaped,
                               trigger_actions=False)
        entry.update(state="running", sid=sid, started_at=int(now))

    def _poll(self, row, entry, now):
        status = self.gw.job_status(entry["sid"])
        if status["state"] == "done":
            return self._done(row, entry, now)
        if status["state"] in ("failed", "missing"):
            raise _Fail("action search %s: %s" % (status["state"], status.get("error")), True)
        if now - (entry.get("started_at") or now) > RUNNING_LIMIT:
            self.gw.control(entry["sid"], "cancel")
            raise _Fail("action search ran longer than %d seconds" % RUNNING_LIMIT, True)

    def _start_job(self, row, entry, action, now):
        target_id = action.get("job")
        target = self.store.get_job(target_id) if target_id else None
        if target is None:
            raise _Fail("job %r does not exist" % (target_id,))
        owner = row.get("owner")
        access = self.gw.user_access(owner) if owner else {"roles": [], "capabilities": []}
        if not authz.can_run(owner, target, access["roles"], access["capabilities"]):
            raise _Fail("owner %r may not run job %r" % (owner, target_id))
        depth = int(row.get("chain_depth") or 0) + 1
        if depth > CHAIN_LIMIT:
            self._emit({"type": "chain_depth_exceeded", "run_id": row["run_id"],
                        "job_id": row["job_id"], "target_job": target_id, "limit": CHAIN_LIMIT},
                       now)
            raise _Fail("Job chain depth limit (%d) reached" % CHAIN_LIMIT)
        rerun = row.get("chain_rerun")
        key = scheduler.run_key(target_id, "start_job", row.get("scheduled_time"), row["run_id"],
                                rerun, entry["index"])
        created = scheduler.create_run(self.store, target, "start_job", row.get("scheduled_time"),
                                       action.get("params") or {}, upstream=row["run_id"],
                                       now=now, audit=self.audit, chain_depth=depth, rerun=rerun,
                                       action_index=entry["index"], upstream_run=row)
        if created is None and self.store.get_run(key) is None:
            raise _Fail("run of job %r was not created (queue is full)" % target_id)
        self._done(row, entry, now, target_job=target_id, target_run_id=key)
