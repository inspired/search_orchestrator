"""REST API route functions (spec sections 9-11), behind ``orchestrator_rest.py``.

``handle(user, method, path, body, deps) -> (status, payload)`` is pure apart
from the gateways it is given. ``deps``:

* ``user_gateway``: the caller's own session. Used to read the caller's own
  roles and capabilities (``user_access``), to check saved searches and to
  write and delete hidden saved searches, so they are owned by the caller.
* ``system_gateway``: the system session (``passSystemAuth``). Used for KV
  Store (``so_*`` collections deny ordinary users) and secrets.
* ``audit``: an object with ``emit(event)``.
* ``clock`` (optional): returns epoch seconds.
* ``secrets`` (optional): session keys the self-test probe scrubs from its output.
* ``sleep`` (optional): used by the self-test probe while it polls.

``POST selftest`` (admin only, ``| orchestrate selftest``): ``{"scenario":
"basic"|"rollup_late"|"rollup_fail", "slow_n", "delayed_after",
"scheduled_time"}`` saves the built-in job (``selftest.py``) as the caller and
starts a run (``{"job_id", "run_id", ...}``, plus ``"queued_behind": {"run_id",
"state"}`` when an active run of the job keeps it queued); ``"probe"`` returns
``{"checks": [{"check", "ok", "detail"}]}``. The audit object may offer
``write(event)``, which raises on failure, for the probe's audit check.

Step previews (``preview.py``; callers who may edit the job: the stored job if its id
exists and they may see it, else ``can_edit(None)``). A preview is an ad hoc search
started with ``user_gateway`` as the caller, never the owner or the system session;
nothing about it is stored. ``job_ref`` in its sid is the definition's id, or ``new``.

* ``POST preview/defaults`` ``{"job"}``: ``{"scheduled_time"}``, the latest cron slot.
* ``POST preview`` ``{"job", "step_id", "scheduled_time", "params", "input", "anyway"}``,
  ``input`` ``{"mode": "live", "previews": {step: {"sid"} | {"skipped": kind}}}`` or
  ``{"mode": "run", "run_id"}``: 201 ``{"status": "started", "sid", "spl"}`` (plus
  ``"anyway": true`` when it bypassed a skip), 200 ``{"status": "skipped", "skip_kind",
  "reason"}``, 409 ``needs_preview`` (``steps``), ``upstream_failed`` (``step``: a failed
  step behind an on_success edge, as a run decides) or ``run_step_missing`` (``step``), 410
  ``run_results_expired`` (``step``), 403 ``run_results_forbidden`` (``step``: splunkd
  won't let the caller read that run's result), 400 ``invalid`` (errors in the step, the
  steps it reads, the edges into them, params or time zone; or anywhere in the job for a
  cycle or a malformed job) or ``bad_param``. The sid of a live
  input is checked statically (``preview.own_sid``) before splunkd is asked about it. Audited as ``preview_dispatched``.
* ``GET preview/<sid>`` (query ``limit``, seconds, capped at ``preview.MAX_RUNTIME``):
  ``{"state", "result_count", "error", "truncated", "run_duration", "messages"}``; a
  running search past the limit is cancelled and reported failed, otherwise touched.
  The caller's own sid that splunkd no longer has (expired, deleted) is 200 with
  ``"state": "missing"``.
* ``GET preview/<sid>/results``: ``{"fields", "rows", "total"}``, at most
  ``preview.TABLE_ROWS`` rows. ``POST preview/<sid>/cancel``: ``{"cancelled": true}``.
  A sid that is not the caller's own preview is 404 (results and cancel: also a gone one).

Failures return ``{"error": {"code", "message", "issues"}}`` (some codes add
fields, such as ``choices`` for ``definition_choice_required``). A job or run
the caller may not see is reported as 404, never 403, so its existence does
not leak.

Engine commands (``so_commands``), applied by ``Engine._apply_command``:
``{"type": "pause"|"resume"|"cancel"|"dismiss", "run_id", "user"}`` and
``{"type": "rerun", "run_id", "step_id", "definition": "latest"|"original",
"restart_downstream_jobs": bool, "user"}``. The engine decides whether the
run's state allows the command and audits the result.

Hidden searches no longer needed are removed at each save of the job
(``hidden.gc``). "Needed" covers active runs, held runs, and failed or
cancelled runs that ended within the result-retention setting, since those
may still be re-run with their original definition.
"""
import json
import re
import time
import uuid
from urllib.parse import unquote, urlsplit

from . import authz, hidden, model, preview, scheduler, selftest, tokens
from . import cron as cronmod
from . import state as statemod
from .engine import DEFAULT_SETTINGS, first_fields
from .gateway import GatewayError, check_webhook_url
from .lease import COLLECTION as LOCKS
from .lease import KEY as LEASE_KEY
from .lease import LEASE_SECONDS
from .store import ACTIVE_RUN_STATES, COMMANDS, RUNS, SETTINGS, Store

JOB_ID_RE = model.JOB_ID_RE
DEST_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
RESERVED_JOB_IDS = ("validate", "new")  # route keywords under jobs/; "new": unsaved previews
DESTINATIONS_KEY = "destinations"
ACTION_RUNS = "so_action_runs"
AUDIT_INDEX = "orchestrator"
RERUNNABLE = ("blocked", "failed", "cancelled")
LIST_FIELDS = "definition:0"  # KV projection for run lists: no definition snapshot
ACTION_TYPES = ("webhook", "email", "event", "start_job", "alert_action")
HOOKS = ("on_start", "on_success", "on_failure", "on_complete", "on_delayed")
PRESETS = ("slack", "generic")
# Integer settings and their upper bounds (the lower bound is 1).
INT_SETTINGS = {"max_searches": 100, "max_searches_per_job": 50, "queue_cap": 1000,
                "result_retention": 7 * 86400, "run_retention_days": 3650}
HIDDEN_JOB = "(hidden job)"
CHAIN_LIMIT = 10
NEXT_RUN_MAX_DAYS = 400  # day matches the Jobs screen's next-run walk may try per cron
LAST_RUN_FIELDS = ("id", "state", "trigger", "scheduled_time", "started_at", "ended_at",
                   "delay_alerted", "held", "gave_up")
# Bookkeeping fields: not part of a job's definition for "has the job changed".
_META = ("_key", "_user", "created_at", "created_by", "updated_at", "updated_by",
         "hidden_searches", "enabled")
_SERVER_FIELDS = ("owner", "hidden_searches", "created_at", "created_by", "updated_at",
                  "updated_by")


class ApiError(Exception):
    def __init__(self, status, code, message, issues=None, **extra):
        Exception.__init__(self, message)
        self.status = status
        self.code = code
        self.message = message
        self.issues = issues or []
        self.extra = extra

    def payload(self):
        err = {"code": self.code, "message": self.message, "issues": self.issues}
        err.update(self.extra)
        return {"error": err}


def _issue(level, code, message, step=None):
    return {"level": level, "code": code, "message": message, "step": step}


def _errors(issues):
    return [i for i in issues if i.get("level") == "error"]


class _Ctx:
    def __init__(self, user, deps):
        self.user = user
        self.deps = deps
        self.user_gw = deps["user_gateway"]
        self.sys_gw = deps["system_gateway"]
        self.store = Store(self.sys_gw)
        self.audit = deps["audit"]
        self.now = int((deps.get("clock") or time.time)())
        self._access = None

    @property
    def access(self):
        if self._access is None:
            self._access = self.user_gw.user_access(self.user)
        return self._access

    def allowed(self, check, job):
        return check(self.user, job, self.access["roles"], self.access["capabilities"])

    def emit(self, event):
        event = dict(event)
        event.setdefault("_time", self.now)
        event.setdefault("user", self.user)
        event.setdefault("source", "rest")
        try:
            self.audit.emit(event)
        except Exception:  # a lost audit event never fails the request
            pass

    def deny(self, action, **fields):
        self.emit(dict(fields, type="permission_denied", action=action))
        return ApiError(403, "forbidden", "you may not %s" % action.replace("_", " "))


