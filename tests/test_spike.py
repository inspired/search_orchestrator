"""Pure helpers of the Milestone 1 spike. Removed with the spike in Task 6."""
import json

import pytest

import orchestrator_engine as spike


def test_make_row_encodes_detail_and_ok():
    row = spike.make_row("identity", True, {"username": "u"}, "sid1", 12.9)
    assert row == {"check": "identity", "ok": 1, "detail": '{"username": "u"}', "sid": "sid1", "at": 12}
    assert spike.make_row("x", False, "raw", None, 1)["ok"] == 0
    assert spike.make_row("x", False, "raw", None, 1)["sid"] == ""


def test_make_row_truncates_detail():
    row = spike.make_row("x", True, "a" * (spike.MAX_DETAIL + 10), "", 1)
    assert row["detail"].endswith("...[truncated]")
    assert len(row["detail"]) < spike.MAX_DETAIL + 20


def test_dispatch_params():
    assert spike.dispatch_params(5, {"v": "a"}, {"workload_pool": "p"}) == {
        "dispatch.now": 5, "force_dispatch": 1, "trigger_actions": 0, "args.v": "a", "workload_pool": "p"}


def test_parse_sid_json_and_xml():
    assert spike.parse_sid('{"sid": "abc"}') == "abc"
    assert spike.parse_sid("<response>\n <sid>abc__1</sid>\n</response>") == "abc__1"
    with pytest.raises(spike.SpikeError):
        spike.parse_sid("{}")
    with pytest.raises(spike.SpikeError):
        spike.parse_sid("<nope/>")


def test_job_summary_and_state():
    body = json.dumps({"entry": [{"author": "a", "acl": {"owner": "o", "app": "ap", "sharing": "user"},
                                  "content": {"dispatchState": "DONE", "isDone": True, "isFailed": False,
                                              "ttl": 60, "other": "dropped"}}]})
    summary = spike.job_summary(body)
    assert summary["acl_owner"] == "o" and summary["author"] == "a" and summary["ttl"] == 60
    assert "other" not in summary
    assert spike.job_finished(summary) and not spike.job_failed(summary)
    assert spike.job_failed({"dispatchState": "FAILED"})
    assert spike.job_failed({"isFailed": "1"})
    assert not spike.job_finished({"dispatchState": "RUNNING", "isDone": False})


def test_results_and_values():
    rows = spike.parse_results('{"results": [{"count": "3", "roles": ["r1", "r2"]}]}')
    assert spike.count_of(rows) == 3
    assert spike.first_value(rows, "roles") == "r1"
    assert spike.parse_results("{}") == []
    assert spike.count_of([]) is None
    assert spike.count_of([{"count": "x"}]) is None
    assert spike.first_value([{}], "a") is None


@pytest.mark.parametrize("rows,expected", [
    ([{"username": "u", "roles": "r"}], True),
    ([{"username": "u", "roles": ["r"]}], True),
    ([{"username": "splunk-system-user", "roles": ["r"]}], False),
    ([{"username": "u", "roles": ["r", "admin"]}], False),
    ([], False),
])
def test_identity_ok(rows, expected):
    assert spike.identity_ok(rows, "u", "r") is expected


def test_args_ok():
    good = {"v": "x", "literal": "foo$", "other": "$unknown$"}
    assert spike.args_ok([good], "x")
    assert not spike.args_ok([dict(good, v="$args.v$")], "x")
    assert not spike.args_ok([dict(good, other="")], "x")
    assert not spike.args_ok([dict(good, literal="foo")], "x")


def test_snapped_time_ok():
    now = 1_700_000_000
    assert spike.snapped_time_ok(str(now - spike.DAY - 100), now)
    assert spike.snapped_time_ok(now - 2 * spike.DAY + 10, now)
    assert not spike.snapped_time_ok(now + 5 * spike.DAY, now)  # computed from the real clock
    assert not spike.snapped_time_ok(None, now)
    assert not spike.snapped_time_ok("abc", now)


def test_iso_time():
    assert spike.iso_time(0) == "1970-01-01T00:00:00.000+00:00"


def test_pick_pool():
    pool = lambda name, **content: {"name": name, "content": content}
    pick = lambda *entries: spike.pick_pool(json.dumps({"entry": list(entries)}))
    assert pick() is None
    assert pick(pool("a", category="ingest"), pool("b", category="search"),
                pool("c", category="search", default_category_pool="1")) == "c"
    assert pick(pool("a", category="ingest"), pool("b", category="search")) == "b"
    assert pick(pool("a")) == "a"


@pytest.mark.parametrize("before,after,expected", [
    ({"dispatchState": "RUNNING", "isDone": False}, {"missing": True}, True),
    ({"dispatchState": "RUNNING"}, {"dispatchState": "FINALIZING"}, True),
    ({"dispatchState": "QUEUED"}, {"dispatchState": "CANCELED"}, True),
    # The job failed by itself: the cancel did nothing.
    ({"dispatchState": "RUNNING"}, {"dispatchState": "FAILED", "isFailed": True}, False),
    # Finalized flag alone is not a cancel marker, and the job may have just finished.
    ({"dispatchState": "RUNNING"}, {"dispatchState": "DONE", "isDone": True, "isFinalized": True}, False),
    ({"dispatchState": "RUNNING"}, {"dispatchState": "RUNNING"}, False),
    # Already over before the cancel.
    ({"dispatchState": "DONE", "isDone": True}, {"missing": True}, False),
    ({"dispatchState": "FAILED"}, {"dispatchState": "CANCELED"}, False),
    ({"missing": True}, {"missing": True}, False),
])
def test_cancel_ok(before, after, expected):
    assert spike.cancel_ok(before, after) is expected


@pytest.mark.parametrize("before,after,expected", [
    (100, 300, True), ("300", "300", True), (300, 299, False),
    (None, 300, False), (300, None, False), ("x", 300, False),
])
def test_touch_ok(before, after, expected):
    assert spike.touch_ok(before, after) is expected


@pytest.mark.parametrize("after,expected", [
    (1234, True), ("1200", True), (1174, True),
    (1173, False), (1235, False), (300, False), (None, False),
])
def test_setttl_ok(after, expected):
    assert spike.setttl_ok(after, 1234) is expected


def test_done_detail_complete():
    detail = spike.done_detail(["a", "b"], ["a", "b"], [("a", True), ("b", False)])
    assert detail["expected"] == 2 and detail["checks"] == ["a", "b"] and detail["missing"] == []
    assert detail["matched"] == 1 and detail["failed"] == ["b"]


def test_done_detail_shows_partial_run():
    detail = spike.done_detail(["a", "b", "c"], ["a"], [("a", True), ("b", True), ("c", True)])
    assert detail["expected"] == 3 and detail["checks"] == ["a"] and detail["missing"] == ["b", "c"]
