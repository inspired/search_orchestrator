"""``| orchestrate selftest``: built-in jobs and the server probe (spec section 10)."""
import pytest

from fakes import FakeGateway
from so import model, selftest
from so.gateway import GatewayError
from test_api import Audit, World
from test_orchestrate import Splunkd, run_cmd

PROBE_CHECKS = ["dispatch_as_owner", "history_json", "job_status_system", "job_results_system",
                "job_setttl_system", "job_cancel_system", "kv_delete_query", "user_exists",
                "user_access", "saved_search_info", "index_exists", "audit_receivers_simple",
                "preview_as_caller"]


def errors(job):
    return [i for i in model.validate_job(job) if i["level"] == "error"]


def edges(job):
    return sorted((e["from"], e["to"]) for e in job["edges"])


def steps(job):
    return {s["id"]: s for s in job["steps"]}


def as_job(definition, job_id="so_selftest"):
    return dict(definition, id=job_id, owner="root")


def test_selftest_definition_is_valid():
    job = selftest.definition()
    assert not errors(as_job(job))
    s = steps(job)
    assert set(s) == {"a", "b", "c", "d", "skip_me", "flaky", "merged", "merged_check"}
    assert edges(job) == sorted([("a", "b"), ("a", "c"), ("b", "d"), ("c", "d"),
                                 ("a", "skip_me"), ("a", "flaky"), ("b", "merged"),
                                 ("c", "merged"), ("skip_me", "merged"),
                                 ("merged", "merged_check")])
    # merged must give exactly one row: otherwise merged_check reads the missing lookup
    # and fails, as flaky's first attempt does.
    check = s["merged_check"]["spl"]
    assert check.startswith("| inputlookup [| makeresults | eval lookup=if(")
    assert '"$merged.resultCount$"="1"' in check
    assert '"%s", "%s"' % (selftest.OK_LOOKUP, selftest.MISSING_LOOKUP) in check
    assert s["merged"]["type"] == "previous"
    assert s["merged"]["spl"] == "| stats dc(branch) AS branches | where branches=2"
    assert not s["merged"].get("earliest") and not s["merged"].get("latest")
    assert all(e["condition"] == "on_success" for e in job["edges"] if e["to"] == "merged")
    assert "makeresults" in s["a"]["spl"]
    for parallel in ("b", "c"):
        assert "| loadjob $a.sid$" in s[parallel]["spl"]
    assert s["skip_me"]["run_when"]["kind"] == "expression"
    assert s["flaky"]["retries"] == 1
    for fail_first in (False, True):
        rollup = selftest.rollup_definition(fail_first, slow_n=1234, delayed_after=10)
        assert not errors(as_job(rollup, "so_selftest_rollup"))
        assert edges(rollup) == [("daily", "weekly"), ("weekly", "monthly")]
        assert rollup["defaults"]["delayed_after"] == 10
        delayed = [a for a in rollup["actions"] if a["hook"] == "on_delayed"]
        assert delayed == [{"hook": "on_delayed", "type": "event", "index": "orchestrator"}]
        assert not any(a["type"] == "webhook" for a in rollup["actions"])
        daily = steps(rollup)["daily"]
        if fail_first:
            assert "so_selftest_missing.csv" in daily["spl"]
        else:
            assert "mvrange(0,1234)" in daily["spl"]
            # mvexpand truncates at its memory limit on a real server: hashes stay per row.
            assert "mvexpand" not in daily["spl"] and "mvmap(r, sha512(" in daily["spl"]
            assert "sum(h)" in daily["spl"]  # else the optimizer removes the hashing
        assert all("addinfo" in st["spl"] for st in rollup["steps"])
    assert selftest.rollup_definition(False)["steps"][0]["spl"].startswith(
        "| makeresults count=50000 | eval r=mvrange(0,%d)" % selftest.DEFAULT_SLOW_N)


