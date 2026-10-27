/**
 * Module: Core Reporting — Agent Audit Schema (AAS v1.0) Serializer
 * File Path: src/core/reporting/aas-reporter.ts
 * Architecture Role: Token-frugal, Agent-native review serialization engine. Groups
 *   findings by file in topological order, inlining code anchors and localized verify commands.
 * Dependencies & Triggers: Consumes ../types, ./aas-types, and agentConstraintGenerator;
 *   registered in reporterRegistry.ts and invoked by CLI/API formatters.
 * Responsibilities:
 *   1. Assemble executive verdict and health block for zero-latency triage.
 *   2. Group defects per file, eliminating thousands of duplicated path strings.
 *   3. Inject concise anchor code context and targeted verification commands.
 *   4. Order impacted files topologically (L1_CONTRACT -> L5_GOVERNANCE).
 * Exit Semantics & Design Rationale: Pure, non-throwing transformation. Adheres strictly
 *   to CC <= 10, Depth <= 3, and zero transient loop allocation (PRF-MEM-001) with no sync I/O.
 */

import * as path from 'path';
import type { Issue, ScanReport, Severity } from '../types';
import type { QualityScoreBreakdown } from '../scoring/scoringTypes';
import {
    formatAnchorSlice,
    resolveTopologyLayer,
    generateVerificationDirective,
    type AgentTopologyLayer,
} from '../guidance/agentConstraintGenerator';
import {
    AAS_SCHEMA_ID,
    type AasBottleneck,
    type AasCounts,
    type AasDefectRecord,
    type AasFixRecipe,
    type AasHealth,
    type AasReportOptions,
    type AasSeverity,
    type AasVerdict,
    type AgentAuditReport,
} from './aas-types';

export * from './aas-types';

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_DEFECTS_PER_FILE = 50;
const DEFAULT_MAX_TOTAL_DEFECTS = 500;
const DEFAULT_CONTEXT_RADIUS = 1;
const DEFAULT_MAX_MESSAGE_CHARS = 160;
const DEFAULT_BOTTLENECKS_LIMIT = 8;
const DEFAULT_VERIFY_COMMAND = 'npm test';
const ELLIPSIS = '…';

const ROUND_SCALE_HUNDRED = 100;
const MAX_SUGGESTION_CHARS = 80;
const ELLIPSIS_TRUNCATE_CHARS = 77;
const UNRANKED_TOPOLOGY_WEIGHT = 99;

const SEVERITY_ERROR: Severity = 'error';
const SEVERITY_WARNING: Severity = 'warning';

const AAS_SEV_BLOCK: AasSeverity = 'BLOCK';
const AAS_SEV_WARN: AasSeverity = 'WARN';
const AAS_SEV_INFO: AasSeverity = 'INFO';

const VERDICT_BLOCK: AasVerdict = 'BLOCK';
const VERDICT_WARN: AasVerdict = 'WARN';
const VERDICT_PASS: AasVerdict = 'PASS';

const TOPOLOGY_ORDER: readonly string[] = [
    'L1_CONTRACT',
    'L2_OPERATOR',
    'L3_CONFIG',
    'L4_PRESENTATION',
    'L5_GOVERNANCE',
];

const TOPOLOGY_RANK: Readonly<Record<string, number>> = Object.freeze({
    L1_CONTRACT: 1,
    L2_OPERATOR: 2,
    L3_CONFIG: 3,
    L4_PRESENTATION: 4,
    L5_GOVERNANCE: 5,
});

/**
 * Maps static analysis severity onto Agent triage severity.
 *
 * @param sev - Finding severity.
 * @returns Mapped AAS severity.
 */
function mapSeverity(sev?: string): AasSeverity {
    if (sev === SEVERITY_ERROR) return AAS_SEV_BLOCK;
    return sev === SEVERITY_WARNING ? AAS_SEV_WARN : AAS_SEV_INFO;
}

/**
 * Derives executive triage verdict from aggregate severity counts.
 *
 * @param counts - Aggregated counts.
 * @returns Executive verdict.
 */
