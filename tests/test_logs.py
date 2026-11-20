"""Troubleshooting logs: the log files (so.logs) and the logs route (so.logs_api)."""
import json
import logging
import re

import pytest

from so import logs, logs_api
from so.audit import Audit
from so.gateway import GatewayError
from test_api import _request, Session, saved, start, w  # noqa: F401  (w is a fixture)


@pytest.fixture
def root_logger():
    root = logging.getLogger("so")
    level, handlers = root.level, list(root.handlers)
    yield root
    for h in root.handlers:
        if h not in handlers:
            h.close()
    root.handlers[:] = handlers
    root.setLevel(level)


# -- lines ---------------------------------------------------------------------

def test_kv_quotes_sorts_cuts_and_drops_secrets_and_none():
    line = logs.kv(run_id="daily:1", count=3, ok=True, note='say "hi"\nthere', token="t0p",
                   session_key="k", password="p", missing=None, long="x" * 600)
    assert line.startswith('count=3 long="' + "x" * 500 + '…" note="say \\"hi\\" there" ok=true')
    assert line.endswith('run_id="daily:1"')
    assert "t0p" not in line and "session_key" not in line and "password" not in line
    assert "missing" not in line


def test_audit_events_are_mirrored_without_bulky_fields(caplog):
    caplog.set_level(logging.INFO, logger="so")
    logs.audit_line({"type": "step_dispatched", "_time": 1, "run_id": "daily:1", "step_id": "a",
                     "definition": {"steps": []}, "params": {"x": "secret value"}})
    [rec] = [r for r in caplog.records if r.name == "so.audit"]
    assert rec.levelno == logging.INFO
    assert rec.getMessage() == 'event=step_dispatched run_id="daily:1" step_id="a"'


def test_engine_audit_writes_the_log_line_too(caplog):
    class Writer:
        def write_event(self, event):
            pass
    caplog.set_level(logging.INFO, logger="so")
    Audit(Writer(), index="orchestrator").emit({"type": "run_created", "run_id": "r1"})
    assert any(r.getMessage() == 'event=run_created run_id="r1"' for r in caplog.records)


def test_setup_writes_one_file_per_process_in_key_value_lines(tmp_path, root_logger):
    path = logs.setup("search_orchestrator", "engine", directory=str(tmp_path))
    assert path == str(tmp_path / "search_orchestrator.engine.log")
    assert logs.setup("search_orchestrator", "engine", directory=str(tmp_path)) == path  # once
    logs.event(logging.getLogger("so.engine"), logging.INFO, "tick", ms=12, run_id="daily:1")
    try:
        raise ValueError("boom")
    except ValueError:
        logging.getLogger("so.engine").exception("event=tick_failed")
    for h in root_logger.handlers:
        h.flush()
    text = open(path).read()
    first = text.splitlines()[0]
    assert ' level=INFO process=engine logger=so.engine event=tick ms=12 run_id="daily:1"' in first
    assert "level=ERROR" in text and "ValueError: boom" in text


def test_setup_without_a_log_folder_does_nothing(tmp_path, root_logger):
    assert logs.setup("search_orchestrator", "rest", directory=str(tmp_path / "nope")) is None


def test_level_comes_from_settings_at_most_every_30_seconds(root_logger):
    now = [1000]
    level = logs.LevelFromSettings(clock=lambda: now[0])
    settings = {"log_level": "debug"}
    level.apply(lambda: settings)
    assert root_logger.level == logging.DEBUG
    settings["log_level"] = "ERROR"
    now[0] += 10
    level.apply(lambda: settings)
    assert root_logger.level == logging.DEBUG
    now[0] += 30
    level.apply(lambda: settings)
    assert root_logger.level == logging.ERROR
    logs.set_level("nonsense")
    assert root_logger.level == logging.INFO


