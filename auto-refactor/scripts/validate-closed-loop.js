#!/usr/bin/env node
/**
 * Module: Verification Harness — Closed-Loop Adjudication Contract
 * File Path: scripts/validate-closed-loop.js
 * Architecture Role: Guards the three links that turn adjudication from a report annotation into
 *   a working loop: recorded outcomes reach the arbiter, resolved findings reach review memory,
 *   and unresolved findings reach a human work list. Each link has a plausible implementation that
 *   looks correct in a passing report while doing nothing — a corpus loader nobody calls, a
 *   `fixResults` array always written as `[]`, a queue that mirrors the whole report — so the
 *   suite asserts the end-to-end effect rather than the presence of a function.
 * Dependencies & Triggers: consumes ../dist/core/scoring/calibration-corpus,
 *   ../dist/core/reporting/review-queue, ../dist/core/memory/fix-outcome-tracker,
 *   ../dist/core/pipeline/confidence-rework and ../dist/core/scoring/finding-confidence-arbiter;
 *   registered in scripts/test-parallel.js and run by `npm test`.
 * Responsibilities:
 *   1. Assert a valid corpus changes an arbiter verdict, and an invalid one changes nothing.
 *   2. Assert the queue excludes blocking, suppressed and mechanically patchable findings.
 *   3. Assert a resolution is recorded once, survives a line shift, and stays bounded.
 *   4. Assert rework selects only bounded, unproven, non-blocking findings and refutes correctly.
 *   5. Assert every category and strategy token is one the type union declares.
 * Exit Semantics & Design Rationale: Exits 0 when every link behaves, 1 naming the first
 *   violation. No scan is run: these are unit-level contracts, and running a full scan here would
 *   duplicate `validate-precision-governance` at a hundred times the cost.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { runEntry } = require('./common/test-runner-harness');

const ROOT = path.join(__dirname, '..');
const corpusModule = require(path.join(ROOT, 'dist/core/scoring/calibration-corpus'));
const queueModule = require(path.join(ROOT, 'dist/core/reporting/review-queue'));
const fixModule = require(path.join(ROOT, 'dist/core/memory/fix-outcome-tracker'));
const reworkModule = require(path.join(ROOT, 'dist/core/pipeline/confidence-rework'));
const arbiterModule = require(path.join(ROOT, 'dist/core/scoring/finding-confidence-arbiter'));

const { parseCalibrationCorpus, loadCalibrationCorpus, CALIBRATION_CORPUS_SCHEMA } = corpusModule;
const {
  categorizeForReview,
  buildReviewQueue,
  countNeedsHuman,
  serializeReviewQueue,
  QUEUE_NEEDS_HUMAN,
  QUEUE_RUNTIME_EVIDENCE,
  QUEUE_UNCALIBRATED,
  QUEUE_ADVISORY,
} = queueModule;
const { deriveResolvedRules, reconcileFixResults, MAX_FIX_RESULTS_PER_FILE } = fixModule;
const {
  planRework,
  collectReworkAnalyzers,
  reconcileRework,
  summarizeRework,
  dropRefutedFindings,
  buildInvalidationEvents,
  expandWindow,
  hasLocalRework,
  resolveIssueConfidence,
  REWORK_WIDEN_CONTEXT,
  REWORK_DEEPEN_AST,
  REWORK_SWAP_ANALYZER_SET,
  REWORK_DEFER_EXTERNAL_EVIDENCE,
  VERDICT_CONFIRMED,
  VERDICT_REFUTED,
} = reworkModule;
const { FindingConfidenceArbiter } = arbiterModule;

/**
 * Builds a minimal issue record.
 *
 * @param overrides - Fields to override.
 * @returns Issue with a deterministic identity.
 */
