/**
 * Module: Core Intelligence — Near-Literal Calling Domain Clustering Scanner
 * File Path: src/core/intelligence/near-literal-cluster.ts
 * Architecture Role: Detects unextracted sibling literals in the same calling scope or adjacent
 *     code block (HTTP status codes, protocol values, path fragments, event names) when one
 *     constant is extracted, preventing incomplete "fix-one-miss-all" partial refactoring.
 * Dependencies & Triggers: Consumes LiteralRecord from incremental-state and
 *     generateSemanticConstantName from semantic-naming-engine; consumed by ConstantsAnalyzer.
 * Responsibilities:
 *     1. Group literals by calling scope and proximity window (+-25 lines).
 *     2. Categorize literals into semantic families (status, protocol, duration, route, event).
 *     3. Identify incomplete clusters where some literals remain hardcoded
 *        while others are promoted.
 *     4. Emit canonical CONST-CLU-001 issues with batch extraction recommendations.
 * Exit Semantics & Design Rationale: Deterministic and pure function without side effects.
 */

import type { Issue } from '../types';
import type { LiteralRecord } from '../incremental-state';
import { generateSemanticConstantName } from '../governance/semantic-naming-engine';
import { classifyLiteral } from '../governance/semanticLiterals';
import { locN } from '../../utils/normalized';
import { ConstantsMessages } from '../messages/constants';

const LOCAL_WINDOW_LINE_DELTA = 25;
const MIN_CLUSTER_SIZE = 2;
const MIN_UNEXTRACTED_TRIGGER = 2;

const CONSTANTS_ANALYZER = 'constants';
const RULE_CONST_CLU_001 = 'CONST-CLU-001';
const SEVERITY_WARNING = 'warning';

const FAMILY_HTTP_STATUS = 'http_status';
const FAMILY_DURATION_MS = 'duration_ms';
const FAMILY_NETWORK_PORT = 'network_port';
const FAMILY_PATH_ROUTE = 'path_route';
const FAMILY_EVENT_NAME = 'event_name';
const FAMILY_STATUS_FLAG = 'status_flag';
const FAMILY_URL_ENDPOINT = 'url_endpoint';
const FAMILY_FILE_PATH = 'file_path';

const HTTP_STATUS_MIN = 100;
const HTTP_STATUS_MAX = 599;
const DURATION_MS_MIN = 1000;
const DURATION_MS_MAX = 86400000;
const DURATION_STEP_1000 = 1000;

const KNOWN_PORT_SET = new Set([80, 443, 3000, 8080, 5432, 6379, 27017]);
const KNOWN_EVENT_SET = new Set([
    'click',
    'change',
    'input',
    'keydown',
    'keyup',
    'submit',
    'load',
    'error',
]);
const KNOWN_STATUS_SET = new Set([
    'ok',
    'error',
    'pending',
    'ready',
    'active',
    'inactive',
    'success',
    'failed',
]);

/**
 * Semantic cluster representing sibling literals belonging to the same domain.
 */
export interface SiblingLiteralCluster {
    clusterKey: string;
    family: string;
    startLine: number;
    endLine: number;
    literals: LiteralRecord[];
    hasExtractedConstant: boolean;
    hasHardcodedInline: boolean;
}

function identifyNumericFamily(n: number): string | null {
    if (n >= HTTP_STATUS_MIN && n <= HTTP_STATUS_MAX) return FAMILY_HTTP_STATUS;
    if (n >= DURATION_MS_MIN && n <= DURATION_MS_MAX && n % DURATION_STEP_1000 === 0) {
        return FAMILY_DURATION_MS;
    }
    if (KNOWN_PORT_SET.has(n)) return FAMILY_NETWORK_PORT;
    return null;
}

