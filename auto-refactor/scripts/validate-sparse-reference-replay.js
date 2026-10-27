#!/usr/bin/env node
/**
 * Module: Verification Harness — Sparse Reference Replay Planner
 * File Path: scripts/validate-sparse-reference-replay.js
 * Architecture Role: Key-point lock for the sparse-reference replay upgrade. Asserts the planner
 *   keeps a constant working set where the bounded sliding-window manager alone degrades to a
 *   whole-file replay: adjacent anchors merge into a compound window, and a signature mutation
 *   becomes a bounded window carrying the external call sites it could reach.
 * Dependencies & Triggers: `npm run validate-sparse-replay` (part of `npm test`); imports
 *   ../dist/api (SparseReferenceReplayManager, createCallGraphReferenceResolver, referenceFiles,
 *   REASON_ tags) plus the symbol index and call graph contracts.
 * Responsibilities: Assert plain-window pass-through, compound-anchor promotion, signature
 *   bridging, honest import fallback, budget enforcement, and resolver determinism/ranking.
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so a planner
 *   that silently widens to the whole file fails the build. Each degradation case is paired with a
 *   positive case because "never degrades" and "always degrades" are both wrong answers.
 */
'use strict';

const assert = require('assert');
const {
  SparseReferenceReplayManager,
  SwaBoundedReplayManager,
  createCallGraphReferenceResolver,
  referenceFiles,
  REASON_COMPOUND_ANCHOR_WINDOW,
  REASON_SPARSE_BRIDGED_SIGNATURE,
  REASON_GLOBAL_MUTATION,
  REASON_MULTI_ANCHOR_SPAN,
  REASON_SIGNATURE_MUTATION,
  DEFAULT_MAX_COMPOUND_WINDOW_LINES,
} = require('../dist/api');
const { SymbolIndex } = require('../dist/core/intelligence/symbolIndex');
const { CallGraph } = require('../dist/core/intelligence/callGraph');

/** Two top-level declarations plus a class, used as the editing fixture. */
const SOURCE = [
  'import { util } from "./util";',
  '',
  'export function calculateTax(amount: number): number {',
  '    const rate = 0.2;',
  '    return amount * rate;',
  '}',
  '',
  'export function applyDiscount(amount: number): number {',
  '    return amount * 0.9;',
  '}',
  '',
  'export class Ledger {',
  '    public balance: number = 0;',
  '}',
  '',
].join('\n');

/**
 * Build a symbol index plus call graph with `callers` external call sites of `calculateTax`.
 *
 * @param callers - Number of cross-file call sites to synthesize.
 * @returns Call graph exposing those call sites.
 */
function buildCallGraph(callers) {
  const index = new SymbolIndex();
  index.addDefinitions([{ name: 'calculateTax', kind: 'function', file: 'src/tax.ts', line: 3 }]);
  const references = [];
  for (let i = 0; i < callers; i++) {
    references.push({
      name: 'calculateTax',
      file: `src/consumer-${String(i).padStart(2, '0')}.ts`,
      line: 10 + i,
      kind: 'call',
      caller: `consumer${i}`,
    });
  }
  index.addReferences(references);
  return new CallGraph(index);
}

/** Assert the planner leaves a genuinely local edit untouched. */
function assertLocalEditStaysBounded() {
  const planner = new SparseReferenceReplayManager();
  const edited = SOURCE.replace('const rate = 0.2;', 'const rate = 0.25;');
  const window = planner.computeSparseReplayWindow({
    filePath: 'src/tax.ts',
    oldContent: SOURCE,
    newContent: edited,
    changedLines: [4, 4],
  });
  assert.strictEqual(window.isBounded, true, 'local edit must stay bounded');
  assert.strictEqual(window.requiresFullReplay, false, 'local edit must not replay the file');
  assert.strictEqual(window.isSparseBridged, false, 'local edit needs no sparse references');
  assert.strictEqual(window.sparseReferences.length, 0, 'local edit carries no references');
  assert.strictEqual(window.startLine, 3, 'window starts at the declaration');
  assert.strictEqual(window.endLine, 6, 'window ends at the declaration');
  console.log('  ✔ local edit stays a plain bounded window');
}

