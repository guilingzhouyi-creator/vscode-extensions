/**
 * Module: Core Reporting — AAS Executive Health & ADR-Q Metrics Builder
 * File Path: src/core/reporting/aas-health-metrics.ts
 * Architecture Role: Computes executive health block for Agent Audit Schema reports including
 *   composite score, CAI isolation, SQALE debt, polyglot balance, anti-gaming guard, and ADR-Q.
 * Dependencies & Triggers: types, aas-types, aas-dimension-details; invoked by aas-reporter.
 * Responsibilities:
 *   1. Resolve hierarchical governance vs. qualityScore health fields with overrides.
 *   2. Project ADR-Q financial/risk/inequality/stochastic indicators with opt-in legacy aliases.
 *   3. Attach dimensional health summary when dimension details are requested.
 * Exit Semantics & Design Rationale: Pure transformation preserving field omission semantics
 *   when telemetry or arbitration passes did not produce values.
 */

import type { ScanReport } from '../types';
import type { AasCounts, AasHealth, AasReportOptions } from './aas-types';
import { computeDimensionSummary, resolveDimensionIndicesSource } from './aas-dimension-details';

const ROUND_SCALE_HUNDRED = 100;

type QuantSource = NonNullable<NonNullable<ScanReport['qualityScore']>['quant']>;
type QuantTuple = readonly [string, string, (quant: QuantSource) => number | undefined];

const QUANT_FIELD_EXTRACTORS: readonly QuantTuple[] = [
    ['rcr', 'icr', (quant) => quant.financial?.rcr ?? quant.financial?.interestCoverageRatio],
    ['erq', 'qsr', (quant) => quant.riskRatios?.erq ?? quant.riskRatios?.qsr],
    ['ddr', 'sortino', (quant) => quant.riskRatios?.ddr ?? quant.riskRatios?.sortino],
    ['edb95', 'var95', (quant) => quant.riskRatios?.edb95 ?? quant.riskRatios?.var95],
    ['ptd', 'mdd', (quant) => quant.riskRatios?.ptd ?? quant.riskRatios?.mdd],
    ['dsi', 'debtGini', (quant) => quant.inequality?.dsi ?? quant.inequality?.debtGini],
    ['rcd', 'defectEntropy', (quant) => quant.inequality?.rcd ?? quant.inequality?.defectEntropy],
    [
        'ehl',
        'halfLifeCommits',
        (quant) => quant.stochastic?.ehl ?? quant.stochastic?.halfLifeCommits,
    ],
];

function roundMetric(metricValue: number | undefined | null): number | undefined {
    if (typeof metricValue === 'number' && Number.isFinite(metricValue)) {
        return Math.round(metricValue * ROUND_SCALE_HUNDRED) / ROUND_SCALE_HUNDRED;
    }
    return undefined;
}

function deriveHealthSqale(
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

function evaluateHealthPolyglot(
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

function inspectHealthGamingDefense(
    report: ScanReport,
    override?: AasHealth['gamingDefense'],
): AasHealth['gamingDefense'] | undefined {
    if (override) return override;
    const arbitration = report.summary.arbitration;
    if (!arbitration || arbitration.isGamingBlocked === undefined) return undefined;
    return {
        isBlocked: arbitration.isGamingBlocked,
        ...(arbitration.semanticChangeRatio !== undefined
            ? { semanticRatio: roundMetric(arbitration.semanticChangeRatio) }
            : {}),
        ...(arbitration.netDebtDelta !== undefined
            ? { netDebtDelta: arbitration.netDebtDelta }
            : {}),
        ...(arbitration.gamingReason ? { reason: arbitration.gamingReason } : {}),
    };
}

function measureHealthQuant(
    report: ScanReport,
    override?: AasHealth['quant'],
    includeAlias = false,
): AasHealth['quant'] | undefined {
    if (override) return override;
    const quantMetrics = report.qualityScore?.quant;
    if (!quantMetrics) return undefined;
    const quantPayload: Record<string, unknown> = {};
    for (const [primary, alias, read] of QUANT_FIELD_EXTRACTORS) {
        const rounded = roundMetric(read(quantMetrics));
        if (rounded !== undefined) {
            quantPayload[primary] = rounded;
            if (includeAlias) quantPayload[alias] = rounded;
        }
    }
    if (quantMetrics.financial?.status) {
        quantPayload.status = quantMetrics.financial.status;
    }
    return Object.keys(quantPayload).length > 0
        ? (quantPayload as unknown as AasHealth['quant'])
        : undefined;
}

function resolveCoreHealthFields(
    report: ScanReport,
    override?: Partial<AasHealth> & { readonly dimensions?: Partial<Record<string, number>> },
): Pick<AasHealth, 'score' | 'grade' | 'density' | 'tensorSummary' | 'pillars'> {
    const governance = report.governance;
    const source = governance ?? report.qualityScore;
    const rawScore = governance
        ? governance.hierarchicalCompositeScore
        : report.qualityScore?.compositeScore;
    const candidateScore = override?.score ?? rawScore ?? null;
    return {
        score: roundMetric(candidateScore) ?? null,
        grade: override?.grade ?? source?.grade ?? 'N/A',
        density: roundMetric(override?.density ?? source?.effectiveCodeDensity),
        tensorSummary: override?.tensorSummary ?? source?.densityTensorSummary,
        pillars: override?.pillars ?? governance?.eightPillars?.pillars,
    };
}

/**
 * Computes executive health indicators for an Agent Audit Schema report.
 *
 * @param report - Scan report carrying governance, autonomy, and quality breakdowns.
 * @param counts - Aggregated severity counts for summary inclusion.
 * @param options - AAS report emission options and optional metric overrides.
 * @returns Structured AAS executive health block.
 */
export function buildHealth(
    report: ScanReport,
    counts: AasCounts,
    options?: AasReportOptions,
): AasHealth {
    const override = options?.healthOverride;
    const coreFields = resolveCoreHealthFields(report, override);
    const computedCai = roundMetric(override?.cai ?? report.autonomy?.compositeAutonomyIndex);
    const sqale = deriveHealthSqale(report, override?.sqale);
    const polyglot = evaluateHealthPolyglot(report, override?.polyglot);
    const gamingDefense = inspectHealthGamingDefense(report, override?.gamingDefense);
    const quant = measureHealthQuant(
        report,
        override?.quant,
        options?.includeLegacyQuantAliases === true,
    );
    const vrf = override?.vrf;
    const dimensionSummary = options?.includeDimensionDetails
        ? computeDimensionSummary(resolveDimensionIndicesSource(report, override))
        : undefined;

    return {
        score: coreFields.score,
        grade: coreFields.grade,
        ...(computedCai !== undefined ? { cai: computedCai } : {}),
        ...(coreFields.density !== undefined ? { density: coreFields.density } : {}),
        ...(coreFields.tensorSummary ? { tensorSummary: coreFields.tensorSummary } : {}),
        ...(sqale ? { sqale } : {}),
        ...(polyglot ? { polyglot } : {}),
        ...(gamingDefense ? { gamingDefense } : {}),
        ...(quant ? { quant } : {}),
        ...(dimensionSummary ? { dimensionSummary } : {}),
        ...(coreFields.pillars ? { pillars: coreFields.pillars } : {}),
        ...(vrf ? { vrf } : {}),
        counts,
    };
}
