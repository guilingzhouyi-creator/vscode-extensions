/**
 * Module: Core Scoring — Multi-Language Dual-Track Test Topology Evaluator
 * File Path: src/core/scoring/dual-track-test-evaluator.ts
 * Architecture Role: Evaluates multi-language test topologies across explicit standalone test
 *   suites vs modern embedded test zones, preventing cross-language paradigm corruption.
 * Dependencies & Triggers: Consumes IntraFileZoneProfile and ZONE_EMBEDDED_TEST from
 *   zone-partitioner.ts; invoked by test-modernity analyzer and quality scorers.
 * Responsibilities:
 *   1. Track A: Explicit Standalone Test Files (TS *.test.ts, Py tests/, GDScript tests/unit/).
 *   2. Track B: Embedded Test Code Zones (Rust #[cfg(test)] mod tests, Python doctests).
 *   3. Enforce 4 strict embedded test contracts: zone partitioning, zero build bleed,
 *      LOC decoupling, and agent-readable intent specifications.
 *   4. Enforce cross-language discipline (TST-TOP-001): prohibit embedded tests in TS/GDScript.
 * Exit Semantics & Design Rationale: Deterministic pure evaluation returning structured findings
 *   and scoring metrics with zero I/O; adheres to line width limits (<= 100 columns).
 */

import * as path from 'path';
import type { IntraFileZoneProfile, SemanticZoneSegment } from '../intelligence/zone-partitioner';
import { ZONE_EMBEDDED_TEST } from '../intelligence/zone-partitioner';
import { RULE_TST_TOP_001 } from './dimensionLiterals';

/** Categorization of code files into testing topology tracks. */
export type TestingTrack = 'EXPLICIT_TEST_FILE' | 'EMBEDDED_TEST_ZONE' | 'PRODUCTION_CODE';
/** Backward-compatible type alias for testing track category. */
export type TestTopologyTrack = TestingTrack;

const TRACK_PRODUCTION: TestingTrack = 'PRODUCTION_CODE';
const TRACK_EMBEDDED: TestingTrack = 'EMBEDDED_TEST_ZONE';
const TRACK_EXPLICIT: TestingTrack = 'EXPLICIT_TEST_FILE';

const SEVERITY_WARNING = 'warning';
const SEVERITY_ERROR = 'error';

const REASON_CROSS_LANG = 'cross_language_embedded_test_prohibited';
const REASON_NOT_TAIL = 'embedded_zone_not_tail_isolated';
const REASON_UNCONDITIONAL_BUILD = 'embedded_test_unconditionally_compiled';
const REASON_MISSING_INTENT = 'missing_agent_readable_intent';

const ACTION_EXTRACT_TEST_SUITE = 'extract_test_suite';
const ACTION_RELOCATE_TEST_ZONE = 'relocate_test_zone';
const ACTION_ANNOTATE_INTENT = 'annotate_test_intent';

const CHAR_CODE_LF = 10;
const PERFECT_SCORE = 100;
const PROHIBITED_BASE_SCORE = 40;
const PENALTY_NOT_TAIL = 25;
const PENALTY_UNCONDITIONAL_BUILD = 30;
const PENALTY_MISSING_INTENT = 15;
const PENALTY_ROOT_TEST = 20;

const MARKER_DESCRIBE = 'describe(';
const MARKER_TEST = 'test(';
const MARKER_IT = 'it(';
const MARKER_CFG_TEST = '#[cfg(test)]';
const MARKER_MOD_TESTS = 'mod tests';
const MARKER_PY_MAIN = 'if __name__ == "__main__":';

const PATH_TESTS_DIR = '/tests/';
const PATH_TEST_DIR = '/test/';

/** Remediation actions available to resolve test topology contract violations. */
export type TopologyAction = 'extract_test_suite' | 'relocate_test_zone' | 'annotate_test_intent';

/**
 * Remediation proposal specifying machine-actionable repair steps for test topology violations.
 */
export interface ActionableTestProposal {
    readonly action: TopologyAction;
    readonly rule: typeof RULE_TST_TOP_001;
    readonly targetFile: string;
    readonly rationale: string;
}

function createActionableProposal(
    action: TopologyAction,
    targetFile: string,
    rationale: string,
): ActionableTestProposal {
    return { action, rule: RULE_TST_TOP_001, targetFile, rationale };
}

/** Diagnostic failure reasons describing breached test topology contracts. */
export type TopologyViolationReason =
    | 'cross_language_embedded_test_prohibited'
    | 'embedded_zone_not_tail_isolated'
    | 'embedded_test_unconditionally_compiled'
    | 'missing_agent_readable_intent';

