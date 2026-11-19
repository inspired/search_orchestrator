/** The Troubleshooting page for one run (and step): every level, the last 7 days. */
import { pageHref } from '../../components/PageShell';

export function logsHref(runId: string, stepId?: string): string {
    const query: Record<string, string> = { run_id: runId, level: 'DEBUG', range: '7d' };
    if (stepId) {
        query.step_id = stepId;
    }
    return pageHref('logs', query);
}
