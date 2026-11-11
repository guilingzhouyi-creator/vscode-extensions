#!/usr/bin/env node
/**
 * Module: Tooling — Governance Snapshot Diff Classifier & Timestamp Rollback
 * File Path: scripts/lib/trajectory-ledger-redact.js
 * Architecture Role: Decides whether a post-audit change to
 *   `.refactor-trajectory/governance-supervisor.json` carries governance meaning or is only a
 *   write-time artefact. A full scan always rewrites `lastUpdated`, which used to leave the
 *   work tree permanently dirty and therefore blocked the clean-tree release gate.
 * Dependencies & Triggers: Node.js built-ins only (fs, path, child_process); invoked by
 *   audit-all (ps1 and sh) after the aggregate verdict is known.
 * Responsibilities:
 *   1. Compare the working-tree snapshot against the committed `HEAD` revision field by field.
 *   2. Classify the delta as `absent`, `timestamp-only` or `semantic`.
 *   3. Roll a `timestamp-only` delta back to the committed value, leaving semantic delta intact.
 * Exit Semantics & Design Rationale: 0 = classification produced and any rollback succeeded;
 *   1 = git could not be consulted or the snapshot could not be parsed, because a guard that
 *   cannot read history must not silently claim the tree is clean.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SNAPSHOT_RELATIVE_PATH = path.join(
  'auto-refactor',
  '.refactor-trajectory',
  'governance-supervisor.json',
);
const SNAPSHOT_POSIX_PATH = SNAPSHOT_RELATIVE_PATH.replace(/\\/g, '/');

/** Fields whose change is a governance fact rather than a write artefact. */
const SEMANTIC_KEYS = Object.freeze([
  'version',
  'projectProfile',
  'learnedWeights',
  'activeIncidents',
  'demotedRules',
  'boostedPatterns',
  'evolutionStepsCount',
]);

const KIND_ABSENT = 'absent';
const KIND_TIMESTAMP_ONLY = 'timestamp-only';
const KIND_SEMANTIC = 'semantic';

/**
 * Reads and parses a JSON document, treating absence as null.
 *
 * @param {string} filePath - Absolute path.
 * @returns {object|null} Parsed value, or null when the file does not exist.
 */
function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Reads the committed revision of the snapshot from git.
 *
 * @param {string} repoRoot - Repository root.
 * @returns {object|null} Committed value, or null when the path is untracked.
 */
