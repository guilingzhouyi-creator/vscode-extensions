/**
 * Module: Verification Harness — Data Architecture Data Architecture & Access Governance
 * File Path: scripts/validate-data-architecture.js
 * Architecture Role: Validates data architecture rules, including direct/indirect N+1 queries
 *   (DAT-NPL-001), unbounded full scans on online paths (DAT-QRY-001),
 *   leaky abstractions (DAT-LAY-001), and end-to-end integration into Praxis Diff Governance.
 * Dependencies & Triggers: Consumes ../dist/api; executed during test-parallel runner.
 * Responsibilities: Assert inter-procedural graph traversal, source-level query pattern detection,
 *   and Praxis merge gate escalation for dangerous persistence patterns.
 * Exit Semantics & Design Rationale: Exits 0 on verification pass; throws AssertionError and exits
 *   1 on any anomaly, guaranteeing zero connection starvation or memory pileups in production.
 */

'use strict';

const assert = require('assert');
const {
  SemanticGraph,
  analyzeDataArchitectureWithGraph,
  auditDataArchitectureSource,
  defaultDataArchitectureEvaluator,
  defaultPraxisGovernanceService,
} = require('../dist/api');

async function main() {
  console.log('=== [Data Architecture] Testing Data Architecture & Persistence Access Governance ===\n');

  // 1. Direct Loop Query (N+1 Hazard - DAT-NPL-001)
  const directNPlusOneCode = `
export class OrderService {
    public processOrders(orderIds: string[]): void {
        for (const id of orderIds) {
            const order = this.orderRepo.findById(id);
        }
    }
}
`;
  const directIssues = auditDataArchitectureSource(
    'src/services/orderService.ts',
    directNPlusOneCode,
  );
  const nPlusOneIssues = directIssues.filter((i) => i.rule === 'DAT-NPL-001');
  assert.strictEqual(nPlusOneIssues.length, 1, 'Must detect direct N+1 query in loop');
  assert.strictEqual(nPlusOneIssues[0].severity, 'error', 'N+1 query must be error severity');
  console.log('✔ Direct loop N+1 query detected correctly.');

  // 2. Inter-procedural Indirect N+1 Query via SemanticGraph
  const graph = new SemanticGraph();
  const callerNode = {
    id: 'typescript:src/services/orderBatch.ts#OrderBatchService.processBatchOrders',
    language: 'typescript',
    kind: 'method',
    name: 'processBatchOrders',
    location: {
      file: 'src/services/orderBatch.ts',
      start: { line: 25, column: 5 },
      end: { line: 40, column: 5 },
    },
  };
  const intermediateNode = {
    id: 'typescript:src/services/userService.ts#UserService.getUserProfile',
    language: 'typescript',
    kind: 'method',
    name: 'getUserProfile',
    location: {
      file: 'src/services/userService.ts',
      start: { line: 12, column: 5 },
      end: { line: 20, column: 5 },
    },
  };
  const storageNode = {
    id: 'typescript:src/repositories/userRepository.ts#UserRepository.findById',
    language: 'typescript',
    kind: 'method',
    name: 'findById',
    location: {
      file: 'src/repositories/userRepository.ts',
      start: { line: 8, column: 5 },
      end: { line: 15, column: 5 },
    },
  };

  graph.addNode(callerNode).addNode(intermediateNode).addNode(storageNode);

  // Calls: processBatchOrders -> getUserProfile -> findById
  graph.addEdge({
    id: 'edge:batch-to-service',
    fromNodeId: callerNode.id,
    toNodeId: intermediateNode.id,
    kind: 'calls',
  });
  graph.addEdge({
    id: 'edge:service-to-repo',
    fromNodeId: intermediateNode.id,
    toNodeId: storageNode.id,
    kind: 'calls',
  });

  const indirectIssues = analyzeDataArchitectureWithGraph(graph);
  assert.strictEqual(indirectIssues.length, 1, 'Must identify indirect inter-procedural N+1 query');
  assert.strictEqual(
    indirectIssues[0].rule,
    'DAT-NPL-001',
    'Indirect issue must use rule DAT-NPL-001',
  );
  assert.strictEqual(indirectIssues[0].severity, 'error', 'Indirect N+1 must be fatal error');
  const chain = indirectIssues[0].detail.semanticEvidenceChain;
  assert.strictEqual(chain.length, 3, 'Evidence chain must contain 3 steps (loop -> call -> io)');
  console.log('✔ Inter-procedural indirect N+1 query verified with 3-step evidence chain.');

  // 3. Online Path Unbounded Query (DAT-QRY-001)
  const onlineUnboundedCode = `
export class UserApiController {
    public async listUsers(): Promise<User[]> {
        return this.userRepo.findAll();
    }
}
`;
  const qryIssues = auditDataArchitectureSource(
    'src/controllers/userController.ts',
    onlineUnboundedCode,
  );
  const unboundedIssues = qryIssues.filter((i) => i.rule === 'DAT-QRY-001');
  assert.strictEqual(unboundedIssues.length, 1, 'Must detect unpaginated query on online path');
  assert.strictEqual(unboundedIssues[0].severity, 'warning', 'Unbounded query should be warning');
  console.log('✔ Unbounded query on online controller detected.');

  // 4. Offline/Test Context Immunity
  const testQueryCode = `
describe('UserTest', () => {
    it('loads all users', () => {
        const users = repo.findAll();
    });
});
`;
  const testIssues = auditDataArchitectureSource('tests/unit/user.test.ts', testQueryCode);
  const testUnbounded = testIssues.filter((i) => i.rule === 'DAT-QRY-001');
  assert.strictEqual(testUnbounded.length, 0, 'Test files must not trigger DAT-QRY-001');
  console.log('✔ Test & migration contexts immune to online unbounded query rule.');

  // 5. Leaky Persistence Driver Abstraction (DAT-LAY-001)
  const leakyDomainCode = `
export class BillingDomainService {
    public chargeAccount(accountId: string, amount: number): void {
        pool.execute('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amount, accountId]);
    }
}
`;
  const layIssues = auditDataArchitectureSource('src/core/domain/billing.ts', leakyDomainCode);
  const leakyIssues = layIssues.filter((i) => i.rule === 'DAT-LAY-001');
  assert.strictEqual(
    leakyIssues.length,
    1,
    'Must detect raw pool.execute driver call in domain layer',
  );
  console.log('✔ Leaky data access driver abstraction detected in domain service.');

  // 6. End-to-End Praxis Diff Governance Integration
  const diffWithNPlusOne = {
    filePath: 'src/api/services/invoiceService.ts',
    newContent: `
export class InvoiceService {
    public generateInvoices(orders: any[]): void {
        for (const order of orders) {
            const customer = this.customerRepo.findById(order.customerId);
        }
    }
}
`,
  };

  const diffResult = await defaultPraxisGovernanceService.reviewDiff(diffWithNPlusOne);
  assert.ok(
    diffResult.issues.length > 0,
    'Praxis reviewDiff must contain data architecture issues',
  );
  assert.ok(
    diffResult.issues.some((i) => i.rule === 'DAT-NPL-001'),
    'Must include DAT-NPL-001 in Praxis issues',
  );
  assert.strictEqual(
    diffResult.verdict.status,
    'major_rework_needed',
    'Praxis verdict must escalate to major_rework_needed due to N+1 error',
  );
  assert.strictEqual(
    diffResult.verdict.shouldEscalateToL3A,
    true,
    'Should trigger L3A escalation flag for N+1 database hazard',
  );
  console.log('✔ Praxis Diff Governance end-to-end data architecture gate verified.');

  // Clean data access diff
  const cleanDataDiff = {
    filePath: 'src/api/services/cleanInvoiceService.ts',
    newContent: `
export class CleanInvoiceService {
    public generateInvoices(orders: any[]): void {
        const customerIds = orders.map(o => o.customerId);
        const customers = this.customerRepo.findByIds(customerIds);
    }
}
`,
  };
  const cleanResult = await defaultPraxisGovernanceService.reviewDiff(cleanDataDiff);
  assert.strictEqual(
    cleanResult.issues.length,
    0,
    'Clean batch query diff should produce 0 issues',
  );
  assert.strictEqual(
    cleanResult.verdict.status,
    'passed',
    'Clean batch query verdict must be passed',
  );
  console.log('✔ Clean batch data access diff passed successfully.');

  // 6. Evaluator Object Contract Audit
  const evalIssues = defaultDataArchitectureEvaluator.audit('src/services/test.ts', 'const x = 1;');
  assert.strictEqual(Array.isArray(evalIssues), true);
  console.log('✔ defaultDataArchitectureEvaluator instance interface verified.');

  console.log('\n=== All Data Architecture Data Architecture & Query Governance Tests PASSED ===');
}

main().catch((err) => {
  console.error('Data Architecture verification failed:', err);
  process.exit(1);
});
