"""Hidden saved searches the app owns (spec sections 5 and 9).

``sync(gateway_as_user, job, previous)`` runs at job save with the saving
user's own session (the job owner: an admin saving another's job has become
its owner). Saved searches are created in the owner's namespace, so they are
private, with ``is_visible = 0``. ``is_scheduled`` and ``dispatchAs`` are never
sent: a restricted user gets HTTP 400 for them (Milestone 1), and a private
search created with the owner's own session already dispatches as the owner.

Step searches (``steps[i]``, written into the job definition):

* ``inline``: ``mode = "inline"``. The SPL is compiled with
  ``tokens.compile_spl`` and saved as ``names.step_search_name`` with a hash
  of the job and step IDs, compiled SPL, earliest and latest, so old and new
  versions coexist while runs still use them.
* ``saved_search``: the two-mode rule, checked with the user's session through
  ``gateway.saved_search_info``. If the job owner owns it, it is private
  (sharing ``user``) and has ``dispatchAs = owner``: ``mode = "direct"`` and
  ``hidden_search`` is the referenced search itself (never created or
  deleted by the app). Otherwise ``mode = "wrapped"``: a hidden
  ``| savedsearch "<ref>"`` owned by the job owner, with a warning that the
  search's own summary indexing and actions won't run. A search the user
  cannot read is an ``unknown_saved_search`` error.

Action searches
---------------
Actions of type ``email``, ``event`` and ``alert_action`` run as the job
owner through a hidden saved search named ``action_search_name(job_id, i)``,
created here at job save. The engine (``actions.py``) dispatches them with
``trigger_actions=0`` and ``dispatch.now`` set to the run's scheduled time.
The SPL reads these ``args.*`` (every value is escaped as an SPL string with
``tokens.escape_spl_string``, so each sits inside double quotes):

* ``email``: ``to``, ``subject``, ``message``  (for ``sendemail``)
* ``event``: ``index``, ``payload``  (a JSON string, for ``collect``)
* ``alert_action``: ``action`` (the alert action name, for ``sendalert``) and
  one ``param.<name>`` per configured parameter. An action with no
  parameters gets only ``action``.

Every type also gets the context args ``job``, ``run_id``, ``hook``,
``step`` (the step id, empty for job-level hooks) and ``run_url`` (a
relative link to the run page).

Action index: ``i`` counts the job's actions in one flat list, job-level
actions first (the order of ``job["actions"]``), then each step's
``actions`` in step order, exactly as ``actions.indexed_actions``.

Garbage collection
------------------
``job["hidden_searches"]`` lists every ``{"owner", "name"}`` the app created
for the job (never a direct-mode search). ``gc(job, active_runs)`` returns the
entries that neither the job nor any active run's definition snapshot uses;
the caller deletes them and drops them from the list.

Fallback email
--------------
``FALLBACK_EMAIL_SEARCH`` (``_so_fallback_email``) is system-owned, shipped as
a static stanza in ``default/savedsearches.conf`` and dispatched under owner
``nobody``. It reads ``args.to``, ``args.subject`` and ``args.message``.
"""
import copy
import hashlib
import re

from . import names, tokens

FALLBACK_EMAIL_SEARCH = "_so_fallback_email"
FALLBACK_OWNER = "nobody"
SEARCH_ACTIONS = ("email", "event", "alert_action")
ACTION_EARLIEST = "-1m"
ACTION_LATEST = "now"
_ALERT_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
_PARAM_NAME_RE = re.compile(r"^[A-Za-z0-9_.]+$")


def action_search_name(job_id, action_index):
    """``_so_<job>_action_<index>`` for a job's action that runs through a search."""
    return "_so_%s_action_%d" % (job_id, int(action_index))


def step_hash(job_id, step_id, compiled_spl, earliest, latest):
    text = "\0".join([job_id, step_id, compiled_spl, earliest or "", latest or ""])
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _issue(level, code, message, step=None):
    return {"level": level, "code": code, "message": message, "step": step}


def _indexed(job):
    """``[(index, step_id, action)]`` numbered by ``actions.indexed_actions``."""
    from .actions import indexed_actions  # actions imports this module
    return [(i, step_id, action) for i, _, step_id, action in indexed_actions(job)]


def action_spl(action):
    """The hidden search SPL for an email, event or alert_action action."""
    kind = action.get("type")
    if kind == "email":
        return ('| makeresults | sendemail to="$args.to$" subject="$args.subject$" '
                'message="$args.message$"')
    if kind == "event":
        return ('| makeresults | eval _raw="$args.payload$" | fields _raw _time '
                '| collect index="$args.index$"')
    params = "".join(' param.%s="$args.param.%s$"' % (k, k)
                     for k in sorted((action.get("params") or {}).keys()))
    return "| makeresults | sendalert $args.action$%s" % params


