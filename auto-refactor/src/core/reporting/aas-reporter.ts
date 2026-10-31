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
import type {
    QualityDimension,
    QualityScoreBreakdown,
    QualityScoreRationale,
} from '../scoring/scoringTypes';
import { ALL_QUALITY_DIMENSIONS, DEFAULT_QUALITY_WEIGHTS } from '../scoring/scoringTypes';
import {
    filterActiveTopologyBuckets,
    executeFileTopologyPipeline,
} from './agent-audit-pipeline';
import {
    formatAnchorSlice,
    generateVerificationDirective,
    type AgentTopologyLayer,
} from '../guidance/agentConstraintGenerator';
import {
    AAS_SCHEMA_ID,
    type AasBottleneck,
    type AasCounts,
    type AasDefectRecord,
    type AasDimensionDetail,
    type AasFixRecipe,
    type AasHealth,
    type AasQuantMetrics,
    type AasReportOptions,
    type AasSeverity,
    type AasUsability,
    type AasVerdict,
    type AgentAuditReport,
} from './aas-types';
import { resolveQualityGrade } from '../scoring/scorer-formulas';
import { buildFixRecipe } from './aas-remediation';
import { sharedMemoryGovernor, CacheEvictionTier } from '../memory/memory-governor';

export * from './aas-types';

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_DEFECTS_PER_FILE = 50;
const DEFAULT_MAX_TOTAL_DEFECTS = 500;
const DEFAULT_CONTEXT_RADIUS = 1;
const DEFAULT_MAX_MESSAGE_CHARS = 160;
const DEFAULT_BOTTLENECKS_LIMIT = 8;
const DEFAULT_TOP_BOTTLENECKS_LIMIT = 3;
const DEFAULT_VERIFY_COMMAND = 'npm test';
const ELLIPSIS = '…';

const ROUND_SCALE_HUNDRED = 100;
const ROUND_SCALE_THOUSAND = 1000;
const MAX_HEALTH_SCORE = 100;
const HEALTHY_SCORE_THRESHOLD = 90;
const WARNING_SCORE_THRESHOLD = 75;
const MAX_SUGGESTION_CHARS = 80;
const ELLIPSIS_TRUNCATE_CHARS = 77;

const SEVERITY_ERROR: Severity = 'error';
const SEVERITY_WARNING: Severity = 'warning';

const AAS_SEV_BLOCK: AasSeverity = 'BLOCK';
const AAS_SEV_WARN: AasSeverity = 'WARN';
const AAS_SEV_INFO: AasSeverity = 'INFO';

const VERDICT_BLOCK: AasVerdict = 'BLOCK';
const VERDICT_WARN: AasVerdict = 'WARN';
const VERDICT_PASS: AasVerdict = 'PASS';

/**
 * Maps static analysis severity onto Agent triage severity.
 *
 * @param rawSeverity - Finding severity.
 * @returns Mapped AAS severity.
 */
function mapSeverity(rawSeverity?: string): AasSeverity {
    if (rawSeverity === SEVERITY_ERROR) return AAS_SEV_BLOCK;
    return rawSeverity === SEVERITY_WARNING ? AAS_SEV_WARN : AAS_SEV_INFO;
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
    const cleanedText = (text || '').replace(/\s+/g, ' ').trim();
    return cleanedText.length <= maxChars ? cleanedText : cleanedText.slice(0, Math.max(1, maxChars - 1)) + ELLIPSIS;
}

/**
 * Compresses diagnostic narrative into high-information-density token sentence.
 *
 * Implements the Five-Principle Compression Protocol (see
 * token-frugal-sentence-and-diagnostic-spec.md).
 *
 * @param rawText - Raw narrative diagnostic string.
 * @returns Concise token-dense diagnostic sentence.
 */
