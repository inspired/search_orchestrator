import calendar
import copy

import pytest

from so import state

# Tuesday 1 December 2026, 01:00 UTC: the 1st of the month, not a Monday.
T0 = calendar.timegm((2026, 12, 1, 1, 0, 0))


def job(steps, edges=(), **over):
    """steps: ids or dicts; edges: (from, to[, condition[, expression]])."""
    out = []
    for s in steps:
        d = {"id": s} if isinstance(s, str) else dict(s)
        d.setdefault("type", "inline")
        d.setdefault("spl", "| makeresults")
        out.append(d)
    es = []
    for e in edges:
        es.append({"from": e[0], "to": e[1],
                   "condition": e[2] if len(e) > 2 else "on_success",
                   "expression": e[3] if len(e) > 3 else None})
    j = {"id": "j", "timezone": "UTC", "defaults": {}, "steps": out, "edges": es, "actions": []}
    j.update(over)
    return j


def make_run(definition, **over):
    r = {"_key": "r1", "id": "r1", "definition": definition, "state": "running",
         "scheduled_time": T0, "params": {}, "delay_base": T0, "giveup_base": T0,
         "paused_seconds": 0, "paused_at": None,
         "steps": {s["id"]: {"state": "waiting"} for s in definition["steps"]}}
    r.update(over)
    return r


def apply(run, effects):
    """Apply set_step/set_run effects as the engine would, returning a new run."""
    r = copy.deepcopy(run)
    for e in effects:
        if e[0] == "set_step":
            r["steps"].setdefault(e[1], {}).update(e[2])
        elif e[0] == "set_run":
            r.update(e[1])
    return r


def step(run, sid):
    return run["steps"][sid]


def starts(effects):
    return [e[1] for e in effects if e[0] == "start_step"]


def hooks(effects):
    return [e[1:] for e in effects if e[0] == "hook"]


def ev(run, now):
    effects = state.evaluate(run, now)
    return apply(run, effects), effects


def engine_start(run, sid, now, search="sid1"):
    r = copy.deepcopy(run)
    r["steps"][sid].update({"state": "running", "sid": search, "started_at": now})
    return r


def engine_finish(run, sid, now, ok=True, result_count=1, first=None, error=None):
    r = copy.deepcopy(run)
    r["steps"][sid].update({"outcome": "succeeded" if ok else "failed", "ended_at": now,
                            "result_count": result_count if ok else None,
                            "first": first if ok else None,
                            "error": None if ok else (error or "search failed")})
    return r


def run_step_to(run, sid, now, ok=True, **kw):
    """Start a ready step and finish it, then evaluate."""
    r = engine_start(run, sid, now)
    r = engine_finish(r, sid, now + 1, ok=ok, **kw)
    return ev(r, now + 1)


def chain():
    return job([
        "daily",
        {"id": "weekly", "run_when": {"kind": "cron", "value": "0 1 * * 1"}},
        {"id": "monthly", "run_when": {"kind": "cron", "value": "0 1 1 * *"}},
    ], [("daily", "weekly"), ("weekly", "monthly")])


# ---- Ordering and readiness ----

def test_serial_waits_for_dependency():
    r, eff = ev(make_run(job(["a", "b"], [("a", "b")])), T0)
    assert starts(eff) == ["a"]
    assert step(r, "a")["state"] == "ready" and step(r, "b")["state"] == "waiting"
    r = engine_start(r, "a", T0)
    r, eff = ev(r, T0 + 10)
    assert starts(eff) == [] and step(r, "b")["state"] == "waiting"
    r, eff = run_step_to(r, "a", T0 + 20)
    assert step(r, "a")["state"] == "succeeded"
    assert starts(eff) == ["b"]


def test_run_when_evaluated_only_after_dependencies():
    r, eff = ev(make_run(chain()), T0)
    # weekly does not apply tonight, but it must not be skipped while daily is unfinished,
    # so monthly must not be released early.
    assert step(r, "weekly")["state"] == "waiting"
    assert step(r, "monthly")["state"] == "waiting"
    assert starts(eff) == ["daily"]


