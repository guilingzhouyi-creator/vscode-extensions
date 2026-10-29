/**
 * Module: Verification Harness — DualPipe Bidirectional Overlap & DeepInfer SWA Replay
 * File Path: scripts/validate-bidirectional-swa.js
 * Architecture Role: Comprehensive integration assertion suite validating Phase 2 DeepSeek
 *   architectural internalizations:
 *   1. DualPipe BidirectionalAuditScheduler schedule decomposition (Warmup, Overlap, Cooldown);
 *   2. DualPipe concurrent overlap execution, ring buffer passing, and pipeline metrics;
 *   3. SwaBoundedReplayManager syntactic anchor indexing and caching;
 *   4. SwaBoundedReplayManager bounded sliding window calculation and signature invariance check;
 *   5. SwaBoundedReplayManager issue pruning and global fallback safeguards.
 * Dependencies & Triggers: Consumes dist/api; triggered by test-parallel.js and npm test.
 * Responsibilities: Assert exact schedule topologies, zero bubble leakage, and O(1) bounded
 *   windows.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passing; exits 1 with trace on
 *   failure.
 */

const assert = require('assert');
const {
  BidirectionalAuditScheduler,
  SwaBoundedReplayManager,
  REASON_BOUNDED_LOCAL,
  REASON_SIGNATURE_MUTATION,
  REASON_GLOBAL_MUTATION,
  REASON_MULTI_ANCHOR_SPAN,
  SEVERITY_WARN,
  SEVERITY_ERROR,
} = require('../dist/api');