def test_selftest_admin_only():
    w = World()
    for user in ("alice", "carol", "dave"):
        status, out = w.call(user, "POST", "/orchestrator/selftest", {"scenario": "basic"})
        assert status == 403 and out["error"]["code"] == "forbidden", user
        status, _ = w.call(user, "POST", "/orchestrator/selftest", {"scenario": "probe"})
        assert status == 403
    assert not w.gw.kv.get("so_jobs")
    assert w.audit.of("permission_denied")
    status, out = w.call("root", "POST", "/orchestrator/selftest", {"scenario": "basic"})
    assert status == 201 and out["job_id"] == "so_selftest" and out["run_id"]
    status, out = w.call("root", "POST", "/orchestrator/selftest", {"scenario": "nope"})
    assert status == 400
    status, out = w.call("root", "POST", "/orchestrator/selftest",
                         {"scenario": "rollup_late", "slow_n": 0})
    assert status == 400


def hidden(w, job_id, step_id):
    job = w.store.get_job(job_id)
    return next(s["hidden_search"] for s in job["steps"] if s["id"] == step_id)


def test_selftest_completes_on_fake():
    w = World()
    status, out = w.call("root", "POST", "/orchestrator/selftest", {"scenario": "basic"})
    assert status == 201, out
    run_id = out["run_id"]
    assert w.store.get_run(run_id)["owner"] == "root"
    w.gw.script_job(hidden(w, "so_selftest", "a"), ["running", "done"], result_count=3)
    for parallel in ("b", "c"):
        w.gw.script_job(hidden(w, "so_selftest", parallel), ["done"], result_count=1,
                        first={"rows": "3"})
    w.gw.script_job(hidden(w, "so_selftest", "merged"), ["done"], result_count=1)
    flaky = hidden(w, "so_selftest", "flaky")
    w.gw.script_job(flaky, ["failed"], error="lookup missing")
    for _ in range(40):
        w.engine_tick()
        if any(d["name"] == flaky for d in w.gw.dispatch_log):
            w.gw.script_job(flaky, ["done"], result_count=1)
        w.now += 5
        if w.store.get_run(run_id)["state"] not in ("queued", "running"):
            break
    run = w.store.get_run(run_id)
    assert run["state"] == "succeeded", run
    st = run["steps"]
    assert st["skip_me"]["state"] == "skipped" and st["skip_me"]["skip_kind"] == "run_when"
    assert st["flaky"]["state"] == "succeeded" and st["flaky"]["attempt"] == 2
    assert all(st[s]["state"] == "succeeded"
               for s in ("a", "b", "c", "d", "merged", "merged_check"))
    c_args = [x["args"] for x in w.gw.dispatch_log
              if x["name"] == hidden(w, "so_selftest", "merged_check")]
    assert c_args == [{"merged__resultCount": "1"}]
    d_args = [x["args"] for x in w.gw.dispatch_log if x["name"] == hidden(w, "so_selftest", "d")]
    assert d_args and d_args[0]["b__first__rows"] == "3"
    m_args = [x["args"] for x in w.gw.dispatch_log
              if x["name"] == hidden(w, "so_selftest", "merged")]
    assert m_args == [{"so_input": '"%s" | append [| loadjob "%s"]'
                                   % (st["b"]["sid"], st["c"]["sid"])}]
    assert st["skip_me"].get("sid") is None
    assert [e for e in w.audit.events if e.get("run_id") == run_id and e["type"] == "run_state"]


def probe_world():
    w = World()
    w.splunkd = Splunkd(w)
    w.gw.saved_searches[("nobody", "_so_fallback_email")] = {"search": "| makeresults",
                                                             "sharing": "app"}
    w.gw.removed_users.add(selftest.NO_SUCH_USER)
    w.gw.search_handler = lambda owner, query: [
        e for e in w.audit.events if e.get("probe_id") and e["probe_id"] in query]
    return w


