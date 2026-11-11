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
  REASON_CHANGE_SPAN_EXCEEDS_CAP,
  DEFAULT_MAX_COMPOUND_WINDOW_LINES,
  resolveWindowCap,
  MIN_ADAPTIVE_WINDOW_CAP,
  MAX_ADAPTIVE_WINDOW_CAP,
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

/** Helper to compute a sparse tax window for testing. */
function computeTestTaxWindow(planner, editedContent, changedLines = [4, 9]) {
  return planner.computeSparseReplayWindow({
    filePath: 'src/tax.ts',
    oldContent: SOURCE,
    newContent: editedContent,
    changedLines,
  });
}

/** Helper to compute a bounded replay window for the local tax rate edit. */
function computeTaxRateEditWindow(planner = new SparseReferenceReplayManager()) {
  const edited = SOURCE.replaceAll('const rate = 0.2;', 'const rate = 0.25;');
  const window = planner.computeSparseReplayWindow({
    filePath: 'src/tax.ts',
    oldContent: SOURCE,
    newContent: edited,
    changedLines: [4, 4],
  });
  return { planner, window };
}

/** Assert the planner leaves a genuinely local edit untouched. */
function assertLocalEditStaysBounded() {
  const { window } = computeTaxRateEditWindow();
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
  const edited = SOURCE.replaceAll('return amount * 0.9;', 'return amount * 0.85;');
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

  const window = computeTestTaxWindow(planner, edited);
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
  const edited = SOURCE.replaceAll('return amount * 0.9;', 'return amount * 0.85;');
  const window = computeTestTaxWindow(planner, edited);
  assert.strictEqual(window.isBounded, false, 'a span above the cap cannot be bounded');
  assert.strictEqual(window.requiresFullReplay, true, 'oversized span replays the file');
  assert.strictEqual(window.reason, REASON_MULTI_ANCHOR_SPAN, 'reason stays truthful');
  console.log('  ✔ oversized anchor span still reports a full replay');
}

/** Helper to compute sparse replay window for tax signature mutations. */
function computeTaxSignatureMutationWindow(planner, resolver) {
  const edited = SOURCE.replaceAll(
    'export function calculateTax(amount: number): number {',
    'export function calculateTax(amount: number, discount: number = 0): number {',
  );
  return planner.computeSparseReplayWindow({
    filePath: 'src/tax.ts',
    oldContent: SOURCE,
    newContent: edited,
    changedLines: [3, 3],
    resolveReferences: resolver,
  });
}

/** Assert a signature mutation becomes a bounded window with sparse references attached. */
function assertSignatureMutationIsBridged() {
  const planner = new SparseReferenceReplayManager();
  const baselineEdited = SOURCE.replaceAll(
    'export function calculateTax(amount: number): number {',
    'export function calculateTax(amount: number, discount: number = 0): number {',
  );
  const baseline = new SwaBoundedReplayManager().computeReplayWindow(
    'src/tax.ts',
    SOURCE,
    baselineEdited,
    [3, 3],
  );
  assert.strictEqual(
    baseline.reason,
    REASON_SIGNATURE_MUTATION,
    'baseline manager must report a signature mutation',
  );
  assert.strictEqual(baseline.requiresFullReplay, true, 'baseline manager replays the file');

  const callGraph = buildCallGraph(5);
  const window = computeTaxSignatureMutationWindow(
    planner,
    createCallGraphReferenceResolver(callGraph),
  );
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
  const window = computeTaxSignatureMutationWindow(
    planner,
    createCallGraphReferenceResolver(buildCallGraph(40)),
  );
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
  const window = computeTaxSignatureMutationWindow(planner, undefined);
  assert.strictEqual(window.isBounded, false, 'no resolver means no bridging');
  assert.strictEqual(window.requiresFullReplay, true, 'no resolver means full replay');
  assert.strictEqual(window.isSparseBridged, false, 'no resolver means no bridge flag');
  console.log('  ✔ signature mutation without a resolver degrades honestly');
}

