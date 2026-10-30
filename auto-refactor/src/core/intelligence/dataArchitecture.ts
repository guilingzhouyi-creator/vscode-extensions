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

export { isOfflineOrMigrationContext } from './dataAccessContext';
export * from './data-architecture-sites';

import type { Issue, SemanticEvidenceStep, SemanticReviewDetail } from '../types';
import { isToolOrTestScript } from '../governance/pathScope';
import type { SemanticGraph } from '../semantic/semanticGraph';
import type { SemanticNode } from '../semantic/types';
import {
    createLoopQueryIssue,
    createUnboundedQueryIssue,
    createLoopSerializationIssue,
    createLeakyAbstractionIssue,
    checkResourceRegistrySite,
    DANGLING_RESOURCE_PATH_RE,
    type DataAccessSite,
    type DataArchitectureOptions,
} from './data-architecture-sites';

const EVIDENCE_KINDS = Object.freeze({
    call: 'call',
    condition: 'condition',
    loop: 'loop',
    allocation: 'allocation',
    io: 'io',
});

const DETAIL_KEYS = Object.freeze({
    trigger: 'triggerCondition',
    reliable: 'isDeterministic',
    remedy: 'suggestedFix',
    method: 'verificationMethod',
});

const MODULE_DATA_ACCESS = 'data-access';
const ANALYZER_DATA_ARCHITECTURE = 'data-architecture';
const CODE_DOMAIN_DATA_ARCHITECTURE = 'data-architecture';
const LANGUAGE_TYPESCRIPT = 'typescript';
const SYMBOL_GLOBAL = 'global';
const OP_KIND_RESOURCE_REGISTRY = 'resource-registry';
const SEVERITY_ERROR = 'error';

const MAX_INTER_PROCEDURAL_QUERY_DEPTH = 4;
const STRING_JSON_STRINGIFY = 'JSON.stringify';
const STRING_JSON_PARSE = 'JSON.parse';
const DEFAULT_RULE_VERSION = '1.0.0';
const DEFAULT_CONFIG_VERSION = '0.3.0';

const FILE_TOKEN_STORE = 'store';
const CALL_ARROW_SEPARATOR = ' -> ';
const EDGE_KIND_CALLS = 'calls';

const KEYWORD_LIMIT = 'limit';
const KEYWORD_TAKE = 'take';

const PATH_SEGMENTS = Object.freeze({
    domain: '/domain/',
    services: '/services/',
    core: '/core/',
    test: '/test/',
    scripts: '/scripts/',
});
const TOKEN_MIGRATION = 'migration';
const TOKEN_DATA = 'data';
const TOKEN_DB = 'db';
const TOKEN_LOOP = 'loop';
const TOKEN_ITERATE = 'iterate';
const TOKEN_EACH = 'each';
const TOKEN_PROCESS_ITEMS = 'processitems';
const TOKEN_HANDLE_ORDERS = 'handleorders';

const DEFAULT_ONLINE_WORDS: readonly string[] = Object.freeze(
    'api controller service handler route'.split(' '),
);

const PREFIX_FIND = 'find';
const PREFIX_SELECT = 'select';
const PREFIX_QUERY = 'query';
const PREFIX_GETBY = 'getby';
const PREFIX_FETCH = 'fetch';
const TOKEN_BATCH = 'batch';
const TOKEN_BULK = 'bulk';
const TOKEN_INLIST = 'inlist';
const TOKEN_REPOSITORY = 'repository';
const TOKEN_DAO = 'dao';

