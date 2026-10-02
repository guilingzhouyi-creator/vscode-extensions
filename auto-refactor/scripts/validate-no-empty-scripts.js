/**
 * Module: Governance Guard — Zero Empty Files Guard
 * File Path: scripts/validate-no-empty-scripts.js
 * Architecture Role: Workspace guard preventing zero-byte and zero-ELOC files.
 * Dependencies & Triggers: Consumes Node.js fs/path; executed in test suite.
 * Responsibilities: Audit workspace trees for zero-byte or empty semantic files.
 * Exit Semantics & Design Rationale: Exits 0 on clean check, 1 on empty file detection.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log('=== Running Full-Workspace Zero-Empty-Files Governance Guard ===');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'target',
  '.godot',
  '.cargo-lock',
]);

function inspectFileForEmptiness(fullPath, findings) {
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size === 0) {
      findings.push({
        path: fullPath,
        reason: 'Physical 0-byte file',
        size: 0,
      });
      return;
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    if (content.trim().length === 0) {
      findings.push({
        path: fullPath,
        reason: 'Whitespace-only empty file',
        size: stat.size,
      });
    }
  } catch (err) {
    console.error(`Error reading file ${fullPath}: ${err.message}`);
  }
}

function scanDirectory(dir, findings = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`Error reading directory ${dir}: ${err.message}`);
    return findings;
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(fullPath, findings);
      continue;
    }
    if (entry.isFile()) {
      inspectFileForEmptiness(fullPath, findings);
    }
  }
  return findings;
}

const workspaceRoot = path.resolve(__dirname, '..', '..');
const findings = scanDirectory(workspaceRoot);

if (findings.length > 0) {
  console.error(`\n[FAIL] Found ${findings.length} empty or 0-byte files in workspace:`);
  for (const f of findings) {
    console.error(`  - ${f.path} (${f.reason}, size=${f.size})`);
  }
}

assert.strictEqual(
  findings.length,
  0,
  `Zero empty files invariant violated: Found ${findings.length} empty or 0-byte files!`,
);

console.log('  [PASS] Gate: Zero physical 0-byte or whitespace-only empty files across workspace');
console.log('=== ALL EMPTY FILE GOVERNANCE CHECKS PASSED SUCCESSFULLY! ===\n');
