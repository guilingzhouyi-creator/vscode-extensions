/**
 * Module: Core Intelligence — Data Architecture Site Diagnostics & Issue Construction
 * File Path: src/core/intelligence/data-architecture-sites.ts
 * Architecture Role: Focused diagnostic engine evaluating discrete data access sites,
 *   unbounded query shapes, N+1 iterations, redundant serialization, and resource registries.
 * Dependencies & Triggers: Core types (Issue, SemanticEvidenceStep, SemanticReviewDetail);
 *   consumed by dataArchitecture facade and DataArchitectureAnalyzer.
 * Responsibilities:
 *   1. Define DataAccessSite and DataArchitectureOptions contracts;
 *   2. Implement site-level diagnostic auditors (unbounded queries, N+1 loop calls, leaky abstractions);
 *   3. Enforce bidirectional physical asset path validation for resource registries (DAT-RES-001);
 *   4. Construct structured, reproducible evidence chains and Section VII diagnostic issues.
 * Exit Semantics & Design Rationale: Pure in-memory AST and pattern reasoning without external
 *   database dependencies; issues include full evidence chains and risk assessments.
 */

import type { Issue, SemanticEvidenceStep, SemanticReviewDetail } from '../types';
import { isToolOrTestScript } from '../governance/pathScope';
import { REGEX } from '../constants';

const DEFAULT_RULE_VERSION = '1.0.0';
const DEFAULT_CONFIG_VERSION = '0.3.0';

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
const OP_KIND_QUERY = 'query';
const OP_KIND_SERIALIZATION = 'serialization';
const OP_KIND_VALIDATION = 'validation';
const OP_KIND_DRIVER_CALL = 'driver-call';

const SEVERITY_ERROR = 'error';
const SEVERITY_WARNING = 'warning';
const SEVERITY_INFO = 'info';

const DEFAULT_REPORT_COLUMN = 80;
const TOKEN_REPOSITORY = 'repository';
const TOKEN_DATA = 'data';

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
    operationKind: 'query' | 'serialization' | 'validation' | 'driver-call' | 'resource-registry';
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

export interface SimpleReviewContext {
    readonly filePath: string;
    readonly behavior: string;
    readonly risk: string;
    readonly fix: string;
    readonly evidence?: SemanticEvidenceStep[];
}

export function buildSimpleReviewDetail(ctx: SimpleReviewContext): SemanticReviewDetail {
    return {
        language: LANGUAGE_TYPESCRIPT,
        module: MODULE_DATA_ACCESS,
        symbol: SYMBOL_GLOBAL,
        codeDomain: CODE_DOMAIN_DATA_ARCHITECTURE,
        currentBehavior: ctx.behavior,
        semanticEvidenceChain: ctx.evidence ?? [],
        [DETAIL_KEYS.trigger]: ctx.behavior,
        risk: ctx.risk,
        blastRadius: [ctx.filePath],
        [DETAIL_KEYS.reliable]: true,
        requiresManualConfirm: false,
        [DETAIL_KEYS.remedy]: ctx.fix,
        impactedCallers: [],
        impactedTests: [],
        [DETAIL_KEYS.method]: 'Run automated static and integration checks.',
        ruleVersion: DEFAULT_RULE_VERSION,
        configVersion: DEFAULT_CONFIG_VERSION,
        canAutofix: false,
    };
}

export interface DataArchitectureIssueContext {
    readonly filePath: string;
    readonly line: number;
    readonly rule: string;
    readonly severity: 'error' | 'warning' | 'info';
    readonly message: string;
    readonly behavior: string;
    readonly risk: string;
    readonly suggestion: string;
}

