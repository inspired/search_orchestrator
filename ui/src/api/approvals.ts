/* Approve or reject a run's approval step (bin/so/approval_api.py). The engine applies the
 * decision on its next tick, so the run shows it a few seconds later. Errors: 400
 * bad_request (a reject without a comment, a comment over 1000 characters), 403 forbidden
 * (no orchestrator_approve, or not in the step's approver roles; the message says which),
 * 404 not_found, 409 not_awaiting_approval (already decided or not waiting). */
import { enc, request } from './client';

export function decide(runId: string, stepId: string, decision: 'approve' | 'reject', comment: string): Promise<{ command_id: string }> {
    return request('POST', `runs/${enc(runId)}/approve`, { body: { step_id: stepId, decision, comment } });
}
