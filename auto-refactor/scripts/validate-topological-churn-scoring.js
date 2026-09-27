/**
 * Module: Test Pipeline — Topological Churn & Architectural Fan-in Multiplier Validation
 * File Path: scripts/validate-topological-churn-scoring.js
 * Architecture Role: Verifies architectural fan-in multiplier, temporal churn intensity,
 *   dormant legacy frozen relaxation, actionable proposals, and QualityScorer dynamic
 *   amplification.
 * Dependencies & Triggers: Node assert; executed as test suite 111 in scripts/test-parallel.js.
 * Responsibilities:
 *   1. Verify logarithmic fan-in scaling for leaf vs core infrastructure modules.
 *   2. Verify hyperbolic tangent churn dampening and frozen legacy relaxation.
 *   3. Verify actionable agent proposals for high centrality refactor guards.
 *   4. Verify QualityScorer impact multiplier amplification routing.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on failure.
 */

'use strict';

const assert = require('assert');
const { TopologicalChurnEvaluator } = require('../dist/core/scoring/topological-churn-evaluator');
const { QualityScorer } = require('../dist/core/scoring/qualityScorer');

function testFanInScaling() {
  console.log('1. Testing Fan-in Centrality Multiplier Scaling...');

  const evaluator = new TopologicalChurnEvaluator();

  // Leaf file (fanIn = 0)
  const leafRes = evaluator.evaluate('src/tools/helper.ts', 0);
  assert.strictEqual(
    leafRes.fanInMultiplier,
    1.0,
    'Leaf file must have exactly 1.0 fan-in multiplier',
  );
  assert.strictEqual(leafRes.impactMultiplier, 1.0);

  // Core module (fanIn = 15)
  const coreRes = evaluator.evaluate('src/core/types.ts', 15);
  // 1 + ln(16) = 1 + 2.7725 = 3.77
  assert.ok(
    coreRes.fanInMultiplier >= 3.7 && coreRes.fanInMultiplier <= 3.85,
    `Core module fanInMultiplier should be ~3.77, got ${coreRes.fanInMultiplier}`,
  );

  // Massive hub (fanIn = 500) capped by soft ceiling (6.0)
  const hubRes = evaluator.evaluate('src/index.ts', 500);
  assert.strictEqual(
    hubRes.fanInMultiplier,
    6.0,
    `Massive hub fanInMultiplier must be capped at 6.0, got ${hubRes.fanInMultiplier}`,
  );

  console.log('  ✔ [PASS] Fan-in logarithmic scaling and soft cap verified.');
}

function testTemporalChurnAndFrozenLegacy() {
  console.log('2. Testing Temporal Churn & Frozen Legacy Relaxation...');

  const now = 1710000000 * 1000;
  const evaluator = new TopologicalChurnEvaluator({ nowTimestamp: now });

  // 1. High-churn active file in the last 30 days
  const activeCommits = [];
  for (let i = 0; i < 8; i++) {
    activeCommits.push({
      hash: `c${i}`,
      author: 'Dev',
      timestamp: now - (i + 1) * 24 * 3600 * 1000,
      subject: `commit ${i}`,
      isBugFix: false,
    });
  }

  const activeHistory = {
    filePath: 'src/active-service.ts',
    isGitAvailable: true,
    totalCommits: 8,
    bugFixCommits: 0,
    authorCommitCounts: { Dev: 8 },
    uniqueAuthorsCount: 1,
    firstSeenTimestamp: now - 30 * 24 * 3600 * 1000,
    lastModifiedTimestamp: now - 1 * 24 * 3600 * 1000,
    recentCommits: activeCommits,
  };

  const activeRes = evaluator.evaluate('src/active-service.ts', 2, activeHistory);
  assert.ok(
    activeRes.churnMultiplier > 1.4,
    `Active churnMultiplier should be > 1.4 for 8 commits/month, got ${activeRes.churnMultiplier}`,
  );
  assert.ok(
    activeRes.impactMultiplier > activeRes.fanInMultiplier,
    'Impact multiplier should amplify fan-in multiplier under active churn',
  );

  // 2. Frozen legacy module (last modified 200 days ago, low fan-in)
  const oldTimestamp = now - 200 * 24 * 3600 * 1000;
  const frozenHistory = {
    filePath: 'src/legacy/compat.ts',
    isGitAvailable: true,
    totalCommits: 1,
    bugFixCommits: 0,
    authorCommitCounts: { OldDev: 1 },
    uniqueAuthorsCount: 1,
    firstSeenTimestamp: oldTimestamp,
    lastModifiedTimestamp: oldTimestamp,
    recentCommits: [
      { hash: 'old', author: 'OldDev', timestamp: oldTimestamp, subject: 'init', isBugFix: false },
    ],
  };

  const frozenRes = evaluator.evaluate('src/legacy/compat.ts', 1, frozenHistory);
  assert.strictEqual(frozenRes.isFrozenLegacy, true, 'Dormant file should be marked frozen legacy');
  assert.strictEqual(
    frozenRes.churnMultiplier,
    0.6,
    'Frozen legacy should have 0.6x churn relaxation',
  );

  console.log('  ✔ [PASS] Churn acceleration and frozen legacy relaxation verified.');
}