export function createDataArchitectureIssue(ctx: DataArchitectureIssueContext): Issue {
    return {
        id: `data-architecture:${ctx.rule}:${ctx.filePath}:${ctx.line}`,
        analyzer: ANALYZER_DATA_ARCHITECTURE,
        rule: ctx.rule,
        severity: ctx.severity,
        message: ctx.message,
        location: {
            file: ctx.filePath,
            start: { line: ctx.line, column: 1 },
            end: { line: ctx.line, column: 1 },
        },
        detail: buildSimpleReviewDetail({
            filePath: ctx.filePath,
            behavior: ctx.behavior,
            risk: ctx.risk,
            fix: ctx.suggestion,
        }),
        suggestion: ctx.suggestion,
    };
}

export function createLoopQueryIssue(filePath: string, line: number, text: string): Issue {
    return createDataArchitectureIssue({
        filePath,
        line,
        rule: 'DAT-NPL-001',
        severity: SEVERITY_ERROR,
        message: `N+1 query hazard: persistent storage query executed inside loop: '${text}'.`,
        behavior: `Persistent storage query executed inside loop: '${text}'`,
        risk: 'Dispatches N separate roundtrips across iterations.',
        suggestion: 'Hoist query outside loop and use a batch IN clause or dataloader pattern.',
    });
}

export function createUnboundedQueryIssue(filePath: string, line: number, text: string): Issue {
    return createDataArchitectureIssue({
        filePath,
        line,
        rule: 'DAT-QRY-001',
        severity: SEVERITY_WARNING,
        message: `Unbounded query without limit or pagination on online path: '${text}'.`,
        behavior: `Unbounded query executed on online path: '${text}'`,
        risk: 'Risk of memory exhaustion or large DB lock.',
        suggestion: 'Enforce maximum page size or cursor limit on online queries.',
    });
}

export function createLoopSerializationIssue(filePath: string, line: number, text: string): Issue {
    return createDataArchitectureIssue({
        filePath,
        line,
        rule: 'DAT-SER-001',
        severity: SEVERITY_INFO,
        message: `Repetitive serialization inside iteration: '${text}'.`,
        behavior: `Repetitive JSON serialization inside iteration: '${text}'`,
        risk: 'CPU churn and GC memory pressure in hot loops.',
        suggestion: 'Operate on native in-memory objects; serialize only at network perimeter.',
    });
}

export function createLeakyAbstractionIssue(filePath: string, line: number, text: string): Issue {
    return createDataArchitectureIssue({
        filePath,
        line,
        rule: 'DAT-LAY-001',
        severity: SEVERITY_WARNING,
        message: `Leaky data access abstraction: raw persistence driver call in domain layer: '${text}'.`,
        behavior: `Raw persistence driver call in domain layer: '${text}'`,
        risk: 'Tight coupling to storage implementation.',
        suggestion: 'Abstract database operations behind a repository interface.',
    });
}

/** Regex pattern detecting resource registration call sites (SSOT pointer). */
export const DANGLING_RESOURCE_PATH_RE = REGEX.DATA.DANGLING_RESOURCE_PATH;

const DANGLING_TARGET_RE = REGEX.DATA.DANGLING_TARGET;

export function createResourceRegistryIssue(
    filePath: string,
    line: number,
    text: string,
    detailMsg: string,
): Issue {
    return createDataArchitectureIssue({
        filePath,
        line,
        rule: 'DAT-RES-001',
        severity: SEVERITY_WARNING,
        message: `Resource registry bidirectional mapping inconsistency: ${detailMsg} ('${text}').`,
        behavior: `Resource registry broken or dangling mapping in '${filePath}': '${text}'`,
        risk: 'Broken asset loading, dangling memory pointer, or orphan assets.',
        suggestion:
            'Ensure bidirectional registration in resource center and eliminate dangling asset paths.',
    });
}

/**
 * Checks a data access site for dangling or unmapped physical asset paths.
 *
 * @param site - Data access site descriptor.
 * @returns Detected DAT-RES-001 issue or null.
 */
