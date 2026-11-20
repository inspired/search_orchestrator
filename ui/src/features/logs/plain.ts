/* Errors in plain words for the Troubleshooting page. The log lines keep Splunk's and Python's
 * wording (HTTP codes, errno, byte strings, search ids); a line's title says what it means, and
 * the line as written stays in its details. The problems search (logs_api.problems_query) uses
 * the same wording for the same errors. */

/** Who the app was talking to when it failed: Splunk itself, or an action's receiver (mail
 * server, webhook URL). Connection errors mean different things for each. */
export type ErrorContext = 'splunk' | 'action';

const KV_STARTING = /KV Store is initializing|KV Store is (starting|not ready)/i;
const MAIL = /while sending mail to:?\s*([^\s,;]+)?/i;
const REFUSED = /\[Errno 111\]|connection refused|connection error/i;

/** Splunk search ids in a text as words: a step's hidden search, a scheduled search. */
export function cleanIds(text: string): string {
    return text
        .replace(/\b(?:search )?_[A-Za-z0-9+/=]{16,}__[^\s:,]+/g, 'a step search')
        .replace(/\b(?:search )?scheduler__[^\s:,]+/g, 'a scheduled search');
}

/** A short, plain sentence for an error, or '' for none. */
export function plainError(raw?: string | null, context: ErrorContext = 'splunk'): string {
    let e = (raw || '').trim();
    if (!e) {
        return '';
    }
    e = e.replace(/^a call to Splunk failed:\s*/i, '');
    if (KV_STARTING.test(e)) {
        return 'KV Store was still starting up';
    }
    const mail = e.match(MAIL);
    if (mail || /sendemail/i.test(e)) {
        const to = mail && mail[1] ? ` to ${mail[1]}` : '';
        return REFUSED.test(e) || /timed? ?out/i.test(e) ? `Splunk could not reach its mail server to send the email${to}` : `Splunk could not send the email${to}`;
    }
    if (REFUSED.test(e)) {
        return context === 'action' ? 'the receiver did not answer (connection refused)' : 'Splunk was not answering (it may have been starting or stopping)';
    }
    if (/connection reset|broken pipe/i.test(e)) {
        return context === 'action' ? 'the connection to the receiver was cut off' : 'the connection to Splunk was cut off';
    }
    if (/timed? ?out/i.test(e)) {
        return context === 'action' ? 'the receiver did not answer in time' : 'Splunk did not answer in time';
    }
    if (/no longer exists: it expired/i.test(e)) {
        return 'the search had already expired';
    }
    // Splunk's own message inside a response body: b'{"messages":[{"type":"ERROR","text":"…"}]}'
    const text = e.match(/"text"\s*:\s*"((?:[^"\\]|\\.)+)"/);
    if (text) {
        e = text[1].replace(/\\(.)/g, '$1');
    }
    return cleanIds(e.replace(/\s*--\s*b'.*$/s, ''))
        .replace(/^HTTPError$/, 'Splunk refused the call')
        .split('\n')[0]
        .slice(0, 200)
        .trim();
}

const VERB: Record<string, string> = {
    loaded: 'load',
    listed: 'list',
    opened: 'open',
    saved: 'save',
    deleted: 'delete',
    created: 'create',
    checked: 'check',
    started: 'start',
    enabled: 'enable',
    disabled: 'disable',
    looked: 'look',
    restored: 'restore',
    decided: 'decide',
    tested: 'test',
    viewed: 'view',
    previewed: 'preview',
    stopped: 'stop',
    read: 'read',
    changed: 'change',
    cancelled: 'cancel',
    searched: 'search',
    worked: 'work',
    resolved: 'resolve',
    ran: 'run',
};

/** "loaded the runs list" → "load the runs list", for "could not …"; "enabled or disabled"
 * turns both verbs, and "asked to cancel" becomes "cancel". */
export function infinitive(pastTense: string): string {
    const t = pastTense.replace(/^asked to /, '').replace(/^enabled or disabled\b/, 'enable or disable');
    const [first, ...rest] = t.split(' ');
    return [VERB[first] || first, ...rest].join(' ');
}