# Routing.

def _routes():
    return [
        (r"jobs", {"GET": list_jobs, "POST": create_job}),
        (r"jobs/validate", {"POST": validate_job}),
        (r"jobs/(?P<job_id>[^/]+)", {"GET": get_job, "PUT": update_job, "DELETE": delete_job}),
        (r"jobs/(?P<job_id>[^/]+)/runs", {"POST": start_run}),
        (r"jobs/(?P<job_id>[^/]+)/enabled", {"POST": set_enabled}),
        (r"runs", {"GET": list_runs}),
        (r"runs/(?P<run_id>[^/]+)", {"GET": get_run}),
        (r"runs/(?P<run_id>[^/]+)/(?P<action>pause|resume|cancel|dismiss)", {"POST": control_run}),
        (r"runs/(?P<run_id>[^/]+)/rerun", {"POST": rerun}),
        (r"settings", {"GET": get_settings, "PUT": put_settings}),
        (r"destinations", {"GET": list_destinations, "POST": save_destination}),
        (r"destinations/(?P<name>[^/]+)", {"DELETE": delete_destination}),
        (r"health", {"GET": health}),
        (r"me", {"GET": me}),
        (r"selftest", {"POST": run_selftest}),
        (r"preview", {"POST": start_preview}),
        (r"preview/defaults", {"POST": preview_defaults}),
        (r"preview/(?P<sid>[^/]+)", {"GET": poll_preview}),
        (r"preview/(?P<sid>[^/]+)/results", {"GET": preview_rows}),
        (r"preview/(?P<sid>[^/]+)/cancel", {"POST": cancel_preview}),
    ]


def _is_job_id(value):
    return bool(JOB_ID_RE.fullmatch(value))


_ID_CHECKS = {"job_id": _is_job_id, "run_id": scheduler.is_run_id,
              "name": lambda v: bool(DEST_NAME_RE.fullmatch(v)),
              "sid": lambda v: preview.parts(v) is not None}


def _relative(path):
    """``/servicesNS/-/app/orchestrator/jobs/x`` -> ``jobs/x``."""
    parts = [p for p in (path or "").split("/") if p]
    if "orchestrator" in parts:
        parts = parts[parts.index("orchestrator") + 1:]
    return "/".join(parts)


def handle(user, method, path, body, deps):
    """Route one request. Returns ``(status, payload)``."""
    method = (method or "GET").upper()
    rel = _relative(path)
    try:
        if not user:
            raise ApiError(401, "unauthenticated", "no user session")
        for pattern, methods in _routes():
            match = re.fullmatch(pattern, rel)
            if not match:
                continue
            func = methods.get(method)
            if func is None:
                raise ApiError(405, "method_not_allowed", "%s is not allowed on %s" % (method, rel))
            if body is not None and not isinstance(body, dict):
                raise ApiError(400, "bad_request", "the request body must be a JSON object")
            args = {k: unquote(v) for k, v in match.groupdict().items()}
            for key, value in args.items():
                if not _ID_CHECKS.get(key, lambda v: True)(value):
                    # Never let a malformed id reach a KV Store path on the system session.
                    raise ApiError(404, "not_found", "no such %s" % key.replace("_id", ""))
            return func(_Ctx(user, deps), body or {}, **args)
        raise ApiError(404, "not_found", "no such route: %s" % rel)
    except ApiError as err:
        return err.status, err.payload()
    except GatewayError as err:
        return 502, ApiError(502, "splunk_error", "a call to Splunk failed: %s" % err).payload()


# Jobs.

def _public_job(ctx, job):
    out = {k: v for k, v in job.items() if k not in ("_key", "_user", "hidden_searches")}
    out["permissions"] = {"can_edit": ctx.allowed(authz.can_edit, job),
                          "can_run": ctx.allowed(authz.can_run, job)}
    return out


def _visible_job(ctx, job_id):
    job = ctx.store.get_job(job_id)
    if job is None or not ctx.allowed(authz.can_view, job):
        raise ApiError(404, "not_found", "no job %r" % job_id)
    return job


def _next_run(job, now):
    """``(next cron slot after now, beyond)``: the slot is None when there is none;
    ``beyond`` is True when the walk (NEXT_RUN_MAX_DAYS days) ended without finding one,
    so the Jobs screen shows a dash instead of "Not scheduled"."""
    if job.get("enabled") is False:
        return None, False
    specs = scheduler.cron_specs(job)
    if not specs:
        return None, False
    slots = [cronmod.next_slot(spec, int(now) + 1, job.get("timezone"), NEXT_RUN_MAX_DAYS)
             for spec in specs]
    slots = [s for s in slots if s is not None]
    return (min(slots), False) if slots else (None, True)


def _last_run(ctx, job_id):
    rows = ctx.sys_gw.kv_query(RUNS, {"job_id": job_id}, sort="created_at:-1", limit=1)
    if not rows:
        return None
    return {k: rows[0].get(k) for k in LAST_RUN_FIELDS}


def _listed_job(ctx, job):
    """A job for the Jobs screen: the public job plus its next and last run."""
    out = _public_job(ctx, job)
    out["next_run"], out["next_run_beyond"] = _next_run(job, ctx.now)
    out["last_run"] = _last_run(ctx, job.get("id") or job.get("_key"))
    return out


def list_jobs(ctx, body):
    jobs = [j for j in ctx.store.list_jobs() if ctx.allowed(authz.can_view, j)]
    jobs.sort(key=lambda j: (str(j.get("name") or ""), str(j.get("id"))))
    return 200, {"jobs": [_listed_job(ctx, j) for j in jobs]}


def get_job(ctx, body, job_id):
    return 200, {"job": _listed_job(ctx, _visible_job(ctx, job_id))}


def _new_id(ctx, body):
    job_id = body.get("id")
    if job_id is not None:
        if not isinstance(job_id, str) or not JOB_ID_RE.fullmatch(job_id):
            raise ApiError(400, "bad_job_id", "job id %r must be 1-64 letters, digits, _ or -, "
                           "starting with a letter or digit" % (job_id,))
        if job_id.lower() in RESERVED_JOB_IDS:
            raise ApiError(400, "bad_job_id", "job id %r is reserved" % job_id)
        return job_id
    slug = re.sub(r"[^a-z0-9]+", "_", str(body.get("name") or "job").lower()).strip("_")[:40]
    base = slug or "job"
    job_id = base
    while (job_id in RESERVED_JOB_IDS or ctx.store.get_job(job_id) is not None
           or _has_runs(ctx, job_id)):
        job_id = "%s_%s" % (base, uuid.uuid4().hex[:6])
    return job_id


def _has_runs(ctx, job_id):
    """Does KV Store still hold any run of ``job_id`` (e.g. of a deleted job)?"""
    return bool(ctx.store.list_runs({"job_id": job_id}, limit=1, fields="_key"))


def _prepare(body, job_id, owner):
    job = {k: v for k, v in body.items() if not k.startswith("_") and k not in _SERVER_FIELDS}
    job.update(_key=job_id, id=job_id, owner=owner)
    if job.get("enabled") is None:
        job["enabled"] = True
    return job


def _destination_names(ctx):
    doc = ctx.sys_gw.kv_get(SETTINGS, DESTINATIONS_KEY) or {}
    return {d.get("name") for d in doc.get("destinations") or []}


