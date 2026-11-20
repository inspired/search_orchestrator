import { pipeNewlineEdit } from '../features/builder/pipeNewline';

const at = (before: string, after = '') => pipeNewlineEdit(before + after, before.length);

describe('pipeNewlineEdit', () => {
    test('puts the pipe on a new line after a search', () => {
        expect(at('index=a')).toEqual({ text: 'index=a\n| ', caret: 10 });
    });
    test('removes one trailing space first', () => {
        expect(at('index=a ')).toEqual({ text: 'index=a\n| ', caret: 10 });
        expect(at('index=a  ')).toEqual({ text: 'index=a \n| ', caret: 11 });
    });
    test('keeps the text after the caret', () => {
        expect(at('index=a', ' | head 1')).toEqual({ text: 'index=a\n|  | head 1', caret: 10 });
    });
    test('does nothing at the start of a line or after only whitespace', () => {
        expect(at('')).toBeNull();
        expect(at('   ')).toBeNull();
        expect(at('index=a\n')).toBeNull();
        expect(at('index=a\n  ')).toBeNull();
    });
    test('works on a later line', () => {
        expect(at('index=a\n| stats count')).toEqual({ text: 'index=a\n| stats count\n| ', caret: 24 });
    });
    test('does nothing inside a double-quoted string', () => {
        expect(at('x="a ')).toBeNull();
        expect(at('x="a \\" ')).toBeNull();
    });
    test('works after a closed string', () => {
        expect(at('x="a"')?.text).toBe('x="a"\n| ');
    });
    test('does nothing inside a triple-backtick comment', () => {
        expect(at('a ```note ')).toBeNull();
        expect(at('a ```note\nmore ')).toBeNull();
    });
    test('works after a closed comment', () => {
        expect(at('a ```c```')?.text).toBe('a ```c```\n| ');
    });
    test('does nothing for ||', () => {
        expect(at('a |')).toBeNull();
        expect(at('a|')).toBeNull();
    });
    test('after a bracket', () => {
        expect(at('a [')?.text).toBe('a [\n| ');
    });
});
