"""Performance route (features-2 spec section 10)."""
from so import perf
from so.gateway import GatewayError
from test_api import T0, saved, start, w  # noqa: F401  (w is a fixture)

PERF = {"run_duration": 3.2, "scan_count": 1204, "event_count": 10, "result_count": 5,
        "disk_usage": 2}
NOTE_INTRO = "CPU and memory need read access to _introspection; ask an admin."
NOTE_OLD = "Some steps ran before 1.23.0 and their numbers come from _audit."
NOTE_MAX = "Only the first 50 searches are shown."


def run_with(w, steps):
    """A started run whose steps are replaced by ``steps`` ({step_id: doc})."""
    saved(w)
    run = w.store.get_run(start(w))
    run.update(started_at=T0 + 10, ended_at=T0 + 100)
    run["steps"] = steps
    w.store.save_run(run)
    return run["id"]


def get(w, run_id, user="alice"):
    return w.call(user, "GET", "/orchestrator/runs/%s/performance" % run_id)


def handler(w, intro=None, audit=None):
    def run(owner, query):
        if "_introspection" in query:
            if isinstance(intro, Exception):
                raise intro
            return intro or []
        if isinstance(audit, Exception):
            raise audit
        return audit or []
    w.gw.search_handler = run


def test_engine_perf_passes_through_and_introspection_fills_cpu(w):
    run_id = run_with(w, {"a": {"state": "succeeded", "sid": "s1", "perf": PERF}})
    handler(w, intro=[{"sid": "s1", "cpu_peak": "88.5", "cpu_avg": "40.25", "mem_peak_mb": "512"}])
    status, out = get(w, run_id)
    assert status == 200, out
    assert out["steps"]["a"] == dict(PERF, source="engine", cpu_peak=88.5, cpu_avg=40.25,
                                     mem_peak_mb=512.0)
    assert out["notes"] == []


def test_step_without_perf_uses_audit_numbers(w):
    run_id = run_with(w, {"a": {"state": "succeeded", "sid": "s1"}})
    handler(w, audit=[{"sid": "s1", "run_duration": "2.5", "scan_count": "100",
                       "event_count": "7", "result_count": "3"}])
    status, out = get(w, run_id)
    assert status == 200, out
    assert out["steps"]["a"] == {"run_duration": 2.5, "scan_count": 100.0, "event_count": 7.0,
                                 "result_count": 3.0, "source": "audit"}
    assert out["notes"] == [NOTE_OLD]


def test_introspection_403_adds_note_and_still_returns_200(w):
    run_id = run_with(w, {"a": {"state": "succeeded", "sid": "s1", "perf": PERF}})
    handler(w, intro=GatewayError("denied", status=403))
    status, out = get(w, run_id)
    assert status == 200, out
    assert out["notes"] == [NOTE_INTRO]
    assert out["steps"]["a"]["source"] == "engine" and "cpu_peak" not in out["steps"]["a"]


def test_sid_with_space_is_left_out_of_the_queries(w):
    run_id = run_with(w, {"a": {"state": "succeeded", "sid": "s1"},
                          "b": {"state": "succeeded", "sid": "bad sid | delete"}})
    handler(w)
    assert get(w, run_id)[0] == 200
    queries = [q for _, q, _, _ in w.gw.search_log]
    assert len(queries) == 2 and all("s1" in q and "bad" not in q for q in queries)


def test_more_than_50_sids_are_cut_with_a_note(w):
    run_id = run_with(w, {"s%02d" % i: {"state": "succeeded", "sid": "sid%02d" % i, "perf": PERF}
                          for i in range(51)})
    handler(w)
    status, out = get(w, run_id)
    assert status == 200 and out["notes"] == [NOTE_MAX]
    assert len(out["steps"]) == 50
    assert "sid49" in w.gw.search_log[0][1] and "sid50" not in w.gw.search_log[0][1]


def test_searches_run_as_the_caller_in_the_run_window(w):
    run_id = run_with(w, {"a": {"state": "succeeded", "sid": "s1"}})
    handler(w)
    assert get(w, run_id)[0] == 200
    assert [c for c in w.calls if c[1] == "search_oneshot"] == [("user:alice", "search_oneshot")] * 2
    assert {(o, e, l) for o, _, e, l in w.gw.search_log} == {("alice", str(T0 + 10 - 60),
                                                              str(T0 + 100 + 300))}


def test_no_search_when_there_are_no_sids(w):
    run_id = run_with(w, {"a": {"state": "waiting"}})
    status, out = get(w, run_id)
    assert status == 200 and out == {"steps": {}, "notes": []} and w.gw.search_log == []


def test_dave_cannot_see_the_run(w):
    run_id = run_with(w, {"a": {"state": "succeeded", "sid": "s1"}})
    assert get(w, run_id, "dave")[0] == 404


def test_queries_quote_audit_sids_only():
    assert perf.introspection_query(["a", "b"]).endswith("IN (a, b)") or "IN (a, b)" in \
        perf.introspection_query(["a", "b"])
    assert 'search_id IN ("a", "b")' in perf.audit_query(["a", "b"])
