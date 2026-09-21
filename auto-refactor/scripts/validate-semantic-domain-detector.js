#!/usr/bin/env node
/**
 * Module: Verification Harness — Cross-File Semantic Domain & Distributed Redundancy Detector
 * File Path: scripts/validate-semantic-domain-detector.js
 * Architecture Role: Verification test suite asserting multi-dimensional semantic fingerprints,
 *   domain divergence vs incidental redundancy discrimination, and CPX-RED-001 emissions.
 * Dependencies & Triggers: Consumes semantic domain detector from dist/core/intelligence;
 *   invoked by test-parallel.js runner.
 * Responsibilities: Assert semantic similarity calculation across 9 dimensions, cluster detection,
 *   domain divergence rationale, and project-scale elastic redundancy budgeting.
 * Exit Semantics & Design Rationale: Process exits 0 on all assertions passing, 1 on failure.
 */

'use strict';

const {
  computeSemanticSimilarity,
  clusterSemanticDomains,
  evaluateDomainDivergence,
  evaluateDistributedRedundancy,
} = require('../dist/core/intelligence/semantic-domain-detector');

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

function createRoutineDescriptor(id, name, filePath, domainName, overrides = {}) {
  const defaultFingerprint = {
    symbolTokens: new Set(['token', 'data']),
    domainName,
    callInDegree: 2,
    callOutDegree: 1,
    cfgSkeletonHash: 'default-cfg',
    dataFlowStages: ['parse', 'process', 'return'],
    ioShape: { arity: 1, paramTypes: ['unknown'], returnKind: 'scalar' },
    algorithmicSteps: ['step1', 'step2'],
    sideEffectBoundary: 'pure',
    stateOwnership: 'transient',
    callFrequencyHotness: 'request_path',
  };
  const fingerprint = overrides.fingerprint
    ? { ...defaultFingerprint, ...overrides.fingerprint }
    : defaultFingerprint;
  return {
    id,
    name,
    filePath,
    startLine: 1,
    endLine: 30,
    cc: 6,
    loc: 30,
    ...overrides,
    fingerprint,
  };
}

function createTaxCalculationRoutine(
  id,
  name,
  filePath,
  domainName,
  tokens,
  contextType,
  overrides = {},
) {
  return createRoutineDescriptor(id, name, filePath, domainName, {
    startLine: 10,
    endLine: 40,
    ...overrides,
    fingerprint: {
      symbolTokens: new Set(tokens),
      callInDegree: 2,
      callOutDegree: 2,
      cfgSkeletonHash: 'cfg-tax-loop-branch',
      dataFlowStages: ['parse_input', 'apply_discount', 'apply_tax', 'round_result'],
      ioShape: { arity: 2, paramTypes: [contextType, 'TaxRateConfig'], returnKind: 'composite' },
      algorithmicSteps: ['validate_rate', 'calc_discount', 'calc_tax', 'normalize_cents'],
    },
  });
}

function testHomologousSimilarity() {
  console.log('--- 1. Testing 9-Dimensional Semantic Similarity ---');
  const routineA = createTaxCalculationRoutine(
    'routine-order-calc',
    'calculateTaxAndDiscount',
    'src/billing/tax.ts',
    'billing',
    ['tax', 'discount', 'subtotal', 'currency', 'rate'],
    'OrderContext',
    { fingerprint: { callInDegree: 3 } },
  );

  const routineB = createTaxCalculationRoutine(
    'routine-checkout-calc',
    'computeCheckoutTotals',
    'src/checkout/totals.ts',
    'checkout',
    ['tax', 'discount', 'subtotal', 'currency', 'amount'],
    'CartContext',
    { startLine: 15, endLine: 45, cc: 7 },
  );

  const routineC = createRoutineDescriptor(
    'routine-socket-poll',
    'pollSocketEvents',
    'src/network/poller.ts',
    'network',
    {
      startLine: 50,
      endLine: 90,
      cc: 12,
      loc: 40,
      fingerprint: {
        symbolTokens: new Set(['socket', 'epoll', 'buffer', 'fd', 'timeout']),
        callInDegree: 1,
        callOutDegree: 5,
        cfgSkeletonHash: 'cfg-poll-loop',
        dataFlowStages: ['wait_event', 'drain_buffer', 'dispatch_packet'],
        ioShape: { arity: 1, paramTypes: ['SocketFd'], returnKind: 'collection' },
        algorithmicSteps: ['epoll_wait', 'check_errno', 'read_bytes'],
        sideEffectBoundary: 'io_async',
        stateOwnership: 'scoped',
        callFrequencyHotness: 'hot_loop',
      },
    },
  );

  const simAB = computeSemanticSimilarity(routineA, routineB);
  const simAC = computeSemanticSimilarity(routineA, routineC);

  assert(
    simAB >= 0.75,
    `High semantic similarity between homologous calculation routines (${simAB.toFixed(2)})`,
  );
  assert(
    simAC <= 0.25,
    `Low semantic similarity between calculation and network polling (${simAC.toFixed(2)})`,
  );
}

