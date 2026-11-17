import React, { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import SplEditor from '../features/builder/SplEditor';
import { PIPE_NEWLINE_KEY } from '../features/builder/usePipeNewlinePref';
import { renderThemed } from './fixtures';

function Harness({ initial = '', onValue }: { initial?: string; onValue?: (v: string) => void }) {
    const [v, setV] = useState(initial);
    return (
        <SplEditor
            inputId="spl"
            value={v}
            onChange={(next) => {
                setV(next);
                onValue?.(next);
            }}
        />
    );
}

const area = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const typeAt = (caret: number, key = '|') => {
    area().focus();
    area().setSelectionRange(caret, caret);
    return fireEvent.keyDown(area(), { key });
};

beforeEach(() => window.localStorage.clear());

describe('SplEditor', () => {
    test('shows the highlighted copy hidden from assistive technology and keeps the real textarea', () => {
        const { container } = renderThemed(<Harness initial="index=a | stats count" />);
        expect(area()).toHaveValue('index=a | stats count');
        expect(area()).toHaveAttribute('spellcheck', 'false');
        const pre = container.querySelector('pre[aria-hidden="true"]') as HTMLElement;
        expect(pre.textContent).toContain('index=a | stats count');
        expect(pre.querySelectorAll('span').length).toBeGreaterThan(3);
    });

    test('typing | puts it on a new line and drops the trailing space', () => {
        renderThemed(<Harness initial="index=a " />);
        const proceeded = typeAt(8);
        expect(proceeded).toBe(false); // default prevented
        expect(area()).toHaveValue('index=a\n| ');
        expect(area().selectionStart).toBe(10);
    });

    test('typing | inside a string, or in a line of only whitespace, is left alone', () => {
        renderThemed(<Harness initial={'x="a '} />);
        expect(typeAt(5)).toBe(true);
        expect(area()).toHaveValue('x="a ');
    });

    test('a modified key or a selection is left alone', () => {
        renderThemed(<Harness initial="index=a" />);
        area().focus();
        area().setSelectionRange(0, 3);
        expect(fireEvent.keyDown(area(), { key: '|' })).toBe(true);
        area().setSelectionRange(7, 7);
        expect(fireEvent.keyDown(area(), { key: '|', metaKey: true })).toBe(true);
        expect(fireEvent.keyDown(area(), { key: '|', isComposing: true })).toBe(true);
    });

    test('the checkbox turns it off and is remembered', () => {
        renderThemed(<Harness initial="index=a" />);
        const box = screen.getByRole('checkbox', { name: 'Put each | on a new line' });
        expect(box).toBeChecked();
        fireEvent.click(box);
        expect(window.localStorage.getItem(PIPE_NEWLINE_KEY)).toBe('0');
        expect(typeAt(7)).toBe(true);
        expect(area()).toHaveValue('index=a');
    });

    test('starts off when remembered off', () => {
        window.localStorage.setItem(PIPE_NEWLINE_KEY, '0');
        renderThemed(<Harness initial="index=a" />);
        expect(screen.getByRole('checkbox', { name: 'Put each | on a new line' })).not.toBeChecked();
    });
});
