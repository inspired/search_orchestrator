/* Job source: a job as pretty JSON text, and the checks on text pasted back in. Used by the
 * Source tab and by Import jobs on the Jobs page. */
import { toDefinition } from '../../api/client';
import type { JobDefinition } from '../../api/types';
import { blankJob } from './reducer';

export const IMPORT_KEY = 'search_orchestrator.imported_job';

/** The job as JSON text: server fields dropped, keys in the order stored, two-space indent. */
export function jobToSource(job: JobDefinition): string {
    return JSON.stringify(toDefinition(job), null, 2);
}

/** 1-based line and column of character offset `pos` in `text`. */
export function lineColumn(text: string, pos: number): { line: number; column: number } {
    const before = text.slice(0, Math.max(0, Math.min(pos, text.length)));
    const lines = before.split('\n');
    return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** Offset of the first character that makes `text` invalid JSON (the text's length when it ends
 * too early). Browsers differ in whether JSON.parse's message says where, so this finds it. */
export function jsonErrorOffset(text: string): number {
    let i = 0;
    const fail = (): never => {
        throw i;
    };
    const ws = () => {
        while (i < text.length && ' \t\n\r'.includes(text[i])) {
            i += 1;
        }
    };
    const literal = (word: string) => {
        for (let k = 0; k < word.length; k += 1) {
            if (text[i] !== word[k]) {
                fail();
            }
            i += 1;
        }
    };
    const string = () => {
        i += 1;
        while (text[i] !== '"') {
            if (i >= text.length || text[i] < ' ') {
                fail();
            }
            if (text[i] === '\\') {
                i += 1;
                if (text[i] === 'u') {
                    if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) {
                        i += 1;
                        fail();
                    }
                    i += 4;
                } else if (!'"\\/bfnrt'.includes(text[i] || '#')) {
                    fail();
                }
            }
            i += 1;
        }
        i += 1;
    };
    const number = () => {
        const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
        if (!m) {
            i += text[i] === '-' ? 1 : 0;
            fail();
        }
        i += (m as RegExpExecArray)[0].length;
    };
    const value = (): void => {
        ws();
        const c = text[i];
        if (c === '{') {
            i += 1;
            ws();
            if (text[i] === '}') {
                i += 1;
                return;
            }
            for (;;) {
                ws();
                if (text[i] !== '"') {
                    fail();
                }
                string();
                ws();
                if (text[i] !== ':') {
                    fail();
                }
                i += 1;
                value();
                ws();
                if (text[i] === ',') {
                    i += 1;
                } else if (text[i] === '}') {
                    i += 1;
                    return;
                } else {
                    fail();
                }
            }
        } else if (c === '[') {
            i += 1;
            ws();
            if (text[i] === ']') {
                i += 1;
                return;
            }
            for (;;) {
                value();
                ws();
                if (text[i] === ',') {
                    i += 1;
                } else if (text[i] === ']') {
                    i += 1;
                    return;
                } else {
                    fail();
                }
            }
        } else if (c === '"') {
            string();
        } else if (c === 't') {
            literal('true');
        } else if (c === 'f') {
            literal('false');
        } else if (c === 'n') {
            literal('null');
        } else {
            number();
        }
    };
    try {
        value();
        ws();
        if (i < text.length) {
            fail();
        }
    } catch (at) {
        return typeof at === 'number' ? Math.min(at, text.length) : text.length;
    }
    return text.length;
}

function syntaxMessage(text: string, err: Error): string {
    const raw = err.message || 'unexpected input';
    const at = /position (\d+)/.exec(raw);
    const lc = /line (\d+) column (\d+)/.exec(raw);
    let line: number;
    let column: number;
    if (lc) {
        line = parseInt(lc[1], 10);
        column = parseInt(lc[2], 10);
    } else {
        ({ line, column } = lineColumn(text, at ? parseInt(at[1], 10) : jsonErrorOffset(text)));
    }
    const cleaned = raw
        .replace(/,?\s*(\.\.\.)?"[\s\S]*"\s*is not valid JSON$/, '')
        .replace(/\s*\(line \d+ column \d+\)/, '')
        .replace(/\s*in JSON at position \d+/, '')
        .replace(/\s*at position \d+/, '')
        .trim();
    return `The source isn't valid JSON: ${cleaned} (line ${line}, column ${column})`;
}

export type ParsedSource = { job: Record<string, unknown>; error?: undefined } | { error: string; job?: undefined };

/** Parses pasted text into a job object with name and steps; server fields are dropped. */
export function parseJobSource(text: string): ParsedSource {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (err) {
        return { error: syntaxMessage(text, err as Error) };
    }
    const obj = value as Record<string, unknown> | null;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.name !== 'string' || !Array.isArray(obj.steps)) {
        return { error: 'The source must be a job object with name and steps' };
    }
    // Fields the pasted job leaves out take the blank job's values, so the builder can open it.
    return { job: { ...blankJob(), ...toDefinition(obj as unknown as JobDefinition) } as unknown as Record<string, unknown> };
}

/** The job a new unsaved builder starts from after Import jobs (read once). */
export function takeImportedJob(): JobDefinition | null {
    try {
        const raw = window.sessionStorage.getItem(IMPORT_KEY);
        window.sessionStorage.removeItem(IMPORT_KEY);
        const parsed = raw ? parseJobSource(raw) : null;
        return parsed && parsed.job ? (parsed.job as unknown as JobDefinition) : null;
    } catch (err) {
        return null;
    }
}

/** Keeps an imported job for the builder page to pick up; false when storage is unavailable. */
export function stashImportedJob(job: Record<string, unknown>): boolean {
    const rest = { ...job };
    delete rest.id;
    try {
        window.sessionStorage.setItem(IMPORT_KEY, JSON.stringify(rest));
        return true;
    } catch (err) {
        return false;
    }
}
