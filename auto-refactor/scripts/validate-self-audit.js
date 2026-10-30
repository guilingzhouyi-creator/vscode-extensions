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
const os = require('os');
const path = require('path');
const { runSelfAudit, BASELINE_OUTPUT, BASELINE_AAS_OUTPUT } = require('./run-self-audit');
const { evaluateElasticDebtBudget } = require('../dist/api');

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
 * @param report - Parsed report object.
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
 * @param report - Self-audit report.
 */
function validateSnapshotMetadata(report) {
  console.log('4. Validating Immutable Snapshot Metadata...');
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
 * @param report - Self-audit report.
 * @param elapsedSec - Elapsed wall time in seconds.
 */
function validateScopeAndPerformance(report, elapsedSec) {
  console.log('5. Validating Audit Scope & Performance Thresholds...');
  assert.ok(
    report.scope.filesScanned >= 250,
    `Must scan >= 250 files: ${report.scope.filesScanned}`,
  );
  assert.ok(elapsedSec <= 30.0, `Self-audit must complete within 30s: ${elapsedSec}s`);
  console.log(
    `✔ Scanned ${report.scope.filesScanned} files in ${elapsedSec.toFixed(2)}s (<= 30s).`,
  );
}

/**
 * Validates the 8 strategic pillars, composite score (>= 85), and code density (>= 0.85).
 *
 * @param report - Self-audit report.
 */
function validateEightPillarsAndMetrics(report) {
  console.log('6. Validating Eight Strategic Pillars Health Model...');
  assert.ok(report.eightPillars && typeof report.eightPillars.pillars === 'object');

  let weightSum = 0;
  for (const pillar of EXPECTED_PILLARS) {
    const val = report.eightPillars.pillars[pillar];
    assert.ok(
      typeof val === 'number' && !Number.isNaN(val) && val >= 0 && val <= 100,
      `Pillar ${pillar} must be 0..100: ${val}`,
    );
    const weight = report.eightPillars.weights?.[pillar];
    assert.ok(
      typeof weight === 'number' && weight > 0,
      `Pillar ${pillar} must have positive weight`,
    );
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
  if (report.metrics.densityTensorSummary) {
    const dts = report.metrics.densityTensorSummary;
    assert.ok(typeof dts.compositeDensity === 'number', 'compositeDensity must be number');
    assert.ok(typeof dts.averageTspr === 'number', 'averageTspr must be number');
    assert.ok(typeof dts.averagePor === 'number', 'averagePor must be number');
    assert.ok(typeof dts.averageColumnDensity === 'number', 'averageColumnDensity must be number');
    if (typeof dts.averageSpatialDensity === 'number') {
      assert.ok(
        dts.averageSpatialDensity >= 0 && dts.averageSpatialDensity <= 1,
        'averageSpatialDensity in [0, 1]',
      );
    }
  }
  console.log(
    `✔ Eight-pillar scores valid (Composite: ${report.metrics.compositeScore}, Density: ${(report.metrics.effectiveCodeDensity * 100).toFixed(1)}%).`,
  );
}

/**
 * Validates the ten-dimensional quality vector subsystem integration.
 *
 * @param report - Self-audit report.
 */
function validateTenDimensions(report) {
  console.log('7. Validating Ten-Dimensional Scoring Subsystem Integration...');
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
 * @param report - Self-audit report.
 */
function validateDebtLedger(report) {
  console.log('8. Validating Technical Debt Ledger Tiering...');
  const tiers = report.metrics.byDebtTier;
  assert.ok(typeof tiers.critical === 'number');
  assert.ok(typeof tiers.high === 'number');
  assert.ok(typeof tiers.medium === 'number');
  assert.ok(typeof tiers.low === 'number');

  const totalFiles = report.scope ? report.scope.filesScanned : undefined;
  const compositeScore = report.metrics ? report.metrics.compositeScore : undefined;

  let baselineDebt;
  if (fs.existsSync(BASELINE_OUTPUT)) {
    try {
      const prev = JSON.parse(fs.readFileSync(BASELINE_OUTPUT, 'utf8'));
      baselineDebt = prev?.metrics?.byDebtTier;
    } catch {}
  }

  const evaluation = evaluateElasticDebtBudget(tiers, {
    totalFiles,
    compositeScore,
    baselineDebt,
    cumulative: !baselineDebt,
  });

  assert.ok(
    evaluation.isWithinBudget,
    `Technical debt must remain within dynamic elastic budget: ${evaluation.violations.map((v) => v.message).join('; ')}`,
  );
  assert.ok(
    evaluation.verdict === 'PERMITTED_ZERO_DEBT' || evaluation.verdict === 'PERMITTED_ELASTIC',
    `Expected permitted debt verdict, got: ${evaluation.verdict}`,
  );
  assert.ok(
    tiers.critical <= evaluation.dynamicLimits.critical,
    `Critical debt (${tiers.critical}) must not exceed dynamic limit (${evaluation.dynamicLimits.critical})`,
  );
  assert.ok(
    tiers.high <= evaluation.dynamicLimits.high,
    `High debt (${tiers.high}) must not exceed dynamic limit (${evaluation.dynamicLimits.high})`,
  );

  assert.strictEqual(
    tiers.critical + tiers.high + tiers.medium + tiers.low,
    report.metrics.totalIssues,
    'Debt tiers sum must match total issues',
  );
  assert.ok(report.topHotspots.length > 0, 'Must produce top hotspots for Self-Refactor input');
  console.log(
    `✔ Debt ledger categorized (elastic budget active: verdict=${evaluation.verdict}): Critical=${tiers.critical}/${evaluation.dynamicLimits.critical}, High=${tiers.high}/${evaluation.dynamicLimits.high}, Med=${tiers.medium}, Low=${tiers.low}.`,
  );
}

/**
 * Validates the baseline report file on disk and schema parity with in-memory report.
 *
 * @param report - In-memory report produced by runner.
 * @param baselinePath - File path to the persisted baseline JSON report.
 */
function validateBaselineFileOnDisk(report, baselinePath = BASELINE_OUTPUT) {
  console.log('2. Validating Baseline Report File on Disk & Schema Parity...');
  assert.ok(fs.existsSync(baselinePath), `${baselinePath} must exist`);
  const fileContent = fs.readFileSync(baselinePath, 'utf8');
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

/**
 * Validate that the producer properly emits the Agent Audit Schema (AAS v1.0) report artifact.
 *
 * @param report - In-memory report produced by the runner.
 * @param aasPath - File path to the persisted AAS report artifact.
 */
function validateAasReportOnDisk(report, aasPath = BASELINE_AAS_OUTPUT) {
  console.log('3. Validating AAS v1.0 Agent-Native Report Emission...');
  assert.ok(
    fs.existsSync(aasPath),
    `${aasPath} must be emitted by the producer`,
  );
  const aasDoc = JSON.parse(fs.readFileSync(aasPath, 'utf8'));
  assert.strictEqual(aasDoc.schema, 'aas-v1', 'AAS document must declare aas-v1 schema');
  assert.strictEqual(aasDoc.tool, 'auto-refactor');
  assert.strictEqual(aasDoc.health.score, report.metrics.compositeScore);
  assert.strictEqual(aasDoc.health.grade, report.metrics.grade);
  assert.strictEqual(aasDoc.health.counts.files, report.scope.filesScanned);
  assert.ok(typeof aasDoc.files === 'object' && aasDoc.files !== null);
  assert.ok(typeof aasDoc.topology === 'object' && aasDoc.topology !== null);
  console.log(`✔ AAS v1.0 Agent-Native report verified (verdict ${aasDoc.verdict}).`);
}

async function main() {
  console.log('=== [Self-Audit] Testing System Self-Audit Engine (Reviewer -> Reviewer) ===\n');

  const start = Date.now();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-audit-test-'));
  const tempBaseline = path.join(tempDir, 'self-audit-baseline.json');
  const tempAas = path.join(tempDir, 'self-audit-baseline.aas.json');
  const tempTrajectory = path.join(tempDir, 'trajectory');

  try {
    // 1. Run Self-Audit Engine targeting isolated sandbox output
    console.log('1. Executing Full Self-Audit via Immutable Sandbox (Isolated Output)...');
    const report = await runSelfAudit({
      baselineOutput: tempBaseline,
      aasOutput: tempAas,
      trajectoryDir: tempTrajectory,
      persist: true,
    });
    const elapsedSec = (Date.now() - start) / 1000;

    // Schema baseline assertion on in-memory report
    validateReportSchema(report);

    // 2. Validate Baseline Report File Output & Disk Parity
    validateBaselineFileOnDisk(report, tempBaseline);

    // 3. Validate the AAS v1.0 Agent-Native report
    validateAasReportOnDisk(report, tempAas);

    // 4. Validate Immutable Audit Snapshot Quintuple (E, R, C, L, S)
    validateSnapshotMetadata(report);

    // 5. Validate Scope & Performance
    validateScopeAndPerformance(report, elapsedSec);

    // 6. Validate Eight Strategic Pillars Health Model
    validateEightPillarsAndMetrics(report);

    // 7. Validate Ten-Dimensional Scoring Subsystem Integration
    validateTenDimensions(report);

    // 8. Validate Technical Debt Ledger Tiering
    validateDebtLedger(report);

    console.log('\n================================================================');
    console.log('🎉 ALL Self-Audit SYSTEM SELF-AUDIT TESTS PASSED (8/8)!');
    console.log('================================================================');
  } finally {
    if (tempDir && tempDir.includes('self-audit-test-')) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error('Self-Audit verification failed:', err);
  process.exit(1);
});
