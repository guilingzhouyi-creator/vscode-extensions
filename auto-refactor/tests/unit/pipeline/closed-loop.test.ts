/**
 * Module: Unit Test Suite — Review Queue, Fix Outcomes and Confidence-Gated Rework
 * File Path: tests/unit/pipeline/closed-loop.test.ts
 * Architecture Role: Pins the three closed-loop contracts added on top of adjudication: which
 *   findings reach a human, what counts as a resolved finding across audits, and which bounded
 *   findings earn a second look. Each of the three has an obvious wrong implementation that still
 *   looks correct in a report — a queue that includes mechanically fixable work, a fix history
 *   that records persistence as a fix, a rework pass that re-runs the identical scan — so the
 *   tests state those wrong outcomes explicitly as negative controls.
 * Dependencies & Triggers: Consumes review-queue.ts, fix-outcome-tracker.ts and
 *   confidence-rework.ts; run by vitest in `npm test`.
 * Responsibilities:
 *   1. Assert queue category precedence, exclusions and byte-stable ordering.
 *   2. Assert fix-outcome derivation ignores line shifts and bounds the history.
 *   3. Assert rework planning, strategy selection, reconciliation and refutation dropping.
 * Exit Semantics & Design Rationale: Deterministic and I/O-free apart from one temp-file round
 *   trip; no clock reads and no RNG, so a failure always means a contract moved.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Issue } from '../../../src/core/types';
import type { ArbitratedFinding } from '../../../src/core/scoring/finding-confidence-arbiter';
import {
    QUEUE_ADVISORY,
    QUEUE_NEEDS_HUMAN,
    QUEUE_RUNTIME_EVIDENCE,
    QUEUE_UNCALIBRATED,
    buildReviewQueue,
    categorizeForReview,
    countNeedsHuman,
    serializeReviewQueue,
    writeReviewQueue,
} from '../../../src/core/reporting/review-queue';
import {
    MAX_FIX_RESULTS_PER_FILE,
    deriveResolvedRules,
    reconcileFixResults,
} from '../../../src/core/memory/fix-outcome-tracker';
import type { ReviewMemoryRecord } from '../../../src/core/memory/types';
import {
    REWORK_DEFER_EXTERNAL_EVIDENCE,
    REWORK_DEEPEN_AST,
    REWORK_SWAP_ANALYZER_SET,
    REWORK_WIDEN_CONTEXT,
    VERDICT_CONFIRMED,
    VERDICT_REFUTED,
    buildInvalidationEvents,
    collectReworkAnalyzers,
    dropRefutedFindings,
    expandWindow,
    hasLocalRework,
    planRework,
    reconcileRework,
    resolveIssueConfidence,
    summarizeRework,
} from '../../../src/core/pipeline/confidence-rework';

const TEMP_DIRS: string[] = [];

afterEach(() => {
    for (const dir of TEMP_DIRS.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

/**
 * Builds a minimal issue.
 *
 * @param overrides - Fields to override on the default record.
 * @returns Issue with a deterministic identity.
 */
