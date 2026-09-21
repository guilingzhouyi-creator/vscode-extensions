/**
 * Module: Verification Harness — Phase 9 System Self-Audit Baseline
 * File Path: scripts/validate-phase9-self-audit.js
 * Architecture Role: Validates the production-grade self-examination runner, confirming
 *   immutable AuditSnapshot sandbox isolation, 8-pillar quality evaluation, technical debt
 *   ledger tiering (Critical/High/Medium/Low), and baseline report schema integrity.
 * Dependencies & Triggers: Consumes ./run-self-audit; executed in test-parallel runner.
 * Responsibilities: Assert baseline JSON existence, 8-pillar bounds, debt classification,
 *   and self-audit performance threshold (<= 8s).
 * Exit Semantics & Design Rationale: Exits 0 on pass, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const { runSelfAudit, BASELINE_OUTPUT } = require('./run-self-audit');

async function main() {
  console.log('=== [Phase 9] Testing System Self-Audit Engine (Reviewer -> Reviewer) ===\n');

  const start = Date.now();

  // 1. Run Self-Audit Engine
  console.log('1. Executing Full Self-Audit via Immutable Sandbox...');
  const report = await runSelfAudit();
  const elapsedSec = (Date.now() - start) / 1000;

  // 2. Validate Baseline Report File Output
  console.log('2. Validating Baseline Report File on Disk...');
  assert.ok(fs.existsSync(BASELINE_OUTPUT), 'reports/self-audit-baseline.json must exist');
  const fileContent = fs.readFileSync(BASELINE_OUTPUT, 'utf8');
  const parsed = JSON.parse(fileContent);
  assert.strictEqual(parsed.snapshotId, report.snapshotId);
  console.log(`✔ Baseline report verified on disk (${(fileContent.length / 1024).toFixed(1)} KB).`);

  // 3. Validate Immutable Audit Snapshot Quintuple (E, R, C, L, S)
  console.log('3. Validating Immutable Snapshot Metadata...');
  assert.ok(report.snapshotId && report.snapshotId.startsWith('snapshot-'));
  assert.strictEqual(report.versions.engineVersion, '0.4.0');
  assert.strictEqual(report.versions.ruleVersion, '2026.09-v1');
  assert.strictEqual(report.versions.configVersion, 'cfg-v1.0');
  assert.strictEqual(report.versions.languageAdapterVersion, 'adapters-v1.0');
  assert.strictEqual(report.versions.scoringVersion, 'scoring-v1.0');
  assert.strictEqual(typeof report.rulesDigest, 'string');
  assert.strictEqual(report.rulesDigest.length, 64);
  console.log('✔ AuditSnapshot quintuple (E, R, C, L, S) matches immutable sandbox contract.');

  // 4. Validate Scope & Performance
  console.log('4. Validating Audit Scope & Performance Thresholds...');
  assert.ok(
    report.scope.filesScanned >= 250,
    `Must scan >= 250 files: ${report.scope.filesScanned}`,
  );
  assert.ok(elapsedSec <= 8.0, `Self-audit must complete within 8s: ${elapsedSec}s`);
  console.log(`✔ Scanned ${report.scope.filesScanned} files in ${elapsedSec.toFixed(2)}s (<= 8s).`);

  // 5. Validate Eight Strategic Pillars
  console.log('5. Validating Eight Strategic Pillars Health Model...');
  const expectedPillars = [
    'architecture',
    'maintainability',
    'performance',
    'data',
    'testing',
    'reliability',
    'security',
    'extensibility',
  ];
  for (const pillar of expectedPillars) {
    const val = report.eightPillars.pillars[pillar];
    assert.ok(
      typeof val === 'number' && val >= 0 && val <= 100,
      `Pillar ${pillar} must be 0..100: ${val}`,
    );
  }
  assert.ok(
    report.metrics.compositeScore >= 85,
    `Composite score must be >= 85: ${report.metrics.compositeScore}`,
  );
  assert.ok(['A+', 'A'].includes(report.metrics.grade));
  assert.ok(
    report.metrics.effectiveCodeDensity >= 0.85,
    `Code density must be >= 85%: ${report.metrics.effectiveCodeDensity}`,
  );
  console.log(
    `✔ Eight-pillar scores valid (Composite: ${report.metrics.compositeScore}, Density: ${(report.metrics.effectiveCodeDensity * 100).toFixed(1)}%).`,
  );

  // 6. Validate Technical Debt Ledger
  console.log('6. Validating Technical Debt Ledger Tiering...');
  const tiers = report.metrics.byDebtTier;
  assert.ok(typeof tiers.critical === 'number');
  assert.ok(typeof tiers.high === 'number');
  assert.ok(typeof tiers.medium === 'number');
  assert.ok(typeof tiers.low === 'number');
  assert.ok(tiers.critical + tiers.high + tiers.medium + tiers.low === report.metrics.totalIssues);
  assert.ok(report.topHotspots.length > 0, 'Must produce top hotspots for Phase 10 input');
  console.log(
    `✔ Debt ledger categorized: Critical=${tiers.critical}, High=${tiers.high}, Med=${tiers.medium}, Low=${tiers.low}.`,
  );

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 9 SYSTEM SELF-AUDIT TESTS PASSED (6/6)!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Phase 9 verification failed:', err);
  process.exit(1);
});