/** Assert adjacent anchors merge into one compound window instead of a whole-file replay. */
function assertCompoundAnchorsMerge() {
  const planner = new SparseReferenceReplayManager();
  const edited = SOURCE.replace('return amount * 0.9;', 'return amount * 0.85;');
  const baseline = new SwaBoundedReplayManager().computeReplayWindow(
    'src/tax.ts',
    SOURCE,
    edited,
    [4, 9],
  );
  assert.strictEqual(
    baseline.reason,
    REASON_MULTI_ANCHOR_SPAN,
    'baseline manager must report a multi-anchor span',
  );
  assert.strictEqual(baseline.requiresFullReplay, true, 'baseline manager replays the file');

  const window = planner.computeSparseReplayWindow({
    filePath: 'src/tax.ts',
    oldContent: SOURCE,
    newContent: edited,
    changedLines: [4, 9],
  });
  assert.strictEqual(window.reason, REASON_COMPOUND_ANCHOR_WINDOW, 'planner merges the anchors');
  assert.strictEqual(window.isBounded, true, 'compound window is bounded');
  assert.strictEqual(window.requiresFullReplay, false, 'compound window avoids full replay');
  assert.strictEqual(window.startLine, 3, 'compound window starts at the first anchor');
  assert.strictEqual(window.endLine, 10, 'compound window ends at the last anchor');
  assert.ok(
    window.effectiveSpanLines <= DEFAULT_MAX_COMPOUND_WINDOW_LINES,
    'compound window respects the line cap',
  );
  console.log('  ✔ adjacent anchors merge into a bounded compound window');
}

/** Assert an anchor span larger than the cap still degrades honestly. */
function assertOversizedSpanDegrades() {
  const planner = new SparseReferenceReplayManager(undefined, { maxCompoundWindowLines: 2 });
  const edited = SOURCE.replace('return amount * 0.9;', 'return amount * 0.85;');
  const window = planner.computeSparseReplayWindow({
    filePath: 'src/tax.ts',
    oldContent: SOURCE,
    newContent: edited,
    changedLines: [4, 9],
  });
  assert.strictEqual(window.isBounded, false, 'a span above the cap cannot be bounded');
  assert.strictEqual(window.requiresFullReplay, true, 'oversized span replays the file');
  assert.strictEqual(window.reason, REASON_MULTI_ANCHOR_SPAN, 'reason stays truthful');
  console.log('  ✔ oversized anchor span still reports a full replay');
}

/** Assert a signature mutation becomes a bounded window with sparse references attached. */
function assertSignatureMutationIsBridged() {
  const planner = new SparseReferenceReplayManager();
  const edited = SOURCE.replace(
    'export function calculateTax(amount: number): number {',
    'export function calculateTax(amount: number, discount: number = 0): number {',
  );
  const baseline = new SwaBoundedReplayManager().computeReplayWindow(
    'src/tax.ts',
    SOURCE,
    edited,
    [3, 3],
  );
  assert.strictEqual(
    baseline.reason,
    REASON_SIGNATURE_MUTATION,
    'baseline manager must report a signature mutation',
  );
  assert.strictEqual(baseline.requiresFullReplay, true, 'baseline manager replays the file');

  const callGraph = buildCallGraph(5);
  const window = planner.computeSparseReplayWindow({
    filePath: 'src/tax.ts',
    oldContent: SOURCE,
    newContent: edited,
    changedLines: [3, 3],
    resolveReferences: createCallGraphReferenceResolver(callGraph),
  });
  assert.strictEqual(window.reason, REASON_SPARSE_BRIDGED_SIGNATURE, 'planner bridges the change');
  assert.strictEqual(window.isBounded, true, 'bridged window is bounded');
  assert.strictEqual(window.requiresFullReplay, false, 'bridged window avoids full replay');
  assert.strictEqual(window.isSparseBridged, true, 'bridged window is flagged');
  assert.strictEqual(window.sparseReferences.length, 5, 'all five call sites are retained');
  assert.strictEqual(window.startLine, 3, 'bridged window starts at the mutated declaration');
  assert.strictEqual(
    window.sparseReferences[0].symbol,
    'calculateTax',
    'references name the symbol',
  );
  console.log('  ✔ signature mutation is bounded and carries sparse references');
}

/** Assert the sparse reference budget caps the retained call sites. */
function assertSparseBudgetIsEnforced() {
  const planner = new SparseReferenceReplayManager(undefined, { maxSparseReferences: 3 });
  const edited = SOURCE.replace(
    'export function calculateTax(amount: number): number {',
    'export function calculateTax(amount: number, discount: number = 0): number {',
  );
  const window = planner.computeSparseReplayWindow({
    filePath: 'src/tax.ts',
    oldContent: SOURCE,
    newContent: edited,
    changedLines: [3, 3],
    resolveReferences: createCallGraphReferenceResolver(buildCallGraph(40)),
  });
  assert.strictEqual(window.sparseReferences.length, 3, 'reference budget caps the window');
  assert.ok(
    window.effectiveSpanLines <= DEFAULT_MAX_COMPOUND_WINDOW_LINES,
    'bridged window respects the line cap',
  );
  console.log('  ✔ sparse reference budget caps retained call sites');
}

