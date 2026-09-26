/**
 * Module: Test Pipeline — Internationalization & Kernel Cleanliness Guard
 * File Path: scripts/validate-i18n-cleanliness.js
 * Architecture Role: Regression guard enforcing the strict boundary between engine core
 *     diagnostics (100% normalized English for LLM Agents and parsers) and presentation
 *     dictionaries (localized human-facing translations).
 * Dependencies & Triggers: Node.js fs/path; executed in test-parallel runner.
 * Responsibilities:
 *   1. Verify that no diagnostic message, suggestion, reason, or rationale in src/
 *      contains Chinese characters.
 *   2. Verify that presentation dictionary (zh-cn.ts) exists and defines valid mapping tables.
 * Exit Semantics & Design Rationale: Process exits 0 if all cleanliness contracts hold,
 *     1 on violation.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const CHINESE_CHAR_RE = /[\u4e00-\u9fa5]/;

function scanFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const fullPath = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'dictionaries') continue;
      results.push(...scanFiles(fullPath));
    } else if (ent.isFile() && (ent.name.endsWith('.ts') || ent.name.endsWith('.js'))) {
      results.push(fullPath);
    }
  }
  return results;
}

function checkDiagnosticCleanliness(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    // Check property declarations that define human/agent diagnostic text
    const isDiagnosticField =
      trimmed.startsWith('message:') ||
      trimmed.startsWith('suggestion:') ||
      trimmed.startsWith('reason:') ||
      trimmed.startsWith('rationale:') ||
      trimmed.startsWith('description:');

    if (isDiagnosticField && CHINESE_CHAR_RE.test(trimmed)) {
      violations.push({
        line: idx + 1,
        content: trimmed,
      });
    }
  });

  return violations;
}

function main() {
  console.log('--- Checking Internationalization & Kernel Cleanliness ---');

  const files = scanFiles(SRC_DIR);
  let totalViolations = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const violations = checkDiagnosticCleanliness(file);
    if (violations.length > 0) {
      console.error(`✖ [FAIL] Found Chinese in diagnostic field in ${rel}:`);
      violations.forEach((v) => {
        console.error(`   Line ${v.line}: ${v.content}`);
      });
      totalViolations += violations.length;
    }
  }

  assert.strictEqual(
    totalViolations,
    0,
    `Found ${totalViolations} Chinese diagnostic strings in engine core. Human text must live in dictionaries.`,
  );
  console.log(
    `✔ [PASS] Verified ${files.length} engine files: 0 Chinese characters in diagnostics.`,
  );

  // Check presentation dictionary
  const dictPath = path.join(SRC_DIR, 'core', 'praxis', 'presentation', 'dictionaries', 'zh-cn.ts');
  assert.ok(fs.existsSync(dictPath), 'zh-cn.ts presentation dictionary must exist');
  const dictContent = fs.readFileSync(dictPath, 'utf8');
  assert.ok(dictContent.includes('STDLIB-PANIC-001'), 'zh-cn.ts must register STDLIB translations');
  console.log('✔ [PASS] Presentation dictionary is properly populated and decoupled.');

  console.log('✔ [PASS] Internationalization cleanliness guard passed completely.');
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
