/**
 * Module: Core Engine — Quality Dimension Deduction Rules
 * File Path: src/core/scoring/dimensionDeductions.ts
 * Architecture Role: Rule-to-dimension deduction evaluators for transparent quality scoring.
 * Dependencies & Triggers: Imports Issue, FileMetric from ../types, ScoringRationales from
 *   ../messages, and dimension types from ./scoringTypes; called by QualityScorer.
 * Responsibilities: Run the declarative table from ./dimensionRuleTable (standardization,
 *   modernity, semantic purity, maintainability, comments, duplication), add the severity debt
 *   fallback, delegate architecture/security/performance families to
 *   ./dimensionFamilyDeductions, and apply file-metric deductions (nesting, exported symbols).
 * Exit Semantics & Design Rationale: Pure functions with zero side effects beyond calling the
 *   provided deduction applier callback; swallows no errors and performs no I/O.
 */
import {
    DEDUCTION_ERROR_TECH_DEBT,
    DEDUCTION_NESTING_DEPTH_OVERFLOW,
    DEDUCTION_EXCESSIVE_EXPORTED_SYMBOLS,
    DEDUCTION_WARNING_TECH_DEBT,
    MAX_NESTING_DEPTH,
    MAX_EXPORTED_SYMBOLS,
    DIMENSION_ARCHITECTURE_CONSISTENCY,
    DIMENSION_MAINTAINABILITY,
    DIMENSION_TECH_DEBT_RISK,
    DIMENSION_PERFORMANCE_EFFICIENCY,
    DIMENSION_MODERNITY,
    DIMENSION_STANDARDIZATION,
    FRAGMENT_ERROR,
    FRAGMENT_WARNING,
} from './dimensionLiterals';
import { DIMENSION_RULES } from './dimensionRuleTable';
import {
    applyArchitectureDeductions,
    applySecurityDeductions,
    applyPerformanceDeductions,
} from './dimensionFamilyDeductions';
export {
    applyArchitectureDeductions,
    applySecurityDeductions,
    applyPerformanceDeductions,
} from './dimensionFamilyDeductions';

import type { Issue, FileMetric } from '../types';
import { ScoringRationales } from '../messages';
import type { QualityDimension } from './scoringTypes';

/**
 * Explicit rule-family -> quality dimension routing for the quantified standard.
 */
export const FAMILY_DIMENSIONS: Record<string, QualityDimension> = {
    'GOV-PRF': DIMENSION_PERFORMANCE_EFFICIENCY,
    'PRF-MEM': DIMENSION_PERFORMANCE_EFFICIENCY,
    'PRF-IO': DIMENSION_PERFORMANCE_EFFICIENCY,
    'PRF-ALG': DIMENSION_PERFORMANCE_EFFICIENCY,
    'PRF-LEAK': DIMENSION_PERFORMANCE_EFFICIENCY,
    'PRF-POL': DIMENSION_PERFORMANCE_EFFICIENCY,
    CMP: DIMENSION_PERFORMANCE_EFFICIENCY,
    // GOV-TYP findings are implicit/loose typing that hides errors at runtime. That is a
    // type-purity defect, which is where the rule table charges it, not an architecture
    // breach. Routing the family to architectureConsistency double-charged one finding
    // across two axes.
    'GOV-TYP': 'semanticPurity',
    ARCH: DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-HDL': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-CFG': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-BLR': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-SKL': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-ROL': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-UTL': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'ARCH-ABS': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'CPX-REC': DIMENSION_MAINTAINABILITY,
    'CPX-BUD': DIMENSION_MAINTAINABILITY,
    'CPX-JST': DIMENSION_MAINTAINABILITY,
    'CPX-HOP': DIMENSION_MAINTAINABILITY,
    'CPX-RED': DIMENSION_MAINTAINABILITY,
    // CPX-NEST and CPX-STM are deducted to maintainability by the rule table, so they need
    // explicit entries here. Without them they fell through to the bare `CPX` catch-all
    // below and were routed to performanceEfficiency, which contradicted the table.
    'CPX-NEST': DIMENSION_MAINTAINABILITY,
    'CPX-STM': DIMENSION_MAINTAINABILITY,
    // Remaining complexity rules are time/space/amplification costs, owned by performance.
    CPX: DIMENSION_PERFORMANCE_EFFICIENCY,
    'DAT-LAY': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'DAT-DEF': DIMENSION_ARCHITECTURE_CONSISTENCY,
    DAT: DIMENSION_PERFORMANCE_EFFICIENCY,
    'TST-TAU': DIMENSION_MAINTAINABILITY,
    'TST-DBT': DIMENSION_MAINTAINABILITY,
    // Test topology breaches are charged to maintainability by the rule table, so the bare
    // TST catch-all below must not claim them for modernity.
    'TST-TOP': DIMENSION_MAINTAINABILITY,
    TST: DIMENSION_MODERNITY,
    'DEP-LAZ': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'DEP-RES': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'DEP-INV': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'DEP-ORD': DIMENSION_STANDARDIZATION,
    'DEP-WLD': DIMENSION_STANDARDIZATION,
    DEP: DIMENSION_STANDARDIZATION,
    GDM: DIMENSION_MODERNITY,
};

