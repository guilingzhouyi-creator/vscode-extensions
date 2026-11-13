/**
 * Module: Core Reporting — AAS Dimensional Breakdown & Bottleneck Projection
 * File Path: src/core/reporting/aas-dimension-details.ts
 * Architecture Role: Projects ten-dimensional quality vectors, per-dimension bottleneck
 *   attribution, and point-loss/frequency bottlenecks for Agent Audit Schema v1.0/v1.1 reports.
 * Dependencies & Triggers: scoringTypes, scorer-formulas, aas-types; invoked by aas-reporter.
 * Responsibilities:
 *   1. Project finite numeric ten-dimension scores with override precedence.
 *   2. Aggregate rule loss deltas per dimension and surface top bottlenecks.
 *   3. Extract deduction-ranked or issue-frequency fallback bottlenecks.
 * Exit Semantics & Design Rationale: Pure transformation with zero filesystem access or loop
 *   closures allocating redundant objects.
 */

import type { Issue, ScanReport } from '../types';
import type {
    QualityDimension,
    QualityScoreBreakdown,
    QualityScoreRationale,
} from '../scoring/scoringTypes';
import { ALL_QUALITY_DIMENSIONS, DEFAULT_QUALITY_WEIGHTS } from '../scoring/scoringTypes';
import { resolveQualityGrade } from '../scoring/scorer-formulas';
import type { AasBottleneck, AasDimensionDetail, AasReportOptions } from './aas-types';

const DEFAULT_BOTTLENECKS_LIMIT = 8;
const DEFAULT_TOP_BOTTLENECKS_LIMIT = 3;
const ROUND_SCALE_HUNDRED = 100;
const ROUND_SCALE_THOUSAND = 1000;

/**
 * Projects ten-dimensional quality vector scores if present.
 *
 * @param report - Scan report carrying governance or quality score indices.
 * @param overrideDimensions - Optional dimension score overrides.
 * @returns Filtered map of finite dimension scores, or undefined when empty.
 */
export function projectDimensions(
    report: ScanReport,
    overrideDimensions?: Partial<Record<string, number>>,
): Partial<Record<string, number>> | undefined {
    const sourceIndices =
        overrideDimensions ?? report.governance?.tenDimensions ?? report.qualityScore?.indices;
    if (!sourceIndices) return undefined;
    const projectedScores: Record<string, number> = {};
    for (const [dimensionName, scoreValue] of Object.entries(sourceIndices)) {
        if (typeof scoreValue === 'number' && Number.isFinite(scoreValue)) {
            projectedScores[dimensionName] = scoreValue;
        }
    }
    return Object.keys(projectedScores).length > 0 ? projectedScores : undefined;
}

function recordRuleLoss(
    lossMap: Map<string, { loss: number; count: number }>,
    rule: string,
    delta: number,
): void {
    const currentLoss = lossMap.get(rule);
    if (currentLoss) {
        currentLoss.loss += Math.abs(delta);
        currentLoss.count += 1;
    } else {
        lossMap.set(rule, { loss: Math.abs(delta), count: 1 });
    }
}

function getOrCreateLossMap(
    dimensionToLossesMap: Map<string, Map<string, { loss: number; count: number }>>,
    dimension: string,
): Map<string, { loss: number; count: number }> {
    let lossMap = dimensionToLossesMap.get(dimension);
    if (!lossMap) {
        lossMap = new Map();
        dimensionToLossesMap.set(dimension, lossMap);
    }
    return lossMap;
}

function collectDimensionRuleLosses(
    rationales?: QualityScoreRationale[],
): Map<string, Map<string, { loss: number; count: number }>> {
    const dimensionToLossesMap = new Map<string, Map<string, { loss: number; count: number }>>();
    if (!rationales || rationales.length === 0) return dimensionToLossesMap;

    ALL_QUALITY_DIMENSIONS.forEach((dimension) => {
        dimensionToLossesMap.set(dimension, new Map());
    });

    for (const rationale of rationales) {
        const lossMap = getOrCreateLossMap(dimensionToLossesMap, rationale.dimension);
        recordRuleLoss(lossMap, rationale.rule || 'unknown', rationale.delta);
    }
    return dimensionToLossesMap;
}

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
 *
 * @param breakdown - Project quality score breakdown with indices and rationales.
 * @param options - AAS report options gating `includeDimensionDetails`.
 * @returns Per-dimension detail record map, or undefined when disabled or absent.
 */
export function projectDimensionDetails(
    breakdown?: QualityScoreBreakdown,
    options?: AasReportOptions,
): Partial<Record<string, AasDimensionDetail>> | undefined {
    if (!breakdown?.indices || !options?.includeDimensionDetails) return undefined;

    const notEvaluatedSet = new Set(breakdown.notEvaluated ?? []);
    const details: Record<string, AasDimensionDetail> = {};
    const dimensionToLossesMap = collectDimensionRuleLosses(breakdown.rationales);

    Object.entries(breakdown.indices).forEach(([dimension, scoreValue]) => {
        if (typeof scoreValue !== 'number' || !Number.isFinite(scoreValue)) return;
        const evaluated = !notEvaluatedSet.has(dimension as QualityDimension);
        const fallbackWeight = (DEFAULT_QUALITY_WEIGHTS as Record<string, number>)[dimension];
        const weightVal =
            breakdown.weights &&
            typeof (breakdown.weights as Record<string, number>)[dimension] === 'number'
                ? (breakdown.weights as Record<string, number>)[dimension]
                : fallbackWeight;
        const bottlenecks = extractTopBottlenecks(dimensionToLossesMap.get(dimension));
        const qualityGrade = resolveQualityGrade(scoreValue);

        let confidenceField: { confidence: number } | undefined;
        if (breakdown.confidence !== undefined) {
            confidenceField = {
                confidence:
                    Math.round(breakdown.confidence * ROUND_SCALE_HUNDRED) / ROUND_SCALE_HUNDRED,
            };
        }
        details[dimension] = {
            score: Math.round(scoreValue * ROUND_SCALE_HUNDRED) / ROUND_SCALE_HUNDRED,
            grade: qualityGrade,
            evaluated,
            ...(weightVal !== undefined
                ? { weight: Math.round(weightVal * ROUND_SCALE_THOUSAND) / ROUND_SCALE_THOUSAND }
                : {}),
            ...confidenceField,
            ...bottlenecks,
        };
    });
    return Object.keys(details).length > 0 ? details : undefined;
}

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
 * Computes top quality bottlenecks ordered by point loss or finding frequency fallback.
 *
 * @param report - Scan report containing deductions and issue list.
 * @param limit - Maximum number of bottleneck entries to emit.
 * @returns Ordered bottleneck summary array.
 */
export function extractBottlenecks(
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