def _job_issues(ctx, job):
    """Checks beyond ``model.validate_job``: job fields, actions and the start_job cycle."""
    issues = []
    if not isinstance(job.get("name"), str) or not job["name"].strip():
        issues.append(_issue("error", "bad_job", "the job needs a name"))
    if not isinstance(job.get("enabled"), bool):
        issues.append(_issue("error", "bad_job", "enabled must be true or false"))
    roles = job.get("run_roles")
    if roles is not None and not (isinstance(roles, list) and all(isinstance(r, str) for r in roles)):
        issues.append(_issue("error", "bad_job", "run_roles must be a list of role names"))
    for t in job.get("triggers") or []:
        if not isinstance(t, dict) or t.get("type") != "completion":
            continue
        if not isinstance(t.get("job"), str) or not JOB_ID_RE.fullmatch(t["job"]):
            issues.append(_issue("error", "bad_trigger", "a completion trigger needs the id of "
                                 "the job it follows"))
        if (t.get("on") or "success") not in ("success", "complete"):
            issues.append(_issue("error", "bad_trigger", "a completion trigger's \"on\" must be "
                                 "\"success\" or \"complete\""))
    dests = None
    scoped = [(None, a) for a in job.get("actions") or []]
    for step in job.get("steps") or []:
        scoped.extend((step.get("id"), a) for a in step.get("actions") or [])
    for step_id, action in scoped:
        if not isinstance(action, dict):
            issues.append(_issue("error", "bad_action", "an action must be an object", step_id))
            continue
        kind = action.get("type")
        if kind not in ACTION_TYPES:
            issues.append(_issue("error", "bad_action", "unknown action type %r" % (kind,), step_id))
            continue
        if action.get("hook") not in HOOKS:
            issues.append(_issue("error", "bad_action", "unknown action hook %r"
                                 % (action.get("hook"),), step_id))
        required = {"email": "to", "event": "index", "start_job": "job",
                    "alert_action": "action", "webhook": "destination"}[kind]
        if not isinstance(action.get(required), str) or not action[required]:
            issues.append(_issue("error", "bad_action", "%s action needs %s" % (kind, required),
                                 step_id))
        elif kind == "webhook":
            if dests is None:
                dests = _destination_names(ctx)
            if action["destination"] not in dests:
                issues.append(_issue("error", "unknown_destination", "unknown webhook destination "
                                     "%r" % action["destination"], step_id))
    cycle = _chain_cycle(ctx, job)
    if cycle:
        cycle = _redact_cycle(ctx, cycle, job["id"])
        issues.append(_issue("warning", "job_chain_cycle",
                             "start_job actions form a cycle across jobs (%s); each run starts the "
                             "next until the chain depth limit (%d) stops it"
                             % (" -> ".join(cycle), CHAIN_LIMIT)))
    return issues


def _chain_targets(job):
    actions = list(job.get("actions") or [])
    for step in job.get("steps") or []:
        if isinstance(step, dict):
            actions.extend(step.get("actions") or [])
    return [a.get("job") for a in actions
            if isinstance(a, dict) and a.get("type") == "start_job" and isinstance(a.get("job"), str)]


def _redact_cycle(ctx, cycle, own_id):
    """Replace the ids of jobs the caller may not view with ``(hidden job)``."""
    jobs = {}
    out = []
    for job_id in cycle:
        if job_id != own_id:
            if job_id not in jobs:
                jobs[job_id] = ctx.store.get_job(job_id)
            if jobs[job_id] is None or not ctx.allowed(authz.can_view, jobs[job_id]):
                job_id = HIDDEN_JOB
        out.append(job_id)
    return out


def _chain_cycle(ctx, job):
    """The path ``[job, ..., job]`` if start_job actions lead back to ``job``, else None."""
    start = job["id"]
    graph = {j.get("id") or j.get("_key"): _chain_targets(j) for j in ctx.store.list_jobs()}
    graph[start] = _chain_targets(job)
    parent = {start: None}
    queue = [start]
    while queue:
        node = queue.pop(0)
        for target in graph.get(node) or []:
            if target == start:
                path = [node]
                while parent[path[-1]] is not None:
                    path.append(parent[path[-1]])
                return list(reversed(path)) + [start]
            if target not in parent:
                parent[target] = node
                queue.append(target)
    return None


def _check(ctx, job):
    """``(issues, planned, searches)`` for a save, without writing anything. ``planned``
    and ``searches`` come from ``hidden.plan`` and are None if an earlier check failed."""
    issues = model.validate_job(job)
    if _errors(issues):
        return issues, None, None
    issues += _job_issues(ctx, job)
    if _errors(issues):
        return issues, None, None
    planned, searches, found = hidden.plan(ctx.user_gw, job)
    issues += found
    return issues, planned, searches


def _owner_change(ctx, previous):
    """``{"owner_will_change", "owner"}``: saving makes the saver the owner, so an admin
    saving another person's job takes it over (spec section 9)."""
    changes = previous is not None and previous.get("owner") != ctx.user
    return {"owner_will_change": changes, "owner": ctx.user}


def validate_job(ctx, body):
    if not ctx.allowed(authz.can_edit, None) and not ctx.allowed(authz.can_admin, None):
        raise ctx.deny("validate_job")
    job_id = body.get("id") if isinstance(body.get("id"), str) and body.get("id") else "job"
    existing = None
    if body.get("id") and _is_job_id(job_id):
        existing = ctx.store.get_job(job_id)
        if existing is not None and not ctx.allowed(authz.can_view, existing):
            existing = None  # as if new: never reveal that the id is taken
    issues, _, _ = _check(ctx, _prepare(body, job_id, ctx.user))
    out = {"valid": not _errors(issues), "issues": issues}
    out.update(_owner_change(ctx, existing))
    return 200, out


def _save(ctx, job, previous):
    issues, planned, searches = _check(ctx, job)
    if _errors(issues):
        raise ApiError(400, "job_invalid", "the job has errors and was not saved", issues)

    def record(tracked):
        # Stored before any upsert, on the doc the engine already uses, so a partial
        # failure leaves every new name tracked for gc. A new job has no doc yet: on
        # failure its searches are removed again below.
        if previous is not None:
            ctx.store.save_job(dict(previous, hidden_searches=tracked))

    try:
        job = hidden.apply(ctx.user_gw, planned, searches, previous, record)
    except GatewayError:
        if previous is None:
            for s in searches:
                try:
                    ctx.user_gw.delete_saved_search(s["owner"], s["name"])
                except GatewayError as err:
                    ctx.emit({"type": "hidden_search_delete_failed", "job_id": job["id"],
                              "name": s["name"], "owner": s["owner"], "error": str(err)})
        raise
    job["created_at"] = (previous or {}).get("created_at", ctx.now)
    job["created_by"] = (previous or {}).get("created_by", ctx.user)
    job.update(updated_at=ctx.now, updated_by=ctx.user)
    ctx.store.save_job(job)
    _collect_garbage(ctx, job)
    return job, issues


def _runs_needing_searches(ctx, job_id):
    retention = int((ctx.store.get_settings() or {}).get("result_retention")
                    or DEFAULT_SETTINGS["result_retention"])
    out = []
    for run in ctx.store.list_runs({"job_id": job_id}):
        state = run.get("state")
        if state in ACTIVE_RUN_STATES or run.get("held"):
            out.append(run)
        elif state in RERUNNABLE and int(run.get("ended_at") or 0) >= ctx.now - retention:
            out.append(run)
    return out


def _collect_garbage(ctx, job):
    stale = hidden.gc(job, _runs_needing_searches(ctx, job["id"]))
    if not stale:
        return
    gone = []
    for entry in stale:
        try:
            ctx.user_gw.delete_saved_search(entry["owner"], entry["name"])
            gone.append(entry)
        except GatewayError as err:  # kept on the list; tried again at the next save
            ctx.emit({"type": "hidden_search_delete_failed", "job_id": job["id"],
                      "name": entry["name"], "owner": entry["owner"], "error": str(err)})
    if gone:
        job["hidden_searches"] = [e for e in job["hidden_searches"] if e not in gone]
        ctx.store.save_job(job)


