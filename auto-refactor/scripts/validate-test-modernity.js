/**
 * Module: Verification Harness — Phase 6 Test Modernity & Contract Governance
 * File Path: scripts/validate-test-modernity.js
 * Architecture Role: Validates multi-language test modernity rules, including tautological
 *   assertions (TST-TAU-001), orphaned skipped tests (TST-SKP-001), mock-only illusions
 *   (TST-ILS-001), business-to-test semantic mapping, EMTD/CBCR five-dimensional scoring
 *   (TST-DEN-001), and end-to-end integration into the Praxis Diff Governance Subsystem.
 * Dependencies & Triggers: Consumes ../dist/api; executed during test-parallel runner.
 * Responsibilities: Assert multi-language AST/pattern detection (TS, Python, GDScript, Rust),
 *   semantic graph coverage mapping, and Praxis merge gate escalation for fake test PRs.
 * Exit Semantics & Design Rationale: Exits 0 on verification pass; throws AssertionError and exits
 *   1 on any anomaly, preventing fake tests or decaying suites from breaching the merge gate.
 */

'use strict';

const assert = require('assert');
const {
  SemanticGraph,
  auditTestSource,
  mapBusinessToTests,
  defaultTestModernityEvaluator,
  defaultPraxisGovernanceService,
} = require('../dist/api');

