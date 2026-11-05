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


def test_double_underscore_step_id_rejected():
    assert "bad_step_id" in codes(validate_job(job(steps=("a__b", "c"))))
    assert "bad_step_id" in codes(validate_job(job(steps=("a\n",))))


def test_timezone_unknown_vs_unavailable(monkeypatch):
    import so.cron as c
    assert "bad_timezone" in codes(validate_job(job(timezone="No/Such_Zone")))
    assert not codes(validate_job(job())) & {"bad_timezone", "timezone_fallback"}

    def boom(name):
        raise KeyError(name)
    monkeypatch.setattr(c, "ZoneInfo", boom)
    iss = validate_job(job())
    assert "timezone_fallback" in codes(iss) and "bad_timezone" not in codes(iss)
    assert [i["level"] for i in iss if i["code"] == "timezone_fallback"] == ["warning"]
    monkeypatch.setattr(c, "ZoneInfo", None)
    assert "timezone_fallback" in codes(validate_job(job()))


def test_malformed_input_returns_bad_shape():
    good = job(edges=[("a", "b")])
    mutations = [
        lambda j: j.update(steps=["x"]), lambda j: j.update(steps="x"), lambda j: j.update(steps=5),
        lambda j: j.update(params=[1]), lambda j: j.update(edges=[[]]), lambda j: j.update(edges=[None]),
        lambda j: j["steps"][0].update(run_when="x"), lambda j: j["steps"][0].update(run_when=[1]),
        lambda j: j["steps"][0].update(run_when={"kind": 1, "value": 2}),
        lambda j: j["steps"][0].update(retries="3"), lambda j: j["steps"][0].update(retries=True),
        lambda j: j["steps"][0].update(max_runtime=-1), lambda j: j["steps"][0].update(delayed_after=1.5),
        lambda j: j.update(defaults={"retries": "x"}), lambda j: j.update(defaults=[]),
        lambda j: j["edges"][0].update({"from": ["a"]}), lambda j: j["steps"][0].update(spl=5),
        lambda j: j.update(timezone=5), lambda j: j.update(params=[{"name": ["x"]}]),
        lambda j: j.update(triggers=[{"type": "cron", "cron": 5}]), lambda j: j.update(actions=[3]),
    ]
    import copy
    for m in mutations:
        j = copy.deepcopy(good)
        m(j)
        iss = validate_job(j)
        assert "bad_shape" in codes(iss), j
    for junk in (None, [], "x", 5, {"steps": None}, {}):
        assert isinstance(validate_job(junk), list)