function resolveVerdict(counts: AasCounts): AasVerdict {
    if (counts.errors > 0) return VERDICT_BLOCK;
    return counts.warns > 0 ? VERDICT_WARN : VERDICT_PASS;
}

/**
 * Trims message to reasonable length for token conservation.
 *
 * @param text - Raw message string.
 * @param maxChars - Character ceiling.
 * @returns Shortened string.
 */
function trimMessage(text: string, maxChars: number = DEFAULT_MAX_MESSAGE_CHARS): string {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    return clean.length <= maxChars ? clean : clean.slice(0, Math.max(1, maxChars - 1)) + ELLIPSIS;
}

/**
 * Compresses diagnostic narrative into high-information-density token sentence.
 *
 * Implements the Five-Principle Compression Protocol (see token-frugal-sentence-and-diagnostic-spec.md).
 *
 * @param rawText - Raw narrative diagnostic string.
 * @returns Concise token-dense diagnostic sentence.
 */
export function compressDiagnosticSentence(rawText: string): string {
    if (!rawText) return '';
    let msg = rawText.replace(/\s+/g, ' ').trim();

    msg = msg.replace(
        /Identifier\s+('?[a-zA-Z0-9_$-]+'?)\s+contains\s+unapproved\s+truncated\s+abbreviation\s+('?[a-zA-Z0-9_$-]+'?)\.?/i,
        'identifier $1 unapproved abbr $2',
    );
    msg = msg.replace(
        /Identifier\s+('?[a-zA-Z0-9_$-]+'?)\s+is\s+vague\s+and\s+uninformative;\s*lacks\s+domain\s+context\.?/i,
        'identifier $1 lacks domain context',
    );
    msg = msg.replace(
        /(?:Function\s+or\s+method\s+name|Local\s+variable\s+name|Variable\s+name)\s+('?[a-zA-Z0-9_$-]+'?)\s+is\s+too\s+short\s*\(([^)]+)\)[^.]*\.?/i,
        'symbol $1 too short ($2)',
    );
    msg = msg.replace(
        /(?:Function\s+or\s+method\s+name|Variable\s+name)\s+('?[a-zA-Z0-9_$-]+'?)\s+is\s+excessively\s+long\s*\(([^)]+)\)[^.]*\.?/i,
        'symbol $1 too long ($2)',
    );
    msg = msg.replace(
        /Cognitive\s+complexity\s*\((\d+)\)\s*exceeds\s*threshold\s*\((\d+)\)\s*in\s*(?:function|method)?\s*('?[a-zA-Z0-9_$-]+'?)/i,
        'CC $1 > $2 in $3',
    );
    msg = msg.replace(/Effective\s+code\s+volume\s+budget\s+exceeded\.?/i, 'ELOC budget exceeded');
    msg = msg.replace(/Physical\s+line\s+count\s+ceiling\s+exceeded\.?/i, 'LOC ceiling exceeded');
    msg = msg.replace(/Dynamic\s+dilution\s+envelope\s+exceeded\.?/i, 'dilution envelope exceeded');
    msg = msg.replace(
        /Effective\s+logic\s+density\s+below\s+floor\s+threshold\.?/i,
        'token density below floor',
    );
    msg = msg.replace(
        /(?:Function|Method)\s+has\s+(\d+)\s+positional\s+parameters?\s+exceeding\s+threshold\s+of\s+(\d+)\.?/i,
        'params $1 > $2',
    );

    msg = msg.replace(/^(?:Notice|Warning|Error|Violation):\s*/i, '');
    return msg.trim();
}

/**
 * In-memory anchor extractor avoiding direct synchronous filesystem operations.
 */
class AnchorCache {
    private readonly cache = new Map<string, string | null>();
    private readonly customReader?: (relPath: string) => string | undefined;

    constructor(customReader?: (relPath: string) => string | undefined) {
        this.customReader = customReader;
    }

