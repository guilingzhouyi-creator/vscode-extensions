#!/usr/bin/env node
/**
 * Module: Verification Harness — Confidence Calibration Health & Monotonic Ratchet
 * File Path: scripts/validate-confidence-calibration.js
 * Architecture Role: The missing half of the existing precision governance suite. That suite
 *   guards numeric precision (0.01 scale, IEEE 754 drift); this one guards *statistical*
 *   honesty — whether a reported confidence actually predicts an outcome. A static analyzer
 *   that reports 0.95 for everything scores perfectly on "did we emit a number" and fails
 *   completely on "may I use this result", which is the question a consumer actually asks.
 * Dependencies & Triggers: consumes ../dist/core/scoring/confidence-calibration (pure math
 *   surface, no scan required) and the labelled evaluation corpus embedded below; registered in
 *   scripts/test-parallel.js and run by `npm test`.
 * Responsibilities:
 *   1. Assert the Jeffreys posterior moves in the direction the evidence points.
 *   2. Assert shrinkage: a 2-observation rule cannot outvote the analyzer's own score, and a
 *      1000-observation rule almost entirely replaces it.
 *   3. Assert credible bounds bracket the posterior they describe, and contain the shrunk score.
 *   4. Assert the superseded behaviour is gone: an uncalibrated actionable finding no longer
 *      lands on the 0.95 ceiling the pre-calibration arbiter assumed.
 *   5. Measure the labelled corpus twice — raw self-reports, then the same reports after
 *      calibration — and require the calibrated set to be strictly more honest on BOTH ECE and
 *      Brier, then ratchet the calibrated numbers against a frozen ceiling.
 * Exit Semantics & Design Rationale: Exits 0 when every invariant holds and both calibrated
 *   errors are at or below the frozen ceiling, exits 1 naming the first violated invariant. The
 *   before/after pair is the load-bearing assertion: a calibration module that merely relabels
 *   scores without improving them would pass a ratchet alone but fails the improvement check.
 *   The ratchet is one-directional — lowering it requires shrinking the error, which is the
 *   review the metric exists to force.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const calibration = require(path.join(ROOT, 'dist/core/scoring/confidence-calibration'));
const arbiterModule = require(path.join(ROOT, 'dist/core/scoring/finding-confidence-arbiter'));

const {
  calibrateRuleConfidence,
  computeExpectedCalibrationError,
  computeBrierScore,
  computeObservedAccuracy,
  computeMeanConfidence,
  evaluateCalibrationHealth,
  clampUnit,
  JEFFREYS_PRIOR,
  CALIBRATION_SHRINKAGE_ANCHOR,
} = calibration;

const { FindingConfidenceArbiter, CONFIDENCE_ACTIONABLE_DEFAULT } = arbiterModule;

/**
 * Frozen ceiling for both calibration errors, measured on the CALIBRATED set below.
 *
 * Regression ceilings, not a claim about production accuracy: the corpus is deterministic, so any
 * rise means the scoring got worse. Measured at ratification: ECE 0.1589, Brier 0.1852.
 *
 * Both ceilings sit above zero on purpose. The residual is the shrinkage anchor doing its job —
 * a rule with ~10 observations only half-trusts its own posterior, so it stays partway toward its
 * historical self-report. Driving this to zero would require either a much larger corpus or a
 * weaker anchor, and a weaker anchor is the more dangerous of the two: it would let a rule with
 * three observations overrule the analyzer. Tightening these numbers requires shrinking the
 * error, which is the review the ratchet exists to force.
 */
const BASELINE = {
  expectedCalibrationError: 0.17,
  brierScore: 0.2,
};

