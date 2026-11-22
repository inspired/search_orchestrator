/* The editor's node positions and the edits that move them, for the current node size (compact
 * or full): the laid-out positions, drag and nudge, tidy up, align and distribute. Each edit is
 * one undo step. */
import { useMemo } from 'react';
import type { JobDefinition } from '../../api/types';
import { Arrange, arrange as arrangeNodes } from './align';
import { layoutFlow } from './flowLayout';
import type { Pos, Positions } from './graphLogic';
import type { FlowGraph } from './nodeModel';
import type { BuilderAction } from './reducer';

export default function useFlowLayout(job: JobDefinition, graph: FlowGraph, compact: boolean, dispatch: React.Dispatch<BuilderAction>) {
    const positions: Positions = useMemo(() => layoutFlow(graph, job.layout?.nodes, compact), [graph, job.layout, compact]);
    return {
        positions,
        /** Every shown position is written with the move, so nodes the layout placed stay where they are. */
        move: (moved: Record<string, Pos>) => dispatch({ type: 'moveNodes', positions: { ...positions, ...moved } }),
        tidy: (keys?: string[]) => dispatch({ type: 'tidyLayout', keys, compact }),
        arrange: (keys: string[], how: Arrange) => {
            const moved = arrangeNodes(graph, positions, keys, how, compact);
            if (Object.keys(moved).length) {
                dispatch({ type: 'moveNodes', positions: { ...positions, ...moved } });
            }
        },
    };
}
