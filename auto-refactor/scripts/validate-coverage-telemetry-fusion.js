/**
 * Module: Test Pipeline — CI Coverage Telemetry Ingestion & Dynamic Feedback Validation
 * File Path: scripts/validate-coverage-telemetry-fusion.js
 * Architecture Role: Verifies LCOV report parsing, resilient file path resolution,
 *   coverage-based complexity damping/amplification factor K_cov, and RiskFusionEngine integration.
 * Dependencies & Triggers: Node assert; executed as test suite 112 in scripts/test-parallel.js.
 * Responsibilities:
 *   1. Verify LCOV string parsing (SF, DA, LF, LH, BRF, BRH, end_of_record).
 *   2. Verify resilient cross-platform file path lookup.
 *   3. Verify dynamic factor K_cov (0.5 for well-tested, 1.8 for uncovered naked risk).
 *   4. Verify closed-loop cross-plane risk resonance with RiskFusionEngine.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on failure.
 */

'use strict';

const assert = require('assert');
const { LcovIngester } = require('../dist/core/telemetry');
const { RiskFusionEngine } = require('../dist/core/scoring/risk-fusion-engine');

function testLcovParsingAndPathLookup() {
  console.log('1. Testing LCOV Parser & Resilient Path Resolution...');

  const ingester = new LcovIngester();

  const mockLcov = `
TN:
SF:src/core/complex-algorithm.ts
DA:1,1
DA:2,1
DA:3,10
DA:4,0
DA:5,0
LF:5
LH:3
BRF:4
BRH:2
end_of_record
SF:src/core/well-tested.ts
DA:10,5
DA:11,5
DA:12,5
DA:13,5
LF:4
LH:4
BRF:2
BRH:2
end_of_record
`;

  const profiles = ingester.parse(mockLcov);
  assert.strictEqual(profiles.size, 2);

  const complexProfile = ingester.findProfile('src\\core\\complex-algorithm.ts', profiles);
  assert.ok(complexProfile, 'Should find profile with backslashes on Windows');
  assert.strictEqual(complexProfile.linesFound, 5);
  assert.strictEqual(complexProfile.linesHit, 3);
  assert.strictEqual(complexProfile.lineCoverageRatio, 0.6);
  assert.strictEqual(complexProfile.branchCoverageRatio, 0.5);
  assert.strictEqual(complexProfile.lineHits.get(3), 10);
  assert.strictEqual(complexProfile.lineHits.get(4), 0);

  const testedProfile = ingester.findProfile('well-tested.ts', profiles);
  assert.ok(testedProfile, 'Should match by filename suffix');
  assert.strictEqual(testedProfile.lineCoverageRatio, 1.0);
  assert.strictEqual(testedProfile.branchCoverageRatio, 1.0);

  console.log('  ✔ [PASS] LCOV parsing and resilient lookup verified.');
}

function testCoverageDampingFactorKcov() {
  console.log('2. Testing Dynamic Coverage Damping Factor K_cov...');

  const ingester = new LcovIngester();

  // Profile 1: Well-tested module (100% lines, 100% branches)
  const wellTestedProfile = {
    filePath: 'src/math.ts',
    linesFound: 10,
    linesHit: 10,
    lineCoverageRatio: 1.0,
    branchesFound: 4,
    branchesHit: 4,
    branchCoverageRatio: 1.0,
    lineHits: new Map([
      [5, 12],
      [6, 12],
    ]),
  };

  const resWellTested = ingester.evaluateCoverageDamping(wellTestedProfile, 5);
  assert.strictEqual(resWellTested.status, 'well_covered');
  assert.strictEqual(
    resWellTested.dampingMultiplier,
    0.5,
    'Well-tested module must receive 0.5x complexity penalty halving',
  );

  // Profile 2: Uncovered naked line in partially tested module
  const partialProfile = {
    filePath: 'src/parser.ts',
    linesFound: 10,
    linesHit: 5,
    lineCoverageRatio: 0.5,
    branchesFound: 2,
    branchesHit: 1,
    branchCoverageRatio: 0.5,
    lineHits: new Map([
      [20, 0], // Never executed in tests!
      [21, 5],
    ]),
  };

  const resUncovered = ingester.evaluateCoverageDamping(partialProfile, 20);
  assert.strictEqual(resUncovered.status, 'uncovered_high_risk');
  assert.strictEqual(
    resUncovered.dampingMultiplier,
    1.8,
    'Uncovered high-risk line must receive 1.8x penalty amplification',
  );

  // Profile 3: Moderate tested line
  const resModerate = ingester.evaluateCoverageDamping(partialProfile, 21);
  assert.strictEqual(resModerate.status, 'moderate_coverage');
  assert.strictEqual(resModerate.dampingMultiplier, 1.0);

  // Profile 4: Unmonitored
  const resUnmonitored = ingester.evaluateCoverageDamping(undefined, 10);
  assert.strictEqual(resUnmonitored.status, 'unmonitored');
  assert.strictEqual(resUnmonitored.dampingMultiplier, 1.0);

  console.log('  ✔ [PASS] K_cov dynamic damping and amplification verified across all tiers.');
}

