"""End-to-end engine tests through Engine.tick() with FakeGateway."""
import calendar
import io

import pytest

from fakes import FakeGateway
from so import audit as auditmod
from so import engine as enginemod
from so import names, scheduler
from so.actions import ActionRunner
from so.engine import AuthExpired, Engine
from so.gateway import DispatchError, KvError
from so.lease import Lease
from so.store import Store

# Tuesday 1 December 2026, 01:00 UTC: the 1st of the month, not a Monday.
T0 = calendar.timegm((2026, 12, 1, 1, 0, 0))
DAY = 86400
IN_FLIGHT = ("starting", "running")


class Clock:
    def __init__(self, t):
        self.t = t

    def __call__(self):
        return self.t


class RecordingAudit:
    def __init__(self):
        self.events = []

    def emit(self, event):
        self.events.append(dict(event))

    def of(self, kind, **match):
        return [e for e in self.events if e.get("type") == kind
                and all(e.get(k) == v for k, v in match.items())]


def make_job(job_id="j", steps=("a",), edges=(), cron="0 1 * * *", **over):
    out = []
    for s in steps:
        d = {"id": s} if isinstance(s, str) else dict(s)
        d.setdefault("type", "inline")
        d.setdefault("spl", "| makeresults")
        d.setdefault("hidden_search", names.step_search_name(job_id, d["id"], "0123456789abcdef"))
        if d["type"] == "previous":
            d.setdefault("hidden_search_empty",
                         names.step_search_name(job_id, d["id"], "fedcba9876543210"))
        out.append(d)
    es = [{"from": e[0], "to": e[1], "condition": e[2] if len(e) > 2 else "on_success"}
          for e in edges]
    j = {"_key": job_id, "id": job_id, "name": job_id, "owner": "alice", "enabled": True,
         "timezone": "UTC", "triggers": [{"type": "cron", "cron": cron}] if cron else [],
         "params": [], "steps": out, "edges": es, "actions": [], "defaults": {},
         "catchup": "all", "after_give_up": "hold"}
    j.update(over)
    return j


class World:
    def __init__(self, t=T0 - 5):
        self.gw = FakeGateway()
        self.clock = Clock(t)
        self.gw.clock = self.clock
        self.store = Store(self.gw)
        self.audit = RecordingAudit()
        self.actions = ActionRunner(self.gw, self.store, self.audit, self.clock)
        self.engine = self.new_engine()

    def new_engine(self, holder="h1"):
        return Engine(self.gw, self.store, self.audit, self.actions, self.clock, holder)

    def add_job(self, job, scripts=None):
        scripts = scripts or {}
        self.store.save_job(job)
        for s in job["steps"]:
            for name in filter(None, (s["hidden_search"], s.get("hidden_search_empty"))):
                if s["id"] in scripts:
                    self.gw.script_job(name, **scripts[s["id"]])
                else:
                    self.gw.upsert_saved_search(job["owner"], name, s["spl"], "", "")
        return job

    def tick(self, at=None, advance=None):
        if at is not None:
            self.clock.t = at
        if advance is not None:
            self.clock.t += advance
        self.engine.tick()

    def run(self, run_id):
        return self.store.get_run(run_id)

    def step(self, run_id, step_id):
        return self.run(run_id)["steps"][step_id]

    def finish(self, sid, state="done", result_count=1):
        self.gw.jobs[sid].update(states=[state], idx=0, result_count=result_count)

    def dispatched(self, step_id=None):
        return [d for d in self.gw.dispatch_log
                if step_id is None or d["name"].split("_")[3] == step_id]

    def action_rows(self, **match):
        rows = self.gw.kv.get("so_action_runs", {}).values()
        return [r for r in rows if all(r.get(k) == v for k, v in match.items())]

    def in_flight(self):
        return sum(1 for r in self.gw.kv.get("so_runs", {}).values()
                   for st in r["steps"].values() if st.get("state") in IN_FLIGHT)

    def command(self, **cmd):
        cmd.setdefault("created_at", int(self.clock()))
        self.store.enqueue_command(cmd)

    def manual(self, job, scheduled_time=None, **kw):
        return scheduler.create_run(self.store, job, "manual",
                                    scheduled_time or int(self.clock()), {},
                                    now=int(self.clock()), audit=self.audit,
                                    actions=self.actions, **kw)


def cron_run(world, job, slot=T0):
    """Let the engine see the job before the slot, then tick at the slot."""
    world.tick(at=slot - 5)
    world.tick(at=slot)
    return "%s:%d" % (job["id"], slot)


# --- happy paths ---------------------------------------------------------------

def test_rollup_serial_happy_path():
    w = World()
    j = w.add_job(make_job(steps=[
        {"id": "daily", "earliest": "-1d@d", "latest": "@d"},
        {"id": "weekly", "run_when": {"kind": "cron", "value": "* * * * 1"},
         "spl": "| loadjob $daily.sid$"},
        {"id": "monthly", "run_when": {"kind": "cron", "value": "* * 1 * *"},
         "spl": "| loadjob $daily.sid$ | eval w=\"$weekly.sid|none$\""}],
        edges=[("daily", "weekly"), ("weekly", "monthly")]),
        scripts={"daily": {"states": ["running", "done"], "result_count": 5},
                 "monthly": {"states": ["running", "done"], "result_count": 1}})
    run_id = cron_run(w, j)
    assert w.step(run_id, "daily")["state"] == "running"
    for _ in range(4):
        w.tick(advance=5)
    run = w.run(run_id)
    assert run["state"] == "succeeded"
    assert run["steps"]["weekly"]["state"] == "skipped"
    assert run["steps"]["weekly"]["skip_kind"] == "run_when"
    assert [d["name"].split("_")[3] for d in w.gw.dispatch_log] == ["daily", "monthly"]
    daily, monthly = w.gw.dispatch_log
    assert daily["now"] == T0 and monthly["now"] == T0
    assert daily["owner"] == "alice" and daily["name"] == j["steps"][0]["hidden_search"]
    assert (daily["earliest"], daily["latest"]) == ("-1d@d", "@d")
    assert monthly["args"] == {"daily__sid": daily["sid"], "weekly__sid": "none"}
    assert run["steps"]["daily"]["result_count"] == 5


def test_parallel_branches_then_merge_respects_limits():
    w = World()
    branches = ["b%d" % i for i in range(1, 7)]
    j = w.add_job(make_job(steps=["a"] + branches + ["m"],
                           edges=[("a", b) for b in branches] + [(b, "m") for b in branches]),
                  scripts={b: {"states": ["running", "running", "done"]} for b in branches})
    run_id = cron_run(w, j)
    peak = 0
    for _ in range(12):
        w.tick(advance=5)
        peak = max(peak, w.in_flight())
        assert w.in_flight() <= 4
    assert peak == 4
    run = w.run(run_id)
    assert run["state"] == "succeeded"
    names_in_order = [d["name"].split("_")[3] for d in w.gw.dispatch_log]
    assert names_in_order[0] == "a" and names_in_order[-1] == "m"
    assert names_in_order[1:5] == ["b1", "b2", "b3", "b4"]  # topo order


def test_global_limit_oldest_run_first():
    w = World(T0)
    w.store.save_settings({"max_searches": 5})
    roots = ["p%d" % i for i in range(1, 7)]
    j = w.add_job(make_job("j", steps=roots, cron=None),
                  scripts={p: {"states": ["running"]} for p in roots})
    k = w.add_job(make_job("k", steps=roots, cron=None),
                  scripts={p: {"states": ["running"]} for p in roots})
    old = w.manual(j, scheduled_time=T0 - 100)
    new = w.manual(k, scheduled_time=T0)
    w.tick()
    running = lambda rid: sum(1 for s in w.run(rid)["steps"].values() if s["state"] in IN_FLIGHT)
    assert running(old) == 4 and running(new) == 1


