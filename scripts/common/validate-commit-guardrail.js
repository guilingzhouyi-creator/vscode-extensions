/**
 * Module: Commit Message Tokenizer & Style Guardrail Verification Harness
 * File Path: scripts/common/validate-commit-guardrail.js
 * Architecture Role: Standalone regression test and verification harness for the Git commit message
 *   lexical tokenizer (commit-tokenizer.js) and the style guardrail arbiter (commit-style-arbiter.js).
 * Dependencies & Triggers: Consumes commit-tokenizer.js, commit-style-arbiter.js, and
 *   validate-commit-msg-style.js; invoked by audit-all, pre-commit-gate, and CI pipelines.
 * Responsibilities:
 *   1. Assert adversarial zero-width characters stripping and NFKC unicode normalization;
 *   2. Assert lightweight prefix Trie operations (insert, searchLongestPrefix, buildTrie);
 *   3. Assert Conventional Commit header extraction and section segmentation;
 *   4. Assert header imperative mood validation (CMG-STY-007) across Chinese and English verbs;
 *   5. Assert zero-POV objectivity enforcement (CMG-STY-008) and sub-pronoun deduplication;
 *   6. Assert academic software testing terminology (Test Oracle) whitelisting vs hyperbole interception;
 *   7. Assert Shannon token information entropy and style health scoring calibration.
 * Exit Semantics & Design Rationale: Exits 0 on 100% assertion pass, 1 on any invariant regression.
 *   Ensures zero-dependency, sub-15ms lexical guardrail defense against non-standard commits.
 */
'use strict';

const assert = require('assert');
const {
  normalizeText,
  createTrie,
  insertTrie,
  searchLongestPrefix,
  buildTrie,
  maskTechnicalTokens,
  parseCommitStructure,
  parseHeaderLine,
  extractBilingualTokens,
  extractLeadingActionVerb,
} = require('./commit-tokenizer');

const {
  APPROVED_CHINESE_VERBS,
  APPROVED_ENGLISH_VERBS,
  isAcademicTestOracleContext,
  checkHeaderImperativeMood,
  checkZeroPOV,
  checkProjectNomenclature,
  calculateShannonEntropy,
  auditCommitStyleGuardrails,
} = require('./commit-style-arbiter');

const { validateCommitMessageContent } = require('./validate-commit-msg-style');

/**
 * Validates text normalization and adversarial evasion stripping.
 */
function testNormalizationAndEvasion() {
  // Test zero-width character stripping
  const zeroWidthCases = [
    '完\u200B美', // Zero-width space (U+200B)
    '完\u200C美', // Zero-width non-joiner (U+200C)
    '完\u200D美', // Zero-width joiner (U+200D)
    '完\uFEFF美', // Zero-width no-break space / BOM (U+FEFF)
    '完\u00AD美', // Soft hyphen (U+00AD)
  ];
  for (const raw of zeroWidthCases) {
    const normalized = normalizeText(raw);
    assert.strictEqual(normalized, '完美', `Zero-width evasion must normalize to clean word: ${raw}`);
  }

  // Test fullwidth to halfwidth NFKC normalization
  const fullwidthRaw = 'ｆｅａｔ（ｃｏｒｅ）： 修复问题';
  const normalizedFw = normalizeText(fullwidthRaw);
  assert.strictEqual(normalizedFw, 'feat(core): 修复问题', 'Fullwidth characters must be normalized to ASCII equivalents');

  // Test empty/null input robustness
  assert.strictEqual(normalizeText(''), '');
  assert.strictEqual(normalizeText(null), '');
}

/**
 * Validates prefix Trie indexing and longest prefix search.
 */
function testPrefixTrieOperations() {
  const words = ['测试神谕', '测试', '断言神谕', '断言', '神谕'];
  const trie = buildTrie(words);

  // Longest prefix match: '测试神谕基准' should match '测试神谕' rather than shorter '测试'
  const matchLong = searchLongestPrefix(trie, '测试神谕基准', 0);
  assert.ok(matchLong, 'Should match longest prefix');
  assert.strictEqual(matchLong.matched, '测试神谕', 'Longest prefix must win over shorter prefixes');

  // Match at offset
  const matchOffset = searchLongestPrefix(trie, '前置断言神谕验证', 2);
  assert.ok(matchOffset, 'Should match at non-zero start index');
  assert.strictEqual(matchOffset.matched, '断言神谕');

  // Non-matching query
  const matchNone = searchLongestPrefix(trie, '完全无关文本', 0);
  assert.strictEqual(matchNone, null, 'Unmatched queries must return null');
}

/**
 * Validates Conventional Commit header and section parsing.
 */