    public getAnchor(
        file: string,
        startLine: number,
        endLine: number,
        radius: number,
    ): string | undefined {
        if (!this.customReader) return undefined;
        let content = this.cache.get(file);
        if (content === undefined) {
            const raw = this.customReader(file);
            content = raw !== undefined ? raw : null;
            this.cache.set(file, content);
        }
        if (!content) return undefined;
        return formatAnchorSlice(content, startLine, endLine, radius);
    }
}

/**
 * Projects ten-dimensional quality vector scores if present.
 */
function projectDimensions(
    breakdown?: QualityScoreBreakdown,
): Partial<Record<string, number>> | undefined {
    if (!breakdown?.indices) return undefined;
    const projectedScores: Record<string, number> = {};
    for (const [dim, val] of Object.entries(breakdown.indices)) {
        if (typeof val === 'number' && Number.isFinite(val)) {
            projectedScores[dim] = val;
        }
    }
    return Object.keys(projectedScores).length > 0 ? projectedScores : undefined;
}

/**
 * Computes executive health indicators.
 */
function buildHealth(report: ScanReport, counts: AasCounts, options?: AasReportOptions): AasHealth {
    const override = options?.healthOverride;
    const score =
        override?.score !== undefined
            ? override.score
            : (report.qualityScore?.compositeScore ?? null);
    const grade = override?.grade ?? report.qualityScore?.grade ?? 'N/A';
    const cai =
        override?.cai !== undefined
            ? override.cai
            : (report.autonomy?.compositeAutonomyIndex ??
              report.qualityScore?.polyglotGeneralization?.index);
    const density =
        override?.density !== undefined
            ? override.density
            : report.qualityScore?.effectiveCodeDensity;
    const tensorSummary =
        override?.tensorSummary !== undefined
            ? override.tensorSummary
            : report.qualityScore?.densityTensorSummary;

    return {
        score:
            score !== null && Number.isFinite(score)
                ? Math.round(score * ROUND_SCALE_HUNDRED) / ROUND_SCALE_HUNDRED
                : null,
        grade,
        ...(cai !== undefined && Number.isFinite(cai)
            ? { cai: Math.round(cai * ROUND_SCALE_HUNDRED) / ROUND_SCALE_HUNDRED }
            : {}),
        ...(density !== undefined && Number.isFinite(density)
            ? { density: Math.round(density * ROUND_SCALE_HUNDRED) / ROUND_SCALE_HUNDRED }
            : {}),
        ...(tensorSummary ? { tensorSummary } : {}),
        counts,
    };
}

/**
 * Extracts deduction bottlenecks from dimensional breakdowns.
 */
function extractDeductionBottlenecks(
    deductions: Record<string, { entries: Array<{ rule?: string; points: number }> }>,
    limit: number,
): AasBottleneck[] {
    const lossMap = new Map<string, { dim: string; loss: number; count: number }>();
    for (const [dim, audit] of Object.entries(deductions)) {
        const entries = audit?.entries;
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
            const rule = entry.rule || 'unknown';
            const points = Number.isFinite(entry.points) ? entry.points : 0;
            const current = lossMap.get(rule);
            if (current) {
                current.loss += points;
                current.count += 1;
            } else {
                lossMap.set(rule, { dim, loss: points, count: 1 });
            }
        }
    }

    return Array.from(lossMap.entries())
        .map(([rule, data]) => ({
            rule,
            dim: data.dim,
            loss: Math.round(data.loss * ROUND_SCALE_HUNDRED) / ROUND_SCALE_HUNDRED,
            count: data.count,
        }))
        .sort((itemA, itemB) => itemB.loss - itemA.loss)
        .slice(0, limit);
}

/**
 * Fallback frequency bottlenecks based on detected issue volume.
 */
function extractFrequencyBottlenecks(issues: readonly Issue[], limit: number): AasBottleneck[] {
    const freqMap = new Map<string, number>();
    for (const issue of issues) {
        freqMap.set(issue.rule, (freqMap.get(issue.rule) ?? 0) + 1);
    }
    return Array.from(freqMap.entries())
        .map(([rule, count]) => ({ rule, loss: count, count }))
        .sort((itemA, itemB) => itemB.count - itemA.count)
        .slice(0, limit);
}

