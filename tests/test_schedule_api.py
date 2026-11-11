"""Schedule routes: GET schedule and POST schedule/preview."""
import pytest

from so.store import RUNS
from test_api import T0, World, job_body, saved  # noqa: F401  (T0 is Tue 2026-12-01 01:00 UTC)

HOUR = 3600


@pytest.fixture
def w():
    return World()


def cron_job(job_id, cron, name=None, **over):
    return job_body(job_id, name=name or job_id.title(), triggers=[{"type": "cron", "cron": cron}], **over)


def add_run(w, run_id, job_id, state="succeeded", start=None, end=None, steps=None):
    start = T0 - HOUR if start is None else start
    doc = {"_key": run_id, "id": run_id, "job_id": job_id, "owner": "alice", "state": state,
           "created_at": start, "queued_at": start, "started_at": start,
           "ended_at": end if end is not None else (None if state == "running" else start + 120),
           "scheduled_time": start, "delay_alerted": False,
           "steps": steps or {"a": {"state": "succeeded", "started_at": start, "ended_at": start + 60},
                              "b": {"state": "succeeded", "started_at": start + 60, "ended_at": start + 120}}}
    w.gw.kv_batch_save(RUNS, [doc])


def test_visible_hidden_and_load(w):
    saved(w, "alice", cron_job("mine", "30 2 * * *", name="Mine"))
    saved(w, "bob", cron_job("theirs", "30 2 * * *", name="Secret name", run_roles=[]))
    add_run(w, "theirs:r1", "theirs")
    status, out = w.call("alice", "GET", "/orchestrator/schedule")
    assert status == 200, out
    assert out["from"] == T0 - 8 * HOUR and out["to"] == T0 + 16 * HOUR
    rows = {r["key"]: r for r in out["jobs"]}
    assert rows["mine"]["name"] == "Mine" and not rows["mine"]["hidden"]
    hidden = rows["hidden-1"]
    assert hidden["hidden"] and hidden["name"] == "Hidden job 1"
    assert "Secret" not in str(out) and "theirs" not in str(out)
    assert all("id" not in b for b in hidden["bars"])
    past = [b for b in hidden["bars"] if b["state"] == "succeeded"]
    assert past and past[0]["start"] == T0 - HOUR
    # both jobs run two 60 s fallback steps at 02:30, one after the other: 2 searches at once
    slot = T0 + 90 * 60
    assert [slot, 2] in out["load"]
    assert rows["mine"]["next_run"] == slot
    assert [b for b in rows["mine"]["bars"] if b["state"] == "scheduled"][0]["estimated"] is True


def test_visible_runs_have_ids_and_running_counts_until_now(w):
    saved(w, "alice", job_body("mine"))
    add_run(w, "mine:r1", "mine", state="running", start=T0 - 300,
            steps={"a": {"state": "running", "started_at": T0 - 300}, "b": {"state": "waiting"}})
    out = w.call("alice", "GET", "/orchestrator/schedule")[1]
    bar = out["jobs"][0]["bars"][0]
    assert bar["id"] == "mine:r1" and bar["state"] == "running" and bar["end"] == T0
    assert [T0 - 300, 1] in out["load"]


def test_window_validation(w):
    assert w.call("alice", "GET", "/orchestrator/schedule", {"from": "x"})[0] == 400
    assert w.call("alice", "GET", "/orchestrator/schedule", {"from": T0, "to": T0})[0] == 400
    assert w.call("alice", "GET", "/orchestrator/schedule", {"from": T0, "to": T0 + 9 * 86400})[0] == 400
    status, out = w.call("alice", "GET", "/orchestrator/schedule", {"from": T0, "to": T0 + 7 * 86400})
    assert status == 200 and out["to"] == T0 + 7 * 86400


def test_dependent_row_points_at_upstream(w):
    saved(w, "alice", cron_job("up", "0 3 * * *", name="Up"))
    saved(w, "alice", job_body("down", name="Down", triggers=[{"type": "completion", "job": "up", "on": "success"}]))
    rows = {r["key"]: r for r in w.call("alice", "GET", "/orchestrator/schedule")[1]["jobs"]}
    assert rows["down"]["upstream"] == "up"
    dep = rows["down"]["bars"][0]
    assert dep["dependent"] and dep["start"] == T0 + 2 * HOUR + 120


def test_preview_requires_edit_rights(w):
    saved(w, "alice", cron_job("mine", "0 2 * * *"))
    status, out = w.call("carol", "POST", "/orchestrator/schedule/preview", {"job": cron_job("mine", "0 2 * * *")})
    assert status == 403
    assert w.call("alice", "POST", "/orchestrator/schedule/preview", {"job": "x"})[0] == 400


def test_preview_excludes_own_job_and_suggests(w):
    saved(w, "alice", cron_job("mine", "0 2 * * *"))
    for i in range(3):
        saved(w, "bob", cron_job("busy%d" % i, "0 2 * * *"))
    draft = cron_job("mine", "0 2 * * *")
    status, out = w.call("alice", "POST", "/orchestrator/schedule/preview", {"job": draft})
    assert status == 200, out
    assert out["to"] - out["from"] == 86400 and out["timezone"] == "UTC"
    two = T0 + HOUR
    assert [two, 3] in out["load"]  # three other jobs, not this one
    sched = out["schedules"][0]
    assert sched["index"] == 0 and sched["runs"][0]["start"] == two
    assert sched["suggestion"]["peak"] <= 1
    assert sched["suggestion"]["hour"] in (1, 2)


def test_preview_weekly_uses_seven_days_and_new_job(w):
    draft = cron_job("brandnew", "0 2 * * 1")
    del draft["id"]
    status, out = w.call("alice", "POST", "/orchestrator/schedule/preview", {"job": draft})
    assert status == 200, out
    assert out["to"] - out["from"] == 7 * 86400
    assert len(out["schedules"][0]["runs"]) == 1
    assert out["schedules"][0]["suggestion"] is None  # nothing else runs: nothing quieter
