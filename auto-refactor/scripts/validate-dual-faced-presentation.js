/**
 * Module: Verification Harness — Dual-Faced Presentation & Standard Terminology Governance
 * File Path: scripts/validate-dual-faced-presentation.js
 * Architecture Role: Verifies dual-faced presentation contracts for Agent and Praxis UI faces.
 * Dependencies & Triggers: Consumes ../dist/api; executed via test-parallel and npm test.
 * Responsibilities:
 *   1. Assert CAPP 2.0 compression, structured markdown, and actionable directives.
 *   2. Assert Praxis UI diagnostic card taxonomy, badges, i18n, and remediation snippets.
 *   3. Assert dual-faced data symmetry between Agent directives and UI cards.
 *   4. Assert standard terminology SSOT categorization and actionable remediation verbs.
 * Exit Semantics & Design Rationale: Exits 0 on success; throws AssertionError on failure.
 */

'use strict';

const path = require('path');
const assert = require('assert');
const {
  toCapp,
  toAgentReview,
  toPraxisPresentation,
  render,
  formatCompactGuardDirective,
  formatCompactAgentPrompt,
  defaultPraxisPresentationService,
  resolveRuleTaxonomy,
  DEFECT_TAXONOMY_SPECS,
  ACTION_VERB_SPECS,
  isStandardActionVerb,
} = require('../dist/api');

function createSampleScanReport() {
  const issues = [
    {
      id: 'num:NUM-PREC-001:src/score.ts:42',
      analyzer: 'governance',
      rule: 'NUM-PREC-001',
      severity: 'warning',
      message: 'Lossy precision rounding Math.round(v * 10) / 10 detected.',
      location: {
        file: 'src/score.ts',
        start: { line: 42, column: 12 },
        end: { line: 42, column: 40 },
      },
      suggestion: 'Use standard 0.01 precision rounding.',
      actionable: {
        action: 'align_numeric_precision',
        code: 'AR:NUM:001',
        taxonomy: 'NUM_PREC',
        safeToAutomate: true,
        templateSnippet: 'Math.round(val * 100) / 100 + 0',
        targetArguments: {
          matchedExpression: 'Math.round(v * 10) / 10',
          standardPrecision: 0.01,
        },
      },
    },
    {
      id: 'test:TST-FLT-001:tests/unit/score.test.ts:88',
      analyzer: 'test-modernity',
      rule: 'TST-FLT-001',
      severity: 'warning',
      message: "Fragile floating-point assertion: asserts naked float literal '0.85'.",
      location: {
        file: 'tests/unit/score.test.ts',
        start: { line: 88, column: 5 },
        end: { line: 88, column: 60 },
      },
      suggestion: 'Use tolerance assertion toBeCloseTo.',
      actionable: {
        action: 'replace_with_tolerance_assertion',
        code: 'AR:TST:004',
        taxonomy: 'TEST_MODERN',
        safeToAutomate: true,
        templateSnippet: 'expect(actual).toBeCloseTo(0.85, 2);',
        targetArguments: {
          targetLiteral: '0.85',
          toleranceDecimals: 2,
        },
      },
    },
    {
      id: 'gov:GOV-SAN-002:src/core/notes.ts:15',
      analyzer: 'governance',
      rule: 'GOV-SAN-002',
      severity: 'warning',
      message: "Promotional or non-objective prose '完美无瑕' detected in docstring.",
      location: {
        file: 'src/core/notes.ts',
        start: { line: 15, column: 8 },
        end: { line: 15, column: 20 },
      },
      suggestion: 'Use objective factual statements.',
      actionable: {
        action: 'sanitize_prose_terminology',
        code: 'AR:GOV:001',
        taxonomy: 'GOV_NORM',
        safeToAutomate: false,
        templateSnippet: 'State verifiable technical scope and bounds.',
        targetArguments: {
          forbiddenTerm: '完美无瑕',
          category: 'hyperbolic_affirmative',
        },
      },
    },
    {
      id: 'cpx:high-complexity:src/engine.ts:120',
      analyzer: 'complexity',
      rule: 'high-complexity',
      severity: 'error',
      message: 'Function processTask has cyclomatic complexity 18 (threshold 10).',
      location: {
        file: 'src/engine.ts',
        start: { line: 120, column: 1 },
        end: { line: 180, column: 2 },
      },
      suggestion: 'Extract pure predicate helpers or use strategy lookup map.',
      actionable: {
        action: 'apply_guard_clause',
        code: 'AR:CPX:001',
        taxonomy: 'CTRL_FLOW',
        safeToAutomate: false,
        templateSnippet: 'if (!condition) return defaultValue;',
        targetArguments: {
          cyclomaticComplexity: 18,
          threshold: 10,
          functionName: 'processTask',
        },
      },
    },
  ];

  return {
    version: '0.4.0',
    tool: 'auto-refactor',
    root: path.resolve(__dirname, '..'),
    generatedAt: '2026-10-04T12:00:00.000Z',
    summary: {
      filesScanned: 4,
      issuesTotal: 4,
      durationMs: 45,
      bySeverity: {
        error: 1,
        warning: 3,
        info: 0,
      },
      byAnalyzer: {
        governance: 2,
        'test-modernity': 1,
        complexity: 1,
      },
      warnings: [],
    },
    issues,
  };
}

