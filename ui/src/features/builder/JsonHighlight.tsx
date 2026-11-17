/* JSON as coloured spans, from the same theme syntax tokens the SPL highlighter uses. */
import React, { useMemo } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { JsonTokenKind, tokenizeJson } from './jsonTokens';
import { useSplColors } from './SplHighlight';

const THEME_KEY: Record<JsonTokenKind, string> = {
    key: 'syntaxColorAttributeName',
    string: 'syntaxColorRegex',
    number: 'syntaxColorLiteral',
    boolean: 'syntaxColorKeyword',
    null: 'syntaxColorKeyword',
    punctuation: 'syntaxColorPunctuation',
    whitespace: 'contentColorDefault',
    invalid: 'statusColorHigh',
};

export default function JsonHighlight({ text }: { text: string }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const spl = useSplColors();
    const tokens = useMemo(() => tokenizeJson(text), [text]);
    const color = (k: JsonTokenKind) => theme[THEME_KEY[k]] || theme.contentColorDefault;
    return (
        <>
            {tokens.map((t, i) =>
                t.parts ? (
                    <span key={i} style={{ color: color('string') }}>
                        &quot;
                        {t.parts.map((p, j) => (
                            <span key={j} style={{ color: spl[p.kind], fontWeight: p.kind === 'command' || p.kind === 'pipe' ? 600 : undefined }}>
                                {p.text}
                            </span>
                        ))}
                        &quot;
                    </span>
                ) : (
                    <span key={i} style={{ color: color(t.kind) }}>
                        {t.text}
                    </span>
                )
            )}
        </>
    );
}