/** Assert a signature mutation without a resolver degrades honestly instead of pretending. */
function assertSignatureWithoutResolverDegrades() {
  const planner = new SparseReferenceReplayManager();
  const edited = SOURCE.replace(
    'export function calculateTax(amount: number): number {',
    'export function calculateTax(amount: number, discount: number = 0): number {',
  );
  const window = planner.computeSparseReplayWindow({
    filePath: 'src/tax.ts',
    oldContent: SOURCE,
    newContent: edited,
    changedLines: [3, 3],
  });
  assert.strictEqual(window.isBounded, false, 'no resolver means no bridging');
  assert.strictEqual(window.requiresFullReplay, true, 'no resolver means full replay');
  assert.strictEqual(window.isSparseBridged, false, 'no resolver means no bridge flag');
  console.log('  ✔ signature mutation without a resolver degrades honestly');
}

/** Assert import mutations stay a whole-file replay: module resolution changed everywhere. */
function assertImportMutationStaysFullReplay() {
  const planner = new SparseReferenceReplayManager();
  const edited = SOURCE.replace(
    'import { util } from "./util";',
    'import { util, extra } from "./util";',
  );
  const window = planner.computeSparseReplayWindow({
    filePath: 'src/tax.ts',
    oldContent: SOURCE,
    newContent: edited,
    changedLines: [1, 1],
    resolveReferences: createCallGraphReferenceResolver(buildCallGraph(5)),
  });
  assert.strictEqual(window.isBounded, false, 'import edits cannot be bounded');
  assert.strictEqual(window.requiresFullReplay, true, 'import edits replay the whole file');
  assert.strictEqual(window.reason, REASON_GLOBAL_MUTATION, 'import reason stays truthful');
  console.log('  ✔ import mutation keeps a whole-file replay');
}

/** Assert the resolver prefers cross-file callers and is deterministic across runs. */
function assertResolverRankingAndDeterminism() {
  const index = new SymbolIndex();
  index.addDefinitions([{ name: 'shared', kind: 'function', file: 'src/shared.ts', line: 1 }]);
  index.addReferences([
    { name: 'shared', file: 'src/shared.ts', line: 20, kind: 'call', caller: 'localCaller' },
    { name: 'shared', file: 'src/remote.ts', line: 8, kind: 'call', caller: 'remoteCaller' },
  ]);
  const resolver = createCallGraphReferenceResolver(new CallGraph(index));
  const first = resolver('shared', 1);
  const second = resolver('shared', 1);
  assert.strictEqual(first.length, 1, 'limit is honoured');
  assert.strictEqual(first[0].file, 'src/remote.ts', 'cross-file caller outranks the local one');
  assert.deepStrictEqual(first, second, 'resolver output is deterministic');
  assert.deepStrictEqual(referenceFiles(first), ['src/remote.ts'], 'file projection is stable');
  assert.deepStrictEqual(resolver('shared', 0), [], 'zero budget returns nothing');
  console.log('  ✔ resolver ranks cross-file callers first and stays deterministic');
}

/** Assert the planner forwards issue pruning to the bounded manager. */
function assertPruningDelegates() {
  const planner = new SparseReferenceReplayManager();
  const edited = SOURCE.replace('const rate = 0.2;', 'const rate = 0.25;');
  const window = planner.computeSparseReplayWindow({
    filePath: 'src/tax.ts',
    oldContent: SOURCE,
    newContent: edited,
    changedLines: [4, 4],
  });
  const issues = [
    { location: { start: { line: 1 } } },
    { location: { start: { line: 4 } } },
    { location: { start: { line: 12 } } },
  ];
  const pruned = planner.pruneIssuesOutsideWindow(issues, window);
  assert.strictEqual(pruned.length, 1, 'only the in-window issue survives');
  assert.strictEqual(pruned[0].location.start.line, 4, 'the surviving issue is the in-window one');
  console.log('  ✔ issue pruning delegates to the bounded manager');
}

function main() {
  console.log('=== Sparse Reference Replay Planner Validation ===');
  assertLocalEditStaysBounded();
  assertCompoundAnchorsMerge();
  assertOversizedSpanDegrades();
  assertSignatureMutationIsBridged();
  assertSparseBudgetIsEnforced();
  assertSignatureWithoutResolverDegrades();
  assertImportMutationStaysFullReplay();
  assertResolverRankingAndDeterminism();
  assertPruningDelegates();
  console.log('=== ALL SPARSE REFERENCE VALIDATION TESTS PASSED (9/9) ===');
}

main();
