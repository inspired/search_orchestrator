from so import model
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


def test_orchestrate_in_step_spl_is_an_error():
    # Final review M14: it would bypass the chain depth limit.
    for spl in ("| orchestrate start job=j", "index=x | ORCHESTRATE status", "x |orchestrate jobs"):
        j = job()
        j["steps"][0]["spl"] = spl
        found = [i for i in validate_job(j) if i["code"] == "orchestrate_in_step"]
        assert found and found[0]["level"] == "error" and found[0]["step"] == "a"
        assert found[0]["message"] == "Steps cannot call | orchestrate; use a start_job action"
    j = job()
    j["steps"][0]["spl"] = '| makeresults | eval note="orchestrate later"'
    assert "orchestrate_in_step" not in codes(validate_job(j))


def test_step_without_time_range_warns():
    # Final review M19.
    j = job()
    j["steps"][1].update(earliest="-1d@d", latest="@d")
    found = [i for i in validate_job(j) if i["code"] == "all_time_search"]
    assert [(i["step"], i["level"], i["message"]) for i in found] == [
        ("a", "warning", "This step searches all time.")]
    j["steps"][0]["earliest"] = "-1h"
    assert "all_time_search" not in codes(validate_job(j))
    j = job(steps=("a",))
    j["steps"] = [{"id": "a", "type": "saved_search", "saved_search_ref": "x"}]
    assert "all_time_search" not in codes(validate_job(j))  # its own time range applies


def test_token_after_backslash_is_a_save_error():
    from so import model
    job = {"id": "j", "title": "J", "owner": "u",
           "steps": [{"id": "a", "type": "inline", "earliest": "-1d", "latest": "now",
                      "spl": 'search source="C:\\logs\\$run.param.p$"'}],
           "edges": [], "params": [{"name": "p", "type": "string"}]}
    issues = model.validate_job(job)
    assert any(i["code"] == "unsafe_token_position" and i["level"] == "error" for i in issues)


def test_previous_step_validation():
    base = {"id": "j", "owner": "o", "steps": [
        {"id": "a", "type": "inline", "spl": "| makeresults", "earliest": "-1d"},
        {"id": "b", "type": "previous", "spl": "stats count"}], "edges": []}
    codes = {i["code"] for i in model.validate_job(base) if i["level"] == "error"}
    assert {"previous_needs_pipe", "previous_needs_dependency"} <= codes
    base["steps"][1]["spl"] = "| stats count"
    base["edges"] = [{"from": "a", "to": "b"}]
    assert not [i for i in model.validate_job(base) if i["level"] == "error"]
    assert not [i for i in model.validate_job(base)
                if i["code"] == "all_time_search" and i["step"] == "b"]


def test_previous_step_shares_inline_spl_checks():
    j = {"id": "j", "owner": "o", "steps": [
        {"id": "a", "type": "inline", "spl": "| makeresults", "earliest": "-1d"},
        {"id": "b", "type": "previous", "spl": "| orchestrate run x | eval x=```$a.sid$```"}],
        "edges": [{"from": "a", "to": "b"}]}
    found = {i["code"] for i in model.validate_job(j) if i["level"] == "error"}
    assert {"orchestrate_in_step", "unsafe_token_position"} <= found


def test_find_cycle_names_the_path():
    from so import model as m
    job = {"steps": [{"id": x} for x in ("a", "b", "c", "d")],
           "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "c"},
                     {"from": "c", "to": "b"}, {"from": "c", "to": "d"}]}
    assert m.find_cycle(job) == ["b", "c", "b"]
    job["edges"] = [{"from": "a", "to": "a"}]
    assert m.find_cycle(job) == ["a", "a"]
    job["edges"] = [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}]
    assert m.find_cycle(job) is None


def test_previous_step_with_an_old_time_range_warns():
    from so import model as m
    j = {"name": "j", "enabled": True, "timezone": "UTC", "triggers": [], "params": [],
         "actions": [],
         "steps": [{"id": "a", "type": "inline", "spl": "| makeresults", "earliest": "-1d"},
                   {"id": "p", "type": "previous", "spl": "| stats count", "earliest": "-7d",
                    "latest": "now"}],
         "edges": [{"from": "a", "to": "p"}]}
    found = [i for i in m.validate_job(j) if i["code"] == "previous_old_time_range"]
    assert found == [{"level": "warning", "code": "previous_old_time_range",
                      "message": "re-save the job to drop this step's old time range",
                      "step": "p"}]
    assert m.old_time_range_issues(j) == found
    del j["steps"][1]["earliest"], j["steps"][1]["latest"]
    assert "previous_old_time_range" not in codes(m.validate_job(j))
    assert m.old_time_range_issues(j) == []


def report_job(edges=(("a", "b"),), **step):
    j = job(edges=edges)
    j["steps"][1] = dict({"id": "b", "type": "saved_search", "saved_search_ref": "rep",
                          "read_previous": True}, **step)
    return j


def test_read_previous_rules():
    assert not [i for i in validate_job(report_job()) if i["level"] == "error"]
    assert "bad_shape" in codes(validate_job(report_job(read_previous="true")))
    assert "report_input_needs_one" in codes(validate_job(report_job(edges=())))
    three = job(steps=("a", "c", "b"), edges=[("a", "b"), ("c", "b")])
    three["steps"][2] = report_job()["steps"][1]
    assert "report_input_needs_one" in codes(validate_job(three))
    inline = job(edges=[("a", "b")])
    inline["steps"][1]["read_previous"] = True
    assert "bad_step" in codes(validate_job(inline))
    off = job(edges=())
    off["steps"][1] = {"id": "b", "type": "saved_search", "saved_search_ref": "rep",
                       "read_previous": False}
    assert "report_input_needs_one" not in codes(validate_job(off))


def test_same_two_steps_connected_twice_is_one_input():
    j = report_job(edges=[("a", "b"), ("a", "b")])
    assert "report_input_needs_one" not in codes(validate_job(j))


def test_report_input_warning():
    warned = lambda j: "report_input_may_be_missing" in codes(validate_job(j))  # noqa: E731
    assert not warned(report_job())
    failing = report_job()
    failing["edges"][0]["condition"] = "on_failure"
    assert warned(failing)
    skippable = report_job()
    skippable["steps"][0]["run_when"] = {"kind": "cron", "value": "0 0 1 * *"}
    assert warned(skippable)