function testStandardTerminologySSOT() {
  console.log('1. Testing Standard Terminology SSOT...');

  const expectedTaxonomies = [
    'ARCH_LAYER',
    'CTRL_FLOW',
    'NUM_PREC',
    'TEST_MODERN',
    'GOV_NORM',
    'SEC_GUARD',
  ];

  for (const cat of expectedTaxonomies) {
    const spec = DEFECT_TAXONOMY_SPECS[cat];
    assert(spec, `Defect taxonomy spec missing for ${cat}`);
    assert.strictEqual(spec.code, cat);
    assert(spec.title.length > 0, `Taxonomy title empty for ${cat}`);
    assert(spec.zhTitle.length > 0, `Taxonomy zhTitle empty for ${cat}`);
  }

  assert.strictEqual(resolveRuleTaxonomy('NUM-PREC-001'), 'NUM_PREC');
  assert.strictEqual(resolveRuleTaxonomy('TST-FLT-001'), 'TEST_MODERN');
  assert.strictEqual(resolveRuleTaxonomy('ADV-CMP-001'), 'CTRL_FLOW');
  assert.strictEqual(resolveRuleTaxonomy('ADV-NST-001'), 'CTRL_FLOW');
  assert.strictEqual(resolveRuleTaxonomy('ARCH-FAC-001'), 'ARCH_LAYER');
  assert.strictEqual(resolveRuleTaxonomy('SEC-CST-001'), 'SEC_GUARD');

  const actionKeys = Object.keys(ACTION_VERB_SPECS);
  assert(actionKeys.length >= 16, `Expected at least 16 action verbs, got ${actionKeys.length}`);
  assert(isStandardActionVerb('align_numeric_precision'));
  assert(isStandardActionVerb('replace_with_tolerance_assertion'));
  assert(isStandardActionVerb('sanitize_prose_terminology'));
  assert(isStandardActionVerb('apply_guard_clause'));
  assert(!isStandardActionVerb('unknown_action_verb'));

  console.log('  ✔ Standard Terminology SSOT and taxonomies verified successfully');
}

function testAgentFacingFace() {
  console.log('\n2. Testing Agent-Facing Face (CAPP 2.0 & Structured Directives)...');
  const report = createSampleScanReport();

  const cappText = toCapp(report);
  assert(cappText.includes('[CAPP:v'), 'CAPP output missing header');
  assert(cappText.includes('NUM-PREC-001'), 'CAPP missing NUM-PREC-001');
  assert(cappText.includes('action:align_numeric_precision'), 'CAPP missing actionable verb');
  assert(cappText.includes('[safe=true]'), 'CAPP missing safeToAutomate indicator');

  const directive = formatCompactGuardDirective(report.issues[0]);
  assert.strictEqual(directive.ruleId, 'NUM-PREC-001');
  assert.strictEqual(directive.actionable?.action, 'align_numeric_precision');
  assert.strictEqual(directive.actionable?.safeToAutomate, true);

  const agentPrompt = formatCompactAgentPrompt('test-scope', report.issues);
  assert(
    agentPrompt.tokenSavingsRatio >= 0.65,
    `Expected token savings ratio >= 0.65, got ${agentPrompt.tokenSavingsRatio}`,
  );
  assert.strictEqual(agentPrompt.verdict, 'BLOCK');

  const markdownReview = toAgentReview(report);
  assert(markdownReview.includes('# Static Analysis Review Directives for AI Agent'));
  assert(markdownReview.includes('### [WARNING|NUM-PREC-001]'));
  assert(markdownReview.includes('Action: `align_numeric_precision`'));
  assert(markdownReview.includes('Math.round(val * 100) / 100 + 0'));
  assert(markdownReview.includes('### [ERROR|high-complexity]'));

  const renderedAgent = render(report, 'agent');
  assert.strictEqual(renderedAgent, markdownReview);

  const renderedCapp = render(report, 'capp');
  assert.strictEqual(renderedCapp, cappText);

  console.log('  ✔ Agent-facing face (CAPP 2.0 and markdown prompt) verified successfully');
}

