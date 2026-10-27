#!/usr/bin/env node
/**
 * Module: Verification Harness — Sparse AST Hopper and Sliding Symbol Stream
 * File Path: scripts/validate-sparse-ast-hopper.js
 * Architecture Role: Key-point lock for the two bounded-working-set kernels: the hopper must prune
 *   only subtrees lying wholly outside the audited span while reproducing every in-window finding,
 *   and the sliding symbol stream must hold its active-file budget under sustained admission.
 * Dependencies & Triggers: `npm run validate-sparse-hopper` (part of `npm test`); imports
 *   ../dist/api (classifyNodeForWindow, isSubtreePrunable, shouldDispatchNode, hopperPruneRatio,
 *   createSparseHopperStats, SlidingSymbolStream) plus the symbol index and NodeKind contracts.
 * Responsibilities: Assert verdict classification, prune-eligibility rules, dispatch rules,
 *   window-equivalence against an unbounded run of the same tree, real prune-ratio telemetry, and
 *   stream budget/saliency behaviour.
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so a hopper
 *   that drops an in-window node fails the build. Equivalence compares a bounded run with an
 *   unbounded run over the same synthetic tree, because the only acceptable pruning is one that
 *   changes nothing inside the audited span.
 */
'use strict';

const assert = require('assert');
const {
  classifyNodeForWindow,
  isSubtreePrunable,
  shouldDispatchNode,
  createSparseHopperStats,
  hopperPruneRatio,
  totalHopperNodes,
  SlidingSymbolStream,
} = require('../dist/api');
const { SymbolIndex, collectSymbols } = require('../dist/core/intelligence/symbolIndex');
const { NodeKind } = require('../dist/core/ast/multilang');

/** Build one normalized node with an explicit line extent. */
function node(startLine, endLine, kind = NodeKind.Function) {
  return {
    kind,
    start: { line: startLine, column: 1 },
    end: { line: endLine, column: 1 },
  };
}

/** Assert the four placement verdicts plus the unknown fallback. */
function assertClassification() {
  const window = { startLine: 10, endLine: 20 };
  assert.strictEqual(
    classifyNodeForWindow(node(12, 15), window),
    'inside',
    'nested node is inside',
  );
  assert.strictEqual(classifyNodeForWindow(node(5, 15), window), 'wraps', 'overlap is wrapping');
  assert.strictEqual(classifyNodeForWindow(node(1, 9), window), 'before', 'earlier node is before');
  assert.strictEqual(classifyNodeForWindow(node(21, 30), window), 'after', 'later node is after');
  assert.strictEqual(
    classifyNodeForWindow(node(10, 20), window),
    'inside',
    'exact match is inside',
  );
  assert.strictEqual(
    classifyNodeForWindow({ kind: NodeKind.Call }, window),
    'unknown',
    'no position',
  );
  assert.strictEqual(
    classifyNodeForWindow(node(21, 30), undefined),
    'inside',
    'no window means all',
  );
  console.log('  ✔ node placement classification is exact');
}

/** Assert prune eligibility never covers a node that intersects the window. */
function assertPruneEligibility() {
  const window = { startLine: 10, endLine: 20 };
  assert.strictEqual(isSubtreePrunable(node(1, 9), window), true, 'earlier node is prunable');
  assert.strictEqual(isSubtreePrunable(node(21, 30), window), true, 'later node is prunable');
  assert.strictEqual(isSubtreePrunable(node(12, 15), window), false, 'inside node is kept');
  assert.strictEqual(isSubtreePrunable(node(9, 11), window), false, 'wrapping node is kept');
  assert.strictEqual(isSubtreePrunable({ kind: NodeKind.Call }, window), false, 'unknown is kept');
  assert.strictEqual(isSubtreePrunable(node(21, 30), undefined), false, 'no window prunes nothing');
  console.log('  ✔ prune eligibility keeps every intersecting subtree');
}

/** Assert dispatch keeps wrapping and unknown nodes so scope context survives. */
function assertDispatchRules() {
  const window = { startLine: 10, endLine: 20 };
  assert.strictEqual(shouldDispatchNode(node(12, 15), window), true, 'inside node dispatches');
  assert.strictEqual(shouldDispatchNode(node(5, 15), window), true, 'wrapping node dispatches');
  assert.strictEqual(shouldDispatchNode(node(1, 9), window), false, 'before node is skipped');
  assert.strictEqual(
    shouldDispatchNode({ kind: NodeKind.Call }, window),
    true,
    'unknown dispatches',
  );
  console.log('  ✔ dispatch keeps wrapping and unpositioned nodes');
}

