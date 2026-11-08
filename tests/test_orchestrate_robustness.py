"""``| orchestrate``: logic, performance and resilience.

test_orchestrate.py covers the happy paths. This file goes after what breaks: odd input,
replies that are not what the command expects, a server that fails mid-way, and call
counts that grow with the data. The real chunked protocol is driven through splunklib, so
what Splunk sees (configuration, rows, error messages) is tested and not only ``execute``.
"""
import csv
import io
import json
import re
import tempfile
import time

import pytest

import orchestrate
from so import scheduler, selftest, tokens
from so.gateway import GatewayError
from test_api import job_body
from test_orchestrate import Splunkd, TOKENS, run_cmd, saved  # noqa: F401
from test_api import World

KEY = "s3cr3t-session-key-0123456789"


@pytest.fixture
def w():
    world = World()
    world.splunkd = Splunkd(world)
    return world


def command_error(fn, *args, **kw):
    with pytest.raises(orchestrate.CommandError) as err:
        fn(*args, **kw)
    return str(err.value)


def active_runs(w):
    return [r for r in w.gw.kv.get("so_runs", {}).values() if r["state"] == "queued"]


class Recorder:
    """A gateway that records each call and answers from a function."""

    def __init__(self, answer):
        self.calls, self.answer = [], answer

    def orchestrator_api(self, method, path, body=None):
        self.calls.append((method, path, body))
        return self.answer(method, path, body)


def one_run(run_id):
    return {"id": run_id, "job_id": "j", "state": "succeeded", "steps": {},
            "definition": {"steps": []}}


class Faulty(Recorder):
    """Lists ``n`` runs and fails the fetch of the run named ``bad``."""

    def __init__(self, n, bad, status, payload):
        def answer(method, path, body):
            if path == "runs":
                return 200, {"runs": [{"id": "j:%d" % i} for i in range(n)]}
            if path == "runs/" + bad:
                return status, payload
            return 200, {"run": one_run(path[len("runs/"):])}
        Recorder.__init__(self, answer)


# Logic: argument parsing.

@pytest.mark.parametrize("argv,expected", [
    (["jobs"], ("jobs", {}, {})),
    (["status", "limit=3"], ("status", {"limit": "3"}, {})),
    (["start", "job=a", "param.x="], ("start", {"job": "a"}, {"x": ""})),
    (["start", "job=a", "param.x=a=b=c"], ("start", {"job": "a"}, {"x": "a=b=c"})),
    (["start", "job=a", 'param.x="a b"'], ("start", {"job": "a"}, {"x": "a b"})),
    (["start", "job=a", r'param.x="a\"b"'], ("start", {"job": "a"}, {"x": 'a"b'})),
    (["start", "job=a", 'param.x=""'], ("start", {"job": "a"}, {"x": ""})),
    (["start", "job=a", 'param.x="'], ("start", {"job": "a"}, {"x": '"'})),
    (["start", "job=a", "param.a.b=1"], ("start", {"job": "a"}, {"a.b": "1"})),
    (["cancel", 'run="r:1"'], ("cancel", {"run": "r:1"}, {})),
])
def test_parse_accepts(argv, expected):
    assert orchestrate.parse_args(argv) == expected


@pytest.mark.parametrize("argv,needle", [
    ([], "first argument"),
    (["START", "job=a"], "first argument"),
    (["job=a"], "first argument"),
    (["start"], "job is required"),
    (["start", "job="], "job is required"),
    (['start', 'job=""'], "job is required"),
    (["start", "job=a", "x"], "expected name=value"),
    (["start", "job=a", "=x"], "expected name=value"),
    (["start", "job=a", "param.=x"], "unknown argument"),
    (["status", "param.x=1"], "unknown argument"),
    (["jobs", "limit=1"], "unknown argument"),
    (["cancel"], "run is required"),
    (["rerun", "run=a"], "step is required"),
    (["rerun", "step=a"], "run is required"),
])
def test_parse_rejects(argv, needle):
    assert needle in command_error(orchestrate.parse_args, argv)


def test_repeated_option_is_refused():
    command_error(orchestrate.parse_args, ["cancel", "run=j:1", "run=j:2"])


@pytest.mark.parametrize("line", ['status run=""', 'status job=""', 'selftest scenario=""'])
def test_empty_selector_is_refused(line):
    command_error(orchestrate.parse_args, line.split())