/**
 * Finding generated when test topology discipline or embedded contracts are breached.
 */
export interface TopologyFinding {
    readonly rule: typeof RULE_TST_TOP_001;
    readonly filePath: string;
    readonly line: number;
    readonly column: number;
    readonly severity: 'warning' | 'error';
    readonly reason: TopologyViolationReason;
    readonly message: string;
    readonly actionableProposal: ActionableTestProposal;
}

/** Backward-compatible type alias for finding consumer code. */
export type TestTopologyFinding = TopologyFinding;

interface FindingBuildParams {
    filePath: string;
    line?: number;
    column?: number;
    severity: 'warning' | 'error';
    reason: TopologyViolationReason;
    message: string;
    action: TopologyAction;
    rationale: string;
}

function createTopologyFinding(params: FindingBuildParams): TopologyFinding {
    return {
        rule: RULE_TST_TOP_001,
        filePath: params.filePath,
        line: params.line ?? 1,
        column: params.column ?? 1,
        severity: params.severity,
        reason: params.reason,
        message: params.message,
        actionableProposal: createActionableProposal(
            params.action,
            params.filePath,
            params.rationale,
        ),
    };
}

/**
 * Result of dual-track test topology evaluation.
 */
export interface DualTrackEvaluation {
    readonly filePath: string;
    readonly track: TestingTrack;
    readonly language: string;
    readonly testTopologyScore: number; // 0 - 100
    readonly embeddedTestLines: number;
    readonly productionEffectiveLoc: number;
    readonly isCompliant: boolean;
    readonly findings: readonly TopologyFinding[];
}

interface EvaluationResultParams {
    filePath: string;
    track: TestingTrack;
    language: string;
    score: number;
    lineCount: number;
    productionLoc: number;
    findings?: readonly TopologyFinding[];
}

function buildEvaluationResult(params: EvaluationResultParams): DualTrackEvaluation {
    const findings = params.findings ?? [];
    return {
        filePath: params.filePath,
        track: params.track,
        language: params.language,
        testTopologyScore: Math.max(0, params.score),
        embeddedTestLines: params.lineCount,
        productionEffectiveLoc: params.productionLoc,
        isCompliant: findings.length === 0,
        findings,
    };
}

const TS_JS_TEST_PATTERN = /\.(?:test|spec)\.[jt]sx?$/i;
const PY_TEST_PATTERN = /(?:^|\/|\\)test_.*\.py$|.*_test\.py$/i;
const GDSCRIPT_TEST_PATTERN = /(?:^|\/|\\)tests?\/.*\.gd$/i;

/** Languages permitted to house embedded unit test zones in production source files. */
const PERMITTED_EMBEDDED_LANGUAGES = new Set(['.rs', '.py']);

/**
 * Fast newline counter to compute line count without regex or array allocations.
 */
function countContentLines(content: string): number {
    if (content.length === 0) {
        return 1;
    }
    let count = 1;
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === CHAR_CODE_LF) {
            count++;
        }
    }
    return count;
}

/**
 * Detects presence of embedded test markers across known language conventions.
 */
function hasEmbeddedMarkers(content: string, ext: string): boolean {
    return (
        content.includes(MARKER_CFG_TEST) ||
        content.includes(MARKER_MOD_TESTS) ||
        content.includes(MARKER_DESCRIBE) ||
        content.includes(MARKER_IT) ||
        (ext === '.py' && content.includes(MARKER_PY_MAIN))
    );
}

/**
 * Checks whether the source file is pure production code with no embedded tests.
 */
function isPureProductionCode(content: string, ext: string, embeddedLines: number): boolean {
    return !hasEmbeddedMarkers(content, ext) && embeddedLines === 0;
}

/**
 * Constructs a compliant production code topology result.
 */
function createPureProductionResult(
    filePath: string,
    ext: string,
    productionLoc: number,
): DualTrackEvaluation {
    return buildEvaluationResult({
        filePath,
        track: TRACK_PRODUCTION,
        language: ext,
        score: PERFECT_SCORE,
        lineCount: 0,
        productionLoc,
    });
}

interface ProhibitedResultParams {
    filePath: string;
    content: string;
    ext: string;
    lineCount: number;
    productionLoc: number;
}

/**
 * Constructs a violation result for embedded tests in forbidden languages.
 */