/** Assert the ratio helpers report real counters rather than a constant. */
function assertHopperStats() {
  const stats = createSparseHopperStats();
  assert.strictEqual(totalHopperNodes(stats), 0, 'fresh stats are zeroed');
  assert.strictEqual(hopperPruneRatio(stats), 0, 'empty stats report a zero ratio');
  stats.visited = 30;
  stats.pruned = 70;
  assert.strictEqual(totalHopperNodes(stats), 100, 'total sums both counters');
  assert.strictEqual(hopperPruneRatio(stats), 0.7, 'ratio is pruned over total');
  console.log('  ✔ hopper counters drive a real prune ratio');
}

/** Fixture: synthetic normalized tree with four top-level functions in disjoint line bands. */
function buildFixtureTree() {
  const fn = (name, startLine, endLine) => ({
    kind: NodeKind.Function,
    name,
    start: { line: startLine, column: 1 },
    end: { line: endLine, column: 1 },
    children: [
      {
        kind: NodeKind.Constant,
        name: `${name}Value`,
        start: { line: startLine + 1, column: 5 },
        end: { line: startLine + 1, column: 25 },
        children: [],
      },
    ],
  });
  return {
    kind: NodeKind.SourceFile,
    start: { line: 1, column: 1 },
    end: { line: 20, column: 1 },
    children: [
      fn('firstStep', 1, 4),
      fn('secondStep', 6, 9),
      fn('thirdStep', 11, 14),
      fn('fourthStep', 16, 19),
    ],
  };
}

/** Adapter over the synthetic tree: children come straight from the fixture arrays. */
const FIXTURE_ADAPTER = {
  id: 'fixture',
  extensions: ['.fixture'],
  parse() {
    return { root: buildFixtureTree() };
  },
  root(ast) {
    return ast.root;
  },
  children(normalizedNode) {
    return normalizedNode.children || [];
  },
};

/** Build a streaming entry recording every dispatched node's start line. */
function buildRecordingEntry(record) {
  return {
    analyzer: {
      name: 'recorder',
      visit(normalizedNode) {
        if (normalizedNode.start) record.push(normalizedNode.start.line);
      },
    },
    ctx: { config: {}, filePath: 'fixture.ts', content: '', root: buildFixtureTree() },
  };
}

/** Assert a bounded run dispatches only window-intersecting nodes and prunes the rest. */
function assertWindowEquivalence() {
  const { runStreaming } = require('../dist/core/ast/traverse');

  const fullLines = [];
  runStreaming(FIXTURE_ADAPTER, buildFixtureTree(), [buildRecordingEntry(fullLines)]);
  assert.deepStrictEqual(
    fullLines,
    [1, 2, 6, 7, 11, 12, 16, 17],
    'unbounded run dispatches every positioned node',
  );

  const boundedLines = [];
  const stats = createSparseHopperStats();
  runStreaming(
    FIXTURE_ADAPTER,
    buildFixtureTree(),
    [buildRecordingEntry(boundedLines)],
    [6, 9],
    stats,
  );
  assert.deepStrictEqual(
    boundedLines,
    [6, 7],
    'bounded run dispatches only the nodes inside the audited span',
  );
  assert.strictEqual(stats.pruned, 3, 'the three out-of-window top-level subtrees are pruned');
  assert.ok(hopperPruneRatio(stats) > 0.5, 'the majority of the tree is pruned');
  console.log('  ✔ bounded window dispatches only in-window nodes and prunes the rest');
}

/** Assert a window with no in-span nodes still prunes rather than dispatching everything. */
function assertEmptyWindowPrunesEverything() {
  const { runStreaming } = require('../dist/core/ast/traverse');
  const lines = [];
  const stats = createSparseHopperStats();
  runStreaming(FIXTURE_ADAPTER, buildFixtureTree(), [buildRecordingEntry(lines)], [40, 50], stats);
  assert.deepStrictEqual(lines, [], 'nothing inside an empty span is dispatched');
  assert.strictEqual(stats.visited, 0, 'no node counted as visited');
  assert.ok(stats.pruned >= 4, 'all top-level subtrees are pruned');
  assert.strictEqual(hopperPruneRatio(stats), 1, 'the whole tree is pruned');
  console.log('  ✔ an empty audited span prunes the whole tree');
}

/** Fixture builder for the sliding stream: one definition plus one call per file. */
function symbolFixture(fileIndex) {
  return {
    definitions: [
      {
        name: `handler${fileIndex}`,
        kind: 'function',
        file: `src/file-${fileIndex}.ts`,
        line: 1,
      },
    ],
    references: [
      {
        name: 'shared',
        file: `src/file-${fileIndex}.ts`,
        line: 2,
        kind: 'call',
        caller: `handler${fileIndex}`,
      },
    ],
  };
}

