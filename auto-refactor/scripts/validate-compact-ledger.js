/**
 * Module: Verification Harness — Compact Ledger Store & Trajectory Compaction Tests
 * File Path: scripts/validate-compact-ledger.js
 * Architecture Role: Verifies compact NDJSON record size bounds (< 350 bytes),
 *   rolling active ledger persistence, weekly aggregation, and lifetime statistical summaries.
 * Dependencies & Triggers: Consumes dist/core trajectory modules; executed in test-parallel.js.
 * Responsibilities: Validate record serialization bounds, rolling pruning, and compaction.
 * Exit Semantics & Design Rationale: Exits 0 on assertions pass, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  formatCompactRecord,
  serializeNdjsonLine,
  appendTrajectoryRecord,
  readRecentRecords,
  readLifetimeSummary,
} = require('../dist/core/trajectory/compact-ledger-store');
const { getIsoWeekId, compactLedger } = require('../dist/core/trajectory/trajectory-compactor');

async function runTests() {
  console.log('🧪 Running Compact Ledger & Trajectory Compaction Validation Suite...');

  const tempLedgerDir = path.join(os.tmpdir(), `refactor-ledger-test-${Date.now()}`);

  try {
    // --- Test 1: Record Serialization & Size Constraint (< 350 bytes) ---
    console.log(
      '  ▶ [Test 1] Testing CompactTrajectoryRecord serialization and size limit (< 350B)...',
    );
    const sampleCounters = {
      processed: 15420,
      unique: 8200,
      changed: 120,
      semantic: 95,
      relocated: 15,
      cosmetic: 10,
      boilerplate: 0,
      added: 60,
      deleted: 60,
      modified: 60,
    };

    const sampleMetrics = {
      qed: 0.0526,
      reviewYield: 4.85,
      regressionDensity: 0,
      deltaQSemantic: 5.0,
      beforeScore: 82.0,
      afterScore: 87.0,
      scoreVector: [90.5, 88.0, 95.0, 84.5, 86.0, 91.0, 89.5, 80.0, 92.0, 94.0],
      dimensionDeltas: { maintainability: 5.0 },
      debtDelta: {
        addedDebtPoints: 0,
        resolvedDebtPoints: 12,
        netDebtCleared: 12,
        regressionFindingsCount: 0,
        regressionFindingIds: [],
      },
      gamingPenalty: 0,
    };

    const compactRec = formatCompactRecord({
      runId: 'run-test-001',
      revision: 'a1b2c3d4e5f6',
      module: 'workspace-timing',
      agent: 'gemini-antigravity',
      timestamp: 1790840000000,
      counters: sampleCounters,
      metrics: sampleMetrics,
      gatePass: true,
    });

    const serialized = serializeNdjsonLine(compactRec);
    const byteSize = Buffer.byteLength(serialized, 'utf8');

    console.log(`    ℹ Serialized record size: ${byteSize} bytes (limit: 350B)`);
    assert.ok(byteSize < 350, `Record size (${byteSize}B) must be strictly under 350 bytes`);
    console.log('    ✔ Ultra-compact record size verified');

    // --- Test 2: Persistence & Rolling Ledger Appends ---
    console.log('  ▶ [Test 2] Testing rolling NDJSON ledger persistence...');
    await appendTrajectoryRecord(tempLedgerDir, compactRec);

    // Add second record
    const compactRec2 = formatCompactRecord({
      runId: 'run-test-002',
      revision: 'b2c3d4e5f6a1',
      module: 'auto-refactor',
      agent: 'gemini-antigravity',
      timestamp: 1790840100000,
      counters: { ...sampleCounters, semantic: 40, changed: 50 },
      metrics: { ...sampleMetrics, qed: 0.1, deltaQSemantic: 4.0, afterScore: 91.0 },
      gatePass: true,
    });
    await appendTrajectoryRecord(tempLedgerDir, compactRec2);

    const loaded = await readRecentRecords(tempLedgerDir, 10);
    assert.strictEqual(loaded.length, 2, 'Should have loaded 2 records');
    assert.strictEqual(loaded[0].id, 'run-test-001');
    assert.strictEqual(loaded[1].id, 'run-test-002');
    console.log('    ✔ Active ledger persistence verified');

    // --- Test 3: ISO Week ID Resolution ---
    console.log('  ▶ [Test 3] Testing ISO 8601 week calculation...');
    const weekId = getIsoWeekId(1790840000000);
    assert.ok(/^20\d\d-W\d\d$/.test(weekId), `Week ID (${weekId}) must match YYYY-Www format`);
    console.log(`    ✔ ISO week format verified (${weekId})`);

    // --- Test 4: Trajectory Compaction & Weekly Aggregates ---
    console.log('  ▶ [Test 4] Testing trajectory compaction and weekly aggregation...');
    const weeklySummaries = await compactLedger(tempLedgerDir);

    assert.strictEqual(
      weeklySummaries.length,
      1,
      'Should produce 1 weekly summary for test records',
    );
    const summary = weeklySummaries[0];
    assert.strictEqual(summary.totalRuns, 2, 'Weekly summary should aggregate 2 runs');
    assert.strictEqual(summary.eloc.semanticTotal, 95 + 40, 'Semantic ELOC must sum correctly');
    assert.strictEqual(summary.gatePassRate, 100, 'Pass rate should be 100%');

    const lifetime = await readLifetimeSummary(tempLedgerDir);
    assert.ok(lifetime !== null, 'Lifetime summary file must exist');
    assert.strictEqual(lifetime.totalRuns, 2);
    console.log('    ✔ Trajectory compaction and lifetime summary verified');

    console.log('\n🎉 ALL Phase 3 Compact Ledger & Compaction Tests PASSED!\n');
  } finally {
    try {
      fs.rmSync(tempLedgerDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
