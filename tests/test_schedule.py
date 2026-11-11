"""Schedule projection: profiles, run_when, cron slots, chains, load, merging, suggestions."""
import calendar

from so import schedule

DAY = 86400
# Tuesday 2026-12-01 00:00 UTC
T0 = calendar.timegm((2026, 12, 1, 0, 0, 0))


def job(job_id="j", cron="0 2 * * *", steps=None, edges=None, **over):
    out = {"id": job_id, "name": job_id.upper(), "enabled": True, "timezone": "UTC",
           "steps": steps if steps is not None else [{"id": "a", "type": "inline", "spl": "| makeresults"},
                                                     {"id": "b", "type": "inline", "spl": "| makeresults"}],
           "edges": edges if edges is not None else [{"from": "a", "to": "b"}],
           "triggers": [{"type": "cron", "cron": cron}] if cron else []}
    out.update(over)
    return out


def run(started, steps, state="succeeded"):
    return {"state": state, "started_at": started, "steps": steps}


# Profiles.

def test_profile_from_most_recent_succeeded_attempt():
    history = [run(1000, {"a": {"state": "succeeded", "started_at": 1000, "ended_at": 1030},
                          "b": {"state": "failed", "started_at": 1030, "ended_at": 1031}}),
               run(500, {"a": {"state": "succeeded", "started_at": 500, "ended_at": 600},
                         "b": {"state": "succeeded", "started_at": 610, "ended_at": 700}})]
    assert schedule.profile(job(), history, 4) == {"a": (0, 30), "b": (110, 90)}


def test_profile_fallback_follows_graph_and_cap():
    j = job(steps=[{"id": x, "type": "inline", "spl": "| makeresults"} for x in "abcd"],
            edges=[{"from": "a", "to": "d"}])
    prof = schedule.profile(j, [], 2)
    assert prof["a"] == (0, 60) and prof["b"] == (0, 60)
    assert prof["c"] == (60, 60)  # two already run at 0
    assert prof["d"] == (60, 60)  # after a
    assert all(d == schedule.FALLBACK_STEP_SECONDS for _, d in prof.values())


# Which steps run.

def test_cron_run_when_drops_step_on_other_days():
    j = job(steps=[{"id": "a", "type": "inline", "spl": "| makeresults"},
                   {"id": "mon", "type": "inline", "spl": "| makeresults",
                    "run_when": {"kind": "cron", "value": "* * * * 1"}},
                   {"id": "after", "type": "inline", "spl": "| makeresults"}],
            edges=[{"from": "a", "to": "mon"}, {"from": "mon", "to": "after"}])
    tuesday, monday = T0, T0 + 6 * DAY
    assert schedule.steps_for_slot(j, tuesday) == {"a", "after"}  # run_when skip passes on_success
    assert schedule.steps_for_slot(j, monday) == {"a", "mon", "after"}


def test_expression_run_when_and_edges_count_as_taken():
    j = job(steps=[{"id": "a", "type": "inline", "spl": "| makeresults"},
                   {"id": "x", "type": "inline", "spl": "| makeresults",
                    "run_when": {"kind": "expression", "value": "$step.a.result_count$ > 5"}},
                   {"id": "y", "type": "inline", "spl": "| makeresults"},
                   {"id": "f", "type": "inline", "spl": "| makeresults"}],
            edges=[{"from": "a", "to": "x"},
                   {"from": "a", "to": "y", "condition": "expression", "expression": "1 == 2"},
                   {"from": "a", "to": "f", "condition": "on_failure"}])
    assert schedule.steps_for_slot(j, T0) == {"a", "x", "y"}


def test_cycle_counts_every_step():
    j = job(edges=[{"from": "a", "to": "b"}, {"from": "b", "to": "a"}])
    assert schedule.steps_for_slot(j, T0) == {"a", "b"}


# Projection.

def test_project_uses_cron_slots_in_time_zone_and_profile():
    j = job(cron="0 2 * * *", timezone="Europe/Oslo")
    prof = {"a": (0, 30), "b": (30, 60)}
    runs = schedule.project(j, prof, T0, T0 + 2 * DAY, T0)
    oslo_2am = T0 + 1 * 3600  # 02:00 in Oslo (UTC+1) is 01:00 UTC
    assert [r["start"] for r in runs] == [oslo_2am, oslo_2am + DAY]
    assert runs[0]["steps"] == [(oslo_2am, oslo_2am + 30), (oslo_2am + 30, oslo_2am + 90)]
    assert runs[0]["end"] == oslo_2am + 90


def test_project_skips_past_disabled_and_bad_cron():
    assert schedule.project(job(), {}, T0, T0 + DAY, T0 + 3 * 3600) == []  # 02:00 already passed
    assert schedule.project(job(enabled=False), {}, T0, T0 + DAY, T0) == []
    bad = job(triggers=[{"type": "cron", "cron": "nope"}, {"type": "cron", "cron": "0 3 * * *", "enabled": False}])
    assert schedule.project(bad, {}, T0, T0 + DAY, T0) == []