export function checkResourceRegistrySite(site: DataAccessSite): Issue | null {
    if (site.operationKind !== OP_KIND_RESOURCE_REGISTRY) return null;
    const match = DANGLING_RESOURCE_PATH_RE.exec(site.expressionText);
    if (!match) return null;
    const key = match[1]?.trim();
    const assetPath = match[2]?.trim();
    if (!key || assetPath === undefined || DANGLING_TARGET_RE.test(assetPath)) {
        return createResourceRegistryIssue(
            site.file,
            site.line,
            site.expressionText,
            `Empty or unmapped physical asset path for resource key '${key}'`,
        );
    }
    return null;
}

export interface SiteDetailOptions {
    readonly behavior: string;
    readonly evidence: SemanticEvidenceStep[];
    readonly trigger: string;
    readonly risk: string;
    readonly remedy: string;
    readonly method: string;
    readonly reliable?: boolean;
}

export function buildSiteDetail(site: DataAccessSite, options: SiteDetailOptions): SemanticReviewDetail {
    const isDeterministic = options.reliable ?? true;
    return {
        language: LANGUAGE_TYPESCRIPT,
        module: MODULE_DATA_ACCESS,
        symbol: site.symbol,
        codeDomain: CODE_DOMAIN_DATA_ARCHITECTURE,
        currentBehavior: options.behavior,
        semanticEvidenceChain: options.evidence,
        [DETAIL_KEYS.trigger]: options.trigger,
        risk: options.risk,
        blastRadius: [site.file],
        [DETAIL_KEYS.reliable]: isDeterministic,
        requiresManualConfirm: !isDeterministic,
        [DETAIL_KEYS.remedy]: options.remedy,
        impactedCallers: [],
        impactedTests: [],
        [DETAIL_KEYS.method]: options.method,
        ruleVersion: DEFAULT_RULE_VERSION,
        configVersion: DEFAULT_CONFIG_VERSION,
        canAutofix: false,
    };
}

export interface SiteIssueOptions {
    readonly rule: string;
    readonly severity: 'warning' | 'error' | 'info';
    readonly message: string;
    readonly suggestion: string;
    readonly detail: SemanticReviewDetail;
    readonly confidence?: number;
}

export function buildSiteIssue(site: DataAccessSite, options: SiteIssueOptions): Issue {
    return {
        id: `data-architecture:${options.rule}:${site.file}:${site.line}`,
        analyzer: ANALYZER_DATA_ARCHITECTURE,
        rule: options.rule,
        severity: options.severity,
        message: options.message,
        location: {
            file: site.file,
            start: { line: site.line, column: 1 },
            end: { line: site.line, column: DEFAULT_REPORT_COLUMN },
        },
        detail: options.detail,
        suggestion: options.suggestion,
        evidence: { confidence: options.confidence ?? 0.95, requiresRuntime: false },
    };
}

export interface DiagnosticSpec {
    readonly site: DataAccessSite;
    readonly rule: string;
    readonly severity: 'warning' | 'error' | 'info';
    readonly summary: string;
    readonly remedy: string;
    readonly behavior: string;
    readonly evidence: SemanticEvidenceStep[];
    readonly trigger: string;
    readonly risk: string;
    readonly method: string;
    readonly confidence?: number;
    readonly reliable?: boolean;
}

export function buildSiteFinding(spec: DiagnosticSpec): Issue {
    const detail = buildSiteDetail(spec.site, {
        behavior: spec.behavior,
        evidence: spec.evidence,
        trigger: spec.trigger,
        risk: spec.risk,
        remedy: spec.remedy,
        method: spec.method,
        reliable: spec.reliable,
    });
    return buildSiteIssue(spec.site, {
        rule: spec.rule,
        severity: spec.severity,
        message: spec.summary,
        suggestion: spec.remedy,
        detail,
        confidence: spec.confidence,
    });
}

