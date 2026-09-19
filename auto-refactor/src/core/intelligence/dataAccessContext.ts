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
/**
 * Module: Core Intelligence — Data Architecture & Access Modernization
 * File Path: src/core/intelligence/dataArchitecture.ts
 * Architecture Role: Semantic analyzer for persistence, caching, query patterns, and trust
 *   boundaries across data access and domain orchestration layers.
 * Dependencies & Triggers: Core types (Issue, SemanticReviewDetail, SemanticEvidenceStep);
 *   invoked by DataArchitectureAnalyzer during file analysis and post-scan passes.
 * Responsibilities: Differentiate online request paths from offline/migration jobs; detect
 *   unbounded data queries (DAT-QRY-001); detect N+1 loop queries (DAT-NPL-001); detect
 *   redundant cross-layer serialization (DAT-SER-001); distinguish security perimeter defense
 *   from excessive internal defensive validation (DAT-DEF-001); flag persistence abstraction
 *   leaks in pure domain logic (DAT-LAY-001).
 * Exit Semantics & Design Rationale: Pure in-memory AST and pattern reasoning without external
 *   database dependencies; issues include full evidence chains and risk assessments.
 */

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
    const offlinePathHints = [
        'migration',
        'seed',
        'fixture',
        'batch',
        'job',
        'task',
        'cron',
        'cli',
        'script',
        'tool',
    ];
    for (const hint of offlinePathHints) {
        if (lowerPath.includes(hint) || lowerSymbol.includes(hint)) {
            return true;
        }
    }
    return false;
}
