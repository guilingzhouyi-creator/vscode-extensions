/**
 * Module: Verification Harness — Phase 3 Universal Rule Hierarchy & Praxis Integration
 * File Path: scripts/validate-universal-rules.js
 * Architecture Role: Validates the three-tier rule pyramid (Layer 1 Universal, Layer 2 Family,
 *   Layer 3 Dialect), confirms language-agnostic clean architecture and cycle detection on the
 *   SemanticGraph, and verifies the Praxis Diff Governance Subsystem service facade.
 * Dependencies & Triggers: Consumes ../dist/api; executed during test-parallel runner.
 * Responsibilities: Assert rule classification, Layer 1 topology rules,
 *   SemanticPraxisContextEnricher impact file deduction, and PraxisDiffGovernanceService.
 * Exit Semantics & Design Rationale: Exits 0 on full verification pass; throws AssertionError
 *   and exits 1 on any discrepancy, guaranteeing contract stability for the Praxis team.
 */

'use strict';

const assert = require('assert');
const {
  SemanticGraph,
  classifyRuleLayer,
  UniversalCycleRule,
  UniversalCleanArchitectureRule,
  SemanticPraxisContextEnricher,
  defaultPraxisGovernanceService,
} = require('../dist/api');

async function main() {
  console.log('=== [Phase 3] Testing Universal Rule Pyramid & Praxis Diff Subsystem ===\n');

  // 1. Verify Three-Tier Rule Pyramid Classification
  assert.strictEqual(classifyRuleLayer('import-cycle'), 'layer1_universal');
  assert.strictEqual(classifyRuleLayer('clean-layer-violation'), 'layer1_universal');
  assert.strictEqual(classifyRuleLayer('ARCH-CLN-001'), 'layer1_universal');
  assert.strictEqual(classifyRuleLayer('typescript-modern'), 'layer2_family');
  assert.strictEqual(classifyRuleLayer('python-imports'), 'layer2_family');
  assert.strictEqual(classifyRuleLayer('magic-literal'), 'layer3_dialect');
  console.log('✔ Three-tier rule pyramid classification verified.');

  // 2. Test Layer 1 Clean Architecture Unidirectional Boundary Rule
  const archGraph = new SemanticGraph();
  const coreNode = {
    id: 'typescript:src/core/domain/entity.ts#UserEntity',
    language: 'typescript',
    kind: 'type',
    name: 'UserEntity',
    location: {
      file: 'src/core/domain/entity.ts',
      start: { line: 10, column: 1 },
      end: { line: 20, column: 1 },
    },
  };
  const uiNode = {
    id: 'typescript:src/frontend/ui/button.ts#RenderButton',
    language: 'typescript',
    kind: 'function',
    name: 'RenderButton',
    location: {
      file: 'src/frontend/ui/button.ts',
      start: { line: 5, column: 1 },
      end: { line: 15, column: 1 },
    },
  };
  archGraph.addNode(coreNode).addNode(uiNode);

  // Illegal edge: Core domain depends on outer UI layer
  archGraph.addEdge({
    id: 'edge:core-violates-ui',
    fromNodeId: coreNode.id,
    toNodeId: uiNode.id,
    kind: 'calls',
  });

  const cleanArchRule = new UniversalCleanArchitectureRule();
  const archIssues = cleanArchRule.evaluate(archGraph, {});
  assert.strictEqual(archIssues.length, 1, 'Must detect 1 clean architecture violation');
  assert.strictEqual(archIssues[0].rule, 'clean-layer-violation');
  assert(
    archIssues[0].message.includes('boundary breach'),
    'Issue message must report boundary breach',
  );
  console.log('✔ Layer 1 universal clean architecture boundary enforcement verified.');

  // 3. Test Layer 1 Universal Cycle Detection Rule
  const cycleGraph = new SemanticGraph();
  const modA = {
    id: 'python:services/payment.py#module',
    language: 'python',
    kind: 'module',
    name: 'payment',
    location: {
      file: 'services/payment.py',
      start: { line: 1, column: 1 },
      end: { line: 50, column: 1 },
    },
  };
  const modB = {
    id: 'python:services/order.py#module',
    language: 'python',
    kind: 'module',
    name: 'order',
    location: {
      file: 'services/order.py',
      start: { line: 1, column: 1 },
      end: { line: 40, column: 1 },
    },
  };
  cycleGraph.addNode(modA).addNode(modB);
  cycleGraph.addEdge({ id: 'e:a-b', fromNodeId: modA.id, toNodeId: modB.id, kind: 'depends_on' });
  cycleGraph.addEdge({ id: 'e:b-a', fromNodeId: modB.id, toNodeId: modA.id, kind: 'depends_on' });

  const cycleRule = new UniversalCycleRule();
  const cycleIssues = cycleRule.evaluate(cycleGraph, {});
  assert.strictEqual(cycleIssues.length, 1, 'Must detect circular dependency loop');
  assert.strictEqual(cycleIssues[0].rule, 'import-cycle');
  console.log('✔ Layer 1 universal cycle detection verified across topology graph.');

  // 4. Test Praxis Semantic Context Enricher (Impact Closure)
  const enrichGraph = new SemanticGraph();
  const callee = {
    id: 'typescript:src/service/calculator.ts#add',
    language: 'typescript',
    kind: 'function',
    name: 'add',
    location: {
      file: 'src/service/calculator.ts',
      start: { line: 10, column: 1 },
      end: { line: 20, column: 1 },
    },
  };
  const callerA = {
    id: 'typescript:src/controllers/billing.ts#calculateTotal',
    language: 'typescript',
    kind: 'function',
    name: 'calculateTotal',
    location: {
      file: 'src/controllers/billing.ts',
      start: { line: 1, column: 1 },
      end: { line: 30, column: 1 },
    },
  };
  const callerB = {
    id: 'typescript:src/cli/reportCmd.ts#run',
    language: 'typescript',
    kind: 'function',
    name: 'run',
    location: {
      file: 'src/cli/reportCmd.ts',
      start: { line: 1, column: 1 },
      end: { line: 25, column: 1 },
    },
  };

  enrichGraph.addNode(callee).addNode(callerA).addNode(callerB);
  enrichGraph.addEdge({ id: 'e1', fromNodeId: callerA.id, toNodeId: callee.id, kind: 'calls' });
  enrichGraph.addEdge({ id: 'e2', fromNodeId: callerB.id, toNodeId: callee.id, kind: 'calls' });

  const enricher = new SemanticPraxisContextEnricher(enrichGraph);
  const rawHunk = {
    hunkId: 'hunk-1',
    header: '@@ -12,4 +12,6 @@ function add()',
    oldSpan: { startLine: 12, lineCount: 4 },
    newSpan: { startLine: 12, lineCount: 6 },
    lines: [
      { type: 'context', content: 'const a = 1;' },
      { type: 'insert', content: 'const b = 2;' },
    ],
  };

  const enrichedContext = enricher.enrichHunk('src/service/calculator.ts', rawHunk);
  assert.strictEqual(enrichedContext.enclosingSymbol, 'add', 'Must resolve enclosing symbol');
  assert.strictEqual(enrichedContext.symbolKind, 'function');
  assert(Array.isArray(enrichedContext.impactFiles), 'Impact files must be an array');
  assert.strictEqual(
    enrichedContext.impactFiles.length,
    2,
    'Must discover 2 upstream calling files',
  );
  assert(enrichedContext.impactFiles.includes('src/controllers/billing.ts'));
  assert(enrichedContext.impactFiles.includes('src/cli/reportCmd.ts'));
  console.log(
    '✔ Praxis Semantic Context Enricher impact files closure verified:',
    enrichedContext.impactFiles,
  );

  // 5. Test Praxis Diff Governance Service Facade
  const service = defaultPraxisGovernanceService;
  const result = await service.reviewDiff({
    filePath: 'src/controllers/authController.ts',
    newContent: `
import { Token } from './token';
export function login(user: string): boolean {
    return Token.verify(user);
}
`,
  });

  assert(Array.isArray(result.hunks), 'Result must contain hunks');
  assert(Array.isArray(result.issues), 'Result must contain issues');
  assert(result.verdict, 'Result must contain overall verdict');
  assert(result.impactSummary, 'Result must contain impact summary');
  assert.strictEqual(
    result.verdict.status,
    'passed',
    'Clean controller change must pass merge gate',
  );
  console.log('✔ PraxisDiffGovernanceService end-to-end interface execution verified.');

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 3 UNIVERSAL RULES & PRAXIS TESTS PASSED (5/5)!');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('[FAIL] validate-phase3-universal-rules failed:', err);
  process.exit(1);
});
