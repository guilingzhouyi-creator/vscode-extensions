#!/usr/bin/env node
/**
 * Module: Verification Harness — Feedback Adaptive Supervisor Guard
 * File Path: scripts/validate-feedback-adaptive-supervisor.js
 * Architecture Role: Automated verification suite asserting the mathematical correctness
 *   of weight evolution W_{t+1} = W_t + eta * Error * Gradient, Incident & Rollback Ledger
 *   tracking, rule confidence dampening, and architectural pattern stability boosts.
 * Dependencies & Triggers: `npm test` or `node scripts/validate-feedback-adaptive-supervisor.js`;
 *   imports dist/api.
 * Responsibilities:
 *   1. Validate incident ledger logging, rollback accounting, and milestone tracking.
 *   2. Assert rule confidence dampening down to bounded interval for high-reversion rules.
 *   3. Assert architectural pattern stability boosts up to 1.25 for proven zero-defect patterns.
 *   4. Verify gradient descent weight adaptation W_{t+1} on discrepancy errors.
 *   5. Verify ledger export/import persistence and governance summary reporting.
 * Exit Semantics & Design Rationale: Exits 0 on all tests passing, 1 on any assertion error.
 */
'use strict';

const assert = require('assert');
const {
  FeedbackIncidentLedger,
  FeedbackAdaptiveSupervisor,
} = require('../dist/api');

