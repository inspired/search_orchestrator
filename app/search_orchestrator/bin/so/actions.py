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
* ``webhook``: ``destination`` (a name), optional ``preset`` (``slack`` or
  ``generic``) and ``body`` (a JSON template; ``{{job}}``, ``{{run_id}}``,
  ``{{message}}`` and the other ctx names are filled in)

Templates (webhook body, email subject and message, event payload, alert
action parameters) also take the SPL tokens ``$run.*$`` and ``$<step>.*$``
(with ``|default``; a token with no value and no default is left empty). Their
values come from ``tokens``, the run's token context snapshotted into the row
at submit. Webhook bodies are JSON-encoded after filling; search action args
are SPL-string escaped.
* ``email``: ``to``, optional ``subject`` and ``message``
* ``event``: ``index``, optional ``payload`` (template)
* ``start_job``: ``job`` (target job ID) and optional ``params``
* ``alert_action``: ``action`` (name) and ``params``
Email, event and alert_action dispatch a hidden search as the run's owner,
named by the action's ``hidden_search`` in the run's definition snapshot
(content-addressed, written at job save; see ``hidden.py`` for the args contract).

Webhook destinations live in ``so_settings`` document ``destinations``:
``{"destinations": [{"name", "url_secret_ref", "headers_secret_ref", "preset"}]}``.
The URL (and optional headers JSON) are read from the credential store and are
never logged or audited: only scheme and host are reported.

Retries: a failing action is retried 3 times (4 attempts) after ``state.backoff``
seconds. A non-transient error (https rule, 4xx, unknown destination, no
permission) fails at once.

Fallback (spec section 10, decided here, on the job-scope event only): the run
failing (``on_failure``) or being delayed (``on_delayed``) is sent to
``settings.fallback`` (``{"type": "webhook", "destination": name}`` or
``{"type": "email", "to": address}``) unless the job has a job-level action for
the hook, or (failure) an unhandled failed step has a step-level on_failure
action, or (delay) a delayed step has a step-level on_delayed action. Handled
step failures never use the fallback. A matching action that runs out of
retries sends it too. The key is ``run_id:fallback:hook:occurrence``, so one
event sends at most one fallback.

Rows snapshot everything they need (action definitions, owner, scheduled time,
ctx, chain depth, ``chain_rerun``) at submit, so ``pump`` never re-reads the run (a queue-cap
rejected run is never saved). ``pump(now, keep_lease)`` calls ``keep_lease()``
between rows and ``keep_lease(force=True)`` right before each send, and starts
no new action after ``PUMP_BUDGET`` seconds.
Fallback rows have ``kind="fallback"`` and ``scope="fallback"``. Content is only job,
run and step names, status and links. Email goes through the
system-owned hidden search ``_so_fallback_email`` under ``nobody``.
Links are relative unless settings has ``base_url``.

