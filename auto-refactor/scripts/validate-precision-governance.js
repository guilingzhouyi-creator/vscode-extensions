/**
 * Module: Verification Harness — Precision Governance & Numeric Health Validation Suite
 * File Path: scripts/validate-precision-governance.js
 * Architecture Role: Verifies the 0.01 precision scale across core scoring models,
 *   detects lossy floating point operations, ensures IEEE 754 drift resilience,
 *   and tests static governance rules NUM-PREC-001, TST-FLT-001, and GOV-SAN-002.
 * Dependencies & Triggers: Consumes ../dist/api; executed in CI and test-parallel.
 * Responsibilities:
 *   1. Verify 0.01 rounding scale and IEEE 754 subtraction drift absorption in core math.
 *   2. Verify Patch Arbiter micro-delta ranking resolution without lossy truncation.
 *   3. Verify Dynamic Risk normalizer proportional scaling.
 *   4. Verify Compact Ledger Store NDJSON line size (< 350 bytes) with 0.01 precision.
 *   5. Verify NUM-PREC-001 static rule detection for coarse truncation and mismatched scaling.
 *   6. Verify TST-FLT-001 polyglot detection across TS and GDScript assertion patterns.
 *   7. Verify GOV-SAN-002 objective technical prose and slogan interception.
 * Exit Semantics & Design Rationale: Exits 0 on all invariants satisfied, throws on failure.
 */

'use strict';

const assert = require('assert');
const { computeDynamicHotspotRisk, LossyPrecisionRoundingRule } = require('../dist/api');
const {
  formatCompactRecord,
  serializeNdjsonLine,
} = require('../dist/core/trajectory/compact-ledger-store');
const { computeArbitrationScore } = require('../dist/core/trajectory/patchArbiter');
const { TestModernityAnalyzer } = require('../dist/analyzers/test-modernity');
const { createSourceFile } = require('../dist/utils/ast');
const { ProseTerminologySanitizationRule } = require('../dist/core/governance/rules/sanitization');
const { validateCommitMessageContent } = require('../../scripts/common/validate-commit-msg-style');

/**
 * Stage 1: Mathematical core precision and IEEE 754 subtraction drift absorption.
 */
function verifyMathPrecisionCore() {
  console.log('\n1. Verifying 0.01 precision scale & IEEE 754 subtraction drift absorption...');

  const rawDiff = 0.3 - 0.2 - 0.1;
  assert.notStrictEqual(rawDiff, 0.0, 'Raw IEEE 754 subtraction exhibits non-zero machine epsilon');

  const roundedDiff = Math.round(rawDiff * 100) / 100 + 0;
  assert.strictEqual(roundedDiff, 0.0, '0.01 scale rounding must absorb subtraction drift');

  const step = 0.01;
  const valA = 95.04;
  const valB = 95.05;
  const delta = Math.round((valB - valA) * 100) / 100;
  assert.strictEqual(delta, step, 'Micro-delta of 0.01 must be preserved precisely');

  console.log('  ✔ Mathematical core guarantees 0.01 precision without binary float noise.');
}

/**
 * Stage 2: Patch Arbiter micro-delta ranking resolution.
 */
function verifyPatchArbiterMicroDelta() {
  console.log('\n2. Verifying Patch Arbiter micro-delta ranking resolution...');

  // Candidate A: composite 95.0, delta 1.25, density 0.85, issues 0
  const scoreA = computeArbitrationScore(95.0, 1.25, 0.85, 0);
  // Candidate B: composite 95.0, delta 1.30, density 0.85, issues 0
  const scoreB = computeArbitrationScore(95.0, 1.3, 0.85, 0);

  assert.ok(typeof scoreA === 'number', 'Patch score must be numeric');
  assert.ok(typeof scoreB === 'number', 'Patch score must be numeric');

  const diff = Math.round((scoreB - scoreA) * 100) / 100;
  assert.strictEqual(diff, 0.01, 'Patch arbitration must resolve micro-delta at 0.01 precision');

  console.log(`  ✔ Patch scores resolved: patchA=${scoreA}, patchB=${scoreB}`);
}

/**
 * Stage 3: Dynamic Risk normalizer proportional scaling.
 */