function isLoopStart(line: string): boolean {
    return (
        /^(for\s*\(|for\s+[a-zA-Z0-9_$]+\s+in|while\s*\(|while\s+)/.test(line) ||
        /\.(?:map|forEach|filter)\s*\(/.test(line)
    );
}

function isLoopEnd(line: string): boolean {
    return line === '}' || line === '});' || line === '})';
}

function isDatabaseQueryLine(line: string): boolean {
    if (/\b(?:findByIds|findAllById|batchFind|bulkQuery|queryIn)\b/.test(line)) {
        return false;
    }
    if (/\b(?:index|cache|memory|map|local|token|entry|ast|symbol)Store\b/i.test(line)) {
        return false;
    }
    const hasPersistenceTarget =
        /(?:repo|repository|db|database|pool|client|model|dao|collection|prisma|table|session|orm|store)\s*\.\s*(?:find|findAll|select|query|fetch|get|filter)\w*\s*\(/i.test(
            line,
        );
    const hasExplicitOrmMethod =
        /\.(?:findById|findOne|findFirst|findMany|fetchRecords|queryAll|getBy\w+|selectFrom|rawQuery|execSql)\s*\(/.test(
            line,
        );
    const hasDriverCall = /\b(?:db\.query|pool\.execute|rawQuery)\b/.test(line);

    return hasPersistenceTarget || hasExplicitOrmMethod || hasDriverCall;
}

function isUnboundedQueryLine(line: string): boolean {
    return (
        /\b(?:findAll|selectAll|getAll)\s*\(/.test(line) ||
        (/\b(?:find|select)\s*\(\s*\{\s*\}\s*\)/.test(line) &&
            !line.includes(KEYWORD_LIMIT) &&
            !line.includes(KEYWORD_TAKE))
    );
}

function isDriverCallLine(line: string): boolean {
    return /\b(?:pool\.execute|db\.query|client\.query|execSql)\s*\(/.test(line);
}

/**
 * Evaluates whether a file resides strictly within business domain boundaries.
 * Enforces clean separation between domain logic and persistence gateways.
 *
 * @param filePath - Repository-relative file path to evaluate.
 * @returns True if file represents core domain entity or service without persistence traits.
 */
function isPureDomainFile(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return (
        (lower.includes(PATH_SEGMENTS.domain) ||
            lower.includes(PATH_SEGMENTS.services) ||
            lower.includes(PATH_SEGMENTS.core)) &&
        !lower.includes(TOKEN_REPOSITORY) &&
        !lower.includes(TOKEN_DATA) &&
        !lower.includes(TOKEN_DB)
    );
}

/**
 * Determines whether the given execution context represents an online request path.
 * Online handlers require strict bounds on query limits and latency budgets.
 *
 * @param filePath - Target file path being audited.
 * @param content - Full file text inspected for route annotations and framework patterns.
 * @param options - Analysis configuration containing custom online pattern definitions.
 * @returns True if the path represents an online request-serving endpoint.
 */
function isOnlinePath(
    filePath: string,
    content: string,
    options: DataArchitectureOptions,
): boolean {
    const lower = filePath.toLowerCase();
    if (
        lower.includes(PATH_SEGMENTS.test) ||
        lower.includes(PATH_SEGMENTS.scripts) ||
        lower.includes(TOKEN_MIGRATION)
    ) {
        return false;
    }
    const onlineWords = options.onlinePathPatterns ?? DEFAULT_ONLINE_WORDS;
    return (
        onlineWords.some((word) => lower.includes(word)) ||
        /@(?:Get|Post|Put|Delete)\b/.test(content) ||
        /\b(?:express|fastify|router)\b/.test(content)
    );
}

// ============================================================================
// Cross-Procedural Graph Analysis & Source Line Audit
// ============================================================================

/**
 * Discovers indirect N+1 storage queries by traversing cross-procedural call edges.
 * Applies breadth-first search bounded by MAX_INTER_PROCEDURAL_QUERY_DEPTH.
 *
 * @param node - Root caller symbol node initiating iterative execution.
 * @param callsMap - Pre-indexed caller-to-callee identifier adjacency map.
 * @param graph - Global semantic dependency graph.
 * @returns Diagnostic issue if an indirect storage query is reached within depth limit.
 */
function findIndirectStorageQueryIssue(
    node: SemanticNode,
    callsMap: Map<string, string[]>,
    graph: SemanticGraph,
): Issue | null {
    const visited = new Set<string>();
    const queue: Array<{ id: string; path: string[] }> = [{ id: node.id, path: [node.name] }];
    let queueHead = 0;

    while (queueHead < queue.length) {
        const current = queue[queueHead++]!;
        if (current.path.length > MAX_INTER_PROCEDURAL_QUERY_DEPTH) continue;

        const targets = callsMap.get(current.id) || [];
        for (const targetId of targets) {
            if (visited.has(targetId)) continue;
            visited.add(targetId);

            const targetNode = graph.getNode(targetId);
            if (!targetNode) continue;

            const newPath = [...current.path, targetNode.name];
            if (isDataQuerySymbol(targetNode.name, targetNode.location.file)) {
                return createIndirectQueryIssue(node, targetNode, newPath);
            }
            queue.push({ id: targetId, path: newPath });
        }
    }
    return null;
}

/**
 * Evaluates the unified SemanticGraph to detect cross-procedural N+1 query patterns.
 *
 * @param graph - SemanticGraph instance with symbols and call edges.
 * @param options - Data architecture options.
 * @returns Detected cross-procedural data architecture issues.
 */
export function auditDataGraphArchitecture(
    graph: SemanticGraph,
    options: DataArchitectureOptions = {},
): Issue[] {
    const issues: Issue[] = [];
    if (options.checkNPlusOne === false) return issues;

    const allNodes = graph.getAllNodes();
    const callsEdges = graph.getAllEdges().filter((edge) => edge.kind === EDGE_KIND_CALLS);
    const callsMap = new Map<string, string[]>();

    for (const edge of callsEdges) {
        if (!callsMap.has(edge.fromNodeId)) {
            callsMap.set(edge.fromNodeId, []);
        }
        callsMap.get(edge.fromNodeId)!.push(edge.toNodeId);
    }

    for (const node of allNodes) {
        if (!isLoopCallerNode(node.name)) continue;
        const issue = findIndirectStorageQueryIssue(node, callsMap, graph);
        if (issue) issues.push(issue);
    }

    return issues;
}

/** Backward-compatible export alias for auditDataGraphArchitecture. */
export const analyzeDataArchitectureWithGraph = auditDataGraphArchitecture;

/**
 * Tests if a symbol name implies iterative or loop execution.
 */
function isLoopCallerNode(name: string): boolean {
    const lower = name.toLowerCase();
    return (
        lower.includes(TOKEN_LOOP) ||
        lower.includes(TOKEN_BATCH) ||
        lower.includes(TOKEN_ITERATE) ||
        lower.includes(TOKEN_EACH) ||
        lower.includes(TOKEN_PROCESS_ITEMS) ||
        lower.includes(TOKEN_HANDLE_ORDERS)
    );
}

/**
 * Tests if a symbol or its container represents persistent storage retrieval.
 */
function isDataQuerySymbol(name: string, filePath: string): boolean {
    const lower = name.toLowerCase();
    const isBatch =
        lower.includes(TOKEN_BATCH) || lower.includes(TOKEN_BULK) || lower.includes(TOKEN_INLIST);
    if (isBatch) return false;

    const isQueryName =
        lower.startsWith(PREFIX_FIND) ||
        lower.startsWith(PREFIX_SELECT) ||
        lower.startsWith(PREFIX_QUERY) ||
        lower.startsWith(PREFIX_GETBY) ||
        lower.startsWith(PREFIX_FETCH);

    const isRepoFile =
        filePath.toLowerCase().includes(TOKEN_REPOSITORY) ||
        filePath.toLowerCase().includes(TOKEN_DAO) ||
        filePath.toLowerCase().includes(FILE_TOKEN_STORE);

    return isQueryName || isRepoFile;
}

interface IndirectDetailContext {
    readonly callerName: string;
    readonly queryFile: string;
    readonly callerFile: string;
    readonly pathStr: string;
    readonly evidence: SemanticEvidenceStep[];
}

function buildIndirectDetail(ctx: IndirectDetailContext): SemanticReviewDetail {
    return {
        language: LANGUAGE_TYPESCRIPT,
        module: MODULE_DATA_ACCESS,
        symbol: ctx.callerName,
        codeDomain: CODE_DOMAIN_DATA_ARCHITECTURE,
        currentBehavior: `Indirect N+1 query dispatched via downstream call: ${ctx.pathStr}`,
        semanticEvidenceChain: ctx.evidence,
        [DETAIL_KEYS.trigger]: 'Iterative context dispatches calls reaching persistence queries',
        risk: 'Dispatches N separate database roundtrips across call boundaries.',
        blastRadius: [ctx.callerFile, ctx.queryFile],
        [DETAIL_KEYS.reliable]: true,
        requiresManualConfirm: false,
        [DETAIL_KEYS.remedy]:
            'Batch identifiers into a single batch query before entering the loop.',
        impactedCallers: [],
        impactedTests: [],
        [DETAIL_KEYS.method]: 'Verify query count is constant (O(1)) across iterations.',
        ruleVersion: DEFAULT_RULE_VERSION,
        configVersion: DEFAULT_CONFIG_VERSION,
        canAutofix: false,
    };
}

/**
 * Creates an issue for indirect inter-procedural N+1 query.
 */
function createIndirectQueryIssue(
    caller: { location: { file: string; start: { line: number; column: number } }; name: string },
    queryTarget: { location: { file: string }; name: string },
    callPath: string[],
): Issue {
    const pathStr = callPath.join(CALL_ARROW_SEPARATOR);
    const evidence: SemanticEvidenceStep[] = [
        {
            kind: EVIDENCE_KINDS.loop,
            description: `Iteration caller method '${caller.name}'`,
            file: caller.location.file,
            line: caller.location.start.line,
            symbol: caller.name,
        },
        {
            kind: EVIDENCE_KINDS.call,
            description: `Inter-procedural call sequence: ${pathStr}`,
            file: caller.location.file,
            line: caller.location.start.line,
            symbol: caller.name,
        },
        {
            kind: EVIDENCE_KINDS.io,
            description: `Terminal database query in '${queryTarget.name}'`,
            file: queryTarget.location.file,
            line: 1,
            symbol: queryTarget.name,
        },
    ];

    const detail = buildIndirectDetail({
        callerName: caller.name,
        queryFile: queryTarget.location.file,
        callerFile: caller.location.file,
        pathStr,
        evidence,
    });

    return {
        id: `${ANALYZER_DATA_ARCHITECTURE}:DAT-NPL-001:${caller.location.file}:${caller.location.start.line}`,
        analyzer: ANALYZER_DATA_ARCHITECTURE,
        rule: 'DAT-NPL-001',
        severity: SEVERITY_ERROR,
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

function updateLoopDepth(trimmed: string, inLoop: number): number {
    let nextDepth = inLoop;
    if (isLoopStart(trimmed)) {
        const isSingleLine =
            trimmed.includes('=>') && (trimmed.endsWith(');') || trimmed.endsWith(')'));
        if (!isSingleLine) {
            nextDepth++;
        }
    }
    return nextDepth;
}

interface LineAuditContext {
    readonly filePath: string;
    readonly lineNo: number;
    readonly trimmed: string;
    readonly inLoop: number;
    readonly isOnline: boolean;
}

function auditDataArchitectureLine(ctx: LineAuditContext, issues: Issue[]): void {
    if (ctx.inLoop > 0) {
        if (isDatabaseQueryLine(ctx.trimmed)) {
            issues.push(createLoopQueryIssue(ctx.filePath, ctx.lineNo, ctx.trimmed));
        } else if (
            ctx.trimmed.includes(STRING_JSON_STRINGIFY) ||
            ctx.trimmed.includes(STRING_JSON_PARSE)
        ) {
            issues.push(createLoopSerializationIssue(ctx.filePath, ctx.lineNo, ctx.trimmed));
        }
    }

    if (ctx.isOnline && isUnboundedQueryLine(ctx.trimmed)) {
        issues.push(createUnboundedQueryIssue(ctx.filePath, ctx.lineNo, ctx.trimmed));
    }

    if (isDriverCallLine(ctx.trimmed) && isPureDomainFile(ctx.filePath)) {
        issues.push(createLeakyAbstractionIssue(ctx.filePath, ctx.lineNo, ctx.trimmed));
    }

    if (DANGLING_RESOURCE_PATH_RE.test(ctx.trimmed)) {
        const syntheticSite: DataAccessSite = {
            file: ctx.filePath,
            line: ctx.lineNo,
            symbol: SYMBOL_GLOBAL,
            isOnlinePath: ctx.isOnline,
            isLoopContext: ctx.inLoop > 0,
            isUnboundedQuery: false,
            operationKind: OP_KIND_RESOURCE_REGISTRY,
            expressionText: ctx.trimmed,
        };
        const registryIssue = checkResourceRegistrySite(syntheticSite);
        if (registryIssue) issues.push(registryIssue);
    }
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
    if (isToolOrTestScript(filePath)) {
        return [];
    }
    const issues: Issue[] = [];
    const lines = content.split(/\r?\n/);
    const isOnline = isOnlinePath(filePath, content, options);

    let inLoop = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const lineNo = i + 1;

        inLoop = updateLoopDepth(trimmed, inLoop);
        auditDataArchitectureLine({ filePath, lineNo, trimmed, inLoop, isOnline }, issues);

        if (isLoopEnd(trimmed) && inLoop > 0) {
            inLoop--;
        }
    }

    return issues;
}

/**
 * Evaluator contract supporting both standard and legacy audit invocation styles.
 */
export interface IDataArchitectureEvaluator {
    audit?(
        filePath: string,
        content: string,
        graph?: SemanticGraph,
        options?: DataArchitectureOptions,
    ): Issue[];
}

/**
 * Unified data architecture evaluator combining AST source inspection and semantic graphs.
 */
export class DataArchitectureEvaluator implements IDataArchitectureEvaluator {
    public readonly audit: (
        filePath: string,
        content: string,
        graph?: SemanticGraph,
        options?: DataArchitectureOptions,
    ) => Issue[];

    public constructor() {
        this.audit = (filePath, content, graph, options) =>
            this.auditDataArchitecture(filePath, content, graph, options);
    }

    /**
     * Executes data architecture review across file source and optional graph.
     *
     * @param filePath - Source file path.
     * @param content - Source file content string.
     * @param graph - Optional SemanticGraph instance.
     * @param options - Review configuration options.
     * @returns Array of detected issues.
     */
    public auditDataArchitecture(
        filePath: string,
        content: string,
        graph?: SemanticGraph,
        options: DataArchitectureOptions = {},
    ): Issue[] {
        const issues: Issue[] = [...auditDataArchitectureSource(filePath, content, options)];
        if (graph) {
            issues.push(...auditDataGraphArchitecture(graph, options));
        }
        return issues;
    }
}

/** Default singleton instance of DataArchitectureEvaluator */
export const defaultDataArchitectureEvaluator = new DataArchitectureEvaluator();