Delivery is at least once: a crash between dispatching a search and saving its
sid can repeat that one action.
"""
import json
import logging
import time
from urllib.parse import quote, urlsplit

from . import authz, hidden, presets, scheduler, tokens
from .gateway import DispatchError, GatewayError, check_webhook_url
from .state import backoff

log = logging.getLogger(__name__)

ACTION_RUNS = "so_action_runs"
SETTINGS = "so_settings"
MAX_RETRIES = 3
PUMP_BUDGET = 5.0
CHAIN_LIMIT = 10
RUNNING_LIMIT = 600  # seconds a hidden action search may run
BATCH = 100
FALLBACK_HOOKS = ("on_delayed", "on_failure")
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


def _scrub(text, url):
    """Remove a webhook URL (and its path, query and credentials) from an error text."""
    text = str(text)
    parts = urlsplit(url)
    bits = [url, parts.path if len(parts.path) > 1 else "", parts.query,
            parts.netloc.rpartition("@")[0]]
    for bit in sorted(set(b for b in bits if b), key=len, reverse=True):
        text = text.replace(bit, "[url]")
    return text


def _needs_failure_fallback(run, definition):
    if any(a.get("hook") == "on_failure" for a in definition.get("actions") or []):
        return False
    handled = {e.get("from") for e in definition.get("edges") or []
               if e.get("condition") in ("on_failure", "always")}
    for step in definition.get("steps") or []:
        st = (run.get("steps") or {}).get(step.get("id")) or {}
        if st.get("state") == "failed" and step.get("id") not in handled \
                and any(a.get("hook") == "on_failure" for a in step.get("actions") or []):
            return False
    return True


def _needs_delay_fallback(run, definition):
    if any(a.get("hook") == "on_delayed" for a in definition.get("actions") or []):
        return False
    for step in definition.get("steps") or []:
        st = (run.get("steps") or {}).get(step.get("id")) or {}
        if st.get("delay_alerted") \
                and any(a.get("hook") == "on_delayed" for a in step.get("actions") or []):
            return False
    return True


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
        matching = [(i, a) for i, s, sid, a in indexed_actions(definition)
                    if s == scope and sid == step_id and a.get("hook") == hook]
        ctx = self._ctx(run, hook, scope, step_id)
        doc = {"_key": key, "kind": "action", "run_id": run_id, "job_id": run.get("job_id"),
               "owner": run.get("owner"), "scheduled_time": run.get("scheduled_time"),
               "scope": scope, "hook": hook, "step_id": step_id, "occurrence": occurrence,
               "ctx": ctx, "tokens": tokens.run_context(run) if matching else None,
               "chain_depth": int(run.get("chain_depth") or 0),
               "chain_rerun": chain_rerun(run),
               "actions": [_entry(i, a) for i, a in matching],
               "state": "pending", "attempts": 0, "error": None,
               "fallback": False, "created_at": int(self.clock())}
        new = bool(matching) and self.gw.kv_insert(ACTION_RUNS, doc)  # nothing to send, no row
        needs = {"on_failure": _needs_failure_fallback,
                 "on_delayed": _needs_delay_fallback}.get(hook)
        if scope == "job" and needs and needs(run, definition):
            self._ensure_fallback(doc)  # also on replay: the insert is idempotent
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
        return {"job": definition.get("name") or job_id, "job_id": job_id,
                "run_id": run.get("_key") or run.get("id"), "hook": hook, "scope": scope,
                "step_id": step_id, "step": names.get(step_id, step_id) if step_id else None,
                "status": status, "failed": failed}

    def _ensure_fallback(self, row):
        key = fallback_key(row["run_id"], row["hook"], row["occurrence"])
        doc = {"_key": key, "kind": "fallback", "run_id": row["run_id"], "job_id": row["job_id"],
               "owner": row.get("owner"), "scheduled_time": row.get("scheduled_time"),
               "scope": "fallback", "hook": row["hook"], "step_id": row["step_id"],
               "occurrence": row["occurrence"], "ctx": row["ctx"],
               "actions": [_entry(None, {"type": "fallback"})], "state": "pending",
               "attempts": 0, "error": None, "fallback": True, "created_at": int(self.clock())}
        return self.gw.kv_insert(ACTION_RUNS, doc)

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
        final = not transient or entry["attempts"] > MAX_RETRIES
        entry["error"] = error[:500]
        entry["sid"] = None
        if final:
            entry["state"] = "failed"
        else:
            entry.update(state="pending", next_at=int(now) + backoff(entry["attempts"]))
        self._emit(dict({"type": "action_failed" if final else "action_retry",
                         "run_id": row["run_id"], "job_id": row["job_id"], "hook": row["hook"],
                         "scope": row["scope"], "step_id": row["step_id"],
                         "action_type": entry["type"], "action_index": entry["index"],
                         "attempts": entry["attempts"], "error": entry["error"],
                         "is_fallback": row["kind"] == "fallback"}, **extra), now)

    # -- executors ------------------------------------------------------------

    def _execute(self, row, entry, settings, now):
        ctx = self._links(row["ctx"], settings)
        if row["kind"] == "fallback":
            return self._fallback(row, entry, ctx, settings, now)
        action = entry.get("action") or {}
        kind = entry["type"]
        if row.get("tokens"):
            ctx["tokens"] = row["tokens"]  # $run.*$ and $<step>.*$ in templates
        if kind == "webhook":
            return self._webhook(row, entry, action, ctx, now)
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

    def _destination(self, name):
        doc = self.gw.kv_get(SETTINGS, "destinations") or {}
        for dest in doc.get("destinations") or []:
            if dest.get("name") == name:
                return dest
        raise _Fail("unknown webhook destination %r" % (name,))

    def _post(self, row, entry, dest_name, preset, body_template, ctx, now):
        dest = self._destination(dest_name)
        url = self.gw.read_secret(dest.get("url_secret_ref") or "")
        if not url:
            raise _Fail("destination %r has no URL secret" % dest_name)
        headers = {"Content-Type": "application/json"}
        try:
            check_webhook_url(url)
            if dest.get("headers_secret_ref"):
                raw = self.gw.read_secret(dest["headers_secret_ref"])
                if raw:
                    try:
                        extra = json.loads(raw)
                        headers.update({str(k): str(v) for k, v in extra.items()})
                    except (ValueError, AttributeError):
                        raise _Fail("destination %r headers secret is not a JSON object"
                                    % dest_name)
            if body_template:
                template = json.loads(body_template) if isinstance(body_template, str) \
                    else body_template
                body = presets.fill(template, ctx)
            else:
                body = presets.render(preset or dest.get("preset") or "generic", ctx)
            parts = urlsplit(url)
            where = {"destination": dest_name, "scheme": parts.scheme, "host": parts.hostname}
            try:
                status = self.gw.post_webhook(url, headers, json.dumps(body))
            except GatewayError as err:
                raise GatewayError(_scrub(err, url), status=err.status, transient=err.transient)
        except _Fail:
            raise
        except GatewayError as err:
            raise _Fail(_scrub(err, url), err.transient)
        except Exception as err:  # e.g. http.client.InvalidURL, whose text has the URL
            raise _Fail("bad webhook request (%s): %s" % (type(err).__name__, _scrub(err, url)))
        self._done(row, entry, now, http_status=status, **where)

    def _webhook(self, row, entry, action, ctx, now):
        self._post(row, entry, action.get("destination"), action.get("preset"),
                   action.get("body"), ctx, now)

    def _fallback(self, row, entry, ctx, settings, now):
        fb = settings.get("fallback") or {}
        if fb.get("type") == "webhook" and fb.get("destination"):
            return self._post(row, entry, fb["destination"], fb.get("preset"), None, ctx, now)
        if fb.get("type") == "email" and fb.get("to"):
            args = {"to": fb["to"], "subject": "Search Orchestrator: %s %s" % (
                ctx["job"], presets._VERB.get(ctx["hook"], ctx["hook"])),
                "message": presets.default_message(ctx)}
            return self._dispatch(row, entry, hidden.FALLBACK_OWNER, hidden.FALLBACK_EMAIL_SEARCH,
                                  args, now)
        raise _Fail("no fallback notification destination is configured")

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
            args.update(index=action.get("index") or "", payload=payload)
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
                                       action_index=entry["index"])
        if created is None and self.store.get_run(key) is None:
            raise _Fail("run of job %r was not created (queue is full)" % target_id)
        self._done(row, entry, now, target_job=target_id, target_run_id=key)
