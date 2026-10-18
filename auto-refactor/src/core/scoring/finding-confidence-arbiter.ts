/**
 * Module: Core Scoring — Three-Tier Confidence Arbiter & Differential Slicing Guard
 * File Path: src/core/scoring/finding-confidence-arbiter.ts
 * Architecture Role: Evaluates findings using Tricorder-inspired three-tier classification,
 *   enforces inline comment suppressions, and prunes non-blocking historical suggestions
 *   outside differential change slices to minimize review fatigue and false positives.
 * Dependencies & Triggers: Consumes Issue, Severity, and AgentActionablePayload from ../types;
 *   invoked by code review gates, pull request analyzers, and CI pipeline evaluators.
 * Responsibilities:
 *   1. Classify findings into Prescriptive (T1), Actionable (T2), and Advisory (T3) tiers.
 *   2. Enforce inline comment directives (@refactor-suppress, refactor-ignore-rule).
 *   3. Filter out non-blocking historical suggestions outside modified differential slices.
 *   4. Extract executable patches for Actionable findings to enable deterministic codemods.
 *   5. Render explainable arbitration verdicts with zero transient allocations in loops.
 * Exit Semantics & Design Rationale: Deterministic pure evaluation; fail-closed gate block
 *   when prescriptive findings exist; early returns to maintain shallow cyclomatic depth.
 */

import type { Issue } from '../types';

/** Prescriptive confidence tier token denoting hard gate blockers. */
export const TIER_PRESCRIPTIVE = 'prescriptive' as const;

/** Actionable confidence tier token denoting automated refactoring patches. */
export const TIER_ACTIONABLE = 'actionable' as const;

/** Advisory confidence tier token denoting non-blocking quality suggestions. */
export const TIER_ADVISORY = 'advisory' as const;

/** Canonical union type for finding confidence tiers. */
export type FindingConfidenceTier =
    typeof TIER_PRESCRIPTIVE | typeof TIER_ACTIONABLE | typeof TIER_ADVISORY;

/** Gate verdict token indicating approval without blocking issues. */
export const GATE_VERDICT_PASSED = 'passed' as const;

/** Gate verdict token indicating rejection due to blocking findings. */
export const GATE_VERDICT_BLOCKED = 'blocked' as const;

/** Verdict rendered by quality gate arbitration. */
export type GateVerdict = typeof GATE_VERDICT_PASSED | typeof GATE_VERDICT_BLOCKED;

/** Fixed maximum confidence score assigned to prescriptive findings. */
export const CONFIDENCE_PRESCRIPTIVE = 1.0;

/** Default confidence score assigned to actionable findings with patches. */
export const CONFIDENCE_ACTIONABLE_DEFAULT = 0.95;

/** Minimum acceptable confidence floor for actionable findings. */
export const CONFIDENCE_ACTIONABLE_FLOOR = 0.9;

/** Default baseline confidence score assigned to advisory suggestions. */
export const CONFIDENCE_ADVISORY_DEFAULT = 0.75;

/** Default cyclomatic complexity threshold that escalates to prescriptive tier. */
export const DEFAULT_HARD_COMPLEXITY_THRESHOLD = 15;

/** Canonical directive token for suppressing rules via inline comments. */
export const DIRECTIVE_REFACTOR_SUPPRESS = '@refactor-suppress';

/** Legacy compatibility token for ignoring specific rules via comments. */
export const DIRECTIVE_REFACTOR_IGNORE_RULE = 'refactor-ignore-rule';

/** General directive token for inline rule suppression. */
export const DIRECTIVE_REFACTOR_IGNORE = 'refactor-ignore';

