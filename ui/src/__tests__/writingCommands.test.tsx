import { writingCommand } from '../features/builder/writingCommands';

describe('writingCommand', () => {
    test.each([
        ['index=a | collect index=s', 'collect'],
        ['| OutputLookup x.csv', 'outputlookup'],
        ['index=a [ search index=b | outputcsv f ]', 'outputcsv'],
        ['| makeresults | delete', 'delete'],
        ['index=a | eval collect=1', null],
        ['index=a "| collect"', null],
        ['index=a | eval x="a \\" | collect"', null],
        ['index=a | eval x=a||delete', null],
        ['index=a | collectfoo', null],
        ['index=a | stats count', null],
        ['', null],
        ['index=a `m | collect index=s', 'collect'],
    ])('%s', (spl, expected) => {
        expect(writingCommand(spl)).toBe(expected);
    });
    test('the first writing command wins', () => {
        expect(writingCommand('| sendemail to=a | collect index=s')).toBe('sendemail');
    });
});
