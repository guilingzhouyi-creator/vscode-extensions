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
const diffClassifierPath = path.join(ROOT, 'dist', 'core', 'router', 'diffClassifier');
const configPath = path.join(ROOT, 'dist', 'core', 'config', 'config');
const sliceTypesPath = path.join(ROOT, 'dist', 'core', 'router', 'sliceTypes');
const { ERR_INVALID_CUSTOM_ANALYZER, ERR_UNKNOWN_CATEGORY, ERR_UNCLASSIFIED_FILE } = require(
  sliceTypesPath,
);
const { CATEGORY_GENERAL_CODE } = require(diffClassifierPath);

console.log(
  '=== Validating Fail-Closed Architecture & Guardrails (Fail-Closed, N-02, N-03, N-08) ===',
);

// 1. Validate config schema enforcement on custom analyzers (N-08)
assert(fs.existsSync(CONFIG_SCHEMA_PATH), 'config.schema.json must exist');
const configSchema = JSON.parse(fs.readFileSync(CONFIG_SCHEMA_PATH, 'utf8'));
const customAnalyzerItems = configSchema.properties?.customAnalyzers?.items;
assert(customAnalyzerItems, 'customAnalyzers items must be defined in config.schema.json');
const customAnalyzerProps = customAnalyzerItems.properties;
assert(
  customAnalyzerProps,
  'customAnalyzers items properties must be defined in config.schema.json',
);
assert(
  customAnalyzerProps.signals,
  'customAnalyzers must declare mutation signals in schema (N-08)',
);
assert(customAnalyzerProps.track, 'customAnalyzers must declare execution track in schema (N-08)');
assert(
  Array.isArray(customAnalyzerItems.required) &&
    customAnalyzerItems.required.includes('signals') &&
    customAnalyzerItems.required.includes('track'),
  'customAnalyzers must strictly require signals and track in schema (N-08)',
);
console.log(
  '✓ config.schema.json enforces signals and track declarations for custom analyzers (N-08)',
);

// 2. Load router module and test unconditional Fail-Closed enforcement (N-02, N-03)
let router;
try {
  router = require(routerPath);
} catch (err) {
  console.error('[FAIL] Unable to load sparseRuleRouter from dist. Run npm run build first.');
  console.error(err);
  process.exit(1);
}

const {
  resolveCategoryTargets,
  applyLanguageGating,
  setRoutingFallbackListener,
  isFailClosedMode,
  ALL_LANGUAGE_SPECIFIC_ANALYZERS,
  ROUTING_EVENT_UNKNOWN_CATEGORY,
  ROUTING_EVENT_UNCLASSIFIED_LANGUAGE,
} = router;

assert(isFailClosedMode() === true, 'isFailClosedMode must return true unconditionally in S2');

// Test Telemetry Exposure hook
const events = [];
setRoutingFallbackListener((evt) => {
  events.push(evt);
});

// Verify unknown category strictly throws [UNKNOWN_CATEGORY] without needing env flags (N-02)
let categoryThrew = false;
try {
  resolveCategoryTargets('NON_EXISTENT_CATEGORY_TEST');
} catch (err) {
  categoryThrew = true;
  assert(
    err.message.includes(ERR_UNKNOWN_CATEGORY),
    `Expected ${ERR_UNKNOWN_CATEGORY}, got: ${err.message}`,
  );
}
assert(
  categoryThrew,
  '[FAIL-CLOSED VIOLATION] resolveCategoryTargets must throw on unknown category (N-02)',
);
assert(
  events.some((e) => e.type === ROUTING_EVENT_UNKNOWN_CATEGORY),
  'Must emit UNKNOWN_CATEGORY_FALLBACK telemetry event upon error',
);
console.log('✓ Unknown category strictly throws [UNKNOWN_CATEGORY] unconditionally (N-02)');

// Verify unknown archetype on GENERAL_CODE strictly throws [UNKNOWN_CATEGORY]
let archetypeThrew = false;
try {
  resolveCategoryTargets(CATEGORY_GENERAL_CODE, 'non_existent_archetype');
} catch (err) {
  archetypeThrew = true;
  assert(
    err.message.includes(ERR_UNKNOWN_CATEGORY),
    `Expected ${ERR_UNKNOWN_CATEGORY}, got: ${err.message}`,
  );
}
assert(
  archetypeThrew,
  '[FAIL-CLOSED VIOLATION] resolveCategoryTargets must throw on unknown archetype (N-02)',
);
console.log('✓ Unknown archetype strictly throws [UNKNOWN_CATEGORY] unconditionally (N-02)');

