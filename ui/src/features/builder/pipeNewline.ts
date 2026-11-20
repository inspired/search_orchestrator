/* "Put each | on a new line": what typing | at the caret should do instead. */
import { openLiteralAt } from './splTokens';

export interface PipeEdit {
    text: string;
    caret: number;
}

/**
 * The text and caret after typing `|` at `caret`, with the pipe moved to a new line (and one
 * space before the caret dropped), or null when the pipe should be typed as it is: inside a
 * string, macro or comment, as the second pipe of `||`, or on a line with nothing before it.
 */
export function pipeNewlineEdit(text: string, caret: number): PipeEdit | null {
    const before = text.slice(0, caret);
    if (before.endsWith('|') || openLiteralAt(text, caret)) {
        return null;
    }
    const lineStart = before.lastIndexOf('\n') + 1;
    if (before.slice(lineStart).trim() === '') {
        return null;
    }
    const kept = before.endsWith(' ') ? before.slice(0, -1) : before;
    const inserted = `${kept}\n| `;
    return { text: inserted + text.slice(caret), caret: inserted.length };
}