async function main() {
  console.log('=== [1/5] Testing DualPipe Bidirectional Schedule Plan Construction ===');

  const scheduler = new BidirectionalAuditScheduler(64);

  // 1. Empty inputs
  const emptySteps = scheduler.buildSchedulePlan([]);
  assert.strictEqual(emptySteps.length, 0, 'Empty inputs must generate 0 schedule steps');

  // 2. Single input
  const singleSteps = scheduler.buildSchedulePlan([
    { filePath: 'src/single.ts', oldContent: '', newContent: '' },
  ]);
  assert.strictEqual(singleSteps.length, 1, 'Single input must generate 1 step');
  assert.strictEqual(singleSteps[0].isOverlap, false, 'Single step cannot overlap');
  assert.strictEqual(singleSteps[0].forwardFile, 'src/single.ts');
  assert.strictEqual(singleSteps[0].backwardFile, 'src/single.ts');

  // 3. Multi-file inputs (4 files) -> 1 Warmup + 3 Overlaps + 1 Cooldown = 5 steps
  const multiInputs = [
    { filePath: 'src/a.ts', oldContent: '', newContent: '' },
    { filePath: 'src/b.ts', oldContent: '', newContent: '' },
    { filePath: 'src/c.ts', oldContent: '', newContent: '' },
    { filePath: 'src/d.ts', oldContent: '', newContent: '' },
  ];
  const steps = scheduler.buildSchedulePlan(multiInputs);
  assert.strictEqual(steps.length, 5, '4 files must produce 5 schedule intervals (1W + 3O + 1C)');

  // Step 0: Warmup (F_0 only)
  assert.strictEqual(steps[0].stepIndex, 0);
  assert.strictEqual(steps[0].forwardFile, 'src/a.ts');
  assert.strictEqual(steps[0].backwardFile, undefined);
  assert.strictEqual(steps[0].isOverlap, false, 'Warmup step must not be overlap');

  // Step 1: Overlap F_1 with D_0
  assert.strictEqual(steps[1].stepIndex, 1);
  assert.strictEqual(steps[1].forwardFile, 'src/b.ts');
  assert.strictEqual(steps[1].backwardFile, 'src/a.ts');
  assert.strictEqual(steps[1].isOverlap, true, 'Step 1 must be bidirectional overlap');

  // Step 2: Overlap F_2 with D_1
  assert.strictEqual(steps[2].stepIndex, 2);
  assert.strictEqual(steps[2].forwardFile, 'src/c.ts');
  assert.strictEqual(steps[2].backwardFile, 'src/b.ts');
  assert.strictEqual(steps[2].isOverlap, true, 'Step 2 must be bidirectional overlap');

  // Step 3: Overlap F_3 with D_2
  assert.strictEqual(steps[3].stepIndex, 3);
  assert.strictEqual(steps[3].forwardFile, 'src/d.ts');
  assert.strictEqual(steps[3].backwardFile, 'src/c.ts');
  assert.strictEqual(steps[3].isOverlap, true, 'Step 3 must be bidirectional overlap');

  // Step 4: Cooldown (D_3 only)
  assert.strictEqual(steps[4].stepIndex, 4);
  assert.strictEqual(steps[4].forwardFile, undefined);
  assert.strictEqual(steps[4].backwardFile, 'src/d.ts');
  assert.strictEqual(steps[4].isOverlap, false, 'Cooldown step must not be overlap');

  console.log('DualPipe schedule plan construction verified (Warmup -> Overlap -> Cooldown).');

  console.log('=== [2/5] Testing DualPipe Bidirectional Execution & Overlap Metrics ===');

  // Mock Scanner providing necessary interfaces
  const mockScanner = {
    getPlan: () => [{ name: 'naming' }, { name: 'complexity' }],
    getReviewMemory: () => ({ get: () => undefined, put: () => {} }),
    getTrajectoryManager: () => ({ getTrajectory: () => undefined, recordRevision: () => null }),
    getDependencyGraph: () => null,
    getQualityScorer: () => ({
      evaluateFile: () => ({
        compositeScore: 92,
        debtScore: 5,
        maintainabilityScore: 90,
        reliabilityScore: 95,
        securityScore: 100,
      }),
    }),
    runAnalyzers: async () => ({
      issues: [],
      metric: { eloc: 40, loc: 60, cc: 4, depth: 2 },
    }),
  };

  const execInputs = [
    { filePath: 'file1.ts', oldContent: 'const a = 1;', newContent: 'const a = 2;' },
    { filePath: 'file2.ts', oldContent: 'const b = 1;', newContent: 'const b = 2;' },
    { filePath: 'file3.ts', oldContent: 'const c = 1;', newContent: 'const c = 2;' },
  ];

  const result = await scheduler.execute(mockScanner, execInputs);
  assert.strictEqual(result.fastVerdicts.size, 3, 'Must have fast verdicts for all 3 files');
  assert.strictEqual(result.deepVerdicts.size, 3, 'Must have deep verdicts for all 3 files');
  assert.strictEqual(result.scheduleSteps.length, 4, '3 inputs must produce 4 execution intervals');

  const metrics = result.metrics;
  assert.strictEqual(metrics.totalSteps, 4, 'Total steps must be 4');
  assert.strictEqual(metrics.overlapCount, 2, 'Must have 2 overlapped intervals');
  assert.strictEqual(metrics.bubbleCount, 2, 'Must have 2 bubble intervals (warmup + cooldown)');
  assert.strictEqual(metrics.overlapRatio, 0.5, 'Overlap ratio must be 2 / 4 = 0.5');
  assert(metrics.totalLatencyMs >= 0, 'Total latency must be tracked');
  assert.strictEqual(result.overallStatus, 'SPECULATIVE_PASSED');

  console.log('DualPipe execution, ring buffer passing, and metrics verified.');

  console.log('=== [3/5] Testing SwaBoundedReplayManager Syntactic Anchor Indexing ===');

  const swaManager = new SwaBoundedReplayManager({ maxWindowLines: 128 });
  swaManager.clearCache();

  const sampleSource = [
    'import { something } from "./other";',
    '',
    'export function calculateTax(amount: number): number {',
    '    const rate = 0.2;',
    '    return amount * rate;',
    '}',
    '',
    'export class AccountManager {',
    '    private balance: number = 0;',
    '',
    '    public deposit(val: number): void {',
    '        this.balance += val;',
    '    }',
    '}',
  ].join('\n');

  const anchors = swaManager.indexAnchors('src/account.ts', sampleSource);
  assert.strictEqual(
    anchors.length,
    2,
    'Should index 2 declarations (calculateTax and AccountManager)',
  );

  const functionAnchor = anchors[0];
  assert.strictEqual(functionAnchor.name, 'calculateTax');
  assert.strictEqual(functionAnchor.startLine, 3);
  assert.strictEqual(functionAnchor.endLine, 6);
  assert(functionAnchor.signatureHash.length > 0, 'Must compute signature hash');

  const classAnchor = anchors[1];
  assert.strictEqual(classAnchor.name, 'AccountManager');
  assert.strictEqual(classAnchor.startLine, 8);
  assert.strictEqual(classAnchor.endLine, 14);

  // Cache hit check
  const cachedAnchors = swaManager.indexAnchors('src/account.ts', sampleSource);
  assert.strictEqual(cachedAnchors, anchors, 'Must return cached reference for unchanged content');
  const cacheStats = swaManager.getCacheStats();
  assert.strictEqual(cacheStats.hitCount, 1, 'Cache hit count should be 1');

  console.log('SWA anchor indexing and LRU caching verified.');

  console.log('=== [4/5] Testing SwaBoundedReplayManager Bounded Replay Evaluation ===');

  // Case 4.1: Localized edit inside calculateTax body (lines 4-5 modified, signature line 3
  // untouched)
  const modifiedLocalSource = [
    'import { something } from "./other";',
    '',
    'export function calculateTax(amount: number): number {',
    '    const rate = 0.25; // modified rate',
    '    return Math.round(amount * rate);',
    '}',
    '',
    'export class AccountManager {',
    '    private balance: number = 0;',
    '',
    '    public deposit(val: number): void {',
    '        this.balance += val;',
    '    }',
    '}',
  ].join('\n');

  const localWindow = swaManager.computeReplayWindow(
    'src/account.ts',
    sampleSource,
    modifiedLocalSource,
    [4, 5],
  );
  assert.strictEqual(localWindow.isBounded, true, 'Localized micro-edit must be bounded');
  assert.strictEqual(localWindow.requiresFullReplay, false, 'Must not require full replay');
  assert.strictEqual(localWindow.startLine, 3, 'Window start should align with anchor start');
  assert.strictEqual(localWindow.endLine, 6, 'Window end should align with anchor end');
  assert.strictEqual(localWindow.reason, REASON_BOUNDED_LOCAL);
  assert.strictEqual(swaManager.canUseSwaReplay(localWindow), true);

  // Case 4.2: Declaration signature modified (line 3 parameter changed)
  const modifiedSignatureSource = [
    'import { something } from "./other";',
    '',
    'export function calculateTax(amount: number, discount: number = 0): number {',
    '    const rate = 0.2;',
    '    return amount * rate;',
    '}',
    '',
    'export class AccountManager {',
    '    private balance: number = 0;',
    '',
    '    public deposit(val: number): void {',
    '        this.balance += val;',
    '    }',
    '}',
  ].join('\n');

  const signatureWindow = swaManager.computeReplayWindow(
    'src/account.ts',
    sampleSource,
    modifiedSignatureSource,
    [3, 3],
  );
  assert.strictEqual(signatureWindow.isBounded, false, 'Signature mutation must not be bounded');
  assert.strictEqual(signatureWindow.requiresFullReplay, true, 'Must require full replay');
  assert.strictEqual(signatureWindow.reason, REASON_SIGNATURE_MUTATION);
  assert.strictEqual(swaManager.canUseSwaReplay(signatureWindow), false);

  // Case 4.3: Top-level import modified (line 1)
  const modifiedImportSource = [
    'import { something, another } from "./other";',
    '',
    'export function calculateTax(amount: number): number {',
    '    const rate = 0.2;',
    '    return amount * rate;',
    '}',
    '',
    'export class AccountManager {',
    '    private balance: number = 0;',
    '',
    '    public deposit(val: number): void {',
    '        this.balance += val;',
    '    }',
    '}',
  ].join('\n');

  const importWindow = swaManager.computeReplayWindow(
    'src/account.ts',
    sampleSource,
    modifiedImportSource,
    [1, 1],
  );
  assert.strictEqual(
    importWindow.requiresFullReplay,
    true,
    'Import mutation must trigger full replay',
  );
  assert.strictEqual(importWindow.reason, REASON_GLOBAL_MUTATION);

  // Case 4.4: Cross-anchor edit span (lines 5 to 10)
  const crossWindow = swaManager.computeReplayWindow(
    'src/account.ts',
    sampleSource,
    modifiedLocalSource,
    [5, 10],
  );
  assert.strictEqual(
    crossWindow.requiresFullReplay,
    true,
    'Cross-anchor span must trigger full replay',
  );
  assert.strictEqual(crossWindow.reason, REASON_MULTI_ANCHOR_SPAN);

  console.log('SWA bounded window calculation and boundary safeguards verified.');

  console.log('=== [5/5] Testing SwaBoundedReplayManager Issue Pruning ===');

  const testIssues = [
    {
      id: 'rule1:1',
      analyzer: 'comments',
      rule: 'missing-jsdoc',
      severity: SEVERITY_WARN,
      message: 'missing jsdoc on line 1',
      location: { file: 'src/account.ts', start: { line: 1, column: 1 } },
    },
    {
      id: 'rule2:4',
      analyzer: 'naming',
      rule: 'bad-identifier',
      severity: SEVERITY_WARN,
      message: 'bad naming on line 4',
      location: { file: 'src/account.ts', start: { line: 4, column: 5 } },
    },
    {
      id: 'rule3:10',
      analyzer: 'complexity',
      rule: 'high-complexity',
      severity: SEVERITY_ERROR,
      message: 'high complexity on line 10',
      location: { file: 'src/account.ts', start: { line: 10, column: 1 } },
    },
  ];

  // Pruning against localWindow [3, 6] should keep only rule2:4
  const pruned = swaManager.pruneIssuesOutsideWindow(testIssues, localWindow);
  assert.strictEqual(pruned.length, 1, 'Only issue at line 4 should be retained in [3, 6] window');
  assert.strictEqual(pruned[0].id, 'rule2:4');

  // Pruning against signatureWindow (full replay required) should retain all issues
  const unpruned = swaManager.pruneIssuesOutsideWindow(testIssues, signatureWindow);
  assert.strictEqual(unpruned.length, 3, 'Full replay window must retain all issues');

  console.log('SWA issue pruning verified.');
  console.log('=== ALL PHASE 2 VALIDATION TESTS PASSED (5/5) ===');
}

main().catch((validationError) => {
  console.error('Phase 2 validation failed:', validationError);
  process.exit(1);
});