def test_zero_results_step_succeeds():
    w = World()
    j = w.add_job(make_job(steps=["a", {"id": "b", "spl": "| makeresults | eval n=$a.resultCount$"}],
                           edges=[("a", "b")]),
                  scripts={"a": {"states": ["done"], "result_count": 0}})
    run_id = cron_run(w, j)
    w.tick(advance=5)
    assert w.step(run_id, "a")["state"] == "succeeded"
    assert w.step(run_id, "a")["result_count"] == 0
    assert w.dispatched("b")[0]["args"] == {"a__resultCount": "0"}


def test_only_referenced_first_row_fields_are_stored():
    w = World()
    j = w.add_job(make_job(steps=["a", {"id": "b", "spl": "| makeresults | eval h=$a.first.host$"}],
                           edges=[("a", "b")]),
                  scripts={"a": {"states": ["done"], "result_count": 2,
                                 "first": {"host": ["h1", "h2"], "secret": "x"}}})
    run_id = cron_run(w, j)
    w.tick(advance=5)
    assert w.step(run_id, "a")["first"] == {"host": "h1"}
    assert w.dispatched("b")[0]["args"] == {"a__first__host": "h1"}


# --- delays, failure, re-run ----------------------------------------------------

def test_late_daily_weekly_waits_delay_hook_once_then_starts():
    w = World()
    j = w.add_job(make_job(steps=["daily", "weekly"], edges=[("daily", "weekly")]),
                  scripts={"daily": {"states": ["running"]}})
    run_id = cron_run(w, j)
    w.tick(at=T0 + 3599)
    assert not w.action_rows(hook="on_delayed")
    w.tick(at=T0 + 3600)
    assert len(w.action_rows(hook="on_delayed", scope="job")) == 1
    assert len(w.action_rows(hook="on_delayed", scope="step", step_id="daily")) == 1
    for _ in range(3):
        w.tick(advance=60)
    assert len(w.action_rows(hook="on_delayed", scope="job")) == 1
    assert w.step(run_id, "weekly")["state"] == "waiting"
    w.finish(w.step(run_id, "daily")["sid"])
    w.tick(at=T0 + 5000)
    weekly = w.step(run_id, "weekly")
    assert weekly["state"] == "running" and weekly["started_at"] == T0 + 5000
    assert w.dispatched("weekly")[0]["now"] == T0


def test_scheduled_time_passed_as_dispatch_now_on_late_start():
    w = World()
    j = w.add_job(make_job(steps=["daily", "weekly"], edges=[("daily", "weekly")]),
                  scripts={"daily": {"states": ["running"]}})
    run_id = cron_run(w, j)
    w.finish(w.step(run_id, "daily")["sid"])
    w.tick(at=T0 + 2 * 3600 + 17)
    assert [d["now"] for d in w.gw.dispatch_log] == [T0, T0]
    assert w.step(run_id, "weekly")["started_at"] == T0 + 2 * 3600 + 17


def test_failed_daily_blocks_then_rerun_recovers():
    w = World()
    j = w.add_job(make_job(steps=["daily", "weekly"], edges=[("daily", "weekly")]),
                  scripts={"daily": {"states": ["failed"], "error": "bad search"}})
    run_id = cron_run(w, j)
    w.tick(advance=5)
    run = w.run(run_id)
    assert run["state"] == "blocked"
    assert run["steps"]["daily"]["state"] == "failed"
    assert "bad search" in run["steps"]["daily"]["error"]
    assert run["steps"]["weekly"]["state"] == "waiting"
    assert len(w.action_rows(hook="on_failure", scope="job")) == 1
    w.tick(advance=3600)
    assert len(w.dispatched("daily")) == 1  # no automatic retry with retries = 0
    w.gw.script_job(j["steps"][0]["hidden_search"], ["done"])
    w.command(type="rerun", run_id=run_id, step_id="daily", definition="original", user="bob")
    w.tick(advance=5)
    assert w.run(run_id)["rerun_count"] == 1
    assert w.step(run_id, "daily")["state"] == "running"
    w.tick(advance=5)
    w.tick(advance=5)
    run = w.run(run_id)
    assert run["state"] == "succeeded"
    assert [d["now"] for d in w.gw.dispatch_log] == [T0, T0, T0]
    assert w.audit.of("command", command="rerun", result="ok")


def test_missing_search_counts_as_failed_attempt():
    w = World()
    j = w.add_job(make_job(steps=[{"id": "a", "retries": 1}]),
                  scripts={"a": {"states": ["running", "missing"]}})
    run_id = cron_run(w, j)
    w.tick(advance=5)  # running
    w.tick(advance=5)  # missing
    a = w.step(run_id, "a")
    assert a["state"] == "retrying" and a["attempt"] == 2
    assert "no longer exists" in a["error"]
    rows = w.store.list_step_runs(run_id)
    first = [r for r in rows if r["attempt"] == 1][0]
    assert first["outcome"] == "failed" and "no longer exists" in first["error"]
    w.gw.script_job(j["steps"][0]["hidden_search"], ["done"])
    w.tick(advance=30)
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "succeeded"
    assert len(w.dispatched("a")) == 2


def test_finalized_search_is_failed_with_clear_error():
    w = World()
    j = w.add_job(make_job(), scripts={"a": {"states": ["finalized"], "result_count": 3}})
    run_id = cron_run(w, j)
    w.tick(advance=5)
    a = w.step(run_id, "a")
    assert a["state"] == "failed" and "finalized" in a["error"]
    assert w.run(run_id)["state"] == "blocked"


def test_deleted_hidden_search_fails_with_clear_error():
    w = World()
    j = w.add_job(make_job())
    w.gw.delete_saved_search("alice", j["steps"][0]["hidden_search"])
    run_id = cron_run(w, j)
    w.tick(advance=5)
    a = w.step(run_id, "a")
    assert a["state"] == "failed"
    assert j["steps"][0]["hidden_search"] in a["error"] and "not found" in a["error"]


def test_step_without_hidden_search_fails_with_clear_error():
    w = World()
    j = make_job()
    del j["steps"][0]["hidden_search"]
    w.store.save_job(j)
    run_id = cron_run(w, j)
    w.tick(advance=5)
    a = w.step(run_id, "a")
    assert a["state"] == "failed" and "hidden saved search" in a["error"]
    assert not w.gw.dispatch_log


def test_orphaned_owner_fails_with_clear_error():
    w = World()
    j = w.add_job(make_job())
    w.gw.removed_users.add("alice")
    run_id = cron_run(w, j)
    w.tick(advance=5)
    a = w.step(run_id, "a")
    assert a["state"] == "failed"
    assert "owner 'alice'" in a["error"] and "no longer exists" in a["error"]


def test_transient_dispatch_error_is_retried_without_using_retries():
    w = World()
    j = w.add_job(make_job())
    w.gw.fail_dispatch(j["steps"][0]["hidden_search"], transient=True, times=2)
    run_id = cron_run(w, j)
    a = w.step(run_id, "a")
    assert a["dispatch_errors"] == 1 and a["outcome"] == "dispatch_error"
    w.tick(advance=5)
    assert w.step(run_id, "a")["state"] == "retrying"
    w.tick(advance=30)
    assert w.step(run_id, "a")["dispatch_errors"] == 2
    w.tick(advance=5)
    w.tick(advance=60)
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "succeeded"
    assert w.step(run_id, "a")["attempt"] == 1


# --- queue -------------------------------------------------------------------

def test_runs_queue_in_order_never_overlap():
    w = World()
    long = {"max_runtime": 10 * DAY, "give_up_after": 10 * DAY}
    j = w.add_job(make_job(defaults=long), scripts={"a": {"states": ["running"]}})
    r1 = cron_run(w, j)
    r2 = "j:%d" % (T0 + DAY)
    r3 = "j:%d" % (T0 + 2 * DAY)
    w.tick(at=T0 + DAY)
    w.tick(at=T0 + 2 * DAY)
    assert [w.run(r)["state"] for r in (r1, r2, r3)] == ["running", "queued", "queued"]
    for expected in (r1, r2):
        w.finish(w.step(expected, "a")["sid"])
        for _ in range(3):
            w.tick(advance=5)
            active = [r for r in (r1, r2, r3) if w.run(r)["state"] in ("running", "blocked")]
            assert len(active) <= 1
    assert [w.run(r)["state"] for r in (r1, r2, r3)] == ["succeeded", "succeeded", "running"]
    assert [d["now"] for d in w.gw.dispatch_log] == [T0, T0 + DAY, T0 + 2 * DAY]


