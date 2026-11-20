# Search Orchestrator

A Splunk app that runs dependent searches as one unit: a job is a graph of search steps with schedules, conditions, retries, delays, deadlines and actions, so a weekly rollup never runs on top of an unfinished daily summary.

## Credits

Based on [inspired/search_orchestrator](https://github.com/inspired/search_orchestrator) by Mikael Bjerkeland, who wrote the original design, engine and app shell. This repo continues that work together with him.

## Try it

1. Download `search_orchestrator-<version>.tgz` from the [latest release](https://github.com/lyderhansen/search_orchestrator/releases/latest).
2. In Splunk: **Apps > Manage Apps > Install app from file**, then restart if asked.
3. Open **Search Orchestrator**, then **Jobs > Browse examples** for 18 ready-made jobs that use only data every Splunk has.

Supported: Splunk Enterprise 9.4 and later (standalone search head) and Splunk Cloud Victoria. Roles, the audit index and settings are in the [admin guide](docs/admin-guide.md); building and running jobs is in the [user guide](docs/user-guide.md).

This is a test release. Please report problems as [issues](https://github.com/lyderhansen/search_orchestrator/issues).

## Build from source

```sh
scripts/package.sh <version>      # writes dist/search_orchestrator-<version>.tgz
scripts/appinspect.sh dist/search_orchestrator-<version>.tgz
```

Tests: `python3 -m pytest -q tests` and, in `ui/`, `npx jest`.
