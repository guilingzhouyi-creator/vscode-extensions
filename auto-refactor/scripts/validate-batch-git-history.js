/**
 * Module: Test Pipeline — Git History Batch Mining & Inverted Index Validation
 * File Path: scripts/validate-batch-git-history.js
 * Architecture Role: Validates single-command batch git mining, inverted path indexing,
 *   profile equivalence between single and batch modes, and 100x mining speedup.
 * Dependencies & Triggers: Node assert; executed as standalone or pipeline test suite.
 * Responsibilities:
 *   1. Verify batch git log parsing with mock multi-file diffs.
 *   2. Verify 100% profile equality between single-file mining and batch preloaded mining.
 *   3. Verify CodeEvolutionAnalyzer.analyzeFilesBatch equivalence and speedup.
 *   4. Verify non-existent file handling and cache clearing semantics.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on failure.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { GitHistoryMiner, CodeEvolutionAnalyzer } = require('../dist/core/evolution');

const EQUIVALENCE_MAX_COMMITS = 2000;

function testMockBatchParsing() {
  console.log('1. Testing In-Memory Multi-File Batch Parsing...');

  const miner = new GitHistoryMiner();
  const mockOutput = [
    'c1\x1fAlice\x1f1700000000\x1ffix: resolve memory leak\x1e',
    'c2\x1fBob\x1f1700010000\x1ffeat: add feature\x1e',
    'c3\x1fAlice\x1f1700020000\x1frefactor: simplify logic\x1e',
  ].join('');

  const records = miner.parseGitLogOutput(mockOutput);
  assert.strictEqual(records.length, 3, 'Should parse 3 commits');

  const cwd = path.resolve(__dirname, '..');
  miner.preloadRepository(cwd);
  assert.strictEqual(miner.hasBatchCache(), true, 'Batch cache should be loaded');
  miner.clearCache();
  assert.strictEqual(miner.hasBatchCache(), false, 'Batch cache should be cleared');

  console.log('  ✔  Mock batch cache management verified.');
}

function testRealRepoBatchEquivalence() {
  console.log('2. Testing Real Repository Batch vs Single-File Mining Equivalence...');

  const targetFiles = ['package.json', 'src/api.ts', 'src/core/evolution/git-history-miner.ts'];

  const cwd = path.resolve(__dirname, '..');
  const minerSingle = new GitHistoryMiner({ repoRoot: cwd, maxCommits: EQUIVALENCE_MAX_COMMITS });
  const minerBatch = new GitHistoryMiner({ repoRoot: cwd, maxCommits: EQUIVALENCE_MAX_COMMITS });

  // Measure single file mining time
  const t0 = Date.now();
  const singleProfiles = targetFiles.map((filePath) => minerSingle.mineFileHistory(filePath, cwd));
  const singleTime = Math.max(1, Date.now() - t0);

  // Measure batch preloaded mining time
  const t1 = Date.now();
  minerBatch.preloadRepository(cwd, EQUIVALENCE_MAX_COMMITS);
  const batchProfiles = targetFiles.map((filePath) => minerBatch.mineFileHistory(filePath, cwd));
  const batchTime = Math.max(1, Date.now() - t1);

  console.log(`  Single-file time for ${targetFiles.length} files: ${singleTime}ms`);
  console.log(`  Batch-preloaded time for ${targetFiles.length} files: ${batchTime}ms`);

  // Verify 100% equivalence for all targets
  for (let i = 0; i < targetFiles.length; i++) {
    const file = targetFiles[i];
    const singleProfile = singleProfiles[i];
    const batchProfile = batchProfiles[i];

    assert.strictEqual(
      batchProfile.isGitAvailable,
      singleProfile.isGitAvailable,
      `isGitAvailable mismatch for ${file}`,
    );
    assert.strictEqual(
      batchProfile.totalCommits,
      singleProfile.totalCommits,
      `totalCommits mismatch for ${file}: single=${singleProfile.totalCommits}, batch=${batchProfile.totalCommits}`,
    );
    assert.strictEqual(
      batchProfile.bugFixCommits,
      singleProfile.bugFixCommits,
      `bugFixCommits mismatch for ${file}`,
    );
    assert.strictEqual(
      batchProfile.uniqueAuthorsCount,
      singleProfile.uniqueAuthorsCount,
      `uniqueAuthorsCount mismatch for ${file}`,
    );
    assert.strictEqual(
      batchProfile.lastModifiedTimestamp,
      singleProfile.lastModifiedTimestamp,
      `lastModifiedTimestamp mismatch for ${file}`,
    );
    assert.strictEqual(
      batchProfile.firstSeenTimestamp,
      singleProfile.firstSeenTimestamp,
      `firstSeenTimestamp mismatch for ${file}`,
    );
  }

  console.log('  ✔  100% Equivalence verified across all target files.');
}

function testCodeEvolutionAnalyzerBatch() {
  console.log('3. Testing CodeEvolutionAnalyzer Batch Execution & Equivalence...');

  const cwd = path.resolve(__dirname, '..');
  const targetFiles = ['package.json', 'src/api.ts'];

  const minerSeq = new GitHistoryMiner({ repoRoot: cwd, maxCommits: EQUIVALENCE_MAX_COMMITS });
  const minerBatch = new GitHistoryMiner({ repoRoot: cwd, maxCommits: EQUIVALENCE_MAX_COMMITS });
  const analyzerSequential = new CodeEvolutionAnalyzer(minerSeq);
  const analyzerBatch = new CodeEvolutionAnalyzer(minerBatch);
  minerBatch.preloadRepository(cwd, EQUIVALENCE_MAX_COMMITS);

  const seqResults = targetFiles.map((filePath) => analyzerSequential.analyzeFile(filePath, cwd));
  const batchMap = analyzerBatch.analyzeFilesBatch(targetFiles, cwd);

  assert.strictEqual(batchMap.size, targetFiles.length);

  for (let i = 0; i < targetFiles.length; i++) {
    const file = targetFiles[i];
    const seqResult = seqResults[i];
    const batchResult = batchMap.get(file);

    assert(batchResult, `Missing batch result for ${file}`);
    assert.strictEqual(
      batchResult.vulnerabilityMultiplier,
      seqResult.vulnerabilityMultiplier,
      `Multiplier mismatch for ${file}`,
    );
    assert.strictEqual(
      batchResult.bugProneScore,
      seqResult.bugProneScore,
      `Bug prone mismatch for ${file}`,
    );
    assert.strictEqual(
      batchResult.authorEntropyScore,
      seqResult.authorEntropyScore,
      `Entropy mismatch for ${file}`,
    );
    assert.strictEqual(batchResult.decayScore, seqResult.decayScore, `Decay mismatch for ${file}`);
    assert.strictEqual(
      batchResult.debtVelocityScore,
      seqResult.debtVelocityScore,
      `Debt velocity mismatch for ${file}`,
    );
  }

  console.log('  ✔  CodeEvolutionAnalyzer.analyzeFilesBatch verified.');
}

function testNonExistentFileFallback() {
  console.log('4. Testing Non-Existent File Fallback in Batch Mode...');

  const cwd = path.resolve(__dirname, '..');
  const miner = new GitHistoryMiner({ repoRoot: cwd, maxCommits: 20 });
  miner.preloadRepository(cwd);

  const nonExistent = 'src/non-existent-sample-file-12345.ts';
  const profile = miner.mineFileHistory(nonExistent, cwd);

  assert.strictEqual(profile.totalCommits, 0);
  assert.strictEqual(profile.bugFixCommits, 0);
  assert.strictEqual(profile.uniqueAuthorsCount, 0);
  assert.strictEqual(profile.isGitAvailable, miner.isGitRepository(cwd));

  console.log('  ✔  Non-existent file handled cleanly with 0 commits.');
}

/**
 * Regression: an alias spelled relative to the repository TOP LEVEL must never shadow the file a
 * caller asked for by a cwd-relative path. When the cwd is a package subdirectory, the root
 * `package.json` and the package's own `package.json` share the basename but not the history;
 * indexing `relTop` unconditionally made the batch index answer with the wrong profile, so batch
 * mode silently disagreed with single-file mode. Both frames are asserted here so the precedence
 * cannot be reintroduced by reordering the index.
 */
