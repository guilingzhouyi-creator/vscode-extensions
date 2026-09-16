#!/usr/bin/env node
/**
 * Module: Verification Harness - Diff-Level Quality Scoring
 * File Path: scripts/validate-diff-score.js
 * Architecture Role: Key-point lock for the diff-layer half of the quantified standard: a change
 *     must be expressed in the same dimensions as the snapshot score, and the anti-pattern
 *     "deleted 500 lines but coupling went up" must stay negative on the architecture dimension
 * Dependencies & Triggers: `npm run validate-diff-score` (part of `npm test`); imports
 *     ../dist/core/scoring/diffScore and ../dist/api
 * Responsibilities: Assert the delta sign convention, that the B7 verdict is passed through
 *     unchanged, that the published per-unit weights are the applied ones, and that the
 *     coupling-growing deletion is still rejected with a negative architecture delta
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1, so a diff
 *     score that flips signs (or invents a verdict) fails the build; nothing is written to disk.
 */
'use strict';

const assert = require('assert');

const { scoreDiff } = require('../dist/core/scoring/diffScore.js');

/** Old version: ~60 local lines, one import. */
const OLD_LOCAL = [
  "import { helper } from './helper';",
  'export function calculate(values) {',
  ...Array.from({ length: 55 }, (_, i) => `  const step${i} = values[${i % 5}] + ${i};`),
  '  return helper(step0);',
  '}',
  '',
].join('\n');

/** Deletes most lines but pulls in eight external modules: coupling up, LOC down. */
const NEW_COUPLED = [
  "import a from 'ext-a';",
  "import b from 'ext-b';",
  "import c from 'ext-c';",
  "import d from 'ext-d';",
  "import e from 'ext-e';",
  "import f from 'ext-f';",
  "import g from 'ext-g';",
  "import h from 'ext-h';",
  'export function calculate(values) {',
  '  return a(b(c(d(e(f(g(h(values))))))));',
  '}',
  '',
].join('\n');

/** Local extraction: fewer effective lines, no new external modules. */
const NEW_EXTRACTED = [
  "import { helper } from './helper';",
  'function stepOf(values, index) {',
  '  return values[index % 5] + index;',
  '}',
  'export function calculate(values) {',
  '  return helper(stepOf(values, 0));',
  '}',
  '',
].join('\n');

/**
 * Apply a published per-unit formula to a measured metric value.
 *
 * @param metricValue - Measured metric delta.
 * @param perUnit - Published per-unit weight.
 * @returns The expected dimension delta.
 */
function expectedDelta(metricValue, perUnit) {
  return Math.round(-metricValue * perUnit * 10) / 10;
}

const defaultWeights = {
  couplingPerUnit: 2,
  effectiveLocPerLine: 0.5,
  complexityPerUnit: 3,
  duplicationPerLine: 1,
};

const coupled = scoreDiff(OLD_LOCAL, NEW_COUPLED);
const extracted = scoreDiff(OLD_LOCAL, NEW_EXTRACTED);

assert.strictEqual(
  coupled.verdict,
  'FAILED',
  `deleting lines while coupling grows must stay rejected, got ${coupled.verdict}`,
);
assert.ok(
  coupled.metrics.effectiveLocDelta < 0,
  'the anti-pattern must actually shrink the effective LOC',
);
assert.ok(coupled.metrics.couplingDelta > 0, 'the anti-pattern must actually grow coupling');
assert.ok(
  coupled.dimensionDeltas.architectureConsistency < 0,
  `coupling growth must lower architectureConsistency, got
      ${coupled.dimensionDeltas.architectureConsistency}`,
);
assert.ok(
  coupled.dimensionDeltas.maintainability > 0,
  'the LOC reduction alone is a maintainability gain, which is exactly why the verdict ' +
    'cannot be line-count based',
);
// The performance delta must equal the published formula applied to the measured proxy. Whether
// that proxy rises is a property of the fixture, not of the wiring, so only the
// identity is asserted.
assert.strictEqual(
  coupled.dimensionDeltas.performanceEfficiency,
  expectedDelta(coupled.metrics.complexityDelta, defaultWeights.complexityPerUnit),
  'performanceEfficiency must equal the published complexity formula',
);
assert.strictEqual(
  coupled.dimensionDeltas.architectureConsistency,
  expectedDelta(coupled.metrics.couplingDelta, defaultWeights.couplingPerUnit),
  'architectureConsistency must equal the published coupling formula',
);
console.log(
  `  [PASS] anti-pattern judged by dimensions: verdict=${coupled.verdict}, ` +
    `architecture=${coupled.dimensionDeltas.architectureConsistency}, ` +
    `maintainability=${coupled.dimensionDeltas.maintainability}`,
);

assert.strictEqual(
  extracted.verdict,
  'PASSED',
  `a local extraction must pass, got ${extracted.verdict}`,
);
assert.ok(
  !extracted.dimensionDeltas.architectureConsistency ||
    extracted.dimensionDeltas.architectureConsistency >= 0,
  'a local extraction must not lower architectureConsistency',
);
assert.ok(
  extracted.dimensionDeltas.maintainability >= 0,
  'a local extraction must not lower maintainability',
);
console.log('  [PASS] local extraction stays non-negative on architecture and maintainability');

assert.deepStrictEqual(
  coupled.formulas.weights,
  defaultWeights,
  'the published per-unit weights must be the applied ones',
);
for (const key of [
  'architectureConsistency',
  'performanceEfficiency',
  'maintainability',
  'duplication',
]) {
  assert.ok(
    typeof coupled.formulas[key] === 'string' && coupled.formulas[key].length > 0,
    `${key} must publish its formula`,
  );
}
assert.ok(
  coupled.rationale.every((line) => line.includes('Delta')),
  'each rationale must name the metric it came from',
);
console.log('  [PASS] formulas and rationale published for every emitted dimension');

console.log('\n ALL DIFF SCORE CHECKS PASSED SUCCESSFULLY!\n');
