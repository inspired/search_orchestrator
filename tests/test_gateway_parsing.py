import json
import os

import pytest
from so import gateway as g

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def fx(name):
    with open(os.path.join(FIX, name)) as f:
        return f.read()


class FakeHTTPError(Exception):
    def __init__(self, status):
        Exception.__init__(self, "HTTP {}".format(status))
        self.status = status


class Body:
    def __init__(self, text):
        self.text = text

    def read(self):
        return self.text.encode()


class Resp:
    def __init__(self, text):
        self.body = Body(text)


class StubService:
    def __init__(self, handler):
        self.handler = handler
        self.calls = []

    def _do(self, method, path, **kw):
        self.calls.append((method, path, kw))
        return self.handler(method, path, kw)

    def get(self, path, **kw):
        return self._do("get", path, **kw)

    def post(self, path, **kw):
        return self._do("post", path, **kw)

    def delete(self, path, **kw):
        return self._do("delete", path, **kw)


def test_status_parses_done_zero_results_as_success():
    s = g.parse_job_status(fx("job_done_zero.json"))
    assert (s["state"], s["result_count"], s["error"]) == ("done", 0, None)


def test_status_parses_running_and_rows():
    assert g.parse_job_status(fx("job_running.json"))["state"] == "running"
    s = g.parse_job_status(fx("job_done_rows.json"))
    assert s["state"] == "done" and s["result_count"] == 42


def test_status_parses_failed_with_message():
    s = g.parse_job_status(fx("job_failed.json"))
    assert s["state"] == "failed" and "unknown search command" in s["error"]


def test_status_zombie_is_failed():
    s = g.parse_job_status(fx("job_zombie.json"))
    assert s["state"] == "failed" and s["zombie"] is True and s["error"]


def test_status_finalized_flag():
    s = g.parse_job_status(fx("job_finalized.json"))
    assert s["state"] == "done" and s["finalized"] is True


def test_status_404_is_missing():
    def handler(method, path, kw):
        raise FakeHTTPError(404)
    gw = g.SplunkGateway(StubService(handler))
    assert gw.job_status("nope")["state"] == "missing"


def test_first_row_none_on_zero_rows():
    assert g.parse_first_row(fx("results_zero.json")) is None
    assert g.parse_first_row(fx("results_one.json"))["host"] == "web01"
    gw = g.SplunkGateway(StubService(lambda m, p, kw: Resp(fx("results_zero.json"))))
    assert gw.first_row("sid") is None


@pytest.mark.parametrize("status,transient", [(503, True), (429, True), (500, True),
                                              (400, False), (403, False), (404, False)])
def test_dispatch_503_transient_400_not(status, transient):
    def handler(method, path, kw):
        raise FakeHTTPError(status)
    gw = g.SplunkGateway(StubService(handler))
    with pytest.raises(g.DispatchError) as info:
        gw.dispatch("u", "_so_x", 1730000000, {})
    assert info.value.transient is transient


def test_dispatch_request_shape():
    svc = StubService(lambda m, p, kw: Resp(fx("dispatch_ok.json")))
    gw = g.SplunkGateway(svc)
    sid = gw.dispatch("alice", "_so_j_s", 1730000000.9, {"v": "x"}, earliest="-1d@d",
                      latest="@d", trigger_actions=True)
    method, path, kw = svc.calls[0]
    assert sid == "1730000000.5"
    assert (method, path, kw["owner"], kw["app"]) == ("post", "saved/searches/_so_j_s/dispatch",
                                                      "alice", "search_orchestrator")
    assert kw["dispatch.now"] == 1730000000 and kw["force_dispatch"] == 1
    assert kw["trigger_actions"] == 1 and kw["args.v"] == "x"
    assert kw["dispatch.earliest_time"] == "-1d@d" and kw["dispatch.latest_time"] == "@d"
    assert "workload_pool" not in kw