/**
 * Computes top quality bottlenecks ordered by point loss.
 */
function extractBottlenecks(
    report: ScanReport,
    limit: number = DEFAULT_BOTTLENECKS_LIMIT,
): AasBottleneck[] {
    const deductions = report.qualityScore?.deductionsByDimension;
    if (deductions && typeof deductions === 'object') {
        const extractedBottlenecks = extractDeductionBottlenecks(deductions, limit);
        if (extractedBottlenecks.length > 0) return extractedBottlenecks;
    }
    return extractFrequencyBottlenecks(report.issues, limit);
}

/**
 * Resolves concise semantic action verb from canonical rule identifier.
 */
function resolveActionFromRule(rule: string): string {
    if (rule.startsWith('NAM-')) return 'rename_identifier';
    if (rule.startsWith('CST-') || rule === 'hardcoded-string' || rule === 'magic-number') {
        return 'extract_constant';
    }
    if (rule.startsWith('BIG-') || rule === 'large-file') return 'split_file';
    if (rule.startsWith('CPX-') || rule === 'high-complexity') return 'decompose_complexity';
    if (rule.startsWith('SIM-')) return 'simplify_code';
    if (rule.startsWith('PRF-')) return 'optimize_performance';
    if (rule.startsWith('ARCH-')) return 'decouple_architecture';
    if (rule.startsWith('DEP-')) return 'resolve_dependency';
    if (rule.startsWith('SEC-')) return 'harden_security';
    if (rule.startsWith('HYG-')) return 'sanitize_hygiene';
    return 'refactor';
}

/**
 * Extracts concise, single-clause suggestion template (<= 80 chars) to prevent prose bloat.
 */
function cleanSuggestion(raw: string): string | undefined {
    if (!raw) return undefined;
    let trimmed = raw.trim();
    trimmed = trimmed.replace(/^(?:Please\s+|Consider\s+|It\s+is\s+recommended\s+to\s+)/i, '');
    if (trimmed.length <= MAX_SUGGESTION_CHARS) return trimmed;
    const match = trimmed.match(/^([^.!?\n]+[.!?]?)/);
    const firstClause = match
        ? match[1].trim()
        : trimmed.slice(0, ELLIPSIS_TRUNCATE_CHARS) + ELLIPSIS;
    return firstClause.length <= MAX_SUGGESTION_CHARS
        ? firstClause
        : firstClause.slice(0, ELLIPSIS_TRUNCATE_CHARS) + ELLIPSIS;
}

/**
 * Builds actionable remediation recipe from issue metadata.
 */
function buildFixRecipe(issue: Issue): AasFixRecipe | undefined {
    const act = issue.actionable;
    if (act?.action) {
        const conciseTemplate = act.templateSnippet
            ? cleanSuggestion(act.templateSnippet)
            : undefined;
        return {
            action: act.action,
            ...(act.patch ? { patch: act.patch } : {}),
            ...(conciseTemplate ? { template: conciseTemplate } : {}),
            ...(act.safeToAutomate !== undefined ? { safeToAutomate: act.safeToAutomate } : {}),
        };
    }
    if (issue.suggestion) {
        const concise = cleanSuggestion(issue.suggestion);
        return {
            action: resolveActionFromRule(issue.rule),
            ...(concise ? { template: concise } : {}),
        };
    }
    return undefined;
}

/**
 * Parameter object for single defect record construction.
 */
interface DefectRecordParams {
    readonly issue: Issue;
    readonly file: string;
    readonly layer: AgentTopologyLayer;
    readonly anchorCache: AnchorCache;
    readonly options: AasReportOptions;
    readonly defaultVerify: string;
}

/**
 * Converts single Issue into concise AasDefectRecord.
 */
