"""Why a job did not start is always logged: a disabled job's passing slot, slots missed
while the engine was not checking, a run waiting in the queue, a step waiting for a search
slot, and a downstream job that a finished run does not start."""
import logging

from test_engine import DAY, T0, World, make_job


def lines(caplog, name):
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith("event=%s" % name)]


def test_a_disabled_jobs_slot_is_reported_once():
    w = World()
    w.add_job(make_job(enabled=False))
    w.tick(at=T0 - 5)
    w.tick(at=T0 + 10)
    w.tick(at=T0 + 20)
    assert w.audit.of("schedule_skipped", reason="disabled", job_id="j", scheduled_time=T0)
    assert len(w.audit.of("schedule_skipped")) == 1
    assert not w.gw.kv.get("so_runs")


def test_slots_missed_while_the_engine_was_down_are_counted_with_the_policy():
    w = World()
    w.add_job(make_job(catchup="latest"))
    w.tick(at=T0 - 5)
    w.tick(at=T0 + 30 * DAY + 3600)
    [ev] = w.audit.of("schedule_missed")
    assert ev["missed"] == 30 and ev["caught_up"] == 1 and ev["policy"] == "latest"
    assert ev["seconds"] == 30 * DAY + 3605 and ev["at_least"] is False


def test_catchup_all_still_reports_what_is_past_its_cap():
    w = World()
    w.add_job(make_job(), scripts={"a": {"states": ["running"]}})
    w.tick(at=T0 - 5)
    w.tick(at=T0 + 30 * DAY)
    [ev] = w.audit.of("schedule_missed")
    assert ev["missed"] == 31 - 7 and ev["caught_up"] == 7


def test_no_report_when_the_engine_kept_checking():
    w = World()
    w.add_job(make_job(), scripts={"a": {"states": ["running"]}})
    for t in range(T0 - 5, T0 + 60, 5):
        w.tick(at=t)
    assert not w.audit.of("schedule_missed")


def test_a_queued_run_says_what_it_waits_for_once(caplog):
    caplog.set_level(logging.INFO, logger="so")
    w = World(T0)
    j = w.add_job(make_job(cron=None), scripts={"a": {"states": ["running"]}})
    first = w.manual(j)
    w.tick()
    second = w.manual(j, scheduled_time=T0 + 1)
    third = w.manual(j, scheduled_time=T0 + 2)
    for _ in range(3):
        w.tick(advance=5)
    waits = lines(caplog, "run_waiting")
    assert len(waits) == 2  # once per run, not every tick
    assert all('reason="waiting_for_run"' in m and 'by_run="%s"' % first in m for m in waits)
    assert {second, third} == {m.split('run_id="')[1].split('"')[0] for m in waits}


def test_a_step_waiting_for_a_search_slot_says_so(caplog):
    caplog.set_level(logging.INFO, logger="so")
    w = World(T0)
    w.store.save_settings({"max_searches_per_job": 1})
    j = w.add_job(make_job(steps=["a", "b"], cron=None), scripts={"a": {"states": ["running"]}, "b": {"states": ["running"]}})
    w.manual(j)
    w.tick()
    w.tick(advance=5)
    [m] = lines(caplog, "step_waiting")
    assert 'reason="search_slots"' in m and 'step_id="b"' in m and "max_searches_per_job=1" in m


def test_a_downstream_job_not_started_says_why(caplog):
    caplog.set_level(logging.INFO, logger="so")
    w = World(T0)
    up = w.add_job(make_job("up", cron=None), scripts={"a": {"states": ["done"]}})
    w.gw.jobs  # noqa: B018
    w.add_job(make_job("down", cron=None, triggers=[{"type": "completion", "job": "up", "on": "failure"}]))
    w.add_job(make_job("off", cron=None, enabled=False, triggers=[{"type": "completion", "job": "up", "on": "success"}]))
    run = w.manual(up)
    for _ in range(4):
        w.tick(advance=5)
    assert w.run(run)["state"] == "succeeded"
    msgs = lines(caplog, "completion_not_fired")
    assert any('target_job="down"' in m and 'reason="outcome"' in m and 'on="failure"' in m for m in msgs)
    assert any('target_job="off"' in m and 'reason="disabled"' in m for m in msgs)


# -- found on a live instance: a restart floods logs and splunkd.log --------------------

def test_kvstore_starting_is_said_once_and_the_recovery_counted(caplog):
    from so.gateway import KvError
    caplog.set_level(logging.DEBUG, logger="so")
    w = World(T0)
    real = w.engine.lease.acquire

    def initializing(*a, **k):
        raise KvError('KV Store error: HTTP 503 -- "KV Store is initializing. Please try again later."', status=503)
    w.engine.lease.acquire = initializing
    for _ in range(4):
        w.tick(advance=5)
    w.engine.lease.acquire = real
    w.tick(advance=5)
    msgs = [r.getMessage() for r in caplog.records if r.levelno >= logging.INFO]
    assert len([m for m in msgs if "waiting_for_kvstore" in m]) == 1
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING and "tick skipped" in r.getMessage()]
    [resumed] = [m for m in msgs if m.startswith("event=ticks_resumed")]
    assert "skipped=4" in resumed and "seconds=20" in resumed  # first skip to the tick that worked


def test_other_skips_warn_once_per_reason(caplog):
    from so.gateway import KvError
    caplog.set_level(logging.WARNING, logger="so")
    w = World(T0)

    def down(*a, **k):
        raise KvError("KV Store error: connection refused", status=None)
    w.engine.lease.acquire = down
    for _ in range(3):
        w.tick(advance=5)
    assert len([r for r in caplog.records if "tick skipped" in r.getMessage()]) == 1


def test_the_event_stream_closes_quietly_when_splunkd_already_closed_the_pipe():
    import orchestrator_engine

    class Closed:
        calls = 0

        def close(self):
            Closed.calls += 1
            raise BrokenPipeError(32, "Broken pipe")
    ew = Closed()
    orchestrator_engine.close_quietly(ew)
    ew.close()  # splunklib's own close afterwards does nothing
    assert Closed.calls == 1