def test_upsert_never_sends_scheduling_arguments():
    svc = StubService(lambda m, p, kw: Resp("{}"))
    g.SplunkGateway(svc).upsert_saved_search("alice", "_so_j_s", "search *", "-1h", "now", "d")
    kw = svc.calls[0][2]
    assert "is_scheduled" not in kw and "dispatchAs" not in kw
    assert kw["is_visible"] == 0 and kw["search"] == "search *"


def test_upsert_creates_on_404():
    def handler(method, path, kw):
        if path != "saved/searches":
            raise FakeHTTPError(404)
        return Resp("{}")
    svc = StubService(handler)
    g.SplunkGateway(svc).upsert_saved_search("alice", "_so_j_s", "search *", "-1h", "now")
    assert svc.calls[-1][1] == "saved/searches" and svc.calls[-1][2]["name"] == "_so_j_s"


def test_history_filters_and_sorts():
    assert g.parse_history(fx("history.json"), 1793000000 - 10**9) == [
        "1730000200.3", "1730000100.2", "scheduler__old"]
    cutoff = g._epoch("2026-11-05T09:00:00+00:00")
    assert g.parse_history(fx("history.json"), cutoff) == ["1730000200.3", "1730000100.2"]


def test_kv_insert_409_is_false_and_other_errors_raise():
    def dup(method, path, kw):
        raise FakeHTTPError(409)
    assert g.SplunkGateway(StubService(dup)).kv_insert("so_runs", {"_key": "a"}) is False

    def down(method, path, kw):
        raise FakeHTTPError(503)
    with pytest.raises(g.KvError):
        g.SplunkGateway(StubService(down)).kv_insert("so_runs", {"_key": "a"})


def test_webhook_refuses_non_https():
    gw = g.SplunkGateway(StubService(lambda *a: None))
    for url in ("http://example.com/x", "file:///etc/passwd", "ftp://h/x", "https:///x"):
        with pytest.raises(g.GatewayError):
            gw.post_webhook(url, {}, "{}")


def test_from_session_accepts_loopback_only():
    for uri in ("https://127.0.0.1:8089", "https://localhost:8089", "https://[::1]:8089"):
        assert isinstance(g.SplunkGateway.from_session(uri, "key"), g.SplunkGateway)
    for uri in ("https://splunk.example.com:8089", "https://10.0.0.5:8089", "https://127.0.0.1.evil.com:8089"):
        with pytest.raises(g.GatewayError):
            g.SplunkGateway.from_session(uri, "key")


def test_webhook_error_does_not_leak_url_secret():
    with pytest.raises(g.GatewayError) as info:
        g.check_webhook_url("http://hooks.example.com/services/T0/B0/SECRETTOKEN")
    assert "SECRETTOKEN" not in str(info.value) and "hooks.example.com" in str(info.value)


def test_status_includes_ttl():
    assert g.parse_job_status(fx("job_running.json"))["ttl"] == 600


def _raiser(status):
    def handler(method, path, kw):
        raise FakeHTTPError(status)
    return g.SplunkGateway(StubService(handler))


def test_kv_404_on_insert_update_query_raises_kv_error():
    gw = _raiser(404)
    with pytest.raises(g.KvError):
        gw.kv_insert("so_missing", {"_key": "a"})
    with pytest.raises(g.KvError):
        gw.kv_query("so_missing")
    with pytest.raises(g.KvError):
        gw.kv_batch_save("so_missing", [{"_key": "a"}])
    assert gw.kv_update("so_runs", "a", {}) is False  # 404 on update means no such key
    assert gw.kv_get("so_runs", "a") is None


def test_kv_409_on_update_raises_kv_error():
    with pytest.raises(g.KvError):
        _raiser(409).kv_update("so_runs", "a", {})
    with pytest.raises(g.KvError):
        _raiser(409).kv_get("so_runs", "a")


def test_parse_user_access():
    body = ('{"entry":[{"content":{"roles":["ops"],"capabilities":["orchestrator_run"]}}]}')
    assert g.parse_user_access(body) == {"roles": ["ops"], "capabilities": ["orchestrator_run"]}


