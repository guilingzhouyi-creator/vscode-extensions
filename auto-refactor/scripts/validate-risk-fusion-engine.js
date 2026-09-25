#!/usr/bin/env node
/**
 * Module: Verification Harness — Dual-Plane Risk Fusion & Unified Scoring
 * File Path: scripts/validate-risk-fusion-engine.js
 * Architecture Role: Automated verification suite asserting the mathematical correctness
 *   of the Risk Fusion formula Risk_i = S_i^alpha * D_i^beta * H_i^gamma, dual-side confirmation
 *   escalation, single-sided cold path dampening, and adaptive unified scoring Q_total.
 * Dependencies & Triggers: `npm test` or `node scripts/validate-risk-fusion-engine.js`;
 *   imports dist/api.
 * Responsibilities:
 *   1. Validate dual-side confirmation escalation to CRITICAL.
 *   2. Validate single-sided noise suppression on cold paths.
 *   3. Validate hidden bottleneck capture.
 *   4. Validate adaptive weights W = f(Stage, Scale, Domain, Risk) and Q_total synthesis.
 * Exit Semantics & Design Rationale: Exits 0 on all tests passing, 1 on any assertion error.
 */
'use strict';

const assert = require('assert');
const {
  fuseIssueRisks,
  resolveAdaptiveFusionWeights,
  computeUnifiedQualityScore,
  computeStaticIssueRisk,
  computeDynamicHotspotRisk,
} = require('../dist/api');

