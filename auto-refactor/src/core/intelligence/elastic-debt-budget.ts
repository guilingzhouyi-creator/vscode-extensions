/**
 * Module: Core Intelligence — Role & Scale Aware Elastic Technical Debt Budget Engine
 * File Path: src/core/intelligence/elastic-debt-budget.ts
 * Architecture Role: Evaluates newly introduced technical debt against dynamic, scale-aware,
 *   and quality-fused elastic budget envelopes instead of brittle rigid zero-tolerance deadlocks.
 * Dependencies & Triggers: Zero external dependencies; consumes purely numerical debt counts,
 *   project scale metrics, and composite quality scores. Triggered by scan gates, ratchets,
 *   and workspace self-audit routines.
 * Responsibilities:
 *   1. Calculate scale and health-damped dynamic debt allowances for Critical, High, Medium,
 *      and Low tiers;
 *   2. Support elastic non-zero envelopes for Critical and High debt during transitions;
 *   3. Compute composite weighted technical debt scores with health score fusion;
 *   4. Supply actionable arbitration verdicts (PERMITTED_ELASTIC vs BLOCKED_EXCEEDED_BUDGET).
 * Exit Semantics & Design Rationale: CC <= 10, Depth <= 3; strictly non-throwing; returns
 *   structured ElasticDebtBudgetEvaluation without spurious breakage on healthy codebases.
 */

/**
 * Standardized technical debt tier categories.
 */
export type ElasticDebtTier = 'critical' | 'high' | 'medium' | 'low';

const TIER_CRITICAL: ElasticDebtTier = 'critical';
const TIER_HIGH: ElasticDebtTier = 'high';
const TIER_MEDIUM: ElasticDebtTier = 'medium';
const TIER_LOW: ElasticDebtTier = 'low';

const PROP_PAIR_RULE: readonly [string, string] = Object.freeze(['r', 'rule']);
const PROP_PAIR_TIER: readonly [string, string] = Object.freeze(['t', 'tier']);
const PROP_PAIR_SEVERITY: readonly [string, string] = Object.freeze(['sev', 'severity']);

const SCORE_TIER_A_PLUS = 98.0;
const SCORE_TIER_A = 95.0;
const SCORE_TIER_B_PLUS = 90.0;
const SCORE_TIER_B = 80.0;

const FACTOR_A_PLUS = 1.25;
const FACTOR_A = 1.10;
const FACTOR_B_PLUS = 1.00;
const FACTOR_B = 0.70;
const FACTOR_DEGRADED = 0.40;

const PERCENT_SCALE_HUNDRED = 100;
const DEFAULT_LIMIT_MIN_CRITICAL = 1;
const DEFAULT_LIMIT_MIN_HIGH = 2;
const DEFAULT_LIMIT_MIN_MEDIUM = 10;
const DEFAULT_LIMIT_MIN_LOW = 50;
const SCALE_RATIO_TEN = 10;
const PATH_SEPARATOR_SLASH = '/';
const UNKNOWN_RULE_IDENTIFIER = 'UNKNOWN';
const SEVERITY_WARNING = 'warning';
const NUMSTAT_MIN_PARTS = 3;

/**
 * Technical debt counts partitioned by severity tier.
 */
export interface DebtTierCounts {
    critical: number;
    high: number;
    medium: number;
    low: number;
}

/**
 * Weights assigned to each debt tier for composite debt pressure calculation.
 */
export interface DebtTierWeights {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
}

/**
 * Configuration options for evaluating elastic technical debt budgets.
 */