def test_run_when_skip_releases_downstream():
    r, _ = ev(make_run(chain()), T0)
    r, eff = run_step_to(r, "daily", T0)
    assert step(r, "weekly")["state"] == "skipped"
    assert step(r, "weekly")["skip_kind"] == "run_when"
    assert step(r, "monthly")["state"] == "ready"
    assert starts(eff) == ["monthly"]


def test_unused_failure_branch_is_not_taken_and_stays_not_taken():
    j = job(["a", "cleanup", "after"], [("a", "cleanup", "on_failure"), ("cleanup", "after")])
    r, _ = ev(make_run(j), T0)
    r, eff = run_step_to(r, "a", T0)
    assert step(r, "cleanup")["state"] == "skipped"
    assert step(r, "cleanup")["skip_kind"] == "not_taken"
    assert step(r, "after")["state"] == "skipped"
    assert step(r, "after")["skip_kind"] == "not_taken"
    assert starts(eff) == []
    assert r["state"] == "succeeded"


def test_always_edge_leaves_not_taken_step():
    j = job(["a", "cleanup", "report"], [("a", "cleanup", "on_failure"), ("cleanup", "report", "always")])
    r, _ = ev(make_run(j), T0)
    r, eff = run_step_to(r, "a", T0)
    assert step(r, "cleanup")["skip_kind"] == "not_taken"
    assert step(r, "report")["state"] == "ready"
    assert starts(eff) == ["report"]


def _upstream_run(outcome, condition, expression=None):
    """Run with upstream u in the given outcome and edge u->d."""
    j = job(["u", "d"], [("u", "d", condition, expression)])
    r = make_run(j)
    u = {"succeeded": {"state": "succeeded", "result_count": 5, "sid": "s"},
         "failed": {"state": "failed", "result_count": None, "sid": "s", "error": "x"},
         "skipped_run_when": {"state": "skipped", "skip_kind": "run_when"},
         "skipped_not_taken": {"state": "skipped", "skip_kind": "not_taken"}}[outcome]
    if outcome == "failed":
        # handled so the run is not blocked; irrelevant to the edge itself
        j["steps"].append({"id": "h", "type": "inline", "spl": "x"})
        j["edges"].append({"from": "u", "to": "h", "condition": "always", "expression": None})
        r["steps"]["h"] = {"state": "running", "sid": "sh", "started_at": T0}  # keeps the run active
    r["steps"]["u"] = u
    return r


# satisfied -> d ready; not -> d skipped(not_taken); unresolved -> d waiting
EDGE_TABLE = [
    ("succeeded", "on_success", None, "ready"),
    ("succeeded", "on_failure", None, "not_taken"),
    ("succeeded", "always", None, "ready"),
    ("succeeded", "expression", "$u.resultCount$ > 0", "ready"),
    ("failed", "on_success", None, "waiting"),
    ("failed", "on_failure", None, "ready"),
    ("failed", "always", None, "ready"),
    ("failed", "expression", "$u.status$ == 'failed'", "ready"),
    ("skipped_run_when", "on_success", None, "ready"),
    ("skipped_run_when", "on_failure", None, "not_taken"),
    ("skipped_run_when", "always", None, "ready"),
    ("skipped_run_when", "expression", "$u.status$ == 'skipped'", "not_taken"),
    ("skipped_not_taken", "on_success", None, "not_taken"),
    ("skipped_not_taken", "on_failure", None, "not_taken"),
    ("skipped_not_taken", "always", None, "ready"),
    ("skipped_not_taken", "expression", "$u.status$ == 'skipped'", "not_taken"),
]


@pytest.mark.parametrize("outcome,condition,expression,expected", EDGE_TABLE)
def test_edge_table(outcome, condition, expression, expected):
    r, _ = ev(_upstream_run(outcome, condition, expression), T0)
    d = step(r, "d")
    if expected == "not_taken":
        assert d["state"] == "skipped" and d["skip_kind"] == "not_taken"
    else:
        assert d["state"] == expected


def test_expression_evaluated_false_is_not_taken():
    r, _ = ev(_upstream_run("succeeded", "expression", "$u.resultCount$ > 10"), T0)
    assert step(r, "d")["skip_kind"] == "not_taken"