/** Pre-compiled regex for inline suppression directives. */
const INLINE_DIRECTIVE_PATTERN =
    /(?:@refactor-suppress(?:-next-line)?|refactor-ignore-rule|refactor-ignore)\b(?:\s*[:(]?\s*([^*/\r\n]*))?/i;

/** Pre-compiled regex for stripping comment syntax. */
const COMMENT_DELIMITER_STRIP_PATTERN = /^[\s/*#\-\\]+|[\s/*#\-\\]+$/g;

/** Pre-compiled regexes for Prescriptive rule keywords. */
const SYNTAX_KEYWORD_PATTERN = /syntax|parse|unexpected token/i;
const SECRET_KEYWORD_PATTERN =
    /secret|credential|passwordhash|passwordsalt|privatekey|clientsecret|authtoken/i;
const COMPLEXITY_KEYWORD_PATTERN = /complexity/i;

/**
 * Structured executable patch for Actionable (T2) findings.
 */
export interface ExecutablePatch {
    /** Target file path */
    file: string;
    /** Replacement code snippet or template */
    templateSnippet?: string;
    /** Standard unified diff representation */
    unifiedDiff?: string;
    /** Line and column coordinates for mechanical text replacement */
    patchRange?: {
        startLine: number;
        startCol: number;
        endLine: number;
        endCol: number;
        replacementText: string;
    };
    /** Rationale or description for automated application */
    description?: string;
    /** Whether safe for automated mutation without human arbitration */
    safeToAutomate: boolean;
}

/**
 * Arbitrated finding result with tiering, confidence, and filtering metadata.
 */
export interface ArbitratedFinding {
    /** Original issue reference */
    issue: Issue;
    /** Assigned confidence tier */
    tier: FindingConfidenceTier;
    /** Quantified confidence score in [0.0, 1.0] */
    confidence: number;
    /** Whether this finding demands gate obstruction */
    mustBlock: boolean;
    /** Executable mutation payload for Actionable findings */
    executablePatch?: ExecutablePatch;
    /** Whether suppressed via inline directive or configuration */
    isSuppressed: boolean;
    /** Whether inlined suppression has passed its TTL expiry date */
    isSuppressionExpired?: boolean;
    /** Expiry date string if suppression was bounded by TTL */
    suppressionExpiryDate?: string;
    /** Human-readable explanation for suppression */
    suppressionReason?: string;
    /** Subordinate secondary findings clustered under this primary finding */
    clusteredFindings?: Issue[];
    /** Whether omitted because it lies outside modified differential code slices */
    isPrunedBySlice: boolean;
    /** Tricorder rule lifecycle state */
    ruleLifecycleState?: RuleLifecycleState;
    /** Whether prescriptive blocking authority was stripped by quarantine/canary lifecycle */
    isQuarantined?: boolean;
    /** Diagnostic rationale for classification and decision */
    rationale: string;
}

/**
 * Tricorder-inspired Rule Lifecycle States governing gating authority.
 */
export type RuleLifecycleState =
    | 'active'
    | 'canary'
    | 'experimental'
    | 'quarantined'
    | 'deprecated';

/**
 * Line range span for differential slice tracking.
 */
export interface LineRangeSpan {
    startLine: number;
    endLine: number;
}

/**
 * Differential slice configuration for PR and commit inspection.
 */
export interface DifferentialSliceConfig {
    /** Whether differential slice filtering is active */
    enabled: boolean;
    /** Changed line ranges per file */
    fileChangedRanges?: Map<string, LineRangeSpan[]> | Record<string, LineRangeSpan[]>;
    /** Changed lines for single-file scenarios */
    changedLines?: Set<number> | number[];
    /** Whether to prune non-blocking findings outside diff spans (default: true) */
    pruneHistoricalNonBlocking?: boolean;
}

/**
 * Options configuring the FindingConfidenceArbiter.
 */
export interface FindingConfidenceArbiterOptions {
    /** Hard cyclomatic complexity threshold to trigger Prescriptive (T1). Default: 15 */
    hardComplexityThreshold?: number;
    /** Additional rule names to treat as Prescriptive (T1). */
    customPrescriptiveRules?: string[];
    /** Minimum confidence score for Actionable tier (T2). Default: 0.90 */
    actionableConfidenceFloor?: number;
    /** Default confidence score for Advisory tier (T3). Default: 0.75 */
    advisoryConfidenceDefault?: number;
    /** Whether inline comment suppression is enabled. Default: true */
    enableInlineSuppression?: boolean;
    /** Additional directive tokens recognized for comment suppression. */
    customDirectiveTokens?: string[];
    /** Differential slice context for pull request or commit review. */
    differentialSlice?: DifferentialSliceConfig;
    /** File content lookup table for inline suppression checks. */
    fileContentMap?: Map<string, string> | Record<string, string>;
    /** Whether to automatically demote prescriptive findings for noisy rules (default: true). */
    autoDemoteNoisyRules?: boolean;
    /** Reference timestamp for evaluating TTL-bounded suppressions (default: Date.now()). */
    nowTimestamp?: number;
    /** Whether to cluster secondary findings on overlapping lines (default: false). */
    enableClustering?: boolean;
    /** Lifecycle state map per rule ID, enforcing quarantine or canary gating */
    ruleLifecycleMap?: Map<string, RuleLifecycleState> | Record<string, RuleLifecycleState>;
    /** Dynamic suppression ratio threshold to trigger automatic rule quarantine (default: 0.50) */
    autoQuarantineThreshold?: number;
}

/**
 * Per-rule suppression health statistic representing noise and developer feedback.
 */
export interface RuleSuppressionStat {
    /** Unique rule identifier */
    rule: string;
    /** Total evaluations of this rule */
    total: number;
    /** Total times this rule was suppressed */
    suppressed: number;
    /** Proportion of evaluations suppressed [0.0, 1.0] */
    suppressionRatio: number;
    /** Whether flagged as noisy (suppression ratio >= 30% with >= 3 samples) */
    isNoisy: boolean;
}

/**
 * Aggregate summary produced by the arbiter.
 */
export interface ArbitrationSummary {
    totalEvaluated: number;
    prescriptiveCount: number;
    actionableCount: number;
    advisoryCount: number;
    suppressedCount: number;
    prunedBySliceCount: number;
    blockingCount: number;
    gateVerdict: GateVerdict;
    findings: ArbitratedFinding[];
    activeFindings: ArbitratedFinding[];
    executablePatches: ExecutablePatch[];
    ruleSuppressionStats?: RuleSuppressionStat[];
    noisyRules?: string[];
    /** Number of subordinate findings clustered under primary findings */
    clusteredCount?: number;
    /** Number of suppressions that have expired past their TTL date */
    expiredSuppressionCount?: number;
    /** Number of findings affected by rule quarantine */
    quarantinedCount?: number;
    /** Rules dynamically elevated to quarantine due to high developer suppression */
    quarantinedRules?: string[];
}

/**
 * Helper to normalize file paths to forward-slash format.
 *
 * @param rawPath - Path with arbitrary separators.
 * @returns Normalized path with forward slashes.
 */
function normalizePath(rawPath: string): string {
    return rawPath.replace(/\\/g, '/');
}

/**
 * Evaluates whether an issue represents a Prescriptive (T1) violation.
 *
 * @param issue - Candidate issue to check.
 * @param threshold - Hard cyclomatic complexity threshold.
 * @param customRules - Custom rule IDs to treat as Prescriptive.
 * @returns Object indicating prescriptive match and technical rationale.
 */
function evaluatePrescriptiveMatch(
    issue: Issue,
    threshold: number,
    customRules?: Set<string>,
): { isMatch: boolean; rationale: string } {
    if (customRules && customRules.has(issue.rule)) {
        return {
            isMatch: true,
            rationale: `Prescriptive rule override matched: ${issue.rule}`,
        };
    }

    if (issue.severity === 'error' && issue.evidence?.confidence === 1.0) {
        return {
            isMatch: true,
            rationale: 'Strict static error with verified confidence 1.0',
        };
    }

    // High-risk secret or credential leak
    if (
        issue.rule === 'ARCH-LEAK-002' ||
        issue.rule === 'SEC-LEAK-001' ||
        (issue.rule.startsWith('SEC-') && issue.severity === 'error') ||
        SECRET_KEYWORD_PATTERN.test(issue.rule) ||
        SECRET_KEYWORD_PATTERN.test(issue.message)
    ) {
        return {
            isMatch: true,
            rationale: `High-risk secret or credential leak detected: ${issue.rule}`,
        };
    }

    // Syntax or parser failure
    if (
        issue.rule.startsWith('SYN-') ||
        issue.rule.startsWith('PARSER-') ||
        SYNTAX_KEYWORD_PATTERN.test(issue.rule) ||
        SYNTAX_KEYWORD_PATTERN.test(issue.analyzer) ||
        SYNTAX_KEYWORD_PATTERN.test(issue.message)
    ) {
        return {
            isMatch: true,
            rationale: `Syntax or parse error detected: ${issue.rule}`,
        };
    }

    // Cyclomatic complexity hard limit exceeded
    const isComplexityRule =
        issue.rule === 'high-complexity' ||
        issue.rule.startsWith('CPX-') ||
        COMPLEXITY_KEYWORD_PATTERN.test(issue.rule);

    if (isComplexityRule) {
        const detailComplexity =
            typeof issue.detail?.complexity === 'number'
                ? issue.detail.complexity
                : typeof issue.detail?.cyclomaticComplexity === 'number'
                  ? issue.detail.cyclomaticComplexity
                  : undefined;

        if (detailComplexity !== undefined && detailComplexity >= threshold) {
            return {
                isMatch: true,
                rationale: `Cyclomatic complexity ${detailComplexity} exceeds threshold ${threshold}`,
            };
        }

        if (issue.rule === 'high-complexity' || issue.severity === 'error') {
            return {
                isMatch: true,
                rationale: `Hard complexity violation: ${issue.rule}`,
            };
        }
    }

    return { isMatch: false, rationale: '' };
}

/**
 * Extracts an executable patch from an issue if present.
 *
 * @param issue - Finding to extract patch data from.
 * @returns Executable patch structure or undefined.
 */
function extractExecutablePatch(issue: Issue): ExecutablePatch | undefined {
    const act = issue.actionable;
    const detail = issue.detail;

    const template =
        act?.templateSnippet ||
        (typeof detail?.templateSnippet === 'string' ? detail.templateSnippet : undefined);

    const diff =
        (typeof detail?.unifiedDiff === 'string' ? detail.unifiedDiff : undefined) ||
        (act?.targetArguments && typeof act.targetArguments.unifiedDiff === 'string'
            ? (act.targetArguments.unifiedDiff as string)
            : undefined);

    const patchRange = act?.patch
        ? {
              startLine: act.patch.range.startLine,
              startCol: act.patch.range.startCol,
              endLine: act.patch.range.endLine,
              endCol: act.patch.range.endCol,
              replacementText: act.patch.replacementText,
          }
        : undefined;

    if (!template && !diff && !patchRange && !act?.safeToAutomate) {
        return undefined;
    }

    return {
        file: issue.location.file,
        templateSnippet: template,
        unifiedDiff: diff,
        patchRange,
        description: act?.rationale || issue.suggestion || issue.message,
        safeToAutomate: act?.safeToAutomate ?? true,
    };
}

const TTL_UNTIL_PATTERN = /\buntil=(\d{4}-\d{2}-\d{2}|\d+)\b/i;

/**
 * Checks if a raw code line matches any custom suppression directives.
 */
function checkCustomDirectives(
    rawLine: string,
    customDirectives?: string[],
): { isSuppressed: boolean; reason?: string } | null {
    if (!customDirectives || customDirectives.length === 0) {
        return null;
    }
    for (let i = 0; i < customDirectives.length; i++) {
        if (rawLine.includes(customDirectives[i])) {
            return {
                isSuppressed: true,
                reason: `Suppressed via custom directive: ${customDirectives[i]}`,
            };
        }
    }
    return null;
}

/**
 * Parses Tricorder TTL expiry (until=YYYY-MM-DD or timestamp) from directive text.
 */
function parseDirectiveTtl(
    cleaned: string,
    nowTimestamp?: number,
): { isExpired: boolean; expiryDate?: string } {
    const untilMatch = TTL_UNTIL_PATTERN.exec(cleaned);
    if (!untilMatch) {
        return { isExpired: false };
    }
    const expiryDate = untilMatch[1];
    const expiryTime = /^\d{4}-\d{2}-\d{2}$/.test(expiryDate)
        ? Date.parse(`${expiryDate}T23:59:59Z`)
        : parseInt(expiryDate, 10);
    const refTime = nowTimestamp ?? Date.now();
    const isExpired = !Number.isNaN(expiryTime) && refTime > expiryTime;
    return { isExpired, expiryDate };
}

/**
 * Splits directive text into rule token list and optional developer reason.
 */
function splitRuleAndReason(cleaned: string): { rulePart: string; reasonPart: string } {
    const colonIdx = cleaned.indexOf(':');
    const dashIdx = cleaned.indexOf('--');
    if (colonIdx >= 0) {
        return {
            rulePart: cleaned.substring(0, colonIdx).trim(),
            reasonPart: cleaned.substring(colonIdx + 1).trim(),
        };
    }
    if (dashIdx >= 0) {
        return {
            rulePart: cleaned.substring(0, dashIdx).trim(),
            reasonPart: cleaned.substring(dashIdx + 2).trim(),
        };
    }
    return { rulePart: cleaned, reasonPart: '' };
}

/**
 * Tests if the rule tokens include the target rule or wildcard.
 */
function matchesRuleToken(tokensString: string, targetRule: string): boolean {
    const tokens = tokensString.split(/[,\s]+/);
    const ruleLower = targetRule.toLowerCase();
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i].trim().toLowerCase();
        if (token === ruleLower || token === '*' || token === 'all') {
            return true;
        }
    }
    return false;
}

