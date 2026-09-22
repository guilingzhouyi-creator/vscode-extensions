#!/usr/bin/env node
/**
 * Module: Verification Harness — Expert Manifest Contract Guard
 * File Path: scripts/validate-expert-manifest.js
 * Architecture Role: Validates that ExpertManifest is the single source of truth for
 *   all analyzers, conforms to C-01, C-02, C-04, and N-08, and verifies that the
 *   security family strictly forbids 'skip' fallback.
 * Dependencies & Triggers: Run via `npm test` or `node scripts/validate-expert-manifest.js`.
 * Responsibilities: Verify expert manifest integrity, completeness, and security guardrails.
 * Exit Semantics & Design Rationale: Exits 0 on verification pass, 1 on failure.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifestModulePath = path.join(ROOT, 'dist', 'core', 'router', 'expert-manifest');

let manifestModule;
try {
  manifestModule = require(manifestModulePath);
} catch (err) {
  console.error('[FAIL] Unable to load expert-manifest module from dist. Run npm run build first.');
  console.error(err);
  process.exit(1);
}

const { EXPERT_MANIFEST, validateExpertManifest, deriveCategoryMatrix, deriveArchetypeMatrix } =
  manifestModule;

console.log('=== Validating MoE Expert Manifest Integrity (C-01, C-02, C-04, N-08) ===');

assert(Array.isArray(EXPERT_MANIFEST), 'EXPERT_MANIFEST must be an array');
assert(EXPERT_MANIFEST.length >= 21, `Expected >= 21 experts, found ${EXPERT_MANIFEST.length}`);

// 1. Validate manifest integrity constraints
try {
  validateExpertManifest(EXPERT_MANIFEST);
  console.log(`✓ Manifest structural validation passed (${EXPERT_MANIFEST.length} experts)`);
} catch (err) {
  console.error(`[FAIL] validateExpertManifest threw: ${err.message}`);
  process.exit(1);
}

// 2. Validate Security Family Fallback Rule (C-04 & §3-7: Security family forbidden from skip)
for (const expert of EXPERT_MANIFEST) {
  if (expert.isSecurityFamily) {
    assert.notStrictEqual(
      expert.fallback,
      'skip',
      `[SECURITY_VIOLATION] Security expert ${expert.id} must not declare fallback 'skip'`,
    );
    assert(
      expert.fallback === 'escalate-deep' || expert.fallback === 'block',
      `[SECURITY_VIOLATION] Security expert ${expert.id} must declare fallback 'escalate-deep' or 'block'`,
    );
  }
}
console.log('✓ Security family fallback policy verified (no skip allowed)');

// 3. Validate Matrix Generation (C-01: Matrices dynamically generated from manifest)
const categoryMatrix = deriveCategoryMatrix(EXPERT_MANIFEST);
assert(categoryMatrix.LITERAL_ONLY.length > 0, 'Derived LITERAL_ONLY category must not be empty');
assert(categoryMatrix.CONTROL_FLOW.length > 0, 'Derived CONTROL_FLOW category must not be empty');
assert(
  categoryMatrix.INTERFACE_SIGNATURE.length > 0,
  'Derived INTERFACE_SIGNATURE must not be empty',
);
assert(categoryMatrix.IMPORT_EXPORT.length > 0, 'Derived IMPORT_EXPORT must not be empty');
assert(
  categoryMatrix.GENERAL_CODE.length === EXPERT_MANIFEST.length,
  'Derived GENERAL_CODE must include all experts',
);
console.log('✓ Dynamic category matrix derivation verified');

const archetypeMatrix = deriveArchetypeMatrix(EXPERT_MANIFEST);
assert(archetypeMatrix.demo.length > 0, 'Archetype demo must have experts');
assert(archetypeMatrix.web.length > 0, 'Archetype web must have experts');
assert(archetypeMatrix.game.length > 0, 'Archetype game must have experts');
assert(archetypeMatrix.library.length > 0, 'Archetype library must have experts');
console.log('✓ Dynamic archetype matrix derivation verified');

console.log('[PASS] validate-expert-manifest passed all integrity and normative assertions.');
process.exit(0);
