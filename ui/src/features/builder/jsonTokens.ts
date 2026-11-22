/* A small JSON tokenizer for syntax colours. Display only: the token texts always join back to
 * the input exactly, and it never throws, so half-typed text still shows. */
import { SplToken, tokenizeSpl } from './splTokens';

export type JsonTokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'whitespace' | 'invalid';

export interface JsonToken {
    kind: JsonTokenKind;
    text: string;
    /** For the value of an "spl" key: the string content (between the quotes) as SPL tokens. */
    parts?: SplToken[];
}

const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/;
const LITERAL = /^(true|false|null)(?![\w])/;

/** SPL tokens for the raw (still escaped) content of a JSON string; undefined if it cannot be split exactly. */
function splParts(raw: string): SplToken[] | undefined {
    let decoded: string;
    try {
        decoded = JSON.parse(`"${raw}"`);
    } catch (err) {
        return undefined;
    }
    const parts = tokenizeSpl(decoded).map((t) => ({ kind: t.kind, text: JSON.stringify(t.text).slice(1, -1) }));
    return parts.map((p) => p.text).join('') === raw ? parts : undefined;
}

export function tokenizeJson(text: string): JsonToken[] {
    const out: JsonToken[] = [];
    let i = 0;
    let afterSplKey = false;
    while (i < text.length) {
        const c = text[i];
        const rest = text.slice(i);
        let m: RegExpMatchArray | null;
        let tok: JsonToken;
        if (/\s/.test(c)) {
            let j = i + 1;
            while (j < text.length && /\s/.test(text[j])) {
                j += 1;
            }
            out.push({ kind: 'whitespace', text: text.slice(i, j) });
            i = j;
            continue;
        } else if (c === '"') {
            let j = i + 1;
            let closed = false;
            while (j < text.length) {
                if (text[j] === '\\') {
                    j += 2;
                } else if (text[j] === '"') {
                    closed = true;
                    j += 1;
                    break;
                } else {
                    j += 1;
                }
            }
            j = Math.min(j, text.length);
            const s = text.slice(i, j);
            if (!closed) {
                tok = { kind: 'invalid', text: s };
            } else if (/^\s*:/.test(text.slice(j))) {
                tok = { kind: 'key', text: s };
            } else {
                tok = { kind: 'string', text: s };
                const parts = afterSplKey ? splParts(s.slice(1, -1)) : undefined;
                if (parts) {
                    tok.parts = parts;
                }
            }
            i = j;
        } else if ('{}[]:,'.includes(c)) {
            tok = { kind: 'punctuation', text: c };
            i += 1;
        } else if ((m = rest.match(NUMBER))) {
            tok = { kind: 'number', text: m[0] };
            i += m[0].length;
        } else if ((m = rest.match(LITERAL))) {
            tok = { kind: m[1] === 'null' ? 'null' : 'boolean', text: m[0] };
            i += m[0].length;
        } else {
            // a run of anything else, up to whitespace or the next structural character
            const run = (rest.match(/^[^\s"{}[\]:,]+/) || [String.fromCodePoint(text.codePointAt(i) as number)])[0];
            tok = { kind: 'invalid', text: run };
            i += run.length;
        }
        if (tok.kind === 'key') {
            afterSplKey = tok.text === '"spl"';
        } else if (!(tok.kind === 'punctuation' && tok.text === ':')) {
            afterSplKey = false;
        }
        out.push(tok);
    }
    return out;
}
