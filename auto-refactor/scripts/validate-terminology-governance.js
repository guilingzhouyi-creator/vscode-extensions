#!/usr/bin/env node
/**
 * Module: Verification Harness — Terminology Constraints & Governance Engine
 * File Path: scripts/validate-terminology-governance.js
 * Architecture Role: Verification suite ensuring cross-analyzer terminology constraints,
 *   single-source-of-truth lexicon integration, and scoring/preflight connectivity.
 * Dependencies & Triggers: `npm test` or `node scripts/validate-terminology-governance.js`;
 *   imports dist/core/governance/terminology-engine, dist/api, and dist/core/preflight.
 * Responsibilities:
 *   1. Verify terminology masking pipeline (code spans, formulas, IDs, quotes, whitelists).
 *   2. Verify bidirectional bilingual detection across all four prohibited categories.
 *   3. Assert CommentAnalyzer emits CMT-TRM-001 on non-objective comment prose.
 *   4. Assert DocsAnalyzer emits DOC-TRM-001 on non-objective markdown prose.
 *   5. Verify scoring table deduction mappings for CMT-TRM-001 and DOC-TRM-001.
 *   6. Verify preflight index terminology sensitivity and sparse activation boost.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passed; exits 1 on failure.
 */
'use strict';

const assert = require('assert');
const {
  auditTerminologyProse,
  sanitizeLineForTerminology,
} = require('../dist/core/governance/terminology-engine');
const { CommentAnalyzer } = require('../dist/api');
const { DocsAnalyzer } = require('../dist/analyzers/docs');
const { DIMENSION_RULES } = require('../dist/core/scoring/dimensionRuleTable');
const { buildFileAuditIndex } = require('../dist/core/preflight/audit-index');
const { activateSparseAnalyzers } = require('../dist/core/preflight/sparse-activator');

/** Test stage 1: Terminology sanitization and technical whitelist masking */
function testSanitizationAndWhitelisting() {
  process.stdout.write(
    '  ▶ [Engine Sanitization] Testing contextual masking and whitelisting...\n',
  );

  // Code span masking
  const codeSpanLine = 'Use `absolute path` or `temporary buffer` in functions.';
  const maskedCode = sanitizeLineForTerminology(codeSpanLine);
  assert(!maskedCode.includes('absolute path'), 'Code spans must be masked');
  assert(maskedCode.includes('__CODE_SPAN__'), 'Masked marker must be present');

  // Formula masking
  const formulaLine = 'When calculating $\\Delta Q = 100\\%$, keep stability.';
  const maskedFormula = sanitizeLineForTerminology(formulaLine);
  assert(!maskedFormula.includes('100%'), 'Inline formula must be masked');

  // Rule ID masking
  const ruleIdLine = 'Rule CMT-TRM-001 protects comment quality.';
  const maskedRule = sanitizeLineForTerminology(ruleIdLine);
  assert(maskedRule.includes('__RULE_ID__'), 'Standard rule ID must be masked');

  // Technical whitelist preservation
  const technicalLine = '系统采用绝对路径与临时缓冲区进行全量编译和垃圾回收。';
  const findingsTechZh = auditTerminologyProse(technicalLine);
  assert.strictEqual(
    findingsTechZh.length,
    0,
    'Legitimate Chinese technical terms must not trigger findings',
  );

  const technicalLineEn =
    'Garbage-collected runtimes allocate temporary objects using absolute coordinates.';
  const findingsTechEn = auditTerminologyProse(technicalLineEn);
  assert.strictEqual(
    findingsTechEn.length,
    0,
    'Legitimate English technical terms must not trigger findings',
  );

  const gitLine = '在暂存区中对占位符进行切片审查。';
  const findingsGit = auditTerminologyProse(gitLine);
  assert.strictEqual(
    findingsGit.length,
    0,
    'Git staging area and placeholder tokens must not trigger findings',
  );

  process.stdout.write('    ✔ Sanitization and technical whitelisting verified.\n');
}

