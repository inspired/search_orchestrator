"""Job deadlines (spec section 5): when a run's deadline is and when it is late."""
import calendar

from so import deadline

T = calendar.timegm((2026, 12, 1, 0, 30, 0))  # Tuesday 1 December 2026, 00:30 UTC


def job(dl, tz="UTC"):
    return {"id": "j", "timezone": tz, "deadline": dl}


def test_within():
    assert deadline.deadline_at(job({"within": 3600}), T, "cron", False) == T + 3600


def test_finish_by_same_day():
    assert deadline.deadline_at(job({"finish_by": "06:00"}), T, "cron", False) \
        == calendar.timegm((2026, 12, 1, 6, 0, 0))


def test_finish_by_next_day():
    t = calendar.timegm((2026, 12, 1, 7, 0, 0))
    assert deadline.deadline_at(job({"finish_by": "06:00"}), t, "cron", False) \
        == calendar.timegm((2026, 12, 2, 6, 0, 0))


def test_finish_by_at_the_scheduled_minute_is_that_minute():
    t = calendar.timegm((2026, 12, 1, 6, 0, 0))
    assert deadline.deadline_at(job({"finish_by": "06:00"}), t, "cron", False) == t


def test_both_take_the_earlier():
    six = calendar.timegm((2026, 12, 1, 6, 0, 0))
    assert deadline.deadline_at(job({"finish_by": "06:00", "within": 3600}), T, "cron",
                                False) == T + 3600
    assert deadline.deadline_at(job({"finish_by": "06:00", "within": 86400}), T, "cron",
                                False) == six


def test_finish_by_dst():
    t = calendar.timegm((2026, 3, 28, 23, 30, 0))  # 00:30 in Oslo, the night clocks go forward
    assert deadline.deadline_at(job({"finish_by": "06:00"}, "Europe/Oslo"), t, "cron", False) \
        == calendar.timegm((2026, 3, 29, 4, 0, 0))


def test_finish_by_in_the_dst_gap_is_the_first_minute_after_it():
    t = calendar.timegm((2026, 3, 28, 23, 30, 0))
    # 02:30 does not exist in Oslo on 29 March 2026: 03:00 CEST (01:00 UTC) is next.
    assert deadline.deadline_at(job({"finish_by": "02:30"}, "Europe/Oslo"), t, "cron", False) \
        == calendar.timegm((2026, 3, 29, 1, 0, 0))


def test_chained_runs_have_a_deadline():
    for trigger in ("completion", "start_job"):
        assert deadline.deadline_at(job({"within": 60}), T, trigger, False) == T + 60


def test_no_deadline_for_manual_backfill_catchup():
    dl = job({"within": 3600})
    for trigger in ("manual", "rest", "backfill", "alert_action"):
        assert deadline.deadline_at(dl, T, trigger, False) is None
    assert deadline.deadline_at(dl, T, "cron", True) is None
    assert deadline.deadline_at({"id": "j", "timezone": "UTC"}, T, "cron", False) is None


def test_is_late():
    run = {"state": "queued", "deadline_at": T, "late_at": None}
    assert deadline.is_late(run, T)
    assert deadline.is_late(dict(run, state="paused"), T + 10)
    assert not deadline.is_late(dict(run, late_at=T), T + 10)
    assert not deadline.is_late(dict(run, state="succeeded"), T + 10)
    assert not deadline.is_late(run, T - 1)
    assert not deadline.is_late(dict(run, deadline_at=None), T + 10)
    assert not deadline.is_late({"state": "running"}, T + 10)  # a run from before 1.20.0


def test_shape_issues():
    assert deadline.shape_issues({"finish_by": "06:00"}) == []
    assert deadline.shape_issues({"within": 60}) == []
    assert deadline.shape_issues({"finish_by": "23:59", "within": 604800}) == []
    assert deadline.shape_issues({"finish_by": "6:00"}) == ["Finish by must be a time like 06:00"]
    assert deadline.shape_issues({"finish_by": "24:00"}) == ["Finish by must be a time like 06:00"]
    for bad in (59, 604801, 3600.5, "3600", True):
        assert deadline.shape_issues({"within": bad}) \
            == ["Finish within must be between 1 minute and 7 days"]
    assert deadline.shape_issues({}) == ["Set Finish by or Finish within, or remove the deadline"]
    assert deadline.shape_issues({"finish_by": None, "within": None}) \
        == ["Set Finish by or Finish within, or remove the deadline"]
    assert deadline.shape_issues([]) == ["deadline must be an object"]
    assert deadline.shape_issues("06:00") == ["deadline must be an object"]


def test_finish_by_repeated_hour_uses_the_second_one_when_the_first_has_passed():
    # 25 October 2026, Oslo: 02:00-03:00 happens twice (CEST 00:00-01:00 UTC, CET 01:00-02:00 UTC).
    t = calendar.timegm((2026, 10, 25, 0, 45, 0))  # 02:45 CEST, the first time round
    assert deadline.deadline_at(job({"finish_by": "02:30"}, "Europe/Oslo"), t, "cron", False) \
        == calendar.timegm((2026, 10, 25, 1, 30, 0))  # 02:30 CET