def test_rest_requests_are_logged_with_status_time_and_user(w, caplog):
    import orchestrator_rest
    caplog.set_level(logging.DEBUG, logger="so")
    build = lambda uri, token: Session(w.gw, token, w.calls)  # noqa: E731
    orchestrator_rest.respond(_request("GET", "/orchestrator/jobs/nope"), build=build,
                              audit_factory=lambda gw: w.audit)
    [rec] = [r for r in caplog.records if r.name == "so.rest" and "event=request" in r.getMessage()]
    msg = rec.getMessage()
    assert 'method="GET"' in msg and 'path="/orchestrator/jobs/nope"' in msg
    assert 'user="alice"' in msg and "status=404" in msg and " ms=" in msg
    assert 'error_code="not_found"' in msg


def test_rest_level_follows_the_setting(w, root_logger):
    import orchestrator_rest
    w.store.save_settings({"log_level": "DEBUG"})
    orchestrator_rest._LEVEL.read_at = None
    orchestrator_rest.respond(_request("GET", "/orchestrator/me"),
                              build=lambda uri, token: Session(w.gw, token, w.calls),
                              audit_factory=lambda gw: w.audit)
    assert root_logger.level == logging.DEBUG


def test_log_level_setting_is_validated(w):
    status, out = w.call("root", "PUT", "/orchestrator/settings", {"log_level": "debug"})
    assert status == 200 and out["settings"]["log_level"] == "DEBUG"
    assert w.call("root", "PUT", "/orchestrator/settings", {"log_level": "LOUD"})[0] == 400
    assert w.call("root", "GET", "/orchestrator/settings")[1]["settings"]["log_level"] == "DEBUG"


# -- the route -----------------------------------------------------------------

def get_logs(w, body=None, user="alice"):
    return w.call(user, "GET", "/orchestrator/logs", body or {})


def test_logs_search_as_the_caller_with_the_filters(w):
    w.gw.search_handler = lambda owner, query: [
        {"_time": "2026-11-19T10:00:00.000+00:00", "level": "INFO", "process": "engine",
         "logger": "so.audit", "event": "step_dispatched", "run_id": "daily:1", "step_id": "a",
         "_raw": "2026-11-19 ... event=step_dispatched"}]
    status, out = get_logs(w, {"run_id": "daily:1", "step_id": "a", "level": "warning",
                               "process": "engine", "text": 'say "hi"', "range": "1h"})
    assert status == 200, out
    owner, query, earliest, latest = w.gw.search_log[-1]
    assert owner == "alice" and earliest == "-1h" and latest == "now"
    assert query.startswith('index=_internal source="*search_orchestrator.*.log" process=engine '
                            'level IN (ERROR, WARNING) run_id="daily:1" step_id="a" "say \\"hi\\""')
    assert "| head 200 |" in query
    assert out["spl"] == "search " + query
    assert out["lines"][0]["event"] == "step_dispatched" and out["lines"][0]["time"].startswith("2026")
    assert out["lines"][0]["raw"].endswith("event=step_dispatched")
    assert out["notes"] == []


def test_logs_debug_shows_every_level_and_limit_is_capped(w):
    get_logs(w, {"level": "DEBUG", "limit": "5000"})
    query = w.gw.search_log[-1][1]
    assert "level IN" not in query and "| head 1000 |" in query


@pytest.mark.parametrize("body", [{"run_id": "x | delete"}, {"job_id": 'a"b'}, {"process": "web"},
                                  {"level": "LOUD"}, {"range": "1y"}, {"limit": "many"},
                                  {"text": "x" * 301}])
def test_logs_refuse_bad_filters(w, body):
    status, out = get_logs(w, body)
    assert status == 400 and w.gw.search_log == []


def test_no_lines_and_no_access_say_so(w):
    status, out = get_logs(w)
    assert status == 200 and out["lines"] == [] and out["notes"] == [logs_api.NOTE_EMPTY]

    def denied(owner, query):
        raise GatewayError("forbidden", status=403)
    w.gw.search_handler = denied
    status, out = get_logs(w)
    assert status == 200 and out["notes"] == [logs_api.NOTE_DENIED]

    def broken(owner, query):
        raise GatewayError("boom", status=500)
    w.gw.search_handler = broken
    status, out = get_logs(w)
    assert status == 502 and "boom" in json.dumps(out)