def test_parse_saved_search_info():
    body = ('{"entry":[{"name":"s","acl":{"owner":"alice","sharing":"user","app":"search_orchestrator"},'
            '"content":{"dispatchAs":"owner","search":"index=x"}}]}')
    assert g.parse_saved_search_info(body) == {"exists": True, "owner": "alice", "sharing": "user",
                                               "dispatch_as": "owner", "app": "search_orchestrator",
                                               "visible": True}


def test_parse_saved_search_info_visibility_across_apps():
    def entry(app, sharing, owner="alice"):
        return {"name": "s", "acl": {"owner": owner, "sharing": sharing, "app": app},
                "content": {"dispatchAs": "owner"}}
    one = lambda *e: g.parse_saved_search_info(json.dumps({"entry": list(e)}))  # noqa: E731
    assert one(entry("search", "user"))["visible"] is False
    assert one(entry("search", "app"))["visible"] is False
    assert one(entry("search", "global"))["visible"] is True
    assert one(entry("search", "system"))["visible"] is True
    # Several apps hold the name: the one visible from this app wins.
    info = one(entry("search", "user"), entry("search_orchestrator", "app", "bob"))
    assert info["owner"] == "bob" and info["visible"] is True
    assert one(entry("search", "user"))["app"] == "search"


def test_saved_search_info_404_is_missing():
    info = _raiser(404).saved_search_info("alice", "nope")
    assert info == {"exists": False, "owner": None, "sharing": None, "dispatch_as": None,
                    "app": None, "visible": False}


def test_saved_search_info_reads_owner_namespace():
    body = ('{"entry":[{"acl":{"owner":"bob","sharing":"app"},"content":{"dispatchAs":"user"}}]}')
    svc = StubService(lambda m, p, kw: Resp(body))
    info = g.SplunkGateway(svc).saved_search_info("alice", "x y")
    assert svc.calls[0][0] == "get" and svc.calls[0][2]["owner"] == "alice"
    assert svc.calls[0][2]["app"] == "-"  # wildcard app: the lookup sees every app
    assert svc.calls[0][1] == "saved/searches/x%20y"  # encoded exactly once (see below)
    assert info == {"exists": True, "owner": "bob", "sharing": "app", "dispatch_as": "user",
                    "app": None, "visible": False}


def test_index_exists():
    svc = StubService(lambda m, p, kw: Resp('{"entry":[{"name":"orchestrator"}]}'))
    assert g.SplunkGateway(svc).index_exists("orchestrator") is True
    assert _raiser(404).index_exists("orchestrator") is False


def test_delete_secret_path_and_404_ok():
    svc = StubService(lambda m, p, kw: Resp("{}"))
    g.SplunkGateway(svc).delete_secret("destination_ops_url")
    assert svc.calls[0][:2] == ("delete", "storage/passwords/search_orchestrator:destination_ops_url:")
    _raiser(404).delete_secret("gone")
    with pytest.raises(g.GatewayError):
        _raiser(500).delete_secret("x")


def _final_path(path, owner="alice", app="search_orchestrator"):
    """The path splunklib actually requests for a gateway path segment."""
    from splunklib import binding
    return binding.Context(owner=owner, app="search_orchestrator")._abspath(path, owner=owner,
                                                                            app=app)


def test_saved_search_names_encoded_once_with_spaces_and_slash():
    svc = StubService(lambda m, p, kw: Resp('{"entry":[{"acl":{},"content":{}}]}'
                                            if m == "get" else '{"sid":"1"}'))
    gw = g.SplunkGateway(svc)
    name = "Errors last 24h/by host"
    gw.saved_search_info("alice", name)
    gw.dispatch("alice", name, 1, {})
    gw.upsert_saved_search("alice", name, "x", "-1h", "now")
    gw.delete_saved_search("alice", name)
    gw.history("alice", name, 0)
    want = "/servicesNS/alice/search_orchestrator/saved/searches/Errors%20last%2024h%2Fby%20host"
    finals = [_final_path(c[1], app=c[2].get("app", "search_orchestrator")) for c in svc.calls]
    assert finals[0] == want.replace("/search_orchestrator/", "/-/")
    assert finals[2] == want and finals[3] == want
    assert finals[1] == want + "/dispatch" and finals[4] == want + "/history"


