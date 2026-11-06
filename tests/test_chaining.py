"""Job-to-job chaining: completion triggers and start-job actions (spec section 10)."""
from so import scheduler
from so.gateway import KvError
from test_engine import DAY, T0, World, make_job

UP_RUN_SCHEDULED = T0 - 3 * DAY


def chain_world(on="success", up_steps=("a",), up_edges=(), up_scripts=None, down_owner="alice",
                **up_over):
    w = World(t=T0)
    up = w.add_job(make_job("up", steps=up_steps, edges=up_edges, cron=None, **up_over),
                   scripts=up_scripts or {})
    down = w.add_job(make_job("down", cron=None, owner=down_owner,
                              triggers=[{"type": "completion", "job": "up", "on": on}]))
    return w, up, down


def runs_of(w, job_id):
    return sorted((r for r in w.gw.kv.get("so_runs", {}).values() if r["job_id"] == job_id),
                  key=lambda r: r["_key"])


def settle(w, ticks=8):
    for _ in range(ticks):
        w.tick(advance=5)


def handled_failure_up(on="complete"):
    """``up``: step a fails, an on_failure edge to b handles it, so the run ends failed."""
    return chain_world(on=on, up_steps=("a", "b"), up_edges=[("a", "b", "on_failure")],
                       up_scripts={"a": {"states": ["failed"], "error": "boom"}})


def rerun(w, run_id, restart=False):
    w.command(type="rerun", run_id=run_id, step_id="a", definition="original",
              restart_downstream_jobs=restart, user="alice")


def test_completion_fires_once_per_upstream_run():
    w, up, down = chain_world()
    first = w.manual(up)
    settle(w)
    assert w.run(first)["state"] == "succeeded"
    downs = runs_of(w, "down")
    assert len(downs) == 1
    key = downs[0]["_key"]
    assert key == "down:%s:completion" % first and scheduler.is_run_id(key)
    assert (downs[0]["trigger"], downs[0]["upstream"], downs[0]["chain_depth"]) == \
        ("completion", first, 1)
    settle(w)
    assert len(runs_of(w, "down")) == 1
    assert runs_of(w, "down")[0]["state"] == "succeeded"
    second = w.manual(up)
    settle(w)
    assert w.run(second)["state"] == "succeeded"
    assert sorted(r["upstream"] for r in runs_of(w, "down")) == sorted([first, second])


def test_completion_on_success_ignores_failure_and_on_complete_fires():
    w, up, down = handled_failure_up(on="success")
    run_id = w.manual(up)
    settle(w)
    assert w.run(run_id)["state"] == "failed"
    assert runs_of(w, "down") == []
    w2, up2, _ = handled_failure_up(on="complete")
    run2 = w2.manual(up2)
    settle(w2)
    assert w2.run(run2)["state"] == "failed"
    assert [r["upstream"] for r in runs_of(w2, "down")] == [run2]


def test_failed_upstream_success_on_rerun_starts_downstream():
    w, up, down = chain_world(up_scripts={"a": {"states": ["failed"], "error": "boom"}})
    run_id = w.manual(up)
    settle(w)
    assert w.run(run_id)["state"] == "blocked"
    assert runs_of(w, "down") == []
    w.gw.script_job(up["steps"][0]["hidden_search"], ["done"])
    rerun(w, run_id)
    settle(w)
    assert w.run(run_id)["state"] == "succeeded"
    downs = runs_of(w, "down")
    assert [r["_key"] for r in downs] == ["down:%s:completion" % run_id]


def test_rerun_of_succeeded_upstream_no_refire_unless_ticked():
    # The upstream run already reached the matching outcome ("complete": it ended
    # failed) and started the downstream job. Re-running it to success does not start
    # it again; with restart_downstream_jobs it does, under a distinct key.
    w, up, down = handled_failure_up(on="complete")
    run_id = w.manual(up)
    settle(w)
    assert len(runs_of(w, "down")) == 1
    w.gw.script_job(up["steps"][0]["hidden_search"], ["done"])
    rerun(w, run_id)
    settle(w)
    assert w.run(run_id)["state"] == "succeeded"
    assert len(runs_of(w, "down")) == 1

    w.gw.script_job(up["steps"][0]["hidden_search"], ["failed"])
    second = w.manual(up)
    settle(w)
    assert w.run(second)["state"] == "failed"
    assert len(runs_of(w, "down")) == 2
    w.gw.script_job(up["steps"][0]["hidden_search"], ["done"])
    rerun(w, second, restart=True)
    settle(w)
    assert w.run(second)["state"] == "succeeded"
    keys = [r["_key"] for r in runs_of(w, "down")]
    restarted = "down:%s:completion:rerun1" % second
    assert len(keys) == 3 and restarted in keys
    assert scheduler.is_run_id(restarted)
    assert w.run(restarted)["upstream"] == second


