/**
 * Module: Verification Harness — Scoring Parameters & Operator Invariants
 * File Path: scripts/validate-scoring-parameters.js
 * Architecture Role: Locks the scoring parameter single source of truth and the mathematical
 *   invariants that depend on it: default resolution, deep partial overrides, boundary rejection,
 *   the macro-file damping continuity, clone-density originality, non-compensatory CAI
 *   aggregation, and the canonical anti-gaming conjunction.
 * Dependencies & Triggers: Consumes dist/core scoring modules; executed by `npm test`.
 * Responsibilities:
 *   1. Assert the frozen defaults resolve to themselves and that partial overrides deep-merge;
 *   2. Assert invalid weights, ratios, and scale constants are rejected at the boundary;
 *   3. Assert the scale factor curve is continuous at the knee and damped past it;
 *   4. Assert originality is density-based and no longer pinned by duplicated literals;
 *   5. Assert the CAI geometric mean cannot be masked by healthy axes;
 *   6. Assert the anti-gaming conjunction needs BOTH a trivial ratio and non-positive debt.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_SCORING_CONFIG,
  resolveScoringConfig,
  assertValidScoringConfig,
} = require('../dist/core/scoring/scoring-parameters');
const {
  sanitizeScaleFactor,
  applyScaleDampedScores,
  computeSecurityCeiling,
  SATURATION_HALFPOINT,
} = require('../dist/core/scoring/scorer-formulas');
const { evaluateAntiGamingConjunction } = require('../dist/core/scoring/antiGaming');
const { evaluateProjectAutonomy } = require('../dist/core/scoring/autonomy-scorer');
const { ALL_QUALITY_DIMENSIONS } = require('../dist/core/scoring/scoringTypes');

/** Build a deduction record where only the named dimension carries points. */
function deductionsOf(points) {
  const record = {};
  for (const dim of ALL_QUALITY_DIMENSIONS) {
    record[dim] = points[dim] || 0;
  }
  return record;
}

function testDefaultResolution() {
  console.log('1. Testing default parameter resolution and deep partial overrides...');
  const base = resolveScoringConfig();
  assert.strictEqual(base, DEFAULT_SCORING_CONFIG, 'No override must return the frozen default');
  assert.ok(Object.isFrozen(base), 'Resolved defaults must be frozen');

  const autonomyMass =
    base.autonomy.weights.effectiveLoc +
    base.autonomy.weights.symbolCall +
    base.autonomy.weights.domainKernel +
    base.autonomy.weights.codeOriginality +
    base.autonomy.weights.supplyChainResilience +
    base.autonomy.weights.criticalPathAutonomy;
  assert.ok(
    Math.abs(autonomyMass - 1.0) < 1e-9,
    `Autonomy weights must sum to 1, got ${autonomyMass}`,
  );
  assert.strictEqual(base.autonomy.aggregationMode, 'geometric', 'CAI must default to geometric');

  const tuned = resolveScoringConfig({
    autonomy: { weights: { codeOriginality: 0.4 }, aggregationMode: 'arithmetic' },
    quality: { saturationHalfpoint: 12 },
  });
  assert.strictEqual(tuned.autonomy.weights.codeOriginality, 0.4, 'Override must apply');
  assert.strictEqual(
    tuned.autonomy.weights.effectiveLoc,
    DEFAULT_SCORING_CONFIG.autonomy.weights.effectiveLoc,
    'Unspecified weight must keep its default',
  );
  assert.strictEqual(tuned.autonomy.aggregationMode, 'arithmetic');
  assert.strictEqual(tuned.quality.saturationHalfpoint, 12);
  assert.strictEqual(
    tuned.quality.macroFileKneeScale,
    DEFAULT_SCORING_CONFIG.quality.macroFileKneeScale,
    'Unspecified quality field must keep its default',
  );
  assert.strictEqual(
    DEFAULT_SCORING_CONFIG.autonomy.aggregationMode,
    'geometric',
    'Merging must not mutate the frozen default',
  );
  console.log('   ✓ Default resolution and deep merge verified.');
}

