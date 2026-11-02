/**
 * Module: Core Scoring — Anti-Gaming Detector
 * File Path: src/core/scoring/antiGaming.ts
 * Architecture Role: Detects score-gaming behaviors including artificial function splitting,
 *   empty forwarding wrappers, tautological test padding, spurious interfaces, tautological
 *   traversal loop padding, and low-entropy token water-logging.
 * Dependencies & Triggers: Consumes computeEffectiveCodeDensity from ./effectiveDensity,
 *   tokenizeCode and calculateTokenShannonEntropy from ../intelligence/token-entropy,
 *   and Issue from core/types.
 * Responsibilities: Emit canonical GOV-GAM-001 issues and calculate gaming deductions.
 * Exit Semantics & Design Rationale: Deterministic pattern matching with explainable evidence.
 */

import type { Issue } from '../types';
import { computeEffectiveCodeDensity, type EffectiveDensityResult } from './effectiveDensity';
import { evaluateNetCognitiveCost } from './cognitive-cost-model';
import {
    extractConstantEntities,
    analyzeConstantTransitions,
} from '../diff/constant-relocation-detector';

import { evaluateEffectiveCommentDensity } from '../comments/comment-density-model';
import { calculateShannonEntropy } from '../math';
import { AntiGamingMessages } from '../messages';
import { DEFAULT_SCORING_CONFIG, type AntiGamingScoringConfig } from './scoring-parameters';
import type { DifferentialBoundsVerdict } from './diff-bounds-governor';

/**
 * Rule identifier for anti-gaming detection.
 */
export const RULE_GOV_GAM_001 = 'GOV-GAM-001';

/**
 * Legacy/common alias for GOV-GAM-001 (clean re-export without nested constant indirection).
 */
export { RULE_GOV_GAM_001 as ALIAS_SCORE_GAMING_001 };

const ANALYZER_GOVERNANCE = 'governance';
const SEVERITY_WARNING = 'warning';
const DEFAULT_LINE_END_COLUMN = 80;

/** Regular expression matching tautological test assertions. */
const RE_TAUTOLOGY_ASSERTIONS =
    /(?:expect\(true\)\.toBe\(true\)|assert\s+1\s*==\s*1|assert\(true\)|expect\(1\)\.toBe\(1\))/g;

/** Regular expression matching variable declaration bindings across lines. */
const RE_VAR_DECLARATIONS = /\b(?:var|let|const)\s+([a-zA-Z0-9_]+)\b/g;

/** Regular expression stripping variable declaration keyword prefix. */
const RE_VAR_KEYWORD_PREFIX = /\b(?:var|let|const)\s+/;

/** Regular expression testing single letter plus digit sequenced identifier. */
const RE_DEGENERATE_IDENTIFIER = /^[a-zA-Z]\d+$/;

/** Regular expression matching empty or tautological traversal loops. */
const RE_TAUTOLOGICAL_LOOPS =
    /(?:for\s*\([^)]*\)|while\s*\([^)]*\))\s*\{\s*(?:continue;|void\s*0;|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|[\r\n\s])*\}|for\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s+in\s+[^:\r\n]+:\s*(?:pass|\.\.\.)(?:\s|$)/g;

/**
 * Kinds of score gaming recognized.
 */
export type GamingPatternKind =
    | 'artificial_function_splitting'
    | 'tautological_test_padding'
    | 'spurious_empty_interface'
    | 'artificial_relocation_padding'
    | 'tautological_comment_padding'
    | 'naming_entropy_anomaly'
    | 'tautological_traversal_padding'
    | 'low_entropy_token_padding';