function testRiskFusionEngineClosedLoop() {
  console.log('3. Testing Cross-Plane Risk Resonance with RiskFusionEngine...');

  const ingester = new LcovIngester();
  const fusionEngine = new RiskFusionEngine();

  // Static issue: High complexity warning (S = 4.0)
  const staticIssue = {
    issueId: 'CPX-HOP-001:src/core/eval.ts:42',
    rule: 'CPX-HOP-001',
    severity: 'warning',
    normalizedRisk: 4.0,
    dimension: 'maintainability',
    weight: 1.0,
    message: 'High cognitive cost jump detected',
  };

  // Scenario A: Backed by 100% CI coverage -> single-side dampening
  const wellTestedProfile = {
    filePath: 'src/core/eval.ts',
    linesFound: 20,
    linesHit: 20,
    lineCoverageRatio: 1.0,
    branchesFound: 5,
    branchesHit: 5,
    branchCoverageRatio: 1.0,
    lineHits: new Map([[42, 50]]),
  };

  const dynamicEvidenceWellTested = ingester.asDynamicEvidence(
    wellTestedProfile,
    42,
    'CPX-HOP-001',
  );
  const fusedSafe = fusionEngine.evaluateIssue(staticIssue, dynamicEvidenceWellTested);

  assert.strictEqual(
    fusedSafe.suppressionApplied,
    true,
    'Well-tested complexity should trigger suppressionApplied in RiskFusionEngine',
  );
  assert.ok(
    fusedSafe.fusedScore < 2.0,
    `Suppressed score should be low (< 2.0), got ${fusedSafe.fusedScore}`,
  );

  // Scenario B: Naked uncovered line in CI -> dual confirmation amplification
  const uncoveredProfile = {
    filePath: 'src/core/eval.ts',
    linesFound: 20,
    linesHit: 3,
    lineCoverageRatio: 0.15,
    branchesFound: 5,
    branchesHit: 0,
    branchCoverageRatio: 0.0,
    lineHits: new Map([[42, 0]]),
  };

  const dynamicEvidenceNaked = ingester.asDynamicEvidence(uncoveredProfile, 42, 'CPX-HOP-001');
  const fusedDanger = fusionEngine.evaluateIssue(staticIssue, dynamicEvidenceNaked);

  assert.strictEqual(
    fusedDanger.isDualConfirmed,
    true,
    'High static complexity + naked zero test coverage triggers dual-confirmed risk amplification',
  );
  assert.strictEqual(
    fusedDanger.level,
    'critical',
    'Naked high complexity must be escalated to critical risk level',
  );

  console.log('  ✔ [PASS] RiskFusionEngine closed-loop resonance verified.');
}

function runAll() {
  console.log('=== Validating Coverage Telemetry Ingestion & Dynamic Feedback ===\n');
  testLcovParsingAndPathLookup();
  testCoverageDampingFactorKcov();
  testRiskFusionEngineClosedLoop();
  console.log('\n[PASS] All 3 Coverage Telemetry test suites passed successfully!');
}

runAll();
