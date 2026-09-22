/**
 * Module: Verification Harness - Closed-Loop Governance & High-Load Stress
 * File Path: scripts/validate-e2e-stress.js
 * Architecture Role: Comprehensive verification harness for full-lifecycle closed-loop
 *   governance, multi-language mixed project stress scenarios, fine-grained slice MoE
 *   dispatch, trajectory recipe learning & oscillation defense, Praxis SPI facade synergy,
 *   and high-load throughput/memory stability benchmarks.
 * Dependencies & Triggers: Consumes ../dist/api; executed in test-parallel runner.
 * Responsibilities: Validate all core functional gates of closed-loop stress governance.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passing, throws on failure.
 */

'use strict';

const assert = require('assert');
const {
  synthesizeEightPillars,
  computeRiskWeightedPenalties,
  computeEffectiveCodeDensity,
  detectScoreGaming,
  RULE_REGISTRY,
  classifyRuleLayer,
  ASTSliceExtractor,
  SparseMoEGateRouter,
  CallChainImpactTracer,
  createPraxisSliceAuditService,
  TrajectoryRecipeExtractor,
  RegressionTrajectoryDetector,
  createPraxisTrajectoryLearningService,
  createPraxisMultiAgentGovernanceService,
} = require('../dist/api');
const { SymbolIndex } = require('../dist/core/intelligence/symbolIndex');
const { CallGraph } = require('../dist/core/intelligence/callGraph');

/**
 * Verify 180 canonical rules and tier distributions.
 */
function verifyRulePyramidDistribution() {
  assert.strictEqual(RULE_REGISTRY.length, 180);
  let layer1 = 0;
  let layer2 = 0;
  for (const r of RULE_REGISTRY) {
    const layer = classifyRuleLayer(r.id);
    if (layer === 'layer1_universal') layer1++;
    if (layer === 'layer2_family') layer2++;
  }
  assert.ok(layer1 >= 10);
  assert.ok(layer2 >= 1);
}

/**
 * Verify non-linear penalties and 8-pillar ceilings.
 */
function verifyRiskPenaltiesAndEightPillars() {
  const issues = [
    {
      id: 'iss-1',
      analyzer: 'architecture',
      rule: 'ARCH-001',
      severity: 'error',
      message: 'Controller directly accesses raw DB entity bypassing Domain Service',
      location: {
        file: 'src/api/ctrl.ts',
        start: { line: 1, column: 1 },
        end: { line: 1, column: 40 },
      },
    },
  ];
  const risk = computeRiskWeightedPenalties(issues);
  assert.ok(risk.fatalIssueCount >= 1);

  const base = {
    architectureConsistency: 60,
    maintainability: 82,
    performanceEfficiency: 78,
    codeSecurity: 95,
    semanticPurity: 88,
    techDebtRisk: 65,
    standardization: 90,
    commentQuality: 85,
    duplication: 92,
    modernity: 84,
  };
  const score = synthesizeEightPillars(base, 75, 85, risk.ceilings);
  assert.ok(score.pillars.architecture <= 40);
  assert.ok(score.compositeScore >= 0 && score.compositeScore <= 100);
  console.log(`  ✔ E2E Closed Loop: CompositeScore=${score.compositeScore.toFixed(1)}`);
}

/**
 * Gate 1: Full-Lifecycle E2E Governance Closed Loop.
 */
function testGate1ClosedLoop() {
  console.log('\n[Gate 1] Verifying full-lifecycle E2E governance closed loop...');
  verifyRulePyramidDistribution();
  verifyRiskPenaltiesAndEightPillars();
}

/**
 * Gate 2: Multi-Language Mixed Project Real-World Scenarios.
 */
function testGate2MultiLanguageScenarios() {
  console.log('\n[Gate 2] Verifying multi-language mixed project real-world scenarios...');
  const tsCode = [
    '/**',
    ' * Order processor domain service.',
    ' */',
    'export class OrderProcessor {',
    '    /**',
    '     * Process an order transaction.',
    '     * @param amount - Order total.',
    '     * @returns Processing status.',
    '     */',
    '    public processOrder(amount: number): boolean {',
    '        if (amount <= 0) return false;',
    '        return amount + amount * 0.08 > 0;',
    '    }',
    '}',
  ].join('\n');

  const pyCode = [
    'class DataPipeline:',
    '    def process_records(self, records):',
    '        return sum(x["val"] for x in records if x.get("ok"))',
  ].join('\n');

  const tsDensity = computeEffectiveCodeDensity(tsCode);
  const pyDensity = computeEffectiveCodeDensity(pyCode);
  assert.ok(tsDensity.effectiveDensity >= 0.7);
  assert.ok(pyDensity.effectiveDensity >= 0.7);

  const gaming = detectScoreGaming('src/orders/processor.ts', tsCode);
  assert.strictEqual(gaming.hasGaming, false);
  console.log(`  ✔ Multi-Language Parity: TS density=${tsDensity.effectiveDensity.toFixed(2)}`);
}

