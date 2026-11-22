"""Version history (spec section 3): diff, summaries and the saves that write versions."""
import copy

from so import history
from test_api import T0, job_body, saved, w  # noqa: F401  (w is a fixture)


def _job(**over):
    job = {"id": "j", "name": "J", "enabled": True,
           "steps": [{"id": "a", "type": "inline", "spl": "one"},
                     {"id": "b", "type": "inline", "spl": "two"}],
           "edges": [{"from": "a", "to": "b"}], "triggers": [], "actions": []}
    job.update(over)
    return job


def test_diff_matches_steps_by_id_not_position():
    a = _job()
    b = _job(steps=list(reversed(a["steps"])))
    assert history.diff(a, b) == []


def test_diff_labels():
    a = _job()
    b = copy.deepcopy(a)
    b["steps"][0]["spl"] = "three"
    changes = history.diff(a, b)
    assert len(changes) == 1
    assert changes[0]["path"] == "steps.a.spl"
    assert changes[0]["label"] == "Changed the search of a"
    assert (changes[0]["before"], changes[0]["after"]) == ("one", "three")
    b["steps"].append({"id": "c", "type": "inline", "spl": "x"})
    assert "Added step c" in [c["label"] for c in history.diff(a, b)]
    assert "Removed step c" in [c["label"] for c in history.diff(b, a)]
    c = copy.deepcopy(a)
    c["edges"][0]["condition"] = "on_failure"
    assert [x["label"] for x in history.diff(a, c)] == ["Changed the line from a to b"]
    assert [x["label"] for x in history.diff(a, _job(edges=[]))] == ["Removed the line from a to b"]


def test_diff_other_labels():
    a = _job()
    named = _job(steps=[dict(a["steps"][0], name="Daily summary", earliest="-1d"), a["steps"][1]])
    later = copy.deepcopy(named)
    later["steps"][0]["earliest"] = "-2d"
    assert [c["label"] for c in history.diff(named, later)] == \
        ["Changed the time range of Daily summary"]
    assert [c["label"] for c in history.diff(a, _job(enabled=False))] == ["Turned the job off"]
    assert [c["label"] for c in history.diff(a, _job(timezone="UTC"))] == ["Changed timezone"]
    assert [c["label"] for c in history.diff(a, _job(triggers=[{"cron": "* * * * *"}]))] == \
        ["Changed the schedule"]
    assert [c["label"] for c in history.diff(a, _job(actions=[{"type": "email"}]))] == \
        ["Changed the actions"]
    assert history.diff(a, _job(owner="x", updated_by="y")) == []


def test_layout_only_change_is_one_move_change():
    a = _job(layout={"nodes": {k: {"x": 0, "y": 0} for k in "abc"}})
    b = _job(layout={"nodes": {k: {"x": 5, "y": 5} for k in "abc"}})
    assert history.diff(a, b) == [{"path": "layout", "kind": "changed", "label": "Moved 3 nodes",
                                   "before": a["layout"]["nodes"], "after": b["layout"]["nodes"]}]


def test_groups_change_is_one_change():
    a = _job(layout={"nodes": {}, "groups": []})
    b = _job(layout={"nodes": {}, "groups": [{"id": "g"}]})
    assert [c["label"] for c in history.diff(a, b)] == ["Changed groups"]


def test_summarize_caps_at_eight():
    changes = [{"label": "Change %d" % i} for i in range(12)]
    lines = history.summarize(changes)
    assert len(lines) == 8 and lines[-1] == "and 5 more changes"
    assert history.summarize(changes[:8]) == [c["label"] for c in changes[:8]]


def _put(w, body, user="alice"):
    status, out = w.call(user, "PUT", "/orchestrator/jobs/daily", body)
    assert status == 200, out
    return out


def test_unchanged_save_writes_no_version(w):
    saved(w)
    _put(w, job_body())
    assert len(history.list_versions(w.gw, "daily")) == 1
    assert len(w.audit.of("job_version_saved")) == 1


def test_first_edit_of_old_job_writes_baseline(w):
    # A job as 1.18.2 stored it: saved normally, then its versions removed.
    saved(w)
    history.delete_all(w.gw, "daily")
    w.gw.kv_update("so_jobs", "daily", dict(w.gw.kv_get("so_jobs", "daily"), updated_at=T0 - 5))
    w.now = T0 + 60
    _put(w, job_body(name="Renamed"))
    versions = history.list_versions(w.gw, "daily")
    assert [v["version"] for v in versions] == [2, 1]
    assert versions[1]["summary"] == ["Saved before version history started"]
    assert versions[1]["saved_by"] == "alice" and versions[1]["saved_at"] == T0 - 5
    assert versions[0]["saved_at"] == T0 + 60
    assert versions[0]["summary"] == ["Changed name"]
    assert "definition" not in versions[0]


def test_enabled_toggle_writes_version(w):
    saved(w)
    status, _ = w.call("alice", "POST", "/orchestrator/jobs/daily/enabled", {"enabled": False})
    assert status == 200
    assert history.list_versions(w.gw, "daily")[0]["summary"] == ["Turned the job off"]


def test_retention_keeps_fifty(w):
    saved(w)
    for i in range(54):
        _put(w, job_body(name="Name %d" % i))
    versions = history.list_versions(w.gw, "daily")
    assert len(versions) == 50
    assert versions[-1]["version"] == 6 and versions[0]["version"] == 55
    assert sum(e["count"] for e in w.audit.of("job_versions_pruned")) == 5


def test_delete_job_deletes_versions(w):
    saved(w)
    _put(w, job_body(name="Other"))
    status, _ = w.call("alice", "DELETE", "/orchestrator/jobs/daily")
    assert status == 200
    assert history.list_versions(w.gw, "daily") == []


def test_version_number_collision_retries(w):
    saved(w)
    w.gw.kv_insert("so_job_versions", {"_key": "daily:2", "job_id": "other", "version": 0})
    _put(w, job_body(name="Changed"))
    assert [v["version"] for v in history.list_versions(w.gw, "daily")] == [3, 1]


def test_version_has_no_server_fields(w):
    saved(w)
    definition = history.get_version(w.gw, "daily", 1)["definition"]
    for field in ("owner", "hidden_searches", "created_at", "updated_by", "_key", "_user"):
        assert field not in definition
    assert history.get_version(w.gw, "daily", 1)["summary"] == ["Created the job"]
    assert history.get_version(w.gw, "daily", 9) is None
