"""The engine feeds backfills in order and cancels them as a group (features-2 spec 6)."""
from so import backfill
from so.gateway import KvError

from test_engine import DAY, T0, World, make_job

BF = "bf0123456789ab"
RUNNING = {"a": {"states": ["running"]}}


def add_backfill(w, slots, concurrency=1, job_id="j", backfill_id=BF, params=None):
    doc = {"_key": backfill_id, "id": backfill_id, "job_id": job_id, "created_by": "alice",
           "created_at": int(w.clock()), "from": slots[0], "to": slots[-1] + 1,
           "source": "step", "step": DAY, "slots": list(slots), "params": params or {},
           "concurrency": concurrency, "count": len(slots), "next": 0, "state": "running",
           "run_ids": [], "ended_at": None, "cancelled_by": None}
    assert w.gw.kv_insert(backfill.BACKFILLS, doc)
    return backfill_id


def doc(w, backfill_id=BF):
    return w.gw.kv_get(backfill.BACKFILLS, backfill_id)


def bf_runs(w, backfill_id=BF):
    rows = [r for r in w.gw.kv.get("so_runs", {}).values() if r.get("backfill") == backfill_id]
    return sorted(rows, key=lambda r: r["scheduled_time"])


def key(slot, job_id="j", backfill_id=BF):
    return "%s:backfill-%s:%d" % (job_id, backfill_id, slot)


def slots(n):
    return [T0 - (10 - i) * DAY for i in range(n)]


def finish_active(w):
    for r in bf_runs(w):
        st = r["steps"]["a"]
        if r["state"] == "running" and st.get("sid") and st.get("state") == "running":
            w.finish(st["sid"])


def test_feeds_one_at_a_time_in_order():
    w = World(T0)
    w.add_job(make_job(cron=None, deadline={"within": 600}), scripts=RUNNING)
    s = slots(3)
    add_backfill(w, s)
    w.tick()
    runs = bf_runs(w)
    assert [r["id"] for r in runs] == [key(s[0])]
    run = runs[0]
    assert run["trigger"] == "backfill" and run["backfill"] == BF
    assert run["scheduled_time"] == s[0] and run["deadline_at"] is None
    assert run["state"] == "running"
    assert run["delay_base"] == run["promoted_at"] == T0
    assert doc(w)["next"] == 1 and doc(w)["run_ids"] == [key(s[0])]
    w.tick(advance=5)
    assert len(bf_runs(w)) == 1
    w.finish(run["steps"]["a"]["sid"])
    w.tick(advance=5)
    assert w.run(key(s[0]))["state"] == "succeeded"
    w.tick(advance=5)
    runs = bf_runs(w)
    assert [r["id"] for r in runs] == [key(s[0]), key(s[1])]
    second = runs[1]
    assert second["scheduled_time"] == s[1] and second["state"] == "running"
    assert second["delay_base"] == second["promoted_at"] == T0 + 15
    assert [d["now"] for d in w.gw.dispatch_log] == [s[0], s[1]]


def test_concurrency_three_queues_three():
    w = World(T0)
    w.add_job(make_job(cron=None), scripts=RUNNING)
    s = slots(5)
    add_backfill(w, s, concurrency=3)
    for _ in range(3):
        w.tick(advance=5)
        runs = bf_runs(w)
        assert [r["id"] for r in runs] == [key(t) for t in s[:3]]
        assert [r["state"] for r in runs] == ["running", "queued", "queued"]
    assert doc(w)["next"] == 3
    finish_active(w)
    for _ in range(4):
        w.tick(advance=5)
        active = [r for r in bf_runs(w) if r["state"] in ("queued", "running")]
        assert len(active) <= 3
    assert len(bf_runs(w)) == 4