function testPraxisUiFace() {
  console.log('\n3. Testing Human & Praxis UI Face (Payload, Cards, i18n & QuickFix)...');
  const report = createSampleScanReport();

  const presentationJson = toPraxisPresentation(report, { locale: 'zh-CN' });
  const payload = JSON.parse(presentationJson);

  assert.strictEqual(payload.overallVerdict, 'BLOCK');
  assert.strictEqual(payload.locale, 'zh-CN');
  assert.strictEqual(payload.metrics.totalDirectives, 4);
  assert.strictEqual(payload.metrics.blockCount, 1);
  assert.strictEqual(payload.metrics.warnCount, 3);
  assert.strictEqual(payload.cards.length, 4);

  const cardPrecision = payload.cards.find((c) => c.ruleId === 'NUM-PREC-001');
  assert(cardPrecision, 'NUM-PREC-001 card missing');
  assert.strictEqual(cardPrecision.badgeColor, 'yellow');
  assert.strictEqual(cardPrecision.badgeText, '[警告]');
  assert.strictEqual(cardPrecision.title, '数值截断精度失衡');
  assert.strictEqual(cardPrecision.taxonomy, 'NUM_PREC');
  assert.strictEqual(cardPrecision.actionVerb, 'align_numeric_precision');
  assert.strictEqual(cardPrecision.safeToAutomate, true);
  assert.strictEqual(cardPrecision.quickFixSnippet, 'Math.round(val * 100) / 100 + 0');

  const cardTest = payload.cards.find((c) => c.ruleId === 'TST-FLT-001');
  assert(cardTest, 'TST-FLT-001 card missing');
  assert.strictEqual(cardTest.title, '脆弱浮点等值断言');
  assert.strictEqual(cardTest.taxonomy, 'TEST_MODERN');
  assert.strictEqual(cardTest.actionVerb, 'replace_with_tolerance_assertion');
  assert.strictEqual(cardTest.quickFixSnippet, 'expect(actual).toBeCloseTo(0.85, 2);');

  const cardSanitize = payload.cards.find((c) => c.ruleId === 'GOV-SAN-002');
  assert(cardSanitize, 'GOV-SAN-002 card missing');
  assert.strictEqual(cardSanitize.title, '源码与注释技术用语客观化');
  assert.strictEqual(cardSanitize.taxonomy, 'GOV_NORM');
  assert.strictEqual(cardSanitize.actionVerb, 'sanitize_prose_terminology');
  assert.strictEqual(cardSanitize.safeToAutomate, false);

  const cardComplexity = payload.cards.find((c) => c.ruleId === 'high-complexity');
  assert(cardComplexity, 'high-complexity card missing');
  assert.strictEqual(cardComplexity.badgeColor, 'red');
  assert.strictEqual(cardComplexity.badgeText, '[阻断]');
  assert.strictEqual(cardComplexity.taxonomy, 'CTRL_FLOW');

  const enPresentationJson = toPraxisPresentation(report, { locale: 'en' });
  const enPayload = JSON.parse(enPresentationJson);
  assert.strictEqual(enPayload.locale, 'en');
  const enCardPrecision = enPayload.cards.find((c) => c.ruleId === 'NUM-PREC-001');
  assert(enCardPrecision, 'English NUM-PREC-001 card missing');
  assert.strictEqual(enCardPrecision.badgeText, '[WARN]');
  assert.strictEqual(enCardPrecision.title, 'Lossy Precision Truncation Governance');

  const renderedPraxis = render(report, 'praxis');
  assert(renderedPraxis.startsWith('{') && renderedPraxis.endsWith('}'));

  console.log('  ✔ Human and Praxis UI presentation payload verified successfully');
}

function testDualFacedSymmetry() {
  console.log('\n4. Testing Dual-Faced Data Symmetry...');
  const report = createSampleScanReport();

  const payload = defaultPraxisPresentationService.fromScanReport(report, { locale: 'zh-CN' });
  const agentPrompt = formatCompactAgentPrompt(report.root, report.issues);

  assert.strictEqual(
    payload.cards.length,
    agentPrompt.directives.length,
    'Card count must match directive count',
  );

  for (let i = 0; i < payload.cards.length; i++) {
    const card = payload.cards[i];
    const directive = agentPrompt.directives[i];

    assert.strictEqual(card.ruleId, directive.ruleId, `Rule ID mismatch at index ${i}`);
    assert.strictEqual(card.line, directive.line, `Line number mismatch at index ${i}`);
    assert.strictEqual(
      card.sourceAgentDirective,
      directive.renderedDirective,
      `Source directive mismatch at index ${i}`,
    );

    if (directive.actionable) {
      assert.strictEqual(
        card.actionVerb,
        directive.actionable.action,
        `Action verb mismatch at index ${i}`,
      );
      assert.strictEqual(
        card.safeToAutomate,
        directive.actionable.safeToAutomate,
        `safeToAutomate mismatch at index ${i}`,
      );
      assert.strictEqual(
        card.quickFixSnippet,
        directive.actionable.templateSnippet,
        `QuickFix snippet mismatch at index ${i}`,
      );
    }
  }

  assert.strictEqual(
    payload.rawAgentPrompt.directives.length,
    agentPrompt.directives.length,
    'rawAgentPrompt directives must be deeply consistent',
  );

  console.log('  ✔ Dual-faced 100% data symmetry verified successfully');
}

function main() {
  console.log('=== Dual-Faced Architecture & Standard Terminology Verification ===\n');
  testStandardTerminologySSOT();
  testAgentFacingFace();
  testPraxisUiFace();
  testDualFacedSymmetry();
  console.log('\n=== All Dual-Faced Presentation Verification Suites Passed ===');
}

main();