function testCommitStructureParsing() {
  const commitSample = [
    'feat(tokenizer): 引入轻量提交护栏分词器',
    '',
    '[Project: governance]',
    '[Why]',
    '对齐全仓提交信息规范，拦截非祈使句口吻。',
    '',
    '[Added]',
    '- 增加 commit-tokenizer.js 与 Trie 前缀匹配。',
    '',
    '[Verification]',
    '运行自测试卷与回归验证。',
  ].join('\n');

  const parsed = parseCommitStructure(commitSample);
  assert.strictEqual(parsed.type, 'feat');
  assert.strictEqual(parsed.scope, 'tokenizer');
  assert.strictEqual(parsed.summary, '引入轻量提交护栏分词器');
  assert.ok(parsed.sections.project, 'Must parse project section');
  assert.ok(parsed.sections.why, 'Must parse why section');
  assert.ok(parsed.sections.added, 'Must parse added section');
  assert.ok(parsed.sections.verification, 'Must parse verification section');

  // Test header without scope
  const noScopeHeader = parseHeaderLine('docs: 更新架构文档说明');
  assert.strictEqual(noScopeHeader.type, 'docs');
  assert.strictEqual(noScopeHeader.scope, '');
  assert.strictEqual(noScopeHeader.summary, '更新架构文档说明');
}

/**
 * Validates header imperative mood enforcement (CMG-STY-007).
 */
function testImperativeMoodGuardrail() {
  // 1. Approved Chinese imperative verbs
  const validZhHeaders = [
    '新增支持自定义配置项',
    '修复空指针异常崩溃',
    '重构核心分词器模块',
    '优化高频遍历性能',
    '消除循环内瞬态堆分配',
    '对齐全仓单源规则目录',
    '加固跨平台路径兼容性',
    '消融空包跳板文件',
    '演进双轨代码密度门禁',
  ];
  for (const h of validZhHeaders) {
    const finding = checkHeaderImperativeMood(h, 1);
    assert.strictEqual(finding, null, `Approved Chinese verb in header should pass: ${h}`);
  }

  // 2. Approved English imperative verbs
  const validEnHeaders = [
    'add support for custom configuration',
    'fix null pointer exception in parser',
    'refactor tokenizer to use prefix trie',
    'optimize inner loop allocation overhead',
    'eliminate redundant forwarding trampolines',
    'align project rule catalog with ssot',
    'harden cross-platform path handling',
  ];
  for (const h of validEnHeaders) {
    const finding = checkHeaderImperativeMood(h, 1);
    assert.strictEqual(finding, null, `Approved English verb in header should pass: ${h}`);
  }

  // 3. Disallowed narrative/past-tense Chinese prefixes
  const invalidZhHeaders = [
    '修改了分词器实现',
    '增加了新功能支持',
    '修复了内存泄漏问题',
    '已完成核心模块重构',
    '关于跨平台路径的调整',
    '针对语法树投影的优化',
  ];
  for (const h of invalidZhHeaders) {
    const finding = checkHeaderImperativeMood(h, 1);
    assert.ok(finding, `Disallowed narrative prefix must be intercepted: ${h}`);
    assert.strictEqual(finding.ruleId, 'CMG-STY-007');
  }

  // 4. Disallowed English past-tense verbs
  const invalidEnHeaders = [
    'added support for custom configuration',
    'modified tokenizer to use prefix trie',
    'fixed null pointer exception',
    'optimized hot paths in parser',
    'completed refactor of core components',
  ];
  for (const h of invalidEnHeaders) {
    const finding = checkHeaderImperativeMood(h, 1);
    assert.ok(finding, `English past-tense header must be intercepted: ${h}`);
    assert.strictEqual(finding.ruleId, 'CMG-STY-007');
  }
}

/**
 * Validates zero-POV pronoun checking and deduplication (CMG-STY-008).
 */
function testZeroPOVGuardrail() {
  // 1. Chinese first-person pronouns
  const zhPronounLine = '我们在本次提交中重构了模块，我进行了全面自测。';
  const zhFindings = checkZeroPOV(zhPronounLine, 10);
  assert.ok(zhFindings.length >= 1, 'Must detect first-person pronouns');
  assert.ok(zhFindings.some((f) => f.ruleId === 'CMG-STY-008' && f.term === '我们'));
  assert.ok(zhFindings.some((f) => f.ruleId === 'CMG-STY-008' && f.term === '我'));

  // 2. English first-person pronouns
  const enPronounLine = 'We refactored the engine and I verified the test suites.';
  const enFindings = checkZeroPOV(enPronounLine, 12);
  assert.ok(enFindings.length >= 1, 'Must detect English first-person pronoun');
  assert.strictEqual(enFindings[0].ruleId, 'CMG-STY-008');

  // 3. Inline code masking should prevent false positives on code variables (e.g. `let i = 0`, `us`)
  const codeLine = '循环索引变量 `i` 在计数器中递增，单位 `us` 表示微秒。';
  const codeFindings = checkZeroPOV(codeLine, 15);
  assert.strictEqual(codeFindings.length, 0, 'Tokens inside code backticks must not trigger zero-POV violation');
}

/**
 * Validates academic test oracle context whitelisting vs mythical hyperbole.
 */