/**
 * Labelled evaluation corpus, declared as counted groups.
 *
 * Ground truth by construction: each group states the confidence an analyzer actually reported
 * for a rule, and how many of those reported findings turned out real (`truePositives`) versus
 * rejected (`falsePositives` — reviewer-suppressed with a stated reason, or rolled back). Counts
 * are the honest representation here: calibration is a per-rule rate estimate, so what matters is
 * how many observations a rule has, not which individual line they came from.
 *
 * The mix is deliberate and reflects how the analyzers actually behave. `secret-detected`,
 * `import-cycle` and `GOV-PRF-004` are mechanical and are right almost every time.
 * `duplicate-literal`, `high-complexity` and `PRF-ALG-001` are systematically over-confident:
 * the first two fire on lookup tables and inherently branchy algorithms and cannot tell those
 * from defects, and the third is a runtime guess made without runtime evidence. A corpus of only
 * easy cases would score well no matter what the adjudicator did, which is why the over-confident
 * groups carry the largest counts.
 */
const CALIBRATION_GROUPS = [
  { rule: 'secret-detected', confidence: 0.98, truePositives: 12, falsePositives: 0 },
  { rule: 'import-cycle', confidence: 0.97, truePositives: 8, falsePositives: 0 },
  { rule: 'GOV-EXC-001', confidence: 0.93, truePositives: 9, falsePositives: 1 },
  { rule: 'GOV-PRF-004', confidence: 0.95, truePositives: 11, falsePositives: 1 },
  { rule: 'magic-number', confidence: 0.87, truePositives: 14, falsePositives: 6 },
  { rule: 'high-complexity', confidence: 0.91, truePositives: 3, falsePositives: 9 },
  { rule: 'duplicate-literal', confidence: 0.88, truePositives: 4, falsePositives: 16 },
  { rule: 'CMT-HDR-001', confidence: 0.58, truePositives: 5, falsePositives: 5 },
  { rule: 'PRF-ALG-001', confidence: 0.48, truePositives: 2, falsePositives: 6 },
  { rule: 'VOL-ELOC-001', confidence: 0.9, truePositives: 2, falsePositives: 4 },
];

/**
 * Expand the counted groups into individual labelled points.
 *
 * @param groups - Counted calibration groups.
 * @returns Flat list of (rule, reported confidence, outcome) observations.
 */
function expandGroups(groups) {
  const points = [];
  for (const group of groups) {
    for (let i = 0; i < group.truePositives; i++) {
      points.push({ rule: group.rule, confidence: group.confidence, outcome: 1 });
    }
    for (let i = 0; i < group.falsePositives; i++) {
      points.push({ rule: group.rule, confidence: group.confidence, outcome: 0 });
    }
  }
  return points;
}

/** Labelled observations, one entry per reported finding. */
const EVALUATION_CORPUS = expandGroups(CALIBRATION_GROUPS);

/**
 * Pool the corpus into per-rule outcome counts.
 *
 * This mirrors how production evidence arrives: outcomes accumulate against a rule id, not
 * against an individual finding, because what is being calibrated is the rule's judgement.
 *
 * @param points - Labelled corpus entries.
 * @returns Rule-keyed statistics list accepted by `calibrateRuleConfidence`.
 */
function deriveRuleStats(points) {
  const byRule = new Map();
  for (const point of points) {
    const entry = byRule.get(point.rule) || {
      rule: point.rule,
      truePositives: 0,
      falsePositives: 0,
    };
    if (point.outcome > 0.5) entry.truePositives += 1;
    else entry.falsePositives += 1;
    byRule.set(point.rule, entry);
  }
  return [...byRule.values()];
}

/**
 * Re-score every corpus point through the calibration module.
 *
 * Each point is scored against its rule's pool with that very point removed, so the score cannot
 * peek at the outcome it is being judged on. Without the leave-one-out step the corpus would
 * grade itself with the answers in hand and the improvement would be an artifact of that.
 *
 * @param points - Labelled corpus entries.
 * @returns Calibrated confidence points, plus the raw baseline for comparison.
 */
