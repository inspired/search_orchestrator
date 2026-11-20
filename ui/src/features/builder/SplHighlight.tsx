/* SPL as coloured spans. Colours come from the theme's syntax tokens so light and dark both
 * work; commands and pipes are bold so the shape of the pipeline reads at a glance. */
import React, { useMemo } from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { SplTokenKind, tokenizeSpl } from './splTokens';

const THEME_KEY: Record<SplTokenKind, string> = {
    pipe: 'syntaxColorKeyword',
    command: 'syntaxColorKeyword',
    keyword: 'syntaxColorOperator',
    function: 'syntaxColorCallable',
    string: 'syntaxColorRegex',
    field: 'syntaxColorAttributeName',
    token: 'syntaxColorConstant',
    macro: 'syntaxColorReference',
    comment: 'syntaxColorComment',
    bracket: 'syntaxColorPunctuation',
    number: 'syntaxColorLiteral',
    operator: 'syntaxColorPunctuation',
    text: 'contentColorDefault',
};

export function useSplColors(): Record<SplTokenKind, string | undefined> {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    return useMemo(() => {
        const out = {} as Record<SplTokenKind, string | undefined>;
        (Object.keys(THEME_KEY) as SplTokenKind[]).forEach((k) => {
            out[k] = theme[THEME_KEY[k]] || theme.contentColorDefault;
        });
        return out;
    }, [theme]);
}

export default function SplHighlight({ text }: { text: string }) {
    const colors = useSplColors();
    const tokens = useMemo(() => tokenizeSpl(text), [text]);
    return (
        <>
            {tokens.map((t, i) => (
                <span
                    key={i}
                    style={{
                        color: colors[t.kind],
                        fontWeight: t.kind === 'command' || t.kind === 'pipe' || t.kind === 'keyword' ? 600 : undefined,
                        fontStyle: t.kind === 'comment' ? 'italic' : undefined,
                    }}
                >
                    {t.text}
                </span>
            ))}
        </>
    );
}
