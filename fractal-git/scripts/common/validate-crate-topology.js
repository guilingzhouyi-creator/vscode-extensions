/**
 * Module: Fractal Git — Subsystems Dependency Topology Validator
 * File Path: fractal-git/scripts/common/validate-crate-topology.js
 * Architecture Role: Enforces strict unidirectional DAG layering across 10 kernel subsystems,
 *   preventing reverse dependencies, layer bypasses, and cyclic coupling.
 * Dependencies & Triggers: Consumes fractal-git/Cargo.toml and all crates/*\/Cargo.toml manifests;
 *   invoked by pre-commit-gate, audit-all.ps1, and local CI.
 * Responsibilities:
 *   1. Parse workspace manifest members and child crate Cargo.toml files;
 *   2. Assert strict adherence to L1 -> L2 -> L3 architectural layer boundaries;
 *   3. Detect cyclic references or illegal cross-boundary dependencies (FGT-DEP-001);
 *   4. Emit structured technical facts and exit non-zero on violation.
 * Exit Semantics & Design Rationale: Exits 0 on clean DAG verification, 1 on layer breach;
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
  'fg-native': 2,
  'fg-storage': 2,
  'fg-topology': 3,
  'fg-gate': 3,
  'fg-transport': 3,
});

/**
 * Explicit whitelist of allowed internal dependencies for each kernel subsystem.
 */
const ALLOWED_INTERNAL_DEPS = Object.freeze({
  'fg-core': new Set([]),
  'fg-object': new Set(['fg-core']),
  'fg-index': new Set(['fg-core', 'fg-object']),
  'fg-algorithms': new Set(['fg-core', 'fg-object']),
  'fg-pools': new Set(['fg-core', 'fg-object']),
  'fg-native': new Set(['fg-core']),
  'fg-storage': new Set(['fg-core', 'fg-object', 'fg-index', 'fg-algorithms', 'fg-pools', 'fg-native']),
  'fg-topology': new Set(['fg-core', 'fg-native']),
  'fg-gate': new Set(['fg-core', 'fg-object', 'fg-topology']),
  'fg-transport': new Set(['fg-core', 'fg-object', 'fg-topology']),
});

/**
 * Reads `[workspace].members` from the root manifest and reduces each entry to its crate directory
 * name, so member discovery follows the manifest instead of the architecture matrix.
 *
 * @param {string} content - Raw root Cargo.toml content.
 * @returns {string[]} Crate directory names, in manifest order.
 */
function extractWorkspaceMembers(content) {
  const members = [];
  const lines = content.split('\n');
  let inMembersArray = false;

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (!inMembersArray) {
      if (/^members\s*=\s*\[/.test(line)) {
        inMembersArray = true;
      } else {
        continue;
      }
    }
    const quoted = line.match(/"([^"]+)"/g) || [];
    for (const entry of quoted) {
      const relativePath = entry.replace(/"/g, '');
      const segments = relativePath.split('/').filter(Boolean);
      if (segments.length > 0) {
        members.push(segments[segments.length - 1]);
      }
    }
    if (line.includes(']')) {
      break;
    }
  }
  return members;
}

/**
 * Extracts internal crate dependency names from a Cargo.toml file content.
 *
 * All three dependency tables are scanned. A crate that reaches a forbidden layer only through a
 * dev- or build-dependency is still a crate that reaches it, and those tables used to be invisible
 * here: a boundary violation could be introduced by moving an import into a test or a build script
 * without any gate noticing.
 *
 * @param {string} content - Raw Cargo.toml content.
 * @returns {string[]} Array of internal dependency crate names.
 */
function extractInternalDependencies(content) {
  const deps = [];
  const lines = content.split('\n');
  const DEPENDENCY_TABLES = new Set(['[dependencies]', '[dev-dependencies]', '[build-dependencies]']);
  let inDependencies = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inDependencies = DEPENDENCY_TABLES.has(line);
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
    violations.push(`FGT-DEP-001: Unregistered kernel subsystem '${crateName}' not mapped in architecture layer matrix`);
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
 * Main execution function asserting workspace kernel subsystem topology.
 */
function runTopologyValidation() {
  console.log('=== [FGT-DEP-001] Validating Fractal Git Kernel Subsystems Topology ===');
  const violations = [];

  if (!fs.existsSync(ROOT_CARGO_TOML)) {
    console.error(`FATAL: Root Cargo.toml missing at ${ROOT_CARGO_TOML}`);
    process.exit(1);
  }

  // The member list is read from the workspace manifest rather than from the architecture matrix.
  // Deriving it from the matrix made the two sides agree by construction: a crate added to the
  // workspace but never registered in `CRATE_LAYERS` was simply never inspected, and the gate
  // reported full compliance for a crate it had not looked at.
  const rootManifest = fs.readFileSync(ROOT_CARGO_TOML, 'utf8');
  const manifestMembers = extractWorkspaceMembers(rootManifest);
  if (manifestMembers.length === 0) {
    console.error('FGT-DEP-001: Workspace manifest declares no members; topology cannot be verified');
    process.exit(1);
  }
  console.log(`Inspecting ${manifestMembers.length} kernel subsystems under ${path.relative(process.cwd(), CRATES_DIR)}...`);

  for (const crate of manifestMembers) {
    const manifestPath = path.join(CRATES_DIR, crate, 'Cargo.toml');
    if (!fs.existsSync(manifestPath)) {
      violations.push(`FGT-DEP-001: Missing manifest for registered subsystem at ${path.relative(PROJECT_ROOT, manifestPath)}`);
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

  console.log('✔  Subsystems unidirectional DAG layering is 100% compliant with DIRECTORY_SPEC.md.');
  process.exit(0);
}

runTopologyValidation();