def create_job(ctx, body):
    if not ctx.allowed(authz.can_edit, None):
        raise ctx.deny("create_job")
    job_id = _new_id(ctx, body)
    if ctx.store.get_job(job_id) is not None:
        raise ApiError(409, "job_exists", "a job with id %r already exists" % job_id)
    if _has_runs(ctx, job_id):
        # A new owner of the id would otherwise see, and re-run, the old owner's runs.
        raise ApiError(409, "job_id_in_use", "Runs of a deleted job with this id are still "
                       "retained; choose another id")
    job, issues = _save(ctx, _prepare(body, job_id, ctx.user), None)
    ctx.emit({"type": "job_saved", "job_id": job_id, "created": True, "owner": job["owner"]})
    out = {"job": _public_job(ctx, job), "issues": issues}
    out.update(_owner_change(ctx, None))
    return 201, out


def update_job(ctx, body, job_id):
    previous = _visible_job(ctx, job_id)
    if not ctx.allowed(authz.can_edit, previous):
        raise ctx.deny("edit_job", job_id=job_id)
    old_owner = previous.get("owner")
    change = _owner_change(ctx, previous)
    job, issues = _save(ctx, _prepare(body, job_id, ctx.user), previous)
    ctx.emit({"type": "job_saved", "job_id": job_id, "created": False, "owner": job["owner"],
              "enabled": job.get("enabled")})
    if old_owner != ctx.user:
        ctx.emit({"type": "job_owner_changed", "job_id": job_id, "from": old_owner,
                  "to": ctx.user})
    out = {"job": _public_job(ctx, job), "issues": issues}
    out.update(change)
    return 200, out


def set_enabled(ctx, body, job_id):
    """Enable or disable a job. Unlike a save, the owner is kept (an admin does not take
    the job over), and the definition and its hidden searches are untouched."""
    job = _visible_job(ctx, job_id)
    if not ctx.allowed(authz.can_edit, job):
        raise ctx.deny("enable_job", job_id=job_id)
    enabled = body.get("enabled")
    if not isinstance(enabled, bool):
        raise ApiError(400, "bad_request", "enabled must be true or false")
    job.update(enabled=enabled, updated_at=ctx.now, updated_by=ctx.user)
    ctx.store.save_job(job)
    ctx.emit({"type": "job_enabled", "job_id": job_id, "enabled": enabled,
              "owner": job.get("owner")})
    return 200, {"job": _public_job(ctx, job)}


def delete_job(ctx, body, job_id):
    job = _visible_job(ctx, job_id)
    if not ctx.allowed(authz.can_edit, job):
        raise ctx.deny("delete_job", job_id=job_id)
    active = ctx.store.list_runs({"job_id": job_id, "state": {"$in": ACTIVE_RUN_STATES}})
    if active:
        raise ApiError(409, "job_has_active_runs", "job %r has %d active or queued run(s); cancel "
                       "them first" % (job_id, len(active)))
    for entry in job.get("hidden_searches") or []:
        ctx.user_gw.delete_saved_search(entry["owner"], entry["name"])
    ctx.store.delete_job(job_id)
    ctx.emit({"type": "job_deleted", "job_id": job_id, "owner": job.get("owner")})
    return 200, {"deleted": job_id}


# Runs.

def _scheduled_time(ctx, body):
    value = body.get("scheduled_time")
    if value is None or value == "":
        return ctx.now
    try:
        if isinstance(value, bool):
            raise ValueError
        out = int(float(value))
    except (TypeError, ValueError):
        raise ApiError(400, "bad_request", "scheduled_time must be epoch seconds")
    if out < 0:
        raise ApiError(400, "bad_request", "scheduled_time must be epoch seconds")
    return out


def start_run(ctx, body, job_id):
    job = _visible_job(ctx, job_id)
    if not ctx.allowed(authz.can_run, job):
        raise ctx.deny("run_job", job_id=job_id)
    if job.get("enabled") is False:
        raise ApiError(409, "job_disabled", "job %r is disabled" % job_id)
    params = body.get("params") or {}
    if not isinstance(params, dict):
        raise ApiError(400, "bad_request", "params must be an object")
    scheduled = _scheduled_time(ctx, body)
    try:
        run_id = scheduler.create_run(ctx.store, job, "manual", scheduled, params, now=ctx.now,
                                      audit=ctx.audit, chain_depth=0)
    except tokens.TokenError as err:
        message = "parameter %s: %s" % (err.token, err.reason)
        raise ApiError(400, "bad_param", message, [_issue("error", "bad_param", message)])
    if run_id is None:
        raise ApiError(409, "queue_full", "job %r has reached its queue cap" % job_id)
    ctx.emit({"type": "run_requested", "job_id": job_id, "run_id": run_id,
              "scheduled_time": scheduled})
    return 201, {"run_id": run_id}


def _run_job(ctx, run, jobs=None):
    """The job a run's permissions come from: the current job, or, if it was deleted,
    only the run's own owner and its snapshot's run_roles (admins see every run)."""
    job_id = run.get("job_id")
    job = jobs.get(job_id) if jobs is not None else ctx.store.get_job(job_id)
    if job is None:
        job = {"owner": run.get("owner"),
               "run_roles": (run.get("definition") or {}).get("run_roles") or []}
    return job


def _visible_run(ctx, run_id):
    run = ctx.store.get_run(run_id)
    if run is None or not ctx.allowed(authz.can_view, _run_job(ctx, run)):
        raise ApiError(404, "not_found", "no run %r" % run_id)
    return run


def _summary(run):
    return {k: v for k, v in run.items() if k not in ("_key", "_user", "definition")}


def list_runs(ctx, body):
    filters = {}
    for key in ("job_id", "state"):
        if isinstance(body.get(key), str) and body[key]:
            filters[key] = body[key]
    try:
        limit = max(1, min(1000, int(body.get("limit") or 200)))
    except (TypeError, ValueError):
        raise ApiError(400, "bad_request", "limit must be a number")
    if ctx.allowed(authz.can_admin, None):
        runs = ctx.store.list_runs(filters, limit=limit, fields=LIST_FIELDS)
        return 200, {"runs": [_summary(r) for r in runs]}
    jobs = {j.get("id") or j.get("_key"): j for j in ctx.store.list_jobs()}
    visible = sorted(k for k, j in jobs.items() if ctx.allowed(authz.can_view, j))
    query = dict(filters)
    if "job_id" in filters:
        if filters["job_id"] in jobs and filters["job_id"] not in visible:
            return 200, {"runs": []}
    else:  # runs of jobs the caller may see, and runs of deleted jobs (checked below)
        query["$or"] = [{"job_id": {"$in": visible}}, {"job_id": {"$nin": sorted(jobs)}}]
    out, skip = [], 0
    while len(out) < limit:
        page = ctx.store.list_runs(query, limit=limit, skip=skip, fields=LIST_FIELDS)
        out.extend(r for r in page if r.get("job_id") in visible or _deleted_job_run_visible(ctx, r))
        if len(page) < limit:
            break
        skip += len(page)
    return 200, {"runs": [_summary(r) for r in out[:limit]]}


def _deleted_job_run_visible(ctx, row):
    """A listed run (without its snapshot) of a deleted job: visible to its owner, or to
    run_roles members per the snapshot, which is read only when needed."""
    if row.get("owner") == ctx.user:
        return True
    run = ctx.store.get_run(row.get("_key") or row.get("id"))
    return run is not None and ctx.allowed(authz.can_view, _run_job(ctx, run, {}))


def _definition(doc):
    return {k: v for k, v in (doc or {}).items() if k not in _META}


def _ancestors(definition, step_id):
    preds = {}
    for e in definition.get("edges") or []:
        preds.setdefault(e.get("to"), []).append(e.get("from"))
    seen, stack = set(), list(preds.get(step_id, []))
    while stack:
        n = stack.pop()
        if n not in seen:
            seen.add(n)
            stack.extend(preds.get(n, []))
    return seen