export interface ElasticDebtBudgetOptions {
    /** Base critical debt allowance (default: 2; permits transition elasticity) */
    readonly baseCriticalAllowance?: number;
    /** Base high debt allowance (default: 5; permits transition elasticity) */
    readonly baseHighAllowance?: number;
    /** Base medium debt allowance (default: 100) */
    readonly baseMediumAllowance?: number;
    /** Base low debt allowance (default: 500) */
    readonly baseLowAllowance?: number;
    /** Total project files scanned (used for dynamic scale square-root scaling) */
    readonly totalFiles?: number;
    /** Total project effective lines of code (ECL) */
    readonly totalEloc?: number;
    /** Project composite health score in [0.0, 100.0] */
    readonly compositeScore?: number;
    /** Prior baseline debt counts to evaluate delta additions */
    readonly baselineDebt?: Partial<DebtTierCounts>;
    /** Custom tier weights for composite pressure calculation */
    readonly tierWeights?: Partial<DebtTierWeights>;
    /** Maximum permissible composite weighted growth before triggering budget breach */
    readonly maxWeightedGrowth?: number;
    /** True if evaluating cumulative repository debt rather than incremental delta */
    readonly cumulative?: boolean;
}

/**
 * Operational verdict returned by the elastic technical debt budget evaluator.
 */
export type ElasticDebtBudgetVerdict =
    | 'PERMITTED_ZERO_DEBT'
    | 'PERMITTED_ELASTIC'
    | 'BLOCKED_EXCEEDED_BUDGET';

/**
 * Specific debt tier violation detail when a budget threshold is exceeded.
 */
export interface DebtTierViolation {
    readonly tier: ElasticDebtTier;
    readonly observed: number;
    readonly delta: number;
    readonly limit: number;
    readonly message: string;
}

/**
 * Comprehensive result of evaluating technical debt against elastic dynamic budgets.
 */
export interface ElasticDebtBudgetEvaluation {
    /** True if technical debt (including Critical and High) is within the elastic envelope */
    readonly isWithinBudget: boolean;
    /** Operational verdict status */
    readonly verdict: ElasticDebtBudgetVerdict;
    /** Dynamic elastic limits computed for the current project scale and health */
    readonly dynamicLimits: DebtTierCounts;
    /** Observed raw debt counts in current scan */
    readonly observedDebt: DebtTierCounts;
    /** Delta additions over baseline */
    readonly deltaDebt: DebtTierCounts;
    /** Composite weighted debt score */
    readonly weightedDebtScore: number;
    /** Net weighted debt growth over baseline */
    readonly weightedGrowth: number;
    /** Scale multiplier derived from repository file count */
    readonly scaleFactor: number;
    /** Health elasticity factor derived from composite quality score */
    readonly healthElasticityFactor: number;
    /** Technical rationale explaining evaluation outcome */
    readonly rationale: string;
    /** List of individual tier violations if any */
    readonly violations: readonly DebtTierViolation[];
}

const DEFAULT_BASE_CRITICAL = 2;
const DEFAULT_BASE_HIGH = 5;
const DEFAULT_BASE_MEDIUM = 100;
const DEFAULT_BASE_LOW = 500;
const REFERENCE_FILE_SCALE = 200;
const DEFAULT_WEIGHTED_GROWTH_LIMIT = 50;

const DEFAULT_TIER_WEIGHTS: DebtTierWeights = Object.freeze({
    critical: 10,
    high: 3,
    medium: 1,
    low: 0.2,
});

/**
 * Resolves the health elasticity multiplier based on current composite quality score.
 * High-quality projects (A+) earn wider elastic allowances; degrading projects are tightened.
 */
function resolveHealthElasticityFactor(compositeScore?: number): number {
    if (compositeScore === undefined || Number.isNaN(compositeScore)) {
        return 1.0;
    }
    if (compositeScore >= SCORE_TIER_A_PLUS) return FACTOR_A_PLUS;
    if (compositeScore >= SCORE_TIER_A) return FACTOR_A;
    if (compositeScore >= SCORE_TIER_B_PLUS) return FACTOR_B_PLUS;
    if (compositeScore >= SCORE_TIER_B) return FACTOR_B;
    return FACTOR_DEGRADED;
}

/**
 * Resolves the scale factor using sub-linear square-root scaling based on total file count.
 */