function testBoundaryRejection() {
  console.log('2. Testing parameter boundary rejection...');
  const zeroMass = resolveScoringConfig({
    autonomy: {
      weights: {
        effectiveLoc: 0,
        symbolCall: 0,
        domainKernel: 0,
        codeOriginality: 0,
        supplyChainResilience: 0,
        criticalPathAutonomy: 0,
      },
    },
  });
  assert.throws(
    () => assertValidScoringConfig(zeroMass),
    RangeError,
    'Zero weight mass must throw',
  );

  const negative = resolveScoringConfig({
    autonomy: { weights: { effectiveLoc: -0.5 } },
  });
  assert.throws(() => assertValidScoringConfig(negative), RangeError, 'Negative weight must throw');

  const badRatio = resolveScoringConfig({
    antiGaming: { semanticChangeRatioThreshold: 1.5 },
  });
  assert.throws(() => assertValidScoringConfig(badRatio), RangeError, 'Ratio > 1 must throw');

  const badHalfpoint = resolveScoringConfig({ quality: { saturationHalfpoint: 0 } });
  assert.throws(
    () => assertValidScoringConfig(badHalfpoint),
    RangeError,
    'Zero half-point must throw',
  );

  assert.ok(assertValidScoringConfig(resolveScoringConfig()), 'Valid config must pass');
  console.log('   ✓ Boundary rejection verified.');
}

function testScaleFactorCurve() {
  console.log('3. Testing scale factor curve continuity and macro-file damping...');
  const identity = sanitizeScaleFactor(1);
  assert.ok(Math.abs(identity - 1) < 1e-9, `Scale at baseline must be 1, got ${identity}`);

  const microTop = sanitizeScaleFactor(0.9999);
  assert.ok(microTop <= 1.0 && microTop > 0.99, `Micro-file top must approach 1, got ${microTop}`);

  const microLow = sanitizeScaleFactor(0.0001);
  assert.ok(
    microLow > 0.19 && microLow < 0.21,
    `Micro-file floor must approach 0.2, got ${microLow}`,
  );

  const knee = DEFAULT_SCORING_CONFIG.quality.macroFileKneeScale;
  const atKnee = sanitizeScaleFactor(knee);
  const nearKnee = sanitizeScaleFactor(knee - 1e-6);
  assert.ok(
    Math.abs(atKnee - nearKnee) < 1e-4,
    `Curve must be continuous at the knee (${atKnee} vs ${nearKnee})`,
  );

  // A 10,000-line file is scale 100. Linear scaling would hand it a hundred-fold divisor and let
  // the hyperbolic curve report a near-perfect index for a badly bloated file.
  const huge = sanitizeScaleFactor(100);
  assert.ok(huge < 20, `Macro damping must cap scale 100 well below 20, got ${huge}`);
  assert.ok(huge > knee, `Damping must stay above the knee, got ${huge}`);

  let previous = 0;
  for (let scale = knee; scale <= 500; scale += 1) {
    const value = sanitizeScaleFactor(scale);
    assert.ok(value >= previous, 'Scale factor must stay monotonically non-decreasing');
    previous = value;
  }

  const monotonePoints = applyScaleDampedScores(
    deductionsOf({ maintainability: 500 }),
    100,
  ).maintainability;
  const linearEquivalent = (100 * SATURATION_HALFPOINT) / (SATURATION_HALFPOINT + 500 / 100);
  assert.ok(
    monotonePoints < linearEquivalent,
    `Damped index (${monotonePoints}) must be harsher than the undamped one (${linearEquivalent})`,
  );
  console.log('   ✓ Scale curve continuity and macro damping verified.');
}

function testSecurityCeilingConfig() {
  console.log('4. Testing configurable security attack surface ceiling...');
  const clean = computeSecurityCeiling({ exportedSymbols: 0, nonBlankLines: 0 });
  assert.ok(clean > 99.4 && clean <= 100, `Clean ceiling must stay near 100, got ${clean}`);

  const exposed = computeSecurityCeiling({ exportedSymbols: 500, nonBlankLines: 5000 });
  assert.ok(
    exposed >= 99.4,
    `Exposed ceiling must stay above the documented floor, got ${exposed}`,
  );

  const tuned = computeSecurityCeiling({ exportedSymbols: 500, nonBlankLines: 5000 }, 1, {
    exportWeight: 0.6,
    locWeight: 0.4,
    exportLimit: 30,
    locLimit: 500,
    maxDiscount: 1.0,
    baselineLines: 100,
  });
  assert.ok(tuned < exposed, `A larger maxDiscount must lower the ceiling (${tuned} < ${exposed})`);
  console.log('   ✓ Security ceiling parameterization verified.');
}

