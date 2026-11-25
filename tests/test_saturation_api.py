"""All of Splunk's searches over time (so.saturation_api), for the Runs timeline: what ran,
from _audit, what Splunk's scheduler will run, and Splunk's own limits, searched as the viewer."""
from so import saturation_api as sat
from so.gateway import GatewayError
from test_api import w  # noqa: F401  (w is a fixture)

H = 3600
START = 1767225600  # 2026-01-01 00:00 UTC


def get(w, body, user="alice"):
    return w.call(user, "GET", "/orchestrator/schedule/splunk", body)


def handler(past=(), saved=(), limits=None):
    def run(owner, query):
        if "search-concurrency" in query:
            return [limits] if limits else []
        if "saved/searches" in query:
            return list(saved)
        if "info=completed" in query:
            return list(past)
        return []
    return run


def searches_of(w, term):
    return [c for c in w.gw.search_log if term in c[1]]


def test_past_searches_become_the_most_at_once_per_bucket_by_kind(w):
    w.now = START + 2 * H  # the whole window is past
    past = [
        {"start": str(START + 10), "end": str(START + 200), "kind": "scheduled"},
        {"start": str(START + 20), "end": str(START + 100), "kind": "scheduled"},
        {"start": str(START + 50), "end": str(START + 60), "kind": "app"},
        {"start": str(START + 400), "end": str(START + 500), "kind": "other"},
    ]
    w.gw.search_handler = handler(past=past, limits={"max_hist_searches": "18", "max_hist_scheduled_searches": "9"})
    status, out = get(w, {"from": START, "to": START + 2 * H})
    assert status == 200, out
    assert out["bucket"] == 300
    assert out["past"][0] == [START, 1, 2, 0]  # at 50-60 s: one app search and two scheduled
    assert out["past"][1] == [START + 300, 0, 0, 1]
    assert len(out["past"]) == 2  # empty buckets are left out
    assert out["future"] == [] and searches_of(w, "saved/searches") == []
    assert out["limit"] == {"searches": 18, "scheduled": 9}
    owner, query, earliest, latest = searches_of(w, "info=completed")[0]
    assert owner == "alice" and query.startswith("search index=_audit action=search info=completed")
    assert earliest == str(START) and latest == str(START + 2 * H)


def test_scheduled_saved_searches_are_projected_from_their_cron_and_runtime(w):
    w.now = START - 1  # the whole window is still to come
    saved = [
        {"title": "Every 15", "eai:acl.app": "search", "cron_schedule": "*/15 * * * *", "runtime": "400"},
        {"title": "Broken", "eai:acl.app": "search", "cron_schedule": "@daily", "runtime": "10"},
        {"title": "No runtime yet", "eai:acl.app": "search", "cron_schedule": "0 * * * *"},
    ]
    w.gw.search_handler = handler(saved=saved)
    status, out = get(w, {"from": START, "to": START + H})
    assert status == 200, out
    future = dict((t, n) for t, n in out["future"])
    # 00:00: the */15 search and the hourly one at once; 00:05: the */15 one (400 s) still runs.
    assert future[START] == 2 and future[START + 300] == 1
    assert START + 600 not in future  # nothing runs from 00:06:40 to 00:15
    assert future[START + 900] == 1
    assert out["skipped_crons"] == 1 and out["projected_searches"] == 2
    assert searches_of(w, "info=completed") == []  # nothing is past yet


def test_bucket_is_half_an_hour_over_a_week(w):
    w.now = START + 8 * 86400
    assert get(w, {"from": START, "to": START + 7 * 86400})[1]["bucket"] == 1800


def test_needs_an_app_capability_and_a_window(w):
    assert get(w, {"from": START, "to": START + H}, user="dave")[0] == 403
    assert get(w, {"from": START + H, "to": START})[0] == 400


def test_no_access_says_so(w):
    def denied(owner, query):
        raise GatewayError("forbidden", status=403)
    w.gw.search_handler = denied
    w.now = START + 30 * 60
    status, out = get(w, {"from": START, "to": START + H})
    assert status == 200 and out["past"] == [] and out["future"] == [] and out["limit"] is None
    assert out["notes"] == [sat.NOTE_DENIED]


def test_nothing_found_says_who_may_read_it(w):
    w.now = START + 2 * H
    status, out = get(w, {"from": START, "to": START + H})
    assert status == 200 and out["notes"] == [sat.NOTE_EMPTY]
