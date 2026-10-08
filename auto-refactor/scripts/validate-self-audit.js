/**
 * Module: Verification Harness — Self-Audit System Self-Audit Baseline
 * File Path: scripts/validate-self-audit.js
 * Architecture Role: Validates the production-grade self-examination runner, confirming
 *   immutable AuditSnapshot sandbox isolation, 8-pillar quality evaluation, technical debt
 *   ledger tiering (Critical/High/Medium/Low), ten-dimensional fidelity, and baseline report
 *   schema integrity.
 * Dependencies & Triggers: Consumes ./run-self-audit; executed in test-parallel runner.
 * Responsibilities: Assert baseline JSON existence, 8-pillar bounds, debt classification,
 *   composite score / code density alignment with new scoring model, and schema parity.
 * Exit Semantics & Design Rationale: Exits 0 on pass, throws AssertionError on failure.
 *   Modular function decomposition (< 10 cyclomatic complexity per function).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const { runSelfAudit, BASELINE_OUTPUT } = require('./run-self-audit');

const EXPECTED_PILLARS = [
  'architecture',
  'maintainability',
  'performance',
  'data',
  'testing',
  'reliability',
  'security',
  'extensibility',
];

const EXPECTED_TEN_DIMENSIONS = [
  'architectureConsistency',
  'semanticPurity',
  'codeSecurity',
  'performanceEfficiency',
  'standardization',
  'modernity',
  'maintainability',
  'commentQuality',
  'duplication',
  'techDebtRisk',
];

const REPORT_REQUIRED_ROOT_KEYS = [
  'snapshotId',
  'timestamp',
  'versions',
  'rulesDigest',
  'configDigest',
  'scope',
  'metrics',
  'eightPillars',
  'tenDimensions',
  'topHotspots',
  'technicalDebtLedger',
  'hierarchicalBreakdown',
  'trajectory',
];

/**
 * Validates canonical report schema invariants.
 *
 * @param {object} report - Parsed report object.
 */
function validateReportSchema(report) {
  assert.ok(report && typeof report === 'object', 'Report must be a non-null object');
  for (const key of REPORT_REQUIRED_ROOT_KEYS) {
    assert.ok(key in report, `Report schema broken: missing required root property '${key}'`);
  }
  assert.ok(Array.isArray(report.topHotspots), 'topHotspots must be an array');
  assert.ok(report.topHotspots.length > 0, 'topHotspots must not be empty');
  assert.ok(
    report.technicalDebtLedger && typeof report.technicalDebtLedger === 'object',
    'technicalDebtLedger must be object',
  );
  assert.ok(
    report.hierarchicalBreakdown && typeof report.hierarchicalBreakdown === 'object',
    'hierarchicalBreakdown must be object',
  );
  assert.ok(
    Array.isArray(report.hierarchicalBreakdown.domains),
    'hierarchicalBreakdown.domains must be array',
  );
  assert.ok(
    report.trajectory && typeof report.trajectory === 'object',
    'trajectory must be object',
  );
}

/**
 * Validates immutable AuditSnapshot quintuple metadata.
 *
 * @param {object} report - Self-audit report.
 */
function validateSnapshotMetadata(report) {
  console.log('3. Validating Immutable Snapshot Metadata...');
  assert.ok(report.snapshotId && report.snapshotId.startsWith('snapshot-'));
  assert.strictEqual(report.versions.engineVersion, '0.4.0');
  assert.strictEqual(report.versions.ruleVersion, '2026.09-v1');
  assert.strictEqual(report.versions.configVersion, 'cfg-v1.0');
  assert.strictEqual(report.versions.languageAdapterVersion, 'adapters-v1.0');
  assert.strictEqual(report.versions.scoringVersion, 'scoring-v1.0');
  assert.strictEqual(typeof report.rulesDigest, 'string');
  assert.strictEqual(report.rulesDigest.length, 64);
  assert.strictEqual(typeof report.configDigest, 'string');
  assert.strictEqual(report.configDigest.length, 64);
  console.log('✔ AuditSnapshot quintuple (E, R, C, L, S) matches immutable sandbox contract.');
}

