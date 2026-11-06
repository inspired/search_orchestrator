import pytest

from so import tokens as tk

from so.tokens import (TokenError, compile_spl, escape_spl_string, find_tokens,
                       render_args, token_defaults, validate_param)


def ctx_zero_rows(step):
    return {"run": {"id": "r1", "scheduled_time": 1, "params": {}},
            "steps": {step: {"status": "succeeded", "sid": "9", "resultCount": 0, "first": None}}}


def test_literal_dollar_untouched():
    s = '| rex "foo$" | eval x="$unknown$"'
    assert compile_spl(s, {"daily"})[0] == s


def test_known_token_compiled():
    assert compile_spl("| loadjob $daily.sid$", {"daily"}) == ('| loadjob "$args.daily__sid$"', ["daily__sid"])


def test_default_stripped_and_extracted():
    spl, names = compile_spl('$a.sid|x$ $a.sid$', {"a"})
    assert spl == '"$args.a__sid$" "$args.a__sid$"' and names == ["a__sid"]
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


def test_default_cannot_span_unterminated_token():
    spl = '| eval a="$d.sid|" | rex "foo$"'
    assert compile_spl(spl, {"d"}) == (spl, [])
    assert find_tokens(spl, {"d"}) == set()
    assert token_defaults(spl, {"d"}) == {}
    assert compile_spl("$d.sid|a b-c_1.2:x@y$", {"d"})[1] == ["d__sid"]


def test_number_param_strict_and_normalised():
    d = {"name": "n", "type": "number"}
    assert validate_param(d, "007") == "7"
    assert validate_param(d, "3.50") == "3.5"
    assert validate_param(d, "-0") == "0"
    assert validate_param(d, 100) == "100"
    assert validate_param(d, 2.5) == "2.5"
    for bad in ("1e3", "+1", " 1", "1 ", "²", "٣", "1\n", ".5", "5."):
        with pytest.raises(TokenError):
            validate_param(d, bad)


def test_time_param_fullmatch_ascii():
    t = {"name": "t", "type": "time"}
    for bad in ("now\n", "-1d\n", "١d", "-1d@d\n"):
        with pytest.raises(TokenError):
            validate_param(t, bad)


def _substitute(compiled, args):
    """Do what splunkd does with $args.x$ at dispatch: plain text replacement."""
    for k, v in args.items():
        compiled = compiled.replace("$args.%s$" % k, v)
    return compiled


def test_unquoted_param_compiles_to_one_quoted_literal():
    spl, names = compile_spl("index=$run.param.idx$ | stats count", set())
    assert spl == 'index="$args.run__param__idx$" | stats count'
    ctx = {"run": {"params": {"idx": "main | outputlookup x.csv"}}, "steps": {}}
    final = _substitute(spl, render_args(names, ctx))
    assert final == 'index="main | outputlookup x.csv" | stats count'


def test_injection_probe_value_cannot_escape_quotes():
    # Final review C1 probe: the value must stay one SPL string, even with quotes,
    # a subsearch or a macro in it.
    spl, names = compile_spl("index=$run.param.idx$ | stats count", set())
    for bad, want in (('main" | delete "', 'index="main\\" | delete \\"" | stats count'),
                      ("[| inputlookup x.csv]", 'index="[| inputlookup x.csv]" | stats count'),
                      ('x\\" | delete', 'index="x\\\\\\" | delete" | stats count')):
        ctx = {"run": {"params": {"idx": bad}}, "steps": {}}
        assert _substitute(spl, render_args(names, ctx)) == want
    assert "$args.run__param__idx$ |" not in spl


def test_quoted_token_left_as_is():
    s = '| eval p="pre $run.param.p$ post" | search host="$d.first.host$"'
    assert compile_spl(s, {"d"})[0] == '| eval p="pre $args.run__param__p$ post" | search host="$args.d__first__host$"'


def test_first_field_token_quoted_when_bare():
    spl, names = compile_spl("search host=$d.first.host$ | head 1", {"d"})
    assert spl == 'search host="$args.d__first__host$" | head 1'
    ctx = {"run": {}, "steps": {"d": {"status": "succeeded", "first": {"host": "a | delete"}}}}
    assert _substitute(spl, render_args(names, ctx)) == 'search host="a | delete" | head 1'


def test_quote_scanner_handles_escapes_and_literal_dollars():
    s = r'| eval a="x\" $run.id$" | rex "foo$" | eval b=$run.id$ c="\\" d=$d.sid|none$'
    assert compile_spl(s, {"d"})[0] == (
        r'| eval a="x\" $args.run__id$" | rex "foo$" | eval b="$args.run__id$" c="\\" d="$args.d__sid$"')
    assert compile_spl("| loadjob $daily.sid$", {"daily"})[0] == '| loadjob "$args.daily__sid$"'


