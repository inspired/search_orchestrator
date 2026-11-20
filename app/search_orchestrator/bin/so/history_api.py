"""Version history routes (spec section 3), dispatched from ``api.handle``.

* ``GET jobs/<job_id>/versions``: ``{"versions": [...]}`` newest first, without
  definitions. Query ``version=<n>``: ``{"version": {..., "definition"}}``. Query
  ``compare=<a>,<b>`` (``b`` a number or ``current``): ``{"from", "to", "changes"}``.
  Anyone who may see the job may read its history; others get 404.
* ``POST jobs/<job_id>/restore`` ``{"version": n}``: saves version ``n`` as a new version
  through ``api.update_job`` (so it is validated, and an admin takes ownership), and
  replies as ``update_job`` does. Audited as ``job_restored``.
"""
from . import authz, history
from .api import ApiError, _visible_job, update_job

NOT_A_VERSION = "version must be a version number"


def _number(value, allow_current=False):
    if allow_current and value == "current":
        return value
    if isinstance(value, bool) or not str(value).strip().isdigit():
        raise ApiError(400, "bad_request", NOT_A_VERSION)
    return int(str(value).strip())


def _stored(ctx, job_id, n):
    doc = history.get_version(ctx.sys_gw, job_id, n)
    if doc is None:
        raise ApiError(404, "not_found", "no version %d of job %r" % (n, job_id))
    return doc


def _definition(ctx, job, n):
    return history.definition_of(job) if n == "current" else _stored(ctx, job["id"], n)["definition"]


def versions(ctx, body, job_id):
    job = _visible_job(ctx, job_id)
    if body.get("version") not in (None, ""):
        return 200, {"version": _stored(ctx, job_id, _number(body["version"]))}
    if body.get("compare") not in (None, ""):
        parts = str(body["compare"]).split(",")
        if len(parts) != 2:
            raise ApiError(400, "bad_request", "compare must be two versions, like 1,current")
        a, b = _number(parts[0]), _number(parts[1], allow_current=True)
        return 200, {"from": a, "to": b,
                     "changes": history.diff(_definition(ctx, job, a), _definition(ctx, job, b))}
    return 200, {"versions": history.list_versions(ctx.sys_gw, job_id)}


def restore(ctx, body, job_id):
    job = _visible_job(ctx, job_id)
    if not ctx.allowed(authz.can_edit, job):
        raise ctx.deny("restore_job", job_id=job_id)
    n = _number(body.get("version"))
    doc = _stored(ctx, job_id, n)
    newest = history.list_versions(ctx.sys_gw, job_id)[0]["version"]
    status, out = update_job(ctx, dict(doc["definition"], id=job_id), job_id, restored_from=n)
    ctx.emit({"type": "job_restored", "job_id": job_id, "from_version": newest, "to_version": n})
    return status, out