def test_dependents_start_at_upstream_end_and_loops_stop():
    up = job("up")
    dep = job("dep", cron=None, triggers=[{"type": "completion", "job": "up", "on": "success"}])
    prof = {"a": (0, 100), "b": (100, 100)}
    jobs = {"up": up, "dep": dep}
    projected = {"up": schedule.project(up, prof, T0, T0 + DAY, T0)}
    out = schedule.project_dependents(jobs, {"dep": prof}, projected, T0 + DAY)
    start = T0 + 2 * 3600 + 200
    assert [r["start"] for r in out["dep"]] == [start]
    assert out["dep"][0]["dependent"] is True and out["dep"][0]["upstream"] == "up"

    a = job("a", cron=None, triggers=[{"type": "completion", "job": "b"}])
    b = job("b", triggers=[{"type": "cron", "cron": "0 1 * * *"}, {"type": "completion", "job": "a"}])
    loop = schedule.project_dependents({"a": a, "b": b}, {"a": prof, "b": prof},
                                       {"b": schedule.project(b, prof, T0, T0 + DAY, T0)}, T0 + DAY)
    total = len(loop.get("a", [])) + len(loop.get("b", []))
    assert 0 < total <= schedule.CHAIN_LIMIT


# Load.

def test_run_intervals_running_step_until_now():
    r = {"steps": {"a": {"state": "succeeded", "started_at": 10, "ended_at": 20},
                   "b": {"state": "running", "started_at": 15},
                   "c": {"state": "waiting"}}}
    assert sorted(schedule.run_intervals(r, 30)) == [(10, 20), (15, 30)]


def test_load_series_counts_overlaps_and_clips():
    series = schedule.load_series([(0, 10), (5, 15), (5, 8), (20, 30)], 2, 25)
    assert series == [[2, 1], [5, 3], [8, 2], [10, 1], [15, 0], [20, 1]]
    assert schedule.load_series([], 0, 10) == [[0, 0]]
    assert schedule.peak(series, [(9, 11)]) == 2
    assert schedule.peak(series, [(16, 19)]) == 0


def test_merge_dense_keeps_failed_and_caps():
    window = 400 * 10  # gap threshold 10 s
    bars = [{"state": "succeeded", "start": t, "end": t + 2} for t in range(0, 50, 5)]
    bars.append({"state": "failed", "start": 52, "end": 53})
    bars += [{"state": "succeeded", "start": t, "end": t + 2} for t in (55, 60)]
    out = schedule.merge_dense(bars, 0, window)
    assert [b.get("kind") for b in out] == ["span", None, "span"]
    assert out[0]["count"] == 10 and out[0]["start"] == 0 and out[0]["end"] == 47
    many = [{"state": "failed", "start": t, "end": t + 1} for t in range(0, 6000, 10)]
    assert len(schedule.merge_dense(many, 0, 6000)) == schedule.MAX_BARS_PER_JOB


def test_is_daily():
    assert schedule.is_daily(job())
    assert not schedule.is_daily(job(cron="0 2 * * 1"))
    assert not schedule.is_daily(job(steps=[{"id": "a", "type": "inline", "spl": "| makeresults",
                                            "run_when": {"kind": "cron", "value": "* * * * 1-5"}}], edges=[]))


# Suggestions.

def busy(at, count, length=600, days=1):
    return [(at + d * DAY, at + d * DAY + length) for d in range(days) for _ in range(count)]


def test_suggest_closest_clearly_quieter_time():
    j = job(cron="0 2 * * *", steps=[{"id": "a", "type": "inline", "spl": "| makeresults"}], edges=[])
    prof = {"a": (0, 300)}
    load = schedule.load_series(busy(T0 + 2 * 3600 - 1800, 9, length=3000) + busy(T0 + 2 * 3600 + 1200, 8, length=600),
                                T0, T0 + DAY)
    out = schedule.suggest(j, "0 2 * * *", prof, load, T0, T0 + DAY, 100)
    assert out == {"hour": 2, "minute": 30, "peak": 0, "base_peak": 9}  # the 8 end at 02:30


def test_suggest_none_when_not_clearly_quieter_or_not_single_time():
    j = job(steps=[{"id": "a", "type": "inline", "spl": "| makeresults"}], edges=[])
    flat = schedule.load_series([(T0, T0 + DAY)] * 3, T0, T0 + DAY)
    assert schedule.suggest(j, "0 2 * * *", {"a": (0, 60)}, flat, T0, T0 + DAY, 100) is None
    assert schedule.suggest(j, "*/5 * * * *", {"a": (0, 60)}, flat, T0, T0 + DAY, 100) is None
    assert schedule.suggest(j, "0 1,2 * * *", {"a": (0, 60)}, flat, T0, T0 + DAY, 100) is None
    assert schedule.suggest(j, "bad", {"a": (0, 60)}, flat, T0, T0 + DAY, 100) is None