const GAMING_KIND_ARTIFICIAL_SPLITTING: GamingPatternKind = 'artificial_function_splitting';
const GAMING_KIND_TAUTOLOGICAL_TEST: GamingPatternKind = 'tautological_test_padding';
const GAMING_KIND_RELOCATION_PADDING: GamingPatternKind = 'artificial_relocation_padding';
const GAMING_KIND_TAUTOLOGICAL_COMMENT: GamingPatternKind = 'tautological_comment_padding';
const GAMING_KIND_NAMING_ENTROPY: GamingPatternKind = 'naming_entropy_anomaly';
const GAMING_KIND_TAUTOLOGICAL_TRAVERSAL: GamingPatternKind = 'tautological_traversal_padding';
const GAMING_KIND_LOW_ENTROPY_TOKEN: GamingPatternKind = 'low_entropy_token_padding';

const FORWARDING_HOP_THRESHOLD = 3;
const FORWARDING_SPLIT_THRESHOLD = 5;
const DENSITY_SPLIT_THRESHOLD = 0.65;
const PENALTY_ARTIFICIAL_SPLITTING = 15.0;

const TAUTOLOGY_TEST_THRESHOLD = 3;
const PENALTY_TAUTOLOGICAL_TEST = 20.0;

const RELOCATION_PADDING_MIN_COUNT = 4;
const RELOCATION_PADDING_PENALTY = 15.0;

const COMMENT_WATERLOG_MIN_LINES = 5;
const PENALTY_TAUTOLOGICAL_COMMENT = 10.0;

const ID_SUFFIX_RELOCATION = 'relocation';
const ID_SUFFIX_TAUTOLOGY = 'tautology';
const ID_SUFFIX_TAUTOLOGICAL_LOOP = 'tautological-loop';
const ID_SUFFIX_LOW_ENTROPY = 'low-entropy-tokens';
const ID_SUFFIX_DEFAULT = '1';

const ENTROPY_CONFIG = {
    minVarCount: 6,
    degenerateThreshold: 6,
    lowBound: 1.5,
    degenerateBound: 2.8,
} as const;

const PENALTY_NAMING_ENTROPY = 10.0;

const TAUTOLOGICAL_LOOP_THRESHOLD = 2;
const PENALTY_TAUTOLOGICAL_TRAVERSAL = 20.0;

const LOW_ENTROPY_MIN_LINES = DEFAULT_SCORING_CONFIG.antiGaming.lowEntropyMinLines;
const LOW_ENTROPY_SHANNON_THRESHOLD = DEFAULT_SCORING_CONFIG.antiGaming.lowEntropyShannonThreshold;
const PENALTY_LOW_ENTROPY_TOKEN = 25.0;

/** Canonical verdict code emitted when the anti-gaming conjunction fires. */
export const VERDICT_BLOCK_GAMING_DETECTED = 'BLOCK_GAMING_DETECTED';

interface CreateGamingIssueParams {
    filePath: string;
    idSuffix: string;
    message: string;
    suggestion: string;
    gamingKind: GamingPatternKind;
    detail: Record<string, unknown>;
}

function createGamingIssue(params: CreateGamingIssueParams): Issue {
    const { filePath, idSuffix, message, suggestion, gamingKind, detail } = params;
    return {
        id: `${ANALYZER_GOVERNANCE}:${RULE_GOV_GAM_001}:${filePath}:${idSuffix}`,
        analyzer: ANALYZER_GOVERNANCE,
        rule: RULE_GOV_GAM_001,
        severity: SEVERITY_WARNING,
        message,
        location: {
            file: filePath,
            start: { line: 1, column: 1 },
            end: { line: 1, column: DEFAULT_LINE_END_COLUMN },
        },
        detail: {
            gamingType: gamingKind,
            gamingKind,
            ...detail,
        },
        suggestion,
    };
}

function buildAntiGamingResult(
    issues: Issue[],
    gamingKinds: GamingPatternKind[],
    gamingPenalty: number,
): AntiGamingResult {
    return {
        hasGaming: issues.length > 0,
        issues,
        gamingKinds,
        gamingPenalty,
    };
}

/**
 * Result of anti-gaming detection.
 */
export interface AntiGamingResult {
    hasGaming: boolean;
    issues: Issue[];
    gamingKinds: GamingPatternKind[];
    gamingPenalty: number;
}

