"""Snippets (features-2 spec section 9): clipboard contents shared between builders.

A snippet is the builder's copy format (``{"so_clipboard": 1, steps, edges, job_actions,
triggers, positions}``) with a name and a description, kept in ``so_snippets``. Every
builder (``orchestrator_build`` or admin) can list and read all snippets; only the owner or
an admin changes or deletes one. Snippets hold no secrets because jobs hold none. Content
is checked only for the copy format, step ids and size (``content_issues``); unknown
top-level keys are dropped.
"""
import json
import re
import uuid

from . import authz, model
from .api import ApiError

SNIPPETS = "so_snippets"
MAX_BYTES = 200_000
MAX_STEPS = 100
NAME_MAX = 80
DESCRIPTION_MAX = 500
ID_RE = re.compile(r"^sn[0-9a-f]{12}$")  # api.py repeats this pattern: it cannot import this module
LISTS = ("steps", "edges", "job_actions", "triggers")
KEYS = ("so_clipboard",) + LISTS + ("positions",)
NOT_COPY = "The snippet isn't in the copy format; copy the nodes again"


def content_issues(content):
    """Why ``content`` can't be a snippet, as messages (empty when it can)."""
    if (not isinstance(content, dict) or content.get("so_clipboard") != 1
            or not all(isinstance(content.get(k), list) for k in LISTS)
            or not isinstance(content.get("positions"), dict)
            or not all(isinstance(x, dict) for k in LISTS for x in content[k])
            or not all(isinstance(s.get("actions", []), list) for s in content["steps"])):
        return [NOT_COPY]
    out = []
    for step in content["steps"]:
        sid = step.get("id")
        if not isinstance(sid, str) or not model.STEP_ID_RE.fullmatch(sid) or "__" in sid:
            out.append("Step id %s isn't valid" % (sid,))
    if len(content["steps"]) > MAX_STEPS:
        out.append("A snippet can hold at most 100 steps")
    if len(json.dumps(content)) > MAX_BYTES:
        out.append("A snippet can be at most 200 KB")
    return out


def node_count(content):
    """How many nodes pasting adds, as the builder's ``clipSize``."""
    steps = sum(1 + len(s.get("actions") or []) for s in content["steps"])
    expr = sum(1 for e in content["edges"] if e.get("condition") == "expression")
    return steps + len(content["job_actions"]) + len(content["triggers"]) + expr


def _public(doc, with_content=True):
    out = {k: doc.get(k) for k in ("id", "name", "description", "owner", "created_at",
                                   "updated_at", "node_count")}
    if with_content:
        out["content"] = doc.get("content")
    return out


def _builder(ctx, action):
    caps = ctx.access["capabilities"]
    if authz.BUILD not in caps and authz.ADMIN not in caps:
        raise ctx.deny(action)


def _get(ctx, snippet_id):
    doc = ctx.sys_gw.kv_get(SNIPPETS, snippet_id)
    if doc is None:
        raise ApiError(404, "not_found", "no snippet %r" % snippet_id)
    return doc


def _text(body):
    name, desc = body.get("name"), body.get("description") or ""
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > NAME_MAX:
        raise ApiError(400, "bad_request", "Give the snippet a name of 1 to 80 characters")
    if not isinstance(desc, str) or len(desc) > DESCRIPTION_MAX:
        raise ApiError(400, "bad_request", "Keep the description to 500 characters or fewer")
    return name.strip(), desc


def _unique(ctx, name, own_id=None):
    for row in ctx.sys_gw.kv_query(SNIPPETS, fields="content:0"):
        if row.get("id") != own_id and (row.get("name") or "").lower() == name.lower():
            raise ApiError(409, "snippet_exists",
                           "A snippet named %s already exists; pick another name" % row["name"])


def _fields(ctx, body):
    name, desc = _text(body)
    content = body.get("content")
    found = content_issues(content)
    if found:
        raise ApiError(400, "bad_snippet", found[0], issues=[
            {"level": "error", "code": "bad_snippet", "message": m, "step": None} for m in found])
    _unique(ctx, name)
    content = {k: content[k] for k in KEYS}
    return {"name": name, "description": desc, "content": content, "node_count": node_count(content)}


def list_snippets(ctx, body):
    _builder(ctx, "list_snippets")
    rows = ctx.sys_gw.kv_query(SNIPPETS, sort="name:1", fields="content:0")
    return 200, {"snippets": [_public(r, False) for r in rows]}


def get_snippet(ctx, body, snippet_id):
    _builder(ctx, "read_snippet")
    return 200, {"snippet": _public(_get(ctx, snippet_id))}


def create_snippet(ctx, body):
    _builder(ctx, "create_snippet")
    snippet_id = "sn" + uuid.uuid4().hex[:12]
    doc = dict(_fields(ctx, body), _key=snippet_id, id=snippet_id, owner=ctx.user,
               created_at=ctx.now, updated_at=ctx.now)
    ctx.sys_gw.kv_insert(SNIPPETS, doc)
    ctx.emit({"type": "snippet_saved", "snippet_id": snippet_id, "name": doc["name"], "created": True})
    return 201, {"snippet": _public(doc)}


def _own(ctx, snippet_id, action):
    _builder(ctx, action)
    doc = _get(ctx, snippet_id)
    if doc.get("owner") != ctx.user and authz.ADMIN not in ctx.access["capabilities"]:
        raise ctx.deny(action, snippet_id=snippet_id)
    return doc


def update_snippet(ctx, body, snippet_id):
    doc = dict(_own(ctx, snippet_id, "change_snippet"))
    name, desc = _text(body)  # rename only: any content in the body is ignored
    _unique(ctx, name, snippet_id)
    doc.update(name=name, description=desc, updated_at=ctx.now)
    ctx.sys_gw.kv_update(SNIPPETS, snippet_id, doc)
    ctx.emit({"type": "snippet_saved", "snippet_id": snippet_id, "name": doc["name"], "created": False})
    return 200, {"snippet": _public(doc)}


def delete_snippet(ctx, body, snippet_id):
    doc = _own(ctx, snippet_id, "delete_snippet")
    ctx.sys_gw.kv_delete(SNIPPETS, snippet_id)
    ctx.emit({"type": "snippet_deleted", "snippet_id": snippet_id, "name": doc.get("name")})
    return 200, {"deleted": snippet_id}
