/**
 * Module: Static Quality Assurance — Trajectory Accumulator & Progressive ELOC Validation
 * File Path: scripts/validate-trajectory-accumulator.js
 * Architecture Role: Validates the TrajectoryAccumulator engine, testing first baseline initialization,
 *   progressive multi-run ELOC accumulation, AST deduplication, QED calculation, and storage limits.
 * Dependencies & Triggers: Consumes ../dist/api; executed via test-parallel and npm test.
 * Exit Semantics: Exits with code 0 on all assertions pass, non-zero on failure.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  TrajectoryAccumulator,
  readLifetimeSummary,
  readRecentRecords,
} = require('../dist/api');

const TEST_LEDGER_DIR = path.join(__dirname, '..', 'tmp', 'test-trajectory-accumulator');

async function cleanTestDir() {
  if (fs.existsSync(TEST_LEDGER_DIR)) {
    fs.rmSync(TEST_LEDGER_DIR, { recursive: true, force: true });
  }
}

async function runValidation() {
  console.log('--- [1/5] Testing First Baseline Initialization ---');
  await cleanTestDir();
  const accumulator = new TrajectoryAccumulator(TEST_LEDGER_DIR);

  const sampleFiles = [
    {
      filePath: 'src/core/math.ts',
      content: `
        export function add(a: number, b: number): number {
            return a + b;
        }
        export function subtract(a: number, b: number): number {
            return a - b;
        }
      `,
    },
    {
      filePath: 'src/core/utils.ts',
      content: `
        export class Logger {
            public log(msg: string): void {
                console.log(msg);
            }
        }
      `,
    },
  ];

  const baselineRes = await accumulator.recordAuditRun({
    runId: 'baseline-001',
    revision: 'abc1234',
    module: 'test-module',
    scannedFiles: sampleFiles,
    beforeScore: 98.0,
    afterScore: 98.0,
  });

  assert.strictEqual(baselineRes.isFirstBaseline, true, 'First run should be marked as baseline');
  assert.ok(baselineRes.runEloc.processed > 0, 'Processed ELOC should be positive');
  assert.ok(baselineRes.runEloc.unique > 0, 'Unique ELOC should be positive');
  assert.strictEqual(baselineRes.lifetimeSummary.totalRuns, 1, 'Lifetime total runs should be 1');
  assert.strictEqual(
    baselineRes.lifetimeSummary.eloc.processedTotal,
    baselineRes.runEloc.processed,
    'Lifetime processed total should match baseline processed ELOC',
  );

  console.log('--- [2/5] Testing Progressive Multi-Run ELOC Accumulation ---');
  const secondRunRes = await accumulator.recordAuditRun({
    runId: 'run-002',
    revision: 'def5678',
    module: 'test-module',
    scannedFiles: sampleFiles,
    beforeScore: 98.0,
    afterScore: 99.0,
  });

  assert.strictEqual(secondRunRes.isFirstBaseline, false, 'Second run should not be baseline');
  assert.strictEqual(secondRunRes.lifetimeSummary.totalRuns, 2, 'Lifetime total runs should be 2');
  assert.strictEqual(
    secondRunRes.lifetimeSummary.eloc.processedTotal,
    baselineRes.runEloc.processed * 2,
    'Cumulative processed ELOC should accumulate additively across runs',
  );
  assert.strictEqual(
    secondRunRes.lifetimeSummary.eloc.uniqueTotal,
    baselineRes.runEloc.unique,
    'Unique ELOC should remain stable when scanning identical files (AST block deduplicated)',
  );

  console.log('--- [3/5] Testing Third Run with New Files and Debt Resolution ---');
  const modifiedFiles = [
    ...sampleFiles,
    {
      filePath: 'src/core/extra.ts',
      content: `
        export function multiply(a: number, b: number): number {
            return a * b;
        }
      `,
    },
  ];

  const thirdRunRes = await accumulator.recordAuditRun({
    runId: 'run-003',
    revision: 'ghi9012',
    module: 'test-module',
    scannedFiles: modifiedFiles,
    beforeScore: 99.0,
    afterScore: 100.0,
    addedDebtPoints: 0,
    resolvedDebtPoints: 10,
    regressionFindingsCount: 0,
  });

  assert.strictEqual(thirdRunRes.lifetimeSummary.totalRuns, 3, 'Lifetime total runs should be 3');
  assert.ok(
    thirdRunRes.lifetimeSummary.eloc.uniqueTotal > baselineRes.runEloc.unique,
    'Unique ELOC should increase when new files are introduced',
  );
  assert.ok(thirdRunRes.qualityMetrics.qed >= 0, 'QED should be non-negative for score increase');
  assert.ok(thirdRunRes.lifetimeSummary.debt.netYield >= 0, 'Net yield should reflect debt resolution');

  console.log('--- [4/5] Testing Ledger Persistence & Compaction ---');
  const recentRecords = await readRecentRecords(TEST_LEDGER_DIR);
  assert.strictEqual(recentRecords.length, 3, 'All 3 records should be persisted in active NDJSON');

  const lifetime = await readLifetimeSummary(TEST_LEDGER_DIR);
  assert.ok(lifetime !== null, 'Lifetime summary file should exist and be valid JSON');
  assert.strictEqual(lifetime.totalRuns, 3, 'Persisted lifetime runs should be 3');

  console.log('--- [5/5] Testing NDJSON Record Size Bound (< 350 Bytes) ---');
  const ndjsonPath = path.join(TEST_LEDGER_DIR, 'active-runs.ndjson');
  const lines = fs.readFileSync(ndjsonPath, 'utf8').trim().split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineByteLength = Buffer.byteLength(lines[i], 'utf8');
    assert.ok(
      lineByteLength <= 350,
      `NDJSON record ${i} must be <= 350 bytes (got ${lineByteLength} bytes)`,
    );
  }

  await cleanTestDir();
  console.log('✅ ALL TRAJECTORY ACCUMULATOR VALIDATION CHECKS PASSED');
}

runValidation().catch((err) => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