/**
 * Validates scope and execution performance thresholds.
 *
 * @param {object} report - Self-audit report.
 * @param {number} elapsedSec - Elapsed wall time in seconds.
 */
function validateScopeAndPerformance(report, elapsedSec) {
  console.log('4. Validating Audit Scope & Performance Thresholds...');
  assert.ok(
    report.scope.filesScanned >= 250,
    `Must scan >= 250 files: ${report.scope.filesScanned}`,
  );
  assert.ok(elapsedSec <= 15.0, `Self-audit must complete within 15s: ${elapsedSec}s`);
  console.log(
    `✔ Scanned ${report.scope.filesScanned} files in ${elapsedSec.toFixed(2)}s (<= 15s).`,
  );
}

/**
 * Validates the 8 strategic pillars, composite score (>= 85), and code density (>= 0.85).
 *
 * @param {object} report - Self-audit report.
 */
function validateEightPillarsAndMetrics(report) {
  console.log('5. Validating Eight Strategic Pillars Health Model...');
  assert.ok(report.eightPillars && typeof report.eightPillars.pillars === 'object');

  let weightSum = 0;
  for (const pillar of EXPECTED_PILLARS) {
    const val = report.eightPillars.pillars[pillar];
    assert.ok(
      typeof val === 'number' && !Number.isNaN(val) && val >= 0 && val <= 100,
      `Pillar ${pillar} must be 0..100: ${val}`,
    );
    const weight = report.eightPillars.weights?.[pillar];
    assert.ok(typeof weight === 'number' && weight > 0, `Pillar ${pillar} must have positive weight`);
    weightSum += weight;
  }
  assert.ok(Math.abs(weightSum - 1.0) < 0.001, `Pillar weights sum must be 1.0: ${weightSum}`);

  // Composite health score and code density validations
  assert.ok(
    report.metrics.compositeScore >= 85,
    `Composite score must be >= 85: ${report.metrics.compositeScore}`,
  );
  assert.strictEqual(
    report.eightPillars.compositeScore,
    report.metrics.compositeScore,
    'eightPillars.compositeScore must equal metrics.compositeScore',
  );
  assert.ok(['A+', 'A'].includes(report.metrics.grade));
  assert.ok(
    report.metrics.effectiveCodeDensity >= 0.85 && report.metrics.effectiveCodeDensity <= 1.0,
    `Code density must be in [0.85, 1.0]: ${report.metrics.effectiveCodeDensity}`,
  );
  console.log(
    `✔ Eight-pillar scores valid (Composite: ${report.metrics.compositeScore}, Density: ${(report.metrics.effectiveCodeDensity * 100).toFixed(1)}%).`,
  );
}

/**
 * Validates the ten-dimensional quality vector subsystem integration.
 *
 * @param {object} report - Self-audit report.
 */
function validateTenDimensions(report) {
  console.log('6. Validating Ten-Dimensional Scoring Subsystem Integration...');
  assert.ok(
    report.tenDimensions && typeof report.tenDimensions === 'object',
    'tenDimensions must be object',
  );
  const keys = Object.keys(report.tenDimensions);
  assert.strictEqual(
    keys.length,
    EXPECTED_TEN_DIMENSIONS.length,
    'tenDimensions must contain exactly 10 dimensions',
  );
  for (const dim of EXPECTED_TEN_DIMENSIONS) {
    const score = report.tenDimensions[dim];
    assert.ok(
      typeof score === 'number' && !Number.isNaN(score) && score >= 0 && score <= 100,
      `Dimension '${dim}' must be numeric score in [0, 100], got ${score}`,
    );
  }
  const reactiveDims = EXPECTED_TEN_DIMENSIONS.filter((dim) => report.tenDimensions[dim] < 100.0);
  assert.ok(
    reactiveDims.length >= 4,
    `Ten dimensions must exhibit dynamic reaction (>= 4), got ${reactiveDims.length}`,
  );
  console.log(
    `✔ Ten-dimensional metrics valid (${reactiveDims.length} reactive dimensions: ${reactiveDims.join(', ')}).`,
  );
}

/**
 * Validates technical debt ledger tiering.
 *
 * @param {object} report - Self-audit report.
 */