def _action_issues(action, step):
    if action.get("type") != "alert_action":
        return []
    out = []
    if not _ALERT_NAME_RE.fullmatch(str(action.get("action") or "")):
        out.append(_issue("error", "bad_action", "alert action name %r is not valid"
                          % (action.get("action"),), step))
    for k in (action.get("params") or {}):
        if not _PARAM_NAME_RE.fullmatch(str(k)):
            out.append(_issue("error", "bad_action", "alert action parameter name %r is not "
                              "valid" % (k,), step))
    return out


def _wrapped_warning(ref, owner, step):
    return _issue("warning", "saved_search_wrapped",
                  "Saved search %r is not a private search of %s with dispatchAs = owner, so it "
                  "runs through a hidden | savedsearch wrapper as %s: its own summary indexing "
                  "and actions won't run" % (ref, owner, owner), step)


def plan(gw, job):
    """``(job, searches, issues)`` without writing anything.

    ``job`` is a copy with ``steps[i].hidden_search`` and ``mode`` filled in;
    ``searches`` lists the saved searches to create, as
    ``{"owner", "name", "search", "earliest", "latest", "description"}``.
    """
    job = copy.deepcopy(job)
    owner = job.get("owner")
    job_id = job.get("id")
    steps = job.get("steps") or []
    ids = [s.get("id") for s in steps]
    searches, issues = [], []
    for step in steps:
        sid = step.get("id")
        earliest, latest = step.get("earliest") or "", step.get("latest") or ""
        if step.get("type") == "saved_search":
            ref = step.get("saved_search_ref") or ""
            info = gw.saved_search_info(owner, ref)
            if not info.get("exists"):
                issues.append(_issue("error", "unknown_saved_search", "saved search %r was not "
                                     "found, or %s cannot read it" % (ref, owner), sid))
                continue
            if (info.get("owner") == owner and info.get("sharing") == "user"
                    and info.get("dispatch_as") == "owner"):
                step.update(mode="direct", hidden_search=ref)
                continue
            spl = '| savedsearch "%s"' % tokens.escape_spl_string(ref)
            mode = "wrapped"
            issues.append(_wrapped_warning(ref, owner, sid))
        else:
            spl, _ = tokens.compile_spl(step.get("spl") or "", ids)
            mode = "inline"
        name = names.step_search_name(job_id, sid, step_hash(job_id, sid, spl, earliest, latest))
        step.update(mode=mode, hidden_search=name)
        searches.append({"owner": owner, "name": name, "search": spl, "earliest": earliest,
                         "latest": latest,
                         "description": "Search Orchestrator job %s, step %s" % (job_id, sid)})
    for index, step_id, action in _indexed(job):
        if action.get("type") not in SEARCH_ACTIONS:
            continue
        found = _action_issues(action, step_id)
        issues.extend(found)
        if found:
            continue
        searches.append({"owner": owner, "name": action_search_name(job_id, index),
                         "search": action_spl(action), "earliest": ACTION_EARLIEST,
                         "latest": ACTION_LATEST,
                         "description": "Search Orchestrator job %s, %s action %d"
                                        % (job_id, action.get("type"), index)})
    return job, searches, issues


def sync(gw, job, previous, issues=None):
    """Create the job's hidden searches with the user's session ``gw``; return the job
    with ``hidden_search``/``mode`` per step and the updated ``hidden_searches`` list.
    Issues found (warnings, or errors that skip a search) are appended to ``issues``."""
    planned, searches, found = plan(gw, job)
    if issues is not None:
        issues.extend(found)
    tracked = [dict(e) for e in ((previous or {}).get("hidden_searches") or [])]
    for s in searches:
        gw.upsert_saved_search(s["owner"], s["name"], s["search"], s["earliest"], s["latest"],
                               s["description"])
        entry = {"owner": s["owner"], "name": s["name"]}
        if entry not in tracked:
            tracked.append(entry)
    planned["hidden_searches"] = tracked
    return planned


def used(definition, owner):
    """``{(owner, name)}`` of the app-created searches a definition dispatches."""
    out = set()
    job_id = definition.get("id")
    for step in definition.get("steps") or []:
        if step.get("hidden_search") and step.get("mode") != "direct":
            out.add((owner, step["hidden_search"]))
    for index, _, action in _indexed(definition):
        if action.get("type") in SEARCH_ACTIONS:
            out.add((owner, action_search_name(job_id, index)))
    return out


def gc(job, active_runs):
    """Tracked hidden searches no longer needed by ``job`` or any of ``active_runs``."""
    keep = used(job, job.get("owner"))
    for run in active_runs or []:
        keep |= used(run.get("definition") or {}, run.get("owner"))
    return [dict(e) for e in job.get("hidden_searches") or []
            if (e.get("owner"), e.get("name")) not in keep]
