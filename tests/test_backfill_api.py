"""Backfill planning and routes (features-2 spec section 6)."""
import calendar

import pytest

from so import backfill, scheduler
from so.store import COMMANDS
from test_api import error, job_body, saved, w  # noqa: F401  (w is a fixture)

DAY = 86400
START = calendar.timegm((2026, 11, 1, 0, 0, 0))
END = START + 30 * DAY
CRON = [{"type": "cron", "cron": "0 1 * * *"}]
DAILY = [START + 3600 + i * DAY for i in range(30)]


def cron_job(w, user="alice", **over):
    return saved(w, user, job_body(triggers=CRON, **over))


def post(w, body, user="alice", job_id="daily"):
    return w.call(user, "POST", "/orchestrator/jobs/%s/backfills" % job_id, body)


def created(w, user="alice", **over):
    status, out = post(w, dict({"from": START, "to": END}, **over), user)
    assert status == 201, out
    return out["backfill"]


def test_plan_schedule_daily():
    job = job_body(triggers=CRON)
    assert backfill.plan_slots(job, START, END, "schedule", None) == DAILY


def test_plan_schedule_unions_enabled_triggers():
    job = job_body(triggers=CRON + [{"type": "cron", "cron": "0 2 * * *"},
                                    {"type": "cron", "cron": "0 3 * * *", "enabled": False}])
    assert backfill.plan_slots(job, START, START + DAY, "schedule", None) == \
        [START + 3600, START + 7200]


def test_plan_step_hourly():
    job = job_body()
    assert backfill.plan_slots(job, START, START + DAY, "step", 3600) == \
        [START + i * 3600 for i in range(24)]


ERRORS = [
    ({"from": END, "to": START}, 400, "bad_range", "From must be before To"),
    ({"from": START, "to": START}, 400, "bad_range", "From must be before To"),
    ({"from": START, "to": START + 401 * DAY, "source": "step", "step": DAY}, 400, "bad_range",
     "Pick a range of at most 400 days"),
    ({"from": START, "to": START + 10 * DAY, "source": "step", "step": 3600}, 400,
     "too_many_slots",
     "This covers 240 runs; the most is 100. Shorten the range or use a longer step."),
    ({"from": START + 7200, "to": START + 3 * 3600}, 400, "no_slots",
     "No runs fall in this range; widen it or change the step"),
    ({"from": START, "to": END, "concurrency": 0}, 400, "bad_request", None),
    ({"from": START, "to": END, "concurrency": 6}, 400, "bad_request", None),
    ({"from": START, "to": END, "concurrency": "x"}, 400, "bad_request", None),
    ({"from": START, "to": END, "source": "step", "step": 59}, 400, "bad_request", None),
    ({"from": START, "to": END, "source": "step", "step": 2678401}, 400, "bad_request", None),
    ({"from": START, "to": END, "source": "step"}, 400, "bad_request", None),
    ({"from": START, "to": END, "source": "weekly"}, 400, "bad_request", None),
    ({"to": END}, 400, "bad_request", None),
]


@pytest.mark.parametrize("body,status,code,message", ERRORS)
def test_errors(w, body, status, code, message):
    cron_job(w)
    got, out = post(w, body)
    assert (got, error(out)) == (status, code), out
    if message is not None:
        assert out["error"]["message"] == message
    assert w.gw.kv.get(backfill.BACKFILLS, {}) == {}


def test_no_schedule(w):
    saved(w)
    status, out = post(w, {"from": START, "to": END})
    assert (status, error(out)) == (400, "no_schedule")
    assert out["error"]["message"] == "The job has no schedule; add one or use Every …"
    status, out = post(w, {"from": START, "to": END, "source": "step", "step": DAY})
    assert status == 201, out


def test_disabled_trigger_is_no_schedule(w):
    saved(w, body=job_body(triggers=[dict(CRON[0], enabled=False)]))
    assert error(post(w, {"from": START, "to": END})[1]) == "no_schedule"


def test_job_disabled(w):
    cron_job(w, enabled=False)
    status, out = post(w, {"from": START, "to": END})
    assert (status, error(out)) == (409, "job_disabled")


def test_dry_run_stores_nothing(w):
    cron_job(w)
    status, out = post(w, {"from": START, "to": END, "dry_run": True})
    assert status == 200, out
    assert out == {"slots": DAILY, "count": 30}
    assert w.gw.kv.get(backfill.BACKFILLS, {}) == {}
    assert not w.audit.of("backfill_created")