export function compressDiagnosticSentence(rawText: string): string {
    if (!rawText) return '';
    let messageText = rawText.replace(/\s+/g, ' ').trim();

    messageText = messageText.replace(
        /Identifier\s+('?[a-zA-Z0-9_$-]+'?)\s+contains\s+unapproved\s+truncated\s+abbreviation\s+('?[a-zA-Z0-9_$-]+'?)\.?/i,
        'identifier $1 unapproved abbr $2',
    );
    messageText = messageText.replace(
        /Identifier\s+('?[a-zA-Z0-9_$-]+'?)\s+is\s+vague\s+and\s+uninformative;\s*lacks\s+domain\s+context\.?/i,
        'identifier $1 lacks domain context',
    );
    messageText = messageText.replace(
        /(?:Function\s+or\s+method\s+name|Local\s+variable\s+name|Variable\s+name)\s+('?[a-zA-Z0-9_$-]+'?)\s+is\s+too\s+short\s*\(([^)]+)\)[^.]*\.?/i,
        'symbol $1 too short ($2)',
    );
    messageText = messageText.replace(
        /(?:Function\s+or\s+method\s+name|Variable\s+name)\s+('?[a-zA-Z0-9_$-]+'?)\s+is\s+excessively\s+long\s*\(([^)]+)\)[^.]*\.?/i,
        'symbol $1 too long ($2)',
    );
    messageText = messageText.replace(
        /Cognitive\s+complexity\s*\((\d+)\)\s*exceeds\s*threshold\s*\((\d+)\)\s*in\s*(?:function|method)?\s*('?[a-zA-Z0-9_$-]+'?)/i,
        'CC $1 > $2 in $3',
    );
    messageText = messageText.replace(/Effective\s+code\s+volume\s+budget\s+exceeded\.?/i, 'ELOC budget exceeded');
    messageText = messageText.replace(/Physical\s+line\s+count\s+ceiling\s+exceeded\.?/i, 'LOC ceiling exceeded');
    messageText = messageText.replace(/Dynamic\s+dilution\s+envelope\s+exceeded\.?/i, 'dilution envelope exceeded');
    messageText = messageText.replace(
        /Effective\s+logic\s+density\s+below\s+floor\s+threshold\.?/i,
        'token density below floor',
    );
    messageText = messageText.replace(
        /(?:Function|Method)\s+has\s+(\d+)\s+positional\s+parameters?\s+exceeding\s+threshold\s+of\s+(\d+)\.?/i,
        'params $1 > $2',
    );
    messageText = messageText.replace(
        /Synchronous\s+('?[a-zA-Z0-9_$.-]+'?)\s+blocks\s+event\s+loop\.?/i,
        'sync $1 blocks event loop',
    );
    messageText = messageText.replace(
        /Sync\s+I\/O\s+in\s+async\s+(?:method|function)\.?/i,
        'sync IO in async fn',
    );
    messageText = messageText.replace(
        /Zero\s+transient\s+heap\s+allocation\s+(?:in\s+hot\s+loop\s+bodies\s+)?violated\.?/i,
        'loop transient heap allocation',
    );
    messageText = messageText.replace(
        /Control\s+flow\s+nesting\s+depth\s*\((\d+)\)\s*exceeds\s*(?:limit|threshold)\s*(?:\((\d+)\)|\s*(\d+))\.?/i,
        'nesting depth $1 > $2$3',
    );
    messageText = messageText.replace(
        /Procedure\s+line\s+count\s*\((\d+)\)\s*exceeds\s*(?:single-responsibility\s+)?limit\s*(?:\((\d+)\)|\s*(\d+))\.?/i,
        'procedure lines $1 > $2$3',
    );
    messageText = messageText.replace(
        /Magic\s+number\s+(\d+)\s+detected(?:[^.]*)?\.?/i,
        'magic number $1',
    );
    messageText = messageText.replace(
        /Literal\s+string\s+("?[^"]+"?|'?[^']+'?)\s+should\s+be\s+constant\.?/i,
        'literal string $1 not constant',
    );
    messageText = messageText.replace(
        /(?:Facade\s+method\s+merely\s+delegates\s+to\s+[^.]*|Single-target\s+pass-through\s+trampoline\s+detected)\.?/i,
        'trampoline pass-through',
    );

    messageText = messageText.replace(/^(?:Notice|Warning|Error|Violation|Failed):\s*/i, '');
    return messageText.trim().replace(/\.$/, '');
}

