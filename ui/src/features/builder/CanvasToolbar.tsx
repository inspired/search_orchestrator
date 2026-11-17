/* The buttons above the Flow canvas: Add node, Tidy up and Group selection (when the caller handles them and the
 * job can be edited), "Follow the run" (run page, while follow is off), zoom, reset and frame, the node-type legend, the grid, line labels, Compact nodes and Full screen. "/" in the
 * toolbar opens the node search at the view centre, as it does in the canvas. */
import React from 'react';
import Button from '@splunk/react-ui/Button';

export interface CanvasToolbarProps {
    canEdit: boolean;
    onAddNode?: () => void;
    onTidy?: () => void;
    /** Puts a frame around the selected nodes; dimmed (`canGroup` false) with nothing selected. */
    onGroup?: () => void;
    canGroup?: boolean;
    /** Multiply the zoom by this factor. */
    onZoom: (factor: number) => void;
    onReset: () => void;
    onFrame: () => void;
    legendOpen: boolean;
    onToggleLegend: () => void;
    gridOn: boolean;
    onToggleGrid: () => void;
    lineLabelsOn: boolean;
    onToggleLineLabels: () => void;
    compact: boolean;
    onToggleCompact: () => void;
    fullScreen: boolean;
    onToggleFullScreen?: () => void;
    /** Shown when given: turns following the running steps back on. */
    onFollow?: () => void;
}

export default function CanvasToolbar(p: CanvasToolbarProps) {
    return (
        <div
            style={{ display: 'flex', gap: '4px', marginBottom: '4px', flexWrap: 'wrap' }}
            onKeyDown={(ev) => {
                if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && p.onAddNode && p.canEdit) {
                    ev.preventDefault();
                    p.onAddNode();
                }
            }}
        >
            {p.canEdit && p.onAddNode && <Button appearance="secondary" label="Add node" onClick={p.onAddNode} />}
            {p.canEdit && p.onTidy && <Button appearance="subtle" label="Tidy up" onClick={p.onTidy} />}
            {p.canEdit && p.onGroup && <Button appearance="subtle" label="Group selection" disabled={!p.canGroup} onClick={p.onGroup} />}
            {p.onFollow && <Button appearance="secondary" label="Follow the run" onClick={p.onFollow} />}
            <Button appearance="subtle" label="Zoom in" onClick={() => p.onZoom(1.2)} />
            <Button appearance="subtle" label="Zoom out" onClick={() => p.onZoom(1 / 1.2)} />
            <Button appearance="subtle" label="Reset view" onClick={p.onReset} />
            <Button appearance="subtle" label="Frame all" onClick={p.onFrame} />
            <Button appearance="subtle" label={p.legendOpen ? 'Hide node types' : 'Show node types'} onClick={p.onToggleLegend} />
            <Button appearance="subtle" label={p.gridOn ? 'Hide grid' : 'Show grid'} onClick={p.onToggleGrid} />
            <Button appearance="subtle" label={p.lineLabelsOn ? 'Hide line labels' : 'Show line labels'} onClick={p.onToggleLineLabels} />
            <Button appearance="subtle" label={p.compact ? 'Full nodes' : 'Compact nodes'} onClick={p.onToggleCompact} />
            {p.onToggleFullScreen && <Button appearance="subtle" label={p.fullScreen ? 'Leave full screen' : 'Full screen'} onClick={p.onToggleFullScreen} />}
        </div>
    );
}
