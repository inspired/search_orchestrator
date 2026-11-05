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
| `_so_spike_shared`, owned by `so_m1_owner2`, shared in the app, `dispatchAs = owner` set by an admin | The other owner's search that wrapper mode reaches |

Everything created carries evidence of the script: `realname` on users, `description` on searches, `rtSrchJobsQuota = 1371` on roles (inert, as they can't run real-time searches), and the word `so_m1_setup_fixture` in the index's seed event. Setup checks first and refuses to reuse any user, role or index without that evidence, changing nothing. `--cleanup` skips anything without it and prints a warning, so check those objects by hand.

The script saves searches with the restricted user's session and sends only what's needed, because Splunk refuses scheduling, alert and action arguments from a user without `schedule_search` (seen on 10.6.1.1 with `is_scheduled`). New searches are unscheduled by default. `dispatchAs = owner` is set by an admin, on the shared search only.

If Splunk still refuses a save, the script says so and does the least it can, and none of these steps gives index access:

- HTTP 403: it adds `edit_search_schedule_window` to both roles and retries.
- `is_visible` or `description` refused: it adds `schedule_search` to both roles and retries. If that's refused too, it saves without the argument and sets it afterwards as admin, which keeps the owner, so `description` still works as evidence. If that also fails, it warns, and `--cleanup` skips that search.
- Anything else: it prints Splunk's message against that search, carries on with the others, and exits with an error listing the searches not saved. Fix the cause and re-run.

## Requirements

- A standalone Splunk Enterprise server with its management port reachable. The script creates its index over REST, which Splunk Cloud and indexer clusters don't allow.
- `bash`, `curl` and `openssl` where the script runs.
- A local admin account that can log in with a password, since single sign-on and multi-factor logins won't work with the script.

## Procedure

1. Install the app build `dist/search_orchestrator-0.0.4.tgz` and restart Splunk if prompted. On 0.0.3 and earlier splunkd never registered the input, so the spike didn't run. To check it's registered: `| rest /services/data/modular-inputs splunk_server=local | search title=orchestrator_engine`. The spike runs at this point too and records failures, because the fixtures don't exist yet. That's expected.
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

The spike ran from build 0.0.4 on Splunk 10.6.1.1, with the engine on Python 3.13.11. Every row was written, and `done` was `ok = 1`.

### Results

| `check` | Result | Observed |
|---|---|---|
| `identity` | Pass | `username = so_m1_user`, roles `so_m1_role`, job `acl_owner = so_m1_user` |
| `secret_control` | Pass | Count 1 |
| `index_access` | Pass | Count 0 |
| `args` | Pass | `v` substituted. `literal = "foo$"` and `other = "$unknown$"` unchanged |
| `scheduled_time` | Pass | With epoch `dispatch.now`, `info_min_time = 1793145600`, which is `-1d@d` of the time sent |
| `scheduled_time_iso` | Fail | An ISO 8601 `dispatch.now` was ignored: `info_min_time` came from the real current time |
| `job_status_read`, `job_results_read` | Pass | |
| `job_touch` | Pass | TTL 600 before and 600 after |
| `job_setttl` | Pass | TTL 1234 |
| `job_cancel` | Pass | `PARSING` before the cancel, then 404 |
| `loadjob` | Pass | Count 1, as `so_m1_user` |
| `wrapper_mode` | Pass | Count 0, job owned by `so_m1_user` |
| `workload_pool` | Fail | HTTP 400: `Argument workload_pool is not supported by this handler` |
| `workload_pool_prefixed` | Fail | `dispatch.workload_pool` was accepted, but the job reports pool `""`. Whether workload management is enabled on the server is unknown |
| `shared_direct_owner_ns`, `shared_direct_user_ns` | Fail | Job `acl_owner = so_m1_owner2`, but count 0. `so_m1_owner2_role` allows `so_m1_secret`, and `secret_control` found 1 event in the same time range. So a system-session direct dispatch of a shared `dispatchAs = owner` search did **not** run with its owner's index access |
| `system_dispatch_ad_hoc` | Fail (informational) | Ran as `splunk-system-user` |

Found during setup:

- Restricted users without `schedule_search` can't send `is_scheduled` when saving a search. Splunk returns HTTP 400 `Argument "is_scheduled" is not supported by this handler`.
- splunkd does not register a modular input whose scheme has no parameters. The input needs at least one declared argument, here `tick_seconds`.

### Conclusions

1. **Gate passed.** Hidden private saved searches owned by the job owner run with the owner's identity and access. The system session dispatches them via `/servicesNS/<owner>/search_orchestrator/saved/searches/<name>/dispatch`.
2. `dispatch.now` must be sent as epoch seconds.
3. `workload_pool` is dropped from the first version, as spec §9 provides.
4. Saved-search steps: direct dispatch is **not** proven for shared searches. So every `saved_search` step uses the hidden `| savedsearch` wrapper owned by the job owner, unless the referenced search is private and owned by the job owner.
5. Never use the ad hoc `search/jobs` route for user work, since it runs as `splunk-system-user`.

These also bear on later tasks:

- Hidden searches are saved with the user's own session. The REST handler must not send scheduling, alert or action arguments for users without `schedule_search`, and relies on the defaults for no schedule and `dispatchAs = owner`.
- The engine's scheme must keep at least one parameter.