def test_a_full_page_says_there_are_more(w):
    w.gw.search_handler = lambda owner, query: [{"_raw": "x"}] * 3
    out = get_logs(w, {"limit": "3"})[1]
    assert out["notes"] == [logs_api.NOTE_LIMIT % ("newest", 3)]


# -- parsing, names, summary, breakdown, problems ----------------------------------

RAW = ('2026-11-19 13:46:17,374 +0100 level=INFO process=rest logger=so.rest event=request '
       'method="POST" ms=168 path="/orchestrator/runs/daily%3Amanual%3Aab/approve" status=202 '
       'user="alice" error="say \\"no\\""')


def test_parse_line_reads_fields_messages_and_tracebacks():
    fields, message, trace = logs_api.parse_line(RAW)
    assert fields["event"] == "request" and fields["status"] == "202" and fields["ms"] == "168"
    assert fields["user"] == "alice" and fields["error"] == 'say "no"' and message is None
    raw = ("2026-11-19 13:00:00,001 +0000 level=WARNING process=engine logger=so.engine "
           "status of search s1 failed: boom\nTraceback (most recent call last):\n  x")
    fields, message, trace = logs_api.parse_line(raw)
    assert fields == {"level": "WARNING", "process": "engine", "logger": "so.engine"}
    assert message == "status of search s1 failed: boom" and trace.startswith("Traceback")


def test_lines_carry_fields_and_the_names_of_jobs_the_caller_may_see(w):
    saved(w)
    w.gw.search_handler = lambda owner, query: [
        {"_time": "t", "_raw": "2026-11-19 13:00:00,001 +0000 level=INFO process=engine "
                               'logger=so.audit event=step_dispatched job_id="daily" step_id="a"'},
        {"_time": "t", "_raw": RAW.replace("runs/daily%3Amanual%3Aab/approve", "jobs/daily")}]
    out = get_logs(w)[1]
    assert out["lines"][0]["fields"]["step_id"] == "a" and out["lines"][0]["job_id"] == "daily"
    assert out["names"]["daily"]["name"] and "a" in out["names"]["daily"]["steps"]
    assert get_logs(w, user="dave")[1]["names"] == {}


def test_oldest_first_and_event_filter(w):
    get_logs(w, {"sort": "oldest", "event": "step_state", "run_id": "daily:1"})
    query = w.gw.search_log[-1][1]
    assert 'run_id="daily:1" event=step_state' in query and "| reverse |" in query
    assert get_logs(w, {"event": "Bad Event"})[0] == 400
    assert get_logs(w, {"sort": "sideways"})[0] == 400


def test_summary_buckets_totals_top_events_and_engine(w):
    def handler(owner, query):
        if "timechart" in query:
            return [{"_time": "2026-11-19T13:00:00", "error": "1", "warning": "2", "info": "5",
                     "debug": "0", "req_ok": "3", "req_4xx": "1", "req_5xx": "0", "req_p95": "120",
                     "ticks": "12", "tick_avg": "40", "tick_max": "90", "active_runs": "2"}]
        return [{"event": "request", "level": "INFO", "process": "rest", "sc": "ok", "to": "-", "count": "3"},
                {"event": "request", "level": "WARNING", "process": "rest", "sc": "4xx", "to": "-", "count": "1"},
                {"event": "action_failed", "level": "INFO", "process": "engine", "sc": "-", "to": "-", "count": "2"},
                {"event": "run_state", "level": "INFO", "process": "engine", "sc": "-", "to": "failed", "count": "1"},
                {"event": "-", "level": "ERROR", "process": "engine", "sc": "-", "to": "-", "count": "1"}]
    w.gw.search_handler = handler
    status, out = w.call("alice", "GET", "/orchestrator/logs/summary", {"range": "1h"})
    assert status == 200, out
    assert out["span"] == "1m" and out["buckets"][0]["tick_max"] == 90.0
    t = out["totals"]
    assert (t["requests"], t["req_4xx"], t["actions_failed"], t["runs_failed"], t["error"]) == (4, 1, 2, 1, 1)
    assert [e["event"] for e in out["events"]][:2] == ["request", "action_failed"]
    assert "(no event)" in [e["event"] for e in out["events"]]
    assert set(out["engine"]) == {"running", "last_seen"} and out["log_level"] == "INFO"
    assert "timechart span=1m" in w.gw.search_log[0][1]