@pytest.mark.parametrize("limit,expected", [("0", 1), ("-5", 1), ("1", 1), ("20", 20),
                                            ("21", 20), ("99999", 20)])
def test_status_limit_is_clamped(limit, expected):
    gw = Recorder(lambda m, p, b: (200, {"runs": []}))
    orchestrate.execute(["status", "limit=" + limit], gw)
    assert gw.calls[0][2]["limit"] == expected


@pytest.mark.parametrize("limit", ["abc", "1.5", "1e3", " "])
def test_status_limit_must_be_a_whole_number(limit):
    gw = Recorder(lambda m, p, b: (200, {"runs": []}))
    assert "limit must be a number" in command_error(orchestrate.execute,
                                                     ["status", "limit=" + limit], gw)
    assert gw.calls == []


# Logic: identifiers reach a URL path.

@pytest.mark.parametrize("argv", [["status", "run=../settings"], ["status", "run=a/b"],
                                  ["status", "run=../../server/info"],
                                  ["cancel", "run=../jobs/x"], ["rerun", "run=a/b", "step=s"],
                                  ["start", "job=../jobs/x"]])
def test_ids_with_path_separators_never_reach_the_server(argv):
    gw = Recorder(lambda m, p, b: (404, {"error": {"code": "not_found", "message": "no"}}))
    with pytest.raises(orchestrate.CommandError):
        orchestrate.execute(argv, gw)
    assert gw.calls == []


# Logic: start.

def test_start_validates_parameters_before_creating_a_run(w):
    saved(w)
    for bad in ("param.p=abc", "param.p=1e5x"):
        assert "bad_param" in command_error(run_cmd, w, "start job=daily %s" % bad)
    assert not w.gw.kv.get("so_runs")


def test_start_uses_the_declared_default(w):
    saved(w)
    run_id = run_cmd(w, "start job=daily")[0]["run_id"]
    assert w.store.get_run(run_id)["params"] == {"p": "1"}


def test_start_refuses_an_undeclared_parameter(w):
    saved(w)
    command_error(run_cmd, w, "start job=daily param.typo=7")
    assert not w.gw.kv.get("so_runs")


def test_start_refuses_a_disabled_job(w):
    saved(w, body=job_body(enabled=False))
    assert "job_disabled" in command_error(run_cmd, w, "start job=daily")


def test_start_on_unknown_job_says_not_found(w):
    assert "not_found" in command_error(run_cmd, w, "start job=nope")


@pytest.mark.parametrize("value", ["abc", "-1", "nan", "true"])
def test_start_refuses_a_bad_scheduled_time(w, value):
    saved(w)
    assert "scheduled_time must be epoch seconds" in command_error(
        run_cmd, w, "start job=daily scheduled_time=%s" % value)
    assert not w.gw.kv.get("so_runs")


def test_start_scheduled_time_infinity_is_a_bad_request(w):
    saved(w)
    assert "scheduled_time must be epoch seconds" in command_error(
        run_cmd, w, "start job=daily scheduled_time=inf")


@pytest.mark.parametrize("value", ["1e300", "253402300800000"])
def test_start_refuses_an_impossible_scheduled_time(w, value):
    saved(w)
    command_error(run_cmd, w, "start job=daily scheduled_time=%s" % value)
    assert not w.gw.kv.get("so_runs")


def test_parameter_values_are_escaped_when_dispatched(w):
    spl = '| makeresults | eval p="$run.param.p$"'
    body = job_body(params=[{"name": "p", "type": "string", "default": "d"}],
                    steps=[{"id": "a", "type": "inline", "spl": spl}], edges=[])
    saved(w, body=body)
    evil = 'x" | delete | eval a="'
    run_id = orchestrate.execute(
        ["start", "job=daily", "param.p=" + evil],
        w.splunkd.gateway("https://127.0.0.1:8089", "tok-alice"))[0]["run_id"]
    assert w.store.get_run(run_id)["params"]["p"] == evil
    w.engine_tick()
    sent = list(w.gw.dispatch_log[-1]["args"].values())
    assert tokens.escape_spl_string(evil) in sent and evil not in sent