async function main() {
  console.log('=== [Feedback Adaptive Supervisor] Testing Closed-Loop Governance ===\n');

  // 1. Incident Ledger & Rollback Tracking
  console.log('1. Testing Incident Ledger & Rule Rollback Tracking...');
  const ledger = new FeedbackIncidentLedger();

  // Record normal adoptions
  ledger.recordRuleAdoption('RULE-LOOP-001');
  ledger.recordRuleAdoption('RULE-LOOP-001');

  const beforeRollback = ledger.getRuleReliability('RULE-LOOP-001');
  assert.strictEqual(beforeRollback.adoptions, 2);
  assert.strictEqual(beforeRollback.rollbacks, 0);
  assert.strictEqual(beforeRollback.confidenceMultiplier, 1.0);

  // Record multiple rollbacks for a problematic rule
  ledger.recordRuleRollback(
    'RULE-MAP-CONVERT',
    'src/core/engine/hot-loop.ts',
    'Reverted: map allocation caused 120ms GC pause in 60fps frame cycle',
    90.0,
    15.0
  );
  ledger.recordRuleRollback(
    'RULE-MAP-CONVERT',
    'src/core/network/packet-processor.ts',
    'Reverted: performance regression in high-throughput network loop',
    88.0,
    22.0
  );

  const dampenedStats = ledger.getRuleReliability('RULE-MAP-CONVERT');
  assert.strictEqual(dampenedStats.rollbacks, 2);
  assert.ok(
    dampenedStats.confidenceMultiplier <= 0.6,
    `Multiplier should be heavily dampened: got ${dampenedStats.confidenceMultiplier}`
  );
  assert.ok(
    dampenedStats.confidenceMultiplier >= 0.2,
    `Multiplier must respect floor: got ${dampenedStats.confidenceMultiplier}`
  );
  console.log(
    `✔ Rule confidence dampening confirmed: ` +
    `RULE-MAP-CONVERT multiplier = ${dampenedStats.confidenceMultiplier}`
  );

  // 2. Architectural Stability Milestones
  console.log('2. Testing Architectural Stability Boosts...');
  ledger.recordStabilityMilestone('zero_transient_pooling', 'WebGames/scripts/bullet_spawner.gd');
  ledger.recordStabilityMilestone('zero_transient_pooling', 'WebGames/scripts/particle_pipeline.gd');
  ledger.recordStabilityMilestone('zero_transient_pooling', 'WebGames/scripts/state_broadcaster.gd');

  const patternStats = ledger.getPatternStability('zero_transient_pooling');
  assert.strictEqual(patternStats.milestoneCount, 3);
  assert.ok(
    patternStats.stabilityBoostFactor >= 1.15,
    `Pattern boost should be >= 1.15, got ${patternStats.stabilityBoostFactor}`
  );
  assert.ok(patternStats.stabilityBoostFactor <= 1.25, `Pattern boost must not exceed 1.25`);
  console.log(
    `✔ Architectural stability boost confirmed: ` +
    `zero_transient_pooling factor = ${patternStats.stabilityBoostFactor}`
  );

  // 3. Weight Evolution: W_{t+1} = W_t + eta * Error * Gradient
  console.log('3. Testing Adaptive Tri-Plane Weight Evolution (Gradient Descent)...');
  const initialWeights = { Ws: 0.50, Wd: 0.35, Wf: 0.15 };
  const supervisor = new FeedbackAdaptiveSupervisor(ledger, initialWeights, 0.02);

  assert.deepStrictEqual(supervisor.getWeights(), initialWeights);

  // Scenario A: Severe runtime degradation / crash missed by static review
  // System predicted 92.0, actual outcome was 25.0 -> Error = -67.0
  const step1 = supervisor.evolveFromOutcome({
    predictedScore: 92.0,
    actualOutcomeScore: 25.0,
    attributionPlane: 'dynamic',
    reason: 'Thread lock under heavy concurrent load',
  });

  const updatedWeights = supervisor.getWeights();
  assert.strictEqual(step1.stepIndex, 1);
  assert.strictEqual(step1.error, -67.0);

  // Dynamic plane was underweighted and missed the runtime crash, so Wd should increase
  assert.ok(
    updatedWeights.Wd > initialWeights.Wd,
    `Dynamic weight Wd must increase: was ${initialWeights.Wd}, now ${updatedWeights.Wd}`
  );
  // Static plane should adjust downwards
  assert.ok(
    updatedWeights.Ws < initialWeights.Ws,
    `Static weight Ws must decrease: was ${initialWeights.Ws}, now ${updatedWeights.Ws}`
  );

  // Total weights must strictly sum to 1.0
  const weightSum =
    Math.round((updatedWeights.Ws + updatedWeights.Wd + updatedWeights.Wf) * 1000) / 1000;
  assert.strictEqual(weightSum, 1.0, `Weights must sum to 1.0: got ${weightSum}`);
  console.log(
    `✔ Adaptive step 1: [Ws: ${initialWeights.Ws} -> ${updatedWeights.Ws}, ` +
    `Wd: ${initialWeights.Wd} -> ${updatedWeights.Wd}, ` +
    `Wf: ${initialWeights.Wf} -> ${updatedWeights.Wf}]`
  );

  // Scenario B: Architecture regression missed by dynamic testing
  const step2 = supervisor.evolveFromOutcome({
    predictedScore: 88.0,
    actualOutcomeScore: 40.0,
    attributionPlane: 'static',
    reason: 'Cyclic dependency caused build break and cross-domain pollution',
  });

  const weightsAfterStatic = supervisor.getWeights();
  assert.strictEqual(step2.stepIndex, 2);
  assert.ok(
    weightsAfterStatic.Ws > updatedWeights.Ws,
    `Static weight Ws must re-increase: was ${updatedWeights.Ws}, now ${weightsAfterStatic.Ws}`
  );
  const sum2 =
    Math.round((weightsAfterStatic.Ws + weightsAfterStatic.Wd + weightsAfterStatic.Wf) * 1000) /
    1000;
  assert.strictEqual(sum2, 1.0, `Weights must sum to 1.0: got ${sum2}`);
  console.log(
    `✔ Adaptive step 2: [Ws: ${updatedWeights.Ws} -> ${weightsAfterStatic.Ws}, ` +
    `Wd: ${updatedWeights.Wd} -> ${weightsAfterStatic.Wd}, ` +
    `Wf: ${updatedWeights.Wf} -> ${weightsAfterStatic.Wf}]`
  );

  // 4. Rule Confidence Adjustment & Architecture Boost API
  console.log('4. Testing Rule Confidence Adjustment & Architecture Boost APIs...');
  const baseConf = 0.9;
  const adjustedConf = supervisor.adjustRuleConfidence('RULE-MAP-CONVERT', baseConf);
  assert.ok(
    adjustedConf < baseConf,
    `Adjusted confidence should be reduced from base ${baseConf}: got ${adjustedConf}`
  );

  const baseScore = 80.0;
  const boostedScore = supervisor.applyArchitectureBoost('zero_transient_pooling', baseScore);
  assert.ok(
    boostedScore > baseScore,
    `Boosted score should exceed base ${baseScore}: got ${boostedScore}`
  );
  console.log(
    `✔ Supervisor applied adjustments: Conf ${baseConf} -> ${adjustedConf}, ` +
    `Score ${baseScore} -> ${boostedScore}`
  );

  // 5. State Serialization & Restoration
  console.log('5. Testing Ledger State Persistence...');
  const exported = ledger.exportState();
  assert.ok(Array.isArray(exported.incidents));
  assert.ok(exported.incidents.length >= 3);
  assert.strictEqual(exported.ruleRollbacks['RULE-MAP-CONVERT'], 2);

  const restoredLedger = new FeedbackIncidentLedger();
  restoredLedger.importState(exported);
  const restoredStats = restoredLedger.getRuleReliability('RULE-MAP-CONVERT');
  assert.strictEqual(restoredStats.rollbacks, 2);
  assert.strictEqual(restoredStats.confidenceMultiplier, dampenedStats.confidenceMultiplier);
  console.log(`✔ Ledger state exported and restored identically across instances`);

  // 6. Governance Summary
  console.log('6. Testing Governance Summary Generation...');
  const summary = supervisor.generateGovernanceSummary();
  assert.ok(summary.totalIncidents >= 3);
  assert.ok(summary.rollbacksCount >= 2);
  assert.strictEqual(summary.evolutionStepsCount, 2);
  assert.ok(summary.dampenedRulesCount >= 1);
  assert.ok(summary.boostedPatternsCount >= 1);
  console.log(`✔ Governance summary generated: ${JSON.stringify(summary, null, 2)}`);

  console.log('\n✔ ALL FEEDBACK ADAPTIVE SUPERVISION TESTS PASSED!');
}

main().catch((err) => {
  console.error('\n✖ [FEEDBACK ADAPTIVE SUPERVISOR TEST FAILED]:', err);
  process.exit(1);
});
