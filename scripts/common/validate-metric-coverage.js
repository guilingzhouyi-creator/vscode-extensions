/**
 * Module: Documentation Metric Coverage Guard — Declared Versus Rendered
 * File Path: scripts/common/validate-metric-coverage.js
 * Architecture Role: Closes the last gap in the document-metrics pipeline. `sync-doc-metrics`
 *   verifies that every *rendered* region matches its source, but it never asks whether every
 *   *declared* metric is rendered at all: a metric declared in `doc-metrics.json` with no marker
 *   region is documentation debt that reads as a completed feature, and a marker naming an
 *   undeclared metric is a region nobody can regenerate.
 * Dependencies & Triggers: `scripts/common/doc-metrics.json`, `scripts/README.md` and the Markdown
 *   corpus; invoked by pre-push gate, audit-all and CI.
 * Responsibilities:
 *   1. Report metrics declared but rendered nowhere;
 *   2. Report markers whose id was never declared;
 *   3. Report inventoried scripts that the README inventory table never names;
 *   4. Report a guard that carries its own copy of the scan scope instead of reading the config;
 *   5. Prove every detector fires by driving it with synthetic declarations and documents.
 * Exit Semantics & Design Rationale: 0 = declaration set equals rendered set, the inventory table
 *   names every script, and no guard keeps a private skip list; 1 = any of those is violated. Set
 *   equality rather than one-way containment: a declared-but-unrendered metric is a promise nobody
 *   keeps, and a rendered-but-undeclared marker is a value with no source. The table check exists
 *   because `script-inventory` counts files, so a table missing rows still renders the right total —
 *   the drift is invisible to every count-based guard.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { listScriptInventory, resolveScanScope } = require('./sync-doc-metrics');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CONFIG_FILE = path.join(__dirname, 'doc-metrics.json');
const README_FILE = path.join(REPO_ROOT, 'scripts/README.md');

/**
 * Guards that walk the documentation corpus and therefore must share one scan scope.
 *
 * Each used to declare its own skip list. They drifted: three omitted `target` and `.venv` while
 * keeping a bare `plugins` entry that matched nothing at the repository root, so a Rust build
 * artefact was audited as governance prose. Reading the scope from `doc-metrics.json` is what makes
 * them provably identical; this list is how the guard proves nobody quietly reintroduced a copy.
 */
const SCOPE_CONSUMERS = Object.freeze([
  'scripts/common/validate-doc-anchors.js',
  'scripts/common/validate-doc-reachability.js',
  'scripts/common/validate-docs-consistency.js',
  'scripts/common/validate-metric-coverage.js',
]);

