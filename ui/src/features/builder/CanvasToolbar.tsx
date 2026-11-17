/* The bar above the Flow canvas, in three groups: on the left Add node and an Arrange menu
 * (Tidy up, Group selection; when the caller handles them and the job can be edited) and a
 * View menu of toggles (Node types, Grid, Line labels, Compact nodes); on the right "Follow
 * the run" (run page, while follow is off), the zoom buttons with the zoom level, Frame all,
 * Reset view and Full screen. "/" in the toolbar opens the node search at the view centre,
 * as it does in the canvas. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import ButtonGroup from '@splunk/react-ui/ButtonGroup';
import Dropdown from '@splunk/react-ui/Dropdown';
import Menu from '@splunk/react-ui/Menu';
import Minus from '@splunk/react-icons/Minus';
import Plus from '@splunk/react-icons/Plus';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';

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
    /** The zoom, shown as a percentage between the zoom buttons. */
    zoom?: number;
    /** Shown when given: shows or hides the side panel. */
    panelOpen?: boolean;
    onTogglePanel?: () => void;
}

export default function CanvasToolbar(p: CanvasToolbarProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const toggle = (label: string, on: boolean, onClick: () => void) => (
        <Menu.Item selectable selectableAppearance="checkbox" selected={on} onClick={onClick}>
            {label}
        </Menu.Item>
    );
    const canArrange = p.canEdit && (p.onTidy || p.onGroup);
    const sep = <span aria-hidden style={{ width: '1px', alignSelf: 'stretch', margin: '4px 4px', background: theme.borderColorWeak || theme.borderColor }} />;
    return (
        <div
            role="toolbar"
            aria-label="Canvas"
            style={{ display: 'flex', gap: '4px', marginBottom: '4px', flexWrap: 'wrap', alignItems: 'center' }}
            onKeyDown={(ev) => {
                if (ev.key === '/' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && p.onAddNode && p.canEdit) {
                    ev.preventDefault();
                    p.onAddNode();
                }
            }}
        >
            {p.canEdit && p.onAddNode && <Button appearance="secondary" icon={<Plus />} label="Add node" onClick={p.onAddNode} />}
            {canArrange && (
                <Dropdown toggle={<Button appearance="subtle" label="Arrange" isMenu />}>
                    <Menu>
                        {p.onTidy && <Menu.Item onClick={p.onTidy}>Tidy up</Menu.Item>}
                        {p.onGroup && (
                            <Menu.Item disabled={!p.canGroup} onClick={p.onGroup} description={p.canGroup ? undefined : 'Select nodes first'}>
                                Group selection
                            </Menu.Item>
                        )}
                    </Menu>
                </Dropdown>
            )}
            <Dropdown toggle={<Button appearance="subtle" label="View" isMenu />}>
                <Menu>
                    {toggle('Node types', p.legendOpen, p.onToggleLegend)}
                    {toggle('Grid', p.gridOn, p.onToggleGrid)}
                    {toggle('Line labels', p.lineLabelsOn, p.onToggleLineLabels)}
                    {toggle('Compact nodes', p.compact, p.onToggleCompact)}
                    {p.onTogglePanel && toggle('Side panel', Boolean(p.panelOpen), p.onTogglePanel)}
                </Menu>
            </Dropdown>
            <span style={{ flex: 1 }} />
            {p.onFollow && <Button appearance="secondary" label="Follow the run" onClick={p.onFollow} />}
            <ButtonGroup>
                <Button appearance="subtle" icon={<Minus />} aria-label="Zoom out" onClick={() => p.onZoom(1 / 1.2)} />
                {p.zoom !== undefined && (
                    <span aria-label="Zoom level" style={{ minWidth: '44px', textAlign: 'center', fontSize: '12px', color: theme.contentColorMuted, alignSelf: 'center' }}>
                        {`${Math.round(p.zoom * 100)}%`}
                    </span>
                )}
                <Button appearance="subtle" icon={<Plus />} aria-label="Zoom in" onClick={() => p.onZoom(1.2)} />
            </ButtonGroup>
            <Button appearance="subtle" label="Frame all" onClick={p.onFrame} />
            <Button appearance="subtle" label="Reset view" onClick={p.onReset} />
            {p.onToggleFullScreen && (
                <>
                    {sep}
                    <Button appearance="subtle" label={p.fullScreen ? 'Leave full screen' : 'Full screen'} onClick={p.onToggleFullScreen} />
                </>
            )}
        </div>
    );
}