def test_kv_keys_quoted_against_traversal():
    svc = StubService(lambda m, p, kw: Resp("{}"))
    gw = g.SplunkGateway(svc)
    gw.kv_get("so_jobs", "../so_runs/x")
    gw.kv_update("so_jobs", "a/b", {})
    gw.kv_delete("so_jobs", "..")
    finals = [_final_path(c[1], "nobody") for c in svc.calls]
    base = "/servicesNS/nobody/search_orchestrator/storage/collections/data/so_jobs/"
    assert finals == [base + "..%2Fso_runs%2Fx", base + "a%2Fb", base + "%2E%2E"]


def test_index_name_encoded_once():
    svc = StubService(lambda m, p, kw: Resp("{}"))
    g.SplunkGateway(svc).index_exists("my index")
    assert _final_path(svc.calls[0][1], "nobody").endswith("/data/indexes/my%20index")


def test_parse_history_details_reads_dispatch_now():
    body = json.dumps({"entry": [
        {"name": "s1", "published": "2026-12-01T01:00:05+00:00",
         "content": {"dispatch.now": "1796086800"}},
        {"name": "s2", "published": "2026-12-01T01:00:09+00:00",
         "content": {"request": {"dispatch.now": "1796086000"}}},
        {"name": "s3", "published": "2026-12-01T01:00:07+00:00", "content": {}},
        {"name": "old", "published": "2026-11-30T01:00:00+00:00", "content": {}}]})
    out = g.parse_history_details(body, 1796086800)
    assert [d["sid"] for d in out] == ["s2", "s3", "s1"]
    assert out[0]["dispatch_now"] == 1796086000 and out[1]["dispatch_now"] is None
    assert out[2]["dispatch_now"] == 1796086800 and out[1]["published"] == 1796086807


def test_done_job_with_error_message_is_failed():
    # Real server, 10.6.1.1: a missing lookup ends DONE with isFailed=0 and an ERROR message.
    body = json.dumps({"entry": [{"content": {
        "dispatchState": "DONE", "isDone": True, "isFailed": False, "resultCount": 1,
        "messages": [{"type": "ERROR", "text": "The lookup table 'x.csv' requires a .csv or KV store lookup definition."},
                     {"type": "WARN", "text": "[subsearch]: something"}]}}]})
    st = g.parse_job_status(body)
    assert st["state"] == "failed"
    assert "x.csv" in st["error"] and "subsearch" not in st["error"]


def test_done_job_with_only_warnings_is_done():
    body = json.dumps({"entry": [{"content": {
        "dispatchState": "DONE", "isDone": True, "resultCount": 0,
        "messages": [{"type": "WARN", "text": "truncated"}]}}]})
    assert g.parse_job_status(body)["state"] == "done"


def test_search_oneshot_uses_search_jobs_exec_mode():
    calls = []

    class Svc:
        def post(self, path, **kw):
            calls.append((path, kw))

            class R:  # noqa: D401
                body = type("B", (), {"read": lambda self: b'{"results": [{"a": "1"}]}'})()
                status = 200
            return R()
    gw = g.SplunkGateway(Svc())
    rows = gw.search_oneshot("bob", "search x")
    assert rows == [{"a": "1"}]
    path, kw = calls[0]
    assert str(path).endswith("search/jobs") and kw.get("exec_mode") == "oneshot"


def _status_body(**content):
    return json.dumps({"entry": [{"content": content}]})


def test_status_reports_subsearch_truncation_from_info_message():
    body = _status_body(dispatchState="DONE", isDone="1", messages=[{"type": "INFO",
        "text": "[subsearch]: Subsearch produced 100000 results, truncating to maxout "
                "[subsearch_maxout] 50000."}])
    st = g.parse_job_status(body)
    assert st["state"] == "done" and "truncating to maxout" in st["truncated"]