function buildDefectRecord(params: DefectRecordParams): AasDefectRecord {
    const issue = params.issue;
    const startLine = issue.location?.start?.line ?? 1;
    const endLine = issue.location?.end?.line ?? startLine;
    const col = issue.location?.start?.column;
    const sev = mapSeverity(issue.severity);
    const rawMsg = trimMessage(issue.message);
    const msg =
        params.options.compressSentences !== false ? compressDiagnosticSentence(rawMsg) : rawMsg;

    const radius = params.options.contextRadius ?? DEFAULT_CONTEXT_RADIUS;
    const anchor =
        sev !== AAS_SEV_INFO
            ? params.anchorCache.getAnchor(params.file, startLine, endLine, radius)
            : undefined;

    const fix = buildFixRecipe(issue);
    const verifyCmd = generateVerificationDirective(
        issue,
        params.layer,
        params.options.baseDir || process.cwd(),
    ).command;

    const isNonDefaultVerify = Boolean(verifyCmd && verifyCmd !== params.defaultVerify);

    return {
        line: startLine,
        ...(col !== undefined && col > 1 ? { col } : {}),
        rule: issue.rule,
        sev,
        msg,
        ...(anchor ? { anchor } : {}),
        ...(fix ? { fix } : {}),
        ...(isNonDefaultVerify ? { verify: verifyCmd } : {}),
        ...(params.options.includeAnalyzer && issue.analyzer ? { analyzer: issue.analyzer } : {}),
        ...(issue.isNew ? { isNew: true } : {}),
    };
}

/**
 * Normalizes file path to relative POSIX format.
 */
function normalizeRelativePath(filePath: string, baseDir: string): string {
    let rel = filePath.replace(/\\/g, '/');
    if (baseDir && path.isAbsolute(rel)) {
        rel = path.relative(baseDir, rel).replace(/\\/g, '/');
    }
    return rel;
}

/**
 * Retrieves existing array from map or instantiates fresh array without loop allocation.
 */
function getOrCreateBucket<K, V>(map: Map<K, V[]>, key: K): V[] {
    const existing = map.get(key);
    if (existing) return existing;
    const fresh: V[] = [];
    map.set(key, fresh);
    return fresh;
}

/**
 * Partitions eligible findings into a map of repository-relative file paths.
 */
function collectFileIssues(
    issues: readonly Issue[],
    includeInfo: boolean,
    baseDir: string,
): Map<string, Issue[]> {
    const fileMap = new Map<string, Issue[]>();
    for (const issue of issues) {
        if (!includeInfo && issue.severity === 'info') continue;
        const normFile = normalizeRelativePath(issue.location?.file || 'unknown', baseDir);
        getOrCreateBucket(fileMap, normFile).push(issue);
    }
    return fileMap;
}

/**
 * Resolves the highest-priority architectural topology layer across all findings in a file.
 */
function resolvePrimaryLayer(issues: readonly Issue[], fPath: string): string {
    let bestLayer = 'L5_GOVERNANCE';
    let bestRank = UNRANKED_TOPOLOGY_WEIGHT;
    for (const issue of issues) {
        const layer = resolveTopologyLayer(issue.rule, fPath);
        const rank = TOPOLOGY_RANK[layer] ?? UNRANKED_TOPOLOGY_WEIGHT;
        if (rank < bestRank) {
            bestRank = rank;
            bestLayer = layer;
        }
    }
    return bestLayer;
}

/**
 * Maps each affected file to its primary architectural topology layer.
 */
function buildFileLayerMap(fileMap: Map<string, Issue[]>): Map<string, string> {
    const layerMap = new Map<string, string>();
    for (const [fPath, issues] of fileMap.entries()) {
        layerMap.set(fPath, resolvePrimaryLayer(issues, fPath));
    }
    return layerMap;
}

/**
 * Sorts files by topological priority (L1 -> L5), breaking ties alphabetically.
 */