function testCrossFileClustering() {
  console.log('--- 2. Testing Cross-File Semantic Domain Clustering ---');
  const sharedAuthFp = {
    symbolTokens: new Set(['user', 'token', 'auth', 'expire']),
    callInDegree: 2,
    callOutDegree: 1,
    cfgSkeletonHash: 'auth-hash',
    dataFlowStages: ['parse', 'validate', 'return'],
    ioShape: { arity: 1, paramTypes: ['string'], returnKind: 'scalar' },
    algorithmicSteps: ['validate_token', 'check_expiry'],
  };
  const clusterRoutines = [
    createRoutineDescriptor('r1', 'validateAlphaUser', 'src/auth/alpha.ts', 'auth', {
      endLine: 25,
      cc: 4,
      loc: 25,
      fingerprint: sharedAuthFp,
    }),
    createRoutineDescriptor('r2', 'validateBetaUser', 'src/users/beta.ts', 'users', {
      endLine: 25,
      cc: 4,
      loc: 25,
      fingerprint: sharedAuthFp,
    }),
  ];

  const clusters = clusterSemanticDomains(clusterRoutines, 0.7);
  assert(clusters.length === 1, 'Detected 1 cross-file semantic domain cluster');
  assert(clusters[0].routines.length === 2, 'Cluster contains both homologous validation routines');
  assert(
    clusters[0].primaryCategory === 'validation',
    'Primary category correctly inferred as validation',
  );
}

function createStateRoutine(id, name, filePath, domainName, stage, overrides = {}) {
  return createRoutineDescriptor(id, name, filePath, domainName, {
    endLine: 20,
    cc: 3,
    loc: 20,
    ...overrides,
    fingerprint: {
      symbolTokens: new Set(['cache', 'state']),
      callInDegree: 1,
      callOutDegree: 0,
      cfgSkeletonHash: 'hash-state',
      dataFlowStages: [stage],
      ioShape: { arity: 0, paramTypes: [], returnKind: 'scalar' },
      algorithmicSteps: ['read_state'],
      ...overrides.fingerprint,
    },
  });
}

function testDomainDivergenceCheck() {
  console.log('--- 3. Testing Domain Divergence vs Incidental Redundancy ---');
  const divergentCluster = [
    createStateRoutine('d1', 'getCacheState', 'src/cache/state.ts', 'cache', 'read'),
    createStateRoutine('d2', 'writeGlobalState', 'src/global/state.ts', 'global', 'write', {
      fingerprint: {
        sideEffectBoundary: 'stateful',
        stateOwnership: 'global_singleton',
        callFrequencyHotness: 'cold_batch',
      },
    }),
  ];

  const divergenceCheck = evaluateDomainDivergence(divergentCluster);
  assert(
    divergenceCheck.isDivergence,
    'Identified legitimate domain divergence due to lifecycle mismatch',
  );
  assert(
    divergenceCheck.reason.includes('lifecycle'),
    'Divergence reason accurately cites lifecycle/side-effect mismatch',
  );
}

function testDistributedRedundancyBudget() {
  console.log('--- 4. Testing Project-Scale Distributed Redundancy & CPX-RED-001 ---');
  const vatFp = {
    symbolTokens: new Set(['vat', 'calc', 'rate', 'price', 'cents']),
    callInDegree: 2,
    callOutDegree: 1,
    cfgSkeletonHash: 'vat-calc-cfg',
    dataFlowStages: ['input', 'rate', 'calc', 'round'],
    ioShape: { arity: 2, paramTypes: ['number', 'number'], returnKind: 'scalar' },
    algorithmicSteps: ['validate', 'compute', 'round'],
  };
  const redundantRoutines = [
    createRoutineDescriptor('red-1', 'computeInvoiceVat', 'src/invoicing/vat.ts', 'invoicing', {
      startLine: 10,
      endLine: 60,
      cc: 12,
      loc: 50,
      fingerprint: vatFp,
    }),
    createRoutineDescriptor('red-2', 'calculateQuoteVat', 'src/quoting/vat.ts', 'quoting', {
      startLine: 10,
      endLine: 60,
      cc: 12,
      loc: 50,
      fingerprint: vatFp,
    }),
    createRoutineDescriptor('red-3', 'evaluateOrderVat', 'src/orders/vat.ts', 'orders', {
      startLine: 10,
      endLine: 60,
      cc: 12,
      loc: 50,
      fingerprint: vatFp,
    }),
  ];

  const result = evaluateDistributedRedundancy(redundantRoutines, 300, {
    redundancyBudgetCC: 15,
  });

  assert(
    result.isBudgetExceeded,
    'Redundancy budget is exceeded when 3 domains implement identical calculations',
  );
  assert(result.issues.length >= 1, 'Emitted CPX-RED-001 distributed redundancy issue');
  assert(
    result.issues[0].rule === 'CPX-RED-001',
    'Issue rule matches CPX-RED-001 canonical identifier',
  );
  assert(
    result.distributedRedundancyScore === 24,
    'Calculated redundant CC correctly as (3-1)*12 = 24',
  );
}

function runTests() {
  testHomologousSimilarity();
  testCrossFileClustering();
  testDomainDivergenceCheck();
  testDistributedRedundancyBudget();
  console.log(`\nResults: ${passedCount}/${totalCount} assertions passed.`);
}

runTests();
