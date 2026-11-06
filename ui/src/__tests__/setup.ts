import '@testing-library/jest-dom';

// Splunk Web's page config, read by @splunk/splunk-utils when it is first imported.
(window as unknown as { $C: unknown }).$C = {
    MRSPARKLE_PORT_NUMBER: '8000',
    SPLUNKD_PATH: '/en-US/splunkd/__raw',
    LOCALE: 'en-US',
    MRSPARKLE_ROOT_PATH: '',
};
