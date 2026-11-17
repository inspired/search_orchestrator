/* The app's Splunk-wide names. A normal build uses them as they are; a side-by-side test
 * package (scripts/package_variant.sh) builds with SO_SUFFIX=_<suffix>, which webpack's
 * DefinePlugin puts in __SO_SUFFIX__, so the copy talks to its own REST endpoint and command. */
declare const __SO_SUFFIX__: string | undefined;

const SUFFIX: string = typeof __SO_SUFFIX__ === 'string' ? __SO_SUFFIX__ : '';

/** The REST endpoint under /services (restmap.conf match). */
export const REST_BASE = `orchestrator${SUFFIX}`;
/** The custom search command (commands.conf). SPL command names are letters and digits
 * only, so the command takes the suffix without its underscore (orchestrate<suffix>). */
export const COMMAND = `orchestrate${SUFFIX.replace(/^_/, '')}`;
export const CAP_ADMIN = `orchestrator_admin${SUFFIX}`;
export const CAP_RUN = `orchestrator_run${SUFFIX}`;
