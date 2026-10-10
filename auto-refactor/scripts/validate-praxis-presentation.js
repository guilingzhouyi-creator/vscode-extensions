/**
 * Module: Verification Harness — Praxis Presentation & i18n Localization Adapter
 * File Path: scripts/validate-praxis-presentation.js
 * Architecture Role: Verifies the presentation layer contracts, bilingual i18n dictionaries,
 *   graceful registry fallback, and end-to-end auditAndPresent pipeline.
 * Dependencies & Triggers: Consumes ../dist/api; executed in CI / test-parallel.
 * Responsibilities:
 *   1. Assert defaultPraxisI18nProvider resolves Chinese and English rule entries;
 *   2. Assert graceful fallback to engine RULE_REGISTRY for unmapped rules;
 *   3. Assert toPresentation transforms CAPP prompts into rich UI diagnostic cards;
 *   4. Assert auditAndPresent simultaneously produces CAPP agent prompts and UI cards.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const {
  defaultPraxisI18nProvider,
  createPraxisI18nProvider,
  defaultPraxisPresentationService,
  formatCompactAgentPrompt,
  aggregateSemanticOverlappingCards,
  SEMANTIC_OVERLAP_GROUPS,
} = require('../dist/api');

async function testI18nProvider() {
  console.log('1. Testing defaultPraxisI18nProvider...');

  // Default locale should be zh-CN
  assert.strictEqual(defaultPraxisI18nProvider.getLocale(), 'zh-CN');

  // Query high-frequency rule in zh-CN
  const zhRule = defaultPraxisI18nProvider.getRuleText('SEC-CST-001', 'zh-CN');
  assert.ok(zhRule, 'Expected zh-CN entry for SEC-CST-001');
  assert.strictEqual(zhRule.name, '禁止硬编码敏感凭据');
  assert.ok(zhRule.summary.includes('硬编码'));
  assert.ok(zhRule.remediation.includes('环境变量'));

  // Query in English
  const enRule = defaultPraxisI18nProvider.getRuleText('SEC-CST-001', 'en');
  assert.ok(enRule, 'Expected en entry for SEC-CST-001');
  assert.strictEqual(enRule.name, 'Hardcoded Secret Prohibited');
  assert.ok(enRule.summary.includes('High-entropy'));

  // Common UI strings
  const zhCommon = defaultPraxisI18nProvider.getCommonStrings('zh-CN');
  assert.strictEqual(zhCommon.badgeBlock, '阻断');
  assert.strictEqual(zhCommon.badgeWarn, '警告');

  const enCommon = defaultPraxisI18nProvider.getCommonStrings('en');
  assert.strictEqual(enCommon.badgeBlock, 'BLOCK');
  assert.strictEqual(enCommon.badgeWarn, 'WARN');

  // Graceful fallback to RULE_REGISTRY
  const fallbackRule = defaultPraxisI18nProvider.getRuleText('GOV-DBG-001', 'zh-CN');
  assert.ok(fallbackRule, 'Expected fallback entry from RULE_REGISTRY for GOV-DBG-001');
  assert.ok(fallbackRule.summary.length > 0, 'Summary should be populated from rule registry');
  assert.ok(
    fallbackRule.remediation.length > 0,
    'Remediation should be populated from rule registry',
  );

  // Custom extension rule registration
  const isolatedProvider = createPraxisI18nProvider('zh-CN');
  isolatedProvider.registerRuleI18n('zh-CN', {
    'CUSTOM-RULE-001': {
      name: '自定义业务检查',
      summary: '业务定制规范检查项',
      remediation: '遵循团队设计规范',
    },
  });
  const custom = isolatedProvider.getRuleText('CUSTOM-RULE-001', 'zh-CN');
  assert.ok(custom);
  assert.strictEqual(custom.name, '自定义业务检查');

  console.log('  ✔ i18n provider correctly resolves translations and fallback metadata');
}

async function testToPresentation() {
  console.log('\n2. Testing toPresentation conversion...');

  const issues = [
    {
      id: 'i1',
      analyzer: 'security',
      rule: 'SEC-CST-001',
      severity: 'error',
      message: 'Found hardcoded secret key',
      location: { file: 'src/config.ts', start: { line: 42, column: 10 } },
      suggestion: 'process.env.API_KEY',
    },
    {
      id: 'i2',
      analyzer: 'performance',
      rule: 'ADV-PRF-001',
      severity: 'warning',
      message: 'Expensive property access inside loop',
      location: { file: 'src/config.ts', start: { line: 88, column: 5 } },
      suggestion: 'const cached = obj.prop',
    },
  ];

  const agentPrompt = formatCompactAgentPrompt('src/config.ts#L40-L90', issues);
  assert.strictEqual(agentPrompt.verdict, 'BLOCK');

  // Presentation in zh-CN
  const payloadZh = defaultPraxisPresentationService.toPresentation(agentPrompt, {
    locale: 'zh-CN',
    docsBaseUrl: 'https://praxis.internal/rules',
  });

  assert.strictEqual(payloadZh.target, 'src/config.ts#L40-L90');
  assert.strictEqual(payloadZh.overallVerdict, 'BLOCK');
  assert.strictEqual(payloadZh.locale, 'zh-CN');
  assert.strictEqual(payloadZh.metrics.totalDirectives, 2);
  assert.strictEqual(payloadZh.metrics.blockCount, 1);
  assert.strictEqual(payloadZh.metrics.warnCount, 1);
  assert.strictEqual(payloadZh.metrics.infoCount, 0);
  assert.ok(payloadZh.metrics.tokenSavingsRatio >= 0.7);

  // Cards verification
  assert.strictEqual(payloadZh.cards.length, 2);
  const blockCard = payloadZh.cards[0];
  assert.strictEqual(blockCard.ruleId, 'SEC-CST-001');
  assert.strictEqual(blockCard.severity, 'block');
  assert.strictEqual(blockCard.badgeText, '[阻断]');
  assert.strictEqual(blockCard.badgeColor, 'red');
  assert.strictEqual(blockCard.title, '禁止硬编码敏感凭据');
  assert.strictEqual(blockCard.file, 'config.ts');
  assert.strictEqual(blockCard.line, 42);
  assert.strictEqual(blockCard.quickFixSnippet, 'process.env.API_KEY');
  assert.strictEqual(blockCard.docsUrl, 'https://praxis.internal/rules/SEC-CST-001');
  assert.ok(blockCard.sourceAgentDirective.includes('[GUARD|BLOCK|SEC-CST-001]'));

  // Dual-faced traceability
  assert.strictEqual(payloadZh.rawAgentPrompt, agentPrompt);

  // Presentation in English
  const payloadEn = defaultPraxisPresentationService.toPresentation(agentPrompt, {
    locale: 'en',
  });
  assert.strictEqual(payloadEn.locale, 'en');
  assert.strictEqual(payloadEn.cards[0].badgeText, '[BLOCK]');
  assert.strictEqual(payloadEn.cards[0].title, 'Hardcoded Secret Prohibited');
  assert.strictEqual(payloadEn.cards[1].badgeText, '[WARN]');
  assert.strictEqual(payloadEn.cards[1].badgeColor, 'yellow');

  console.log(
    '  ✔ toPresentation converts CAPP prompts into rich localized cards with dual-faced alignment',
  );
}

async function testAuditAndPresentEndToEnd() {
  console.log('\n3. Testing auditAndPresent end-to-end pipeline...');

  const startTime = Date.now();
  const fakeToken = ['ghp', 'x'.repeat(28)].join('_');
  const input = {
    file: 'src/core/cache.ts',
    oldCode: 'export function run() { return 1; }',
    newCode: `export function run() {\n    const secretToken = "${fakeToken}";\n    return secretToken;\n}`,
    changedLines: [2],
  };

  const payload = await defaultPraxisPresentationService.auditAndPresent(input, {
    locale: 'zh-CN',
  });
  const durationMs = Date.now() - startTime;

  assert.ok(payload);
  assert.strictEqual(payload.target, 'src/core/cache.ts#L2');
  assert.ok(Array.isArray(payload.cards));
  assert.ok(payload.rawAgentPrompt);
  assert.ok(payload.rawAgentPrompt.compactPromptText.length > 0);

  console.log(`  ✔ auditAndPresent completed in ${durationMs}ms`);
  console.log(`    - Overall verdict: ${payload.overallVerdict}`);
  console.log(`    - Cards count: ${payload.cards.length}`);
  console.log(`    - Summary text: "${payload.summaryText}"`);
  console.log(
    `    - Raw CAPP prompt:\n      ${payload.rawAgentPrompt.compactPromptText.split('\n')[0]}`,
  );
}

async function testSemanticOverlapAggregation() {
  console.log('\n4. Testing semantic overlap aggregation and diagnostic deduplication...');

  assert.ok(Array.isArray(SEMANTIC_OVERLAP_GROUPS), 'SEMANTIC_OVERLAP_GROUPS should be an array');
  assert.strictEqual(SEMANTIC_OVERLAP_GROUPS.length, 11, 'Expected exactly 11 overlap groups');
  assert.strictEqual(typeof aggregateSemanticOverlappingCards, 'function');

  const issues = [
    {
      id: 'issue-hyg-stb',
      analyzer: 'hygiene',
      rule: 'HYG-STB-002',
      severity: 'error',
      message: 'Empty stub placeholder found',
      location: { file: 'src/modules/order.ts', start: { line: 15, column: 4 } },
      suggestion: 'Implement concrete business logic',
    },
    {
      id: 'issue-gov-san',
      analyzer: 'governance',
      rule: 'GOV-SAN-001',
      severity: 'warning',
      message: 'Missing input sanitization guard',
      location: { file: 'src/modules/order.ts', start: { line: 15, column: 4 } },
      suggestion: 'Sanitize untrusted input',
    },
  ];

  const agentPrompt = formatCompactAgentPrompt('src/modules/order.ts#L15', issues);

  // 1. Aggregation enabled (default behavior)
  const payloadAggregated = defaultPraxisPresentationService.toPresentation(agentPrompt);
  assert.strictEqual(
    payloadAggregated.cards.length,
    1,
    'Expected 2 issues to be aggregated into 1 card',
  );
  const primaryCard = payloadAggregated.cards[0];
  assert.strictEqual(
    primaryCard.ruleId,
    'HYG-STB-002',
    'Error severity should be elected as primary card',
  );
  assert.strictEqual(primaryCard.severity, 'block');
  assert.deepStrictEqual(primaryCard.correlatedRules, ['GOV-SAN-001']);
  assert.strictEqual(primaryCard.correlationCount, 1);
  assert.strictEqual(payloadAggregated.metrics.totalDirectives, 1);
  assert.strictEqual(payloadAggregated.metrics.blockCount, 1);
  assert.strictEqual(payloadAggregated.metrics.warnCount, 0);

  // 2. Aggregation disabled via options
  const payloadDisabled = defaultPraxisPresentationService.toPresentation(agentPrompt, {
    aggregateOverlaps: false,
  });
  assert.strictEqual(
    payloadDisabled.cards.length,
    2,
    'Expected 2 cards when aggregateOverlaps is false',
  );
  assert.strictEqual(payloadDisabled.cards[0].ruleId, 'HYG-STB-002');
  assert.strictEqual(payloadDisabled.cards[1].ruleId, 'GOV-SAN-001');
  assert.strictEqual(payloadDisabled.cards[0].correlatedRules, undefined);
  assert.strictEqual(payloadDisabled.cards[1].correlatedRules, undefined);
  assert.strictEqual(payloadDisabled.metrics.totalDirectives, 2);
  assert.strictEqual(payloadDisabled.metrics.blockCount, 1);
  assert.strictEqual(payloadDisabled.metrics.warnCount, 1);

  // 3. Direct function edge cases
  assert.deepStrictEqual(aggregateSemanticOverlappingCards([]), []);
  assert.strictEqual(aggregateSemanticOverlappingCards([primaryCard]).length, 1);

  console.log(
    '  ✔ Semantic overlap successfully aggregated cards by severity and collected correlated rules',
  );
}

async function runAll() {
  console.log('=== Starting Praxis Presentation & i18n Verification Suite ===\n');
  await testI18nProvider();
  await testToPresentation();
  await testAuditAndPresentEndToEnd();
  await testSemanticOverlapAggregation();
  console.log('\n=== All Praxis Presentation & i18n tests passed successfully! ===');
}

runAll().catch((err) => {
  console.error('\n❌ Verification failed with error:', err);
  process.exit(1);
});
