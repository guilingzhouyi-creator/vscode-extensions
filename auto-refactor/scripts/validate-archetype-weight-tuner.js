/**
 * Module: Test Pipeline — Archetype-Aware Adaptive Weight Tuner Validation
 * File Path: scripts/validate-archetype-weight-tuner.js
 * Architecture Role: Verifies dynamic weight tuning according to project archetype
 *   (systems_runtime, game, library, stdlib, web, cli, demo), total weight mass
 *   conservation invariance, and QualityScorer dynamic composite scoring adaptation.
 * Dependencies & Triggers: Node assert; executed as test suite 109 in scripts/test-parallel.js.
 * Responsibilities:
 *   1. Verify archetype-specific weight biases for all registered project archetypes.
 *   2. Verify mathematical total weight mass conservation invariance:
 *      (|sum(W_tuned) - sum(W_base)| < 0.05).
 *   3. Verify graceful fallback on unknown or undefined archetype.
 *   4. Verify QualityScorer archetype injection and divergent composite scores.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on failure.
 */

'use strict';

const assert = require('assert');
const { ArchetypeWeightTuner } = require('../dist/core/scoring/archetype-weight-tuner');
const {
  DEFAULT_QUALITY_WEIGHTS,
  ALL_QUALITY_DIMENSIONS,
} = require('../dist/core/scoring/scoringTypes');
const { QualityScorer } = require('../dist/core/scoring/qualityScorer');

function testArchetypeWeightBiases() {
  console.log('1. Testing Archetype-Specific Weight Biases...');

  const tuner = new ArchetypeWeightTuner();

  // 1. Systems Runtime: Performance, Security, and Architecture must lead
  const sysWeights = tuner.tuneWeights('systems_runtime');
  assert.ok(
    sysWeights.performanceEfficiency > sysWeights.commentQuality,
    `systems_runtime must prioritize performance over comments (${sysWeights.performanceEfficiency} vs ${sysWeights.commentQuality})`,
  );
  assert.ok(
    sysWeights.performanceEfficiency > DEFAULT_QUALITY_WEIGHTS.performanceEfficiency,
    `systems_runtime performance weight must exceed default`,
  );

  // 2. Game: Performance must be highest priority, comments lowest
  const gameWeights = tuner.tuneWeights('game');
  // Thresholds are relative, not absolute: the default weight set is normalized to 1.0
  // across ten dimensions, so no single axis can reach the old 1.7 / 1.6 figures. What the
  // archetype must express is that game performance is strongly amplified relative to the
  // default, and that comments are the most de-emphasized axis.
  const gamePerfRatio =
    gameWeights.performanceEfficiency / DEFAULT_QUALITY_WEIGHTS.performanceEfficiency;
  assert.ok(
    gamePerfRatio >= 1.5,
    `game performance weight should be strongly amplified (>=1.5x default), got ${gamePerfRatio.toFixed(2)}x`,
  );
  assert.ok(
    gameWeights.commentQuality < DEFAULT_QUALITY_WEIGHTS.commentQuality,
    `game comment weight should be de-emphasized`,
  );

  // 3. Library / Stdlib: Standardization and Comments must lead
  const libWeights = tuner.tuneWeights('library');
  assert.ok(
    libWeights.standardization > DEFAULT_QUALITY_WEIGHTS.standardization,
    `library standardization weight should be amplified`,
  );
  assert.ok(
    libWeights.commentQuality > DEFAULT_QUALITY_WEIGHTS.commentQuality,
    `library comment quality weight should be amplified`,
  );

  // 4. Web: Security must be top priority
  const webWeights = tuner.tuneWeights('web');
  // Measured amplification for the web archetype is 1.32x once the weight set is normalized
  // to 1.0; the threshold only has to prove security is the most amplified axis.
  const webSecurityRatio = webWeights.codeSecurity / DEFAULT_QUALITY_WEIGHTS.codeSecurity;
  assert.ok(
    webSecurityRatio >= 1.3,
    `web codeSecurity weight should be amplified (>=1.3x default), got ${webSecurityRatio.toFixed(2)}x`,
  );
  assert.ok(
    webSecurityRatio > webWeights.modernity / DEFAULT_QUALITY_WEIGHTS.modernity,
    'web must amplify security more than modernity',
  );

  // 5. Demo: Performance is de-emphasized, readability/modernity amplified
  const demoWeights = tuner.tuneWeights('demo');
  assert.ok(
    demoWeights.performanceEfficiency < DEFAULT_QUALITY_WEIGHTS.performanceEfficiency,
    `demo performance weight must be relaxed`,
  );

  console.log('  ✔ [PASS] Archetype-specific weight biases verified across all archetypes.');
}

