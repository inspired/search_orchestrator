import '@testing-library/jest-dom';

// Splunk Web's page config, read by @splunk/splunk-utils when it is first imported.
(window as unknown as { $C: unknown }).$C = {
    MRSPARKLE_PORT_NUMBER: '8000',
    SPLUNKD_PATH: '/en-US/splunkd/__raw',
    LOCALE: 'en-US',
    MRSPARKLE_ROOT_PATH: '',
};

// jsdom has no PointerEvent, so fireEvent.pointer* would drop clientX/clientY. A
// MouseEvent subclass keeps them, which the canvas's drag gestures read.
if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
        pointerId: number;

        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
        }
    }
    (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}

// The builder opens in Simple for new browsers; the builder tests drive Flow unless a
// test picks Simple itself.
beforeEach(() => {
    try {
        window.localStorage.setItem('so.builder.view', 'flow');
    } catch (err) {
        // no storage in this environment
    }
});

// The Runs page groups by job for new browsers; its tests use the flat list unless they pick.
beforeEach(() => {
    try {
        window.localStorage.setItem('so.runs.grouped', '0');
    } catch (err) {
        // no storage in this environment
    }
});
