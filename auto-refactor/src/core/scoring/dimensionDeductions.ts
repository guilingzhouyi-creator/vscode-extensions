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
    DIMENSION_COMMENT_QUALITY,
    DIMENSION_CODE_SECURITY,
    DIMENSION_SEMANTIC_PURITY,
    DIMENSION_DUPLICATION,
    FRAGMENT_ERROR,
    FRAGMENT_WARNING,
} from './dimensionLiterals';
import { DIMENSION_RULES, getDimensionRulesForAnalyzer } from './dimensionRuleTable';
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
 * 32-bit Bitmask representation for the 10 quality dimensions (CPX-SPACE-001 zero heap allocation).
 */
export const DIMENSION_BIT_MAP: Record<QualityDimension, number> = {
    architectureConsistency: 1 << 0,
    semanticPurity: 1 << 1,
    codeSecurity: 1 << 2,
    performanceEfficiency: 1 << 3,
    standardization: 1 << 4,
    modernity: 1 << 5,
    maintainability: 1 << 6,
    commentQuality: 1 << 7,
    duplication: 1 << 8,
    techDebtRisk: 1 << 9,
};

/**
 * Convert QualityDimension identifier to its bitmask flag.
 *
 * @param dim - Target quality dimension identifier.
 * @returns Bitmask flag integer for the dimension.
 */
export function dimensionToBit(dim: QualityDimension): number {
    return DIMENSION_BIT_MAP[dim] || 0;
}

/**
 * Check whether a bitmask contains the specified QualityDimension flag.
 *
 * @param mask - Bitmask integer to inspect.
 * @param dim - Target quality dimension identifier.
 * @returns True if the mask contains the dimension flag.
 */
export function bitmaskHasDimension(mask: number, dim: QualityDimension): boolean {
    return (mask & (DIMENSION_BIT_MAP[dim] || 0)) !== 0;
}

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
    // Repository Gate Architecture & Governance
    'GATE-SYS': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'GATE-HOOK': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'GATE-ISO': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'GATE-FAC': DIMENSION_ARCHITECTURE_CONSISTENCY,
    'GATE-ERR': DIMENSION_MAINTAINABILITY,
    'GATE-ROUTE': DIMENSION_MAINTAINABILITY,
    'GATE-BUDGET': DIMENSION_MAINTAINABILITY,
    'GATE-AST': DIMENSION_MAINTAINABILITY,
    'GATE-PROC': DIMENSION_MAINTAINABILITY,
    'GATE-MSG': DIMENSION_STANDARDIZATION,
    'GATE-SSOT': DIMENSION_STANDARDIZATION,
    'GATE-HYG': DIMENSION_STANDARDIZATION,
    GATE: DIMENSION_STANDARDIZATION,
    // Shell / PowerShell Lint Governance
    'SH-ERR': DIMENSION_MAINTAINABILITY,
    'SH-EXIT': DIMENSION_MAINTAINABILITY,
    'SH-INIT': DIMENSION_MAINTAINABILITY,
    'PS-ERROR': DIMENSION_MAINTAINABILITY,
    SH: DIMENSION_STANDARDIZATION,
    PS: DIMENSION_STANDARDIZATION,
    // Code Simplification & Structure Smells
    'SIM-TRN': DIMENSION_MAINTAINABILITY,
    'SIM-BOOL': DIMENSION_MAINTAINABILITY,
    'SIM-ELSE': DIMENSION_MAINTAINABILITY,
    'SIM-GUARD': DIMENSION_MAINTAINABILITY,
    'SIM-IMM': DIMENSION_MAINTAINABILITY,
    'SIM-FLAT': DIMENSION_MAINTAINABILITY,
    'SIM-COMC': DIMENSION_COMMENT_QUALITY,
    'SIM-LONG': DIMENSION_STANDARDIZATION,
    'SIM-EMPTY': DIMENSION_STANDARDIZATION,
    'SIM-PRNT': DIMENSION_STANDARDIZATION,
    SIM: DIMENSION_MAINTAINABILITY,
    // Go Modern Language Pack
    'GOM-CTX': DIMENSION_MODERNITY,
    'GOM-ERR': DIMENSION_MODERNITY,
    'GOM-STYLE': DIMENSION_MODERNITY,
    GOM: DIMENSION_MODERNITY,
    // Naming & Standardization Governance
    NAM: DIMENSION_STANDARDIZATION,
    'NAM-DEC': DIMENSION_ARCHITECTURE_CONSISTENCY,
    // TypeScript Modern Language Pack
    TSM: DIMENSION_MODERNITY,
    // Constants & Duplication Governance
    CONST: DIMENSION_DUPLICATION,
    'duplicate-literal': DIMENSION_DUPLICATION,
    'nested-constant': DIMENSION_DUPLICATION,
    'magic-number': DIMENSION_DUPLICATION,
    'hardcoded-string': DIMENSION_DUPLICATION,
    // Security & Client Exposure Governance
    SEC: DIMENSION_CODE_SECURITY,
    'SEC-EXP': DIMENSION_CODE_SECURITY,
    // Production Build Hygiene
    'PROD-HYG': DIMENSION_MAINTAINABILITY,
    // Frontend UI Engineering & Accessibility
    'UI-ENG': DIMENSION_STANDARDIZATION,
    'UI-ENG-002': DIMENSION_PERFORMANCE_EFFICIENCY,
    'UI-ENG-003': DIMENSION_MAINTAINABILITY,
    // Hygiene Rules
    'HYG-CLN': DIMENSION_DUPLICATION,
    'HYG-NAM': DIMENSION_STANDARDIZATION,
    'HYG-DED': DIMENSION_SEMANTIC_PURITY,
    'HYG-WRAP': DIMENSION_SEMANTIC_PURITY,
    'HYG-EMP': DIMENSION_STANDARDIZATION,
    // Governance Rules
    'GOV-DAT': DIMENSION_MAINTAINABILITY,
    'GOV-STD': DIMENSION_MODERNITY,
    // File Dimension Governance
    'large-file': DIMENSION_MAINTAINABILITY,
};