function identifyStringFamily(rawVal: string): string | null {
    const val = rawVal.replace(/^['"`]|['"`]$/g, '').trim();
    if (val.startsWith('/') || val.includes('/')) return FAMILY_PATH_ROUTE;
    if (KNOWN_EVENT_SET.has(val.toLowerCase())) return FAMILY_EVENT_NAME;
    if (KNOWN_STATUS_SET.has(val.toLowerCase())) return FAMILY_STATUS_FLAG;

    const classification = classifyLiteral(val, false);
    if (classification.kind === 'url') return FAMILY_URL_ENDPOINT;
    if (classification.kind === 'file-path') return FAMILY_FILE_PATH;
    return null;
}

/**
 * Identifies the semantic family of a literal record.
 */
function identifyLiteralFamily(lit: LiteralRecord): string | null {
    if (lit.numeric) {
        return identifyNumericFamily(Number(lit.value));
    }
    return identifyStringFamily(lit.value);
}

function tryAppendToCluster(
    cluster: SiblingLiteralCluster,
    lit: LiteralRecord,
    family: string,
    line: number,
): boolean {
    if (cluster.family !== family || Math.abs(line - cluster.endLine) > LOCAL_WINDOW_LINE_DELTA) {
        return false;
    }
    cluster.literals.push(lit);
    cluster.endLine = Math.max(cluster.endLine, line);
    cluster.startLine = Math.min(cluster.startLine, line);
    if (lit.isConstBound) cluster.hasExtractedConstant = true;
    else cluster.hasHardcodedInline = true;
    return true;
}

/**
 * Inserts a literal record into an existing cluster within range, or creates a new one.
 */
function addCandidateToClusters(lit: LiteralRecord, clusters: SiblingLiteralCluster[]): void {
    const family = identifyLiteralFamily(lit);
    if (!family) return;

    const line = lit.line || (lit.node.start ? lit.node.start.line : 1);
    for (const cluster of clusters) {
        if (tryAppendToCluster(cluster, lit, family, line)) {
            return;
        }
    }

    clusters.push({
        clusterKey: `${family}:${line}`,
        family,
        startLine: line,
        endLine: line,
        literals: [lit],
        hasExtractedConstant: lit.isConstBound,
        hasHardcodedInline: !lit.isConstBound,
    });
}

/**
 * Evaluates an individual cluster and builds a finding if extraction is incomplete.
 */
function buildClusterIssue(cluster: SiblingLiteralCluster, filePath: string): Issue | null {
    const unextracted = cluster.literals.filter((l) => !l.isConstBound);
    if (unextracted.length === 0) return null;

    const isIncomplete =
        cluster.hasExtractedConstant || unextracted.length >= MIN_UNEXTRACTED_TRIGGER;
    if (!isIncomplete) return null;

    const firstUnextracted = unextracted[0];
    const suggestions = unextracted.map((l) => {
        const suggestedName = generateSemanticConstantName(l.value, l.numeric);
        return `const ${suggestedName} = ${l.value}; (line ${l.line})`;
    });

    const desc = ConstantsMessages.UNEXTRACTED_CLUSTER_LEAK(
        cluster.family,
        unextracted.length,
        cluster.hasExtractedConstant,
    );

    return {
        id: `${CONSTANTS_ANALYZER}:${RULE_CONST_CLU_001}:${filePath}:${firstUnextracted.line}`,
        analyzer: CONSTANTS_ANALYZER,
        rule: RULE_CONST_CLU_001,
        severity: SEVERITY_WARNING,
        message: desc.message,
        location: locN(firstUnextracted.node, filePath),
        detail: {
            family: cluster.family,
            totalClusterCount: cluster.literals.length,
            unextractedCount: unextracted.length,
            lines: unextracted.map((l) => l.line),
            values: unextracted.map((l) => l.value),
        },
        suggestion: `${desc.suggestion}:\n  ${suggestions.join('\n  ')}`,
    };
}

/**
 * Scans literals in a file and detects incomplete clustering extractions.
 *
 * @param literals - All literal records observed in the file traversal.
 * @param filePath - Path to the file being scanned.
 * @returns List of CONST-CLU-001 issues for incomplete clusters.
 */
export function scanNearLiteralClusters(literals: LiteralRecord[], filePath: string): Issue[] {
    const issues: Issue[] = [];
    if (literals.length < MIN_CLUSTER_SIZE) return issues;

    const candidates = literals.filter((l) => {
        if (l.tolerated) return false;
        if (l.numeric && ['0', '1', '-1'].includes(l.value)) return false;
        return true;
    });

    const clusters: SiblingLiteralCluster[] = [];
    for (const lit of candidates) {
        addCandidateToClusters(lit, clusters);
    }

    for (const cluster of clusters) {
        const issue = buildClusterIssue(cluster, filePath);
        if (issue) issues.push(issue);
    }

    return issues;
}
