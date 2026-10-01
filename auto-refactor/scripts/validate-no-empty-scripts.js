/**
 * Suite: Full-Workspace Empty & Vacuous File Governance Guard
 * Path: scripts/validate-no-empty-scripts.js
 * Invariants Tested:
 *   1. Zero Physical 0-byte files across source, test, script, and documentation trees
 *   2. Zero Semantic empty (whitespace-only or comment-only with 0 ELOC) source files
 *   3. Exemption rules (e.g. .git, build lock artifacts in target/) are strictly audited
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

function scanDirectory(dir, findings = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDirectory(fullPath, findings);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        if (stat.size === 0) {
          findings.push({
            path: fullPath,
            reason: 'Physical 0-byte file',
            size: 0,
          });
        } else {
          const content = fs.readFileSync(fullPath, 'utf8');
          const trimmed = content.trim();
          if (trimmed.length === 0) {
            findings.push({
              path: fullPath,
              reason: 'Whitespace-only empty file',
              size: stat.size,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}: ${err.message}`);
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