/**
 * Detects artificial function splitting by analyzing density and forwarding counts.
 */
function checkArtificialSplitting(
    filePath: string,
    density: EffectiveDensityResult,
    issues: Issue[],
    gamingKinds: GamingPatternKind[],
): number {
    // Check mechanical call hop inflation (CPX-HOP-001)
    if (density.forwardingCount >= FORWARDING_HOP_THRESHOLD) {
        const hopCost = evaluateNetCognitiveCost(
            filePath,
            Array.from({ length: density.forwardingCount }, (_, i) => ({
                name: `forwarder_${i + 1}`,
                loc: 2,
                cc: 1,
                callDepth: 1,
                isForwardingWrapper: true,
            })),
        );
        issues.push(...hopCost.issues);
    }

    // If there are 5 or more trivial forwarders and density drops below 0.65
    if (
        density.forwardingCount >= FORWARDING_SPLIT_THRESHOLD &&
        density.effectiveDensity < DENSITY_SPLIT_THRESHOLD
    ) {
        gamingKinds.push(GAMING_KIND_ARTIFICIAL_SPLITTING);
        issues.push(
            createGamingIssue({
                filePath,
                idSuffix: ID_SUFFIX_DEFAULT,
                message: AntiGamingMessages.ARTIFICIAL_SPLITTING_MESSAGE(
                    density.forwardingCount,
                    density.effectiveDensity,
                ),
                suggestion: AntiGamingMessages.ARTIFICIAL_SPLITTING_SUGGESTION,
                gamingKind: GAMING_KIND_ARTIFICIAL_SPLITTING,
                detail: {
                    forwardingCount: density.forwardingCount,
                    effectiveDensity: density.effectiveDensity,
                    totalLoc: density.totalLoc,
                },
            }),
        );
        return PENALTY_ARTIFICIAL_SPLITTING;
    }
    return 0.0;
}

/**
 * Detects tautological test padding (fake tests with constant assertions).
 */
function checkTautologicalTestPadding(
    filePath: string,
    content: string,
    issues: Issue[],
    gamingKinds: GamingPatternKind[],
): number {
    const isTest =
        filePath.includes('test') || filePath.includes('spec') || filePath.includes('__tests__');
    if (!isTest) {
        return 0.0;
    }

    const tautologyMatches = content.match(RE_TAUTOLOGY_ASSERTIONS);
    const count = tautologyMatches ? tautologyMatches.length : 0;
    if (count >= TAUTOLOGY_TEST_THRESHOLD) {
        gamingKinds.push(GAMING_KIND_TAUTOLOGICAL_TEST);
        issues.push(
            createGamingIssue({
                filePath,
                idSuffix: ID_SUFFIX_TAUTOLOGY,
                message: AntiGamingMessages.TAUTOLOGICAL_TEST_MESSAGE(count),
                suggestion: AntiGamingMessages.TAUTOLOGICAL_TEST_SUGGESTION,
                gamingKind: GAMING_KIND_TAUTOLOGICAL_TEST,
                detail: {
                    tautologyCount: count,
                },
            }),
        );
        return PENALTY_TAUTOLOGICAL_TEST;
    }
    return 0.0;
}

interface RelocationPaddingParams {
    filePath: string;
    beforeContent: string;
    afterContent: string;
    issues: Issue[];
    gamingKinds: GamingPatternKind[];
}

/**
 * Detects artificial relocation padding where constants are moved around
 * merely to inflate diff line counts.
 */