async function main() {
  console.log('=== [Phase 6] Testing Test Modernity & Contract Coverage Governance ===\n');

  // 1. Multi-language Tautological Assertion Detection (TST-TAU-001)
  console.log('1. Testing Multi-language Tautological & Non-verifying Assertions (TST-TAU-001)...');

  // 1.1 TypeScript / JavaScript
  const tsTautologyCode = `
describe('OrderService Tests', () => {
    it('verifies order processing', () => {
        expect(true).toBe(true);
        expect(1).toBe(1);
    });
    it('empty test without assertions', () => {
    });
});
`;
  const tsIssues = auditTestSource('tests/orderService.test.ts', tsTautologyCode);
  const tsTauIssues = tsIssues.filter((i) => i.rule === 'TST-TAU-001');
  assert.strictEqual(tsTauIssues.length >= 2, true, 'TS tautology + empty test must be flagged');
  console.log('✔ TypeScript tautological assertions and empty tests detected.');

  // 1.2 Python
  const pyTautologyCode = `
import pytest

def test_order_creation():
    assert True
    assert 1 == 1
    x = 42
    assert x == x
`;
  const pyIssues = auditTestSource('tests/test_orders.py', pyTautologyCode);
  const pyTauIssues = pyIssues.filter((i) => i.rule === 'TST-TAU-001');
  assert.strictEqual(pyTauIssues.length >= 1, true, 'Python assert True/1==1 must be flagged');
  console.log('✔ Python tautological assertions detected.');

  // 1.3 GDScript
  const gdTautologyCode = `
extends TestCase

func test_character_health():
    assert_true(true)
    assert_eq(1, 1)
`;
  const gdIssues = auditTestSource('tests/unit/test_player.gd', gdTautologyCode);
  const gdTauIssues = gdIssues.filter((i) => i.rule === 'TST-TAU-001');
  assert.strictEqual(gdTauIssues.length >= 1, true, 'GDScript assert_true(true) must be flagged');
  console.log('✔ GDScript tautological assertions detected.');

  // 1.4 Rust
  const rustTautologyCode = `
#[cfg(test)]
mod tests {
    #[test]
    fn test_compute_state() {
        assert!(true);
        assert_eq!(1, 1);
    }
}
`;
  const rsIssues = auditTestSource('tests/integration_test.rs', rustTautologyCode);
  const rsTauIssues = rsIssues.filter((i) => i.rule === 'TST-TAU-001');
  assert.strictEqual(rsTauIssues.length >= 1, true, 'Rust assert!(true) must be flagged');
  console.log('✔ Rust tautological assertions detected.');

  // 2. Orphaned Skipped Tests (TST-SKP-001) across Languages
  console.log('\n2. Testing Orphaned Skipped Tests (TST-SKP-001)...');

  const tsSkippedCode = `
describe('Billing Service', () => {
    it.skip('flaky invoice generation test', () => {
        const res = billing.generate();
        expect(res.status).toBe('ok');
    });
});
`;
  const tsSkipIssues = auditTestSource('tests/billing.test.ts', tsSkippedCode);
  assert.strictEqual(
    tsSkipIssues.some((i) => i.rule === 'TST-SKP-001'),
    true,
    'it.skip must trigger TST-SKP-001',
  );

  const pySkippedCode = `
import pytest

@pytest.mark.skip(reason="intermittent failure")
def test_network_sync():
    res = sync_remote()
    assert res.ok is True
`;
  const pySkipIssues = auditTestSource('tests/test_sync.py', pySkippedCode);
  assert.strictEqual(
    pySkipIssues.some((i) => i.rule === 'TST-SKP-001'),
    true,
    '@pytest.mark.skip must trigger TST-SKP-001',
  );

  const rsSkippedCode = `
#[test]
#[ignore]
fn test_heavy_computation() {
    assert_eq!(calculate(), 100);
}
`;
  const rsSkipIssues = auditTestSource('tests/test_calc.rs', rsSkippedCode);
  assert.strictEqual(
    rsSkipIssues.some((i) => i.rule === 'TST-SKP-001'),
    true,
    'Rust #[ignore] must trigger TST-SKP-001',
  );
  console.log('✔ Multi-language skipped test cases (TST-SKP-001) verified.');

  // 3. Test Integrity Illusions (TST-ILS-001 - Mock Only & Obsolete Contract)
  console.log('\n3. Testing Test Integrity Illusions (TST-ILS-001)...');

  const mockOnlyCode = `
describe('Payment Service', () => {
    it('executes payment mock', () => {
        const mockRepo = { save: jest.fn() };
        mockRepo.save.mockReturnValue(true);
        expect(mockRepo.save).toHaveBeenCalled();
        expect(mockRepo.save).toHaveBeenCalledTimes(1);
    });
});
`;
  const mockIssues = auditTestSource('tests/payment.test.ts', mockOnlyCode);
  assert.strictEqual(
    mockIssues.some((i) => i.rule === 'TST-ILS-001'),
    true,
    'Mock-only test must trigger TST-ILS-001',
  );

  const obsoleteContractCode = `
describe('Customer Contract', () => {
    it('verifies customer V1 schema', () => {
        const legacy = readSchema();
        expect(legacy.deprecatedContract).toBe('ContractV1');
    });
});
`;
  const obsoleteIssues = auditTestSource('tests/customer.test.ts', obsoleteContractCode);
  assert.strictEqual(
    obsoleteIssues.some((i) => i.rule === 'TST-ILS-001'),
    true,
    'Deprecated contract assertion must trigger TST-ILS-001',
  );
  console.log('✔ Mock-only assertions and obsolete contract illusions verified.');

  // 4. Business <-> Test Semantic Mapping & EMTD / CBCR Calculations
  console.log('\n4. Testing Business <-> Test Mapping & 5-Dimensional Metrics (TST-DEN-001)...');

  const graph = new SemanticGraph();
  graph.addNode({
    id: 'src/services/paymentService.ts:PaymentProcessor',
    name: 'PaymentProcessor',
    kind: 'type',
    language: 'typescript',
    location: {
      file: 'src/services/paymentService.ts',
      start: { line: 1, column: 1 },
      end: { line: 10, column: 1 },
    },
  });
  graph.addNode({
    id: 'src/services/orderService.ts:OrderService',
    name: 'OrderService',
    kind: 'type',
    language: 'typescript',
    location: {
      file: 'src/services/orderService.ts',
      start: { line: 1, column: 1 },
      end: { line: 20, column: 1 },
    },
  });
  graph.addNode({
    id: 'src/utils/stringHelper.ts:formatId',
    name: 'formatId',
    kind: 'function',
    language: 'typescript',
    location: {
      file: 'src/utils/stringHelper.ts',
      start: { line: 1, column: 1 },
      end: { line: 5, column: 1 },
    },
  });

  const testSites = [
    {
      file: 'tests/orderService.test.ts',
      line: 10,
      testName: 'OrderService should create new order',
      isSkipped: false,
      isTautological: false,
      isMockOnly: false,
      referencesDeprecatedContract: false,
      testedSymbol: 'OrderService',
    },
  ];

  const mappingResult = mapBusinessToTests(graph, testSites, 100, {
    minEmtd: 50,
    minCbcr: 0.8,
  });

  assert.strictEqual(mappingResult.semanticUnits.length, 3, 'Must extract 3 business units');
  assert.strictEqual(
    mappingResult.uncoveredSymbols.includes('PaymentProcessor'),
    true,
    'PaymentProcessor must be flagged as uncovered',
  );
  assert.strictEqual(typeof mappingResult.metrics.emtd, 'number');
  assert.strictEqual(typeof mappingResult.metrics.cbcr, 'number');
  assert.strictEqual(
    mappingResult.issues.some((i) => i.rule === 'TST-DEN-001'),
    true,
    'CBCR below 0.8 must emit TST-DEN-001',
  );
  console.log(
    `✔ Business-to-Test mapping verified: EMTD=${mappingResult.metrics.emtd}, ` +
      `CBCR=${mappingResult.metrics.cbcr}, TST-DEN-001 emitted.`,
  );

  // 5. Praxis Diff Governance End-to-End Test Gate
  console.log('\n5. Testing Praxis Diff Governance Integration with Test Modernity Gate...');

  const fakeTestDiff = {
    filePath: 'tests/authService.test.ts',
    newContent: `
describe('AuthService Security Tests', () => {
    it('authenticates admin token', () => {
        expect(true).toBe(true);
    });
});
`,
  };

  const fakeResult = await defaultPraxisGovernanceService.reviewDiff(fakeTestDiff, {
    testIntegrityFatal: true,
  });

  assert.strictEqual(
    fakeResult.issues.some((i) => i.rule === 'TST-TAU-001'),
    true,
    'Fake test PR must trigger TST-TAU-001',
  );
  assert.strictEqual(
    fakeResult.verdict.status,
    'major_rework_needed',
    'Fake test PR must be blocked by Praxis Gate',
  );
  assert.strictEqual(
    fakeResult.verdict.shouldEscalateToL3A,
    true,
    'Fake test PR must escalate to L3A review',
  );
  console.log('✔ Fake test diff successfully blocked by Praxis Diff Governance Gate.');

  // Clean genuine test diff
  const cleanTestDiff = {
    filePath: 'tests/userProfile.test.ts',
    newContent: `
describe('UserProfile Tests', () => {
    it('validates user email formatting', () => {
        const profile = new UserProfile('alice', 'alice@example.com');
        expect(profile.isValidEmail()).toBe(true);
        expect(profile.getUsername()).toBe('alice');
    });
});
`,
  };

  const cleanResult = await defaultPraxisGovernanceService.reviewDiff(cleanTestDiff);
  assert.strictEqual(cleanResult.issues.length, 0, 'Clean test diff should produce 0 issues');
  assert.strictEqual(cleanResult.verdict.status, 'passed', 'Clean test verdict must be passed');
  console.log('✔ Genuine test diff passed Praxis Diff Governance Gate.');

  // 6. Evaluator Object Interface Audit
  const evalIssues = defaultTestModernityEvaluator.audit(
    'tests/dummy.test.ts',
    'it("test", () => { expect(1).toBe(1); });',
  );
  assert.strictEqual(evalIssues.length >= 1, true);
  console.log('✔ defaultTestModernityEvaluator instance interface verified.');

  console.log('\n=== All Phase 6 Test Modernity & Contract Governance Tests PASSED ===');
}

main().catch((err) => {
  console.error('Phase 6 verification failed:', err);
  process.exit(1);
});