function calibrateCorpus(points) {
  const rawPoints = [];
  const calibratedPoints = [];
  // Pool once, then subtract each point's own observation for the leave-one-out score. A per-point
  // filter would rescan the corpus inside the loop (O(N^2)) and, more importantly, would recompute
  // counts that never change; subtracting one observation is the same leave-one-out by definition.
  const pool = new Map(deriveRuleStats(points).map((entry) => [entry.rule, entry]));
  for (const point of points) {
    const full = pool.get(point.rule);
    const removed = point.outcome > 0.5 ? 1 : 0;
    const stats = full
      ? {
          rule: full.rule,
          truePositives: full.truePositives - removed,
          falsePositives: full.falsePositives - (1 - removed),
        }
      : undefined;
    const record = calibrateRuleConfidence(point.confidence, stats);
    rawPoints.push({ confidence: point.confidence, outcome: point.outcome });
    calibratedPoints.push({ confidence: record.calibrated, outcome: point.outcome });
  }
  return { rawPoints, calibratedPoints };
}

/**
 * Stage 1: the posterior must move in the direction the evidence points.
 */
function verifyPosteriorDirection() {
  console.log('\n1. Verifying posterior direction, bounds and unit-interval containment...');
  const raw = 0.5;
  const confirmed = calibrateRuleConfidence(raw, {
    rule: 'demo',
    truePositives: 200,
    falsePositives: 0,
  });
  const rejected = calibrateRuleConfidence(raw, {
    rule: 'demo',
    truePositives: 0,
    falsePositives: 200,
  });

  assert.ok(
    confirmed.calibrated > raw,
    `200 confirmations must raise confidence above the raw ${raw}, got ${confirmed.calibrated}`,
  );
  assert.ok(
    rejected.calibrated < raw,
    `200 rejections must lower confidence below the raw ${raw}, got ${rejected.calibrated}`,
  );
  for (const record of [confirmed, rejected]) {
    assert.ok(
      record.calibrated >= 0 && record.calibrated <= 1,
      'confidence left the unit interval',
    );
    assert.ok(
      record.lowerBound <= record.posteriorMean && record.posteriorMean <= record.upperBound,
      `credible bounds [${record.lowerBound}, ${record.upperBound}] must bracket the posterior ` +
        `mean ${record.posteriorMean} they describe`,
    );
    assert.ok(
      record.calibrated >= Math.min(record.raw, record.posteriorMean) - 1e-9 &&
        record.calibrated <= Math.max(record.raw, record.posteriorMean) + 1e-9,
      `shrunk confidence ${record.calibrated} must lie between the raw ${record.raw} and the ` +
        `posterior ${record.posteriorMean}`,
    );
  }
  assert.strictEqual(confirmed.source, 'calibrated');
  assert.strictEqual(confirmed.isReliable, true);
  console.log(
    `  ✔ confirmed ${confirmed.calibrated} toward posterior ${confirmed.posteriorMean}, ` +
      `rejected ${rejected.calibrated} toward posterior ${rejected.posteriorMean}.`,
  );
}

/**
 * Stage 2: small samples must not silently override the analyzer.
 */
function verifyShrinkage() {
  console.log('\n2. Verifying empirical-Bayes shrinkage against sample size...');
  const raw = 0.9;
  const tiny = calibrateRuleConfidence(raw, {
    rule: 'demo',
    truePositives: 1,
    falsePositives: 1,
  });
  const huge = calibrateRuleConfidence(raw, {
    rule: 'demo',
    truePositives: 0,
    falsePositives: 1000,
  });
  const wide = calibrateRuleConfidence(0.5, { rule: 'demo', truePositives: 1, falsePositives: 1 });
  const narrow = calibrateRuleConfidence(0.5, {
    rule: 'demo',
    truePositives: 500,
    falsePositives: 500,
  });

  assert.strictEqual(tiny.isReliable, false, 'a 2-observation rule must not claim reliability');
  assert.ok(
    Math.abs(tiny.calibrated - raw) < 0.15,
    `2 observations must stay close to the raw score ${raw}, got ${tiny.calibrated}`,
  );
  assert.ok(
    huge.calibrated < 0.05,
    `1000 rejections must almost fully override the raw score ${raw}, got ${huge.calibrated}`,
  );
  assert.strictEqual(huge.isReliable, true);
  assert.ok(
    narrow.upperBound - narrow.lowerBound < wide.upperBound - wide.lowerBound,
    'credible bounds must tighten as the sample grows',
  );
  console.log(
    `  ✔ 2 observations -> ${tiny.calibrated} (unreliable, bounds width ` +
      `${(wide.upperBound - wide.lowerBound).toFixed(4)}), 1001 rejections -> ${huge.calibrated} ` +
      `(width ${(narrow.upperBound - narrow.lowerBound).toFixed(4)}).`,
  );
}