function createIssue(overrides: Partial<Issue> = {}): Issue {
    return {
        id: 'constants:magic-number:src/a.ts:1',
        analyzer: 'constants',
        rule: 'magic-number',
        severity: 'warning',
        message: 'Magic number 42',
        location: { file: 'src/a.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 9 } },
        detail: {},
        ...overrides,
    };
}

/**
 * Builds an issue at a specific file and line.
 *
 * @param file - File path.
 * @param line - 1-based line number.
 * @returns Issue positioned at that location.
 */
function issueAt(file: string, line: number): Issue {
    return createIssue({
        location: { file, start: { line, column: 1 }, end: { line, column: 5 } },
    });
}

/**
 * Builds an arbitrated finding with sensible defaults.
 *
 * @param overrides - Fields to override on the default record.
 * @returns Arbitrated finding suitable for queue projection.
 */
function createFinding(overrides: Partial<ArbitratedFinding> = {}): ArbitratedFinding {
    return {
        issue: createIssue(),
        tier: 'advisory',
        confidence: 0.75,
        confidenceSource: 'uncalibrated',
        calibrationSampleSize: 0,
        mustBlock: false,
        isSuppressed: false,
        isPrunedBySlice: false,
        rationale: 'default rationale',
        ...overrides,
    };
}

describe('review queue categorisation', () => {
    it('never queues a blocking finding', () => {
        expect(categorizeForReview(createFinding({ mustBlock: true }))).toBeUndefined();
    });

    it('never queues a suppressed finding', () => {
        expect(categorizeForReview(createFinding({ isSuppressed: true }))).toBeUndefined();
    });

    it('never queues a finding the arbiter promoted to actionable', () => {
        const finding = createFinding({
            tier: 'actionable',
            executablePatch: { file: 'src/a.ts', safeToAutomate: true },
        });
        expect(categorizeForReview(finding)).toBeUndefined();
    });

    it('queues a patch the evidence demoted to advisory', () => {
        const finding = createFinding({
            tier: 'advisory',
            confidenceSource: 'calibrated',
            calibrationSampleSize: 60,
            executablePatch: { file: 'src/a.ts', safeToAutomate: true },
        });
        expect(categorizeForReview(finding)).toBe(QUEUE_ADVISORY);
    });

    it('files an uncalibrated runtime finding as needing a human', () => {
        const finding = createFinding({
            issue: createIssue({ evidence: { confidence: 0.6, requiresRuntime: true } }),
        });
        expect(categorizeForReview(finding)).toBe(QUEUE_NEEDS_HUMAN);
    });

    it('files a calibrated runtime finding as runtime-evidence work', () => {
        const finding = createFinding({
            confidenceSource: 'calibrated',
            calibrationSampleSize: 40,
            issue: createIssue({ evidence: { confidence: 0.6, requiresRuntime: true } }),
        });
        expect(categorizeForReview(finding)).toBe(QUEUE_RUNTIME_EVIDENCE);
    });

    it('files an uncalibrated non-runtime finding as uncalibrated', () => {
        expect(categorizeForReview(createFinding())).toBe(QUEUE_UNCALIBRATED);
    });

    it('files a well-observed advisory finding as advisory', () => {
        const finding = createFinding({
            tier: 'advisory',
            confidenceSource: 'calibrated',
            calibrationSampleSize: 50,
        });
        expect(categorizeForReview(finding)).toBe(QUEUE_ADVISORY);
    });

    it('leaves a thin-sample advisory finding out of the queue', () => {
        const finding = createFinding({
            tier: 'advisory',
            confidenceSource: 'calibrated',
            calibrationSampleSize: 2,
        });
        expect(categorizeForReview(finding)).toBeUndefined();
    });

    it('orders deterministically by category, file, line, rule and analyzer', () => {
        const queued = buildReviewQueue([
            createFinding({
                tier: 'advisory',
                confidenceSource: 'calibrated',
                calibrationSampleSize: 30,
                issue: createIssue({ rule: 'z-rule' }),
            }),
            createFinding({ issue: issueAt('src/b.ts', 5) }),
            createFinding({ issue: issueAt('src/b.ts', 2) }),
            createFinding({
                issue: createIssue({
                    evidence: { confidence: 0.4, requiresRuntime: true },
                }),
            }),
        ]);
        expect(queued.map((record) => record.category)).toEqual([
            QUEUE_NEEDS_HUMAN,
            QUEUE_UNCALIBRATED,
            QUEUE_UNCALIBRATED,
            QUEUE_ADVISORY,
        ]);
        expect(queued.map((record) => record.file)).toEqual([
            'src/a.ts',
            'src/b.ts',
            'src/b.ts',
            'src/a.ts',
        ]);
        expect(queued[1].line).toBe(2);
        expect(queued[2].line).toBe(5);
    });

    it('counts only the needs-human category', () => {
        const queued = buildReviewQueue([
            createFinding(),
            createFinding({
                issue: createIssue({ evidence: { confidence: 0.4, requiresRuntime: true } }),
            }),
        ]);
        expect(queued).toHaveLength(2);
        expect(countNeedsHuman(queued)).toBe(1);
    });

    it('serializes one record per line and nothing at all for an empty queue', () => {
        expect(serializeReviewQueue([])).toBe('');
        const body = serializeReviewQueue(buildReviewQueue([createFinding()]));
        expect(body.endsWith('\n')).toBe(true);
        expect(body.trim().split('\n')).toHaveLength(1);
    });

    it('writes the queue to a fresh nested directory', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-refactor-queue-'));
        TEMP_DIRS.push(root);
        const target = path.join(root, 'nested', 'deeper', 'queue.ndjson');
        const written = await writeReviewQueue(target, buildReviewQueue([createFinding()]));
        expect(written).toBe(1);
        expect(fs.readFileSync(target, 'utf8').trim().split('\n')).toHaveLength(1);
    });
});