function testOriginalityDensityScaling() {
  console.log('5. Testing density-based originality and literal decoupling...');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoring-originality-'));

  /** Build a synthetic proprietary file of the requested size. */
  function makeFile(lines) {
    const body = [];
    for (let i = 0; i < lines; i++) {
      body.push(`export const value${i} = ${i};`);
    }
    return {
      file: 'src/core/logic.ts',
      lines,
      characters: lines * 30,
      nonBlankLines: lines,
      content: body.join('\n'),
    };
  }

  /** Build `count` clone findings, the only rule that feeds originality. */
  function makeCloneIssues(count) {
    const issues = [];
    for (let i = 0; i < count; i++) {
      issues.push({
        id: `hygiene:HYG-CLN-001:src/core/logic.ts:${i}`,
        analyzer: 'hygiene',
        rule: 'HYG-CLN-001',
        severity: 'warning',
        message: 'duplicate block',
        location: {
          file: 'src/core/logic.ts',
          start: { line: i + 1, column: 1 },
          end: { line: i + 1, column: 80 },
        },
      });
    }
    return issues;
  }

  /** Build `count` duplicate-literal findings, which must NOT feed originality. */
  function makeLiteralIssues(count) {
    const issues = [];
    for (let i = 0; i < count; i++) {
      issues.push({
        id: `constants:duplicate-literal:src/core/logic.ts:${i}`,
        analyzer: 'constants',
        rule: 'duplicate-literal',
        severity: 'info',
        message: 'repeated literal',
        location: {
          file: 'src/core/logic.ts',
          start: { line: i + 1, column: 1 },
          end: { line: i + 1, column: 80 },
        },
      });
    }
    return issues;
  }

  try {
    const config = { root: tempDir };

    // 5.1 A large clean tree must report 100% originality.
    const largeClean = evaluateProjectAutonomy([makeFile(2000)], [], config);
    assert.strictEqual(
      largeClean.dimensions.codeOriginality,
      100,
      `Clean large tree must report 100 originality, got ${largeClean.dimensions.codeOriginality}`,
    );

    // 5.2 Fifty duplicated literals must be ignored; the old absolute count saturated at 54.
    const literalHeavy = evaluateProjectAutonomy([makeFile(2000)], makeLiteralIssues(60), config);
    assert.strictEqual(
      literalHeavy.dimensions.codeOriginality,
      100,
      `duplicate-literal must not penalize originality, got ${literalHeavy.dimensions.codeOriginality}`,
    );

    // 5.3 Identical clone density at different tree sizes must score equally.
    const smallTree = evaluateProjectAutonomy([makeFile(1000)], makeCloneIssues(5), config);
    const bigTree = evaluateProjectAutonomy([makeFile(4000)], makeCloneIssues(20), config);
    assert.ok(
      Math.abs(smallTree.dimensions.codeOriginality - bigTree.dimensions.codeOriginality) < 1.0,
      `Equal density must yield equal originality (${smallTree.dimensions.codeOriginality} vs ${bigTree.dimensions.codeOriginality})`,
    );

    // 5.4 A real clone hotspot must still be penalized below the clean ceiling.
    const hotTree = evaluateProjectAutonomy([makeFile(1000)], makeCloneIssues(80), config);
    assert.ok(
      hotTree.dimensions.codeOriginality < 50,
      `Heavy clone density must drop originality below 50, got ${hotTree.dimensions.codeOriginality}`,
    );

    console.log('   ✓ Density-based originality and literal decoupling verified.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function testAggregationNonCompensatory() {
  console.log('6. Testing non-compensatory CAI aggregation...');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoring-aggregation-'));
  try {
    const config = { root: tempDir };
    const metrics = [
      {
        file: 'src/core/math.ts',
        lines: 800,
        characters: 24000,
        nonBlankLines: 800,
        content: 'export function add(a: number, b: number) { return a + b; }',
      },
    ];

    const geometric = evaluateProjectAutonomy(metrics, [], config);
    const arithmetic = evaluateProjectAutonomy(metrics, [], {
      ...config,
      scoring: { autonomy: { aggregationMode: 'arithmetic' } },
    });

    assert.strictEqual(
      geometric.compositeAutonomyIndex,
      arithmetic.compositeAutonomyIndex,
      'On a fully healthy tree both modes agree',
    );

    const webTree = evaluateProjectAutonomy(
      [
        {
          file: 'src/vendor/lib.js',
          lines: 3000,
          characters: 90000,
          nonBlankLines: 3000,
          content: '/* vendor */',
        },
        {
          file: 'src/wrapper.ts',
          lines: 20,
          characters: 600,
          nonBlankLines: 20,
          content: 'import * as sdk from "@aws-sdk/client-s3";\nexport function run() {}',
        },
      ],
      [],
      config,
    );
    assert.ok(
      webTree.compositeAutonomyIndex < 60,
      `A vendor-dominated tree must stay in the low bands, got ${webTree.compositeAutonomyIndex}`,
    );
    assert.ok(
      webTree.dimensions.effectiveLocAutonomy < 20,
      'Vendor-dominated tree must show a low LOC autonomy axis',
    );
    console.log('   ✓ Non-compensatory aggregation verified.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function testAntiGamingConjunction() {
  console.log('7. Testing canonical anti-gaming conjunction...');

  const trivialClaim = evaluateAntiGamingConjunction({
    changedEloc: 10,
    totalEloc: 1000,
    netDebtEliminated: 0,
    gamingPenalty: 0,
    claimsScoreGain: true,
  });
  assert.strictEqual(trivialClaim.isGaming, true, 'Trivial ratio plus zero debt must fire');
  assert.strictEqual(trivialClaim.verdictCode, 'BLOCK_GAMING_DETECTED');

  const substantial = evaluateAntiGamingConjunction({
    changedEloc: 400,
    totalEloc: 1000,
    netDebtEliminated: 0,
    gamingPenalty: 0,
    claimsScoreGain: true,
  });
  assert.strictEqual(substantial.isGaming, false, 'A substantial rewrite must not fire');

  const realDebt = evaluateAntiGamingConjunction({
    changedEloc: 10,
    totalEloc: 1000,
    netDebtEliminated: 12,
    gamingPenalty: 0,
    claimsScoreGain: true,
  });
  assert.strictEqual(realDebt.isGaming, false, 'Real debt elimination must clear the conjunction');

  const honestFix = evaluateAntiGamingConjunction({
    changedEloc: 5,
    totalEloc: 1000,
    netDebtEliminated: 0,
    gamingPenalty: 0,
    claimsScoreGain: false,
  });
  assert.strictEqual(honestFix.isGaming, false, 'A small bug fix claiming no gain must not fire');

  const patternPenalty = evaluateAntiGamingConjunction({
    changedEloc: 500,
    totalEloc: 1000,
    netDebtEliminated: 20,
    gamingPenalty: 15,
    claimsScoreGain: false,
  });
  assert.strictEqual(patternPenalty.isGaming, true, 'A concrete pattern penalty is sufficient');

  const boundary = evaluateAntiGamingConjunction({
    changedEloc: 150,
    totalEloc: 1000,
    netDebtEliminated: 0,
    gamingPenalty: 0,
    claimsScoreGain: true,
  });
  assert.strictEqual(boundary.isGaming, true, 'Exactly 15% must still count as trivial');

  const hostile = evaluateAntiGamingConjunction({
    changedEloc: Number.NaN,
    totalEloc: Number.NaN,
    netDebtEliminated: Number.NaN,
    gamingPenalty: Number.NaN,
    claimsScoreGain: true,
  });
  assert.strictEqual(
    hostile.isGaming,
    false,
    'Non-finite inputs must not fabricate a gaming verdict',
  );
  console.log('   ✓ Canonical anti-gaming conjunction verified.');
}

function testTdrPillarClosure() {
  console.log('8. Testing TDR pillar prefix closure against the rule catalog...');
  const catalogPath = path.join(__dirname, '..', '..', 'scripts', 'common', 'rule-catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const prefixes = new Set();
  for (const rule of catalog.rules || []) {
    const match = /^([A-Z]{2,4})-/.exec(rule.id || '');
    if (match) prefixes.add(match[1]);
  }
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'core', 'scoring', 'technical-debt-ratio.ts'),
    'utf8',
  );
  // Collect the declared prefixes once into a set instead of re-scanning the whole source file
  // for every registered family, which would be quadratic in the catalog size.
  const declared = new Set();
  for (const match of source.matchAll(/'([A-Z]{2,4})-':/g)) {
    declared.add(match[1]);
  }
  const missing = [];
  for (const prefix of prefixes) {
    if (!declared.has(prefix)) missing.push(prefix);
  }
  assert.deepStrictEqual(
    missing,
    [],
    `Every registered rule family must map to a TDR pillar; unmapped: ${missing.join(', ')}`,
  );
  console.log(`   ✓ All ${prefixes.size} rule families map to a TDR pillar.`);
}

function main() {
  console.log('Starting scoring parameters and operator invariants harness...');
  testDefaultResolution();
  testBoundaryRejection();
  testScaleFactorCurve();
  testSecurityCeilingConfig();
  testOriginalityDensityScaling();
  testAggregationNonCompensatory();
  testAntiGamingConjunction();
  testTdrPillarClosure();
  console.log('\n✔ All scoring parameter and operator invariant checks passed.\n');
}

main();
