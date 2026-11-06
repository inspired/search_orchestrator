from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from so.cron import CronError, matches, next_slot, parse, prev_slot, slots_between

OSLO = ZoneInfo("Europe/Oslo")
UTC = ZoneInfo("UTC")


def ts(s, tz):
    return int(datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=tz).timestamp())


def ts_utc(s):
    return ts(s, UTC)


def test_cron_monday():
    assert matches(parse("0 1 * * 1"), ts("2026-11-02 01:00", OSLO), OSLO)
    assert not matches(parse("0 1 * * 1"), ts("2026-11-03 01:00", OSLO), OSLO)


def test_cron_timezone_matters():
    assert not matches(parse("0 1 * * 1"), ts("2026-11-02 01:00", UTC), OSLO)


def test_fields():
    s = parse("*/15 8-10 1,15 jan-mar mon-fri")
    assert s.minutes == {0, 15, 30, 45} and s.hours == {8, 9, 10}
    assert s.months == {1, 2, 3} and s.dows == {1, 2, 3, 4, 5}
    assert parse("0 0 * * 7").dows == {0}
    assert parse("5/20 * * * *").minutes == {5, 25, 45}


@pytest.mark.parametrize("bad", ["", "* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *",
                                 "*/0 * * * *", "5-1 * * * *", "a * * * *", "1,, * * * *"])
def test_bad(bad):
    with pytest.raises(CronError):
        parse(bad)


def test_dom_dow_or():
    s = parse("0 0 13 * 5")
    assert matches(s, ts("2026-11-13 00:00", UTC), UTC)  # Friday the 13th
    assert matches(s, ts("2026-11-06 00:00", UTC), UTC)  # Friday
    assert matches(s, ts("2026-12-13 00:00", UTC), UTC)  # Sunday the 13th
    assert not matches(s, ts("2026-11-07 00:00", UTC), UTC)


def test_cron_dst_gap_fires_once_at_next_valid():
    r = slots_between(parse("30 2 * * *"), ts_utc("2027-03-28 00:00"), ts_utc("2027-03-28 06:00"), OSLO)
    assert len(r) == 1 and r[0] == ts_utc("2027-03-28 01:00")


def test_cron_dst_repeat_fires_once():
    r = slots_between(parse("30 2 * * *"), ts_utc("2027-10-30 22:00"), ts_utc("2027-10-31 06:00"), OSLO)
    assert len(r) == 1 and r[0] == ts_utc("2027-10-31 00:30")


def test_slots_half_open_and_sorted():
    r = slots_between(parse("0 * * * *"), ts_utc("2026-11-05 10:00"), ts_utc("2026-11-05 13:00"), UTC)
    assert r == [ts_utc("2026-11-05 10:00"), ts_utc("2026-11-05 11:00"), ts_utc("2026-11-05 12:00")]


def test_unknown_tz_falls_back(caplog):
    assert isinstance(slots_between(parse("0 1 * * *"), 0, 86400 * 2, "No/Such_Zone"), list)
    assert "unavailable" in caplog.text


def test_superscript_digit_is_cron_error():
    for bad in ("² * * * *", "*/² * * * *"):
        with pytest.raises(CronError):
            parse(bad)


@pytest.fixture
def local_tz(monkeypatch):
    import time as _t
    if not hasattr(_t, "tzset"):
        pytest.skip("tzset unavailable")
    monkeypatch.setenv("TZ", "Europe/Oslo")
    _t.tzset()
    yield
    monkeypatch.undo()
    _t.tzset()


def test_local_fallback_is_dst_aware(local_tz):
    import so.cron as c
    spec = parse("0 12 * * *")
    for tz in (None, "No/Such_Zone"):
        for day, utc_hour in (("2026-01-15", 11), ("2026-06-15", 10)):
            r = c.slots_between(spec, ts_utc(day + " 00:00"), ts_utc(day + " 23:59"), tz)
            assert r == [ts_utc("%s %02d:00" % (day, utc_hour))]
    assert c.matches(spec, ts_utc("2026-06-15 10:00"), None)


def test_local_fallback_dst_gap_and_repeat(local_tz):
    spec = parse("30 2 * * *")
    gap = slots_between(spec, ts_utc("2027-03-28 00:00"), ts_utc("2027-03-28 06:00"), None)
    assert gap == [ts_utc("2027-03-28 01:00")]
    rep = slots_between(spec, ts_utc("2027-10-30 22:00"), ts_utc("2027-10-31 06:00"), None)
    assert rep == [ts_utc("2027-10-31 00:30")]


def test_tz_status(monkeypatch):
    import so.cron as c
    assert c.tz_status("Europe/Oslo") == "ok"
    assert c.tz_status("No/Such_Zone") == "unknown"
    assert c.tz_status("../etc") == "unknown"

    def boom(name):
        raise c.ZoneInfo.__class__("x") if False else KeyError(name)
    monkeypatch.setattr(c, "ZoneInfo", boom)
    assert c.tz_status("Europe/Oslo") == "unavailable"
    monkeypatch.setattr(c, "ZoneInfo", None)
    assert c.tz_status("Europe/Oslo") == "unavailable"


def test_prev_slot_is_mirror_of_next_slot():
    spec = parse("0 1 * * *")
    now = ts("2026-11-10 13:30", OSLO)
    before = prev_slot(spec, now, OSLO, 2)
    after = next_slot(spec, now, OSLO, 2)
    assert before == ts("2026-11-10 01:00", OSLO) and after == ts("2026-11-11 01:00", OSLO)
    assert before <= now < after
    # Strictly before: a slot exactly at ``before`` is not returned.
    assert prev_slot(spec, before, OSLO, 2) == ts("2026-11-09 01:00", OSLO)
    assert prev_slot(spec, before + 1, OSLO, 2) == before
    assert prev_slot(parse("0 1 30 2 *"), now, OSLO, 400) is None
    monday = parse("0 1 * * 1")
    assert prev_slot(monday, now, UTC, 1) is None  # Tuesday: looks at Wednesday and Tuesday
    assert prev_slot(monday, now, UTC, 2) == ts_utc("2026-11-09 01:00")
