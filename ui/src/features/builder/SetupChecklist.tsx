/* A short list above the tabs of what the job still needs, with a button to the tab that
 * fixes each item. Not a step bar: items can be done in any order. */
import React from 'react';
import Button from '@splunk/react-ui/Button';
import List from '@splunk/react-ui/List';
import ScreenReaderContent from '@splunk/react-ui/ScreenReaderContent';
import Typography from '@splunk/react-ui/Typography';
import CheckCircle from '@splunk/react-icons/CheckCircle';
import Circle from '@splunk/react-icons/Circle';
import useSplunkTheme from '@splunk/themes/useSplunkTheme';
import { TAB_LABELS, TabId } from './JobTabs';
import type { ChecklistItem } from './readiness';

export interface SetupChecklistProps {
    items: ChecklistItem[];
    onTabChange: (tab: TabId) => void;
    onHide?: () => void;
}

export default function SetupChecklist({ items, onTabChange, onHide }: SetupChecklistProps) {
    const theme = useSplunkTheme() as unknown as Record<string, string>;
    const count = items.filter((i) => i.done).length;
    const requiredDone = items.every((i) => i.optional || i.done);
    return (
        <section aria-labelledby="setup-checklist-title" style={{ margin: '8px 0 16px' }}>
            <Typography as="h2" variant="title4" id="setup-checklist-title">
                Set up this job
            </Typography>
            <Typography as="p" variant="body" style={{ color: theme.contentColorMuted }}>{`${count} of ${items.length} done`}</Typography>
            <List>
                {items.map((item) => {
                    const Icon = item.done ? CheckCircle : Circle;
                    return (
                        <List.Item key={item.key}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Icon aria-hidden style={{ color: item.done ? theme.statusColorSuccess : theme.contentColorMuted }} />
                                <ScreenReaderContent>{item.done ? 'Done' : 'Not done'}</ScreenReaderContent>
                                <span>{item.label}</span>
                                {!item.done && (
                                    <Button appearance="subtle" label={`Go to ${TAB_LABELS[item.tab]}`}
                                        aria-label={`Go to ${TAB_LABELS[item.tab]}: ${item.label}`} onClick={() => onTabChange(item.tab)} />
                                )}
                            </span>
                        </List.Item>
                    );
                })}
            </List>
            {onHide && requiredDone && <Button appearance="subtle" label="Hide checklist" onClick={onHide} />}
        </section>
    );
}
