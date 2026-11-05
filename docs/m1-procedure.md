# Milestone 1: identity spike procedure

**Test-only.** `scripts/m1_setup.sh` creates throwaway users, roles, an index and saved searches, so it is meant for a test server only. Run `--cleanup` when the milestone is closed. The spike engine and this procedure are removed in Task 6.

The spike answers spec §9's go/no-go question: can a modular input's system session dispatch saved searches that run with the identity and access of their owner? An admin-owned test would pass without proving anything, so this uses a restricted user and an index that user can't read.

## What the script creates

| Object | Purpose |
|---|---|
| Index `so_m1_secret`, with one seed event | Data that only one of the test users can read |
| Role `so_m1_role`: `srchIndexesAllowed = main`, `srchIndexesDefault = main`, no imported roles, capabilities `search` and `rest_properties_get` | Cannot read `so_m1_secret` |
| User `so_m1_user` with that role | The owner being tested |
| Role `so_m1_owner2_role`: allowed and default index `so_m1_secret`, same capabilities | Can read `so_m1_secret` |
| User `so_m1_owner2` with that role | A second owner, for wrapper mode |
| Private hidden searches owned by `so_m1_user`, saved with that user's session: `_so_spike_identity`, `_so_spike_secret`, `_so_spike_args`, `_so_spike_now`, `_so_spike_loadjob`, `_so_spike_long`, `_so_spike_wrapper` | What the engine dispatches |
| `_so_spike_shared`, owned by `so_m1_owner2`, shared in the app, `dispatchAs = owner` | The other owner's search that wrapper mode reaches |

Everything created carries evidence of the script: `realname` on users, `description` on searches, `rtSrchJobsQuota = 1371` on roles (inert, as they can't run real-time searches), and the word `so_m1_setup_fixture` in the index's seed event. Setup checks first and refuses to reuse any user, role or index without that evidence, changing nothing. `--cleanup` skips anything without it and prints a warning, so check those objects by hand.

If Splunk refuses a save as `so_m1_user` with HTTP 403, the script adds `edit_search_schedule_window` to both roles, says so, and retries. That capability gives no index access.

## Requirements

- A standalone Splunk Enterprise server with its management port reachable. The script creates its index over REST, which Splunk Cloud and indexer clusters don't allow.
- `bash`, `curl` and `openssl` where the script runs.
- A local admin account that can log in with a password, since single sign-on and multi-factor logins won't work with the script.

## Procedure

1. Install the app build and restart Splunk if prompted. The spike runs at this point too and records failures, because the fixtures don't exist yet. That's expected.
2. Run the script. Add `--insecure` only if the management port uses a self-signed certificate. A plain `http://` host is refused unless you add `--allow-http`, because passwords would travel unencrypted:

   ```
   scripts/m1_setup.sh --host https://<server>:8089 [--insecure] [--allow-http]
   ```

   It asks for an admin username and password, and for a test-user password, which it generates if left blank. Passwords are not stored or printed, and they don't appear in process listings. The script is safe to re-run. Each run resets the test-user password.
3. Restart Splunk. The engine clears old rows and runs the checks once per start.
4. After about 5 minutes, run this as an admin. The sequence has finished when a `done` row is present:

   ```
   | inputlookup so_spike_results | table check ok detail sid at
   ```

   Rows are also logged to `splunkd.log`, in case KV Store isn't available:

   ```
   index=_internal sourcetype=splunkd "so_spike"
   ```

5. Tell the builder, who verifies the rows over MCP against the table below.
6. When the milestone is closed, and before uninstalling the app, remove the test objects:

   ```
   scripts/m1_setup.sh --host https://<server>:8089 [--insecure] [--allow-http] --cleanup
   ```

## Reading the results

Each row has `check`, `ok` (0 or 1), `detail` (raw observations as JSON), `sid` and `at` (epoch seconds). `ok` only says whether the observation matched what's expected below, so read `detail` as well. A failed check doesn't stop later ones, unless they depend on its job.

| `check` | `ok = 1` means |
|---|---|
| `system_session_identity` | Recorded what the system session resolves to, for comparison with `identity` |
| `secret_control` | The system session counts at least one event in `so_m1_secret`. If this fails, `index_access` proves nothing |
| `identity` | `_so_spike_identity` ran with `username = so_m1_user`, and roles are exactly `so_m1_role` |
| `index_access` | `_so_spike_secret` finished with count 0 |
| `args` | `v` was substituted, and `literal = foo$` and `other = $unknown$` were unchanged |
| `scheduled_time` | `info_min_time` was computed from a `dispatch.now` 7 days ago, sent as epoch seconds |
| `scheduled_time_iso` | The same, sent as an ISO 8601 string with `dispatch.time_format` |
| `job_status_read`, `job_results_read` | The system session reads the status and results of the `identity` job |
| `job_touch` | `touch` was accepted, the job stayed readable, and its TTL afterwards is at least what it was before |
| `job_setttl` | `setttl` was accepted and the TTL afterwards reflects the value set: at most 60 seconds below it |
| `job_cancel` | `_so_spike_long` was running, and after the cancel its status is 404 or its `dispatchState` is `FINALIZING` or `CANCELED`. A job already over beforehand, or one that shows as failed or done afterwards, gives `ok = 0`, because the cancel isn't proven. `detail` records `before_state` |
| `loadjob` | `_so_spike_loadjob`, as `so_m1_user`, read the `identity` job by search ID |
| `wrapper_mode` | `_so_spike_wrapper` reached `_so_spike_shared`, belongs to `so_m1_user`, and returned count 0, so it ran with `so_m1_user`'s access |
| `shared_direct_owner_ns`, `shared_direct_user_ns` | A direct dispatch of `_so_spike_shared`, in the `so_m1_owner2` and `so_m1_user` namespaces, returned a count above 0 and belongs to `so_m1_owner2` |
| `workload_pool`, `workload_pool_prefixed` | Dispatch with `workload_pool`, or `dispatch.workload_pool`, was accepted and the job reports that pool. A failure on both drops `workload_pool` from the first version |
| `system_dispatch_ad_hoc` | Informational, for the alternative route: a direct `search/jobs` POST in `so_m1_user`'s namespace ran as `so_m1_user`. `detail` records the username observed |
| `done` | Every expected check's row was written. `detail` has `expected` (count), `checks` (names written), `missing`, and `failed` (checks that didn't match). `ok = 0` means a partial run, and `missing` says what's absent |

**On any `identity` or `index_access` failure, stop.** Spec §9's fallback is the owner's decision.

## Findings

Pending. Recorded here after the owner has run the procedure.
