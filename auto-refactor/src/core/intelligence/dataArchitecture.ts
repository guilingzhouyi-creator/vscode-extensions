export { isOfflineOrMigrationContext } from './dataAccessContext';

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
import type { SemanticGraph } from '../semantic/semanticGraph';

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
    onlinePathPatterns?: string[];
    offlinePathPatterns?: string[];
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

/**
 * Evaluates the unified SemanticGraph to detect cross-procedural N+1 query patterns.
 *
 * @param graph - SemanticGraph instance with symbols and call edges.
 * @param options - Data architecture options.
 * @returns Detected cross-procedural data architecture issues.
 */
export function analyzeDataArchitectureWithGraph(
    graph: SemanticGraph,
    options: DataArchitectureOptions = {},
): Issue[] {
    const issues: Issue[] = [];
    if (options.checkNPlusOne === false) return issues;

    const allNodes = graph.getAllNodes();
    const callsEdges = graph.getAllEdges().filter((e) => e.kind === 'calls');
    const callsMap = new Map<string, string[]>();

    for (const edge of callsEdges) {
        if (!callsMap.has(edge.fromNodeId)) {
            callsMap.set(edge.fromNodeId, []);
        }
        callsMap.get(edge.fromNodeId)!.push(edge.toNodeId);
    }

    for (const node of allNodes) {
        if (!isLoopCallerNode(node.name)) continue;

        // Traverse downstream call tree up to depth 3 looking for storage access
        const visited = new Set<string>();
        const queue: Array<{ id: string; path: string[] }> = [{ id: node.id, path: [node.name] }];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (current.path.length > 4) continue;

            const targets = callsMap.get(current.id) || [];
            for (const targetId of targets) {
                if (visited.has(targetId)) continue;
                visited.add(targetId);

                const targetNode = graph.getNode(targetId);
                if (!targetNode) continue;

                const newPath = [...current.path, targetNode.name];
                if (isDataQuerySymbol(targetNode.name, targetNode.location.file)) {
                    issues.push(createIndirectNPlusOneIssue(node, targetNode, newPath));
                    break;
                }
                queue.push({ id: targetId, path: newPath });
            }
        }
    }

    return issues;
}

/**
 * Tests if a symbol name implies iterative or loop execution.
 */
function isLoopCallerNode(name: string): boolean {
    const lower = name.toLowerCase();
    return (
        lower.includes('loop') ||
        lower.includes('batch') ||
        lower.includes('iterate') ||
        lower.includes('each') ||
        lower.includes('processitems') ||
        lower.includes('handleorders')
    );
}

/**
 * Tests if a symbol or its container represents persistent storage retrieval.
 */
function isDataQuerySymbol(name: string, filePath: string): boolean {
    const lower = name.toLowerCase();
    const isBatch = lower.includes('batch') || lower.includes('bulk') || lower.includes('inlist');
    if (isBatch) return false;

    const isQueryName =
        lower.startsWith('find') ||
        lower.startsWith('select') ||
        lower.startsWith('query') ||
        lower.startsWith('getby') ||
        lower.startsWith('fetch');

    const isRepoFile =
        filePath.toLowerCase().includes('repository') ||
        filePath.toLowerCase().includes('dao') ||
        filePath.toLowerCase().includes('store');

    return isQueryName || isRepoFile;
}

/**
 * Creates an issue for indirect inter-procedural N+1 query.
 */
function createIndirectNPlusOneIssue(
    caller: { location: { file: string; start: { line: number; column: number } }; name: string },
    queryTarget: { location: { file: string }; name: string },
    callPath: string[],
): Issue {
    const pathStr = callPath.join(' -> ');
    const evidence: SemanticEvidenceStep[] = [
        {
            kind: 'loop',
            description: `Iteration caller method '${caller.name}'`,
            file: caller.location.file,
            line: caller.location.start.line,
            symbol: caller.name,
        },
        {
            kind: 'call',
            description: `Inter-procedural call sequence: ${pathStr}`,
            file: caller.location.file,
            line: caller.location.start.line,
            symbol: caller.name,
        },
        {
            kind: 'io',
            description: `Terminal database query in '${queryTarget.name}'`,
            file: queryTarget.location.file,
            line: 1,
            symbol: queryTarget.name,
        },
    ];

    const detail: SemanticReviewDetail = {
        language: 'typescript',
        module: 'data-access',
        symbol: caller.name,
        codeDomain: 'data-architecture',
        currentBehavior: `Indirect N+1 query dispatched via downstream call: ${pathStr}`,
        semanticEvidenceChain: evidence,
        triggerCondition: 'Iterative context dispatches calls reaching persistence queries',
        risk: 'Dispatches N separate database roundtrips across call boundaries.',
        blastRadius: [caller.location.file, queryTarget.location.file],
        isDeterministic: true,
        requiresManualConfirm: false,
        suggestedFix: 'Batch identifiers into a single batch query before entering the loop.',
        impactedCallers: [],
        impactedTests: [],
        verificationMethod: 'Verify query count is constant (O(1)) across iterations.',
        ruleVersion: '1.0.0',
        configVersion: '0.3.0',
        canAutofix: false,
    };

    return {
        id: `data-architecture:DAT-NPL-001:${caller.location.file}:${caller.location.start.line}`,
        analyzer: 'data-architecture',
        rule: 'DAT-NPL-001',
        severity: 'error',
        message: `Indirect N+1 query hazard in '${caller.name}': downstream persistence call (${pathStr}).`,
        location: {
            file: caller.location.file,
            start: caller.location.start,
            end: caller.location.start,
        },
        detail,
        suggestion: 'Hoist query outside loop and pass pre-indexed results or use batching.',
        evidence: {
            confidence: 0.95,
            requiresRuntime: false,
        },
    };
}

