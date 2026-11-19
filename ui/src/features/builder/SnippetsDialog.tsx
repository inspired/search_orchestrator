/* The Snippets dialog (builder toolbar, Snippets…): every snippet with its owner, node count and
 * last change. The owner or an admin can rename one or, after a question, delete it. Rename and
 * the question take the dialog's place until they are done or cancelled. */
import React, { useRef, useState } from 'react';
import Button from '@splunk/react-ui/Button';
import Message from '@splunk/react-ui/Message';
import Modal from '@splunk/react-ui/Modal';
import Table from '@splunk/react-ui/Table';
import WaitSpinner from '@splunk/react-ui/WaitSpinner';
import type { SnippetInfo } from '../../api/snippets';
import type { Me } from '../../api/types';
import { formatTime } from '../../format';
import { useSnippetForm } from './SaveSnippetDialog';

export interface SnippetsDialogProps {
    snippets: SnippetInfo[] | null;
    error: string | null;
    me: Me;
    onRename: (id: string, s: { name: string; description: string }) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onClose: () => void;
    returnFocus?: React.MutableRefObject<HTMLElement | null>;
}

type View = { kind: 'list' } | { kind: 'rename' | 'delete'; snippet: SnippetInfo };

export const mayChange = (me: Me, s: SnippetInfo) => me.can_admin || s.owner === me.user;

export default function SnippetsDialog({ snippets, error, me, onRename, onDelete, onClose, returnFocus }: SnippetsDialogProps) {
    const [view, setView] = useState<View>({ kind: 'list' });
    const focused = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
    const back = () => setView({ kind: 'list' });
    let body: React.ReactNode;
    if (view.kind === 'rename') {
        body = <RenameSnippet key={view.snippet.id} snippet={view.snippet} onRename={(s) => onRename(view.snippet.id, s).then(back)} onCancel={back} />;
    } else if (view.kind === 'delete') {
        body = <DeleteSnippet key={view.snippet.id} snippet={view.snippet} onDelete={() => onDelete(view.snippet.id).then(back)} onCancel={back} />;
    } else {
        body = (
            <>
                <Modal.Header title="Snippets" />
                <Modal.Body>
                    {error && (
                        <Message type="error" appearance="default">
                            {error}
                        </Message>
                    )}
                    {!snippets && !error && <WaitSpinner size="medium" />}
                    {snippets && !snippets.length && <p>No snippets yet. Select nodes on the canvas and choose Save as snippet.</p>}
                    {snippets && snippets.length > 0 && (
                        <Table>
                            <Table.Head>
                                <Table.HeadCell>Name</Table.HeadCell>
                                <Table.HeadCell>Owner</Table.HeadCell>
                                <Table.HeadCell>Nodes</Table.HeadCell>
                                <Table.HeadCell>Updated</Table.HeadCell>
                                <Table.HeadCell>Actions</Table.HeadCell>
                            </Table.Head>
                            <Table.Body>
                                {snippets.map((s) => (
                                    <Table.Row key={s.id}>
                                        <Table.Cell>
                                            {s.name}
                                            {s.description && <div style={{ fontSize: '12px' }}>{s.description}</div>}
                                        </Table.Cell>
                                        <Table.Cell>{s.owner}</Table.Cell>
                                        <Table.Cell>{s.node_count}</Table.Cell>
                                        <Table.Cell>{formatTime(s.updated_at)}</Table.Cell>
                                        <Table.Cell>
                                            {mayChange(me, s) && (
                                                <>
                                                    <Button appearance="subtle" inline label="Rename" onClick={() => setView({ kind: 'rename', snippet: s })} />
                                                    <Button appearance="subtle" inline label="Delete" onClick={() => setView({ kind: 'delete', snippet: s })} />
                                                </>
                                            )}
                                        </Table.Cell>
                                    </Table.Row>
                                ))}
                            </Table.Body>
                        </Table>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button appearance="secondary" label="Close" onClick={onClose} />
                </Modal.Footer>
            </>
        );
    }
    return (
        <Modal open onRequestClose={view.kind === 'list' ? onClose : back} returnFocus={returnFocus || focused} style={{ width: '720px' }}>
            {body}
        </Modal>
    );
}

function RenameSnippet({ snippet, onRename, onCancel }: { snippet: SnippetInfo; onRename: (s: { name: string; description: string }) => Promise<void>; onCancel: () => void }) {
    const form = useSnippetForm(snippet, onRename);
    return (
        <>
            <Modal.Header title={`Rename snippet ${snippet.name}`} />
            <Modal.Body>{form.fields}</Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Cancel" onClick={onCancel} />
                <Button appearance="primary" label="Rename snippet" disabled={form.busy} onClick={form.submit} />
            </Modal.Footer>
        </>
    );
}

function DeleteSnippet({ snippet, onDelete, onCancel }: { snippet: SnippetInfo; onDelete: () => Promise<void>; onCancel: () => void }) {
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const go = async () => {
        setBusy(true);
        try {
            await onDelete();
        } catch (err) {
            setError(`The snippet was not deleted: ${(err as Error).message}`);
            setBusy(false);
        }
    };
    return (
        <>
            <Modal.Header title={`Delete snippet ${snippet.name}?`} />
            <Modal.Body>
                {error && (
                    <Message type="error" appearance="default">
                        {error}
                    </Message>
                )}
                <p>Nobody can insert it after this. Jobs that already hold its nodes keep them.</p>
            </Modal.Body>
            <Modal.Footer>
                <Button appearance="secondary" label="Cancel" onClick={onCancel} />
                <Button appearance="destructive" label="Delete snippet" disabled={busy} onClick={go} />
            </Modal.Footer>
        </>
    );
}
