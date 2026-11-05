import pytest
from fakes import FakeGateway
from so.gateway import KvError
from so.store import Store


@pytest.fixture
def store():
    return Store(FakeGateway())


def test_duplicate_run_key_returns_false(store):
    assert store.create_run({"id": "r1", "state": "queued"}) is True
    assert store.create_run({"id": "r1", "state": "queued"}) is False
    assert store.get_run("r1")["state"] == "queued"


def test_job_roundtrip_and_delete(store):
    store.save_job({"id": "j1", "name": "a"})
    store.save_job({"id": "j1", "name": "b"})
    assert store.get_job("j1")["name"] == "b"
    assert len(store.list_jobs()) == 1
    store.delete_job("j1")
    assert store.get_job("j1") is None


def test_active_runs_and_filters(store):
    for rid, state in (("a", "queued"), ("b", "running"), ("c", "succeeded")):
        store.create_run({"id": rid, "state": state, "job_id": "j", "created_at": ord(rid)})
    assert [r["id"] for r in store.list_active_runs()] == ["a", "b"]
    assert [r["id"] for r in store.list_runs({"state": "succeeded"})] == ["c"]


def test_commands_taken_once_in_order(store):
    store.enqueue_command({"type": "cancel", "created_at": 2})
    store.enqueue_command({"type": "pause", "created_at": 1})
    assert [c["type"] for c in store.take_commands()] == ["pause", "cancel"]
    assert store.take_commands() == []


def test_settings_roundtrip(store):
    assert store.get_settings() == {}
    store.save_settings({"global_searches": 5})
    assert store.get_settings()["global_searches"] == 5


def test_prune_runs_drops_old_ended_runs_and_attempts(store):
    store.create_run({"id": "old", "state": "succeeded", "ended_at": 100})
    store.create_run({"id": "new", "state": "succeeded", "ended_at": 900})
    store.create_run({"id": "act", "state": "running"})
    store.save_step_run({"run_id": "old", "step_id": "s", "attempt": 1})
    assert store.prune_runs(500) == 1
    assert store.get_run("old") is None and store.get_run("new") and store.get_run("act")
    assert store.list_step_runs("old") == []


def test_kv_down_raises(store):
    store.gw.kv_down = True
    with pytest.raises(KvError):
        store.get_job("x")
