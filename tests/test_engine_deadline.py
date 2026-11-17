"""The engine marks runs late at their deadline and fires ``on_late`` (spec section 5)."""
from so.gateway import KvError

from test_engine import DAY, T0, World, cron_run, make_job

WITHIN = {"within": 600}


def _late_job(deadline=WITHIN, **over):
    return make_job(deadline=deadline, **over)


def _late_rows(w, run_id):
    return w.action_rows(run_id=run_id, kind="action", hook="on_late", scope="job")


def test_running_run_goes_late_once():
    w = World()
    j = w.add_job(_late_job(), scripts={"a": {"states": ["running"]}})
    run_id = cron_run(w, j)
    assert w.run(run_id)["deadline_at"] == T0 + 600
    w.tick(at=T0 + 599)
    assert not w.audit.of("run_late")
    w.tick(at=T0 + 600)
    late = w.audit.of("run_late", run_id=run_id)
    assert len(late) == 1
    assert late[0]["job_id"] == "j" and late[0]["deadline_at"] == T0 + 600
    assert late[0]["state"] == "running"
    rows = _late_rows(w, run_id)
    assert [r["_key"] for r in rows] == ["%s:job:on_late:-:0" % run_id]
    assert w.run(run_id)["late_at"] == T0 + 600
    w.tick(advance=60)
    assert len(w.audit.of("run_late", run_id=run_id)) == 1
    assert len(_late_rows(w, run_id)) == 1
    assert w.run(run_id)["late_at"] == T0 + 600


def test_action_submitted_is_audited_when_the_job_has_an_on_late_action():
    w = World()
    j = w.add_job(_late_job(actions=[{"hook": "on_late", "type": "webhook",
                                      "url": "https://example.invalid/hook"}]),
                  scripts={"a": {"states": ["running"]}})
    run_id = cron_run(w, j)
    w.tick(at=T0 + 600)
    assert len(w.audit.of("action_submitted", run_id=run_id, hook="on_late")) == 1


def test_queued_run_goes_late():
    w = World()
    j = w.add_job(_late_job(deadline={"within": 3600}, defaults={"give_up_after": 600}),
                  scripts={"a": {"states": ["running"]}})
    first = cron_run(w, j)
    w.tick(at=T0 + 600)
    assert w.run(first)["state"] == "failed" and w.run(first)["held"]
    w.tick(at=T0 + DAY)
    second = "j:%d" % (T0 + DAY)
    assert w.run(second)["state"] == "queued"
    w.tick(at=T0 + DAY + 3600)
    late = w.audit.of("run_late", run_id=second)
    assert len(late) == 1 and late[0]["state"] == "queued"
    assert not w.audit.of("run_late", run_id=first)  # it ended before its deadline


def test_finished_run_is_never_late():
    w = World()
    j = w.add_job(_late_job(), scripts={"a": {"states": ["running"]}})
    run_id = cron_run(w, j)
    w.finish(w.step(run_id, "a")["sid"])
    w.tick(at=T0 + 300)
    assert w.run(run_id)["state"] == "succeeded"
    w.tick(at=T0 + 700)
    assert not w.audit.of("run_late")
    assert not _late_rows(w, run_id)
    assert w.run(run_id)["late_at"] is None


def test_paused_run_still_goes_late():
    w = World()
    j = w.add_job(_late_job(), scripts={"a": {"states": ["running"]}})
    run_id = cron_run(w, j)
    w.command(type="pause", run_id=run_id)
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "paused"
    w.tick(at=T0 + 600)
    late = w.audit.of("run_late", run_id=run_id)
    assert len(late) == 1 and late[0]["state"] == "paused"


def test_late_survives_crash_before_save():
    w = World()
    j = w.add_job(_late_job(), scripts={"a": {"states": ["running"]}})
    run_id = cron_run(w, j)
    real = w.store.save_run
    state = {"fail": True}

    def flaky_save(run):
        if run.get("late_at") is not None and state["fail"]:
            state["fail"] = False
            raise KvError("KV Store unavailable", status=503, transient=True)
        return real(run)

    w.store.save_run = flaky_save
    w.tick(at=T0 + 600)  # on_late submitted, then the run save fails
    assert not state["fail"]
    assert len(_late_rows(w, run_id)) == 1
    assert w.run(run_id)["late_at"] is None
    w.tick(advance=5)
    assert len(_late_rows(w, run_id)) == 1
    assert w.run(run_id)["late_at"] == T0 + 605
    assert len(w.audit.of("run_late", run_id=run_id)) == 1


def test_manual_run_has_no_deadline():
    w = World(T0)
    j = w.add_job(_late_job(cron=None), scripts={"a": {"states": ["running"]}})
    run_id = w.manual(j)
    w.tick()
    assert w.run(run_id)["deadline_at"] is None
    w.tick(at=T0 + 3600)
    assert not w.audit.of("run_late")
    assert not _late_rows(w, run_id)


