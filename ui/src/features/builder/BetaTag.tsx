/* "Beta" beside a building block that is still in development and may not work yet
 * (BETA_KINDS): in Settings > Building blocks and the builder's add menu. */
import React from 'react';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { BETA_NOTE } from './nodeCatalog';

export default function BetaTag() {
    const t = useSplunkTheme() as unknown as Record<string, string>;
    return (
        <span
            data-testid="beta-tag"
            title={BETA_NOTE}
            aria-label={`Beta. ${BETA_NOTE}`}
            style={{
                display: 'inline-block',
                marginLeft: '6px',
                padding: '0 6px',
                border: `1px solid ${t.borderColor}`,
                borderRadius: '8px',
                fontSize: '11px',
                lineHeight: '16px',
                fontWeight: 600,
                color: t.contentColorMuted,
                verticalAlign: 'middle',
            }}
        >
            Beta
        </span>
    );
}
