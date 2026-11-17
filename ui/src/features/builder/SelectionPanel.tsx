/* The side panel for several selected nodes: how many, and what can be done to all of them at
 * once (align them, spread them out evenly, tidy them up, remove them). */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import Heading from '@splunk/react-ui/Heading';
import { ALIGN_LABEL, AlignHow, Arrange, DISTRIBUTE_LABEL, DISTRIBUTE_REASON } from './align';

export interface SelectionPanelProps {
    keys: string[];
    onTidy: (keys: string[]) => void;
    /** Align or distribute `keys`; one undo step. */
    onArrange?: (keys: string[], how: Arrange) => void;
    /** The page confirms, then removes them. */
    onRequestRemove: (keys: string[]) => void;
}

const row = { display: 'flex', flexWrap: 'wrap', gap: '4px' } as const;

export default function SelectionPanel({ keys, onTidy, onArrange, onRequestRemove }: SelectionPanelProps) {
    const enough = keys.length >= 3;
    return (
        <section aria-label="Selected nodes">
            <Heading level={2}>{`${keys.length} nodes selected`}</Heading>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                {onArrange && (
                    <>
                        <div role="group" aria-label="Align" style={row}>
                            {(Object.keys(ALIGN_LABEL) as AlignHow[]).map((how) => (
                                <Button key={how} appearance="subtle" label={ALIGN_LABEL[how]} onClick={() => onArrange(keys, how)} />
                            ))}
                        </div>
                        <div role="group" aria-label="Distribute" style={row}>
                            {(['spread-x', 'spread-y'] as const).map((how) => (
                                <Button key={how} appearance="subtle" label={DISTRIBUTE_LABEL[how]} disabled={!enough} onClick={() => onArrange(keys, how)} />
                            ))}
                        </div>
                        {!enough && <span style={{ fontSize: '12px' }}>{DISTRIBUTE_REASON}</span>}
                    </>
                )}
                <Button appearance="secondary" label="Tidy up selection" onClick={() => onTidy(keys)} />
                <Button appearance="destructive" label="Remove nodes" onClick={() => onRequestRemove(keys)} />
            </div>
        </section>
    );
}
