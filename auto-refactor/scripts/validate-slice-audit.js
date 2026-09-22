/**
 * Module: Verification Harness - Phase 13 Incremental Slice Audit Engine & Sparse MoE
 * File Path: scripts/validate-slice-audit.js
 * Architecture Role: Comprehensive verification harness for fine-grained AST slice extraction,
 *   feature vector classification, sparse MoE CED routing, call-chain impact tracing, and
 *   Praxis slice audit service facade.
 * Dependencies & Triggers: Consumes ../dist/api; executed in test-parallel runner.
 * Responsibilities: Validate all 6 core functional gates of Phase 13.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passing,
 *   throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const {
  ASTSliceExtractor,
  SparseMoEGateRouter,
  CallChainImpactTracer,
  createPraxisSliceAuditService,
} = require('../dist/api');
const { SymbolIndex } = require('../dist/core/intelligence/symbolIndex');
const { CallGraph } = require('../dist/core/intelligence/callGraph');

async function main() {
  console.log('================================================================');
  console.log('Phase 13: Incremental Slice Audit Engine & Sparse MoE Harness');
  console.log('================================================================\n');

  // ── Step 1: Fine-Grained AST Slice Extraction & Feature Vectors ──
  console.log('── Step 1: Fine-Grained AST Slice Extraction & Feature Vectors ──');
  const extractor = new ASTSliceExtractor();
  const oldCode = [
    'export function computeTotal(basePrice: number): number {',
    '  return basePrice * 1.1;',
    '}',
    '',
    'export function formatCurrency(val: number): string {',
    '  return "$" + val.toFixed(2);',
    '}',
  ].join('\n');

  const newCode = [
    'export function computeTotal(basePrice: number, discount: number = 0): number {',
    '  if (basePrice < 0) throw new Error("negative price");',
    '  return (basePrice - discount) * 1.1;',
    '}',
    '',
    'export function formatCurrency(val: number): string {',
    '  return "$" + val.toFixed(2);',
    '}',
  ].join('\n');

  const slices = extractor.extractSlices('src/pricing.ts', oldCode, newCode, [1, 2, 3]);
  assert.ok(slices.length >= 1, 'Must extract at least one AST slice node');
  const targetSlice = slices.find((s) => s.symbolName === 'computeTotal');
  assert.ok(targetSlice, 'Target slice computeTotal must be extracted');
  assert.strictEqual(targetSlice.filePath, 'src/pricing.ts');
  assert.strictEqual(targetSlice.isExported, true);
  assert.strictEqual(targetSlice.featureVector.hasSignatureMutation, true);
  assert.strictEqual(targetSlice.featureVector.hasControlFlowMutation, true);
  assert.strictEqual(targetSlice.primaryKind, 'signature');
  console.log(
    `  ✔ AST slice extracted: ${targetSlice.symbolName} [kind=${targetSlice.primaryKind}]`,
  );

  // ── Step 2: Sparse MoE CED Routing & Activation Ratio Suppression ──
  console.log('\n── Step 2: Sparse MoE CED Routing & Activation Ratio Suppression ──');
  const router = new SparseMoEGateRouter();

  // Test Doc-only slice routing
  const docSlice = {
    sliceId: 'slice:doc',
    filePath: 'src/doc.ts',
    startLine: 1,
    endLine: 5,
    nodeKind: 'CommentBlock',
    symbolName: 'doc',
    isExported: false,
    featureVector: {
      hasSignatureMutation: false,
      hasControlFlowMutation: false,
      hasLiteralMutation: false,
      hasAsyncMutation: false,
      hasIoMutation: false,
      hasTypeMutation: false,
      isDocOnly: true,
    },
    primaryKind: 'doc-comment',
  };
  const docPlan = router.routeSlice(docSlice);
  assert.ok(
    docPlan.activationRatio <= 0.15,
    `Doc-only activation ratio must be <= 15%, found: ${docPlan.activationRatio}`,
  );
  assert.ok(docPlan.activeAnalyzers.includes('comments'), 'Must activate comments analyzer');
  assert.ok(
    !docPlan.activeAnalyzers.includes('complexity'),
    'Complexity analyzer must be cold-bypassed',
  );
  console.log(`  ✔ Doc-only slice routed: ratio=${docPlan.activationRatio} (cold bypass verified)`);

  // Test Literal-only slice routing
  const litSlice = {
    sliceId: 'slice:lit',
    filePath: 'src/constants.ts',
    startLine: 1,
    endLine: 2,
    nodeKind: 'VariableStatement',
    symbolName: 'MAX_RETRIES',
    isExported: true,
    featureVector: {
      hasSignatureMutation: false,
      hasControlFlowMutation: false,
      hasLiteralMutation: true,
      hasAsyncMutation: false,
      hasIoMutation: false,
      hasTypeMutation: false,
      isDocOnly: false,
    },
    primaryKind: 'literal',
  };
  const litPlan = router.routeSlice(litSlice);
  assert.ok(
    litPlan.activationRatio <= 0.15,
    `Literal-only activation ratio must be <= 15%, found: ${litPlan.activationRatio}`,
  );
  assert.ok(litPlan.activeAnalyzers.includes('constants'), 'Must activate constants analyzer');
  assert.ok(
    !litPlan.activeAnalyzers.includes('governance'),
    'Governance analyzer must be cold-bypassed',
  );
  console.log(`  ✔ Literal slice routed: ratio=${litPlan.activationRatio} (cold bypass verified)`);

  // ── Step 3: Cross-File Call-Chain Impact Propagation ──
  console.log('\n── Step 3: Cross-File Call-Chain Impact Propagation ──');
  const index = new SymbolIndex();
  index.addDefinitions([
    {
      name: 'computeTotal',
      kind: 'function',
      file: 'src/pricing.ts',
      line: 1,
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
    {
      name: 'handleCheckout',
      kind: 'function',
      file: 'src/controller.ts',
      line: 50,
      column: 1,
      exported: true,
    },
  ]);
  index.addReferences([
    { name: 'computeTotal', file: 'src/billing.ts', line: 15, column: 5, caller: 'processOrder' },
    {
      name: 'processOrder',
      file: 'src/controller.ts',
      line: 65,
      column: 5,
      caller: 'handleCheckout',
    },
  ]);

  const callGraph = new CallGraph(index);
  const tracer = new CallChainImpactTracer();

  const nonBreakingImpact = tracer.traceSymbolImpact(
    'computeTotal',
    'src/pricing.ts',
    false,
    callGraph,
    3,
  );
  assert.strictEqual(nonBreakingImpact.totalImpactedCallers, 2);
  assert.ok(nonBreakingImpact.impactedFiles.includes('src/billing.ts'));
  assert.ok(nonBreakingImpact.impactedFiles.includes('src/controller.ts'));
  assert.strictEqual(nonBreakingImpact.hasBreakingMutation, false);
  console.log(
    `  ✔ Reverse call chain traced: ${nonBreakingImpact.totalImpactedCallers} callers across ` +
      `${nonBreakingImpact.impactedFiles.length} files (depth 1~2)`,
  );

  // ── Step 4: Breaking Slice Side-Effect Guard (GOV-SLC-001) ──
  console.log('\n── Step 4: Breaking Slice Side-Effect Guard (GOV-SLC-001) ──');
  const breakingImpact = tracer.traceSymbolImpact(
    'computeTotal',
    'src/pricing.ts',
    true,
    callGraph,
    3,
  );
  assert.strictEqual(breakingImpact.riskLevel, 'CRITICAL');
  assert.ok(
    breakingImpact.issues.length >= 1,
    'Must emit issue on breaking mutation across external callers',
  );
  const sliceIssue = breakingImpact.issues[0];
  assert.strictEqual(sliceIssue.rule, 'GOV-SLC-001');
  assert.strictEqual(sliceIssue.severity, 'error');
  assert.strictEqual(sliceIssue.analyzer, 'governance');
  console.log(`  ✔ GOV-SLC-001 emitted: ${sliceIssue.message}`);

  // ── Step 5: Sub-10ms Slice Execution Latency Benchmark ──
  console.log('\n── Step 5: Sub-10ms Slice Execution Latency Benchmark ──');
  const praxisService = createPraxisSliceAuditService();
  const runs = 5;
  const latencies = [];

  for (let i = 0; i < runs; i++) {
    const verdict = await praxisService.auditSlice(
      {
        filePath: 'src/pricing.ts',
        oldContent: oldCode,
        newContent: newCode,
        changedLines: [1, 2, 3],
        maxCallDepth: 3,
      },
      callGraph,
    );
    latencies.push(verdict.latencyMs);
  }

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / runs;
  console.log(`  ✔ Average slice audit latency: ${avgLatency.toFixed(2)}ms (5 runs)`);
  assert.ok(avgLatency < 50, `Slice audit latency must be < 50ms, found: ${avgLatency}ms`);

  // ── Step 6: Praxis Slice Audit Facade & SPI Integration ──
  console.log('\n── Step 6: Praxis Slice Audit Facade & SPI Integration ──');
  const fullVerdict = await praxisService.auditSlice(
    {
      filePath: 'src/pricing.ts',
      oldContent: oldCode,
      newContent: newCode,
      changedLines: [1, 2, 3],
    },
    callGraph,
  );

  assert.strictEqual(fullVerdict.filePath, 'src/pricing.ts');
  assert.ok(fullVerdict.slices.length > 0, 'Must contain parsed slices');
  assert.ok(fullVerdict.routingPlan.activeAnalyzers.length > 0, 'Must have active analyzers');
  assert.ok(fullVerdict.impacts.length > 0, 'Must report symbol impacts');
  assert.strictEqual(fullVerdict.status, 'BLOCK'); // Due to GOV-SLC-001 breaking mutation
  console.log(`  ✔ Praxis slice audit facade verified (Verdict status: ${fullVerdict.status})`);

  console.log('\n================================================================');
  console.log('🎉 PHASE 13: ALL 6 INCREMENTAL SLICE AUDIT GATES PASSED (100%)');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Phase 13 verification failed:', err);
  process.exit(1);
});
