#!/usr/bin/env node
/**
 * Module: Verification Harness — Boundary Discipline & Anti-Utils Governance
 * File Path: scripts/validate-boundary-discipline-engine.js
 * Architecture Role: Verification test suite asserting boundary discipline rules:
 *   ARCH-UTL-001 (god-object junk drawer utility file) and
 *   ARCH-ABS-001 (harmful over-abstraction / spurious indirection).
 * Dependencies & Triggers: Consumes boundary-discipline-engine from dist/core/intelligence;
 *   invoked by test-parallel.js runner.
 * Responsibilities: Assert anti-god-utils interception, 4 canonical destination routing streams,
 *   hop-depth indirection limits (>= 3 hops) and cyclic cross-domain abstraction interception.
 * Exit Semantics & Design Rationale: Process exits 0 on all assertions passing, 1 on failure.
 */

'use strict';

const {
  routeSymbolDestination,
  auditBoundaryDiscipline,
} = require('../dist/core/intelligence/boundary-discipline-engine');

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

function createTestUtilFile(overrides = {}) {
  return {
    filePath: 'src/util.ts',
    loc: 100,
    exportedSymbols: [
      {
        name: 'fn',
        line: 10,
        category: 'domain_dto',
        suggestedStream: 'foundation_capability_layer',
        isPure: false,
      },
    ],
    distinctCategoryCount: 1,
    isGenericUtilityName: false,
    hasCyclicDependencies: false,
    delegationHopDepth: 1,
    ...overrides,
  };
}

function testDestinationStreamRouting() {
  console.log('--- 1. Testing 4 Canonical Destination Stream Routing ---');
  const mathSym = routeSymbolDestination('calculateCircleArea', true);
  assert(
    mathSym.stream === 'algorithm_operator_library',
    'Routed math helper to algorithm_operator_library',
  );
  assert(mathSym.category === 'math', 'Categorized as math');

  const constSym = routeSymbolDestination('DEFAULT_TIMEOUT_MS', true);
  assert(
    constSym.stream === 'constant_registry_library',
    'Routed timeout constant to constant_registry_library',
  );
  assert(constSym.category === 'constant', 'Categorized as constant');

  const ruleSym = routeSymbolDestination('validateUserAge', true);
  assert(ruleSym.stream === 'rule_policy_module', 'Routed validation rule to rule_policy_module');
  assert(ruleSym.category === 'validation_rule', 'Categorized as validation_rule');

  const fmtSym = routeSymbolDestination('formatIsoTimestamp', true);
  assert(
    fmtSym.stream === 'foundation_capability_layer',
    'Routed formatter to foundation_capability_layer',
  );
  assert(fmtSym.category === 'formatting', 'Categorized as formatting');
}

function testAntiGodUtils() {
  console.log('--- 2. Testing Anti-God-Utils Interception (ARCH-UTL-001) ---');
  const godUtilsFile = {
    filePath: 'src/common/utils.ts',
    loc: 450,
    exportedSymbols: [
      {
        name: 'roundCents',
        line: 10,
        category: 'math',
        suggestedStream: 'algorithm_operator_library',
        isPure: true,
      },
      {
        name: 'MAX_RETRIES',
        line: 30,
        category: 'constant',
        suggestedStream: 'constant_registry_library',
        isPure: true,
      },
      {
        name: 'validateEmail',
        line: 50,
        category: 'validation_rule',
        suggestedStream: 'rule_policy_module',
        isPure: true,
      },
      {
        name: 'formatCurrency',
        line: 80,
        category: 'formatting',
        suggestedStream: 'foundation_capability_layer',
        isPure: true,
      },
    ],
    distinctCategoryCount: 4,
    isGenericUtilityName: true,
    hasCyclicDependencies: false,
    delegationHopDepth: 1,
  };

  const result = auditBoundaryDiscipline([godUtilsFile]);
  assert(result.issues.length === 1, 'Emitted ARCH-UTL-001 for multi-category junk drawer utility');
  assert(result.issues[0].rule === 'ARCH-UTL-001', 'Issue rule matches ARCH-UTL-001');
  assert(
    result.issues[0].detail.distinctCategoryCount === 4,
    'Records 4 distinct categories polluting single file',
  );
  assert(
    result.issues[0].suggestion.includes('four canonical destinations'),
    'Suggests 4 canonical destination streams',
  );
}

function testOverAbstraction() {
  console.log('--- 3. Testing Over-Abstraction & Spurious Indirection (ARCH-ABS-001) ---');
  const indirectionFile = createTestUtilFile({
    filePath: 'src/adapters/proxy_facade_layer.ts',
    delegationHopDepth: 4,
  });

  const res3A = auditBoundaryDiscipline([indirectionFile]);
  assert(res3A.issues.length === 1, 'Emitted ARCH-ABS-001 for 4-hop spurious indirection');
  assert(res3A.issues[0].rule === 'ARCH-ABS-001', 'Issue matches ARCH-ABS-001');
  assert(res3A.issues[0].detail.delegationHopDepth === 4, 'Cites delegationHopDepth = 4');

  const cyclicFile = createTestUtilFile({
    filePath: 'src/shared/domain_bridge.ts',
    hasCyclicDependencies: true,
  });

  const res3B = auditBoundaryDiscipline([cyclicFile]);
  assert(res3B.issues.length === 1, 'Emitted ARCH-ABS-001 for circular dependency sharing');
  assert(res3B.issues[0].detail.hasCyclicDependencies === true, 'Cites circular dependency hazard');
}

function testCohesiveUtilityPass() {
  console.log('--- 4. Testing Cohesive Pure Focused Utility Pass ---');
  const cohesiveFile = createTestUtilFile({
    filePath: 'src/algo/vector_math.ts',
    exportedSymbols: [
      {
        name: 'vectorAdd',
        line: 10,
        category: 'math',
        suggestedStream: 'algorithm_operator_library',
        isPure: true,
      },
      {
        name: 'vectorSub',
        line: 20,
        category: 'math',
        suggestedStream: 'algorithm_operator_library',
        isPure: true,
      },
    ],
  });

  const result = auditBoundaryDiscipline([cohesiveFile]);
  assert(
    result.issues.length === 0,
    'Focused single-category operator library passes with 0 issues',
  );
}

function runTests() {
  testDestinationStreamRouting();
  testAntiGodUtils();
  testOverAbstraction();
  testCohesiveUtilityPass();
  console.log(`\nResults: ${passedCount}/${totalCount} assertions passed.`);
}

runTests();