const REGION = /<!--\s*METRICS:BEGIN\s+([a-z0-9-]+)\s*-->/g;
const README_ROW = /^\|\s*`([a-z0-9]+)\/`\s*\|\s*[^|]+?\s*\|\s*`([^`]+)`/;

/**
 * Collects every Markdown file in scope.
 *
 * The scope comes from `doc-metrics.json` so this walk and `sync-doc-metrics` provably see the same
 * corpus. A private copy here was the drift that let `fractal-git/target` build output be audited.
 *
 * @param {{skipDirectories: string[], skipPaths: string[]}} scope - Resolved scan scope.
 * @returns {string[]} Absolute paths.
 */
function collectDocuments(scope) {
  const skipDirs = new Set(scope.skipDirectories);
  const skipPaths = scope.skipPaths;
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
      if (skipPaths.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) files.push(full);
    }
  };
  walk(REPO_ROOT);
  return files;
}

/**
 * Compares a declared id set against a rendered id set.
 *
 * Pure so the probes can call it with synthetic inputs; the real run simply feeds it the corpus.
 *
 * @param {string[]} declared - Metric ids from `doc-metrics.json`.
 * @param {Set<string>} rendered - Metric ids found in marker regions.
 * @returns {{declaredButUnrendered: string[], renderedButUndeclared: string[]}} Both directions.
 */
function compareCoverage(declared, rendered) {
  const declaredSet = new Set(declared);
  return {
    declaredButUnrendered: declared.filter((id) => !rendered.has(id)),
    renderedButUndeclared: [...rendered].filter((id) => !declaredSet.has(id)).sort(),
  };
}

/**
 * Collects the rendered ids across a list of document bodies.
 *
 * @param {string[]} bodies - Document texts.
 * @returns {Set<string>} Rendered metric ids.
 */
function collectRendered(bodies) {
  const rendered = new Set();
  for (const body of bodies) {
    REGION.lastIndex = 0;
    for (const match of body.matchAll(REGION)) rendered.add(match[1]);
  }
  return rendered;
}

/**
 * Lists the script files the README inventory table names.
 *
 * @param {string} markdown - README body.
 * @returns {Set<string>} `dir/file` keys.
 */
function parseInventoryTable(markdown) {
  const named = new Set();
  for (const line of markdown.split('\n')) {
    const match = README_ROW.exec(line);
    if (match) named.add(`${match[1]}/${match[2]}`);
  }
  return named;
}

/**
 * Reports inventoried scripts that the README table never names.
 *
 * `script-inventory` counts files, so a table that omits rows still renders the correct total. That
 * makes the omission invisible to every count-based guard: the number is right, the inventory is
 * wrong, and the reader who looks up a script by name does not find it.
 *
 * @param {Array<{dir: string, file: string}>} inventory - Inventoried files.
 * @param {Set<string>} named - `dir/file` keys present in the table.
 * @returns {string[]} Missing `dir/file` keys, sorted.
 */
function findMissingInventoryRows(inventory, named) {
  return inventory
    .map((entry) => `${entry.dir}/${entry.file}`)
    .filter((key) => !named.has(key))
    .sort();
}

/**
 * Reports scope consumers that still carry a private skip list.
 *
 * The check is textual on purpose: it must catch a guard that *declares* its own list even if the
 * values happen to match today, because the next edit to the config would silently desynchronise
 * them. Reading the scope from the config is the only shape that cannot drift. The pattern is
 * anchored to the start of a line so the probe fixtures below — which embed the same text inside a
 * string literal — are not mistaken for declarations.
 *
 * @param {Array<{file: string, body: string}>} sources - Guard sources.
 * @returns {string[]} Files that declare a private scan scope.
 */
function findPrivateScopes(sources) {
  return sources
    .filter(({ body }) => /^[ \t]*const\s+SKIP_(?:DIRS|DIRECTORIES|PATHS)\s*=/m.test(body))
    .map(({ file }) => file);
}

/**
 * Reports annotated inventory rows whose README text disagrees with the annotation.
 *
 * `inventoryAnnotations` exists so a data-only file (a baseline snapshot, a registry) can state what
 * it is for without the reader opening it. It is a second copy of the README's role and caller
 * columns, so it can drift — and had: one of four entries described a role the table no longer
 * carries. Two copies that must agree is a contract; two copies nobody compares is a liability.
 * Checking the agreement keeps the annotation useful without letting it become a lie.
 *
 * @param {object} annotations - `inventoryAnnotations` from `doc-metrics.json`.
 * @param {string} markdown - README body.
 * @returns {string[]} Annotated keys whose README row is missing or disagrees.
 */
function findAnnotationDrift(annotations, markdown) {
  const rows = new Map();
  for (const line of markdown.split('\n')) {
    const match = README_ROW.exec(line);
    if (match) rows.set(`${match[1]}/${match[2]}`, line);
  }
  const drift = [];
  for (const [key, annotation] of Object.entries(annotations || {})) {
    const row = rows.get(key);
    if (!row) {
      drift.push(`${key}: annotated but absent from the README table`);
      continue;
    }
    // The caller column is the half that rots silently: a renamed entry point leaves the
    // annotation naming a script nobody runs.
    const callers = annotation.callers || '';
    const names = [...callers.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const missing = names.filter((name) => !row.includes(name));
    if (missing.length > 0) drift.push(`${key}: README row omits caller(s) ${missing.join(', ')}`);
  }
  return drift;
}

/**
 * Proves every detector discriminates.
 *
 * @returns {string[]} Probe failures.
 */
function runSelfProbes() {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      failures.push(`probe "${label}": expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
    }
  };
  const complete = compareCoverage(['a', 'b'], collectRendered(['x <!-- METRICS:BEGIN a -->1<!-- METRICS:END a -->', '<!-- METRICS:BEGIN b -->2<!-- METRICS:END b -->']));
  expect('complete-declaration-passes', [complete.declaredButUnrendered, complete.renderedButUndeclared], [[], []]);
  const unrendered = compareCoverage(['a', 'b'], collectRendered(['<!-- METRICS:BEGIN a -->1<!-- METRICS:END a -->']));
  expect('declared-but-unrendered-blocks', unrendered.declaredButUnrendered, ['b']);
  const undeclared = compareCoverage(['a'], collectRendered(['<!-- METRICS:BEGIN a -->1<!-- METRICS:END a -->', '<!-- METRICS:BEGIN ghost -->2<!-- METRICS:END ghost -->']));
  expect('rendered-but-undeclared-blocks', undeclared.renderedButUndeclared, ['ghost']);

  const table = parseInventoryTable(
    ['| `common/` | Node.js | `a.js` | role | caller |', '| `sh/` | Bash | `b.sh` | role | caller |'].join('\n'),
  );
  expect('inventory-table-parses-rows', [...table].sort(), ['common/a.js', 'sh/b.sh']);
  expect(
    'inventory-table-complete-passes',
    findMissingInventoryRows([{ dir: 'common', file: 'a.js' }], table),
    [],
  );
  expect(
    'inventory-table-missing-row-blocks',
    findMissingInventoryRows([{ dir: 'common', file: 'a.js' }, { dir: 'common', file: 'ghost.js' }], table),
    ['common/ghost.js'],
  );

  expect(
    'private-scope-rejected',
    findPrivateScopes([{ file: 'x.js', body: "const SKIP_DIRS = new Set(['dist']);" }]),
    ['x.js'],
  );  expect(
    'config-derived-scope-passes',
    findPrivateScopes([{ file: 'y.js', body: 'const scope = resolveScanScope(config);' }]),
    [],
  );

  const annotatedTable = '| `common/` | JSON | `a.json` | role | `caller-one` |';
  expect(
    'annotation-drift-accepted',
    findAnnotationDrift({ 'common/a.json': { callers: '`caller-one`' } }, annotatedTable),
    [],
  );
  expect(
    'annotation-missing-row-rejected',
    findAnnotationDrift({ 'common/ghost.json': { callers: '`x`' } }, annotatedTable).length,
    1,
  );
  expect(
    'annotation-stale-caller-rejected',
    findAnnotationDrift({ 'common/a.json': { callers: '`renamed-caller`' } }, annotatedTable).length,
    1,
  );
  return failures;
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  const probeFailures = runSelfProbes();
  if (probeFailures.length > 0) {
    console.error('✖ BLOCK metric-coverage: built-in probes no longer discriminate.');
    for (const failure of probeFailures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('✖ BLOCK metric-coverage: doc-metrics.json is missing.');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const findings = collectFindings(config);
  const passed = findings.every((finding) => finding.items.length === 0);
  if (isAgent) {
    reportAgent(config, findings, passed);
    return;
  }
  reportHuman(findings, passed);
}

/**
 * Runs every assertion and returns one record per assertion.
 *
 * Uniform records rather than four local variables: the caller only needs "which assertion failed
 * and on what", and a shared shape keeps the pass/fail decision a single `every` instead of a
 * five-term conjunction that grows with each new assertion.
 *
 * @param {object} config - Parsed `doc-metrics.json`.
 * @returns {Array<{id: string, label: string, items: string[]}>} Findings per assertion.
 */
function collectFindings(config) {
  const declared = (config.metrics || []).map((metric) => metric.id);
  const rendered = collectRendered(
    collectDocuments(resolveScanScope(config)).map((file) => fs.readFileSync(file, 'utf8')),
  );
  const coverage = compareCoverage(declared, rendered);
  const readme = fs.existsSync(README_FILE) ? fs.readFileSync(README_FILE, 'utf8') : '';
  const inventory = listScriptInventory();
  return [
    { id: 'declaredButUnrendered', label: 'declared but never rendered', items: coverage.declaredButUnrendered },
    { id: 'renderedButUndeclared', label: 'rendered but never declared', items: coverage.renderedButUndeclared },
    {
      id: 'inventoryRowsMissing',
      label: 'missing from scripts/README.md inventory table',
      items: findMissingInventoryRows(inventory, parseInventoryTable(readme)),
    },
    {
      id: 'privateScanScopes',
      label: 'guard keeps a private scan scope instead of reading doc-metrics.json',
      items: findPrivateScopes(
        SCOPE_CONSUMERS.map((rel) => ({
          file: rel,
          body: fs.existsSync(path.join(REPO_ROOT, rel)) ? fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8') : '',
        })),
      ),
    },
    {
      id: 'annotationDrift',
      label: 'inventory annotation disagrees with the README table',
      items: findAnnotationDrift(config.inventoryAnnotations, readme),
    },
  ];
}

/**
 * Emits the structured verdict consumed by agents.
 *
 * @param {object} config - Parsed `doc-metrics.json`.
 * @param {Array<object>} findings - Assertion results.
 * @param {boolean} passed - Whether every assertion is empty.
 * @returns {void}
 */
function reportAgent(config, findings, passed) {
  const payload = {
    protocolVersion: '1.0.0',
    status: passed ? 'PASS' : 'BLOCK',
    gate: 'metric-coverage',
    declared: (config.metrics || []).length,
    summary: passed
      ? `All ${(config.metrics || []).length} declared metrics are rendered, the inventory table names every script, and no guard keeps a private scan scope.`
      : 'Declaration set, rendered set, inventory table or scan scope disagree.',
  };
  for (const finding of findings) payload[finding.id] = finding.items;
  console.log(JSON.stringify(payload, null, 2));
  process.exit(passed ? 0 : 1);
}

/**
 * Emits the operator-facing verdict.
 *
 * @param {Array<object>} findings - Assertion results.
 * @param {boolean} passed - Whether every assertion is empty.
 * @returns {void}
 */
function reportHuman(findings, passed) {
  if (passed) {
    console.log(
      `  PASS Metric coverage: ${listScriptInventory().length} inventory rows complete, ${SCOPE_CONSUMERS.length} guards share one scan scope.`,
    );
    process.exit(0);
  }
  console.error('✖ BLOCK metric-coverage: documentation coverage is inconsistent.');
  for (const finding of findings) {
    if (finding.items.length > 0) console.error(`  ${finding.label}: ${finding.items.join(', ')}`);
  }
  process.exit(1);
}

if (require.main === module) main();

module.exports = Object.freeze({
  compareCoverage,
  collectRendered,
  parseInventoryTable,
  findMissingInventoryRows,
  findPrivateScopes,
  findAnnotationDrift,
  runSelfProbes,
});