def test_create(w):
    cron_job(w)
    status, out = post(w, {"from": START, "to": END, "params": {"p": "5"}})
    assert status == 201, out
    doc = out["backfill"]
    assert backfill.ID_RE.fullmatch(doc["id"])
    assert (doc["state"], doc["next"], doc["concurrency"]) == ("running", 0, 1)
    assert (doc["job_id"], doc["created_by"], doc["created_at"]) == ("daily", "alice", w.now)
    assert (doc["from"], doc["to"], doc["source"], doc["step"]) == (START, END, "schedule", None)
    assert doc["slots"] == DAILY and doc["count"] == 30
    assert doc["params"] == {"p": "5"} and doc["run_ids"] == []
    assert doc["ended_at"] is None and doc["cancelled_by"] is None
    stored = w.gw.kv[backfill.BACKFILLS][doc["id"]]
    assert stored["slots"] == DAILY and stored["state"] == "running"
    event = w.audit.of("backfill_created")[0]
    assert {k: event[k] for k in ("backfill_id", "job_id", "slots", "from", "to", "source")} == \
        {"backfill_id": doc["id"], "job_id": "daily", "slots": 30, "from": START, "to": END,
         "source": "schedule"}


def test_create_step_and_concurrency(w):
    saved(w)
    doc = created(w, source="step", step=DAY, concurrency=5)
    assert (doc["source"], doc["step"], doc["concurrency"]) == ("step", DAY, 5)
    assert doc["slots"] == [START + i * DAY for i in range(30)]


def test_step_given_means_step_source(w):
    saved(w)
    doc = created(w, step=DAY)
    assert doc["source"] == "step" and doc["count"] == 30


def test_epoch_strings_accepted(w):
    cron_job(w)
    doc = created(w, **{"from": str(START), "to": str(END)})
    assert (doc["from"], doc["to"]) == (START, END)
    assert ("user:alice", "parse_times") not in w.calls


def test_relative_times_resolved_as_caller(w):
    cron_job(w)
    w.gw.times[("-30d@d", w.now)] = START
    w.gw.times[("@d", w.now)] = END
    doc = created(w, **{"from": "-30d@d", "to": "@d"})
    assert (doc["from"], doc["to"], doc["count"]) == (START, END, 30)
    assert ("user:alice", "parse_times") in w.calls
    assert ("system", "parse_times") not in w.calls


def test_unreadable_time(w):
    cron_job(w)
    status, out = post(w, {"from": "yesterday-ish", "to": END})
    assert (status, error(out)) == (400, "bad_time")
    assert out["error"]["field"] == "from"


def test_bad_param(w):
    cron_job(w)
    status, out = post(w, {"from": START, "to": END, "params": {"p": "abc"}})
    assert (status, error(out)) == (400, "bad_param")
    assert w.gw.kv.get(backfill.BACKFILLS, {}) == {}
    status, out = post(w, {"from": START, "to": END, "params": ["p"]})
    assert (status, error(out)) == (400, "bad_request")


def test_run_role_may_create(w):
    cron_job(w)
    doc = created(w, "carol")
    assert doc["created_by"] == "carol"


def test_dave_sees_nothing(w):
    cron_job(w)
    doc = created(w)
    status, out = post(w, {"from": START, "to": END}, "dave")
    assert (status, error(out)) == (404, "not_found")
    status, out = w.call("dave", "GET", "/orchestrator/backfills")
    assert status == 200 and out == {"backfills": []}
    status, out = w.call("dave", "GET", "/orchestrator/backfills/" + doc["id"])
    assert (status, error(out)) == (404, "not_found")
    status, out = w.call("dave", "POST", "/orchestrator/backfills/%s/cancel" % doc["id"])
    assert (status, error(out)) == (404, "not_found")


def test_malformed_backfill_id_is_404(w):
    for path in ("backfills/bf123", "backfills/BF0123456789AB", "backfills/x/cancel"):
        status, out = w.call("root", "GET" if "cancel" not in path else "POST",
                             "/orchestrator/" + path)
        assert (status, error(out)) == (404, "not_found"), path


