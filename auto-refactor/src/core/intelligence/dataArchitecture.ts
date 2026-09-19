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

import type { Issue, SemanticEvidenceStep, SemanticReviewDetail } from '../types';

/**
 * Context descriptor for a data access operation.
 */
export interface DataAccessSite {
    file: string;
    line: number;
    symbol: string;
    isOnlinePath: boolean;
    isLoopContext: boolean;
    isUnboundedQuery: boolean;
    operationKind: 'query' | 'serialization' | 'validation' | 'driver-call';
    targetEntity?: string;
    expressionText: string;
}

/**
 * Options controlling data architecture review.
 */
export interface DataArchitectureOptions {
    checkUnboundedQueries?: boolean;
    checkNPlusOne?: boolean;
    checkRedundantSerialization?: boolean;
    checkDefensiveExcess?: boolean;
}

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

/**
 * Scan a list of data access sites in a file and generate diagnostic issues.
 *
 * @param sites - Observed data access sites within the file.
 * @param options - Configuration options for data architecture review.
 * @returns Array of issues conforming to Section VII schema.
 */
export function analyzeDataAccessSites(
    sites: DataAccessSite[],
    options: DataArchitectureOptions = {},
): Issue[] {
    const issues: Issue[] = [];
    const checkUnbounded = options.checkUnboundedQueries ?? true;
    const checkNPlusOne = options.checkNPlusOne ?? true;
    const checkRedundantSer = options.checkRedundantSerialization ?? true;
    const checkDefensive = options.checkDefensiveExcess ?? true;

    // Track consecutive validations to identify excessive defense vs perimeter defense
    const validationCountInSymbol = new Map<string, number>();

    for (const site of sites) {
        // 1. Unbounded query on online request path (DAT-QRY-001)
        if (checkUnbounded && site.isOnlinePath && site.isUnboundedQuery) {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'condition',
                    description: `Online request handler in '${site.symbol}'`,
                    file: site.file,
                    line: site.line,
                    symbol: site.symbol,
                },
                {
                    kind: 'io',
                    description: `Unbounded query without pagination/cursor limit: '${site.expressionText}'`,
                    file: site.file,
                    line: site.line,
                    symbol: site.symbol,
                },
            ];

            const detail: SemanticReviewDetail = {
                language: 'typescript',
                module: 'data-access',
                symbol: site.symbol,
                codeDomain: 'data-architecture',
                currentBehavior: `Querying persistent storage with unbounded fetch: '${site.expressionText}'.`,
                semanticEvidenceChain: evidence,
                triggerCondition:
                    'Unpaginated query execution detected within an online request handler',
                risk: 'Database query may return unbounded records under production data volume, causing OOM or high latency.',
                blastRadius: [site.file],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix:
                    'Add cursor-based or limit/offset pagination with an explicit maximum page size.',
                impactedCallers: [],
                impactedTests: [],
                verificationMethod:
                    'Verify query SQL/ORM execution includes LIMIT and OFFSET/cursor constraints.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `data-architecture:DAT-QRY-001:${site.file}:${site.line}`,
                analyzer: 'data-architecture',
                rule: 'DAT-QRY-001',
                severity: 'warning',
                message: `Unbounded query on online request path: '${site.expressionText}' lacks pagination limit.`,
                location: {
                    file: site.file,
                    start: { line: site.line, column: 1 },
                    end: { line: site.line, column: 80 },
                },
                detail,
                suggestion: 'Introduce limit/cursor parameters to enforce bounded result sets.',
                evidence: {
                    confidence: 0.95,
                    requiresRuntime: false,
                },
            });
        }

        // 2. N+1 query in loop context (DAT-NPL-001)
        if (checkNPlusOne && site.isLoopContext && site.operationKind === 'query') {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'loop',
                    description: `Iterative execution block in '${site.symbol}'`,
                    file: site.file,
                    line: site.line,
                    symbol: site.symbol,
                },
                {
                    kind: 'io',
                    description: `Database or storage query executed inside iteration: '${site.expressionText}'`,
                    file: site.file,
                    line: site.line,
                    symbol: site.symbol,
                },
            ];

            const detail: SemanticReviewDetail = {
                language: 'typescript',
                module: 'data-access',
                symbol: site.symbol,
                codeDomain: 'data-architecture',
                currentBehavior: `Executing query '${site.expressionText}' inside a loop or mapping iteration.`,
                semanticEvidenceChain: evidence,
                triggerCondition: 'Persistent storage query dispatched inside an iteration loop',
                risk: 'Dispatches N separate database roundtrips for N items, causing severe database connection starvation.',
                blastRadius: [site.file],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix:
                    'Batch identifiers into a single batch query (e.g. IN (...) clause or batch lookup) outside the loop.',
                impactedCallers: [],
                impactedTests: [],
                verificationMethod:
                    'Assert database query count equals 1 regardless of collection size.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `data-architecture:DAT-NPL-001:${site.file}:${site.line}`,
                analyzer: 'data-architecture',
                rule: 'DAT-NPL-001',
                severity: 'error',
                message: `N+1 query hazard: persistent storage fetch executed inside iteration in '${site.symbol}'.`,
                location: {
                    file: site.file,
                    start: { line: site.line, column: 1 },
                    end: { line: site.line, column: 80 },
                },
                detail,
                suggestion:
                    'Hoist query outside loop and use a batch IN clause or dataloader pattern.',
                evidence: {
                    confidence: 0.95,
                    requiresRuntime: false,
                },
            });
        }

        // 3. Redundant serialization in loop or consecutive calls (DAT-SER-001)
        if (checkRedundantSer && site.operationKind === 'serialization' && site.isLoopContext) {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'loop',
                    description: `Loop iteration in '${site.symbol}'`,
                    file: site.file,
                    line: site.line,
                    symbol: site.symbol,
                },
                {
                    kind: 'allocation',
                    description: `Repetitive serialization/deserialization: '${site.expressionText}'`,
                    file: site.file,
                    line: site.line,
                    symbol: site.symbol,
                },
            ];

            const detail: SemanticReviewDetail = {
                language: 'typescript',
                module: 'data-access',
                symbol: site.symbol,
                codeDomain: 'data-architecture',
                currentBehavior: `Repeatedly parsing or stringifying objects inside an iteration block: '${site.expressionText}'.`,
                semanticEvidenceChain: evidence,
                triggerCondition:
                    'Serialization roundtrip invoked per item within an iteration loop',
                risk: 'Excessive CPU overhead and memory churn from JSON encoding/decoding inside critical paths.',
                blastRadius: [site.file],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix:
                    'Pass strongly-typed in-memory representations directly; serialize only at network perimeter.',
                impactedCallers: [],
                impactedTests: [],
                verificationMethod:
                    'Benchmark JSON parse/stringify invocations across pipeline execution.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `data-architecture:DAT-SER-001:${site.file}:${site.line}`,
                analyzer: 'data-architecture',
                rule: 'DAT-SER-001',
                severity: 'info',
                message: `Redundant serialization cycle inside iteration: '${site.expressionText}'.`,
                location: {
                    file: site.file,
                    start: { line: site.line, column: 1 },
                    end: { line: site.line, column: 80 },
                },
                detail,
                suggestion:
                    'Operate on native objects in memory and serialize only at the external boundary.',
                evidence: {
                    confidence: 0.85,
                    requiresRuntime: false,
                },
            });
        }

        // 4. Excessive defensive validation within trusted domain context (DAT-DEF-001)
        if (checkDefensive && site.operationKind === 'validation') {
            const count = (validationCountInSymbol.get(site.symbol) ?? 0) + 1;
            validationCountInSymbol.set(site.symbol, count);

            if (count > 2 && !site.isOnlinePath) {
                const evidence: SemanticEvidenceStep[] = [
                    {
                        kind: 'condition',
                        description: `Internal non-perimeter domain logic in '${site.symbol}'`,
                        file: site.file,
                        line: site.line,
                        symbol: site.symbol,
                    },
                    {
                        kind: 'condition',
                        description: `Repeated defensive validation of already established invariant: '${site.expressionText}'`,
                        file: site.file,
                        line: site.line,
                        symbol: site.symbol,
                    },
                ];

                const detail: SemanticReviewDetail = {
                    language: 'typescript',
                    module: 'data-access',
                    symbol: site.symbol,
                    codeDomain: 'data-architecture',
                    currentBehavior: `Repeated redundant parameter and invariant validation in internal function '${site.symbol}'.`,
                    semanticEvidenceChain: evidence,
                    triggerCondition:
                        'Multiple repetitive assertions on trusted internal domain types within non-perimeter code',
                    risk: 'Obscures business flow with noisy defensive checks; masks true ownership of invariant enforcement.',
                    blastRadius: [site.file],
                    isDeterministic: false,
                    requiresManualConfirm: true,
                    suggestedFix:
                        'Enforce domain invariants once at construction or trust boundary; rely on type guarantees internally.',
                    impactedCallers: [],
                    impactedTests: [],
                    verificationMethod:
                        'Verify unit tests validate invariant failures at boundary rather than internal functions.',
                    ruleVersion: '1.0.0',
                    configVersion: '0.3.0',
                    canAutofix: false,
                };

                issues.push({
                    id: `data-architecture:DAT-DEF-001:${site.file}:${site.line}`,
                    analyzer: 'data-architecture',
                    rule: 'DAT-DEF-001',
                    severity: 'info',
                    message: `Excessive defensive validation in internal domain logic: '${site.expressionText}'.`,
                    location: {
                        file: site.file,
                        start: { line: site.line, column: 1 },
                        end: { line: site.line, column: 80 },
                    },
                    detail,
                    suggestion:
                        'Retain perimeter validation at entry boundaries; rely on typed value objects internally.',
                    evidence: {
                        confidence: 0.8,
                        requiresRuntime: false,
                    },
                });
            }
        }

        // 5. Leaky data access abstraction (DAT-LAY-001)
        if (
            site.operationKind === 'driver-call' &&
            !site.file.includes('repository') &&
            !site.file.includes('data')
        ) {
            const evidence: SemanticEvidenceStep[] = [
                {
                    kind: 'call',
                    description: `Low-level database driver call in business domain: '${site.expressionText}'`,
                    file: site.file,
                    line: site.line,
                    symbol: site.symbol,
                },
            ];

            const detail: SemanticReviewDetail = {
                language: 'typescript',
                module: 'data-access',
                symbol: site.symbol,
                codeDomain: 'data-architecture',
                currentBehavior: `Directly invoking storage driver/SQL execution from non-repository file '${site.file}'.`,
                semanticEvidenceChain: evidence,
                triggerCondition:
                    'Low-level persistence API directly referenced outside repository layer',
                risk: 'Tight coupling of domain logic to specific persistence driver prevents testing and schema evolution.',
                blastRadius: [site.file],
                isDeterministic: true,
                requiresManualConfirm: false,
                suggestedFix:
                    'Encapsulate database driver access behind a repository interface or gateway abstraction.',
                impactedCallers: [],
                impactedTests: [],
                verificationMethod:
                    'Verify domain module imports only repository interfaces, not raw database clients.',
                ruleVersion: '1.0.0',
                configVersion: '0.3.0',
                canAutofix: false,
            };

            issues.push({
                id: `data-architecture:DAT-LAY-001:${site.file}:${site.line}`,
                analyzer: 'data-architecture',
                rule: 'DAT-LAY-001',
                severity: 'warning',
                message: `Leaky data access abstraction: raw persistence driver call in domain layer '${site.file}'.`,
                location: {
                    file: site.file,
                    start: { line: site.line, column: 1 },
                    end: { line: site.line, column: 80 },
                },
                detail,
                suggestion: 'Abstract database operations behind a repository interface.',
                evidence: {
                    confidence: 0.9,
                    requiresRuntime: false,
                },
            });
        }
    }

    return issues;
}
