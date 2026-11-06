import configparser
from pathlib import Path

from fakes import FakeGateway
from so import actions, hidden

APP = Path(__file__).resolve().parent.parent / "app" / "search_orchestrator"


def job(spl="| makeresults | eval p=\"$run.param.p$\"", **over):
    j = {"id": "daily", "owner": "alice", "params": [{"name": "p", "type": "string"}],
         "steps": [{"id": "a", "type": "inline", "spl": spl, "earliest": "-1d@d", "latest": "@d"}],
         "edges": [], "actions": []}
    j.update(over)
    return j


def names(gw):
    return {k for k in gw.saved_searches}


def test_hidden_name_changes_with_spl():
    gw = FakeGateway()
    one = hidden.sync(gw, job(), None)
    two = hidden.sync(gw, job(spl="| makeresults count=2"), one)
    again = hidden.sync(gw, job(), two)
    n1, n2 = one["steps"][0]["hidden_search"], two["steps"][0]["hidden_search"]
    assert n1 != n2 and n1 == again["steps"][0]["hidden_search"]
    assert n1.startswith("_so_daily_a_") and len(n1) == len("_so_daily_a_") + 8
    assert {("alice", n1), ("alice", n2)} <= names(gw)


def test_hidden_name_changes_with_time_range():
    gw = FakeGateway()
    one = hidden.sync(gw, job(), None)
    j = job()
    j["steps"][0]["earliest"] = "-7d@d"
    two = hidden.sync(gw, j, one)
    assert one["steps"][0]["hidden_search"] != two["steps"][0]["hidden_search"]


def test_sync_compiles_tokens_and_keeps_literal_dollars():
    gw = FakeGateway()
    out = hidden.sync(gw, job(spl='search x | rex "foo$" | eval p="$run.param.p$" | eval u="$nope$"'),
                      None)
    st = out["steps"][0]
    saved = gw.saved_searches[("alice", st["hidden_search"])]
    assert saved["search"] == 'search x | rex "foo$" | eval p="$args.run__param__p$" | eval u="$nope$"'
    assert (saved["earliest"], saved["latest"]) == ("-1d@d", "@d")
    assert st["mode"] == "inline"
    assert out["hidden_searches"] == [{"owner": "alice", "name": st["hidden_search"]}]


def test_saved_step_owned_direct_else_wrapped():
    gw = FakeGateway()
    gw.upsert_saved_search("alice", "mine", "index=a", "-1h", "now")
    gw.upsert_saved_search("bob", "theirs", "index=b", "-1h", "now")
    gw.saved_searches[("bob", "theirs")]["sharing"] = "app"
    gw.upsert_saved_search("alice", "mine_user", "index=a", "-1h", "now")
    gw.saved_searches[("alice", "mine_user")]["dispatch_as"] = "user"
    j = job(steps=[{"id": "d", "type": "saved_search", "saved_search_ref": "mine"},
                   {"id": "w", "type": "saved_search", "saved_search_ref": "theirs"},
                   {"id": "u", "type": "saved_search", "saved_search_ref": "mine_user"}])
    issues = []
    out = hidden.sync(gw, j, None, issues)
    d, w, u = out["steps"]
    assert d["mode"] == "direct" and d["hidden_search"] == "mine"
    assert w["mode"] == "wrapped" and w["hidden_search"].startswith("_so_daily_w_")
    assert gw.saved_searches[("alice", w["hidden_search"])]["search"] == '| savedsearch "theirs"'
    assert u["mode"] == "wrapped"
    warned = sorted(i["step"] for i in issues if i["code"] == "saved_search_wrapped")
    assert warned == ["u", "w"]
    assert all(i["level"] == "warning" for i in issues)
    assert {"owner": "alice", "name": "mine"} not in out["hidden_searches"]


def test_unreadable_saved_search_is_error():
    gw = FakeGateway()
    j = job(steps=[{"id": "x", "type": "saved_search", "saved_search_ref": "gone"}])
    _, searches, issues = hidden.plan(gw, j)
    assert [i["code"] for i in issues] == ["unknown_saved_search"]
    assert issues[0]["level"] == "error" and searches == []


