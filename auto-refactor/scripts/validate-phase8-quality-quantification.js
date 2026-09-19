/**
 * Module: Verification Harness — Phase 8 Quality Quantification & Anti-Gaming
 * File Path: scripts/validate-phase8-quality-quantification.js
 * Architecture Role: Validates the 8-pillar quality model, non-linear risk penalties,
 *   severe pillar ceilings, effective code density, anti-gaming detection (GOV-GAM-001),
 *   5-level hierarchical scoring, patch quality deltas, and Praxis Diff governance.
 * Dependencies & Triggers: Consumes ../dist/api; executed in test-parallel runner.
 * Responsibilities: Run deterministic scenarios asserting anti-dilution, anti-gaming,
 *   and patch quality evaluations.
 * Exit Semantics & Design Rationale: Exits 0 on pass, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const {
  synthesizeEightPillars,
  computeRiskWeightedPenalties,
  computeEffectiveCodeDensity,
  detectScoreGaming,
  scoreFileQuality,
  aggregateProjectScore,
  evaluatePatchQuality,
  defaultPraxisGovernanceService,
  RULE_GOV_GAM_001,
} = require('../dist/api');

async function main() {
  console.log('=== [Phase 8] Testing Quality Quantification & Anti-Gaming System ===\n');

  // 1. Eight-Pillar Model and Custom Weights
  console.log('1. Testing Eight-Pillar Quality Model & Weight Synthesis...');
  const baseIndices = {
    architectureConsistency: 90,
    maintainability: 85,
    performanceEfficiency: 95,
    codeSecurity: 100,
    semanticPurity: 90,
    techDebtRisk: 80,
    standardization: 90,
    commentQuality: 85,
    duplication: 95,
    modernity: 80,
  };
  const breakdown = synthesizeEightPillars(baseIndices, 88, 92);
  assert.ok(breakdown.compositeScore > 80 && breakdown.compositeScore < 95);
  assert.strictEqual(breakdown.pillars.security, 100);
  assert.strictEqual(breakdown.pillars.data, 88);
  assert.strictEqual(breakdown.pillars.testing, 92);
  console.log('✔ Eight-pillar synthesis computed correct weighted breakdown.');

  // 2. Non-linear Risk Model & Anti-Dilution Ceilings
  console.log('2. Testing Non-linear Risk Model & Anti-Dilution Ceilings...');
  const fatalArchIssue = {
    id: 'arch-1',
    analyzer: 'architecture',
    rule: 'ARCH-HDL-001',
    severity: 'error',
    message: 'Headless core violates boundary by importing vscode UI',
    location: {
      file: 'src/core/model.ts',
      start: { line: 1, column: 1 },
      end: { line: 1, column: 20 },
    },
  };
  const riskResult = computeRiskWeightedPenalties([fatalArchIssue]);
  assert.strictEqual(riskResult.fatalIssueCount, 1);
  assert.strictEqual(riskResult.ceilings.length, 1);
  assert.strictEqual(riskResult.ceilings[0].pillar, 'architecture');
  assert.strictEqual(riskResult.ceilings[0].maxScore, 40);

  const cappedBreakdown = synthesizeEightPillars(baseIndices, 100, 100, riskResult.ceilings);
  assert.strictEqual(
    cappedBreakdown.pillars.architecture,
    40,
    'Architecture pillar must be capped at 40',
  );
  console.log('✔ Fatal architecture breach properly capped architecture pillar.');

  // 3. Effective Code Density Calculation
  console.log('3. Testing Effective Code Density (Semantic LOC vs Boilerplate)...');
  const cleanCode = [
    'export function calculateTax(amount: number): number {',
    '    if (amount <= 0) return 0;',
    '    const rate = 0.15;',
    '    return amount * rate;',
    '}',
  ].join('\n');
  const cleanDensity = computeEffectiveCodeDensity(cleanCode);
  assert.ok(
    cleanDensity.effectiveDensity >= 0.8,
    `Clean code should have high density: ${cleanDensity.effectiveDensity}`,
  );
  assert.strictEqual(cleanDensity.isLowDensity, false);

  const stubCode = [
    'export class WrapperService {',
    '    getA(): string { return this.a; }',
    '    getB(): string { return this.b; }',
    '    getC(): string { return this.c; }',
    '    getD(): string { return this.d; }',
    '    getE(): string { return this.e; }',
    '    getF(): string { return this.f; }',
    '    getG(): string { return this.g; }',
    '    getH(): string { return this.h; }',
    '    getI(): string { return this.i; }',
    '    getJ(): string { return this.j; }',
    '    getK(): string { return this.k; }',
    '    getL(): string { return this.l; }',
    '    getM(): string { return this.m; }',
    '    getN(): string { return this.n; }',
    '    getO(): string { return this.o; }',
    '}',
  ].join('\n');
  const stubDensity = computeEffectiveCodeDensity(stubCode);
  assert.ok(
    stubDensity.effectiveDensity < 0.5,
    `Boilerplate wrappers should yield low density: ${stubDensity.effectiveDensity}`,
  );
  assert.ok(stubDensity.forwardingCount >= 10, 'Must detect 10+ trivial forwarders');
  assert.strictEqual(stubDensity.isLowDensity, true);
  console.log('✔ Effective code density correctly differentiates semantic logic from boilerplate.');

  // 4. Anti-Gaming Detector (GOV-GAM-001)
  console.log('4. Testing Anti-Gaming Detector for Artificial Splitting and Tautology...');
  const gamingStubCode = [
    'export class GamingController {',
    '    method1(): void { return this.forward1(); }',
    '    method2(): void { return this.forward2(); }',
    '    method3(): void { return this.forward3(); }',
    '    method4(): void { return this.forward4(); }',
    '    method5(): void { return this.forward5(); }',
    '    method6(): void { return this.forward6(); }',
    '    method7(): void { return this.forward7(); }',
    '    method8(): void { return this.forward8(); }',
    '    method9(): void { return this.forward9(); }',
    '    method10(): void { return this.forward10(); }',
    '    method11(): void { return this.forward11(); }',
    '    method12(): void { return this.forward12(); }',
    '    method13(): void { return this.forward13(); }',
    '    method14(): void { return this.forward14(); }',
    '    method15(): void { return this.forward15(); }',
    '}',
  ].join('\n');
  const splitGaming = detectScoreGaming('src/controller/gaming.ts', gamingStubCode);
  assert.strictEqual(splitGaming.hasGaming, true, 'Artificial splitting must trigger gaming');
  assert.ok(splitGaming.gamingKinds.includes('artificial_function_splitting'));
  assert.ok(splitGaming.issues.some((i) => i.rule === RULE_GOV_GAM_001));
  assert.ok(splitGaming.gamingPenalty >= 15);

  const testGamingCode = [
    'describe("gaming test", () => {',
    '    it("fake 1", () => { expect(true).toBe(true); });',
    '    it("fake 2", () => { expect(true).toBe(true); });',
    '    it("fake 3", () => { expect(true).toBe(true); });',
    '});',
  ].join('\n');
  const testGaming = detectScoreGaming('tests/unit/fake.test.ts', testGamingCode);
  assert.strictEqual(testGaming.hasGaming, true, 'Tautological tests must trigger gaming');
  assert.ok(testGaming.gamingKinds.includes('tautological_test_padding'));
  console.log('✔ Anti-gaming detector successfully caught splitting and tautology.');

  // 5. Five-Level Hierarchical Scoring
  console.log('5. Testing Five-Level Hierarchical Quality Aggregation...');
  const file1 = scoreFileQuality('src/core/auth.ts', cleanCode, [], 'identity', 'auth');
  const file2 = scoreFileQuality('src/core/session.ts', cleanCode, [], 'identity', 'session');
  const file3 = scoreFileQuality(
    'src/data/db.ts',
    cleanCode,
    [fatalArchIssue],
    'persistence',
    'db',
  );

  const projectScore = aggregateProjectScore([file1, file2, file3]);
  assert.strictEqual(projectScore.totalFiles, 3);
  assert.strictEqual(projectScore.fatalCount, 1);
  assert.ok(projectScore.domains.length === 2);
  assert.ok(
    projectScore.eightPillars.pillars.architecture <= 45,
    'Fatal issue in file3 must cap project arch pillar',
  );
  assert.ok(['A', 'B', 'C'].includes(projectScore.grade));
  console.log(
    `✔ Five-level hierarchical scoring passed (Composite: ${projectScore.compositeScore}).`,
  );

  // 6. Patch Quality Quantification (Before / After / Delta)
  console.log('6. Testing Patch Quality (Before / After / Delta Evaluation)...');
  const patchImprovement = evaluatePatchQuality({
    filePath: 'src/core/logic.ts',
    beforeContent: stubCode,
    afterContent: cleanCode,
    existingIssues: [],
    newIssues: [],
  });
  assert.ok(patchImprovement.deltaScore > 0, 'Refactoring boilerplate must increase score');
  assert.strictEqual(patchImprovement.verdict, 'improved');
  assert.ok(patchImprovement.effectiveDensityDelta > 0);

  const patchGaming = evaluatePatchQuality({
    filePath: 'src/core/logic.ts',
    beforeContent: cleanCode,
    afterContent: gamingStubCode,
    existingIssues: [],
    newIssues: [],
  });
  assert.strictEqual(patchGaming.verdict, 'gaming_rejected');
  assert.ok(patchGaming.gamingViolations.length > 0);
  console.log('✔ Patch quality accurately computed positive delta and rejected gaming patch.');

  // 7. Praxis Diff Governance Integration
  console.log('7. Testing Praxis Diff Subsystem Delta Scoring and Gaming Gate...');
  const praxisValidResult = await defaultPraxisGovernanceService.reviewDiff({
    filePath: 'src/core/feature.ts',
    oldContent: stubCode,
    newContent: cleanCode,
  });
  assert.ok(praxisValidResult.patchQuality !== undefined, 'Must include patchQuality');
  assert.ok(praxisValidResult.deltaScore !== undefined, 'Must include deltaScore');
  assert.strictEqual(praxisValidResult.verdict.status, 'passed');

  const praxisGamingResult = await defaultPraxisGovernanceService.reviewDiff({
    filePath: 'src/core/feature.ts',
    oldContent: cleanCode,
    newContent: gamingStubCode,
  });
  assert.strictEqual(praxisGamingResult.verdict.status, 'major_rework_needed');
  assert.strictEqual(praxisGamingResult.verdict.shouldEscalateToL3A, true);
  assert.ok(praxisGamingResult.issues.some((i) => i.rule === RULE_GOV_GAM_001));
  console.log('✔ Praxis Diff governance correctly escalates gaming patches to L3A.');

  console.log('\n================================================================');
  console.log('🎉 ALL PHASE 8 QUALITY QUANTIFICATION TESTS PASSED (7/7)!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Phase 8 verification failed:', err);
  process.exit(1);
});