def test_catchup_all_capped_at_7_oldest_first():
    w = World()
    j = w.add_job(make_job(), scripts={"a": {"states": ["running"]}})
    w.tick(at=T0 - 5)
    w.tick(at=T0 + 30 * DAY)  # the engine was down for 30 days
    runs = sorted(w.gw.kv["so_runs"].values(), key=lambda r: r["scheduled_time"])
    assert [r["scheduled_time"] for r in runs] == [T0 + (24 + i) * DAY for i in range(7)]
    assert [r["state"] for r in runs] == ["running"] + ["queued"] * 6
    assert all(r["catchup"] for r in runs[:-1])
    assert w.gw.dispatch_log[0]["now"] == T0 + 24 * DAY
    # catch-up runs count their delay from leaving the queue
    assert runs[0]["delay_base"] == T0 + 30 * DAY


def test_catchup_latest_and_none():
    for policy, expected in (("latest", [T0 + 30 * DAY]), ("none", [])):
        w = World()
        w.add_job(make_job(catchup=policy))
        w.tick(at=T0 - 5)
        w.tick(at=T0 + 30 * DAY + 3600)
        assert sorted(r["scheduled_time"] for r in w.gw.kv.get("so_runs", {}).values()) == expected


def test_on_time_run_delay_counts_from_scheduled_time():
    w = World()
    j = w.add_job(make_job(), scripts={"a": {"states": ["running"]}})
    w.tick(at=T0 - 5)
    w.tick(at=T0 + 20)
    run = w.run("j:%d" % T0)
    assert run["delay_base"] == T0 and run["giveup_base"] == T0 + 20 and not run["catchup"]


def test_hold_blocks_later_runs_until_dismiss():
    w = World(T0)
    j = w.add_job(make_job(cron=None, defaults={"give_up_after": 600}),
                  scripts={"a": {"states": ["running"]}})
    r1 = w.manual(j)
    w.tick()
    sid1 = w.step(r1, "a")["sid"]
    w.tick(at=T0 + 600)
    run = w.run(r1)
    assert run["state"] == "failed" and run["gave_up"] and run["held"]
    assert (sid1, "cancel", {}) in w.gw.control_log
    r2 = w.manual(j)
    for _ in range(3):
        w.tick(advance=60)
    assert w.run(r2)["state"] == "queued"
    w.command(type="dismiss", run_id=r1, user="bob")
    w.tick(advance=5)
    assert w.run(r1)["held"] is False
    assert w.run(r2)["state"] == "running"
    assert w.audit.of("command", command="dismiss", result="ok")


def test_rerun_of_held_run_goes_first():
    w = World(T0)
    j = w.add_job(make_job(cron=None, defaults={"give_up_after": 600}),
                  scripts={"a": {"states": ["running"]}})
    r1 = w.manual(j, scheduled_time=T0)
    w.tick()
    w.tick(at=T0 + 600)
    r2 = w.manual(j, scheduled_time=T0 + 700)
    w.tick(advance=5)
    w.command(type="rerun", run_id=r1, step_id="a", definition="original")
    w.tick(advance=5)
    assert w.run(r1)["state"] == "running" and w.run(r2)["state"] == "queued"
    assert w.run(r1)["giveup_base"] == T0 + 610


def test_continue_lets_later_runs_proceed():
    w = World(T0)
    j = w.add_job(make_job(cron=None, after_give_up="continue", defaults={"give_up_after": 600}),
                  scripts={"a": {"states": ["running"]}})
    r1 = w.manual(j)
    w.tick()
    w.tick(at=T0 + 600)
    assert w.run(r1)["state"] == "failed" and not w.run(r1).get("held")
    r2 = w.manual(j)
    w.tick(advance=5)
    assert w.run(r2)["state"] == "running"


def test_hold_repeats_alert_daily():
    w = World(T0)
    j = w.add_job(make_job(cron=None, defaults={"give_up_after": 600}),
                  scripts={"a": {"states": ["running"]}})
    r1 = w.manual(j)
    w.tick()
    w.tick(at=T0 + 600)
    assert len(w.action_rows(run_id=r1, hook="on_failure", scope="job")) == 1
    w.tick(at=T0 + 600 + DAY - 1)
    assert len(w.action_rows(run_id=r1, hook="on_failure", scope="job")) == 1
    w.tick(at=T0 + 600 + DAY)
    w.tick(advance=5)
    rows = w.action_rows(run_id=r1, hook="on_failure", scope="job")
    assert sorted(str(r["occurrence"]) for r in rows) == ["0", "hold1"]
    w.tick(at=T0 + 600 + 2 * DAY + 10)
    assert len(w.action_rows(run_id=r1, hook="on_failure", scope="job")) == 3
    assert w.audit.of("hold_alert", run_id=r1)


def test_queue_cap_rejects_audits_and_notifies():
    w = World(T0)
    w.store.save_settings({"queue_cap": 2})
    j = w.add_job(make_job(cron=None), scripts={"a": {"states": ["running"]}})
    assert w.manual(j) and w.manual(j)
    assert w.manual(j) is None
    rejected = w.audit.of("run_rejected", job_id="j")
    assert rejected and rejected[0]["reason"] == "queue_cap"
    rows = w.action_rows(hook="on_failure", scope="job")
    assert len(rows) == 1 and rows[0]["run_id"] == rejected[0]["run_id"]
    assert len(w.gw.kv["so_runs"]) == 2


def test_queue_cap_applies_to_cron_slots():
    w = World()
    w.store.save_settings({"queue_cap": 1})
    j = w.add_job(make_job(), scripts={"a": {"states": ["running"]}})
    cron_run(w, j)
    w.tick(at=T0 + DAY)
    assert len(w.gw.kv["so_runs"]) == 1
    assert w.audit.of("run_rejected", reason="queue_cap")


# --- commands ------------------------------------------------------------------

def test_pause_resume_cancel_commands():
    w = World(T0)
    j = w.add_job(make_job(steps=["a", "b"], edges=[("a", "b")], cron=None),
                  scripts={"a": {"states": ["running"]}, "b": {"states": ["running"]}})
    r = w.manual(j)
    w.tick()
    w.command(type="pause", run_id=r)
    w.tick(advance=5)
    assert w.run(r)["state"] == "paused" and w.run(r)["paused_at"] == T0 + 5
    w.finish(w.step(r, "a")["sid"])
    w.tick(advance=5)
    assert w.step(r, "a")["state"] == "succeeded"
    assert w.step(r, "b")["state"] == "ready"  # no new steps start while paused
    w.command(type="resume", run_id=r)
    w.tick(advance=95)
    run = w.run(r)
    assert run["state"] == "running" and run["paused_seconds"] == 100 and run["paused_at"] is None
    assert w.step(r, "b")["state"] == "running"
    sid_b = w.step(r, "b")["sid"]
    w.command(type="cancel", run_id=r)
    w.tick(advance=5)
    run = w.run(r)
    assert run["state"] == "cancelled" and run["steps"]["b"]["state"] == "cancelled"
    assert (sid_b, "cancel", {}) in w.gw.control_log
    assert not w.gw.kv.get("so_commands")


def test_bad_command_is_rejected_and_removed():
    w = World(T0)
    j = w.add_job(make_job(cron=None))
    r = w.manual(j)
    w.command(type="resume", run_id=r)
    w.command(type="rerun", run_id="nope", step_id="a")
    w.tick()
    assert len(w.audit.of("command", result="rejected")) == 2
    assert not w.gw.kv.get("so_commands")


