#!/usr/bin/env node
/**
 * Module: Verification Harness — Static Analysis Plane (SAP) Quality Model
 * File Path: scripts/validate-static-quality-model.js
 * Architecture Role: Automated verification suite asserting the mathematical correctness
 *   of the Static Analysis Plane (SAP) quality vector Q_s = (A, M, P, D, T, R, E), the static
 *   issue risk confidence formula S_i = P_i * C_i * I_i, and vector space delta calculations.
 * Dependencies & Triggers: `npm test` or `node scripts/validate-static-quality-model.js`;
 *   imports dist/api.
 * Responsibilities:
 *   1. Validate seven-axis vector synthesis from fine-grained indicators.
 *   2. Validate S_i = P_i * C_i * I_i with reach-aware blast radius and confidence.
 *   3. Validate static vector deltas, Euclidean distance, and cosine similarity.
 * Exit Semantics & Design Rationale: Exits 0 on all tests passing, 1 on any assertion error.
 */
'use strict';

const assert = require('assert');
const {
  ALL_STATIC_QUALITY_AXES,
  STATIC_AXIS_NAMES,
  DEFAULT_STATIC_WEIGHTS,
  synthesizeStaticQualityVector,
  computeStaticQualityScore,
  computeStaticIssueRisk,
  computeStaticVectorDelta,
  pillarToStaticAxis,
} = require('../dist/api');

