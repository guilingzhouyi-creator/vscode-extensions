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
export type TestTopologyTrack = 'EXPLICIT_TEST_FILE' | 'EMBEDDED_TEST_ZONE' | 'PRODUCTION_CODE';

/**
 * Finding generated when test topology discipline or embedded contracts are breached.
 */
export interface TestTopologyFinding {
    readonly rule: typeof RULE_TST_TOP_001;
    readonly filePath: string;
    readonly line: number;
    readonly column: number;
    readonly severity: 'warning' | 'error';
    readonly reason:
        | 'cross_language_embedded_test_prohibited'
        | 'embedded_zone_not_tail_isolated'
        | 'embedded_test_unconditionally_compiled'
        | 'missing_agent_readable_intent';
    readonly message: string;
    readonly actionableProposal: {
        readonly action: 'extract_test_suite' | 'relocate_test_zone' | 'annotate_test_intent';
        readonly rule: typeof RULE_TST_TOP_001;
        readonly targetFile: string;
        readonly rationale: string;
    };
}

/**
 * Result of dual-track test topology evaluation.
 */
export interface DualTrackTestEvaluationResult {
    readonly filePath: string;
    readonly track: TestTopologyTrack;
    readonly language: string;
    readonly testTopologyScore: number; // 0 - 100
    readonly embeddedTestLines: number;
    readonly productionEffectiveLoc: number;
    readonly isCompliant: boolean;
    readonly findings: readonly TestTopologyFinding[];
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
        if (content.charCodeAt(i) === 10) {
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
        content.includes('#[cfg(test)]') ||
        content.includes('mod tests') ||
        content.includes('describe(') ||
        content.includes('it(') ||
        (ext === '.py' && content.includes('if __name__ == "__main__":'))
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
): DualTrackTestEvaluationResult {
    return {
        filePath,
        track: 'PRODUCTION_CODE',
        language: ext,
        testTopologyScore: 100,
        embeddedTestLines: 0,
        productionEffectiveLoc: productionLoc,
        isCompliant: true,
        findings: [],
    };
}

/**
 * Constructs a violation result for embedded tests in forbidden languages.
 */
function createProhibitedEmbeddedResult(
    filePath: string,
    content: string,
    ext: string,
    embeddedLines: number,
    productionLoc: number,
): DualTrackTestEvaluationResult {
    const lines = content.split(/\r\n|\n/);
    const testLineIdx = lines.findIndex(
        (l) => l.includes('describe(') || l.includes('test(') || l.includes('it('),
    );
    const lineNum = testLineIdx >= 0 ? testLineIdx + 1 : 1;

    const findings: TestTopologyFinding[] = [
        {
            rule: RULE_TST_TOP_001,
            filePath,
            line: lineNum,
            column: 1,
            severity: 'warning',
            reason: 'cross_language_embedded_test_prohibited',
            message:
                `Embedded test code domain prohibited in ${ext} production source file. ` +
                `Enforce explicit test file topology (e.g. create dedicated *.test.ts).`,
            actionableProposal: {
                action: 'extract_test_suite',
                rule: RULE_TST_TOP_001,
                targetFile: filePath,
                rationale:
                    `Extract embedded test assertions from '${filePath}' into an explicit ` +
                    `standalone test suite to maintain clean architectural boundaries.`,
            },
        },
    ];

    return {
        filePath,
        track: 'EMBEDDED_TEST_ZONE',
        language: ext,
        testTopologyScore: 40,
        embeddedTestLines: embeddedLines,
        productionEffectiveLoc: productionLoc,
        isCompliant: false,
        findings,
    };
}

/**
 * Checks whether embedded test zones are placed at the tail of the source file.
 */
function checkTailIsolation(
    filePath: string,
    segs: readonly SemanticZoneSegment[],
): TestTopologyFinding | null {
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
            return {
                rule: RULE_TST_TOP_001,
                filePath,
                line: segs[firstTestIdx].startLine,
                column: 1,
                severity: 'warning',
                reason: 'embedded_zone_not_tail_isolated',
                message:
                    `Embedded test zone is interleaved before production code. ` +
                    `Move embedded test zone to the end of the file.`,
                actionableProposal: {
                    action: 'relocate_test_zone',
                    rule: RULE_TST_TOP_001,
                    targetFile: filePath,
                    rationale:
                        `Relocate test block to file tail to maintain modern zone ` +
                        `partitioning discipline.`,
                },
            };
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
    evaluate(ctx: PermittedZoneContext): { penalty: number; finding: TestTopologyFinding | null };
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
                    return { penalty: 25, finding: tailFinding };
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
                ctx.content.includes('mod tests') &&
                !ctx.content.includes('#[cfg(test)]')
            ) {
                return {
                    penalty: 30,
                    finding: {
                        rule: RULE_TST_TOP_001,
                        filePath: ctx.filePath,
                        line: 1,
                        column: 1,
                        severity: 'error',
                        reason: 'embedded_test_unconditionally_compiled',
                        message:
                            `Rust embedded test module missing #[cfg(test)] conditional compilation ` +
                            `attribute; risks production binary code bleed.`,
                        actionableProposal: {
                            action: 'relocate_test_zone',
                            rule: RULE_TST_TOP_001,
                            targetFile: ctx.filePath,
                            rationale: `Add #[cfg(test)] attribute to isolate test suite from release builds.`,
                        },
                    },
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
                    penalty: 15,
                    finding: {
                        rule: RULE_TST_TOP_001,
                        filePath: ctx.filePath,
                        line: 1,
                        column: 1,
                        severity: 'warning',
                        reason: 'missing_agent_readable_intent',
                        message:
                            `Embedded unit tests lack structured doc comments (Case/Assertion), ` +
                            `inhibiting autonomous agent regression verification.`,
                        actionableProposal: {
                            action: 'annotate_test_intent',
                            rule: RULE_TST_TOP_001,
                            targetFile: ctx.filePath,
                            rationale: `Add doc comments with 'Case:' and 'Assertion:' for machine-readability.`,
                        },
                    },
                };
            }
            return { penalty: 0, finding: null };
        },
    },
];

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
    ): DualTrackTestEvaluationResult {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const ext = path.extname(normalizedPath).toLowerCase();
        const isExplicitTestFile = this.isExplicitTestPath(normalizedPath);

        // 1. First Track: Explicit Standalone Test Files
        if (isExplicitTestFile) {
            return this.evaluateExplicitTestFile(normalizedPath, content, ext);
        }

        // 2. Second Track: Production Files with possible Embedded Test Zones
        return this.evaluateProductionOrEmbeddedFile(normalizedPath, content, ext, zoneProfile);
    }

    private isExplicitTestPath(filePath: string): boolean {
        return (
            TS_JS_TEST_PATTERN.test(filePath) ||
            PY_TEST_PATTERN.test(filePath) ||
            GDSCRIPT_TEST_PATTERN.test(filePath) ||
            filePath.includes('/tests/') ||
            filePath.includes('/test/')
        );
    }

    private evaluateExplicitTestFile(
        filePath: string,
        _content: string,
        ext: string,
    ): DualTrackTestEvaluationResult {
        const findings: TestTopologyFinding[] = [];

        // Check for anti-pattern: test file placed directly in root without topology structure
        const segments = filePath.split('/').filter(Boolean);
        let topologyScore = 100;

        if (segments.length <= 1) {
            topologyScore -= 20;
        }

        return {
            filePath,
            track: 'EXPLICIT_TEST_FILE',
            language: ext,
            testTopologyScore: Math.max(0, topologyScore),
            embeddedTestLines: 0,
            productionEffectiveLoc: 0,
            isCompliant: findings.length === 0,
            findings,
        };
    }

    private evaluatePermittedZoneContracts(
        filePath: string,
        content: string,
        ext: string,
        zoneProfile: IntraFileZoneProfile | undefined,
        embeddedLines: number,
        productionLoc: number,
    ): DualTrackTestEvaluationResult {
        let zoneScore = 100;
        const findings: TestTopologyFinding[] = [];
        const ctx: PermittedZoneContext = { filePath, content, ext, zoneProfile };

        for (const rule of PERMITTED_ZONE_CONTRACTS) {
            const res = rule.evaluate(ctx);
            if (res.finding !== null) {
                zoneScore -= res.penalty;
                findings.push(res.finding);
            }
        }

        return {
            filePath,
            track: 'EMBEDDED_TEST_ZONE',
            language: ext,
            testTopologyScore: Math.max(0, zoneScore),
            embeddedTestLines: embeddedLines,
            productionEffectiveLoc: productionLoc,
            isCompliant: findings.length === 0,
            findings,
        };
    }

    private evaluateProductionOrEmbeddedFile(
        filePath: string,
        content: string,
        ext: string,
        zoneProfile?: IntraFileZoneProfile,
    ): DualTrackTestEvaluationResult {
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
            return createProhibitedEmbeddedResult(
                filePath,
                content,
                ext,
                embeddedLines,
                productionLoc,
            );
        }

        // Permitted languages governed by contract rules
        return this.evaluatePermittedZoneContracts(
            filePath,
            content,
            ext,
            zoneProfile,
            embeddedLines,
            productionLoc,
        );
    }

    private checkTailIsolation(
        filePath: string,
        segs: readonly SemanticZoneSegment[],
    ): TestTopologyFinding | null {
        return checkTailIsolation(filePath, segs);
    }
}
