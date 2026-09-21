#!/usr/bin/env node
/**
 * Module: Verification Harness — Multi-Dimensional File Taxonomy & Role Ontology
 * File Path: scripts/validate-file-taxonomy-ontology.js
 * Architecture Role: Verification test suite asserting 8-role ontology classification,
 *   pseudo-shared library detection (ARCH-ROL-001), and domain utility creep (ARCH-ROL-002).
 * Dependencies & Triggers: Consumes file-taxonomy-ontology from dist/core/architecture;
 *   invoked by test-parallel.js runner.
 * Responsibilities: Assert classification across multi-criteria metric vectors,
 *   reject superficial size fallacies, and verify role distributions and issue emissions.
 * Exit Semantics & Design Rationale: Process exits 0 on all assertions passing, 1 on failure.
 */

'use strict';

const {
  classifyFileOntology,
  auditFileTaxonomy,
} = require('../dist/core/architecture/file-taxonomy-ontology');

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

function createTaxonomyFile(overrides = {}) {
  return {
    filePath: 'src/module.ts',
    loc: 100,
    codeDensity: 0.8,
    exportedSymbolCount: 5,
    fanInCount: 4,
    crossDomainFanIn: 1,
    fanOutCount: 1,
    isStateful: false,
    hasGlobalMutableState: false,
    pureFunctionRatio: 0.8,
    hasIoOrSystemImports: false,
    hasPoolOrBufferSymbols: false,
    hasRuleOrPolicySymbols: false,
    hasConstantOrEnumOnly: false,
    hasMathOrAlgoKeywords: false,
    domainName: 'core',
    ...overrides,
  };
}

function testConstantAndPoolRoles() {
  console.log('--- 1. Testing Constant and Pool Roles ---');
  // 1. Constant Registry Library
  const constRes = classifyFileOntology(
    createTaxonomyFile({
      filePath: 'src/constants/limits.ts',
      loc: 80,
      codeDensity: 0.7,
      exportedSymbolCount: 15,
      fanInCount: 10,
      crossDomainFanIn: 4,
      fanOutCount: 0,
      pureFunctionRatio: 1.0,
      hasConstantOrEnumOnly: true,
      domainName: 'constants',
    }),
  );
  assert(
    constRes.inferredRole === 'constant_registry_library',
    'Classified constant registry library',
  );

  // 2. Resource Pool Component
  const poolRes = classifyFileOntology(
    createTaxonomyFile({
      filePath: 'src/memory/packet_pool.ts',
      loc: 120,
      codeDensity: 0.85,
      exportedSymbolCount: 3,
      fanInCount: 6,
      crossDomainFanIn: 2,
      isStateful: true,
      pureFunctionRatio: 0.3,
      hasPoolOrBufferSymbols: true,
      domainName: 'memory',
    }),
  );
  assert(poolRes.inferredRole === 'resource_pool_component', 'Classified resource pool component');
}

function testRuleAndAlgoRoles() {
  console.log('--- 2. Testing Rule and Algorithm Roles ---');
  // 3. Rule Policy Module
  const ruleRes = classifyFileOntology(
    createTaxonomyFile({
      filePath: 'src/policy/discount_rules.ts',
      loc: 150,
      exportedSymbolCount: 8,
      fanOutCount: 2,
      pureFunctionRatio: 0.9,
      hasRuleOrPolicySymbols: true,
      domainName: 'pricing',
    }),
  );
  assert(ruleRes.inferredRole === 'rule_policy_module', 'Classified rule policy module');

  // 4. Algorithm / Operator Library
  const algoRes = classifyFileOntology(
    createTaxonomyFile({
      filePath: 'src/algo/matrix_transform.ts',
      loc: 200,
      codeDensity: 0.9,
      exportedSymbolCount: 6,
      fanInCount: 8,
      crossDomainFanIn: 3,
      fanOutCount: 0,
      pureFunctionRatio: 1.0,
      hasMathOrAlgoKeywords: true,
      domainName: 'math',
    }),
  );
  assert(
    algoRes.inferredRole === 'algorithm_operator_library',
    'Classified algorithm operator library',
  );
}

function testInfraAndSharedRoles() {
  console.log('--- 3. Testing Infrastructure and Shared Roles ---');
  // 5. Infrastructure Library
  const infraRes = classifyFileOntology(
    createTaxonomyFile({
      filePath: 'src/storage/disk_adapter.ts',
      loc: 180,
      fanInCount: 5,
      crossDomainFanIn: 2,
      fanOutCount: 4,
      isStateful: true,
      pureFunctionRatio: 0.2,
      hasIoOrSystemImports: true,
      domainName: 'storage',
    }),
  );
  assert(infraRes.inferredRole === 'infrastructure_library', 'Classified infrastructure library');

  // 6. True Shared Library
  const sharedRes = classifyFileOntology(
    createTaxonomyFile({
      filePath: 'src/shared/string_formatters.ts',
      loc: 90,
      fanInCount: 12,
      crossDomainFanIn: 4,
      fanOutCount: 0,
      pureFunctionRatio: 0.95,
      domainName: 'shared',
    }),
  );
  assert(sharedRes.inferredRole === 'shared_library', 'Classified true stateless shared library');
}

