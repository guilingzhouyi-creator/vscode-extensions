/**
 * Module: Verification Harness — Baseline Freeze Baseline Freeze & AuditSnapshot Verification
 * File Path: scripts/validate-baseline-freeze.js
 * Architecture Role: Validates the immutable AuditSnapshot (E, R, C, L, S) quintuple,
 *   freezes the v0.3.0 baseline manifest to reports/baseline-v0.3.0.json, and asserts
 *   that the sandbox snapshot matches runtime rules and configuration integrity.
 * Dependencies & Triggers: Consumes ../dist/api and node:assert/path/fs; invoked by npm test
 *   as part of the Baseline Freeze bootstrap baseline verification.
 * Responsibilities: Assert snapshot structure, verify rules digest reproducibility, test
 *   filesystem freeze and reload, and confirm baseline metrics consistency.
 * Exit Semantics & Design Rationale: Exits 0 on full verification pass; throws AssertionError
 *   and exits 1 on any discrepancy, guaranteeing a fail-closed baseline lock.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const {
  createAuditSnapshot,
  verifyAuditSnapshot,
  freezeBaselineToFile,
  loadFrozenBaseline,
  CURRENT_ENGINE_VERSION,
  CURRENT_RULE_VERSION,
  CURRENT_CONFIG_VERSION,
  CURRENT_ADAPTER_VERSION,
  CURRENT_SCORING_VERSION,
  RULE_REGISTRY,
} = require('../dist/api');

async function main() {
  console.log('=== [Baseline Freeze] Testing AuditSnapshot (E, R, C, L, S) & Sandbox Freeze ===\n');

  // 1. Create runtime snapshot
  const snapshot = createAuditSnapshot();

  assert(snapshot.snapshotId.startsWith('snapshot-v'), 'Snapshot ID must have standard prefix');
  assert(snapshot.timestamp, 'Snapshot must have ISO timestamp');

  // Verify Version Quintuple (E, R, C, L, S)
  assert.strictEqual(snapshot.versions.engineVersion, CURRENT_ENGINE_VERSION);
  assert.strictEqual(snapshot.versions.ruleVersion, CURRENT_RULE_VERSION);
  assert.strictEqual(snapshot.versions.configVersion, CURRENT_CONFIG_VERSION);
  assert.strictEqual(snapshot.versions.languageAdapterVersion, CURRENT_ADAPTER_VERSION);
  assert.strictEqual(snapshot.versions.scoringVersion, CURRENT_SCORING_VERSION);
  console.log('✔ Version Quintuple (E, R, C, L, S) verified:');
  console.log(`  - Engine:   ${snapshot.versions.engineVersion}`);
  console.log(`  - Rules:    ${snapshot.versions.ruleVersion}`);
  console.log(`  - Config:   ${snapshot.versions.configVersion}`);
  console.log(`  - Adapters: ${snapshot.versions.languageAdapterVersion}`);
  console.log(`  - Scoring:  ${snapshot.versions.scoringVersion}\n`);

  // 2. Verify rule registry lock & digests
  assert.strictEqual(snapshot.registeredRuleIds.length, RULE_REGISTRY.length);
  assert.ok(snapshot.registeredRuleIds.length >= 136, 'Must retain at least 136 registered rules');
  assert.ok(
    RULE_REGISTRY.length >= snapshot.registeredRuleIds.length,
    'Current registry must preserve and supersede baseline rules',
  );
  for (const baseId of snapshot.registeredRuleIds) {
    assert.ok(
      RULE_REGISTRY.some((r) => r.id === baseId),
      `Baseline rule ${baseId} must remain registered`,
    );
  }
  assert.strictEqual(snapshot.rulesDigest.length, 64, 'Rules digest must be 64-char hex SHA-256');
  assert.strictEqual(snapshot.configDigest.length, 64, 'Config digest must be 64-char hex SHA-256');
  console.log(
    `✔ Rule registry digest locked: ${snapshot.rulesDigest.slice(0, 16)}... (136 baseline rules preserved)`,
  );

  // 3. Verify supported languages array
  const expectedLangs = ['typescript', 'javascript', 'python', 'rust', 'gdscript'];
  for (const lang of expectedLangs) {
    assert(snapshot.supportedLanguages.includes(lang), `Missing language: ${lang}`);
  }
  console.log(`✔ Supported languages locked (${snapshot.supportedLanguages.join(', ')})`);

  // 4. Verify snapshot verification API
  const checkResult = verifyAuditSnapshot(snapshot);
  assert.strictEqual(checkResult.valid, true, 'Clean snapshot must pass verification');
  assert.strictEqual(checkResult.errors.length, 0, 'No errors expected on clean snapshot');

  // 5. Test freeze and reload to reports/baseline-v0.3.0.json
  const targetReportDir = path.resolve(process.cwd(), 'reports');
  const targetReportPath = path.join(targetReportDir, 'baseline-v0.3.0.json');

  const frozen = freezeBaselineToFile(targetReportPath, {
    compositeScore: 88.5,
    testSuiteLatencySec: 11.09,
    incrementalBuildLatencySec: 1.36,
  });
  assert(fs.existsSync(targetReportPath), 'Frozen baseline file must exist on disk');

  const reloaded = loadFrozenBaseline(targetReportPath);
  assert(reloaded !== null, 'Reloaded baseline must not be null');
  assert.strictEqual(reloaded.snapshotId, frozen.snapshotId);
  assert.strictEqual(reloaded.rulesDigest, frozen.rulesDigest);
  assert.strictEqual(reloaded.baselineMetrics.compositeScore, 88.5);
  assert.strictEqual(reloaded.baselineMetrics.testSuiteLatencySec, 11.09);
  assert.strictEqual(reloaded.baselineMetrics.incrementalBuildLatencySec, 1.36);
  console.log(`✔ Baseline successfully frozen and verified at: ${targetReportPath}`);

  // 6. Test tampered snapshot detection
  const tampered = {
    ...snapshot,
    rulesDigest: '0000000000000000000000000000000000000000000000000000000000000000',
  };
  const tamperedCheck = verifyAuditSnapshot(tampered);
  assert.strictEqual(tamperedCheck.valid, false, 'Tampered snapshot must fail verification');
  assert(tamperedCheck.errors.length > 0, 'Tampered check must report error message');
  console.log('✔ Tampered snapshot detection verified (fail-closed).\n');

  console.log('================================================================');
  console.log('🎉 Baseline Freeze BASELINE FREEZE & AUDIT SNAPSHOT VERIFICATION PASSED!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Baseline Freeze verification failed:', err);
  process.exit(1);
});
