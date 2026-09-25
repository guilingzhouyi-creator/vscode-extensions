/**
 * Module: Verification Harness — Project Comment Governance & Density Suite
 * File Path: scripts/validate-comment-governance.js
 * Architecture Role: Verifies project-level comment style profiling, 9-dimensional
 *   effective comment density (ECD-C), anti-waterlogging, and semantic duty matching.
 * Dependencies & Triggers: Consumes ../dist/api; executed in test suite.
 * Responsibilities:
 *   1. Assert ProjectCommentProfiler detects CJK/Latin ratios and dominant conventions;
 *   2. Assert evaluateEffectiveCommentDensity rewards design rationales;
 *   3. Assert detectScoreGaming emits tautological_comment_padding for water-logged files;
 *   4. Assert matchCommentCodeDuty flags side-effect contradictions against pure doc claims;
 *   5. Assert CommentAnalyzer emits CMT-LNG-001, CMT-LNG-002, CMT-VMD-001, CMT-INT-001.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const {
  defaultProjectCommentProfiler,
  evaluateEffectiveCommentDensity,
  matchCommentCodeDuty,
  detectScoreGaming,
  CommentAnalyzer,
} = require('../dist/api');

async function testCommentLanguageProfiling() {
  console.log('1. Testing ProjectCommentProfiler language distribution and dominant style...');

  const enSource = [
    '/**',
    ' * Architectural Role: High performance in-memory LRU cache manager with eviction policies.',
    ' * Dependencies & Triggers: Consumes node memory buffer and timing primitives directly.',
    ' * Responsibilities: Maintain fast key-value lookups with strictly bounded memory capacity.',
    ' * Contract Invariants: Thread-safe, non-null keys, synchronous cache eviction and bounded storage.',
    ' */',
    'export class MemoryCache {}',
  ].join('\n');

  const enDist = defaultProjectCommentProfiler.profileSingleFile(enSource);
  assert.strictEqual(enDist.dominantLanguage, 'en');
  assert.ok(enDist.latinRatio >= 0.9);
  assert.strictEqual(enDist.cjkChars, 0);

  const zhSource = [
    '/**',
    ' * 架构定位：内存级最近最少使用缓存管理器。',
    ' * 依赖与触发：消费基础内存缓冲区。',
    ' * 核心职责：维护高吞吐键值对快速查找并提供上限容量保护。',
    ' */',
    'export class MemoryCacheZh {}',
  ].join('\n');

  const zhDist = defaultProjectCommentProfiler.profileSingleFile(zhSource);
  assert.strictEqual(zhDist.dominantLanguage, 'zh-CN');
  assert.ok(zhDist.cjkRatio >= 0.85);

  // Project aggregation
  const fileMap = new Map([
    ['src/core/cache.ts', enSource],
    ['src/core/store.ts', enSource],
    ['src/utils/math.ts', enSource],
    ['src/utils/algo.ts', enSource],
    ['src/compat/legacy.ts', zhSource],
  ]);

  const profile = defaultProjectCommentProfiler.profileProject(fileMap);
  assert.strictEqual(profile.totalFilesScanned, 5);
  assert.strictEqual(profile.globalDominantLanguage, 'en');
  assert.ok(profile.overallDistribution.latinRatio > 0.65);

  console.log(
    '  ✔ Language profiler accurately computes CJK/Latin ratios and dominant conventions',
  );
}

async function testEffectiveCommentDensityAndWaterLogging() {
  console.log('\n2. Testing Effective Comment Density (ECD-C) and water-logging detection...');

  // Substantive design rationale comment
  const highQualitySource = [
    '/**',
    ' * Why this is needed: We use a bounded ring buffer instead of a dynamic array',
    ' * because allocation pauses during GC hurt real-time audio latency.',
    ' * Invariant: Never throws under memory pressure; drops oldest frame when full.',
    ' * @param capacity Maximum number of buffer slots',
    ' * @returns Initialized ring buffer instance',
    ' */',
    'export function createRingBuffer(capacity: number) { return { capacity }; }',
  ].join('\n');

  const highQualityMetrics = evaluateEffectiveCommentDensity(highQualitySource);
  assert.strictEqual(highQualityMetrics.hasWaterLogging, false);
  assert.ok(highQualityMetrics.effectiveCommentRatio >= 0.75);
  assert.ok(highQualityMetrics.categoryCounts.DESIGN_RATIONALE >= 1);
  assert.ok(highQualityMetrics.categoryCounts.INVARIANT_BOUNDARY >= 1);
  assert.ok(highQualityMetrics.categoryCounts.API_CONTRACT >= 2);

  // Tautological water-logging comments
  const waterLoggedSource = [
    '// get user id',
    'export function getUserId() { return 1; }',
    '',
    '// set user name',
    'export function setUserName(name: string) {}',
    '',
    '// return true',
    'export function isReady() { return true; }',
    '',
    '// todo: implement',
    'export function nextStep() {}',
    '',
    '// placeholder',
    'export function finalize() {}',
  ].join('\n');

  const waterMetrics = evaluateEffectiveCommentDensity(waterLoggedSource);
  assert.strictEqual(waterMetrics.hasWaterLogging, true);
  assert.ok(waterMetrics.effectiveCommentRatio < 0.4);
  assert.ok(waterMetrics.categoryCounts.TRIVIAL_TRANSLATION >= 2);
  assert.ok(waterMetrics.categoryCounts.WATER_LOGGING >= 2);

  // Anti-gaming detection integration
  const antiGaming = detectScoreGaming('src/sample.ts', waterLoggedSource);
  assert.ok(antiGaming.hasGaming);
  assert.ok(antiGaming.gamingKinds.includes('tautological_comment_padding'));
  assert.ok(antiGaming.gamingPenalty >= 10);

  console.log(
    '  ✔ High-value rationale rewarded (ECR >= 0.75) and water-logging penalized in anti-gaming',
  );
}