function resolveScaleFactor(totalFiles?: number): number {
    if (!totalFiles || totalFiles <= 0) {
        return 1.0;
    }
    return Math.max(1.0, Math.round(Math.sqrt(totalFiles / REFERENCE_FILE_SCALE) * PERCENT_SCALE_HUNDRED) / PERCENT_SCALE_HUNDRED);
}

/**
 * Computes composite weighted debt points across all tiers.
 */
export function computeWeightedDebtPoints(
    counts: DebtTierCounts,
    weights: DebtTierWeights = DEFAULT_TIER_WEIGHTS,
): number {
    return Math.round(
        (counts.critical * weights.critical +
            counts.high * weights.high +
            counts.medium * weights.medium +
            counts.low * weights.low) *
        PERCENT_SCALE_HUNDRED,
    ) / PERCENT_SCALE_HUNDRED;
}

function computeRawObserved(observed: Partial<DebtTierCounts>): DebtTierCounts {
    return {
        critical: Math.max(0, observed.critical ?? 0),
        high: Math.max(0, observed.high ?? 0),
        medium: Math.max(0, observed.medium ?? 0),
        low: Math.max(0, observed.low ?? 0),
    };
}

function computeDeltaDebt(
    raw: DebtTierCounts,
    baseline: Partial<DebtTierCounts> = {},
): DebtTierCounts {
    return {
        critical: Math.max(0, raw.critical - (baseline.critical ?? 0)),
        high: Math.max(0, raw.high - (baseline.high ?? 0)),
        medium: Math.max(0, raw.medium - (baseline.medium ?? 0)),
        low: Math.max(0, raw.low - (baseline.low ?? 0)),
    };
}

function computeDynamicLimits(options: ElasticDebtBudgetOptions, factor: number): DebtTierCounts {
    const isCumulative = options.cumulative === true;
    const baseCrit = options.baseCriticalAllowance ?? DEFAULT_BASE_CRITICAL;
    const baseHigh = options.baseHighAllowance ?? DEFAULT_BASE_HIGH;
    const baseMed =
        options.baseMediumAllowance ??
        (isCumulative && options.totalFiles
            ? Math.max(DEFAULT_BASE_MEDIUM, Math.floor(options.totalFiles * 1.5))
            : DEFAULT_BASE_MEDIUM);
    const baseLow =
        options.baseLowAllowance ??
        (isCumulative && options.totalFiles
            ? Math.max(DEFAULT_BASE_LOW, options.totalFiles * SCALE_RATIO_TEN)
            : DEFAULT_BASE_LOW);
    return {
        critical: Math.max(DEFAULT_LIMIT_MIN_CRITICAL, Math.floor(baseCrit * factor)),
        high: Math.max(DEFAULT_LIMIT_MIN_HIGH, Math.floor(baseHigh * factor)),
        medium: Math.max(DEFAULT_LIMIT_MIN_MEDIUM, Math.floor(baseMed * factor)),
        low: Math.max(DEFAULT_LIMIT_MIN_LOW, Math.floor(baseLow * factor)),
    };
}

function resolveTierWeights(options: ElasticDebtBudgetOptions): DebtTierWeights {
    return {
        critical: options.tierWeights?.critical ?? DEFAULT_TIER_WEIGHTS.critical,
        high: options.tierWeights?.high ?? DEFAULT_TIER_WEIGHTS.high,
        medium: options.tierWeights?.medium ?? DEFAULT_TIER_WEIGHTS.medium,
        low: options.tierWeights?.low ?? DEFAULT_TIER_WEIGHTS.low,
    };
}

function checkTierLimit(
    tier: ElasticDebtTier,
    observed: number,
    delta: number,
    limit: number,
): DebtTierViolation | null {
    if (delta <= limit) return null;
    return {
        tier,
        observed,
        delta,
        limit,
        message: `New ${tier} debt (${delta}) exceeds dynamic elastic limit (${limit})`,
    };
}