/**
 * Resolve a rule id to its explicitly routed dimension.
 *
 * @param rule - Emitted rule id.
 * @returns The routed dimension, or null when the family has no explicit owner.
 */
export function familyDimensionOf(rule: string): QualityDimension | null {
    if (typeof rule !== 'string' || rule.length === 0) {
        return null;
    }
    let best: string | null = null;
    for (const prefix of Object.keys(FAMILY_DIMENSIONS)) {
        // Exact-family ids (e.g. a bare "ARCH") carry no trailing segment, so a plain
        // prefix test would drop them and silently route the finding to techDebtRisk.
        const matches = rule === prefix || rule.startsWith(prefix + '-');
        if (matches && (best === null || prefix.length > best.length)) {
            best = prefix;
        }
    }
    return best === null ? null : FAMILY_DIMENSIONS[best];
}

/**
 * Callback signature for applying a deduction to a quality dimension.
 */
export type DeductionApplier = (
    dim: QualityDimension,
    points: number,
    reason: string,
    rule?: string,
    line?: number,
) => void;

/**
 * Apply the declarative dimension rules, then the severity-based technical-debt deduction.
 *
 * Each dimension is deducted at most once per finding: the first table row that covers the
 * finding wins, and later rows for the same dimension are skipped, so the catch-all row can be
 * written last without negating every specific rule.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 * @param seedClaimed - Dimensions a family applier already charged for this finding.
 */
export function applyQualityDimensionDeductions(
    issue: Issue,
    apply: DeductionApplier,
    seedClaimed?: Set<QualityDimension>,
): void {
    const line = issue.location?.start?.line;
    // Seeded with the dimensions the family appliers already claimed, so a finding that
    // lands in both buckets is charged once per dimension rather than once per bucket.
    const claimed = new Set<QualityDimension>(seedClaimed);
    for (const rule of DIMENSION_RULES) {
        if (rule.analyzer !== issue.analyzer) continue;
        if (claimed.has(rule.dimension)) continue;
        if (!rule.covers(issue)) continue;
        claimed.add(rule.dimension);
        apply(rule.dimension, rule.points, rule.rationale(issue.message), issue.rule, line);
    }
    applySeverityDeductions(issue, apply, claimed, line);
}

/**
 * List the analyzers that can deduct each dimension, derived from the rule table.
 *
 * The coverage model in `DIMENSION_ANALYZERS` decides which axes count as measured, so the two
 * must agree: a deduction from an analyzer a dimension does not declare would be scored without
 * being counted as measured. `techDebtRisk` is the documented exception — every analyzer feeds
 * it through the severity fallback above.
 *
 * @returns Analyzer ids per dimension, one entry per table row (an id may repeat).
 */
export function dimensionDeductionSources(): Record<QualityDimension, string[]> {
    // Accumulated as delimited text so the loop allocates nothing and runs no linear search.
    const joined = new Map<QualityDimension, string>();
    for (const rule of DIMENSION_RULES) {
        joined.set(rule.dimension, (joined.get(rule.dimension) ?? '') + rule.analyzer + '|');
    }
    const result = {} as Record<QualityDimension, string[]>;
    for (const [dimension, analyzers] of joined) {
        result[dimension] = analyzers.split('|').filter(Boolean).sort();
    }
    return result;
}

/**
 * Apply the severity-based technical-debt deduction that every analyzer feeds.
 *
 * The dimension is the finding's explicitly routed family dimension when it has one, so a rule
 * with a dedicated axis is never double-counted as generic debt. When that dedicated dimension
 * has already been deducted by the rule table, the severity deduction is routed to
 * DIMENSION_TECH_DEBT_RISK to prevent unfair double penalty on the primary quality dimension.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 * @param claimed - Optional set of dimensions already deducted by rule table.
 * @param line - Start line of the finding, when known.
 */