# --- restart, crash, outage, lease ----------------------------------------------

def test_restart_mid_run_resumes_by_sid():
    w = World()
    j = w.add_job(make_job(), scripts={"a": {"states": ["running", "done"]}})
    run_id = cron_run(w, j)
    sid = w.step(run_id, "a")["sid"]
    w.engine = w.new_engine()
    w.tick(advance=5)
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "succeeded"
    assert w.step(run_id, "a")["sid"] == sid
    assert len(w.gw.dispatch_log) == 1


def test_crash_after_dispatch_adopts_not_duplicates():
    w = World()
    j = w.add_job(make_job(), scripts={"a": {"states": ["done"]}})
    w.tick(at=T0 - 5)
    w.gw.crash_after_dispatch = True
    w.tick(at=T0 + 100)  # a late start: history must use real time, not dispatch.now
    run_id = "j:%d" % T0
    a = w.step(run_id, "a")
    assert a["state"] == "starting" and not a.get("sid") and a["intent_at"] == T0 + 100
    w.gw.crash_after_dispatch = False
    w.engine = w.new_engine()
    w.tick(advance=5)
    a = w.step(run_id, "a")  # adopted, then polled in the same tick
    assert a["state"] == "succeeded" and a["sid"] == w.gw.dispatch_log[0]["sid"]
    assert w.run(run_id)["state"] == "succeeded"
    assert len(w.gw.dispatch_log) == 1
    assert w.audit.of("step_adopted", run_id=run_id)


def test_starting_step_with_no_job_found_is_dispatched():
    w = World()
    j = w.add_job(make_job())
    run_id = cron_run(w, j)
    run = w.run(run_id)
    run["steps"]["a"].update(state="starting", sid=None, started_at=None, intent_at=T0 + 1)
    w.store.save_run(run)
    w.tick(at=T0 + 10)
    assert len(w.gw.dispatch_log) == 2
    assert w.step(run_id, "a")["sid"] == w.gw.dispatch_log[1]["sid"]


def test_kv_outage_tick_is_harmless_and_recovers():
    w = World()
    j = w.add_job(make_job(steps=["a", "b"], edges=[("a", "b")]),
                  scripts={"a": {"states": ["done"]}})
    run_id = cron_run(w, j)
    before = w.run(run_id)
    w.gw.kv_down = True
    w.tick(advance=5)
    w.tick(advance=5)
    w.gw.kv_down = False
    assert w.run(run_id) == before
    # KV fails right after b is dispatched: the search ID is never saved.
    real = w.gw.dispatch

    def dispatch_then_outage(*args, **kw):
        sid = real(*args, **kw)
        w.gw.kv_down = True
        return sid

    w.gw.dispatch = dispatch_then_outage
    w.tick(advance=5)
    w.gw.dispatch = real
    w.gw.kv_down = False
    assert w.step(run_id, "b")["state"] == "starting"
    w.tick(advance=5)
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "succeeded"
    assert len(w.dispatched("b")) == 1


def test_only_lease_holder_acts():
    w = World(T0)
    j = w.add_job(make_job(cron=None))
    r = w.manual(j)
    assert Lease(w.gw).acquire("other", T0)
    w.tick()
    w.tick(advance=89)
    assert w.run(r)["state"] == "queued" and not w.gw.dispatch_log
    w.tick(advance=1)  # the other holder's lease expired
    assert w.run(r)["state"] == "running" and len(w.gw.dispatch_log) == 1


def test_session_expiry_401_never_fails_a_run():
    w = World()
    j = w.add_job(make_job())
    real = w.gw.dispatch

    def expired(*args, **kw):
        raise DispatchError(False, "HTTP 401 Unauthorized", 401)

    w.tick(at=T0 - 5)
    w.gw.dispatch = expired
    with pytest.raises(AuthExpired):
        w.tick(at=T0)
    run_id = "j:%d" % T0
    assert w.step(run_id, "a")["state"] == "starting"
    w.gw.dispatch = real
    w.tick(advance=5)
    assert w.step(run_id, "a")["state"] == "running"
    assert w.run(run_id)["state"] == "running"


def test_kv_401_raises_auth_expired():
    w = World()

    def denied(*a, **k):
        raise KvError("HTTP 401 Unauthorized", status=401)

    w.gw.kv_insert = denied
    with pytest.raises(AuthExpired):
        w.tick()


def test_hooks_submitted_once_across_crash_before_run_save():
    w = World()
    j = w.add_job(make_job(), scripts={"a": {"states": ["done"]}})
    run_id = cron_run(w, j)
    real = w.gw.kv_update
    state = {"fail": True}

    def flaky_update(collection, key, doc):
        if collection == "so_runs" and state["fail"]:
            state["fail"] = False
            raise KvError("KV Store unavailable", status=503, transient=True)
        return real(collection, key, doc)

    w.gw.kv_update = flaky_update
    w.tick(advance=5)  # hooks submitted, then the run save fails
    assert w.action_rows(hook="on_success", scope="job")
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "succeeded"
    for hook, scope in (("on_start", "job"), ("on_success", "job"), ("on_complete", "job"),
                        ("on_success", "step"), ("on_complete", "step")):
        assert len(w.action_rows(run_id=run_id, hook=hook, scope=scope)) == 1, (hook, scope)


# --- definition, audit, results, pruning -----------------------------------------

def test_edit_does_not_change_active_run():
    w = World()
    j = w.add_job(make_job(steps=["a", "b"], edges=[("a", "b")]),
                  scripts={"a": {"states": ["running"]}})
    run_id = cron_run(w, j)
    old_b = j["steps"][1]["hidden_search"]
    edited = make_job(steps=["a", {"id": "b", "spl": "| makeresults | eval v=2",
                                   "hidden_search": "_so_j_b_99999999"}], edges=[("a", "b")])
    edited["owner"] = "carol"
    w.store.save_job(edited)
    w.finish(w.step(run_id, "a")["sid"])
    w.tick(advance=5)
    b = w.dispatched("b")[0]
    assert b["name"] == old_b and b["owner"] == "alice"
    assert w.run(run_id)["definition"]["steps"][1]["hidden_search"] == old_b


def test_every_state_change_is_audited():
    w = World()
    j = w.add_job(make_job(steps=["a", "b"], edges=[("a", "b")]),
                  scripts={"a": {"states": ["running", "done"]}})
    run_id = cron_run(w, j)
    w.tick(advance=5)
    w.tick(advance=5)
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "succeeded"
    assert w.audit.of("run_created", run_id=run_id)
    runs = [(e["from"], e["to"]) for e in w.audit.of("run_state", run_id=run_id)]
    assert runs == [("queued", "running"), ("running", "succeeded")]
    for sid in ("a", "b"):
        steps = [(e["from"], e["to"]) for e in w.audit.of("step_state", run_id=run_id, step_id=sid)]
        assert steps == [("waiting", "ready"), ("ready", "starting"), ("starting", "running"),
                         ("running", "succeeded")], sid
        assert w.audit.of("step_dispatched", run_id=run_id, step_id=sid)
    # This job has no actions, so no hook is audited as "action_submitted" (server-check noise).
    assert not w.audit.of("action_submitted", run_id=run_id)
    assert all(isinstance(e["_time"], int) for e in w.audit.events)
    assert all(e.get("job_id") == "j" for e in w.audit.events if e.get("run_id"))


def test_results_touched_while_needed_and_ttl_set_at_end():
    w = World()
    w.store.save_settings({"result_retention": 7200})
    j = w.add_job(make_job(steps=["a", "b"], edges=[("a", "b")]),
                  scripts={"b": {"states": ["running"]}})
    run_id = cron_run(w, j)
    w.tick(advance=5)
    sid_a = w.step(run_id, "a")["sid"]
    touches = lambda: [c for c in w.gw.control_log if c[:2] == (sid_a, "touch")]
    w.tick(advance=60)
    first = len(touches())
    assert first == 1
    w.tick(advance=60)
    assert len(touches()) == first
    w.tick(advance=300)
    assert len(touches()) == first + 1
    w.finish(w.step(run_id, "b")["sid"])
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "succeeded"
    assert (sid_a, "setttl", {"ttl": 7200}) in w.gw.control_log