def test_queue_cap_is_enforced(w):
    saved(w)
    for _ in range(scheduler.QUEUE_CAP):
        run_cmd(w, "start job=daily")
    before = len(w.gw.kv["so_runs"])
    assert "queue_full" in command_error(run_cmd, w, "start job=daily")
    assert len(w.gw.kv["so_runs"]) == before == scheduler.QUEUE_CAP


def test_queue_cap_holds_under_a_concurrent_start(w):
    saved(w)
    for _ in range(scheduler.QUEUE_CAP - 1):
        run_cmd(w, "start job=daily")
    original, raced = w.gw.kv_query, []

    def racing(collection, query=None, **kw):
        out = original(collection, query, **kw)
        if collection == "so_runs" and (query or {}).get("state") and not raced:
            raced.append(1)  # another search starts the job right after this one counted
            run_cmd(w, "start job=daily")
        return out

    w.gw.kv_query = racing
    try:
        run_cmd(w, "start job=daily")
    except orchestrate.CommandError:
        pass
    w.gw.kv_query = original
    assert len(w.gw.kv["so_runs"]) <= scheduler.QUEUE_CAP


# Logic: status.

def test_status_of_unknown_job_is_empty_and_of_unknown_run_is_an_error(w):
    assert run_cmd(w, "status job=nope") == []
    assert "not_found" in command_error(run_cmd, w, "status run=nope:1")


