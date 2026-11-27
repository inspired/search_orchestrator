"""Run health page routes (so.run_health_api): the audit searches, run as the viewer."""
import json

import pytest

from so import run_health_api as rh
from so.gateway import GatewayError
from test_api import saved, w  # noqa: F401  (w is a fixture)

T = 1767225600  # 2026-01-01 00:00 UTC


def get(w, section, body=None, user="alice"):
    return w.call(user, "GET", "/orchestrator/runhealth/" + section, body or {})


def runs_rows():
    return [
        {"first_seen": str(T), "run_id": "daily:1", "job_id": "daily", "state": "succeeded", "duration": "60", "reason": "", "last_seen": str(T + 60)},
        {"first_seen": str(T + 3600), "run_id": "daily:2", "job_id": "daily", "state": "failed", "duration": "30", "reason": "a: boom", "last_seen": str(T + 3700)},
        {"first_seen": str(T + 7200), "run_id": "daily:3", "job_id": "daily", "state": "held", "duration": "90", "reason": "a: again", "last_seen": str(T + 7300)},
        {"first_seen": str(T + 7300), "run_id": "daily:4", "job_id": "daily", "state": "in progress", "duration": "", "reason": "", "last_seen": str(T + 7400)},
        {"first_seen": str(T + 7400), "run_id": "daily:5", "job_id": "daily", "state": "cancelled", "duration": "", "reason": "", "last_seen": str(T + 7500)},
    ]


def test_runs_searches_the_audit_index_as_the_viewer_and_sums_it_up(w):
    w.gw.search_handler = lambda owner, query: runs_rows()
    status, out = get(w, "runs", {"range": "7d"})
    assert status == 200, out
    owner, query, earliest, latest = w.gw.search_log[-1]
    assert owner == "alice" and earliest == "-7d" and latest == "now"
    assert query.startswith("`orchestrator_index` job_id=* type IN (")
    assert out["kpi"] == {"runs": 5, "succeeded": 1, "failed": 1, "held_blocked": 1,
                          "success_rate": 33.3, "median_duration": 60}
    assert [r["run_id"] for r in out["attention"]] == ["daily:3", "daily:2"]
    assert out["attention"][0]["reason"] == "a: again"
    assert out["over_time"]["span"] == 6 * 3600
    total = sum(sum(b["counts"].values()) for b in out["over_time"]["buckets"])
    assert total == 5
    assert out["spl"] == "search " + query and out["earliest"] == "-7d"


def test_one_job_is_quoted_into_every_search(w):
    get(w, "runs", {"job_id": "daily"})
    assert w.gw.search_log[-1][1].startswith('`orchestrator_index` job_id="daily" type IN (')
    get(w, "steps", {"job_id": "daily"})
    assert all('job_id="daily"' in q for _, q, _, _ in w.gw.search_log[-2:])


@pytest.mark.parametrize("body", [{"job_id": 'a" OR 1=1'}, {"range": "1y"}])
def test_bad_filters_are_refused_before_any_search(w, body):
    status, out = get(w, "runs", body)
    assert status == 400 and w.gw.search_log == []


def test_unknown_section_is_404(w):
    assert get(w, "everything")[0] == 404


def test_needs_an_app_capability(w):
    assert get(w, "runs", user="dave")[0] == 403
    assert w.gw.search_log == []


def test_no_events_say_who_may_read_the_audit_index(w):
    status, out = get(w, "runs")
    assert status == 200 and out["kpi"]["runs"] == 0 and out["notes"] == [rh.NOTE_EMPTY]
    assert "_audit" in rh.NOTE_EMPTY


def test_refused_and_broken_searches(w):
    def denied(owner, query):
        raise GatewayError("forbidden", status=403)
    w.gw.search_handler = denied
    status, out = get(w, "steps")
    assert status == 200 and out["notes"] == [rh.NOTE_DENIED]

    def broken(owner, query):
        raise GatewayError("boom", status=500)
    w.gw.search_handler = broken
    status, out = get(w, "steps")
    assert status == 502 and "boom" in json.dumps(out)


def test_each_section_returns_its_tables(w):
    w.gw.search_handler = lambda owner, query: [{"job": "daily", "step": "a", "x": "1"}]
    for section, keys in (("steps", ("failing", "slowest")), ("actions", ("by_type", "failures")),
                          ("late", ("late",)), ("engine", ("last", "errors", "tracebacks")),
                          ("performance", ("runtime", "scanned", "slowest", "peaks"))):
        status, out = get(w, section)
        assert status == 200, (section, out)
        for key in keys:
            assert key in out, (section, key)
        assert out["searches"] and all(s["spl"].startswith(("search ", "|")) for s in out["searches"])


def test_late_counts_its_rows(w):
    w.gw.search_handler = lambda owner, query: [{"job_id": "daily", "run_id": "daily:1"}] * 2
    assert get(w, "late")[1]["count"] == 2


def test_names_of_jobs_the_viewer_may_see(w):
    saved(w)
    w.gw.search_handler = lambda owner, query: runs_rows()
    assert get(w, "runs")[1]["names"]["daily"]["name"]
    w.gw.users["carol"]["roles"] = ["nobody"]
    assert get(w, "runs", user="carol")[1]["names"] == {}
