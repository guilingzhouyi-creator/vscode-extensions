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

import type { Issue, ScanReport, Severity } from '../types';
import { filterActiveTopologyBuckets, executeFileTopologyPipeline } from './agent-audit-pipeline';
import { type AgentTopologyLayer } from '../guidance/agentConstraintGenerator';
import {
    AAS_SCHEMA_ID,
    type AasCounts,
    type AasDefectRecord,
    type AasReportOptions,
    type AasUsability,
    type AasVerdict,
    type AgentAuditReport,
} from './aas-types';
import { compressDiagnosticSentence } from './aas-remediation';
import {
    extractBottlenecks,
    projectDimensionDetails,
    projectDimensions,
} from './aas-dimension-details';
import { buildHealth } from './aas-health-metrics';
import { AnchorCache, buildDefectRecord } from './aas-defect-records';

export * from './aas-types';
export { compressDiagnosticSentence };

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_DEFECTS_PER_FILE = 50;
const DEFAULT_MAX_TOTAL_DEFECTS = 500;
const DEFAULT_CONTEXT_RADIUS = 1;
const DEFAULT_VERIFY_COMMAND = 'npm test';

const SEVERITY_ERROR: Severity = 'error';

const VERDICT_BLOCK: AasVerdict = 'BLOCK';
const VERDICT_WARN: AasVerdict = 'WARN';
const VERDICT_PASS: AasVerdict = 'PASS';

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
 * Parameter object for batch file defect emission.
 */
interface EmitDefectsParams {
    readonly issues: readonly Issue[];
    readonly filePath: string;
    readonly layer: AgentTopologyLayer;
    readonly anchorCache: AnchorCache;
    readonly options: AasReportOptions;
    readonly defaultVerify: string;
    readonly maxPerFile: number;
    readonly remainingBudget: number;
    /** Rule-to-tier map from the arbitration pass, or undefined when it did not run. */
    readonly ruleTiers?: Readonly<Record<string, 'T1' | 'T2' | 'T3'>>;
}

const DEFAULT_RULE_FILE_CAP = 5;

function appendFoldedRuleLine(
    lastDefectByRule: Map<string, AasDefectRecord>,
    ruleId: string,
    lineNumber: number,
): void {
    const existingDefect = lastDefectByRule.get(ruleId);
    if (!existingDefect) return;
    const mutableDefect = existingDefect as { moreLines?: number[] };
    if (!mutableDefect.moreLines) {
        mutableDefect.moreLines = [lineNumber];
    } else if (!mutableDefect.moreLines.includes(lineNumber)) {
        mutableDefect.moreLines.push(lineNumber);
    }
}

function resolveEffectiveRuleTier(
    issue: Issue,
    ruleTiers: Readonly<Record<string, 'T1' | 'T2' | 'T3'>> | undefined,
): 'T1' | 'T2' | 'T3' | undefined {
    return issue.adjudicatedTier ?? (ruleTiers ? ruleTiers[issue.rule] : undefined);
}

