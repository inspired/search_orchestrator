import inspect

import pytest
from fakes import FakeGateway
from so import gateway as g


def _shape(func):
    return [(p.name, p.kind, p.default) for p in inspect.signature(func).parameters.values()]


def test_fake_and_real_signatures_match_protocol():
    names = [n for n, v in vars(g.Gateway).items()
             if callable(v) and not n.startswith("_")]
    assert names
    for name in names:
        proto = _shape(getattr(g.Gateway, name))
        assert _shape(getattr(FakeGateway, name)) == proto, name
        assert _shape(getattr(g.SplunkGateway, name)) == proto, name


def test_fake_insert_and_batch_generate_keys():
    fake = FakeGateway()
    assert fake.kv_insert("c", {"x": 1})
    fake.kv_batch_save("c", [{"x": 2}])
    keys = [d["_key"] for d in fake.kv_query("c")]
    assert len(keys) == 2 and all(keys)


def test_fake_dispatch_unknown_search_is_non_transient():
    fake = FakeGateway()
    with pytest.raises(g.DispatchError) as info:
        fake.dispatch("u", "_so_nope", 1, {})
    assert info.value.transient is False
    fake.upsert_saved_search("u", "_so_yes", "search *", "-1h", "now")
    assert fake.dispatch("u", "_so_yes", 1, {})


def test_fake_missing_collection_is_kv_error():
    fake = FakeGateway()
    fake.missing_collections.add("so_runs")
    with pytest.raises(g.KvError):
        fake.kv_insert("so_runs", {"_key": "a"})
    with pytest.raises(g.KvError):
        fake.kv_query("so_runs")
    assert fake.kv_insert("so_jobs", {"_key": "a"})


def test_fake_preview_jobs():
    fake = FakeGateway()
    fake.script_job("so_preview_", ["running", "done"], result_count=2,
                    rows=[{"a": "1"}, {"a": "2"}], run_duration=0.5)
    sid = fake.preview_dispatch("alice", "| x", "-1d", "now", 123, "so_preview_h_j_s_r")
    assert sid == "so_preview_h_j_s_r"
    assert fake.preview_log == [{"sid": sid, "user": "alice", "spl": "| x", "earliest": "-1d",
                                 "latest": "now", "now": 123}]
    assert fake.preview_info(sid)["state"] == "running"
    info = fake.preview_info(sid)
    assert (info["owner"], info["state"], info["result_count"], info["run_duration"]) == \
        ("alice", "done", 2, 0.5)
    assert fake.preview_results(sid, 1) == {"fields": ["a"], "rows": [{"a": "1"}]}
    assert fake.preview_info("nope")["state"] == "missing"
    fake.control(sid, "cancel")
    assert fake.preview_info(sid)["state"] == "missing"


def test_add_and_forget_job():
    gw = FakeGateway()
    gw.add_job("s1", result_count=4)
    assert gw.job_status("s1")["state"] == "done" and gw.job_status("s1")["result_count"] == 4
    gw.forget_job("s1")
    assert gw.job_status("s1")["state"] == "missing"
    gw.forget_job("nosuch")  # no error