def test_suggest_stays_within_two_hours_and_same_day():
    j = job(steps=[{"id": "a", "type": "inline", "spl": "| makeresults"}], edges=[])
    # busy all day except 04:00-04:30 and 23:00 the day before; typed 00:30
    load = schedule.load_series([(T0, T0 + 4 * 3600)] * 5 + [(T0 + 4 * 3600 + 1800, T0 + DAY)] * 5, T0, T0 + DAY)
    assert schedule.suggest(j, "30 0 * * *", {"a": (0, 60)}, load, T0, T0 + DAY, 100) is None
    out = schedule.suggest(j, "0 3 * * *", {"a": (0, 60)}, load, T0, T0 + DAY, 100)
    assert out["hour"] == 4 and out["minute"] == 0


def test_suggest_when_over_limit_even_if_only_one_lower():
    j = job(steps=[{"id": "a", "type": "inline", "spl": "| makeresults"}], edges=[])
    load = schedule.load_series([(T0 + 3600, T0 + 7800)] * 10 + [(T0 + 7800, T0 + 9000)] * 9, T0, T0 + DAY)
    out = schedule.suggest(j, "0 2 * * *", {"a": (0, 60)}, load, T0, T0 + DAY, 10)
    assert out == {"hour": 2, "minute": 10, "peak": 9, "base_peak": 10}


# Review fixes.

def test_dependent_steps_are_judged_at_upstream_scheduled_time():
    # upstream Friday 23:50 ends Saturday 00:10; the dependent's weekday step still runs,
    # because a chained run takes the upstream run's scheduled time
    friday = T0 + 3 * DAY  # Fri 2026-12-04 00:00
    up = job("up", cron="50 23 * * 5", steps=[{"id": "a", "type": "inline", "spl": "| makeresults"}], edges=[])
    dep = job("dep", cron=None, triggers=[{"type": "completion", "job": "up"}],
              steps=[{"id": "wk", "type": "inline", "spl": "| makeresults",
                      "run_when": {"kind": "cron", "value": "* * * * 1-5"}}], edges=[])
    projected = {"up": schedule.project(up, {"a": (0, 1200)}, friday, friday + 2 * DAY, friday)}
    out = schedule.project_dependents({"up": up, "dep": dep}, {"dep": {"wk": (0, 60)}}, projected, friday + 2 * DAY)
    run = out["dep"][0]
    assert run["start"] == friday + 86400 + 600 and run["scheduled"] == friday + 23 * 3600 + 50 * 60
    assert run["steps"] == [(run["start"], run["start"] + 60)]


def test_two_completion_triggers_on_one_upstream_fire_once():
    up = job("up")
    dep = job("dep", cron=None, triggers=[{"type": "completion", "job": "up", "on": "success"},
                                          {"type": "completion", "job": "up", "on": "complete"}])
    prof = {"a": (0, 60), "b": (60, 60)}
    projected = {"up": schedule.project(up, prof, T0, T0 + DAY, T0)}
    out = schedule.project_dependents({"up": up, "dep": dep}, {"dep": prof}, projected, T0 + DAY)
    assert len(out["dep"]) == 1


def test_remaining_counts_an_active_run_until_its_estimated_end():
    prof = {"a": (0, 600), "b": (600, 300)}
    now = T0 + 120
    active = {"started_at": T0, "scheduled_time": T0,
              "steps": {"a": {"state": "running", "started_at": T0}, "b": {"state": "waiting"}}}
    rest = schedule.remaining(job(), prof, active, now)
    assert rest["steps"] == [(now, T0 + 600), (T0 + 600, T0 + 900)]
    assert rest["end"] == T0 + 900
    # a step that overran its estimate still counts a little past now, then the next one
    late = schedule.remaining(job(), prof, active, T0 + 700)
    assert late["steps"] == [(T0 + 700, T0 + 1000)]
    dep = job("dep", cron=None, triggers=[{"type": "completion", "job": "j"}])
    out = schedule.project_dependents({"j": job(), "dep": dep}, {"dep": prof}, {}, T0 + DAY, {"j": [rest]})
    assert out["dep"][0]["start"] == T0 + 900


def test_local_ticks_follow_half_hour_zones():
    ticks = schedule.local_ticks(T0, T0 + DAY, "Asia/Kolkata")
    assert ticks[0] == [T0 + 30 * 60, "06:00"]  # 00:30 UTC is 06:00 in +05:30
    assert len(ticks) == 8
    week = schedule.local_ticks(T0, T0 + 7 * DAY, "Asia/Kolkata")
    assert week[0][0] == T0 + 18 * 3600 + 30 * 60 and week[0][1].endswith(" 2")


def test_malformed_job_shapes_do_not_raise():
    j = job(steps=[{"id": "a"}], edges=None)
    assert schedule.steps_for_slot(j, T0) == {"a"}
    assert schedule.profile(j, [], 4) == {"a": (0, 60)}
