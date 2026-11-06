import hashlib

import pytest

from so import preview


def test_default_preview_time():
    assert preview.default_time({"triggers": []}, 1_800_000_000) == 1_800_000_000
    job = {"triggers": [{"type": "cron", "cron": "0 1 * * *", "enabled": True}]}
    t = preview.default_time(job, 1_800_000_000)
    assert t < 1_800_000_000 and 1_800_000_000 - t <= 86400
    never = {"triggers": [{"type": "cron", "cron": "0 1 30 2 *", "enabled": True}]}
    assert preview.default_time(never, 1_800_000_000) == 1_800_000_000


def test_default_time_uses_latest_enabled_trigger_and_timezone():
    now = 1_800_000_000  # 2027-01-15 08:00 UTC
    job = {"timezone": "UTC", "triggers": [
        {"type": "cron", "cron": "0 1 * * *"},                    # no "enabled": counts
        {"type": "cron", "cron": "0 7 * * *", "enabled": True},
        {"type": "cron", "cron": "30 7 * * *", "enabled": False},  # ignored
        {"type": "chained", "after": "x"}]}
    assert preview.default_time(job, now) == now - 3600
    assert preview.default_time({"triggers": [{"type": "cron", "cron": "30 7 * * *",
                                               "enabled": False}]}, now) == now
    assert preview.default_time({}, now) == now


def test_preview_sid_ownership():
    sid = preview.make_sid("alice", "j1", "daily", "abc")
    assert preview.own_preview({"owner": "alice"}, sid, "alice", "j1")
    assert not preview.own_preview({"owner": "bob"}, sid, "alice", "j1")
    assert not preview.own_preview({"owner": "alice"}, sid, "alice", "j2")
    assert not preview.own_preview({"owner": "alice"}, "scheduler__x", "alice", "j1")


def test_make_sid_shape_and_other_user():
    sid = preview.make_sid("alice", "new", "daily", "abc")
    h = hashlib.sha1(b"alice").hexdigest()[:8]
    assert sid == "so_preview_%s.new.daily.abc" % h
    assert sid.startswith(preview.PREFIX)
    assert not preview.own_preview({"owner": "alice"}, preview.make_sid("bob", "new", "d", "x"),
                                   "alice", "new")
    assert not preview.own_preview({"owner": "alice"}, sid, "alice", "ne")
    assert (preview.MAX_RUNTIME, preview.TABLE_ROWS, preview.TTL) == (600, 100, 1800)


def test_own_preview_binds_one_job_and_step():
    alice = {"owner": "alice"}
    for other in ("j_1", "j_a", "j-1"):
        assert not preview.own_preview(alice, preview.make_sid("alice", other, "s", "r1"),
                                       "alice", "j")
    sid = preview.make_sid("alice", "j", "s_1", "r1")
    assert preview.own_preview(alice, sid, "alice", "j")
    assert preview.own_preview(alice, sid, "alice", "j", step_id="s_1")
    assert not preview.own_preview(alice, sid, "alice", "j", step_id="s")
    assert not preview.own_preview(alice, sid + ".x", "alice", "j")       # 5 parts
    assert not preview.own_preview(alice, sid + " ", "alice", "j")        # bad sid char
    assert not preview.own_preview(alice, sid.replace(".r1", ".r-1"), "alice", "j")  # bad rand
    assert not preview.own_preview(alice, sid.replace(".s_1.", ".S1."), "alice", "j")  # bad step
    assert not preview.own_preview(alice, None, "alice", "j")


def test_make_sid_validates_parts():
    for args in (("alice", "j.1", "s", "r"), ("alice", "", "s", "r"),
                 ("alice", "j", "s.x", "r"), ("alice", "j", "a__b", "r"),
                 ("alice", "j", "s", "r.1"), ("alice", "j", "s", ""),
                 ("alice", "j", "s", "x" * 33)):
        with pytest.raises(ValueError):
            preview.make_sid(*args)


def test_closure_includes_token_sources():
    job = {"steps": [{"id": i, "type": "inline", "spl": s} for i, s in
                     [("a", "x"), ("b", "| loadjob $a.sid$"), ("c", '| eval n="$b.resultCount$"'),
                      ("z", "y")]], "edges": [{"from": "a", "to": "b"}]}
    assert preview.closure(job, "c") == ["a", "b"]


def test_closure_edges_previous_tokens_and_order():
    job = {"steps": [{"id": "p", "type": "previous", "spl": '| eval x="$q.sid$"'},
                     {"id": "q", "type": "inline", "spl": "x"},
                     {"id": "m", "type": "inline", "spl": "x"},
                     {"id": "r", "type": "inline", "spl": '| eval y="$run.id$ $r.sid$"'},
                     {"id": "n", "type": "inline", "spl": "x"}],
           "edges": [{"from": "m", "to": "p"}, {"from": "n", "to": "m"}, {"from": "r", "to": "q"}]}
    assert preview.closure(job, "p") == ["r", "q", "n", "m"]
    assert preview.closure(job, "n") == []
    assert preview.closure(job, "r") == []


def test_own_sid_is_static():
    sid = preview.make_sid("alice", "j", "s_1", "r1")
    assert preview.own_sid(sid, "alice", "j")
    assert preview.own_sid(sid, "alice", "j", "s_1")
    assert not preview.own_sid(sid, "bob", "j")
    assert not preview.own_sid(sid, "alice", "k")
    assert not preview.own_sid(sid, "alice", "j", "s_2")
    assert not preview.own_sid("x", "alice", "j") and not preview.own_sid(None, "alice", "j")
    assert not preview.own_preview({"owner": "bob"}, sid, "alice", "j")


def test_job_ref_pattern_is_the_job_id_pattern():
    import itertools
    import re

    from so import api, model
    assert preview.JOB_REF_RE is model.JOB_ID_RE and api.JOB_ID_RE is model.JOB_ID_RE
    first = "aZ09"
    rest = "aZ09_-"
    valid = ["new", "a", "Z", "0", "a" * 64, "0-_", "daily_summary-2"]
    valid += [f + "".join(r) for f in first for r in itertools.product(rest, repeat=2)]
    for job_id in valid:
        assert api._is_job_id(job_id), job_id
        sid = preview.make_sid("alice", job_id, "a", "r1")
        assert preview.parts(sid)[1] == job_id
    for bad in ("", "_a", "-a", "a" * 65, "a.b", "a b", "a/b"):
        assert not model.JOB_ID_RE.fullmatch(bad)
        with pytest.raises(ValueError):
            preview.make_sid("alice", bad, "a", "r1")
    assert re.compile(model.JOB_ID_RE.pattern).fullmatch("new")