function testAgentActionableProposals() {
  console.log('3. Testing Agent Actionable Proposals for Centrality & Churn...');

  const now = 1710000000 * 1000;
  const evaluator = new TopologicalChurnEvaluator({ nowTimestamp: now });

  // High fanIn (20) + active churn (4 commits) -> high_centrality_refactor_guard
  const history = {
    filePath: 'src/core/central-bus.ts',
    isGitAvailable: true,
    totalCommits: 4,
    bugFixCommits: 0,
    authorCommitCounts: { Dev: 4 },
    uniqueAuthorsCount: 1,
    firstSeenTimestamp: now - 20 * 24 * 3600 * 1000,
    lastModifiedTimestamp: now - 2 * 24 * 3600 * 1000,
    recentCommits: [
      { hash: '1', author: 'Dev', timestamp: now - 1000, subject: 'update', isBugFix: false },
      { hash: '2', author: 'Dev', timestamp: now - 2000, subject: 'update', isBugFix: false },
      { hash: '3', author: 'Dev', timestamp: now - 3000, subject: 'update', isBugFix: false },
      { hash: '4', author: 'Dev', timestamp: now - 4000, subject: 'update', isBugFix: false },
    ],
  };

  const res = evaluator.evaluate('src/core/central-bus.ts', 20, history);
  assert.ok(res.actionableProposal, 'Actionable proposal must be generated');
  assert.strictEqual(res.actionableProposal.action, 'high_centrality_refactor_guard');

  console.log('  ✔ [PASS] High centrality refactor guard proposal verified.');
}

function testQualityScoringImpactIntegration() {
  console.log('4. Testing QualityScorer Integration with Impact Multiplier...');

  const scorer = new QualityScorer();
  const issues = [
    {
      rule: 'ARCH-CYCLE-001',
      analyzer: 'architecture',
      message: 'Cyclic dependency path detected',
      severity: 'error',
    },
  ];

  // Baseline evaluation
  const baseScore = scorer.evaluateFile('src/hub.ts', issues);

  // Amplified evaluation for critical hub (impactMultiplier = 3.5x)
  const amplifiedScore = scorer.evaluateFile('src/hub.ts', issues, null, undefined, {
    impactMultiplier: 3.5,
  });

  assert.ok(
    amplifiedScore.compositeScore < baseScore.compositeScore,
    `Central hub score (${amplifiedScore.compositeScore}) should be lower than baseline (${baseScore.compositeScore})`,
  );

  console.log('  ✔ [PASS] QualityScorer impact multiplier amplification verified.');
}

function runAll() {
  console.log('=== Validating Topological Churn & Fan-in Multiplier ===\n');
  testFanInScaling();
  testTemporalChurnAndFrozenLegacy();
  testAgentActionableProposals();
  testQualityScoringImpactIntegration();
  console.log('\n[PASS] All 4 Topological Churn test suites passed successfully!');
}

runAll();