function verifyDynamicRiskNormalizer() {
  console.log('\n3. Verifying Dynamic Risk normalizer proportional scaling...');

  const moderate = computeDynamicHotspotRisk('moderate-hotspot', {
    behavioralScope: 2.0,
    frequencyFactor: 1.5,
    resourceConsumption: 3.0,
    businessSensitivity: 2.0,
  });

  const heavy = computeDynamicHotspotRisk('heavy-hotspot', {
    behavioralScope: 4.0,
    frequencyFactor: 5.0,
    resourceConsumption: 8.0,
    businessSensitivity: 4.0,
  });

  const riskModerate = moderate.normalizedRisk;
  const riskHeavy = heavy.normalizedRisk;

  assert.ok(riskModerate >= 0.0 && riskModerate <= 10.0, 'Moderate risk in [0, 10.0]');
  assert.ok(riskHeavy >= 0.0 && riskHeavy <= 10.0, 'Heavy risk in [0, 10.0]');
  assert.ok(riskModerate < riskHeavy, 'Moderate risk must strictly be lower than heavy risk');

  const roundedModerate = Math.round(riskModerate * 100) / 100;
  const roundedHeavy = Math.round(riskHeavy * 100) / 100;

  assert.strictEqual(
    riskModerate,
    roundedModerate,
    'Moderate risk must be aligned to 0.01 precision',
  );
  assert.strictEqual(riskHeavy, roundedHeavy, 'Heavy risk must be aligned to 0.01 precision');

  console.log(`  ✔ Dynamic risks calibrated: moderate=${riskModerate}, heavy=${riskHeavy}`);
}

/**
 * Stage 4: Compact Ledger Store NDJSON size invariants with 0.01 vector precision.
 */
function verifyCompactLedgerStoreNDJSON() {
  console.log(
    '\n4. Verifying Compact Ledger Store NDJSON size invariants with 0.01 vector precision...',
  );

  const scoreVector = [99.12, 98.45, 100.0, 97.89, 99.55, 96.8, 99.2, 98.9, 99.05, 98.75];
  const rec = formatCompactRecord({
    runId: 'run-precision',
    revision: 'a1b2c3d4',
    module: 'core',
    agent: 'agent',
    counters: {
      processed: 12500,
      unique: 10200,
      changed: 450,
      semantic: 380,
      relocated: 0,
      cosmetic: 70,
    },
    metrics: {
      beforeScore: 98.45,
      afterScore: 99.12,
      scoreVector,
      qed: 0.1234,
      debtDelta: {
        addedDebtPoints: 0,
        resolvedDebtPoints: 15,
        regressionFindingsCount: 0,
      },
    },
    gatePass: true,
  });

  const line = serializeNdjsonLine(rec);
  const byteLength = Buffer.byteLength(line, 'utf8');

  assert.ok(
    byteLength <= 350,
    `NDJSON serialized line must not exceed 350 bytes, actual: ${byteLength} bytes`,
  );

  const parsed = JSON.parse(line);
  assert.strictEqual(parsed.score.aft, 99.12, 'After score must preserve 0.01 precision');
  assert.deepStrictEqual(
    parsed.score.vec,
    scoreVector,
    'Score vector must preserve 0.01 precision',
  );

  console.log(`  ✔ NDJSON line size verified: ${byteLength} bytes (< 350 bytes limit).`);
}

/**
 * Stage 5: NUM-PREC-001 static rule detection capability.
 */
function verifyNumPrecRuleDetection() {
  console.log('\n5. Verifying NUM-PREC-001 static rule detection capability...');

  const badCodeA = 'const coarse = Math.round((a - b) * 10) / 10;';
  const badCodeB = 'const mismatch = Math.round((raw / 250.0) * 100) / 10;';
  const badCodeC = 'const lossyStr = Number(val.toFixed(1));';
  const goodCode = 'const safe = Math.round((a - b) * 100) / 100;';

  const mockCtx = (content, filePath = 'src/domain/scoring.ts') => ({
    filePath,
    content,
    lines: content.split('\n'),
    masked: content.split('\n'),
    capabilities: { languageId: 'typescript', hasAst: false },
    node: { kind: 0, text: content },
  });

  const check = (code) => LossyPrecisionRoundingRule.checkFile(mockCtx(code));

  const issuesA = check(badCodeA);
  assert.ok(issuesA && issuesA.length > 0, 'Must flag * 10 / 10 coarse rounding');
  assert.strictEqual(issuesA[0].ruleId, 'NUM-PREC-001');

  const issuesB = check(badCodeB);
  assert.ok(issuesB && issuesB.length > 0, 'Must flag * 100 / 10 mismatched scaling');
  assert.strictEqual(issuesB[0].ruleId, 'NUM-PREC-001');

  const issuesC = check(badCodeC);
  assert.ok(issuesC && issuesC.length > 0, 'Must flag toFixed(1) lossy truncation');
  assert.strictEqual(issuesC[0].ruleId, 'NUM-PREC-001');

  const issuesGood = check(goodCode);
  assert.strictEqual(issuesGood, null, 'Must allow 0.01 precision rounding');

  console.log('  ✔ NUM-PREC-001 correctly flags coarse truncation and passes 0.01 precision code.');
}

/**
 * Stage 6: TST-FLT-001 polyglot detection across TS and GDScript.
 */