/**
 * Formats suppression outcome with TTL expiry state and reason.
 */
function formatSuppressionOutcome(
    isExpired: boolean,
    expiryDate?: string,
    reasonPart?: string,
    targetRule?: string,
): { isSuppressed: boolean; isExpired?: boolean; expiryDate?: string; reason?: string } {
    if (isExpired) {
        return {
            isSuppressed: false,
            isExpired: true,
            expiryDate,
            reason: targetRule
                ? `Suppression expired on ${expiryDate}`
                : `Wildcard suppression expired on ${expiryDate}`,
        };
    }
    const defaultReason = targetRule
        ? `Suppressed via inline directive for rule '${targetRule}'`
        : 'Suppressed via inline comment directive';
    const baseReason = reasonPart || defaultReason;
    const reason = expiryDate ? `${baseReason} (valid until ${expiryDate})` : baseReason;
    return {
        isSuppressed: true,
        isExpired: false,
        expiryDate,
        reason,
    };
}

/**
 * Parses a single line for suppression directive matching an issue rule.
 *
 * @param rawLine - Code line to parse.
 * @param targetRule - The rule to verify against.
 * @param customDirectives - Optional additional directive keywords.
 * @param nowTimestamp - Reference timestamp for evaluating TTL expiry.
 * @returns Suppression evaluation result.
 */
