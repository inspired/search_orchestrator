import { tokenizeJson } from '../features/builder/jsonTokens';
import { jobToSource } from '../features/builder/sourceLogic';
import { rollupJob } from './builderFixtures';
import { toDefinition } from '../api/client';

const join = (s: string) => tokenizeJson(s).map((t) => t.text).join('');
const kinds = (s: string) => tokenizeJson(s).filter((t) => t.kind !== 'whitespace').map((t) => `${t.kind}:${t.text}`);

describe('tokenizeJson', () => {
    it('classifies keys, strings, numbers, literals and punctuation', () => {
        expect(kinds('{"a": [1, -2.5e3, true, false, null, "x"]}')).toEqual([
            'punctuation:{', 'key:"a"', 'punctuation::', 'punctuation:[', 'number:1', 'punctuation:,', 'number:-2.5e3', 'punctuation:,',
            'boolean:true', 'punctuation:,', 'boolean:false', 'punctuation:,', 'null:null', 'punctuation:,', 'string:"x"', 'punctuation:]', 'punctuation:}',
        ]);
    });

    it('treats a string followed by a colon as a key even with spaces and escapes', () => {
        expect(kinds('{"a\\"b"  : "v"}').slice(1, 3)).toEqual(['key:"a\\"b"', 'punctuation::']);
    });

    it('round-trips a real job definition', () => {
        const src = jobToSource(toDefinition(rollupJob()));
        expect(join(src)).toBe(src);
        expect(tokenizeJson(src).some((t) => t.kind === 'invalid')).toBe(false);
    });

    it('round-trips broken and half-typed text without throwing', () => {
        ['{"a": tru', '{"a": "unclosed', '{,]:}', 'nul', '--1 @# \u{1F600}', '', '   \n', '{"a":'].forEach((s) => {
            expect(join(s)).toBe(s);
        });
        expect(kinds('@')).toEqual(['invalid:@']);
        expect(kinds('"open')[0]).toBe('invalid:"open');
    });

    it('colours the SPL inside "spl" values and keeps the escapes as typed', () => {
        const src = '{"spl": "index=a | stats count by \\"x\\"\\n| head 1", "name": "n"}';
        const toks = tokenizeJson(src);
        expect(toks.map((t) => t.text).join('')).toBe(src);
        const spl = toks.find((t) => t.kind === 'string' && t.parts);
        expect(spl).toBeDefined();
        expect((spl!.parts as { text: string }[]).map((p) => p.text).join('')).toBe(spl!.text.slice(1, -1));
        expect(spl!.parts!.some((p) => p.kind === 'command' && p.text === 'stats')).toBe(true);
        expect(toks.find((t) => t.text === '"n"')!.parts).toBeUndefined();
    });
});