function testAcademicTestOracleContext() {
  // Legitimate academic terminology
  assert.strictEqual(isAcademicTestOracleContext('引入脆性断言神谕检测', 4), true);
  assert.strictEqual(isAcademicTestOracleContext('基于差分神谕对齐行为', 2), true);
  assert.strictEqual(isAcademicTestOracleContext('测试神谕验证机制', 0), true);

  // Mythical hyperbole without testing context
  assert.strictEqual(isAcademicTestOracleContext('这套代码犹如神谕一般完美', 6), false);

  // Integrated commit style check: academic term in commit message must pass cleanly
  const validAcademicMsg = [
    'feat(rules): 引入脆性断言神谕与差分神谕静态检测引擎',
    '',
    '[Project: auto-refactor]',
    '[Why]',
    '学术测试理论中的测试神谕（Test Oracle）用于判定程序实际行为与预期规范的一致性。',
    '',
    '[Added]',
    '- 增加断言神谕分析器与相关规则。',
    '',
    '[Verification]',
    '运行单元测试套件，断言神谕规则对等价变异体的拦截成立。',
  ].join('\n');

  const resAcademic = validateCommitMessageContent(validAcademicMsg);
  assert.strictEqual(resAcademic.valid, true, 'Academic Test Oracle commit message must be valid and whitelisted');

  // Hyperbolic praise using "神谕" without academic context must be intercepted
  const hyperbolicMsg = [
    'feat(core): 交付犹如神谕般的工业级架构',
    '',
    '[Project: auto-refactor]',
    '[Why]',
    '神谕降临解决全部问题。',
    '',
    '[Verification]',
    '断言测试成立。',
  ].join('\n');

  const resHyperbolic = validateCommitMessageContent(hyperbolicMsg);
  assert.strictEqual(resHyperbolic.valid, false, 'Hyperbolic praise must be intercepted by CMG-STY-002');
  assert.ok(resHyperbolic.findings.some((f) => f.ruleId === 'CMG-STY-002'));
}

/**
 * Validates Shannon entropy calculation and style health score evaluation.
 */
function testEntropyAndHealthScoring() {
  const sampleText = '新增分词器与安全审查护栏，规范化提交文本并拦截非祈使句与主观代词叙述。';
  const tokenData = extractBilingualTokens(sampleText);
  const entropy = calculateShannonEntropy(tokenData.allTokens);

  assert.ok(entropy > 3.0, `Entropy should be significant for technical text: ${entropy}`);

  // Test full audit score on clean commit
  const cleanMsg = [
    'feat(core): 新增提交护栏分词器与祈使语态仲裁器',
    '',
    '[Project: governance]',
    '[Why]',
    '对齐全仓提交信息规范，纯客观陈述技术事实。',
    '',
    '[Verification]',
    '断言自测试卷与门禁回归测试成立。',
  ].join('\n');

  const cleanAudit = auditCommitStyleGuardrails(cleanMsg);
  assert.strictEqual(cleanAudit.findings.length, 0);
  assert.strictEqual(cleanAudit.styleScore, 100);

  // Test deduction on violating commit
  const violatingMsg = [
    'feat(core): 修改了核心算法',
    '',
    '[Project: governance]',
    '[Why]',
    '我们在本次改动中优化了架构。',
    '',
    '[Verification]',
    '断言测试成立。',
  ].join('\n');

  const violatingAudit = auditCommitStyleGuardrails(violatingMsg);
  assert.ok(violatingAudit.findings.length >= 2);
  assert.ok(violatingAudit.styleScore < 100);
}

/**
 * Main verification test runner.
 */
function runGuardrailVerification() {
  console.log('🚀 启动提交信息分词器与护栏仲裁器独立回归测试...');

  testNormalizationAndEvasion();
  console.log('  ✔ [PASS] 文本归一化与对抗性零宽隐形字符消融验证通过');

  testPrefixTrieOperations();
  console.log('  ✔ [PASS] 前缀树 Trie 构建与最长前缀 O(L) 匹配验证通过');

  testCommitStructureParsing();
  console.log('  ✔ [PASS] Conventional Commit 规范头部与结构化区块解析验证通过');

  testImperativeMoodGuardrail();
  console.log('  ✔ [PASS] CMG-STY-007 标题祈使动词契约与中英过去态拦截验证通过');

  testZeroPOVGuardrail();
  console.log('  ✔ [PASS] CMG-STY-008 零人称客观叙述与代词反重复误报验证通过');

  testAcademicTestOracleContext();
  console.log('  ✔ [PASS] 学术测试神谕（Test Oracle）上下文正向解耦验证通过');

  testEntropyAndHealthScoring();
  console.log('  ✔ [PASS] 香农信息熵 H(T) 与风格健康分 StyleHealthScore 评定验证通过');

  console.log('🎉 提交信息分词器与安全审查护栏体系全部 7 组独立契约测试验证通过！');
}

if (require.main === module) {
  try {
    runGuardrailVerification();
    process.exit(0);
  } catch (err) {
    console.error('❌ [FAIL] 提交护栏独立验证失败:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

module.exports = {
  runGuardrailVerification,
};