function evaluateLineDirective(
    rawLine: string,
    targetRule: string,
    customDirectives?: string[],
    nowTimestamp?: number,
): { isSuppressed: boolean; isExpired?: boolean; expiryDate?: string; reason?: string } {
    const match = INLINE_DIRECTIVE_PATTERN.exec(rawLine);
    if (!match) {
        return checkCustomDirectives(rawLine, customDirectives) ?? { isSuppressed: false };
    }

    const payload = match[1];
    if (!payload || payload.trim().length === 0) {
        return {
            isSuppressed: true,
            reason: 'Suppressed via wildcard inline comment directive',
        };
    }

    const cleaned = payload.replace(COMMENT_DELIMITER_STRIP_PATTERN, '').trim();
    const { isExpired, expiryDate } = parseDirectiveTtl(cleaned, nowTimestamp);
    const { rulePart, reasonPart } = splitRuleAndReason(cleaned);

    if (rulePart.length === 0) {
        return formatSuppressionOutcome(isExpired, expiryDate, reasonPart);
    }

    if (matchesRuleToken(rulePart, targetRule)) {
        return formatSuppressionOutcome(isExpired, expiryDate, reasonPart, targetRule);
    }

    return { isSuppressed: false };
}

/**
 * Checks if a line number falls within any given line ranges.
 *
 * @param lineNo - 1-based target line number.
 * @param spans - Array of line range spans.
 * @returns True if line is inside any span.
 */
function isLineInRanges(lineNo: number, spans: LineRangeSpan[]): boolean {
    for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        if (lineNo >= span.startLine && lineNo <= span.endLine) {
            return true;
        }
    }
    return false;
}

/**
 * Resolves the primary finding within an overlapping cluster and aggregates secondary findings.
 */
function resolveClusterPrimary(cluster: ArbitratedFinding[]): {
    primary: ArbitratedFinding;
    secondaryCount: number;
} {
    if (cluster.length === 1) {
        return { primary: cluster[0], secondaryCount: 0 };
    }

    const tierWeight = (t: FindingConfidenceTier) =>
        t === TIER_PRESCRIPTIVE ? 3 : t === TIER_ACTIONABLE ? 2 : 1;

    let bestIdx = 0;
    for (let i = 1; i < cluster.length; i++) {
        const best = cluster[bestIdx];
        const cand = cluster[i];
        const wBest = tierWeight(best.tier);
        const wCand = tierWeight(cand.tier);
        if (wCand > wBest || (wCand === wBest && cand.confidence > best.confidence)) {
            bestIdx = i;
        }
    }

    const primary = cluster[bestIdx];
    const secondaries: Issue[] = [];
    for (let i = 0; i < cluster.length; i++) {
        if (i !== bestIdx) {
            secondaries.push(cluster[i].issue);
        }
    }

    primary.clusteredFindings = (primary.clusteredFindings || []).concat(secondaries);
    return { primary, secondaryCount: secondaries.length };
}

