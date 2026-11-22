"""Building blocks an admin turns off in Settings (so.blocks)."""
from so import blocks
from test_api import job_body, saved, w  # noqa: F401  (w is a fixture)


def approval_body():
    body = job_body()
    body["steps"].append({"id": "gate", "type": "approval", "approval": {"message": "ok?"}})
    body["edges"].append({"from": "b", "to": "gate"})
    return body


def test_kinds_of_a_job():
    job = {"triggers": [{"type": "cron", "cron": "0 * * * *"}, {"type": "completion", "job": "x"}],
           "steps": [{"id": "a", "type": "inline", "spl": "x", "output": {"kind": "lookup", "name": "l"}},
                     {"id": "b", "type": "approval", "actions": [{"type": "webhook", "preset": "slack"}]},
                     {"id": "c", "type": "saved_search"}],
           "actions": [{"type": "email"}, {"type": "webhook"}, {"type": "some_alert"}]}
    assert blocks.kinds_of(job) == {"trigger_cron", "trigger_completion", "lookup", "approval",
                                    "slack", "saved_search", "email", "webhook", "alert_action"}
    assert blocks.kinds_of(None) == set()


def test_setting_is_checked_and_shown_to_everyone(w):
    status, out = w.call("root", "GET", "/orchestrator/settings")
    assert out["settings"]["turned_off"] == []
    for bad in (["search"], ["nope"], "approval", [1]):
        status, out = w.call("root", "PUT", "/orchestrator/settings", {"turned_off": bad})
        assert status == 400, bad
    status, out = w.call("root", "PUT", "/orchestrator/settings", {"turned_off": ["webhook", "approval"]})
    assert status == 200, out
    assert out["settings"]["turned_off"] == ["approval", "webhook"]
    status, out = w.call("alice", "GET", "/orchestrator/me")
    assert out["turned_off"] == ["approval", "webhook"]
    status, out = w.call("alice", "PUT", "/orchestrator/settings", {"turned_off": []})
    assert status == 403


def test_a_turned_off_block_cant_be_added_but_existing_jobs_keep_it(w):
    job = saved(w, body=approval_body())
    w.call("root", "PUT", "/orchestrator/settings", {"turned_off": ["approval"]})
    # The job that already has an approval still saves.
    body = approval_body()
    body["description"] = "changed"
    status, out = w.call("alice", "PUT", "/orchestrator/jobs/%s" % job["id"], body)
    assert status == 200, out
    # A new job with one is refused, with a message saying where to turn it on.
    body = approval_body()
    body["id"] = "other"
    status, out = w.call("alice", "POST", "/orchestrator/jobs/validate", body)
    assert not out["valid"]
    errors = [i for i in out["issues"] if i["level"] == "error"]
    assert [i["code"] for i in errors] == ["block_turned_off"]
    assert "Approval is turned off in Settings > Building blocks" in errors[0]["message"]
    status, out = w.call("alice", "POST", "/orchestrator/jobs", body)
    assert status == 400
    # Turned back on, it saves.
    w.call("root", "PUT", "/orchestrator/settings", {"turned_off": []})
    status, out = w.call("alice", "POST", "/orchestrator/jobs", body)
    assert status == 201, out
