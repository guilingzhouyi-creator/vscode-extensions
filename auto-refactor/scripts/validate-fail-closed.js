#!/usr/bin/env node
/**
 * Module: Verification Harness — Fail-Closed Routing & Validation Guard
 * File Path: scripts/validate-fail-closed.js
 * Architecture Role: Enforces Zero-Tolerance Fail-Closed Policy, N-02 (no fail-open
 *   fallback for unknown categories), N-03 (no silent skip for unclassified files),
 *   and N-08 (track declaration for custom analyzers).
 * Dependencies & Triggers: Run via `npm test` or `node scripts/validate-fail-closed.js`.
 * Responsibilities: Validate fail-closed routing behavior, unknown category errors, and schema
 *   enforcement.
 * Exit Semantics & Design Rationale: Exits 0 on verification pass, 1 on failure.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_SCHEMA_PATH = path.join(ROOT, 'config.schema.json');
const routerPath = path.join(ROOT, 'dist', 'core', 'router', 'sparseRuleRouter');

console.log(
  '=== Validating Fail-Closed Architecture & Guardrails (Fail-Closed, N-02, N-03, N-08) ===',
);

// 1. Validate config schema enforcement on custom analyzers (N-08)
assert(fs.existsSync(CONFIG_SCHEMA_PATH), 'config.schema.json must exist');
const configSchema = JSON.parse(fs.readFileSync(CONFIG_SCHEMA_PATH, 'utf8'));
const customAnalyzerProps = configSchema.properties?.customAnalyzers?.items?.properties;
assert(
  customAnalyzerProps,
  'customAnalyzers items properties must be defined in config.schema.json',
);
assert(
  customAnalyzerProps.signals,
  'customAnalyzers must declare mutation signals in schema (N-08)',
);
assert(customAnalyzerProps.track, 'customAnalyzers must declare execution track in schema (N-08)');
console.log(
  '✓ config.schema.json enforces signals and track declarations for custom analyzers (N-08)',
);

// 2. Load router module and test gray-scale telemetry exposure (S0.5)
let router;
try {
  router = require(routerPath);
} catch (err) {
  console.error('[FAIL] Unable to load sparseRuleRouter from dist. Run npm run build first.');
  console.error(err);
  process.exit(1);
}

const { resolveCategoryTargets, applyLanguageGating, setRoutingFallbackListener } = router;

// Test Telemetry Exposure
const events = [];
setRoutingFallbackListener((evt) => {
  events.push(evt);
});

// Default mode: Unknown category emits telemetry event
const targets = resolveCategoryTargets('NON_EXISTENT_CATEGORY_TEST');
assert(Array.isArray(targets), 'In S0 default mode, targets should return array fallback');
assert(
  events.some((e) => e.type === 'UNKNOWN_CATEGORY_FALLBACK'),
  'Must emit UNKNOWN_CATEGORY_FALLBACK event (S0.5)',
);

// Default mode: Unclassified language emits telemetry event
const dummySet = new Set(['some-analyzer']);
applyLanguageGating(dummySet, undefined);
assert(
  events.some((e) => e.type === 'UNCLASSIFIED_LANGUAGE_FALLBACK'),
  'Must emit UNCLASSIFIED_LANGUAGE_FALLBACK event',
);

console.log('✓ Routing telemetry exposure captured fallback events without silent swallowing');

// 3. Test Fail-Closed Hard Throws when fail-closed mode is enforced (Fail-Closed, N-02, N-03)
process.env.AUTO_REFACTOR_FAIL_CLOSED = '1';

// Verify unknown category throws
let categoryThrew = false;
try {
  resolveCategoryTargets('UNRECOGNIZED_CHAOS_CATEGORY');
} catch (err) {
  categoryThrew = true;
  assert(
    err.message.includes('[UNKNOWN_CATEGORY]'),
    `Expected [UNKNOWN_CATEGORY], got: ${err.message}`,
  );
}
assert(
  categoryThrew,
  '[FAIL-CLOSED VIOLATION] resolveCategoryTargets must throw on unknown category (N-02)',
);
console.log('✓ Unknown category strictly throws [UNKNOWN_CATEGORY] in fail-closed mode (N-02)');

// Verify unclassified file language throws
let languageThrew = false;
try {
  applyLanguageGating(dummySet, undefined);
} catch (err) {
  languageThrew = true;
  assert(
    err.message.includes('[UNCLASSIFIED_FILE]'),
    `Expected [UNCLASSIFIED_FILE], got: ${err.message}`,
  );
}
assert(
  languageThrew,
  '[FAIL-CLOSED VIOLATION] applyLanguageGating must throw on unclassified file (N-03)',
);
console.log('✓ Unclassified file strictly throws [UNCLASSIFIED_FILE] in fail-closed mode (N-03)');

// Clean up environment
delete process.env.AUTO_REFACTOR_FAIL_CLOSED;
setRoutingFallbackListener(null);

console.log('[PASS] validate-fail-closed passed all checks.');
process.exit(0);