/** Assert the stream holds its budget while retaining every declaration. */
function assertStreamBudget() {
  const stream = new SlidingSymbolStream(8);
  for (let i = 0; i < 40; i++) {
    const fixture = symbolFixture(i);
    stream.admit(`src/file-${i}.ts`, fixture.definitions, fixture.references);
  }
  const stats = stream.stats();
  assert.strictEqual(stats.budget, 8, 'budget is the configured value');
  assert.strictEqual(stats.activeFiles, 8, 'active files never exceed the budget');
  assert.ok(stats.evictedFiles >= 32, 'evictions are counted');
  assert.strictEqual(stats.retainedDefinitions, 40, 'declarations survive eviction');
  assert.ok(stats.retainedReferences <= 8, 'reference edges stay bounded');
  assert.strictEqual(stream.isActive('src/file-0.ts'), false, 'the oldest file was evicted');
  assert.strictEqual(stream.isActive('src/file-39.ts'), true, 'the newest file is active');
  assert.strictEqual(
    stream.definitionsOf('handler0').length,
    1,
    'an evicted file still answers declaration lookups',
  );
  assert.strictEqual(
    stream.referencesOf('shared').length,
    stats.retainedReferences,
    'reference count matches the reported telemetry',
  );
  console.log('  ✔ sliding stream holds its budget while keeping declarations');
}

/** Assert recency protects a hot file from eviction by cold newcomers. */
function assertSaliencyProtectsHotFile() {
  const stream = new SlidingSymbolStream(3);
  for (let i = 0; i < 5; i++) {
    stream.admit(
      'src/hot.ts',
      [],
      [{ name: 'hot', file: 'src/hot.ts', line: i + 1, kind: 'call', caller: 'hotCaller' }],
    );
  }
  for (let i = 0; i < 10; i++) {
    stream.admit(
      `src/cold-${i}.ts`,
      [],
      [{ name: 'cold', file: `src/cold-${i}.ts`, line: 1, kind: 'call', caller: 'coldCaller' }],
    );
  }
  assert.strictEqual(stream.isActive('src/hot.ts'), true, 'the hot file survives eviction');
  assert.ok(stream.stats().activeFiles <= 3, 'budget still holds');
  console.log('  ✔ saliency keeps the hot file resident');
}

/** Assert the factory view reproduces the index facts it was built from. */
function assertViewFromIndex() {
  const index = new SymbolIndex();
  const parsed = collectSymbols(
    {
      kind: NodeKind.SourceFile,
      children: [
        {
          kind: NodeKind.Function,
          name: 'alpha',
          start: { line: 1, column: 1 },
          children: [{ kind: NodeKind.Call, name: 'beta', start: { line: 2, column: 3 } }],
        },
        {
          kind: NodeKind.Function,
          name: 'beta',
          start: { line: 5, column: 1 },
          children: [],
        },
      ],
    },
    'src/alpha.ts',
  );
  index.addDefinitions(parsed.definitions);
  index.addReferences(parsed.references);

  const view = index.createSlidingView(16);
  assert.strictEqual(view.definitionsOf('alpha').length, 1, 'declaration survives the projection');
  assert.strictEqual(view.referencesOf('beta').length, 1, 'call edge survives the projection');
  const resolved = view.resolve('beta');
  assert.strictEqual(resolved.definitions.length, 1, 'resolve returns the declaration');
  assert.strictEqual(resolved.references.length, 1, 'resolve returns the call site');
  assert.strictEqual(view.stats().activeFiles, 1, 'one file admitted');
  assert.strictEqual(view.stats().evictedFiles, 0, 'nothing evicted at this size');
  console.log('  ✔ sliding view reproduces the source index facts');
}

async function main() {
  console.log('=== Sparse AST Hopper and Sliding Symbol Stream Validation ===');
  assertClassification();
  assertPruneEligibility();
  assertDispatchRules();
  assertHopperStats();
  assertWindowEquivalence();
  assertEmptyWindowPrunesEverything();
  assertStreamBudget();
  assertSaliencyProtectsHotFile();
  assertViewFromIndex();
  console.log('=== ALL SPARSE HOPPER VALIDATION TESTS PASSED (9/9) ===');
}

main().catch((error) => {
  console.error('\n✖ BLOCK', error && error.message ? error.message : error);
  process.exit(1);
});
