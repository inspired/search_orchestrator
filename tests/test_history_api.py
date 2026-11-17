"""Version history routes (spec section 3): list, read, compare and restore."""
from so import history
from test_api import job_body, saved, w  # noqa: F401  (w is a fixture)

BASE = "/orchestrator/jobs/daily"


def _put(w, body, user="alice"):
    status, out = w.call(user, "PUT", BASE, body)
    assert status == 200, out
    return out


def _two_versions(w):
    saved(w)
    _put(w, job_body(name="Renamed"))


def test_list_newest_first_without_definition(w):
    _two_versions(w)
    status, out = w.call("alice", "GET", BASE + "/versions")
    assert status == 200
    assert [v["version"] for v in out["versions"]] == [2, 1]
    assert all("definition" not in v for v in out["versions"])


def test_get_one_version(w):
    _two_versions(w)
    status, out = w.call("alice", "GET", BASE + "/versions", {"version": "1"})
    assert status == 200
    assert out["version"]["definition"]["name"] == "Daily summary"


def test_compare_with_current(w):
    saved(w)
    _put(w, job_body(name="Renamed"))
    status, out = w.call("alice", "GET", BASE + "/versions", {"compare": "1,current"})
    assert status == 200
    assert (out["from"], out["to"]) == (1, "current")
    assert [c["label"] for c in out["changes"]] == ["Changed name"]
    status, out = w.call("alice", "GET", BASE + "/versions", {"compare": "1,2"})
    assert status == 200 and [c["label"] for c in out["changes"]] == ["Changed name"]


def test_visibility(w):
    _two_versions(w)
    assert w.call("carol", "GET", BASE + "/versions")[0] == 200
    for user in ("bob", "dave"):
        status, out = w.call(user, "GET", BASE + "/versions")
        assert status == 404 and out["error"]["code"] == "not_found"


def test_bad_query(w):
    _two_versions(w)
    status, out = w.call("alice", "GET", BASE + "/versions", {"version": "abc"})
    assert status == 400 and out["error"]["code"] == "bad_request"
    assert out["error"]["message"] == "version must be a version number"
    status, out = w.call("alice", "GET", BASE + "/versions", {"version": "9"})
    assert status == 404 and out["error"]["message"] == "no version 9 of job 'daily'"
    status, out = w.call("alice", "GET", BASE + "/versions", {"compare": "1"})
    assert status == 400 and out["error"]["code"] == "bad_request"


def test_restore_writes_a_new_version(w):
    _two_versions(w)
    status, out = w.call("alice", "POST", BASE + "/restore", {"version": 1})
    assert status == 200, out
    assert out["job"]["name"] == "Daily summary"
    newest = history.list_versions(w.gw, "daily")[0]
    assert newest["version"] == 3 and newest["restored_from"] == 1
    assert w.store.get_job("daily")["name"] == "Daily summary"
    event = w.audit.of("job_restored")[0]
    assert (event["job_id"], event["from_version"], event["to_version"]) == ("daily", 2, 1)


def test_restore_needs_edit_rights(w):
    _two_versions(w)
    status, out = w.call("carol", "POST", BASE + "/restore", {"version": 1})
    assert status == 403 and out["error"]["code"] == "forbidden"
    assert w.audit.of("permission_denied")
    assert len(history.list_versions(w.gw, "daily")) == 2


def test_restore_invalid_version_changes_nothing(w):
    w.gw.upsert_saved_search("alice", "mine", "index=a", "-1h", "now")
    saved(w, body=job_body(steps=[{"id": "a", "type": "saved_search", "saved_search_ref": "mine"}],
                           edges=[]))
    _put(w, job_body(name="Renamed"))
    del w.gw.saved_searches[("alice", "mine")]
    before = (w.store.get_job("daily"), history.list_versions(w.gw, "daily"))
    status, out = w.call("alice", "POST", BASE + "/restore", {"version": 1})
    assert status == 400 and out["error"]["code"] == "job_invalid"
    assert out["error"]["issues"]
    assert (w.store.get_job("daily"), history.list_versions(w.gw, "daily")) == before


def test_restore_bad_version(w):
    _two_versions(w)
    assert w.call("alice", "POST", BASE + "/restore", {"version": "x"})[0] == 400
    assert w.call("alice", "POST", BASE + "/restore", {"version": 9})[0] == 404


def test_admin_restore_takes_ownership(w):
    _two_versions(w)
    status, out = w.call("root", "POST", BASE + "/restore", {"version": 1})
    assert status == 200, out
    assert w.store.get_job("daily")["owner"] == "root"
    assert w.audit.of("job_owner_changed")
