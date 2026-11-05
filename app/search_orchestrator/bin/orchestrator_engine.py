#!/usr/bin/env python3
"""SPIKE (Milestone 1, spec section 9). Throwaway: Task 6 replaces this file.

Using the modular input's system session, dispatches searches owned by a
restricted user and records every observed outcome as a row in the so_spike
KV Store collection. Rows hold raw observations; `ok` only says whether the
observation matched the expected value. See docs/m1-procedure.md.

The sequence runs once per engine start. Afterwards the process stays alive
(interval = 0 would otherwise relaunch it and repeat the sequence forever).
"""
import json
import os
import re
import sys
import time
from urllib.parse import urlsplit

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from splunklib import client  # noqa: E402
from splunklib.modularinput import EventWriter, Scheme, Script  # noqa: E402

APP = "search_orchestrator"
OWNER = "so_m1_user"
OWNER_ROLE = "so_m1_role"
OWNER2 = "so_m1_owner2"
KV_PATH = "storage/collections/data/so_spike"
CONTEXT_SEARCH = "| rest /services/authentication/current-context splunk_server=local | fields username roles"
SECRET_SEARCH = "search index=so_m1_secret | stats count"
ARG_VALUE = "spike_value"
ISO_TIME_FORMAT = "%FT%T.%Q%:z"
FALLBACK_POOL = "standard_perf"
MAX_DETAIL = 8000
CANCEL_STATES = ("FINALIZING", "CANCELED")
DAY = 86400
JOB_FIELDS = ("dispatchState", "isDone", "isFailed", "isFinalized", "resultCount", "ttl",
              "messages", "search", "label", "delegate", "isSavedSearch", "now",
              "earliestTime", "latestTime", "searchEarliestTime", "searchLatestTime",
              "workload_pool", "runDuration")


class SpikeError(Exception):
    """A check could not proceed."""


# Pure helpers (unit-tested in tests/test_spike.py).

def make_row(check, ok, detail, sid, at):
    text = detail if isinstance(detail, str) else json.dumps(detail, sort_keys=True, default=str)
    if len(text) > MAX_DETAIL:
        text = text[:MAX_DETAIL] + "...[truncated]"
    return {"check": check, "ok": 1 if ok else 0, "detail": text, "sid": sid or "", "at": int(at)}


def dispatch_params(now, args=None, extra=None):
    params = {"dispatch.now": now, "force_dispatch": 1, "trigger_actions": 0}
    for key, value in (args or {}).items():
        params["args." + key] = value
    params.update(extra or {})
    return params


def parse_sid(body):
    try:
        sid = json.loads(body).get("sid")
    except (ValueError, AttributeError):
        match = re.search(r"<sid>\s*([^<\s]+)\s*</sid>", body)
        sid = match.group(1) if match else None
    if not sid:
        raise SpikeError("no sid in response: " + body[:500])
    return sid


def job_summary(body):
    entry = json.loads(body)["entry"][0]
    content = entry.get("content", {})
    acl = entry.get("acl", {})
    summary = {key: content[key] for key in JOB_FIELDS if key in content}
    summary["acl_owner"] = acl.get("owner")
    summary["acl_app"] = acl.get("app")
    summary["acl_sharing"] = acl.get("sharing")
    summary["author"] = entry.get("author")
    return summary


def job_failed(summary):
    return _truthy(summary.get("isFailed")) or summary.get("dispatchState") == "FAILED"


def job_finished(summary):
    return _truthy(summary.get("isDone")) or job_failed(summary)


def _truthy(value):
    return value in (True, 1, "1", "true", "True")


def parse_results(body):
    return json.loads(body).get("results", [])


def as_list(value):
    if value is None:
        return []
    return list(value) if isinstance(value, list) else [value]


def first_value(rows, field):
    values = as_list(rows[0].get(field)) if rows else []
    return values[0] if values else None


def count_of(rows):
    value = first_value(rows, "count")
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def identity_ok(rows, username, role):
    return (len(rows) == 1 and first_value(rows, "username") == username
            and set(as_list(rows[0].get("roles"))) == {role})


def args_ok(rows, value):
    return (len(rows) == 1 and first_value(rows, "v") == value
            and first_value(rows, "literal") == "foo$"
            and first_value(rows, "other") == "$unknown$")


def snapped_time_ok(info_min_time, now):
    """Is info_min_time what -1d@d gives relative to now, in any timezone?

    Snapping to the day moves the value back by up to a day from now - 1d. An
    hour of slack on each side covers daylight-saving days.
    """
    try:
        value = float(info_min_time)
    except (TypeError, ValueError):
        return False
    return now - 2 * DAY - 3600 <= value <= now - DAY + 3600


