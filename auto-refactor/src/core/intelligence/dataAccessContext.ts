/**
 * Module: Core Intelligence — Data Access Context Helpers
 * File Path: src/core/intelligence/dataAccessContext.ts
 * Architecture Role: Context classification helper for the data-architecture analyzer pack.
 * Dependencies & Triggers: the same imports as ./dataArchitecture; re-exported by that module so
 *   existing callers keep their single import path.
 * Responsibilities: Decide whether a data-access site sits in an offline or migration context.
 * Exit Semantics & Design Rationale: Pure predicate over the supplied evidence strings; no I/O
 *   and no state, so it can be called per site without ordering constraints.
 */
/** Path/symbol fragment marking a schema migration entry point. */
const HINT_MIGRATION = 'migration';
/** Path/symbol fragment marking a data seeding entry point. */
const HINT_SEED = 'seed';
/** Path/symbol fragment marking a test fixture builder. */
const HINT_FIXTURE = 'fixture';
/** Path/symbol fragment marking a batch processing job. */
const HINT_BATCH = 'batch';
/** Path/symbol fragment marking a queued or scheduled job. */
const HINT_JOB = 'job';
/** Path/symbol fragment marking an administrative task. */
const HINT_TASK = 'task';
/** Path/symbol fragment marking a cron entry point. */
const HINT_CRON = 'cron';
/** Path/symbol fragment marking a command-line entry point. */
const HINT_CLI = 'cli';
/** Path/symbol fragment marking a maintenance script. */
const HINT_SCRIPT = 'script';
/** Path/symbol fragment marking an operator tool. */
const HINT_TOOL = 'tool';

/** Fragments whose presence in a path or symbol marks an offline or migration context. */
const OFFLINE_CONTEXT_HINTS = [
    HINT_MIGRATION,
    HINT_SEED,
    HINT_FIXTURE,
    HINT_BATCH,
    HINT_JOB,
    HINT_TASK,
    HINT_CRON,
    HINT_CLI,
    HINT_SCRIPT,
    HINT_TOOL,
];

/**
 * Identify whether a file or function belongs to an offline, migration, or admin task.
 *
 * @param filePath - Repository-relative file path.
 * @param symbol - Function or class symbol name.
 * @returns True when the context is an offline or migration job.
 */
export function isOfflineOrMigrationContext(filePath: string, symbol: string): boolean {
    const lowerPath = filePath.toLowerCase();
    const lowerSymbol = symbol.toLowerCase();
    for (const hint of OFFLINE_CONTEXT_HINTS) {
        if (lowerPath.includes(hint) || lowerSymbol.includes(hint)) {
            return true;
        }
    }
    return false;
}