def test_restart_downstream_also_restarts_start_job_action():
    w = World(t=T0)
    other = w.add_job(make_job("other", cron=None))
    up = w.add_job(make_job("up", steps=("a", "b"), edges=[("a", "b", "on_failure")], cron=None,
                            actions=[{"hook": "on_complete", "type": "start_job",
                                      "job": "other"}]),
                   scripts={"a": {"states": ["failed"], "error": "boom"}})
    run_id = w.manual(up)
    settle(w)
    assert [r["_key"] for r in runs_of(w, "other")] == ["other:%s:start_job:a0" % run_id]
    w.gw.script_job(up["steps"][0]["hidden_search"], ["failed"])
    rerun(w, run_id)
    settle(w)
    assert len(runs_of(w, "other")) == 1  # fired once per upstream run
    rerun(w, run_id, restart=True)
    settle(w)
    keys = [r["_key"] for r in runs_of(w, "other")]
    assert "other:%s:start_job:a0:rerun2" % run_id in keys and len(keys) == 2
    assert other


def test_chained_run_inherits_scheduled_time():
    w, up, down = chain_world()
    run_id = w.manual(up, scheduled_time=UP_RUN_SCHEDULED)
    settle(w, 12)
    downs = runs_of(w, "down")
    assert downs[0]["scheduled_time"] == UP_RUN_SCHEDULED
    assert downs[0]["state"] == "succeeded"
    down_dispatches = [d for d in w.gw.dispatch_log if d["name"].startswith("_so_down_")]
    assert down_dispatches and all(d["now"] == UP_RUN_SCHEDULED for d in down_dispatches)
    assert w.run(run_id)["state"] == "succeeded"


def _fail_up_run_saves_once(w, run_id):
    real = w.gw.kv_update
    state = {"armed": True}

    def flaky(collection, key, doc):
        if (collection == "so_runs" and key == run_id and state["armed"]
                and doc.get("state") in ("succeeded", "failed")):
            state["armed"] = False
            raise KvError("KV Store unavailable", status=503, transient=True)
        return real(collection, key, doc)

    w.gw.kv_update = flaky
    return state


def test_chain_key_no_duplicate_after_restart():
    w, up, down = handled_failure_up(on="complete")
    run_id = w.manual(up)
    state = _fail_up_run_saves_once(w, run_id)
    settle(w, 3)
    assert not state["armed"]  # the run's final save failed after the downstream run was made
    assert len(runs_of(w, "down")) == 1
    w.engine = w.new_engine()  # restart
    settle(w)
    assert w.run(run_id)["state"] == "failed"
    assert len(runs_of(w, "down")) == 1

    # A re-run that restarts downstream jobs is exactly-once across a restart too.
    w.gw.script_job(up["steps"][0]["hidden_search"], ["done"])
    rerun(w, run_id, restart=True)
    state = _fail_up_run_saves_once(w, run_id)
    settle(w, 4)
    assert not state["armed"]
    w.engine = w.new_engine()
    settle(w)
    assert w.run(run_id)["state"] == "succeeded"
    keys = sorted(r["_key"] for r in runs_of(w, "down"))
    assert keys == sorted(["down:%s:completion" % run_id, "down:%s:completion:rerun1" % run_id])


def test_completion_chain_depth_limit():
    w, up, down = chain_world()
    run_id = w.manual(up, chain_depth=10)
    settle(w)
    assert w.run(run_id)["state"] == "succeeded"
    assert runs_of(w, "down") == []
    events = w.audit.of("chain_depth_exceeded", run_id=run_id)
    assert events and events[0]["target_job"] == "down"
    assert events[0]["error"] == "Job chain depth limit (10) reached"


def test_completion_requires_upstream_owner_may_run_target():
    w, up, down = chain_world(down_owner="bob")
    run_id = w.manual(up)
    settle(w)
    assert runs_of(w, "down") == []
    assert w.audit.of("run_rejected", reason="permission", target_job="down")
    w.gw.users["alice"] = {"roles": ["ops"], "capabilities": ["orchestrator_run"]}
    w.store.save_job(dict(down, run_roles=["ops"]))
    second = w.manual(up)
    settle(w)
    assert [r["upstream"] for r in runs_of(w, "down")] == [second]


def test_persistent_user_access_error_rejects_completion_and_closes_upstream():
    # Final review M5.
    from so import engine as enginemod
    from so.gateway import GatewayError
    w, up, down = chain_world(down_owner="bob")

    def broken(name):
        raise GatewayError("user lookup failed: HTTP 503", status=503, transient=True)
    w.gw.user_access = broken
    first = w.manual(up)
    settle(w, 8)
    assert not w.run(first).get("closed")  # the closing save waits for the check
    start = w.clock.t
    while w.clock.t < start + enginemod.UNKNOWN_LIMIT + 10:
        w.tick(advance=5)
    run = w.run(first)
    assert run["state"] == "succeeded" and run["closed"] is True
    assert runs_of(w, "down") == []
    rejected = w.audit.of("run_rejected", run_id=first, reason="permission_check_failed")
    assert len(rejected) == 1 and rejected[0]["target_job"] == "down"
    assert "503" in rejected[0]["error"]
