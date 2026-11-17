/* A small SPL tokenizer for syntax colours. It is for display only: the token texts always
 * join back to the input exactly, and it never rejects anything. */
export type SplTokenKind =
    | 'pipe'
    | 'command'
    | 'keyword'
    | 'function'
    | 'string'
    | 'field'
    | 'token'
    | 'macro'
    | 'comment'
    | 'bracket'
    | 'number'
    | 'operator'
    | 'text';

export interface SplToken {
    kind: SplTokenKind;
    text: string;
}

const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'BY', 'AS', 'OVER', 'WHERE']);
const IDENT = /^[A-Za-z_][\w.:]*/;
const NUMBER = /^\d+(\.\d+)?/;
const TOKEN = /^\$[A-Za-z_][\w.]*(\|[^$\s]*)?\$/;
const OPERATORS = /^[=!<>+\-*/%,]+/;

/** Where a double-quoted string starting at `i` ends (exclusive) and whether it closed. */
function stringEnd(text: string, i: number): { end: number; closed: boolean } {
    let j = i + 1;
    while (j < text.length) {
        if (text[j] === '\\') {
            j += 2;
        } else if (text[j] === '"') {
            return { end: j + 1, closed: true };
        } else {
            j += 1;
        }
    }
    return { end: text.length, closed: false };
}

function closeAt(text: string, from: number, close: string): { end: number; closed: boolean } {
    const at = text.indexOf(close, from);
    return at < 0 ? { end: text.length, closed: false } : { end: at + close.length, closed: true };
}

/** True when `caret` sits inside an unterminated string, macro or ``` comment. */
export function openLiteralAt(text: string, caret: number): boolean {
    const t = text.slice(0, caret);
    let i = 0;
    while (i < t.length) {
        const c = t[i];
        let r: { end: number; closed: boolean } | null = null;
        if (t.startsWith('```', i)) {
            r = closeAt(t, i + 3, '```');
        } else if (c === '`') {
            r = closeAt(t, i + 1, '`');
        } else if (c === '"') {
            r = stringEnd(t, i);
        }
        if (r) {
            if (!r.closed) {
                return true;
            }
            i = r.end;
        } else {
            i += 1;
        }
    }
    return false;
}

export function tokenizeSpl(text: string): SplToken[] {
    const out: SplToken[] = [];
    const push = (kind: SplTokenKind, s: string) => out.push({ kind, text: s });
    let expectCommand = false;
    let i = 0;
    while (i < text.length) {
        const rest = text.slice(i);
        const c = text[i];
        let m: RegExpMatchArray | null;
        if (/\s/.test(c)) {
            let j = i + 1;
            while (j < text.length && /\s/.test(text[j])) {
                j += 1;
            }
            push('text', text.slice(i, j));
            i = j;
        } else if (rest.startsWith('```')) {
            const { end } = closeAt(text, i + 3, '```');
            push('comment', text.slice(i, end));
            i = end;
        } else if (c === '`') {
            const { end } = closeAt(text, i + 1, '`');
            push('macro', text.slice(i, end));
            expectCommand = false;
            i = end;
        } else if (c === '"') {
            const { end } = stringEnd(text, i);
            push('string', text.slice(i, end));
            expectCommand = false;
            i = end;
        } else if (c === '|') {
            push('pipe', c);
            expectCommand = true;
            i += 1;
        } else if (c === '[' || c === ']' || c === '(' || c === ')') {
            push('bracket', c);
            expectCommand = c === '[';
            i += 1;
        } else if (c === '$' && (m = rest.match(TOKEN))) {
            push('token', m[0]);
            expectCommand = false;
            i += m[0].length;
        } else if ((m = rest.match(IDENT))) {
            const word = m[0];
            const next = text.slice(i + word.length, i + word.length + 2);
            let kind: SplTokenKind = 'text';
            if (expectCommand) {
                kind = 'command';
            } else if (KEYWORDS.has(word.toUpperCase())) {
                kind = 'keyword';
            } else if (next[0] === '(') {
                kind = 'function';
            } else if (next[0] === '=' || next[0] === '<' || next[0] === '>' || next === '!=') {
                kind = 'field';
            }
            push(kind, word);
            expectCommand = false;
            i += word.length;
        } else if ((m = rest.match(NUMBER))) {
            push('number', m[0]);
            expectCommand = false;
            i += m[0].length;
        } else if ((m = rest.match(OPERATORS))) {
            push('operator', m[0]);
            expectCommand = false;
            i += m[0].length;
        } else {
            // one code point, so surrogate pairs stay whole
            const cp = String.fromCodePoint(text.codePointAt(i) as number);
            push('text', cp);
            expectCommand = false;
            i += cp.length;
        }
    }
    return out;
}
