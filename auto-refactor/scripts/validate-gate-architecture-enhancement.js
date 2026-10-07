#!/usr/bin/env node
/**
 * Module: Verification Harness — Gate Architecture Enhancement & Quantification Model
 * File Path: scripts/validate-gate-architecture-enhancement.js
 * Architecture Role: Comprehensive verification suite testing gate governance extensions,
 *   preflight sparse index activation, ten-dimensional scoring deduction integration,
 *   Bayesian scope normalization, analyzer registry completeness, and anti-gaming gates.
 * Dependencies & Triggers: `npm run validate-gate-architecture-enhancement` or `npm test`;
 *   imports dist/core/governance, dist/core/preflight, dist/core/scoring, dist/core/praxis.
 * Responsibilities:
 *   1. Verify FileRoleInference, AuditIndex, SparseActivator for gate infrastructure.
 *   2. Verify GATE-MSG-002, GATE-AST-001, GATE-FAC-001, GATE-PROC-001 rule logic.
 *   3. Verify scoring deduction mappings for gate-architecture, shell-lint, simplify, go-modern.
 *   4. Verify Bayesian Gaussian belief updating and multi-scale confidence clamping [0.60, 1.00].
 *   5. Verify zero analyzer fracture across all 30 built-in analyzers in BUILTIN_FACTORIES.
 *   6. Verify composite quality gate anti-gaming detection and verdict resolution.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passed; exits 1 on error.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  inferFileRole,
  isGateInfrastructure,
} = require('../dist/core/intelligence/file-role-inference');
const {
  resolveFileAuditType,
  resolveLanguageFromPath,
} = require('../dist/core/preflight/audit-index');
const { activateSparseAnalyzers } = require('../dist/core/preflight/sparse-activator');
const { ANALYZER_SLICE_DOMAIN } = require('../dist/core/preflight/slice-partitioner');
const { auditGateArchitecture } = require('../dist/core/governance/gate-governance');
const { DIMENSION_RULES } = require('../dist/core/scoring/dimensionRuleTable');
const {
  familyDimensionOf,
  classifyDebtTier,
  calculateCompoundedDeduction,
} = require('../dist/core/scoring/dimensionDeductions');
const { DIMENSION_ANALYZERS } = require('../dist/core/scoring/scoringTypes');
const {
  normalizeScopeQuality,
  calculateScopeCompleteness,
  calculateCompositeConfidence,
} = require('../dist/core/preflight/scope-normalizer');
const { BUILTIN_FACTORIES } = require('../dist/core/analyzer-registry');
const { evaluateCompositeGate } = require('../dist/core/praxis/composite-quality-gate');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gate-enhancement-${prefix}-`));
}

function cleanTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

console.log('Testing Gate Architecture Enhancement & Quantification Model...');

// ── Test 1: Preflight Index & Sparse Activator Integration ──
(function testPreflightGateInfrastructureAndPolyglot() {
  // 1.1 FileRoleInference
  const gateFiles = [
    '.githooks/pre-commit',
    'scripts/sh/pre-commit-gate.sh',
    'scripts/ps1/commit-msg-gate.ps1',
    'scripts/pre-push-gate.sh',
  ];
  for (const f of gateFiles) {
    assert.strictEqual(
      isGateInfrastructure(f),
      true,
      `Expected isGateInfrastructure to be true for ${f}`,
    );
    assert.strictEqual(
      inferFileRole(f).role,
      'gate_infrastructure',
      `Expected inferFileRole to return gate_infrastructure for ${f}`,
    );
  }

  // 1.2 AuditIndex FileAuditType and LanguageKind
  assert.strictEqual(
    resolveFileAuditType('scripts/sh/pre-commit-gate.sh', 'gate_infrastructure'),
    'gate',
  );
  assert.strictEqual(resolveLanguageFromPath('service.go'), 'go');
  assert.strictEqual(resolveLanguageFromPath('pre-commit-gate.sh'), 'shell');
  assert.strictEqual(resolveLanguageFromPath('commit-msg-gate.ps1'), 'shell');

  // 1.3 SparseActivator affinity
  const gateIndexEntry = {
    filePath: 'scripts/sh/pre-commit-gate.sh',
    type: 'gate',
    role: 'gate_infrastructure',
    lang: 'shell',
    eloc: { physicalLines: 120, nonBlankLines: 100, estimatedEloc: 80 },
    deps: { imports: [], exports: [], fanIn: 1, fanOut: 0 },
    risk: {
      inherentRisk: 0.9,
      isHighFanIn: false,
      isSecuritySensitive: false,
      historicalDefectDensity: 0,
    },
    history: { recentFindingCount: 0, recentRuleIds: [] },
    indexedAt: Date.now(),
  };

  const gateResult = activateSparseAnalyzers(
    ['gate-architecture'],
    [gateIndexEntry],
    { mode: 'CHANGESET' },
    new Set(['scripts/sh/pre-commit-gate.sh']),
  );
  assert.ok(
    gateResult.activatedAnalyzers.includes('gate-architecture'),
    'gate-architecture must be activated on gate infrastructure file',
  );

  const businessEntry = {
    filePath: 'src/services/billing.ts',
    type: 'source',
    role: 'business_module',
    lang: 'typescript',
    eloc: { physicalLines: 200, nonBlankLines: 180, estimatedEloc: 150 },
    deps: { imports: [], exports: [], fanIn: 2, fanOut: 1 },
    risk: {
      inherentRisk: 0.3,
      isHighFanIn: false,
      isSecuritySensitive: false,
      historicalDefectDensity: 0,
    },
    history: { recentFindingCount: 0, recentRuleIds: [] },
    indexedAt: Date.now(),
  };
  const businessResult = activateSparseAnalyzers(
    ['gate-architecture'],
    [businessEntry],
    { mode: 'CHANGESET' },
    new Set(['src/services/billing.ts']),
  );
  assert.strictEqual(
    businessResult.activatedAnalyzers.includes('gate-architecture'),
    false,
    'gate-architecture must stay dormant on business files in CHANGESET mode',
  );

  // 1.4 SlicePartitioner assignment
  assert.strictEqual(ANALYZER_SLICE_DOMAIN['gate-architecture'], 'architecture_coupling');
  assert.strictEqual(ANALYZER_SLICE_DOMAIN['go-modern'], 'modernity_governance');
  assert.strictEqual(ANALYZER_SLICE_DOMAIN['performance'], 'ast_complexity');

  console.log('  [PASS] 1. Preflight index & sparse activator gate integration');
})();

// ── Test 2: Gate Governance Extended Rules ──
(function testGateGovernanceExtendedRules() {
  const dir = createTempDir('extended-rules');
  try {
    fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts', 'ps1'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts', 'sh'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts', 'common'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });

    // CI and hooks scaffolding
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n');
    fs.writeFileSync(path.join(dir, '.githooks', 'pre-commit'), '#!/bin/sh\nexec pwsh "$@"\n');
    fs.writeFileSync(path.join(dir, '.githooks', 'commit-msg'), '#!/bin/sh\nexec pwsh "$@"\n');
    fs.writeFileSync(path.join(dir, '.githooks', 'pre-push'), '#!/bin/sh\nexec pwsh "$@"\n');

    // Minimal scripts lacking the 4 new contracts
    fs.writeFileSync(
      path.join(dir, 'scripts', 'ps1', 'pre-commit-gate.ps1'),
      `$ErrorActionPreference = 'Stop'\n# 0-byte check\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'scripts', 'ps1', 'commit-msg-gate.ps1'),
      `$ErrorActionPreference = 'Stop'\n# commit-msg\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'scripts', 'ps1', 'pre-push-gate.ps1'),
      `$ErrorActionPreference = 'Stop'\n# pre-push\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'scripts', 'sh', 'pre-commit-gate.sh'),
      `set -euo pipefail\n# 0-byte check\n`,
    );

    // Initial audit should flag GATE-MSG-002, GATE-AST-001, GATE-FAC-001
    const unhardenedResult = auditGateArchitecture(dir);
    const unhardenedRules = unhardenedResult.issues.map((i) => i.rule);
    assert.ok(
      unhardenedRules.includes('GATE-MSG-002'),
      'GATE-MSG-002 must trigger when commit-msg-forbidden-terms is unwired',
    );
    assert.ok(
      unhardenedRules.includes('GATE-AST-001'),
      'GATE-AST-001 must trigger when validate-staged-slice is unwired',
    );
    assert.ok(
      unhardenedRules.includes('GATE-FAC-001'),
      'GATE-FAC-001 must trigger when facade discipline check is unwired',
    );

    // Test GATE-PROC-001: bare Read-Host without redirection guard
    fs.writeFileSync(
      path.join(dir, 'scripts', 'ps1', 'interactive-gate.ps1'),
      `$ErrorActionPreference = 'Stop'\nRead-Host "Enter confirmation"\n`,
    );
    const procResult = auditGateArchitecture(dir);
    assert.ok(
      procResult.issues.some((i) => i.rule === 'GATE-PROC-001'),
      'GATE-PROC-001 must trigger when Read-Host lacks redirection guard',
    );

    // Harden the scripts and add bilingual terms dictionary
    fs.writeFileSync(
      path.join(dir, 'scripts', 'common', 'commit-msg-forbidden-terms.json'),
      JSON.stringify({
        patterns: [{ regex: '临时改动', reason: 'temporary phrasing' }],
        asciiPatterns: [{ regex: 'tone down', reason: 'meta-narrative slogan' }],
      }),
    );
    fs.writeFileSync(
      path.join(dir, 'scripts', 'ps1', 'commit-msg-gate.ps1'),
      `$ErrorActionPreference = 'Stop'\n# commit-msg-forbidden-terms.json wired\nnode validate-commit-msg-style.js\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'scripts', 'ps1', 'pre-commit-gate.ps1'),
      `$ErrorActionPreference = 'Stop'\n# 0-byte check\nnode validate-staged-slice.js\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'scripts', 'ps1', 'pre-push-gate.ps1'),
      `$ErrorActionPreference = 'Stop'\n# facade-discipline check\nnode validate-facade.js\n`,
    );
    fs.writeFileSync(
      path.join(dir, 'scripts', 'ps1', 'interactive-gate.ps1'),
      `$ErrorActionPreference = 'Stop'\nif ([Environment]::UserInteractive -and -not [Console]::IsOutputRedirected) { Read-Host "Prompt" }\n`,
    );

    const hardenedResult = auditGateArchitecture(dir);
    const remainingNewIssues = hardenedResult.issues.filter((i) =>
      ['GATE-MSG-002', 'GATE-AST-001', 'GATE-FAC-001', 'GATE-PROC-001'].includes(i.rule),
    );
    assert.strictEqual(
      remainingNewIssues.length,
      0,
      `Hardened gate scripts must clear all 4 new gate rules, remaining: ${JSON.stringify(remainingNewIssues)}`,
    );

    console.log('  [PASS] 2. Gate governance extended rules (GATE-MSG-002, AST, FAC, PROC)');
  } finally {
    cleanTempDir(dir);
  }
})();

// ── Test 3: Ten-Dimensional Scoring & Deduction Integration ──
(function testTenDimensionalScoringDeductions() {
  // 3.1 Verify DIMENSION_RULES contains entries for gate, shell, simplify, go-modern
  const gateRows = DIMENSION_RULES.filter((r) => r.analyzer === 'gate-architecture');
  assert.ok(gateRows.length >= 3, 'gate-architecture must have at least 3 deduction rows');
  assert.ok(
    gateRows.some((r) => r.dimension === 'architectureConsistency'),
    'gate-architecture must deduct architectureConsistency',
  );
  assert.ok(
    gateRows.some((r) => r.dimension === 'maintainability'),
    'gate-architecture must deduct maintainability',
  );
  assert.ok(
    gateRows.some((r) => r.dimension === 'standardization'),
    'gate-architecture must deduct standardization',
  );

  const shellRows = DIMENSION_RULES.filter((r) => r.analyzer === 'shell-lint');
  assert.ok(shellRows.length >= 2, 'shell-lint must have deduction rows');

  const simplifyRows = DIMENSION_RULES.filter((r) => r.analyzer === 'simplify');
  assert.ok(simplifyRows.length >= 3, 'simplify must have deduction rows');

  const goRows = DIMENSION_RULES.filter((r) => r.analyzer === 'go-modern');
  assert.ok(goRows.length >= 1, 'go-modern must have deduction rows');

  // 3.2 Verify FAMILY_DIMENSIONS routing
  assert.strictEqual(familyDimensionOf('GATE-SYS-001'), 'architectureConsistency');
  assert.strictEqual(familyDimensionOf('GATE-ERR-001'), 'maintainability');
  assert.strictEqual(familyDimensionOf('GATE-MSG-002'), 'standardization');
  assert.strictEqual(familyDimensionOf('SH-ERR-001'), 'maintainability');
  assert.strictEqual(familyDimensionOf('SH-001'), 'standardization');
  assert.strictEqual(familyDimensionOf('SIM-BOOL-001'), 'maintainability');
  assert.strictEqual(familyDimensionOf('GOM-CTX-001'), 'modernity');

  // 3.3 Verify Non-linear Compounding Deduction
  const basePoints = 15;
  const deductionInitial = calculateCompoundedDeduction(basePoints, 0, 0.5);
  const deductionRepeated = calculateCompoundedDeduction(basePoints, 1, 0.5);
  const deductionCompound = calculateCompoundedDeduction(basePoints, 5, 0.5);
  assert.strictEqual(deductionInitial, 15);
  assert.ok(
    deductionRepeated > deductionInitial,
    `Repeated defect must increase deduction points (${deductionRepeated} > ${deductionInitial})`,
  );
  assert.ok(
    deductionCompound > deductionRepeated,
    `Higher defect count must compound sublinearly (${deductionCompound} > ${deductionRepeated})`,
  );

  // 3.4 Verify Debt Tier Classification
  const critIssue = {
    rule: 'GATE-SYS-001',
    analyzer: 'gate-architecture',
    severity: 'error',
    message: 'crit',
  };
  assert.strictEqual(classifyDebtTier(critIssue), 1, 'GATE-SYS error must be Tier 1');
  const evoIssue = {
    rule: 'CPX-NEST-001',
    analyzer: 'complexity',
    severity: 'warning',
    message: 'evo',
  };
  assert.strictEqual(classifyDebtTier(evoIssue), 2, 'CPX-NEST warning must be Tier 2');
  const smellIssue = {
    rule: 'HYG-NAM-001',
    analyzer: 'hygiene',
    severity: 'info',
    message: 'smell',
  };
  assert.strictEqual(classifyDebtTier(smellIssue), 3, 'HYG-NAM info must be Tier 3');

  console.log('  [PASS] 3. Ten-dimensional scoring deductions & family routing');
})();

// ── Test 4: Bayesian Scope Normalization & Confidence Bounds ──
(function testBayesianScopeNormalizationAndConfidence() {
  // 4.1 Scope completeness
  const fullCompleteness = calculateScopeCompleteness(1000, 1000, 1000);
  assert.strictEqual(fullCompleteness, 1.0);
  const partialCompleteness = calculateScopeCompleteness(50, 100, 10000);
  assert.ok(
    partialCompleteness >= 0.1 && partialCompleteness <= 1.0,
    `Scope completeness must be bounded in [0.1, 1.0], got ${partialCompleteness}`,
  );

  // 4.2 Composite confidence clamping [0.60, 1.00]
  const floorConf = calculateCompositeConfidence(0.01, 0.01, 0.01);
  assert.strictEqual(floorConf, 0.6, `Confidence floor must be clamped at 0.60, got ${floorConf}`);
  const maxConf = calculateCompositeConfidence(1.0, 1.0, 1.0);
  assert.strictEqual(maxConf, 1.0, `Max confidence must be clamped at 1.00, got ${maxConf}`);

  // 4.3 Bayesian Conjugate Gaussian belief update in CHANGESET mode
  const priorMean = 90.0;
  const assessment = normalizeScopeQuality({
    mode: 'CHANGESET',
    priorProjectMean: priorMean,
    priorProjectConfidence: 0.85,
    sliceBeforeScores: { architectureConsistency: 85, standardization: 85 },
    sliceAfterScores: { architectureConsistency: 95, standardization: 95 },
    elocAudited: 40,
    elocBlastRadius: 80,
    elocTotalProject: 10000,
    elocSemantic: 35,
    averageEvidenceConfidence: 0.95,
  });

  assert.strictEqual(assessment.mode, 'CHANGESET');
  assert.ok(assessment.changesetDelta, 'changesetDelta must be present');
  assert.strictEqual(assessment.changesetDelta.deltaQ, 10);
  assert.ok(
    assessment.projectBaseline.mean >= priorMean,
    `Positive deltaQ should gently shift project mean upward (prior=${priorMean}, post=${assessment.projectBaseline.mean})`,
  );
  // Verify 95% Confidence Interval
  const [ciLower, ciUpper] = assessment.projectBaseline.confidenceInterval95;
  assert.ok(ciLower <= assessment.projectBaseline.mean, 'ciLower <= mean');
  assert.ok(ciUpper >= assessment.projectBaseline.mean, 'ciUpper >= mean');
  assert.ok(assessment.projectBaseline.confidence >= 0.6, 'confidence >= 0.60');

  console.log('  [PASS] 4. Bayesian scope normalization & multi-scale confidence bounds');
})();

// ── Test 5: Analyzer Registry & Zero Fracture Verification ──
(function testAnalyzerRegistryZeroFracture() {
  const factoryKeys = Object.keys(BUILTIN_FACTORIES);
  assert.strictEqual(
    factoryKeys.length,
    30,
    `Expected exactly 30 built-in analyzers in BUILTIN_FACTORIES, found ${factoryKeys.length}`,
  );

  for (const name of factoryKeys) {
    const factory = BUILTIN_FACTORIES[name];
    assert.strictEqual(typeof factory, 'function', `Factory for ${name} must be a function`);
    const instance = factory();
    assert.ok(instance, `Instance of ${name} must be created`);
    assert.strictEqual(instance.name, name, `Instance name must match ${name}`);
    const hasAnalyzeOrFinalize =
      typeof instance.analyze === 'function' || typeof instance.finalize === 'function';
    assert.ok(hasAnalyzeOrFinalize, `Analyzer ${name} must implement analyze or finalize`);
  }

  // Verify all 30 appear in DIMENSION_ANALYZERS
  const allDeclaredAnalyzers = new Set();
  for (const analyzers of Object.values(DIMENSION_ANALYZERS)) {
    for (const a of analyzers) allDeclaredAnalyzers.add(a);
  }
  for (const name of factoryKeys) {
    assert.ok(
      allDeclaredAnalyzers.has(name),
      `Analyzer ${name} must be wired into DIMENSION_ANALYZERS`,
    );
  }

  console.log('  [PASS] 5. Analyzer registry completeness & zero fracture (30/30 wired)');
})();

// ── Test 6: Anti-Gaming & Composite Quality Gate ──
(function testAntiGamingAndCompositeGate() {
  // Scenario 6.1: Anti-gaming penalty blocks pre-push gate
  const gamedResult = evaluateCompositeGate({
    stage: 'pre-push',
    staticPass: true,
    dynamicPass: true,
    counters: { processed: 200, semantic: 10, changed: 200 },
    metrics: {
      qed: 0.05,
      deltaQSemantic: 0.5,
      regressionDensity: 0.0,
      reviewYield: 0.8,
      gamingPenalty: 0.45,
      beforeScore: 88,
      afterScore: 88.5,
      debtDelta: { regressionFindingsCount: 0 },
    },
  });

  assert.strictEqual(gamedResult.passed, false, 'Gaming penalty in pre-push must fail gate');
  assert.strictEqual(
    gamedResult.verdictCode,
    'BLOCK_GAMING_DETECTED',
    `Verdict must be BLOCK_GAMING_DETECTED, got ${gamedResult.verdictCode}`,
  );

  // Scenario 6.2: Legitimate change passes gate
  const validResult = evaluateCompositeGate({
    stage: 'pre-commit',
    staticPass: true,
    dynamicPass: true,
    counters: { processed: 100, semantic: 80, changed: 100 },
    metrics: {
      qed: 0.12,
      deltaQSemantic: 2.0,
      regressionDensity: 0.0,
      reviewYield: 0.9,
      gamingPenalty: 0.0,
      beforeScore: 88,
      afterScore: 90,
      debtDelta: { regressionFindingsCount: 0 },
    },
  });

  assert.strictEqual(validResult.passed, true, 'Legitimate change must pass gate');
  assert.strictEqual(validResult.verdictCode, 'PASS');

  console.log('  [PASS] 6. Anti-gaming detection & composite quality gate evaluation');
})();

console.log('\n ALL GATE ARCHITECTURE ENHANCEMENT VERIFICATION CHECKS PASSED!\n');
