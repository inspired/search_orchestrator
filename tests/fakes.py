"""In-memory FakeGateway for engine tests. Mirrors the Gateway Protocol."""
import copy
import itertools

from so.gateway import DispatchError, GatewayError, KvError


def _match(doc, query):
    for field, cond in (query or {}).items():
        value = doc.get(field)
        if isinstance(cond, dict):
            for op, arg in cond.items():
                ok = {"$lt": lambda: value is not None and value < arg,
                      "$lte": lambda: value is not None and value <= arg,
                      "$gt": lambda: value is not None and value > arg,
                      "$gte": lambda: value is not None and value >= arg,
                      "$ne": lambda: value != arg,
                      "$in": lambda: value in arg}[op]()
                if not ok:
                    return False
        elif value != cond:
            return False
    return True


class FakeGateway:
    def __init__(self):
        self.kv = {}
        self.kv_down = False
        self.crash_after_dispatch = False
        self.dispatch_log = []
        self.control_log = []
        self.webhook_log = []
        self.saved_searches = {}
        self.secrets = {}
        self.jobs = {}  # sid -> {"states": [...], "idx": n, "result_count", "first", "error"}
        self._scripts = {}
        self._dispatch_errors = {}
        self._sids = itertools.count(1)
        self.history_by_search = {}

    # Scripting.

    def script_job(self, name, states, result_count=0, first=None, error="scripted failure"):
        """Each dispatch of ``name`` makes a job whose status steps through ``states``
        ("running", "done", "failed", "missing"); the last state sticks."""
        self._scripts[name] = {"states": list(states), "result_count": result_count,
                               "first": first, "error": error}

    def fail_dispatch(self, name, transient, times=1):
        self._dispatch_errors[name] = [transient] * times

    # Searches.

    def dispatch(self, owner, name, now_epoch, args, earliest=None, latest=None,
                 trigger_actions=False):
        queue = self._dispatch_errors.get(name)
        if queue:
            transient = queue.pop(0)
            raise DispatchError(transient, "scripted dispatch error", 503 if transient else 400)
        script = self._scripts.get(name) or {"states": ["done"], "result_count": 1,
                                             "first": None, "error": None}
        sid = "fake.{}".format(next(self._sids))
        self.jobs[sid] = dict(script, idx=0)
        self.dispatch_log.append({"sid": sid, "owner": owner, "name": name, "now": now_epoch,
                                  "args": dict(args or {}), "earliest": earliest,
                                  "latest": latest, "trigger_actions": trigger_actions})
        self.history_by_search.setdefault((owner, name), []).append((now_epoch, sid))
        if self.crash_after_dispatch:
            raise RuntimeError("simulated crash after dispatch")
        return sid

    def job_status(self, sid):
        job = self.jobs.get(sid)
        if job is None or job.get("cancelled"):
            return {"state": "missing", "result_count": 0, "error": "search job not found",
                    "finalized": False, "zombie": False}
        state = job["states"][min(job["idx"], len(job["states"]) - 1)]
        job["idx"] += 1
        if state == "missing":
            return {"state": "missing", "result_count": 0, "error": "search job not found",
                    "finalized": False, "zombie": False}
        return {"state": state, "result_count": job["result_count"] if state == "done" else 0,
                "error": job["error"] if state == "failed" else None,
                "finalized": False, "zombie": False}

    def first_row(self, sid):
        job = self.jobs.get(sid)
        return copy.deepcopy(job["first"]) if job and job["first"] else None

    def control(self, sid, action, **kw):
        self.control_log.append((sid, action, kw))
        if action == "cancel" and sid in self.jobs:
            self.jobs[sid]["cancelled"] = True

    def history(self, owner, name, since_epoch):
        rows = [r for r in self.history_by_search.get((owner, name), []) if r[0] >= since_epoch]
        return [sid for _, sid in sorted(rows, key=lambda r: r[0], reverse=True)]

    # KV.

    def _check_kv(self):
        if self.kv_down:
            raise KvError("KV Store unavailable", status=503, transient=True)

    def _coll(self, collection):
        return self.kv.setdefault(collection, {})

    def kv_get(self, collection, key):
        self._check_kv()
        return copy.deepcopy(self._coll(collection).get(key))

    def kv_insert(self, collection, doc):
        self._check_kv()
        key = doc["_key"]
        if key in self._coll(collection):
            return False
        self._coll(collection)[key] = copy.deepcopy(doc)
        return True

    def kv_update(self, collection, key, doc):
        self._check_kv()
        if key not in self._coll(collection):
            return False
        self._coll(collection)[key] = dict(copy.deepcopy(doc), _key=key)
        return True

    def kv_delete(self, collection, key):
        self._check_kv()
        self._coll(collection).pop(key, None)

    def kv_delete_query(self, collection, query):
        self._check_kv()
        coll = self._coll(collection)
        for key in [k for k, d in coll.items() if _match(d, query)]:
            del coll[key]

    def kv_query(self, collection, query=None, sort=None, limit=0):
        self._check_kv()
        rows = [copy.deepcopy(d) for d in self._coll(collection).values() if _match(d, query)]
        if sort:
            field, _, direction = sort.partition(":")
            rows.sort(key=lambda d: (d.get(field) is None, d.get(field)),
                      reverse=direction == "-1")
        return rows[:limit] if limit else rows

    def kv_batch_save(self, collection, docs):
        self._check_kv()
        for doc in docs:
            self._coll(collection)[doc["_key"]] = copy.deepcopy(doc)

    # Saved searches, secrets, webhooks.

    def upsert_saved_search(self, owner, name, search, earliest, latest, description=""):
        self.saved_searches[(owner, name)] = {"search": search, "earliest": earliest,
                                              "latest": latest, "description": description}

    def delete_saved_search(self, owner, name):
        self.saved_searches.pop((owner, name), None)

    def read_secret(self, name):
        return self.secrets.get(name)

    def write_secret(self, name, value):
        self.secrets[name] = value

    def post_webhook(self, url, headers, body):
        if not url.startswith("https://"):
            raise GatewayError("webhook URL must be https: " + url)
        self.webhook_log.append({"url": url, "headers": dict(headers or {}), "body": body})
        return 200
