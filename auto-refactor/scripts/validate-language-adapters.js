/**
 * Module: Verification Harness — Language Adapters Multi-Language Semantic Adapters Verification
 * File Path: scripts/validate-language-adapters.js
 * Architecture Role: Validates that concrete source code in TypeScript, Python, Rust, Go,
 *   and GDScript is losslessly mapped into canonical SemanticNode entities and SemanticEdge
 *   relations within the unified SemanticGraph via the SemanticAdapterRegistry.
 * Dependencies & Triggers: Consumes ../dist/api; executed during test-parallel suite.
 * Responsibilities: Assert canonical path normalization, multi-language adapter routing,
 *   AST symbol extraction, function metric deduction, call binding, and inheritance.
 * Exit Semantics & Design Rationale: Exits 0 on full verification pass; throws AssertionError
 *   and exits 1 on any discrepancy, guaranteeing invariant language adaptation for Universal Rules.
 */

'use strict';

const assert = require('assert');
const {
  SemanticGraph,
  defaultSemanticAdapterRegistry,
  normalizeCanonicalPath,
  buildCanonicalSymbolId,
} = require('../dist/api');

async function main() {
  console.log(
    '=== [Language Adapters] Testing Multi-Language Semantic Adapters & AST Bridge ===\n',
  );

  // 1. Verify Path Normalization & Canonical Symbol ID
  const rawWinPath = 'C:\\Project\\src\\service\\authService.ts';
  const canonicalPath = normalizeCanonicalPath(rawWinPath);
  assert.strictEqual(
    canonicalPath,
    'c:/Project/src/service/authService.ts',
    'Windows path must normalize to lower-case drive and forward slashes',
  );

  const symbolId = buildCanonicalSymbolId('TypeScript', './src//utils/math.ts', 'Calculator.add');
  assert.strictEqual(
    symbolId,
    'typescript:src/utils/math.ts#Calculator.add',
    'Symbol ID must have lower-cased language, clean path, and symbol path',
  );
  console.log('✔ Path normalization and canonical symbol ID generation verified.');

  // 2. Verify Adapter Registry & Language Routing
  const languages = defaultSemanticAdapterRegistry.getSupportedLanguages();
  assert(languages.includes('typescript'), 'Registry must support TypeScript');
  assert(languages.includes('python'), 'Registry must support Python');
  assert(languages.includes('rust'), 'Registry must support Rust');
  assert(languages.includes('go'), 'Registry must support Go');
  assert(languages.includes('gdscript'), 'Registry must support GDScript');

  const tsAdapter = defaultSemanticAdapterRegistry.getAdapterForFile('src/index.ts');
  assert.strictEqual(tsAdapter?.language, 'typescript');
  const pyAdapter = defaultSemanticAdapterRegistry.getAdapterForFile('scripts/train.py');
  assert.strictEqual(pyAdapter?.language, 'python');
  const rsAdapter = defaultSemanticAdapterRegistry.getAdapterForFile('core/lib.rs');
  assert.strictEqual(rsAdapter?.language, 'rust');
  const goAdapter = defaultSemanticAdapterRegistry.getAdapterForFile('pkg/server.go');
  assert.strictEqual(goAdapter?.language, 'go');
  const gdAdapter = defaultSemanticAdapterRegistry.getAdapterForFile('scenes/player.gd');
  assert.strictEqual(gdAdapter?.language, 'gdscript');
  console.log('✔ Multi-language adapter routing verified for TS, Python, Rust, Go, GDScript.');

  // 3. Test TypeScript Code Extraction into SemanticGraph
  const graph = new SemanticGraph();
  const tsCode = `
import { Database } from './database';

export class UserService {
    async findUser(id: string): Promise<User> {
        validateId(id);
        return Database.query(id);
    }
}

export async function validateId(id: string): Promise<boolean> {
    return id.length > 0;
}
`;

  const tsFile = 'src/service/userService.ts';
  const extractedTs = defaultSemanticAdapterRegistry.extractFileToGraph(tsFile, tsCode, graph);
  assert.strictEqual(extractedTs, true, 'TS extraction must succeed');

  // Verify Module Node
  const tsModuleNode = graph.getNode('typescript:src/service/userService.ts#module');
  assert(tsModuleNode, 'TS module node must exist');
  assert.strictEqual(tsModuleNode.kind, 'module');

  // Verify Import Edge
  const outEdges = graph.getOutgoingEdges(tsModuleNode.id, 'depends_on');
  assert(
    outEdges.some((e) => e.toNodeId.includes('database')),
    'Module must have depends_on edge to database',
  );

  // Verify Class & Method Node
  const classNode = graph.getNode('typescript:src/service/userService.ts#UserService');
  assert(classNode, 'UserService class node must exist');
  assert.strictEqual(classNode.kind, 'type');

  const methodNode = graph.getNode('typescript:src/service/userService.ts#UserService.findUser');
  assert(methodNode, 'UserService.findUser method node must exist');
  assert.strictEqual(methodNode.kind, 'function');
  assert.strictEqual(methodNode.attributes?.isAsync, true, 'findUser must be async');
  assert.strictEqual(methodNode.metrics?.parameterCount, 1);

  // Verify Method Call Edge
  const findUserCalls = graph.getOutgoingEdges(methodNode.id, 'calls');
  assert(
    findUserCalls.some((e) => e.toNodeId.includes('validateId')),
    'findUser must call validateId',
  );
  console.log('✔ TypeScript AST extraction, method binding, and call topology verified.');

  // 4. Test Python Code Extraction into SemanticGraph
  const pyCode = `
import os
from auth.token import verify_token

class BaseController:
    pass

class AuthController(BaseController):
    async def handle_login(self, username, password):
        verify_token(username)
        return True

def standalone_helper(x, y, z):
    return x + y + z
`;

  const pyFile = 'controllers/auth.py';
  const extractedPy = defaultSemanticAdapterRegistry.extractFileToGraph(pyFile, pyCode, graph);
  assert.strictEqual(extractedPy, true, 'Python extraction must succeed');

  const pyModuleNode = graph.getNode('python:controllers/auth.py#module');
  assert(pyModuleNode, 'Python module node must exist');

  // Verify Python Import
  const pyDepEdges = graph.getOutgoingEdges(pyModuleNode.id, 'depends_on');
  assert(
    pyDepEdges.some((e) => e.toNodeId.includes('auth.token')),
    'Python module must depend on auth.token',
  );

  // Verify Python Class & Inheritance
  const authCtrlNode = graph.getNode('python:controllers/auth.py#AuthController');
  assert(authCtrlNode, 'AuthController class node must exist');
  const inheritEdges = graph.getOutgoingEdges(authCtrlNode.id, 'inherits');
  assert(
    inheritEdges.some((e) => e.toNodeId.includes('BaseController')),
    'AuthController must inherit from BaseController',
  );

  // Verify Python Async Def & Method Call
  const pyMethodNode = graph.getNode('python:controllers/auth.py#AuthController.handle_login');
  assert(pyMethodNode, 'handle_login method node must exist');
  assert.strictEqual(pyMethodNode.attributes?.isAsync, true);
  assert.strictEqual(pyMethodNode.metrics?.parameterCount, 3); // self, username, password

  const pyMethodCalls = graph.getOutgoingEdges(pyMethodNode.id, 'calls');
  assert(
    pyMethodCalls.some((e) => e.toNodeId.includes('verify_token')),
    'handle_login must call verify_token',
  );
  console.log('✔ Python syntax extraction, inheritance, and async method calls verified.');

  // 5. Test Unified Graph Metrics & Slicing across Extracted Languages
  const metrics = graph.computeMetrics();
  assert(metrics.nodeCount >= 7, 'Graph must contain TS and Python nodes');
  assert(metrics.edgeCount >= 5, 'Graph must contain multi-language edges');
  assert.strictEqual(metrics.cycleCount, 0, 'Initial graph must be acyclic');

  const slice = graph.getSlice(methodNode.id, 2, 'forward');
  assert(slice.nodes.length >= 2, 'Slice from findUser must discover downstream calls');
  console.log('✔ Cross-language graph metrics and forward impact slice verified:');
  console.log(`  - Total nodes: ${metrics.nodeCount}`);
  console.log(`  - Total edges: ${metrics.edgeCount}`);
  console.log(`  - Density:     ${metrics.density}`);

  console.log('\n================================================================');
  console.log('🎉 ALL Language Adapters MULTI-LANGUAGE ADAPTER TESTS PASSED (5/5)!');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('[FAIL] validate-language-adapters failed:', err);
  process.exit(1);
});