def test_rerun_does_not_fire_again():
    w = World()
    j = w.add_job(_late_job(defaults={"give_up_after": 900}),
                  scripts={"a": {"states": ["running"]}})
    run_id = cron_run(w, j)
    w.tick(at=T0 + 600)
    w.tick(at=T0 + 900)
    assert w.run(run_id)["state"] == "failed"
    w.command(type="rerun", run_id=run_id, step_id="a", definition="original")
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "running" and w.run(run_id)["rerun_count"] == 1
    w.tick(advance=60)
    assert len(w.audit.of("run_late", run_id=run_id)) == 1
    assert len(_late_rows(w, run_id)) == 1


def test_rerun_after_the_deadline_of_a_run_that_ended_in_time_is_not_late():
    w = World()
    j = w.add_job(_late_job(defaults={"give_up_after": 300}),
                  scripts={"a": {"states": ["running"]}})
    run_id = cron_run(w, j)
    w.tick(at=T0 + 300)
    assert w.run(run_id)["state"] == "failed"
    w.tick(at=T0 + 700)
    w.command(type="rerun", run_id=run_id, step_id="a", definition="original")
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "running"
    w.tick(advance=60)
    assert not w.audit.of("run_late", run_id=run_id)
    assert not _late_rows(w, run_id)
    assert w.run(run_id)["late_at"] is None


def test_rerun_started_before_the_deadline_still_goes_late_once():
    w = World()
    j = w.add_job(_late_job(defaults={"give_up_after": 300}),
                  scripts={"a": {"states": ["running"]}})
    run_id = cron_run(w, j)
    w.tick(at=T0 + 300)
    assert w.run(run_id)["state"] == "failed"
    w.tick(at=T0 + 395)
    w.command(type="rerun", run_id=run_id, step_id="a", definition="original")
    w.tick(advance=5)
    assert w.run(run_id)["state"] == "running"
    w.tick(at=T0 + 600)
    late = w.audit.of("run_late", run_id=run_id)
    assert len(late) == 1 and late[0]["state"] == "running"
    assert len(_late_rows(w, run_id)) == 1
    w.tick(advance=60)
    assert len(w.audit.of("run_late", run_id=run_id)) == 1


# --- chained runs (final review C1) --------------------------------------------

def _chain(w, up_cron, start_job=False):
    """``up`` (no deadline) chains to ``down`` (deadline WITHIN), by completion or start_job."""
    actions = [{"hook": "on_success", "type": "start_job", "job": "down"}] if start_job else []
    up = w.add_job(make_job("up", cron=up_cron, actions=actions))
    triggers = [] if start_job else [{"type": "completion", "job": "up", "on": "success"}]
    down = w.add_job(_late_job(job_id="down", cron=None, triggers=triggers),
                     scripts={"a": {"states": ["running"]}})
    return up, down


def _down_runs(w):
    return [r for r in w.gw.kv.get("so_runs", {}).values() if r["job_id"] == "down"]


def _settle(w, ticks=6):
    for _ in range(ticks):
        w.tick(advance=5)


def test_chained_run_of_a_backfill_has_no_deadline():
    from test_engine_backfill import add_backfill
    for start_job in (False, True):
        w = World(T0)
        _chain(w, None, start_job=start_job)
        add_backfill(w, [T0 - 30 * DAY], job_id="up")
        _settle(w)
        downs = _down_runs(w)
        assert len(downs) == 1 and downs[0]["deadline_at"] is None
        assert downs[0]["deadline_eligible"] is False
        w.tick(at=T0 + 3600)
        assert not w.audit.of("run_late")
        assert not _late_rows(w, downs[0]["_key"])


def test_chained_run_of_a_catchup_or_manual_run_has_no_deadline():
    w = World(T0)
    up, _ = _chain(w, None)
    w.manual(up, scheduled_time=T0 - 3 * DAY)
    _settle(w)
    downs = _down_runs(w)
    assert len(downs) == 1 and downs[0]["deadline_at"] is None
    w.tick(at=T0 + 3600)
    assert not w.audit.of("run_late")


def test_chained_run_of_an_on_time_cron_run_keeps_its_deadline():
    for start_job in (False, True):
        w = World()
        up, _ = _chain(w, "0 1 * * *", start_job=start_job)
        run_id = cron_run(w, up)
        assert w.run(run_id)["deadline_eligible"] is True
        _settle(w)
        downs = _down_runs(w)
        assert len(downs) == 1 and downs[0]["deadline_at"] == T0 + 600
        assert downs[0]["deadline_eligible"] is True
        w.tick(at=T0 + 600)
        assert len(w.audit.of("run_late", run_id=downs[0]["_key"])) == 1


def test_chain_of_a_chained_run_inherits_eligibility():
    w = World()
    up = w.add_job(make_job("up"))
    w.add_job(_late_job(job_id="down", cron=None,
                        triggers=[{"type": "completion", "job": "up", "on": "success"}]))
    w.add_job(_late_job(job_id="third", cron=None,
                        triggers=[{"type": "completion", "job": "down", "on": "success"}]),
              scripts={"a": {"states": ["running"]}})
    cron_run(w, up)
    _settle(w, 12)
    third = [r for r in w.gw.kv.get("so_runs", {}).values() if r["job_id"] == "third"]
    assert len(third) == 1 and third[0]["deadline_at"] == T0 + 600
