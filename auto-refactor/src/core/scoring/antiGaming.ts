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
import { computeEffectiveCodeDensity } from './effectiveDensity';
import { evaluateNetCognitiveCost } from './cognitive-cost-model';
import {
    extractConstantEntities,
    analyzeConstantTransitions,
} from '../diff/constant-relocation-detector';

import { evaluateEffectiveCommentDensity } from '../comments/comment-density-model';
import { calculateShannonEntropy } from './modernization-formulas';
import { tokenizeCode, calculateTokenShannonEntropy } from '../intelligence/token-entropy';

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

const LOW_ENTROPY_MIN_LINES = 300;
const LOW_ENTROPY_SHANNON_THRESHOLD = 2.5;
const PENALTY_LOW_ENTROPY_TOKEN = 25.0;

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
    content: string,
    issues: Issue[],
    gamingKinds: GamingPatternKind[],
): number {
    const density = computeEffectiveCodeDensity(content);
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
    if (density.forwardingCount >= FORWARDING_SPLIT_THRESHOLD && density.effectiveDensity < DENSITY_SPLIT_THRESHOLD) {
        gamingKinds.push(GAMING_KIND_ARTIFICIAL_SPLITTING);
        issues.push(
            createGamingIssue({
                filePath,
                idSuffix: ID_SUFFIX_DEFAULT,
                message:
                    `Anti-gaming violation: detected artificial function splitting with ` +
                    `${density.forwardingCount} trivial forwarding methods (density: ${density.effectiveDensity}).`,
                suggestion:
                    'Avoid mechanically chopping cohesive logic into trivial forwarding wrappers; focus on domain cohesion.',
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
                message:
                    `Anti-gaming violation: detected ${count} tautological non-verifying assertions ` +
                    `inflating test coverage artificially.`,
                suggestion:
                    'Replace tautological assertions with real behavioral input/output assertions.',
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
                message:
                    `Anti-gaming violation: detected artificial relocation padding with ` +
                    `${analysis.relocatedCount} constants moved across lines without functional or semantic changes.`,
                suggestion:
                    'Do not artificially move constants to inflate diff volume; pure relocations earn zero positive quality score.',
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
                message: `Detected tautological comment padding or water-logging (ECR: ${metrics.effectiveCommentRatio}).`,
                suggestion:
                    'Replace tautological line-by-line echoes with substantive design rationale and invariants.',
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
    const names = varMatches.map((m) => m.replace(RE_VAR_KEYWORD_PREFIX, ''));
    const concatenated = names.join('');
    const entropy = calculateShannonEntropy(concatenated);
    const isDegenerate = names.filter((n) => RE_DEGENERATE_IDENTIFIER.test(n)).length >= ENTROPY_CONFIG.degenerateThreshold;
    if ((entropy < ENTROPY_CONFIG.degenerateBound && isDegenerate) || entropy < ENTROPY_CONFIG.lowBound) {
        gamingKinds.push(GAMING_KIND_NAMING_ENTROPY);
        issues.push(
            createGamingIssue({
                filePath,
                idSuffix: ID_SUFFIX_DEFAULT,
                message: `Anti-gaming violation: detected low-entropy identifier sequence (entropy: ${entropy} bits/char).`,
                suggestion:
                    'Use meaningful semantic domain variable names instead of synthetic sequenced identifiers.',
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
                message:
                    `Anti-gaming violation: detected ${count} tautological empty traversal loops ` +
                    `inflating iteration volume without state change.`,
                suggestion:
                    'Remove vacuous empty traversal loops; loops must mutate domain state or execute purposeful side-effects.',
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
    content: string,
    issues: Issue[],
    gamingKinds: GamingPatternKind[],
): number {
    const totalLines = content.split(/\r?\n/).length;
    if (totalLines < LOW_ENTROPY_MIN_LINES) {
        return 0.0;
    }

    const tokenStream = tokenizeCode(content);
    if (tokenStream.rawTokens.length === 0) {
        return 0.0;
    }

    const entropyResult = calculateTokenShannonEntropy(tokenStream.rawTokens);
    if (entropyResult.entropy < LOW_ENTROPY_SHANNON_THRESHOLD) {
        gamingKinds.push(GAMING_KIND_LOW_ENTROPY_TOKEN);
        issues.push(
            createGamingIssue({
                filePath,
                idSuffix: ID_SUFFIX_LOW_ENTROPY,
                message:
                    `Anti-gaming violation: detected low-entropy token padding in large file ` +
                    `(${totalLines} lines, H(T) = ${entropyResult.entropy} < 2.5 bits).`,
                suggestion:
                    'Avoid inflating file volume with low-entropy repetitive tokens or repetitive dictionary definitions.',
                gamingKind: GAMING_KIND_LOW_ENTROPY_TOKEN,
                detail: {
                    totalLines,
                    entropy: entropyResult.entropy,
                    vocabularySize: entropyResult.vocabularySize,
                },
            }),
        );
        return PENALTY_LOW_ENTROPY_TOKEN;
    }
    return 0.0;
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

    const splitPenalty = checkArtificialSplitting(filePath, content, issues, gamingKinds);
    const testPenalty = checkTautologicalTestPadding(filePath, content, issues, gamingKinds);
    const commentPenalty = checkTautologicalCommentPadding(filePath, content, issues, gamingKinds);
    const entropyPenalty = checkNamingEntropyAnomaly(filePath, content, issues, gamingKinds);
    const traversalPenalty = checkTautologicalPadding(
        filePath,
        content,
        issues,
        gamingKinds,
    );
    const lowEntropyTokenPenalty = checkLowEntropyTokenPadding(
        filePath,
        content,
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