/**
 * Stage 3: the un-observed rule must be neutral, not optimistic.
 */
function verifyNeutralPrior() {
  console.log('\n3. Verifying the un-observed rule is neutral rather than optimistic...');
  const neutral = calibrateRuleConfidence(0.8, undefined);
  assert.strictEqual(neutral.sampleSize, 0);
  assert.strictEqual(neutral.calibrated, 0.8, 'un-observed confidence must equal the raw score');
  assert.strictEqual(neutral.isReliable, false);
  assert.strictEqual(neutral.source, 'uncalibrated');
  assert.strictEqual(neutral.alpha, JEFFREYS_PRIOR);
  assert.strictEqual(neutral.beta, JEFFREYS_PRIOR);

  assert.strictEqual(calibrateRuleConfidence(5.0, undefined).calibrated, 1, 'clamp high');
  assert.strictEqual(calibrateRuleConfidence(-3, undefined).calibrated, 0, 'clamp low');
  assert.strictEqual(calibrateRuleConfidence(Number.NaN, undefined).calibrated, 0, 'NaN -> zero');
  assert.strictEqual(clampUnit(Number.POSITIVE_INFINITY), 1);
  assert.strictEqual(clampUnit(Number.NEGATIVE_INFINITY), 0);
  assert.strictEqual(clampUnit(Number.NaN), 0);
  console.log('  ✔ neutral prior, clamping and NaN degradation all hold.');
}

/**
 * Stage 4: the arbiter must no longer reward an uncalibrated rule with the ceiling score.
 */
