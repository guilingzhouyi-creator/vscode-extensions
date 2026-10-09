/**
 * Module: Governance Tooling — Workspace Skills Synchronization & Parity Utility
 * File Path: scripts/common/sync-skills.js
 * Architecture Role: Single source of truth sync utility ensuring 100% byte parity
 *   between the root `.agents/skills/` catalog and `.agents/plugins/workspace-governance/skills/`.
 * Dependencies & Triggers: Node.js standard libraries (fs, path);
 *   invoked manually, by pre-commit hooks, or by validation workflows.
 * Responsibilities:
 *   1. Mirror files and directories from root skills to plugin skills bundle.
 *   2. Remove orphan files in plugin skills bundle if deleted from root.
 *   3. Support --check flag for read-only drift detection.
 * Exit Semantics & Design Rationale: Exits 0 on clean pass or successful sync;
 *   exits 1 on detected drift in --check mode or file operation errors.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Recursively collect all files under a directory as relative paths.
 *
 * @param {string} dir - Directory to walk.
 * @param {string} base - Base directory for relative paths.
 * @returns {string[]} Array of relative file paths with forward slashes.
 */
function collectRelativeFiles(dir, base = dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectRelativeFiles(full, base));
    } else if (entry.isFile()) {
      const rel = path.relative(base, full).replace(/\\/g, '/');
      result.push(rel);
    }
  }
  return result;
}

/**
 * Compare two directories for equality.
 *
 * @param {string} srcDir - Source directory.
 * @param {string} destDir - Destination directory.
 * @returns {{ missing: string[], modified: string[], extra: string[] }} Drift summary.
 */
function compareDirectories(srcDir, destDir) {
  const srcFiles = new Set(collectRelativeFiles(srcDir));
  const destFiles = new Set(collectRelativeFiles(destDir));

  const missing = [];
  const modified = [];
  const extra = [];

  for (const f of srcFiles) {
    if (!destFiles.has(f)) {
      missing.push(f);
      continue;
    }
    const srcContent = fs.readFileSync(path.join(srcDir, f));
    const destContent = fs.readFileSync(path.join(destDir, f));
    if (!srcContent.equals(destContent)) {
      modified.push(f);
    }
  }

  for (const f of destFiles) {
    if (!srcFiles.has(f)) {
      extra.push(f);
    }
  }

  return { missing, modified, extra };
}

/**
 * Synchronize destination directory from source directory.
 *
 * @param {string} srcDir - Source directory.
 * @param {string} destDir - Destination directory.
 * @returns {number} Count of updated/copied files.
 */
function syncDirectories(srcDir, destDir) {
  const diff = compareDirectories(srcDir, destDir);
  let changedCount = 0;

  for (const extra of diff.extra) {
    const targetPath = path.join(destDir, extra);
    fs.unlinkSync(targetPath);
  }

  const toCopy = [...diff.missing, ...diff.modified];
  for (const rel of toCopy) {
    const srcFile = path.join(srcDir, rel);
    const destFile = path.join(destDir, rel);
    const parent = path.dirname(destFile);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.copyFileSync(srcFile, destFile);
    changedCount++;
  }

  return changedCount;
}

/**
 * Main command line runner.
 *
 * @returns {number} Exit code.
 */
function main() {
  const repoRoot = path.resolve(__dirname, '../..');
  const srcDir = path.join(repoRoot, '.agents/skills');
  const destDir = path.join(repoRoot, '.agents/plugins/workspace-governance/skills');
  const isCheckMode = process.argv.includes('--check');

  if (!fs.existsSync(srcDir)) {
    process.stderr.write(`[sync-skills] Source directory not found: ${srcDir}\n`);
    return 1;
  }

  if (isCheckMode) {
    if (!fs.existsSync(destDir)) {
      process.stderr.write(`[sync-skills] Destination plugin directory not found: ${destDir}\n`);
      return 1;
    }
    const diff = compareDirectories(srcDir, destDir);
    const totalDrift = diff.missing.length + diff.modified.length + diff.extra.length;
    if (totalDrift > 0) {
      process.stderr.write(`[sync-skills] Detected drift between root skills and plugin bundle (${totalDrift} items):\n`);
      if (diff.missing.length > 0) process.stderr.write(`  - Missing in plugin: ${diff.missing.join(', ')}\n`);
      if (diff.modified.length > 0) process.stderr.write(`  - Modified in plugin: ${diff.modified.join(', ')}\n`);
      if (diff.extra.length > 0) process.stderr.write(`  - Extra in plugin: ${diff.extra.join(', ')}\n`);
      return 1;
    }
    process.stdout.write(`✔ [PASS] Skills parity verified: root and plugin skills are 100% identical.\n`);
    return 0;
  }

  const updated = syncDirectories(srcDir, destDir);
  process.stdout.write(`✔ [PASS] Synced skills to plugin bundle (${updated} files copied/updated).\n`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { compareDirectories, syncDirectories, collectRelativeFiles };