def test_done_with_counts():
    w = World(T0)
    w.add_job(make_job(cron=None), scripts=RUNNING)
    s = slots(3)
    add_backfill(w, s)
    for _ in range(12):
        w.tick(advance=5)
        finish_active(w)
        if doc(w)["state"] != "running":
            break
    d = doc(w)
    assert d["state"] == "done" and d["ended_at"] is not None
    assert d["next"] == 3 and d["run_ids"] == [key(t) for t in s]
    done = w.audit.of("backfill_done", backfill_id=BF)
    assert len(done) == 1
    assert done[0]["job_id"] == "j" and done[0]["counts"] == {"succeeded": 3}
    w.tick(advance=5)
    assert len(w.audit.of("backfill_done")) == 1
    assert len(bf_runs(w)) == 3


def test_feed_survives_crash_between_create_and_save():
    w = World(T0)
    w.add_job(make_job(cron=None), scripts=RUNNING)
    s = slots(3)
    add_backfill(w, s)
    real = w.gw.kv_update
    state = {"fail": True}

    def flaky_update(collection, k, d):
        if collection == backfill.BACKFILLS and state["fail"]:
            state["fail"] = False
            assert w.gw.kv_get("so_runs", key(s[0])) is not None  # right after create_run
            raise KvError("KV Store unavailable", status=503, transient=True)
        return real(collection, k, d)

    w.gw.kv_update = flaky_update
    w.tick()
    assert not state["fail"]
    assert doc(w)["next"] == 0 and doc(w)["run_ids"] == []
    for _ in range(15):
        w.tick(advance=5)
        finish_active(w)
    runs = bf_runs(w)
    assert [r["scheduled_time"] for r in runs] == s
    assert len(runs) == len(s)
    d = doc(w)
    assert d["state"] == "done" and d["next"] == 3
    assert sorted(d["run_ids"]) == sorted(key(t) for t in s)


def test_queue_full_waits():
    w = World(T0)
    w.store.save_settings({"queue_cap": 1})
    j = w.add_job(make_job(cron=None), scripts=RUNNING)
    manual = w.manual(j)
    add_backfill(w, slots(2))
    w.tick()  # the manual run is queued: it goes first
    assert w.run(manual)["state"] == "running"
    assert not bf_runs(w)
    w.tick(advance=5)  # the queue is full
    w.tick(advance=5)
    assert not bf_runs(w)
    assert not w.audit.of("run_rejected")
    assert doc(w)["next"] == 0 and doc(w)["state"] == "running"
    w.finish(w.step(manual, "a")["sid"])
    w.tick(advance=5)
    assert w.run(manual)["state"] == "succeeded"
    w.tick(advance=5)
    assert [r["state"] for r in bf_runs(w)] == ["running"]
    assert doc(w)["next"] == 1


def test_disabled_job_pauses_feeding():
    w = World(T0)
    j = w.add_job(make_job(cron=None, enabled=False), scripts=RUNNING)
    add_backfill(w, slots(2))
    w.tick()
    w.tick(advance=5)
    assert not bf_runs(w)
    assert doc(w)["state"] == "running" and doc(w)["next"] == 0
    w.store.save_job(dict(j, enabled=True))
    w.tick(advance=5)
    assert len(bf_runs(w)) == 1 and doc(w)["next"] == 1


def test_cancel_cancels_runs_and_stops():
    w = World(T0)
    w.add_job(make_job(cron=None), scripts=RUNNING)
    s = slots(4)
    add_backfill(w, s, concurrency=2)
    w.tick()
    assert [r["state"] for r in bf_runs(w)] == ["running", "queued"]
    sid = w.step(key(s[0]), "a")["sid"]
    w.command(type="cancel_backfill", backfill_id=BF, user="bob")
    w.tick(advance=5)
    assert [r["state"] for r in bf_runs(w)] == ["cancelled", "cancelled"]
    assert (sid, "cancel", {}) in w.gw.control_log
    d = doc(w)
    assert d["state"] == "cancelled" and d["cancelled_by"] == "bob"
    assert d["ended_at"] == T0 + 5
    cancelled = w.audit.of("backfill_cancelled", backfill_id=BF)
    assert len(cancelled) == 1 and cancelled[0]["user"] == "bob"
    assert cancelled[0]["job_id"] == "j"
    ok = w.audit.of("command", command="cancel_backfill")
    assert [e["result"] for e in ok] == ["ok"]
    for _ in range(3):
        w.tick(advance=5)
    assert len(bf_runs(w)) == 2
    assert not w.audit.of("backfill_done")
    w.command(type="cancel_backfill", backfill_id=BF, user="bob")
    w.tick(advance=5)
    results = w.audit.of("command", command="cancel_backfill")
    assert [e["result"] for e in results] == ["ok", "rejected"]
    assert results[1]["detail"] == "already ended"
    assert not w.gw.kv.get("so_commands")


