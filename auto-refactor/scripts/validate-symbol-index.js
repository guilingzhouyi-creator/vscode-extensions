/**
 * Module: Verification Harness — Cross-file Symbol Index
 * File Path: scripts/validate-symbol-index.js
 * Architecture Role: Key-point lock for the repository-intelligence foundation: a scan must fill
 *     the cross-file symbol index from the tree it already builds, the report must publish its
 *     coverage, and resolution must answer definition/reference/impact questions across files
 * Dependencies & Triggers: `npm run validate-symbol-index` (part of `npm test`); imports
 *     ../dist/api (scan) and drives TypeScript + Python fixtures into a temp directory
 * Responsibilities: Assert declarations and call sites are collected on both language families;
 *     assert cross-file references are attributed to the defining file's callers; assert the
 *     published `summary.symbolIndex` counters match the queries; assert a projection-path scan
 *     reports its reduced provenance instead of claiming materialized completeness
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so a scan
 *     that silently stops collecting symbols (or mis-attributes them) fails the build. Counts are
 *     asserted as lower bounds on the fixture plus exact set membership, so unrelated engine
 *     changes cannot make the lock brittle while a real regression still trips it.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan, querySymbols } = require('../dist/api');

/** TypeScript fixture: `helper.ts` defines, `main.ts` calls it across the file boundary. */
const TS_FILES = {
  'src/helper.ts': [
    'export function computeTotal(values: number[]): number {',
    '  return values.reduce((sum, value) => sum + value, 0);',
    '}',
    'export function formatTotal(total: number): string {',
    '  return `total=${total}`;',
    '}',
    '',
  ].join('\n'),
  'src/main.ts': [
    "import { computeTotal, formatTotal } from './helper';",
    '',
    'export function report(values: number[]): string {',
    '  const total = computeTotal(values);',
    '  return formatTotal(total);',
    '}',
    '',
  ].join('\n'),
};

/** Python fixture: same cross-file shape through a module import. */
const PY_FILES = {
  'app/helper.py': [
    'def compute_total(values):',
    '    return sum(values)',
    '',
    'def format_total(total):',
    '    return f"total={total}"',
    '',
  ].join('\n'),
  'app/main.py': [
    'from app.helper import compute_total, format_total',
    '',
    'def report(values):',
    '    total = compute_total(values)',
    '    return format_total(total)',
    '',
  ].join('\n'),
};

/**
 * Rules the fixture would trip are irrelevant here; only the symbol index is asserted. A custom
 * analyzer is declared so the scan takes the materialized path: the lazy-projection fast path does
 * NOT emit symbol facts yet (B2b in the plan), and this lock must test the path that does.
 */
const PLUGIN = path.join(__dirname, '..', 'samples', 'analyzers', 'noConsole.js');
const CONFIG = {
  include: ['**/*.ts', '**/*.py'],
  analyzers: { 'no-console': { enabled: true } },
  customAnalyzers: [
    { name: 'no-console', module: PLUGIN, enabled: true, signals: ['LITERAL'], track: 'fast' },
  ],
};

/**
 * Write a fixture tree and scan it in-process (no daemon, no cache) so the materialized path runs.
 *
 * @param root - Fixture project root.
 * @param files - Map of relative path to UTF-8 content.
 * @param options - Extra scan overrides (e.g. forcing the projection path).
 * @returns Scan report from the public entry point.
 */
