/**
 * Module: Test Pipeline — Git History & Code Evolution Quality Model Validation
 * File Path: scripts/validate-code-evolution-scoring.js
 * Architecture Role: Verifies git history mining, commit log parsing, author entropy,
 *   code decay, debt velocity, composite vulnerability multiplier V_evo(f), graceful
 *   non-git fallback, and transparent scoring deduction amplification.
 * Dependencies & Triggers: Node assert; executed as test suite 108 in scripts/test-parallel.js.
 * Responsibilities:
 *   1. Verify GitHistoryMiner log format parsing and bug-fix commit detection.
 *   2. Verify CodeEvolutionAnalyzer metrics: bug-prone quotient, Shannon entropy, decay, velocity.
 *   3. Verify graceful 1.0 fallback on non-git environment or empty histories.
 *   4. Verify QualityScorer deduction amplification under high vulnerability hotspots.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on failure.
 */

'use strict';

const assert = require('assert');
const { GitHistoryMiner, CodeEvolutionAnalyzer } = require('../dist/core/evolution');
const { QualityScorer } = require('../dist/core/scoring/qualityScorer');

function testGitHistoryMinerLogParsing() {
  console.log('1. Testing Git History Miner Log Parsing...');

  const miner = new GitHistoryMiner();

  // Simulated git log output using ASCII separators \x1f and \x1e
  // Format: hash%x1fauthor%x1f%ct%x1fsubject%x1e
  const mockGitLogOutput = [
    'commit1\x1fAlice\x1f1700000000\x1ffix: resolve critical memory leak in worker pool\x1e',
    'commit2\x1fBob\x1f1700010000\x1ffeat: add new vector tokenizer\x1e',
    'commit3\x1fCharlie\x1f1700020000\x1fpatch: hotfix off-by-one boundary defect\x1e',
    'commit4\x1fAlice\x1f1700030000\x1frefactor: clean up internal types\x1e',
  ].join('');

  const records = miner.parseGitLogOutput(mockGitLogOutput);
  assert.strictEqual(records.length, 4, 'Should parse 4 commit records');
  assert.strictEqual(records[0].author, 'Alice');
  assert.strictEqual(records[0].isBugFix, true, 'fix commit should be flagged as bug fix');
  assert.strictEqual(records[1].isBugFix, false, 'feat commit should not be flagged as bug fix');
  assert.strictEqual(records[2].isBugFix, true, 'patch/defect commit should be flagged as bug fix');

  const profile = miner.aggregateCommitRecords('src/core/worker.ts', records);
  assert.strictEqual(profile.totalCommits, 4);
  assert.strictEqual(profile.bugFixCommits, 2);
  assert.strictEqual(profile.uniqueAuthorsCount, 3);
  assert.strictEqual(profile.authorCommitCounts['Alice'], 2);
  assert.strictEqual(profile.authorCommitCounts['Bob'], 1);
  assert.strictEqual(profile.authorCommitCounts['Charlie'], 1);
  assert.strictEqual(profile.firstSeenTimestamp, 1700000000 * 1000);
  assert.strictEqual(profile.lastModifiedTimestamp, 1700030000 * 1000);

  console.log('  ✔ [PASS] Git log parsing and profile aggregation verified.');
}