def test_old_runs_pruned_after_retention():
    w = World(T0)

    def ended(key, age):
        w.store.create_run({"_key": key, "job_id": "j", "state": "succeeded",
                            "ended_at": T0 - age, "created_at": T0 - age, "steps": {}})

    ended("old", 91 * DAY)
    ended("recent", 89 * DAY)
    w.tick()
    assert w.run("old") is None and w.run("recent") is not None
    ended("old2", 91 * DAY)
    w.tick(advance=60)
    assert w.run("old2") is not None  # at most once an hour
    w.tick(advance=3600)
    assert w.run("old2") is None
    assert w.audit.of("runs_pruned")


def test_prune_respects_retention_setting():
    w = World(T0)
    w.store.save_settings({"run_retention_days": 10})
    w.store.create_run({"_key": "r", "job_id": "j", "state": "failed",
                        "ended_at": T0 - 11 * DAY, "created_at": T0 - 11 * DAY, "steps": {}})
    w.tick()
    assert w.run("r") is None


# --- audit writer and modular input --------------------------------------------------

def test_audit_writes_xml_event_with_numeric_time():
    from splunklib.modularinput import EventWriter
    out = io.StringIO()
    a = auditmod.Audit(EventWriter(output=out, error=io.StringIO()), index="orchestrator",
                       clock=lambda: 1793145600.7)
    a.emit({"type": "run_state", "run_id": "r", "from": "queued", "to": "running"})
    xml = out.getvalue()
    assert "<sourcetype>orchestrator:audit</sourcetype>" in xml
    assert "<index>orchestrator</index>" in xml
    assert '{"_time": 1793145600, ' in xml
    assert "<time>1793145600</time>" in xml


def test_engine_loop_reloads_session_once_on_401():
    import orchestrator_engine as oe

    keys = iter(["k1", "k2", "k3"])
    built = []

    class FakeEngine:
        def __init__(self, key):
            self.key = key

        def tick(self):
            if plan[self.key]:
                raise AuthExpired("401")

    plan = {"k1": True, "k2": False, "k3": True}

    def build(key):
        built.append(key)
        return FakeEngine(key)

    loop = oe.EngineLoop(build, lambda: next(keys), log=lambda *a: None)
    assert loop.run_once() is True  # 401, reload, retry succeeds
    assert built == ["k1", "k2"]
    plan["k2"] = True
    assert loop.run_once() is False  # 401 twice: exit so splunkd restarts with a fresh key
    assert built == ["k1", "k2", "k3"]


def test_engine_loop_survives_unexpected_errors():
    import orchestrator_engine as oe

    class Boom:
        def tick(self):
            raise ValueError("bug")

    logged = []
    loop = oe.EngineLoop(lambda key: Boom(), lambda: "k", log=lambda sev, msg: logged.append(msg))
    assert loop.run_once() is True
    assert logged


def test_settings_defaults():
    assert enginemod.DEFAULT_SETTINGS == {
        "max_searches": 10, "max_searches_per_job": 4, "queue_cap": 20,
        "result_retention": 86400, "run_retention_days": 90}


# --- review fix round 1 ------------------------------------------------------------

def test_queued_rerun_kept_results_are_touched():
    w = World(T0)
    j = w.add_job(make_job(steps=["a", "b"], edges=[("a", "b")], cron=None,
                           after_give_up="continue", defaults={"give_up_after": 600}),
                  scripts={"b": {"states": ["running"]}})
    r1 = w.manual(j)
    w.tick()
    w.tick(advance=5)
    sid_a = w.step(r1, "a")["sid"]
    w.tick(at=T0 + 600)
    assert w.run(r1)["state"] == "failed"
    r2 = w.manual(j)
    w.tick(advance=5)
    assert w.run(r2)["state"] == "running"
    w.command(type="rerun", run_id=r1, step_id="b", definition="original")
    w.tick(advance=5)
    assert w.run(r1)["state"] == "queued" and w.step(r1, "a")["sid"] == sid_a
    touches = lambda: len([c for c in w.gw.control_log if c[:2] == (sid_a, "touch")])
    first = touches()
    assert first >= 1
    w.tick(advance=60)
    assert touches() == first
    w.tick(advance=300)
    assert touches() == first + 1
    assert w.run(r1)["state"] == "queued"


def test_transient_dispatch_error_with_unknown_history_dispatches_once():
    w = World()
    j = w.add_job(make_job())
    real_dispatch, real_history = w.gw.dispatch, w.gw.history
    calls = {"dispatch": 0, "history": 0}

    def timed_out(*args, **kw):
        calls["dispatch"] += 1
        sid = real_dispatch(*args, **kw)  # the search really started
        if calls["dispatch"] == 1:
            raise DispatchError(True, "timed out", 503)
        return sid

    def flaky_history(*args, **kw):
        calls["history"] += 1
        if calls["history"] == 1:
            from so.gateway import GatewayError
            raise GatewayError("history unavailable", status=503, transient=True)
        return real_history(*args, **kw)

    w.gw.dispatch, w.gw.history = timed_out, flaky_history
    run_id = cron_run(w, j)
    a = w.step(run_id, "a")
    assert a["state"] == "starting" and not a.get("outcome") and not a.get("dispatch_errors")
    w.tick(advance=5)
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "succeeded"
    assert len(w.gw.dispatch_log) == 1
    assert w.step(run_id, "a")["sid"] == w.gw.dispatch_log[0]["sid"]


def test_dispatch_error_retry_keeps_intent_at_and_adopts():
    w = World()
    j = w.add_job(make_job())
    real_dispatch, real_history = w.gw.dispatch, w.gw.history
    calls = {"dispatch": 0, "history": 0}

    def timed_out(*args, **kw):
        calls["dispatch"] += 1
        sid = real_dispatch(*args, **kw)
        if calls["dispatch"] == 1:
            raise DispatchError(True, "timed out", 503)
        return sid

    def lagging_history(*args, **kw):
        calls["history"] += 1
        return [] if calls["history"] == 1 else real_history(*args, **kw)

    w.gw.dispatch, w.gw.history = timed_out, lagging_history
    run_id = cron_run(w, j)
    a = w.step(run_id, "a")
    assert a["dispatch_errors"] == 1 and a["intent_at"] == T0
    w.tick(advance=5)  # retrying
    w.tick(advance=30)  # retry: history from the first intent_at finds the search
    a = w.step(run_id, "a")
    assert a["intent_at"] == T0 and a["sid"] == w.gw.dispatch_log[0]["sid"]
    assert len(w.gw.dispatch_log) == 1


def test_prune_is_bounded_per_tick():
    w = World(T0)
    for i in range(450):
        w.store.create_run({"_key": "old%03d" % i, "job_id": "j", "state": "succeeded",
                            "ended_at": T0 - 91 * DAY - i, "created_at": T0 - 92 * DAY,
                            "steps": {}})
    left = lambda: len(w.gw.kv.get("so_runs", {}))
    w.tick()
    assert left() == 250
    w.tick(advance=5)
    assert left() == 50
    w.tick(advance=5)
    assert left() == 0
    assert w.store.get_engine_state()["last_prune"] == T0 + 10


def test_lease_lost_mid_tick_stops_the_tick():
    w = World(T0)
    j = w.add_job(make_job("j", cron=None))
    k = w.add_job(make_job("k", cron=None))
    rj = w.manual(j, scheduled_time=T0 - 10)
    rk = w.manual(k, scheduled_time=T0)
    real = w.gw.dispatch

    def slow_then_stolen(*args, **kw):
        sid = real(*args, **kw)
        w.clock.t += 15  # this tick is taking long
        w.gw.kv["so_locks"]["engine"] = {"_key": "engine", "holder": "other",
                                         "expires": T0 + 1000}
        return sid

    w.gw.dispatch = slow_then_stolen
    w.tick()
    assert w.step(rj, "a")["state"] == "running"
    assert w.step(rk, "a")["state"] != "running"
    assert len(w.gw.dispatch_log) == 1


