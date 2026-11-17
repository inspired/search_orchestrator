import calendar

import pytest

from fakes import FakeGateway
from so import cron as cronmod
from so import scheduler
from so.store import Store

# Tuesday 1 December 2026, 01:00 UTC.
T0 = calendar.timegm((2026, 12, 1, 1, 0, 0))
DAY = 86400


def job(cron="0 1 * * *", **over):
    j = {"_key": "j", "id": "j", "owner": "alice", "enabled": True, "timezone": "UTC",
         "triggers": [{"type": "cron", "cron": cron}] if cron else [], "params": [],
         "steps": [{"id": "a", "type": "inline", "spl": "| makeresults"}], "edges": [],
         "actions": [], "defaults": {}}
    j.update(over)
    return j


def test_no_slots_before_first_check():
    assert scheduler.due_runs(job(), None, T0) == []


def test_on_time_slot_fires_once():
    assert scheduler.due_runs(job(), T0 - 5, T0) == [T0]
    assert scheduler.due_runs(job(), T0, T0 + 5) == []


def test_catchup_all_capped_at_7_oldest_first():
    slots = scheduler.due_runs(job(catchup="all"), T0 - 30 * DAY, T0)
    assert slots == [T0 - 6 * DAY + i * DAY for i in range(7)]
    # default policy is all
    assert scheduler.due_runs(job(), T0 - 30 * DAY, T0) == slots


def test_catchup_latest_and_none():
    assert scheduler.due_runs(job(catchup="latest"), T0 - 30 * DAY, T0 + 3600) == [T0]
    # none: missed slots are skipped, an on-time slot still fires
    assert scheduler.due_runs(job(catchup="none"), T0 - 30 * DAY, T0 + 3600) == []
    assert scheduler.due_runs(job(catchup="none"), T0 - 30 * DAY, T0 + 10) == [T0]


def test_catchup_work_is_bounded_for_every_minute_cron(monkeypatch):
    calls = []
    real = cronmod.slots_between

    def counting(spec, start, end, tz):
        calls.append(end - start)
        return real(spec, start, end, tz)

    monkeypatch.setattr(cronmod, "slots_between", counting)
    slots = scheduler.due_runs(job(cron="* * * * *"), T0 - 365 * DAY, T0)
    assert slots == [T0 - 360 + 60 * i for i in range(7)]
    assert len(calls) == 1 and max(calls) <= DAY + 1


def test_disabled_or_cronless_job_has_no_slots():
    assert scheduler.due_runs(job(enabled=False), T0 - 5, T0) == []
    assert scheduler.due_runs(job(cron=None), T0 - 5, T0) == []


def test_bad_cron_is_ignored():
    assert scheduler.due_runs(job(cron="bad"), T0 - 5, T0) == []


def test_create_run_keys_and_snapshot():
    gw = FakeGateway()
    store = Store(gw)
    j = job()
    run_id = scheduler.create_run(store, j, "cron", T0, {}, now=T0)
    assert run_id == "j:%d" % T0
    assert scheduler.create_run(store, j, "cron", T0, {}, now=T0) is None  # same slot
    run = store.get_run(run_id)
    assert run["state"] == "queued" and run["definition"]["steps"] == j["steps"]
    assert run["owner"] == "alice" and run["scheduled_time"] == T0
    assert run["steps"] == {"a": {"state": "waiting"}}
    chained = scheduler.create_run(store, j, "on_success", T0, {}, upstream="up:1", now=T0)
    assert chained == "j:up:1:on_success"
    assert scheduler.create_run(store, j, "on_success", T0, {}, upstream="up:1", now=T0) is None


def test_create_run_validates_params():
    store = Store(FakeGateway())
    j = job(params=[{"name": "n", "type": "number"}])
    from so.tokens import TokenError
    with pytest.raises(TokenError):
        scheduler.create_run(store, j, "manual", T0, {"n": "x"}, now=T0)
    run_id = scheduler.create_run(store, j, "manual", T0, {"n": "007"}, now=T0)
    assert store.get_run(run_id)["params"] == {"n": "7"}


def test_run_keys_match_run_id_pattern():
    cron = scheduler.run_key("daily", "cron", 1800000000)
    manual = scheduler.run_key("daily-2", "manual", 1)
    chained = scheduler.run_key("down", "start_job", 1, upstream=cron)
    deeper = scheduler.run_key("down_2", "completion", 1, upstream=chained)
    for key in (cron, manual, chained, deeper):
        assert scheduler.is_run_id(key), key
    for bad in ("..", "x", "a/b:c", "a:..", ":a", "a::b", "a:b c", None, "a:" + "b" * 2050):
        assert not scheduler.is_run_id(bad), bad


def test_cron_run_gets_a_deadline_manual_run_none():
    store = Store(FakeGateway())
    j = job(deadline={"within": 3600})
    run = store.get_run(scheduler.create_run(store, j, "cron", T0, {}, now=T0))
    assert run["deadline_at"] == T0 + 3600 and run["late_at"] is None
    late = store.get_run(scheduler.create_run(store, j, "cron", T0 - DAY, {}, now=T0,
                                              catchup=True))
    assert late["deadline_at"] is None
    manual = store.get_run(scheduler.create_run(store, j, "manual", T0, {}, now=T0))
    assert manual["deadline_at"] is None and manual["late_at"] is None
    chained = store.get_run(scheduler.create_run(store, j, "completion", T0, {},
                                                 upstream="up:1", now=T0))
    assert chained["deadline_at"] == T0 + 3600


def test_run_without_deadline_job_has_no_deadline():
    store = Store(FakeGateway())
    run = store.get_run(scheduler.create_run(store, job(), "cron", T0, {}, now=T0))
    assert run["deadline_at"] is None and "deadline" not in run["definition"]


def test_rerun_keeps_the_runs_deadline_and_late_mark():
    from so import state as statemod
    store = Store(FakeGateway())
    run = store.get_run(scheduler.create_run(store, job(deadline={"within": 3600}), "cron",
                                             T0, {}, now=T0))
    run.update(state="failed", late_at=T0 + 3600)
    new = statemod.reset_for_rerun(run, "a", T0 + DAY, scheduler.snapshot(job()))
    assert new["deadline_at"] == T0 + 3600 and new["late_at"] == T0 + 3600


def test_backfill_run_key():
    key = scheduler.run_key("j", "backfill", 100, backfill="bf0123456789ab")
    assert key == "j:backfill-bf0123456789ab:100"
    assert scheduler.is_run_id(key)


def test_create_run_stores_backfill():
    store = Store(FakeGateway())
    run_id = scheduler.create_run(store, job(), "backfill", T0, {}, now=T0,
                                  backfill="bf0123456789ab")
    assert run_id == "j:backfill-bf0123456789ab:%d" % T0
    run = store.get_run(run_id)
    assert run["backfill"] == "bf0123456789ab" and run["deadline_at"] is None
    assert scheduler.create_run(store, job(), "backfill", T0, {}, now=T0,
                                backfill="bf0123456789ab") is None  # same slot
    plain = store.get_run(scheduler.create_run(store, job(), "manual", T0, {}, now=T0))
    assert plain["backfill"] is None
