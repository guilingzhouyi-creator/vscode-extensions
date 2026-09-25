#!/usr/bin/env node
/**
 * Module: Verification Harness — Change Quality Arbiter & Anti-Gaming Guard
 * File Path: scripts/validate-change-quality-arbiter.js
 * Architecture Role: Automated verification suite asserting the mathematical correctness
 *   of ChangeScore = deltaQ - Regression - ComplexityCost - MaintenanceDebt,
 *   and fail-closed rejection of score-gaming patterns (G-01 ~ G-04).
 * Dependencies & Triggers: `npm test` or `node scripts/validate-change-quality-arbiter.js`;
 *   imports dist/api.
 * Responsibilities:
 *   1. Validate genuine code improvements resulting in 'approved' verdict.
 *   2. Validate regression penalties and maintenance debt deductions.
 *   3. Validate fail-closed rejection of gaming patterns with 'gaming_rejected' verdict.
 * Exit Semantics & Design Rationale: Exits 0 on all tests passing, 1 on any assertion error.
 */
'use strict';

const assert = require('assert');
const { evaluateChangeQuality } = require('../dist/api');

async function main() {
  console.log('=== [Change Quality Arbiter] Testing ChangeScore & Anti-Gaming Guard ===\n');

  // 1. Genuine Engineering Improvement (Clean refactoring)
  console.log('1. Testing Genuine Engineering Improvement...');
  const genuineBefore = `
export function processItems(items: string[]): string[] {
    const res: string[] = [];
    for (let i = 0; i < items.length; i++) {
        if (items[i] && items[i].length > 0) {
            res.push(items[i].trim().toLowerCase());
        }
    }
    return res;
}
`;
  const genuineAfter = `
export function processItems(items: readonly string[]): string[] {
    return items
        .filter((item): item is string => Boolean(item && item.trim()))
        .map((item) => item.trim().toLowerCase());
}
`;

  const approvedChange = evaluateChangeQuality({
    filePath: 'src/utils/cleaner.ts',
    beforeContent: genuineBefore,
    afterContent: genuineAfter,
    beforeScore: 78.0,
    afterScore: 92.0,
  });

  assert.strictEqual(approvedChange.deltaQ, 14.0);
  assert.strictEqual(approvedChange.regressionPenalty, 0);
  assert.strictEqual(approvedChange.verdict, 'approved');
  assert.ok(approvedChange.changeScore >= 10.0);
  console.log(`✔ Genuine refactoring approved: ChangeScore = +${approvedChange.changeScore} (${approvedChange.verdict})`);

  // 2. Introduced Regressions (Broken Invariants)
  console.log('2. Testing Introduced Regressions Penalty...');
  const regressedChange = evaluateChangeQuality({
    filePath: 'src/core/solver.ts',
    beforeContent: genuineBefore,
    afterContent: genuineAfter,
    beforeScore: 80.0,
    afterScore: 85.0, // deltaQ = +5
    regressionIssues: [
      {
        id: 'reg-1',
        analyzer: 'architecture',
        rule: 'ARCH-CYCLE-001',
        severity: 'error',
        message: 'Introduced circular dependency',
        location: { file: 'src/core/solver.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
      },
    ],
  });

  assert.strictEqual(regressedChange.deltaQ, 5.0);
  assert.strictEqual(regressedChange.regressionPenalty, 15.0);
  assert.strictEqual(regressedChange.changeScore, -10.0);
  assert.strictEqual(regressedChange.verdict, 'degraded');
  console.log(`✔ Introduced regression penalized: ChangeScore = ${regressedChange.changeScore} (${regressedChange.verdict})`);

  // 3. Score Gaming Detection (Mechanical Forwarding Splitting G-03)
  console.log('3. Testing Anti-Gaming Guard (Mechanical Forwarding Splitting G-03)...');
  const gamingBefore = `
export class HeavyService {
    public doWork(): void {
        console.log("step 1");
        console.log("step 2");
        console.log("step 3");
    }
}
`;

  // Trivial artificial single-line forwarders designed to manipulate CC
  const gamingAfter = `
export class HeavyService {
    public getA(): string { return this.rawA; }
    public getB(): string { return this.rawB; }
    public getC(): string { return this.rawC; }
    public getD(): string { return this.rawD; }
    public getE(): string { return this.rawE; }
    public getF(): string { return this.rawF; }
}
`;

  const gamingChange = evaluateChangeQuality({
    filePath: 'src/services/heavy.ts',
    beforeContent: gamingBefore,
    afterContent: gamingAfter,
    beforeScore: 70.0,
    afterScore: 88.0,
  });

  assert.strictEqual(gamingChange.isGamingRejected, true);
  assert.strictEqual(gamingChange.verdict, 'gaming_rejected');
  assert.ok(gamingChange.changeScore <= -50.0);
  assert.ok(gamingChange.gamingKinds.includes('artificial_function_splitting'));
  console.log(`✔ Gaming attempt strictly rejected: ChangeScore = ${gamingChange.changeScore} (${gamingChange.verdict})`);

  // 4. Maintenance Debt Deduction (Adding suppression tags)
  console.log('4. Testing Maintenance Debt Penalty (Suppression Tags)...');
  const debtBefore = `const a = 1;`;
  const debtAfter = `// @ts-ignore\nconst a = 1;\n// @ts-nocheck\nconst b = 2;`;

  const debtChange = evaluateChangeQuality({
    filePath: 'src/app.ts',
    beforeContent: debtBefore,
    afterContent: debtAfter,
    beforeScore: 80.0,
    afterScore: 82.0,
  });

  assert.strictEqual(debtChange.maintenanceDebt, 20.0); // 2 new ignores * 10
  assert.strictEqual(debtChange.changeScore, -18.0);
  assert.strictEqual(debtChange.verdict, 'degraded');
  console.log(`✔ Maintenance debt penalized: -${debtChange.maintenanceDebt} points (ChangeScore = ${debtChange.changeScore})`);

  console.log('\n🎉 ALL CHANGE QUALITY ARBITER & ANTI-GAMING TESTS PASSED!');
}

main().catch((err) => {
  console.error('❌ Validation failed:', err);
  process.exit(1);
});