function createProhibitedEmbeddedResult(params: ProhibitedResultParams): DualTrackEvaluation {
    const { filePath, content, ext, lineCount, productionLoc } = params;
    const lines = content.split(/\r\n|\n/);
    const testLineIdx = lines.findIndex(
        (l) => l.includes(MARKER_DESCRIBE) || l.includes(MARKER_TEST) || l.includes(MARKER_IT),
    );
    const lineNum = testLineIdx >= 0 ? testLineIdx + 1 : 1;

    const findings: TopologyFinding[] = [
        createTopologyFinding({
            filePath,
            line: lineNum,
            column: 1,
            severity: SEVERITY_WARNING,
            reason: REASON_CROSS_LANG,
            message:
                `Embedded test code domain prohibited in ${ext} production source file. ` +
                `Enforce explicit test file topology (e.g. create dedicated *.test.ts).`,
            action: ACTION_EXTRACT_TEST_SUITE,
            rationale:
                `Extract embedded test assertions from '${filePath}' into an explicit ` +
                `standalone test suite to maintain clean architectural boundaries.`,
        }),
    ];

    return buildEvaluationResult({
        filePath,
        track: TRACK_EMBEDDED,
        language: ext,
        score: PROHIBITED_BASE_SCORE,
        lineCount,
        productionLoc,
        findings,
    });
}

/**
 * Checks whether embedded test zones are placed at the tail of the source file.
 */
function checkTailIsolation(
    filePath: string,
    segs: readonly SemanticZoneSegment[],
): TopologyFinding | null {
    let firstTestIdx = -1;
    for (let i = 0; i < segs.length; i++) {
        if (segs[i].zone === ZONE_EMBEDDED_TEST) {
            firstTestIdx = i;
            break;
        }
    }
    if (firstTestIdx < 0) {
        return null;
    }

    for (let i = firstTestIdx + 1; i < segs.length; i++) {
        if (segs[i].zone !== ZONE_EMBEDDED_TEST) {
            return createTopologyFinding({
                filePath,
                line: segs[firstTestIdx].startLine,
                column: 1,
                severity: SEVERITY_WARNING,
                reason: REASON_NOT_TAIL,
                message:
                    `Embedded test zone is interleaved before production code. ` +
                    `Move embedded test zone to the end of the file.`,
                action: ACTION_RELOCATE_TEST_ZONE,
                rationale:
                    `Relocate test block to file tail to maintain modern zone ` +
                    `partitioning discipline.`,
            });
        }
    }
    return null;
}

interface PermittedZoneContext {
    readonly filePath: string;
    readonly content: string;
    readonly ext: string;
    readonly zoneProfile?: IntraFileZoneProfile;
}

interface PermittedZoneContractRule {
    evaluate(ctx: PermittedZoneContext): { penalty: number; finding: TopologyFinding | null };
}

/**
 * Permitted embedded zone contracts evaluated against modern testing discipline.
 */
const PERMITTED_ZONE_CONTRACTS: readonly PermittedZoneContractRule[] = [
    // Contract 1: Zone Partitioning — Embedded tests must be tail-isolated
    {
        evaluate: (ctx) => {
            if (ctx.zoneProfile && ctx.zoneProfile.segments.length > 0) {
                const tailFinding = checkTailIsolation(ctx.filePath, ctx.zoneProfile.segments);
                if (tailFinding !== null) {
                    return { penalty: PENALTY_NOT_TAIL, finding: tailFinding };
                }
            }
            return { penalty: 0, finding: null };
        },
    },
    // Contract 2: Zero Production Bleed — Rust tests must have #[cfg(test)]
    {
        evaluate: (ctx) => {
            if (
                ctx.ext === '.rs' &&
                ctx.content.includes(MARKER_MOD_TESTS) &&
                !ctx.content.includes(MARKER_CFG_TEST)
            ) {
                return {
                    penalty: PENALTY_UNCONDITIONAL_BUILD,
                    finding: createTopologyFinding({
                        filePath: ctx.filePath,
                        severity: SEVERITY_ERROR,
                        reason: REASON_UNCONDITIONAL_BUILD,
                        message:
                            `Rust embedded test module missing #[cfg(test)] conditional compilation ` +
                            `attribute; risks production binary code bleed.`,
                        action: ACTION_RELOCATE_TEST_ZONE,
                        rationale: `Add #[cfg(test)] attribute to isolate test suite from release builds.`,
                    }),
                };
            }
            return { penalty: 0, finding: null };
        },
    },
    // Contract 3 & 4: Agent-Readable Intent Specification
    {
        evaluate: (ctx) => {
            if (ctx.zoneProfile && ctx.zoneProfile.embeddedTestIntentAnnotatedRatio < 0.5) {
                return {
                    penalty: PENALTY_MISSING_INTENT,
                    finding: createTopologyFinding({
                        filePath: ctx.filePath,
                        severity: SEVERITY_WARNING,
                        reason: REASON_MISSING_INTENT,
                        message:
                            `Embedded unit tests lack structured doc comments (Case/Assertion), ` +
                            `inhibiting autonomous agent regression verification.`,
                        action: ACTION_ANNOTATE_INTENT,
                        rationale: `Add doc comments with 'Case:' and 'Assertion:' for machine-readability.`,
                    }),
                };
            }
            return { penalty: 0, finding: null };
        },
    },
];

