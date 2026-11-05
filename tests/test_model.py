from so.model import validate_job, topo_order, resolve_step


def codes(issues):
    return {i["code"] for i in issues}


def job(steps=("a", "b"), edges=(), actions=True, **over):
    j = {"id": "j", "timezone": "Europe/Oslo", "params": [],
         "defaults": {"retries": 0},
         "steps": [{"id": s, "type": "inline", "spl": "| makeresults"} for s in steps],
         "edges": [{"from": a, "to": b, "condition": "on_success"} for a, b in edges],
         "actions": [{"hook": "on_failure", "type": "webhook"}] if actions else []}
    j.update(over)
    return j


def test_valid_job_clean():
    assert not [i for i in validate_job(job(edges=[("a", "b")])) if i["level"] == "error"]


def test_cycle_rejected():
    assert codes(validate_job(job(edges=[("a", "b"), ("b", "a")]))) >= {"cycle"}


def test_duplicate_and_bad_ids():
    j = job(steps=("a", "a", "Bad", "run"))
    assert codes(validate_job(j)) >= {"duplicate_step", "bad_step_id", "reserved_step_id"}


def test_unknown_edge_step():
    assert "unknown_edge_step" in codes(validate_job(job(edges=[("a", "zz")])))


def test_bad_cron_and_expression():
    j = job()
    j["steps"][0]["run_when"] = {"kind": "cron", "value": "61 * * * *"}
    j["steps"][1]["run_when"] = {"kind": "expression", "value": "import os"}
    assert codes(validate_job(j)) >= {"bad_cron", "bad_expression"}


def test_unknown_token():
    j = job()
    j["steps"][1]["spl"] = "| loadjob $a.bogus$"
    assert "unknown_token" in codes(validate_job(j))
    j["steps"][1]["spl"] = "| search r=$run.param.nope$"
    assert "unknown_token" in codes(validate_job(j))
    j["steps"][1]["spl"] = "| eval x=\"$unknown$\" | rex \"foo$\""
    assert "unknown_token" not in codes(validate_job(j))


def test_expression_edge_unknown_token():
    j = job(edges=[("a", "b")])
    j["edges"][0].update(condition="expression", expression="$ghost.resultCount$ > 0")
    assert "unknown_token" in codes(validate_job(j))


def test_bad_param():
    j = job(params=[{"name": "r", "type": "enum", "values": ["eu"], "default": "us"}])
    assert "bad_param" in codes(validate_job(j))
    assert "bad_param" in codes(validate_job(job(params=[{"name": "r", "type": "nope"}])))


def test_warnings():
    j = job(actions=False, edges=[("a", "b")])
    j["steps"][0]["retries"] = 2
    assert codes(validate_job(j)) >= {"retries_duplicate_risk", "no_failure_notification"}
    assert "no_failure_notification" not in codes(validate_job(job()))


def test_token_from_skippable_step():
    j = job(edges=[("a", "b")])
    j["steps"][0]["run_when"] = {"kind": "cron", "value": "0 1 * * 1"}
    j["steps"][1]["spl"] = "| loadjob $a.sid$"
    assert "token_from_skippable_step" in codes(validate_job(j))
    j["steps"][1]["spl"] = "| loadjob $a.sid|none$"
    assert "token_from_skippable_step" not in codes(validate_job(j))


def test_token_from_downstream_of_failure_edge():
    j = job(steps=("a", "b", "c"), edges=[("a", "b"), ("b", "c")])
    j["edges"][0]["condition"] = "on_failure"
    j["steps"][2]["spl"] = "$b.resultCount$"
    assert "token_from_skippable_step" in codes(validate_job(j))


def test_topo_and_resolve():
    j = job(steps=("c", "b", "a"), edges=[("a", "b"), ("b", "c")])
    assert topo_order(j) == ["a", "b", "c"]
    j["defaults"] = {"max_runtime": 5, "retries": 1}
    r = resolve_step(j, dict(j["steps"][0], retries=None, workload_pool="x"))
    assert r["max_runtime"] == 5 and r["retries"] == 1 and r["delayed_after"] == 3600
    assert "workload_pool" not in r