/**
 * Clusters secondary findings sharing an overlapping file location with a primary finding.
 * Primary ranking precedence: Prescriptive > Actionable > Advisory, then confidence.
 *
 * @param candidates - List of active arbitrated findings.
 * @returns Deduplicated primary findings and total clustered secondary count.
 */
function clusterOverlappingFindings(candidates: ArbitratedFinding[]): {
    primaries: ArbitratedFinding[];
    clusteredCount: number;
} {
    if (candidates.length <= 1) {
        return { primaries: candidates, clusteredCount: 0 };
    }

    const fileMap = new Map<string, ArbitratedFinding[]>();
    for (let i = 0; i < candidates.length; i++) {
        const f = candidates[i];
        const key = f.issue.location.file;
        let list = fileMap.get(key);
        if (!list) {
            list = [];
            fileMap.set(key, list);
        }
        list.push(f);
    }

    const primaries: ArbitratedFinding[] = [];
    let clusteredCount = 0;

    for (const fileFindings of fileMap.values()) {
        if (fileFindings.length === 1) {
            primaries.push(fileFindings[0]);
            continue;
        }

        fileFindings.sort((a, b) => a.issue.location.start.line - b.issue.location.start.line);

        let currentCluster: ArbitratedFinding[] = [fileFindings[0]];

        for (let i = 1; i < fileFindings.length; i++) {
            const current = fileFindings[i];
            const prev = currentCluster[currentCluster.length - 1];
            if (Math.abs(current.issue.location.start.line - prev.issue.location.start.line) <= 1) {
                currentCluster.push(current);
            } else {
                const outcome = resolveClusterPrimary(currentCluster);
                primaries.push(outcome.primary);
                clusteredCount += outcome.secondaryCount;
                currentCluster = [current];
            }
        }

        if (currentCluster.length > 0) {
            const outcome = resolveClusterPrimary(currentCluster);
            primaries.push(outcome.primary);
            clusteredCount += outcome.secondaryCount;
        }
    }

    return { primaries, clusteredCount };
}

/**
 * Applies rule lifecycle policy (quarantine, canary, experimental, deprecated)
 * to decide whether a prescriptive violation has its blocking authority revoked.
 */
function applyRuleLifecyclePolicy(
    lifecycleState: RuleLifecycleState,
    prescriptive: { isMatch: boolean; rationale: string },
    patch: ExecutablePatch | undefined,
    actionableFloor: number,
    advisoryDefault: number,
): {
    tier: FindingConfidenceTier;
    confidence: number;
    mustBlock: boolean;
    rationale: string;
    isQuarantined: boolean;
} {
    if (lifecycleState === 'quarantined') {
        const tier = patch ? TIER_ACTIONABLE : TIER_ADVISORY;
        const confidence = patch ? actionableFloor : advisoryDefault;
        return {
            tier,
            confidence,
            mustBlock: false,
            rationale: `[TRICORDER QUARANTINE: Rule is quarantined due to elevated developer suppression ratio; prescriptive blocking revoked] ${prescriptive.rationale}`,
            isQuarantined: true,
        };
    }

    if (lifecycleState === 'deprecated') {
        return {
            tier: TIER_ADVISORY,
            confidence: advisoryDefault,
            mustBlock: false,
            rationale: `[DEPRECATED RULE: Rule scheduled for deprecation; prescriptive blocking disabled] ${prescriptive.rationale}`,
            isQuarantined: true,
        };
    }

    if (lifecycleState === 'canary' || lifecycleState === 'experimental') {
        const tier = patch ? TIER_ACTIONABLE : TIER_ADVISORY;
        const confidence = patch ? actionableFloor : advisoryDefault;
        return {
            tier,
            confidence,
            mustBlock: false,
            rationale: `[${lifecycleState.toUpperCase()} RULE: Non-blocking trial evaluation] ${prescriptive.rationale}`,
            isQuarantined: true,
        };
    }

    return {
        tier: TIER_PRESCRIPTIVE,
        confidence: CONFIDENCE_PRESCRIPTIVE,
        mustBlock: true,
        rationale: prescriptive.rationale,
        isQuarantined: false,
    };
}

/**
 * Tricorder-inspired Finding Confidence Arbiter.
 *
 * Enforces three-tier confidence stratification, guards against review noise
 * through inline suppression comments, and prunes non-blocking historical
 * issues outside modified differential slices.
 */
export class FindingConfidenceArbiter {
    private readonly hardComplexityThreshold: number;
    private readonly customPrescriptiveRules?: Set<string>;
    private readonly actionableConfidenceFloor: number;
    private readonly advisoryConfidenceDefault: number;
    private readonly enableInlineSuppression: boolean;
    private readonly customDirectiveTokens?: string[];
    private readonly differentialSlice?: DifferentialSliceConfig;
    private readonly fileContentMap?: Map<string, string>;
    private readonly autoDemoteNoisyRules: boolean;
    private readonly nowTimestamp: number;
    private readonly enableClustering: boolean;
    private readonly ruleLifecycleMap?: Map<string, RuleLifecycleState>;
    private readonly autoQuarantineThreshold: number;