def _latest_choice(run, job, step_id):
    """``(available, reason)`` for re-running ``step_id`` with the job's latest definition."""
    if job is None:
        return False, "the job no longer exists"
    original = run.get("definition") or {}
    latest_ids = {s.get("id") for s in job.get("steps") or []}
    needed = {step_id} | _ancestors(original, step_id)
    missing = sorted(n for n in needed if n not in latest_ids)
    if missing:
        return False, ("the latest definition removed or renamed step(s) %s that this run "
                       "depends on" % ", ".join("%r" % m for m in missing))
    return True, None


def _choices(latest_ok, reason):
    return [{"definition": "latest", "available": latest_ok, "reason": reason},
            {"definition": "original", "available": True, "reason": None}]


def get_run(ctx, body, run_id):
    run = _visible_run(ctx, run_id)
    job = ctx.store.get_job(run.get("job_id"))
    out = {k: v for k, v in run.items() if k not in ("_key", "_user")}
    out["definition_changed"] = job is not None and \
        _definition(job) != _definition(run.get("definition"))
    out["rerun_latest"] = {}
    for step in (run.get("definition") or {}).get("steps") or []:
        ok, reason = _latest_choice(run, job, step["id"])
        out["rerun_latest"][step["id"]] = {"available": ok, "reason": reason}
    out["permissions"] = {"can_run": ctx.allowed(authz.can_run, _run_job(ctx, run))}
    attempts = ctx.store.list_step_runs(run_id)
    actions = ctx.sys_gw.kv_query(ACTION_RUNS, {"run_id": run_id})
    return 200, {"run": out, "attempts": attempts, "actions": actions}


def _controllable_run(ctx, run_id, action):
    run = _visible_run(ctx, run_id)
    if not ctx.allowed(authz.can_run, _run_job(ctx, run)):
        raise ctx.deny(action + "_run", run_id=run_id)
    return run


def _enqueue(ctx, command):
    command = dict(command, user=ctx.user, created_at=ctx.now)
    key = ctx.store.enqueue_command(command)
    ctx.emit({"type": "command_requested", "command": command["type"],
              "run_id": command.get("run_id"), "step_id": command.get("step_id")})
    return key


def control_run(ctx, body, run_id, action):
    run = _controllable_run(ctx, run_id, action)
    key = _enqueue(ctx, {"type": action, "run_id": run.get("id") or run_id})
    return 202, {"command_id": key}


def rerun(ctx, body, run_id):
    run = _controllable_run(ctx, run_id, "rerun")
    step_id = body.get("step") if body.get("step") is not None else body.get("step_id")
    if not isinstance(step_id, str) or not step_id:
        raise ApiError(400, "bad_request", "step is required")
    if run.get("state") not in RERUNNABLE:
        raise ApiError(409, "invalid_state", "a %s run cannot be re-run; only blocked, failed and "
                       "cancelled runs can" % run.get("state"))
    original = run.get("definition") or {}
    if step_id not in [s.get("id") for s in original.get("steps") or []]:
        raise ApiError(400, "unknown_step", "the run has no step %r" % step_id)
    choice = body.get("definition")
    if choice not in (None, "latest", "original"):
        raise ApiError(400, "bad_request", "definition must be \"latest\" or \"original\"")
    restart = body.get("restart_downstream_jobs", False)
    if not isinstance(restart, bool):
        raise ApiError(400, "bad_request", "restart_downstream_jobs must be true or false")
    job = ctx.store.get_job(run.get("job_id"))
    changed = job is not None and _definition(job) != _definition(original)
    latest_ok, reason = _latest_choice(run, job, step_id)
    if choice is None and changed:
        raise ApiError(409, "definition_choice_required",
                       "the job changed since this run started: choose the latest or the "
                       "original definition", choices=_choices(latest_ok, reason))
    choice = choice or "original"
    if choice == "latest" and not latest_ok:
        raise ApiError(409, "definition_unavailable",
                       "the latest definition cannot be used: %s" % reason,
                       choices=_choices(latest_ok, reason))
    key = _enqueue(ctx, {"type": "rerun", "run_id": run.get("id") or run_id, "step_id": step_id,
                         "definition": choice, "restart_downstream_jobs": restart})
    return 202, {"command_id": key, "definition": choice}


# Settings and destinations.

def _require_admin(ctx, action):
    if not ctx.allowed(authz.can_admin, None):
        raise ctx.deny(action)


def _settings_view(stored):
    out = dict(DEFAULT_SETTINGS)
    out.update(fallback=None, base_url=None)
    for key, value in (stored or {}).items():
        if not key.startswith("_") and value is not None:
            out[key] = value
    return out


def get_settings(ctx, body):
    _require_admin(ctx, "read_settings")
    return 200, {"settings": _settings_view(ctx.store.get_settings())}


def _bad_setting(message):
    return ApiError(400, "bad_setting", message)


def _check_fallback(ctx, value):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise _bad_setting("fallback must be an object or null")
    kind = value.get("type")
    if kind == "email":
        to = value.get("to")
        if not isinstance(to, str) or "@" not in to:
            raise _bad_setting("fallback email needs an address in \"to\"")
        return {"type": "email", "to": to}
    if kind == "webhook":
        dest = value.get("destination")
        if dest not in _destination_names(ctx):
            raise _bad_setting("unknown webhook destination %r" % (dest,))
        out = {"type": "webhook", "destination": dest}
        if value.get("preset") is not None:
            if value["preset"] not in PRESETS:
                raise _bad_setting("unknown preset %r" % (value["preset"],))
            out["preset"] = value["preset"]
        return out
    raise _bad_setting("fallback type must be \"email\" or \"webhook\"")


def put_settings(ctx, body):
    _require_admin(ctx, "change_settings")
    current = {k: v for k, v in (ctx.store.get_settings() or {}).items() if not k.startswith("_")}
    for key, value in body.items():
        if key in INT_SETTINGS:
            top = INT_SETTINGS[key]
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= top:
                raise _bad_setting("%s must be a whole number from 1 to %d" % (key, top))
            current[key] = value
        elif key == "fallback":
            current[key] = _check_fallback(ctx, value)
        elif key == "base_url":
            if value not in (None, "") and not (isinstance(value, str)
                                                and re.match(r"^https?://[^/\s]+", value)):
                raise _bad_setting("base_url must be an http(s) URL")
            current[key] = value or None
        else:
            raise _bad_setting("unknown setting %r" % key)
    ctx.store.save_settings(current)
    ctx.emit({"type": "settings_changed", "keys": sorted(body)})
    return 200, {"settings": _settings_view(current)}


def _destinations(ctx):
    return list((ctx.sys_gw.kv_get(SETTINGS, DESTINATIONS_KEY) or {}).get("destinations") or [])


def _save_destinations(ctx, dests):
    doc = {"_key": DESTINATIONS_KEY, "destinations": dests}
    if not ctx.sys_gw.kv_update(SETTINGS, DESTINATIONS_KEY, doc):
        if not ctx.sys_gw.kv_insert(SETTINGS, doc):
            ctx.sys_gw.kv_update(SETTINGS, DESTINATIONS_KEY, doc)


def _public_destination(dest):
    return {"name": dest.get("name"), "preset": dest.get("preset"), "host": dest.get("host"),
            "has_headers": bool(dest.get("headers_secret_ref"))}


def list_destinations(ctx, body):
    if not (ctx.allowed(authz.can_admin, None) or ctx.allowed(authz.can_edit, None)):
        raise ctx.deny("list_destinations")
    return 200, {"destinations": [_public_destination(d) for d in _destinations(ctx)]}


