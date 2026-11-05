"""Safe boolean expression language for edge conditions and run_when.

Grammar::

    expr    := and ("or" and)*
    and     := not ("and" not)*
    not     := "not" not | atom
    atom    := "(" expr ")" | operand OP operand
    OP      := == != > >= < <=
    operand := number | 'string' | "string" | $token$

Hand-written recursive descent; nothing is ever passed to eval. A missing
token (lookup returns None) makes its comparison false (including ``!=``).
Nodes are tuples: ("or"|"and", l, r), ("not", n), ("cmp", op, l, r),
("num", v), ("str", v), ("tok", name).
"""
import re


class ExprError(ValueError):
    pass


MAX_LEN = 2000
MAX_DEPTH = 50
_NUM_RE = re.compile(r"-?[0-9]+(?:\.[0-9]+)?")


_TOKEN_RE = re.compile(r"""
    \s*(?:
      (?P<num>-?[0-9]+(?:\.[0-9]+)?)
     |(?P<str>'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")
     |\$(?P<tok>[A-Za-z0-9_.]+)\$
     |(?P<op>==|!=|>=|<=|>|<)
     |(?P<par>[()])
     |(?P<word>[A-Za-z_]+)
    )""", re.X)


def _lex(text):
    pos, out = 0, []
    text = text.rstrip()
    while pos < len(text):
        m = _TOKEN_RE.match(text, pos)
        if not m or m.end() == pos:
            raise ExprError("unexpected character at %d: %r" % (pos, text[pos:pos + 10]))
        pos = m.end()
        kind = m.lastgroup
        val = m.group(kind)
        if kind == "word":
            if val not in ("and", "or", "not"):
                raise ExprError("unexpected word %r" % val)
        out.append((kind, val))
    return out


class _Parser:
    def __init__(self, toks):
        self.t, self.i = toks, 0
        self.depth = 0

    def enter(self):
        self.depth += 1
        if self.depth > MAX_DEPTH:
            raise ExprError("expression nested too deeply")

    def leave(self):
        self.depth -= 1

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def take(self):
        tok = self.peek()
        self.i += 1
        return tok

    def is_word(self, w):
        return self.peek() == ("word", w)

    def expr(self):
        n = self.and_()
        while self.is_word("or"):
            self.take()
            n = ("or", n, self.and_())
        return n

    def and_(self):
        n = self.not_()
        while self.is_word("and"):
            self.take()
            n = ("and", n, self.not_())
        return n

    def not_(self):
        if self.is_word("not"):
            self.take()
            self.enter()
            n = ("not", self.not_())
            self.leave()
            return n
        return self.atom()

    def atom(self):
        if self.peek() == ("par", "("):
            self.take()
            self.enter()
            n = self.expr()
            self.leave()
            if self.take() != ("par", ")"):
                raise ExprError("missing closing parenthesis")
            return n
        left = self.operand()
        kind, op = self.take()
        if kind != "op":
            raise ExprError("expected a comparison operator")
        return ("cmp", op, left, self.operand())

    def operand(self):
        kind, val = self.take()
        if kind == "num":
            return ("num", float(val))
        if kind == "str":
            body = val[1:-1]
            return ("str", re.sub(r"\\(.)", r"\1", body))
        if kind == "tok":
            return ("tok", val)
        raise ExprError("expected a number, string or $token$")


def parse(text):
    if not isinstance(text, str) or not text.strip():
        raise ExprError("empty expression")
    if len(text) > MAX_LEN:
        raise ExprError("expression longer than %d characters" % MAX_LEN)
    p = _Parser(_lex(text))
    try:
        n = p.expr()
    except RecursionError:
        raise ExprError("expression too complex")
    if p.i != len(p.t):
        raise ExprError("unexpected trailing input")
    return n


def tokens(node):
    """Set of token names ($...$ contents) referenced by a parsed expression."""
    if node[0] == "tok":
        return {node[1]}
    if node[0] in ("num", "str"):
        return set()
    if node[0] == "cmp":
        return tokens(node[2]) | tokens(node[3])
    out = set()
    for c in node[1:]:
        out |= tokens(c)
    return out


def _num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v)
    return float(s) if _NUM_RE.fullmatch(s) else None


def _cmp(op, a, b):
    if op == "==":
        return a == b
    if op == "!=":
        return a != b
    if op == ">":
        return a > b
    if op == ">=":
        return a >= b
    if op == "<":
        return a < b
    return a <= b


def _value(node, lookup):
    if node[0] == "tok":
        return lookup(node[1])
    return node[1]


def evaluate(node, lookup):
    k = node[0]
    if k == "or":
        return evaluate(node[1], lookup) or evaluate(node[2], lookup)
    if k == "and":
        return evaluate(node[1], lookup) and evaluate(node[2], lookup)
    if k == "not":
        return not evaluate(node[1], lookup)
    op = node[1]
    a, b = _value(node[2], lookup), _value(node[3], lookup)
    if a is None or b is None:
        return False
    # Numeric comparison when a side is a numeric literal; else both numeric-looking.
    if node[2][0] == "num" or node[3][0] == "num":
        x, y = _num(a), _num(b)
        return False if x is None or y is None else _cmp(op, x, y)
    x, y = _num(a), _num(b)
    if x is not None and y is not None:
        return _cmp(op, x, y)
    return _cmp(op, str(a), str(b))