describe('fix outcome reconciliation', () => {
    /**
     * Builds a previous review-memory record for one file.
     *
     * @param rules - Rules that fired on the previous audit.
     * @returns Minimal record accepted by the derivation.
     */
    function createRecord(rules: string[]): ReviewMemoryRecord {
        return {
            filePath: 'src/a.ts',
            fileHash: 'hash',
            astDigest: 'digest',
            codeDomains: [],
            ruleHits: rules.map((rule, index) => ({
                id: `constants:${rule}:src/a.ts:${index + 1}`,
                analyzer: 'constants',
                rule,
                severity: 'warning',
                line: index + 1,
                message: rule,
            })),
            qualityScores: {} as ReviewMemoryRecord['qualityScores'],
            lastAudited: 1,
            revisionId: 'revision',
            contextWindows: { imports: [], exports: [] },
            fixResults: [],
        };
    }

    it('derives nothing when there is no previous record', () => {
        expect(deriveResolvedRules(undefined, [createIssue()])).toEqual([]);
    });

    it('derives nothing when the rule still fires on a different line', () => {
        const previous = createRecord(['magic-number']);
        const current = [
            createIssue({
                location: {
                    file: 'src/a.ts',
                    start: { line: 99, column: 1 },
                    end: { line: 99, column: 5 },
                },
            }),
        ];
        expect(deriveResolvedRules(previous, current)).toEqual([]);
    });

    it('derives a rule that stopped firing, sorted', () => {
        const previous = createRecord(['zeta', 'alpha']);
        const current = [createIssue({ rule: 'alpha' })];
        expect(deriveResolvedRules(previous, current)).toEqual(['zeta']);
    });

    it('refuses to credit a rule whose analyzer did not run', () => {
        const previous = createRecord(['zeta', 'alpha']);
        expect(deriveResolvedRules(previous, [], ['constants'])).toEqual(['alpha', 'zeta']);
        expect(deriveResolvedRules(previous, [], ['security'])).toEqual([]);
    });

    it('records one fix result per audit that resolved something', () => {
        const results = reconcileFixResults([], ['zeta'], 'rev1', 1000, 'agent');
        expect(results).toHaveLength(1);
        expect(results[0].fixedRules).toEqual(['zeta']);
        expect(results[0].success).toBe(true);
        expect(results[0].patchId).toBe('rescan:rev1');
    });

    it('keeps the previous history untouched when nothing was resolved', () => {
        const existing = reconcileFixResults([], ['zeta'], 'rev1', 1000, 'agent');
        const after = reconcileFixResults(existing, [], 'rev2', 2000, 'agent');
        expect(after).toEqual(existing);
    });

    it('does not duplicate a retried audit', () => {
        const first = reconcileFixResults([], ['zeta'], 'rev1', 1000, 'agent');
        const retried = reconcileFixResults(first, ['zeta'], 'rev1', 1000, 'agent');
        expect(retried).toHaveLength(1);
    });

    it('bounds the retained history to the newest entries', () => {
        let history: ReturnType<typeof reconcileFixResults> = [];
        for (let i = 0; i < MAX_FIX_RESULTS_PER_FILE + 5; i++) {
            history = reconcileFixResults(history, [`rule-${i}`], `rev-${i}`, i, 'agent');
        }
        expect(history).toHaveLength(MAX_FIX_RESULTS_PER_FILE);
        expect(history[history.length - 1].patchId).toBe(
            `rescan:rev-${MAX_FIX_RESULTS_PER_FILE + 4}`,
        );
        expect(history[0].patchId).toBe('rescan:rev-5');
    });
});