function sortFilesByTopology(files: string[], fileLayerMap: Map<string, string>): string[] {
    return [...files].sort((fileA, fileB) => {
        const rankA = TOPOLOGY_RANK[fileLayerMap.get(fileA)!] ?? UNRANKED_TOPOLOGY_WEIGHT;
        const rankB = TOPOLOGY_RANK[fileLayerMap.get(fileB)!] ?? UNRANKED_TOPOLOGY_WEIGHT;
        if (rankA !== rankB) return rankA - rankB;
        return fileA.localeCompare(fileB);
    });
}

/**
 * Parameter object for batch file defect emission.
 */
interface EmitDefectsParams {
    readonly issues: readonly Issue[];
    readonly fPath: string;
    readonly layer: AgentTopologyLayer;
    readonly anchorCache: AnchorCache;
    readonly options: AasReportOptions;
    readonly defaultVerify: string;
    readonly maxPerFile: number;
    readonly remainingBudget: number;
}

/**
 * Emits defect records for a single file respecting per-file and total caps.
 */
function emitDefectsForFile(params: EmitDefectsParams): {
    emitted: AasDefectRecord[];
    omittedCount: number;
} {
    const emitted: AasDefectRecord[] = [];
    let omittedCount = 0;

    for (const issue of params.issues) {
        if (emitted.length >= params.maxPerFile || emitted.length >= params.remainingBudget) {
            omittedCount++;
            continue;
        }
        emitted.push(
            buildDefectRecord({
                issue,
                file: params.fPath,
                layer: params.layer,
                anchorCache: params.anchorCache,
                options: params.options,
                defaultVerify: params.defaultVerify,
            }),
        );
    }

    return { emitted, omittedCount };
}

/**
 * Resolves aggregate counts mirroring ScanSummary.
 */
function resolveCounts(report: ScanReport): AasCounts {
    const summary = report.summary;
    return {
        files: summary.filesScanned,
        total: summary.issuesTotal,
        errors: summary.bySeverity.error ?? 0,
        warns: summary.bySeverity.warning ?? 0,
        info: summary.bySeverity.info ?? 0,
        ...(summary.suppressedCount !== undefined ? { suppressed: summary.suppressedCount } : {}),
    };
}

/**
 * Creates static empty buckets for architectural layers.
 */
function initTopologyMap(): Record<string, string[]> {
    return {
        L1_CONTRACT: [],
        L2_INFRA: [],
        L3_CONFIG: [],
        L4_BUSINESS: [],
        L5_GOVERNANCE: [],
    };
}

/**
 * Context parameters for batch defect processing.
 */
interface DefectEmissionContext {
    readonly sortedFiles: readonly string[];
    readonly fileMap: ReadonlyMap<string, readonly Issue[]>;
    readonly fileLayerMap: ReadonlyMap<string, string>;
    readonly anchorCache: AnchorCache;
    readonly options: AasReportOptions;
    readonly defaultVerify: string;
    readonly maxFiles: number;
    readonly maxPerFile: number;
    readonly maxTotal: number;
}

/**
 * Emits defects for each file up to the allocated capacity.
 */
function processDefectFiles(
    ctx: DefectEmissionContext,
    topologyMap: Record<string, string[]>,
    resultFiles: Record<string, AasDefectRecord[]>,
): number {
    let filesCount = 0;
    let totalEmitted = 0;
    let truncatedCount = 0;

    for (const fPath of ctx.sortedFiles) {
        const issues = ctx.fileMap.get(fPath);
        if (!issues) {
            continue;
        }
        const layer = ctx.fileLayerMap.get(fPath) ?? 'L5_GOVERNANCE';
        if (filesCount >= ctx.maxFiles || totalEmitted >= ctx.maxTotal) {
            truncatedCount += issues.length;
            continue;
        }

        const remainingBudget = ctx.maxTotal - totalEmitted;
        const emissionResult = emitDefectsForFile({
            issues,
            fPath,
            layer: layer as AgentTopologyLayer,
            anchorCache: ctx.anchorCache,
            options: ctx.options,
            defaultVerify: ctx.defaultVerify,
            maxPerFile: ctx.maxPerFile,
            remainingBudget,
        });

        truncatedCount += emissionResult.omittedCount;
        totalEmitted += emissionResult.emitted.length;
        if (emissionResult.emitted.length > 0) {
            resultFiles[fPath] = emissionResult.emitted;
            filesCount++;
            const bucket = topologyMap[layer];
            if (bucket) {
                bucket.push(fPath);
            }
        }
    }
    return truncatedCount;
}