function testCapabilityAndBizRoles() {
  console.log('--- 4. Testing Capability and Business Domain Roles ---');
  // 7. Shared Capability Module
  const capRes = classifyFileOntology(
    createTaxonomyFile({
      filePath: 'src/orders/pipeline_builder.ts',
      loc: 110,
      exportedSymbolCount: 4,
      fanInCount: 5,
      crossDomainFanIn: 2,
      fanOutCount: 2,
      domainName: 'orders',
    }),
  );
  assert(capRes.inferredRole === 'shared_capability_module', 'Classified shared capability module');

  // 8. Business Domain Module
  const bizRes = classifyFileOntology(
    createTaxonomyFile({
      filePath: 'src/orders/order_entity.ts',
      loc: 140,
      exportedSymbolCount: 4,
      fanInCount: 2,
      crossDomainFanIn: 0,
      fanOutCount: 3,
      isStateful: true,
      pureFunctionRatio: 0.4,
      domainName: 'orders',
    }),
  );
  assert(bizRes.inferredRole === 'business_domain_module', 'Classified business domain module');
}

function testPseudoSharedAndUtilityCreep() {
  console.log('--- 2. Testing Pseudo-Shared Library Detection (ARCH-ROL-001) ---');
  const pseudoSharedFile = createTaxonomyFile({
    filePath: 'src/common/shared_session.ts',
    loc: 150,
    exportedSymbolCount: 6,
    fanInCount: 8,
    crossDomainFanIn: 3,
    fanOutCount: 2,
    isStateful: true,
    hasGlobalMutableState: true,
    pureFunctionRatio: 0.2,
    domainName: 'session',
  });
  const pseudoRes = classifyFileOntology(pseudoSharedFile);
  assert(
    pseudoRes.isPseudoSharedLibrary,
    'Identified pseudo-shared library carrying global mutable state',
  );
  assert(
    pseudoRes.inferredRole === 'business_domain_module',
    'Reclassified pseudo-shared library into domain module',
  );

  console.log('--- 3. Testing Domain Utility Creep Detection (ARCH-ROL-002) ---');
  const utilityCreepFile = createTaxonomyFile({
    filePath: 'src/billing/order_processor.ts',
    loc: 300,
    codeDensity: 0.85,
    exportedSymbolCount: 15,
    fanInCount: 2,
    crossDomainFanIn: 0,
    fanOutCount: 4,
    isStateful: true,
    pureFunctionRatio: 0.85,
    hasMathOrAlgoKeywords: true,
    domainName: 'billing',
  });
  const creepRes = classifyFileOntology(utilityCreepFile);
  assert(
    creepRes.hasUnboundedUtilityCreep,
    'Identified domain module utility creep with excessive generic exports',
  );
}

function testRepositoryTaxonomyAudit() {
  console.log('--- 4. Testing Repository-Wide Taxonomy Audit ---');
  const files = [
    createTaxonomyFile({
      filePath: 'src/common/pseudo_cache.ts',
      fanInCount: 6,
      crossDomainFanIn: 3,
      isStateful: true,
      hasGlobalMutableState: true,
      pureFunctionRatio: 0.1,
      domainName: 'cache',
    }),
    createTaxonomyFile({
      filePath: 'src/orders/order_calc_creep.ts',
      loc: 250,
      exportedSymbolCount: 14,
      fanInCount: 2,
      crossDomainFanIn: 0,
      fanOutCount: 2,
      isStateful: true,
      pureFunctionRatio: 0.85,
      hasMathOrAlgoKeywords: true,
      domainName: 'orders',
    }),
  ];

  const auditRes = auditFileTaxonomy(files);
  assert(auditRes.classifications.size === 2, 'Classified all 2 repository files');
  assert(
    auditRes.issues.length === 2,
    'Emitted exactly 2 architectural issues (ARCH-ROL-001 & ARCH-ROL-002)',
  );
  assert(
    auditRes.issues.some((i) => i.rule === 'ARCH-ROL-001'),
    'Emitted ARCH-ROL-001 for pseudo-shared file',
  );
  assert(
    auditRes.issues.some((i) => i.rule === 'ARCH-ROL-002'),
    'Emitted ARCH-ROL-002 for utility creep file',
  );
}

function runTests() {
  testConstantAndPoolRoles();
  testRuleAndAlgoRoles();
  testInfraAndSharedRoles();
  testCapabilityAndBizRoles();
  testPseudoSharedAndUtilityCreep();
  testRepositoryTaxonomyAudit();
  console.log(`\nResults: ${passedCount}/${totalCount} assertions passed.`);
}

runTests();