interface ViolationCheckParams {
    readonly raw: DebtTierCounts;
    readonly delta: DebtTierCounts;
    readonly limits: DebtTierCounts;
    readonly weightedScore: number;
    readonly weightedGrowth: number;
    readonly maxGrowthLimit: number;
}

function collectViolations(params: ViolationCheckParams): DebtTierViolation[] {
    const { raw, delta, limits, weightedScore, weightedGrowth, maxGrowthLimit } = params;
    const violations: DebtTierViolation[] = [];
    const critViolation = checkTierLimit(TIER_CRITICAL, raw.critical, delta.critical, limits.critical);
    if (critViolation) violations.push(critViolation);
    const highViolation = checkTierLimit(TIER_HIGH, raw.high, delta.high, limits.high);
    if (highViolation) violations.push(highViolation);
    const medViolation = checkTierLimit(TIER_MEDIUM, raw.medium, delta.medium, limits.medium);
    if (medViolation) violations.push(medViolation);
    if (weightedGrowth > maxGrowthLimit) {
        violations.push({
            tier: TIER_CRITICAL,
            observed: weightedScore,
            delta: weightedGrowth,
            limit: maxGrowthLimit,
            message: `Composite weighted debt growth (${weightedGrowth.toFixed(1)}) exceeds growth limit (${maxGrowthLimit})`,
        });
    }
    return violations;
}

interface VerdictDecisionParams {
    readonly raw: DebtTierCounts;
    readonly delta: DebtTierCounts;
    readonly violations: readonly DebtTierViolation[];
    readonly scaleFactor: number;
    readonly healthFactor: number;
    readonly limits: DebtTierCounts;
}

function determineVerdictAndRationale(params: VerdictDecisionParams): {
    verdict: ElasticDebtBudgetVerdict;
    rationale: string;
} {
    const { raw, delta, violations, scaleFactor, healthFactor, limits } = params;
    if (raw.critical === 0 && raw.high === 0 && delta.medium === 0) {
        return {
            verdict: 'PERMITTED_ZERO_DEBT',
            rationale: 'Zero Critical and High technical debt observed; fully compliant.',
        };
    }
    if (violations.length === 0) {
        return {
            verdict: 'PERMITTED_ELASTIC',
            rationale:
                `Technical debt is within dynamic elastic envelope (scale=${scaleFactor.toFixed(2)}, ` +
                `healthFactor=${healthFactor.toFixed(2)}, critical=${raw.critical}/${limits.critical}, ` +
                `high=${raw.high}/${limits.high}). No one-vote veto applied.`,
        };
    }
    return {
        verdict: 'BLOCKED_EXCEEDED_BUDGET',
        rationale: `Technical debt breached elastic budget thresholds: ${violations.map((v) => v.message).join('; ')}`,
    };
}

/**
 * Evaluates observed technical debt against elastic, dynamic, scale-aware budgets.
 *
 * @param observed - Current observed debt counts.
 * @param options - Calibration options (files, score, baseline, allowances).
 * @returns Comprehensive ElasticDebtBudgetEvaluation result.
 */
