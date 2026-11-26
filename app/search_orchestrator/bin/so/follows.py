"""Following a job: a person asks to be told when a job they may see fails, is late, is
delayed or succeeds, without editing the job's own actions.

One ``so_follows`` document per job and user, keyed by a hash of both::

    {"job_id", "user", "on": ["failure", "late", ...],
     "notify": {"type": "email"},
     "created_at", "updated_at"}

Email goes to the follower's own Splunk account address, read when it is sent, so nobody can
point someone else's job at an address of their choosing; it is sent with the fallback
notification's system search (job name, outcome and run link only, never results). A follow
saved before 1.50.1 with a webhook destination is told by email too.

Routes (``api.py``): ``GET``, ``PUT`` and ``DELETE jobs/<id>/follow`` for the caller's own
follow. The action runner (``actions.py``) adds one ``kind="follow"`` row per matching
follow when a job-level hook fires, and checks at send time that the follower may still see
the job.
"""
import hashlib

FOLLOWS = "so_follows"
# What a follower can ask about, and the job-level hook that fires it.
EVENTS = {"failure": "on_failure", "late": "on_late", "delayed": "on_delayed",
          "success": "on_success"}
HOOK_EVENT = {hook: event for event, hook in EVENTS.items()}
DEFAULT_EVENTS = ["failure", "late"]


def follow_key(job_id, user):
    return hashlib.sha1(("%s\0%s" % (job_id, user)).encode("utf-8")).hexdigest()[:32]


def for_hook(gw, job_id, hook):
    """The follows of ``job_id`` that ask about ``hook`` (a job-level hook)."""
    event = HOOK_EVENT.get(hook)
    if not event:
        return []
    rows = gw.kv_query(FOLLOWS, {"job_id": job_id}) or []
    return [r for r in rows if event in (r.get("on") or [])]


def followed_by(gw, user):
    """The ids of the jobs ``user`` follows."""
    return {r.get("job_id") for r in gw.kv_query(FOLLOWS, {"user": user}, fields="job_id") or []}


def delete_for_job(gw, job_id):
    gw.kv_delete_query(FOLLOWS, {"job_id": job_id})


def _view(doc, email):
    if not doc:
        return None
    return {"on": list(doc.get("on") or []), "notify": dict(doc.get("notify") or {}),
            "created_at": doc.get("created_at"), "updated_at": doc.get("updated_at"),
            "email": email}


def _email(ctx):
    return (ctx.access or {}).get("email") or None


def get_follow(ctx, body, job_id):
    from .api import _visible_job
    _visible_job(ctx, job_id)
    doc = ctx.sys_gw.kv_get(FOLLOWS, follow_key(job_id, ctx.user))
    return 200, {"follow": _view(doc, _email(ctx)), "email": _email(ctx),
                 "events": list(EVENTS), "default_events": DEFAULT_EVENTS}


def put_follow(ctx, body, job_id):
    from .api import ApiError, _visible_job
    _visible_job(ctx, job_id)
    on = body.get("on")
    if (not isinstance(on, list) or not on or not all(e in EVENTS for e in on)
            or len(set(on)) != len(on)):
        raise ApiError(400, "bad_request", "on must list one or more of: %s" % ", ".join(EVENTS))
    notify = body.get("notify") or {"type": "email"}
    if not isinstance(notify, dict) or notify.get("type") != "email":
        raise ApiError(400, "bad_request", "notify must be email (webhook destinations were removed)")
    if not _email(ctx):
        raise ApiError(400, "no_email", "Your Splunk account has no email address. Add one "
                       "in your account settings.")
    notify = {"type": "email"}
    key = follow_key(job_id, ctx.user)
    previous = ctx.sys_gw.kv_get(FOLLOWS, key)
    doc = {"_key": key, "job_id": job_id, "user": ctx.user, "on": [e for e in EVENTS if e in on],
           "notify": notify, "created_at": (previous or {}).get("created_at", ctx.now),
           "updated_at": ctx.now}
    if previous:
        ctx.sys_gw.kv_update(FOLLOWS, key, doc)
    else:
        ctx.sys_gw.kv_insert(FOLLOWS, doc)
    ctx.emit({"type": "job_followed", "job_id": job_id, "on": ",".join(doc["on"]),
              "notify": notify["type"]})
    return 200, {"follow": _view(doc, _email(ctx))}


def delete_follow(ctx, body, job_id):
    from .api import _visible_job
    _visible_job(ctx, job_id)
    key = follow_key(job_id, ctx.user)
    if ctx.sys_gw.kv_get(FOLLOWS, key):
        ctx.sys_gw.kv_delete(FOLLOWS, key)
        ctx.emit({"type": "job_unfollowed", "job_id": job_id})
    return 200, {"follow": None}