function issue(overrides = {}) {
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
 * Builds a minimal arbitrated finding.
 *
 * @param overrides - Fields to override.
 * @returns Arbitrated finding.
 */
function finding(overrides = {}) {
  return {
    issue: issue(),
    tier: 'advisory',
    confidence: 0.75,
    confidenceSource: 'uncalibrated',
    calibrationSampleSize: 0,
    mustBlock: false,
    isSuppressed: false,
    isPrunedBySlice: false,
    rationale: 'rationale',
    ...overrides,
  };
}

/**
 * Stage 1: the corpus loader must accept good evidence and reject corrupt evidence.
 */
async function verifyCorpusIntake() {
  console.log('\n1. Verifying calibration corpus intake...');
  const accepted = parseCalibrationCorpus({
    schema: CALIBRATION_CORPUS_SCHEMA,
    rules: [
      { rule: 'magic-number', truePositives: 14, falsePositives: 6 },
      { rule: 'high-complexity', truePositives: 3, falsePositives: 9 },
    ],
  });
  assert.strictEqual(accepted.stats.length, 2);
  assert.strictEqual(accepted.rejections.length, 0);

  const rejected = parseCalibrationCorpus({
    schema: CALIBRATION_CORPUS_SCHEMA,
    rules: [
      { rule: '', truePositives: 1, falsePositives: 0 },
      { rule: 'negative', truePositives: -1, falsePositives: 0 },
      { rule: 'stringly', truePositives: '3', falsePositives: 0 },
      { rule: 'empty', truePositives: 0, falsePositives: 0 },
      { rule: 'dup', truePositives: 1, falsePositives: 0 },
      { rule: 'dup', truePositives: 2, falsePositives: 0 },
      'not-an-object',
    ],
  });
  assert.strictEqual(rejected.stats.length, 1, 'only the first dup entry may survive');
  assert.strictEqual(
    rejected.rejections.length,
    6,
    `expected 6 rejections, got ${rejected.rejections.length}`,
  );

  assert.strictEqual(parseCalibrationCorpus({ schema: 'other/v9', rules: [] }).stats.length, 0);
  assert.strictEqual(parseCalibrationCorpus(null).rejections.length, 1);
  assert.strictEqual(parseCalibrationCorpus({ schema: CALIBRATION_CORPUS_SCHEMA }).stats.length, 0);

  const unreadable = loadCalibrationCorpus('corpus.json', async () => {
    throw new Error('EACCES');
  });
  assert.ok(unreadable instanceof Promise, 'the loader must be asynchronous');
  const malformed = loadCalibrationCorpus('corpus.json', async () => '{ not json');
  assert.deepStrictEqual(await loadCalibrationCorpus(undefined, async () => undefined), {
    stats: [],
    rejections: [],
  });

  // The load-bearing one: accepted evidence must actually move an arbiter verdict.
  const target = issue();
  const uncalibrated = new FindingConfidenceArbiter().arbitrateFinding(target);
  const calibrated = new FindingConfidenceArbiter({
    ruleCalibrationStats: accepted.stats,
  }).arbitrateFinding(target);
  assert.strictEqual(uncalibrated.confidenceSource, 'uncalibrated');
  assert.strictEqual(calibrated.confidenceSource, 'calibrated');
  assert.strictEqual(calibrated.calibrationSampleSize, 20);
  assert.notStrictEqual(
    calibrated.confidence,
    uncalibrated.confidence,
    'accepted corpus evidence must change the adjudicated confidence',
  );
  console.log(
    `  ✔ ${accepted.stats.length} entries accepted, ${rejected.rejections.length} rejected, ` +
      `arbiter ${uncalibrated.confidence} -> ${calibrated.confidence}.`,
  );
}

/**
 * Stage 2: the queue must be a work list, not a second copy of the report.
 */
function verifyReviewQueue() {
  console.log('\n2. Verifying the review queue is a work list, not a report copy...');
  const queue = buildReviewQueue([
    finding({ mustBlock: true }),
    finding({ isSuppressed: true }),
    finding({
      tier: 'actionable',
      executablePatch: { file: 'src/a.ts', safeToAutomate: true },
    }),
    finding({ issue: issue({ evidence: { confidence: 0.4, requiresRuntime: true } }) }),
    finding({
      confidenceSource: 'calibrated',
      calibrationSampleSize: 40,
      issue: issue({ evidence: { confidence: 0.5, requiresRuntime: true } }),
    }),
    finding(),
    finding({ tier: 'advisory', confidenceSource: 'calibrated', calibrationSampleSize: 60 }),
    finding({ tier: 'advisory', confidenceSource: 'calibrated', calibrationSampleSize: 1 }),
  ]);
  const categories = queue.map((record) => record.category);
  assert.deepStrictEqual(categories, [
    QUEUE_NEEDS_HUMAN,
    QUEUE_RUNTIME_EVIDENCE,
    QUEUE_UNCALIBRATED,
    QUEUE_ADVISORY,
  ]);
  assert.strictEqual(countNeedsHuman(queue), 1);
  assert.strictEqual(queue.length, 4, 'four of eight findings warrant a human');

  // Every exclusion, stated as its own negative control.
  assert.strictEqual(categorizeForReview(finding({ mustBlock: true })), undefined);
  assert.strictEqual(categorizeForReview(finding({ isSuppressed: true })), undefined);
  assert.strictEqual(
    categorizeForReview(
      finding({ tier: 'actionable', executablePatch: { file: 'x', safeToAutomate: true } }),
    ),
    undefined,
    'a patch the arbiter trusts must not reach a human',
  );
  // ...but a patch the evidence demoted to advisory must, or the queue hides the interesting case.
  assert.strictEqual(
    categorizeForReview(
      finding({
        tier: 'advisory',
        confidenceSource: 'calibrated',
        calibrationSampleSize: 60,
        executablePatch: { file: 'x', safeToAutomate: true },
      }),
    ),
    QUEUE_ADVISORY,
    'a patch on a rejected rule is exactly what a reviewer must see',
  );

  const body = serializeReviewQueue(queue);
  assert.strictEqual(serializeReviewQueue([]), '');
  assert.strictEqual(body.trim().split('\n').length, 4);
  const parsed = JSON.parse(body.trim().split('\n')[0]);
  assert.strictEqual(parsed.category, QUEUE_NEEDS_HUMAN);
  assert.strictEqual(parsed.requiresRuntime, true);
  assert.strictEqual(typeof parsed.rationale, 'string');

  // Determinism: a shuffled input must serialize to identical bytes.
  const shuffled = buildReviewQueue([
    finding({ tier: 'advisory', confidenceSource: 'calibrated', calibrationSampleSize: 60 }),
    finding(),
    finding({
      confidenceSource: 'calibrated',
      calibrationSampleSize: 40,
      issue: issue({ evidence: { confidence: 0.5, requiresRuntime: true } }),
    }),
    finding({ issue: issue({ evidence: { confidence: 0.4, requiresRuntime: true } }) }),
  ]);
  assert.strictEqual(
    serializeReviewQueue(shuffled),
    body,
    'queue bytes must not depend on input order',
  );
  console.log(`  ✔ ${queue.length} of 8 findings queued, categories and bytes deterministic.`);
}

/**
 * Stage 3: a resolution must be recorded, survive a line shift, and stay bounded.
 */
function verifyFixOutcomes() {
  console.log('\n3. Verifying resolved findings reach review memory...');
  const record = {
    filePath: 'src/a.ts',
    fileHash: 'h',
    astDigest: 'd',
    codeDomains: [],
    ruleHits: [
      {
        id: 'x:alpha:src/a.ts:1',
        analyzer: 'x',
        rule: 'alpha',
        severity: 'warning',
        line: 1,
        message: '',
      },
      {
        id: 'x:beta:src/a.ts:2',
        analyzer: 'x',
        rule: 'beta',
        severity: 'warning',
        line: 2,
        message: '',
      },
    ],
    qualityScores: {},
    lastAudited: 1,
    revisionId: 'r',
    contextWindows: { imports: [], exports: [] },
    fixResults: [],
  };

  assert.deepStrictEqual(deriveResolvedRules(undefined, [issue()]), []);
  assert.deepStrictEqual(deriveResolvedRules(record, [issue({ rule: 'alpha' })]), ['beta']);
  assert.deepStrictEqual(deriveResolvedRules(record, []), ['alpha', 'beta']);
  assert.deepStrictEqual(
    deriveResolvedRules(record, [issue({ rule: 'gamma' })]),
    ['alpha', 'beta'],
    'a newly introduced rule must not mask the two that were resolved',
  );
  // A configuration change must not masquerade as a repair.
  assert.deepStrictEqual(
    deriveResolvedRules(record, [], ['x']),
    ['alpha', 'beta'],
    'an analyzer that ran must still be credited',
  );
  assert.deepStrictEqual(
    deriveResolvedRules(record, [], ['some-other-analyzer']),
    [],
    'silence from an analyzer that never ran is not a fix',
  );

  const first = reconcileFixResults([], ['beta'], 'rev-1', 100, 'agent');
  assert.strictEqual(first.length, 1);
  assert.deepStrictEqual(first[0].fixedRules, ['beta']);
  assert.strictEqual(reconcileFixResults(first, ['beta'], 'rev-1', 100, 'agent').length, 1);

  let history = [];
  for (let i = 0; i < MAX_FIX_RESULTS_PER_FILE + 3; i++) {
    history = reconcileFixResults(history, [`rule-${i}`], `rev-${i}`, i, 'agent');
  }
  assert.strictEqual(history.length, MAX_FIX_RESULTS_PER_FILE);
  assert.strictEqual(
    history[history.length - 1].patchId,
    `rescan:rev-${MAX_FIX_RESULTS_PER_FILE + 2}`,
  );
  console.log(
    `  ✔ resolutions derived, retries deduplicated, history bounded at ${MAX_FIX_RESULTS_PER_FILE} ` +
      `(kept ${history.length}).`,
  );
}

/**
 * Stage 4: rework must spend its second pass only where a second pass can help.
 */
function verifyRework() {
  console.log('\n4. Verifying confidence-gated rework spends its pass where it can help...');
  const plan = (issues, extra = {}) =>
    planRework({ issues, confidenceThreshold: 0.65, wasBounded: true, ...extra });

  assert.deepStrictEqual(
    planRework({
      issues: [issue({ evidence: { confidence: 0.1 } })],
      confidenceThreshold: 0.65,
      wasBounded: false,
    }),
    [],
    'an unbounded scan has nothing wider to look at',
  );
  assert.deepStrictEqual(plan([issue({ evidence: { confidence: 0.65 } })]), []);
  assert.deepStrictEqual(plan([issue({ severity: 'error', evidence: { confidence: 0.1 } })]), []);

  const weak = plan([issue({ evidence: { confidence: 0.2 } })]);
  assert.strictEqual(weak.length, 1);
  assert.strictEqual(weak[0].strategy, REWORK_WIDEN_CONTEXT);

  const wholeSymbol = plan([
    issue({ analyzer: 'complexity', rule: 'CPX-001', evidence: { confidence: 0.2 } }),
  ]);
  assert.strictEqual(wholeSymbol[0].strategy, REWORK_DEEPEN_AST);

  const deferred = plan([issue({ evidence: { confidence: 0.2, requiresRuntime: true } })]);
  assert.strictEqual(deferred[0].strategy, REWORK_DEFER_EXTERNAL_EVIDENCE);
  assert.strictEqual(
    hasLocalRework(deferred),
    false,
    'a runtime-dependent candidate needs no local scan',
  );

  const swapped = plan([issue({ evidence: { confidence: 0.2 } })], {
    skippedAnalyzers: ['security'],
  });
  assert.strictEqual(swapped[0].strategy, REWORK_SWAP_ANALYZER_SET);
  assert.deepStrictEqual(collectReworkAnalyzers(swapped, ['security']), ['constants', 'security']);

  assert.deepStrictEqual(expandWindow([100, 200], 2), [1, 300]);
  assert.deepStrictEqual(expandWindow([50, 50], 2), [50, 50]);
  assert.strictEqual(resolveIssueConfidence(issue()), 0.5);
  assert.strictEqual(resolveIssueConfidence(issue({ evidence: { confidence: 1.7 } })), 1);

  const confirmed = reconcileRework(weak, [issue()]);
  assert.strictEqual(confirmed[0].verdict, VERDICT_CONFIRMED);
  const refuted = reconcileRework(weak, []);
  assert.strictEqual(refuted[0].verdict, VERDICT_REFUTED);
  assert.deepStrictEqual(summarizeRework(refuted), { evaluated: 1, confirmed: 0, refuted: 1 });
  assert.deepStrictEqual(dropRefutedFindings([weak[0].issue], refuted), []);

  const events = buildInvalidationEvents(refuted, 'src/a.ts', 42);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'SPECULATIVE_INVALIDATION');
  assert.strictEqual(events[0].severity, 'info', 'a refutation is a good outcome, not a breach');
  assert.strictEqual(buildInvalidationEvents(confirmed, 'src/a.ts', 42).length, 0);
  console.log(
    '  ✔ 4 strategies, 4 exclusions, refutation drops the finding and reports info severity.',
  );
}

