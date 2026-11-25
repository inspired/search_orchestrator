"""Building blocks an admin can turn off (Settings > Building blocks).

A job is made of node kinds: triggers, steps and actions, as the builder draws them. Search and
Schedule are always on; every other kind can be turned off, for a simpler app where a team does
not use it (approvals, say). A kind that is off is not offered in the builder, and a save that
adds one is refused. Jobs that already use it keep working and can still be saved: turning a
kind off never breaks a running job.

Slack, Microsoft Teams, PagerDuty and ServiceNow are retired (``RETIRED``): Splunk's own apps
for them do the same as an Alert action, so the app no longer offers them. They work like a kind
that is always off: a save that adds one is refused, and a job that has one keeps it.
"""

ALWAYS_ON = ("trigger_cron", "search")
OPTIONAL = ("trigger_completion", "saved_search", "previous", "summary_index", "lookup",
            "approval", "email", "webhook", "event", "alert_action", "start_job")
LABELS = {"trigger_completion": "After another job", "saved_search": "Saved search",
          "previous": "Results of earlier steps", "summary_index": "Summary index",
          "lookup": "Lookup", "approval": "Approval", "email": "Email", "webhook": "Webhook",
          "slack": "Slack", "teams": "Microsoft Teams", "pagerduty": "PagerDuty",
          "servicenow": "ServiceNow", "event": "Event to an index",
          "alert_action": "Alert action", "start_job": "Start another job"}
CHANNEL_PRESETS = ("slack", "teams", "pagerduty", "servicenow")
RETIRED = CHANNEL_PRESETS


def step_kind(step):
    output = step.get("output") if isinstance(step.get("output"), dict) else {}
    if step.get("type") == "approval":
        return "approval"
    if output.get("kind") in ("summary_index", "lookup"):
        return output["kind"]
    if step.get("type") in ("saved_search", "previous"):
        return step["type"]
    return "search"


def action_kind(action):
    kind = action.get("type")
    if kind == "webhook":
        return action.get("preset") if action.get("preset") in CHANNEL_PRESETS else "webhook"
    if kind in ("email", "event", "start_job"):
        return kind
    return "alert_action"


def kinds_of(job):
    """Every node kind the job uses."""
    out = set()
    if not isinstance(job, dict):
        return out
    for t in job.get("triggers") or []:
        if isinstance(t, dict):
            out.add("trigger_cron" if t.get("type") == "cron" else "trigger_completion")
    actions = list(job.get("actions") or [])
    for s in job.get("steps") or []:
        if isinstance(s, dict):
            out.add(step_kind(s))
            actions += list(s.get("actions") or [])
    for a in actions:
        if isinstance(a, dict):
            out.add(action_kind(a))
    return out


def turned_off(settings):
    """The kinds turned off in these settings, in catalog order."""
    off = (settings or {}).get("turned_off") or []
    return [k for k in OPTIONAL if k in off]


def check(value):
    """The stored form of a ``turned_off`` setting, or ValueError."""
    if not isinstance(value, list) or not all(isinstance(k, str) for k in value):
        raise ValueError("turned_off must be a list of building block names")
    value = [k for k in value if k not in RETIRED]  # an old setting may still name one
    unknown = [k for k in value if k not in OPTIONAL]
    if unknown:
        always = [k for k in unknown if k in ALWAYS_ON]
        if always:
            raise ValueError("%s can't be turned off" % ", ".join(always))
        raise ValueError("unknown building block %s" % ", ".join(repr(k) for k in unknown))
    return [k for k in OPTIONAL if k in value]


def issues(job, previous, settings):
    """An error for each turned-off or retired kind the job adds (one it did not use before)."""
    off = set(turned_off(settings))
    added = kinds_of(job) - kinds_of(previous)
    out = [{"level": "error", "code": "block_retired", "step": None,
            "message": "%s actions are no longer offered; use an Alert action with Splunk's own "
                       "%s app instead" % (LABELS[k], LABELS[k])}
           for k in RETIRED if k in added]
    out += [{"level": "error", "code": "block_turned_off", "step": None,
             "message": "%s is turned off in Settings > Building blocks; remove it, or ask "
                        "an admin to turn it on" % LABELS[k]}
            for k in OPTIONAL if k in added & off]
    return out