/** Test stage 2: Prohibited terminology detection across categories */
function testBilingualTerminologyDetection() {
  process.stdout.write('  ▶ [Detection Precision] Testing bilingual category detection...\n');

  // Category 1: Temporary / Casual
  const tempZh = '这是一个临时方案，先这样凑合用一下。';
  const tempZhFindings = auditTerminologyProse(tempZh);
  assert(tempZhFindings.length >= 2, 'Should detect temporary phrasing in Chinese');
  assert(tempZhFindings.some((f) => f.category === 'temporary'));

  const tempEn = 'This is a hacky fix for now.';
  const tempEnFindings = auditTerminologyProse(tempEn);
  assert(tempEnFindings.length >= 1, 'Should detect temporary phrasing in English');
  assert(tempEnFindings.some((f) => f.term === 'hacky'));

  // Category 2: Hyperbolic Affirmative
  const hypAffZh = '本系统实现工业级极致性能，零缺陷且绝对化安全。';
  const hypAffZhFindings = auditTerminologyProse(hypAffZh);
  assert(hypAffZhFindings.length >= 2, 'Should detect hyperbolic affirmative claims in Chinese');

  const hypAffEn = 'Provides a bulletproof and flawless architecture that is state-of-the-art.';
  const hypAffEnFindings = auditTerminologyProse(hypAffEn);
  assert(hypAffEnFindings.length >= 2, 'Should detect hyperbolic claims in English');

  // Category 3: Hyperbolic Negative
  const hypNegZh = '旧模块代码一团糟，是一堆毫无价值的废物。';
  const hypNegZhFindings = auditTerminologyProse(hypNegZh);
  assert(hypNegZhFindings.length >= 2, 'Should detect derogatory negativity in Chinese');

  const hypNegEn = 'The legacy parser is total crap and garbage.';
  const hypNegEnFindings = auditTerminologyProse(hypNegEn);
  assert(hypNegEnFindings.length >= 1, 'Should detect derogatory terms in English');

  // Category 4: Meta-narrative
  const metaZh = '调整文案语调为低调中肯、求真务实，移除宣扬性词汇。';
  const metaZhFindings = auditTerminologyProse(metaZh);
  assert(metaZhFindings.length >= 2, 'Should detect meta-narrative slogans in Chinese');

  const metaEn = 'We need to tone down the text and stay humble with pragmatic wording.';
  const metaEnFindings = auditTerminologyProse(metaEn);
  assert(metaEnFindings.length >= 1, 'Should detect meta-narrative slogans in English');

  process.stdout.write('    ✔ Bilingual category detection verified.\n');
}

/** Test stage 3: CommentAnalyzer CMT-TRM-001 integration */
function testCommentAnalyzerIntegration() {
  process.stdout.write('  ▶ [Comment Analyzer] Testing CMT-TRM-001 enforcement...\n');

  const analyzer = new CommentAnalyzer();

  const cleanSource = [
    '/**',
    ' * Module: Test',
    ' * File Path: src/example.ts',
    ' * Architecture Role: Test Module',
    ' * Dependencies & Triggers: none',
    ' * Responsibilities: Provides test functions',
    ' * Exit Semantics & Design Rationale: Deterministic',
    ' */',
    'export const value = 42;',
  ].join('\n');

  const cleanIssues = analyzer.analyze(null, {
    filePath: 'src/example.ts',
    content: cleanSource,
    options: { level: 'standard' },
    config: { commentLevel: 'standard' },
  });
  const cmtTrmClean = cleanIssues.filter((i) => i.rule === 'CMT-TRM-001');
  assert.strictEqual(cmtTrmClean.length, 0, 'Clean source comments must not trigger CMT-TRM-001');

  const dirtySource = [
    '/**',
    ' * Module: Test',
    ' * File Path: src/example.ts',
    ' * Architecture Role: Test Module',
    ' * Dependencies & Triggers: none',
    ' * Responsibilities: Provides test functions',
    ' * Exit Semantics & Design Rationale: Deterministic',
    ' */',
    '// 临时方案，凑合处理',
    'export const value = 42;',
  ].join('\n');

  const dirtyIssues = analyzer.analyze(null, {
    filePath: 'src/example.ts',
    content: dirtySource,
    options: { level: 'standard' },
    config: { commentLevel: 'standard' },
  });
  const cmtTrmDirty = dirtyIssues.filter((i) => i.rule === 'CMT-TRM-001');
  assert(cmtTrmDirty.length >= 1, 'Dirty comment must trigger CMT-TRM-001');
  assert.strictEqual(cmtTrmDirty[0].severity, 'warning');

  process.stdout.write('    ✔ CommentAnalyzer CMT-TRM-001 integration verified.\n');
}