/**
 * Audits source code directly across multiple languages for data access architecture issues.
 *
 * @param filePath - Path to the source file.
 * @param content - File contents.
 * @param options - Audit options.
 * @returns Array of detected issues.
 */
export function auditDataArchitectureSource(
    filePath: string,
    content: string,
    options: DataArchitectureOptions = {},
): Issue[] {
    const issues: Issue[] = [];
    const lines = content.split(/\r?\n/);
    const isOnline = isOnlinePath(filePath, content, options);

    let inLoop = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const lineNo = i + 1;

        if (isLoopStart(trimmed)) {
            const isSingleLine =
                trimmed.includes('=>') && (trimmed.endsWith(');') || trimmed.endsWith(')'));
            if (!isSingleLine) {
                inLoop++;
            }
        }

        if (inLoop > 0) {
            if (isDatabaseQueryLine(trimmed)) {
                issues.push(createLoopQueryIssue(filePath, lineNo, trimmed));
            } else if (trimmed.includes('JSON.stringify') || trimmed.includes('JSON.parse')) {
                issues.push(createLoopSerializationIssue(filePath, lineNo, trimmed));
            }
        }

        if (isOnline && isUnboundedQueryLine(trimmed)) {
            issues.push(createUnboundedQueryIssue(filePath, lineNo, trimmed));
        }

        if (isDriverCallLine(trimmed) && isPureDomainFile(filePath)) {
            issues.push(createLeakyAbstractionIssue(filePath, lineNo, trimmed));
        }

        if (isLoopEnd(trimmed) && inLoop > 0) {
            inLoop--;
        }
    }

    return issues;
}

/**
 * Checks if the line marks the start of a loop construct.
 */
