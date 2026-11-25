/* Shapes of the Search Orchestrator REST API (app/search_orchestrator/bin/so/api.py).
 * Times are integer epoch seconds. */
import type { ApprovalState } from './approvals';
import type { StepPerf } from './performance';

export const RUN_STATES = ['queued', 'running', 'blocked', 'paused', 'succeeded', 'failed', 'cancelled'] as const;
export type RunState = (typeof RUN_STATES)[number];

export const STEP_STATES = [
    'waiting',
    'ready',
    'starting',
    'running',
    'retrying',
    'succeeded',
    'failed',
    'skipped',
    'cancelled',
    'abandoned',
    'awaiting_approval',
] as const;
export type StepState = (typeof STEP_STATES)[number];

/** Why a step was skipped: its cadence did not apply, or no incoming edge was satisfied. */
export type SkipKind = 'run_when' | 'not_taken' | 'not_started';

export type AnyState = RunState | StepState;

export interface Issue {
    level: 'error' | 'warning';
    code: string;
    message: string;
    step: string | null;
}

/** Error body: {"error": {"code", "message", "issues", ...extra}}. */
export interface ErrorBody {
    error: {
        code: string;
        message: string;
        issues?: Issue[];
        choices?: DefinitionChoice[];
        [extra: string]: unknown;
    };
}

export type ParamType = 'string' | 'number' | 'enum' | 'time';

export interface ParamDecl {
    name: string;
    type?: ParamType;
    default?: string | number | null;
    values?: string[];
    regex?: string;
    label?: string;
    description?: string;
}

export interface RunWhen {
    kind: string | null;
    value: string | null;
}

export interface Action {
    /** `on_approval_requested`: approval steps only. */
    hook: 'on_start' | 'on_success' | 'on_failure' | 'on_complete' | 'on_delayed' | 'on_late' | 'on_approval_requested';
    type: 'webhook' | 'email' | 'event' | 'start_job' | 'alert_action';
    /** Webhooks: the body format; absent uses the destination's. */
    preset?: WebhookPreset;
    /** PagerDuty and ServiceNow webhooks (bin/so/presets.py PRESET_OPTIONS); never `{}`. */
    options?: Record<string, string>;
    [field: string]: unknown;
}

export type StepOutput =
    | {
          kind: 'summary_index';
          index: string;
          source?: string;
          sourcetype?: string;
          host?: string;
          add_run_id?: boolean;
          /** Only these fields (comma or space separated, * allowed); empty writes every field. */
          fields?: string;
          /** The events' _time: the result's own (default), the run's scheduled time, or now. */
          time?: 'result' | 'scheduled' | 'now';
      }
    | { kind: 'lookup'; name: string; append?: boolean; fields?: string };

export interface StepDef {
    id: string;
    name?: string;
    /** `previous`: SPL that starts with |, run on the results of the steps it depends on. */
    type: 'inline' | 'saved_search' | 'previous' | 'approval';
    spl?: string;
    saved_search_ref?: string;
    earliest?: string;
    latest?: string;
    run_when?: RunWhen | null;
    delayed_after?: number | null;
    give_up_after?: number | null;
    max_runtime?: number | null;
    /** Events this step's search may scan; null or absent uses Settings > Events scanned limit. */
    max_scan?: number | null;
    retries?: number | null;
    actions?: Action[];
    output?: StepOutput;
    /** `approval` steps (no search, time range, retries or max runtime); absent fields use defaults. */
    approval?: { message?: string; approver_roles?: string[]; timeout?: number; on_timeout?: 'reject' | 'approve' };
}

/** How an expression line is checked: the small comparison language (the default when
 * absent), an SPL `where` expression, or a search that must return a row. */
export type ConditionKind = 'simple' | 'eval' | 'search';

export interface Edge {
    from: string;
    to: string;
    condition?: 'on_success' | 'on_failure' | 'always' | 'expression';
    expression?: string;
    expression_kind?: ConditionKind;
    /** `search` conditions only, relative to the run's scheduled time. */
    earliest?: string;
    latest?: string;
    /** Written by the server at save. */
    hidden_search?: string;
}

/** An SPL condition's result on a run, by edge key `<from>><to>`. */
export interface ConditionStatus {
    state: 'starting' | 'running' | 'met' | 'not_met' | 'failed' | 'cancelled';
    sid?: string | null;
    error?: string | null;
    result_count?: number | null;
    started_at?: number | null;
    ended_at?: number | null;
}

export interface Trigger {
    type: 'cron' | 'completion' | string;
    cron?: string;
    job?: string;
    on?: 'success' | 'complete';
    enabled?: boolean;
    /** The steps it starts (each with no line into it); without it, every such step. */
    steps?: string[];
}

