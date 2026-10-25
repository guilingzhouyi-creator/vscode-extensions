/**
 * Module: Validation — Agent Audit Schema (AAS v1.0) Sidecar Coverage Guard
 * File Path: scripts/validate-sidecar-coverage.js
 * Architecture Role: Enforces that every persisted report artifact in reports/ has an
 *   Agent-Native AAS v1.0 sidecar (*.aas.json) beside it. The legacy CAS v3 (*.cas.json)
 *   format is completely retired and prohibited.
 * Dependencies & Triggers: Consumes ../dist/api and the reports directory; executed by the
 *   parallel suite runner (npm test).
 * Responsibilities:
 *   1. Classify every *.json in reports/ as a report artifact or a non-report ledger.
 *   2. Assert each report artifact has a sibling *.aas.json declaring schema "aas-v1".
 *   3. Enforce zero legacy *.cas.json sidecars exist on disk.
 *   4. Report non-report files explicitly for total audit traceability.
 * Exit Semantics & Design Rationale: Exits non-zero when any report lacks its AAS v1.0 sidecar
 *   or when any legacy CAS artifact is detected.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const JSON_SUFFIX = '.json';
const AAS_SUFFIX = '.aas.json';
const AAS_SCHEMA = 'aas-v1';
const CAS_SUFFIX = '.cas.json';

/**
 * Enumerate source artifacts in the reports directory, excluding derived projections.
 *
 * @returns Absolute paths of candidate source artifacts.
 */
function listSourceArtifacts() {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  return fs
    .readdirSync(REPORTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(JSON_SUFFIX))
    .filter((entry) => !entry.name.endsWith(AAS_SUFFIX) && !entry.name.endsWith(CAS_SUFFIX))
    .map((entry) => path.join(REPORTS_DIR, entry.name))
    .sort();
}

/**
 * Enumerate any lingering legacy CAS v3 artifacts.
 *
 * @returns Absolute paths of legacy .cas.json files.
 */
function listLegacyCasArtifacts() {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  return fs
    .readdirSync(REPORTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(CAS_SUFFIX))
    .map((entry) => path.join(REPORTS_DIR, entry.name))
    .sort();
}

/**
 * Decide whether an artifact is a report the adapters can normalise.
 *
 * @param sourcePath - Candidate artifact.
 * @returns True when the migration layer recognises the shape.
 */
function isReportArtifact(sourcePath) {
  try {
    const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    if (!payload || typeof payload !== 'object') return false;
    return Boolean(
      payload.schema === 'aas-v1' ||
      payload.summary ||
      payload.baselineMetrics ||
      Array.isArray(payload.issues) ||
      payload.cai !== undefined ||
      payload.health !== undefined
    );
  } catch {
    return false;
  }
}

/**
 * Assert one report artifact carries a valid AAS v1.0 projection.
 *
 * @param sourcePath - Report artifact whose AAS projection is required.
 */
function assertAasSidecarFor(sourcePath) {
  const name = path.basename(sourcePath);
  const aasPath = sourcePath.slice(0, -JSON_SUFFIX.length) + AAS_SUFFIX;

  assert.ok(
    fs.existsSync(aasPath),
    `${name} is a recognizable report artifact but is missing its Agent-Native (${AAS_SUFFIX}) projection`,
  );

  const aas = JSON.parse(fs.readFileSync(aasPath, 'utf8'));
  const sidecarName = path.basename(aasPath);
  assert.strictEqual(
    aas.schema,
    AAS_SCHEMA,
    `${sidecarName} must declare the ${AAS_SCHEMA} discriminator`,
  );
  assert.ok(
    typeof aas.health === 'object' && aas.health !== null,
    `${sidecarName} must carry an executive health block`,
  );
  assert.ok(
    Number.isFinite(aas.health.score),
    `${sidecarName} must carry a valid numeric health score`,
  );
}

function main() {
  console.log(
    '=== [AAS Sidecar Coverage] Guarding Agent-Native AAS v1.0 Precondition (Zero Legacy CAS) ===\n',
  );

  // 1. Assert zero legacy *.cas.json files
  const legacyCas = listLegacyCasArtifacts();
  assert.strictEqual(
    legacyCas.length,
    0,
    `Legacy CAS v3 artifacts detected on disk: ${legacyCas.map((f) => path.basename(f)).join(', ')}. All legacy CAS files must be retired.`,
  );

  // 2. Enumerate source artifacts
  const artifacts = listSourceArtifacts();
  assert.ok(
    artifacts.length > 0,
    'The reports directory must hold at least one artifact; an empty directory makes this guard vacuous',
  );

  const reports = [];
  const other = [];
  for (const artifact of artifacts) {
    (isReportArtifact(artifact) ? reports : other).push(artifact);
  }

  assert.ok(
    reports.length > 0,
    'At least one recognizable report must exist in reports/',
  );

  for (const report of reports) {
    assertAasSidecarFor(report);
  }

  for (const ledger of other) {
    console.log(`  · ${path.basename(ledger)}: non-report artifact, no sidecar expected`);
  }
  console.log(
    `\n✔ ${reports.length} report artifact(s) fully projected into AAS v1.0 (*.aas.json), ${other.length} non-report(s) exempt`,
  );
  console.log('\n================================================================');
  console.log('🎉 ALL AAS v1.0 SIDECAR COVERAGE CHECKS PASSED (ZERO LEGACY CAS)!');
  console.log('================================================================');
}

main();
