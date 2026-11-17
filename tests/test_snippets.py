"""Snippets on the server (features-2 spec section 9)."""
import json

from so import snippets
from test_api import error, w  # noqa: F401  (w is a fixture)

URL = "/orchestrator/snippets"


def clip(**over):
    out = {"so_clipboard": 1,
           "steps": [{"id": "a", "type": "inline", "spl": "| makeresults",
                      "actions": [{"hook": "on_failure", "type": "email", "to": "ops@example.com"}]},
                     {"id": "b", "type": "inline", "spl": "| makeresults"}],
           "edges": [{"from": "a", "to": "b", "condition": "expression", "expr": "1=1"}],
           "job_actions": [{"hook": "on_success", "type": "webhook", "destination": "slack"}],
           "triggers": [{"type": "cron", "cron": "0 * * * *"}],
           "positions": {"step:a": {"x": 1, "y": 2}}}
    out.update(over)
    return out


def body(name="Hourly checks", **over):
    out = {"name": name, "description": "Two steps", "content": clip()}
    out.update(over)
    return out


def make(w, user="alice", **over):
    status, out = w.call(user, "POST", URL, body(**over))
    assert status == 201, out
    return out["snippet"]


def test_create_sets_owner_id_and_node_count(w):
    s = make(w)
    assert s["owner"] == "alice" and snippets.ID_RE.fullmatch(s["id"])
    # 2 steps + 1 step action + 1 job action + 1 trigger + 1 expression edge
    assert s["node_count"] == 6 == snippets.node_count(clip())
    assert s["content"] == clip()
    assert w.audit.of("snippet_saved")[0]["created"] is True


def test_list_omits_content_and_builders_share(w):
    s = make(w)
    status, out = w.call("bob", "GET", URL)
    assert status == 200 and [x["id"] for x in out["snippets"]] == [s["id"]]
    assert "content" not in out["snippets"][0] and out["snippets"][0]["node_count"] == 6
    status, out = w.call("bob", "GET", "%s/%s" % (URL, s["id"]))
    assert status == 200 and out["snippet"]["content"] == clip()


def test_only_owner_or_admin_changes_or_deletes(w):
    s = make(w)
    path = "%s/%s" % (URL, s["id"])
    assert w.call("bob", "PUT", path, body(name="X"))[0] == 403
    assert w.call("bob", "DELETE", path)[0] == 403
    status, out = w.call("alice", "PUT", path, body(name="Renamed"))
    assert status == 200 and out["snippet"]["name"] == "Renamed" and out["snippet"]["owner"] == "alice"
    assert w.audit.of("snippet_saved")[-1]["created"] is False
    assert w.call("root", "PUT", path, body(name="By root"))[0] == 200
    assert w.call("root", "DELETE", path)[0] == 200
    assert w.call("alice", "GET", path)[0] == 404
    gone = w.audit.of("snippet_deleted")[0]
    assert gone["snippet_id"] == s["id"] and gone["name"] == "By root"


def test_non_builders_denied_everywhere(w):
    s = make(w)
    path = "%s/%s" % (URL, s["id"])
    for method, p, b in (("GET", URL, None), ("POST", URL, body("Other")), ("GET", path, None),
                         ("PUT", path, body()), ("DELETE", path, None)):
        assert w.call("carol", method, p, b)[0] == 403, (method, p)
    assert w.audit.of("permission_denied")


def test_duplicate_name_case_insensitive(w):
    s = make(w)
    status, out = w.call("bob", "POST", URL, body("hourly CHECKS"))
    assert status == 409 and error(out) == "snippet_exists"
    assert out["error"]["message"] == "A snippet named Hourly checks already exists; pick another name"
    other = make(w, name="Other")
    status, out = w.call("alice", "PUT", "%s/%s" % (URL, other["id"]), body("HOURLY checks"))
    assert status == 409
    assert w.call("alice", "PUT", "%s/%s" % (URL, s["id"]), body("hourly checks"))[0] == 200


def test_name_and_description_limits(w):
    for bad in ("", "   ", "x" * 81, 5):
        status, out = w.call("alice", "POST", URL, body(bad))
        assert status == 400 and error(out) == "bad_request", bad
    assert w.call("alice", "POST", URL, body("x" * 80))[0] == 201
    status, out = w.call("alice", "POST", URL, body("Fine", description="d" * 501))
    assert status == 400 and error(out) == "bad_request"


def issues(w, content):
    status, out = w.call("alice", "POST", URL, body(content=content))
    assert status == 400 and error(out) == "bad_snippet", out
    return [i["message"] for i in out["error"]["issues"]]


def test_content_messages(w):
    fmt = "The snippet isn't in the copy format; copy the nodes again"
    assert issues(w, clip(so_clipboard=2)) == [fmt]
    assert issues(w, "text") == [fmt]
    broken = clip()
    del broken["edges"]
    assert issues(w, broken) == [fmt]
    assert issues(w, clip(steps=[{"id": "Bad id"}])) == ["Step id Bad id isn't valid"]
    many = clip(steps=[{"id": "s%d" % i} for i in range(101)], edges=[], job_actions=[], triggers=[])
    assert issues(w, many) == ["A snippet can hold at most 100 steps"]
    huge = clip(positions={"k": "x" * 200_000})
    assert issues(w, huge) == ["A snippet can be at most 200 KB"]
    assert len(json.dumps(clip())) < snippets.MAX_BYTES


def test_secrets_cannot_get_in(w):
    leaky = clip(job_actions=[{"hook": "on_failure", "type": "webhook", "destination": "slack",
                               "url": "https://hooks.example.com/T0/secret"}])
    assert issues(w, leaky) == ["Snippets can't hold secrets or URLs; reference a destination by name"]
    deep = clip(steps=[{"id": "a", "actions": [{"type": "webhook", "headers": {"Authorization": "x"}}]}])
    assert len(issues(w, deep)) == 1
    s = make(w, content=clip(extra="ignored", positions={}))
    assert "extra" not in s["content"]


def test_unknown_and_malformed_ids_404(w):
    assert w.call("alice", "GET", URL + "/sn" + "0" * 12)[0] == 404
    assert w.call("alice", "PUT", URL + "/sn" + "0" * 12, body())[0] == 404
    assert w.call("alice", "DELETE", URL + "/sn" + "0" * 12)[0] == 404
    for bad in ("nope", "sn123", "SN" + "0" * 12, "sn" + "g" * 12):
        assert w.call("alice", "GET", "%s/%s" % (URL, bad))[0] == 404, bad