/** Test stage 4: DocsAnalyzer DOC-TRM-001 integration */
function testDocsAnalyzerIntegration() {
  process.stdout.write('  ▶ [Docs Analyzer] Testing DOC-TRM-001 enforcement...\n');

  const analyzer = new DocsAnalyzer();

  const cleanDoc = [
    '# Technical Architecture Specification',
    '',
    'This module coordinates file preprocessing and incremental indexing.',
    '',
    '```ts',
    '// Code fences are exempt from terminology matching',
    'const temporary = true;',
    '```',
  ].join('\n');

  const cleanIssues = analyzer.analyze(null, {
    filePath: 'docs/spec.md',
    content: cleanDoc,
    options: {},
    config: { root: '.' },
  });
  const docTrmClean = cleanIssues.filter((i) => i.rule === 'DOC-TRM-001');
  assert.strictEqual(
    docTrmClean.length,
    0,
    'Clean markdown documentation must not trigger DOC-TRM-001',
  );

  const dirtyDoc = [
    '# Product Overview',
    '',
    '这是一套工业级极致天花板架构，彻底解决所有崩溃。',
  ].join('\n');

  const dirtyIssues = analyzer.analyze(null, {
    filePath: 'docs/spec.md',
    content: dirtyDoc,
    options: {},
    config: { root: '.' },
  });
  const docTrmDirty = dirtyIssues.filter((i) => i.rule === 'DOC-TRM-001');
  assert(docTrmDirty.length >= 1, 'Non-objective documentation must trigger DOC-TRM-001');
  assert.strictEqual(docTrmDirty[0].severity, 'warning');

  process.stdout.write('    ✔ DocsAnalyzer DOC-TRM-001 integration verified.\n');
}

/** Test stage 5: Scoring deduction table mapping */
function testScoringDeductionMapping() {
  process.stdout.write(
    '  ▶ [Scoring Table] Testing deduction mappings for CMT-TRM-001 and DOC-TRM-001...\n',
  );

  const cmtFinding = {
    id: 'comments:CMT-TRM-001:src/a.ts:1',
    analyzer: 'comments',
    rule: 'CMT-TRM-001',
    message: 'Comment prose contains non-objective terminology',
    severity: 'warning',
    location: { file: 'src/a.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
  };

  const cmtDeductions = DIMENSION_RULES.filter(
    (entry) => entry.analyzer === 'comments' && entry.covers(cmtFinding),
  );
  assert(cmtDeductions.length > 0, 'CMT-TRM-001 must have deduction mapping in dimension table');
  assert.strictEqual(cmtDeductions[0].dimension, 'commentQuality');

  const docFinding = {
    id: 'docs:DOC-TRM-001:docs/a.md:1',
    analyzer: 'docs',
    rule: 'DOC-TRM-001',
    message: 'Documentation prose contains non-objective terminology',
    severity: 'warning',
    location: { file: 'docs/a.md', start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
  };

  const docDeductions = DIMENSION_RULES.filter(
    (entry) => entry.analyzer === 'docs' && entry.covers(docFinding),
  );
  assert(docDeductions.length > 0, 'DOC-TRM-001 must have deduction mapping in dimension table');
  assert.strictEqual(docDeductions[0].dimension, 'standardization');

  process.stdout.write('    ✔ Scoring table deduction mappings verified.\n');
}

/** Test stage 6: Preflight index and sparse activation boost */
function testPreflightAndSparseActivation() {
  process.stdout.write(
    '  ▶ [Preflight & Activator] Testing terminology sensitivity and activation boost...\n',
  );

  const docContent = '# System Architecture\nProvides core system design documentation.';
  const docEntry = buildFileAuditIndex('docs/overview.md', docContent);
  assert.strictEqual(
    docEntry.risk.isTerminologySensitive,
    true,
    'Doc file must be terminology sensitive',
  );

  const codeWithHighComments = [
    '// Architectural comment line 1',
    '// Architectural comment line 2',
    '// Architectural comment line 3',
    'export const value = 1;',
  ].join('\n');
  const codeEntry = buildFileAuditIndex('src/core/helper.ts', codeWithHighComments);
  assert.strictEqual(
    codeEntry.risk.isTerminologySensitive,
    true,
    'High comment ratio file must be sensitive',
  );

  const sparsePlan = activateSparseAnalyzers(
    ['comments', 'docs', 'complexity', 'hygiene'],
    [codeEntry, docEntry],
    {
      mode: 'CHANGESET',
      reason: 'Git modified files',
      targetFiles: ['src/core/helper.ts', 'docs/overview.md'],
    },
    new Set(['src/core/helper.ts', 'docs/overview.md']),
  );

  assert(sparsePlan.selectedFiles.includes('src/core/helper.ts'), 'Helper must be selected');
  assert(
    (sparsePlan.fileAnalyzerMap['src/core/helper.ts'] || []).includes('comments'),
    'Comments analyzer must be activated for terminology sensitive changed file',
  );

  process.stdout.write('    ✔ Preflight index and sparse activator boost verified.\n');
}

function main() {
  process.stdout.write(
    '=== Terminology Constraints & Governance Engine Verification Suite ===\n\n',
  );

  testSanitizationAndWhitelisting();
  testBilingualTerminologyDetection();
  testCommentAnalyzerIntegration();
  testDocsAnalyzerIntegration();
  testScoringDeductionMapping();
  testPreflightAndSparseActivation();

  process.stdout.write('\n✔ All terminology governance test suites passed successfully!\n');
}

main();
