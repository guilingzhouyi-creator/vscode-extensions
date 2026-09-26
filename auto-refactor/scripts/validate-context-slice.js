#!/usr/bin/env node
/**
 * Module: Verification Harness - Semantic Region Context Slice
 * File Path: scripts/validate-context-slice.js
 * Architecture Role: Key-point lock for the Agent-facing slice: an intent must resolve to
 *     definition, dependency and impact regions from the shared indexes, honour its budget
 *     explicitly, and report unmatched tokens instead of hiding them
 * Dependencies & Triggers: `npm run validate-context-slice` (part of `npm test`); imports
 *     ../dist/api (queryContextSlice + scan surface), ../dist/core/intelligence/contextSlice,
 *     ../dist/core/intelligence/symbolIndex and ../dist/core/intelligence/callGraph
 * Responsibilities: Assert intent resolution, the three region roles with their evidence, the
 *     budget/truncation contract, the unresolved-token contract, and that a real scan produces a
 *     slice whose regions all point at files that exist
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1, so a slice
 *     that silently drops regions (or claims completeness after truncation) fails the build;
 *     temporary fixture roots are removed in a `finally` block.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SymbolIndex, collectSymbols } = require('../dist/core/intelligence/symbolIndex.js');
const { CallGraph } = require('../dist/core/intelligence/callGraph.js');
const { buildContextSlice } = require('../dist/core/intelligence/contextSlice.js');
const { queryContextSlice } = require('../dist/api.js');

/** Fixture: entry -> alpha -> beta -> gamma, one cross-file hop each. */
const FIXTURE = {
  'src/main.ts': [
    "import { alpha } from './a';",
    'export function entry(): void {',
    '  alpha();',
    '}',
    '',
  ].join('\n'),
  'src/a.ts': [
    "import { beta } from './b';",
    'export function alpha(): void {',
    '  beta();',
    '}',
    '',
  ].join('\n'),
  'src/b.ts': [
    "import { gamma } from './c';",
    'export function beta(): void {',
    '  gamma();',
    '}',
    '',
  ].join('\n'),
  'src/c.ts': ['export function gamma(): void {', '  return;', '}', ''].join('\n'),
};

/**
 * Build a synthetic file tree with one declaration calling one callee.
 *
 * @param fn - Declared function name.
 * @param callee - Called name.
 * @returns A normalized node view shaped like adapter output.
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

/**
 * Write the fixture tree and run the public slice query against it.
 *
 * @param root - Fixture project root.
 * @returns The slice returned by the public API.
 */
async function scanAndSlice(root) {
  for (const [name, content] of Object.entries(FIXTURE)) {
    const absolute = path.join(root, name);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  const configFile = path.join(root, 'auto-refactor.config.json');
  fs.writeFileSync(configFile, JSON.stringify({ include: ['**/*.ts'], analyzers: {} }, null, 2));
  return queryContextSlice('给 alpha 增加超时处理', {
    root,
    configFile,
    logLevel: 'silent',
    cache: false,
    workers: 1,
  });
}

(async () => {
  // ── 1. Unit: region roles, evidence, budget and unresolved contract ───────────────────────────
  const index = new SymbolIndex();
  const trees = {
    'src/main.ts': chainTree('entry', 'alpha'),
    'src/a.ts': chainTree('alpha', 'beta'),
    'src/b.ts': chainTree('beta', 'gamma'),
  };
  for (const [file, tree] of Object.entries(trees)) {
    const collected = collectSymbols(tree, file);
    index.addDefinitions(collected.definitions);
    index.addReferences(collected.references);
  }
  const slice = buildContextSlice('给 alpha 增加超时处理', index, new CallGraph(index));
  assert.deepStrictEqual(slice.symbols, ['alpha'], 'the intent must resolve to alpha');
  assert.ok(
    slice.regions.some((region) => region.role === 'definition' && region.file === 'src/a.ts'),
    'the definition region must be selected',
  );
  assert.ok(slice.dependencies.includes('beta'), 'the callee must become a dependency region');
  assert.ok(slice.impacts.includes('entry'), 'the caller must become an impact region');
  assert.ok(
    slice.regions.every((region) => region.reason.length > 0),
    'every region must carry its selection evidence',
  );
  assert.ok(
    slice.constraints.some((line) => line.includes('Static inference') || line.includes('静态推断')),
    'the slice must state that its edges are static',
  );
  assert.ok(!slice.truncated, 'a three-region slice must not report truncation');
  console.log(
    `  [PASS] intent resolved to roles definition/dependency/impact (${slice.regions.length} regions)`,
  );

  const capped = buildContextSlice('给 alpha 增加超时处理', index, new CallGraph(index), {
    maxRegions: 2,
  });
  assert.strictEqual(capped.regions.length, 2, 'the budget must be enforced');
  assert.strictEqual(capped.truncated, true, 'truncation must be reported, not hidden');
  const unmatched = buildContextSlice('alpha zetaUnknown', index, new CallGraph(index));
  assert.deepStrictEqual(
    unmatched.unresolved,
    ['zetaUnknown'],
    'unmatched tokens must be reported',
  );
  console.log('  [PASS] budget truncation and unresolved tokens are explicit');

  // ── 2. Integration: a real scan feeds the slice, regions point at existing files ──────────────
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-slice-'));
  try {
    const real = await scanAndSlice(root);
    assert.deepStrictEqual(real.symbols, ['alpha'], 'the real scan must resolve the intent');
    assert.ok(real.dependencies.includes('beta'), 'the real call graph must supply dependencies');
    assert.ok(real.impacts.includes('entry'), 'the real call graph must supply impact');
    assert.ok(real.regions.length > 0, 'the real slice must contain regions');
    for (const region of real.regions) {
      assert.ok(
        fs.existsSync(path.join(root, region.file)),
        `every region must point at a real file: ${region.file}`,
      );
    }
    console.log(
      `  [PASS] real scan slice: ${real.regions.length} regions, ${real.dependencies.length} dependencies, ${real.impacts.length} impacts`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('\n ALL CONTEXT SLICE CHECKS PASSED SUCCESSFULLY!\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