function shouldFoldRepeatedRule(
    issue: Issue,
    confidenceTier: 'T1' | 'T2' | 'T3' | undefined,
    currentRuleCount: number,
    maxPerRule: number,
): boolean {
    return (
        issue.severity !== SEVERITY_ERROR &&
        confidenceTier !== 'T1' &&
        currentRuleCount >= maxPerRule
    );
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
    let previousCoveredFromLine = -1;
    let previousCoveredToLine = -1;
    const shouldDeduplicate = params.options.deduplicateAnchors !== false;
    const radius = params.options.contextRadius ?? DEFAULT_CONTEXT_RADIUS;
    const maxPerRule = params.options.maxPerRulePerFile ?? DEFAULT_RULE_FILE_CAP;
    const maxAllowed = Math.min(params.maxPerFile, params.remainingBudget);
    const ruleCountMap = new Map<string, number>();
    const lastDefectByRule = new Map<string, AasDefectRecord>();

    for (const issue of params.issues) {
        if (emitted.length >= maxAllowed) {
            omittedCount++;
            continue;
        }
        const startLine = issue.location?.start?.line ?? 1;
        const endLine = issue.location?.end?.line ?? startLine;
        const confidenceTier = resolveEffectiveRuleTier(issue, params.ruleTiers);
        const currentRuleCount = ruleCountMap.get(issue.rule) ?? 0;
        if (shouldFoldRepeatedRule(issue, confidenceTier, currentRuleCount, maxPerRule)) {
            appendFoldedRuleLine(lastDefectByRule, issue.rule, startLine);
            omittedCount++;
            continue;
        }

        const skipAnchor =
            shouldDeduplicate &&
            startLine >= previousCoveredFromLine &&
            endLine <= previousCoveredToLine;

        const defectRecord = buildDefectRecord({
            issue,
            file: params.filePath,
            layer: params.layer,
            anchorCache: params.anchorCache,
            options: params.options,
            defaultVerify: params.defaultVerify,
            skipAnchor,
            ...(confidenceTier ? { tier: confidenceTier } : {}),
        });

        if (defectRecord.anchor) {
            previousCoveredFromLine = Math.max(1, startLine - radius);
            previousCoveredToLine = endLine + radius;
        }
        emitted.push(defectRecord);
        ruleCountMap.set(issue.rule, currentRuleCount + 1);
        lastDefectByRule.set(issue.rule, defectRecord);
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
 * Projects the arbitration verdict into the usability block a consumer reads first.
 *
 * Returns undefined when the arbitration pass did not run, so the block's presence is itself the
 * signal that the numbers were adjudicated. Emitting zeroes instead would be indistinguishable
 * from "a scan that found nothing", which is the opposite meaning.
 *
 * @param report - Complete scan report.
 * @returns Usability counts, or undefined when no arbitration ran.
 */
function resolveUsability(report: ScanReport): AasUsability | undefined {
    const arbitration = report.summary.arbitration;
    if (!arbitration) return undefined;
    return {
        proven: arbitration.prescriptiveCount,
        patchable: arbitration.actionableCount,
        advisory: arbitration.advisoryCount,
        uncalibrated: arbitration.uncalibratedCount,
        needsHuman: arbitration.reviewQueueCount,
    };
}

/**
 * Context parameters for batch defect processing.
 */
interface DefectEmissionContext {
    readonly sortedFiles: readonly string[];
    readonly fileMap: ReadonlyMap<string, readonly Issue[]>;
    readonly fileLayerMap: ReadonlyMap<string, AgentTopologyLayer>;
    readonly anchorCache: AnchorCache;
    readonly options: AasReportOptions;
    readonly defaultVerify: string;
    readonly maxFiles: number;
    readonly maxPerFile: number;
    readonly maxTotal: number;
    /** Rule-to-tier map from the arbitration pass, or undefined when it did not run. */
    readonly ruleTiers?: Readonly<Record<string, 'T1' | 'T2' | 'T3'>>;
}

/**
 * Emits defects for each file up to the allocated capacity.
 */
function processDefectFiles(
    emissionContext: DefectEmissionContext,
    topologyMap: Record<AgentTopologyLayer, string[]>,
    resultFiles: Record<string, AasDefectRecord[]>,
): number {
    let filesCount = 0;
    let totalEmitted = 0;
    let truncatedCount = 0;

    for (const targetFilePath of emissionContext.sortedFiles) {
        const issues = emissionContext.fileMap.get(targetFilePath);
        if (!issues) {
            continue;
        }
        const layer = emissionContext.fileLayerMap.get(targetFilePath) ?? 'L5_GOVERNANCE';
        if (filesCount >= emissionContext.maxFiles || totalEmitted >= emissionContext.maxTotal) {
            truncatedCount += issues.length;
            continue;
        }

        const remainingBudget = emissionContext.maxTotal - totalEmitted;
        const emissionResult = emitDefectsForFile({
            issues,
            filePath: targetFilePath,
            layer,
            anchorCache: emissionContext.anchorCache,
            options: emissionContext.options,
            defaultVerify: emissionContext.defaultVerify,
            maxPerFile: emissionContext.maxPerFile,
            remainingBudget,
            ...(emissionContext.ruleTiers ? { ruleTiers: emissionContext.ruleTiers } : {}),
        });

        truncatedCount += emissionResult.omittedCount;
        totalEmitted += emissionResult.emitted.length;
        if (emissionResult.emitted.length > 0) {
            resultFiles[targetFilePath] = emissionResult.emitted;
            filesCount++;
            const bucket = topologyMap[layer];
            if (bucket) {
                bucket.push(targetFilePath);
            }
        }
    }
    return truncatedCount;
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
    const pipelineCtx = executeFileTopologyPipeline(
        report.issues,
        baseDir,
        options.includeInfo === true,
    );

    const resultFiles: Record<string, AasDefectRecord[]> = {};
    const ruleTiers = report.summary.arbitration?.ruleTiers;

    const emissionContext: DefectEmissionContext = {
        sortedFiles: pipelineCtx.sortedFiles,
        fileMap: pipelineCtx.fileMap,
        fileLayerMap: pipelineCtx.fileLayerMap,
        anchorCache,
        options,
        defaultVerify,
        maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
        maxPerFile: options.maxDefectsPerFile ?? DEFAULT_MAX_DEFECTS_PER_FILE,
        maxTotal: options.maxTotalDefects ?? DEFAULT_MAX_TOTAL_DEFECTS,
        ...(ruleTiers ? { ruleTiers } : {}),
    };

    const truncatedCount = processDefectFiles(
        emissionContext,
        pipelineCtx.topologyBuckets,
        resultFiles,
    );
    const topology = filterActiveTopologyBuckets(pipelineCtx.topologyBuckets);

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
    try {
        const counts = resolveCounts(report);
        const verdict = resolveVerdict(counts);
        const health = buildHealth(report, counts, options);
        const usability = resolveUsability(report);
        const dimensions = projectDimensions(report, options.healthOverride?.dimensions);
        const dimensionDetails = projectDimensionDetails(report.qualityScore, options);
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
            ...(usability ? { usability } : {}),
            defaultVerify,
            ...(dimensions ? { dimensions } : {}),
            ...(dimensionDetails ? { dimensionDetails } : {}),
            bottlenecks,
            topology,
            files,
            ...(truncatedCount > 0 ? { truncated: truncatedCount } : {}),
            ...(report.summary.warnings && report.summary.warnings.length > 0
                ? { notes: report.summary.warnings }
                : {}),
        };
    } finally {
        anchorCache.dispose();
    }
}

/**
 * Serializes an AAS-v1 report to JSON format.
 *
 * Emits compact JSON by default: the payload is written for agents and CI parsers, where
 * indentation is pure overhead (measured at +49.6% bytes on a 500-defect report). Human-readable
 * output is opt-in through `pretty: true` so the frugal path stays the default rather than the
 * exception.
 *
 * @param report - Complete scan report input.
 * @param options - Serialization and filtering options; `pretty` enables two-space indentation.
 * @returns JSON string of AgentAuditReport.
 */
export function toAasJson(
    report: ScanReport,
    options: AasReportOptions & { readonly pretty?: boolean } = {},
): string {
    const auditDocument = buildAasReport(report, options);
    return JSON.stringify(auditDocument, null, options.pretty === true ? 2 : 0);
}