export function evaluateElasticDebtBudget(
    observed: Partial<DebtTierCounts>,
    options: ElasticDebtBudgetOptions = {},
): ElasticDebtBudgetEvaluation {
    const rawObserved = computeRawObserved(observed);
    const deltaDebt = computeDeltaDebt(rawObserved, options.baselineDebt);
    const scaleFactor = resolveScaleFactor(options.totalFiles);
    const healthFactor = resolveHealthElasticityFactor(options.compositeScore);
    const combinedFactor = scaleFactor * healthFactor;
    const dynamicLimits = computeDynamicLimits(options, combinedFactor);
    const weights = resolveTierWeights(options);

    const weightedScore = computeWeightedDebtPoints(rawObserved, weights);
    const weightedGrowth = computeWeightedDebtPoints(deltaDebt, weights);
    const defaultGrowthLimit =
        options.cumulative && options.totalFiles
            ? Math.max(DEFAULT_WEIGHTED_GROWTH_LIMIT, options.totalFiles * SCALE_RATIO_TEN)
            : Math.max(
                DEFAULT_WEIGHTED_GROWTH_LIMIT,
                Math.floor(DEFAULT_WEIGHTED_GROWTH_LIMIT * combinedFactor),
            );
    const maxGrowthLimit = options.maxWeightedGrowth ?? defaultGrowthLimit;

    const violations = collectViolations({
        raw: rawObserved,
        delta: deltaDebt,
        limits: dynamicLimits,
        weightedScore,
        weightedGrowth,
        maxGrowthLimit,
    });
    const isWithinBudget = violations.length === 0;

    const { verdict, rationale } = determineVerdictAndRationale({
        raw: rawObserved,
        delta: deltaDebt,
        violations,
        scaleFactor,
        healthFactor,
        limits: dynamicLimits,
    });

    return {
        isWithinBudget,
        verdict,
        dynamicLimits,
        observedDebt: rawObserved,
        deltaDebt,
        weightedDebtScore: weightedScore,
        weightedGrowth,
        scaleFactor,
        healthElasticityFactor: healthFactor,
        rationale,
        violations,
    };
}

const CRITICAL_RULE_RE = /^(?:ARCH-|clean-layer-violation$|expensive-loop-operation$)/;
const HIGH_RULE_RE = /^(?:high-complexity$|CPX-|PRF-|DAT-|TST-TAU|GOV-GAM)/;
const MEDIUM_RULE_RE = /^(?:large-file$|BIG-|SIM-|duplicate-literal$|GOV-LOG)/;
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.rs', '.go', '.gd', '.py']);
const DOC_EXTENSIONS = new Set(['.json', '.md', '.yaml', '.yml', '.txt']);
const LINE_SHIFT_TOLERANCE = 10;

/** Minimal issue shape accepted by debt tiering and ledger builders. */
export interface DebtIssueLike {
    readonly id?: string;
    readonly rule?: string;
    readonly severity?: string;
    readonly message?: string;
    readonly file?: string;
    readonly line?: number;
    readonly location?: {
        readonly file?: string;
        readonly start?: { readonly line?: number };
    };
}

/** Partitioned technical debt ledger entry. */
export interface DebtLedgerEntry {
    readonly id?: string;
    readonly rule?: string;
    readonly tier: ElasticDebtTier;
    readonly severity?: string;
    readonly file: string;
    readonly line: number;
    readonly message?: string;
}

/** Result of partitioning scan issues into debt tiers and per-file groups. */
export interface DebtLedgerResult<T extends DebtIssueLike = DebtIssueLike> {
    readonly debtByTier: DebtTierCounts;
    readonly criticalItems: DebtLedgerEntry[];
    readonly highItems: DebtLedgerEntry[];
    readonly fileIssuesMap: Map<string, T[]>;
}

/**
 * Classifies an issue finding into technical debt tiers (critical, high, medium, low).
 */
export function classifyElasticDebtTier(issue: DebtIssueLike): ElasticDebtTier {
    const rule = issue.rule || '';
    const sev = issue.severity || SEVERITY_WARNING;
    if (sev === 'error' || CRITICAL_RULE_RE.test(rule)) {
        return TIER_CRITICAL;
    }
    if (rule === 'CPX-TRV-001') {
        return TIER_MEDIUM;
    }
    if (HIGH_RULE_RE.test(rule)) {
        return TIER_HIGH;
    }
    if (sev === 'info') {
        return TIER_LOW;
    }
    return MEDIUM_RULE_RE.test(rule) ? TIER_MEDIUM : TIER_LOW;
}

/**
 * Partitions issues into technical debt tiers and groups them by file path.
 */
