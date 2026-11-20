/* A jsdom test environment that runs one test file in another time zone. Jest gives each
 * test file a copy of process.env, so setting TZ inside a test does not change how Date
 * reads local time; this sets the worker's real TZ for the file and restores it after.
 *
 * Use with a docblock at the top of the test file:
 *   @jest-environment ./jest/timezoneEnvironment.js
 *   @jest-environment-options {"timezone": "Europe/Oslo"}
 */
const { TestEnvironment } = require('jest-environment-jsdom');

class TimezoneEnvironment extends TestEnvironment {
    constructor(config, context) {
        super(config, context);
        this.timezone = (config.projectConfig.testEnvironmentOptions || {}).timezone;
    }

    async setup() {
        await super.setup();
        this.previousTZ = process.env.TZ;
        if (this.timezone) {
            process.env.TZ = this.timezone;
            this.global.process.env.TZ = this.timezone;
        }
    }

    async teardown() {
        if (this.previousTZ === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = this.previousTZ;
        }
        await super.teardown();
    }
}

module.exports = TimezoneEnvironment;