/**
 * In-memory anchor extractor avoiding direct synchronous filesystem operations.
 */
class AnchorCache {
    private readonly cache = new Map<string, string | null>();
    private readonly customReader?: (relPath: string) => string | undefined;
    private readonly unregister?: () => void;

    constructor(customReader?: (relPath: string) => string | undefined) {
        this.customReader = customReader;
        this.unregister = sharedMemoryGovernor.register({
            name: 'aas-reporter:anchor-cache',
            tier: CacheEvictionTier.Ephemeral,
            clear: () => this.clear(),
            getSize: () => this.cache.size,
        });
    }

    public clear(): void {
        this.cache.clear();
    }

    public dispose(): void {
        this.clear();
        this.unregister?.();
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
            const rawContent = this.customReader(file);
            content = rawContent !== undefined ? rawContent : null;
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
    for (const [dimensionName, scoreValue] of Object.entries(breakdown.indices)) {
        if (typeof scoreValue === 'number' && Number.isFinite(scoreValue)) {
            projectedScores[dimensionName] = scoreValue;
        }
    }
    return Object.keys(projectedScores).length > 0 ? projectedScores : undefined;
}

/**
 * Appends a rule loss occurrence to a dimension's loss map without in-loop allocation.
 */
function recordRuleLoss(lossMap: Map<string, { loss: number; count: number }>, rule: string, delta: number): void {
    const currentLoss = lossMap.get(rule);
    if (currentLoss) {
        currentLoss.loss += Math.abs(delta);
        currentLoss.count += 1;
    } else {
        lossMap.set(rule, { loss: Math.abs(delta), count: 1 });
    }
}

/**
 * Resolves or creates a dimension's loss map outside lexical loop.
 */
function getOrCreateLossMap(
    dimensionRationales: Map<string, Map<string, { loss: number; count: number }>>,
    dimension: string,
): Map<string, { loss: number; count: number }> {
    let lossMap = dimensionRationales.get(dimension);
    if (!lossMap) {
        lossMap = new Map();
        dimensionRationales.set(dimension, lossMap);
    }
    return lossMap;
}

/**
 * Collects rule loss statistics grouped by dimension key.
 */
function collectDimensionRuleLosses(rationales?: QualityScoreRationale[]): Map<string, Map<string, { loss: number; count: number }>> {
    const dimensionRationales = new Map<string, Map<string, { loss: number; count: number }>>();
    if (!rationales || rationales.length === 0) return dimensionRationales;

    ALL_QUALITY_DIMENSIONS.forEach((dimension) => {
        dimensionRationales.set(dimension, new Map());
    });

    for (const rationale of rationales) {
        const lossMap = getOrCreateLossMap(dimensionRationales, rationale.dimension);
        recordRuleLoss(lossMap, rationale.rule || 'unknown', rationale.delta);
    }
    return dimensionRationales;
}

/**
 * Derives top bottlenecks from a dimension's rule loss map.
 */
function extractTopBottlenecks(lossMap?: Map<string, { loss: number; count: number }>): {
    totalLoss?: number;
    topBottlenecks?: Array<{ rule: string; loss: number; count: number }>;
} {
    if (!lossMap || lossMap.size === 0) return {};
    const sorted = Array.from(lossMap.entries())
        .map(([rule, stat]) => ({ rule, loss: stat.loss, count: stat.count }))
        .sort((itemA, itemB) => itemB.loss - itemA.loss);
    const totalLoss = sorted.reduce((sum, item) => sum + item.loss, 0);
    return {
        ...(totalLoss > 0 ? { totalLoss } : {}),
        topBottlenecks: sorted.slice(0, DEFAULT_TOP_BOTTLENECKS_LIMIT),
    };
}

/**
 * Projects detailed ten-dimensional metrics with weights and bottlenecks (AAS v1.1).
 */
function projectDimensionDetails(
    breakdown?: QualityScoreBreakdown,
    options?: AasReportOptions,
): Partial<Record<string, AasDimensionDetail>> | undefined {
    if (!breakdown?.indices || !options?.includeDimensionDetails) return undefined;

    const notEvaluatedSet = new Set(breakdown.notEvaluated ?? []);
    const details: Record<string, AasDimensionDetail> = {};
    const dimensionRationales = collectDimensionRuleLosses(breakdown.rationales);

    Object.entries(breakdown.indices).forEach(([dimension, scoreValue]) => {
        if (typeof scoreValue !== 'number' || !Number.isFinite(scoreValue)) return;
        const evaluated = !notEvaluatedSet.has(dimension as QualityDimension);
        const fallbackWeight = (DEFAULT_QUALITY_WEIGHTS as Record<string, number>)[dimension];
        const weightVal = breakdown.weights && typeof (breakdown.weights as Record<string, number>)[dimension] === 'number'
            ? (breakdown.weights as Record<string, number>)[dimension]
            : fallbackWeight;
        const bottlenecks = extractTopBottlenecks(dimensionRationales.get(dimension));

        details[dimension] = {
            score: Math.round(scoreValue * ROUND_SCALE_HUNDRED) / ROUND_SCALE_HUNDRED,
            grade: resolveQualityGrade(scoreValue),
            evaluated,
            ...(weightVal !== undefined ? { weight: Math.round(weightVal * ROUND_SCALE_THOUSAND) / ROUND_SCALE_THOUSAND } : {}),
            ...(breakdown.confidence !== undefined
                ? { confidence: Math.round(breakdown.confidence * ROUND_SCALE_HUNDRED) / ROUND_SCALE_HUNDRED }
                : {}),
            ...bottlenecks,
        };
    });
    return Object.keys(details).length > 0 ? details : undefined;
}

/**
 * Rounds numeric metric to 2 decimal places.
 */
function roundMetric(metricValue: number | undefined | null): number | undefined {
    if (typeof metricValue === 'number' && Number.isFinite(metricValue)) {
        return Math.round(metricValue * ROUND_SCALE_HUNDRED) / ROUND_SCALE_HUNDRED;
    }
    return undefined;
}

/**
 * Resolves composite health score with optional override.
 */
function resolveHealthScore(overrideScore?: number | null, rawScore?: number | null): number | null {
    const candidateScore = overrideScore !== undefined ? overrideScore : (rawScore ?? null);
    const roundedScore = roundMetric(candidateScore);
    return roundedScore !== undefined ? roundedScore : null;
}

/**
 * Resolves CAI metric truthfully without falling back to polyglot generalization.
 */
function resolveHealthCai(report: ScanReport, overrideCai?: number): number | undefined {
    const autonomyIndex = overrideCai ?? report.autonomy?.compositeAutonomyIndex;
    return roundMetric(autonomyIndex);
}

/**
 * Resolves SQALE technical debt assessment.
 */
function resolveHealthSqale(
    report: ScanReport,
    override?: AasHealth['sqale'],
): AasHealth['sqale'] | undefined {
    if (override) return override;
    const technicalDebt = report.qualityScore?.technicalDebt;
    if (!technicalDebt) return undefined;
    return {
        tdr: roundMetric(technicalDebt.technicalDebtRatio) ?? 0,
        remediationMinutes: Math.round(technicalDebt.totalRemediationMinutes),
        grade: technicalDebt.sqaleGrade,
    };
}

/**
 * Resolves polyglot modernization and balance metrics.
 */
function resolveHealthPolyglot(
    report: ScanReport,
    override?: AasHealth['polyglot'],
): AasHealth['polyglot'] | undefined {
    if (override) return override;
    const polyglotMetrics = report.qualityScore?.polyglotGeneralization;
    if (!polyglotMetrics) return undefined;
    return {
        index: roundMetric(polyglotMetrics.index) ?? 0,
        meanScore: roundMetric(polyglotMetrics.meanScore) ?? 0,
        dispersionPenalty: roundMetric(polyglotMetrics.dispersionPenalty) ?? 0,
        standardDeviation: roundMetric(polyglotMetrics.standardDeviation) ?? 0,
        languageCount: polyglotMetrics.languageCount ?? 0,
    };
}

/**
 * Resolves anti-gaming defense circuit status.
 */
function resolveHealthGamingDefense(
    report: ScanReport,
    override?: AasHealth['gamingDefense'],
): AasHealth['gamingDefense'] | undefined {
    if (override) return override;
    const arbitration = report.summary.arbitration;
    if (arbitration && arbitration.isGamingBlocked !== undefined) {
        return {
            isBlocked: arbitration.isGamingBlocked,
            ...(arbitration.semanticChangeRatio !== undefined
                ? { semanticRatio: roundMetric(arbitration.semanticChangeRatio) }
                : {}),
            ...(arbitration.netDebtDelta !== undefined ? { netDebtDelta: arbitration.netDebtDelta } : {}),
            ...(arbitration.gamingReason ? { reason: arbitration.gamingReason } : {}),
        };
    }
    return undefined;
}

/**
 * Resolves quantitative architecture dynamics and resilience indicators (ADR-Q).
 */
function resolveHealthQuant(
    report: ScanReport,
    override?: AasHealth['quant'],
): AasHealth['quant'] | undefined {
    if (override) return override;
    const quantMetrics = report.qualityScore?.quant;
    if (!quantMetrics) return undefined;
    const fin = quantMetrics.financial;
    const risk = quantMetrics.riskRatios;
    const ineq = quantMetrics.inequality;
    const stoch = quantMetrics.stochastic;

    const rcr = roundMetric(fin?.rcr ?? fin?.interestCoverageRatio);
    const erq = roundMetric(risk?.erq ?? risk?.qsr);
    const ddr = roundMetric(risk?.ddr ?? risk?.sortino);
    const dsi = roundMetric(ineq?.dsi ?? ineq?.debtGini);
    const rcd = roundMetric(ineq?.rcd ?? ineq?.defectEntropy);
    const edb95 = roundMetric(risk?.edb95 ?? risk?.var95);
    const ptd = roundMetric(risk?.ptd ?? risk?.mdd);
    const ehl = roundMetric(stoch?.ehl ?? stoch?.halfLifeCommits);

    const quant: AasQuantMetrics = {
        ...(rcr !== undefined ? { rcr, icr: rcr } : {}),
        ...(erq !== undefined ? { erq, qsr: erq } : {}),
        ...(ddr !== undefined ? { ddr, sortino: ddr } : {}),
        ...(edb95 !== undefined ? { edb95, var95: edb95 } : {}),
        ...(ptd !== undefined ? { ptd, mdd: ptd } : {}),
        ...(dsi !== undefined ? { dsi, debtGini: dsi } : {}),
        ...(rcd !== undefined ? { rcd, defectEntropy: rcd } : {}),
        ...(ehl !== undefined ? { ehl, halfLifeCommits: ehl } : {}),
        ...(fin?.status ? { status: fin.status } : {}),
    };

    return Object.keys(quant).length > 0 ? quant : undefined;
}

/**
 * Summarizes dimensional health status distribution.
 */
function computeDimensionSummary(indices?: Record<string, number>): AasHealth['dimensionSummary'] | undefined {
    if (!indices) return undefined;
    let healthyCount = 0;
    let warningCount = 0;
    let failingCount = 0;
    let lowestDimension: string | undefined;
    let lowestScore = MAX_HEALTH_SCORE;

    Object.entries(indices).forEach(([dimension, scoreValue]) => {
        if (typeof scoreValue !== 'number' || !Number.isFinite(scoreValue)) return;
        if (scoreValue >= HEALTHY_SCORE_THRESHOLD) healthyCount++;
        else if (scoreValue >= WARNING_SCORE_THRESHOLD) warningCount++;
        else failingCount++;

        if (scoreValue < lowestScore) {
            lowestScore = scoreValue;
            lowestDimension = dimension;
        }
    });

    return {
        healthyCount,
        warningCount,
        failingCount,
        ...(lowestDimension ? { lowestDimension, lowestScore: Math.round(lowestScore * ROUND_SCALE_HUNDRED) / ROUND_SCALE_HUNDRED } : {}),
    };
}

/**
 * Computes executive health indicators.
 */
function buildHealth(report: ScanReport, counts: AasCounts, options?: AasReportOptions): AasHealth {
    const override = options?.healthOverride;
    const score = resolveHealthScore(override?.score, report.qualityScore?.compositeScore);
    const grade = override?.grade ?? report.qualityScore?.grade ?? 'N/A';
    const computedCai = resolveHealthCai(report, override?.cai);
    const density = roundMetric(override?.density ?? report.qualityScore?.effectiveCodeDensity);
    const tensorSummary = override?.tensorSummary ?? report.qualityScore?.densityTensorSummary;
    const sqale = resolveHealthSqale(report, override?.sqale);
    const polyglot = resolveHealthPolyglot(report, override?.polyglot);
    const gamingDefense = resolveHealthGamingDefense(report, override?.gamingDefense);
    const quant = resolveHealthQuant(report, override?.quant);
    const vrf = override?.vrf;
    const dimensionSummary = options?.includeDimensionDetails
        ? computeDimensionSummary(report.qualityScore?.indices)
        : undefined;

    return {
        score,
        grade,
        ...(computedCai !== undefined ? { cai: computedCai } : {}),
        ...(density !== undefined ? { density } : {}),
        ...(tensorSummary ? { tensorSummary } : {}),
        ...(sqale ? { sqale } : {}),
        ...(polyglot ? { polyglot } : {}),
        ...(gamingDefense ? { gamingDefense } : {}),
        ...(quant ? { quant } : {}),
        ...(dimensionSummary ? { dimensionSummary } : {}),
        ...(vrf ? { vrf } : {}),
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
    const lossMap = new Map<string, { dimension: string; loss: number; count: number }>();
    for (const [dimension, audit] of Object.entries(deductions)) {
        const entries = audit?.entries;
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
            const ruleId = entry.rule || 'unknown';
            const points = Number.isFinite(entry.points) ? entry.points : 0;
            const current = lossMap.get(ruleId);
            if (current) {
                current.loss += points;
                current.count += 1;
            } else {
                lossMap.set(ruleId, { dimension, loss: points, count: 1 });
            }
        }
    }

    return Array.from(lossMap.entries())
        .map(([ruleId, bottleneckData]) => ({
            rule: ruleId,
            dim: bottleneckData.dimension,
            loss: Math.round(bottleneckData.loss * ROUND_SCALE_HUNDRED) / ROUND_SCALE_HUNDRED,
            count: bottleneckData.count,
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
 * Parameter object for single defect record construction.
 */
interface DefectRecordParams {
    readonly issue: Issue;
    readonly file: string;
    readonly layer: AgentTopologyLayer;
    readonly anchorCache: AnchorCache;
    readonly options: AasReportOptions;
    readonly defaultVerify: string;
    readonly skipAnchor?: boolean;
    /**
     * Tier the arbitration pass assigned this issue's rule, or undefined when the pass did not
     * run. Passed in rather than derived here: the arbiter owns tiering, and a reporter that
     * re-derived it would be a second source of truth for the same judgement.
     */
    readonly tier?: 'T1' | 'T2' | 'T3';
}

/**
 * Projects the optional adjudication fields onto a defect record.
 *
 * Split out of `buildDefectRecord` so the record assembly stays a flat list of field decisions
 * rather than accumulating one branch per optional field. Both fields are omitted — never
 * defaulted — when unavailable: a consumer must be able to tell "not adjudicated" from
 * "adjudicated as certain", and only absence carries that meaning.
 *
 * @param issue - Source finding.
 * @param tier - Tier the arbitration pass assigned the finding's rule, when it ran.
 * @returns Tier and confidence fields, possibly empty.
 */
function projectAdjudicationFields(
    issue: Issue,
    tier: 'T1' | 'T2' | 'T3' | undefined,
): { tier?: 'T1' | 'T2' | 'T3'; conf?: number } {
    const fields: { tier?: 'T1' | 'T2' | 'T3'; conf?: number } = {};
    if (tier) fields.tier = tier;
    const confidence = issue.evidence?.confidence;
    if (typeof confidence === 'number') fields.conf = Number(confidence.toFixed(2));
    return fields;
}

/**
 * Converts single Issue into concise AasDefectRecord.
 */
function buildDefectRecord(params: DefectRecordParams): AasDefectRecord {
    const issue = params.issue;
    const startLine = issue.location?.start?.line ?? 1;
    const endLine = issue.location?.end?.line ?? startLine;
    const startColumn = issue.location?.start?.column;
    const severityTier = mapSeverity(issue.severity);
    const rawMessage = trimMessage(issue.message);
    const compressedMessage =
        params.options.compressSentences !== false ? compressDiagnosticSentence(rawMessage) : rawMessage;

    const shouldSkipAnchor = params.skipAnchor === true;
    const radius = params.options.contextRadius ?? DEFAULT_CONTEXT_RADIUS;
    const anchor =
        !shouldSkipAnchor && severityTier !== AAS_SEV_INFO
            ? params.anchorCache.getAnchor(params.file, startLine, endLine, radius)
            : undefined;

    const fixRecipe = buildFixRecipe(issue);
    const verifyCmd = generateVerificationDirective(
        issue,
        params.layer,
        params.options.baseDir || process.cwd(),
    ).command;

    const isNonDefaultVerify = Boolean(verifyCmd && verifyCmd !== params.defaultVerify);

    return {
        line: startLine,
        ...(startColumn !== undefined && startColumn > 1 ? { col: startColumn } : {}),
        rule: issue.rule,
        sev: severityTier,
        msg: compressedMessage,
        ...(anchor ? { anchor } : {}),
        ...(fixRecipe ? { fix: fixRecipe } : {}),
        ...(isNonDefaultVerify ? { verify: verifyCmd } : {}),
        ...(params.options.includeAnalyzer && issue.analyzer ? { analyzer: issue.analyzer } : {}),
        ...(issue.isNew ? { isNew: true } : {}),
        ...projectAdjudicationFields(issue, params.tier),
    };
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

    for (const issue of params.issues) {
        if (emitted.length >= params.maxPerFile || emitted.length >= params.remainingBudget) {
            omittedCount++;
            continue;
        }
        const startLine = issue.location?.start?.line ?? 1;
        const endLine = issue.location?.end?.line ?? startLine;
        const isCoveredByPreviousAnchor =
            shouldDeduplicate &&
            startLine >= previousCoveredFromLine &&
            endLine <= previousCoveredToLine;
        const skipAnchor = isCoveredByPreviousAnchor;

        const confidenceTier = params.ruleTiers ? params.ruleTiers[issue.rule] : undefined;
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

    const truncatedCount = processDefectFiles(emissionContext, pipelineCtx.topologyBuckets, resultFiles);
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
        const dimensions = projectDimensions(report.qualityScore);
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
 * @param report - Complete scan report input.
 * @param options - Serialization and filtering options.
 * @returns JSON string of AgentAuditReport.
 */
export function toAasJson(
    report: ScanReport,
    options: AasReportOptions & { readonly pretty?: boolean } = {},
): string {
    const auditDocument = buildAasReport(report, options);
    return JSON.stringify(auditDocument, null, options.pretty === false ? 0 : 2);
}
