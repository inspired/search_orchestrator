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


# Review fixes.

def test_no_upstream_between_visible_and_hidden_rows(w):
    saved(w, "alice", cron_job("mine", "0 3 * * *", name="Mine"))
    saved(w, "bob", job_body("theirs", name="Theirs", run_roles=[],
                             triggers=[{"type": "completion", "job": "mine"}]))
    saved(w, "bob", cron_job("bobup", "0 4 * * *", run_roles=[]))
    saved(w, "alice", job_body("after", name="After", triggers=[{"type": "completion", "job": "bobup"}]))
    rows = w.call("alice", "GET", "/orchestrator/schedule")[1]["jobs"]
    assert all(r["upstream"] is None for r in rows)
    assert sum(1 for r in rows if r["hidden"]) == 2


def test_active_run_counts_past_now_and_triggers_dependents(w):
    saved(w, "alice", job_body("long", name="Long"))
    saved(w, "alice", job_body("next", name="Next", triggers=[{"type": "completion", "job": "long"}]))
    add_run(w, "long:old", "long", start=T0 - 86400)  # profile: a 0-60, b 60-120
    add_run(w, "long:now", "long", state="running", start=T0 - 30,
            steps={"a": {"state": "running", "started_at": T0 - 30}, "b": {"state": "waiting"}})
    out = w.call("alice", "GET", "/orchestrator/schedule")[1]
    # a until T0+30, b until T0+90 (estimated), then Next's a and b until T0+210
    assert out["load"] == [[T0 - 8 * HOUR, 0], [T0 - 30, 1], [T0 + 210, 0]]
    rows = {r["key"]: r for r in out["jobs"]}
    assert rows["next"]["bars"][0]["start"] == T0 - 30 + 120


def test_profiles_for_jobs_crowded_out_of_the_scan(w, monkeypatch):
    from so import schedule_api
    monkeypatch.setattr(schedule_api, "HISTORY_SCAN", 1)
    saved(w, "alice", cron_job("busy", "* * * * *"))
    saved(w, "alice", cron_job("nightly", "0 3 * * *", steps=[{"id": "a", "type": "inline", "spl": "| makeresults"}],
                               edges=[]))
    add_run(w, "busy:r", "busy", start=T0 - 60)
    add_run(w, "nightly:r", "nightly", start=T0 - 86400,
            steps={"a": {"state": "succeeded", "started_at": T0 - 86400, "ended_at": T0 - 86400 + 7200}})
    rows = {r["key"]: r for r in w.call("alice", "GET", "/orchestrator/schedule")[1]["jobs"]}
    nightly = [b for b in rows["nightly"]["bars"] if b["state"] == "scheduled"][0]
    assert nightly["end"] - nightly["start"] == 7200


def test_preview_ticks_and_malformed_draft(w):
    out = w.call("alice", "POST", "/orchestrator/schedule/preview",
                 {"job": cron_job("x", "0 2 * * *", timezone="Asia/Kolkata")})[1]
    assert out["ticks"][0][1] == "09:00"  # T0 01:00 UTC is 06:30 in Kolkata; next 3-hour mark
    bad = {"id": "x", "steps": [{"id": "a"}, "junk"], "edges": None, "triggers": ["x", {"type": "cron", "cron": "0 1 * * *"}],
           "timezone": 5}
    status, out = w.call("alice", "POST", "/orchestrator/schedule/preview", {"job": bad})
    assert status == 200, out
    assert out["timezone"] is None and out["schedules"][0]["index"] == 0


def test_preview_monthly_window_is_around_the_next_run(w):
    # T0 is Tue 1 Dec 01:00 UTC; the 20th is 19 days away
    out = w.call("alice", "POST", "/orchestrator/schedule/preview", {"job": cron_job("m", "0 2 20 * *")})[1]
    nxt = T0 + 19 * 86400 + 3600
    assert out["from"] == nxt - 3 * 86400 and out["to"] == out["from"] + 7 * 86400
    assert [r["start"] for r in out["schedules"][0]["runs"]] == [nxt]
    soon = w.call("alice", "POST", "/orchestrator/schedule/preview", {"job": cron_job("m", "0 2 3 * *")})[1]
    assert soon["from"] == T0
