/* Shapes of the Search Orchestrator REST API (app/search_orchestrator/bin/so/api.py).
 * Times are integer epoch seconds. */

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
] as const;
export type StepState = (typeof STEP_STATES)[number];

/** Why a step was skipped: its cadence did not apply, or no incoming edge was satisfied. */
export type SkipKind = 'run_when' | 'not_taken';

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
    hook: 'on_start' | 'on_success' | 'on_failure' | 'on_complete' | 'on_delayed';
    type: 'webhook' | 'email' | 'event' | 'start_job' | 'alert_action';
    [field: string]: unknown;
}

export interface StepDef {
    id: string;
    name?: string;
    /** `previous`: SPL that starts with |, run on the results of the steps it depends on. */
    type: 'inline' | 'saved_search' | 'previous';
    spl?: string;
    saved_search_ref?: string;
    earliest?: string;
    latest?: string;
    run_when?: RunWhen | null;
    delayed_after?: number | null;
    give_up_after?: number | null;
    max_runtime?: number | null;
    retries?: number | null;
    actions?: Action[];
}

export interface Edge {
    from: string;
    to: string;
    condition?: 'on_success' | 'on_failure' | 'always' | 'expression';
    expression?: string;
}

export interface Trigger {
    type: 'cron' | 'completion' | string;
    cron?: string;
    job?: string;
    on?: 'success' | 'complete';
    enabled?: boolean;
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
    run_roles?: string[];
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
    permissions: JobPermissions;
    /** Next cron slot, or null (GET jobs and GET jobs/<id> only). */
    next_run?: number | null;
    /** True when no cron slot was found within the server's 400-day walk. */
    next_run_beyond?: boolean;
    last_run?: LastRun | null;
    /** Problems a re-save fixes, such as previous_old_time_range. */
    warnings?: Issue[];
}

export interface StepStatus {
    state: StepState;
    skip_kind?: SkipKind | null;
    attempt?: number;
    sid?: string | null;
    started_at?: number | null;
    ended_at?: number | null;
    next_attempt_at?: number | null;
    delay_alerted?: boolean;
    result_count?: number | null;
    error?: string | null;
    dispatch_errors?: number;
}

/** A run as GET runs lists it (no definition). */
export interface RunSummary {
    id: string;
    job_id: string;
    owner: string;
    trigger: string;
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
    steps: Record<string, StepStatus>;
}

export interface RerunLatest {
    available: boolean;
    reason: string | null;
}

/** A run as GET runs/<id> returns it. */
export interface RunDetail extends RunSummary {
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
}

export interface Settings {
    max_searches: number;
    max_searches_per_job: number;
    queue_cap: number;
    result_retention: number;
    run_retention_days: number;
    fallback: { type: 'email'; to: string } | { type: 'webhook'; destination: string; preset?: string } | null;
    base_url: string | null;
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

export interface Destination {
    name: string;
    preset: 'slack' | 'generic';
    host: string | null;
    has_headers: boolean;
}

export interface DestinationInput {
    name: string;
    url: string;
    preset?: 'slack' | 'generic';
    headers?: Record<string, string> | null;
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

export interface RunFilters {
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