def test_status_truncated_other_subsearch_limits_and_none():
    for text in ("[subsearch]: Subsearch timed out after 60 seconds",
                 "[subsearch]: Subsearch was auto-finalized after 60 seconds"):
        st = g.parse_job_status(_status_body(isDone="1", messages=[{"type": "WARN",
                                                                     "text": text}]))
        assert st["state"] == "done" and st["truncated"] == text
    st = g.parse_job_status(_status_body(isDone="1", messages=[{"type": "INFO",
                                                                 "text": "timed out"}]))
    assert st["truncated"] is None
    assert g.parse_job_status(fx("job_done_rows.json"))["truncated"] is None
    assert g.MISSING_STATUS["truncated"] is None


def test_status_reports_subsearch_time_limit_from_real_messages():
    # Real server, 10.6: append maxtime=1 [...] that hit its limit.
    first = ("[subsearch]: The search auto-finalized after it reached its time limit: "
             "1 seconds.")
    st = g.parse_job_status(_status_body(dispatchState="DONE", isDone="1", messages=[
        {"type": "INFO", "text": first}, {"type": "INFO", "text": "[subsearch]: Search finalized."}]))
    assert st["state"] == "done" and st["truncated"] == first


def test_status_unrelated_info_message_is_not_truncation():
    st = g.parse_job_status(_status_body(dispatchState="DONE", isDone="1", messages=[
        {"type": "INFO", "text": "Your timerange was substituted based on your search string"}]))
    assert st["state"] == "done" and st["truncated"] is None


def _preview_job_body():
    return json.dumps({"entry": [{
        "name": "so_preview_x", "acl": {"owner": "alice", "app": "search_orchestrator"},
        "content": {"dispatchState": "DONE", "isDone": True, "resultCount": 3,
                    "runDuration": 0.42, "ttl": 1800,
                    "messages": [{"type": "INFO", "text": "hello"},
                                 {"type": "WARN", "text": "careful"}]}}]})


def test_parse_preview_info():
    info = g.parse_preview_info(_preview_job_body())
    assert info == {"owner": "alice", "state": "done", "result_count": 3, "error": None,
                    "truncated": None, "run_duration": 0.42,
                    "messages": [{"type": "INFO", "text": "hello"},
                                 {"type": "WARN", "text": "careful"}]}
    running = g.parse_preview_info(json.dumps({"entry": [{"content": {
        "dispatchState": "RUNNING", "eai:acl": {"owner": "bob"}}}]}))
    assert (running["owner"], running["state"], running["run_duration"]) == ("bob", "running", None)
    assert running["messages"] == []


def test_preview_info_request_and_404():
    svc = StubService(lambda m, p, kw: Resp(_preview_job_body()))
    info = g.SplunkGateway(svc).preview_info("so_preview_x")
    assert info["owner"] == "alice"
    method, path, kw = svc.calls[0]
    assert (method, str(path)) == ("get", "search/jobs/so_preview_x")

    def handler(method, path, kw):
        raise FakeHTTPError(404)
    missing = g.SplunkGateway(StubService(handler)).preview_info("gone")
    assert missing["state"] == "missing" and missing["owner"] is None
    assert missing["messages"] == [] and missing["truncated"] is None


def test_parse_preview_results():
    out = g.parse_preview_results(fx("results_one.json"))
    assert out == {"fields": ["host", "count"], "rows": [{"host": "web01", "count": "7"}]}
    named = g.parse_preview_results(json.dumps({"fields": [{"name": "a"}, {"name": "b"}],
                                                "results": [{"a": "1"}]}))
    assert named == {"fields": ["a", "b"], "rows": [{"a": "1"}]}
    assert g.parse_preview_results(fx("results_zero.json"))["rows"] == []


def test_preview_results_request():
    svc = StubService(lambda m, p, kw: Resp(fx("results_one.json")))
    out = g.SplunkGateway(svc).preview_results("so_preview_x", 100)
    assert out["rows"][0]["host"] == "web01"
    method, path, kw = svc.calls[0]
    assert (method, str(path), kw["count"]) == ("get", "search/jobs/so_preview_x/results", 100)