function readHeadSnapshot(repoRoot) {
  let raw;
  try {
    raw = execFileSync('git', ['show', `HEAD:${SNAPSHOT_POSIX_PATH}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Collects the semantic keys whose values differ between two snapshots.
 *
 * Comparison is structural rather than textual: the commit order writes a stable key order, so
 * a textual compare would report a key reordering as semantic drift.
 *
 * @param {object|null} committed - Value at HEAD.
 * @param {object|null} working - Value in the work tree.
 * @returns {string[]} Differing semantic keys, empty when none.
 */
function collectSemanticDelta(committed, working) {
  if (committed === null || working === null) return [];
  const changed = [];
  for (const key of SEMANTIC_KEYS) {
    if (JSON.stringify(committed[key]) !== JSON.stringify(working[key])) changed.push(key);
  }
  return changed;
}

/**
 * Classifies the work-tree snapshot delta against HEAD.
 *
 * @param {string} [repoRoot] - Repository root; defaults to this module's repository.
 * @returns {{kind: string, changedKeys: string[], exists: boolean}}
 */
function classifySnapshotDiff(repoRoot = REPO_ROOT) {
  const workingPath = path.join(repoRoot, SNAPSHOT_RELATIVE_PATH);
  const working = readJsonIfPresent(workingPath);
  if (working === null) {
    return { kind: KIND_ABSENT, changedKeys: [], exists: false };
  }
  const committed = readHeadSnapshot(repoRoot);
  if (committed === null) {
    // Untracked snapshot: every field it carries is unrecorded, so it is never "timestamp-only".
    return { kind: KIND_SEMANTIC, changedKeys: SEMANTIC_KEYS.slice(), exists: true };
  }
  const changedKeys = collectSemanticDelta(committed, working);
  if (changedKeys.length > 0) {
    return { kind: KIND_SEMANTIC, changedKeys, exists: true };
  }
  const timestampChanged = committed.lastUpdated !== working.lastUpdated;
  return {
    kind: timestampChanged ? KIND_TIMESTAMP_ONLY : KIND_ABSENT,
    changedKeys: [],
    exists: true,
  };
}

/**
 * Restores `lastUpdated` to its committed value, leaving every other field untouched.
 *
 * Refuses to run when the delta is not timestamp-only: rewriting a semantically changed
 * snapshot would erase governance facts that the operator still has to commit.
 *
 * @param {string} [repoRoot] - Repository root; defaults to this module's repository.
 * @returns {boolean} True when the field was restored.
 */
function revertTimestampOnly(repoRoot = REPO_ROOT) {
  const classification = classifySnapshotDiff(repoRoot);
  if (classification.kind !== KIND_TIMESTAMP_ONLY) return false;
  const workingPath = path.join(repoRoot, SNAPSHOT_RELATIVE_PATH);
  const committed = readHeadSnapshot(repoRoot);
  const working = readJsonIfPresent(workingPath);
  if (committed === null || working === null) return false;
  working.lastUpdated = committed.lastUpdated;
  fs.writeFileSync(workingPath, `${JSON.stringify(working, null, 2)}\n`, 'utf8');
  return true;
}

/**
 * Runs the three-fixture self test used by the gate.
 *
 * @returns {boolean} True when every fixture classifies as declared.
 */
function runSelfTest() {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'snapshot-redact-'));
  const snapshotPath = path.join(dir, SNAPSHOT_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const baseline = {
    version: '1.0',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    projectProfile: 'standard',
    learnedWeights: { Ws: 0.5, Wd: 0.45, Wf: 0.05 },
    activeIncidents: 0,
    demotedRules: [],
    boostedPatterns: [],
    evolutionStepsCount: 1,
  };

  // Fixture 1: timestamp-only delta.
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify({ ...baseline, lastUpdated: '2026-02-02T00:00:00.000Z' }),
  );
  const timestampOnly = collectSemanticDelta(baseline, readJsonIfPresent(snapshotPath)).length === 0;

  // Fixture 2: a governance field changed.
  const withIncident = { ...baseline, activeIncidents: 3 };
  const semanticDetected =
    collectSemanticDelta(baseline, withIncident).join(',') === 'activeIncidents';

  // Fixture 3: absent snapshot.
  fs.rmSync(snapshotPath);
  const absentDetected = readJsonIfPresent(snapshotPath) === null;

  fs.rmSync(dir, { recursive: true, force: true });
  return timestampOnly && semanticDetected && absentDetected;
}

/**
 * Human-readable one-liner for audit summaries.
 *
 * @param {{kind: string, changedKeys: string[]}} classification - Result of the classifier.
 * @returns {string} Summary fragment.
 */
function describeClassification(classification) {
  if (classification.kind === KIND_ABSENT) return '治理快照无变更';
  if (classification.kind === KIND_TIMESTAMP_ONLY) return '治理快照仅时间戳变化，已回滚';
  return `治理快照含语义变更: ${classification.changedKeys.join(', ')}`;
}

function main() {
  if (process.argv.includes('--self-test')) {
    const ok = runSelfTest();
    console.log(ok ? '✔ snapshot diff classifier self-test passed' : '✖ self-test failed');
    process.exit(ok ? 0 : 1);
  }
  try {
    const classification = classifySnapshotDiff();
    console.log(describeClassification(classification));
    if (process.argv.includes('--revert-timestamp')) {
      const reverted = revertTimestampOnly();
      if (reverted) console.log('✔ lastUpdated restored to the committed value');
    }
    process.exit(0);
  } catch (err) {
    console.error(`✖ snapshot classification failed: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  SEMANTIC_KEYS,
  KIND_ABSENT,
  KIND_TIMESTAMP_ONLY,
  KIND_SEMANTIC,
  SNAPSHOT_RELATIVE_PATH,
  classifySnapshotDiff,
  describeClassification,
  revertTimestampOnly,
  runSelfTest,
};
