/**
 * Module: Test Pipeline — Zero Nested Constants Governance Guard
 * File Path: scripts/validate-nested-constant-cleanliness.js
 * Architecture Role: Enforces strict anti-nesting discipline across src/. Prohibits
 *     redundant constant aliases (const A = B) and nested indirection, ensuring Single
 *     Source of Truth (SSOT) integrity and zero intermediate indirection in the engine.
 * Dependencies & Triggers: Node.js fs/path; executed in test-parallel runner.
 * Responsibilities:
 *   1. Recursively scan src/ for redundant constant alias declarations (const A = B).
 *   2. Assert that total nested constant aliases strictly equal 0.
 * Exit Semantics & Design Rationale: Process exits 0 on full compliance, 1 on violation.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

const ALIAS_RE =
  /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::\s*[^=]+)?\s*=\s*([A-Z][A-Z0-9_]{2,})\s*;?$/;

function scanFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const fullPath = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '.git') continue;
      results.push(...scanFiles(fullPath));
    } else if (ent.isFile() && (ent.name.endsWith('.ts') || ent.name.endsWith('.js'))) {
      results.push(fullPath);
    }
  }
  return results;
}

function runAudit() {
  console.log('--- Checking Zero Nested Constants Cleanliness ---');
  const files = scanFiles(SRC_DIR);
  const violations = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        return;
      }
      const match = trimmed.match(ALIAS_RE);
      if (match && match[1] !== match[2]) {
        violations.push({
          file: path.relative(ROOT, file).replace(/\\/g, '/'),
          line: idx + 1,
          alias: match[1],
          target: match[2],
          raw: trimmed,
        });
      }
    });
  }

  if (violations.length > 0) {
    console.error(`❌ [FAIL] Found ${violations.length} nested constant alias violation(s):`);
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line} -> '${v.alias}' aliases '${v.target}' (${v.raw})`);
    }
    process.exit(1);
  }

  console.log(`✔ [PASS] Verified ${files.length} source files: 0 nested constant aliases found.`);
  console.log('✔ [PASS] Zero nested constants cleanliness guard passed completely.');
}

runAudit();
