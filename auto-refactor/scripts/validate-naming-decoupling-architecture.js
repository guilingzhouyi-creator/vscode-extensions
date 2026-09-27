/**
 * Module: Test Pipeline — Identifier Length & Architectural Decoupling Validation
 * File Path: scripts/validate-naming-decoupling-architecture.js
 * Architecture Role: Verifies the NamingDecouplingAuditor, NAM-DEC-001 rule emission,
 *   token segmentation, domain prefix clustering, and quality scoring deduction routing.
 * Dependencies & Triggers: Node assert; executed as test suite 106 in scripts/test-parallel.js.
 * Responsibilities:
 *   1. Validate semantic tokenization and threshold gating across camel, Pascal, snake, and UPPER.
 *   2. Validate Domain Prefix Clustering for flat symbol architectures.
 *   3. Validate end-to-end NamingAnalyzer emission of NAM-DEC-001 and actionable proposals.
 *   4. Validate Python multi-language support for decoupling detection.
 *   5. Validate scoring deduction routing into architectureConsistency and standardization.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on failure.
 */

'use strict';

const assert = require('assert');
const {
  splitIdentifierTokens,
  NamingDecouplingAuditor,
} = require('../dist/core/architecture/naming-decoupling-auditor');
const { NamingAnalyzer } = require('../dist/analyzers/naming');
const { DIMENSION_RULES } = require('../dist/core/scoring/dimensionRuleTable');
const {
  RULE_NAM_DEC_001,
  DEDUCTION_NAMING_DECOUPLING,
  DIMENSION_ARCHITECTURE_CONSISTENCY,
  DIMENSION_STANDARDIZATION,
  ANALYZER_NAMING,
} = require('../dist/core/scoring/dimensionLiterals');

function testTokenizationAndThresholds() {
  console.log('1. Testing Identifier Tokenization and Single Symbol Thresholds...');

  // Tokenization checks
  const tokensPascal = splitIdentifierTokens(
    'UserAuthenticationSessionTokenValidationServiceManager',
  );
  assert.deepStrictEqual(
    tokensPascal,
    ['User', 'Authentication', 'Session', 'Token', 'Validation', 'Service', 'Manager'],
    'PascalCase tokenization should split into 7 distinct semantic segments',
  );

  const tokensUpper = splitIdentifierTokens(
    'CONFIG_NETWORK_HTTP_REST_API_TIMEOUT_RETRY_INTERVAL_MS',
  );
  assert.deepStrictEqual(
    tokensUpper,
    ['CONFIG', 'NETWORK', 'HTTP', 'REST', 'API', 'TIMEOUT', 'RETRY', 'INTERVAL', 'MS'],
    'UPPER_SNAKE_CASE tokenization should split by underscores',
  );

  const auditor = new NamingDecouplingAuditor();

  // Test excessive length type
  const typeFinding = auditor.auditIdentifier(
    'UserAuthenticationSessionTokenValidationServiceManager',
    'class',
    10,
    1,
  );
  assert.ok(typeFinding, 'Ultra-long class name must trigger NAM-DEC-001 finding');
  assert.strictEqual(typeFinding.severity, 'error', '54-char class should be error tier');
  assert.ok(
    typeFinding.suggestedDomainDirectory.includes('domain/'),
    'Should propose domain directory namespace',
  );
  assert.strictEqual(
    typeFinding.actionableProposal.action,
    'decompose_module',
    'Should propose decompose_module actionable payload',
  );
  assert.strictEqual(typeFinding.actionableProposal.rule, RULE_NAM_DEC_001);

  // Test excessive constant
  const constFinding = auditor.auditIdentifier(
    'CONFIG_NETWORK_HTTP_REST_API_TIMEOUT_RETRY_INTERVAL_MS',
    'constant',
    20,
    1,
  );
  assert.ok(constFinding, 'Ultra-long constant must trigger NAM-DEC-001 finding');
  assert.ok(
    constFinding.actionableProposal.suggestedSymbol.length < constFinding.symbol.length,
    'Suggested symbol must be more concise than original symbol',
  );

  // Test compact, well-proportioned identifiers
  const normalType = auditor.auditIdentifier('TokenValidator', 'class', 1, 1);
  assert.strictEqual(normalType, null, 'Normal class name should not trigger finding');

  const normalVar = auditor.auditIdentifier('retryCount', 'variable', 2, 1);
  assert.strictEqual(normalVar, null, 'Normal variable name should not trigger finding');

  console.log('  ✔ [PASS] Tokenization and threshold checks passed.');
}

function testDomainPrefixClustering() {
  console.log('2. Testing Domain Prefix Clustering for Flat Architectures...');

  const auditor = new NamingDecouplingAuditor();

  const flatSymbols = [
    { name: 'PlayerInventoryEquipmentSlot', kind: 'class', line: 10, column: 1 },
    { name: 'PlayerInventoryEquipmentBag', kind: 'class', line: 20, column: 1 },
    { name: 'PlayerInventoryEquipmentManager', kind: 'class', line: 30, column: 1 },
    { name: 'PlayerInventoryEquipmentItem', kind: 'class', line: 40, column: 1 },
    { name: 'RegularGameEngine', kind: 'class', line: 50, column: 1 },
  ];

  const clusterFindings = auditor.auditClusters(flatSymbols);
  assert.strictEqual(
    clusterFindings.length,
    4,
    'All 4 symbols sharing PlayerInventoryEquipment prefix must be flagged for clustering',
  );

  for (const finding of clusterFindings) {
    assert.strictEqual(finding.reason, 'domain_prefix_clustering');
    assert.ok(
      finding.suggestedDomainDirectory.includes('player'),
      'Directory suggestion should incorporate clustered domain tokens',
    );
  }

  // Under-threshold cluster (only 2 symbols)
  const sparseSymbols = [
    { name: 'PlayerInventoryEquipmentSlot', kind: 'class', line: 10, column: 1 },
    { name: 'PlayerInventoryEquipmentBag', kind: 'class', line: 20, column: 1 },
  ];
  const sparseFindings = auditor.auditClusters(sparseSymbols);
  assert.strictEqual(sparseFindings.length, 0, 'Clusters under 4 symbols should not trigger');

  console.log('  ✔ [PASS] Domain prefix clustering passed.');
}

