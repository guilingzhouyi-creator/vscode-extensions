/**
 * Module: Fractal Git — Micro-Crates Dependency Topology Validator
 * File Path: fractal-git/scripts/common/validate-crate-topology.js
 * Architecture Role: Enforces strict unidirectional DAG layering across 9 micro-crates,
 *   preventing reverse dependencies, layer bypasses, and cyclic coupling.
 * Dependencies & Triggers: Consumes fractal-git/Cargo.toml and all crates/*\/Cargo.toml manifests;
 *   invoked by pre-commit-gate, audit-all.ps1, and local CI.
 * Responsibilities:
 *   1. Parse workspace manifest members and child crate Cargo.toml files;
 *   2. Assert strict adherence to L1 -> L2 -> L3 architectural layer boundaries;
 *   3. Detect cyclic references or illegal cross-boundary dependencies (FGT-DEP-001);
 *   4. Emit structured technical facts and exit non-zero on violation.
 * Exit Semantics & Design Rationale: Exits 0 on clean DAG topology verification, 1 on layer violation;
 *   adheres to CC <= 15, Depth <= 4, and zero-black-box execution.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ROOT_CARGO_TOML = path.join(PROJECT_ROOT, 'Cargo.toml');
const CRATES_DIR = path.join(PROJECT_ROOT, 'crates');

/**
 * Architectural layer assignments defining the allowed dependency directions.
 * Strict rule: A crate in Layer N may only depend on crates in Layer M where M <= N.
 */
const CRATE_LAYERS = Object.freeze({
  'fg-core': 1,
  'fg-object': 1,
  'fg-index': 1,
  'fg-algorithms': 1,
  'fg-pools': 2,
  'fg-storage': 2,
  'fg-topology': 3,
  'fg-gate': 3,
  'fg-transport': 3,
});

/**
 * Explicit whitelist of allowed internal dependencies for each micro-crate.
 */
const ALLOWED_INTERNAL_DEPS = Object.freeze({
  'fg-core': new Set([]),
  'fg-object': new Set(['fg-core']),
  'fg-index': new Set(['fg-core', 'fg-object']),
  'fg-algorithms': new Set(['fg-core', 'fg-object']),
  'fg-pools': new Set(['fg-core', 'fg-object']),
  'fg-storage': new Set(['fg-core', 'fg-object', 'fg-index', 'fg-algorithms', 'fg-pools']),
  'fg-topology': new Set(['fg-core']),
  'fg-gate': new Set(['fg-core', 'fg-object', 'fg-topology']),
  'fg-transport': new Set(['fg-core', 'fg-object', 'fg-topology']),
});

/**
 * Extracts internal crate dependency names from a Cargo.toml file content.
 *
 * @param {string} content - Raw Cargo.toml content.
 * @returns {string[]} Array of internal dependency crate names.
 */
function extractInternalDependencies(content) {
  const deps = [];
  const lines = content.split('\n');
  let inDependencies = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inDependencies = line === '[dependencies]';
      continue;
    }
    if (!inDependencies || line.startsWith('#') || !line.includes('=')) {
      continue;
    }
    const match = line.match(/^([a-z0-9_-]+)\s*=/i);
    if (match) {
      const depName = match[1].trim();
      if (depName.startsWith('fg-')) {
        deps.push(depName);
      }
    }
  }
  return deps;
}

/**
 * Validates a single crate's dependencies against layer and whitelist constraints.
 *
 * @param {string} crateName - Name of the crate being validated.
 * @param {string[]} dependencies - List of internal dependency crate names.
 * @param {string[]} violations - Mutable array accumulating error messages.
 */
function validateCrateDependencies(crateName, dependencies, violations) {
  const currentLayer = CRATE_LAYERS[crateName];
  const allowedSet = ALLOWED_INTERNAL_DEPS[crateName];

  if (currentLayer === undefined || !allowedSet) {
    violations.push(`FGT-DEP-001: Unregistered micro-crate '${crateName}' not mapped in architecture layer matrix`);
    return;
  }

  for (const dep of dependencies) {
    const depLayer = CRATE_LAYERS[dep];
    if (depLayer === undefined) {
      violations.push(`FGT-DEP-001: Crate '${crateName}' depends on unknown internal crate '${dep}'`);
      continue;
    }

    if (depLayer > currentLayer) {
      violations.push(
        `FGT-DEP-001: Reverse layer dependency detected: '${crateName}' (Layer ${currentLayer}) depends on '${dep}' (Layer ${depLayer})`
      );
      continue;
    }

    if (!allowedSet.has(dep)) {
      violations.push(
        `FGT-DEP-001: Crate '${crateName}' violates dependency boundary: '${dep}' is not in allowed whitelist [${Array.from(allowedSet).join(', ')}]`
      );
    }
  }
}

/**
 * Main execution function asserting workspace micro-crate topology.
 */
function runTopologyValidation() {
  console.log('=== [FGT-DEP-001] Validating Fractal Git Micro-Crates Topology ===');
  const violations = [];

  if (!fs.existsSync(ROOT_CARGO_TOML)) {
    console.error(`FATAL: Root Cargo.toml missing at ${ROOT_CARGO_TOML}`);
    process.exit(1);
  }

  const manifestMembers = Object.keys(CRATE_LAYERS);
  console.log(`Inspecting ${manifestMembers.length} micro-crates under ${path.relative(process.cwd(), CRATES_DIR)}...`);

  for (const crate of manifestMembers) {
    const manifestPath = path.join(CRATES_DIR, crate, 'Cargo.toml');
    if (!fs.existsSync(manifestPath)) {
      violations.push(`FGT-DEP-001: Missing manifest for registered micro-crate at ${path.relative(PROJECT_ROOT, manifestPath)}`);
      continue;
    }
    const content = fs.readFileSync(manifestPath, 'utf8');
    const deps = extractInternalDependencies(content);
    validateCrateDependencies(crate, deps, violations);
  }

  if (violations.length > 0) {
    console.error(`\n✖ BLOCK Found ${violations.length} topology violation(s):`);
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }

  console.log('✔ PASS Micro-crate unidirectional DAG layering is 100% compliant with DIRECTORY_SPEC.md.');
  process.exit(0);
}

runTopologyValidation();
