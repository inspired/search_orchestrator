"""Following a job: the REST routes and the notifications the action runner sends."""
import json

from so import follows
from test_actions import T, W, WEBHOOK  # noqa: F401
from test_api import error, job_body, saved, w  # noqa: F401  (w is a fixture)


def follow(w, body, user="alice", job_id="daily"):
    return w.call(user, "PUT", "/orchestrator/jobs/%s/follow" % job_id, body)


def test_follow_unfollow_and_the_jobs_list_flag(w):
    w.gw.users.setdefault("alice", {"roles": [], "capabilities": []})
    w.gw.users["alice"]["email"] = "alice@example.com"
    saved(w)
    status, out = w.call("alice", "GET", "/orchestrator/jobs/daily/follow")
    assert status == 200 and out["follow"] is None and out["email"] == "alice@example.com"
    status, out = follow(w, {"on": ["late", "failure"]})
    assert status == 200 and out["follow"]["on"] == ["failure", "late"]  # stored in a fixed order
    status, out = w.call("alice", "GET", "/orchestrator/jobs")
    assert out["jobs"][0]["following"] is True
    status, out = w.call("alice", "DELETE", "/orchestrator/jobs/daily/follow")
    assert out == {"follow": None}
    status, out = w.call("alice", "GET", "/orchestrator/jobs")
    assert out["jobs"][0]["following"] is False


def test_bad_follows(w):
    saved(w)
    for body in ({"on": []}, {"on": ["sometimes"]}, {"on": ["failure", "failure"]},
                 {"on": ["failure"], "notify": {"type": "sms"}}):
        status, out = follow(w, body)
        assert (status, error(out)) == (400, "bad_request"), body
    status, out = follow(w, {"on": ["failure"]})  # alice has no email in the fake
    assert error(out) in ("no_email", "bad_request")
    status, out = follow(w, {"on": ["failure"], "notify": {"type": "webhook", "destination": "nope"}})
    assert (status, error(out)) == (400, "bad_request")  # webhook destinations were removed


def test_a_job_you_cannot_see_cannot_be_followed(w):
    saved(w)
    status, out = follow(w, {"on": ["failure"]}, user="mallory")
    assert status in (403, 404)


def test_deleting_the_job_removes_its_follows(w):
    w.gw.users.setdefault("alice", {"roles": [], "capabilities": []})
    w.gw.users["alice"]["email"] = "alice@example.com"
    saved(w)
    follow(w, {"on": ["failure"]})
    w.call("alice", "DELETE", "/orchestrator/jobs/daily")
    assert not w.gw.kv_query(follows.FOLLOWS)


def _follower(w, on=("failure",), notify=None, user="bob", email="bob@example.com"):
    w.gw.users[user] = {"roles": ["ops"], "capabilities": ["orchestrator_run"], "email": email}
    job = w.store.get_job("j")
    job["run_roles"] = ["ops"]
    w.store.save_job(job)
    w.gw.kv_insert(follows.FOLLOWS, {"_key": follows.follow_key("j", user), "job_id": "j",
                                     "user": user, "on": list(on),
                                     "notify": notify or {"type": "email"}})


def test_a_follower_gets_an_email_at_their_own_address():
    w = W()
    _follower(w)
    w.gw.script_job("_so_fallback_email", ["done"])
    w.submit("on_failure", "job")
    w.submit("on_failure", "job")  # replay: still one row
    assert len(w.rows(kind="follow")) == 1
    w.pump()
    d = [x for x in w.gw.dispatch_log if x["name"] == "_so_fallback_email"][0]
    assert d["owner"] == "nobody" and d["args"]["to"] == "bob@example.com"
    assert "you follow this job" in d["args"]["subject"]


def test_follows_only_fire_for_the_events_asked_for():
    w = W()
    _follower(w, on=("late",))
    w.submit("on_failure", "job")
    assert not w.rows(kind="follow")
    w.submit("on_late", "job")
    assert len(w.rows(kind="follow")) == 1


def test_a_follower_who_lost_access_or_has_no_email_is_not_sent_anything():
    w = W()
    _follower(w)
    w.gw.users["bob"]["roles"] = []
    w.submit("on_failure", "job")
    w.pump()
    assert w.rows(kind="follow")[0]["state"] == "failed"
    assert "may no longer see" in w.rows(kind="follow")[0]["error"]
    w2 = W()
    _follower(w2, email="")
    w2.submit("on_failure", "job")
    w2.pump()
    assert "no email address" in w2.rows(kind="follow")[0]["error"]