def test_breakdown_routes_and_splunkd_calls(w):
    def handler(owner, query):
        if "event=request" in query:
            assert 'route=replace(route, "^(jobs|runs|backfills|snippets|destinations)/[^/]+"' in query
            return [{"method": "POST", "route": "runs/<id>/approve", "count": "4", "p95": "300",
                     "avg": "150", "max": "320", "failed": "1", "all_p95": "210", "all_count": "40"}]
        return [{"method": "GET", "ep": "search/jobs/<sid>", "count": "90", "p95": "45", "avg": "20",
                 "max": "80", "errors": "0"}]
    w.gw.search_handler = handler
    out = w.call("alice", "GET", "/orchestrator/logs/breakdown")[1]
    assert out["routes"][0]["route"] == "runs/<id>/approve" and out["requests_p95"] == 210.0
    assert out["requests"] == 40 and out["calls"][0]["endpoint"] == "search/jobs/<sid>"


def test_problems_are_grouped_in_spl_so_search_shows_the_same_table(w):
    w.gw.search_handler = lambda owner, query: [
        {"times": "54", "level": "Warning", "problem": "Email failed, will retry: Connection refused",
         "area": "Action", "jobs": ["daily", "weekly"], "runs": "8", "last_seen": "1763557200",
         "first_seen": "1763550000", "event": "action_retry", "signature": "action_retry||email|x",
         "sample": '2026-11-19 13:00:00,001 +0000 level=WARNING process=engine logger=so.audit '
                   'event=action_retry action_type="email" job_id="daily" run_id="daily:cron:1" '
                   'error="Connection refused"'},
        {"times": "2", "level": "Error", "problem": "Engine skipped a tick", "area": "Engine",
         "jobs": "", "runs": "0", "last_seen": "1763557100", "first_seen": "1763557000",
         "signature": "|||Engine skipped a tick", "sample": "free text"}]
    status, out = w.call("alice", "GET", "/orchestrator/logs/problems")
    assert status == 200, out
    first, second = out["problems"]
    assert (first["count"], first["level"], first["problem"], first["area"]) == (
        54, "WARNING", "Email failed, will retry: Connection refused", "Action")
    assert first["jobs"] == ["daily", "weekly"] and first["runs"] == 8
    assert first["last"].startswith("2025-11-19T") and first["sample"]["run_id"] == "daily:cron:1"
    assert second["level"] == "ERROR" and second["jobs"] == [] and second["event"] is None
    spl = out["spl"]
    assert "| stats count AS times" in spl and "by signature" in spl
    assert "| sort 0 - sev - times" in spl and "| table times level problem area jobs runs" in spl
    assert "(level IN (ERROR, WARNING) OR event IN" in w.gw.search_log[-1][1]


def test_problem_signatures_take_out_what_differs_each_time():
    def sig(text):
        for pattern, repl in logs_api.PROBLEM_NOISE:
            text = re.sub(pattern, repl, text)
        return text
    a = sig("status of search scheduler__alice_x1 failed: HTTP 503 for run daily:cron:1 at https://h/x")
    b = sig("status of search scheduler__alice_x2 failed: HTTP 503 for run daily:cron:22 at https://h/y")
    assert a == b == "status of search <sid> failed: HTTP <n> for run <run> at <url>"
    for pattern, _ in logs_api.PROBLEM_NOISE:
        assert '"' not in pattern  # each goes into an SPL string as is


# -- failures are warnings (found in a live instance: failed actions were logged at INFO) --

def test_failure_audit_events_are_logged_at_warning(caplog):
    caplog.set_level(logging.INFO, logger="so")
    logs.audit_line({"type": "action_failed", "action_type": "email", "error": "Connection refused"})
    logs.audit_line({"type": "run_state", "from": "running", "to": "failed"})
    logs.audit_line({"type": "run_state", "from": "running", "to": "succeeded"})
    logs.audit_line({"type": "command", "command": "pause", "result": "rejected"})
    levels = [r.levelno for r in caplog.records if r.name == "so.audit"]
    assert levels == [logging.WARNING, logging.WARNING, logging.INFO, logging.WARNING]