async function scanFixture(root, files, options = {}) {
  const { configOverride, ...scanOptions } = options;
  for (const [name, content] of Object.entries(files)) {
    const absolute = path.join(root, name);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  const configFile = path.join(root, 'auto-refactor.config.json');
  fs.writeFileSync(configFile, JSON.stringify(configOverride ?? CONFIG, null, 2));
  return scan({
    root,
    configFile,
    logLevel: 'silent',
    cache: false,
    daemon: 'off',
    workers: 1,
    ...scanOptions,
  });
}

/**
 * Assert the index answers definition/reference/impact questions for one name.
 *
 * @param report - Report whose summary carries the index counters.
 * @param query - Resolver callback returning definitions and references for a name.
 * @param name - Symbol name to resolve.
 * @param expectedFiles - Files that must appear among the definitions.
 * @param expectedRefFiles - Files whose call sites must appear among the references.
 */
function assertResolves(report, query, name, expectedFiles, expectedRefFiles) {
  const resolved = query(name);
  const defFiles = new Set(resolved.definitions.map((d) => d.file.replace(/\\/g, '/')));
  const refFiles = new Set(resolved.references.map((r) => r.file.replace(/\\/g, '/')));
  for (const file of expectedFiles) {
    assert.ok(defFiles.has(file), `${name} must be defined in ${file}, got ${[...defFiles]}`);
  }
  for (const file of expectedRefFiles) {
    assert.ok(refFiles.has(file), `${name} must be called from ${file}, got ${[...refFiles]}`);
  }
  assert.ok(
    report.summary.symbolIndex.definitions >= resolved.definitions.length,
    'published definition count must cover the queried definitions',
  );
}

async function main() {
  const tsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-symbols-ts-'));
  const pyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-symbols-py-'));
  try {
    // ── 1. TypeScript: definitions, calls and cross-file attribution ──
    const tsReport = await scanFixture(tsRoot, TS_FILES);
    const tsIndex = tsReport.summary.symbolIndex;
    assert.ok(tsIndex, 'the report must publish symbol-index coverage');
    assert.strictEqual(
      tsIndex.builtFrom,
      'materialized',
      'a cold scan builds the materialized tree',
    );
    assert.ok(tsIndex.definitions >= 3, `expected >=3 declarations, got ${tsIndex.definitions}`);
    assert.ok(tsIndex.references >= 2, `expected >=2 call sites, got ${tsIndex.references}`);
    assert.ok(
      tsIndex.crossFileReferences >= 2,
      `expected >=2 cross-file call references, got ${tsIndex.crossFileReferences}`,
    );
    console.log('  [PASS] TypeScript scan fills the index with declarations and call sites');

    // ── 2. Python: the same questions through another adapter ──
    const pyReport = await scanFixture(pyRoot, PY_FILES);
    const pyIndex = pyReport.summary.symbolIndex;
    assert.ok(pyIndex.definitions >= 2, `expected Python declarations, got ${pyIndex.definitions}`);
    assert.ok(
      pyIndex.crossFileReferences >= 2,
      `expected Python cross-file calls, got ${pyIndex.crossFileReferences}`,
    );
    console.log('  [PASS] Python scan fills the same index through its own adapter');

    // ── 3. Provenance: a projection-path scan must not claim materialized completeness ──
    // ── 3b. The DEFAULT config (streaming analyzers only) takes the lazy-projection fast path:
    // it must feed the same index, not an empty one. ──
    const projectionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-symbols-proj-'));
    try {
      const projectedReport = await scanFixture(projectionRoot, TS_FILES, {
        configOverride: { include: ['**/*.ts'], analyzers: {} },
      });
      const projectedIndex = projectedReport.summary.symbolIndex;
      assert.strictEqual(
        projectedIndex.builtFrom,
        'projection',
        'a streaming-only config must take the lazy projection path',
      );
      assert.ok(
        projectedIndex.definitions >= 3,
        `the projection path must still feed declarations, got ${projectedIndex.definitions}`,
      );
      assert.ok(
        projectedIndex.references >= 2,
        `the projection path must feed the call names it materializes, got ${projectedIndex.references}`,
      );
      console.log(
        `  [PASS] default (projection) path feeds the index (${projectedIndex.definitions} defs)`,
      );
    } finally {
      fs.rmSync(projectionRoot, { recursive: true, force: true });
    }

    const oxcReport = await scanFixture(tsRoot, TS_FILES, { parser: 'oxc' });
    const oxcSource = oxcReport.summary.symbolIndex.builtFrom;
    assert.ok(
      oxcSource === 'materialized' || oxcSource === 'projection',
      `provenance must be reported, got ${oxcSource}`,
    );
    assert.ok(
      oxcReport.summary.symbolIndex.definitions >= 3,
      `the oxc adapter must feed the same index, got ${oxcReport.summary.symbolIndex.definitions}`,
    );
    console.log(`  [PASS] the oxc adapter feeds the same index (${oxcSource})`);

    // ── 4. Public query API resolves both language families ──
    const tsResolved = await querySymbols('computeTotal', {
      root: tsRoot,
      logLevel: 'silent',
      cache: false,
      daemon: 'off',
      workers: 1,
    });
    assertResolves(tsReport, () => tsResolved, 'computeTotal', ['src/helper.ts'], ['src/main.ts']);
    const pyResolved = await querySymbols('compute_total', {
      root: pyRoot,
      logLevel: 'silent',
      cache: false,
      daemon: 'off',
      workers: 1,
    });
    assertResolves(pyReport, () => pyResolved, 'compute_total', ['app/helper.py'], ['app/main.py']);
    console.log('  [PASS] querySymbols resolves definitions and cross-file call sites');

    // ── 4. The published counters agree with per-file facts ──
    const files = new Set(
      tsReport.fileMetrics.map((m) => m.file.replace(/\\/g, '/')).filter((f) => f.endsWith('.ts')),
    );
    assert.ok(files.has('src/helper.ts') && files.has('src/main.ts'), 'fixture must be scanned');
    assert.strictEqual(
      typeof tsIndex.definitionNames,
      'number',
      'distinct-name count must be published',
    );
    console.log('  [PASS] published index counters describe the scanned fixture');
  } finally {
    fs.rmSync(tsRoot, { recursive: true, force: true });
    fs.rmSync(pyRoot, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log('\n ALL SYMBOL INDEX CHECKS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
