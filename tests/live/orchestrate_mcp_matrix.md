# `| orchestrate` live matrix

Run through the Splunk MCP server (`splunk_run_query`, app `search_orchestrator`), against a
server that has the app installed. Pytest cannot reach it; `tests/test_orchestrate_robustness.py`
is the offline half and these are the things only a real splunkd can answer.

**Safety.** Groups A and B change nothing. Group C only touches the `so_selftest*` jobs. Never
start, cancel or re-run any other job. Never send `slow_n` above 2000. Never send
`scheduled_time=1e300` or similar to a server running 1.1.1 or older: it is stored.

`F:` names the finding in the offline suite that the case confirms on a real server.

## A. Input handling (read-only)

| # | SPL | Expected |
|---|-----|----------|
| A1 | `\| orchestrate` | error: first argument must be one of ... |
| A2 | `\| orchestrate explode` | same error |
| A3 | `\| makeresults \| orchestrate jobs` | Splunk refuses a generating command mid-pipeline |
| A4 | `\| orchestrate jobs "no equals"` | `expected name=value`; shows how Splunk delivers a quoted argument |
| A5 | `\| orchestrate status limit=abc` | error: limit must be a number |
| A6 | `\| orchestrate status limit=0 \| stats dc(run_id)` | 1 |
| A7 | `\| orchestrate status limit=999 \| stats dc(run_id)` | 20 at most |
| A8 | `\| orchestrate status run=nope:1` | error, `not_found` |
| A9 | `\| orchestrate status run=../health` | F:L3 refused before any call: `run can't contain /` |
| A10 | `\| orchestrate status run=../../server/info` | F:L3 same |
| A11 | `\| orchestrate status run="" \| stats dc(run_id)` | F:L2 error: `run has no value` |
| A12 | `\| orchestrate status job=nope` | no rows, no error |
| A13 | `\| orchestrate start job=nope` | error, `not_found` |
| A14 | `\| orchestrate start job="bad id"` | error, `not_found` |
| A15 | `\| orchestrate selftest scenario=bogus` | error, `bad_request`, nothing saved |
| A16 | `\| orchestrate selftest scenario=rollup_late slow_n=0` | error, `bad_request` |
| A17 | `\| orchestrate selftest scenario=rollup_late slow_n=100001` | error, `bad_request` |
| A18 | `\| orchestrate rerun run=<a cancelled so_selftest run> step="a b"` | `unknown_step` echoing `a b`, so the quotes were removed correctly |
| A19 | `\| orchestrate status limit=1 \| stats count by state` | the command feeds later commands |
| A20 | For each error above | The search job ends FAILED. The MCP caller gets only `Search job failed (sid: ...)`; the reason is in the job's `messages.fatal` |

## B. Performance (read-only)

Run each five times, then read `total_run_time` from `index=_audit action=search info=completed`.

| # | SPL | Expected |
|---|-----|----------|
| B1 | `\| orchestrate jobs` | median under 3 s |
| B2 | `\| orchestrate status limit=1` | median under 3 s |
| B3 | `\| orchestrate status limit=20` | median under 10 s |
| B4 | three of B3 in parallel | no errors, under twice the serial time |

## C. Behaviour (self-test jobs only)

| # | SPL | Expected |
|---|-----|----------|
| C1 | `\| orchestrate selftest`, then poll `status run=...` | run succeeds; `skip_me` skipped; `flaky` 2 attempts |
| C2 | `\| orchestrate start job=so_selftest scheduled_time=inf` | F:L5 `bad_request`; no run is created |
| C3 | `\| orchestrate start job=so_selftest param.typo=1` | F:L4 `bad_param`; no run is created |
| C4 | `\| orchestrate cancel run=<succeeded so_selftest run>` | F:L7 `invalid_state`; no command is queued |
| C5 | three `\| orchestrate start job=so_selftest` at once | three run ids; runs do not overlap |
| C6 | `\| orchestrate selftest scenario=rollup_late slow_n=2000`, then `cancel` | run ends `cancelled`; the daily search stops |
| C7 | `\| orchestrate selftest scenario=rollup_fail`, then `rerun run=... step=daily definition=original` | the re-run succeeds |
| C8 | A search-preview start from Splunk Web, then count runs created | F:L8 exactly one run |

Afterwards `| orchestrate status job=<each so_selftest job>` must show nothing active.
