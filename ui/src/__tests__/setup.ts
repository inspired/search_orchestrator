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