function checkRelocationPadding(params: RelocationPaddingParams): number {
    const { filePath, beforeContent, afterContent, issues, gamingKinds } = params;
    const beforeEntities = extractConstantEntities(beforeContent, filePath);
    const afterEntities = extractConstantEntities(afterContent, filePath);
    const analysis = analyzeConstantTransitions(beforeEntities, afterEntities);

    if (
        analysis.hasPureRelocationsOnly &&
        analysis.relocatedCount >= RELOCATION_PADDING_MIN_COUNT
    ) {
        gamingKinds.push(GAMING_KIND_RELOCATION_PADDING);
        issues.push(
            createGamingIssue({
                filePath,
                idSuffix: ID_SUFFIX_RELOCATION,
                message: AntiGamingMessages.RELOCATION_PADDING_MESSAGE(analysis.relocatedCount),
                suggestion: AntiGamingMessages.RELOCATION_PADDING_SUGGESTION,
                gamingKind: GAMING_KIND_RELOCATION_PADDING,
                detail: {
                    relocatedCount: analysis.relocatedCount,
                },
            }),
        );
        return RELOCATION_PADDING_PENALTY;
    }
    return 0.0;
}

/**
 * Detects tautological comment padding and water-logging (ECR < 0.40).
 */
function checkTautologicalCommentPadding(
    filePath: string,
    content: string,
    issues: Issue[],
    gamingKinds: GamingPatternKind[],
): number {
    const metrics = evaluateEffectiveCommentDensity(content);
    if (metrics.hasWaterLogging && metrics.totalCommentLines >= COMMENT_WATERLOG_MIN_LINES) {
        gamingKinds.push(GAMING_KIND_TAUTOLOGICAL_COMMENT);
        issues.push(
            createGamingIssue({
                filePath,
                idSuffix: ID_SUFFIX_DEFAULT,
                message: AntiGamingMessages.TAUTOLOGICAL_COMMENT_MESSAGE(
                    metrics.effectiveCommentRatio,
                ),
                suggestion: AntiGamingMessages.TAUTOLOGICAL_COMMENT_SUGGESTION,
                gamingKind: GAMING_KIND_TAUTOLOGICAL_COMMENT,
                detail: {
                    effectiveCommentRatio: metrics.effectiveCommentRatio,
                    totalCommentLines: metrics.totalCommentLines,
                },
            }),
        );
        return PENALTY_TAUTOLOGICAL_COMMENT;
    }
    return 0.0;
}

/**
 * Detects degenerate identifier naming entropy gaming (e.g. var a1, a2, a3, a4, a5...).
 */
function checkNamingEntropyAnomaly(
    filePath: string,
    content: string,
    issues: Issue[],
    gamingKinds: GamingPatternKind[],
): number {
    const varMatches = content.match(RE_VAR_DECLARATIONS);
    if (!varMatches || varMatches.length < ENTROPY_CONFIG.minVarCount) return 0.0;
    const names = varMatches.map((varMatch) => varMatch.replace(RE_VAR_KEYWORD_PREFIX, ''));
    const concatenated = names.join('');
    const entropy = calculateShannonEntropy(concatenated);
    const isDegenerate =
        names.filter((varName) => RE_DEGENERATE_IDENTIFIER.test(varName)).length >=
        ENTROPY_CONFIG.degenerateThreshold;
    if (
        (entropy < ENTROPY_CONFIG.degenerateBound && isDegenerate) ||
        entropy < ENTROPY_CONFIG.lowBound
    ) {
        gamingKinds.push(GAMING_KIND_NAMING_ENTROPY);
        issues.push(
            createGamingIssue({
                filePath,
                idSuffix: ID_SUFFIX_DEFAULT,
                message: AntiGamingMessages.NAMING_ENTROPY_MESSAGE(entropy),
                suggestion: AntiGamingMessages.NAMING_ENTROPY_SUGGESTION,
                gamingKind: GAMING_KIND_NAMING_ENTROPY,
                detail: {
                    entropy,
                    identifierCount: names.length,
                },
            }),
        );
        return PENALTY_NAMING_ENTROPY;
    }
    return 0.0;
}

/**
 * Detects tautological traversal padding (consecutive formal empty loops).
 *
 * @param filePath - Physical path to source file under evaluation.
 * @param content - Source file text content.
 * @param issues - Output issues collection.
 * @param gamingKinds - Detected gaming pattern collection.
 * @returns Quality penalty points (20.0 if triggered, else 0.0).
 */
