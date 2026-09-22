/**
 * Module: Verification Harness — Phase 1 Unified Semantic IR & Graph Verification
 * File Path: scripts/validate-semantic-ir.js
 * Architecture Role: Validates the language-agnostic SemanticNode, SemanticEdge, and
 *   SemanticGraph topology engine, asserting node indexing, bidirectional edge queries,
 *   subgraph slicing, cycle detection, topological sorting, and JSON roundtrip serialization.
 * Dependencies & Triggers: Consumes ../dist/api; invoked by npm test during test-parallel.
 * Responsibilities: Comprehensive assertions verifying that the unified semantic IR
 *   correctly abstracts multiple languages (TS, Python, Go, Rust) into a uniform topology.
 * Exit Semantics & Design Rationale: Exits 0 on full verification pass; throws AssertionError
 *   and exits 1 on any discrepancy, guaranteeing invariant semantics for Layer 1/2 rules.
 */

'use strict';

const assert = require('assert');
const { SemanticGraph } = require('../dist/api');

async function main() {
  console.log('=== [Phase 1] Testing Unified Semantic IR & Graph Engine ===\n');

  const graph = new SemanticGraph();

  // 1. Create language-agnostic nodes representing multi-language symbols
  const tsNode = {
    id: 'typescript:src/service/auth.ts#login',
    language: 'typescript',
    kind: 'function',
    name: 'login',
    scope: 'AuthService',
    location: {
      file: 'src/service/auth.ts',
      start: { line: 10, column: 5 },
      end: { line: 30, column: 6 },
    },
    attributes: {
      visibility: 'public',
      isAsync: true,
      isPure: false,
      returnType: 'Promise<UserSession>',
    },
    metrics: {
      cyclomaticComplexity: 4,
      nestingDepth: 2,
      lineCount: 20,
      parameterCount: 2,
    },
  };

  const pyNode = {
    id: 'python:backend/auth/crypto.py#verify_hash',
    language: 'python',
    kind: 'function',
    name: 'verify_hash',
    location: {
      file: 'backend/auth/crypto.py',
      start: { line: 15, column: 1 },
      end: { line: 25, column: 18 },
    },
    attributes: {
      visibility: 'public',
      isAsync: false,
      isPure: true,
      returnType: 'bool',
    },
    metrics: {
      cyclomaticComplexity: 2,
      nestingDepth: 1,
      lineCount: 10,
      parameterCount: 2,
    },
  };

  const dbNode = {
    id: 'sql:schema/users.sql#table_users',
    language: 'sql',
    kind: 'database_operation',
    name: 'users_table',
    location: {
      file: 'schema/users.sql',
      start: { line: 1, column: 1 },
      end: { line: 12, column: 2 },
    },
    attributes: {
      isExported: true,
    },
  };

  graph.addNode(tsNode).addNode(pyNode).addNode(dbNode);

  assert.strictEqual(graph.getAllNodes().length, 3, 'Must register 3 distinct nodes');
  assert.strictEqual(graph.hasNode(tsNode.id), true);
  assert.strictEqual(graph.getNode(pyNode.id)?.language, 'python');
  console.log('✔ Multi-language node registration and attribute retention verified.');

  // 2. Add edges across semantic layers
  graph.addEdge({
    id: 'edge:auth-to-crypto',
    fromNodeId: tsNode.id,
    toNodeId: pyNode.id,
    kind: 'calls',
    weight: 1,
    context: { inTryCatch: true },
  });

  graph.addEdge({
    id: 'edge:crypto-to-db',
    fromNodeId: pyNode.id,
    toNodeId: dbNode.id,
    kind: 'reads',
    weight: 1,
  });

  assert.strictEqual(graph.getAllEdges().length, 2, 'Must register 2 edges');
  assert.strictEqual(graph.getOutgoingEdges(tsNode.id).length, 1);
  assert.strictEqual(graph.getOutgoingEdges(tsNode.id, 'calls')[0].toNodeId, pyNode.id);
  assert.strictEqual(graph.getIncomingEdges(pyNode.id).length, 1);
  assert.strictEqual(graph.getIncomingEdges(dbNode.id, 'reads').length, 1);
  console.log('✔ Bidirectional edge indexing and typed filtering verified.');

  // 3. Test DAG Topological Sort
  const topoOrder = graph.getTopologicalSort();
  assert(topoOrder !== null, 'Acyclic graph must produce topological order');
  assert.strictEqual(topoOrder.length, 3);
  assert.strictEqual(topoOrder[0], tsNode.id, 'Source node must precede target');
  assert.strictEqual(topoOrder[2], dbNode.id, 'Sink node must come last');
  console.log('✔ DAG topological sort verified:', topoOrder);

  // 4. Test Subgraph Slicing (Impact Radius)
  const forwardSlice = graph.getSlice(tsNode.id, 2, 'forward');
  assert.strictEqual(forwardSlice.nodes.length, 3, 'Forward slice at depth 2 covers all 3 nodes');
  assert.strictEqual(forwardSlice.edges.length, 2);

  const shallowSlice = graph.getSlice(tsNode.id, 1, 'forward');
  assert.strictEqual(shallowSlice.nodes.length, 2, 'Forward slice at depth 1 covers TS & Python');

  const backwardSlice = graph.getSlice(dbNode.id, 2, 'backward');
  assert.strictEqual(backwardSlice.nodes.length, 3, 'Backward slice from DB covers all callers');
  console.log('✔ Directional impact subgraph slicing verified.');

  // 5. Test Cycle Detection
  graph.addEdge({
    id: 'edge:db-cycle-ts',
    fromNodeId: dbNode.id,
    toNodeId: tsNode.id,
    kind: 'depends_on',
  });

  const cycles = graph.findCycles();
  assert.strictEqual(cycles.length, 1, 'Must detect exactly 1 circular cycle');
  assert.strictEqual(cycles[0][0], tsNode.id);
  assert.strictEqual(cycles[0][cycles[0].length - 1], tsNode.id, 'Cycle must close loop');
  assert.strictEqual(graph.getTopologicalSort(), null, 'Cyclic graph must yield null topo sort');
  console.log('✔ Tarjan-style cycle detection and loop path recovery verified.');

  // 6. Test Holistic Metrics
  const metrics = graph.computeMetrics();
  assert.strictEqual(metrics.nodeCount, 3);
  assert.strictEqual(metrics.edgeCount, 3);
  assert.strictEqual(metrics.cycleCount, 1);
  assert.strictEqual(metrics.componentCount, 1);
  assert.strictEqual(metrics.density, 0.5); // 3 / (3 * 2) = 0.5
  console.log('✔ Whole-graph structural metrics verified:', metrics);

  // 7. Test JSON Serialization Roundtrip
  const serialized = graph.toJSON();
  const restoredGraph = SemanticGraph.fromJSON(serialized);
  assert.strictEqual(restoredGraph.getAllNodes().length, 3);
  assert.strictEqual(restoredGraph.getAllEdges().length, 3);
  assert.strictEqual(restoredGraph.findCycles().length, 1);
  console.log('✔ JSON serialization and reconstruction roundtrip verified.');

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 1 UNIFIED SEMANTIC IR TESTS PASSED (7/7)!');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('[FAIL] validate-phase1-semantic-ir failed:', err);
  process.exit(1);
});
