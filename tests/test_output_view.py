"""View output route: POST preview/output."""
from so import preview
from so.output_view import TIDY
from test_api import T0, job_body, saved, start, w  # noqa: F401  (w is a fixture)

URL = "/orchestrator/preview/output"


def out_job(**over):
    steps = [{"id": "a", "type": "inline", "spl": "| makeresults", "earliest": "-1d", "latest": "now"},
             {"id": "lk", "type": "previous", "spl": "| outputlookup append=true my_lookup.csv",
              "output": {"kind": "lookup", "name": "my_lookup.csv", "append": True}},
             {"id": "si", "type": "previous", "spl": '| collect index=summary source="daily" marker="so_run=$run.id$"',
              "output": {"kind": "summary_index", "index": "summary", "source": "daily", "add_run_id": True},
              "actions": [{"hook": "on_success", "type": "event", "index": "main", "payload": "x"}]}]
    edges = [{"from": "a", "to": "lk"}, {"from": "a", "to": "si"}]
    return job_body("daily", params=[], steps=steps, edges=edges, **over)


def view(w, target, user="alice", **body):
    return w.call(user, "POST", URL, dict({"job": out_job(), "target": target}, **body))


def last_dispatch(w):
    return w.gw.preview_log[-1]


def test_lookup_reads_the_whole_lookup_without_a_time_range(w):
    status, out = view(w, {"step_id": "lk"})
    assert status == 201, out
    assert out["kind"] == "lookup" and out["spl"] == "| inputlookup my_lookup.csv"
    d = last_dispatch(w)
    assert d["user"] == "alice" and d["earliest"] is None and d["latest"] is None
    assert preview.own_sid(out["sid"], "alice", "daily", "lk")
    assert w.audit.of("output_viewed")[-1]["kind"] == "lookup"


def test_summary_index_uses_index_source_and_the_range(w):
    status, out = view(w, {"step_id": "si"}, range="7d")
    assert status == 201, out
    assert out["spl"] == 'index=summary source="daily"' + TIDY
    assert (last_dispatch(w)["earliest"], last_dispatch(w)["latest"]) == ("-7d", "now")


def test_event_and_email_actions(w):
    status, out = view(w, {"action": {"scope": "si", "index": 0}})
    assert status == 201 and out["kind"] == "event"
    # Not all of index=main: only this action's events (by its search, every version of it).
    assert out["spl"] == 'index=main source="_so_daily_action_1_*"' + TIDY
    status, out = view(w, {"action": {"scope": "job", "index": 0}})
    assert status == 201 and out["kind"] == "email"
    assert out["spl"].startswith('index=_internal source=*python.log* sendemail "ops@example.com"')
    assert preview.own_sid(out["sid"], "alice", "daily", "job")


def test_targets_without_output_are_400(w):
    assert view(w, {"step_id": "a"})[0] == 400
    assert view(w, {"step_id": "nope"})[0] == 400
    assert view(w, {"action": {"scope": "job", "index": 5}})[0] == 400
    assert view(w, {"step_id": "lk"}, range="1y")[0] == 400


def test_run_uses_its_definition_window_and_run_id(w):
    saved(w, body=out_job())
    run_id = start(w)
    run = w.store.get_run(run_id)
    run.update(started_at=T0 + 10, ended_at=T0 + 100)
    w.store.save_run(run)
    status, out = w.call("alice", "POST", URL, {"run_id": run_id, "target": {"step_id": "si"}})
    assert status == 201, out
    assert out["spl"] == 'index=summary source="daily" so_run="%s"' % run_id + TIDY
    assert (out["earliest"], out["latest"]) == (str(T0 + 10 - 60), str(T0 + 100 + 600))
    assert w.call("dave", "POST", URL, {"run_id": run_id, "target": {"step_id": "si"}})[0] == 404


def test_caller_who_may_not_edit_is_refused(w):
    saved(w, body=out_job())
    assert view(w, {"step_id": "lk"}, user="dave")[0] == 403


def test_event_action_of_a_run_shows_only_that_runs_events(w):
    saved(w, body=out_job())
    run_id = start(w)
    run = w.store.get_run(run_id)
    name = run["definition"]["steps"][2]["actions"][0].get("hidden_search")
    status, out = w.call("alice", "POST", URL, {"run_id": run_id,
                                                "target": {"action": {"scope": "si", "index": 0}}})
    assert status == 201, out
    head = out["spl"].split("\n")[0]
    assert head == 'index=main source="%s" (so_run="%s" OR "%s")' % (name, run_id, run_id)
    assert "| table _time *" in out["spl"] and "punct" in out["spl"]


def test_the_event_action_marks_each_event_with_its_run():
    from so import hidden
    spl = hidden.action_spl({"type": "event", "index": "main"})
    assert 'marker="so_run=$args.run_id$"' in spl
