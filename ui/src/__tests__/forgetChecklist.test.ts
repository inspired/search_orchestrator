import forgetChecklist from '../features/builder/forgetChecklist';

test('removes what the old setup checklist left in this browser and nothing else', () => {
    window.localStorage.setItem('so.checklist.hidden.abc', '1');
    window.localStorage.setItem('so.checklist.hidden.new', '1');
    window.localStorage.setItem('so.builder.view', 'standard');
    forgetChecklist();
    expect(window.localStorage.getItem('so.checklist.hidden.abc')).toBeNull();
    expect(window.localStorage.getItem('so.checklist.hidden.new')).toBeNull();
    expect(window.localStorage.getItem('so.builder.view')).toBe('standard');
    window.localStorage.clear();
});