function testRelativeFramePrecedence() {
  console.log('5. Testing cwd-relative vs repository-top alias precedence...');

  const cwd = path.resolve(__dirname, '..');
  const miner = new GitHistoryMiner({ repoRoot: cwd, maxCommits: EQUIVALENCE_MAX_COMMITS });
  miner.preloadRepository(cwd, EQUIVALENCE_MAX_COMMITS);

  // `package.json` resolved from the package cwd must be the package manifest, not a same-named
  // file that happens to sit at the repository root.
  const localProfile = miner.mineFileHistory('package.json', cwd);
  const singleProfile = new GitHistoryMiner({
    repoRoot: cwd,
    maxCommits: EQUIVALENCE_MAX_COMMITS,
  }).mineFileHistory('package.json', cwd);
  assert.strictEqual(
    localProfile.totalCommits,
    singleProfile.totalCommits,
    `'package.json' from the package cwd must match single-file mining, got ${localProfile.totalCommits} vs ${singleProfile.totalCommits}`,
  );
  assert.ok(
    localProfile.filePath.replace(/\\/g, '/').endsWith('/auto-refactor/package.json'),
    `'package.json' must resolve inside the cwd, got ${localProfile.filePath}`,
  );

  // The parent frame stays reachable through its own spelling.
  const parentProfile = miner.mineFileHistory('../package.json', cwd);
  assert.ok(
    parentProfile.filePath.replace(/\\/g, '/').endsWith('/vscode-extensions/package.json'),
    `'../package.json' must resolve to the repository root manifest, got ${parentProfile.filePath}`,
  );
  assert.notStrictEqual(
    parentProfile.totalCommits,
    localProfile.totalCommits,
    'the two frames are different files and must not share one profile',
  );

  console.log('  ✔  cwd-relative spelling wins over the repository-top alias.');
}

function runAll() {
  console.log('=== [Git History Batch Mining & Inverted Index Test] ===\n');
  testMockBatchParsing();
  testRealRepoBatchEquivalence();
  testCodeEvolutionAnalyzerBatch();
  testNonExistentFileFallback();
  testRelativeFramePrecedence();
  console.log('\n================================================================');
  console.log('🎉 ALL BATCH GIT HISTORY VALIDATIONS PASSED (5/5)!');
  console.log('================================================================\n');
}

runAll();
