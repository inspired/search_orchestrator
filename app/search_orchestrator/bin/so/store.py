"""KV Store-backed store over the so_* collections (spec section 8).

The current step state is embedded in the run document. ``so_step_runs`` keeps
one row per attempt.
"""
import time
import uuid

JOBS = "so_jobs"
RUNS = "so_runs"
STEP_RUNS = "so_step_runs"
COMMANDS = "so_commands"
SETTINGS = "so_settings"
SETTINGS_KEY = "settings"
ACTIVE_RUN_STATES = ["queued", "running", "blocked", "paused"]
TERMINAL_RUN_STATES = ["succeeded", "failed", "cancelled"]


def _key(doc):
    key = doc.get("_key") or doc.get("id")
    if not key:
        raise ValueError("document needs _key or id")
    return key


class Store:
    def __init__(self, gateway):
        self.gw = gateway

    def _upsert(self, collection, doc):
        key = _key(doc)
        doc = dict(doc, _key=key)
        if not self.gw.kv_update(collection, key, doc):
            if not self.gw.kv_insert(collection, doc):  # lost a race to another writer
                self.gw.kv_update(collection, key, doc)

    # Jobs.

    def get_job(self, job_id):
        return self.gw.kv_get(JOBS, job_id)

    def save_job(self, job):
        self._upsert(JOBS, job)

    def delete_job(self, job_id):
        self.gw.kv_delete(JOBS, job_id)

    def list_jobs(self):
        return self.gw.kv_query(JOBS)

    # Runs.

    def create_run(self, run):
        """Insert a new run. False if a run with this _key already exists."""
        return self.gw.kv_insert(RUNS, dict(run, _key=_key(run)))

    def save_run(self, run):
        self._upsert(RUNS, run)

    def get_run(self, run_id):
        return self.gw.kv_get(RUNS, run_id)

    def list_runs(self, filters=None):
        """Runs matching equality filters (a value may be a KV query operator dict)."""
        return self.gw.kv_query(RUNS, dict(filters or {}), sort="created_at:-1")

    def list_active_runs(self):
        return self.gw.kv_query(RUNS, {"state": {"$in": ACTIVE_RUN_STATES}}, sort="created_at:1")

    def save_step_run(self, row):
        """One row per attempt; _key defaults to run_id:step_id:attempt."""
        if not row.get("_key"):
            row = dict(row, _key="{}:{}:{}".format(row["run_id"], row["step_id"], row["attempt"]))
        self._upsert(STEP_RUNS, row)

    def list_step_runs(self, run_id):
        return self.gw.kv_query(STEP_RUNS, {"run_id": run_id})

    def prune_runs(self, before):
        """Delete ended runs (and their attempt rows) that ended before ``before``."""
        old = self.gw.kv_query(RUNS, {"state": {"$in": TERMINAL_RUN_STATES},
                                      "ended_at": {"$lt": int(before)}})
        for run in old:
            run_id = run["_key"]
            self.gw.kv_delete_query(STEP_RUNS, {"run_id": run_id})
            self.gw.kv_delete(RUNS, run_id)
        return len(old)

    # Commands.

    def enqueue_command(self, command):
        doc = dict(command, _key=command.get("_key") or uuid.uuid4().hex)
        doc.setdefault("created_at", int(time.time()))
        self.gw.kv_insert(COMMANDS, doc)
        return doc["_key"]

    def take_commands(self):
        """Read all pending commands, oldest first, and delete them."""
        commands = self.gw.kv_query(COMMANDS, sort="created_at:1")
        for command in commands:
            self.gw.kv_delete(COMMANDS, command["_key"])
        return commands

    # Settings.

    def get_settings(self):
        return self.gw.kv_get(SETTINGS, SETTINGS_KEY) or {}

    def save_settings(self, settings):
        self._upsert(SETTINGS, dict(settings, _key=SETTINGS_KEY))
