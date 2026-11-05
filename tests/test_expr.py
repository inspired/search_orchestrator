import pytest

from so.expr import ExprError, evaluate, parse, tokens


def test_expr_result_count():
    assert evaluate(parse("$s1.resultCount$ > 0"), {"s1.resultCount": 3}.get)


def test_expr_missing_token_false():
    assert not evaluate(parse("$s1.x$ == 'a'"), {}.get)
    assert not evaluate(parse("$s1.x$ != 'a'"), {}.get)


def test_expr_rejects_code():
    for bad in ("__import__('os')", "1 + 1", "$a$", "", "$a.b$ == ", "($a.b$ == 1", "$a.b$ == 1 )",
                "$a.b$ == 1 x", "open('f')", "$a.b$ === 1"):
        with pytest.raises(ExprError):
            parse(bad)


def test_logic_and_precedence():
    lk = {"a.n": "5", "a.status": "failed"}.get
    assert evaluate(parse("$a.n$ >= 5 and $a.status$ == 'failed'"), lk)
    assert evaluate(parse("$a.n$ < 1 or not $a.status$ == \"ok\" and $a.n$ == 5"), lk)
    assert not evaluate(parse("not ($a.n$ == 5 or $a.n$ == 6)"), lk)


def test_string_vs_number_coercion():
    assert evaluate(parse("$a.n$ == 5"), {"a.n": "5.0"}.get)
    assert not evaluate(parse("$a.n$ == 5"), {"a.n": "x"}.get)
    assert evaluate(parse("$a.s$ < 'b'"), {"a.s": "a"}.get)


def test_tokens():
    assert tokens(parse("$a.sid$ == 'x' or not $b.status$ == 'y'")) == {"a.sid", "b.status"}


def test_length_and_depth_caps():
    for bad in ("(" * 400 + "1 == 1" + ")" * 400, "not " * 400 + "1 == 1",
                " or ".join(["1 == 1"] * 400), "1 == 1" + " " * 2000):
        with pytest.raises(ExprError):
            parse(bad)
    assert evaluate(parse("(" * 40 + "1 == 1" + ")" * 40), {}.get)


def test_numeric_coercion_strict():
    assert not evaluate(parse("$a.n$ == 5"), {"a.n": "5e0"}.get)
    assert not evaluate(parse("$a.n$ == 5"), {"a.n": " 5"}.get)
    assert not evaluate(parse("$a.n$ == 5"), {"a.n": "²"}.get)
    assert not evaluate(parse("$a.n$ == 1"), {"a.n": "1_0"}.get)
    assert evaluate(parse("$a.n$ == 5"), {"a.n": "5"}.get)
    assert evaluate(parse("$a.n$ == 5"), {"a.n": 5}.get)


def test_negative_literals():
    assert evaluate(parse("$a.n$ < -1"), {"a.n": -2}.get)
    assert evaluate(parse("$a.n$ == -1.5"), {"a.n": "-1.5"}.get)
    assert evaluate(parse("-3 < 2"), {}.get)