def test_expression_with_missing_failed_token_is_false():
    r = _upstream_run("failed", "expression", "$u.resultCount$ == 0 or $u.first.host$ != 'x'")
    r["steps"]["u"]["result_count"] = 0  # a failed search's counts are not results
    r, _ = ev(r, T0)
    assert step(r, "d")["state"] == "skipped"
    assert step(r, "d")["skip_kind"] == "not_taken"


# ---- Failures, blocked and failed ----

def test_unhandled_leaf_failure_blocks_run():
    r, _ = ev(make_run(job(["a"])), T0)
    r, eff = run_step_to(r, "a", T0, ok=False)
    assert step(r, "a")["state"] == "failed"
    assert r["state"] == "blocked"
    assert ("step", "on_failure", "a") in hooks(eff)
    assert ("notify_fallback_check", "on_failure", "a") in eff
    r2, eff = ev(r, T0 + 60)
    assert r2["state"] == "blocked" and hooks(eff) == []


def test_handled_failure_ends_failed_not_blocked():
    j = job(["a", "b", "cleanup"], [("a", "b"), ("a", "cleanup", "on_failure")])
    r, _ = ev(make_run(j), T0)
    r, eff = run_step_to(r, "a", T0, ok=False)
    assert starts(eff) == ["cleanup"] and r["state"] == "running"
    r, eff = run_step_to(r, "cleanup", T0 + 10)
    assert r["state"] == "failed"
    assert step(r, "b")["state"] == "abandoned"
    assert ("job", "on_failure", None) in hooks(eff)


def test_blocked_only_after_nothing_else_can_progress():
    j = job(["a", "b", "c"], [("a", "c")])  # a and b in parallel, a fails
    r, eff = ev(make_run(j), T0)
    assert starts(eff) == ["a", "b"]
    r = engine_start(r, "b", T0)
    r, _ = run_step_to(r, "a", T0, ok=False)
    assert step(r, "a")["state"] == "failed"
    assert r["state"] == "running"  # b still running
    r = engine_finish(r, "b", T0 + 30)
    r, _ = ev(r, T0 + 30)
    assert step(r, "b")["state"] == "succeeded"
    assert step(r, "c")["state"] == "waiting"
    assert r["state"] == "blocked"


# ---- Delay and give-up ----

def _late(**over):
    j = job(["daily", "weekly"], [("daily", "weekly")])
    r, _ = ev(make_run(j, **over), T0)
    r, _ = ev(engine_start(r, "daily", T0), T0)  # on_start fired
    return r


def test_delay_fires_once_and_keeps_waiting():
    r = _late()
    r, eff = ev(r, T0 + 3599)
    assert hooks(eff) == []
    r, eff = ev(r, T0 + 3600)
    assert ("step", "on_delayed", "daily") in hooks(eff)
    assert ("step", "on_delayed", "weekly") in hooks(eff)
    assert hooks(eff).count(("job", "on_delayed", None)) == 1
    assert ("notify_fallback_check", "on_delayed", "daily") in eff
    assert ("notify_fallback_check", "on_delayed", None) in eff
    assert step(r, "daily")["delay_alerted"] is True
    assert step(r, "weekly")["state"] == "waiting"
    r, eff = ev(r, T0 + 7200)
    assert hooks(eff) == []
    r, eff = run_step_to(r, "daily", T0 + 8000)
    assert starts(eff) == ["weekly"]


def test_delay_not_fired_while_paused():
    r = _late(state="paused", paused_at=T0 + 100)
    r, eff = ev(r, T0 + 5000)
    assert not [h for h in hooks(eff) if h[1] == "on_delayed"]
    r = dict(r, state="running", paused_at=None, paused_seconds=5000 - 100)
    r, eff = ev(r, T0 + 5001)
    assert ("step", "on_delayed", "daily") in hooks(eff)


