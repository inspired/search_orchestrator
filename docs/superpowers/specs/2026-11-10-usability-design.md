# Search Orchestrator: usability pass

Date: 2026-11-10. Status: draft for owner review.

Builds on `2026-11-05-search-orchestrator-design.md`. Every rule there still holds, in particular "no filled pills or badges for status" and "the screens must not look generic or un-Splunk-like".

## 1. Intent

The app works but asks users to know Splunk internals: cron, relative time modifiers, tokens, durations in minutes, and engineering words such as "dispatchAs" and "wrapper". The aim is that a Splunk user who has never seen the app can build the daily → weekly → monthly rollup, schedule it and know who is told when it fails, without reading the docs.

**Success:** a new user goes from "New job" to a saved, scheduled rollup job using only presets and pickers, and every problem on save points to the field that causes it.

## 2. Design system rules (from `@splunk/react-ui` 5.18.0 `docs-llm/`)

The splunkui.splunk.com site renders client-side and could not be read, so these rules come from the package's own docs (`docs-llm/*.md`), which ship with the version the app already uses.

- **Sentence case everywhere:** buttons, labels, tabs, headings, modal titles, options.
- **Buttons** start with a verb, 1 or 2 words, precise ("Create job", not "New job"). One primary button per area. Destructive actions use `appearance="destructive"`. Avoid disabled buttons: use `disabled="dimmed"` and say what is missing.
- **Errors** say what is wrong and how to fix it ("Pick at least one step", not "Invalid"). Use the control's `error` prop and `ControlGroup` `error` text; use `Message` for server-side errors. `MessageBar` only for page/system state, never stacked.
- **Help text** carries essential information and is always visible; no help text that adds nothing; a placeholder never replaces a label. Tooltips only for non-essential extras.
- **Destructive confirmation:** `Modal` titled with a question ("Remove Daily summary?"), body states the consequence, primary action is a precise verb, no click-away close.
- **Links** describe their target ("Learn more about time ranges", not "here").
- **Component choice:** `RadioBar` for fewer than 8 simple options; `Select` for short lists; `ComboBox` for long or searchable lists; `Card`/`CardLayout` for choosing a template; `CollapsiblePanel` for advanced options; `TabBar` max 7 tabs, `count` on a tab for issue counts; `Search` to filter the Jobs table; `DefinitionList` for key-value readouts; `Markdown` for rendering help text.
- **Owner rule wins over the design system:** no `Badge`, `Chip` or filled pill for run or step status. The `count` on a tab is a number, not a status, and is allowed.

## 3. Decisions

| Topic | Decision | Why |
|---|---|---|
| Time range picker | Our own `Select` of presets plus an "Advanced" pair of `Text` fields, and a server-resolved readout. Not `@splunk/react-time-range`. | Its presets mean "relative to now"; ours mean "relative to the run's scheduled time". Its base Dropdown cannot preview relative times without Splunk Web. Adding it also pulls in `@splunk/moment` and `@splunk/time-range-utils`. |
| Time readout | New `POST timerange/resolve`, using splunkd `search/timeparser` with `now` set to the scheduled time. | Only Splunk resolves Splunk's time syntax correctly; a JS copy would mislead users. |
| Schedule | Presets (hourly, daily, weekly, monthly, custom cron) that convert to and from cron; a cron that doesn't match a preset opens as Custom and is never rewritten. Next runs come from `POST schedule/next` (the existing `cron.py`). | The cron engine already exists on the server; the client never parses time zones. |
| Time zone | `ComboBox` from `Intl.supportedValuesOf('timeZone')`, keeping any unknown stored value. | No server change; the save-time `bad_timezone` check stays. |
| Durations | Number plus unit (minutes, hours, days), stored in seconds as today. | |
| Templates | Client-side `JOB_TEMPLATES` that fill a new job. | No server change. |
| Help | A new in-app **Help** page that renders `docs/user-guide.md` with `Markdown`. "Learn more" links go to its headings. | The docs exist only in the repo today; an in-app page needs no external URL and passes Cloud vetting. |
| Validation | Automatic, debounced, after edits; the Validate button goes. Save stays. | |
| Step type name | "From previous steps" becomes "Results of earlier steps" in the UI and docs; the stored value stays `previous`. | Says what the step reads. |

## 4. Scope

1. Templates and a setup checklist for new jobs.
2. Schedule presets with a readable summary and next runs; time zone picker.
3. Time range presets with a readout of the real window for a scheduled time.
4. Durations with units.
5. "Insert value" token picker for SPL, edge expressions and action messages.
6. Issue counts on job tabs, automatic validation, a save error list that jumps to the problem, and an unsaved-changes guard.
7. Jobs page: an empty state with templates, a summary line per job, and search. Runs page: a "Needs attention" filter. Run page: next-step guidance for held, blocked and failed runs.
8. Help page and "Learn more" links.
9. Wording pass over UI text and server issue messages; docs version lines fixed.

Out of scope: drag-placed nodes, real-time collaboration, a new SPL editor (`@splunk/react-search` is Ace-based and heavy), and any change to the engine or run semantics.
