import { tokenizeSpl, SplToken } from '../features/builder/splTokens';

const kinds = (s: string) => tokenizeSpl(s).filter((t) => t.kind !== 'text' || t.text.trim()).map((t) => `${t.kind}:${t.text}`);
const find = (s: string, text: string): SplToken | undefined => tokenizeSpl(s).find((t) => t.text === text);

describe('tokenizeSpl', () => {
    test('pipe and command', () => {
        expect(find('index=a | stats count', '|')?.kind).toBe('pipe');
        expect(find('index=a | stats count', 'stats')?.kind).toBe('command');
        expect(find('index=a | stats count', 'count')?.kind).toBe('text');
        expect(find('| stats count', 'stats')?.kind).toBe('command');
    });
    test('the first word inside [ is a command, at any depth', () => {
        const t = tokenizeSpl('a [ search b | head 1 [ inputlookup x ] ]');
        expect(t.find((x) => x.text === 'search')?.kind).toBe('command');
        expect(t.find((x) => x.text === 'head')?.kind).toBe('command');
        expect(t.find((x) => x.text === 'inputlookup')?.kind).toBe('command');
        expect(t.filter((x) => x.kind === 'bracket').map((x) => x.text)).toEqual(['[', '[', ']', ']']);
    });
    test('keywords, case-insensitive, not inside strings', () => {
        expect(find('a AND b or c', 'AND')?.kind).toBe('keyword');
        expect(find('a AND b or c', 'or')?.kind).toBe('keyword');
        expect(find('| stats count by host', 'by')?.kind).toBe('keyword');
        expect(find('| eval x=1 | stats count as n', 'as')?.kind).toBe('keyword');
        expect(kinds('"a and b"')).toEqual(['string:"a and b"']);
        expect(find('android', 'android')?.kind).toBe('text');
    });
    test('functions', () => {
        expect(find('| eval x=if(a>1, "y", "n")', 'if')?.kind).toBe('function');
        expect(find('| eval x=len(a)', 'len')?.kind).toBe('function');
        expect(find('| stats count(x) by y', 'count')?.kind).toBe('function');
    });
    test('strings with escapes; unterminated runs to the end', () => {
        expect(kinds('a="x \\" y" b')).toEqual(['field:a', 'operator:=', 'string:"x \\" y"', 'text:b']);
        const t = tokenizeSpl('index=a "oops | stats');
        expect(t[t.length - 1]).toEqual({ kind: 'string', text: '"oops | stats' });
    });
    test('fields before = != < >', () => {
        expect(find('host=a', 'host')?.kind).toBe('field');
        expect(find('host!=a', 'host')?.kind).toBe('field');
        expect(find('count>5', 'count')?.kind).toBe('field');
        expect(find('count<5', 'count')?.kind).toBe('field');
        expect(find('a.b=1', 'a.b')?.kind).toBe('field');
    });
    test('tokens', () => {
        expect(find('x=$a$', '$a$')?.kind).toBe('token');
        expect(find('x=$a.b.c$', '$a.b.c$')?.kind).toBe('token');
        expect(find('x=$a|s$', '$a|s$')?.kind).toBe('token');
        expect(find('x=$weekly.resultCount|0$', '$weekly.resultCount|0$')?.kind).toBe('token');
    });
    test('macros', () => {
        expect(find('`my_macro(1)` | stats count', '`my_macro(1)`')?.kind).toBe('macro');
    });
    test('triple-backtick comments, also over lines, and unterminated', () => {
        expect(find('a ```note | here``` b', '```note | here```')?.kind).toBe('comment');
        expect(find('a ```x\ny``` b', '```x\ny```')?.kind).toBe('comment');
        const t = tokenizeSpl('a ```open | stats');
        expect(t[t.length - 1]).toEqual({ kind: 'comment', text: '```open | stats' });
        expect(t.some((x) => x.kind === 'pipe')).toBe(false);
    });
    test('brackets, numbers, operators', () => {
        expect(kinds('(1.5+2)')).toEqual(['bracket:(', 'number:1.5', 'operator:+', 'number:2', 'bracket:)']);
        expect(find('head 10', '10')?.kind).toBe('number');
        expect(find('a1', 'a1')?.kind).toBe('text');
    });
    test('a command after a macro or comment is still found', () => {
        expect(find('| ```c``` stats count', 'stats')?.kind).toBe('command');
    });

    const samples = [
        'index=main sourcetype=access_combined status>=500 | stats count by host | sort - count',
        'index=a [ search index=b | fields host | dedup host ] | eval x=if(len(host)>3, "long \\"q\\"", "short") | table host x',
        '| loadjob $weekly.sid$ | where count>$daily.resultCount|0$ ```keep this | pipe``` | `my_macro(2)`',
        'index=a "unterminated | stats count',
        '| makeresults\n| eval _time=now()\n\n| collect index=summary',
        '',
        '   ',
        'a ```never closed\nand | more',
        "weird é中 chars ` unmatched",
    ];
    test.each(samples.map((s) => [s]))('round-trips %j', (s) => {
        expect(tokenizeSpl(s).map((t) => t.text).join('')).toBe(s);
    });
});