describe('confidence-gated rework', () => {
    it('treats a missing confidence as neutral rather than confident', () => {
        expect(resolveIssueConfidence(createIssue())).toBe(0.5);
        expect(resolveIssueConfidence(createIssue({ evidence: { confidence: 0.91 } }))).toBe(0.91);
        expect(resolveIssueConfidence(createIssue({ evidence: { confidence: 7 } }))).toBe(1);
        expect(resolveIssueConfidence(createIssue({ evidence: { confidence: -2 } }))).toBe(0);
    });

    it('plans nothing for an unbounded scan', () => {
        const candidates = planRework({
            issues: [createIssue({ evidence: { confidence: 0.2 } })],
            confidenceThreshold: 0.65,
            wasBounded: false,
        });
        expect(candidates).toEqual([]);
    });

    it('skips findings at or above the threshold', () => {
        const candidates = planRework({
            issues: [
                createIssue({ evidence: { confidence: 0.65 } }),
                createIssue({ evidence: { confidence: 0.9 } }),
            ],
            confidenceThreshold: 0.65,
            wasBounded: true,
        });
        expect(candidates).toEqual([]);
    });

    it('skips error-severity findings, since the severity floor settles them', () => {
        const candidates = planRework({
            issues: [createIssue({ severity: 'error', evidence: { confidence: 0.1 } })],
            confidenceThreshold: 0.65,
            wasBounded: true,
        });
        expect(candidates).toEqual([]);
    });

    it('selects a weak finding and widens the window by default', () => {
        const candidates = planRework({
            issues: [createIssue({ evidence: { confidence: 0.2 } })],
            confidenceThreshold: 0.65,
            wasBounded: true,
        });
        expect(candidates).toHaveLength(1);
        expect(candidates[0].strategy).toBe(REWORK_WIDEN_CONTEXT);
    });

    it('selects the unbounded pass for whole-symbol rules', () => {
        const candidates = planRework({
            issues: [
                createIssue({
                    analyzer: 'complexity',
                    rule: 'CPX-001',
                    evidence: { confidence: 0.3 },
                }),
            ],
            confidenceThreshold: 0.65,
            wasBounded: true,
        });
        expect(candidates[0].strategy).toBe(REWORK_DEEPEN_AST);
    });

    it('defers findings whose evidence can only come from outside this process', () => {
        const candidates = planRework({
            issues: [
                createIssue({
                    evidence: { confidence: 0.3, requiresRuntime: true },
                }),
            ],
            confidenceThreshold: 0.65,
            wasBounded: true,
        });
        expect(candidates[0].strategy).toBe(REWORK_DEFER_EXTERNAL_EVIDENCE);
        expect(hasLocalRework(candidates)).toBe(false);
    });

    it('selects the analyzer swap when the first scan skipped analyzers', () => {
        const candidates = planRework({
            issues: [createIssue({ evidence: { confidence: 0.3 } })],
            confidenceThreshold: 0.65,
            wasBounded: true,
            skippedAnalyzers: ['security'],
        });
        expect(candidates[0].strategy).toBe(REWORK_SWAP_ANALYZER_SET);
    });

    it('expands a window symmetrically and clamps the start at line 1', () => {
        expect(expandWindow([100, 200], 2)).toEqual([1, 300]);
        expect(expandWindow([1, 11], 2)).toEqual([1, 21]);
        expect(expandWindow([50, 50], 2)).toEqual([50, 50]);
    });

    it('collects producing analyzers once, adding skipped ones only for a swap', () => {
        const plain = planRework({
            issues: [
                createIssue({ evidence: { confidence: 0.2 } }),
                createIssue({
                    analyzer: 'security',
                    rule: 'SEC-001',
                    evidence: { confidence: 0.2 },
                }),
                createIssue({ evidence: { confidence: 0.2 } }),
            ],
            confidenceThreshold: 0.65,
            wasBounded: true,
        });
        expect(collectReworkAnalyzers(plain, ['hygiene'])).toEqual(['constants', 'security']);

        const withSwap = planRework({
            issues: [createIssue({ evidence: { confidence: 0.2 } })],
            confidenceThreshold: 0.65,
            wasBounded: true,
            skippedAnalyzers: ['hygiene'],
        });
        expect(collectReworkAnalyzers(withSwap, ['hygiene'])).toEqual(['constants', 'hygiene']);
    });

    it('confirms a finding the wider scan reproduces on a moved line', () => {
        const candidates = planRework({
            issues: [createIssue({ evidence: { confidence: 0.2 } })],
            confidenceThreshold: 0.65,
            wasBounded: true,
        });
        const outcomes = reconcileRework(candidates, [
            createIssue({
                location: {
                    file: 'src/a.ts',
                    start: { line: 400, column: 1 },
                    end: { line: 400, column: 5 },
                },
            }),
        ]);
        expect(outcomes[0].verdict).toBe(VERDICT_CONFIRMED);
    });

    it('refutes a finding the wider scan no longer reports', () => {
        const candidates = planRework({
            issues: [createIssue({ evidence: { confidence: 0.2 } })],
            confidenceThreshold: 0.65,
            wasBounded: true,
        });
        const outcomes = reconcileRework(candidates, []);
        expect(outcomes[0].verdict).toBe(VERDICT_REFUTED);
        expect(summarizeRework(outcomes)).toEqual({ evaluated: 1, confirmed: 0, refuted: 1 });
    });

    it('leaves runtime-dependent candidates out of reconciliation entirely', () => {
        const candidates = planRework({
            issues: [createIssue({ evidence: { confidence: 0.2, requiresRuntime: true } })],
            confidenceThreshold: 0.65,
            wasBounded: true,
        });
        expect(reconcileRework(candidates, [])).toEqual([]);
    });

    it('drops refuted findings and keeps everything else in order', () => {
        const weak = createIssue({ evidence: { confidence: 0.2 } });
        const strong = createIssue({ rule: 'other', evidence: { confidence: 0.95 } });
        const candidates = planRework({
            issues: [weak, strong],
            confidenceThreshold: 0.65,
            wasBounded: true,
        });
        const outcomes = reconcileRework(candidates, []);
        expect(dropRefutedFindings([weak, strong], outcomes)).toEqual([strong]);
    });

    it('emits one info-severity invalidation event per file with refutations', () => {
        const candidates = planRework({
            issues: [createIssue({ evidence: { confidence: 0.2 } })],
            confidenceThreshold: 0.65,
            wasBounded: true,
        });
        const events = buildInvalidationEvents(reconcileRework(candidates, []), 'src/a.ts', 7);
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('SPECULATIVE_INVALIDATION');
        expect(events[0].severity).toBe('info');
        expect(events[0].issues).toHaveLength(1);
        expect(buildInvalidationEvents([], 'src/a.ts', 7)).toEqual([]);
    });
});