def test_rerun_with_expired_upstream_results_fails_clearly():
    w = World()
    j = w.add_job(make_job(steps=["a", {"id": "b", "spl": "| loadjob $a.sid$"}],
                           edges=[("a", "b")]),
                  scripts={"b": {"states": ["failed"]}})
    run_id = cron_run(w, j)
    w.tick(advance=5)
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "blocked"
    w.gw.forget_job(w.step(run_id, "a")["sid"])  # a's results expired
    w.gw.script_job(j["steps"][1]["hidden_search"], ["done"])
    w.command(type="rerun", run_id=run_id, step_id="b", definition="original")
    w.tick(advance=5)
    w.tick(advance=5)
    b = w.step(run_id, "b")
    assert b["state"] == "failed"
    assert b["error"] == "Results of step a have expired; re-run from a"
    assert len(w.dispatched("b")) == 1


def test_cancel_adopts_untracked_search_then_cancels():
    w = World()
    j = w.add_job(make_job(), scripts={"a": {"states": ["running"]}})
    w.tick(at=T0 - 5)
    w.gw.crash_after_dispatch = True
    w.tick(at=T0)
    run_id = "j:%d" % T0
    assert w.step(run_id, "a")["state"] == "starting" and not w.step(run_id, "a").get("sid")
    w.gw.crash_after_dispatch = False
    w.command(type="cancel", run_id=run_id)
    w.tick(advance=5)
    sid = w.gw.dispatch_log[0]["sid"]
    assert (sid, "cancel", {}) in w.gw.control_log
    assert w.run(run_id)["state"] == "cancelled"
    assert w.step(run_id, "a")["sid"] == sid and w.step(run_id, "a")["state"] == "cancelled"
    assert len(w.gw.dispatch_log) == 1


def test_give_up_adopts_untracked_search_then_cancels():
    w = World(T0)
    j = w.add_job(make_job(cron=None, defaults={"give_up_after": 600}),
                  scripts={"a": {"states": ["running"]}})
    r = w.manual(j)
    w.gw.crash_after_dispatch = True
    w.tick()
    w.gw.crash_after_dispatch = False
    assert w.step(r, "a")["state"] == "starting"
    w.tick(at=T0 + 600)
    sid = w.gw.dispatch_log[0]["sid"]
    assert (sid, "cancel", {}) in w.gw.control_log
    assert w.run(r)["state"] == "failed" and w.run(r)["gave_up"]
    assert len(w.gw.dispatch_log) == 1


# --- review fix round 2 ------------------------------------------------------------

def _history_fails_for(w, name, status, transient):
    from so.gateway import GatewayError
    real = w.gw.history

    def history(owner, search, since):
        if search == name:
            raise GatewayError("history failed", status=status, transient=transient)
        return real(owner, search, since)

    w.gw.history = history


def _untracked_start(w, job, at=T0):
    """A run whose step dispatched a search but crashed before saving its ID."""
    w.gw.crash_after_dispatch = True
    run_id = w.manual(job, scheduled_time=at)
    w.tick(at=at)
    w.gw.crash_after_dispatch = False
    assert w.step(run_id, "a")["state"] == "starting" and not w.step(run_id, "a").get("sid")
    return run_id


def test_cancel_with_failing_history_does_not_stall_other_jobs():
    w = World(T0)
    j = w.add_job(make_job("j", cron=None), scripts={"a": {"states": ["running"]}})
    k = w.add_job(make_job("k", cron=None), scripts={"a": {"states": ["running"]}})
    rj = _untracked_start(w, j)
    _history_fails_for(w, j["steps"][0]["hidden_search"], 403, False)
    w.command(type="cancel", run_id=rj)
    rk = w.manual(k)
    w.tick(advance=5)
    assert w.run(rj)["state"] == "cancelled"
    assert w.run(rk)["state"] == "running" and w.step(rk, "a")["state"] == "running"
    assert not w.gw.kv.get("so_commands")
    orphan = w.audit.of("possible_orphan_search", run_id=rj, step_id="a")
    assert orphan and orphan[0]["hidden_search"] == j["steps"][0]["hidden_search"]
    assert orphan[0]["intent_at"] == T0
    assert len(w.dispatched()) == 2  # j's untracked search and k's; nothing re-dispatched


def test_non_transient_history_error_fails_attempt_without_dispatch():
    w = World(T0)
    j = w.add_job(make_job(cron=None), scripts={"a": {"states": ["running"]}})
    r = _untracked_start(w, j)
    _history_fails_for(w, j["steps"][0]["hidden_search"], 403, False)
    w.tick(advance=5)
    a = w.step(r, "a")
    assert a["state"] == "failed"
    assert a["error"].startswith("Could not check whether the search for step a started: ")
    assert w.run(r)["state"] == "blocked"
    assert len(w.gw.dispatch_log) == 1
    assert w.audit.of("possible_orphan_search", run_id=r)


def test_unknown_history_bounded_to_300s():
    w = World(T0)
    j = w.add_job(make_job(cron=None), scripts={"a": {"states": ["running"]}})
    r = _untracked_start(w, j)
    _history_fails_for(w, j["steps"][0]["hidden_search"], 503, True)
    w.tick(advance=5)
    assert w.step(r, "a")["state"] == "starting"
    assert w.run(r)["state"] == "running"  # evaluated, not skipped
    w.tick(at=T0 + 299)
    assert w.step(r, "a")["state"] == "starting"
    w.tick(at=T0 + 300)
    a = w.step(r, "a")
    assert a["state"] == "failed"
    assert a["error"] == "Could not confirm whether the search for step a started"
    assert len(w.gw.dispatch_log) == 1


def test_give_up_proceeds_when_history_unknown():
    w = World(T0)
    j = w.add_job(make_job(cron=None, defaults={"give_up_after": 200}),
                  scripts={"a": {"states": ["running"]}})
    r = _untracked_start(w, j)
    _history_fails_for(w, j["steps"][0]["hidden_search"], 503, True)
    w.tick(advance=5)
    w.tick(at=T0 + 200)
    run = w.run(r)
    assert run["state"] == "failed" and run["gave_up"]
    assert w.audit.of("possible_orphan_search", run_id=r, step_id="a")
    assert len(w.gw.dispatch_log) == 1


def test_command_dropped_after_10_failures():
    from so.gateway import GatewayError
    w = World(T0)
    j = w.add_job(make_job("j", cron=None), scripts={"a": {"states": ["running"]}})
    k = w.add_job(make_job("k", cron=None), scripts={"a": {"states": ["running"]}})
    rj = w.manual(j)
    w.tick()
    sid = w.step(rj, "a")["sid"]
    real = w.gw.control

    def control(search, action, **kw):
        if search == sid and action == "cancel":
            raise GatewayError("splunkd busy", status=503, transient=True)
        return real(search, action, **kw)

    w.gw.control = control
    w.command(type="cancel", run_id=rj)
    rk = w.manual(k)
    for _ in range(9):
        w.tick(advance=5)
    assert len(w.audit.of("command_retry", run_id=rj)) == 9
    assert len(w.gw.kv["so_commands"]) == 1
    assert w.run(rj)["state"] == "running"
    assert w.run(rk)["state"] == "running"  # other jobs keep going
    w.tick(advance=5)
    failed = w.audit.of("command_failed", run_id=rj)
    assert failed and failed[0]["attempts"] == 10 and "splunkd busy" in failed[0]["error"]
    assert not w.gw.kv.get("so_commands")


# --- final review I2: lease vs call time --------------------------------------

