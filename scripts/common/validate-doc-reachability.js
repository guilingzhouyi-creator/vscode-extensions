/**
 * Module: Documentation Reachability Guard — Inbound Links for Normative Documents
 * File Path: scripts/common/validate-doc-reachability.js
 * Architecture Role: Keeps the governance corpus navigable. A normative document with no inbound
 *   link is unreachable in practice: a reader following the indexes never arrives at it, and an
 *   editor has no reason to keep it accurate. This repository accumulated orphan documents exactly
 *   that way — the gate checklist and the fractal-git document index were both written, both
 *   correct, and both invisible.
 * Dependencies & Triggers: The Markdown corpus under `docs/`, `.agents/` and the project document
 *   trees; invoked by pre-push gate, audit-all and CI.
 * Responsibilities:
 *   1. Require every normative document under the scanned roots to be named by at least one other
 *      document, by file name, by path, or by slug;
 *   2. Exempt entries that are legitimately consumed by code rather than by readers, listed
 *      explicitly with a reason;
 *   3. Prove the detector fires by driving it with a synthetic corpus.
 * Exit Semantics & Design Rationale: 0 = every reachable-by-design document has an inbound mention,
 *   1 = an orphan exists. The three accepted naming forms exist because the corpus links three ways
 *   (`x.md`, `docs/x.md`, and a bare slug in the preset matrix); accepting only one form reported
 *   twenty-seven false orphans, all of them genuinely linked.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { resolveScanScope } = require('./sync-doc-metrics');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CONFIG_FILE = path.join(__dirname, 'doc-metrics.json');
const SCAN_ROOTS = Object.freeze(['docs', '.agents/skills', '.agents/subagents', 'fractal-git/docs']);

/**
 * Documents with no inbound link by design, each with the reason it is exempt.
 *
 * A template is copied out of the tree and never read in place; an index is reached from the router
 * table rather than from prose. Listing the reason rather than the bare path keeps the exemption
 * reviewable, so a future orphan cannot hide behind a name on this list.
 */
const EXEMPT = Object.freeze({
  '.agents/skills/skill-governance/templates/skill-entrypoint-skeleton.md':
    'template copied into a new skill, never read in place',
  '.agents/skills/subagent-orchestration/templates/archetype-scaffold.json':
    'template copied when adding an archetype, never read in place',
});

/**
 * Collects Markdown files under the given roots.
 *
 * @param {string[]} roots - Repository-relative directories.
 * @param {{skipDirectories: string[], skipPaths: string[]}} scope - Scan scope from `doc-metrics.json`.
 * @returns {string[]} Absolute paths.
 */
function collect(roots, scope) {
  const skipDirs = new Set(scope.skipDirectories);
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
      if (scope.skipPaths.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) files.push(full);
    }
  };
  for (const root of roots) walk(path.join(REPO_ROOT, root));
  return files;
}

/**
 * Determines whether one document body names a target document.
 *
 * Pure so the probes can drive it without touching disk.
 *
 * @param {string} body - Candidate linking document.
 * @param {string} target - Repository-relative target path.
 * @returns {boolean} True when any accepted naming form appears.
 */
function mentions(body, target) {
  const base = path.basename(target);
  const stem = base.replace(/\.md$/, '');
  return body.includes(base) || body.includes(target) || body.includes(stem);
}

/**
 * Lists targets with no inbound mention from any other document.
 *
 * @param {string[]} targets - Repository-relative target paths.
 * @param {Array<{rel: string, body: string}>} corpus - All documents that could link.
 * @param {Record<string, string>} exempt - Exempt targets with reasons.
 * @returns {string[]} Orphan paths, sorted.
 */
function findOrphans(targets, corpus, exempt) {
  const orphans = [];
  for (const target of targets) {
    if (Object.prototype.hasOwnProperty.call(exempt, target)) continue;
    const linked = corpus.some(({ rel, body }) => rel !== target && mentions(body, target));
    if (!linked) orphans.push(target);
  }
  return orphans.sort();
}

/**
 * Proves the detector discriminates.
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
  const corpus = [{ rel: 'index.md', body: '见 [a](a.md)' }];
  expect('linked-document-passes', findOrphans(['a.md'], corpus, {}), []);
  expect('orphan-detected', findOrphans(['b.md'], corpus, {}), ['b.md']);
  expect('exempt-orphan-passes', findOrphans(['b.md'], corpus, { 'b.md': 'reason' }), []);
  expect('slug-form-counts', mentions('预置矩阵列出 wt-review', 'agents/wt-review.md'), true);
  expect('path-form-counts', mentions('见 docs/x.md', 'docs/x.md'), true);
  expect('unrelated-text-does-not-count', mentions('毫无关联的正文', 'docs/x.md'), false);
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
    console.error('✖ BLOCK doc-reachability: built-in probes no longer discriminate.');
    for (const failure of probeFailures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const scope = resolveScanScope(config);
  const targets = collect(SCAN_ROOTS, scope).map((file) => path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
  const corpus = collect(['docs', '.agents', 'fractal-git/docs', 'scripts', ''], scope).map((file) => ({
    rel: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
    body: fs.readFileSync(file, 'utf8'),
  }));
  const orphans = findOrphans(targets, corpus, EXEMPT);
  const passed = orphans.length === 0;

  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'doc-reachability',
          documents: targets.length,
          orphans,
          summary: passed
            ? `All ${targets.length} normative documents have an inbound link.`
            : `${orphans.length} document(s) have no inbound link.`,
        },
        null,
        2,
      ),
    );
    process.exit(passed ? 0 : 1);
  }
  if (passed) {
    console.log(`  PASS Doc reachability: all ${targets.length} normative documents have an inbound link.`);
    process.exit(0);
  }
  console.error(`✖ BLOCK doc-reachability: ${orphans.length} orphan document(s):`);
  for (const orphan of orphans) console.error(`  - ${orphan}`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = Object.freeze({ findOrphans, mentions, runSelfProbes, EXEMPT });
