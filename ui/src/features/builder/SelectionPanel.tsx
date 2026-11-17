/* The side panel for several selected nodes: how many, and what can be done to all of them at
 * once (tidy them up, remove them). */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import Heading from '@splunk/react-ui/Heading';

export interface SelectionPanelProps {
    keys: string[];
    onTidy: (keys: string[]) => void;
    /** The page confirms, then removes them. */
    onRequestRemove: (keys: string[]) => void;
}

export default function SelectionPanel({ keys, onTidy, onRequestRemove }: SelectionPanelProps) {
    return (
        <section aria-label="Selected nodes">
            <Heading level={2}>{`${keys.length} nodes selected`}</Heading>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                {/* Align and Distribute go here. */}
                <Button appearance="secondary" label="Tidy up selection" onClick={() => onTidy(keys)} />
                <Button appearance="destructive" label="Remove nodes" onClick={() => onRequestRemove(keys)} />
            </div>
        </section>
    );
}