async function testCommentSemanticMatcher() {
  console.log('\n3. Testing Comment-to-Code Semantic Duty Matcher...');

  const docClaim =
    '/** Pure utility function with zero side effects; strictly read-only calculation. */';
  const mutationCode = [
    'export function computeTotals(items: any[]) {',
    '    this.lastProcessed = Date.now();',
    '    items.push({ processed: true });',
    '    return items.length;',
    '}',
  ].join('\n');

  const mismatches = matchCommentCodeDuty('computeTotals', docClaim, mutationCode, 10);
  assert.strictEqual(mismatches.length, 1);
  assert.strictEqual(mismatches[0].claimedContract, 'pure_function');
  assert.ok(mismatches[0].message.includes('side effects'));

  console.log(
    '  ✔ Semantic duty matcher successfully caught contradiction between pure doc claim and code mutations',
  );
}

async function testCommentsAnalyzerRules() {
  console.log(
    '\n4. Testing CommentsAnalyzer new rules (CMT-LNG-001, CMT-LNG-002, CMT-VMD-001, CMT-INT-001)...',
  );

  const analyzer = new CommentAnalyzer();

  // Test CMT-LNG-001 (Language Drift in English project)
  const zhDivergentFile = [
    '/**',
    ' * 这是一个完全用中文书写的核心模块。',
    ' * 详细描述了所有的实现细节和内部数据结构说明。',
    ' */',
    'export function executeWork() {}',
  ].join('\n');

  const issuesLng = analyzer.analyze(undefined, {
    filePath: 'src/core/worker.ts',
    content: zhDivergentFile,
    config: { commentLevel: 'standard' },
    options: {
      enableLanguageGovernance: true,
      targetDominantLanguage: 'en',
    },
  });

  const lngIssue = issuesLng.find((i) => i.rule === 'CMT-LNG-001');
  assert.ok(
    lngIssue,
    'Expected CMT-LNG-001 when Chinese comments are added to English-dominant project',
  );
  assert.ok(lngIssue.message.includes('diverges from dominant project convention [en]'));

  // Test CMT-LNG-002 (Mixed language incoherence)
  const mixedFile = [
    '// First line in English explaining basic concepts and architecture',
    '// 第二行完全是中文解释，没有任何英文词汇存在于本行之中',
    '// Another detailed sentence describing the algorithm and data structures',
    '// 第四行又是大量的纯中文说明文字，用来解释各种细节逻辑和流程',
    'export function mixedWork() {}',
  ].join('\n');

  const issuesMixed = analyzer.analyze(undefined, {
    filePath: 'src/core/mixed.ts',
    content: mixedFile,
    config: { commentLevel: 'standard' },
    options: {
      enableLanguageGovernance: true,
    },
  });

  const mixedIssue = issuesMixed.find((i) => i.rule === 'CMT-LNG-002');
  assert.ok(
    mixedIssue,
    'Expected CMT-LNG-002 when single file has haphazard mixed language comments',
  );

  // Test CMT-VMD-001 (Water-logging in analyzer)
  const waterLogFile = [
    '// get count',
    'export function getCount() { return 1; }',
    '// get total',
    'export function getTotal() { return 2; }',
    '// todo',
    'export function run() {}',
    '// placeholder',
    'export function stop() {}',
  ].join('\n');

  const issuesVmd = analyzer.analyze(undefined, {
    filePath: 'src/core/water.ts',
    content: waterLogFile,
    config: { commentLevel: 'standard' },
    options: {
      enableDensityGovernance: true,
    },
  });

  const vmdIssue = issuesVmd.find((i) => i.rule === 'CMT-VMD-001');
  assert.ok(vmdIssue, 'Expected CMT-VMD-001 when comment density is low with water-logging');

  // Test CMT-INT-001 (Semantic duty mismatch in analyzer)
  const mismatchFile = [
    '// Pure utility function with zero mutations',
    'export function clearCache() {',
    '    this.cache = null;',
    '}',
  ].join('\n');

  const issuesInt = analyzer.analyze(undefined, {
    filePath: 'src/core/mismatch.ts',
    content: mismatchFile,
    config: { commentLevel: 'standard' },
    options: {
      enableSemanticDutyCheck: true,
    },
  });

  const intIssue = issuesInt.find((i) => i.rule === 'CMT-INT-001');
  assert.ok(
    intIssue,
    'Expected CMT-INT-001 when documentation claims pure function but code mutates state',
  );

  console.log(
    '  ✔ All 4 comment governance rules (CMT-LNG-001, CMT-LNG-002, CMT-VMD-001, CMT-INT-001) emitted as expected',
  );
}

async function runAll() {
  console.log('=== Starting Project Comment Governance & Density Verification Suite ===\n');
  await testCommentLanguageProfiling();
  await testEffectiveCommentDensityAndWaterLogging();
  await testCommentSemanticMatcher();
  await testCommentsAnalyzerRules();
  console.log('\n=== All Comment Governance & Density tests passed successfully! ===');
}

runAll().catch((err) => {
  console.error('\n❌ Verification failed with error:', err);
  process.exit(1);
});