/**
 * Benchmark incremental slice dispatch throughput.
 */
function benchmarkSliceDispatch(sliceService) {
  const baseCode = [
    '/**',
    ' * Compute total price.',
    ' * @param p - Base item price.',
    ' * @returns Total calculated price.',
    ' */',
    'export function computeTotal(p: number): number {',
    '  return p * 1.1;',
    '}',
  ].join('\n');

  const modCode = [
    '/**',
    ' * Compute total price.',
    ' * @param p - Base item price.',
    ' * @param d - Discount amount.',
    ' * @returns Total calculated price.',
    ' */',
    'export function computeTotal(p: number, d = 0): number {',
    '  return (p - d) * 1.1;',
    '}',
  ].join('\n');

  let totalBypass = 0;
  const count = 120;
  const t0 = Date.now();
  for (let i = 0; i < count; i++) {
    const code = i % 2 === 0 ? baseCode.replace('1.1', '1.2') : modCode;
    const plan = sliceService.getRoutingPlan('src/pricing.ts', baseCode, code, [7]);
    totalBypass += (1 - plan.activationRatio) * 100;
  }
  const avgBypass = totalBypass / count;
  assert.ok(avgBypass >= 65.0);
  console.log(
    `  ✔ MoE Stress: 120 slices dispatched in ${Date.now() - t0}ms, Bypass=${avgBypass.toFixed(1)}%`,
  );
}

/**
 * Verify breaking call-chain mutation guard.
 */
function verifyBreakingCallChainImpact(impactTracer) {
  const symIndex = new SymbolIndex();
  symIndex.addDefinitions([
    {
      name: 'computeTotal',
      kind: 'function',
      file: 'src/pricing.ts',
      line: 6,
      column: 1,
      exported: true,
    },
    {
      name: 'processOrder',
      kind: 'function',
      file: 'src/billing.ts',
      line: 10,
      column: 1,
      exported: true,
    },
  ]);
  symIndex.addReferences([
    { name: 'computeTotal', file: 'src/billing.ts', line: 15, column: 5, caller: 'processOrder' },
  ]);
  const callGraph = new CallGraph(symIndex);

  const impact = impactTracer.traceSymbolImpact(
    'computeTotal',
    'src/pricing.ts',
    true,
    callGraph,
    3,
  );
  assert.strictEqual(impact.riskLevel, 'CRITICAL');
  assert.ok(impact.issues.some((iss) => iss.rule === 'GOV-SLC-001'));
}

/**
 * Gate 3: Incremental Slice & MoE Sparse Dispatch Stress.
 */
function testGate3MoESparseDispatch(sliceService, impactTracer) {
  console.log('\n[Gate 3] Verifying incremental slice & MoE sparse dispatch stress...');
  benchmarkSliceDispatch(sliceService);
  verifyBreakingCallChainImpact(impactTracer);
}

/**
 * Benchmark batch trajectory learning.
 */
async function benchmarkTrajectoryLearning(trajectoryService) {
  const bCode = 'function calc(arr: any[]) { return arr.reduce((a, b) => a + b, 0); }';
  const aCode = 'function calc(arr: number[]): number { return arr.reduce((a, b) => a + b, 0); }';

  const t0 = Date.now();
  for (let i = 0; i < 50; i++) {
    const verdict = await trajectoryService.learnFromTrajectory({
      trajectoryId: `trj-${i}`,
      filePath: `src/data/h_${i}.ts`,
      beforeContent: bCode,
      afterContent: aCode,
      beforeScore: { compositeScore: 60, dimensions: {} },
      afterScore: { compositeScore: 85, dimensions: {} },
      language: 'typescript',
    });
    assert.ok(verdict.durationMs >= 0);
  }
  console.log(`  ✔ Trajectory Stress: 50 learning cycles in ${Date.now() - t0}ms`);
}

/**
 * Verify cyclic oscillation detection.
 */
function verifyCyclicOscillationDetection(regressionDetector) {
  const revisions = [
    {
      revisionId: 'r1',
      fileHash: 'hA',
      astDigest: 'dA',
      timestamp: 1,
      agentUid: 'a1',
      qualityScore: { compositeScore: 70, dimensions: {} },
      ruleHitIds: [],
    },
    {
      revisionId: 'r2',
      fileHash: 'hB',
      astDigest: 'dB',
      timestamp: 2,
      agentUid: 'a2',
      qualityScore: { compositeScore: 85, dimensions: {} },
      ruleHitIds: [],
    },
    {
      revisionId: 'r3',
      fileHash: 'hA',
      astDigest: 'dA',
      timestamp: 3,
      agentUid: 'a3',
      qualityScore: { compositeScore: 68, dimensions: {} },
      ruleHitIds: [],
    },
  ];
  const findings = regressionDetector.detectRegressions('src/cfg.ts', revisions);
  assert.ok(findings.length >= 1);
  assert.strictEqual(findings[0].rule, 'GOV-TRJ-001');
}

