/**
 * Module: Verification Harness — Composite Quality Gate Tests
 * File Path: scripts/validate-composite-gate.js
 * Architecture Role: Verifies multi-stage composite gate decisions, threshold escalations,
 *   regression blocks, and anti-gaming protections.
 * Dependencies & Triggers: Consumes dist/core praxis and trajectory modules; executed in test-parallel.js.
 * Exit Semantics: Exits 0 on all assertions passed, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const {
    evaluateCompositeGate,
    STAGE_THRESHOLDS,
} = require('../dist/core/praxis/composite-quality-gate');

function runTests() {
    console.log('🧪 Running Composite Quality Gate Validation Suite...');

    const baseCounters = {
        processed: 2000,
        unique: 1000,
        changed: 40,
        semantic: 35,
        relocated: 0,
        cosmetic: 5,
        boilerplate: 0,
        added: 20,
        deleted: 20,
        modified: 20,
    };

    const goodMetrics = {
        qed: 0.1,
        reviewYield: 6.5,
        regressionDensity: 0,
        deltaQSemantic: 3.5,
        beforeScore: 82.0,
        afterScore: 85.5,
        scoreVector: [90, 90, 90, 90, 90, 90, 90, 90, 90, 90],
        dimensionDeltas: {},
        debtDelta: {
            addedDebtPoints: 0,
            resolvedDebtPoints: 10,
            netDebtCleared: 10,
            regressionFindingsCount: 0,
            regressionFindingIds: [],
        },
        gamingPenalty: 0,
    };

    // --- Test 1: Standard Clean Pass ---
    console.log('  ▶ [Test 1] Testing standard clean pass across pre-commit and pre-push...');
    const resultCommit = evaluateCompositeGate({
        stage: 'pre-commit',
        staticPass: true,
        dynamicPass: true,
        metrics: goodMetrics,
        counters: baseCounters,
    });
    assert.strictEqual(resultCommit.passed, true, 'Clean change should pass pre-commit gate');
    assert.strictEqual(resultCommit.verdictCode, 'PASS');

    const resultPush = evaluateCompositeGate({
        stage: 'pre-push',
        staticPass: true,
        dynamicPass: true,
        metrics: goodMetrics,
        counters: baseCounters,
    });
    assert.strictEqual(resultPush.passed, true, 'Clean change should pass pre-push gate');
    console.log('    ✔ Standard clean pass verified');

    // --- Test 2: Static Verification Failure Block ---
    console.log('  ▶ [Test 2] Testing static verification failure blocking...');
    const resultStaticFail = evaluateCompositeGate({
        stage: 'pre-commit',
        staticPass: false,
        dynamicPass: true,
        metrics: goodMetrics,
        counters: baseCounters,
    });
    assert.strictEqual(resultStaticFail.passed, false, 'Must fail when static pass is false');
    assert.strictEqual(resultStaticFail.verdictCode, 'BLOCK_STATIC_FAILURE');
    assert.ok(resultStaticFail.violations.some((v) => v.includes('Static')));
    console.log('    ✔ Static failure blocking verified');

    // --- Test 3: Dynamic Test Failure Block ---
    console.log('  ▶ [Test 3] Testing dynamic test failure blocking...');
    const resultDynFail = evaluateCompositeGate({
        stage: 'pre-commit',
        staticPass: true,
        dynamicPass: false,
        metrics: goodMetrics,
        counters: baseCounters,
    });
    assert.strictEqual(resultDynFail.passed, false, 'Must fail when dynamic pass is false');
    assert.strictEqual(resultDynFail.verdictCode, 'BLOCK_DYNAMIC_FAILURE');
    console.log('    ✔ Dynamic failure blocking verified');

    // --- Test 4: Regression Density Block on Pre-Push ---
    console.log('  ▶ [Test 4] Testing regression density block on pre-push...');
    const regressedMetrics = {
        ...goodMetrics,
        regressionDensity: 28.5,
        debtDelta: {
            ...goodMetrics.debtDelta,
            regressionFindingsCount: 1,
            regressionFindingIds: ['SEC-001'],
        },
    };

    const resultRegressPush = evaluateCompositeGate({
        stage: 'pre-push',
        staticPass: true,
        dynamicPass: true,
        metrics: regressedMetrics,
        counters: baseCounters,
    });
    assert.strictEqual(resultRegressPush.passed, false, 'Pre-push must strictly block on regressions');
    assert.strictEqual(resultRegressPush.verdictCode, 'BLOCK_REGRESSION');
    console.log('    ✔ Regression density blocking verified');

    // --- Test 5: Anti-Gaming Block ---
    console.log('  ▶ [Test 5] Testing anti-gaming block on superficial churn...');
    const gamingMetrics = {
        ...goodMetrics,
        qed: 0,
        deltaQSemantic: 0,
        gamingPenalty: 6.5,
    };
    const resultGaming = evaluateCompositeGate({
        stage: 'pre-push',
        staticPass: true,
        dynamicPass: true,
        metrics: gamingMetrics,
        counters: { ...baseCounters, semantic: 0, changed: 100 },
    });
    assert.strictEqual(resultGaming.passed, false, 'Pre-push must block on gaming');
    assert.strictEqual(resultGaming.verdictCode, 'BLOCK_GAMING_DETECTED');
    console.log('    ✔ Anti-gaming blocking verified');

    console.log('\n🎉 ALL Phase 4 Composite Quality Gate Tests PASSED!\n');
}

runTests();