export function buildDebtLedger<T extends DebtIssueLike>(
    issues: readonly T[],
): DebtLedgerResult<T> {
    const debtByTier: DebtTierCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const criticalItems: DebtLedgerEntry[] = [];
    const highItems: DebtLedgerEntry[] = [];
    const fileIssuesMap = new Map<string, T[]>();

    for (const issue of issues) {
        const tier = classifyElasticDebtTier(issue);
        debtByTier[tier]++;
        const filePath = issue.location?.file || issue.file || 'unknown';
        let fileList = fileIssuesMap.get(filePath);
        if (!fileList) {
            fileList = [];
            fileIssuesMap.set(filePath, fileList);
        }
        fileList.push(issue);

        if (tier === TIER_CRITICAL || tier === TIER_HIGH) {
            const entry: DebtLedgerEntry = {
                id: issue.id,
                rule: issue.rule,
                tier,
                severity: issue.severity,
                file: filePath,
                line: issue.location?.start?.line || issue.line || 1,
                message: issue.message,
            };
            if (tier === TIER_CRITICAL) criticalItems.push(entry);
            else highItems.push(entry);
        }
    }

    return { debtByTier, criticalItems, highItems, fileIssuesMap };
}

function normalizeRepoRelativeDebtPath(rawPath: string | undefined): string {
    if (!rawPath) return '';
    let norm = rawPath.replace(/\\/g, PATH_SEPARATOR_SLASH);
    const cwdNorm = process.cwd().replace(/\\/g, PATH_SEPARATOR_SLASH);
    if (norm.startsWith(cwdNorm + PATH_SEPARATOR_SLASH)) {
        norm = norm.slice(cwdNorm.length + 1);
    }
    const lastSlash = cwdNorm.lastIndexOf(PATH_SEPARATOR_SLASH);
    const pkgPrefix = (lastSlash !== -1 ? cwdNorm.slice(lastSlash + 1) : cwdNorm) + PATH_SEPARATOR_SLASH;
    const repoIdx = pkgPrefix.length > 1 ? norm.indexOf(pkgPrefix) : -1;
    if (repoIdx !== -1) {
        norm = norm.slice(repoIdx + pkgPrefix.length);
    } else if (norm.startsWith('./')) {
        norm = norm.slice(2);
    }
    return norm;
}

function extractIssueSignatureDesc(issue: DebtIssueLike): {
    rule: string;
    normFile: string;
    line: number;
    tier: ElasticDebtTier;
} {
    const rawFile = issue.location ? issue.location.file : issue.file;
    const normFile = normalizeRepoRelativeDebtPath(rawFile);
    const rule = issue.rule || UNKNOWN_RULE_IDENTIFIER;
    const rawLine = issue.location?.start ? issue.location.start.line : issue.line;
    const line = typeof rawLine === 'number' ? rawLine : 1;
    return { rule, normFile, line, tier: classifyElasticDebtTier(issue) };
}

/**
 * Serializes current issues into a compact per-file defect signature map.
 */
export function serializeBaselineSignatures(
    issues: readonly DebtIssueLike[],
): Record<string, Array<{ r: string; l: number; t: ElasticDebtTier }>> {
    const files: Record<string, Array<{ r: string; l: number; t: ElasticDebtTier }>> = {};
    for (const issue of issues) {
        const desc = extractIssueSignatureDesc(issue);
        if (!desc.normFile) continue;
        let list = files[desc.normFile];
        if (!list) {
            list = [];
            files[desc.normFile] = list;
        }
        list.push({ r: desc.rule, l: desc.line, t: desc.tier });
    }
    return files;
}

interface PreviousDefectCandidate {
    rule: string;
    line: number;
    tier: ElasticDebtTier;
    matched: boolean;
}

function calculateDiscreteTierWeight(tier: ElasticDebtTier): number {
    if (tier === TIER_CRITICAL) return DEFAULT_TIER_WEIGHTS.critical;
    if (tier === TIER_HIGH) return DEFAULT_TIER_WEIGHTS.high;
    if (tier === TIER_MEDIUM) return DEFAULT_TIER_WEIGHTS.medium;
    return 0;
}

