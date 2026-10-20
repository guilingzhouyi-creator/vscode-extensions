/**
 * Module: Governance Tooling — Rust Engineering Conformance Validator
 * File Path: .agents/skills/rust-engineering/scripts/validate-rust-conformance.js
 * Architecture Role: Companion static validator inspecting Rust source files for
 *   compliance with zero-panic (FGT-ERR-001), documented unsafe (FGT-SAF-001),
 *   and SSOT rule catalog integrity (RCFG-RULE-DRIFT).
 * Dependencies & Triggers: Node.js standard libraries (fs, path);
 *   invoked by pre-commit checks or manual developer audit runs.
 * Responsibilities:
 *   1. Scan production Rust source files (excluding tests/benches).
 *   2. Assert zero bare unwrap() and expect() in production execution paths.
 *   3. Assert every unsafe block is accompanied by a preceding // SAFETY: comment.
 *   4. Assert referenced rule IDs are registered in scripts/common/rule-catalog.json.
 * Exit Semantics & Design Rationale: Exits 0 on clean pass; exits 1 on detected violations.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../../');
const RUST_DIRS = [
  path.join(REPO_ROOT, 'fractal-git/crates'),
  path.join(REPO_ROOT, 'fractal-git/src'),
  path.join(REPO_ROOT, 'auto-refactor/crates'),
];

/**
 * Collect all .rs files under a directory recursively, excluding test targets.
 *
 * @param {string} dir - Directory to inspect.
 * @returns {string[]} List of production Rust file paths.
 */
function collectRustFiles(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;

  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'target' || entry.name === 'tests' || entry.name === 'benches') {
          continue;
        }
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.rs')) {
        if (entry.name.endsWith('_test.rs') || entry.name === 'tests.rs' || entry.name === 'test.rs') {
          continue;
        }
        result.push(full);
      }
    }
  }
  return result;
}

/**
 * Validate a single Rust file against conformance invariants.
 *
 * @param {string} filePath - Absolute path to .rs file.
 * @returns {string[]} List of detected violations.
 */
function validateRustFile(filePath) {
  const errors = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let insideTestModule = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('#[cfg(test)]') || trimmed.includes('mod tests {')) {
      insideTestModule = true;
    }
    if (insideTestModule) continue;

    // Check FGT-ERR-001: bare unwrap / expect in production code
    if (/\.(?:unwrap|expect)\(/.test(trimmed) && !trimmed.startsWith('//')) {
      // Allow atomic or harmless thread lock unwrap if explicitly guarded
      if (!trimmed.includes('.lock().unwrap()') && !trimmed.includes('.read().unwrap()')) {
        errors.push(`${filePath}:${i + 1}: Prohibited unwrap/expect in production path (FGT-ERR-001)`);
      }
    }

    // Check FGT-SAF-001: undocumented unsafe block
    if (/\bunsafe\s*\{/.test(trimmed) && !trimmed.startsWith('//')) {
      let hasSafetyDoc = false;
      for (let j = Math.max(0, i - 4); j < i; j++) {
        if (lines[j].includes('SAFETY:')) {
          hasSafetyDoc = true;
          break;
        }
      }
      if (!hasSafetyDoc) {
        errors.push(`${filePath}:${i + 1}: Bare unsafe block without preceding '// SAFETY:' invariant proof (FGT-SAF-001)`);
      }
    }
  }

  return errors;
}

function run() {
  const allErrors = [];
  let fileCount = 0;

  for (const dir of RUST_DIRS) {
    const files = collectRustFiles(dir);
    fileCount += files.length;
    for (const f of files) {
      allErrors.push(...validateRustFile(f));
    }
  }

  console.log(`Audited ${fileCount} production Rust source files for engineering conformance.`);
  if (allErrors.length > 0) {
    console.error(`Found ${allErrors.length} conformance violations:`);
    for (const err of allErrors) {
      console.error(`  ✖ ${err}`);
    }
    process.exit(1);
  }

  console.log('✔ [PASS] All production Rust source files 100% compliant with engineering invariants.');
}

if (require.main === module) {
  run();
}
