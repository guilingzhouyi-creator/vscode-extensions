/**
 * Module: Verification Harness — Role-Aware Literal Deduplication
 * File Path: scripts/validate-role-aware-deduplication.js
 * Architecture Role: Contract lock ensuring that duplicate literal detection adaptively
 *     relaxes for test suites and configuration/data tables while remaining strictly enforced.
 * Dependencies & Triggers: Run via `node scripts/validate-role-aware-deduplication.js` and test-parallel.
 * Responsibilities: Exercise positive and negative fixtures for role-aware deduplication.
 * Exit Semantics & Design Rationale: Process exits 0 on success; throws AssertionError on failure.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../dist/api');

async function testRoleAwareDeduplication() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-role-dedup-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'test'), { recursive: true });
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });

    // 1. Business module: repeating 'foo' 4 times must trigger duplicate-literal
    fs.writeFileSync(
      path.join(root, 'src/biz.ts'),
      [
        'export function handle(action: string): string {',
        "  if (action === 'foo') return 'foo';",
        "  if (action === 'bar') return 'foo';",
        "  return 'foo';",
        '}',
      ].join('\n'),
    );

    // 2. Test suite: repeating 'foo' 6 times must be exempt as a test benign token
    fs.writeFileSync(
      path.join(root, 'test/biz.test.ts'),
      [
        'export function testBiz(): void {',
        "  const a = 'foo';",
        "  const b = 'foo';",
        "  const c = 'foo';",
        "  const d = 'foo';",
        "  const e = 'foo';",
        "  const f = 'foo';",
        '}',
      ].join('\n'),
    );

    // 3. Config/Data table: repeating 'id' or 'type' 6 times
    // must be exempt as schema property tokens
    fs.writeFileSync(
      path.join(root, 'config/items.ts'),
      [
        'export const ITEMS = [',
        "  { id: 'item_1', type: 'weapon' },",
        "  { id: 'item_2', type: 'weapon' },",
        "  { id: 'item_3', type: 'armor' },",
        "  { id: 'item_4', type: 'armor' },",
        '];',
      ].join('\n'),
    );

    const report = await scan({
      root,
      logLevel: 'silent',
      cache: false,
    });

    const dupIssues = report.issues.filter((i) => i.rule === 'duplicate-literal');
    const bizDups = dupIssues.filter((i) => i.location.file.includes('biz.ts'));
    const testDups = dupIssues.filter((i) => i.location.file.includes('biz.test.ts'));
    const configDups = dupIssues.filter((i) => i.location.file.includes('items.ts'));

    assert.ok(
      bizDups.length >= 1,
      `Business code must detect duplicate 'foo', found: ${bizDups.length}`,
    );
    assert.strictEqual(
      testDups.length,
      0,
      `Test suite benign token 'foo' must be exempt, found: ${testDups.length}`,
    );
    assert.strictEqual(
      configDups.length,
      0,
      `Config schema property 'id' / 'type' must be exempt, found: ${configDups.length}`,
    );

    console.log('  [PASS] Business module enforces standard duplicate literal extraction');
    console.log('  [PASS] Test suite benign tokens are exempt from duplicate literal warnings');
    console.log('  [PASS] Config schema property tokens are exempt from duplicate literal warnings');
    console.log('\nALL ROLE-AWARE DEDUPLICATION CHECKS PASSED SUCCESSFULLY!\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

testRoleAwareDeduplication().catch((err) => {
  console.error(err);
  process.exit(1);
});