def test_plan_writes_nothing():
    gw = FakeGateway()
    hidden.plan(gw, job())
    assert gw.saved_searches == {}


def test_action_searches_numbered_like_indexed_actions():
    gw = FakeGateway()
    j = job(actions=[{"hook": "on_failure", "type": "webhook", "destination": "ops"},
                     {"hook": "on_failure", "type": "email", "to": "a@example.com"}])
    j["steps"][0]["actions"] = [{"hook": "on_success", "type": "event", "index": "summary"},
                                {"hook": "on_failure", "type": "alert_action", "action": "notify",
                                 "params": {"severity": "high"}}]
    out = hidden.sync(gw, j, None)
    idx = {i: a["type"] for i, _, _, a in actions.indexed_actions(out)}
    assert idx == {0: "webhook", 1: "email", 2: "event", 3: "alert_action"}
    flat = [a for _, _, _, a in actions.indexed_actions(out)]
    assert "hidden_search" not in flat[0]
    for i in (1, 2, 3):
        assert flat[i]["hidden_search"].startswith("_so_daily_action_%d_" % i)
        assert len(flat[i]["hidden_search"]) == len("_so_daily_action_%d_" % i) + 8
    email = gw.saved_searches[("alice", flat[1]["hidden_search"])]["search"]
    event = gw.saved_searches[("alice", flat[2]["hidden_search"])]["search"]
    alert = gw.saved_searches[("alice", flat[3]["hidden_search"])]["search"]
    assert {e["name"] for e in out["hidden_searches"]} >= {flat[i]["hidden_search"]
                                                          for i in (1, 2, 3)}
    for arg in ("to", "subject", "message"):
        assert '"$args.%s$"' % arg in email
    assert "sendemail" in email
    assert '"$args.payload$"' in event and '"$args.index$"' in event and "collect" in event
    assert "sendalert $args.action$" in alert and 'param.severity="$args.param.severity$"' in alert


def test_bad_alert_action_param_name_is_error():
    j = job(actions=[{"hook": "on_failure", "type": "alert_action", "action": "notify",
                      "params": {"bad name": "x"}}])
    _, _, issues = hidden.plan(FakeGateway(), j)
    assert [i["code"] for i in issues] == ["bad_action"]


def _run(definition, owner="alice", state="running"):
    return {"_key": "r", "owner": owner, "state": state, "definition": definition}


def test_gc_keeps_versions_for_active_runs():
    gw = FakeGateway()
    one = hidden.sync(gw, job(), None)
    two = hidden.sync(gw, job(spl="| makeresults count=2"), one)
    old = one["steps"][0]["hidden_search"]
    assert hidden.gc(two, [_run(one)]) == []
    assert hidden.gc(two, []) == [{"owner": "alice", "name": old}]


def test_gc_tracks_owner_after_takeover():
    gw = FakeGateway()
    one = hidden.sync(gw, job(), None)
    two = hidden.sync(gw, dict(job(), owner="root"), one)
    name = one["steps"][0]["hidden_search"]
    assert two["steps"][0]["hidden_search"] == name
    assert hidden.gc(two, [_run(one, owner="alice")]) == []
    assert hidden.gc(two, []) == [{"owner": "alice", "name": name}]


def test_gc_never_deletes_direct_saved_search():
    gw = FakeGateway()
    gw.upsert_saved_search("alice", "mine", "index=a", "-1h", "now")
    j = hidden.sync(gw, job(steps=[{"id": "d", "type": "saved_search",
                                    "saved_search_ref": "mine"}]), None)
    assert hidden.gc(dict(j, steps=[]), []) == []


def test_fallback_email_stanza_shipped():
    conf = configparser.RawConfigParser(strict=True, interpolation=None)
    conf.optionxform = str
    conf.read(APP / "default" / "savedsearches.conf")
    st = conf[hidden.FALLBACK_EMAIL_SEARCH]
    assert st["is_visible"] == "false"
    assert st.get("enableSched", "0") == "0"
    for arg in ("to", "subject", "message"):
        assert "$args.%s$" % arg in st["search"]
    assert "| sendemail" in st["search"]
    meta = (APP / "metadata" / "default.meta").read_text()
    assert "[savedsearches/%s]" % hidden.FALLBACK_EMAIL_SEARCH in meta


