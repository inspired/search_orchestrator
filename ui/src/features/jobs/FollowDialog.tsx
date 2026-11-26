/* Follow a job: be told when it fails, is late, is delayed or succeeds, by email to your own
 * Splunk address, without editing
 * the job. Unfollow stops it. */
import React, { useEffect, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import Switch from '@splunk/react-ui/Switch';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import * as client from '../../api/client';
import type { FollowEvent, FollowNotify } from '../../api/client';
import type { Job } from '../../api/types';

export const EVENT_LABEL: Record<FollowEvent, string> = {
    failure: 'It fails',
    late: 'It misses its deadline',
    delayed: 'A step is delayed',
    success: 'It succeeds',
};
const EVENTS: FollowEvent[] = ['failure', 'late', 'delayed', 'success'];

export interface FollowApi {
    getFollow: typeof client.getFollow;
    putFollow: typeof client.putFollow;
    deleteFollow: typeof client.deleteFollow;
}

const defaultApi: FollowApi = { getFollow: client.getFollow, putFollow: client.putFollow, deleteFollow: client.deleteFollow };

export interface FollowDialogProps {
    job: Job;
    onClose: () => void;
    onChanged: () => void;
    returnFocus: React.MutableRefObject<HTMLElement | null>;
    api?: FollowApi;
}

export default function FollowDialog({ job, onClose, onChanged, returnFocus, api = defaultApi }: FollowDialogProps) {
    const [loading, setLoading] = useState(true);
    const [following, setFollowing] = useState(false);
    const [email, setEmail] = useState<string | null>(null);
    const [on, setOn] = useState<FollowEvent[]>(['failure', 'late']);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let live = true;
        api.getFollow(job.id)
            .then((r) => {
                if (!live) {
                    return;
                }
                setEmail(r.email);
                if (r.follow) {
                    setFollowing(true);
                    setOn(r.follow.on);
                }
            })
            .catch((e: Error) => live && setError(e.message))
            .finally(() => live && setLoading(false));
        return () => {
            live = false;
        };
    }, [api, job.id]);

    const toggle = (e: FollowEvent) => setOn((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : EVENTS.filter((x) => x === e || cur.includes(x))));
    const notify: FollowNotify = { type: 'email' };
    const noEmail = notify.type === 'email' && !email;

    const save = async () => {
        setSaving(true);
        setError(null);
        try {
            await api.putFollow(job.id, on, notify);
            onChanged();
            onClose();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(false);
        }
    };
    const unfollow = async () => {
        setSaving(true);
        setError(null);
        try {
            await api.deleteFollow(job.id);
            onChanged();
            onClose();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open onRequestClose={onClose} returnFocus={returnFocus} style={{ width: '520px' }}>
            <Modal.Header title={`${following ? 'Following' : 'Follow'} ${job.name}`} />
            <Modal.Body>
                {error && (
                    <Message type="error" appearance="default">
                        {error}
                    </Message>
                )}
                {loading ? (
                    <WaitSpinner size="medium" />
                ) : (
                    <>
                        <p style={{ marginTop: 0 }}>Be told about this job without changing it. Only you get these messages; they name the job, what happened and link to the run, never its results.</p>
                        <ControlGroup label="Tell me when" labelPosition="top">
                            <div data-testid="follow-events">
                                {EVENTS.map((e) => (
                                    <Switch key={e} appearance="checkbox" selected={on.includes(e)} onClick={() => toggle(e)}>
                                        {EVENT_LABEL[e]}
                                    </Switch>
                                ))}
                            </div>
                        </ControlGroup>
                        <p data-testid="follow-how" style={{ margin: '8px 0 0' }}>
                            {email ? `By email to ${email} (your Splunk account's address).` : 'Your Splunk account has no email address. Add one in your account settings to follow jobs.'}
                        </p>
                    </>
                )}
            </Modal.Body>
            <Modal.Footer>
                {following && <Button appearance="secondary" label="Unfollow" disabled={saving} onClick={unfollow} />}
                <Button appearance="secondary" label="Cancel" onClick={onClose} />
                <Button appearance="primary" label={following ? 'Save' : 'Follow'} disabled={loading || saving || !on.length || noEmail} onClick={save} />
            </Modal.Footer>
        </Modal>
    );
}
