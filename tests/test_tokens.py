import pytest

from so.tokens import (TokenError, compile_spl, escape_spl_string, find_tokens,
                       render_args, token_defaults, validate_param)


def ctx_zero_rows(step):
    return {"run": {"id": "r1", "scheduled_time": 1, "params": {}},
            "steps": {step: {"status": "succeeded", "sid": "9", "resultCount": 0, "first": None}}}


def test_literal_dollar_untouched():
    s = '| rex "foo$" | eval x="$unknown$"'
    assert compile_spl(s, {"daily"})[0] == s


def test_known_token_compiled():
    assert compile_spl('| loadjob $daily.sid$', {"daily"}) == ('| loadjob $args.daily__sid$', ["daily__sid"])


def test_default_stripped_and_extracted():
    spl, names = compile_spl('$a.sid|x$ $a.sid$', {"a"})
    assert spl == "$args.a__sid$ $args.a__sid$" and names == ["a__sid"]
    assert token_defaults("$a.sid|x y$ $a.status$", {"a"}) == {"a__sid": "x y"}
    assert token_defaults("$a.sid|$", {"a"}) == {"a__sid": ""}


def test_all_token_kinds():
    spl = "$run.id$ $run.scheduled_time$ $run.param.region$ $s.sid$ $s.resultCount$ $s.status$ $s.first.host_1$ $s.first$ $s.nope$"
    assert find_tokens(spl, {"s"}) == {"run.id", "run.scheduled_time", "run.param.region",
                                       "s.sid", "s.resultCount", "s.status", "s.first.host_1"}
    assert compile_spl("$run.param.region$ $s.first.host$", {"s"})[1] == ["run__param__region", "s__first__host"]


def test_token_default_used_when_missing():
    spl, names = compile_spl('$weekly.sid|none$', {"weekly"})
    c = {"run": {}, "steps": {"weekly": {"status": "skipped"}}}
    assert render_args(names, c, {"weekly__sid": "none"})["weekly__sid"] == "none"


def test_skipped_step_without_default_raises():
    c = {"run": {}, "steps": {"weekly": {"status": "skipped"}}}
    with pytest.raises(TokenError, match="skipped"):
        render_args(["weekly__sid"], c)


def test_first_field_zero_rows_raises():
    with pytest.raises(TokenError, match="no result rows"):
        render_args(["s__first__host"], ctx=ctx_zero_rows("s"))
    assert render_args(["s__first__host"], ctx_zero_rows("s"), {"s__first__host": "-"}) == {"s__first__host": "-"}


def test_render_values_and_escaping():
    c = {"run": {"id": "r1", "scheduled_time": 100, "params": {"region": 'e"u'}},
         "steps": {"a_b": {"status": "succeeded", "sid": "S1", "resultCount": 4,
                           "first": {"host": 'x\\y"'}}}}
    out = render_args(["run__id", "run__scheduled_time", "run__param__region", "a_b__sid",
                       "a_b__resultCount", "a_b__status", "a_b__first__host"], c)
    assert out == {"run__id": "r1", "run__scheduled_time": "100", "run__param__region": 'e\\"u',
                   "a_b__sid": "S1", "a_b__resultCount": "4", "a_b__status": "succeeded",
                   "a_b__first__host": 'x\\\\y\\"'}


def test_missing_param_and_field():
    c = {"run": {"params": {}}, "steps": {"s": {"status": "succeeded", "first": {"a": 1}}}}
    with pytest.raises(TokenError):
        render_args(["run__param__x"], c)
    with pytest.raises(TokenError):
        render_args(["s__first__zz"], c)
    with pytest.raises(TokenError, match="unknown"):
        render_args(["ghost__sid"], c)


def test_string_param_escaped():
    assert escape_spl_string('a"b\\c') == 'a\\"b\\\\c'


def test_enum_param_rejects_unknown():
    with pytest.raises(TokenError):
        validate_param({"name": "r", "type": "enum", "values": ["eu"]}, "us")
    assert validate_param({"name": "r", "type": "enum", "values": ["eu"]}, "eu") == "eu"


def test_param_types():
    assert validate_param({"name": "n", "type": "number"}, "3.5") == "3.5"
    for bad in ("abc", "nan", "inf"):
        with pytest.raises(TokenError):
            validate_param({"name": "n", "type": "number"}, bad)
    for good in ("-1d@d", "now", "2026-11-05", "2026-11-05 01:00", "1700000000", "@d"):
        validate_param({"name": "t", "type": "time"}, good)
    with pytest.raises(TokenError):
        validate_param({"name": "t", "type": "time"}, '-1d" | delete')
    d = {"name": "s", "type": "string", "regex": "[a-z]+", "default": "ok"}
    assert validate_param(d, None) == "ok"
    with pytest.raises(TokenError):
        validate_param(d, "AB")
    with pytest.raises(TokenError):
        validate_param({"name": "s", "type": "string"}, None)