export interface Defaults {
    delayed_after?: number;
    give_up_after?: number;
    max_runtime?: number;
    retries?: number;
}

/** A job definition as the builder sends it (server fields are ignored on save). */
export interface JobDefinition {
    id?: string;
    name: string;
    description?: string;
    /** Up to 10 words to group jobs by (team, system); filters on Jobs, Runs and Calendar. */
    tags?: string[];
    enabled: boolean;
    timezone?: string;
    catchup?: 'all' | 'latest' | 'none';
    after_give_up?: 'hold' | 'continue';
    triggers?: Trigger[];
    params?: ParamDecl[];
    steps: StepDef[];
    edges?: Edge[];
    actions?: Action[];
    defaults?: Defaults;
    /** Finish a scheduled or chained run by a time of day, or within a span of its start; omit when unset. */
    deadline?: { finish_by?: string; within?: number };
    run_roles?: string[];
    /** Node positions on the canvas, by node key, and the groups (backdrops) drawn behind them.
     * Omit when unset; the server rejects null. A layout that holds groups may have no `nodes`. */
    layout?: { nodes?: Record<string, { x: number; y: number }>; groups?: LayoutGroup[] };
}

/** A titled, tinted frame behind nodes in the editor; a node belongs to it while its box is inside. */
export interface LayoutGroup {
    id: string;
    title: string;
    color: 'categoricalA1' | 'categoricalA2' | 'categoricalA3' | 'categoricalA4' | 'categoricalA5' | 'categoricalA6' | 'categoricalA7';
    x: number;
    y: number;
    w: number;
    h: number;
    collapsed?: boolean;
}

export interface JobPermissions {
    can_edit: boolean;
    can_run: boolean;
}

/** The most recent run of a job, as listed on the Jobs screen. */
export interface LastRun {
    id: string;
    state: RunState;
    trigger: string;
    scheduled_time: number;
    started_at: number | null;
    ended_at: number | null;
    delay_alerted: boolean;
    held: boolean;
    gave_up: boolean;
}

export interface Job extends JobDefinition {
    id: string;
    owner: string;
    created_at?: number;
    created_by?: string;
    updated_at?: number;
    updated_by?: string;
    /** Counts the job's changes; a save sends the one it started from. */
    revision?: number;
    permissions: JobPermissions;
    /** Next cron slot, or null (GET jobs and GET jobs/<id> only). */
    next_run?: number | null;
    /** True when no cron slot was found within the server's 400-day walk. */
    next_run_beyond?: boolean;
    last_run?: LastRun | null;
    /** The newest runs, newest first (at most 10; GET jobs). */
    recent_runs?: LastRun[];
    /** Problems a re-save fixes, such as previous_old_time_range. */
    warnings?: Issue[];
    /** You follow this job (GET jobs). */
    following?: boolean;
}

export interface StepStatus {
    state: StepState;
    /** What the search cost, once it finished (bin/so/engine.py); keys are left out when unknown. */
    perf?: StepPerf;
    skip_kind?: SkipKind | null;
    attempt?: number;
    sid?: string | null;
    started_at?: number | null;
    ended_at?: number | null;
    next_attempt_at?: number | null;
    delay_alerted?: boolean;
    /** The attempt that went over the events scanned limit (Settings: warn). */
    scan_warned?: number | null;
    result_count?: number | null;
    error?: string | null;
    dispatch_errors?: number;
    /** Approval steps: the request and, once someone (or the timeout, `by: "timeout"`) decides, the decision. */
    approval_state?: ApprovalState;
}

/** A run as GET runs lists it (no definition). */
/** Why a queued run hasn't started (bin/so/queue_info.py). */
export type QueueReason =
    | { kind: 'engine_stopped'; last_seen: number | null }
    | { kind: 'held'; run_id: string }
    | { kind: 'waiting_for_run'; run_id: string; state: RunState }
    | { kind: 'behind'; ahead: number; next_run_id: string }
    | { kind: 'next_tick' };

/** Why a step of a running run hasn't started. */
export type StepReason =
    | { kind: 'waiting_for'; steps: string[] }
    | { kind: 'search_slots'; job_running: number; job_max: number; all_running: number; all_max: number }
    | { kind: 'next_tick' };

export interface EngineStatus {
    running: boolean;
    /** Epoch seconds of the engine's last tick, if it ever ran. */
    last_seen: number | null;
}

