import React from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import BuilderPage from '../features/builder/BuilderPage';
import { bezierAt, linkEnds } from '../features/builder/flowCanvasGeometry';
import { buildGraph } from '../features/builder/nodeModel';
import { nodeSize } from '../features/builder/nodeStyle';
import { usedOutcomes } from '../features/builder/outcomes';
import { fakeApi, rollupJob } from './builderFixtures';
import { renderThemed } from './fixtures';

// daily -> weekly -> monthly, and a lone search with no lines, all at saved positions.
const nodes = {
    job: { x: 0, y: 600 },
    'trigger:0': { x: 0, y: 100 },
    'step:daily': { x: 250, y: 100 },
    'step:weekly': { x: 650, y: 100 },
    'step:monthly': { x: 1050, y: 100 },
    'step:lone': { x: 250, y: 380 },
};
const job = rollupJob({
    steps: [...rollupJob().steps, { id: 'lone', name: 'Lone search', type: 'inline', spl: 'search lone' }],
    layout: { nodes },
});
const graph = buildGraph(job);
const DW = 'step:daily-success->step:weekly';

async function show() {
    renderThemed(<BuilderPage jobId="rollups" api={fakeApi({ getJob: jest.fn().mockResolvedValue(job) })} />);
    await act(async () => {
        await Promise.resolve();
    });
    await screen.findByRole('button', { name: /^Search Lone search/ });
}

const lineButton = (re: RegExp) => screen.queryByRole('button', { name: re });

describe('BuilderPage splicing an existing node', () => {
    it('dragging a lone node onto a line puts it there, says so, and Undo restores the line', async () => {
        await show();
        const canvas = screen.getByRole('group', { name: /^Job flow/ });
        const l = graph.links.find((x) => x.key === DW)!;
        const ends = linkEnds(l, graph.nodes.find((n) => n.key === l.from)!, graph.nodes.find((n) => n.key === l.to)!, nodes, usedOutcomes(graph, l.from))!;
        const mid = bezierAt(ends.a, ends.b, 0.5);
        const { w, h } = nodeSize('search');
        const c = { clientX: nodes['step:lone'].x + w / 2, clientY: nodes['step:lone'].y + h / 2 };
        fireEvent.pointerDown(screen.getByTestId('node-step:lone'), c);
        fireEvent.pointerMove(canvas, { clientX: c.clientX + 10, clientY: c.clientY });
        fireEvent.pointerMove(canvas, { clientX: mid.x, clientY: mid.y });
        fireEvent.pointerUp(canvas, { clientX: mid.x, clientY: mid.y });
        expect(lineButton(/^Line from Daily summary, Succeeds, to Weekly rollup/)).toBeNull();
        expect(lineButton(/^Line from Daily summary, Succeeds, to Lone search/)).toBeInTheDocument();
        expect(lineButton(/^Line from Lone search, Succeeds, to Weekly rollup/)).toBeInTheDocument();
        const note = screen.getByTestId('splice-message');
        expect(note).toHaveTextContent(/now runs after/);
        fireEvent.click(within(note).getByRole('button', { name: 'Undo' }));
        expect(lineButton(/^Line from Daily summary, Succeeds, to Weekly rollup/)).toBeInTheDocument();
        expect(lineButton(/^Line from Daily summary, Succeeds, to Lone search/)).toBeNull();
    });

    it('from the keyboard: the line menu offers "Move <name> onto this line" for nodes with no lines', async () => {
        await show();
        fireEvent.click(screen.getByTestId(`line-label-${DW}`));
        const menu = screen.getByRole('listbox', { name: 'Line' });
        // Monthly rollup has lines, so it is not offered.
        expect(within(menu).queryByRole('option', { name: /Move Monthly rollup/ })).toBeNull();
        fireEvent.click(within(menu).getByRole('option', { name: 'Move Lone search onto this line' }));
        expect(lineButton(/^Line from Daily summary, Succeeds, to Lone search/)).toBeInTheDocument();
        expect(lineButton(/^Line from Lone search, Succeeds, to Weekly rollup/)).toBeInTheDocument();
        // It stays where it was.
        expect(screen.getByTestId('node-step:lone')).toHaveAttribute('transform', 'translate(250,380)');
        expect(screen.getByTestId('splice-message')).toHaveTextContent(/now runs after/);
        fireEvent.click(within(screen.getByTestId('splice-message')).getByRole('button', { name: 'Undo' }));
        expect(lineButton(/^Line from Daily summary, Succeeds, to Weekly rollup/)).toBeInTheDocument();
    });
});