/**
 * Three-tier debt classification for technical debt isolation:
 * Tier 1: Critical structural debt (100% penetration to techDebtRisk, no cap)
 * Tier 2: Evolutionary maintenance debt (50% damped penetration to techDebtRisk)
 * Tier 3: Code smells and hygiene (0% penetration to techDebtRisk, primary dimension only)
 */
export type DebtTier = 1 | 2 | 3;

const TIER1_PREFIXES = ['SEC', 'ARCH', 'DEP-INV'];
const TIER1_KEYWORDS = ['LEAK', 'CIRCULAR'];

function isTier1CriticalDebt(rule: string, analyzer: string, severity: string): boolean {
    if (severity === FRAGMENT_ERROR) return true;
    if (analyzer.includes('security')) return true;
    if (TIER1_PREFIXES.some((p) => rule.startsWith(p))) return true;
    return TIER1_KEYWORDS.some((k) => rule.includes(k));
}

const TIER2_PREFIXES = ['CPX', 'CMP', 'DAT', 'TST-DBT'];

function isTier2EvolutionaryDebt(rule: string, analyzer: string): boolean {
    if (analyzer.includes('complexity') || analyzer.includes('maintainability')) return true;
    return TIER2_PREFIXES.some((p) => rule.startsWith(p));
}

/**
 * Classify an issue into a technical debt tier.
 *
 * @param issue - Analyzed issue finding.
 * @returns Technical debt tier (1 = critical, 2 = evolutionary, 3 = smell).
 */
export function classifyDebtTier(issue: Issue): DebtTier {
    const rule = (issue.rule ?? '').toUpperCase();
    const analyzer = (issue.analyzer ?? '').toLowerCase();
    const severity = issue.severity ?? '';

    if (isTier1CriticalDebt(rule, analyzer, severity)) {
        return 1;
    }
    if (isTier2EvolutionaryDebt(rule, analyzer)) {
        return 2;
    }
    return 3;
}

/**
 * Apply the severity-based technical-debt deduction that every analyzer feeds.
 *
 * When the rule table already charged this finding, the finding is debt in its own right and
 * the severity penalty goes to DIMENSION_TECH_DEBT_RISK. Routing it to the family axis
 * instead would charge one finding to two different quality axes: the table row for
 * `GOV-TYP-*` deducts semanticPurity while the family table routes the same id to
 * architectureConsistency, so the old `claimed.has(debtDimension)` check let the severity
 * fallback add a second, different axis on top of the one the table had just charged.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 * @param claimed - Dimensions already deducted for this finding by the rule table or a
 *   family applier; a non-empty set means the finding has already been charged.
 * @param line - Start line of the finding, when known.
 */
function applySeverityDeductions(
    issue: Issue,
    apply: DeductionApplier,
    claimed?: Set<QualityDimension>,
    line?: number,
): void {
    // The table and the family map can name different axes for one id (GOV-TYP deducts
    // semanticPurity in the table but routes to architectureConsistency by family), so
    // membership of the exact routed axis is not enough to detect an existing charge.
    // Any prior charge means this finding is already represented; the severity penalty
    // then belongs to debt rather than to a second quality axis.
    const debtDimension =
        claimed && claimed.size > 0
            ? DIMENSION_TECH_DEBT_RISK
            : (familyDimensionOf(issue.rule ?? '') ?? DIMENSION_TECH_DEBT_RISK);

    // Tiered debt isolation for techDebtRisk
    if (debtDimension === DIMENSION_TECH_DEBT_RISK) {
        const tier = classifyDebtTier(issue);
        if (tier === 3) {
            // Tier 3 code smells do not penetrate into techDebtRisk
            return;
        }
        if (tier === 2) {
            // Tier 2 evolutionary debt penetrates with 50% damping
            const penalty =
                issue.severity === FRAGMENT_ERROR
                    ? Math.round(DEDUCTION_ERROR_TECH_DEBT * 0.5)
                    : Math.round(DEDUCTION_WARNING_TECH_DEBT * 0.5);
            const rationale =
                issue.severity === FRAGMENT_ERROR
                    ? ScoringRationales.ERROR_TECH_DEBT(issue.message)
                    : ScoringRationales.WARNING_TECH_DEBT(issue.message);
            apply(debtDimension, penalty, rationale, issue.rule, line);
            return;
        }
    }

    if (issue.severity === FRAGMENT_ERROR) {
        apply(
            debtDimension,
            DEDUCTION_ERROR_TECH_DEBT,
            ScoringRationales.ERROR_TECH_DEBT(issue.message),
            issue.rule,
            line,
        );
    } else if (issue.severity === FRAGMENT_WARNING) {
        apply(
            debtDimension,
            DEDUCTION_WARNING_TECH_DEBT,
            ScoringRationales.WARNING_TECH_DEBT(issue.message),
            issue.rule,
            line,
        );
    }
}