function checkTautologicalPadding(
    filePath: string,
    content: string,
    issues: Issue[],
    gamingKinds: GamingPatternKind[],
): number {
    const matches = content.match(RE_TAUTOLOGICAL_LOOPS);
    const count = matches ? matches.length : 0;
    if (count >= TAUTOLOGICAL_LOOP_THRESHOLD) {
        gamingKinds.push(GAMING_KIND_TAUTOLOGICAL_TRAVERSAL);
        issues.push(
            createGamingIssue({
                filePath,
                idSuffix: ID_SUFFIX_TAUTOLOGICAL_LOOP,
                message: AntiGamingMessages.TAUTOLOGICAL_TRAVERSAL_MESSAGE(count),
                suggestion: AntiGamingMessages.TAUTOLOGICAL_TRAVERSAL_SUGGESTION,
                gamingKind: GAMING_KIND_TAUTOLOGICAL_TRAVERSAL,
                detail: {
                    tautologicalLoopCount: count,
                },
            }),
        );
        return PENALTY_TAUTOLOGICAL_TRAVERSAL;
    }
    return 0.0;
}

/**
 * Detects low-entropy token padding in oversized files
 * (lines >= 300 with Shannon entropy H(T) < 2.5).
 *
 * @param filePath - Physical path to source file under evaluation.
 * @param content - Source file text content.
 * @param issues - Output issues collection.
 * @param gamingKinds - Detected gaming pattern collection.
 * @returns Quality penalty points (25.0 if triggered, else 0.0).
 */
function checkLowEntropyTokenPadding(
    filePath: string,
    density: EffectiveDensityResult,
    issues: Issue[],
    gamingKinds: GamingPatternKind[],
): number {
    const totalLines = density.physicalLineCount ?? density.totalLoc;
    if (totalLines < LOW_ENTROPY_MIN_LINES || density.tokenEntropy === undefined) {
        return 0.0;
    }

    if (density.tokenEntropy < LOW_ENTROPY_SHANNON_THRESHOLD) {
        gamingKinds.push(GAMING_KIND_LOW_ENTROPY_TOKEN);
        issues.push(
            createGamingIssue({
                filePath,
                idSuffix: ID_SUFFIX_LOW_ENTROPY,
                message: AntiGamingMessages.LOW_ENTROPY_TOKEN_MESSAGE(
                    totalLines,
                    density.tokenEntropy,
                ),
                suggestion: AntiGamingMessages.LOW_ENTROPY_TOKEN_SUGGESTION,
                gamingKind: GAMING_KIND_LOW_ENTROPY_TOKEN,
                detail: {
                    totalLines,
                    entropy: density.tokenEntropy,
                    vocabularySize: density.vocabularySize ?? 0,
                },
            }),
        );
        return PENALTY_LOW_ENTROPY_TOKEN;
    }
    return 0.0;
}

/**
 * Inputs for the canonical anti-gaming conjunction.
 */
export interface AntiGamingConjunctionInput {
    /** Semantic (non-cosmetic) effective lines the change actually rewrote. */
    readonly changedEloc: number;
    /** Total effective lines of the audited surface, used as the ratio denominator. */
    readonly totalEloc: number;
    /** Net technical debt points removed by the change; zero or negative means none. */
    readonly netDebtEliminated: number;
    /** Accumulated pattern penalty from `detectScoreGaming`/`detectDiffScoreGaming`. */
    readonly gamingPenalty: number;
    /**
     * Whether the change claims a quality or efficiency gain (`ΔQ > 0`, `QED > 0`, or a raised
     * composite). Without this guard the conjunction would also fire on an ordinary small bug
     * fix, which never claims a score gain and must not be frozen as gaming.
     */
    readonly claimsScoreGain: boolean;
    /** Optional differential envelope verdict from diff-bounds-governor. */
    readonly differentialVerdict?: DifferentialBoundsVerdict;
    /** Optional Net Semantic Turnover (Δ_net) value. */
    readonly netSemanticTurnover?: number;
    /** Optional empirical admission threshold (Θ_admission). */
    readonly admissionThreshold?: number;
}