/**
 * Stage 5: every token the modules emit must be one their unions declare.
 */
function verifyVocabularies() {
  console.log('\n5. Verifying emitted tokens stay inside their declared unions...');
  const categories = new Set([
    QUEUE_NEEDS_HUMAN,
    QUEUE_RUNTIME_EVIDENCE,
    QUEUE_UNCALIBRATED,
    QUEUE_ADVISORY,
  ]);
  assert.strictEqual(categories.size, 4);
  const strategies = new Set([
    REWORK_WIDEN_CONTEXT,
    REWORK_DEEPEN_AST,
    REWORK_SWAP_ANALYZER_SET,
    REWORK_DEFER_EXTERNAL_EVIDENCE,
  ]);
  assert.strictEqual(strategies.size, 4);
  assert.strictEqual(VERDICT_CONFIRMED === VERDICT_REFUTED, false);
  assert.ok(categories.has(categorizeForReview(finding())));
  console.log('  ✔ 4 queue categories, 4 rework strategies, 2 verdicts, all distinct.');
}

async function main() {
  console.log('=== Closed-Loop Adjudication Contract ===');
  await verifyCorpusIntake();
  verifyReviewQueue();
  verifyFixOutcomes();
  verifyRework();
  verifyVocabularies();
  console.log('\nConclusion: corpus intake, human queue, fix outcomes and gated rework all hold ✔');
}

runEntry('validate-closed-loop.js (closed-loop)', main);