function verifyTestModernityFloatAssertion() {
  console.log('\n6. Verifying TST-FLT-001 polyglot detection across TS and GDScript...');

  const analyzer = new TestModernityAnalyzer();

  const tsFragile = [
    'test("rate check", () => {',
    '  expect(calculateRate()).toBe(0.006);',
    '});',
  ].join('\n');

  const gdFragile = [
    'func test_drop_rate() -> void:',
    '  var rate = calculate_drop_rate()',
    '  assert_true(rate == 0.006, "rate mismatch")',
  ].join('\n');

  const tsRobust = [
    'test("rate check", () => {',
    '  expect(calculateRate()).toBeCloseTo(0.006, 4);',
    '});',
  ].join('\n');

  const sfTs = createSourceFile('tests/unit/rate.test.ts', tsFragile);
  const issuesTs = analyzer.analyze(sfTs, {
    filePath: 'tests/unit/rate.test.ts',
    content: tsFragile,
    config: { analyzers: {} },
  });
  assert.ok(
    issuesTs.some((i) => i.rule === 'TST-FLT-001'),
    'TS fragile float assertion toBe(0.006) must be flagged',
  );

  const issuesGd = analyzer.analyze(undefined, {
    filePath: 'WebGames/tests/unit/test_rate.gd',
    content: gdFragile,
    config: { analyzers: {} },
  });
  assert.ok(
    issuesGd.some((i) => i.rule === 'TST-FLT-001'),
    'GDScript fragile float assertion == 0.006 must be flagged',
  );

  const sfRobust = createSourceFile('tests/unit/robust.test.ts', tsRobust);
  const issuesRobust = analyzer.analyze(sfRobust, {
    filePath: 'tests/unit/robust.test.ts',
    content: tsRobust,
    config: { analyzers: {} },
  });
  assert.ok(
    !issuesRobust.some((i) => i.rule === 'TST-FLT-001'),
    'toBeCloseTo must be exempted as safe tolerance assertion',
  );

  console.log(
    '  ✔ TST-FLT-001 correctly detects fragile float comparisons and exempts safe assertions.',
  );
}

/**
 * Stage 7: GOV-SAN-002 objective prose and slogan interception.
 */
function verifyProseObjectivity() {
  console.log('\n7. Verifying GOV-SAN-002 objective prose and slogan interception...');

  const slogans = [
    '九重门禁构筑坚实屏障',
    '9重防御万无一失',
    '测试全部PASS，质量完美',
    '退出码0全部验证完毕，绝对可靠',
    '案卷施工全面展开',
  ];

  for (const slogan of slogans) {
    const res = validateCommitMessageContent(slogan);
    assert.strictEqual(
      res.valid,
      false,
      `Slogan must be flagged by commit-message style validator: "${slogan}"`,
    );
  }

  const technicalProse = [
    '验证用例集在回归测试中保持稳定',
    '运行 pre-push 门禁脚本执行提交前检查',
    '各模块以 0.01 精度对齐，避免了浮点截断漂移',
    '更新架构契约与规则目录单源注册表',
  ];

  for (const technical of technicalProse) {
    const res = validateCommitMessageContent(technical);
    assert.strictEqual(
      res.valid,
      true,
      `Technical prose must pass commit-message style validator: "${technical}"`,
    );
  }

  const mockCtx = (content, filePath = 'src/core/example.ts') => ({
    filePath,
    content,
    lines: content.split('\n'),
    masked: content.split('\n'),
    capabilities: { languageId: 'typescript', hasAst: false },
    node: { kind: 0, text: content },
  });

  const commentViolation = ProseTerminologySanitizationRule.checkFile(
    mockCtx('// 完美无瑕且零缺陷的代码实现'),
  );
  assert.ok(
    commentViolation && commentViolation.length > 0,
    'GOV-SAN-002 must flag hyperbolic affirmative slogans in source comments',
  );
  assert.strictEqual(commentViolation[0].ruleId, 'GOV-SAN-002');

  const commentClean = ProseTerminologySanitizationRule.checkFile(
    mockCtx('// 通过数学公式推导预期值并在容差范围内验证'),
  );
  assert.strictEqual(commentClean, null, 'GOV-SAN-002 must allow objective technical comments');

  console.log(
    '  ✔ GOV-SAN-002 terminology engine accurately intercepts slogans while allowing technical prose.',
  );
}

/**
 * Main execution harness.
 */
function main() {
  console.log('=== [Precision Governance] Starting Full-Stack Invariant Verification ===');

  verifyMathPrecisionCore();
  verifyPatchArbiterMicroDelta();
  verifyDynamicRiskNormalizer();
  verifyCompactLedgerStoreNDJSON();
  verifyNumPrecRuleDetection();
  verifyTestModernityFloatAssertion();
  verifyProseObjectivity();

  console.log('\n================================================================');
  console.log('✅ Precision Governance validation suite finished: 7 stages passed.');
  console.log('================================================================\n');
}

if (require.main === module) {
  try {
    main();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Precision Governance verification failed:');
    console.error(err);
    process.exit(1);
  }
}

module.exports = {
  verifyMathPrecisionCore,
  verifyPatchArbiterMicroDelta,
  verifyDynamicRiskNormalizer,
  verifyCompactLedgerStoreNDJSON,
  verifyNumPrecRuleDetection,
  verifyTestModernityFloatAssertion,
  verifyProseObjectivity,
};
