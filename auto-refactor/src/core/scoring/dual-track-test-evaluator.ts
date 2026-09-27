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
import type { IntraFileZoneProfile } from '../intelligence/zone-partitioner';
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

    private evaluateProductionOrEmbeddedFile(
        filePath: string,
        content: string,
        ext: string,
        zoneProfile?: IntraFileZoneProfile,
    ): DualTrackTestEvaluationResult {
        const findings: TestTopologyFinding[] = [];
        const lines = content.split(/\r\n|\n/);

        const hasEmbeddedMarker =
            content.includes('#[cfg(test)]') ||
            content.includes('mod tests') ||
            content.includes('describe(') ||
            content.includes('it(') ||
            (ext === '.py' && content.includes('if __name__ == "__main__":'));

        const embeddedLines = zoneProfile ? zoneProfile.embeddedTestLines : 0;
        const productionLoc = zoneProfile ? zoneProfile.productionEffectiveLoc : lines.length;

        // No embedded tests present
        if (!hasEmbeddedMarker && embeddedLines === 0) {
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

        // Embedded tests detected! Check cross-language discipline (TST-TOP-001)
        if (!PERMITTED_EMBEDDED_LANGUAGES.has(ext)) {
            // TypeScript/JavaScript/GDScript: embedded test in production is forbidden!
            const testLineIdx = lines.findIndex(
                (l) => l.includes('describe(') || l.includes('test(') || l.includes('it('),
            );
            const lineNum = testLineIdx >= 0 ? testLineIdx + 1 : 1;

            findings.push({
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
            });

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

        // Permitted embedded language (Rust / Python): Check the 4 modern contracts
        let zoneScore = 100;

        // Contract 1: Zone Partitioning — Embedded tests must be tail-isolated
        if (zoneProfile && zoneProfile.segments.length > 0) {
            const segs = zoneProfile.segments;
            const testIdx = segs.findIndex((s) => s.zone === ZONE_EMBEDDED_TEST);
            if (testIdx >= 0 && testIdx < segs.length - 1) {
                // There is production code after the test block!
                zoneScore -= 25;
                findings.push({
                    rule: RULE_TST_TOP_001,
                    filePath,
                    line: segs[testIdx].startLine,
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
                });
            }
        }

        // Contract 2: Zero Production Bleed — Rust tests must have #[cfg(test)]
        if (ext === '.rs' && content.includes('mod tests') && !content.includes('#[cfg(test)]')) {
            zoneScore -= 30;
            findings.push({
                rule: RULE_TST_TOP_001,
                filePath,
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
                    targetFile: filePath,
                    rationale: `Add #[cfg(test)] attribute to isolate test suite from release builds.`,
                },
            });
        }

        // Contract 3 & 4: Agent-Readable Intent Specification
        if (zoneProfile && zoneProfile.embeddedTestIntentAnnotatedRatio < 0.5) {
            zoneScore -= 15;
            findings.push({
                rule: RULE_TST_TOP_001,
                filePath,
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
                    targetFile: filePath,
                    rationale: `Add doc comments with 'Case:' and 'Assertion:' for machine-readability.`,
                },
            });
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
}
