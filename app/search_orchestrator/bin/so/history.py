"""Version history of a job's definition (spec section 3).

Each save that changes a job's definition stores one document in ``so_job_versions``
(key ``<job id>:<n>``). ``diff`` compares two definitions into labelled changes;
``summarize`` turns them into the short lines shown in the version list. The
newest ``MAX_VERSIONS`` of a job are kept.
"""
VERSIONS = "so_job_versions"
MAX_VERSIONS = 50
MAX_SUMMARY = 8
BASELINE = "Saved before version history started"
CREATED = "Created the job"
INSERT_TRIES = 5

_SERVER_FIELDS = ("_key", "_user", "owner", "hidden_searches", "created_at", "created_by",
                  "updated_at", "updated_by")
_LIST_FIELDS = ("steps", "edges", "triggers", "actions", "layout")
_FIELD_LABELS = {"spl": "the search", "earliest": "the time range", "latest": "the time range"}


def definition_of(job):
    return {k: v for k, v in job.items() if k not in _SERVER_FIELDS}


def _change(path, kind, label, before=None, after=None):
    return {"path": path, "kind": kind, "label": label, "before": before, "after": after}


def _kind(before, after):
    return "added" if before is None else "removed" if after is None else "changed"


def _field_label(field):
    return _FIELD_LABELS.get(field) or "the " + field.replace("_", " ")


def _name(step, fallback):
    return (step or {}).get("name") or (step or {}).get("id") or fallback


def _by(items, key):
    return {key(i): i for i in items or [] if isinstance(i, dict)}


def _fields(a, b):
    return [f for f in list(a) + [f for f in b if f not in a] if a.get(f) != b.get(f)]


def _diff_steps(a, b):
    out, before, after = [], _by(a, lambda s: s.get("id")), _by(b, lambda s: s.get("id"))
    for sid, step in after.items():
        if sid not in before:
            out.append(_change("steps." + sid, "added", "Added step " + _name(step, sid), None, step))
    for sid, step in before.items():
        if sid not in after:
            out.append(_change("steps." + sid, "removed", "Removed step " + _name(step, sid), step))
            continue
        name = _name(after[sid], sid)
        for field in _fields(step, after[sid]):
            if field == "actions":
                out += _diff_indexed("steps.%s.actions" % sid, step.get(field), after[sid].get(field),
                                     "Changed the actions of " + name)
                continue
            out.append(_change("steps.%s.%s" % (sid, field), _kind(step.get(field), after[sid].get(field)),
                               "Changed %s of %s" % (_field_label(field), name),
                               step.get(field), after[sid].get(field)))
    return out


def _diff_edges(a, b, names):
    key = lambda e: "%s>%s" % (e.get("from"), e.get("to"))  # noqa: E731
    out, before, after = [], _by(a, key), _by(b, key)

    def line(e):
        return "from %s to %s" % (names.get(e.get("from"), e.get("from")),
                                  names.get(e.get("to"), e.get("to")))
    for k, edge in after.items():
        if k not in before:
            out.append(_change("edges." + k, "added", "Added a line " + line(edge), None, edge))
    for k, edge in before.items():
        if k not in after:
            out.append(_change("edges." + k, "removed", "Removed the line " + line(edge), edge))
            continue
        for field in _fields(edge, after[k]):
            out.append(_change("edges.%s.%s" % (k, field), _kind(edge.get(field), after[k].get(field)),
                               "Changed the line " + line(edge), edge.get(field), after[k].get(field)))
    return out


def _diff_indexed(path, a, b, label, fieldwise=False):
    out, a, b = [], a or [], b or []
    for i in range(max(len(a), len(b))):
        x, y = (a[i] if i < len(a) else None), (b[i] if i < len(b) else None)
        if x == y:
            continue
        if fieldwise and isinstance(x, dict) and isinstance(y, dict):
            out += [_change("%s[%d].%s" % (path, i, f), _kind(x.get(f), y.get(f)), label,
                            x.get(f), y.get(f)) for f in _fields(x, y)]
        else:
            out.append(_change("%s[%d]" % (path, i), _kind(x, y), label, x, y))
    return out


