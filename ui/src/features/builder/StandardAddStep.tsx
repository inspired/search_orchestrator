/* The Standard view's Add step menu: the step kinds an admin hasn't turned off, with Beta
 * tags. Standard has no + handles that add actions, so a step is added here. */
import React, { useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Dropdown from '@splunk/react-ui/Dropdown';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import BetaTag from './BetaTag';
import { activeCatalog, isBeta } from './nodeCatalog';
import { NodeKind, STEP_KINDS } from './nodeModel';

export default function StandardAddStep({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const [open, setOpen] = useState(false);
    const kinds = activeCatalog().filter((e) => STEP_KINDS.includes(e.kind));
    return (
        <div style={{ margin: '0 0 8px' }}>
            <Dropdown
                open={open}
                onRequestOpen={() => setOpen(true)}
                onRequestClose={() => setOpen(false)}
                closeReasons={['clickAway', 'escapeKey', 'offScreen', 'toggleClick']}
                toggle={<Button appearance="secondary" label="Add step" isMenu />}
            >
                <div role="menu" aria-label="Add step" style={{ padding: '6px', width: '320px', maxWidth: '90vw' }}>
                    {kinds.map((e) => (
                        <button
                            key={e.kind}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                setOpen(false);
                                onAdd(e.kind);
                            }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, background: 'transparent', padding: '6px 10px', font: 'inherit', color: 'inherit', cursor: 'pointer', borderRadius: '4px' }}
                        >
                            <span style={{ fontWeight: 600 }}>{e.label}</span>
                            {isBeta(e.kind) && <BetaTag />}
                            <span style={{ display: 'block', fontSize: '12px', color: theme.contentColorMuted }}>{e.description}</span>
                        </button>
                    ))}
                </div>
            </Dropdown>
        </div>
    );
}