def test_give_up_cancels_all_running_and_abandons_rest():
    j = job(["a", "b", "c", "d"], [("a", "d"), ("b", "d"), ("c", "d")],
            defaults={"give_up_after": 1000})
    j["steps"][2]["give_up_after"] = 5000
    r, _ = ev(make_run(j), T0)
    r = engine_start(r, "a", T0, "sa")
    r = engine_start(r, "b", T0, "sb")
    r, eff = ev(r, T0 + 999)
    assert r["state"] == "running"
    r, eff = ev(r, T0 + 1000)
    assert ("cancel_search", "a", "sa") in eff
    assert ("cancel_search", "b", "sb") in eff
    assert step(r, "a")["state"] == "failed" and step(r, "b")["state"] == "failed"
    assert step(r, "c")["state"] == "abandoned"  # ready, own deadline not passed
    assert step(r, "d")["state"] == "failed"  # waiting, own deadline passed
    assert r["state"] == "failed" and r["gave_up"] is True
    assert starts(eff) == []
    assert ("job", "on_failure", None) in hooks(eff)
    assert ("job", "on_complete", None) in hooks(eff)
    assert state.evaluate(r, T0 + 2000) == []


def test_give_up_ends_blocked_run():
    r, _ = ev(make_run(job(["a"], defaults={"give_up_after": 1000})), T0)
    r, _ = run_step_to(r, "a", T0, ok=False)
    assert r["state"] == "blocked"
    r, eff = ev(r, T0 + 1000)
    assert r["state"] == "failed" and r["gave_up"] is True
    assert ("job", "on_complete", None) in hooks(eff)


def test_unhandled_failure_deadline_waits_for_running_branch():
    j = job([{"id": "a", "give_up_after": 100}, {"id": "b", "give_up_after": 5000}])
    r, _ = ev(make_run(j), T0)
    r = engine_start(r, "b", T0, "sb")
    r, _ = run_step_to(r, "a", T0, ok=False)
    r, eff = ev(r, T0 + 100)
    assert r["state"] == "running" and step(r, "b")["state"] == "running"
    assert ("cancel_search", "b", "sb") not in eff
    r = engine_finish(r, "b", T0 + 200)
    r, _ = ev(r, T0 + 200)
    assert step(r, "b")["state"] == "succeeded"
    assert r["state"] == "failed" and r["gave_up"] is True  # blocked, a's deadline applies


def test_unhandled_failure_deadline_applies_once_blocked():
    j = job([{"id": "a", "give_up_after": 100}, {"id": "b", "give_up_after": 5000}])
    r, _ = ev(make_run(j), T0)
    r = engine_start(r, "b", T0, "sb")
    r, _ = run_step_to(r, "a", T0, ok=False)
    r = engine_finish(r, "b", T0 + 50)
    r, _ = ev(r, T0 + 50)
    assert r["state"] == "blocked"
    r, eff = ev(r, T0 + 99)
    assert r["state"] == "blocked"
    r, eff = ev(r, T0 + 100)
    assert r["state"] == "failed" and r["gave_up"] is True
    assert ("job", "on_complete", None) in hooks(eff)


def test_max_runtime_covers_starting_step():
    j = job([{"id": "a", "max_runtime": 600}])
    r, _ = ev(make_run(j), T0)
    r = copy.deepcopy(r)
    r["steps"]["a"].update({"state": "starting", "sid": "s1", "started_at": T0})
    r, eff = ev(r, T0 + 599)
    assert step(r, "a")["state"] == "starting"
    r, eff = ev(r, T0 + 600)
    assert ("cancel_search", "a", "s1") in eff
    assert step(r, "a")["state"] == "failed" and "max_runtime" in step(r, "a")["error"]


def test_pause_stops_starts_not_running_searches():
    j = job(["a", "b"], [("a", "b")])
    r, _ = ev(make_run(j), T0)
    r = engine_start(r, "a", T0)
    r = dict(r, state="paused", paused_at=T0 + 5)
    r = engine_finish(r, "a", T0 + 10)
    r, eff = ev(r, T0 + 10)
    assert step(r, "a")["state"] == "succeeded"  # running search carried on
    assert step(r, "b")["state"] == "ready"
    assert starts(eff) == [] and r["state"] == "paused"
    assert not [e for e in eff if e[0] == "cancel_search"]
    r = dict(r, state="running", paused_at=None, paused_seconds=20)
    r, eff = ev(r, T0 + 30)
    assert starts(eff) == ["b"]