export interface RunSummary {
    id: string;
    /** The run's number within its job, 1 for the oldest kept run (GET runs). */
    number?: number;
    /** Queued runs: why they haven't started. */
    queue_reason?: QueueReason;
    job_id: string;
    owner: string;
    /** How the run started, such as manual, cron, completion or backfill. */
    trigger: string;
    /** The backfill that created the run (trigger "backfill"). */
    backfill?: string | null;
    upstream: string | null;
    scheduled_time: number;
    params: Record<string, string>;
    state: RunState;
    catchup: boolean;
    created_at: number;
    queued_at: number;
    started_at: number | null;
    ended_at: number | null;
    delay_base: number | null;
    giveup_base: number | null;
    paused_seconds: number;
    paused_at: number | null;
    delay_alerted: boolean;
    held: boolean;
    gave_up: boolean;
    rerun_count: number;
    chain_depth: number;
    deadline_at?: number | null;
    late_at?: number | null;
    steps: Record<string, StepStatus>;
    /** SPL condition results (absent before any ran). */
    conditions?: Record<string, ConditionStatus>;
}

export interface RerunLatest {
    available: boolean;
    reason: string | null;
}

/** A run as GET runs/<id> returns it. */
export interface RunDetail extends RunSummary {
    /** Running runs: why steps that wait haven't started, by step id. */
    step_reasons?: Record<string, StepReason>;
    definition: JobDefinition & { id: string };
    definition_changed: boolean;
    rerun_latest: Record<string, RerunLatest>;
    permissions: { can_run: boolean };
}

export interface StepAttempt {
    run_id: string;
    step_id: string;
    attempt: number;
    [field: string]: unknown;
}

export interface ActionRun {
    run_id: string;
    [field: string]: unknown;
}

export interface RunDetailResponse {
    run: RunDetail;
    engine?: EngineStatus;
    attempts: StepAttempt[];
    actions: ActionRun[];
}

/** Validate and save tell the caller when saving makes them the owner (an admin saving
 * someone else's job takes it over). */
export interface OwnerChange {
    owner_will_change: boolean;
    owner: string;
}

export interface ValidateResponse extends OwnerChange {
    valid: boolean;
    issues: Issue[];
}

export interface SaveResponse extends OwnerChange {
    job: Job;
    issues: Issue[];
}

export interface DefinitionChoice {
    definition: 'latest' | 'original';
    available: boolean;
    reason: string | null;
}

export interface RerunRequest {
    step: string;
    definition?: 'latest' | 'original';
    restart_downstream_jobs?: boolean;
}

export interface Me {
    user: string;
    roles: string[];
    capabilities: string[];
    can_admin: boolean;
    can_build: boolean;
    can_run: boolean;
    can_approve: boolean;
    /** Building blocks (node kinds) an admin turned off in Settings: not offered in the builder. */
    turned_off?: string[];
}

export interface Settings {
    max_searches: number;
    max_searches_per_job: number;
    queue_cap: number;
    result_retention: number;
    run_retention_days: number;
    fallback: { type: 'email'; to: string } | { type: 'webhook'; destination: string; preset?: string } | null;
    base_url: string | null;
    /** ERROR, WARNING, INFO (default) or DEBUG: what the app writes to its log files. */
    log_level?: string;
    /** Events a step's search may scan (null: no limit), and what happens over it. */
    scan_limit?: number | null;
    scan_limit_action?: 'warn' | 'stop';
    /** Building blocks (node kinds) turned off: the builder doesn't offer them. */
    turned_off?: string[];
    [key: string]: unknown;
}

export interface AlertActionParam {
    name: string;
    label: string;
    help: string;
    type: 'text' | 'textarea' | 'select';
    /** What the action uses when the parameter is left out. */
    default: string;
    required: boolean;
    options: { value: string; label: string }[];
}

export interface AlertAction {
    name: string;
    label: string;
    params: AlertActionParam[];
}

export type WebhookPreset = 'generic' | 'slack' | 'teams' | 'pagerduty' | 'servicenow';

export interface Destination {
    name: string;
    preset: WebhookPreset;
    host: string | null;
    has_headers: boolean;
    /** PagerDuty: whether a routing key is stored (it is never shown). */
    body_secret_set?: boolean;
}

export interface DestinationInput {
    name: string;
    /** PagerDuty: empty uses the Events API v2 endpoint. */
    url: string;
    preset?: WebhookPreset;
    headers?: Record<string, string> | null;
    /** PagerDuty only, write-only; absent keeps the stored key. */
    routing_key?: string;
}

export interface Health {
    index_present: boolean;
    engine_alive: boolean;
    engine_heartbeat: number | null;
    fallback_set: boolean;
    pending_commands: number;
    messages: string[];
    /** The audit index name. */
    audit_index: string;
}