/**
 * Collects non-empty topology buckets.
 */
function filterActiveTopology(
    topologyMap: Record<string, string[]>,
): Partial<Record<string, readonly string[]>> {
    const active: Partial<Record<string, readonly string[]>> = {};
    for (const layer of TOPOLOGY_ORDER) {
        const bucket = topologyMap[layer];
        if (bucket && bucket.length > 0) {
            active[layer] = bucket;
        }
    }
    return active;
}

/**
 * Group issues per file and partition files by architectural topology layers.
 */
function groupDefects(
    report: ScanReport,
    anchorCache: AnchorCache,
    options: AasReportOptions,
    defaultVerify: string,
): {
    files: Record<string, readonly AasDefectRecord[]>;
    topology: Partial<Record<string, readonly string[]>>;
    truncatedCount: number;
} {
    const baseDir = options.baseDir || report.root || '';
    const fileMap = collectFileIssues(report.issues, options.includeInfo === true, baseDir);
    const fileLayerMap = buildFileLayerMap(fileMap);
    const sortedFiles = sortFilesByTopology(Array.from(fileMap.keys()), fileLayerMap);

    const topologyMap = initTopologyMap();
    const resultFiles: Record<string, AasDefectRecord[]> = {};

    const ctx: DefectEmissionContext = {
        sortedFiles,
        fileMap,
        fileLayerMap,
        anchorCache,
        options,
        defaultVerify,
        maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
        maxPerFile: options.maxDefectsPerFile ?? DEFAULT_MAX_DEFECTS_PER_FILE,
        maxTotal: options.maxTotalDefects ?? DEFAULT_MAX_TOTAL_DEFECTS,
    };

    const truncatedCount = processDefectFiles(ctx, topologyMap, resultFiles);
    const topology = filterActiveTopology(topologyMap);

    return { files: resultFiles, topology, truncatedCount };
}

/**
 * Projects a ScanReport into a token-frugal, Agent-Native AAS-v1 report.
 *
 * @param report - Complete scan report input.
 * @param options - Tunable emission options.
 * @returns Structured AgentAuditReport.
 */
export function buildAasReport(
    report: ScanReport,
    options: AasReportOptions = {},
): AgentAuditReport {
    const defaultVerify = options.defaultVerify ?? DEFAULT_VERIFY_COMMAND;
    const anchorCache = new AnchorCache(options.fileReader);
    const counts = resolveCounts(report);
    const verdict = resolveVerdict(counts);
    const health = buildHealth(report, counts, options);
    const dimensions = projectDimensions(report.qualityScore);
    const bottlenecks = extractBottlenecks(report);
    const { files, topology, truncatedCount } = groupDefects(
        report,
        anchorCache,
        options,
        defaultVerify,
    );

    return {
        schema: AAS_SCHEMA_ID,
        tool: report.tool,
        version: report.version,
        timestamp: report.generatedAt,
        root: report.root,
        verdict,
        health,
        defaultVerify,
        ...(dimensions ? { dimensions } : {}),
        bottlenecks,
        topology,
        files,
        ...(truncatedCount > 0 ? { truncated: truncatedCount } : {}),
        ...(report.summary.warnings && report.summary.warnings.length > 0
            ? { notes: report.summary.warnings }
            : {}),
    };
}

/**
 * Serializes an AAS-v1 report to JSON format.
 *
 * @param report - Complete scan report input.
 * @param options - Serialization and filtering options.
 * @returns JSON string of AgentAuditReport.
 */
export function toAasJson(
    report: ScanReport,
    options: AasReportOptions & { readonly pretty?: boolean } = {},
): string {
    const doc = buildAasReport(report, options);
    return JSON.stringify(doc, null, options.pretty === false ? 0 : 2);
}
