"""Why a run or step waits (queue_info), through the runs routes."""
from so import lease
from test_api import T0, saved, start, w  # noqa: F401  (w is a fixture)


def engine_alive(w):
    w.gw.kv_insert(lease.COLLECTION, {"_key": lease.KEY, "holder": "h1", "expires": w.now + 60})


def reason(w, run_id, user="alice"):
    status, out = w.call(user, "GET", "/orchestrator/runs/%s" % run_id)
    assert status == 200, out
    return out["run"].get("queue_reason"), out


def test_no_engine_says_so(w):
    saved(w)
    r = start(w)
    got, out = reason(w, r)
    assert got == {"kind": "engine_stopped", "last_seen": None}
    assert out["engine"]["running"] is False


def test_next_tick_then_behind_then_waiting_for_the_active_run(w):
    saved(w)
    engine_alive(w)
    first = start(w, body={"params": {}, "scheduled_time": T0})
    second = start(w, body={"params": {}, "scheduled_time": T0 + 60})
    assert reason(w, first)[0] == {"kind": "next_tick"}
    assert reason(w, second)[0] == {"kind": "behind", "ahead": 1, "next_run_id": first}
    run = w.store.get_run(first)
    run["state"] = "running"
    w.store.save_run(run)
    assert reason(w, second)[0] == {"kind": "waiting_for_run", "run_id": first, "state": "running"}
    status, out = w.call("alice", "GET", "/orchestrator/runs", {"job_id": "daily"})
    by_id = {r["id"]: r for r in out["runs"]}
    assert by_id[second]["queue_reason"]["kind"] == "waiting_for_run"
    assert "queue_reason" not in by_id[first]


def test_a_held_run_blocks_the_job(w):
    saved(w)
    engine_alive(w)
    old = start(w, body={"params": {}, "scheduled_time": T0})
    run = w.store.get_run(old)
    run.update(state="failed", held=True)
    w.store.save_run(run)
    nxt = start(w, body={"params": {}, "scheduled_time": T0 + 60})
    assert reason(w, nxt)[0] == {"kind": "held", "run_id": old}


def test_step_reasons_name_the_steps_before_and_full_search_slots(w):
    saved(w)
    engine_alive(w)
    r = start(w)
    run = w.store.get_run(r)
    run["state"] = "running"
    run["steps"] = {"a": {"state": "ready"}, "b": {"state": "waiting"}}
    w.store.save_run(run)
    w.store.save_settings({"max_searches_per_job": 1, "max_searches": 10})
    other = start(w, body={"params": {}, "scheduled_time": T0 + 600})
    busy = w.store.get_run(other)
    busy.update(state="running", steps={"a": {"state": "running"}})
    w.store.save_run(busy)
    _, out = reason(w, r)
    steps = out["run"]["step_reasons"]
    assert steps["b"] == {"kind": "waiting_for", "steps": ["a"]}
    assert steps["a"]["kind"] == "next_tick"  # this run has no search out yet
    run["steps"]["a"] = {"state": "running"}
    run["steps"]["c"] = {"state": "ready"}
    w.store.save_run(run)
    _, out = reason(w, r)
    assert out["run"]["step_reasons"]["c"] == {"kind": "search_slots", "job_running": 1, "job_max": 1, "all_running": 2, "all_max": 10}