def test_audit_copies_stay_out_of_splunkd_log():
    f = logs.NotAudit()
    assert not f.filter(logging.LogRecord("so.audit", logging.WARNING, "", 0, "x", None, None))
    assert f.filter(logging.LogRecord("so.engine", logging.WARNING, "", 0, "x", None, None))


def test_problems_find_failure_events_logged_at_info_by_older_versions(w):
    w.call("alice", "GET", "/orchestrator/logs/problems")
    query = w.gw.search_log[-1][1]
    assert "event IN (action_failed, action_retry," in query and 'to="failed"' in query
    assert "level IN (ERROR, WARNING)" in query
    # A failure event counts as a warning whatever level it was logged at.
    assert 'eval sev=if(level="ERROR" OR level="CRITICAL", 2, 1)' in query


def test_event_filter_takes_a_list_and_summary_counts_skipped_schedules(w):
    get_logs(w, {"event": "schedule_skipped,schedule_missed"})
    assert "event IN (schedule_skipped, schedule_missed)" in w.gw.search_log[-1][1]
    assert get_logs(w, {"event": "a,B"})[0] == 400
    w.gw.search_handler = lambda owner, query: [] if "timechart" in query else [
        {"event": "schedule_skipped", "level": "INFO", "process": "engine", "sc": "-", "to": "-", "count": "2"},
        {"event": "schedule_missed", "level": "WARNING", "process": "engine", "sc": "-", "to": "-", "count": "1"}]
    t = w.call("alice", "GET", "/orchestrator/logs/summary")[1]["totals"]
    assert (t["schedules_skipped"], t["schedules_missed"]) == (2, 1)


def test_engine_graphs_read_the_heartbeat_too_so_they_show_at_info():
    spl = logs_api.summary_query({"range": "24h"})
    assert 'avg(eval(case(event="tick", ms, event="heartbeat", tonumber(avg_ms)))) AS tick_avg' in spl
    assert 'max(eval(case(event="tick", ms, event="heartbeat", tonumber(slowest_ms)))) AS tick_max' in spl
    assert 'tonumber(coalesce(peak_runs, active_runs))' in spl and 'event="heartbeat"' in spl
    # Runs started comes from run_state lines, logged at Info, so every bucket has a value.
    assert 'count(eval(event="run_state" AND to="running")) AS runs_started' in spl


def test_problem_error_keeps_quotes_inside_the_value():
    # Splunk's key=value extraction stops error="..." at the first \" inside it; the problems
    # search takes the whole quoted value with rex. This applies that rex, as SPL reads its
    # string (\" is ", \\ is \), to a real line.
    query = logs_api.problems_query({"range": "24h"})
    literal = re.search(r'\| rex field=_raw "(\\serror=.*?\)\\")"', query).group(1)
    pattern = re.sub(r'\\(["\\])', r"\1", literal).replace("(?<err>", "(?P<err>")
    raw = ('2026-11-20 08:00:00,000 +0000 level=WARNING process=engine logger=so.audit '
           'event=action_retry action_type="email" error="action search failed: '
           'command=\\"sendemail\\", [Errno 111] Connection refused while sending mail to: '
           'you@example.com" job_id="daily"')
    err = re.search(pattern, raw).group("err")
    err = re.sub(r"\\(.)", r"\1", err)  # the eval replace that follows
    assert err == ('action search failed: command="sendemail", [Errno 111] Connection refused '
                   'while sending mail to: you@example.com')
    assert 'eval what=coalesce(err, error,' in query


def test_problems_use_the_same_plain_words_as_the_page():
    query = logs_api.problems_query({"range": "24h"})
    for words in ('"KV Store was still starting up"', '"Splunk could not reach its mail server"',
                  '"Splunk was not answering (it may have been starting or stopping)"',
                  '"the receiver did not answer (connection refused)"',
                  '"Engine skipped a tick".said', '"Requests failed ("'):
        assert words in query, words