export function checkUnboundedQuerySite(site: DataAccessSite): Issue | null {
    if (!site.isOnlinePath || !site.isUnboundedQuery) return null;
    return buildSiteFinding({
        site,
        rule: 'DAT-QRY-001',
        severity: SEVERITY_WARNING,
        summary: `Unbounded query on online request path: '${site.expressionText}' lacks pagination limit.`,
        remedy: 'Introduce limit/cursor parameters to enforce bounded result sets.',
        behavior: `Querying persistent storage with unbounded fetch: '${site.expressionText}'.`,
        evidence: [
            {
                kind: EVIDENCE_KINDS.condition,
                description: `Online request handler in '${site.symbol}'`,
                file: site.file,
                line: site.line,
                symbol: site.symbol,
            },
            {
                kind: EVIDENCE_KINDS.io,
                description: `Unbounded query without pagination/cursor limit: '${site.expressionText}'`,
                file: site.file,
                line: site.line,
                symbol: site.symbol,
            },
        ],
        trigger: 'Unpaginated query execution detected within an online request handler',
        risk: 'Database query may return unbounded records under production data volume, causing OOM or high latency.',
        method: 'Verify query SQL/ORM execution includes LIMIT and OFFSET/cursor constraints.',
    });
}

export function checkLoopQuerySite(site: DataAccessSite): Issue | null {
    if (!site.isLoopContext || site.operationKind !== OP_KIND_QUERY) return null;
    return buildSiteFinding({
        site,
        rule: 'DAT-NPL-001',
        severity: SEVERITY_ERROR,
        summary: `N+1 query hazard: persistent storage fetch executed inside iteration in '${site.symbol}'.`,
        remedy: 'Hoist query outside loop and use a batch IN clause or dataloader pattern.',
        behavior: `Executing query '${site.expressionText}' inside a loop or mapping iteration.`,
        evidence: [
            {
                kind: EVIDENCE_KINDS.loop,
                description: `Iterative execution block in '${site.symbol}'`,
                file: site.file,
                line: site.line,
                symbol: site.symbol,
            },
            {
                kind: EVIDENCE_KINDS.io,
                description: `Database or storage query executed inside iteration: '${site.expressionText}'`,
                file: site.file,
                line: site.line,
                symbol: site.symbol,
            },
        ],
        trigger: 'Persistent storage query dispatched inside an iteration loop',
        risk: 'Dispatches N separate database roundtrips for N items, causing severe database connection starvation.',
        method: 'Assert database query count equals 1 regardless of collection size.',
    });
}

export function checkRedundantSerializationSite(site: DataAccessSite): Issue | null {
    if (site.operationKind !== OP_KIND_SERIALIZATION || !site.isLoopContext) return null;
    return buildSiteFinding({
        site,
        rule: 'DAT-SER-001',
        severity: SEVERITY_INFO,
        summary: `Redundant serialization cycle inside iteration: '${site.expressionText}'.`,
        remedy: 'Operate on native objects in memory and serialize only at the external boundary.',
        behavior: `Repeatedly parsing or stringifying objects inside an iteration block: '${site.expressionText}'.`,
        evidence: [
            {
                kind: EVIDENCE_KINDS.loop,
                description: `Loop iteration in '${site.symbol}'`,
                file: site.file,
                line: site.line,
                symbol: site.symbol,
            },
            {
                kind: EVIDENCE_KINDS.allocation,
                description: `Repetitive serialization/deserialization: '${site.expressionText}'`,
                file: site.file,
                line: site.line,
                symbol: site.symbol,
            },
        ],
        trigger: 'Serialization roundtrip invoked per item within an iteration loop',
        risk: 'Excessive CPU overhead and memory churn from JSON encoding/decoding inside critical paths.',
        method: 'Benchmark JSON parse/stringify invocations across pipeline execution.',
        confidence: 0.85,
    });
}