    /**
     * Initializes a new instance of FindingConfidenceArbiter.
     *
     * @param options - Configuration options for confidence arbitration.
     */
    constructor(options?: FindingConfidenceArbiterOptions) {
        this.hardComplexityThreshold =
            options?.hardComplexityThreshold ?? DEFAULT_HARD_COMPLEXITY_THRESHOLD;

        this.customPrescriptiveRules = options?.customPrescriptiveRules
            ? new Set(options.customPrescriptiveRules)
            : undefined;

        this.actionableConfidenceFloor =
            options?.actionableConfidenceFloor ?? CONFIDENCE_ACTIONABLE_FLOOR;

        this.advisoryConfidenceDefault =
            options?.advisoryConfidenceDefault ?? CONFIDENCE_ADVISORY_DEFAULT;

        this.enableInlineSuppression = options?.enableInlineSuppression !== false;
        this.customDirectiveTokens = options?.customDirectiveTokens;
        this.differentialSlice = options?.differentialSlice;
        this.autoDemoteNoisyRules = options?.autoDemoteNoisyRules !== false;
        this.nowTimestamp = options?.nowTimestamp ?? Date.now();
        this.enableClustering = options?.enableClustering ?? false;
        this.autoQuarantineThreshold = options?.autoQuarantineThreshold ?? 0.5;

        if (options?.ruleLifecycleMap) {
            if (options.ruleLifecycleMap instanceof Map) {
                this.ruleLifecycleMap = options.ruleLifecycleMap;
            } else {
                this.ruleLifecycleMap = new Map(Object.entries(options.ruleLifecycleMap));
            }
        }

        if (options?.fileContentMap) {
            if (options.fileContentMap instanceof Map) {
                this.fileContentMap = options.fileContentMap;
            } else {
                this.fileContentMap = new Map(Object.entries(options.fileContentMap));
            }
        }
    }

    /**
     * Evaluates inline comment suppression for a specific issue.
     *
     * @param issue - Target issue to evaluate.
     * @param fileContentOrLines - Optional file source code string or split line array.
     * @returns Suppression verdict and explanation.
     */
    public checkInlineSuppression(
        issue: Issue,
        fileContentOrLines?: string | string[],
    ): {
        isSuppressed: boolean;
        isExpired?: boolean;
        expiryDate?: string;
        reason?: string;
    } {
        if (issue.suppression) {
            return {
                isSuppressed: true,
                reason: issue.suppression.reason,
            };
        }

        if (!this.enableInlineSuppression) {
            return { isSuppressed: false };
        }

        let lines: string[] | undefined;
        if (Array.isArray(fileContentOrLines)) {
            lines = fileContentOrLines;
        } else if (typeof fileContentOrLines === 'string') {
            lines = fileContentOrLines.split('\n');
        } else if (this.fileContentMap) {
            const normPath = normalizePath(issue.location.file);
            const content =
                this.fileContentMap.get(normPath) || this.fileContentMap.get(issue.location.file);
            if (content) {
                lines = content.split('\n');
            }
        }

        if (!lines || lines.length === 0) {
            return { isSuppressed: false };
        }

        const targetLine = issue.location.start.line;
        const lineIdxSame = targetLine - 1;
        const lineIdxPrev = targetLine - 2;

        if (lineIdxSame >= 0 && lineIdxSame < lines.length) {
            const sameResult = evaluateLineDirective(
                lines[lineIdxSame],
                issue.rule,
                this.customDirectiveTokens,
                this.nowTimestamp,
            );
            if (sameResult.isExpired || sameResult.isSuppressed) {
                return sameResult;
            }
        }

        if (lineIdxPrev >= 0 && lineIdxPrev < lines.length) {
            const prevResult = evaluateLineDirective(
                lines[lineIdxPrev],
                issue.rule,
                this.customDirectiveTokens,
                this.nowTimestamp,
            );
            if (prevResult.isExpired || prevResult.isSuppressed) {
                return prevResult;
            }
        }

        return { isSuppressed: false };
    }

    /**
     * Determines whether an issue falls inside active differential change slices.
     *
     * @param issue - Target issue to check.
     * @param changedRanges - Explicit changed line range spans or changed line numbers.
     * @returns True if the issue is positioned on a changed line.
     */
    public isInDifferentialSlice(
        issue: Issue,
        changedRanges?: LineRangeSpan[] | Set<number>,
    ): boolean {
        if (changedRanges instanceof Set) {
            return changedRanges.has(issue.location.start.line);
        }

        if (Array.isArray(changedRanges)) {
            return isLineInRanges(issue.location.start.line, changedRanges);
        }

        const diffConfig = this.differentialSlice;
        if (!diffConfig || !diffConfig.enabled) {
            return true;
        }

        if (diffConfig.changedLines) {
            if (diffConfig.changedLines instanceof Set) {
                return diffConfig.changedLines.has(issue.location.start.line);
            }
            return diffConfig.changedLines.includes(issue.location.start.line);
        }

        const rangesMap = diffConfig.fileChangedRanges;
        if (!rangesMap) {
            return true;
        }

        const normPath = normalizePath(issue.location.file);
        let spans: LineRangeSpan[] | undefined;

        if (rangesMap instanceof Map) {
            spans = rangesMap.get(normPath) || rangesMap.get(issue.location.file);
        } else {
            spans = rangesMap[normPath] || rangesMap[issue.location.file];
        }

        if (!spans || spans.length === 0) {
            return false;
        }

        return isLineInRanges(issue.location.start.line, spans);
    }

