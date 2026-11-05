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