/** One page of the Jobs screen (GET jobs with a limit). */
export interface JobsResult {
    jobs: Job[];
    /** Jobs matching the search, over all pages. */
    total: number;
    /** The last runs could not be read, so each job's last_run is unknown. */
    last_run_unavailable?: boolean;
}

export interface JobSearch {
    q: string;
    offset: number;
    limit: number;
}

export interface RunsResult {
    runs: RunSummary[];
    /** The search stopped before looking at every run. */
    partial?: boolean;
}

export interface RunFilters {
    /** Part of a job's name, or a job's exact id. */
    q?: string;
    job_id?: string;
    state?: RunState;
    limit?: number;
}

// Step previews (POST preview, GET preview/<sid>, ...).

/** Where a preview's upstream steps come from: the caller's live previews in this tab, or
 * a past run. */
export type PreviewInput =
    | { mode: 'live'; previews: Record<string, { sid?: string; skipped?: SkipKind }> }
    | { mode: 'run'; run_id: string };

export interface PreviewRequest {
    job: JobDefinition | Job;
    step_id: string;
    scheduled_time: number;
    params: Record<string, string>;
    input: PreviewInput;
    /** Preview a step that would be skipped anyway. */
    anyway?: boolean;
}

/** A step a preview read (an edge source, or a step its SPL names in a token), as the
 * server resolved it: a step a run would skip is skipped whatever was sent. */
export interface PreviewInputRead {
    step: string;
    state: 'succeeded' | 'failed' | 'skipped';
    sid?: string;
    skip_kind?: SkipKind;
}

export type PreviewStart =
    | { status: 'started'; sid: string; spl: string; anyway?: boolean; input?: PreviewInputRead[] }
    | { status: 'skipped'; skip_kind: SkipKind; reason: string };

export interface PreviewStatus {
    state: 'running' | 'done' | 'failed' | 'missing';
    result_count: number;
    error?: string | null;
    truncated?: string | null;
    run_duration?: number;
    messages: { type: string; text: string }[];
}

export interface PreviewResults {
    fields: string[];
    rows: Record<string, unknown>[];
    total: number;
}

/** One bar on the schedule timeline: an actual run, a projected run or a merged span. */
export interface ScheduleBar {
    kind?: 'span';
    /** A run state, or "scheduled" for a projected run. */
    state: RunState | 'scheduled';
    start: number;
    end: number;
    /** When an actual run started (it was queued from `start` until then). */
    started?: number | null;
    /** Set for runs of jobs the caller may view. */
    id?: string;
    delayed?: boolean;
    estimated?: boolean;
    dependent?: boolean;
    /** Runs merged into a span. */
    count?: number;
}

export interface ScheduleJob {
    /** The job id, or an opaque key for a job the caller may not view. */
    key: string;
    name: string;
    hidden: boolean;
    /** The key of the row this job's completion trigger follows. */
    upstream: string | null;
    next_run: number | null;
    bars: ScheduleBar[];
}

/** `[time, searches]` change points: the count holds until the next point. */
export type LoadSeries = [number, number][];

export interface ScheduleResponse {
    from: number;
    to: number;
    now: number;
    max_searches: number;
    load: LoadSeries;
    jobs: ScheduleJob[];
    idle_jobs: number;
    partial: boolean;
}

/** Every Splunk search over time (GET schedule/splunk), searched as the viewer. */
export interface SplunkLoad {
    from: number;
    to: number;
    now: number;
    /** Seconds per bucket: each holds the most searches that ran at the same moment in it. */
    bucket: number;
    /** `[bucket start, this app, scheduled, other]`: searches that ran (from _audit). */
    past: [number, number, number, number][];
    /** `[bucket start, scheduled]`: Splunk's scheduled saved searches, projected. */
    future: [number, number][];
    /** splunkd's own concurrent search limits. */
    limit: { searches: number; scheduled: number | null } | null;
    projected_searches: number;
    skipped_crons: number;
    notes: string[];
    searches: { title: string; spl: string; earliest: string; latest: string }[];
}

export interface ScheduleSuggestion {
    hour: number;
    minute: number;
    peak: number;
    base_peak: number;
}

export interface SchedulePreview {
    /** The index of the cron trigger in the job's triggers. */
    index: number;
    runs: { start: number; end: number }[];
    suggestion: ScheduleSuggestion | null;
}

export interface SchedulePreviewResponse {
    from: number;
    to: number;
    now: number;
    /** The job's time zone; null means the server's own, which its cron uses. */
    timezone: string | null;
    /** Axis ticks `[time, label]` in that time zone, computed by the server. */
    ticks: [number, string][];
    max_searches: number;
    load: LoadSeries;
    schedules: SchedulePreview[];
}