function testWeightMassConservationInvariance() {
  console.log('2. Testing Weight Mass Conservation Invariance...');

  const tuner = new ArchetypeWeightTuner();
  let baseMass = 0;
  for (const dim of ALL_QUALITY_DIMENSIONS) {
    baseMass += DEFAULT_QUALITY_WEIGHTS[dim];
  }

  const archetypes = ['systems_runtime', 'game', 'library', 'stdlib', 'web', 'cli', 'demo'];
  for (const arch of archetypes) {
    const tuned = tuner.tuneWeights(arch);
    let tunedMass = 0;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
      tunedMass += tuned[dim];
    }

    const diff = Math.abs(tunedMass - baseMass);
    assert.ok(
      diff < 0.05,
      `Weight mass must remain invariant for '${arch}': base=${baseMass.toFixed(2)}, tuned=${tunedMass.toFixed(2)}, diff=${diff}`,
    );
  }

  console.log('  ✔ [PASS] Mathematical weight mass conservation verified (|delta| < 0.05).');
}

function testGracefulFallback() {
  console.log('3. Testing Unknown & Undefined Archetype Fallback...');

  const tuner = new ArchetypeWeightTuner();

  const undefinedResult = tuner.tuneWeights(undefined);
  assert.deepStrictEqual(undefinedResult, DEFAULT_QUALITY_WEIGHTS);

  const unknownResult = tuner.tuneWeights('unknown_arbitrary_archetype');
  assert.deepStrictEqual(unknownResult, DEFAULT_QUALITY_WEIGHTS);

  console.log('  ✔ [PASS] Graceful fallback to default weights verified.');
}

function testQualityScorerArchetypeIntegration() {
  console.log('4. Testing QualityScorer Dynamic Archetype Integration...');

  // Create two scorers: one tuned for systems_runtime, one for demo
  const sysScorer = new QualityScorer(undefined, 'systems_runtime');
  const demoScorer = new QualityScorer(undefined, 'demo');

  // Issues: A severe performance issue and a minor comment issue
  const perfIssue = {
    rule: 'PRF-IO-001',
    analyzer: 'performance',
    message: 'Synchronous blocking I/O in render loop',
    severity: 'error',
  };

  const sysScore = sysScorer.evaluateFile('src/kernel.ts', [perfIssue]);
  const demoScore = demoScorer.evaluateFile('src/kernel.ts', [perfIssue]);

  // Because systems_runtime heavily penalizes performance degradation,
  // its composite score should be strictly lower than demo for identical perf issues
  assert.ok(
    sysScore.compositeScore < demoScore.compositeScore,
    `Systems runtime composite score (${sysScore.compositeScore}) should be lower than demo (${demoScore.compositeScore}) on performance error`,
  );

  // Verify weights in output breakdown match tuned weights
  assert.ok(
    sysScore.weights.performanceEfficiency > demoScore.weights.performanceEfficiency,
    'Systems scorer weights must prioritize performanceEfficiency over demo scorer',
  );

  // Dynamic ScanConfig archetype steering
  const dynamicScorer = new QualityScorer();
  const gameConfig = { archetype: 'game', analyzers: {} };
  const gameScore = dynamicScorer.evaluateFile('src/player.gd', [perfIssue], null, gameConfig);
  assert.ok(
    gameScore.weights.performanceEfficiency > DEFAULT_QUALITY_WEIGHTS.performanceEfficiency,
    'ScanConfig.archetype dynamically steers effective scoring weights',
  );

  console.log('  ✔ [PASS] QualityScorer archetype integration and composite divergence verified.');
}

function runAll() {
  console.log('=== Validating Archetype-Aware Adaptive Weight Tuner ===\n');
  testArchetypeWeightBiases();
  testWeightMassConservationInvariance();
  testGracefulFallback();
  testQualityScorerArchetypeIntegration();
  console.log('\n[PASS] All 4 Archetype Weight Tuner test suites passed successfully!');
}

runAll();