/**
 * Result of the canonical anti-gaming conjunction.
 */
export interface AntiGamingConjunctionVerdict {
    readonly isGaming: boolean;
    /** Canonical verdict code, present only when the conjunction fired. */
    readonly verdictCode?: typeof VERDICT_BLOCK_GAMING_DETECTED;
    /** Explicit reason, present only when the conjunction fired. */
    readonly reason?: string;
}

/**
 * Evaluates the canonical `BLOCK_GAMING_DETECTED` conjunction.
 *
 * The rule SSOT states the trigger as a strict mathematical conjunction — a trivial semantic
 * change ratio (`<= 15%`) **and** a non-positive net debt elimination. Previously that
 * conjunction existed only in the skill template while the production gate matched a message
 * substring, so the published contract and the enforced behaviour could drift apart. This
 * operator is that contract in code, and every gate routes through it.
 *
 * The `claimsScoreGain` guard keeps the conjunction aimed at its actual target: a change that
 * *claims* a quality gain while rewriting almost no semantics and clearing no debt. A genuinely
 * small bug fix trips the ratio and the debt condition as well, but claims nothing, so it is not
 * frozen.
 *
 * A pattern penalty from `detectScoreGaming` is a separate sufficient trigger: it means a
 * concrete gaming construct (tautological tests, trampoline padding, low-entropy water) was
 * found, which does not depend on how small the diff happened to be.
 *
 * @param input - Semantic change ratio inputs plus the accumulated pattern penalty.
 * @param config - Anti-gaming parameters; defaults to the scoring SSOT.
 * @returns Verdict indicating whether the change must be frozen.
 */
function checkSemanticRatioGaming(
    input: AntiGamingConjunctionInput,
    config: AntiGamingScoringConfig,
): AntiGamingConjunctionVerdict | null {
    const ratioMeasurable = Number.isFinite(input.changedEloc) && Number.isFinite(input.totalEloc);
    if (!ratioMeasurable || !input.claimsScoreGain) {
        return null;
    }

    const changed = Math.max(0, input.changedEloc);
    const total = Math.max(1, input.totalEloc);
    const semanticRatio = changed / total;
    const threshold = config.semanticChangeRatioThreshold;
    const netDebt = Number.isFinite(input.netDebtEliminated) ? input.netDebtEliminated : 0;

    if (semanticRatio <= threshold && netDebt <= 0) {
        return {
            isGaming: true,
            verdictCode: VERDICT_BLOCK_GAMING_DETECTED,
            reason:
                `Semantic change ratio ${(semanticRatio * 100).toFixed(2)}% is at or below ` +
                `${(threshold * 100).toFixed(2)}% with no net debt eliminated ` +
                `(${netDebt.toFixed(2)} points) while claiming a score gain.`,
        };
    }
    return null;
}

function checkDifferentialBoundsGaming(
    input: AntiGamingConjunctionInput,
): AntiGamingConjunctionVerdict | null {
    if (input.differentialVerdict && !input.differentialVerdict.isAllowed) {
        return {
            isGaming: true,
            verdictCode: VERDICT_BLOCK_GAMING_DETECTED,
            reason: input.differentialVerdict.reason ?? 'Differential bounds envelope violated.',
        };
    }
    return null;
}

function checkAdmissionTurnoverGaming(
    input: AntiGamingConjunctionInput,
): AntiGamingConjunctionVerdict | null {
    if (
        Number.isFinite(input.netSemanticTurnover) &&
        Number.isFinite(input.admissionThreshold) &&
        input.claimsScoreGain &&
        (input.netSemanticTurnover as number) < (input.admissionThreshold as number)
    ) {
        return {
            isGaming: true,
            verdictCode: VERDICT_BLOCK_GAMING_DETECTED,
            reason:
                `Net semantic turnover ${(input.netSemanticTurnover as number).toFixed(2)} ` +
                `is below empirical admission threshold ${(input.admissionThreshold as number).toFixed(2)} ` +
                `while claiming a score gain.`,
        };
    }
    return null;
}

