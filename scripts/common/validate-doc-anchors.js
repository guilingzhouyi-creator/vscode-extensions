/**
 * Module: Documentation Anchor Guard — Positional References and Named Anchors
 * File Path: scripts/common/validate-doc-anchors.js
 * Architecture Role: Keeps cross-document references resolvable. A document that says "公理 6" is
 *   referring to a number that no longer exists once a row is inserted or deleted above it, and the
 *   reference fails silently: the sentence still reads fine, it just points at the wrong rule.
 *   Earlier revisions of the DSH plan set carried seventeen such references, all stale after the
 *   axiom table was reordered.
 * Dependencies & Triggers: Node.js standard library plus AGENTS.md as the anchor authority; invoked
 *   by pre-push gate, audit-all and CI.
 * Responsibilities:
 *   1. Reject positional references (§N, 公理 N, 红线 N, SOP 第 N 步) anywhere in the scanned corpus;
 *   2. Verify that a named anchor (「X」公理 / 「X」行) actually names a row that exists in AGENTS.md;
 *   3. Prove both detectors still fire through built-in probes before trusting a green run.
 * Exit Semantics & Design Rationale: 0 = every reference resolves by name, 1 = a positional
 *   reference survives or a named anchor names nothing. The guard forbids position rather than
 *   validating it because position is exactly what breaks: a number can be made correct today and
 *   wrong tomorrow by an unrelated edit, while a name travels with its row.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const RULES_FILE = path.join(REPO_ROOT, 'AGENTS.md');
const SCAN_ROOTS = Object.freeze(['docs', '.agents/skills', '.agents/dsh', '.agents/subagents', 'scripts']);
const SCAN_FILES = Object.freeze(['AGENTS.md', 'README.md']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'archive', 'dist', 'out', 'bin', 'obj', '.audit-logs', 'plugins']);
const SKIP_PATHS = Object.freeze(['WebGames/docs', 'archives']);

/**
 * A reference that identifies a rule by how many rows precede it.
 *
 * The separator is `[ \t]` rather than `\s` on purpose: a table row ending in 「红线」 followed by a
 * cell containing 「1」 would otherwise read as the reference 「红线 1」 across a newline, and every
 * such table would be a false positive. Ordinals and section numbers are only written on one line.
 * The redline pattern additionally refuses 「红线一票否决」, an idiom about vetoes that is not a
 * reference to any numbered redline.
 */
const POSITIONAL = [
  { name: 'cross-doc-section-number', pattern: /(?:AGENTS\.md|docs\/[\w./-]+\.md)[ \t]*§[ \t]*\d/g },
  { name: 'axiom-ordinal', pattern: /公理[ \t]*[0-9０-９一二三四五六七八九十]/g },
  { name: 'redline-ordinal', pattern: /红线[ \t]*[0-9０-９一二三四五六七八九十](?!票)/g },
  { name: 'sop-step-ordinal', pattern: /SOP[ \t]*第[ \t]*[0-9０-９一二三四五六七八九十]+[ \t]*步/g },
];

/** A reference that identifies a rule by its row name; the name must exist in AGENTS.md. */
const NAMED = /「([^」\n]{2,40})」(?:公理|行|节)/g;

/**
 * Collects Markdown files beneath the scan roots.
 *
 * @returns {string[]} Absolute paths.
 */
function collectDocuments() {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
      if (SKIP_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) files.push(full);
    }
  };
  for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root));
  for (const rel of SCAN_FILES) {
    const abs = path.join(REPO_ROOT, rel);
    if (fs.existsSync(abs)) files.push(abs);
  }
  return files;
}

/**
 * Finds positional references in one document body.
 *
 * @param {string} text - Document body.
 * @returns {Array<{kind: string, match: string}>} Positional references.
 */
function findPositional(text) {
  const found = [];
  for (const { name, pattern } of POSITIONAL) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) found.push({ kind: name, match: match[0].trim() });
  }
  return found;
}

/**
 * Lists named anchors whose name does not appear in the anchor authority.
 *
 * @param {string} text - Document body.
 * @param {string} authority - Text of AGENTS.md.
 * @returns {string[]} Unresolvable anchor names.
 */
function findDanglingAnchors(text, authority) {
  const dangling = [];
  NAMED.lastIndex = 0;
  for (const match of text.matchAll(NAMED)) {
    if (!authority.includes(match[1])) dangling.push(match[1]);
  }
  return dangling;
}

/**
 * Runs the audit across the corpus.
 *
 * @returns {Array<object>} Violations.
 */
function runAudit() {
  const authority = fs.readFileSync(RULES_FILE, 'utf8');
  const violations = [];
  for (const file of collectDocuments()) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    for (const hit of findPositional(text)) {
      violations.push({ type: 'POSITIONAL_REFERENCE', file: rel, detail: `${hit.kind}: ${hit.match}` });
    }
    for (const name of findDanglingAnchors(text, authority)) {
      violations.push({ type: 'DANGLING_ANCHOR', file: rel, detail: name });
    }
  }
  return violations;
}

/**
 * Proves both detectors discriminate before trusting a green result.
 *
 * @param {string} authority - Text of AGENTS.md.
 * @returns {string[]} Probe failures.
 */
function runSelfProbes(authority) {
  const failures = [];
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) failures.push(`probe "${label}": expected ${wanted}, got ${actual}`);
  };
  expect('named-reference-is-allowed', findPositional('见 §二 的「SubAgent 调度」公理').length, 0);
  expect('ordinal-axiom-rejected', findPositional('依据公理 6 执行').length, 1);
  expect('ordinal-redline-rejected', findPositional('触碰红线 3').length, 1);
  expect('ordinal-sop-step-rejected', findPositional('按 SOP 第 4 步').length, 1);
  expect('section-number-rejected', findPositional('详见 AGENTS.md §3').length, 1);
  expect(
    'existing-anchor-resolves',
    findDanglingAnchors('见「SubAgent 调度」公理', authority).length,
    0,
  );
  expect(
    'absent-anchor-rejected',
    findDanglingAnchors('见「不存在的条目」公理', authority).length,
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
  if (!fs.existsSync(RULES_FILE)) {
    console.error('✖ BLOCK doc-anchors: AGENTS.md is missing, so no anchor can be resolved.');
    process.exit(1);
  }
  const authority = fs.readFileSync(RULES_FILE, 'utf8');
  const probeFailures = runSelfProbes(authority);
  if (probeFailures.length > 0) {
    console.error('✖ BLOCK doc-anchors: built-in probes no longer discriminate.');
    for (const failure of probeFailures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  const violations = runAudit();
  const passed = violations.length === 0;
  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'doc-anchors',
          violations,
          summary: passed
            ? 'Every cross-document reference resolves by name.'
            : `${violations.length} unresolvable documentation reference(s).`,
        },
        null,
        2,
      ),
    );
    process.exit(passed ? 0 : 1);
  }
  if (passed) {
    console.log('  PASS Documentation anchors: every reference resolves by name.');
    process.exit(0);
  }
  console.error(`✖ BLOCK doc-anchors: ${violations.length} unresolvable reference(s):`);
  for (const item of violations) console.error(`  - ${item.file} [${item.type}] ${item.detail}`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = Object.freeze({ runAudit, findPositional, findDanglingAnchors, runSelfProbes });