    /**
     * Arbitrates a single issue according to confidence, suppression, and differential slice.
     *
     * @param issue - The issue finding to arbitrate.
     * @param fileContent - Optional file content for inline suppression evaluation.
     * @param changedRanges - Optional changed line ranges for differential slice filtering.
     * @returns Complete arbitrated finding record.
     */
    public arbitrateFinding(
        issue: Issue,
        fileContent?: string,
        changedRanges?: LineRangeSpan[],
    ): ArbitratedFinding {
        const suppression = this.checkInlineSuppression(issue, fileContent);
        const prescriptive = evaluatePrescriptiveMatch(
            issue,
            this.hardComplexityThreshold,
            this.customPrescriptiveRules,
        );

        const lifecycleState: RuleLifecycleState =
            this.ruleLifecycleMap?.get(issue.rule) || 'active';

        let tier: FindingConfidenceTier = TIER_ADVISORY;
        let confidence = this.advisoryConfidenceDefault;
        let mustBlock = false;
        let patch: ExecutablePatch | undefined;
        let rationale = '';
        let isSuppressionExpired = false;
        let isQuarantined = false;

        if (suppression.isExpired) {
            isSuppressionExpired = true;
            tier = TIER_PRESCRIPTIVE;
            confidence = CONFIDENCE_PRESCRIPTIVE;
            mustBlock = true;
            rationale = `[SUPPRESSION EXPIRED: Inlined suppression expired on ${suppression.expiryDate}. Immediate remediation required.]`;
            patch = extractExecutablePatch(issue);
        } else if (prescriptive.isMatch) {
            patch = extractExecutablePatch(issue);
            const policy = applyRuleLifecyclePolicy(
                lifecycleState,
                prescriptive,
                patch,
                this.actionableConfidenceFloor,
                this.advisoryConfidenceDefault,
            );
            tier = policy.tier;
            confidence = policy.confidence;
            mustBlock = policy.mustBlock;
            rationale = policy.rationale;
            isQuarantined = policy.isQuarantined;
        } else {
            patch = extractExecutablePatch(issue);
            if (patch) {
                tier = TIER_ACTIONABLE;
                confidence = Math.max(
                    this.actionableConfidenceFloor,
                    issue.evidence?.confidence ?? CONFIDENCE_ACTIONABLE_DEFAULT,
                );
                mustBlock = false;
                rationale = 'Actionable finding with deterministic executable patch payload';
            } else {
                tier = TIER_ADVISORY;
                confidence = Math.min(
                    CONFIDENCE_ACTIONABLE_FLOOR - 0.01,
                    issue.evidence?.confidence ?? this.advisoryConfidenceDefault,
                );
                mustBlock = false;
                rationale = 'Advisory suggestion for architectural evolution and code quality';
            }
        }

        let isPrunedBySlice = false;
        const sliceActive = this.differentialSlice?.enabled ?? false;

        if (sliceActive) {
            const inSlice = this.isInDifferentialSlice(issue, changedRanges);
            const pruneNonBlocking = this.differentialSlice?.pruneHistoricalNonBlocking !== false;

            if (!inSlice && !mustBlock && pruneNonBlocking) {
                isPrunedBySlice = true;
            }
        }

        return {
            issue,
            tier,
            confidence,
            mustBlock,
            executablePatch: patch,
            isSuppressed: suppression.isSuppressed,
            isSuppressionExpired,
            suppressionExpiryDate: suppression.expiryDate,
            suppressionReason: suppression.reason,
            isPrunedBySlice,
            ruleLifecycleState: lifecycleState,
            isQuarantined,
            rationale,
        };
    }

    /**
     * Clusters overlapping findings from multiple analyzers on the same file and line span.
     *
     * @param candidates - List of active arbitrated findings.
     * @returns Clustered primary findings and secondary count.
     */
    public clusterFindings(candidates: ArbitratedFinding[]): {
        primaries: ArbitratedFinding[];
        clusteredCount: number;
    } {
        return clusterOverlappingFindings(candidates);
    }

    /**
     * Arbitrates an entire array of findings in batch.
     *
     * @param issues - List of issues to evaluate.
     * @returns Aggregated arbitration summary and categorized findings.
     */
    public arbitrate(issues: Issue[]): ArbitrationSummary {
        const acc = createInitialBatchAccumulator();

        for (let i = 0; i < issues.length; i++) {
            const result = this.arbitrateFinding(issues[i]);
            recordFindingMetrics(result, acc);
        }

        const { stats: ruleSuppressionStats, noisyRules, autoQuarantinedRules } =
            computeRuleSuppressionStats(acc.ruleMap, this.autoQuarantineThreshold);

        if (this.autoDemoteNoisyRules && noisyRules.length > 0) {
            applyNoisyRuleDemotions(
                acc,
                noisyRules,
                autoQuarantinedRules,
                this.advisoryConfidenceDefault,
            );
        }

        const { finalActiveFindings, clusteredCount } = resolveBatchClustering(
            this.enableClustering,
            acc.activeFindings,
        );

        if (this.enableClustering && acc.activeFindings.length > 1) {
            acc.blockingCount = finalActiveFindings.filter((f) => f.mustBlock).length;
        }

        const gateVerdict: GateVerdict =
            acc.blockingCount > 0 ? GATE_VERDICT_BLOCKED : GATE_VERDICT_PASSED;

        return {
            totalEvaluated: issues.length,
            prescriptiveCount: acc.prescriptiveCount,
            actionableCount: acc.actionableCount,
            advisoryCount: acc.advisoryCount,
            suppressedCount: acc.suppressedCount,
            prunedBySliceCount: acc.prunedBySliceCount,
            blockingCount: acc.blockingCount,
            gateVerdict,
            findings: acc.findings,
            activeFindings: finalActiveFindings,
            executablePatches: acc.executablePatches,
            ruleSuppressionStats,
            noisyRules,
            clusteredCount,
            expiredSuppressionCount: acc.expiredSuppressionCount,
            quarantinedCount: acc.quarantinedCount,
            quarantinedRules: autoQuarantinedRules.length > 0 ? autoQuarantinedRules : undefined,
        };
    }
}