def test_lease_outlasts_engine_call_timeouts():
    from so import gateway as gwmod
    from so import lease as leasemod
    assert gwmod.ENGINE_CALL_TIMEOUT == 15
    assert leasemod.LEASE_SECONDS == 90
    assert enginemod.LEASE_RENEW_EVERY == 10


def test_engine_gateway_uses_short_call_timeout(monkeypatch):
    import orchestrator_engine as oe
    seen = {}

    def fake_from_session(uri, key, timeout=60):
        seen.update(uri=uri, key=key, timeout=timeout)
        return "gw"
    monkeypatch.setattr(oe.SplunkGateway, "from_session", staticmethod(fake_from_session))
    assert oe.make_gateway("https://127.0.0.1:8089", "k") == "gw"
    assert seen == {"uri": "https://127.0.0.1:8089", "key": "k", "timeout": 15}


def test_lease_renewed_immediately_before_each_dispatch():
    w = World(T0)
    j = w.add_job(make_job("j", steps=["a", "b"], cron=None))
    w.manual(j, scheduled_time=T0)
    order = []
    real_acquire, real_dispatch = w.engine.lease.acquire, w.gw.dispatch

    def acquire(holder, now):
        order.append("lease")
        return real_acquire(holder, now)

    def dispatch(*a, **kw):
        order.append("dispatch")
        return real_dispatch(*a, **kw)
    w.engine.lease.acquire = acquire
    w.gw.dispatch = dispatch
    w.tick()
    assert order.count("dispatch") == 2
    for i, item in enumerate(order):
        if item == "dispatch":
            assert order[i - 1] == "lease"  # renewed right before, even within 10 s


def test_lost_lease_means_no_dispatch():
    w = World(T0)
    j = w.add_job(make_job("j", cron=None))
    r = w.manual(j, scheduled_time=T0)
    real_acquire = w.engine.lease.acquire
    calls = []

    def acquire(holder, now):
        calls.append(now)
        if len(calls) == 1:
            return real_acquire(holder, now)
        # Another member took the lease while this tick was busy.
        w.gw.kv["so_locks"]["engine"] = {"_key": "engine", "holder": "other",
                                         "expires": now + 1000}
        return False
    w.engine.lease.acquire = acquire
    w.tick()
    assert not w.gw.dispatch_log
    st = w.step(r, "a")
    assert st["state"] in ("waiting", "starting") and not st.get("sid")
    # The new leader finds the step starting with no search, checks history, dispatches once.
    other = w.new_engine("other")
    w.clock.t += 5
    other.tick()
    assert len(w.gw.dispatch_log) == 1


def test_lease_renewed_before_each_action_send():
    w = World(T0)
    j = w.add_job(make_job("j", cron=None, actions=[
        {"hook": "on_start", "type": "webhook", "destination": "ops"},
        {"hook": "on_start", "type": "webhook", "destination": "ops"}]))
    w.gw.kv.setdefault("so_settings", {})["destinations"] = {
        "_key": "destinations", "destinations": [{"name": "ops", "url_secret_ref": "u"}]}
    w.gw.secrets["u"] = "https://hooks.example.com/x"
    w.manual(j, scheduled_time=T0)
    order = []
    real_acquire, real_post = w.engine.lease.acquire, w.gw.post_webhook

    def acquire(holder, now):
        order.append("lease")
        return real_acquire(holder, now)

    def post(*a, **kw):
        order.append("send")
        return real_post(*a, **kw)
    w.engine.lease.acquire = acquire
    w.gw.post_webhook = post
    w.tick()
    assert order.count("send") == 2
    for i, item in enumerate(order):
        if item == "send":
            assert order[i - 1] == "lease"


def test_queue_cap_rejections_while_held_fold_into_daily_hold_alert():
    # Final review M2: a held job with a 5-minute cron fills its queue; each rejected
    # slot must not notify on its own.
    w = World(T0)
    w.store.save_settings({"queue_cap": 3})
    j = w.add_job(make_job(cron="*/5 * * * *", defaults={"give_up_after": 600}),
                  scripts={"a": {"states": ["running"]}})
    w.tick(at=T0 - 5)
    w.tick(at=T0)
    r1 = "j:%d" % T0
    w.tick(at=T0 + 600)
    assert w.run(r1)["held"]
    t = T0 + 600
    while t < T0 + 600 + DAY + 1800:
        t += 300
        w.tick(at=t)
    rejected = w.audit.of("run_rejected", reason="queue_cap")
    assert len(rejected) > 100 and all(e.get("held") for e in rejected)
    rows = w.action_rows(hook="on_failure", scope="job")
    assert sorted(str(r["occurrence"]) for r in rows) == ["0", "hold1"]
    assert all(r["run_id"] == r1 for r in rows)


def test_failing_cancel_on_give_up_is_bounded_then_orphan_audited():
    # Final review M4: a strict cancel that keeps failing transiently must not stall the
    # run forever.
    from so.gateway import GatewayError
    w = World(T0)
    j = w.add_job(make_job("j", cron=None, after_give_up="continue",
                           defaults={"give_up_after": 600}),
                  scripts={"a": {"states": ["running"]}})
    r = w.manual(j)
    w.tick()
    sid = w.step(r, "a")["sid"]
    real = w.gw.control

    def control(search, action, **kw):
        if search == sid and action == "cancel":
            raise GatewayError("splunkd busy", status=503, transient=True)
        return real(search, action, **kw)
    w.gw.control = control
    w.tick(at=T0 + 600)
    assert w.run(r)["state"] == "running"  # cancel must succeed first
    w.tick(at=T0 + 600 + enginemod.UNKNOWN_LIMIT - 1)
    assert w.run(r)["state"] == "running"
    w.tick(at=T0 + 600 + enginemod.UNKNOWN_LIMIT)
    assert w.run(r)["state"] == "failed"
    orphan = w.audit.of("possible_orphan_search", run_id=r)
    assert orphan and orphan[0]["sid"] == sid and "cancel" in orphan[0]["reason"]


def _direct_job():
    return make_job(steps=[{"id": "a", "type": "saved_search", "saved_search_ref": "mine",
                            "mode": "direct", "hidden_search": "mine"}])


def _add_direct(w, **entry):
    j = w.add_job(_direct_job(), scripts={"a": {"states": ["done"]}})
    w.gw.upsert_saved_search("alice", "mine", "index=a", "-1h", "now")
    w.gw.saved_searches[("alice", "mine")].update(entry)
    return j


def test_direct_mode_adopts_only_job_with_matching_dispatch_now():
    # Final review M6: the user's own search may also run by hand or on its own schedule.
    w = World()
    j = _add_direct(w)
    w.tick(at=T0 - 5)
    w.gw.crash_after_dispatch = True
    w.tick(at=T0 + 100)
    run_id = "j:%d" % T0
    ours = w.gw.dispatch_log[0]["sid"]
    w.gw.crash_after_dispatch = False
    w.clock.t += 2
    w.gw.dispatch("alice", "mine", T0 + 102, {})  # the owner ran it by hand meanwhile
    w.engine = w.new_engine()
    w.tick(advance=5)
    a = w.step(run_id, "a")
    assert a["sid"] == ours and w.audit.of("step_adopted", run_id=run_id, sid=ours)


def test_direct_mode_unmatched_history_is_unknown_then_fails():
    w = World()
    j = _add_direct(w)
    w.tick(at=T0 - 5)
    w.tick(at=T0)
    run_id = "j:%d" % T0
    run = w.run(run_id)
    run["steps"]["a"] = {"state": "starting", "sid": None, "attempt": 1,
                         "intent_at": T0 + 1, "try_at": T0 + 1}
    run["state"] = "running"
    w.store.save_run(run)
    n = len(w.gw.dispatch_log)
    w.clock.t = T0 + 5
    w.gw.dispatch("alice", "mine", T0 + 5, {})  # not ours: wrong dispatch.now
    w.tick(at=T0 + 10)
    a = w.step(run_id, "a")
    assert a["state"] == "starting" and not a.get("sid")
    assert len(w.gw.dispatch_log) == n + 1  # never dispatched a second time
    w.tick(at=T0 + 1 + enginemod.UNKNOWN_LIMIT)
    attempts = w.audit.of("step_attempt", run_id=run_id, step_id="a", outcome="failed")
    assert attempts and "Could not confirm" in attempts[-1]["error"]
    assert w.audit.of("possible_orphan_search", run_id=run_id)
    assert not w.audit.of("step_adopted", run_id=run_id)