def test_token_after_backslash_rejected():
    # Final re-review: `\$tok$` let `" | delete` close the string.
    for spl in (r'source="C:\logs\$run.param.p$"', r"path=\$run.param.p$"):
        with pytest.raises(TokenError) as e:
            compile_spl(spl, set())
        assert "backslash" in e.value.reason
    # An escaped backslash (even count) is fine.
    assert compile_spl(r'source="C:\\$run.param.p$"', set())[0] == r'source="C:\\$args.run__param__p$"'


def test_token_in_comment_rejected_and_comment_quotes_ignored():
    with pytest.raises(TokenError) as e:
        compile_spl("| makeresults ``` note $run.param.p$ ``` | stats count", set())
    assert "comment" in e.value.reason
    # A quote inside a comment must not flip the quote state for later tokens.
    spl = '| makeresults ``` say "hi ``` | eval x=$run.param.p$'
    assert compile_spl(spl, set())[0] == '| makeresults ``` say "hi ``` | eval x="$args.run__param__p$"'


def test_backtick_in_search_value_fails_attempt():
    spl, names = compile_spl("index=$run.param.idx$", set())
    with pytest.raises(TokenError) as e:
        render_args(names, {"run": {"params": {"idx": "`mymacro`"}}, "steps": {}})
    assert "backtick" in e.value.reason
    ctx = {"run": {}, "steps": {"d": {"status": "succeeded", "first": {"h": "a```b"}}}}
    with pytest.raises(TokenError):
        render_args(compile_spl("x=$d.first.h$", {"d"})[1], ctx)


def test_escape_spl_string_neutralises_backticks():
    assert escape_spl_string('a`b"c\\') == 'a\'b\\"c\\\\'


def test_input_spl_shapes():
    assert tk.EMPTY_INPUT == "| makeresults | where 1=0"
    assert tk.input_spl(["1.2"]) == '"1.2"'
    assert tk.input_spl(["a_1", "b.2"]) == '"a_1" | append [| loadjob "b.2"]'
    assert tk.input_spl(["a", "b", "c"]) == \
        '"a" | append [| loadjob "b"] | append [| loadjob "c"]'
    with pytest.raises(tk.TokenError) as err:
        tk.input_spl([])
    assert err.value.reason == "no input to load"
    for bad in ['x" | delete', "", "a b", None]:
        with pytest.raises(tk.TokenError):
            tk.input_spl([bad])


def test_step_spl_previous_prefixes_input():
    step = {"id": "w", "type": "previous", "spl": "| stats sum(count) by $run.param.f$"}
    spl, names = tk.step_spl(step, ["d", "w"])
    assert spl == '| loadjob $args.so_input$ | stats sum(count) by "$args.run__param__f$"'
    assert names == ["run__param__f"]
    assert tk.empty_step_spl(step, ["d", "w"]) == \
        ('| makeresults | where 1=0 | stats sum(count) by "$args.run__param__f$"',
         ["run__param__f"])
    inline = {"id": "w", "type": "inline", "spl": "| loadjob $d.sid$"}
    assert tk.step_spl(inline, ["d", "w"]) == ('| loadjob "$args.d__sid$"', ["d__sid"])


def test_previous_inputs_follow_edge_order():
    job = {"steps": [{"id": x} for x in "abc"],
           "edges": [{"from": "b", "to": "c"}, {"from": "a", "to": "c"}, {"from": "b", "to": "c"}]}
    assert tk.previous_inputs(job, "c") == ["b", "a"]
    assert tk.previous_inputs(job, "a") == []


def test_fill_replaces_args_only():
    assert tk.fill('| loadjob $args.so_input$ | eval x="$args.a__sid$" | eval y="$keep$"',
                   {"so_input": '"1"', "a__sid": "1"}) == \
        '| loadjob "1" | eval x="1" | eval y="$keep$"'
    step = {"id": "p", "type": "previous", "spl": "| stats count"}
    for sids, full in ((["s1"], '| loadjob "s1" | stats count'),
                       (["s1", "s2"], '| loadjob "s1" | append [| loadjob "s2"] | stats count')):
        assert tk.fill(tk.step_spl(step, ["p"])[0], {"so_input": tk.input_spl(sids)}) == full
    assert tk.empty_step_spl(step, ["p"])[0] == "| makeresults | where 1=0 | stats count"
    assert tk.fill('"$args.other$"', {"so_input": "x"}) == '"$args.other$"'