function checkPatternPenaltyGaming(
    input: AntiGamingConjunctionInput,
): AntiGamingConjunctionVerdict | null {
    if (Number.isFinite(input.gamingPenalty) && (input.gamingPenalty as number) > 0) {
        return {
            isGaming: true,
            verdictCode: VERDICT_BLOCK_GAMING_DETECTED,
            reason: `Gaming pattern penalty of ${input.gamingPenalty} points was raised.`,
        };
    }
    return null;
}

export function evaluateAntiGamingConjunction(
    input: AntiGamingConjunctionInput,
    config: AntiGamingScoringConfig = DEFAULT_SCORING_CONFIG.antiGaming,
): AntiGamingConjunctionVerdict {
    const ratioVerdict = checkSemanticRatioGaming(input, config);
    if (ratioVerdict) return ratioVerdict;

    const diffVerdict = checkDifferentialBoundsGaming(input);
    if (diffVerdict) return diffVerdict;

    const turnoverVerdict = checkAdmissionTurnoverGaming(input);
    if (turnoverVerdict) return turnoverVerdict;

    const patternVerdict = checkPatternPenaltyGaming(input);
    if (patternVerdict) return patternVerdict;

    return { isGaming: false };
}

/**
 * Evaluates whether source code exhibits artificial score-gaming patterns.
 *
 * @param filePath - Physical path to the source file under evaluation.
 * @param content - Text content of the source file.
 * @returns Anti-gaming analysis result including penalty and identified issues.
 */
export function detectScoreGaming(filePath: string, content: string): AntiGamingResult {
    const issues: Issue[] = [];
    const gamingKinds: GamingPatternKind[] = [];
    const density = computeEffectiveCodeDensity(content);

    const splitPenalty = checkArtificialSplitting(filePath, density, issues, gamingKinds);
    const testPenalty = checkTautologicalTestPadding(filePath, content, issues, gamingKinds);
    const commentPenalty = checkTautologicalCommentPadding(filePath, content, issues, gamingKinds);
    const entropyPenalty = checkNamingEntropyAnomaly(filePath, content, issues, gamingKinds);
    const traversalPenalty = checkTautologicalPadding(filePath, content, issues, gamingKinds);
    const lowEntropyTokenPenalty = checkLowEntropyTokenPadding(
        filePath,
        density,
        issues,
        gamingKinds,
    );

    const gamingPenalty =
        splitPenalty +
        testPenalty +
        commentPenalty +
        entropyPenalty +
        traversalPenalty +
        lowEntropyTokenPenalty;

    return buildAntiGamingResult(issues, gamingKinds, gamingPenalty);
}

/**
 * Evaluates whether a code diff exhibits artificial score-gaming patterns.
 *
 * @param filePath - Physical path to the source file under evaluation.
 * @param beforeContent - Text content before the change.
 * @param afterContent - Text content after the change.
 * @returns Anti-gaming analysis result for the diff.
 */
export function detectDiffScoreGaming(
    filePath: string,
    beforeContent: string,
    afterContent: string,
): AntiGamingResult {
    const issues: Issue[] = [];
    const gamingKinds: GamingPatternKind[] = [];

    const snapshotGaming = detectScoreGaming(filePath, afterContent);
    issues.push(...snapshotGaming.issues);
    gamingKinds.push(...snapshotGaming.gamingKinds);

    const relocationPenalty = checkRelocationPadding({
        filePath,
        beforeContent,
        afterContent,
        issues,
        gamingKinds,
    });
    const gamingPenalty = snapshotGaming.gamingPenalty + relocationPenalty;

    return buildAntiGamingResult(issues, gamingKinds, gamingPenalty);
}