def test_preview_dispatch_request_shape():
    svc = StubService(lambda m, p, kw: Resp('{"sid": "so_preview_abc"}'))
    gw = g.SplunkGateway(svc)
    sid = gw.preview_dispatch("alice", "| makeresults", "-1d@d", "@d", 1794272400.7,
                              "so_preview_abc")
    assert sid == "so_preview_abc"
    method, path, kw = svc.calls[0]
    assert (method, str(path), kw["owner"], kw["app"]) == ("post", "search/jobs", "alice",
                                                           "search_orchestrator")
    assert kw["search"] == "| makeresults" and kw["id"] == "so_preview_abc"
    assert kw["now"] == 1794272400 and kw["exec_mode"] == "normal"
    assert (kw["auto_cancel"], kw["timeout"]) == (180, 1800)
    assert (kw["earliest_time"], kw["latest_time"]) == ("-1d@d", "@d")
    svc.calls.clear()
    gw.preview_dispatch("alice", "| x", "", None, 1, "so_preview_abc")
    kw = svc.calls[0][2]
    assert "earliest_time" not in kw and "latest_time" not in kw


def test_preview_dispatch_errors_are_dispatch_errors():
    def handler(method, path, kw):
        raise FakeHTTPError(400)
    with pytest.raises(g.DispatchError) as info:
        g.SplunkGateway(StubService(handler)).preview_dispatch("u", "x", "", "", 1, "so_preview_a")
    assert info.value.transient is False and info.value.status == 400


ALERT_ACTIONS = json.dumps({"entry": [
    {"name": "webhook", "content": {"label": "Webhook", "is_custom": "1", "disabled": "0"}},
    {"name": "email", "content": {"label": "Send email", "disabled": False}},
    {"name": "summary_index", "content": {"disabled": "0"}},
    {"name": "logevent", "content": {"label": "Log Event", "is_custom": True, "disabled": False}},
    {"name": "off", "content": {"label": "Off", "is_custom": "1", "disabled": "1"}},
    {"name": "bare", "content": {"label": "", "is_custom": 1}},
]})


def test_alert_actions_lists_only_enabled_custom_actions_by_label():
    assert g.parse_alert_actions(ALERT_ACTIONS) == [
        {"name": "bare", "label": "bare", "params": []},
        {"name": "logevent", "label": "Log Event", "params": []},
        {"name": "webhook", "label": "Webhook", "params": []},
    ]


FORMS = json.dumps({"entry": [{"name": "logevent", "content": {"eai:data":
    '<label>Index</label><input name="action.logevent.param.index"/>'}}]})


def _alert_handler(forms):
    def handler(method, path, kw):
        if path == "data/ui/alerts":
            return forms(kw)
        return Resp(ALERT_ACTIONS)
    return handler


def test_alert_actions_reads_actions_and_forms_from_this_apps_namespace():
    svc = StubService(_alert_handler(lambda kw: Resp(FORMS)))
    found = {a["name"]: a for a in g.SplunkGateway(svc).alert_actions("alice")}
    assert [p["name"] for p in found["logevent"]["params"]] == ["index"]
    assert [c[:2] for c in svc.calls] == [("get", "alerts/alert_actions"), ("get", "data/ui/alerts")]
    for _, _, kw in svc.calls:
        assert (kw["owner"], kw["app"], kw["count"]) == ("alice", g.APP, 0)


def test_alert_actions_are_still_listed_when_the_forms_cannot_be_read():
    def denied(kw):
        raise FakeHTTPError(403)
    found = g.SplunkGateway(StubService(_alert_handler(denied))).alert_actions("alice")
    assert [a["name"] for a in found] == ["bare", "logevent", "webhook"]
    assert all(a["params"] == [] for a in found)


def test_alert_actions_failure_is_a_gateway_error():
    def down(m, p, kw):
        raise FakeHTTPError(503)
    with pytest.raises(g.GatewayError) as err:
        g.SplunkGateway(StubService(down)).alert_actions("alice")
    assert err.value.status == 503 and err.value.transient