function matchPreviousDefectCandidate(
    candidates: PreviousDefectCandidate[] | undefined,
    line: number,
): boolean {
    if (!candidates || candidates.length === 0) return false;
    for (const cand of candidates) {
        if (!cand.matched && Math.abs(cand.line - line) <= LINE_SHIFT_TOLERANCE) {
            cand.matched = true;
            return true;
        }
    }
    for (const cand of candidates) {
        if (!cand.matched) {
            cand.matched = true;
            return true;
        }
    }
    return false;
}

const VALID_ELASTIC_TIERS = new Set<string>(['critical', 'high', 'medium', 'low']);

function resolveStringProp(
    raw: Record<string, unknown>,
    keys: readonly [string, string],
    defaultVal: string,
): string {
    const val = raw[keys[0]] ?? raw[keys[1]];
    return val !== undefined && val !== null ? String(val) : defaultVal;
}

function parseDefectRecord(raw: Record<string, unknown>): PreviousDefectCandidate {
    const rule = resolveStringProp(raw, PROP_PAIR_RULE, UNKNOWN_RULE_IDENTIFIER);
    const rawLine = raw.l ?? raw.line;
    const line = typeof rawLine === 'number' ? rawLine : 1;
    const rawTier = resolveStringProp(raw, PROP_PAIR_TIER, '');
    const tier: ElasticDebtTier = VALID_ELASTIC_TIERS.has(rawTier)
        ? (rawTier as ElasticDebtTier)
        : classifyElasticDebtTier({
            rule,
            severity: resolveStringProp(raw, PROP_PAIR_SEVERITY, rawTier || SEVERITY_WARNING),
        });
    return { rule, line, tier, matched: false };
}

function buildPreviousDefectsLookup(
    filesMap: Record<string, unknown> | null | undefined,
): Map<string, PreviousDefectCandidate[]> {
    const prevSignatures = new Map<string, PreviousDefectCandidate[]>();
    if (!filesMap || typeof filesMap !== 'object') return prevSignatures;

    for (const [fileRel, defectList] of Object.entries(filesMap)) {
        if (!Array.isArray(defectList)) continue;
        const normFile = normalizeRepoRelativeDebtPath(fileRel);
        for (const defect of defectList) {
            if (!defect || typeof defect !== 'object') continue;
            const entry = parseDefectRecord(defect as Record<string, unknown>);
            const key = `${entry.rule}#${normFile}`;
            let group = prevSignatures.get(key);
            if (!group) {
                group = [];
                prevSignatures.set(key, group);
            }
            group.push(entry);
        }
    }
    return prevSignatures;
}

function computeDiscreteDebtPoints(byDebtTier: Partial<DebtTierCounts> | null | undefined): number {
    if (!byDebtTier) return 0;
    return (
        (byDebtTier.critical || 0) * DEFAULT_TIER_WEIGHTS.critical +
        (byDebtTier.high || 0) * DEFAULT_TIER_WEIGHTS.high +
        (byDebtTier.medium || 0) * DEFAULT_TIER_WEIGHTS.medium
    );
}

/** Input options for computing structural debt delta across runs. */
export interface StructuralDebtDeltaInput {
    readonly prevFilesMap?: Record<string, unknown> | null;
    readonly currentIssues: readonly DebtIssueLike[];
    readonly currentDebtByTier?: Partial<DebtTierCounts> | null;
    readonly prevBaseline?: {
        readonly metrics?: { readonly byDebtTier?: Partial<DebtTierCounts> };
    } | null;
}

function sumUnmatchedPreviousCandidates(
    prevSignatures: Map<string, PreviousDefectCandidate[]>,
): number {
    let resolvedDebtPoints = 0;
    for (const candidates of prevSignatures.values()) {
        for (const cand of candidates) {
            if (!cand.matched) {
                resolvedDebtPoints += calculateDiscreteTierWeight(cand.tier);
            }
        }
    }
    return resolvedDebtPoints;
}

