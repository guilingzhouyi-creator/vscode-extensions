/**
 * Module: Documentation Metric Coverage Guard — Declared Versus Rendered
 * File Path: scripts/common/validate-metric-coverage.js
 * Architecture Role: Closes the last gap in the document-metrics pipeline. `sync-doc-metrics`
 *   verifies that every *rendered* region matches its source, but it never asks whether every
 *   *declared* metric is rendered at all: a metric declared in `doc-metrics.json` with no marker
 *   region is documentation debt that reads as a completed feature, and a marker naming an
 *   undeclared metric is a region nobody can regenerate.
 * Dependencies & Triggers: `scripts/common/doc-metrics.json` and the Markdown corpus; invoked by
 *   pre-push gate, audit-all and CI.
 * Responsibilities:
 *   1. Report metrics declared but rendered nowhere;
 *   2. Report markers whose id was never declared;
 *   3. Prove the detector fires by driving it with synthetic declarations and documents.
 * Exit Semantics & Design Rationale: 0 = declaration set equals rendered set, 1 = either direction
 *   is non-empty. Set equality rather than one-way containment: a declared-but-unrendered metric is
 *   a promise nobody keeps, and a rendered-but-undeclared marker is a value with no source.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CONFIG_FILE = path.join(__dirname, 'doc-metrics.json');
const SKIP_DIRS = new Set(['node_modules', '.git', 'archive', 'dist', 'out', 'bin', 'obj', '.audit-logs', 'plugins']);
const SKIP_PATHS = Object.freeze(['WebGames/docs', '.agents/plugins']);
const REGION = /<!--\s*METRICS:BEGIN\s+([a-z0-9-]+)\s*-->/g;

/**
 * Collects every Markdown file in scope.
 *
 * @returns {string[]} Absolute paths.
 */
function collectDocuments() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
      if (SKIP_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
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
 * Proves the comparison discriminates in both directions.
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
  const declared = (config.metrics || []).map((metric) => metric.id);
  const rendered = collectRendered(collectDocuments().map((file) => fs.readFileSync(file, 'utf8')));
  const { declaredButUnrendered, renderedButUndeclared } = compareCoverage(declared, rendered);

  const passed = declaredButUnrendered.length === 0 && renderedButUndeclared.length === 0;
  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'metric-coverage',
          declared: declared.length,
          rendered: rendered.size,
          declaredButUnrendered,
          renderedButUndeclared,
          summary: passed
            ? `All ${declared.length} declared metrics are rendered.`
            : 'Declaration set and rendered set differ.',
        },
        null,
        2,
      ),
    );
    process.exit(passed ? 0 : 1);
  }
  if (passed) {
    console.log(`  PASS Metric coverage: ${declared.length} declared metrics are all rendered.`);
    process.exit(0);
  }
  console.error('✖ BLOCK metric-coverage: declaration set and rendered set differ.');
  if (declaredButUnrendered.length > 0) {
    console.error(`  declared but never rendered: ${declaredButUnrendered.join(', ')}`);
  }
  if (renderedButUndeclared.length > 0) {
    console.error(`  rendered but never declared: ${renderedButUndeclared.join(', ')}`);
  }
  process.exit(1);
}

if (require.main === module) main();

module.exports = Object.freeze({ compareCoverage, collectRendered, runSelfProbes });
