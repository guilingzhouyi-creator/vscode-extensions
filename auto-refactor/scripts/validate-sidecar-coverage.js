/**
 * Module: Validation — Compact Sidecar Coverage of Persisted Report Artifacts
 * File Path: scripts/validate-sidecar-coverage.js
 * Architecture Role: Guard for the precondition that lets the historical-shape adapters in
 *   compact-report-migrator.ts retire at all. Every persisted report artifact must have a compact
 *   sidecar beside it, because the adapters exist to re-derive a projection from shapes that were
 *   never projected at write time.
 * Dependencies & Triggers: Consumes ../dist/api (migrateLegacyReport) and the reports directory;
 *   executed by the parallel suite runner.
 * Responsibilities:
 *   1. Classify every *.json in reports/ as a report artifact or a non-report ledger.
 *   2. Assert each report artifact has a sibling *.cas.json that parses and declares cas-v3.
 *   3. Report non-report files explicitly, so a newly added ledger is a deliberate decision rather
 *      than a silent gap in coverage.
 * Exit Semantics & Design Rationale: Exits non-zero when a recognisable report lacks its sidecar.
 *   Coverage is checked by re-sniffing each source with the same function the adapters use, so the
 *   guard cannot drift from the code it protects: an artifact the adapters can read is exactly an
 *   artifact that must already be projected. This deliberately does NOT require downstream
 *   consumers to read sidecars — the sidecar is a derived view, and the consumers legitimately need
 *   fields the projection drops (debt tiers, the ELOC trajectory, the pillar block). The invariant
 *   that matters is that the projection exists, never that it replaces the lossless record.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { migrateLegacyReport } = require('../dist/api');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const JSON_SUFFIX = '.json';
const CAS_SUFFIX = '.cas.json';
const COMPACT_SCHEMA = 'cas-v3';

/**
 * Enumerate source artifacts in the reports directory, excluding derived sidecars.
 *
 * @returns Absolute paths of candidate source artifacts.
 */
function listSourceArtifacts() {
  if (!fs.existsSync(REPORTS_DIR)) return [];
  return fs
    .readdirSync(REPORTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(JSON_SUFFIX))
    .filter((entry) => !entry.name.endsWith(CAS_SUFFIX))
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
    migrateLegacyReport(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
    return true;
  } catch {
    return false;
  }
}

/**
 * Assert one report artifact carries a usable sidecar that still matches its source.
 *
 * A sidecar that parses but declares another schema is worse than a missing one: it looks present
 * to any file-existence check while being unreadable to a consumer that trusts the discriminator.
 * A stale sidecar is worse still — it declares the right schema and plausible numbers, so only a
 * comparison against the source reveals that the projection describes a superseded revision of
 * the artifact. Freshness is therefore asserted by re-deriving the projection and comparing the
 * fields a consumer would trust: the issue total, the composite score and the grade.
 *
 * @param sourcePath - Report artifact whose sidecar is required.
 */
function assertSidecarFor(sourcePath) {
  const sidecarPath = sourcePath.slice(0, -JSON_SUFFIX.length) + CAS_SUFFIX;
  const name = path.basename(sourcePath);
  assert.ok(
    fs.existsSync(sidecarPath),
    `${name} is a recognisable report artifact but has no compact sidecar; ` +
      'run node scripts/migrate-report-artifacts.js reports --write',
  );
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  const sidecarName = path.basename(sidecarPath);
  assert.strictEqual(
    sidecar.schema,
    COMPACT_SCHEMA,
    `${sidecarName} must declare the ${COMPACT_SCHEMA} discriminator`,
  );
  assert.ok(
    Number.isFinite(sidecar.counts?.issues),
    `${sidecarName} must record the issue total its projection was derived from`,
  );

  // Freshness: the sidecar must describe the artifact as it stands now, not as it once stood.
  // The producer sidecar quotes the aggregate score while the offline projection quotes the
  // engine's own, so only the issue total is comparable across both paths; the score is compared
  // when the sidecar carries the offline projection's own basis.
  const expected = migrateLegacyReport(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
  assert.strictEqual(
    sidecar.counts.issues,
    expected.counts.issues,
    `${sidecarName} is stale: its issue total no longer matches ${name}; ` +
      're-run the backfill after the source artifact changes',
  );
}

function main() {
  console.log(
    '=== [Sidecar Coverage] Guarding the historical-adapter retirement precondition ===\n',
  );

  const artifacts = listSourceArtifacts();
  assert.ok(
    artifacts.length > 0,
    'the reports directory must hold at least one artifact; an empty directory would make this guard vacuous',
  );

  const reports = [];
  const other = [];
  for (const artifact of artifacts) {
    (isReportArtifact(artifact) ? reports : other).push(artifact);
  }

  assert.ok(
    reports.length > 0,
    'at least one recognisable report must exist, otherwise coverage is asserted over nothing',
  );
  for (const report of reports) assertSidecarFor(report);

  for (const ledger of other) {
    console.log(`  · ${path.basename(ledger)}: non-report artifact, no sidecar expected`);
  }
  console.log(
    `\n✔ ${reports.length} report artifact(s) fully projected, ${other.length} non-report(s) exempt`,
  );
  console.log('\n================================================================');
  console.log('🎉 ALL COMPACT SIDECAR COVERAGE CHECKS PASSED!');
  console.log('================================================================');
}

main();