// Verify unclassified file strictly throws [UNCLASSIFIED_FILE] without needing env flags (N-03)
const dummySet = new Set(['some-analyzer']);
let languageThrew = false;
try {
  applyLanguageGating(dummySet, undefined);
} catch (err) {
  languageThrew = true;
  assert(
    err.message.includes(ERR_UNCLASSIFIED_FILE),
    `Expected ${ERR_UNCLASSIFIED_FILE}, got: ${err.message}`,
  );
}
assert(
  languageThrew,
  '[FAIL-CLOSED VIOLATION] applyLanguageGating must throw on unclassified file (N-03)',
);
assert(
  events.some((e) => e.type === ROUTING_EVENT_UNCLASSIFIED_LANGUAGE),
  'Must emit UNCLASSIFIED_LANGUAGE_FALLBACK telemetry event upon error',
);
console.log('✓ Unclassified file strictly throws [UNCLASSIFIED_FILE] unconditionally (N-03)');

// Verify artifact classification is accepted and prunes language-specific analyzers
const artifactSet = new Set(['comments', ...ALL_LANGUAGE_SPECIFIC_ANALYZERS]);
applyLanguageGating(artifactSet, 'artifact');
assert(artifactSet.has('comments'), 'Generic analyzers must be retained for artifact files');
for (const spec of ALL_LANGUAGE_SPECIFIC_ANALYZERS) {
  assert(!artifactSet.has(spec), `Language-specific analyzer ${spec} must be pruned for artifact`);
}
console.log('✓ Artifact classification prunes all language-specific analyzers safely');

// Clean up router telemetry listener
setRoutingFallbackListener(null);

// 3. Test Config Loading Fail-Closed Enforcement on customAnalyzers (N-08)
let configModule;
try {
  configModule = require(configPath);
} catch (err) {
  console.error('[FAIL] Unable to load config module from dist. Run npm run build first.');
  console.error(err);
  process.exit(1);
}

const { resolveConfig } = configModule;

// Verify missing signals throws [INVALID_CUSTOM_ANALYZER]
let missingSignalsThrew = false;
try {
  resolveConfig({
    root: ROOT,
    customAnalyzers: [{ name: 'test-bad-plugin', module: './bad.js', track: 'fast' }],
  });
} catch (err) {
  missingSignalsThrew = true;
  assert(
    err.message.includes(ERR_INVALID_CUSTOM_ANALYZER),
    `Expected ${ERR_INVALID_CUSTOM_ANALYZER}, got: ${err.message}`,
  );
}
assert(
  missingSignalsThrew,
  '[FAIL-CLOSED VIOLATION] customAnalyzers missing signals must throw [INVALID_CUSTOM_ANALYZER]',
);

// Verify missing track throws [INVALID_CUSTOM_ANALYZER]
let missingTrackThrew = false;
try {
  resolveConfig({
    root: ROOT,
    customAnalyzers: [{ name: 'test-bad-plugin', module: './bad.js', signals: ['LITERAL'] }],
  });
} catch (err) {
  missingTrackThrew = true;
  assert(
    err.message.includes(ERR_INVALID_CUSTOM_ANALYZER),
    `Expected ${ERR_INVALID_CUSTOM_ANALYZER}, got: ${err.message}`,
  );
}
assert(
  missingTrackThrew,
  '[FAIL-CLOSED VIOLATION] customAnalyzers missing track must throw [INVALID_CUSTOM_ANALYZER]',
);

// Verify valid customAnalyzers declaration passes resolveConfig
const validResolved = resolveConfig({
  root: ROOT,
  customAnalyzers: [
    { name: 'test-good-plugin', module: './good.js', signals: ['LITERAL'], track: 'fast' },
  ],
});
assert(
  validResolved.customAnalyzers?.length === 1,
  'Valid custom analyzer must be retained in resolved config',
);
console.log('✓ customAnalyzers strictly enforces signals and track declarations (N-08)');

console.log('[PASS] validate-fail-closed passed all checks.');
process.exit(0);
