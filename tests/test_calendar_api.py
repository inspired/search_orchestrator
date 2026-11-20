"""Calendar route (features-2 spec section 12)."""
from so import backfill
from test_api import T0, error, job_body, saved, w  # noqa: F401  (w is a fixture)

HOUR = 3600
DAY = 86400
EVERY_HOUR = [{"type": "cron", "cron": "0 * * * *"}]


def cal(w, user="alice", **query):
    query.setdefault("from", T0)
    query.setdefault("to", T0 + DAY)
    return w.call(user, "GET", "/orchestrator/calendar", query)


def items(w, user="alice", **query):
    status, out = cal(w, user, **query)
    assert status == 200, out
    return out["items"]


def test_future_slots_of_enabled_cron_trigger(w):
    saved(w, body=job_body(triggers=EVERY_HOUR))
    got = items(w, **{"from": T0 - 2 * HOUR})
    assert [i["kind"] for i in got] == ["scheduled"] * 24
    assert got[0] == {"kind": "scheduled", "job_id": "daily", "job_name": "Daily summary",
                      "time": T0}  # T0 is on the hour: slot at "now" counts, earlier ones do not
    assert all(i["time"] >= T0 for i in got)


def test_disabled_job_and_disabled_trigger_give_none(w):
    saved(w, body=job_body(triggers=EVERY_HOUR, enabled=False))
    saved(w, body=job_body("other", triggers=[dict(EVERY_HOUR[0], enabled=False)]))
    assert items(w) == []


def test_run_in_range_with_state_and_late(w):
    saved(w)
    run = w.store.get_run(_start(w))
    run.update(state="succeeded", started_at=T0 + 5, ended_at=T0 + 60, late_at=T0 + 1)
    w.store.save_run(run)
    got = items(w)
    assert got == [{"kind": "run", "job_id": "daily", "job_name": "Daily summary",
                    "run_id": run["id"], "state": "succeeded", "trigger": run["trigger"],
                    "scheduled_time": run["scheduled_time"], "started_at": T0 + 5,
                    "ended_at": T0 + 60, "late": True, "backfill_id": None}]
    run["late_at"] = None
    w.store.save_run(run)
    assert items(w)[0]["late"] is False


def _start(w):
    status, out = w.call("alice", "POST", "/orchestrator/jobs/daily/runs", {"params": {}})
    assert status == 201, out
    return out["run_id"]


def test_running_backfill_unused_slots(w):
    saved(w)
    slots = [T0 + i * HOUR for i in range(5)]
    w.gw.kv_insert(backfill.BACKFILLS, {"_key": "bf000000000001", "id": "bf000000000001",
                                       "job_id": "daily", "state": "running", "slots": slots,
                                       "next": 2})
    w.gw.kv_insert(backfill.BACKFILLS, {"_key": "bf000000000002", "id": "bf000000000002",
                                       "job_id": "daily", "state": "done", "slots": slots,
                                       "next": 0})
    got = items(w)
    assert [(i["kind"], i["time"], i["backfill_id"]) for i in got] == \
        [("backfill", t, "bf000000000001") for t in slots[2:]]
    assert got[0]["job_name"] == "Daily summary"


def test_job_id_filters_everything(w):
    saved(w, body=job_body(triggers=EVERY_HOUR))
    saved(w, body=job_body("other", triggers=EVERY_HOUR))
    got = items(w, job_id="other")
    assert got and {i["job_id"] for i in got} == {"other"}
    assert {i["job_id"] for i in items(w)} == {"daily", "other"}


def test_visible_jobs_only(w):
    saved(w, body=job_body(triggers=EVERY_HOUR))
    assert items(w, "bob") == []
    assert items(w, "bob", job_id="daily") == []
    assert items(w, "root")


def test_items_sorted_by_time(w):
    saved(w, body=job_body(triggers=EVERY_HOUR))
    run = w.store.get_run(_start(w))
    run.update(scheduled_time=T0 + 90 * 60)
    w.store.save_run(run)
    times = [i.get("time") or i["scheduled_time"] for i in items(w)]
    assert times == sorted(times) and T0 + 90 * 60 in times


def test_truncated_at_2000(w):
    every_minute = [{"type": "cron", "cron": "* * * * *"}]
    for n in range(7):  # 300 slots per job at most: 7 * 300 = 2100
        saved(w, body=job_body("j%d" % n, triggers=every_minute))
    status, out = cal(w, to=T0 + 8 * DAY)
    assert status == 200
    assert len(out["items"]) == 2000 and out["truncated"] is True
    status, out = cal(w, job_id="j0", to=T0 + 8 * DAY)
    assert len(out["items"]) == 300 and out["truncated"] is False


def test_range_errors(w):
    for query, message in [({"from": T0, "to": T0 + 8 * DAY + 1}, "Pick a range of at most 8 days"),
                           ({"from": T0, "to": T0}, "From must be before To"),
                           ({"from": T0 + 5, "to": T0}, "From must be before To"),
                           ({"from": "x", "to": T0}, "from and to must be epoch seconds"),
                           ({"to": T0}, "from and to must be epoch seconds")]:
        status, out = w.call("alice", "GET", "/orchestrator/calendar", query)
        assert (status, error(out)) == (400, "bad_range"), query
        assert out["error"]["message"] == message
    assert cal(w, to=T0 + 8 * DAY)[0] == 200


def test_no_capability_is_403(w):
    assert cal(w, "dave")[0] == 403
    assert cal(w, "carol")[0] == 200
