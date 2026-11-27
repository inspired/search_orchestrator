/* Run health (bin/so/run_health_api.py): the app's audit events in _audit, and its lines in
 * _internal and _introspection, searched as the viewer and summed up per section. */
import { request } from './client';

export type HealthRange = '24h' | '7d' | '30d';
export type HealthSection = 'runs' | 'steps' | 'actions' | 'late' | 'engine' | 'performance';

export interface HealthFilters {
    job_id?: string;
    range?: HealthRange;
}

/** A search behind a part of a section, for Open in Search. */
export interface HealthSearch {
    key: string;
    title: string;
    spl: string;
    earliest: string;
    latest: string;
}

export type Row = Record<string, string | string[] | undefined>;

interface Common {
    searches: HealthSearch[];
    notes: string[];
    /** Job and step names for the jobs the viewer may see. */
    names: Record<string, { name: string; steps: Record<string, string> }>;
}

export interface RunsSection extends Common {
    kpi: {
        runs: number;
        succeeded: number;
        failed: number;
        held_blocked: number;
        success_rate: number | null;
        median_duration: number | null;
    };
    over_time: {
        span: number;
        buckets: { t: number; counts: Record<string, number> }[];
    };
    attention: Row[];
}

export interface StepsSection extends Common {
    failing: Row[];
    slowest: Row[];
}

export interface ActionsSection extends Common {
    by_type: Row[];
    failures: Row[];
}

export interface LateSection extends Common {
    late: Row[];
    count: number;
}

export interface EngineSection extends Common {
    last: Row;
    errors: Row[];
    tracebacks: Row[];
}

export interface PerformanceSection extends Common {
    runtime: Row[];
    scanned: Row[];
    slowest: Row[];
    peaks: Row[];
}

export interface Sections {
    runs: RunsSection;
    steps: StepsSection;
    actions: ActionsSection;
    late: LateSection;
    engine: EngineSection;
    performance: PerformanceSection;
}

export function runHealth<S extends HealthSection>(section: S, filters: HealthFilters): Promise<Sections[S]> {
    const query: Record<string, string> = {};
    if (filters.job_id) {
        query.job_id = filters.job_id;
    }
    if (filters.range) {
        query.range = filters.range;
    }
    return request<Sections[S]>('GET', `runhealth/${section}`, { query });
}
