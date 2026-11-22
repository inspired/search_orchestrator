/* How a condition line is checked (1.17.0): the small comparison language, an SPL `where`
 * expression, or a search that must return a row. Mirrors model.py's checks and messages. */
import type { ConditionKind, Edge } from '../../api/types';
import { writingCommand } from './writingCommands';

export const CONDITION_KINDS: { value: ConditionKind; label: string }[] = [
    { value: 'simple', label: 'Simple comparison' },
    { value: 'eval', label: 'SPL expression' },
    { value: 'search', label: 'Search returns results' },
];

/** A search condition's time range when none is set: "The 24 hours before". */
export const DEFAULT_CONDITION_RANGE = { earliest: '-24h', latest: 'now' };

export const conditionKind = (e: Pick<Edge, 'expression_kind'>): ConditionKind => e.expression_kind || 'simple';

/** The engine's key for a line's condition result on a run. */
export const conditionKey = (from: string, to: string): string => `${from}>${to}`;

/** "where <expr>" or "search <spl>" for an SPL condition (newlines folded); the bare
 * expression for a simple one; '' when empty. */
export function conditionShort(e: Pick<Edge, 'expression' | 'expression_kind'>): string {
    const text = (e.expression || '').replace(/\s+/g, ' ').trim();
    if (!text) {
        return '';
    }
    const kind = conditionKind(e);
    return kind === 'eval' ? `where ${text}` : kind === 'search' ? `search ${text}` : text;
}

/** Whether a `|` starts a command, skipping double-quoted strings, macros and ``` comments;
 * `||` is not a pipe, and a ' is not a delimiter. As model.py's _pipes. */
function hasPipe(spl: string): boolean {
    const n = spl.length;
    let i = 0;
    while (i < n) {
        const c = spl[i];
        if (c === '"') {
            i += 1;
            while (i < n && spl[i] !== c) {
                i += spl[i] === '\\' ? 2 : 1;
            }
            i += 1;
        } else if (c === '`') {
            const close = spl.startsWith('```', i) ? '```' : '`';
            const end = spl.indexOf(close, i + close.length);
            i = end < 0 ? i + 1 : end + close.length;
        } else if (c === '|') {
            if (spl[i + 1] === '|') {
                i += 2;
                continue;
            }
            return true;
        } else {
            i += 1;
        }
    }
    return false;
}

/** Problems with an SPL condition, as model.py reports them (code, message). */
export function splConditionIssues(e: Edge): { code: 'bad_expression' | 'condition_writes'; message: string }[] {
    const kind = conditionKind(e);
    if (kind === 'simple') {
        return [];
    }
    const where = `dependency ${e.from}->${e.to}`;
    const text = e.expression || '';
    if (!text.trim()) {
        const what = kind === 'eval' ? 'an SPL expression' : 'a search';
        return [{ code: 'bad_expression', message: `${where}: the condition is empty; write ${what}, or pick another condition` }];
    }
    const out: { code: 'bad_expression' | 'condition_writes'; message: string }[] = [];
    if (kind === 'eval' && hasPipe(text)) {
        out.push({
            code: 'bad_expression',
            message: `${where}: an SPL expression can't contain | outside quotes; write only what follows | where, or pick Search returns results for a full search`,
        });
    } else {
        const cmd = writingCommand(text);
        if (cmd) {
            out.push({ code: 'condition_writes', message: `${where}: a condition only reads, so it can't use ${cmd}; move ${cmd} into a step and check that step's results here` });
        }
    }
    if (/\|\s*orchestrate\b/i.test(text)) {
        out.push({ code: 'condition_writes', message: `${where}: a condition can't call | orchestrate; use a start-job action instead` });
    }
    return out;
}