interface IssueBatchAccumulator {
    findings: ArbitratedFinding[];
    activeFindings: ArbitratedFinding[];
    executablePatches: ExecutablePatch[];
    prescriptiveCount: number;
    actionableCount: number;
    advisoryCount: number;
    suppressedCount: number;
    expiredSuppressionCount: number;
    prunedBySliceCount: number;
    blockingCount: number;
    quarantinedCount: number;
    ruleMap: Map<string, { total: number; suppressed: number }>;
}

function createInitialBatchAccumulator(): IssueBatchAccumulator {
    return {
        findings: [],
        activeFindings: [],
        executablePatches: [],
        prescriptiveCount: 0,
        actionableCount: 0,
        advisoryCount: 0,
        suppressedCount: 0,
        expiredSuppressionCount: 0,
        prunedBySliceCount: 0,
        blockingCount: 0,
        quarantinedCount: 0,
        ruleMap: new Map(),
    };
}

function recordFindingMetrics(
    result: ArbitratedFinding,
    acc: IssueBatchAccumulator,
): void {
    acc.findings.push(result);

    const ruleStat = acc.ruleMap.get(result.issue.rule) || { total: 0, suppressed: 0 };
    ruleStat.total++;
    if (result.isSuppressed) {
        ruleStat.suppressed++;
        acc.suppressedCount++;
    }
    acc.ruleMap.set(result.issue.rule, ruleStat);

    if (result.isSuppressionExpired) {
        acc.expiredSuppressionCount++;
    }

    if (result.isQuarantined) {
        acc.quarantinedCount++;
    }

    if (result.tier === TIER_PRESCRIPTIVE) {
        acc.prescriptiveCount++;
    } else if (result.tier === TIER_ACTIONABLE) {
        acc.actionableCount++;
    } else {
        acc.advisoryCount++;
    }

    if (result.isPrunedBySlice) {
        acc.prunedBySliceCount++;
    }

    const isActive = !result.isSuppressed && !result.isPrunedBySlice;
    if (isActive) {
        acc.activeFindings.push(result);
        if (result.mustBlock) {
            acc.blockingCount++;
        }
        if (result.executablePatch) {
            acc.executablePatches.push(result.executablePatch);
        }
    }
}

function computeRuleSuppressionStats(
    ruleMap: Map<string, { total: number; suppressed: number }>,
    autoQuarantineThreshold = 0.5,
): { stats: RuleSuppressionStat[]; noisyRules: string[]; autoQuarantinedRules: string[] } {
    const stats: RuleSuppressionStat[] = [];
    const noisyRules: string[] = [];
    const autoQuarantinedRules: string[] = [];

    for (const [rule, stat] of ruleMap.entries()) {
        const ratio = stat.total > 0 ? +(stat.suppressed / stat.total).toFixed(2) : 0;
        const isNoisy = stat.total >= 3 && ratio >= 0.3;
        stats.push({
            rule,
            total: stat.total,
            suppressed: stat.suppressed,
            suppressionRatio: ratio,
            isNoisy,
        });
        if (isNoisy) {
            noisyRules.push(rule);
        }
        if (stat.total >= 5 && ratio >= autoQuarantineThreshold) {
            autoQuarantinedRules.push(rule);
        }
    }

    return { stats, noisyRules, autoQuarantinedRules };
}

function applyNoisyRuleDemotions(
    acc: IssueBatchAccumulator,
    noisyRules: string[],
    autoQuarantinedRules: string[],
    advisoryDefault: number,
): void {
    const noisySet = new Set(noisyRules);
    const quarantineSet = new Set(autoQuarantinedRules);

    for (let i = 0; i < acc.findings.length; i++) {
        const f = acc.findings[i];
        if (f.tier === TIER_PRESCRIPTIVE && noisySet.has(f.issue.rule)) {
            const isAutoQuarantine = quarantineSet.has(f.issue.rule);
            f.tier = TIER_ADVISORY;
            f.confidence = advisoryDefault;
            if (isAutoQuarantine) {
                f.isQuarantined = true;
                f.ruleLifecycleState = 'quarantined';
                f.rationale +=
                    ' [TRICORDER DYNAMIC QUARANTINE: Auto-quarantined due to excessive developer suppression ratio >= 50%]';
                acc.quarantinedCount++;
            } else {
                f.rationale +=
                    ' [Tricorder Feedback: Demoted from Prescriptive to Advisory due to elevated developer suppression ratio >= 30%]';
            }
            acc.prescriptiveCount--;
            acc.advisoryCount++;
            if (f.mustBlock) {
                f.mustBlock = false;
                acc.blockingCount = Math.max(0, acc.blockingCount - 1);
            }
        }
    }
}

function resolveBatchClustering(
    enableClustering: boolean,
    activeFindings: ArbitratedFinding[],
): { finalActiveFindings: ArbitratedFinding[]; clusteredCount: number } {
    if (!enableClustering || activeFindings.length <= 1) {
        return { finalActiveFindings: activeFindings, clusteredCount: 0 };
    }
    const outcome = clusterOverlappingFindings(activeFindings);
    return {
        finalActiveFindings: outcome.primaries,
        clusteredCount: outcome.clusteredCount,
    };
}