/**
 * Computes structural added/resolved debt points and regression count with +/-10 line tolerance.
 */
export function calculateStructuralDebtDelta(input: StructuralDebtDeltaInput): {
    addedDebtPoints: number;
    resolvedDebtPoints: number;
    regressionFindingsCount: number;
} {
    if (!input.prevBaseline && !input.prevFilesMap) {
        return { addedDebtPoints: 0, resolvedDebtPoints: 0, regressionFindingsCount: 0 };
    }
    if (!input.prevFilesMap) {
        const currPts = computeDiscreteDebtPoints(input.currentDebtByTier);
        const prevTier = input.prevBaseline?.metrics?.byDebtTier;
        const prevPts = prevTier ? computeDiscreteDebtPoints(prevTier) : currPts;
        return {
            addedDebtPoints: Math.max(0, currPts - prevPts),
            resolvedDebtPoints: Math.max(0, prevPts - currPts),
            regressionFindingsCount: 0,
        };
    }

    const prevSignatures = buildPreviousDefectsLookup(input.prevFilesMap);
    let addedDebtPoints = 0;
    let regressionFindingsCount = 0;
    for (const issue of input.currentIssues) {
        const desc = extractIssueSignatureDesc(issue);
        const key = `${desc.rule}#${desc.normFile}`;
        if (!matchPreviousDefectCandidate(prevSignatures.get(key), desc.line)) {
            addedDebtPoints += calculateDiscreteTierWeight(desc.tier);
            if (desc.tier === 'critical' || desc.tier === 'high') {
                regressionFindingsCount++;
            }
        }
    }

    return {
        addedDebtPoints,
        resolvedDebtPoints: sumUnmatchedPreviousCandidates(prevSignatures),
        regressionFindingsCount,
    };
}

function resolveFileSemanticWeight(filePath: string): number {
    const norm = (filePath || '').replace(/\\/g, '/').toLowerCase();
    if (norm.includes('test') || norm.endsWith('.test.ts')) return 0.7;
    const dot = norm.lastIndexOf('.');
    const ext = dot !== -1 ? norm.slice(dot) : '';
    if (CODE_EXTENSIONS.has(ext)) return 0.85;
    if (DOC_EXTENSIONS.has(ext)) return 0.3;
    return 0.75;
}

function shouldIncludeInElocDiff(filePath: string): boolean {
    const norm = normalizeRepoRelativeDebtPath(filePath).toLowerCase();
    if (!norm) return false;
    return !(
        norm.startsWith('reports/') ||
        norm.startsWith('.refactor-trajectory/') ||
        norm.startsWith('dist/') ||
        norm.startsWith('node_modules/')
    );
}

/**
 * Estimates physical and semantic changed ELOC from `git diff --numstat` output.
 */
export function estimateChangedElocFromNumstat(numstatRaw: string | undefined):
    | {
        changed: number;
        semantic: number;
        added: number;
        deleted: number;
        modified: number;
    }
    | undefined {
    if (!numstatRaw || !numstatRaw.trim()) return undefined;
    let realAdded = 0;
    let realDeleted = 0;
    let changed = 0;
    let weightedSemantic = 0;
    for (const line of numstatRaw.trim().split('\n')) {
        const parts = line.split('\t');
        if (parts.length < NUMSTAT_MIN_PARTS) continue;
        const add = parseInt(parts[0], 10) || 0;
        const del = parseInt(parts[1], 10) || 0;
        const lineTotal = add + del;
        const file = parts[2] || '';
        if (lineTotal === 0 || !shouldIncludeInElocDiff(file)) continue;
        realAdded += add;
        realDeleted += del;
        changed += lineTotal;
        weightedSemantic += lineTotal * resolveFileSemanticWeight(file);
    }
    if (changed === 0) return undefined;
    return {
        changed,
        semantic: Math.max(1, Math.round(weightedSemantic)),
        added: realAdded,
        deleted: realDeleted,
        modified: Math.min(realAdded, realDeleted),
    };
}
