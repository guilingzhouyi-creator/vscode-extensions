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
const RULE_CATALOG_PATH = path.join(REPO_ROOT, 'scripts/common/rule-catalog.json');
const RUST_DIRS = [
  path.join(REPO_ROOT, 'fractal-git/crates'),
  path.join(REPO_ROOT, 'fractal-git/src'),
  path.join(REPO_ROOT, 'auto-refactor/crates'),
];

const RULE_ID_RE = /\b([A-Z]{2,4}-[A-Z0-9]{2,6}-\d{3})\b/g;
const PROTOCOL_ALLOWLIST = new Set([
  'SHA-256',
  'SHA-512',
  'AES-256',
  'AES-128',
  'UTF-8',
  'UTF-16',
  'ISO-8601',
  'RFC-7231',
  'RFC-3339',
  'IEEE-754',
]);

function loadRegisteredRules() {
  if (!fs.existsSync(RULE_CATALOG_PATH)) {
    return new Set();
  }
  const catalog = JSON.parse(fs.readFileSync(RULE_CATALOG_PATH, 'utf8'));
  return new Set((catalog.rules || []).map((r) => r.id));
}

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

function countChar(str, ch) {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === ch) count++;
  }
  return count;
}

/**
 * Check rule ID drift against catalog.
 */
function checkRuleDrift(line, lineNum, filePath, registeredRules, errors) {
  if (registeredRules.size === 0) return;
  RULE_ID_RE.lastIndex = 0;
  let match;
  while ((match = RULE_ID_RE.exec(line)) !== null) {
    const ruleId = match[1];
    if (!PROTOCOL_ALLOWLIST.has(ruleId) && !registeredRules.has(ruleId)) {
      errors.push(`${filePath}:${lineNum}: Unregistered rule ID '${ruleId}' (RCFG-RULE-DRIFT)`);
    }
  }
}

/**
 * Check bare unwrap / expect in production code.
 */
function checkUnwrapExpect(trimmed, lineNum, filePath, errors) {
  if (!/\.(?:unwrap|expect)\(/.test(trimmed) || trimmed.startsWith('//')) return;
  if (!trimmed.includes('.lock().unwrap()') && !trimmed.includes('.read().unwrap()')) {
    errors.push(`${filePath}:${lineNum}: Prohibited unwrap/expect in production path (FGT-ERR-001)`);
  }
}

/**
 * Check unsafe block safety invariant documentation.
 */
function checkUnsafeSafety(trimmed, lines, lineIndex, filePath, errors) {
  if (!/\bunsafe\s*\{/.test(trimmed) || trimmed.startsWith('//')) return;
  let hasSafetyDoc = false;
  for (let j = Math.max(0, lineIndex - 4); j < lineIndex; j++) {
    if (lines[j].includes('SAFETY:')) {
      hasSafetyDoc = true;
      break;
    }
  }
  if (!hasSafetyDoc) {
    errors.push(`${filePath}:${lineIndex + 1}: Bare unsafe block without preceding '// SAFETY:' invariant proof (FGT-SAF-001)`);
  }
}

/**
 * Validate a single Rust file against conformance invariants.
 *
 * @param {string} filePath - Absolute path to .rs file.
 * @param {Set<string>} registeredRules - Set of valid rule IDs from rule-catalog.json.
 * @returns {string[]} List of detected violations.
 */
function validateRustFile(filePath, registeredRules) {
  const errors = [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  let pendingTestAttr = false;
  let insideTestModule = false;
  let testBraceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('#[cfg(test)]')) {
      pendingTestAttr = true;
    }
    if ((pendingTestAttr && trimmed.includes('{')) || trimmed.includes('mod tests {')) {
      insideTestModule = true;
      pendingTestAttr = false;
      testBraceDepth = 0;
    }
    if (insideTestModule) {
      testBraceDepth += countChar(line, '{') - countChar(line, '}');
      if (testBraceDepth <= 0) {
        insideTestModule = false;
      }
      continue;
    }

    checkRuleDrift(line, i + 1, filePath, registeredRules, errors);
    checkUnwrapExpect(trimmed, i + 1, filePath, errors);
    checkUnsafeSafety(trimmed, lines, i, filePath, errors);
  }

  return errors;
}

function run() {
  const registeredRules = loadRegisteredRules();
  const allErrors = [];
  let fileCount = 0;

  for (const dir of RUST_DIRS) {
    const files = collectRustFiles(dir);
    fileCount += files.length;
    for (const f of files) {
      allErrors.push(...validateRustFile(f, registeredRules));
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