def test_cancel_survives_crash_after_save():
    w = World(T0)
    w.add_job(make_job(cron=None), scripts=RUNNING)
    s = slots(3)
    add_backfill(w, s, concurrency=2)
    w.tick()
    real = w.store.save_run
    state = {"fail": True}

    def flaky_save(run):
        if run.get("state") == "cancelled" and state["fail"]:
            state["fail"] = False
            raise KvError("KV Store unavailable", status=503, transient=True)
        return real(run)

    w.store.save_run = flaky_save
    w.command(type="cancel_backfill", backfill_id=BF, user="bob")
    w.tick(advance=5)
    assert not state["fail"]
    assert doc(w)["state"] == "cancelled"  # stored before the runs are cancelled
    assert w.gw.kv.get("so_commands")  # the command is applied again
    w.tick(advance=5)
    assert [r["state"] for r in bf_runs(w)] == ["cancelled", "cancelled"]
    assert len(w.audit.of("backfill_cancelled")) == 1
    assert [e["result"] for e in w.audit.of("command", command="cancel_backfill")] == ["ok"]
    assert not w.gw.kv.get("so_commands")


def test_cancel_of_unknown_backfill_is_rejected():
    w = World(T0)
    w.command(type="cancel_backfill", backfill_id="bf000000000000", user="bob")
    w.tick()
    results = w.audit.of("command", command="cancel_backfill")
    assert [e["result"] for e in results] == ["rejected"]
    assert not w.gw.kv.get("so_commands")


def test_scheduled_run_waits_behind_at_most_one():
    w = World()
    w.add_job(make_job(), scripts=RUNNING)  # cron 0 1 * * *: a run at T0
    s = slots(3)
    add_backfill(w, s)
    w.tick()  # T0 - 5
    first = key(s[0])
    assert w.run(first)["state"] == "running"
    w.tick(at=T0)
    cron = "j:%d" % T0
    assert w.run(cron)["state"] == "queued"
    w.finish(w.step(first, "a")["sid"])
    w.tick(advance=5)
    assert w.run(first)["state"] == "succeeded"
    w.tick(advance=5)
    assert len(bf_runs(w)) == 1  # the cron run goes first
    assert w.run(cron)["state"] == "running"
    w.tick(advance=5)
    second = key(s[1])
    assert w.run(second)["state"] == "queued"  # created while the cron run is active
    assert w.run(cron)["state"] == "running"
    w.finish(w.step(cron, "a")["sid"])
    w.tick(advance=5)
    assert w.run(cron)["state"] == "succeeded"
    w.tick(advance=5)
    assert w.run(second)["state"] == "running"


def test_invalid_params_skip_the_slot_and_are_audited():
    w = World(T0)
    w.add_job(make_job(cron=None, params=[{"name": "n", "type": "number"}]),
              scripts=RUNNING)
    s = slots(2)
    add_backfill(w, s, params={"n": "not a number"})
    w.tick()
    rejected = w.audit.of("run_rejected", reason="invalid_params")
    assert [e["run_id"] for e in rejected] == [key(t) for t in s]
    assert not bf_runs(w)
    d = doc(w)
    assert d["next"] == 2 and d["state"] == "done"
    assert w.audit.of("backfill_done")[0]["counts"] == {}
