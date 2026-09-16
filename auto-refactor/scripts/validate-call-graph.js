#!/usr/bin/env node
/**
 * Module: Verification Harness - Cross-file Call Graph
 * File Path: scripts/validate-call-graph.js
 * Architecture Role: Key-point lock for the call-graph view over the shared symbol index: a scan
 *     must yield resolved cross-file caller -> callee edges, a walkable three-hop chain and
 *     explicitly unresolved external calls, without any second parse
 * Dependencies & Triggers: `npm run validate-call-graph` (part of `npm test`); imports ../dist/api
 *     (scan), ../dist/core/intelligence/symbolIndex and ../dist/core/intelligence/callGraph
 * Responsibilities: Assert caller attribution, cross-file resolution, the three-hop chain walk and
 *     unresolved-call accounting on synthetic trees, then assert a real scan publishes the same
 *     counters on both the materialized and the lazy-projection traversals
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1, so a
 *     traversal that stops attributing callers (or silently drops unresolved calls) fails the
 *     build; temporary fixture roots are removed in a `finally` block.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SymbolIndex, collectSymbols } = require('../dist/core/intelligence/symbolIndex.js');
const { CallGraph } = require('../dist/core/intelligence/callGraph.js');
const { scan } = require('../dist/api.js');

const PLUGIN = path.join(__dirname, '..', 'samples', 'analyzers', 'noConsole.js');

/** Plug-in analyzer config: forces the materialized traversal. */
const MATERIALIZED_CONFIG = {
  include: ['**/*.ts'],
  analyzers: { 'no-console': { enabled: true } },
  customAnalyzers: [{ name: 'no-console', module: PLUGIN, enabled: true }],
};

/** Streaming-only config: takes the lazy-projection fast path. */
const PROJECTION_CONFIG = { include: ['**/*.ts'], analyzers: {} };

/** Four files forming a three-hop cross-file chain a -> b -> c -> d plus one unresolved call. */
const FIXTURE = {
  'src/a.ts': ["import { b } from './b';", 'export function a(): void {', '  b();', '}', ''].join(
    '\n',
  ),
  'src/b.ts': ["import { c } from './c';", 'export function b(): void {', '  c();', '}', ''].join(
    '\n',
  ),
  'src/c.ts': ["import { d } from './d';", 'export function c(): void {', '  d();', '}', ''].join(
    '\n',
  ),
  'src/d.ts': ['export function d(): void {', '  externalProbe();', '}', ''].join('\n'),
};

/**
 * Write the fixture tree and scan it through the public entry point.
 *
 * @param root - Fixture project root.
 * @param config - Config file content controlling the traversal path.
 * @returns Scan report.
 */