def save_destination(ctx, body):
    _require_admin(ctx, "manage_destinations")
    name = body.get("name")
    if not isinstance(name, str) or not DEST_NAME_RE.fullmatch(name):
        raise ApiError(400, "bad_destination", "destination name must be 1-64 letters, digits, "
                       "_, . or -")
    url = body.get("url")
    if not isinstance(url, str):
        raise ApiError(400, "bad_destination", "destination needs an https url")
    try:
        check_webhook_url(url)
    except GatewayError as err:
        raise ApiError(400, "bad_destination", str(err))
    headers = body.get("headers", ...)
    if headers not in (..., None) and not (isinstance(headers, dict) and all(
            isinstance(k, str) and isinstance(v, str) for k, v in headers.items())):
        raise ApiError(400, "bad_destination", "headers must be an object of strings")
    preset = body.get("preset") or "generic"
    if preset not in PRESETS:
        raise ApiError(400, "bad_destination", "unknown preset %r" % (preset,))
    dests = _destinations(ctx)
    old = next((d for d in dests if d.get("name") == name), {})
    url_ref = "destination_%s_url" % name
    ctx.sys_gw.write_secret(url_ref, url)
    headers_ref = old.get("headers_secret_ref")
    if headers is not ...:
        if headers_ref and not headers:
            ctx.sys_gw.delete_secret(headers_ref)
        headers_ref = None
        if headers:
            headers_ref = "destination_%s_headers" % name
            ctx.sys_gw.write_secret(headers_ref, json.dumps(headers, sort_keys=True))
    dest = {"name": name, "url_secret_ref": url_ref, "headers_secret_ref": headers_ref,
            "preset": preset, "host": urlsplit(url).hostname}
    dests = [d for d in dests if d.get("name") != name] + [dest]
    _save_destinations(ctx, dests)
    ctx.emit({"type": "destination_saved", "destination": name, "host": dest["host"],
              "created": not old})
    return 201, {"destination": _public_destination(dest)}


def delete_destination(ctx, body, name):
    _require_admin(ctx, "manage_destinations")
    dests = _destinations(ctx)
    if not any(d.get("name") == name for d in dests):
        raise ApiError(404, "not_found", "no destination %r" % name)
    fallback = (ctx.store.get_settings() or {}).get("fallback") or {}
    if fallback.get("type") == "webhook" and fallback.get("destination") == name:
        raise ApiError(409, "destination_in_use", "destination %r is the fallback notification "
                       "destination; change the fallback first" % name)
    dest = next(d for d in dests if d.get("name") == name)
    for ref in (dest.get("url_secret_ref"), dest.get("headers_secret_ref")):
        if not ref:
            continue
        try:
            ctx.sys_gw.delete_secret(ref)
        except GatewayError as err:  # the doc entry stays, so the delete can be retried
            ctx.emit({"type": "destination_secret_delete_failed", "destination": name,
                      "error": "HTTP %s" % err.status if err.status else type(err).__name__})
            raise ApiError(502, "secret_delete_failed", "could not delete the stored secrets of "
                           "destination %r; it was kept, try again" % name)
    _save_destinations(ctx, [d for d in dests if d.get("name") != name])
    ctx.emit({"type": "destination_deleted", "destination": name})
    return 200, {"deleted": name}


# Health and the caller.

def health(ctx, body):
    if not any(c.startswith("orchestrator_") for c in ctx.access["capabilities"]):
        raise ctx.deny("read_health")
    settings = ctx.store.get_settings() or {}
    fb = settings.get("fallback") or {}
    fallback_set = bool((fb.get("type") == "email" and fb.get("to")) or
                        (fb.get("type") == "webhook" and fb.get("destination") in
                         _destination_names(ctx)))
    lease = ctx.sys_gw.kv_get(LOCKS, LEASE_KEY)
    heartbeat = int(lease["expires"]) - LEASE_SECONDS if lease and lease.get("expires") else None
    alive = bool(lease) and int(lease.get("expires") or 0) > ctx.now
    index_present = ctx.sys_gw.index_exists(AUDIT_INDEX)
    messages = []
    if not index_present:
        messages.append("The %s index is missing, so audit events are being lost." % AUDIT_INDEX)
    if not alive:
        messages.append("The engine is not running: no run will advance.")
    if not fallback_set:
        messages.append("No fallback notification destination is set, so a job with no failure "
                        "or delay action fails silently.")
    pending = len(ctx.sys_gw.kv_query(COMMANDS))
    return 200, {"health": {"index_present": index_present, "engine_alive": alive,
                            "engine_heartbeat": heartbeat, "fallback_set": fallback_set,
                            "pending_commands": pending, "messages": messages,
                            "audit_index": AUDIT_INDEX}}


def me(ctx, body):
    caps = sorted(c for c in ctx.access["capabilities"] if c.startswith("orchestrator_"))
    return 200, {"user": ctx.user, "roles": list(ctx.access["roles"]), "capabilities": caps,
                 "can_admin": ctx.allowed(authz.can_admin, None),
                 "can_build": ctx.allowed(authz.can_edit, None),
                 "can_run": authz.RUN in caps or ctx.allowed(authz.can_admin, None)}


# Preview.

SKIP_REASONS = {
    "run_when": "its run when condition doesn't match at this time",
    "not_taken": "none of the edges into it would be taken"}
POLL_FIELDS = ("state", "result_count", "error", "truncated", "run_duration", "messages")
_UPSTREAM = ("state", "skip_kind", "sid", "result_count", "first")
RUN_ENDED = ("succeeded", "failed", "skipped")  # step states a preview can read from a run


def _preview_target(ctx, body):
    """``(job, job_ref)`` for a preview request once the caller may edit the job:
    the stored job if its id exists and the caller may see it, else as a new job."""
    definition = body.get("job")
    if not isinstance(definition, dict):
        raise ApiError(400, "bad_request", "job must be a job definition object")
    job_id = definition.get("id")
    job_ref = job_id if isinstance(job_id, str) and _is_job_id(job_id) else "new"
    stored = ctx.store.get_job(job_id) if job_ref == job_id else None
    if stored is not None and not ctx.allowed(authz.can_view, stored):
        stored = None  # as if new: never reveal that the id is taken
    if not ctx.allowed(authz.can_edit, stored):
        raise ctx.deny("preview_job", job_id=job_ref)
    return _prepare(definition, job_ref, ctx.user), job_ref


def _invalid(issues):
    return ApiError(400, "invalid", "the step or a step it depends on has errors", issues)


def _blocks_every_preview(message, issues):
    return ApiError(400, "invalid", "%s; fix it before previewing" % message, issues)


def _preview_scope(job, step_id):
    """The steps ``step_id`` reads, after checking the step, those steps, the edges into
    them, the params and the time zone. Errors elsewhere (other steps and edges, the
    schedule, actions) don't block a preview, except two anywhere in the job, since
    finding the steps a step reads needs a well-formed job whose edges form a DAG: a
    malformed job (``bad_shape``) and a dependency cycle. Both are 400 ``invalid`` with a
    message naming the problem ("the job has a cycle: a → b → a; fix it before
    previewing")."""
    shape = [i for i in _errors(model.validate_job(job)) if i.get("code") == "bad_shape"]
    if shape:
        raise _blocks_every_preview("the job is malformed: %s" % shape[0]["message"], shape)
    if step_id not in [s.get("id") for s in job.get("steps") or []]:
        raise ApiError(400, "unknown_step", "the job has no step %r" % (step_id,))
    cycle = model.find_cycle(job)
    if cycle:
        message = "the job has a cycle: %s" % " → ".join(cycle)
        raise _blocks_every_preview(message, [_issue("error", "cycle", message)])
    scope = preview.closure(job, step_id)
    keep = set(scope) | {step_id}
    part = dict(job, steps=[s for s in job.get("steps") or [] if s.get("id") in keep],
                edges=[e for e in job.get("edges") or [] if e.get("to") in keep], triggers=[])
    found = _errors(model.validate_job(part))
    if found:
        raise _invalid(found)
    return scope


