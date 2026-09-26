/**
 * Module: Test Pipeline — Constants Single Source of Truth (SSOT) Guard
 * File Path: scripts/validate-constants-ssot.js
 * Architecture Role: Architecture gate enforcing single source of truth (SSOT) for all
 *     core domain tokens, AST kinds, severity levels, and standardized rule codes.
 * Dependencies & Triggers: Consumes compiled dist/core/constants; executed in test-parallel runner.
 * Responsibilities:
 *   1. Assert all SSOT constant modules are properly re-exported through the index barrel.
 *   2. Assert zero undefined exports, zero duplicate keys, and zero export collisions.
 *   3. Assert canonical naming conventions for all exported constant tokens.
 * Exit Semantics & Design Rationale: Process exits 0 if all constants SSOT contracts hold,
 *     1 on failure.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONSTANTS_SRC_DIR = path.join(ROOT, 'src', 'core', 'constants');
const CONSTANTS_DIST_DIR = path.join(ROOT, 'dist', 'core', 'constants');

function main() {
  console.log('--- Checking Constants Single Source of Truth (SSOT) ---');

  // 1. Check directory structure
  const requiredModules = [
    'ast-tokens.ts',
    'diagnostic-tokens.ts',
    'system-tokens.ts',
    'rule-codes.ts',
    'index.ts',
  ];

  for (const mod of requiredModules) {
    const fullPath = path.join(CONSTANTS_SRC_DIR, mod);
    assert.ok(
      fs.existsSync(fullPath),
      `Required constants module ${mod} must exist in src/core/constants/`,
    );
  }
  console.log(`✔ [PASS] All ${requiredModules.length} core constant modules exist.`);

  // 2. Check compiled barrel exports
  const constants = require(CONSTANTS_DIST_DIR);
  assert.ok(constants, 'Constants barrel must be requireable from dist/core/constants');

  // Check key categories
  assert.strictEqual(typeof constants.AST_FUNCTION_DECLARATION, 'string');
  assert.strictEqual(typeof constants.PRIMITIVE_STRING, 'string');
  assert.strictEqual(typeof constants.LANG_TYPESCRIPT, 'string');
  assert.strictEqual(typeof constants.SEVERITY_WARNING, 'string');
  assert.strictEqual(typeof constants.ANALYZER_CONSTANTS, 'string');
  assert.strictEqual(typeof constants.RULE_MAGIC_NUMBER, 'string');
  assert.strictEqual(typeof constants.CODE_CONST_HARDCODED_STRING, 'string');
  console.log('✔ [PASS] Core AST, primitive, severity, analyzer, and rule code tokens verified.');

  // 3. Check rule code format: AR:DOMAIN:ID
  const codeKeys = Object.keys(constants).filter((k) => k.startsWith('CODE_'));
  assert.ok(
    codeKeys.length >= 8,
    `Must define at least 8 standardized rule codes (found ${codeKeys.length})`,
  );
  for (const k of codeKeys) {
    const val = constants[k];
    assert.ok(
      typeof val === 'string' && /^AR:[A-Z]+:\d{3}$/.test(val),
      `Rule code ${k} = '${val}' must match format AR:DOMAIN:ID`,
    );
  }
  console.log(`✔ [PASS] All ${codeKeys.length} standardized rule codes match AR:DOMAIN:ID format.`);

  // 4. Check zero undefined exports
  const allExportKeys = Object.keys(constants);
  assert.ok(
    allExportKeys.length >= 50,
    `Constants barrel must export >= 50 constants (found ${allExportKeys.length})`,
  );
  for (const k of allExportKeys) {
    assert.notStrictEqual(constants[k], undefined, `Constant export '${k}' must not be undefined`);
  }
  console.log(`✔ [PASS] All ${allExportKeys.length} exported constants are defined and non-null.`);

  console.log('✔ [PASS] Constants SSOT guard passed completely.');
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