def test_pause_stops_give_up_clock():
    j = job(["a"], defaults={"give_up_after": 1000})
    r, _ = ev(make_run(j), T0)
    r = engine_start(r, "a", T0)
    r = dict(r, state="paused", paused_at=T0 + 500)
    r, _ = ev(r, T0 + 5000)
    assert r["state"] == "paused" and step(r, "a")["state"] == "running"
    # resumed at T0+5000 after 4500s paused: 500s used, 500s left
    r = dict(r, state="running", paused_at=None, paused_seconds=4500)
    r, _ = ev(r, T0 + 5499)
    assert step(r, "a")["state"] == "running"
    r, eff = ev(r, T0 + 5500)
    assert step(r, "a")["state"] == "failed" and r["state"] == "failed"


# ---- Attempts ----

def test_max_runtime_counts_as_failed_attempt():
    j = job([{"id": "a", "max_runtime": 600, "retries": 1}])
    r, _ = ev(make_run(j), T0)
    r = engine_start(r, "a", T0, "s1")
    r, eff = ev(r, T0 + 599)
    assert step(r, "a")["state"] == "running"
    r, eff = ev(r, T0 + 600)
    assert ("cancel_search", "a", "s1") in eff
    a = step(r, "a")
    assert a["state"] == "retrying" and a["attempt"] == 2
    assert "max_runtime" in a["error"]
    r = engine_start(r, "a", a["next_attempt_at"], "s2")
    r, eff = ev(r, a["next_attempt_at"] + 600)
    assert ("cancel_search", "a", "s2") in eff
    assert step(r, "a")["state"] == "failed"


def test_retry_backoff_schedule():
    assert [state.backoff(n) for n in range(1, 8)] == [30, 60, 120, 240, 480, 900, 900]
    j = job([{"id": "a", "retries": 2}])
    r, _ = ev(make_run(j), T0)
    assert step(r, "a")["attempt"] == 1
    r, eff = run_step_to(r, "a", T0, ok=False)
    a = step(r, "a")
    assert a["state"] == "retrying" and a["attempt"] == 2 and a["next_attempt_at"] == T0 + 1 + 30
    assert hooks(eff) == [("step", "on_start", "a")]  # no on_failure for a retried attempt
    r, eff = ev(r, T0 + 30)
    assert starts(eff) == []
    r, eff = ev(r, T0 + 31)
    assert starts(eff) == ["a"]
    r, eff = run_step_to(r, "a", T0 + 40, ok=False)
    assert step(r, "a")["next_attempt_at"] == T0 + 41 + 60
    r, eff = run_step_to(r, "a", T0 + 200, ok=False)
    assert step(r, "a")["state"] == "failed" and r["state"] == "blocked"


def test_dispatch_error_retries_without_consuming_retries():
    j = job([{"id": "a", "retries": 0}])
    r, _ = ev(make_run(j), T0)
    now = T0
    for n in (1, 2, 3):
        r = copy.deepcopy(r)
        r["steps"]["a"].update({"state": "starting", "dispatch_errors": n,
                                "outcome": "dispatch_error", "error": "503"})
        r, eff = ev(r, now)
        a = step(r, "a")
        assert a["state"] == "retrying" and a["attempt"] == 1
        assert a["next_attempt_at"] == now + state.backoff(n)
        now = a["next_attempt_at"]
        r, eff = ev(r, now)
        assert starts(eff) == ["a"]
    # the search finally starts and succeeds: retries were never consumed
    ok, _ = run_step_to(r, "a", now)
    assert step(ok, "a")["state"] == "succeeded"
    # a 4th consecutive dispatch error counts as one failed attempt
    r = copy.deepcopy(r)
    r["steps"]["a"].update({"state": "starting", "dispatch_errors": 4,
                            "outcome": "dispatch_error", "error": "503"})
    r, eff = ev(r, now)
    assert step(r, "a")["state"] == "failed"


