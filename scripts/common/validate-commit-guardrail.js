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

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const {
  normalizeText,
  createTrie,
  insertTrie,
  searchLongestPrefix,
  buildTrie,
  maskMultilineCodeBlocks,
  maskTechnicalTokens,
  parseCommitStructure,
  parseHeaderLine,
  extractBilingualTokens,
  extractLeadingActionVerb,
  analyzeEnglishVerbInflection,
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

const {
  recordCommitGuardrailAudit,
  readLatestGuardrailSnapshot,
} = require('./commit-guardrail-logger');

const {
  evaluateDebtCorridor,
  updateDebtLedger,
  readDebtLedger,
  MODE_NORMAL,
  MODE_ELASTIC_WARNING,
  MODE_FORCED_PAYDOWN,
  STATUS_PASS,
  STATUS_WARN,
  STATUS_BLOCK,
} = require('./tech-debt-corridor');

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

  // 3. Disallowed narrative/past-tense Chinese prefixes & intent modality
  const invalidZhHeaders = [
    '修改了分词器实现',
    '增加了新功能支持',
    '修复了内存泄漏问题',
    '已完成核心模块重构',
    '关于跨平台路径的调整',
    '针对语法树投影的优化',
    '打算支持新分词协议',
    '准备重构核心模块',
    '计划升级门禁架构',
    '尝试优化遍历性能',
  ];
  for (const h of invalidZhHeaders) {
    const finding = checkHeaderImperativeMood(h, 1);
    assert.ok(finding, `Disallowed narrative/intent prefix must be intercepted: ${h}`);
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

  // 5. Disallowed English present participle (-ing) verbs
  const invalidEnParticiples = [
    'adding support for custom configuration',
    'fixing parser crash on edge cases',
    'updating tokenizer implementation',
    'refactoring core routines',
    'optimizing hot paths',
  ];
  for (const h of invalidEnParticiples) {
    const finding = checkHeaderImperativeMood(h, 1);
    assert.ok(finding, `English present participle (-ing) header must be intercepted: ${h}`);
    assert.strictEqual(finding.ruleId, 'CMG-STY-007');
  }

  // 6. Disallowed English third-person singular (-s / -es) verbs
  const invalidEnThirdPersons = [
    'adds support for custom configuration',
    'fixes parser crash on edge cases',
    'updates tokenizer implementation',
    'refactors core routines',
    'optimizes hot paths',
  ];
  for (const h of invalidEnThirdPersons) {
    const finding = checkHeaderImperativeMood(h, 1);
    assert.ok(finding, `English third-person singular (-s) header must be intercepted: ${h}`);
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
 * Validates multiline Markdown code block masking without false positive findings.
 */
function testMultilineCodeBlockMasking() {
  const codeBlockMsg = [
    'feat(core): 重构核心算子实现',
    '',
    '[Project: governance]',
    '[Why]',
    '代码示例如下：',
    '```typescript',
    '// In code snippet, we use temp variables and subjective pronouns:',
    'const we = 1;',
    'let temp = "for now";',
    '```',
    '',
    '[Verification]',
    '断言单元测试通过。',
  ].join('\n');

  const audit = auditCommitStyleGuardrails(codeBlockMsg);
  assert.strictEqual(audit.findings.length, 0, 'Code block content must be masked without emitting zero-POV or prohibited term findings');
}

/**
 * Validates centralized guardrail logger and snapshot generation.
 */
function testCommitGuardrailLogger() {
  const tempLogDir = path.join(os.tmpdir(), `guardrail-logger-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  try {
    const samplePayload = {
      status: 'PASS',
      warning: 'WARN',
      styleScore: 85,
      entropy: 4.5,
      gitRevision: 'test-sha-1234',
      debtCorridor: {
        currentHighDebtCount: 1,
        mode: 'ELASTIC_WARNING',
      },
      findings: [{ ruleId: 'CMG-STY-007', lineNum: 1, term: 'adding' }],
    };

    const recorded = recordCommitGuardrailAudit(samplePayload, tempLogDir);
    assert.strictEqual(recorded, true, 'Logger must successfully persist snapshot');

    const latest = readLatestGuardrailSnapshot(tempLogDir);
    assert.ok(latest, 'Latest snapshot must be readable');
    assert.strictEqual(latest.status, 'PASS');
    assert.strictEqual(latest.warning, 'WARN');
    assert.strictEqual(latest.styleScore, 85);
    assert.strictEqual(latest.gitRevision, 'test-sha-1234');
  } finally {
    if (fs.existsSync(tempLogDir)) {
      fs.rmSync(tempLogDir, { recursive: true, force: true });
    }
  }
}

/**
 * Validates the elastic technical debt corridor and accumulation ratchet state machine.
 */
function testElasticTechDebtCorridor() {
  const tempLogDir = path.join(os.tmpdir(), `corridor-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  try {
    // 1. Clean commit -> NORMAL / PASS
    const cleanVerdict = evaluateDebtCorridor({
      findings: [],
      styleScore: 100,
      commitType: 'feat',
      logDir: tempLogDir,
    });
    assert.strictEqual(cleanVerdict.status, STATUS_PASS);
    assert.strictEqual(cleanVerdict.mode, MODE_NORMAL);
    assert.strictEqual(cleanVerdict.currentHighDebtCount, 0);

    // 2. Critical violation -> Hard Zero BLOCK
    const criticalVerdict = evaluateDebtCorridor({
      findings: [{ ruleId: 'SEC-VUL-001', category: 'security' }],
      styleScore: 80,
      commitType: 'feat',
      logDir: tempLogDir,
    });
    assert.strictEqual(criticalVerdict.status, STATUS_BLOCK);
    assert.strictEqual(criticalVerdict.mode, MODE_FORCED_PAYDOWN);
    assert.strictEqual(criticalVerdict.criticalCount, 1);

    // 3. Single High Debt -> ELASTIC_WARNING (permitted with warning)
    const singleHighVerdict = evaluateDebtCorridor({
      findings: [{ ruleId: 'CMG-STY-007', category: 'imperative_mood', isHighDebt: true }],
      styleScore: 85,
      commitType: 'feat',
      logDir: tempLogDir,
    });
    assert.strictEqual(singleHighVerdict.status, STATUS_PASS);
    assert.strictEqual(singleHighVerdict.warning, STATUS_WARN);
    assert.strictEqual(singleHighVerdict.mode, MODE_ELASTIC_WARNING);
    assert.strictEqual(singleHighVerdict.currentHighDebtCount, 1);
    assert.ok(singleHighVerdict.agentDirectives, 'Agent directives must be populated');

    // Register this high debt in ledger
    updateDebtLedger({
      newHighIssues: [{ ruleId: 'CMG-STY-007', term: 'adding' }],
      logDir: tempLogDir,
    });
    const ledgerAfter1 = readDebtLedger(tempLogDir);
    assert.strictEqual(ledgerAfter1.items.length, 1);

    // 4. Introduce 2nd High Debt -> Accumulation Ceiling Reached -> BLOCK & FORCED_PAYDOWN
    updateDebtLedger({
      newHighIssues: [{ ruleId: 'CMG-STY-008', term: 'we' }],
      logDir: tempLogDir,
    });
    const ceilingVerdict = evaluateDebtCorridor({
      findings: [{ ruleId: 'CMG-STY-007', category: 'imperative_mood', isHighDebt: true }],
      styleScore: 85,
      commitType: 'feat',
      logDir: tempLogDir,
    });
    assert.strictEqual(ceilingVerdict.status, STATUS_BLOCK);
    assert.strictEqual(ceilingVerdict.mode, MODE_FORCED_PAYDOWN);
    assert.ok(ceilingVerdict.reason.includes('blocked') || ceilingVerdict.reason.includes('ceiling') || ceilingVerdict.reason.includes('corridor'));
    assert.ok(ceilingVerdict.agentDirectives.paydownInstructions.length > 0, 'Paydown instructions must be present');

    // 5. Paydown in clean refactor commit -> settles debt
    updateDebtLedger({
      isCleanCommit: true,
      logDir: tempLogDir,
    });
    const ledgerAfterSettle = readDebtLedger(tempLogDir);
    assert.strictEqual(ledgerAfterSettle.items.length, 1, 'Older debt must be settled on clean refactor');
  } finally {
    if (fs.existsSync(tempLogDir)) {
      fs.rmSync(tempLogDir, { recursive: true, force: true });
    }
  }
}

/**
 * Validates intelligent base form recovery for software engineering verbs with silent trailing 'e'.
 */
function testSilentEVerbRecovery() {
  const cases = [
    { input: 'updated', expectedBase: 'update', expectedTense: 'past' },
    { input: 'updating', expectedBase: 'update', expectedTense: 'participle' },
    { input: 'updates', expectedBase: 'update', expectedTense: 'third_singular' },
    { input: 'created', expectedBase: 'create', expectedTense: 'past' },
    { input: 'creating', expectedBase: 'create', expectedTense: 'participle' },
    { input: 'creates', expectedBase: 'create', expectedTense: 'third_singular' },
    { input: 'configured', expectedBase: 'configure', expectedTense: 'past' },
    { input: 'migrated', expectedBase: 'migrate', expectedTense: 'past' },
    { input: 'fixes', expectedBase: 'fix', expectedTense: 'third_singular' },
    { input: 'fixed', expectedBase: 'fix', expectedTense: 'past' },
  ];

  for (const c of cases) {
    const res = analyzeEnglishVerbInflection(c.input);
    assert.ok(res, `analyzeEnglishVerbInflection must recognize ${c.input}`);
    assert.strictEqual(res.baseForm, c.expectedBase, `Base form of ${c.input} must be ${c.expectedBase}`);
    assert.strictEqual(res.tense, c.expectedTense, `Tense of ${c.input} must be ${c.expectedTense}`);
  }
}

/**
 * Validates the Agent Directives envelope schema and credit envelope integrity.
 */
function testAgentDirectivesEnvelopeProtocol() {
  const tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-directives-test-'));
  try {
    const dummyFindings = [
      {
        ruleId: 'CMG-STY-007',
        category: 'imperative_mood',
        lineNum: 1,
        term: 'updated',
        reason: 'Must use imperative mood',
        guidance: 'Replace updated with update',
        isHighDebt: true,
      },
    ];

    const verdict = evaluateDebtCorridor({
      findings: dummyFindings,
      styleScore: 88,
      commitType: 'feat',
      logDir: tempLogDir,
      targetFile: '.git/COMMIT_EDITMSG',
    });

    assert.strictEqual(verdict.status, STATUS_PASS);
    assert.strictEqual(verdict.warning, STATUS_WARN);
    assert.ok(verdict.agentDirectives, 'agentDirectives must be generated');
    const directives = verdict.agentDirectives;

    // Validate directives envelope schema
    assert.deepStrictEqual(directives.targetFiles, ['.git/COMMIT_EDITMSG']);
    assert.deepStrictEqual(directives.remediationPriority, ['CMG-STY-007']);
    assert.strictEqual(directives.verificationCommand, 'pwsh -File scripts/ps1/commit-msg-gate.ps1 .git/COMMIT_EDITMSG');
    assert.strictEqual(directives.fastRecheckCommand, 'node scripts/common/validate-commit-msg.js .git/COMMIT_EDITMSG');
    assert.strictEqual(directives.verificationTimeBudgetMs, 50);

    // Validate credit envelope
    assert.ok(directives.creditEnvelope, 'creditEnvelope must be present');
    assert.strictEqual(directives.creditEnvelope.mode, MODE_ELASTIC_WARNING);
    assert.strictEqual(directives.creditEnvelope.maxCredit, 2);
    assert.strictEqual(directives.creditEnvelope.currentHighDebt, 1);
    assert.strictEqual(directives.creditEnvelope.remainingCredit, 1);
    assert.strictEqual(directives.creditEnvelope.isFeatLocked, false);

    // Validate actionable remediations
    assert.strictEqual(directives.actionableRemediations.length, 1);
    assert.strictEqual(directives.actionableRemediations[0].offendingTerm, 'updated');
    assert.strictEqual(directives.actionableRemediations[0].suggestedFix, 'Replace updated with update');
  } finally {
    if (fs.existsSync(tempLogDir)) {
      fs.rmSync(tempLogDir, { recursive: true, force: true });
    }
  }
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
  console.log('  ✔ [PASS] CMG-STY-007 标题祈使动词契约与中英过去/进行/三单态拦截验证通过');

  testZeroPOVGuardrail();
  console.log('  ✔ [PASS] CMG-STY-008 零人称客观叙述与代词反重复误报验证通过');

  testAcademicTestOracleContext();
  console.log('  ✔ [PASS] 学术测试神谕（Test Oracle）上下文正向解耦验证通过');

  testEntropyAndHealthScoring();
  console.log('  ✔ [PASS] 香农信息熵 H(T) 与风格健康分 StyleHealthScore 评定验证通过');

  testMultilineCodeBlockMasking();
  console.log('  ✔ [PASS] 跨行 Markdown 代码块预屏蔽与正文词法隔离验证通过');

  testCommitGuardrailLogger();
  console.log('  ✔ [PASS] 集中归一化双轨持久化 (.audit-logs/) 与快照生成验证通过');

  testElasticTechDebtCorridor();
  console.log('  ✔ [PASS] 弹性高危技术债容差走廊与清偿棘轮互锁状态机验证通过');

  testSilentEVerbRecovery();
  console.log('  ✔ [PASS] 软件工程动词静音 e 词根智能还原验证通过');

  testAgentDirectivesEnvelopeProtocol();
  console.log('  ✔ [PASS] Autonomous Agent 结构化提示信封协议与信用额度包验证通过');

  console.log('🎉 提交信息分词器、双轨持久化与弹性债务走廊体系全部 12 组独立契约测试验证通过！');
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
