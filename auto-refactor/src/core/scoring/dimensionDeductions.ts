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
    DIMENSION_MODERNITY,
    FRAGMENT_ERROR,
    FRAGMENT_WARNING,
    RULE_MOD_BWD_001,
    DEDUCTION_BACKWARD_SHIM,
} from './dimensionLiterals';
import { calculateShimDebtDecayPenalty } from './modernization-formulas';
export { calculateDirectnessIndex, calculateShimDebtDecayPenalty } from './modernization-formulas';
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
    // --- architectureConsistency (67 prefixes) ---
    ARCH: 'architectureConsistency',
    'ARCH-HDL': 'architectureConsistency',
    'ARCH-CFG': 'architectureConsistency',
    'ARCH-BLR': 'architectureConsistency',
    'ARCH-SKL': 'architectureConsistency',
    'ARCH-ROL': 'architectureConsistency',
    'ARCH-UTL': 'architectureConsistency',
    'ARCH-ABS': 'architectureConsistency',
    'DAT-LAY': 'architectureConsistency',
    'DAT-DEF': 'architectureConsistency',
    'DEP-LAZ': 'architectureConsistency',
    'DEP-RES': 'architectureConsistency',
    'DEP-INV': 'architectureConsistency',
    'GATE-SYS': 'architectureConsistency',
    'GUARD-SYS': 'architectureConsistency',
    'GATE-HOOK': 'architectureConsistency',
    'GUARD-HOOK': 'architectureConsistency',
    'GATE-ISO': 'architectureConsistency',
    'GUARD-ISO': 'architectureConsistency',
    'GATE-FAC': 'architectureConsistency',
    'GUARD-FAC': 'architectureConsistency',
    'NAM-DEC': 'architectureConsistency',
    'VSC-MEM': 'architectureConsistency',
    'VSC-UI-002': 'architectureConsistency',
    VSC: 'architectureConsistency',
    'ADV-CFG': 'architectureConsistency',
    'ADV-BND': 'architectureConsistency',
    'ADV-DEC': 'architectureConsistency',
    ADV: 'architectureConsistency',
    'FGT-BRG': 'architectureConsistency',
    'FGT-CAS': 'architectureConsistency',
    'FGT-COR': 'architectureConsistency',
    'FGT-DEP': 'architectureConsistency',
    'FGT-FAC': 'architectureConsistency',
    'FGT-GAT': 'architectureConsistency',
    'FGT-IDX': 'architectureConsistency',
    'FGT-OBJ': 'architectureConsistency',
    'FGT-POL': 'architectureConsistency',
    'FGT-STO': 'architectureConsistency',
    'FGT-TOP': 'architectureConsistency',
    'FGT-TRN': 'architectureConsistency',
    FGT: 'architectureConsistency',
    RCFG: 'architectureConsistency',
    'ART-SPEC': 'architectureConsistency',
    'ART-AUD': 'architectureConsistency',
    ART: 'architectureConsistency',
    LAY: 'architectureConsistency',
    RES: 'architectureConsistency',
    'STDLIB-ALLOC': 'architectureConsistency',
    STDLIB: 'architectureConsistency',
    'GOV-ARC': 'architectureConsistency',
    'GOV-AGN': 'architectureConsistency',
    'GOV-RUL': 'architectureConsistency',
    'GOV-RTC': 'architectureConsistency',
    'GOV-TRJ': 'architectureConsistency',
    'GOV-SAN': 'architectureConsistency',
    'clean-layer': 'architectureConsistency',
    disallowed: 'architectureConsistency',
    import: 'architectureConsistency',
    analyzer: 'architectureConsistency',
    ARF: 'architectureConsistency',
    L0: 'architectureConsistency',
    L1: 'architectureConsistency',
    L2: 'architectureConsistency',
    L3: 'architectureConsistency',
    L4: 'architectureConsistency',
    L5: 'architectureConsistency',
    // --- codeSecurity (6 prefixes) ---
    'GUARD-DESTR': 'codeSecurity',
    SEC: 'codeSecurity',
    'SEC-EXP': 'codeSecurity',
    'FGT-SAF': 'codeSecurity',
    secret: 'codeSecurity',
    'high-entropy': 'codeSecurity',
    // --- performanceEfficiency (22 prefixes) ---
    'GOV-PRF': 'performanceEfficiency',
    'PRF-MEM': 'performanceEfficiency',
    'PRF-IO': 'performanceEfficiency',
    'PRF-ALG': 'performanceEfficiency',
    'PRF-LEAK': 'performanceEfficiency',
    'PRF-POL': 'performanceEfficiency',
    CMP: 'performanceEfficiency',
    CPX: 'performanceEfficiency',
    DAT: 'performanceEfficiency',
    'VSC-PERF': 'performanceEfficiency',
    'VSC-UI-001': 'performanceEfficiency',
    'VSC-UI-004': 'performanceEfficiency',
    'UI-ENG-002': 'performanceEfficiency',
    'ADV-PRF': 'performanceEfficiency',
    'ADV-POOL': 'performanceEfficiency',
    'FGT-PRF': 'performanceEfficiency',
    'FGT-LCK': 'performanceEfficiency',
    'FGT-ALG': 'performanceEfficiency',
    'expensive-loop': 'performanceEfficiency',
    'high-algorithmic': 'performanceEfficiency',
    'loop-transient': 'performanceEfficiency',
    'PRF-DUP': 'performanceEfficiency',
    // --- maintainability (62 prefixes) ---
    'CPX-REC': 'maintainability',
    'CPX-BUD': 'maintainability',
    'CPX-JST': 'maintainability',
    'CPX-HOP': 'maintainability',
    'CPX-RED': 'maintainability',
    'CPX-NEST': 'maintainability',
    'CPX-STM': 'maintainability',
    'TST-TAU': 'maintainability',
    'TST-DBT': 'maintainability',
    'TST-ORC': 'maintainability',
    'TST-TOP': 'maintainability',
    'GATE-ERR': 'maintainability',
    'GUARD-ERR': 'maintainability',
    'GATE-ROUTE': 'maintainability',
    'GUARD-ROUTE': 'maintainability',
    'GATE-BUDGET': 'maintainability',
    'GUARD-BUDGET': 'maintainability',
    'GATE-AST': 'maintainability',
    'GUARD-AST': 'maintainability',
    'GATE-PROC': 'maintainability',
    'GUARD-PROC': 'maintainability',
    'SH-ERR': 'maintainability',
    'SH-EXIT': 'maintainability',
    'SH-INIT': 'maintainability',
    'PS-ERROR': 'maintainability',
    'SIM-TRN': 'maintainability',
    'SIM-BOOL': 'maintainability',
    'SIM-ELSE': 'maintainability',
    'SIM-GUARD': 'maintainability',
    'SIM-IMM': 'maintainability',
    'SIM-FLAT': 'maintainability',
    SIM: 'maintainability',
    'VSC-UI-003': 'maintainability',
    'PROD-HYG': 'maintainability',
    'UI-ENG-003': 'maintainability',
    'UI-ENG-005': 'maintainability',
    'UI-ENG-007': 'maintainability',
    'UI-ENG-008': 'maintainability',
    'GOV-DAT': 'maintainability',
    'large-file': 'maintainability',
    'ADV-EVT': 'maintainability',
    'ADV-LAM': 'maintainability',
    'ADV-SIG': 'maintainability',
    'FGT-ERR': 'maintainability',
    'ART-REC': 'maintainability',
    'ART-VIG': 'maintainability',
    'VOL-ELOC': 'maintainability',
    'VOL-LOC': 'maintainability',
    'VOL-TAU': 'maintainability',
    'VOL-POR': 'maintainability',
    'VOL-DIL': 'maintainability',
    'VOL-RATIO': 'maintainability',
    VOL: 'maintainability',
    ERR: 'maintainability',
    TB: 'maintainability',
    'STDLIB-PANIC': 'maintainability',
    'STDLIB-RECURSION': 'maintainability',
    'HYG-SGL': 'maintainability',
    'HYG-STB': 'maintainability',
    'GOV-GAM': 'maintainability',
    'GOV-BLS': 'maintainability',
    high: 'maintainability',
    // --- standardization (45 prefixes) ---
    'DEP-ORD': 'standardization',
    'DEP-WLD': 'standardization',
    DEP: 'standardization',
    'GATE-MSG': 'standardization',
    'GUARD-MSG': 'standardization',
    'GATE-SSOT': 'standardization',
    'GUARD-SSOT': 'standardization',
    'GATE-HYG': 'standardization',
    'GUARD-HYG': 'standardization',
    GAT: 'standardization',
    GATE: 'standardization',
    GUARD: 'standardization',
    SH: 'standardization',
    PS: 'standardization',
    'SIM-LONG': 'standardization',
    'SIM-EMPTY': 'standardization',
    'SIM-PRNT': 'standardization',
    NAM: 'standardization',
    'UI-ENG': 'standardization',
    'HYG-NAM': 'standardization',
    'HYG-EMP': 'standardization',
    'ADV-TYP': 'standardization',
    'ADV-NAM': 'standardization',
    'ADV-UI': 'standardization',
    'DOC-DUP': 'standardization',
    'DOC-TRM': 'standardization',
    CMG: 'standardization',
    'ART-UI': 'standardization',
    'ART-ICO': 'standardization',
    SCR: 'standardization',
    'STDLIB-UNSAFE': 'standardization',
    'STDLIB-CONST': 'standardization',
    'STDLIB-PORT': 'standardization',
    'HYG-IND': 'standardization',
    'HYG-EOL': 'standardization',
    'HYG-BOM': 'standardization',
    'HYG-DIR': 'standardization',
    'HYG-EXC': 'standardization',
    'HYG-SUP': 'standardization',
    'HYG-TRL': 'standardization',
    'HYG-CLT': 'standardization',
    'HYG-BLT': 'standardization',
    HYG: 'standardization',
    GOV: 'standardization',
    'EXT-DIR': 'standardization',
    // --- modernity (14 prefixes) ---
    TST: 'modernity',
    GDM: 'modernity',
    'GOM-CTX': 'modernity',
    'GOM-ERR': 'modernity',
    'GOM-STYLE': 'modernity',
    GOM: 'modernity',
    TSM: 'modernity',
    'GOV-STD': 'modernity',
    'MOD-BWD': 'modernity',
    'MOD-FLB': 'modernity',
    'MOD-DEP': 'modernity',
    MOD: 'modernity',
    RSM: 'modernity',
    PYM: 'modernity',
    // --- semanticPurity (9 prefixes) ---
    'GOV-TYP': 'semanticPurity',
    'NUM-BND': 'semanticPurity',
    NUM: 'semanticPurity',
    'HYG-DED': 'semanticPurity',
    'HYG-WRAP': 'semanticPurity',
    'ADV-RNG': 'semanticPurity',
    'RES-SHUT': 'semanticPurity',
    UUID: 'semanticPurity',
    unused: 'semanticPurity',
    // --- commentQuality (5 prefixes) ---
    'SIM-COMC': 'commentQuality',
    'VSC-I18N': 'commentQuality',
    CMT: 'commentQuality',
    DOC: 'commentQuality',
    'VOL-DOC': 'commentQuality',
    // --- duplication (7 prefixes) ---
    CONST: 'duplication',
    'duplicate-literal': 'duplication',
    'nested-constant': 'duplication',
    'magic-number': 'duplication',
    'hardcoded-string': 'duplication',
    'HYG-CLN': 'duplication',
    HC: 'duplication',
    // --- techDebtRisk (0 prefixes) ---
};

