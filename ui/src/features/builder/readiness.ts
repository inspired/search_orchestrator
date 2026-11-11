/* What a job still needs before it is ready, for the setup checklist. */
import type { Issue, JobDefinition } from '../../api/types';
import type { TabId } from './JobTabs';

export interface ChecklistItem {
    key: 'name' | 'steps' | 'searches' | 'schedule' | 'notify';
    label: string;
    done: boolean;
    optional: boolean;
    tab: TabId;
}

/** `checked`: the server issues come from a check of this very job; before that, a missing
 * `no_failure_notification` only means nobody has asked. */
export function readiness(job: JobDefinition, issues: Issue[], checked: boolean): ChecklistItem[] {
    const steps = job.steps || [];
    const searchesDone =
        steps.length > 0 &&
        steps.every((s) => (s.type === 'saved_search' ? Boolean((s.saved_search_ref || '').trim()) : Boolean((s.spl || '').trim())));
    const scheduled = (job.triggers || []).some((t) => t.type === 'cron' || t.type === 'completion');
    const failureAction = [...(job.actions || []), ...steps.flatMap((s) => s.actions || [])].some(
        (a) => a.hook === 'on_failure' || a.hook === 'on_complete'
    );
    const notified = failureAction || (checked && !issues.some((i) => i.code === 'no_failure_notification'));
    return [
        { key: 'name', label: 'Give the job a name', done: Boolean((job.name || '').trim()), optional: false, tab: 'steps' },
        { key: 'steps', label: 'Add a step', done: steps.length > 0, optional: false, tab: 'steps' },
        { key: 'searches', label: "Write each step's search", done: searchesDone, optional: false, tab: 'steps' },
        {
            key: 'schedule',
            label: 'Choose when it runs (optional; you can also start it by hand)',
            done: scheduled,
            optional: true,
            tab: 'triggers',
        },
        { key: 'notify', label: 'Choose who hears about failures', done: notified, optional: true, tab: 'actions' },
    ];
}