def _diff_layout(a, b):
    a, b = a or {}, b or {}
    na, nb = a.get("nodes") or {}, b.get("nodes") or {}
    moved = sum(1 for k in set(na) | set(nb) if na.get(k) != nb.get(k))
    out = []
    if moved:
        label = "Moved %d node%s" % (moved, "" if moved == 1 else "s")
        out.append(_change("layout", "changed", label, na, nb))
    if a.get("groups") != b.get("groups"):
        out.append(_change("layout.groups", "changed", "Changed groups", a.get("groups"), b.get("groups")))
    return out


def _diff_setting(name, before, after):
    if name == "enabled":
        label = "Turned the job on" if after else "Turned the job off"
    else:
        label = "Changed " + name
    return _change("settings." + name, _kind(before, after), label, before, after)


def diff(a, b):
    """The changes from definition ``a`` to ``b`` (server fields are ignored)."""
    a, b = definition_of(a), definition_of(b)
    names = {s.get("id"): _name(s, s.get("id"))
             for s in list(a.get("steps") or []) + list(b.get("steps") or []) if isinstance(s, dict)}
    out = _diff_steps(a.get("steps"), b.get("steps")) + _diff_edges(a.get("edges"), b.get("edges"), names)
    out += _diff_indexed("triggers", a.get("triggers"), b.get("triggers"), "Changed the schedule", True)
    out += _diff_indexed("actions", a.get("actions"), b.get("actions"), "Changed the actions")
    out += _diff_layout(a.get("layout"), b.get("layout"))
    for name in sorted(n for n in set(a) | set(b) if n not in _LIST_FIELDS and a.get(n) != b.get(n)):
        out.append(_diff_setting(name, a.get(name), b.get(name)))
    return out


def summarize(changes):
    labels = [c["label"] for c in changes]
    if len(labels) <= MAX_SUMMARY:
        return labels
    rest = len(labels) - (MAX_SUMMARY - 1)
    return labels[:MAX_SUMMARY - 1] + ["and %d more changes" % rest]


def _newest(gw, job_id):
    rows = gw.kv_query(VERSIONS, {"job_id": job_id}, sort="version:-1", limit=1)
    return rows[0] if rows else None


def _doc(job_id, n, definition, summary, saved_by, saved_at, restored_from=None):
    doc = {"_key": "%s:%d" % (job_id, n), "job_id": job_id, "version": n, "saved_at": saved_at,
           "saved_by": saved_by, "summary": summary, "definition": definition}
    if restored_from is not None:
        doc["restored_from"] = restored_from
    return doc


def _prune(gw, job_id):
    old = gw.kv_query(VERSIONS, {"job_id": job_id}, sort="version:-1", skip=MAX_VERSIONS,
                      fields="_key")
    for row in old:
        gw.kv_delete(VERSIONS, row["_key"])
    return len(old)


def record(gw, job, user, now, previous, restored_from=None):
    """Store a version when the job's definition changed. Returns ``(version, pruned)``;
    ``version`` is None when nothing changed, or when every version number was taken."""
    job_id = job["id"]
    newest = _newest(gw, job_id)
    if newest is None and previous is not None:
        newest = _doc(job_id, 1, definition_of(previous), [BASELINE], previous.get("updated_by"),
                      previous.get("updated_at") or now)
        gw.kv_insert(VERSIONS, newest)
    definition = definition_of(job)
    if newest is not None and newest["definition"] == definition:
        return None, 0
    summary = summarize(diff(newest["definition"], definition)) if newest else [CREATED]
    n = (newest["version"] if newest else 0) + 1
    for _ in range(INSERT_TRIES):
        doc = _doc(job_id, n, definition, summary or ["Changed the job"], user, now, restored_from)
        if gw.kv_insert(VERSIONS, doc):
            return doc, _prune(gw, job_id)
        n += 1
    return None, 0


def list_versions(gw, job_id):
    return gw.kv_query(VERSIONS, {"job_id": job_id}, sort="version:-1", fields="definition:0")


def get_version(gw, job_id, n):
    return gw.kv_get(VERSIONS, "%s:%d" % (job_id, n))


def delete_all(gw, job_id):
    count = len(gw.kv_query(VERSIONS, {"job_id": job_id}, fields="_key"))
    gw.kv_delete_query(VERSIONS, {"job_id": job_id})
    return count