def test_probe_runs_every_check_on_fake():
    w = probe_world()
    real_dispatch = w.gw.dispatch

    def dispatch(owner, name, *a, **kw):
        w.gw.script_job(name, ["done"], result_count=3, first={"run_id": selftest.PROBE_RUN_ID})
        return real_dispatch(owner, name, *a, **kw)

    w.gw.dispatch = dispatch
    w.gw.script_job("so_preview_", ["running", "done"], result_count=2,
                    rows=[{"n": "1"}, {"n": "2"}])
    w.gw.kv.setdefault("so_locks", {})["engine"] = {"_key": "engine", "holder": "h"}
    touched = []
    for name in ("kv_insert", "kv_delete", "kv_delete_query", "kv_update"):
        real = getattr(w.gw, name)

        def spy(collection, *a, _real=real, _name=name, **kw):
            touched.append((_name, collection))
            return _real(collection, *a, **kw)

        setattr(w.gw, name, spy)
    rows = run_cmd(w, "selftest scenario=probe", token="tok-root")
    assert [r["check"] for r in rows] == ["rest_me"] + PROBE_CHECKS
    assert all(r["ok"] == 1 for r in rows), [r for r in rows if not r["ok"]]
    assert all(set(r) == {"check", "ok", "detail"} for r in rows)
    assert set(w.gw.kv["so_locks"]) == {"engine"}  # scratch docs removed, lease kept
    # The scratch docs live in their own collection: the engine lease is never touched.
    assert selftest.SCRATCH == "so_selftest"
    assert ("kv_delete_query", "so_selftest") in touched
    assert not [t for t in touched if t[1] == "so_locks"]
    assert not w.gw.kv.get("so_selftest")
    assert any(e.get("type") == "selftest_probe" for e in w.audit.events)
    for row in rows:
        assert "tok-" not in row["detail"]
    (entry,) = w.gw.preview_log
    assert entry["user"] == "root" and entry["spl"] == "| makeresults count=2"
    assert ".new.probe." in entry["sid"]
    assert (entry["sid"], "cancel", {}) in w.gw.control_log


def test_probe_check_errors_are_scrubbed_and_isolated():
    gw = FakeGateway()
    gw.users = {"root": {"roles": ["admin"], "capabilities": ["orchestrator_admin"]}}

    def boom(*a, **kw):
        raise GatewayError("HTTP 500 sessionKey=SECRETKEY123456 Authorization: Splunk SECRETKEY123456")

    gw.index_exists = boom
    gw.dispatch = boom
    job = {"id": "so_selftest", "steps": [{"id": "a", "spl": "| makeresults",
                                           "hidden_search": "_so_so_selftest_a_1234abcd"}]}
    audit = Audit()
    checks = selftest.probe("root", gw, gw, audit.emit, job, clock=lambda: 1000,
                            sleep=lambda s: None, secrets=["SECRETKEY123456"])
    by = {c["check"]: c for c in checks}
    assert [c["check"] for c in checks] == PROBE_CHECKS
    assert by["index_exists"]["ok"] == 0 and by["dispatch_as_owner"]["ok"] == 0
    assert by["history_json"]["ok"] == 0 and "dispatch" in by["history_json"]["detail"]
    assert by["kv_delete_query"]["ok"] == 1 and by["user_access"]["ok"] == 1
    for c in checks:
        assert "SECRETKEY" not in c["detail"], c
    assert selftest.scrub("token=abc123def456 Splunk zz99zz99zz99", []) == \
        "token=[redacted] Splunk [redacted]"


def test_rollup_scenarios_take_tuning_arguments():
    w = World()
    status, out = w.call("root", "POST", "/orchestrator/selftest",
                         {"scenario": "rollup_late", "slow_n": "5000", "delayed_after": "15"})
    assert status == 201, out
    run = w.store.get_run(out["run_id"])
    definition = run["definition"]
    assert definition["defaults"]["delayed_after"] == 15
    assert "mvrange(0,5000)" in steps(definition)["daily"]["spl"]
    assert run["scheduled_time"] == selftest.default_scheduled_time("rollup_late", w.now)
    assert run["scheduled_time"] < w.now - 3600
    status, out = w.call("root", "POST", "/orchestrator/selftest", {"scenario": "rollup_fail"})
    assert status == 201 and out["job_id"] == "so_selftest_rollup_fail"
    status, out = w.call("root", "POST", "/orchestrator/selftest",
                         {"scenario": "basic", "scheduled_time": "1700000000"})
    assert w.store.get_run(out["run_id"])["scheduled_time"] == 1700000000