def test_dispatch_errors_exhausted_use_a_retry_when_available():
    j = job([{"id": "a", "retries": 1}])
    r, _ = ev(make_run(j), T0)
    r = copy.deepcopy(r)
    r["steps"]["a"].update({"state": "starting", "dispatch_errors": 4, "outcome": "dispatch_error"})
    r, _ = ev(r, T0)
    a = step(r, "a")
    assert a["state"] == "retrying" and a["attempt"] == 2 and a["dispatch_errors"] == 0


def test_starting_treated_like_running():
    j = job(["a", "b"], [("a", "b")], defaults={"give_up_after": 100})
    r, _ = ev(make_run(j), T0)
    r["steps"]["a"]["state"] = "starting"
    r, eff = ev(r, T0 + 50)
    assert starts(eff) == [] and step(r, "a")["state"] == "starting"
    assert r["state"] == "running"
    r, eff = ev(r, T0 + 100)
    assert step(r, "a")["state"] == "failed"


# ---- Re-run ----

def test_downstream():
    j = job(["a", "b", "c", "d"], [("a", "b"), ("b", "c"), ("a", "d")])
    assert state.downstream(j, "b") == {"c"}
    assert state.downstream(j, "a") == {"b", "c", "d"}


def test_rerun_resets_step_and_downstream_keeps_upstream():
    j = job(["a", "b", "c"], [("a", "b"), ("b", "c")])
    r, _ = ev(make_run(j), T0)
    r, _ = run_step_to(r, "a", T0)
    r, _ = run_step_to(r, "b", T0 + 10, ok=False)
    assert r["state"] == "blocked"
    before = copy.deepcopy(r)
    n = state.reset_for_rerun(r, "b", T0 + 86400)
    assert r == before  # pure
    assert n["steps"]["a"] == r["steps"]["a"]
    assert n["steps"]["b"]["state"] == "waiting" and n["steps"]["b"]["sid"] is None
    assert n["steps"]["c"]["state"] == "waiting"
    assert n["scheduled_time"] == T0 and n["giveup_base"] == T0 + 86400
    n, eff = ev(n, T0 + 86400)
    assert starts(eff) == ["b"]
    with pytest.raises(ValueError):
        state.reset_for_rerun(make_run(j), "b", T0)  # running runs cannot be re-run


def test_rerun_with_latest_definition():
    j = job(["a", "b"], [("a", "b")])
    r, _ = ev(make_run(j), T0)
    r, _ = run_step_to(r, "a", T0, ok=False)
    j2 = job(["a", "b", "c"], [("a", "b"), ("b", "c")])
    n = state.reset_for_rerun(r, "a", T0 + 100, definition=j2)
    assert n["definition"] == j2 and n["steps"]["c"]["state"] == "waiting"


def test_rerun_delay_alert_can_fire_once_more():
    j = job(["a"])
    r, _ = ev(make_run(j), T0)
    r = engine_start(r, "a", T0)
    r, eff = ev(r, T0 + 3600)
    assert ("job", "on_delayed", None) in hooks(eff)
    r = engine_finish(r, "a", T0 + 3700, ok=False)
    r, _ = ev(r, T0 + 3700)
    n = state.reset_for_rerun(r, "a", T0 + 10000)
    n, _ = ev(n, T0 + 10000)
    n = engine_start(n, "a", T0 + 10000)
    n, eff = ev(n, T0 + 13599)
    assert not [h for h in hooks(eff) if h[1] == "on_delayed"]
    n, eff = ev(n, T0 + 13600)
    assert ("job", "on_delayed", None) in hooks(eff)
    assert ("step", "on_delayed", "a") in hooks(eff)
    n, eff = ev(n, T0 + 20000)
    assert not [h for h in hooks(eff) if h[1] == "on_delayed"]


def test_job_hooks_fire_once_on_terminal_state():
    j = job(["a", "b"], [("a", "b")])
    r, eff = ev(make_run(j), T0)
    assert hooks(eff) == [("job", "on_start", None)]
    r, eff = run_step_to(r, "a", T0)
    assert ("step", "on_start", "a") in hooks(eff)
    assert ("step", "on_success", "a") in hooks(eff)
    assert ("step", "on_complete", "a") in hooks(eff)
    assert not [h for h in hooks(eff) if h[0] == "job"]
    r, eff = run_step_to(r, "b", T0 + 10)
    assert r["state"] == "succeeded"
    job_hooks = [h for h in hooks(eff) if h[0] == "job"]
    assert job_hooks == [("job", "on_success", None), ("job", "on_complete", None)]
    assert state.evaluate(r, T0 + 20) == []