/**
 * Gate 4: Trajectory Recipe Extraction & Oscillation Defense Stress.
 */
async function testGate4TrajectoryOscillation(trajectoryService, regressionDetector) {
  console.log('\n[Gate 4] Verifying trajectory recipe extraction & oscillation defense...');
  await benchmarkTrajectoryLearning(trajectoryService);
  verifyCyclicOscillationDetection(regressionDetector);
}

/**
 * Gate 5: Praxis Multi-Facade SPI Synergy.
 */
async function testGate5PraxisSynergy(sliceService, trajectoryService) {
  console.log('\n[Gate 5] Verifying Praxis multi-facade SPI synergy...');
  const multiAgentService = createPraxisMultiAgentGovernanceService();
  const patches = [
    {
      agentUid: 'a1',
      patchId: 'p1',
      filePath: 'src/m1.ts',
      timestamp: 1,
      addedLines: 5,
      deletedLines: 1,
      dependenciesAdded: [],
    },
    {
      agentUid: 'a2',
      patchId: 'p2',
      filePath: 'src/m2.ts',
      timestamp: 2,
      addedLines: 8,
      deletedLines: 2,
      dependenciesAdded: [],
    },
  ];
  const agentVerdict = await multiAgentService.reviewMultiAgentPatches(patches);
  assert.strictEqual(agentVerdict.verdict, 'approved');

  const sliceVerdict = await sliceService.auditSlice({
    filePath: 'src/pricing.ts',
    oldContent: 'export function calc(b: number) { return b; }',
    newContent: 'export function calc(b: number, d = 0) { return b - d; }',
    changedLines: [1],
  });
  assert.ok(sliceVerdict.status === 'PASS' || sliceVerdict.status === 'WARN');

  const matches = trajectoryService.matchRecipes('export function test() {}');
  assert.ok(Array.isArray(matches));
  console.log('  ✔ Praxis Facades Synergy: Governance + SliceAudit + Trajectory verified in sync');
}

/**
 * Gate 6: High-Load Stress & Memory Stability Benchmark.
 */
function testGate6HighLoadStress(sliceService) {
  console.log('\n[Gate 6] Verifying high-load stress & memory stability benchmark...');
  const initialMemory = process.memoryUsage();
  const t0 = Date.now();

  for (let i = 0; i < 100; i++) {
    const vFile = `src/virtual/file_${i}.ts`;
    const code = [
      '/**',
      ' * Workload service.',
      ' */',
      `export class WorkloadService_${i} {`,
      '    /**',
      '     * Execute batch computation.',
      '     * @returns Computed sum.',
      '     */',
      '    public execute(): number {',
      '        let sum = 0;',
      '        for (let j = 0; j < 10; j++) sum += j;',
      '        return sum;',
      '    }',
      '}',
    ].join('\n');
    const density = computeEffectiveCodeDensity(code);
    assert.ok(density.effectiveDensity > 0.4);

    const plan = sliceService.getRoutingPlan(vFile, code, code + '\n// edit', [9]);
    assert.ok(plan.filePath);
  }

  const elapsed = Date.now() - t0;
  const finalMemory = process.memoryUsage();
  const heapDiffMb = (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);

  console.log(
    `  ✔ High-Load Stress: 100 files in ${elapsed}ms (Heap Diff: ${heapDiffMb.toFixed(2)}MB)`,
  );
  assert.ok(elapsed < 3000);
  assert.ok(heapDiffMb < 50);
}

/**
 * Main execution orchestration.
 */
async function main() {
  console.log('================================================================');
  console.log('🧪 Verifying End-to-End Governance & Stress Benchmark');
  console.log('================================================================');

  const sliceExtractor = new ASTSliceExtractor();
  const moeRouter = new SparseMoEGateRouter();
  const impactTracer = new CallChainImpactTracer();
  const sliceService = createPraxisSliceAuditService(sliceExtractor, moeRouter, impactTracer);

  const recipeExtractor = new TrajectoryRecipeExtractor();
  const regressionDetector = new RegressionTrajectoryDetector();
  const trajectoryService = createPraxisTrajectoryLearningService(
    recipeExtractor,
    regressionDetector,
  );

  testGate1ClosedLoop();
  testGate2MultiLanguageScenarios();
  testGate3MoESparseDispatch(sliceService, impactTracer);
  await testGate4TrajectoryOscillation(trajectoryService, regressionDetector);
  await testGate5PraxisSynergy(sliceService, trajectoryService);
  testGate6HighLoadStress(sliceService);

  console.log('\n================================================================');
  console.log('🎉 ALL CLOSED-LOOP STRESS GOVERNANCE GATES PASSED!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('\n❌ Closed-loop stress governance validation failed:', err);
  process.exit(1);
});