def _email_job(**action):
    return job(actions=[dict({"hook": "on_failure", "type": "email", "to": "a@example.com"},
                             **action)])


def test_action_name_changes_with_type_and_spl_only():
    gw = FakeGateway()
    one = hidden.sync(gw, _email_job(), None)["actions"][0]["hidden_search"]
    same = hidden.sync(gw, _email_job(to="b@example.com"), None)["actions"][0]["hidden_search"]
    assert one == same  # recipients are run-time args, not SPL
    ev = hidden.sync(gw, job(actions=[{"hook": "on_failure", "type": "event", "index": "s"}]),
                     None)["actions"][0]["hidden_search"]
    assert ev != one and ev.startswith("_so_daily_action_0_")
    alert = lambda p: hidden.sync(gw, job(actions=[{  # noqa: E731
        "hook": "on_failure", "type": "alert_action", "action": "n", "params": p}]),
        None)["actions"][0]["hidden_search"]
    assert alert({"a": "1"}) != alert({"b": "1"})


def test_request_cannot_set_action_hidden_search():
    out = hidden.sync(FakeGateway(), job(actions=[
        {"hook": "on_failure", "type": "webhook", "destination": "x", "hidden_search": "evil"},
        {"hook": "on_failure", "type": "email", "to": "a@b.c", "hidden_search": "evil"}]), None)
    assert "hidden_search" not in out["actions"][0]
    assert out["actions"][1]["hidden_search"].startswith("_so_daily_action_1_")


def test_gc_keeps_action_versions_for_active_runs():
    gw = FakeGateway()
    one = hidden.sync(gw, _email_job(), None)
    two = hidden.sync(gw, job(actions=[{"hook": "on_failure", "type": "event", "index": "s"}]),
                      one)
    old = one["actions"][0]["hidden_search"]
    assert hidden.gc(two, [_run(one)]) == []
    assert hidden.gc(two, []) == [{"owner": "alice", "name": old}]


def test_apply_records_names_before_upserts():
    gw = FakeGateway()
    seen = []
    planned, searches, _ = hidden.plan(gw, _email_job())
    hidden.apply(gw, planned, searches, None,
                 record=lambda tracked: seen.append((list(tracked), dict(gw.saved_searches))))
    tracked, existing = seen[0]
    assert {e["name"] for e in tracked} == {s["name"] for s in searches} and existing == {}


def test_saved_search_outside_app_context_is_clear_error():
    # Final review I4: a search in another app that is not shared globally can't be
    # dispatched or wrapped from the Search Orchestrator app context.
    gw = FakeGateway()
    gw.upsert_saved_search("alice", "nightly", "index=a", "-1d@d", "@d")
    gw.saved_searches[("alice", "nightly")]["app"] = "search"
    gw.upsert_saved_search("bob", "shared_in_search", "index=b", "-1h", "now")
    gw.saved_searches[("bob", "shared_in_search")].update(app="search", sharing="app")
    gw.upsert_saved_search("bob", "global_one", "index=c", "-1h", "now")
    gw.saved_searches[("bob", "global_one")].update(app="search", sharing="global")
    j = job(steps=[{"id": "n", "type": "saved_search", "saved_search_ref": "nightly"},
                   {"id": "s", "type": "saved_search", "saved_search_ref": "shared_in_search"},
                   {"id": "g", "type": "saved_search", "saved_search_ref": "global_one"}])
    planned, searches, issues = hidden.plan(gw, j)
    errors = {i["step"]: i for i in issues if i["level"] == "error"}
    assert sorted(errors) == ["n", "s"]
    assert errors["n"]["code"] == "saved_search_not_visible"
    assert errors["n"]["message"] == ("Saved search 'nightly' must be shared globally or saved in "
                                      "the Search Orchestrator app to be used as a step.")
    assert errors["s"]["message"].startswith("Saved search 'shared_in_search' must be shared")
    assert planned["steps"][2]["mode"] == "wrapped"