def _preview_params(job, body):
    params = body.get("params") or {}
    if not isinstance(params, dict):
        raise ApiError(400, "bad_request", "params must be an object")
    try:
        return scheduler.validate_params(job, params)
    except tokens.TokenError as err:
        message = "parameter %s: %s" % (err.token, err.reason)
        raise ApiError(400, "bad_param", message, [_issue("error", "bad_param", message)])


def _touch(ctx, sid):
    try:
        ctx.user_gw.control(sid, "touch")
    except GatewayError:  # the TTL is only extended; the next poll reports a gone job
        pass


def _live_state(ctx, job, job_ref, up, entry, fields):
    """One upstream step's state from the caller's live preview, or None (needs one)."""
    if not isinstance(entry, dict):
        return None
    if entry.get("skipped") in SKIP_REASONS:
        return {"state": "skipped", "skip_kind": entry["skipped"]}
    sid = entry.get("sid")
    if not preview.own_sid(sid, ctx.user, job_ref, up):
        return None  # checked before splunkd is asked anything about the sid
    info = ctx.user_gw.preview_info(sid)
    if not preview.own_preview(info, sid, ctx.user, job_ref, up):
        return None
    kind = next((s.get("type") for s in job["steps"] if s.get("id") == up), None)
    if info.get("state") == "failed" or (info.get("state") == "done" and kind == "previous"
                                         and info.get("truncated")):
        return {"state": "failed", "sid": sid}
    if info.get("state") != "done":
        return None
    count = int(info.get("result_count") or 0)
    first = None
    if fields and count > 0:
        row = ctx.user_gw.first_row(sid)
        if row:
            first = {f: _scalar(row.get(f)) for f in sorted(fields)}
    _touch(ctx, sid)
    return {"state": "succeeded", "sid": sid, "result_count": count, "first": first}


def _scalar(value):
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _live_upstream(ctx, job, job_ref, scope, previews, scheduled, params):
    """Upstream states from the caller's live previews. Each upstream step is decided again
    (``state.preview_decision``, in topological order, from the states before it): a step a
    run would skip is skipped downstream whatever the client sends, even with a sid from
    Preview anyway. A step a run would not reach past a failure is ``upstream_failed``."""
    if not isinstance(previews, dict):
        raise ApiError(400, "bad_request", "input previews must be an object")
    wanted = first_fields(job)
    upstream, needs = {}, []
    for up in scope:
        if not needs:
            decision, detail = _decide(job, up, scheduled, params, upstream)
            if decision == "skipped":
                upstream[up] = {"state": "skipped", "skip_kind": detail}
                continue
            if decision == "needs":
                raise _needs(upstream, detail.split(","))
            entry = previews.get(up)
            if isinstance(entry, dict) and "skipped" in entry:
                needs.append(up)  # a run would run it, so a client claim of skipped is stale
                continue
        st = _live_state(ctx, job, job_ref, up, previews.get(up), wanted.get(up))
        if st is None:
            needs.append(up)
        else:
            upstream[up] = st
    if needs:
        raise ApiError(409, "needs_preview", "preview %s first" % ", ".join(needs), steps=needs)
    return upstream


def _run_upstream(ctx, job, step_id, scope, run_id):
    """Upstream states recorded by a past run of the job, whose results the step reads
    must still exist."""
    if not scheduler.is_run_id(run_id):
        raise ApiError(404, "not_found", "no run %r" % (run_id,))
    run = _visible_run(ctx, run_id)
    if run.get("job_id") != job["id"]:
        raise ApiError(404, "not_found", "no run %r" % run_id)
    if not ctx.allowed(authz.can_edit, _run_job(ctx, run)):
        raise ctx.deny("preview_job", job_id=job["id"], run_id=run_id)
    steps = run.get("steps") or {}
    upstream = {up: {k: (steps.get(up) or {}).get(k) for k in _UPSTREAM}
                for up in scope if steps.get(up)}
    for up in preview.reads(job, step_id):
        if (upstream.get(up) or {}).get("state") not in RUN_ENDED:
            raise ApiError(409, "run_step_missing", "%s has no result in that run; switch to "
                           "live previews or pick another run" % up, step=up)
    for up in preview.reads(job, step_id):
        st = upstream.get(up) or {}
        if st.get("state") == "succeeded" and st.get("sid"):
            _check_run_result(ctx, up, st["sid"])
    return upstream


def _check_run_result(ctx, up, sid):
    """The caller may read step ``up``'s result ``sid`` from a past run: else 410
    ``run_results_expired`` when splunkd no longer has the job, or 403
    ``run_results_forbidden`` when it refuses the caller. splunkd answers 404 for a job
    it won't show the caller as well as for a gone one, so a 404 is checked again with
    the system session (it only learns whether a sid the run recorded still exists)."""
    forbidden = ApiError(403, "run_results_forbidden", "you may not read %s's results from "
                         "that run; only its owner or an admin can" % up, step=up)
    try:
        info = ctx.user_gw.preview_info(sid)
    except GatewayError as err:
        if err.status == 403:
            raise forbidden
        raise
    if (info or {}).get("state") != "missing":
        return
    if (ctx.sys_gw.preview_info(sid) or {}).get("state") != "missing":
        raise forbidden
    raise ApiError(410, "run_results_expired", "%s's results from that run have expired; "
                   "switch to live previews or pick a newer run" % up, step=up)


def _preview_upstream(ctx, job, job_ref, step_id, scope, source, scheduled, params):
    source = source or {"mode": "live"}
    if not isinstance(source, dict) or source.get("mode") not in ("live", "run"):
        raise ApiError(400, "bad_request", "input mode must be \"live\" or \"run\"")
    if source["mode"] == "run":
        return _run_upstream(ctx, job, step_id, scope, source.get("run_id"))
    return _live_upstream(ctx, job, job_ref, scope, source.get("previews") or {}, scheduled,
                          params)


def _input_mode(source):
    return source.get("mode") if isinstance(source, dict) else "live"


def _decide(job, step_id, scheduled, params, upstream):
    try:
        return statemod.preview_decision(job, step_id, scheduled, params, upstream)
    except (ValueError, TypeError) as err:  # a run would fail the step the same way
        raise _invalid([_issue("error", "bad_run_when", "run_when: %s" % err, step_id)])


def _needs(upstream, steps, mode="live"):
    """A run would not reach the step: a failed step behind an on_success edge is
    ``upstream_failed``, the same in both input modes (only the advice differs)."""
    failed = [s for s in steps if (upstream.get(s) or {}).get("state") == "failed"]
    if failed:
        advice = ("pick another run or switch to live previews" if mode == "run"
                  else "fix it or preview it again")
        return ApiError(409, "upstream_failed", "%s failed, so a run would not reach this "
                        "step; %s" % (failed[0], advice), step=failed[0])
    return ApiError(409, "needs_preview", "preview %s first" % ", ".join(steps), steps=steps)


def _preview_search(ctx, job, step, scheduled, params, upstream):
    """``(spl, earliest, latest)``: the search a run of ``step`` would run, as the caller."""
    if step.get("type") == "saved_search":
        spl, issues = hidden.saved_search_spl(ctx.user_gw, ctx.user, step)
        if spl is None:
            raise _invalid(issues)
        return spl, step.get("earliest") or None, step.get("latest") or None
    ids = [s.get("id") for s in job.get("steps") or []]
    try:
        spl = preview.step_search(step, ids,
                                  preview.token_context(job, scheduled, params, upstream),
                                  preview.input_sids(job, step["id"], upstream))
    except tokens.TokenError as err:
        raise _invalid([_issue("error", "bad_token", "token %s: %s" % (err.token, err.reason),
                               step["id"])])
    if step.get("type") == "previous":
        return spl, None, None
    return spl, step.get("earliest") or None, step.get("latest") or None


