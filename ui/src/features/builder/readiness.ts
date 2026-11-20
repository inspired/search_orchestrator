/* What a job still needs before it is ready, for the setup checklist. */
import type { JobDefinition } from '../../api/types';
import type { TabId } from './JobTabs';
import { triggerKey } from './nodeModel';
import type { NodeKind } from './nodeModel';

export interface ChecklistItem {
    key: 'name' | 'steps' | 'searches' | 'schedule' | 'notify';
    label: string;
    done: boolean;
    optional: boolean;
    tab: TabId;
    /** The node to select on the Flow tab. */
    node?: string;
    /** Open quick-add with only these kinds (there is no node to select yet). */
    addKinds?: NodeKind[];
}

export const TRIGGER_KINDS: NodeKind[] = ['trigger_cron', 'trigger_completion'];

export function readiness(job: JobDefinition): ChecklistItem[] {
    const steps = job.steps || [];
    const triggers = job.triggers || [];
    const searchesDone =
        steps.length > 0 &&
        steps.every((s) => s.type === 'approval' || (s.type === 'saved_search' ? Boolean((s.saved_search_ref || '').trim()) : Boolean((s.spl || '').trim())));
    const scheduled = triggers.some((t) => t.type === 'cron' || t.type === 'completion');
    // The server warns unless the job itself has an on_failure action.
    const notified = (job.actions || []).some((a) => a.hook === 'on_failure');
    return [
        { key: 'name', label: 'Give the job a name', done: Boolean((job.name || '').trim()), optional: false, tab: 'steps' },
        { key: 'steps', label: 'Add a step', done: steps.length > 0, optional: false, tab: 'steps' },
        { key: 'searches', label: "Write each step's search", done: searchesDone, optional: false, tab: 'steps' },
        {
            key: 'schedule',
            label: 'Choose when it runs (optional; you can also start it by hand)',
            done: scheduled,
            optional: true,
            tab: 'steps',
            ...(triggers.length ? { node: triggerKey(0) } : { addKinds: TRIGGER_KINDS }),
        },
        {
            key: 'notify',
            label: "Choose who hears about failures (optional; otherwise the admin's fallback notification is used)",
            done: notified,
            optional: true,
            tab: 'actions',
        },
    ];
}