interface PermittedZoneParams {
    filePath: string;
    content: string;
    ext: string;
    zoneProfile?: IntraFileZoneProfile;
    lineCount: number;
    productionLoc: number;
}

/**
 * Multi-Language Dual-Track Test Topology Evaluator.
 */
export class DualTrackTestEvaluator {
    /**
     * Evaluate a source file against dual-track test topology contracts.
     */
    public evaluateFile(
        filePath: string,
        content: string,
        zoneProfile?: IntraFileZoneProfile,
    ): DualTrackEvaluation {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const ext = path.extname(normalizedPath).toLowerCase();
        const isExplicitTestFile = this.isExplicitTestPath(normalizedPath);

        // 1. First Track: Explicit Standalone Test Files
        if (isExplicitTestFile) {
            return this.evaluateExplicitTestFile(normalizedPath, content, ext);
        }

        // 2. Second Track: Production Files with possible Embedded Test Zones
        return this.evaluateSourceTopology(normalizedPath, content, ext, zoneProfile);
    }

    private isExplicitTestPath(filePath: string): boolean {
        return (
            TS_JS_TEST_PATTERN.test(filePath) ||
            PY_TEST_PATTERN.test(filePath) ||
            GDSCRIPT_TEST_PATTERN.test(filePath) ||
            filePath.includes(PATH_TESTS_DIR) ||
            filePath.includes(PATH_TEST_DIR)
        );
    }

    private evaluateExplicitTestFile(
        filePath: string,
        _content: string,
        ext: string,
    ): DualTrackEvaluation {
        const findings: TopologyFinding[] = [];
        const segments = filePath.split('/').filter(Boolean);
        let topologyScore = PERFECT_SCORE;

        if (segments.length <= 1) {
            topologyScore -= PENALTY_ROOT_TEST;
        }

        return buildEvaluationResult({
            filePath,
            track: TRACK_EXPLICIT,
            language: ext,
            score: topologyScore,
            lineCount: 0,
            productionLoc: 0,
            findings,
        });
    }

    private evaluatePermittedZoneContracts(params: PermittedZoneParams): DualTrackEvaluation {
        let zoneScore = PERFECT_SCORE;
        const findings: TopologyFinding[] = [];
        const ctx: PermittedZoneContext = {
            filePath: params.filePath,
            content: params.content,
            ext: params.ext,
            zoneProfile: params.zoneProfile,
        };

        for (const rule of PERMITTED_ZONE_CONTRACTS) {
            const evalResult = rule.evaluate(ctx);
            if (evalResult.finding !== null) {
                zoneScore -= evalResult.penalty;
                findings.push(evalResult.finding);
            }
        }

        return buildEvaluationResult({
            filePath: params.filePath,
            track: TRACK_EMBEDDED,
            language: params.ext,
            score: zoneScore,
            lineCount: params.lineCount,
            productionLoc: params.productionLoc,
            findings,
        });
    }

    private evaluateSourceTopology(
        filePath: string,
        content: string,
        ext: string,
        zoneProfile?: IntraFileZoneProfile,
    ): DualTrackEvaluation {
        const embeddedLines = zoneProfile ? zoneProfile.embeddedTestLines : 0;
        const productionLoc = zoneProfile
            ? zoneProfile.productionEffectiveLoc
            : countContentLines(content);

        // Guard 1: Pure production code
        if (isPureProductionCode(content, ext, embeddedLines)) {
            return createPureProductionResult(filePath, ext, productionLoc);
        }

        // Guard 2: Prohibited embedded test languages
        if (!PERMITTED_EMBEDDED_LANGUAGES.has(ext)) {
            return createProhibitedEmbeddedResult({
                filePath,
                content,
                ext,
                lineCount: embeddedLines,
                productionLoc,
            });
        }

        // Permitted languages governed by contract rules
        return this.evaluatePermittedZoneContracts({
            filePath,
            content,
            ext,
            zoneProfile,
            lineCount: embeddedLines,
            productionLoc,
        });
    }

    private checkTailIsolation(
        filePath: string,
        segs: readonly SemanticZoneSegment[],
    ): TopologyFinding | null {
        return checkTailIsolation(filePath, segs);
    }
}