/** Assert import mutations stay a whole-file replay: module resolution changed everywhere. */
function assertImportMutationReplay() {
  const planner = new SparseReferenceReplayManager();
  const edited = SOURCE.replaceAll(
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
  const { planner, window } = computeTaxRateEditWindow();
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

/** Assert window shifting ensures containment on large declarations (containment). */
function assertWindowShiftingGuaranteesContainment() {
  const swa = new SwaBoundedReplayManager();
  const lineCount = 400;
  const lines = ['export function processBatch(items: string[]): void {'];
  for (let i = 2; i < lineCount; i++) {
    lines.push(`    const step${i} = ${i};`);
  }
  lines.push('}');
  const source = lines.join('\n');

  // Test 1: Edit at line 129 (previously outside 1..128)
  const edited129 = source.replaceAll('const step129 = 129;', 'const step129 = 9999;');
  const win129 = swa.computeReplayWindow('src/batch.ts', source, edited129, [129, 129]);
  assert.strictEqual(win129.isBounded, true, 'line 129 edit must remain bounded');
  assert.strictEqual(win129.requiresFullReplay, false, 'line 129 edit must not replay full file');
  assert.ok(
    win129.startLine <= 129 && win129.endLine >= 129,
    'window must strictly contain changed line 129',
  );
  assert.ok(win129.effectiveSpanLines <= 128, 'shifted window span must not exceed cap');

  // Test 2: Edit at line 200
  const edited200 = source.replaceAll('const step200 = 200;', 'const step200 = 9999;');
  const win200 = swa.computeReplayWindow('src/batch.ts', source, edited200, [200, 200]);
  assert.strictEqual(win200.isBounded, true, 'line 200 edit must remain bounded');
  assert.ok(
    win200.startLine <= 200 && win200.endLine >= 200,
    'window must strictly contain changed line 200',
  );
  assert.ok(win200.effectiveSpanLines <= 128, 'shifted window span must not exceed cap');

  // Test 3: Edit spanning 200 lines (50 to 250) exceeds cap and must degrade
  const editedOver = source
    .replaceAll('const step50 = 50;', 'const step50 = 9999;')
    .replaceAll('const step250 = 250;', 'const step250 = 9999;');
  const winOver = swa.computeReplayWindow('src/batch.ts', source, editedOver, [50, 250]);
  assert.strictEqual(winOver.isBounded, false, 'oversized edit span must not be bounded');
  assert.strictEqual(
    winOver.requiresFullReplay,
    true,
    'oversized edit span must require full replay',
  );
  assert.strictEqual(
    winOver.reason,
    REASON_CHANGE_SPAN_EXCEEDS_CAP,
    'must report REASON_CHANGE_SPAN_EXCEEDS_CAP',
  );
  console.log('  ✔ window shifting strictly guarantees change containment (containment)');
}

/** Assert signature mutation retains entire declaration body (full-declaration). */
function assertSignaturePreservesFullDeclaration() {
  const planner = new SparseReferenceReplayManager();
  const multilineSource = [
    'export function calculateTax(',
    '    amount: number,',
    '    rate: number,',
    '): number {',
    '    const tax = amount * rate;',
    '    return tax;',
    '}',
  ].join('\n');
  const edited = multilineSource.replaceAll(
    'export function calculateTax(',
    'export function calculateTaxNew(',
  );

  const callGraph = buildCallGraph(3);
  const window = planner.computeSparseReplayWindow({
    filePath: 'src/calc.ts',
    oldContent: multilineSource,
    newContent: edited,
    changedLines: [1, 1],
    resolveReferences: createCallGraphReferenceResolver(callGraph),
  });

  assert.strictEqual(window.isBounded, true, 'multiline signature edit is bounded');
  assert.strictEqual(window.startLine, 1, 'window starts at line 1');
  assert.strictEqual(
    window.endLine,
    7,
    'window must cover the entire function body through line 7',
  );
  assert.strictEqual(
    window.effectiveSpanLines,
    7,
    'effective span matches total declaration lines',
  );
  assert.strictEqual(window.isSparseBridged, true, 'bridging flag active');
  console.log('  ✔ signature window covers complete declaration body (full-declaration)');
}

/** Assert statement declarations are independent and caches are isolated (cache-isolation). */
function assertStatementAnchorIsolation() {
  const swa = new SwaBoundedReplayManager();
  const source = [
    'const A = 1;',
    'const B = 2;',
    'const C = 3;',
    'export function f(): void {',
    '    return;',
    '}',
  ].join('\n');

  const anchors = swa.indexAnchors('src/stmts.ts', source);
  assert.strictEqual(anchors.length, 4, 'must extract 4 independent anchors');
  assert.strictEqual(anchors[0].name, 'A');
  assert.strictEqual(anchors[0].startLine, 1);
  assert.strictEqual(anchors[0].endLine, 1);
  assert.strictEqual(anchors[1].name, 'B');
  assert.strictEqual(anchors[1].startLine, 2);
  assert.strictEqual(anchors[1].endLine, 2);
  assert.strictEqual(anchors[2].name, 'C');
  assert.strictEqual(anchors[2].startLine, 3);
  assert.strictEqual(anchors[2].endLine, 3);
  assert.strictEqual(anchors[3].name, 'f');
  assert.strictEqual(anchors[3].startLine, 4);
  assert.strictEqual(anchors[3].endLine, 6);

  // Test cache isolation: AST cache must not overwrite text cache
  const syntheticAstRoot = {
    kind: 'SourceFile',
    children: [
      {
        kind: 'Function',
        name: 'astOnlyFunc',
        start: { line: 10, column: 1 },
        end: { line: 20, column: 1 },
        text: 'function astOnlyFunc() {}',
        introducesBinding: true,
      },
    ],
  };

  const astAnchors = swa.indexAnchors('src/stmts.ts', source, syntheticAstRoot);
  assert.strictEqual(astAnchors.length, 1, 'AST path must extract ast root anchors');
  assert.strictEqual(astAnchors[0].name, 'astOnlyFunc');

  // Querying text path again must return text anchors from text namespace
  const textAnchorsAgain = swa.indexAnchors('src/stmts.ts', source);
  assert.strictEqual(textAnchorsAgain.length, 4, 'Text cache must remain isolated from AST cache');
  assert.strictEqual(textAnchorsAgain[0].name, 'A');
  console.log(
    '  ✔ statement anchors are independent and AST/text caches are isolated (cache-isolation)',
  );
}

/**
 * Assert cross-language declarations in GDScript and Rust are accurately recognized
 * (polyglot-anchors).
 */
function assertCrossLanguageDeclarationsSupported() {
  const swa = new SwaBoundedReplayManager();

  // GDScript test
  const gdScript = [
    'var health = 100',
    'const MAX_HEALTH = 200',
    '',
    'func _ready() -> void:',
    '    print("ready")',
    '',
    'func _process(delta: float) -> void:',
    '    pass',
  ].join('\n');
  const gdAnchors = swa.indexAnchors('scripts/player.gd', gdScript);
  assert.strictEqual(gdAnchors.length, 4, 'must extract 4 GDScript anchors');
  assert.strictEqual(gdAnchors[0].name, 'health');
  assert.strictEqual(gdAnchors[0].startLine, 1);
  assert.strictEqual(gdAnchors[0].endLine, 1);
  assert.strictEqual(gdAnchors[1].name, 'MAX_HEALTH');
  assert.strictEqual(gdAnchors[1].startLine, 2);
  assert.strictEqual(gdAnchors[1].endLine, 2);
  assert.strictEqual(gdAnchors[2].name, '_ready');
  assert.strictEqual(gdAnchors[2].startLine, 4);
  assert.strictEqual(gdAnchors[2].endLine, 5);
  assert.strictEqual(gdAnchors[3].name, '_process');
  assert.strictEqual(gdAnchors[3].startLine, 7);
  assert.strictEqual(gdAnchors[3].endLine, 8);

  // Rust test
  const rustScript = ['pub fn query(&self);', 'pub fn compute(&self) -> u32 {', '    42', '}'].join(
    '\n',
  );
  const rsAnchors = swa.indexAnchors('src/engine.rs', rustScript);
  assert.strictEqual(rsAnchors.length, 2, 'must extract 2 Rust anchors');
  assert.strictEqual(rsAnchors[0].name, 'query');
  assert.strictEqual(rsAnchors[0].startLine, 1);
  assert.strictEqual(rsAnchors[0].endLine, 1);
  assert.strictEqual(rsAnchors[1].name, 'compute');
  assert.strictEqual(rsAnchors[1].startLine, 2);
  assert.strictEqual(rsAnchors[1].endLine, 4);
  console.log('  ✔ cross-language GDScript and Rust anchors supported (polyglot-anchors)');
}

/** Assert adaptive window capacity calibration resolution based on density metrics. */
function assertWindowCapResolution() {
  const planner = new SparseReferenceReplayManager();

  // 1. Without density: returns default cap (256)
  assert.strictEqual(resolveWindowCap(), DEFAULT_MAX_COMPOUND_WINDOW_LINES);
  assert.strictEqual(planner.resolveWindowCap(), DEFAULT_MAX_COMPOUND_WINDOW_LINES);

  // 2. High effective density (0.90): cap scales down
  // Expected: round(256 * (0.65 / 0.90)) = round(184.88) = 185
  const denseCap = resolveWindowCap({ effectiveDensity: 0.9 });
  assert.strictEqual(denseCap, 185, 'high density scales down cap');

  // 3. Low effective density (0.35): cap scales up
  // Expected: round(256 * (0.65 / 0.35)) = round(475.42) = 475
  const sparseCap = resolveWindowCap({ effectiveDensity: 0.35 });
  assert.strictEqual(sparseCap, 475, 'low density scales up cap');

  // 4. Clamping bounds
  // Extreme low density (< 0.20): clamped to MAX_ADAPTIVE_WINDOW_CAP (512)
  const extremeSparseCap = resolveWindowCap({ effectiveDensity: 0.05 });
  assert.strictEqual(
    extremeSparseCap,
    MAX_ADAPTIVE_WINDOW_CAP,
    'extreme low density clamped to max',
  );

  // Extreme high density (> 0.95): clamped to MIN_ADAPTIVE_WINDOW_CAP (>= 64)
  const extremeDenseCap = resolveWindowCap({ effectiveDensity: 1.0 });
  assert.ok(extremeDenseCap >= MIN_ADAPTIVE_WINDOW_CAP, 'must respect min cap');
}

/** Assert compound span acceptance changes dynamically with code density. */
function assertAdaptiveWindowIntegration() {
  const planner = new SparseReferenceReplayManager();

  // 5. Integration: compound span acceptance changes with density
  const lines = ['export function f1(): void {'];
  for (let i = 0; i < 98; i++) lines.push(`  const x${i} = ${i};`);
  lines.push('}');
  lines.push('export function f2(): void {');
  for (let i = 0; i < 98; i++) lines.push(`  const y${i} = ${i};`);
  lines.push('}');
  const content = lines.join('\n');
  const edited = content
    .replaceAll('const x0 = 0;', 'const x0 = 999;')
    .replaceAll('const y0 = 0;', 'const y0 = 999;');

  // Under normal default (cap 256), 200 lines is accepted:
  const winDefault = planner.computeSparseReplayWindow({
    filePath: 'src/compound.ts',
    oldContent: content,
    newContent: edited,
    changedLines: [2, 102],
  });
  assert.strictEqual(winDefault.isBounded, true, '200 lines fits default 256 cap');
  assert.strictEqual(winDefault.reason, REASON_COMPOUND_ANCHOR_WINDOW);

  // Under high density (effectiveDensity: 0.90, cap 185), 200 lines EXCEEDS the cap and
  // therefore degrades to a full replay:
  const winDense = planner.computeSparseReplayWindow({
    filePath: 'src/compound.ts',
    oldContent: content,
    newContent: edited,
    changedLines: [2, 102],
    density: { effectiveDensity: 0.9 },
  });
  assert.strictEqual(winDense.isBounded, false, '200 lines exceeds 185 cap in dense file');
  assert.strictEqual(winDense.requiresFullReplay, true);

  // Under low density (effectiveDensity: 0.35, cap 475), an even larger 300-line span is accepted:
  const bigLines = ['export function g1(): void {'];
  for (let i = 0; i < 148; i++) bigLines.push(`  const a${i} = ${i};`);
  bigLines.push('}');
  bigLines.push('export function g2(): void {');
  for (let i = 0; i < 148; i++) bigLines.push(`  const b${i} = ${i};`);
  bigLines.push('}');
  const bigContent = bigLines.join('\n');
  const bigEdited = bigContent
    .replaceAll('const a0 = 0;', 'const a0 = 999;')
    .replaceAll('const b0 = 0;', 'const b0 = 999;');

  const winBigSparse = planner.computeSparseReplayWindow({
    filePath: 'src/sparse-compound.ts',
    oldContent: bigContent,
    newContent: bigEdited,
    changedLines: [2, 152],
    density: { effectiveDensity: 0.35 },
  });
  assert.strictEqual(winBigSparse.isBounded, true, '300 lines fits low-density 475 cap');
  assert.strictEqual(winBigSparse.reason, REASON_COMPOUND_ANCHOR_WINDOW);

  console.log(
    '  ✔ adaptive window capacity calibrated from code density metrics (adaptive-window-cap)',
  );
}

function main() {
  console.log('=== Sparse Reference Replay Planner Validation ===');
  assertLocalEditStaysBounded();
  assertCompoundAnchorsMerge();
  assertOversizedSpanDegrades();
  assertSignatureMutationIsBridged();
  assertSparseBudgetIsEnforced();
  assertSignatureWithoutResolverDegrades();
  assertImportMutationReplay();
  assertResolverRankingAndDeterminism();
  assertPruningDelegates();
  assertWindowShiftingGuaranteesContainment();
  assertSignaturePreservesFullDeclaration();
  assertStatementAnchorIsolation();
  assertCrossLanguageDeclarationsSupported();
  assertWindowCapResolution();
  assertAdaptiveWindowIntegration();
  console.log('=== ALL SPARSE REFERENCE VALIDATION TESTS PASSED (15/15) ===');
}

main();
