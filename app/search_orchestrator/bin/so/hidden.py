"""Hidden saved searches the app owns. Task 8 extends this module (sync, gc).

Only the naming of action searches lives here for now.

Action searches
---------------
Actions of type ``email``, ``event`` and ``alert_action`` run as the job
owner through a hidden saved search named ``action_search_name(job_id, i)``.
Task 8 creates these at job save with the owner's own session. The engine
(``actions.py``) dispatches them with ``trigger_actions=0`` and
``dispatch.now`` set to the run's scheduled time. The SPL belongs to Task 8;
it reads these ``args.*`` (every value is escaped as an SPL string with
``tokens.escape_spl_string``):

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
``actions`` in step order. Task 8 must number them the same way (see
``actions.indexed_actions``).

Fallback email
--------------
``FALLBACK_EMAIL_SEARCH`` (``_so_fallback_email``) is system-owned and
dispatched under owner ``nobody``. It reads ``args.to``, ``args.subject``
and ``args.message``. Task 8 (or app install) creates it.
"""

FALLBACK_EMAIL_SEARCH = "_so_fallback_email"
FALLBACK_OWNER = "nobody"


def action_search_name(job_id, action_index):
    """``_so_<job>_action_<index>`` for a job's action that runs through a search."""
    return "_so_%s_action_%d" % (job_id, int(action_index))