function isLoopStart(line: string): boolean {
    return (
        /^(for\s*\(|for\s+[a-zA-Z0-9_$]+\s+in|while\s*\(|while\s+)/.test(line) ||
        /\.(?:map|forEach|filter)\s*\(/.test(line)
    );
}

/**
 * Checks if the line marks the end of a loop block.
 */
function isLoopEnd(line: string): boolean {
    return line === '}' || line === '});' || line === '})';
}

/**
 * Checks if the line performs a database or persistent storage query.
 */
function isDatabaseQueryLine(line: string): boolean {
    if (/\b(?:findByIds|findAllById|batchFind|bulkQuery|queryIn)\b/.test(line)) {
        return false;
    }
    return (
        /\b(?:find|select|query|fetch|get)\w*\s*\(/.test(line) ||
        /\.(?:findById|findOne|findFirst|filter|select)\s*\(/.test(line) ||
        /db\.query|pool\.execute|rawQuery/.test(line)
    );
}

/**
 * Checks if the line is an unbounded query without limit or pagination.
 */
function isUnboundedQueryLine(line: string): boolean {
    const isFetchAll =
        /\b(?:findAll|selectAll|getAll)\s*\(/.test(line) ||
        (/\b(?:find|select)\s*\(\s*\{\s*\}\s*\)/.test(line) &&
            !line.includes('limit') &&
            !line.includes('take'));
    return isFetchAll;
}

/**
 * Checks if the line invokes raw database driver execution.
 */
function isDriverCallLine(line: string): boolean {
    return /\b(?:pool\.execute|db\.query|client\.query|execSql)\s*\(/.test(line);
}

/**
 * Checks if a file belongs to pure domain business logic.
 */
function isPureDomainFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return (
        (lower.includes('/domain/') || lower.includes('/services/') || lower.includes('/core/')) &&
        !lower.includes('repository') &&
        !lower.includes('data') &&
        !lower.includes('db')
    );
}

/**
 * Checks if file belongs to an online request path.
 */
function isOnlinePath(
    filePath: string,
    content: string,
    options: DataArchitectureOptions,
): boolean {
    const lower = filePath.toLowerCase();
    if (lower.includes('/test/') || lower.includes('/scripts/') || lower.includes('migration')) {
        return false;
    }
    const onlineWords = options.onlinePathPatterns ?? [
        'api',
        'controller',
        'service',
        'handler',
        'route',
    ];
    return (
        onlineWords.some((w) => lower.includes(w)) ||
        /@(?:Get|Post|Put|Delete)\b/.test(content) ||
        /\b(?:express|fastify|router)\b/.test(content)
    );
}

function buildSimpleReviewDetail(
    filePath: string,
    behavior: string,
    risk: string,
    fix: string,
    evidence: SemanticEvidenceStep[] = [],
): SemanticReviewDetail {
    return {
        language: 'typescript',
        module: 'data-access',
        symbol: 'global',
        codeDomain: 'data-architecture',
        currentBehavior: behavior,
        semanticEvidenceChain: evidence,
        triggerCondition: behavior,
        risk,
        blastRadius: [filePath],
        isDeterministic: true,
        requiresManualConfirm: false,
        suggestedFix: fix,
        impactedCallers: [],
        impactedTests: [],
        verificationMethod: 'Run automated static and integration checks.',
        ruleVersion: '1.0.0',
        configVersion: '0.3.0',
        canAutofix: false,
    };
}

/**
 * Creates an issue for direct loop query (N+1).
 */
function createLoopQueryIssue(filePath: string, line: number, text: string): Issue {
    return {
        id: `data-architecture:DAT-NPL-001:${filePath}:${line}`,
        analyzer: 'data-architecture',
        rule: 'DAT-NPL-001',
        severity: 'error',
        message: `N+1 query hazard: persistent storage query executed inside loop: '${text}'.`,
        location: {
            file: filePath,
            start: { line, column: 1 },
            end: { line, column: 1 },
        },
        detail: buildSimpleReviewDetail(
            filePath,
            `Persistent storage query executed inside loop: '${text}'`,
            'Dispatches N separate roundtrips across iterations.',
            'Hoist query outside loop and use batching.',
        ),
        suggestion: 'Hoist query outside loop and use a batch IN clause or dataloader pattern.',
    };
}

/**
 * Creates an issue for unbounded queries on online paths.
 */
function createUnboundedQueryIssue(filePath: string, line: number, text: string): Issue {
    return {
        id: `data-architecture:DAT-QRY-001:${filePath}:${line}`,
        analyzer: 'data-architecture',
        rule: 'DAT-QRY-001',
        severity: 'warning',
        message: `Unbounded query without limit or pagination on online path: '${text}'.`,
        location: {
            file: filePath,
            start: { line, column: 1 },
            end: { line, column: 1 },
        },
        detail: buildSimpleReviewDetail(
            filePath,
            `Unbounded query executed on online path: '${text}'`,
            'Risk of memory exhaustion or large DB lock.',
            'Enforce maximum page size or cursor limit.',
        ),
        suggestion: 'Enforce maximum page size or cursor limit on online queries.',
    };
}

/**
 * Creates an issue for loop serialization.
 */
function createLoopSerializationIssue(filePath: string, line: number, text: string): Issue {
    return {
        id: `data-architecture:DAT-SER-001:${filePath}:${line}`,
        analyzer: 'data-architecture',
        rule: 'DAT-SER-001',
        severity: 'info',
        message: `Repetitive serialization inside iteration: '${text}'.`,
        location: {
            file: filePath,
            start: { line, column: 1 },
            end: { line, column: 1 },
        },
        detail: buildSimpleReviewDetail(
            filePath,
            `Repetitive JSON serialization inside iteration: '${text}'`,
            'CPU churn and GC memory pressure in hot loops.',
            'Pass typed in-memory objects and serialize only at perimeter.',
        ),
        suggestion: 'Operate on native in-memory objects; serialize only at network perimeter.',
    };
}

/**
 * Creates an issue for leaky data layer abstraction.
 */
function createLeakyAbstractionIssue(filePath: string, line: number, text: string): Issue {
    return {
        id: `data-architecture:DAT-LAY-001:${filePath}:${line}`,
        analyzer: 'data-architecture',
        rule: 'DAT-LAY-001',
        severity: 'warning',
        message: `Leaky data access abstraction: raw persistence driver call in domain layer: '${text}'.`,
        location: {
            file: filePath,
            start: { line, column: 1 },
            end: { line, column: 1 },
        },
        detail: buildSimpleReviewDetail(
            filePath,
            `Raw persistence driver call in domain layer: '${text}'`,
            'Tight coupling to storage implementation.',
            'Abstract database operations behind a repository interface.',
        ),
        suggestion: 'Abstract database operations behind a repository interface.',
    };
}

/**
 * Unified data architecture evaluator combining AST source inspection and semantic graphs.
 */
export class DataArchitectureEvaluator {
    /**
     * Executes data architecture review across file source and optional graph.
     *
     * @param filePath - Source file path.
     * @param content - Source file content string.
     * @param graph - Optional SemanticGraph instance.
     * @param options - Review configuration options.
     * @returns Array of detected issues.
     */
    public audit(
        filePath: string,
        content: string,
        graph?: SemanticGraph,
        options: DataArchitectureOptions = {},
    ): Issue[] {
        const issues: Issue[] = [];
        const sourceIssues = auditDataArchitectureSource(filePath, content, options);
        issues.push(...sourceIssues);

        if (graph) {
            const graphIssues = analyzeDataArchitectureWithGraph(graph, options);
            issues.push(...graphIssues);
        }

        return issues;
    }
}

/** Default singleton instance of DataArchitectureEvaluator */
export const defaultDataArchitectureEvaluator = new DataArchitectureEvaluator();