export function checkDefensiveExcessSite(
    site: DataAccessSite,
    validationCounts: Map<string, number>,
): Issue | null {
    if (site.operationKind !== OP_KIND_VALIDATION) return null;
    if (isToolOrTestScript(site.file)) return null;
    const count = (validationCounts.get(site.symbol) ?? 0) + 1;
    validationCounts.set(site.symbol, count);

    if (count <= 2 || site.isOnlinePath) return null;

    return buildSiteFinding({
        site,
        rule: 'DAT-DEF-001',
        severity: SEVERITY_INFO,
        summary: `Excessive defensive validation in internal domain logic: '${site.expressionText}'.`,
        remedy: 'Retain perimeter validation at entry boundaries; rely on typed value objects internally.',
        behavior: `Repeated redundant parameter and invariant validation in internal function '${site.symbol}'.`,
        evidence: [
            {
                kind: EVIDENCE_KINDS.condition,
                description: `Internal non-perimeter domain logic in '${site.symbol}'`,
                file: site.file,
                line: site.line,
                symbol: site.symbol,
            },
            {
                kind: EVIDENCE_KINDS.condition,
                description: `Repeated defensive validation of already established invariant: '${site.expressionText}'`,
                file: site.file,
                line: site.line,
                symbol: site.symbol,
            },
        ],
        trigger:
            'Multiple repetitive assertions on trusted internal domain types within non-perimeter code',
        risk: 'Obscures business flow with noisy defensive checks; masks true ownership of invariant enforcement.',
        method: 'Verify unit tests validate invariant failures at boundary rather than internal functions.',
        confidence: 0.8,
        reliable: false,
    });
}

export function checkLeakyAbstractionSite(site: DataAccessSite): Issue | null {
    if (
        site.operationKind !== OP_KIND_DRIVER_CALL ||
        site.file.includes(TOKEN_REPOSITORY) ||
        site.file.includes(TOKEN_DATA)
    ) {
        return null;
    }
    return buildSiteFinding({
        site,
        rule: 'DAT-LAY-001',
        severity: SEVERITY_WARNING,
        summary: `Leaky data access abstraction: raw persistence driver call in domain layer '${site.file}'.`,
        remedy: 'Abstract database operations behind a repository interface.',
        behavior: `Directly invoking storage driver/SQL execution from non-repository file '${site.file}'.`,
        evidence: [
            {
                kind: EVIDENCE_KINDS.call,
                description: `Low-level database driver call in business domain: '${site.expressionText}'`,
                file: site.file,
                line: site.line,
                symbol: site.symbol,
            },
        ],
        trigger: 'Low-level persistence API directly referenced outside repository layer',
        risk: 'Tight coupling of domain logic to specific persistence driver prevents testing and schema evolution.',
        method: 'Verify domain module imports only repository interfaces, not raw database clients.',
        confidence: 0.9,
    });
}

export function collectSiteIssues(
    site: DataAccessSite,
    options: DataArchitectureOptions,
    validationCounts: Map<string, number>,
    issues: Issue[],
): void {
    const unb = options.checkUnboundedQueries !== false ? checkUnboundedQuerySite(site) : null;
    if (unb) issues.push(unb);
    const loopQueryIssue = options.checkNPlusOne !== false ? checkLoopQuerySite(site) : null;
    if (loopQueryIssue) issues.push(loopQueryIssue);
    const red =
        options.checkRedundantSerialization !== false
            ? checkRedundantSerializationSite(site)
            : null;
    if (red) issues.push(red);
    const def =
        options.checkDefensiveExcess !== false
            ? checkDefensiveExcessSite(site, validationCounts)
            : null;
    if (def) issues.push(def);
    const leaky = checkLeakyAbstractionSite(site);
    if (leaky) issues.push(leaky);
    const registryIssue = checkResourceRegistrySite(site);
    if (registryIssue) issues.push(registryIssue);
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
    const symbolValidationCountMap = new Map<string, number>();

    for (const site of sites) {
        collectSiteIssues(site, options, symbolValidationCountMap, issues);
    }

    return issues;
}
