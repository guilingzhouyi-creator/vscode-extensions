/**
 * Module: Verification Harness - Cross-file Literal Index
 * File Path: scripts/validate-literal-index.js
 * Architecture Role: Key-point lock for the literal-intelligence store: the algorithm must keep
 *     cross-file clusters and the meaning split, and both traversal paths must feed it
 * Dependencies & Triggers: `npm run validate-literal-index` (part of `npm test`); imports
 *     ../dist/api (scan) and ../dist/core/intelligence/literalIndex, plus a temp fixture tree
 * Responsibilities: Assert site de-duplication, cross-file clustering, the three-way
 *     same-value-different-meaning split, evidence-based roles and the unknown default; assert
 *     the materialized scan (plug-in analyzer) and the projecting scan both fill the store
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1, so a
 *     traversal that silently stops feeding literals fails the build; temporary fixture roots are
 *     removed in a `finally` block so a failing run leaves no artifacts behind.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { NodeKind } = require('../dist/core/multilang.js');
const {
  LiteralIndex,
  LITERAL_ROLE,
  classifyLiteralRole,
} = require('../dist/core/intelligence/literalIndex.js');
const { scan } = require('../dist/api.js');

const PLUGIN = path.join(__dirname, '..', 'samples', 'analyzers', 'noConsole.js');

/** Config that declares a plug-in analyzer, which forces the materialized traversal. */
const MATERIALIZED_CONFIG = {
  include: ['**/*.ts'],
  analyzers: {
    'no-console': { enabled: true },
    constants: { enabled: true, options: { crossFileLiteralClusters: true } },
  },
  customAnalyzers: [{ name: 'no-console', module: PLUGIN, enabled: true }],
};

/** Config with streaming analyzers only, which takes the lazy-projection fast path. */
const PROJECTION_CONFIG = { include: ['**/*.ts'], analyzers: {} };

/** Three files sharing one numeric value, used for the cross-file assertions. */
const FIXTURE = {
  'src/ports.ts': ['export const PORT_ALPHA = 4242;', ''].join('\n'),
  'src/hash.ts': [
    'export function hashStride(v: number): number {',
    '  return v * 4242;',
    '}',
    '',
  ].join('\n'),
  'src/totals.ts': ['export const TOTAL_OMEGA = 4242;', ''].join('\n'),
};

/**
 * Build a synthetic literal node.
 *
 * @param kind - Normalized node kind.
 * @param text - Source spelling of the literal.
 * @param line - One-based line to report.
 * @returns A structural node view accepted by the index.
 */
function literal(kind, text, line) {
  return { kind, text, start: { line, column: 1 }, children: [] };
}

/**
 * Build a synthetic declaration node.
 *
 * @param kind - Normalized node kind.
 * @param name - Declaration name.
 * @param children - Child nodes.
 * @returns A structural node view accepted by the index.
 */
function declaration(kind, name, children) {
  return { kind, name, start: { line: 1, column: 1 }, children };
}

/**
 * Write a fixture tree and scan it through the public entry point.
 *
 * @param root - Fixture project root.
 * @param files - Map of relative path to UTF-8 content.
 * @param config - Config file content controlling the traversal path.
 * @returns Scan report.
 */
