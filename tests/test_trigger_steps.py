"""Triggers start only the steps they are connected to (``steps``); without ``steps`` a
trigger starts every step with no line into it, as before."""
from so import model, scheduler
from test_engine import T0, World, cron_run, make_job


def two_branches(triggers):
    """a -> a2 and b -> b2, merged into m; the triggers decide which branch starts."""
    return make_job(steps=["a", "a2", "b", "b2", {"id": "m", "type": "previous", "spl": "| stats count"}],
                    edges=[("a", "a2"), ("b", "b2"), ("a2", "m"), ("b2", "m")], cron=None,
                    triggers=triggers)


def settle(w, n=8):
    for _ in range(n):
        w.tick(advance=5)


def test_a_schedule_starts_only_its_steps_and_their_branch():
    w = World()
    j = w.add_job(two_branches([{"type": "cron", "cron": "0 1 * * *", "steps": ["a"]},
                                {"type": "cron", "cron": "0 2 * * *", "steps": ["b"]}]))
    r = cron_run(w, j)
    settle(w)
    assert w.run(r)["entry_steps"] == ["a"]
    assert w.step(r, "a")["state"] == "succeeded" and w.step(r, "a2")["state"] == "succeeded"
    assert (w.step(r, "b")["state"], w.step(r, "b")["skip_kind"]) == ("skipped", "not_started")
    assert (w.step(r, "b2")["state"], w.step(r, "b2")["skip_kind"]) == ("skipped", "not_taken")
    assert w.step(r, "m")["state"] == "succeeded"  # one of its inputs ran
    assert not w.dispatched("b") and not w.dispatched("b2")


def test_schedules_firing_at_once_start_the_union():
    j = two_branches([{"type": "cron", "cron": "0 1 * * *", "steps": ["a"]},
                      {"type": "cron", "cron": "0 1 * * *", "steps": ["b"]}])
    assert scheduler.cron_entry(j, T0) == ["a", "b"]


def test_a_trigger_without_steps_starts_everything():
    j = two_branches([{"type": "cron", "cron": "0 1 * * *", "steps": ["a"]},
                      {"type": "cron", "cron": "0 1 * * *"}])
    assert scheduler.cron_entry(j, T0) is None
    w = World()
    w.add_job(make_job())
    r = cron_run(w, make_job())
    assert w.run(r)["entry_steps"] is None


def test_an_always_line_from_a_branch_that_was_not_started_runs_nothing():
    w = World()
    j = w.add_job(make_job(steps=["a", "b", "c"], edges=[("b", "c", "always")], cron=None,
                           triggers=[{"type": "cron", "cron": "0 1 * * *", "steps": ["a"]}]))
    r = cron_run(w, j)
    settle(w)
    assert w.step(r, "c")["state"] == "skipped"
    assert not w.dispatched("c")


def test_completion_trigger_starts_its_steps():
    j = two_branches([{"type": "completion", "job": "up", "on": "success", "steps": ["b"]}])
    assert scheduler.entry_of(j["triggers"]) == ["b"]


def codes(job):
    return [(i["level"], i["code"]) for i in model.validate_job(job)]


def test_validation():
    j = two_branches([{"type": "cron", "cron": "0 1 * * *", "steps": ["a", "nope"]}])
    assert ("error", "bad_trigger") in codes(j)
    j = two_branches([{"type": "cron", "cron": "0 1 * * *", "steps": ["a2"]}])
    assert ("error", "bad_trigger") in codes(j)  # a line already leads into a2
    j = two_branches([{"type": "cron", "cron": "0 1 * * *", "steps": []}])
    assert ("warning", "trigger_starts_nothing") in codes(j)
    j = two_branches([{"type": "cron", "cron": "0 1 * * *", "steps": ["a"]}])
    issues = model.validate_job(j)
    assert [i["step"] for i in issues if i["code"] == "step_not_started"] == ["b"]
    assert not [i for i in issues if i["level"] == "error"]
