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
* ``previous`` ("From previous steps"): ``mode = "previous"``. Two searches,
  named and hashed like ``inline``: ``hidden_search`` from ``tokens.step_spl``
  (``| loadjob $args.so_input$ <tail>``; the engine fills ``so_input`` with the
  succeeded dependencies' sids) and ``hidden_search_empty`` from
  ``tokens.empty_step_spl`` (``| makeresults | where 1=0 <tail>``), dispatched
  when no dependency succeeded.
* ``saved_search``: the two-mode rule, checked with the user's session through
  ``gateway.saved_search_info``. If the job owner owns it, it is private
  (sharing ``user``) and has ``dispatchAs = owner``: ``mode = "direct"`` and
  ``hidden_search`` is the referenced search itself (never created or
  deleted by the app). Otherwise ``mode = "wrapped"``: a hidden
  ``| savedsearch "<ref>"`` owned by the job owner, with a warning that the
  search's own summary indexing and actions won't run. A search the user
  cannot read is an ``unknown_saved_search`` error. The lookup spans all apps;
  a search this app's context can't see (not saved in this app and not
  shared globally) is a ``saved_search_not_visible`` error.
  With ``read_previous`` the report must read ``$args.so_input$`` (not in a ``` comment, not
  directly in double quotes), else a ``report_missing_input`` or ``report_input_quoted``
  error skips the search; the wrapper then ends with ``args.so_input="$args.so_input$"``.

Action searches
---------------
Actions of type ``email``, ``event`` and ``alert_action`` run as the job
owner through a hidden saved search created here at job save and named by
content, ``action_search_name(job_id, i, action_hash(job_id, i, type, spl))``
(``_so_<job>_action_<i>_<hash8>``), so a run in progress keeps the version its
definition snapshot names (spec section 4). The resolved name is written into
the action as ``hidden_search``; ``actions.py`` snapshots the action into its
row and dispatches exactly that name. It dispatches them with
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
for the job, step and action searches alike (never a direct-mode search).
``apply`` hands the list, including the names about to be created, to its
``record`` callback before any upsert, so the caller can store it first and a
partial failure still leaves every name tracked. ``gc(job, active_runs)``
returns the entries that neither the job nor any active run's definition
snapshot uses; the caller deletes them and drops them from the list.

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
PARAM_NAME_RE = re.compile(r"^[A-Za-z0-9_.]+$")


def action_search_name(job_id, action_index, compiled_hash):
    """``_so_<job>_action_<index>_<hash8>`` for a job's action that runs through a search."""
    return "_so_%s_action_%d_%s" % (job_id, int(action_index), compiled_hash[:8])


def action_hash(job_id, action_index, action_type, spl):
    text = "\0".join(["action", job_id, str(int(action_index)), action_type or "", spl])
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


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
        if not PARAM_NAME_RE.fullmatch(str(k)):
            out.append(_issue("error", "bad_action", "alert action parameter name %r is not "
                              "valid" % (k,), step))
    return out


def not_visible_message(ref):
    return ("Saved search '%s' must be shared globally or saved in the Search Orchestrator "
            "app to be used as a step." % ref)


def _wrapped_warning(ref, owner, step):
    return _issue("warning", "saved_search_wrapped",
                  "Saved search %r is not a private search of %s with dispatchAs = owner, so it "
                  "runs through a hidden | savedsearch wrapper as %s: its own summary indexing "
                  "and actions won't run" % (ref, owner, owner), step)


def _saved_search(gw, owner, step):
    """``(wrapper spl or None, direct, issues)`` for a ``saved_search`` step run as
    ``owner``. ``direct``: the owner's private search with dispatchAs = owner, which a
    run dispatches itself; otherwise the issues include the wrapped warning. On an error
    the spl is None."""
    sid = step.get("id")
    ref = step.get("saved_search_ref") or ""
    info = gw.saved_search_info(owner, ref)
    if not info.get("exists"):
        return None, False, [_issue("error", "unknown_saved_search", "saved search %r was not "
                                    "found, or %s cannot read it" % (ref, owner), sid)]
    if not info.get("visible", True):
        return None, False, [_issue("error", "saved_search_not_visible",
                                    not_visible_message(ref), sid)]
    spl = '| savedsearch "%s"' % tokens.escape_spl_string(ref)
    if step.get("read_previous") is True:
        found = tokens.report_input_issue(ref, info.get("search"))
        if found:
            return None, False, [_issue("error", found[0], found[1], sid)]
        spl += ' args.%s="$args.%s$"' % (tokens.INPUT_ARG, tokens.INPUT_ARG)
    if (info.get("owner") == owner and info.get("sharing") == "user"
            and info.get("dispatch_as") == "owner"):
        return spl, True, []
    return spl, False, [_wrapped_warning(ref, owner, sid)]


def saved_search_spl(gw, owner, step):
    """``(spl, issues)``: the ``| savedsearch "<ref>"`` wrapper a ``saved_search`` step
    runs through as ``owner`` (previews use it even for a search a run dispatches
    directly), or ``(None, errors)`` if ``owner`` can't use the search. Shares ``plan``'s
    checks."""
    spl, _, issues = _saved_search(gw, owner, step)
    return spl, issues


def plan(gw, job):
    """``(job, searches, issues)`` without writing anything.

    ``job`` is a copy with ``steps[i].hidden_search`` and ``mode`` (and, for
    ``previous`` steps, ``hidden_search_empty``) filled in, and without ``earliest`` or
    ``latest`` on ``previous`` steps;
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
        step.pop("hidden_search_empty", None)  # only ever set here, never from the request
        if step.get("type") == "previous":
            # It reads its inputs with loadjob: a time range (say, left from an earlier
            # type) would only reach the dispatch.
            step.pop("earliest", None)
            step.pop("latest", None)
        earliest, latest = step.get("earliest") or "", step.get("latest") or ""
        if step.get("type") == "saved_search":
            spl, direct, found = _saved_search(gw, owner, step)
            issues.extend(found)
            if spl is None:
                continue
            if direct:
                step.update(mode="direct", hidden_search=step.get("saved_search_ref") or "")
                continue
            mode = "wrapped"
        else:
            spl, _ = tokens.step_spl(step, ids)
            mode = "previous" if step.get("type") == "previous" else "inline"
        name = names.step_search_name(job_id, sid, step_hash(job_id, sid, spl, earliest, latest))
        step.update(mode=mode, hidden_search=name)
        searches.append({"owner": owner, "name": name, "search": spl, "earliest": earliest,
                         "latest": latest,
                         "description": "Search Orchestrator job %s, step %s" % (job_id, sid)})
        if mode == "previous":
            empty, _ = tokens.empty_step_spl(step, ids)
            name = names.step_search_name(job_id, sid,
                                          step_hash(job_id, sid, empty, earliest, latest))
            step["hidden_search_empty"] = name
            searches.append({"owner": owner, "name": name, "search": empty,
                             "earliest": earliest, "latest": latest,
                             "description": "Search Orchestrator job %s, step %s (no inputs)"
                                            % (job_id, sid)})
    for index, step_id, action in _indexed(job):
        action.pop("hidden_search", None)  # only ever set here, never from the request
        if action.get("type") not in SEARCH_ACTIONS:
            continue
        found = _action_issues(action, step_id)
        issues.extend(found)
        if found:
            continue
        spl = action_spl(action)
        name = action_search_name(job_id, index, action_hash(job_id, index, action["type"], spl))
        action["hidden_search"] = name
        searches.append({"owner": owner, "name": name,
                         "search": spl, "earliest": ACTION_EARLIEST,
                         "latest": ACTION_LATEST,
                         "description": "Search Orchestrator job %s, %s action %d"
                                        % (job_id, action.get("type"), index)})
    return job, searches, issues


def apply(gw, planned, searches, previous, record=None):
    """Create ``plan``'s ``searches`` with the user's session ``gw``. The tracked list
    (previous entries plus every planned name) goes to ``record(tracked)`` before the
    first upsert. Returns ``planned`` with its ``hidden_searches`` set."""
    tracked = [dict(e) for e in ((previous or {}).get("hidden_searches") or [])]
    for s in searches:
        entry = {"owner": s["owner"], "name": s["name"]}
        if entry not in tracked:
            tracked.append(entry)
    if record is not None:
        record(tracked)
    for s in searches:
        gw.upsert_saved_search(s["owner"], s["name"], s["search"], s["earliest"], s["latest"],
                               s["description"])
    planned = dict(planned, hidden_searches=tracked)
    return planned


def sync(gw, job, previous, issues=None, record=None):
    """Create the job's hidden searches with the user's session ``gw``; return the job
    with ``hidden_search``/``mode`` per step and action and the updated
    ``hidden_searches`` list. Issues found (warnings, or errors that skip a search)
    are appended to ``issues``."""
    planned, searches, found = plan(gw, job)
    if issues is not None:
        issues.extend(found)
    return apply(gw, planned, searches, previous, record)


def used(definition, owner):
    """``{(owner, name)}`` of the app-created searches a definition dispatches."""
    out = set()
    for step in definition.get("steps") or []:
        if step.get("hidden_search") and step.get("mode") != "direct":
            out.add((owner, step["hidden_search"]))
        if step.get("hidden_search_empty"):
            out.add((owner, step["hidden_search_empty"]))
    for _, _, action in _indexed(definition):
        if action.get("type") in SEARCH_ACTIONS and action.get("hidden_search"):
            out.add((owner, action["hidden_search"]))
    return out


def gc(job, active_runs):
    """Tracked hidden searches no longer needed by ``job`` or any of ``active_runs``."""
    keep = used(job, job.get("owner"))
    for run in active_runs or []:
        keep |= used(run.get("definition") or {}, run.get("owner"))
    return [dict(e) for e in job.get("hidden_searches") or []
            if (e.get("owner"), e.get("name")) not in keep]