@pytest.mark.parametrize("run", [
    {"id": "r:1"},
    {"id": "r:1", "steps": None, "definition": None},
    {"_key": "r:1", "steps": {"x": None}},
    {"id": "r:1", "steps": {"a": {}, "b": {}},
     "definition": {"steps": [{"id": "a"}, {"id": "b"}],
                    "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "a"}]}},
])
def test_status_rows_survive_a_damaged_run_document(run):
    rows = orchestrate.status_rows(run)
    assert rows[0]["step"] == orchestrate.RUN_ROW and rows[0]["run_id"] == "r:1"
    assert all(list(r) == orchestrate.STATUS_FIELDS for r in rows)


def test_status_lists_steps_added_by_a_later_definition_last():
    run = {"id": "r:1", "steps": {"a": {}, "new": {}, "b": {}},
           "definition": {"steps": [{"id": "a"}, {"id": "b"}],
                          "edges": [{"from": "a", "to": "b"}]}}
    assert [r["step"] for r in orchestrate.status_rows(run)] == ["(run)", "a", "b", "new"]


# Logic: cancel and rerun.

def finish(w, run_id, state):
    run = w.store.get_run(run_id)
    run.update(state=state, ended_at=w.now)
    w.store.save_run(run)


@pytest.mark.parametrize("state", ["succeeded", "failed", "cancelled"])
def test_cancel_of_a_finished_run_is_refused(w, state):
    saved(w)
    run_id = run_cmd(w, "start job=daily")[0]["run_id"]
    finish(w, run_id, state)
    assert "invalid_state" in command_error(run_cmd, w, "cancel run=%s" % run_id)
    assert not w.gw.kv.get("so_commands")


def test_cancelling_twice_ends_the_run_once(w):
    saved(w)
    run_id = run_cmd(w, "start job=daily")[0]["run_id"]
    run_cmd(w, "cancel run=%s" % run_id)
    run_cmd(w, "cancel run=%s" % run_id)
    w.engine_tick()
    assert w.store.get_run(run_id)["state"] == "cancelled"
    assert not w.gw.kv.get("so_commands")


def test_rerun_of_a_running_run_is_refused(w):
    saved(w)
    run_id = run_cmd(w, "start job=daily")[0]["run_id"]
    w.engine_tick()
    assert "invalid_state" in command_error(run_cmd, w, "rerun run=%s step=a" % run_id)
    assert not w.gw.kv.get("so_commands")


@pytest.mark.parametrize("extra,code", [("step=nope", "unknown_step"),
                                        ("step=a definition=bogus", "bad_request")])
def test_rerun_refuses_a_bad_step_or_definition(w, extra, code):
    saved(w)
    run_id = run_cmd(w, "start job=daily")[0]["run_id"]
    finish(w, run_id, "failed")
    assert code in command_error(run_cmd, w, "rerun run=%s %s" % (run_id, extra))
    assert not w.gw.kv.get("so_commands")


def test_rerun_bad_boolean_sends_nothing():
    gw = Recorder(lambda m, p, b: (202, {}))
    message = command_error(orchestrate.execute,
                            ["rerun", "run=r:1", "step=a", "restart_downstream_jobs=maybe"], gw)
    assert "must be true or false" in message and gw.calls == []


def test_two_quick_reruns_restart_the_run_once(w):
    saved(w)
    run_id = run_cmd(w, "start job=daily")[0]["run_id"]
    w.engine_tick()
    finish(w, run_id, "failed")
    run_cmd(w, "rerun run=%s step=a" % run_id)
    run_cmd(w, "rerun run=%s step=a" % run_id)
    w.engine_tick()
    assert w.store.get_run(run_id)["rerun_count"] == 1
    assert not w.gw.kv.get("so_commands")


# Logic: who may do what.

def test_a_run_you_cannot_see_looks_like_one_that_does_not_exist(w):
    saved(w, body=job_body(run_roles=[]))
    run_id = run_cmd(w, "start job=daily")[0]["run_id"]
    hidden = command_error(run_cmd, w, "status run=%s" % run_id, token="tok-dave")
    absent = command_error(run_cmd, w, "status run=daily:manual:0", token="tok-dave")
    assert hidden.replace(run_id, "X") == absent.replace("daily:manual:0", "X")


@pytest.mark.parametrize("line", ["status", "status job=daily", "status limit=20", "jobs"])
def test_listing_shows_nothing_of_a_job_you_cannot_see(w, line):
    saved(w, body=job_body(run_roles=[]))
    run_cmd(w, "start job=daily")
    assert run_cmd(w, line, token="tok-dave") == []


@pytest.mark.parametrize("line", ["selftest", "selftest scenario=probe",
                                  "selftest scenario=rollup_late slow_n=1"])
def test_selftest_needs_admin_and_changes_nothing_when_refused(w, line):
    assert "forbidden" in command_error(run_cmd, w, line, token="tok-alice")
    assert not w.gw.kv.get("so_jobs") and not w.gw.kv.get("so_runs")


@pytest.mark.parametrize("option,value", [("slow_n", "0"), ("slow_n", "100001"),
                                          ("slow_n", "abc"), ("delayed_after", "0"),
                                          ("delayed_after", "86401")])
def test_selftest_bounds_are_checked_before_anything_is_saved(w, option, value):
    line = "selftest scenario=rollup_late %s=%s" % (option, value)
    assert "bad_request" in command_error(run_cmd, w, line, token="tok-root")
    assert not w.gw.kv.get("so_jobs") and not w.gw.kv.get("so_runs")


# Resilience: replies the command does not expect.

def test_status_skips_a_run_that_vanished_while_listing():
    gw = Faulty(3, "j:1", 404, {"error": {"code": "not_found", "message": "no run"}})
    rows = orchestrate.execute(["status"], gw)
    assert sorted({r["run_id"] for r in rows}) == ["j:0", "j:2"]


def test_status_fails_with_a_clear_message_when_a_fetch_errors():
    gw = Faulty(3, "j:1", 502, {"error": {"code": "splunk_error", "message": "KV down"}})
    assert "KV down (splunk_error)" in command_error(orchestrate.execute, ["status"], gw)


@pytest.mark.parametrize("status,payload", [
    (500, {"error": "boom"}), (500, ["boom"]), (500, "boom"),
    (409, {"error": {"code": "x", "issues": ["text"]}}),
    (409, {"error": {"code": "x", "choices": ["latest"]}}),
])
def test_check_reports_any_error_body(status, payload):
    command_error(orchestrate._check, status, payload)


@pytest.mark.parametrize("line", ["start job=a", "status run=r:1", "status", "jobs"])
def test_a_success_without_the_expected_field_is_a_clear_error(line):
    gw = Recorder(lambda m, p, b: (200, {}))
    command_error(orchestrate.execute, line.split(), gw)


@pytest.mark.parametrize("line", ["jobs", "status", "status run=r:1", "start job=a",
                                  "cancel run=r:1", "rerun run=r:1 step=a"])
def test_a_server_that_is_down_is_reported_as_an_error(w, line):
    w.gw.kv_down = True
    message = command_error(run_cmd, w, line)
    assert "Traceback" not in message and "tok-" not in message


def test_status_with_kv_store_back_works_again(w):
    saved(w)
    run_id = run_cmd(w, "start job=daily")[0]["run_id"]
    w.gw.kv_down = True
    command_error(run_cmd, w, "status run=%s" % run_id)
    w.gw.kv_down = False
    assert run_cmd(w, "status run=%s" % run_id)[0]["run_id"] == run_id


def test_a_far_future_run_does_not_stall_other_jobs(w):
    saved(w)
    saved(w, body=job_body("other"))
    far = run_cmd(w, "start job=daily scheduled_time=99999999999")[0]["run_id"]
    other = run_cmd(w, "start job=other")[0]["run_id"]
    w.engine_tick()
    assert w.store.get_run(other)["state"] == "running"
    assert w.store.get_run(far)["state"] in ("queued", "running", "failed")


# Resilience: the probe against the loopback timeout.

class Stuck:
    """A server whose searches never finish and that never lists them."""

    def __init__(self):
        self.gw = World().gw

    def __getattr__(self, name):
        return getattr(self.gw, name)

    def dispatch(self, *a, **kw):
        return "sid"

    def history(self, *a, **kw):
        return []

    def job_status(self, sid):
        return {"state": "running"}

    def first_row(self, sid):
        return None

    def control(self, sid, action, **kw):
        pass

    def search_oneshot(self, *a, **kw):
        return []

    def preview_dispatch(self, *a, **kw):
        return "so_preview_x"

    def preview_info(self, sid):
        return {"state": "running"}

    def preview_results(self, sid, count):
        return {"rows": []}


def test_probe_fits_inside_the_loopback_timeout():
    gw = Stuck()
    slept = []
    job = dict(selftest.definition(), id="so_selftest", owner="root")
    job["steps"][0]["hidden_search"] = "_so_x"
    clock = iter(range(10 ** 6))
    checks = selftest.probe("root", gw, gw, lambda e: None, job, clock=lambda: next(clock),
                            sleep=slept.append)
    assert len(checks) == 13
    assert sum(slept) < 60


# Resilience and configuration: the real chunked protocol.

def chunk(meta, body=""):
    text = json.dumps(meta)
    return ("chunked 1.0,%d,%d\n%s%s" % (len(text), len(body), text, body)).encode()


def speak(args, gateway, monkeypatch, maxresultrows=50000, preview=False):
    """One whole conversation with the command. Returns (getinfo reply, chunks)."""
    info = {"args": args, "raw_args": args, "dispatch_dir": tempfile.gettempdir(), "sid": "1.1", "app": "a",
            "owner": "alice", "username": "alice", "splunk_version": "10.6.1", "splunkd_uri": "https://127.0.0.1:8089",
            "session_key": KEY, "command": "orchestrate", "maxresultrows": maxresultrows,
            "earliest_time": "0", "latest_time": "0", "search": "%7C%20orchestrate"}
    built = []
    monkeypatch.setattr(tempfile, "tempdir", tempfile.gettempdir())  # splunklib replaces it

    def from_session(uri, key, timeout=60):
        built.append(key)
        if isinstance(gateway, Exception):
            raise gateway
        return gateway

    monkeypatch.setattr(orchestrate.SplunkGateway, "from_session", staticmethod(from_session))
    stream = chunk({"action": "getinfo", "preview": preview, "searchinfo": info})
    for _ in range(30):  # splunkd keeps asking while finished is false
        stream += chunk({"action": "execute", "finished": False})
    out = io.BytesIO()
    command = orchestrate.OrchestrateCommand()
    command.process(["orchestrate"], io.BytesIO(stream), out)
    assert built == [KEY]
    return parse_chunks(out.getvalue())


def parse_chunks(raw):
    chunks = []
    stream = io.BytesIO(raw)
    while True:
        header = stream.readline()
        if not header:
            return chunks[0][0], chunks[1:]
        match = re.match(rb"chunked 1\.0,(\d+),(\d+)", header)
        meta = json.loads(stream.read(int(match.group(1))))
        body = stream.read(int(match.group(2))).decode()
        chunks.append((meta, list(csv.DictReader(io.StringIO(body))) if body else []))


def messages(chunks):
    return [tuple(m) for meta, _ in chunks for m in meta.get("inspector", {}).get("messages", [])]


def rows_of(chunks):
    return [{k: v for k, v in row.items() if not k.startswith("__mv_")}
            for _, rows in chunks for row in rows]


def test_protocol_configuration_is_a_search_head_generator(monkeypatch):
    info, _ = speak(["jobs"], Recorder(lambda m, p, b: (200, {"jobs": []})), monkeypatch)
    assert info["generating"] is True and info["type"] == "reporting"
    assert info.get("distributed") in (None, False)


def test_protocol_passes_every_argument_through(monkeypatch):
    gw = Recorder(lambda m, p, b: (201, {"run_id": "a:manual:1"}))
    _, chunks = speak(["start", "job=a", "param.region=eu west", "scheduled_time=5"], gw,
                      monkeypatch)
    assert gw.calls == [("POST", "jobs/a/runs", {"params": {"region": "eu west"},
                                                 "strict_params": True,
                                                 "scheduled_time": "5"})]
    assert rows_of(chunks) == [{"ok": "1", "job": "a", "run_id": "a:manual:1"}]


def test_protocol_starts_a_run_once_however_many_chunks_splunk_asks_for(monkeypatch):
    gw = Recorder(lambda m, p, b: (201, {"run_id": "a:manual:1"}))
    _, chunks = speak(["start", "job=a"], gw, monkeypatch, maxresultrows=1)
    assert len(gw.calls) == 1 and len(rows_of(chunks)) == 1


def test_protocol_does_not_run_in_preview(monkeypatch):
    info, _ = speak(["jobs"], Recorder(lambda m, p, b: (200, {"jobs": []})), monkeypatch)
    assert info.get("run_in_preview") is False


def test_protocol_delivers_every_row_across_chunks_once(monkeypatch):
    run = dict(one_run("r:1"), steps={"s%d" % i: {} for i in range(250)})
    gw = Recorder(lambda m, p, b: (200, {"run": run}))
    _, chunks = speak(["status", "run=r:1"], gw, monkeypatch, maxresultrows=100)
    rows = rows_of(chunks)
    assert len(rows) == 251 and len({r["step"] for r in rows}) == 251
    assert len(gw.calls) == 1


def test_protocol_reports_a_command_error_as_an_error_message(monkeypatch):
    _, chunks = speak(["nonsense"], Recorder(lambda m, p, b: (200, {})), monkeypatch)
    assert any(kind == "ERROR" and "first argument" in text for kind, text in messages(chunks))
    assert rows_of(chunks) == []


def test_protocol_keeps_braces_in_an_error_from_the_server(monkeypatch):
    body = 'HTTP 503: {"messages": [{"type": "ERROR", "text": "{0} {x}"}]}'
    gw = Recorder(lambda m, p, b: (503, {"error": {"code": "bad_response", "message": body}}))
    _, chunks = speak(["jobs"], gw, monkeypatch)
    assert any(body in text for _, text in messages(chunks))


@pytest.mark.parametrize("error", [
    GatewayError("connection error: Splunk %s refused" % KEY, transient=True),
    RuntimeError("bad session_key=%s here" % KEY),
    ValueError("Authorization: Splunk %s" % KEY),
])
def test_protocol_never_shows_the_session_key(monkeypatch, error):
    def fail(m, p, b):
        raise error
    _, chunks = speak(["jobs"], Recorder(fail), monkeypatch)
    texts = [text for _, text in messages(chunks)]
    assert texts and all(KEY not in text for text in texts)
    assert all("Traceback" not in text for text in texts)


def test_protocol_reports_a_failure_to_build_the_gateway(monkeypatch):
    _, chunks = speak(["jobs"], GatewayError("refusing non-loopback splunkd host"), monkeypatch)
    assert any("refusing non-loopback" in text for _, text in messages(chunks))


# Performance. Budgets count calls, which do not depend on the machine; the wall-clock
# limits are generous and only catch work that grows much faster than it should.

class Counting:
    """Counts the fake server's KV calls."""

    def __init__(self, w):
        self.w, self.calls = w, 0
        original = w.gw.kv_query, w.gw.kv_get

        def query(*a, **kw):
            self.calls += 1
            return original[0](*a, **kw)

        def get(*a, **kw):
            self.calls += 1
            return original[1](*a, **kw)

        w.gw.kv_query, w.gw.kv_get = query, get


def chain(n):
    ids = ["s%d" % i for i in range(n)]
    return job_body(steps=[{"id": i, "type": "inline", "spl": "| makeresults"} for i in ids],
                    edges=[{"from": a, "to": b} for a, b in zip(ids, ids[1:])], params=[])


def timed(fn):
    start = time.perf_counter()
    out = fn()
    return out, time.perf_counter() - start


def test_perf_parser_is_linear_in_the_number_of_arguments():
    argv = ["start", "job=a"] + ["param.p%d=%s" % (i, "x" * 200) for i in range(20000)]
    (_, _, params), seconds = timed(lambda: orchestrate.parse_args(argv))
    print("\nPERF parse_args 20000 params: %.3fs" % seconds)
    assert len(params) == 20000 and seconds < 2


def test_perf_status_of_one_run_makes_a_fixed_number_of_kv_calls(w):
    saved(w, body=chain(5))
    run_id = run_cmd(w, "start job=daily")[0]["run_id"]
    counter = Counting(w)
    run_cmd(w, "status run=%s" % run_id)
    small = counter.calls
    saved_big = job_body("big", steps=chain(120)["steps"], edges=chain(120)["edges"], params=[])
    saved(w, body=saved_big)
    big_id = run_cmd(w, "start job=big")[0]["run_id"]
    counter.calls = 0
    run_cmd(w, "status run=%s" % big_id)
    print("\nPERF status run: kv calls 5 steps=%d, 120 steps=%d" % (small, counter.calls))
    assert counter.calls == small


def test_perf_status_at_the_row_limit_stays_fast(w):
    body = chain(300)
    saved(w, body=body)
    for _ in range(scheduler.QUEUE_CAP):
        run_cmd(w, "start job=daily")
    rows, seconds = timed(lambda: run_cmd(w, "status limit=20"))
    print("\nPERF status limit=20 of 300-step runs: %d rows in %.2fs" % (len(rows), seconds))
    assert len(rows) == 20 * 301 and seconds < 20


def test_perf_jobs_does_not_query_once_per_job(w):
    for i in range(50):
        saved(w, body=job_body("job%d" % i))
    counter = Counting(w)
    assert len(run_cmd(w, "jobs")) == 50
    print("\nPERF jobs with 50 jobs: %d kv calls" % counter.calls)
    assert counter.calls <= 5


def test_perf_jobs_with_a_rare_cron_stays_fast(w):
    triggers = [{"type": "cron", "cron": "0 0 29 2 *", "enabled": True}]
    for i in range(50):
        saved(w, body=job_body("job%d" % i, triggers=triggers))
    rows, seconds = timed(lambda: run_cmd(w, "jobs"))
    print("\nPERF jobs, 50 jobs on a leap-day cron: %.2fs" % seconds)
    assert len(rows) == 50 and seconds < 20


def test_perf_status_call_count_is_bounded_by_its_limit():
    gw = Faulty(20, "none", 200, {})
    orchestrate.execute(["status", "limit=20"], gw)
    assert len(gw.calls) == 21


def test_status_stops_fetching_at_its_deadline_and_says_so(monkeypatch):
    now = [0]
    monkeypatch.setattr(orchestrate.time, "monotonic", lambda: now[0])

    class Slow(Faulty):
        def orchestrator_api(self, method, path, body=None):
            now[0] += 60  # each call takes as long as the loopback timeout allows
            return Faulty.orchestrator_api(self, method, path, body)

    warnings = []
    gw = Slow(20, "none", 200, {})
    rows = orchestrate.execute(["status", "limit=20"], gw, warn=warnings.append)
    assert len(gw.calls) == 2  # the list and one run, then 120 s are used up
    assert len({r["run_id"] for r in rows}) == 1
    assert len(warnings) == 1 and "stopped after 1 of 20 runs" in warnings[0]


def test_protocol_shows_a_status_deadline_as_a_warning(monkeypatch):
    now = [0]
    monkeypatch.setattr(orchestrate.time, "monotonic", lambda: now[0])

    def slow(method, path, body):
        now[0] += 200
        return 200, {"runs": [{"id": "j:1"}, {"id": "j:2"}]}

    _, chunks = speak(["status"], Recorder(slow), monkeypatch)
    assert any(kind == "WARN" and "stopped after 0 of 2" in text
               for kind, text in messages(chunks))