function testHighVulnerabilityHotspotAnalysis() {
  console.log('2. Testing High Vulnerability Hotspot Identification...');

  // A defect-prone module with 10 commits: 8 are bug fixes across 4 different authors
  const now = 1710000000 * 1000;
  const recentTimestamp = now - 2 * 24 * 3600 * 1000; // 2 days ago

  const hotspotCommits = [
    {
      hash: 'h1',
      author: 'Dev1',
      timestamp: recentTimestamp,
      subject: 'fix: patch null pointer',
      isBugFix: true,
    },
    {
      hash: 'h2',
      author: 'Dev2',
      timestamp: recentTimestamp - 1000,
      subject: 'fix: resolve race condition',
      isBugFix: true,
    },
    {
      hash: 'h3',
      author: 'Dev3',
      timestamp: recentTimestamp - 2000,
      subject: 'fix: handle panic',
      isBugFix: true,
    },
    {
      hash: 'h4',
      author: 'Dev4',
      timestamp: recentTimestamp - 3000,
      subject: 'fix: patch memory corruption',
      isBugFix: true,
    },
    {
      hash: 'h5',
      author: 'Dev1',
      timestamp: recentTimestamp - 4000,
      subject: 'chore: bump deps',
      isBugFix: false,
    },
    {
      hash: 'h6',
      author: 'Dev2',
      timestamp: recentTimestamp - 5000,
      subject: 'fix: patch timeout error',
      isBugFix: true,
    },
    {
      hash: 'h7',
      author: 'Dev3',
      timestamp: recentTimestamp - 6000,
      subject: 'fix: hotfix crash on exit',
      isBugFix: true,
    },
    {
      hash: 'h8',
      author: 'Dev4',
      timestamp: recentTimestamp - 7000,
      subject: 'refactor: split helper',
      isBugFix: false,
    },
    {
      hash: 'h9',
      author: 'Dev1',
      timestamp: recentTimestamp - 8000,
      subject: 'fix: repair token parsing',
      isBugFix: true,
    },
    {
      hash: 'h10',
      author: 'Dev2',
      timestamp: recentTimestamp - 9000,
      subject: 'fix: patch edge case',
      isBugFix: true,
    },
  ];

  const profile = {
    filePath: 'src/legacy/fragile-engine.ts',
    isGitAvailable: true,
    totalCommits: 10,
    bugFixCommits: 8,
    authorCommitCounts: { Dev1: 3, Dev2: 3, Dev3: 2, Dev4: 2 },
    uniqueAuthorsCount: 4,
    firstSeenTimestamp: recentTimestamp - 10000,
    lastModifiedTimestamp: recentTimestamp,
    recentCommits: hotspotCommits,
  };

  const analyzer = new CodeEvolutionAnalyzer(undefined, { nowTimestamp: now });
  const metrics = analyzer.evaluateProfile(profile);

  assert.ok(
    metrics.vulnerabilityMultiplier >= 1.6,
    `Vulnerability multiplier should be >= 1.6 for defect hotspot, got ${metrics.vulnerabilityMultiplier}`,
  );
  assert.strictEqual(metrics.bugProneScore, 0.8);
  assert.ok(
    metrics.authorEntropyScore > 0.8,
    'Entropy should be high for 4 evenly distributed authors',
  );
  assert.ok(metrics.actionableProposal, 'Should generate actionable proposal for hotspot');
  assert.strictEqual(metrics.actionableProposal.action, 'hotspot_refactor_recommended');

  console.log('  ✔ [PASS] Hotspot detection and actionable proposal verified.');
}

