/**
 * Module: Test Pipeline — Agent Refactoring ROI & Patch Safety Arbiter Validation
 * File Path: scripts/validate-refactoring-roi-arbiter.js
 * Architecture Role: Verifies automated agent patch arbitration
 *   (AUTO_APPLY, HUMAN_REVIEW, AUTO_REJECT), refactoring ROI, patch safety index,
 *   anti-gaming safeguards, and breaking API drift deterrence.
 * Dependencies & Triggers: Node assert; executed as test suite 113 in scripts/test-parallel.js.
 * Responsibilities:
 *   1. Verify AUTO_APPLY verdict for high-ROI, safe, regression-free refactoring patches.
 *   2. Verify AUTO_REJECT verdict for breaking API drift and score-gaming attempts.
 *   3. Verify HUMAN_REVIEW verdict for borderline or partially-covered changes.
 *   4. Verify ChangeQualityArbiter class facade and mathematical ROI accuracy.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on failure.
 */

'use strict';

const assert = require('assert');
const {
  arbitrateAgentPatch,
  ChangeQualityArbiter,
} = require('../dist/core/scoring/change-quality-arbiter');

function testAutoApplySafePatch() {
  console.log('1. Testing AUTO_APPLY for High-ROI Safe Refactoring Patch...');

  const input = {
    filePath: 'src/core/math-parser.ts',
    beforeContent: 'function parseExpression() { /* 80 lines of nested ifs */ }',
    afterContent:
      'function parseExpression() { return cleanPipeline(); }\nfunction cleanPipeline() {}',
    beforeScore: 65,
    afterScore: 85, // deltaQ = +20
    existingIssues: [{ rule: 'CPX-HOP-001', severity: 'warning', message: 'jump' }],
    newIssues: [],
    regressionIssues: [],
  };

  const arbiter = new ChangeQualityArbiter();
  const result = arbiter.arbitratePatch(input, {
    centralityMultiplier: 1.5,
    hasApiDrift: false,
    uncoveredRiskScore: 0.0,
    semanticBleedScore: 0.0,
  });

  assert.strictEqual(result.decision, 'AUTO_APPLY');
  assert.ok(result.safety.safetyIndex >= 0.95);
  assert.ok(result.roi.roi >= 2.0);
  assert.strictEqual(result.baseEvaluation.verdict, 'approved');

  console.log('  ✔ [PASS] AUTO_APPLY verdict verified.');
}

function testAutoRejectDangerousPatches() {
  console.log('2. Testing AUTO_REJECT for Breaking API Drift & Score Gaming...');

  // Scenario A: Breaking API Drift
  const driftInput = {
    filePath: 'src/api/public-client.ts',
    beforeContent: 'export function queryUser(id: string, token: string) {}',
    afterContent: 'export function queryUser(id: number) {}', // Breaking change!
    beforeScore: 80,
    afterScore: 90,
  };

  const driftResult = arbitrateAgentPatch(driftInput, {
    hasApiDrift: true,
  });
  assert.strictEqual(
    driftResult.decision,
    'AUTO_REJECT',
    'Breaking API drift must be automatically rejected',
  );
  assert.ok(driftResult.safety.safetyIndex < 0.7);

  // Scenario B: Score Gaming Attempt (adding fake test/comment or relocation)
  const gamingInput = {
    filePath: 'src/utils.ts',
    beforeContent: 'const a = 1;',
    afterContent: 'const a = 1;\n// eslint-disable-next-line\n// @ts-ignore',
    beforeScore: 80,
    afterScore: 80,
  };

  const gamingResult = arbitrateAgentPatch(gamingInput);
  assert.strictEqual(
    gamingResult.decision,
    'AUTO_REJECT',
    'Maintenance debt injection must be rejected',
  );

  console.log('  ✔ [PASS] AUTO_REJECT verdicts for API drift & debt injection verified.');
}

function testHumanReviewBorderlinePatch() {
  console.log('3. Testing HUMAN_REVIEW for Borderline & Partially Covered Changes...');

  const input = {
    filePath: 'src/service/order.ts',
    beforeContent: 'function processOrder() { return 1; }',
    afterContent:
      'function processOrder() { return calculateTax() + 1; }\nfunction calculateTax() { return 0; }',
    beforeScore: 75,
    afterScore: 80, // deltaQ = +5
    existingIssues: [],
    newIssues: [],
  };

  // Has moderate uncovered risk (0.45) in CI
  const result = arbitrateAgentPatch(input, {
    uncoveredRiskScore: 0.45,
    centralityMultiplier: 1.0,
  });

  assert.strictEqual(
    result.decision,
    'HUMAN_REVIEW',
    'Borderline patch with partial uncovered risk requires human review',
  );
  assert.ok(result.safety.safetyIndex >= 0.7 && result.safety.safetyIndex < 0.9);

  console.log('  ✔ [PASS] HUMAN_REVIEW verdict verified.');
}

function runAll() {
  console.log('=== Validating Agent Refactoring ROI & Patch Safety Arbiter ===\n');
  testAutoApplySafePatch();
  testAutoRejectDangerousPatches();
  testHumanReviewBorderlinePatch();
  console.log('\n[PASS] All 3 Change Quality Arbiter test suites passed successfully!');
}

runAll();