function testNamingAnalyzerEndToEndTs() {
  console.log('3. Testing NamingAnalyzer End-to-End AST Audit (TypeScript)...');

  const analyzer = new NamingAnalyzer();
  const tsContent = `
export class UserAuthenticationSessionTokenValidationServiceManager {
    public validateToken(): boolean {
        const CONFIG_NETWORK_HTTP_REST_API_TIMEOUT_RETRY_INTERVAL_MS = 30000;
        return true;
    }
}

export class PlayerInventoryEquipmentSlot {}
export class PlayerInventoryEquipmentBag {}
export class PlayerInventoryEquipmentManager {}
export class PlayerInventoryEquipmentItem {}
`;

  const ctx = {
    filePath: 'src/services/monolith.ts',
    content: tsContent,
    options: {},
  };

  const issues = analyzer.analyze(undefined, ctx);
  const decouplingIssues = issues.filter((i) => i.rule === 'NAM-DEC-001');

  assert.ok(
    decouplingIssues.length >= 2,
    `Expected at least 2 NAM-DEC-001 issues, got ${decouplingIssues.length}`,
  );

  const classIssue = decouplingIssues.find(
    (i) => i.detail && i.detail.symbol === 'UserAuthenticationSessionTokenValidationServiceManager',
  );
  assert.ok(classIssue, 'Should flag ultra-long class name in AST');
  assert.ok(classIssue.detail.actionableProposal, 'Issue detail must contain actionableProposal');
  assert.strictEqual(classIssue.detail.actionableProposal.action, 'decompose_module');

  // Verify disabling option works
  const disabledIssues = analyzer.analyze(undefined, {
    ...ctx,
    options: { checkDecoupling: false },
  });
  const disabledDecoupling = disabledIssues.filter((i) => i.rule === 'NAM-DEC-001');
  assert.strictEqual(
    disabledDecoupling.length,
    0,
    'checkDecoupling: false must suppress all NAM-DEC-001 issues',
  );

  console.log('  ✔ [PASS] TypeScript AST end-to-end integration passed.');
}

function testNamingAnalyzerEndToEndPython() {
  console.log('4. Testing NamingAnalyzer End-to-End Audit (Python)...');

  const analyzer = new NamingAnalyzer();
  const pyContent = `
class UserAuthenticationSessionTokenValidationServiceManager:
    pass

CONFIG_NETWORK_HTTP_REST_API_TIMEOUT_RETRY_INTERVAL_MS = 5000
`;

  const ctx = {
    filePath: 'src/services/auth_service.py',
    content: pyContent,
    options: {},
  };

  const issues = analyzer.analyze(undefined, ctx);
  const decouplingIssues = issues.filter((i) => i.rule === 'NAM-DEC-001');

  assert.ok(
    decouplingIssues.length >= 2,
    `Expected Python NAM-DEC-001 issues, got ${decouplingIssues.length}`,
  );
  assert.strictEqual(decouplingIssues[0].rule, 'NAM-DEC-001');

  console.log('  ✔ [PASS] Python end-to-end integration passed.');
}

function testScoringRuleTableRouting() {
  console.log('5. Testing Quality Scoring Rule Table Routing...');

  // Check architecture consistency rule coverage
  const archRule = DIMENSION_RULES.find(
    (r) => r.analyzer === ANALYZER_NAMING && r.dimension === DIMENSION_ARCHITECTURE_CONSISTENCY,
  );
  assert.ok(
    archRule,
    'DIMENSION_RULES must contain NAM-DEC-001 mapping for architectureConsistency',
  );
  assert.strictEqual(
    archRule.points,
    DEDUCTION_NAMING_DECOUPLING,
    'Points deducted must match DEDUCTION_NAMING_DECOUPLING (15)',
  );

  // Check sample issue matching
  const sampleDecoupleIssue = {
    rule: RULE_NAM_DEC_001,
    analyzer: ANALYZER_NAMING,
    message: 'Excessive identifier length suggests architectural decomposition',
  };
  assert.strictEqual(
    archRule.covers(sampleDecoupleIssue),
    true,
    'Architecture consistency rule must cover NAM-DEC-001',
  );

  // Check standardization coverage
  const stdRule = DIMENSION_RULES.find(
    (r) => r.analyzer === ANALYZER_NAMING && r.dimension === DIMENSION_STANDARDIZATION,
  );
  assert.ok(stdRule, 'DIMENSION_RULES must map ANALYZER_NAMING into standardization');

  console.log('  ✔ [PASS] Scoring rule table routing verified.');
}

function runAll() {
  console.log('=== Validating Naming Decoupling Architecture (NAM-DEC-001) ===\n');
  testTokenizationAndThresholds();
  testDomainPrefixClustering();
  testNamingAnalyzerEndToEndTs();
  testNamingAnalyzerEndToEndPython();
  testScoringRuleTableRouting();
  console.log('\n[PASS] All 5 Naming Decoupling Architecture test suites passed successfully!');
}

try {
  runAll();
} catch (err) {
  console.error('\n[FAIL] Naming decoupling architecture validation failed:', err);
  process.exit(1);
}