function testHealthyAndDecayedModules() {
  console.log('3. Testing Healthy Module & Stale Decay Analysis...');

  const now = 1710000000 * 1000;

  // Case A: Healthy single-author module with converging debt (older had bugs, newer are features)
  const healthyCommits = [
    {
      hash: 'c1',
      author: 'Lead',
      timestamp: now - 1000,
      subject: 'feat: add performance benchmark',
      isBugFix: false,
    },
    {
      hash: 'c2',
      author: 'Lead',
      timestamp: now - 2000,
      subject: 'docs: document public types',
      isBugFix: false,
    },
    {
      hash: 'c3',
      author: 'Lead',
      timestamp: now - 3000,
      subject: 'fix: resolve initial startup bug',
      isBugFix: true,
    },
    {
      hash: 'c4',
      author: 'Lead',
      timestamp: now - 4000,
      subject: 'fix: patch config loading',
      isBugFix: true,
    },
  ];

  const healthyProfile = {
    filePath: 'src/core/stable-math.ts',
    isGitAvailable: true,
    totalCommits: 4,
    bugFixCommits: 2,
    authorCommitCounts: { Lead: 4 },
    uniqueAuthorsCount: 1,
    firstSeenTimestamp: now - 5000,
    lastModifiedTimestamp: now - 1000,
    recentCommits: healthyCommits,
  };

  const analyzer = new CodeEvolutionAnalyzer(undefined, { nowTimestamp: now });
  const healthyMetrics = analyzer.evaluateProfile(healthyProfile);

  assert.strictEqual(healthyMetrics.authorEntropyScore, 0.0, 'Single author must have 0 entropy');
  assert.ok(
    healthyMetrics.debtVelocityScore > 0,
    `Healthy module with recent feature focus should have positive velocity, got ${healthyMetrics.debtVelocityScore}`,
  );
  assert.ok(
    healthyMetrics.vulnerabilityMultiplier <= 1.25,
    `Healthy multiplier should remain bounded, got ${healthyMetrics.vulnerabilityMultiplier}`,
  );

  // Case B: Stale decayed module (last modified 250 days ago)
  const staleTimestamp = now - 250 * 24 * 3600 * 1000;
  const staleProfile = {
    filePath: 'src/legacy/old-util.ts',
    isGitAvailable: true,
    totalCommits: 2,
    bugFixCommits: 0,
    authorCommitCounts: { Dev: 2 },
    uniqueAuthorsCount: 1,
    firstSeenTimestamp: staleTimestamp - 1000,
    lastModifiedTimestamp: staleTimestamp,
    recentCommits: [
      {
        hash: 's1',
        author: 'Dev',
        timestamp: staleTimestamp,
        subject: 'chore: initial import',
        isBugFix: false,
      },
      {
        hash: 's2',
        author: 'Dev',
        timestamp: staleTimestamp - 1000,
        subject: 'feat: stub methods',
        isBugFix: false,
      },
    ],
  };

  const staleMetrics = analyzer.evaluateProfile(staleProfile);
  assert.ok(
    staleMetrics.decayScore > 0.5,
    `Decay score should be > 0.5 after 250 days, got ${staleMetrics.decayScore}`,
  );

  // Case C: Non-git fallback
  const nonGitProfile = {
    filePath: 'src/scratch.ts',
    isGitAvailable: false,
    totalCommits: 0,
    bugFixCommits: 0,
    authorCommitCounts: {},
    uniqueAuthorsCount: 0,
    firstSeenTimestamp: null,
    lastModifiedTimestamp: null,
    recentCommits: [],
  };

  const fallbackMetrics = analyzer.evaluateProfile(nonGitProfile);
  assert.strictEqual(fallbackMetrics.vulnerabilityMultiplier, 1.0);
  assert.strictEqual(fallbackMetrics.isGitAvailable, false);

  console.log('  ✔ [PASS] Healthy, decay, and non-git fallback behaviors verified.');
}

function testQualityScoringDeductionAmplification() {
  console.log('4. Testing Quality Scoring Deduction Amplification via Evolution Multiplier...');

  const scorer = new QualityScorer();
  const mockIssues = [
    {
      rule: 'SEC-SQL-001',
      analyzer: 'security',
      message: 'Unsanitized query detected',
      severity: 'error',
      location: { start: { line: 10, column: 1 }, end: { line: 10, column: 20 } },
    },
    {
      rule: 'CPX-REC-001',
      analyzer: 'complexity',
      message: 'Deep recursive cycle detected',
      severity: 'warning',
      location: { start: { line: 35, column: 1 }, end: { line: 35, column: 15 } },
    },
  ];

  // Baseline evaluation without multiplier
  const baselineScore = scorer.evaluateFile('src/model.ts', mockIssues);

  // Amplified evaluation with hotspot multiplier 1.8x
  const amplifiedScore = scorer.evaluateFile('src/model.ts', mockIssues, null, undefined, {
    evolutionMultiplier: 1.8,
  });

  assert.ok(
    amplifiedScore.compositeScore < baselineScore.compositeScore,
    `Amplified vulnerability score (${amplifiedScore.compositeScore}) must be strictly lower than baseline (${baselineScore.compositeScore})`,
  );

  // Verify rationale carries amplification notice
  const hasAmplifiedRationale = amplifiedScore.rationales.some((r) =>
    r.reason.includes('[Vulnerability x1.80]'),
  );
  assert.strictEqual(
    hasAmplifiedRationale,
    true,
    'Rationales should display [Vulnerability x1.80]',
  );

  console.log('  ✔ [PASS] Quality scoring amplification with evolution multiplier verified.');
}

function runAll() {
  console.log('=== Validating Git History & Code Evolution Quality Model ===\n');
  testGitHistoryMinerLogParsing();
  testHighVulnerabilityHotspotAnalysis();
  testHealthyAndDecayedModules();
  testQualityScoringDeductionAmplification();
  console.log('\n[PASS] All 4 Code Evolution Quality test suites passed successfully!');
}

runAll();