def test_cancel_rules(w):
    cron_job(w)
    doc = created(w)
    status, out = w.call("carol", "POST", "/orchestrator/backfills/%s/cancel" % doc["id"])
    assert (status, error(out)) == (403, "forbidden")
    assert w.audit.of("permission_denied")
    status, out = w.call("alice", "POST", "/orchestrator/backfills/%s/cancel" % doc["id"])
    assert status == 202, out
    command = w.gw.kv[COMMANDS][out["command_id"]]
    assert (command["type"], command["backfill_id"], command["user"]) == \
        ("cancel_backfill", doc["id"], "alice")
    stored = w.gw.kv[backfill.BACKFILLS][doc["id"]]
    w.gw.kv[backfill.BACKFILLS][doc["id"]] = dict(stored, state="done")
    status, out = w.call("alice", "POST", "/orchestrator/backfills/%s/cancel" % doc["id"])
    assert (status, error(out)) == (409, "invalid_state")
    assert out["error"]["message"] == "This backfill has already ended"


def test_cancel_by_creator_editor_and_admin(w):
    cron_job(w)
    mine = created(w, "carol")
    status, _ = w.call("carol", "POST", "/orchestrator/backfills/%s/cancel" % mine["id"])
    assert status == 202
    status, _ = w.call("alice", "POST", "/orchestrator/backfills/%s/cancel" % mine["id"])
    assert status == 202  # alice owns (may edit) the job
    status, _ = w.call("root", "POST", "/orchestrator/backfills/%s/cancel" % mine["id"])
    assert status == 202


def test_list_filters_and_counts(w):
    cron_job(w)
    saved(w, body=job_body("other", triggers=CRON))
    first = created(w)
    w.now += 10
    second = created(w)
    status, out = post(w, {"from": START, "to": END}, job_id="other")
    assert status == 201, out
    other = out["backfill"]
    status, out = w.call("alice", "GET", "/orchestrator/backfills", {"job_id": "daily"})
    assert status == 200, out
    assert [b["id"] for b in out["backfills"]] == [second["id"], first["id"]]  # newest first
    assert all(b["count"] == 30 and "slots" not in b for b in out["backfills"])
    status, out = w.call("alice", "GET", "/orchestrator/backfills")
    assert {b["id"] for b in out["backfills"]} == {first["id"], second["id"], other["id"]}
    stored = w.gw.kv[backfill.BACKFILLS][first["id"]]
    w.gw.kv[backfill.BACKFILLS][first["id"]] = dict(stored, state="cancelled")
    status, out = w.call("alice", "GET", "/orchestrator/backfills", {"state": "running"})
    assert {b["id"] for b in out["backfills"]} == {second["id"], other["id"]}


def test_list_hides_jobs_the_caller_cannot_see(w):
    cron_job(w)
    created(w)
    saved(w, "bob", job_body("bobs", triggers=CRON, run_roles=[]))
    status, out = post(w, {"from": START, "to": END}, "bob", job_id="bobs")
    assert status == 201, out
    status, out = w.call("alice", "GET", "/orchestrator/backfills")
    assert [b["job_id"] for b in out["backfills"]] == ["daily"]
    status, out = w.call("bob", "GET", "/orchestrator/backfills", {"job_id": "daily"})
    assert out == {"backfills": []}
    status, out = w.call("root", "GET", "/orchestrator/backfills")
    assert len(out["backfills"]) == 2


def test_get_backfill_and_its_runs(w):
    cron_job(w)
    doc = created(w)
    job = w.store.get_job("daily")
    run_id = scheduler.create_run(w.store, job, "backfill", DAILY[0], {}, now=w.now,
                                  backfill=doc["id"])
    assert run_id == "daily:backfill-%s:%d" % (doc["id"], DAILY[0])
    scheduler.create_run(w.store, job, "manual", DAILY[0], {}, now=w.now)  # not this backfill
    status, out = w.call("carol", "GET", "/orchestrator/backfills/" + doc["id"])
    assert status == 200, out
    assert out["backfill"]["slots"] == DAILY and out["backfill"]["count"] == 30
    assert "_key" not in out["backfill"]
    assert out["runs"] == [{"id": run_id, "state": "queued", "scheduled_time": DAILY[0]}]
    status, out = w.call("carol", "GET", "/orchestrator/runs/" + run_id)
    assert status == 200, out
    assert out["run"]["backfill"] == doc["id"] and out["run"]["trigger"] == "backfill"
    assert out["run"]["deadline_at"] is None
