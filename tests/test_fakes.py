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