async function scanFixture(root, config) {
  for (const [name, content] of Object.entries(FIXTURE)) {
    const absolute = path.join(root, name);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  const configFile = path.join(root, 'auto-refactor.config.json');
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  return scan({ root, configFile, logLevel: 'silent', cache: false, workers: 1 });
}

/**
 * Build one synthetic file tree: a declaration whose body contains a single call.
 *
 * @param fn - Declared function name.
 * @param callee - Called name.
 * @returns A normalized node view shaped like the adapter output.
 */
function chainTree(fn, callee) {
  return {
    kind: 'SourceFile',
    children: [
      {
        kind: 'Function',
        name: fn,
        start: { line: 2, column: 1 },
        children: [{ kind: 'Call', name: callee, start: { line: 3, column: 3 } }],
      },
    ],
  };
}

/** Synthetic trees for the same four files, used for the algorithm-level assertions. */
const SYNTHETIC = {
  'src/a.ts': chainTree('a', 'b'),
  'src/b.ts': chainTree('b', 'c'),
  'src/c.ts': chainTree('c', 'd'),
  'src/d.ts': chainTree('d', 'externalProbe'),
};

(async () => {
  // ── 1. Derivation: attribution, cross-file resolution, chain walk, unresolved accounting ─────
  const index = new SymbolIndex();
  for (const [file, tree] of Object.entries(SYNTHETIC)) {
    const collected = collectSymbols(tree, file);
    index.addDefinitions(collected.definitions);
    index.addReferences(collected.references);
  }
  const graph = new CallGraph(index);

  const firstHop = graph.calleesOf('a');
  assert.strictEqual(firstHop.length, 1, 'a must have exactly one call edge');
  assert.strictEqual(firstHop[0].callee, 'b', 'the edge must name the callee');
  assert.strictEqual(firstHop[0].callerFile, 'src/a.ts', 'the edge must carry the call-site file');
  assert.strictEqual(
    firstHop[0].calleeFile,
    'src/b.ts',
    'the callee must resolve to its defining file',
  );
  assert.strictEqual(firstHop[0].crossFile, true, 'a -> b crosses a file boundary');
  assert.strictEqual(firstHop[0].resolved, true, 'a -> b must resolve');

  assert.deepStrictEqual(
    graph.reachableFrom('a'),
    ['b', 'c', 'd', 'externalProbe'],
    'the three-hop chain a -> b -> c -> d must be walkable, including its unresolved leaf',
  );
  const unresolved = graph.edges().filter((edge) => !edge.resolved);
  assert.strictEqual(unresolved.length, 1, 'the external call must be one unresolved edge');
  assert.strictEqual(
    unresolved[0].callee,
    'externalProbe',
    'the unresolved edge must keep the callee name',
  );
  assert.strictEqual(unresolved[0].calleeFile, null, 'an unresolved callee must not invent a file');
  console.log(
    `  [PASS] three-hop chain walkable, ${unresolved.length} unresolved edge kept (not dropped)`,
  );

  const stats = graph.stats();
  assert.strictEqual(stats.attributedEdges, stats.edges, 'every synthetic edge must be attributed');
  assert.strictEqual(stats.crossFileEdges, 3, 'three cross-file edges expected');
  assert.strictEqual(stats.unresolvedEdges, 1, 'one unresolved edge expected');

  // ── 2. Real scans publish the same counters on both traversals ───────────────────────────────
  const materializedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-callgraph-mat-'));
  const projectedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-callgraph-proj-'));
  try {
    const materializedStats = (await scanFixture(materializedRoot, MATERIALIZED_CONFIG)).summary
      .callGraph;
    assert.ok(materializedStats, 'the scan summary must publish callGraph');
    assert.strictEqual(
      materializedStats.builtFrom,
      'materialized',
      'a plug-in analyzer must force materialization',
    );
    assert.strictEqual(
      materializedStats.attributedEdges,
      materializedStats.edges,
      'every fixture edge must be attributed',
    );
    assert.ok(
      materializedStats.crossFileEdges >= 3,
      `expected >=3 cross-file edges, got ${materializedStats.crossFileEdges}`,
    );
    assert.ok(
      materializedStats.unresolvedEdges >= 1,
      'the external call must be unresolved, not dropped',
    );

    const projectedStats = (await scanFixture(projectedRoot, PROJECTION_CONFIG)).summary.callGraph;
    assert.strictEqual(
      projectedStats.builtFrom,
      'projection',
      'a streaming-only config must take the fast path',
    );
    assert.ok(
      projectedStats.unresolvedEdges >= 1,
      'the projection path must keep unresolved calls',
    );
    assert.ok(
      projectedStats.crossFileEdges >= 3,
      `the projection path must resolve cross-file edges, got ${projectedStats.crossFileEdges}`,
    );
    assert.strictEqual(
      projectedStats.edges,
      materializedStats.edges,
      'both traversals must observe the same edge count for the same code',
    );
    assert.strictEqual(
      projectedStats.crossFileEdges,
      materializedStats.crossFileEdges,
      'both traversals must resolve the same cross-file edges',
    );
    console.log(
      `  [PASS] both paths agree edge-for-edge (${materializedStats.edges} edges, ` +
        `${materializedStats.crossFileEdges} cross-file)`,
    );
  } finally {
    fs.rmSync(materializedRoot, { recursive: true, force: true });
    fs.rmSync(projectedRoot, { recursive: true, force: true });
  }

  console.log('\n ALL CALL GRAPH CHECKS PASSED SUCCESSFULLY!\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