function verifyArbiterSupersedesSelfReport() {
  console.log('\n4. Verifying the arbiter no longer scores "no evidence" as near-certain...');
  const issue = {
    id: 'demo:rule:src/a.ts:1',
    analyzer: 'constants',
    rule: 'magic-number',
    severity: 'warning',
    message: 'Magic number 42',
    location: { file: 'src/a.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 9 } },
    detail: {},
    actionable: {
      action: 'extract_constant',
      code: 'AR:CONST:001',
      safeToAutomate: true,
      templateSnippet: 'const VALUE = 42;',
      rationale: 'extract',
    },
  };

  const uncalibrated = new FindingConfidenceArbiter().arbitrateFinding(issue);
  assert.strictEqual(uncalibrated.tier, 'actionable');
  assert.ok(
    uncalibrated.confidence < CONFIDENCE_ACTIONABLE_DEFAULT,
    `an uncalibrated actionable finding must sit below the ${CONFIDENCE_ACTIONABLE_DEFAULT} ` +
      `ceiling, got ${uncalibrated.confidence}`,
  );
  assert.strictEqual(uncalibrated.confidenceSource, 'uncalibrated');
  assert.strictEqual(uncalibrated.calibrationSampleSize, 0);

  const calibratedUp = new FindingConfidenceArbiter({
    ruleCalibrationStats: [{ rule: 'magic-number', truePositives: 300, falsePositives: 1 }],
  }).arbitrateFinding(issue);
  assert.ok(
    calibratedUp.confidence > uncalibrated.confidence,
    `a well-observed rule must outrank an unobserved one: ${calibratedUp.confidence} vs ` +
      `${uncalibrated.confidence}`,
  );
  assert.strictEqual(calibratedUp.confidenceSource, 'calibrated');
  assert.strictEqual(calibratedUp.calibrationSampleSize, 301);

  const calibratedDown = new FindingConfidenceArbiter({
    ruleCalibrationStats: [{ rule: 'magic-number', truePositives: 1, falsePositives: 40 }],
  }).arbitrateFinding(issue);
  assert.ok(
    calibratedDown.confidence <= uncalibrated.confidence,
    'a mostly-rejected rule must not be promoted above the uncalibrated floor',
  );
  console.log(
    `  ✔ uncalibrated ${uncalibrated.confidence}, well-observed ${calibratedUp.confidence}, ` +
      `mostly-rejected ${calibratedDown.confidence}.`,
  );
}

/**
 * Stage 5: calibration must measurably improve honesty, then hold the improvement.
 */
function verifyCalibrationImprovementAndRatchet() {
  console.log('\n5. Verifying calibration improves ECE and Brier, then ratcheting both...');
  const { rawPoints, calibratedPoints } = calibrateCorpus(EVALUATION_CORPUS);
  const before = evaluateCalibrationHealth(rawPoints);
  const after = evaluateCalibrationHealth(calibratedPoints);

  assert.ok(before.sampleSize >= 20, 'the corpus must stay large enough to be meaningful');
  assert.ok(
    before.optimism > 0.05,
    `the corpus must contain genuine over-confidence for the improvement to be measurable, ` +
      `got optimism ${before.optimism}`,
  );
  assert.ok(
    after.expectedCalibrationError < before.expectedCalibrationError,
    `calibration must lower ECE: before ${before.expectedCalibrationError}, ` +
      `after ${after.expectedCalibrationError}`,
  );
  assert.ok(
    after.brierScore < before.brierScore,
    `calibration must lower Brier: before ${before.brierScore}, after ${after.brierScore}`,
  );
  assert.ok(
    after.expectedCalibrationError <= BASELINE.expectedCalibrationError,
    `calibrated ECE ${after.expectedCalibrationError} exceeds the frozen ceiling ` +
      `${BASELINE.expectedCalibrationError}`,
  );
  assert.ok(
    after.brierScore <= BASELINE.brierScore,
    `calibrated Brier ${after.brierScore} exceeds the frozen ceiling ${BASELINE.brierScore}`,
  );

  // Both metrics must still discriminate, or the ratchet is guarding a dead number.
  const overconfident = EVALUATION_CORPUS.map((point) => ({
    confidence: 0.99,
    outcome: point.outcome,
  }));
  assert.ok(
    computeExpectedCalibrationError(overconfident) > after.expectedCalibrationError,
    'ECE must penalize an all-0.99 adjudicator more than the calibrated one',
  );
  assert.ok(
    computeBrierScore(overconfident) > after.brierScore,
    'Brier must penalize an all-0.99 adjudicator more than the calibrated one',
  );

  console.log(
    `  ✔ ECE ${before.expectedCalibrationError} -> ${after.expectedCalibrationError} ` +
      `(ceiling ${BASELINE.expectedCalibrationError}), ` +
      `Brier ${before.brierScore} -> ${after.brierScore} (ceiling ${BASELINE.brierScore}).`,
  );
  console.log(
    `  ✔ self-report optimism ${before.optimism} -> ${after.optimism}; an all-0.99 adjudicator ` +
      `still scores ECE ${computeExpectedCalibrationError(overconfident)}, so both metrics ` +
      'discriminate.',
  );

  assert.strictEqual(computeMeanConfidence([]), 0);
  assert.strictEqual(computeObservedAccuracy([]), 0);
  assert.strictEqual(computeExpectedCalibrationError([]), 0);
  assert.strictEqual(computeBrierScore([]), 0);
}

/**
 * Runs every stage, rethrowing the first failure after main exits non-zero.
 */
function main() {
  console.log('=== Confidence Calibration Health & Monotonic Ratchet ===');
  verifyPosteriorDirection();
  verifyShrinkage();
  verifyNeutralPrior();
  verifyArbiterSupersedesSelfReport();
  verifyCalibrationImprovementAndRatchet();
  console.log(
    `\nConclusion: posterior direction, shrinkage anchor ${CALIBRATION_SHRINKAGE_ANCHOR}, ` +
      'neutral prior, arbiter supersession, measurable ECE/Brier improvement and both ratchets ' +
      'hold ✔',
  );
}

try {
  main();
} catch (error) {
  console.error(`\n✖ Confidence calibration violation: ${error.message}`);
  process.exit(1);
}
