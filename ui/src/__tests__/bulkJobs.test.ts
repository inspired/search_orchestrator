import { plan, resultTone, runEach } from '../features/jobs/bulkJobs';
import { job as makeJob, me } from './fixtures';

const mine = makeJob({ id: 'a', name: 'Alpha', owner: me.user, enabled: true, tags: ['x'] });
const theirs = makeJob({ id: 'b', name: 'Beta', owner: 'bob', enabled: false });
const readOnly = makeJob({ id: 'c', name: 'Gamma', owner: 'bob', enabled: true, permissions: { can_edit: false, can_run: false } } as never);

describe('bulk job plans', () => {
    test('enable skips jobs already enabled and jobs you cannot edit', () => {
        const p = plan([mine, theirs, readOnly], 'enable', me);
        expect(p.targets.map((j) => j.id)).toEqual(['b']);
        expect(p.skipped).toEqual([
            { job: mine, reason: 'already enabled' },
            { job: readOnly, reason: "you can't edit it" },
        ]);
    });

    test('disable takes enabled jobs you can edit', () => {
        expect(plan([mine, theirs, readOnly], 'disable', me).targets.map((j) => j.id)).toEqual(['a']);
    });

    test('run takes jobs you can run', () => {
        const p = plan([mine, readOnly], 'run', me);
        expect(p.targets.map((j) => j.id)).toEqual(['a']);
        expect(p.skipped[0].reason).toBe("you can't run it");
    });

    test("add tag only takes your own jobs, since saving another person's job makes you its owner", () => {
        const p = plan([mine, theirs], 'tag', me, 'nightly');
        expect(p.targets.map((j) => j.id)).toEqual(['a']);
        expect(p.skipped).toEqual([{ job: theirs, reason: 'owned by bob; adding a tag would make you its owner' }]);
        expect(plan([mine], 'tag', me, 'X').skipped).toEqual([{ job: mine, reason: 'already tagged X' }]);
    });

    test("add tag skips every job until you are known, so nothing changes owner by accident", () => {
        [null, undefined].forEach((who) => {
            const p = plan([mine, theirs], 'tag', who, 'nightly');
            expect(p.targets).toHaveLength(0);
            expect(p.skipped.map((s) => s.reason)).toEqual(["your user details haven't loaded", "your user details haven't loaded"]);
        });
    });

    test('delete takes jobs you can edit; export takes every job', () => {
        expect(plan([mine, theirs, readOnly], 'delete', me).targets.map((j) => j.id)).toEqual(['a', 'b']);
        expect(plan([mine, theirs, readOnly], 'export', me).targets).toHaveLength(3);
    });

    test('runEach calls one by one and reports each outcome', async () => {
        const fn = jest.fn((j: { id: string }) => (j.id === 'b' ? Promise.reject(new Error('KV Store error')) : Promise.resolve()));
        const out = await runEach([mine, theirs], fn);
        expect(fn).toHaveBeenCalledTimes(2);
        expect(out).toEqual([
            { job: mine, ok: true },
            { job: theirs, ok: false, message: 'KV Store error' },
        ]);
    });

    test('result tone: warning on any skip or failure, info when nothing ran, success otherwise', () => {
        expect(resultTone([{ job: mine, ok: true }], [])).toBe('success');
        expect(resultTone([{ job: mine, ok: false, message: 'x' }], [])).toBe('warning');
        expect(resultTone([], [{ job: theirs, reason: 'r' }])).toBe('warning');
        expect(resultTone([], [])).toBe('info');
    });
});