def preview_defaults(ctx, body):
    job, _ = _preview_target(ctx, body)
    try:
        scheduled = preview.default_time(job, ctx.now)
    except (ValueError, TypeError):
        scheduled = ctx.now
    return 200, {"scheduled_time": int(scheduled)}


def start_preview(ctx, body):
    job, job_ref = _preview_target(ctx, body)
    step_id = body.get("step_id")
    scope = _preview_scope(job, step_id)
    params = _preview_params(job, body)
    scheduled = _scheduled_time(ctx, body)
    upstream = _preview_upstream(ctx, job, job_ref, step_id, scope, body.get("input"),
                                 scheduled, params)
    decision, detail = _decide(job, step_id, scheduled, params, upstream)
    if decision == "needs":
        raise _needs(upstream, detail.split(","), _input_mode(body.get("input")))
    anyway = decision == "skipped" and body.get("anyway") is True
    if decision == "skipped" and not anyway:
        return 200, {"status": "skipped", "skip_kind": detail, "reason": SKIP_REASONS[detail]}
    step = next(s for s in job["steps"] if s.get("id") == step_id)
    spl, earliest, latest = _preview_search(ctx, job, step, scheduled, params, upstream)
    sid = preview.make_sid(ctx.user, job_ref, step_id, uuid.uuid4().hex[:16])
    sid = ctx.user_gw.preview_dispatch(ctx.user, spl, earliest, latest, scheduled, sid)
    ctx.emit({"type": "preview_dispatched", "job_id": job_ref, "step_id": step_id, "sid": sid})
    out = {"status": "started", "sid": sid, "spl": spl}
    if anyway:
        out["anyway"] = True
    return 201, out


def _own_preview(ctx, sid, gone_ok=False):
    """``preview_info`` of the caller's own preview ``sid``; anything else is 404. With
    ``gone_ok``, a sid that passes ``own_sid`` but that splunkd no longer has returns its
    ``missing`` info instead (the sid names the caller, so this reveals nothing)."""
    parts = preview.parts(sid)
    if parts is None:  # a malformed sid (the route checks it too) is not the caller's
        raise ApiError(404, "not_found", "no preview %r" % sid)
    _, job_ref, step_id, _ = parts
    if not preview.own_sid(sid, ctx.user, job_ref, step_id):
        raise ApiError(404, "not_found", "no preview %r" % sid)
    info = ctx.user_gw.preview_info(sid)
    if gone_ok and (info or {}).get("state") == "missing":
        return info
    if not preview.own_preview(info, sid, ctx.user, job_ref, step_id):
        raise ApiError(404, "not_found", "no preview %r" % sid)
    return info


def _preview_limit(body):
    """Seconds a preview may run: the step's ``limit``, at most ``preview.MAX_RUNTIME``."""
    value = body.get("limit")
    if value is None or value == "":
        return preview.MAX_RUNTIME
    try:
        if isinstance(value, bool):
            raise ValueError
        limit = int(float(value))
    except (TypeError, ValueError):
        raise ApiError(400, "bad_request", "limit must be a number of seconds")
    if limit < 1:
        raise ApiError(400, "bad_request", "limit must be a number of seconds")
    return min(limit, preview.MAX_RUNTIME)


def poll_preview(ctx, body, sid):
    info = _own_preview(ctx, sid, gone_ok=True)
    limit = _preview_limit(body)
    if info.get("state") == "missing":
        return 200, {k: info.get(k) for k in POLL_FIELDS}
    out = {k: info.get(k) for k in POLL_FIELDS}
    duration = info.get("run_duration")
    if info.get("state") == "running" and duration is not None and float(duration) > limit:
        ctx.user_gw.control(sid, "cancel")
        minutes = "%g" % (limit / 60.0)
        out.update(state="failed", error="Preview stopped after %s minute%s"
                   % (minutes, "" if minutes == "1" else "s"))
    else:
        _touch(ctx, sid)
    return 200, out


def preview_rows(ctx, body, sid):
    info = _own_preview(ctx, sid)
    found = ctx.user_gw.preview_results(sid, preview.TABLE_ROWS)
    return 200, {"fields": list(found.get("fields") or []),
                 "rows": list(found.get("rows") or [])[:preview.TABLE_ROWS],
                 "total": int(info.get("result_count") or 0)}


def cancel_preview(ctx, body, sid):
    _own_preview(ctx, sid)
    ctx.user_gw.control(sid, "cancel")
    return 200, {"cancelled": True}


# Self-test.

def _bounded_int(body, key, default, top):
    value = body.get(key)
    if value is None or value == "":
        return default
    try:
        if isinstance(value, bool):
            raise ValueError
        out = int(value)
    except (TypeError, ValueError):
        raise ApiError(400, "bad_request", "%s must be a whole number" % key)
    if not 1 <= out <= top:
        raise ApiError(400, "bad_request", "%s must be from 1 to %d" % (key, top))
    return out


def _save_selftest_job(ctx, job_id, definition):
    body = dict(definition, id=job_id)
    if ctx.store.get_job(job_id) is None:
        create_job(ctx, body)
    else:
        update_job(ctx, body, job_id)
    return ctx.store.get_job(job_id)


def run_selftest(ctx, body):
    _require_admin(ctx, "run_selftest")
    scenario = body.get("scenario") or "basic"
    if scenario == "probe":
        job = _save_selftest_job(ctx, *selftest.scenario_job("basic"))
        write = getattr(ctx.audit, "write", None) or ctx.audit.emit
        checks = selftest.probe(ctx.user, ctx.user_gw, ctx.sys_gw, write, job,
                                clock=ctx.deps.get("clock") or time.time,
                                sleep=ctx.deps.get("sleep") or time.sleep,
                                secrets=ctx.deps.get("secrets") or ())
        ctx.emit({"type": "selftest", "scenario": scenario,
                  "failed": [c["check"] for c in checks if not c["ok"]]})
        return 200, {"scenario": scenario, "checks": checks}
    slow_n = _bounded_int(body, "slow_n", selftest.DEFAULT_SLOW_N, selftest.SLOW_N_MAX)
    delayed_after = _bounded_int(body, "delayed_after", selftest.DEFAULT_DELAYED_AFTER,
                                 selftest.DELAYED_AFTER_MAX)
    try:
        job_id, definition = selftest.scenario_job(scenario, slow_n, delayed_after)
    except ValueError as err:
        raise ApiError(400, "bad_request", str(err))
    if body.get("scheduled_time") in (None, ""):
        scheduled = selftest.default_scheduled_time(scenario, ctx.now)
    else:
        scheduled = _scheduled_time(ctx, body)
    job = _save_selftest_job(ctx, job_id, definition)
    _, out = start_run(ctx, {"scheduled_time": scheduled}, job_id)
    ctx.emit({"type": "selftest", "scenario": scenario, "job_id": job_id,
              "run_id": out["run_id"]})
    reply = {"scenario": scenario, "job_id": job_id, "run_id": out["run_id"],
             "scheduled_time": scheduled}
    ahead = _queued_behind(ctx, job, out["run_id"])
    if ahead is not None:
        reply["queued_behind"] = ahead
    return 201, reply


def _queued_behind(ctx, job, run_id):
    """``{"run_id", "state"}`` of the active run of ``job`` that keeps the new run
    ``run_id`` queued (one run per job at a time), or None. The self-test jobs use
    ``after_give_up: continue``, so a failed run never holds their queue."""
    live = [r for r in ctx.store.list_runs({"job_id": job["id"], "state": {"$in": [
        "running", "blocked", "paused"]}}, fields=LIST_FIELDS) if r.get("id") != run_id]
    if not live:
        return None
    oldest = min(live, key=lambda r: int(r.get("created_at") or 0))
    return {"run_id": oldest.get("id"), "state": oldest.get("state")}
