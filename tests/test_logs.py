"""Troubleshooting logs: the log files (so.logs) and the logs route (so.logs_api)."""
import json
import logging

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
    assert out["notes"] == [logs_api.NOTE_LIMIT % 3]