@pytest.mark.parametrize("bad", [{"slow_n": "x"}, {"slow_n": 100001}, {"delayed_after": 0},
                                 {"delayed_after": 999999}])
def test_rollup_tuning_arguments_validated(bad):
    w = World()
    status, _ = w.call("root", "POST", "/orchestrator/selftest", dict(bad, scenario="rollup_late"))
    assert status == 400


def test_probe_preview_as_caller_checks_owner():
    gw = FakeGateway()
    gw.users = {"root": {"roles": ["admin"], "capabilities": ["orchestrator_admin"]}}
    gw.script_job("so_preview_", ["done"], result_count=2, rows=[{"n": "1"}, {"n": "2"}])
    job = {"id": "so_selftest", "steps": []}
    run = lambda: {c["check"]: c for c in selftest.probe(  # noqa: E731
        "root", gw, gw, Audit().emit, job, clock=lambda: 1000, sleep=lambda s: None)}
    assert run()["preview_as_caller"]["ok"] == 1
    real = gw.preview_info
    gw.preview_info = lambda sid: dict(real(sid), owner="nobody")
    check = run()["preview_as_caller"]
    assert check["ok"] == 0 and "owner=nobody" in check["detail"]
    assert all(action == "cancel" for _, action, _ in gw.control_log)


def test_selftest_says_when_queued_behind_another_run():
    w = World()
    w.splunkd = Splunkd(w)
    status, out = w.call("root", "POST", "/orchestrator/selftest", {"scenario": "basic"})
    assert status == 201 and "queued_behind" not in out
    first = out["run_id"]
    run = w.store.get_run(first)
    run["state"] = "blocked"
    w.store.save_run(run)
    w.now += 60
    status, out = w.call("root", "POST", "/orchestrator/selftest", {"scenario": "basic"})
    assert status == 201 and out["queued_behind"] == {"run_id": first, "state": "blocked"}
    rows = run_cmd(w, "selftest scheduled_time=%d" % (w.now + 60), token="tok-root")
    assert rows[0]["queued_behind"] == first and rows[0]["queued_behind_state"] == "blocked"
    assert rows[0]["message"] == (
        'queued behind run %s, which is blocked: cancel it with | orchestrate cancel '
        'run="%s", then poll with | orchestrate status run="%s"' % (first, first, rows[0]["run_id"]))
    # The self-test jobs never hold their queue after a failure.
    assert all(j["after_give_up"] == "continue" for j in w.store.list_jobs()
               if j["id"].startswith("so_selftest"))


def test_selftest_queued_behind_names_the_queued_run_promotion_takes_first():
    w = World()

    def selftest_at(t):
        status, out = w.call("root", "POST", "/orchestrator/selftest",
                             {"scenario": "basic", "scheduled_time": t})
        assert status == 201, out
        return out

    early = selftest_at(1000)["run_id"]  # queued: the engine hasn't promoted it
    out = selftest_at(2000)
    assert out["queued_behind"] == {"run_id": early, "state": "queued"}
    # A queued re-run goes first, whatever its scheduled time.
    rerun = selftest_at(5000)["run_id"]
    w.store.save_run(dict(w.store.get_run(rerun), rerun_count=1))
    out = selftest_at(3000)
    assert out["queued_behind"] == {"run_id": rerun, "state": "queued"}
    # Nothing ahead of it: only runs a promotion would take first count.
    for r in w.store.list_runs({"job_id": "so_selftest"}):
        if r["id"] != early:
            w.store.save_run(dict(r, state="cancelled"))
    out = selftest_at(500)
    assert "queued_behind" not in out
    # An active run blocks before any queued one.
    w.store.save_run(dict(w.store.get_run(early), state="running"))
    out = selftest_at(400)
    assert out["queued_behind"] == {"run_id": early, "state": "running"}