/**
 * Options for contextual issue deduction scaling (e.g. Git evolution or fan-in topology).
 */
export interface IssueDeductionOptions {
    evolutionMultiplier?: number;
    impactMultiplier?: number;
    compoundOccurrenceIndex?: number;
    alphaCompounding?: number;
}

/**
 * Calculates non-linear compounding deduction points:
 * Deduction_total = BaseDeduction * (1 + alpha * ln(1 + N))
 *
 * @param basePoints - Base point deduction from rule table
 * @param occurrenceIndex - 0-based repeat index N of the issue family in the same scope
 * @param alpha - Logarithmic compounding dampening factor (default 0.5)
 * @returns Non-linear compounded point deduction
 */
export function calculateCompoundedDeduction(
    basePoints: number,
    occurrenceIndex: number = 0,
    alpha: number = 0.5,
): number {
    if (occurrenceIndex <= 0) return basePoints;
    const multiplier = 1 + alpha * Math.log(1 + occurrenceIndex);
    return Math.round(basePoints * multiplier);
}

/**
 * Apply all issue-based deductions across quality dimensions.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 * @param options - Optional scaling modifiers (evolutionary vulnerability or topological churn).
 */
export function applyIssueDeductions(
    issue: Issue,
    apply: DeductionApplier,
    options?: IssueDeductionOptions,
): void {
    const evoMul = options?.evolutionMultiplier ?? 1.0;
    const impMul = options?.impactMultiplier ?? 1.0;
    const combinedMultiplier = evoMul * impMul;
    const occurrenceIndex = options?.compoundOccurrenceIndex ?? 0;
    const alpha = options?.alphaCompounding ?? 0.5;

    const effectiveApply: DeductionApplier =
        combinedMultiplier !== 1.0 || occurrenceIndex > 0
            ? (dim, points, reason, rule, line) => {
                const compoundedPoints = calculateCompoundedDeduction(points, occurrenceIndex, alpha);
                const amplifiedPoints = Math.round(compoundedPoints * combinedMultiplier);
                const amplifiedReason =
                    combinedMultiplier > 1.0
                        ? `${reason} [Vulnerability x${combinedMultiplier.toFixed(2)}]`
                        : reason;
                apply(dim, amplifiedPoints, amplifiedReason, rule, line);
            }
            : apply;

    // A single finding can match both a family applier and a rule-table row, and the two
    // buckets are not mutually exclusive: `dependency-graph` appears in the rule table and
    // is also accepted by the architecture applier. Charging the same dimension twice for
    // one finding inflated it, so the family appliers are recorded here and the rule table
    // is seeded with them. `ARCH-LEAK-002` still deducts two dimensions on purpose — a
    // leaked credential is both an architecture breach and a security defect — because the
    // guard is per dimension, not per finding.
    const claimedByFamily = new Set<QualityDimension>();
    const recordFamilyClaim: DeductionApplier = (dim, points, reason, rule, line) => {
        claimedByFamily.add(dim);
        apply(dim, points, reason, rule, line);
    };

    applyArchitectureDeductions(issue, recordFamilyClaim);
    applySecurityDeductions(issue, recordFamilyClaim);
    applyPerformanceDeductions(issue, recordFamilyClaim);
    applyQualityDimensionDeductions(issue, effectiveApply, claimedByFamily);
}

/**
 * Apply metrics-based deductions from FileMetric data.
 *
 * @param metric - Computed file metric measurements.
 * @param apply - Deduction callback function.
 */
export function applyMetricDeductions(metric: FileMetric, apply: DeductionApplier): void {
    if (metric.maxNestingDepth > MAX_NESTING_DEPTH) {
        apply(
            DIMENSION_MAINTAINABILITY,
            DEDUCTION_NESTING_DEPTH_OVERFLOW,
            ScoringRationales.MAX_NESTING_DEPTH_OVERFLOW(metric.maxNestingDepth),
        );
    }
    if (metric.exportedSymbols > MAX_EXPORTED_SYMBOLS) {
        apply(
            DIMENSION_ARCHITECTURE_CONSISTENCY,
            DEDUCTION_EXCESSIVE_EXPORTED_SYMBOLS,
            ScoringRationales.EXCESSIVE_EXPORTED_SYMBOLS(metric.exportedSymbols),
        );
    }
}
