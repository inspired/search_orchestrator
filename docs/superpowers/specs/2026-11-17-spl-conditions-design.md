# SPL conditions on lines: design

Date: 2026-11-17. Status: owner request; builder calls marked **(builder call)**. Release 1.17.0.

## Intent

A condition line (an edge with `condition: "expression"`) can only use the small comparison language in `expr.py` today. The owner wants full SPL there, with tokens such as "now". The owner chose two SPL modes, and the existing language stays as a third, default mode, so saved jobs behave as before.

## Edge fields

| Field | Meaning |
|---|---|
| `expression_kind` | `simple` (default when absent), `eval` or `search` |
| `expression` | The text: a simple comparison, an eval expression, or a search |
| `earliest`, `latest` | `search` only. Relative to the run's scheduled time, the same presets as steps. Absent means "The 24 hours before" (`-24h`, `now`). |
| `hidden_search` | Written by the server at save (`eval`/`search`), never taken from the request. |

- **Simple comparison** (`simple`): `expr.py`, evaluated in the engine, unchanged.
- **SPL expression** (`eval`): what you would write after `| where`. True when `| makeresults | where <expr>` returns a row.
- **Search returns results** (`search`): a full search. True when it returns at least one row.

## Hidden searches (as steps, spec section 9)

At job save, `hidden.plan` writes one content-addressed hidden saved search per SPL condition, owned by the job owner: `_so_<job>_cond_<hash8>`. The hash covers job, from, to, kind, compiled SPL, earliest and latest, so old and new versions coexist while runs use them. The name goes into the edge as `hidden_search`, is tracked in `hidden_searches`, and is kept by `hidden.used` while the job or an active run needs it.

- `eval`: `| makeresults | where <compiled expression>`, dispatched with the time range `-1m`..`now` (it reads no events).
- `search`: the compiled search with its own earliest/latest.
- **Tokens** compile with `tokens.compile_spl` (quoted, escaped, never raw SPL). **(builder call)** In `eval` mode the numeric tokens (`$<step>.resultCount$`, `$run.scheduled_time$`, `$run.now$`) outside a string become `tonumber("$args.x$")`, so `$daily.resultCount$ > 0` compares numbers. `search` mode follows the step rules exactly (every token is a quoted string).
- **`now()`** in a condition is the run's scheduled time, as in steps: condition searches are dispatched with `dispatch.now` = scheduled time, so `relative_time(now(), "@d")` means the scheduled day. `$run.now$` (and SPL's `time()`) is the wall-clock time.

## New token `$run.now$`

Epoch seconds when the token is filled: at dispatch for step SPL and conditions, when the hook fires for actions, at evaluation for `run_when` and simple conditions. It is valid everywhere `$run.scheduled_time$` is, and in the Insert value lists.

## Engine

State is kept on the run as `run["conditions"]["<from>><to>"]`: `{kind, state, sid, intent_at, started_at, ended_at, result_count, error}` with state `starting`, `running`, `met`, `not_met`, `failed` or `cancelled`.

- **When:** `state.edge()` for an SPL edge whose source has **succeeded or failed** reads the cached result. With none it returns unresolved (the target stays `waiting`) and asks for `("start_condition", key)`; while paused, nothing new starts. A **skipped** source is "not met" without a search, as in the edge table today.
- **Once per edge per run:** the cached `met`/`not_met`/`failed` is final for the run. A **re-run** drops the results of every edge into a reset step, so they are evaluated again.
- **Dispatch:** as the job owner through `gateway.dispatch` (the same mechanism as steps), with `dispatch.now` = scheduled time and `trigger_actions` off. Saved as `starting` with `intent_at` before the dispatch, then `running` with the sid. Condition searches count toward the running-search limits **(builder call)**.
- **Poll:** before `evaluate`, like steps. Done with rows: `met`; done with none: `not_met`; failed, missing or finalized: `failed`.
- **Timeout: a fixed 300 s** from dispatch **(builder call)**. A condition holds a step back, so it should be quick; a step's 4-hour max runtime is far too long. The search is cancelled and the condition `failed`.
- **Failure** (search error, timeout, a token with no value, a missing hidden search) counts as **not met**: audit `condition_failed` with `run_id`, `edge`, `error`. Every result is audited as `condition_evaluated` with `result` true or false.
- **Restart safety:** a `starting` condition with no sid asks `gateway.history(owner, name, intent_at)` and adopts the newest job, or dispatches again if there is none. A transient history error waits, at most 300 s (`UNKNOWN_LIMIT`), then fails the condition.
- **Run state:** a pending condition counts as activity, so the run is not marked `blocked` while one is out. When the run ends (cancel, give-up), running condition searches are cancelled and marked `cancelled`.
- **Previews** (`state.preview_decision`) never run condition searches; they treat an SPL condition as met.

## Validation (`model.py`, mirrored in `graphLogic.findIssues`)

- `expression_kind` must be one of the three; `eval`/`search` need non-empty text (`bad_expression`).
- Tokens must be known: the same checks as step SPL (`unknown_token`, `unsafe_token_position`).
- No writing commands (`collect`, `outputlookup`, `outputcsv`, `tscollect`, `mcollect`, `meventcollect`, `sendemail`, `delete`) and no `| orchestrate` (`condition_writes`): "a condition only reads; move <cmd> into a step".
- `eval` text can't contain `|` outside a string (`bad_expression`): "use Search returns results for a full search".

## Screens

- **Builder** (`EdgePanel`, used for both the line and the condition node): a **Check with** select (Simple comparison / SPL expression / Search returns results). SPL modes use `SplEditor` with colours and Insert value; "SPL expression" has no pipe-newline, "Search returns results" has it, plus a time range field (default "The 24 hours before"). Line labels: "◇ where …" / "◇ search …".
- **Run graph** (`runFlow.lineStates`): a line whose condition is being checked is `pending`; `met` is `fired` (or `flowing`); `not_met`/`failed` is `wont`. Simple conditions keep today's rule.
- **Run page step detail** lists each incoming SPL condition: checking, met, not met or failed with its error, and a link to its search.

## Not included

**Test condition** in the builder: the preview API is built around one step (its sid names a step, its scope is a step's inputs), so running a condition there would need a second preview kind. Left for later.