def test_cancelled_run_cancels_searches_and_unstarted_steps():
    j = job(["a", "b"], [("a", "b")])
    r, _ = ev(make_run(j), T0)
    r = engine_start(r, "a", T0, "sa")
    r = dict(r, state="cancelled")
    r, eff = ev(r, T0 + 5)
    assert ("cancel_search", "a", "sa") in eff
    assert step(r, "a")["state"] == "cancelled" and step(r, "b")["state"] == "cancelled"
    assert ("job", "on_complete", None) in hooks(eff)
    assert state.evaluate(r, T0 + 10) == []


def test_queued_run_does_nothing():
    assert state.evaluate(make_run(job(["a"]), state="queued"), T0) == []


def test_evaluate_does_not_mutate_input():
    r = make_run(chain())
    before = copy.deepcopy(r)
    state.evaluate(r, T0 + 99999)
    assert r == before


def test_preview_decision_mirrors_run_rules():
    # The brief's job has no timezone (server local time); UTC pins the cron check.
    job = {"timezone": "UTC",
           "steps": [{"id": "d", "type": "inline", "spl": "x"},
                     {"id": "w", "type": "previous", "spl": "| x",
                      "run_when": {"kind": "cron", "value": "0 1 * * 1"}}],
           "edges": [{"from": "d", "to": "w"}]}
    tue = 1794272400  # Tuesday 2026-11-10 01:00 UTC; +6 days is Monday 2026-11-16
    ok = {"d": {"state": "succeeded", "sid": "s1", "result_count": 3}}
    assert state.preview_decision(job, "w", tue, {}, ok) == ("skipped", "run_when")
    assert state.preview_decision(job, "w", tue + 6 * 86400, {}, ok) == ("run", None)
    assert state.preview_decision(job, "w", tue, {}, {}) == ("needs", "d")
    failed = {"d": {"state": "failed"}}
    assert state.preview_decision(job, "w", tue + 6 * 86400, {}, failed) == ("needs", "d")


def test_preview_decision_root_not_taken_and_expressions():
    j = job(["a", "b", "c", "e"], [("a", "c", "on_failure"), ("b", "c"),
                                   ("a", "e", "expression", "$a.resultCount$ > 2")])
    assert state.preview_decision(j, "a", T0, {}, {}) == ("run", None)
    ok = {"a": {"state": "succeeded", "sid": "s", "result_count": 3}}
    assert state.preview_decision(j, "c", T0, {}, ok) == ("needs", "b")
    taken = dict(ok, b={"state": "succeeded", "sid": "t", "result_count": 0})
    assert state.preview_decision(j, "c", T0, {}, taken) == ("run", None)
    neither = dict(ok, b={"state": "skipped", "skip_kind": "not_taken"})
    assert state.preview_decision(j, "c", T0, {}, neither) == ("skipped", "not_taken")
    assert state.preview_decision(j, "c", T0, {}, {}) == ("needs", "a,b")
    assert state.preview_decision(j, "e", T0, {}, ok) == ("run", None)
    few = {"a": {"state": "succeeded", "sid": "s", "result_count": 1}}
    assert state.preview_decision(j, "e", T0, {}, few) == ("skipped", "not_taken")
    skipped = {"a": {"state": "skipped", "skip_kind": "run_when"},
               "b": {"state": "skipped", "skip_kind": "run_when"}}
    assert state.preview_decision(j, "c", T0, {}, skipped) == ("run", None)


def test_preview_decision_run_when_expression_sees_params():
    j = job([{"id": "a", "run_when": {"kind": "expression", "value": '$run.param.env$ == "prod"'}}])
    assert state.preview_decision(j, "a", T0, {"env": "prod"}, {}) == ("run", None)
    assert state.preview_decision(j, "a", T0, {"env": "dev"}, {}) == ("skipped", "run_when")