def _as_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def cancel_ok(before, after):
    """Only proven if the job was running beforehand and the cancel left a mark."""
    if before.get("missing") or job_finished(before):
        return False
    return bool(after.get("missing")) or after.get("dispatchState") in CANCEL_STATES


def touch_ok(ttl_before, ttl_after):
    before, after = _as_int(ttl_before), _as_int(ttl_after)
    return before is not None and after is not None and after >= before


def setttl_ok(ttl_after, target, slack=60):
    """The ttl counts down from the value set, so it can only be slightly below it."""
    after = _as_int(ttl_after)
    return after is not None and 0 <= target - after <= slack


def done_detail(expected, written, results):
    """Summarize the run, so a partial run is visible in the done row."""
    written = list(written)
    return {"expected": len(expected), "checks": written,
            "missing": [name for name in expected if name not in written],
            "matched": len([name for name, ok in results if ok]),
            "failed": [name for name, ok in results if not ok],
            "python": sys.version.split()[0]}


def iso_time(epoch):
    return time.strftime("%Y-%m-%dT%H:%M:%S.000+00:00", time.gmtime(epoch))


def pick_pool(body):
    """Prefer the default search pool; return None when none are listed."""
    entries = json.loads(body).get("entry", [])
    search = [e for e in entries if e.get("content", {}).get("category") == "search"]
    for entry in search:
        if _truthy(entry["content"].get("default_category_pool")):
            return entry["name"]
    chosen = search or entries
    return chosen[0]["name"] if chosen else None


# The spike.