const MAX_FAMILY_CACHE_SIZE = 256;
const FAMILY_DIMENSION_CACHE = new Map<string, QualityDimension | null>();

/**
 * Pre-sorted family prefixes descending by length to guarantee longest-prefix match.
 */
const SORTED_FAMILY_PREFIXES: readonly string[] = Object.keys(FAMILY_DIMENSIONS).sort(
    (deductionA, deductionB) => deductionB.length - deductionA.length,
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
    const bucketEntries = Object.entries(buckets) as [QualityDimension, Set<string>][];
    for (const [dimensionKey, analyzerSet] of bucketEntries) {
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

/**
 * Determine whether a rule finding qualifies as Tier 1 critical structural debt.
 *
 * @param rule - Rule identifier.
 * @param analyzer - Originating analyzer name.
 * @param severity - Severity string of the finding.
 * @returns True if the finding represents critical structural debt.
 */
export function isTier1CriticalDebt(rule: string, analyzer: string, severity: string): boolean {
    if (severity === FRAGMENT_ERROR) {
        return true;
    }
    const analyzerName = (analyzer ?? '').toLowerCase();
    if (analyzerName.includes('security')) {
        return true;
    }
    const ruleId = (rule ?? '').toUpperCase();
    return TIER1_PREFIX_RE.test(ruleId) || TIER1_KEYWORD_RE.test(ruleId);
}

/**
 * Determine whether a rule finding qualifies as Tier 2 evolutionary maintenance debt.
 *
 * @param rule - Rule identifier.
 * @param analyzer - Originating analyzer name.
 * @returns True if the finding represents evolutionary maintenance debt.
 */
export function isTier2EvolutionaryDebt(rule: string, analyzer: string): boolean {
    const analyzerName = (analyzer ?? '').toLowerCase();
    if (TIER2_ANALYZER_RE.test(analyzerName)) {
        return true;
    }
    const ruleId = (rule ?? '').toUpperCase();
    return TIER2_PREFIX_RE.test(ruleId);
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
 * Apply dynamic modernity decay deductions for backward compatibility shims.
 * Integrates calculateShimDebtDecayPenalty and calculateDirectnessIndex.
 *
 * @param issue - Analyzed issue finding.
 * @param apply - Deduction callback function.
 */
export function applyModernityDecayDeductions(issue: Issue, apply: DeductionApplier): void {
    if (!issue.rule || issue.rule !== RULE_MOD_BWD_001) return;
    const line = issue.location?.start?.line;
    const detail = (issue.detail as Record<string, any>) || {};
    const fanIn = typeof detail.fanIn === 'number' ? detail.fanIn : 1;
    const penaltyMul =
        typeof detail.penaltyMultiplier === 'number' ? detail.penaltyMultiplier : 1.0;
    const versionsUntilSunset =
        typeof detail.versionsUntilSunset === 'number' ? detail.versionsUntilSunset : 0;
    const ageDays = versionsUntilSunset <= 0 ? 60 : Math.max(1, (3 - versionsUntilSunset) * 30);
    const dynamicPenalty = calculateShimDebtDecayPenalty(
        DEDUCTION_BACKWARD_SHIM * penaltyMul,
        ageDays,
        fanIn,
        fanIn + 5,
    );
    if (dynamicPenalty > 0) {
        apply(
            DIMENSION_MODERNITY,
            Math.round(dynamicPenalty),
            `Modernity decay penalty for unpruned backward compatibility shim [Fan-in: ${fanIn}, AgeDays: ${ageDays}]`,
            RULE_MOD_BWD_001,
            line,
        );
    }
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
    if (issue.clusteredInto) {
        return;
    }
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
    applyModernityDecayDeductions(issue, recordFamilyClaim);
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
            'CPX-NEST-001',
        );
    }
    if (metric.exportedSymbols > MAX_EXPORTED_SYMBOLS) {
        apply(
            DIMENSION_ARCHITECTURE_CONSISTENCY,
            DEDUCTION_EXCESSIVE_EXPORTED_SYMBOLS,
            ScoringRationales.EXCESSIVE_EXPORTED_SYMBOLS(metric.exportedSymbols),
            'ARCH-BND-001',
        );
    }
}