const MAX_FAMILY_CACHE_SIZE = 256;
const FAMILY_DIMENSION_CACHE = new Map<string, QualityDimension | null>();

/**
 * Pre-sorted family prefixes descending by length to guarantee longest-prefix match.
 */
const SORTED_FAMILY_PREFIXES: readonly string[] = Object.keys(FAMILY_DIMENSIONS).sort(
    (a, b) => b.length - a.length,
);

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
    const cached = FAMILY_DIMENSION_CACHE.get(rule);
    if (cached !== undefined) {
        return cached;
    }

    let resolved: QualityDimension | null = null;
    for (const prefix of SORTED_FAMILY_PREFIXES) {
        // Exact-family ids (e.g. a bare "ARCH") carry no trailing segment, so a plain
        // prefix test would drop them and silently route the finding to techDebtRisk.
        if (rule === prefix || rule.startsWith(prefix + '-')) {
            resolved = FAMILY_DIMENSIONS[prefix];
            break;
        }
    }

    if (FAMILY_DIMENSION_CACHE.size >= MAX_FAMILY_CACHE_SIZE) {
        const oldest = FAMILY_DIMENSION_CACHE.keys().next().value;
        if (oldest !== undefined) {
            FAMILY_DIMENSION_CACHE.delete(oldest);
        }
    }
    FAMILY_DIMENSION_CACHE.set(rule, resolved);
    return resolved;
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
    seedClaimed?: Set<QualityDimension> | number,
): void {
    const line = issue.location?.start?.line;
    let claimedMask = 0;
    if (typeof seedClaimed === 'number') {
        claimedMask = seedClaimed;
    } else if (seedClaimed) {
        for (const dim of seedClaimed) {
            claimedMask |= DIMENSION_BIT_MAP[dim] || 0;
        }
    }

    const rules = getDimensionRulesForAnalyzer(issue.analyzer);
    for (const rule of rules) {
        const bit = DIMENSION_BIT_MAP[rule.dimension] || 0;
        if ((claimedMask & bit) !== 0) continue;
        if (!rule.covers(issue)) continue;
        claimedMask |= bit;
        apply(rule.dimension, rule.points, rule.rationale(issue.message), issue.rule, line);
    }
    applySeverityDeductions(issue, apply, claimedMask, line);
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
let cachedDeductionSources: Record<QualityDimension, string[]> | null = null;

/**
 * Builds the mapping of quality dimensions to deduction analyzer IDs.
 * Pre-allocates buckets for all 10 quality dimensions outside the loop
 * to ensure zero transient Set heap allocations inside the loop (PRF-MEM-001).
 *
 * @returns Analyzer ids per dimension, one entry per table row (an id may repeat).
 */
export function buildDimensionDeductionSources(): Record<QualityDimension, string[]> {
    const buckets: Record<QualityDimension, Set<string>> = {
        architectureConsistency: new Set<string>(),
        semanticPurity: new Set<string>(),
        codeSecurity: new Set<string>(),
        performanceEfficiency: new Set<string>(),
        standardization: new Set<string>(),
        modernity: new Set<string>(),
        maintainability: new Set<string>(),
        commentQuality: new Set<string>(),
        duplication: new Set<string>(),
        techDebtRisk: new Set<string>(),
    };

    for (const rule of DIMENSION_RULES) {
        buckets[rule.dimension].add(rule.analyzer);
    }

    const result = {} as Record<QualityDimension, string[]>;
    for (const [dimensionKey, analyzerSet] of Object.entries(buckets) as [
        QualityDimension,
        Set<string>,
    ][]) {
        if (analyzerSet.size > 0) {
            result[dimensionKey] = Array.from(analyzerSet).sort();
        }
    }
    return result;
}

/**
 * List the analyzers that can deduct each dimension, derived from the rule table.
 * Caches results from buildDimensionDeductionSources to prevent repeated computation.
 *
 * @returns Analyzer ids per dimension, one entry per table row (an id may repeat).
 */
export function dimensionDeductionSources(): Record<QualityDimension, string[]> {
    if (cachedDeductionSources) {
        return cachedDeductionSources;
    }
    cachedDeductionSources = buildDimensionDeductionSources();
    return cachedDeductionSources;
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

const TIER1_PREFIX_RE = /^(?:SEC|ARCH|DEP-INV)/;
const TIER1_KEYWORD_RE = /LEAK|CIRCULAR/;
const TIER2_PREFIX_RE = /^(?:CPX|CMP|DAT|TST-DBT)/;
const TIER2_ANALYZER_RE = /complexity|maintainability/;

export function isTier1CriticalDebt(rule: string, analyzer: string, severity: string): boolean {
    if (severity === FRAGMENT_ERROR) {
        return true;
    }
    const a = (analyzer ?? '').toLowerCase();
    if (a.includes('security')) {
        return true;
    }
    const r = (rule ?? '').toUpperCase();
    return TIER1_PREFIX_RE.test(r) || TIER1_KEYWORD_RE.test(r);
}

export function isTier2EvolutionaryDebt(rule: string, analyzer: string): boolean {
    const a = (analyzer ?? '').toLowerCase();
    if (TIER2_ANALYZER_RE.test(a)) {
        return true;
    }
    const r = (rule ?? '').toUpperCase();
    return TIER2_PREFIX_RE.test(r);
}

/**
 * Classify an issue into a technical debt tier.
 *
 * @param issue - Analyzed issue finding.
 * @returns Technical debt tier (1 = critical, 2 = evolutionary, 3 = smell).
 */
export function classifyDebtTier(issue: Issue): DebtTier {
    const severity = issue.severity ?? '';
    const analyzer = issue.analyzer ?? '';
    const rule = issue.rule ?? '';

    if (isTier1CriticalDebt(rule, analyzer, severity)) {
        return 1;
    }
    if (isTier2EvolutionaryDebt(rule, analyzer)) {
        return 2;
    }
    return 3;
}

function getBaseSeverityDeduction(
    isError: boolean,
    message: string,
): { points: number; rationale: string } {
    return {
        points: isError ? DEDUCTION_ERROR_TECH_DEBT : DEDUCTION_WARNING_TECH_DEBT,
        rationale: isError
            ? ScoringRationales.ERROR_TECH_DEBT(message)
            : ScoringRationales.WARNING_TECH_DEBT(message),
    };
}

function resolveDebtDimension(
    rule: string | undefined,
    claimed?: Set<QualityDimension> | number,
): QualityDimension {
    const hasPriorClaim =
        typeof claimed === 'number' ? claimed !== 0 : Boolean(claimed && claimed.size > 0);
    if (hasPriorClaim) {
        return DIMENSION_TECH_DEBT_RISK;
    }
    return familyDimensionOf(rule ?? '') ?? DIMENSION_TECH_DEBT_RISK;
}

function getTierPenaltyScale(issue: Issue): number {
    const tier = classifyDebtTier(issue);
    if (tier === 3) return 0.0;
    if (tier === 2) return 0.5;
    return 1.0;
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
    claimed?: Set<QualityDimension> | number,
    line?: number,
): void {
    const isError = issue.severity === FRAGMENT_ERROR;
    const isWarning = issue.severity === FRAGMENT_WARNING;
    if (!isError && !isWarning) {
        return;
    }

    const debtDimension = resolveDebtDimension(issue.rule, claimed);
    const scale = debtDimension === DIMENSION_TECH_DEBT_RISK ? getTierPenaltyScale(issue) : 1.0;
    if (scale <= 0) {
        return;
    }

    const base = getBaseSeverityDeduction(isError, issue.message);
    const penalty = Math.round(base.points * scale);
    apply(debtDimension, penalty, base.rationale, issue.rule, line);
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
                  const compoundedPoints = calculateCompoundedDeduction(
                      points,
                      occurrenceIndex,
                      alpha,
                  );
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
    let claimedByFamilyMask = 0;
    const recordFamilyClaim: DeductionApplier = (dim, points, reason, rule, line) => {
        claimedByFamilyMask |= DIMENSION_BIT_MAP[dim] || 0;
        apply(dim, points, reason, rule, line);
    };

    applyArchitectureDeductions(issue, recordFamilyClaim);
    applySecurityDeductions(issue, recordFamilyClaim);
    applyPerformanceDeductions(issue, recordFamilyClaim);
    applyQualityDimensionDeductions(issue, effectiveApply, claimedByFamilyMask);
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