async function main() {
  console.log('=== [Static Analysis Plane] Testing Static Quality Model & S_i = P_i * C_i * I_i ===\n');

  // 1. Static Quality Axis Definitions & Completeness
  console.log('1. Testing Seven Static Quality Axes...');
  assert.strictEqual(ALL_STATIC_QUALITY_AXES.length, 7);
  assert.deepStrictEqual([...ALL_STATIC_QUALITY_AXES], ['A', 'M', 'P', 'D', 'T', 'R', 'E']);
  assert.strictEqual(STATIC_AXIS_NAMES.A, 'architectureQuality');
  assert.strictEqual(STATIC_AXIS_NAMES.M, 'maintainability');
  assert.strictEqual(STATIC_AXIS_NAMES.P, 'algorithmAndPerformance');
  assert.strictEqual(STATIC_AXIS_NAMES.D, 'dataArchitecture');
  assert.strictEqual(STATIC_AXIS_NAMES.T, 'testQuality');
  assert.strictEqual(STATIC_AXIS_NAMES.R, 'reliability');
  assert.strictEqual(STATIC_AXIS_NAMES.E, 'extensibility');

  const weightSum = Object.values(DEFAULT_STATIC_WEIGHTS).reduce((acc, w) => acc + w, 0);
  assert.ok(Math.abs(weightSum - 1.0) < 1e-6, `Default weights must sum to 1.0 (got ${weightSum})`);
  console.log('✔ Seven static quality axes and default weights verified.');

  // 2. Vector Synthesis Q_s = (A, M, P, D, T, R, E)
  console.log('2. Testing Static Quality Vector Synthesis...');
  const fineGrainedIndices = {
    architectureConsistency: 92.0,
    maintainability: 88.0,
    performanceEfficiency: 95.0,
    codeSecurity: 100.0,
    semanticPurity: 90.0,
    techDebtRisk: 80.0,
    standardization: 85.0,
    commentQuality: 90.0,
    duplication: 95.0,
    modernity: 82.0,
  };

  const vector = synthesizeStaticQualityVector(fineGrainedIndices);
  assert.strictEqual(vector.A, 92.0);
  assert.strictEqual(vector.M, 88.0);
  assert.strictEqual(vector.P, 95.0);
  assert.strictEqual(vector.D, 92.0); // defaults to architectureConsistency
  assert.strictEqual(vector.T, 82.0); // modernity
  assert.strictEqual(vector.R, 85.0); // (90 + 80) / 2
  assert.strictEqual(vector.E, 90.0); // (85 + 90 + 95) / 3

  const score = computeStaticQualityScore(vector);
  assert.ok(score >= 85.0 && score <= 95.0, `Score out of expected range: ${score}`);
  console.log(`✔ Static quality vector synthesized: score=${score}, Q_s=${JSON.stringify(vector)}`);

  // Vector with explicit overrides
  const overriddenVector = synthesizeStaticQualityVector(fineGrainedIndices, {
    D: 99.0,
    T: 98.0,
  });
  assert.strictEqual(overriddenVector.D, 99.0);
  assert.strictEqual(overriddenVector.T, 98.0);
  console.log('✔ Static quality vector overrides verified.');

  // 3. Static Issue Risk Confidence Model: S_i = P_i * C_i * I_i
  console.log('3. Testing Static Issue Risk Confidence Formulation S_i = P_i * C_i * I_i...');
  
  // Case A: High-confidence, cross-domain architectural breach
  const archIssue = {
    id: 'arch-cross-domain-1',
    analyzer: 'architecture',
    rule: 'ARCH-HDL-001',
    severity: 'error',
    message: 'Domain circular dependency across boundaries',
    location: { file: 'src/core/model.ts', start: { line: 10, column: 1 }, end: { line: 10, column: 40 } },
  };

  const archRisk = computeStaticIssueRisk(archIssue, {
    ruleProbability: 1.0,
    semanticConfidence: 1.0,
    impactScope: 'cross_domain',
  });

  assert.strictEqual(archRisk.P, 1.0);
  assert.strictEqual(archRisk.C, 1.0);
  assert.strictEqual(archRisk.I, 7.5);
  assert.strictEqual(archRisk.rawRisk, 7.5);
  assert.strictEqual(archRisk.affectedAxis, 'A');
  console.log(`✔ Cross-domain architectural issue risk: S_i = ${archRisk.rawRisk} (Axis: ${archRisk.affectedAxis})`);

  // Case B: Low-confidence, local variable smell
  const localSmell = {
    id: 'hyg-local-1',
    analyzer: 'hygiene',
    rule: 'HYG-NAM-001',
    severity: 'info',
    message: 'Local variable naming abbreviation',
    location: { file: 'src/utils/math.ts', start: { line: 42, column: 5 }, end: { line: 42, column: 10 } },
  };

  const localRisk = computeStaticIssueRisk(localSmell, {
    ruleProbability: 0.8,
    semanticConfidence: 0.7,
    impactScope: 'local',
  });

  assert.strictEqual(localRisk.P, 0.8);
  assert.strictEqual(localRisk.C, 0.7);
  assert.strictEqual(localRisk.I, 1.0);
  assert.strictEqual(Math.round(localRisk.rawRisk * 100) / 100, 0.56);
  assert.strictEqual(localRisk.affectedAxis, 'E');
  console.log(`✔ Local hygiene issue risk dampened: S_i = ${localRisk.rawRisk.toFixed(2)} (Axis: ${localRisk.affectedAxis})`);

  // Case C: Performance hotspot (transient loop allocation)
  const perfIssue = {
    id: 'perf-loop-1',
    analyzer: 'performance',
    rule: 'PRF-MEM-001',
    severity: 'warning',
    message: 'Transient allocation in hot loop',
    location: { file: 'src/core/solver.ts', start: { line: 88, column: 1 }, end: { line: 88, column: 30 } },
  };

  const perfRisk = computeStaticIssueRisk(perfIssue, {
    impactScope: 'file',
  });
  assert.strictEqual(perfRisk.P, 1.0);
  assert.strictEqual(perfRisk.C, 0.9); // default for performance analyzer
  assert.strictEqual(perfRisk.I, 2.5); // reach file
  assert.strictEqual(Math.round(perfRisk.rawRisk * 100) / 100, 2.25);
  assert.strictEqual(perfRisk.affectedAxis, 'P');
  console.log(`✔ Performance issue risk verified: S_i = ${perfRisk.rawRisk.toFixed(2)} (Axis: ${perfRisk.affectedAxis})`);

  // 4. Vector Delta & Directional Shift
  console.log('4. Testing Static Vector Space Delta & Metric Progress...');
  const beforeVector = {
    A: 70.0,
    M: 65.0,
    P: 80.0,
    D: 75.0,
    T: 60.0,
    R: 70.0,
    E: 70.0,
  };

  const afterVector = {
    A: 85.0,
    M: 90.0,
    P: 95.0,
    D: 85.0,
    T: 80.0,
    R: 85.0,
    E: 80.0,
  };

  const delta = computeStaticVectorDelta(beforeVector, afterVector);
  assert.strictEqual(delta.deltaVector.A, 15.0);
  assert.strictEqual(delta.deltaVector.M, 25.0);
  assert.strictEqual(delta.deltaVector.P, 15.0);
  assert.ok(delta.scalarDelta > 0, `Scalar delta must be positive (got ${delta.scalarDelta})`);
  assert.ok(delta.euclideanDistance > 0, `Euclidean distance must be positive (got ${delta.euclideanDistance})`);
  assert.ok(delta.cosineSimilarity >= 0.95, `Cosine similarity should reflect strong directional alignment: ${delta.cosineSimilarity}`);
  console.log(`✔ Vector delta computed: scalarΔ = +${delta.scalarDelta}, distance = ${delta.euclideanDistance}, cosθ = ${delta.cosineSimilarity}`);

  // 5. Pillar to Static Axis Mapping
  console.log('5. Testing Pillar to Static Axis Projection...');
  assert.strictEqual(pillarToStaticAxis('architecture'), 'A');
  assert.strictEqual(pillarToStaticAxis('maintainability'), 'M');
  assert.strictEqual(pillarToStaticAxis('performance'), 'P');
  assert.strictEqual(pillarToStaticAxis('data'), 'D');
  assert.strictEqual(pillarToStaticAxis('testing'), 'T');
  assert.strictEqual(pillarToStaticAxis('reliability'), 'R');
  assert.strictEqual(pillarToStaticAxis('security'), 'R');
  assert.strictEqual(pillarToStaticAxis('extensibility'), 'E');
  console.log('✔ Pillar to static axis mappings verified.');

  console.log('\n🎉 ALL STATIC ANALYSIS PLANE QUANTIFICATION TESTS PASSED!');
}

main().catch((err) => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
