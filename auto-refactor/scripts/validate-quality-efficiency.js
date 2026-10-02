/**
 * Module: Verification Harness — Quality Evolution & Efficiency Engine Tests
 * File Path: scripts/validate-quality-efficiency.js
 * Architecture Role: Verifies QED (Quality Efficiency of Delta), ReviewYield, RegressionDensity,
 *   10-dimensional vector transformations, and anti-gaming debouncing.
 * Dependencies & Triggers: Consumes dist/core trajectory and scoring modules;
 *   executed in test-parallel.js.
 * Responsibilities: Validate vector transformations, QED calculations, and metrics formulas.
 * Exit Semantics & Design Rationale: Exits 0 on assertions pass, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const {
  recordToVector,
  vectorToRecord,
  computeCompositeFromVector,
  computeTrajectoryQualityMetrics,
} = require('../dist/core/trajectory/quality-efficiency-engine');
const { ALL_QUALITY_DIMENSIONS } = require('../dist/core/scoring/scoringTypes');

function runTests() {
  console.log('🧪 Running Quality Efficiency & Evolution Engine Validation Suite...');

  // --- Test 1: 10-Dimensional Vector Bijective Transformation ---
  console.log('  ▶ [Test 1] Testing 10-dimensional vector <-> record bijection...');
  const originalRecord = {
    architectureConsistency: 95,
    semanticPurity: 90,
    codeSecurity: 100,
    performanceEfficiency: 85,
    standardization: 88,
    modernity: 92,
    maintainability: 89,
    commentQuality: 80,
    duplication: 94,
    techDebtRisk: 96,
  };

  const vector = recordToVector(originalRecord);
  assert.strictEqual(vector.length, 10, 'Vector must contain exactly 10 dimension indices');
  assert.strictEqual(vector.length, ALL_QUALITY_DIMENSIONS.length);

  const reconstructed = vectorToRecord(vector);
  for (const dim of ALL_QUALITY_DIMENSIONS) {
    assert.strictEqual(reconstructed[dim], originalRecord[dim], `Dimension ${dim} must match`);
  }
  console.log('    ✔ 10-dimensional vector bijection verified');

  // --- Test 2: Composite Score Derivation ---
  console.log('  ▶ [Test 2] Testing composite score derivation from 10-dimensional vector...');
  const compositeScore = computeCompositeFromVector(vector);
  assert.ok(
    compositeScore >= 85 && compositeScore <= 98,
    `Composite score ${compositeScore} should be in valid range`,
  );
  console.log(`    ✔ Composite score calculation verified (result: ${compositeScore})`);

  // --- Test 3: Standard Positive Refactoring QED & ReviewYield ---
  console.log(
    '  ▶ [Test 3] Testing legitimate refactoring metrics (positive QED and high ReviewYield)...',
  );
  const legitCounters = {
    processed: 2500,
    unique: 1200,
    changed: 40,
    semantic: 35,
    relocated: 0,
    cosmetic: 5,
    boilerplate: 0,
    added: 20,
    deleted: 20,
    modified: 20,
  };

  const legitDebt = {
    addedDebtPoints: 0,
    resolvedDebtPoints: 15,
    netDebtCleared: 15,
    regressionFindingsCount: 0,
    regressionFindingIds: [],
  };

  const metricsLegit = computeTrajectoryQualityMetrics({
    beforeScore: 82.5,
    afterScore: 86.0, // +3.5 ΔQ
    scoreVector: vector,
    counters: legitCounters,
    debtDelta: legitDebt,
  });

  assert.strictEqual(metricsLegit.deltaQSemantic, 3.5, 'ΔQ semantic should be +3.5');
  assert.strictEqual(metricsLegit.qed, 0.1, 'QED must be 3.5 / 35 = 0.1000');
  assert.strictEqual(metricsLegit.reviewYield, 7.4, 'ReviewYield must equal 7.4');
  assert.strictEqual(metricsLegit.regressionDensity, 0, 'RegressionDensity must be 0');
  assert.strictEqual(metricsLegit.gamingPenalty, 0, 'No gaming penalty for legitimate refactoring');
  console.log('    ✔ Legitimate refactoring metrics verified');

  // --- Test 4: Regression Detection & RegressionDensity ---
  console.log('  ▶ [Test 4] Testing regression detection and RegressionDensity calculation...');
  const regressedDebt = {
    addedDebtPoints: 10,
    resolvedDebtPoints: 0,
    netDebtCleared: -10,
    regressionFindingsCount: 2,
    regressionFindingIds: ['SEC-001', 'PRF-002'],
  };

  const metricsRegression = computeTrajectoryQualityMetrics({
    beforeScore: 88.0,
    afterScore: 82.0, // -6.0 ΔQ
    scoreVector: vector,
    counters: legitCounters,
    debtDelta: regressedDebt,
  });

  assert.strictEqual(metricsRegression.deltaQSemantic, -6.0, 'ΔQ semantic should be -6.0');
  assert.ok(metricsRegression.qed < 0, 'QED must be negative on regression');
  assert.strictEqual(
    metricsRegression.regressionDensity,
    57.14,
    'RegressionDensity must equal 57.14 findings / kELOC',
  );
  console.log('    ✔ Regression density metrics verified');

  // --- Test 5: Anti-Gaming Debouncing for Superficial Churn ---
  console.log('  ▶ [Test 5] Testing anti-gaming suppression of superficial cosmetic churn...');
  const gamingCounters = {
    processed: 3000,
    unique: 1500,
    changed: 100, // 100 lines changed
    semantic: 0, // but 0 semantic! (all cosmetic/whitespace)
    relocated: 0,
    cosmetic: 100,
    boilerplate: 0,
    added: 50,
    deleted: 50,
    modified: 50,
  };

  const gamingDebt = {
    addedDebtPoints: 0,
    resolvedDebtPoints: 0,
    netDebtCleared: 0,
    regressionFindingsCount: 0,
    regressionFindingIds: [],
  };

  const metricsGaming = computeTrajectoryQualityMetrics({
    beforeScore: 80.0,
    afterScore: 85.0, // Agent claims +5 score via cosmetic reformat
    scoreVector: vector,
    counters: gamingCounters,
    debtDelta: gamingDebt,
  });

  assert.strictEqual(
    metricsGaming.deltaQSemantic,
    0,
    'ΔQ semantic must be 0 when semantic ELOC is 0',
  );
  assert.strictEqual(metricsGaming.qed, 0, 'QED must be 0 for superficial churn');
  assert.ok(
    metricsGaming.gamingPenalty > 0,
    'Gaming penalty must be triggered for large superficial churn',
  );
  console.log(
    `    ✔ Anti-gaming penalty debouncing verified (penalty: ${metricsGaming.gamingPenalty})`,
  );

  console.log('\n🎉 ALL Phase 2 Quality Evolution & Efficiency Engine Tests PASSED!\n');
}

runTests();
