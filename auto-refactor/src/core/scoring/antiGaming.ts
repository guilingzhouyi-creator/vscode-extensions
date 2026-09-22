/**
 * Module: Core Scoring — Anti-Gaming Detector
 * File Path: src/core/scoring/antiGaming.ts
 * Architecture Role: Detects score-gaming behaviors including artificial function splitting,
 *   empty forwarding wrappers, tautological test padding, and spurious interfaces.
 * Dependencies & Triggers: Consumes computeEffectiveCodeDensity from ./effectiveDensity,
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

/**
 * Rule identifier for anti-gaming detection.
 */
export const RULE_GOV_GAM_001 = 'GOV-GAM-001';

/**
 * Legacy/common alias for GOV-GAM-001.
 */
export const ALIAS_SCORE_GAMING_001 = RULE_GOV_GAM_001;

/**
 * Kinds of score gaming recognized.
 */
export type GamingPatternKind =
    | 'artificial_function_splitting'
    | 'tautological_test_padding'
    | 'spurious_empty_interface'
    | 'artificial_relocation_padding';

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
    if (density.forwardingCount >= 3) {
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
    if (density.forwardingCount >= 5 && density.effectiveDensity < 0.65) {
        gamingKinds.push('artificial_function_splitting');
        issues.push({
            id: `governance:${RULE_GOV_GAM_001}:${filePath}:1`,
            analyzer: 'governance',
            rule: RULE_GOV_GAM_001,
            severity: 'warning',
            message:
                `Anti-gaming violation: detected artificial function splitting with ` +
                `${density.forwardingCount} trivial forwarding methods (density: ${density.effectiveDensity}).`,
            location: {
                file: filePath,
                start: { line: 1, column: 1 },
                end: { line: 1, column: 80 },
            },
            detail: {
                gamingType: 'artificial_function_splitting',
                forwardingCount: density.forwardingCount,
                effectiveDensity: density.effectiveDensity,
                totalLoc: density.totalLoc,
            },
            suggestion:
                'Avoid mechanically chopping cohesive logic into trivial forwarding wrappers; focus on domain cohesion.',
        });
        return 15.0;
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

    const tautologyMatches = content.match(
        /(?:expect\(true\)\.toBe\(true\)|assert\s+1\s*==\s*1|assert\(true\)|expect\(1\)\.toBe\(1\))/g,
    );
    const count = tautologyMatches ? tautologyMatches.length : 0;
    if (count >= 3) {
        gamingKinds.push('tautological_test_padding');
        issues.push({
            id: `governance:${RULE_GOV_GAM_001}:${filePath}:tautology`,
            analyzer: 'governance',
            rule: RULE_GOV_GAM_001,
            severity: 'warning',
            message:
                `Anti-gaming violation: detected ${count} tautological non-verifying assertions ` +
                `inflating test coverage artificially.`,
            location: {
                file: filePath,
                start: { line: 1, column: 1 },
                end: { line: 1, column: 80 },
            },
            detail: {
                gamingType: 'tautological_test_padding',
                tautologyCount: count,
            },
            suggestion:
                'Replace tautological assertions with real behavioral input/output assertions.',
        });
        return 20.0;
    }
    return 0.0;
}

const RELOCATION_PADDING_MIN_COUNT = 4;
const RELOCATION_PADDING_PENALTY = 15.0;
const GAMING_KIND_RELOCATION_PADDING: GamingPatternKind = 'artificial_relocation_padding';
const ANALYZER_GOVERNANCE = 'governance';
const SEVERITY_WARNING = 'warning';
const DEFAULT_LINE_END_COLUMN = 80;

/**
 * Detects artificial relocation padding where constants are moved around
 * merely to inflate diff line counts.
 */
function checkRelocationPadding(
    filePath: string,
    beforeContent: string,
    afterContent: string,
    issues: Issue[],
    gamingKinds: GamingPatternKind[],
): number {
    const beforeEntities = extractConstantEntities(beforeContent, filePath);
    const afterEntities = extractConstantEntities(afterContent, filePath);
    const analysis = analyzeConstantTransitions(beforeEntities, afterEntities);

    if (
        analysis.hasPureRelocationsOnly &&
        analysis.relocatedCount >= RELOCATION_PADDING_MIN_COUNT
    ) {
        gamingKinds.push(GAMING_KIND_RELOCATION_PADDING);
        issues.push({
            id: `${ANALYZER_GOVERNANCE}:${RULE_GOV_GAM_001}:${filePath}:relocation`,
            analyzer: ANALYZER_GOVERNANCE,
            rule: RULE_GOV_GAM_001,
            severity: SEVERITY_WARNING,
            message:
                `Anti-gaming violation: detected artificial relocation padding with ` +
                `${analysis.relocatedCount} constants moved across lines without functional or semantic changes.`,
            location: {
                file: filePath,
                start: { line: 1, column: 1 },
                end: { line: 1, column: DEFAULT_LINE_END_COLUMN },
            },
            detail: {
                gamingType: GAMING_KIND_RELOCATION_PADDING,
                relocatedCount: analysis.relocatedCount,
            },
            suggestion:
                'Do not artificially move constants to inflate diff volume; pure relocations earn zero positive quality score.',
        });
        return RELOCATION_PADDING_PENALTY;
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
    const gamingPenalty = splitPenalty + testPenalty;

    return {
        hasGaming: issues.length > 0,
        issues,
        gamingKinds,
        gamingPenalty,
    };
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

    const relocationPenalty = checkRelocationPadding(
        filePath,
        beforeContent,
        afterContent,
        issues,
        gamingKinds,
    );
    const gamingPenalty = snapshotGaming.gamingPenalty + relocationPenalty;

    return {
        hasGaming: issues.length > 0,
        issues,
        gamingKinds,
        gamingPenalty,
    };
}
