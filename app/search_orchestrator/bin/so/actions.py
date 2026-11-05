"""Action runner STUB. Task 7 owns this module and replaces this stub.

The engine calls ``submit`` for every hook effect from ``state.evaluate`` (and
for the hold and queue-cap alerts) *before* it saves the run that records the
hook in ``hooks_fired``. ``submit`` persists one ``so_action_runs`` row under
the idempotency key ``run_id:scope:hook:step_id:occurrence``, so replaying a
tick after a crash never submits the same hook twice. ``pump(now)`` would
execute pending rows; here it does nothing.

Fallback notification (spec section 10) is not a separate call: every
``on_delayed`` and ``on_failure`` hook reaches ``submit``, so Task 7 decides
there (or in ``pump``) whether the fallback destination is needed. The
evaluator's ``notify_fallback_check`` effects are therefore not forwarded.
"""
import time

ACTION_RUNS = "so_action_runs"


def idempotency_key(run_id, scope, hook, step_id, occurrence):
    return "%s:%s:%s:%s:%s" % (run_id, scope, hook, step_id or "-", occurrence)


class ActionRunner:
    def __init__(self, gateway, store=None, audit=None, clock=time.time):
        self.gw = gateway
        self.store = store
        self.audit = audit
        self.clock = clock

    def submit(self, run, hook, scope, step_id, occurrence=None):
        """Record one hook firing. True if new, False if already submitted.

        ``occurrence`` defaults to the run's ``rerun_count``: a hook fires once
        per run and once more per re-run.
        """
        if occurrence is None:
            occurrence = run.get("rerun_count") or 0
        run_id = run.get("_key") or run.get("id")
        key = idempotency_key(run_id, scope, hook, step_id, occurrence)
        doc = {"_key": key, "run_id": run_id, "job_id": run.get("job_id"), "scope": scope,
               "hook": hook, "step_id": step_id, "occurrence": occurrence,
               "state": "pending", "attempts": 0, "error": None,
               "created_at": int(self.clock())}
        return self.gw.kv_insert(ACTION_RUNS, doc)

    def pump(self, now):
        """Execute pending actions. Stub: Task 7 implements it."""
        return 0