@pytest.mark.parametrize("change", [{"sharing": "app"}, {"dispatch_as": "user"}, None])
def test_direct_mode_rechecked_before_dispatch(change):
    # Final review M7: shared later with dispatchAs = user, a direct dispatch by the
    # system session would not run as the owner.
    w = World()
    j = _add_direct(w)
    if change is None:
        del w.gw.saved_searches[("alice", "mine")]
        w.gw.upsert_saved_search("bob", "mine", "index=b", "-1h", "now")
        w.gw.saved_searches[("bob", "mine")]["sharing"] = "global"
    else:
        w.gw.saved_searches[("alice", "mine")].update(change)
    run_id = cron_run(w, j)
    assert not w.gw.dispatch_log
    failed = w.audit.of("step_attempt", run_id=run_id, step_id="a", outcome="failed")
    assert failed and "no longer a private search of alice" in failed[0]["error"]


def test_direct_mode_dispatches_when_still_private():
    w = World()
    j = _add_direct(w)
    run_id = cron_run(w, j)
    assert len(w.gw.dispatch_log) == 1 and w.gw.dispatch_log[0]["name"] == "mine"
    assert w.step(run_id, "a")["state"] in ("running", "succeeded")


def test_action_submitted_audited_only_with_actions():
    w = World()
    j = w.add_job(make_job(steps=["a"], actions=[
        {"hook": "on_success", "type": "event", "index": "main", "payload": "done",
         "hidden_search": "_so_j_action_0_0123abcd"}]))
    run_id = cron_run(w, j)
    for _ in range(3):
        w.tick(advance=5)
    assert w.run(run_id)["state"] == "succeeded"
    assert w.audit.of("action_submitted", run_id=run_id, hook="on_success", scope="job")
    assert not w.audit.of("action_submitted", run_id=run_id, hook="on_start")


# --- From previous steps --------------------------------------------------------

NEVER = {"kind": "expression", "value": "$a.resultCount$ < 0"}


def test_previous_input_skips_unsucceeded():
    from so import tokens
    w = World()
    j = w.add_job(make_job(steps=["a", {"id": "s", "run_when": NEVER}, "f",
                                  {"id": "p", "type": "previous", "spl": "| stats count"}],
                           edges=[("a", "s"), ("a", "f"), ("a", "p"), ("s", "p"),
                                  ("f", "p", "on_failure")]),
                  scripts={"f": {"states": ["failed"], "error": "bad search"}})
    run_id = cron_run(w, j)
    for _ in range(4):
        w.tick(advance=5)
    assert w.step(run_id, "s")["state"] == "skipped"
    assert w.step(run_id, "f")["state"] == "failed"
    a_sid = w.step(run_id, "a")["sid"]
    p_dispatch = w.dispatched("p")
    assert [d["name"] for d in p_dispatch] == [j["steps"][3]["hidden_search"]]
    assert p_dispatch[0]["args"] == {"so_input": '"%s"' % a_sid}

    w2 = World()
    j2 = w2.add_job(make_job(steps=["a", {"id": "s", "run_when": NEVER},
                                    {"id": "p", "type": "previous",
                                     "spl": '| stats count | eval r="$run.id$"'}],
                             edges=[("a", "s"), ("s", "p")]))
    run2 = cron_run(w2, j2)
    for _ in range(3):
        w2.tick(advance=5)
    assert w2.step(run2, "s")["state"] == "skipped"
    p_dispatch = w2.dispatched("p")
    # No input succeeded: the no-inputs search runs, with the tail's args only.
    assert [d["name"] for d in p_dispatch] == [j2["steps"][2]["hidden_search_empty"]]
    assert p_dispatch[0]["args"] == {"run__id": run2}
    assert tokens.INPUT_ARG not in p_dispatch[0]["args"]
    assert w2.step(run2, "p")["state"] == "succeeded"
    assert w2.audit.of("step_dispatched", step_id="p")[0]["hidden_search"] == \
        j2["steps"][2]["hidden_search_empty"]


def test_previous_input_bad_sid_fails_the_attempt():
    bad = 'x" | delete'
    w = World()
    j = w.add_job(make_job(steps=["a", {"id": "p", "type": "previous", "spl": "| stats count"}],
                           edges=[("a", "p")]),
                  scripts={"a": {"states": ["running"]}})
    run_id = cron_run(w, j)
    run = w.run(run_id)
    run["steps"]["a"]["sid"] = bad
    w.store.save_run(run)
    w.gw.add_job(bad)
    w.tick(advance=5)
    w.tick(advance=5)
    assert w.step(run_id, "a")["state"] == "succeeded"
    p = w.step(run_id, "p")
    assert p["state"] == "failed" and "bad search id" in p["error"]
    assert not w.dispatched("p")


TRUNC = "Subsearch produced 100000 results, truncating to maxout [subsearch_maxout] 50000."


def test_previous_step_fails_on_subsearch_truncation():
    w = World()
    j = w.add_job(make_job(steps=["a", {"id": "p", "type": "previous", "spl": "| stats count"},
                                  {"id": "i", "spl": "| makeresults"}],
                           edges=[("a", "p"), ("a", "i")]),
                  scripts={"p": {"states": ["done"], "truncated": TRUNC},
                           "i": {"states": ["done"], "result_count": 1, "truncated": TRUNC}})
    run_id = cron_run(w, j)
    for _ in range(3):
        w.tick(advance=5)
    p = w.step(run_id, "p")
    assert p["state"] == "failed"
    assert p["error"] == "a subsearch was cut short: " + TRUNC
    assert w.step(run_id, "i")["state"] == "succeeded"


def test_previous_no_input_crash_after_dispatch_adopts_empty_search():
    w = World()
    j = w.add_job(make_job(steps=["a", {"id": "s", "run_when": NEVER},
                                  {"id": "p", "type": "previous", "spl": "| stats count"}],
                           edges=[("a", "s"), ("s", "p")]))
    run_id = cron_run(w, j)
    w.gw.crash_after_dispatch = True
    w.tick(advance=5)  # a done, s skipped, p dispatched and the engine "crashes"
    w.gw.crash_after_dispatch = False
    assert len(w.dispatched("p")) == 1
    p = w.step(run_id, "p")
    assert p["state"] == "starting" and not p.get("sid")
    w.engine = w.new_engine()
    w.tick(advance=5)
    p = w.step(run_id, "p")
    assert p["state"] == "succeeded" and p["sid"] == w.dispatched("p")[0]["sid"]
    assert len(w.dispatched("p")) == 1
    assert w.dispatched("p")[0]["name"] == j["steps"][2]["hidden_search_empty"]
    assert w.audit.of("step_adopted", run_id=run_id, step_id="p")


def test_previous_old_definition_without_empty_search_fails_with_resave_message():
    # Stored before hidden_search_empty existed: with every input skipped there is no
    # search to dispatch, so the attempt fails and says to re-save the job.
    w = World()
    job = make_job(steps=["a", {"id": "s", "run_when": NEVER},
                          {"id": "p", "type": "previous", "spl": "| stats count"}],
                   edges=[("a", "s"), ("s", "p")])
    del job["steps"][2]["hidden_search_empty"]
    j = w.add_job(job)
    run_id = cron_run(w, j)
    for _ in range(3):
        w.tick(advance=5)
    p = w.step(run_id, "p")
    assert p["state"] == "failed"
    assert p["error"] == ("step 'p' has no hidden saved search in its definition; re-save the "
                          "job to create it")
    assert not w.dispatched("p")
    assert w.run(run_id)["state"] in ("failed", "blocked")