async function scanFixture(root, files, config) {
  for (const [name, content] of Object.entries(files)) {
    const absolute = path.join(root, name);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  const configFile = path.join(root, 'auto-refactor.config.json');
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  return scan({ root, configFile, logLevel: 'silent', cache: false, workers: 1 });
}

(async () => {
  // ── 1. Algorithm: clustering, meaning split, de-duplication, roles ────────────────────────────
  const index = new LiteralIndex();
  const sites = [
    [
      'src/net/protocol.ts',
      declaration(NodeKind.Constant, 'PORT_HTTP', [literal(NodeKind.NumericLiteral, '8080', 1)]),
    ],
    [
      'src/alg/hash.ts',
      declaration(NodeKind.Function, 'hashStride', [literal(NodeKind.NumericLiteral, '8080', 1)]),
    ],
    [
      'tests/fixtures/seed.ts',
      declaration(NodeKind.Variable, 'seed', [literal(NodeKind.NumericLiteral, '8080', 1)]),
    ],
    [
      'src/generated/schema.ts',
      declaration(NodeKind.Constant, 'SCHEMA_VER', [literal(NodeKind.NumericLiteral, '512', 1)]),
    ],
    [
      'src/util/format.ts',
      declaration(NodeKind.Function, 'formatDigest', [
        literal(NodeKind.StringLiteral, 'a3f1c9d4e7b20586', 3),
      ]),
    ],
  ];
  for (const [file, tree] of sites) {
    index.addTree(file, tree);
    index.addTree(file, tree); // overlapping observation must not double-count
  }
  index.markBuiltFrom('unit');

  const stats = index.stats();
  assert.strictEqual(
    stats.occurrences,
    sites.length,
    'sites must be de-duplicated, not double-counted',
  );
  assert.strictEqual(stats.files, sites.length, `expected ${sites.length} contributing files`);

  const shared = index.entries().find((entry) => entry.value === '8080');
  assert.ok(shared, 'the shared value 8080 must be indexed');
  assert.strictEqual(
    shared.files.length,
    3,
    'the shared value must be attributed to all three files',
  );
  assert.strictEqual(shared.crossFile, true, 'value used in three files must be cross-file');
  assert.strictEqual(shared.multiMeaning, true, 'same value in three roles is three meanings');
  assert.strictEqual(shared.meanings.length, 3, 'meanings must not be merged across roles/symbols');
  console.log('  [PASS] cross-file cluster kept with a 3-way meaning split (8080)');

  const single = index.entries().find((entry) => entry.value === '512');
  assert.ok(single && single.crossFile === false, 'single-file value must not be cross-file');
  const clusters = index.clusters();
  assert.ok(
    clusters.some((entry) => entry.value === '8080'),
    'cross-file cluster must be reported',
  );
  assert.ok(!clusters.some((entry) => entry.value === '512'), 'single-file value must not cluster');
  console.log(`  [PASS] clusters() reports ${clusters.length} cross-file value(s) only`);

  const roles = stats.byRole;
  for (const role of ['fixture', 'generated', 'protocol', 'algorithm']) {
    assert.ok(
      roles[role] >= 1,
      `expected at least one ${role} occurrence, got ${JSON.stringify(roles)}`,
    );
  }
  assert.strictEqual(
    classifyLiteralRole('src/a.ts', 'X', 'x', NodeKind.Literal),
    LITERAL_ROLE.UNKNOWN,
    'unattributable literals must stay unknown rather than being guessed',
  );
  console.log(`  [PASS] roles inferred from evidence: ${JSON.stringify(roles)}`);

  // ── 2. Materialized traversal feeds the store ────────────────────────────────────────────────
  const materializedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-literals-mat-'));
  const projectedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-literals-proj-'));
  try {
    const materializedReport = await scanFixture(materializedRoot, FIXTURE, MATERIALIZED_CONFIG);
    const materialized = materializedReport.summary.literalIndex;
    assert.ok(materialized, 'the scan summary must publish literalIndex');
    assert.strictEqual(
      materialized.builtFrom,
      'materialized',
      'a plug-in analyzer must force materialization',
    );
    assert.ok(materialized.occurrences > 0, 'the materialized path must feed the literal store');
    assert.ok(materialized.crossFileValues >= 1, 'the shared fixture value must be cross-file');
    assert.ok(
      materialized.multiMeaningValues >= 1,
      'the shared fixture value carries several meanings',
    );
    console.log(
      `  [PASS] materialized path feeds the store (${materialized.occurrences} occurrences, ` +
        `${materialized.values} values, ${materialized.crossFileValues} cross-file)`,
    );

    // ── 3. Lazy-projection fast path feeds the same store ──────────────────────────────────────
    const projectedReport = await scanFixture(projectedRoot, FIXTURE, PROJECTION_CONFIG);
    const projected = projectedReport.summary.literalIndex;
    assert.strictEqual(
      projected.builtFrom,
      'projection',
      'a streaming-only config must take the fast path',
    );
    assert.ok(projected.occurrences > 0, 'the projection path must feed the literal store');
    assert.ok(projected.crossFileValues >= 1, 'the projection path must see cross-file values');
    assert.ok(projected.multiMeaningValues >= 1, 'the projection path must keep the meaning split');
    console.log(
      `  [PASS] projection path feeds the same store (${projected.occurrences} occurrences, ` +
        `${projected.values} values, ${projected.byRole.algorithm ?? 0} algorithm)`,
    );
    // ---- 4. The store is consumed: one finding for the shared multi-meaning value ----
    const findings = materializedReport.issues.filter((issue) =>
      issue.id.startsWith('literal-clusters:'),
    );
    assert.strictEqual(
      findings.length,
      1,
      `expected exactly one cluster finding, got ${findings.length}`,
    );
    assert.strictEqual(findings[0].detail.value, '4242', 'the finding must name the shared value');
    assert.strictEqual(findings[0].detail.crossFile, true, 'the finding must be marked cross-file');
    assert.ok(findings[0].detail.meanings.length >= 2, 'the finding must carry the meaning split');
    assert.strictEqual(
      findings[0].rule,
      'duplicate-literal',
      'the finding must reuse the registered rule id',
    );
    const projectedFindings = projectedReport.issues.filter((issue) =>
      issue.id.startsWith('literal-clusters:'),
    );
    assert.strictEqual(projectedFindings.length, 0, 'the cluster pass must stay opt-in');
    console.log(
      `  [PASS] clusters consumed into a review finding (${findings[0].detail.meanings.length} meanings, opt-in)`,
    );
  } finally {
    fs.rmSync(materializedRoot, { recursive: true, force: true });
    fs.rmSync(projectedRoot, { recursive: true, force: true });
  }

  console.log('\n ALL LITERAL INDEX CHECKS PASSED SUCCESSFULLY!\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