class Spike:
    def __init__(self, service, log, sleep=time.sleep, clock=time.time):
        self.service = service
        self.log = log
        self.sleep = sleep
        self.clock = clock
        self.current_sid = None
        self.identity_sid = None
        self.results = []
        self.written = []

    # REST plumbing.

    def _get(self, path, owner=None, app=APP, **query):
        return self.service.get(path, owner=owner, app=app, output_mode="json",
                                **query).body.read().decode("utf-8")

    def _post(self, path, owner=None, app=APP, **params):
        return self.service.post(path, owner=owner, app=app, output_mode="json",
                                 **params).body.read().decode("utf-8")

    def _dispatch(self, name, owner=OWNER, args=None, now=None, extra=None):
        now = int(self.clock()) if now is None else now
        params = dispatch_params(now, args, extra)
        sid = parse_sid(self._post("saved/searches/{}/dispatch".format(name), owner, **params))
        self.current_sid = sid
        return sid

    def _status(self, sid, owner=OWNER):
        return job_summary(self._get("search/jobs/" + sid, owner))

    def _wait(self, sid, owner=OWNER, timeout=120):
        deadline = self.clock() + timeout
        misses = 0
        summary = {}
        while self.clock() < deadline:
            try:
                summary = self._status(sid, owner)
            except client.HTTPError as err:
                misses += 1
                if err.status != 404 or misses > 5:
                    raise
            else:
                if job_finished(summary):
                    return summary
            self.sleep(1)
        raise SpikeError("job did not finish in {}s; last status: {}".format(timeout, summary))

    def _rows(self, sid, owner=OWNER):
        return parse_results(self._get("search/jobs/{}/results".format(sid), owner, count=0))

    def _run_saved(self, name, owner=OWNER, args=None, now=None, extra=None):
        sid = self._dispatch(name, owner, args, now, extra)
        summary = self._wait(sid, owner)
        rows = [] if job_failed(summary) else self._rows(sid, owner)
        return sid, summary, rows

    def _run_ad_hoc(self, search, owner, **params):
        body = self._post("search/jobs", owner, search=search, **params)
        sid = parse_sid(body)
        self.current_sid = sid
        summary = self._wait(sid, owner)
        rows = [] if job_failed(summary) else self._rows(sid, owner)
        return summary, rows

    def _control(self, sid, action, **params):
        return self._post("search/jobs/{}/control".format(sid), OWNER, action=action, **params)

    def _require_identity_sid(self):
        if not self.identity_sid:
            raise SpikeError("identity search did not produce a job")
        self.current_sid = self.identity_sid
        return self.identity_sid

    # Checks. Each returns (ok, detail); exceptions become ok=0 rows.

    def check_system_session_identity(self):
        entry = json.loads(self._get("/services/authentication/current-context", app=None))["entry"][0]
        content = entry.get("content", {})
        username, roles = content.get("username"), content.get("roles")
        return bool(username), {"username": username, "roles": roles}

    def check_secret_control(self):
        """Without an event in the index, index_access = 0 would prove nothing."""
        summary, rows = self._run_ad_hoc(SECRET_SEARCH, "nobody", earliest_time="0", latest_time="now")
        count = count_of(rows)
        return bool(count), {"count": count, "rows": rows, "job": summary}

    def check_identity(self):
        sid = self._dispatch("_so_spike_identity")
        self.identity_sid = sid
        summary = self._wait(sid)
        rows = [] if job_failed(summary) else self._rows(sid)
        return identity_ok(rows, OWNER, OWNER_ROLE), {
            "username": first_value(rows, "username"),
            "roles": rows[0].get("roles") if rows else None,
            "job": summary}

    def check_index_access(self):
        _, summary, rows = self._run_saved("_so_spike_secret")
        count = count_of(rows)
        return count == 0 and not job_failed(summary), {"count": count, "rows": rows, "job": summary}

    def check_args(self):
        _, summary, rows = self._run_saved("_so_spike_args", args={"v": ARG_VALUE})
        return args_ok(rows, ARG_VALUE), {"expected_v": ARG_VALUE, "rows": rows, "job": summary}

    def _check_time(self, now_param, extra=None):
        now = int(self.clock()) - 7 * DAY
        value = iso_time(now) if now_param == "iso" else now
        _, summary, rows = self._run_saved("_so_spike_now", now=value, extra=extra)
        info_min = first_value(rows, "info_min_time")
        return snapped_time_ok(info_min, now), {
            "dispatch_now_sent": value, "dispatch_now_epoch": now,
            "info_min_time": info_min, "job": summary}

    def check_scheduled_time(self):
        return self._check_time("epoch")

    def check_scheduled_time_iso(self):
        return self._check_time("iso", {"dispatch.time_format": ISO_TIME_FORMAT})

    def check_job_status_read(self):
        summary = self._status(self._require_identity_sid())
        return bool(summary.get("dispatchState")), {"job": summary}

    def check_job_results_read(self):
        rows = self._rows(self._require_identity_sid())
        return len(rows) > 0, {"rows": rows}

    def check_job_touch(self):
        sid = self._require_identity_sid()
        before = self._status(sid).get("ttl")
        self._control(sid, "touch")
        after = self._status(sid).get("ttl")
        return touch_ok(before, after), {"ttl_before": before, "ttl_after": after}

    def check_job_setttl(self):
        sid = self._require_identity_sid()
        target = 1234
        before = self._status(sid).get("ttl")
        self._control(sid, "setttl", ttl=target)
        after = self._status(sid).get("ttl")
        return setttl_ok(after, target), {"ttl_before": before, "ttl_requested": target, "ttl_after": after}

    def check_job_cancel(self):
        sid = self._dispatch("_so_spike_long")
        before = self._status_or_missing(sid)
        for _ in range(5):  # a new job can take a moment to become readable
            if not before.get("missing"):
                break
            self.sleep(1)
            before = self._status_or_missing(sid)
        state = before.get("dispatchState")
        if before.get("missing") or job_finished(before):
            return False, {"note": "not running before cancel; cancel not proven",
                           "before_state": state, "before": before}
        self._control(sid, "cancel")
        self.sleep(2)
        after = self._status_or_missing(sid)
        return cancel_ok(before, after), {"before_state": state, "before": before, "after": after}

    def _status_or_missing(self, sid):
        try:
            return self._status(sid)
        except client.HTTPError as err:
            if err.status == 404:
                return {"missing": True, "error": str(err)}
            raise

    def check_loadjob(self):
        source = self._require_identity_sid()
        _, summary, rows = self._run_saved("_so_spike_loadjob", args={"sid": source})
        count = count_of(rows)
        return bool(count), {"source_sid": source, "count": count, "rows": rows, "job": summary}

    def check_wrapper_mode(self):
        _, summary, rows = self._run_saved("_so_spike_wrapper")
        count = count_of(rows)
        ok = count == 0 and not job_failed(summary) and summary.get("acl_owner") == OWNER
        return ok, {"count": count, "rows": rows, "job": summary,
                    "reading": "count 0 means as so_m1_user; count>0 means with so_m1_owner2's access"}

    def _check_shared_direct(self, namespace):
        _, summary, rows = self._run_saved("_so_spike_shared", owner=namespace)
        count = count_of(rows)
        return bool(count) and summary.get("acl_owner") == OWNER2, {
            "namespace": namespace, "count": count, "rows": rows, "job": summary,
            "reading": "count>0 means it ran with so_m1_owner2's access"}

    def check_shared_direct_owner_ns(self):
        return self._check_shared_direct(OWNER2)

    def check_shared_direct_user_ns(self):
        return self._check_shared_direct(OWNER)

    def _check_workload_pool(self, param):
        try:
            pool = pick_pool(self._get("/services/workloads/pools", app=None))
            listing_error = None
        except Exception as err:  # the listing is only a hint; the dispatch is the check
            pool, listing_error = None, str(err)
        requested = pool or FALLBACK_POOL
        sid = self._dispatch("_so_spike_identity", extra={param: requested})
        summary = self._wait(sid)
        return summary.get("workload_pool") == requested and not job_failed(summary), {
            "param": param, "requested": requested, "pool_listed": pool,
            "listing_error": listing_error, "observed": summary.get("workload_pool"), "job": summary}

    def check_workload_pool(self):
        return self._check_workload_pool("workload_pool")

    def check_workload_pool_prefixed(self):
        return self._check_workload_pool("dispatch.workload_pool")

    def check_system_dispatch_ad_hoc(self):
        summary, rows = self._run_ad_hoc(CONTEXT_SEARCH, OWNER)
        username = first_value(rows, "username")
        return username == OWNER, {
            "username": username, "roles": rows[0].get("roles") if rows else None,
            "job": summary, "reading": "informational: ok=1 means the ad hoc route ran as so_m1_user"}

    # Sequence.

    def checks(self):
        return [(name, getattr(self, "check_" + name)) for name in (
            "system_session_identity", "secret_control", "identity", "index_access", "args",
            "scheduled_time", "scheduled_time_iso", "job_status_read", "job_results_read",
            "job_touch", "job_setttl", "job_cancel", "loadjob", "wrapper_mode",
            "shared_direct_owner_ns", "shared_direct_user_ns", "workload_pool",
            "workload_pool_prefixed", "system_dispatch_ad_hoc")]

    def wait_and_clear(self, attempts=120, delay=5):
        """KV Store is often not ready yet when splunkd starts the input."""
        last = None
        for _ in range(attempts):
            try:
                self.service.delete(KV_PATH, owner="nobody", app=APP)
                return True
            except Exception as err:
                last = err
                self.sleep(delay)
        self.log(EventWriter.ERROR, "so_spike: could not clear rows, KV Store not ready: {}".format(last))
        return False

    def record(self, row):
        self.log(EventWriter.INFO, "so_spike row: " + json.dumps(row, sort_keys=True))
        try:
            self.service.post(KV_PATH, owner="nobody", app=APP,
                              headers=[("Content-Type", "application/json")],
                              body=json.dumps(row))
            self.written.append(row["check"])
        except Exception as err:
            self.log(EventWriter.ERROR, "so_spike: could not write row {}: {}".format(row["check"], err))

    def run_check(self, name, func):
        self.current_sid = None
        try:
            ok, detail = func()
        except Exception as err:
            ok, detail = False, {"error": str(err), "type": type(err).__name__}
        self.results.append((name, bool(ok)))
        self.record(make_row(name, ok, detail, self.current_sid, self.clock()))

    def run(self):
        self.wait_and_clear()
        checks = self.checks()
        for name, func in checks:
            self.run_check(name, func)
        detail = done_detail([name for name, _ in checks], self.written, self.results)
        self.record(make_row("done", not detail["missing"], detail, None, self.clock()))


class OrchestratorEngine(Script):
    def get_scheme(self):
        scheme = Scheme("Search Orchestrator engine")
        scheme.description = "Advances Search Orchestrator runs."
        scheme.use_external_validation = False
        # Multi-instance so that interval = 0 applies: one process, one stanza.
        scheme.use_single_instance = False
        scheme.streaming_mode = Scheme.streaming_mode_simple
        return scheme

    def stream_events(self, inputs, ew):
        try:
            uri = urlsplit(inputs.metadata["server_uri"], allow_fragments=False)
            service = client.Service(scheme=uri.scheme, host=uri.hostname, port=uri.port,
                                     token=inputs.metadata["session_key"], owner="nobody",
                                     app=APP, autologin=False, timeout=60)
            ew.log(EventWriter.INFO, "so_spike: starting")
            Spike(service, ew.log).run()
            ew.log(EventWriter.INFO, "so_spike: finished")
        except Exception as err:
            ew.log(EventWriter.ERROR, "so_spike: stopped early: {}".format(err))
        while True:
            time.sleep(3600)


if __name__ == "__main__":
    sys.exit(OrchestratorEngine().run(sys.argv))