function validateDebtLedger(report) {
  console.log('7. Validating Technical Debt Ledger Tiering...');
  const tiers = report.metrics.byDebtTier;
  assert.ok(typeof tiers.critical === 'number');
  assert.ok(typeof tiers.high === 'number');
  assert.ok(typeof tiers.medium === 'number');
  assert.ok(typeof tiers.low === 'number');
  assert.strictEqual(
    tiers.critical + tiers.high + tiers.medium + tiers.low,
    report.metrics.totalIssues,
    'Debt tiers sum must match total issues',
  );
  assert.ok(report.topHotspots.length > 0, 'Must produce top hotspots for Self-Refactor input');
  console.log(
    `✔ Debt ledger categorized: Critical=${tiers.critical}, High=${tiers.high}, Med=${tiers.medium}, Low=${tiers.low}.`,
  );
}

/**
 * Validates the baseline report file on disk and schema parity with in-memory report.
 *
 * @param {object} report - In-memory report produced by runner.
 */
function validateBaselineFileOnDisk(report) {
  console.log('2. Validating Baseline Report File on Disk & Schema Parity...');
  assert.ok(fs.existsSync(BASELINE_OUTPUT), 'reports/self-audit-baseline.json must exist');
  const fileContent = fs.readFileSync(BASELINE_OUTPUT, 'utf8');
  const parsed = JSON.parse(fileContent);

  validateReportSchema(parsed);
  assert.strictEqual(parsed.snapshotId, report.snapshotId, 'snapshotId mismatch on disk');
  assert.strictEqual(
    parsed.metrics.compositeScore,
    report.metrics.compositeScore,
    'compositeScore mismatch',
  );
  assert.strictEqual(
    parsed.metrics.effectiveCodeDensity,
    report.metrics.effectiveCodeDensity,
    'effectiveCodeDensity mismatch',
  );
  assert.strictEqual(
    parsed.eightPillars.compositeScore,
    report.eightPillars.compositeScore,
    'eightPillars.compositeScore mismatch',
  );
  assert.strictEqual(
    parsed.metrics.totalIssues,
    report.metrics.totalIssues,
    'totalIssues mismatch',
  );
  for (const pillar of EXPECTED_PILLARS) {
    assert.strictEqual(
      parsed.eightPillars.pillars[pillar],
      report.eightPillars.pillars[pillar],
      `Pillar '${pillar}' mismatch`,
    );
  }
  for (const dim of EXPECTED_TEN_DIMENSIONS) {
    assert.strictEqual(
      parsed.tenDimensions[dim],
      report.tenDimensions[dim],
      `Dimension '${dim}' mismatch`,
    );
  }
  console.log(
    `✔ Baseline report verified on disk (${(fileContent.length / 1024).toFixed(1)} KB) with 100% schema parity.`,
  );
}

async function main() {
  console.log('=== [Self-Audit] Testing System Self-Audit Engine (Reviewer -> Reviewer) ===\n');

  const start = Date.now();

  // 1. Run Self-Audit Engine
  console.log('1. Executing Full Self-Audit via Immutable Sandbox...');
  const report = await runSelfAudit();
  const elapsedSec = (Date.now() - start) / 1000;

  // Schema baseline assertion on in-memory report
  validateReportSchema(report);

  // 2. Validate Baseline Report File Output & Disk Parity
  validateBaselineFileOnDisk(report);

  // 3. Validate Immutable Audit Snapshot Quintuple (E, R, C, L, S)
  validateSnapshotMetadata(report);

  // 4. Validate Scope & Performance
  validateScopeAndPerformance(report, elapsedSec);

  // 5. Validate Eight Strategic Pillars Health Model
  validateEightPillarsAndMetrics(report);

  // 6. Validate Ten-Dimensional Scoring Subsystem Integration
  validateTenDimensions(report);

  // 7. Validate Technical Debt Ledger Tiering
  validateDebtLedger(report);

  console.log('\n================================================================');
  console.log('🎉 ALL Self-Audit SYSTEM SELF-AUDIT TESTS PASSED (7/7)!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Self-Audit verification failed:', err);
  process.exit(1);
});