async function main() {
  console.log('=== [Feedback Fusion Layer] Testing Risk Fusion Engine & Unified Scoring ===\n');

  // 1. Dual-Side Confirmation (Resonance Amplification)
  console.log('1. Testing Dual-Side Confirmation Escalation to CRITICAL...');
  const staticHotIssue = computeStaticIssueRisk(
    {
      id: 'arch-hot-loop',
      analyzer: 'architecture',
      rule: 'ARCH-HDL-001',
      severity: 'error',
      message: 'Critical boundary bypass',
      location: { file: 'src/core/dispatch.ts', start: { line: 10, column: 1 }, end: { line: 10, column: 20 } },
    },
    { impactScope: 'cross_domain' },
  ); // S_i = 7.5

  const dynamicHotTrace = computeDynamicHotspotRisk('trace_dispatch', {
    behavioralScope: 4.5,
    invocationsPerHour: 720000,
    resourceConsumption: 8.0,
    businessSensitivity: 4.5,
  }); // D_i is high

  const dualConfirmed = fuseIssueRisks(staticHotIssue, dynamicHotTrace, 1.2);
  assert.strictEqual(dualConfirmed.isDualConfirmed, true);
  assert.strictEqual(dualConfirmed.level, 'critical');
  assert.ok(dualConfirmed.fusedScore >= 20.0, `Dual-confirmed score should be critical: ${dualConfirmed.fusedScore}`);
  console.log(`✔ Dual-confirmed hotspot amplified to CRITICAL: Risk_i = ${dualConfirmed.fusedScore} (${dualConfirmed.level})`);

  // 2. Single-Sided Cold Path Dampening (False Positive Suppression)
  console.log('2. Testing Single-Sided Cold Path Noise Suppression...');
  const staticComplexColdIssue = computeStaticIssueRisk(
    {
      id: 'cpx-cold-tool',
      analyzer: 'complexity',
      rule: 'CPX-CC-001',
      severity: 'warning',
      message: 'High cyclomatic complexity in admin script',
      location: { file: 'src/admin/cleaner.ts', start: { line: 5, column: 1 }, end: { line: 5, column: 20 } },
    },
    { impactScope: 'file' },
  ); // S_i is high

  const dynamicColdTrace = computeDynamicHotspotRisk('trace_cleaner', {
    behavioralScope: 1.0,
    invocationsPerHour: 1, // invoked once an hour
    resourceConsumption: 1.0,
    businessSensitivity: 1.0,
  }); // D_i is very low

  const dampened = fuseIssueRisks(staticComplexColdIssue, dynamicColdTrace, 1.0);
  assert.strictEqual(dampened.suppressionApplied, true);
  assert.ok(dampened.level === 'low' || dampened.level === 'informational', `Dampened level should be low: ${dampened.level}`);
  assert.ok(dampened.fusedScore < 4.0, `Dampened score should be small: ${dampened.fusedScore}`);
  console.log(`✔ Cold path high complexity dampened: Risk_i = ${dampened.fusedScore} (${dampened.level})`);

  // 3. Hidden Runtime Bottleneck Capture
  console.log('3. Testing Hidden Runtime Bottleneck Capture...');
  const staticMinorIssue = computeStaticIssueRisk(
    {
      id: 'minor-call',
      analyzer: 'hygiene',
      rule: 'HYG-NAM-001',
      severity: 'info',
      message: 'Minor variable name issue',
      location: { file: 'src/core/loop.ts', start: { line: 12, column: 1 }, end: { line: 12, column: 10 } },
    },
    { impactScope: 'local' },
  ); // S_i ~ 0.56

  const dynamicHeavyBottleneck = computeDynamicHotspotRisk('trace_lock_bottleneck', {
    behavioralScope: 4.0,
    invocationsPerHour: 500000,
    resourceConsumption: 9.0,
    businessSensitivity: 5.0,
  }); // D_i >= 5.0

  const bottleneck = fuseIssueRisks(staticMinorIssue, dynamicHeavyBottleneck, 1.0);
  assert.ok(bottleneck.fusedScore >= 1.5, `Hidden bottleneck must elevate risk score: ${bottleneck.fusedScore}`);
  console.log(`✔ Hidden runtime bottleneck captured: Risk_i = ${bottleneck.fusedScore} (${bottleneck.level})`);

  // 4. Adaptive Project Weights W = f(Stage, Scale, Domain, Risk)
  console.log('4. Testing Adaptive Project Weights Resolution...');
  const frameworkWeights = resolveAdaptiveFusionWeights({ domain: 'core_framework', stage: 'production' }, true);
  assert.strictEqual(frameworkWeights.Ws, 0.55);
  assert.strictEqual(frameworkWeights.Wd, 0.30);
  assert.strictEqual(frameworkWeights.Wf, 0.15);

  const algorithmWeights = resolveAdaptiveFusionWeights({ domain: 'algorithm_lib', stage: 'production' }, true);
  assert.strictEqual(algorithmWeights.Ws, 0.35);
  assert.strictEqual(algorithmWeights.Wd, 0.50);
  assert.strictEqual(algorithmWeights.Wf, 0.15);

  const missingTelemetryWeights = resolveAdaptiveFusionWeights({ domain: 'core_framework' }, false);
  assert.strictEqual(missingTelemetryWeights.Wd, 0.0);
  assert.strictEqual(missingTelemetryWeights.Ws, 0.85);
  console.log('✔ Adaptive weights correctly tilt across core_framework, algorithm_lib, and missing telemetry.');

  // 5. Total Unified Quality Score Q_total = W_s*Q_s + W_d*Q_d + W_f*Q_f
  console.log('5. Testing Total Unified Quality Score Calculation...');
  const staticVector = { A: 90.0, M: 85.0, P: 95.0, D: 90.0, T: 80.0, R: 85.0, E: 90.0 };
  const dynamicVector = { L: 95.0, T: 90.0, M: 95.0, C: 92.0, E: 85.0 };

  const assessment = computeUnifiedQualityScore(staticVector, dynamicVector, 100.0, {
    domain: 'algorithm_lib',
  });

  assert.ok(assessment.totalScore >= 88.0 && assessment.totalScore <= 96.0);
  assert.ok(assessment.explanation.includes('Unified quality synthesized: Q_total='));
  console.log(`✔ Unified assessment computed: Q_total = ${assessment.totalScore}/100 [Ws=${assessment.weights.Ws}, Wd=${assessment.weights.Wd}, Wf=${assessment.weights.Wf}]`);

  console.log('\n🎉 ALL FEEDBACK FUSION LAYER TESTS PASSED!');
}

main().catch((err) => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
