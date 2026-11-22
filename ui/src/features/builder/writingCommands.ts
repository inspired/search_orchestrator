/* SPL commands that write data. A preview never runs a search that uses one. Saved searches
 * and backtick macros are not expanded, so what they contain is not seen. */

export const WRITING_COMMANDS = ['collect', 'outputlookup', 'outputcsv', 'tscollect', 'mcollect', 'meventcollect', 'sendemail', 'delete'] as const;

/** The first writing command `spl` uses as a command (the first word after a `|`, at the top
 * level or inside a `[ ... ]` subsearch), lower case; null when there is none. Double-quoted
 * strings and backtick macros are skipped; single quotes are not string delimiters. */
export function writingCommand(spl: string): string | null {
    const n = spl.length;
    let i = 0;
    while (i < n) {
        const c = spl[i];
        if (c === '"') {
            i += 1;
            while (i < n && spl[i] !== '"') {
                i += spl[i] === '\\' ? 2 : 1;
            }
            i += 1;
        } else if (c === '`') {
            const close = spl.startsWith('```', i) ? '```' : '`';
            const end = spl.indexOf(close, i + close.length);
            // An unterminated backtick is a plain character; keep scanning after it.
            i = end < 0 ? i + 1 : end + close.length;
        } else if (c === '|') {
            if (spl[i + 1] === '|') {
                i += 2; // the eval "or" operator, not a pipe
                continue;
            }
            const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(spl.slice(i + 1));
            if (m) {
                const word = m[1].toLowerCase();
                if ((WRITING_COMMANDS as readonly string[]).includes(word)) {
                    return word;
                }
            }
            i += 1;
        } else {
            i += 1;
        }
    }
    return null;
}
