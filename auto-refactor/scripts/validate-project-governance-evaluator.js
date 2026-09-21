#!/usr/bin/env node
/**
 * Module: Verification Harness — Project-Scale Progressive Governance Evaluator
 * File Path: scripts/validate-project-governance-evaluator.js
 * Architecture Role: Verification test suite asserting progressive lifecycle calibration,
 *   balanced governance scoring, anti-gaming bonus nullification, and grade assignment.
 * Dependencies & Triggers: Consumes project-governance-evaluator from dist/core/scoring;
 *   invoked by test-parallel.js runner.
 * Responsibilities: Assert stage-aware severity multipliers
 *   (prototype = 0.5, stable = 1.0, enterprise = 1.4), downgrading of prototype warnings to info,
 *   anti-gaming protection, and composite score bounds.
 * Exit Semantics & Design Rationale: Process exits 0 on all assertions passing, 1 on failure.
 */

'use strict';

const { evaluateProjectGovernance } = require('../dist/core/scoring/project-governance-evaluator');

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

function testLifecycleCalibration() {
  console.log('--- 1. Testing 3-Stage Lifecycle Calibration ---');
  const sampleInput = {
    totalFiles: 100,
    totalLOC: 10000,
    distributedRedundancyCount: 2,
    pseudoSharedLibraryCount: 1,
    unboundedUtilityCreepCount: 1,
    godObjectUtilityCount: 1,
    overAbstractionCount: 0,
    unpooledHotspotCount: 1,
    unsoundPoolCount: 0,
    negativeRoiPoolCount: 0,
    cleanSharedLibraryCount: 2,
    soundPoolCount: 1,
    issues: [
      {
        id: 'issue-1',
        analyzer: 'complexity',
        rule: 'CPX-RED-001',
        severity: 'warning',
        message: 'Distributed redundancy warning',
      },
    ],
  };

  const protoResult = evaluateProjectGovernance({ ...sampleInput, stage: 'prototype' });
  assert(protoResult.stage === 'prototype', 'Evaluated prototype stage');
  assert(
    protoResult.calibratedIssues[0].severity === 'info',
    'Prototype stage downgraded warning to info',
  );

  const stableResult = evaluateProjectGovernance({ ...sampleInput, stage: 'stable' });
  assert(stableResult.stage === 'stable', 'Evaluated stable stage');
  assert(
    stableResult.calibratedIssues[0].severity === 'warning',
    'Stable stage preserved warning severity',
  );
  assert(
    stableResult.compositeScore < protoResult.compositeScore,
    'Stable stage applies higher deduction than prototype',
  );

  const enterpriseResult = evaluateProjectGovernance({ ...sampleInput, stage: 'enterprise' });
  assert(enterpriseResult.stage === 'enterprise', 'Evaluated enterprise stage');
  assert(
    enterpriseResult.compositeScore < stableResult.compositeScore,
    'Enterprise stage applies strict 1.4x deductions',
  );
}

function testAntiGamingProtection() {
  console.log('--- 2. Testing Anti-Gaming Guard & Bonus Nullification ---');
  const cleanInput = {
    stage: 'stable',
    totalFiles: 50,
    totalLOC: 5000,
    distributedRedundancyCount: 0,
    pseudoSharedLibraryCount: 0,
    unboundedUtilityCreepCount: 0,
    godObjectUtilityCount: 0,
    overAbstractionCount: 0,
    unpooledHotspotCount: 0,
    unsoundPoolCount: 0,
    negativeRoiPoolCount: 0,
    cleanSharedLibraryCount: 3,
    soundPoolCount: 2,
    issues: [],
  };

  const cleanResult = evaluateProjectGovernance(cleanInput);
  assert(cleanResult.bonuses.cleanReuseBonus === 10, 'Earned 10-point capped clean reuse bonus');
  assert(cleanResult.compositeScore === 100, 'Score is bounded at 100');
  assert(cleanResult.grade === 'A+', 'Assigned A+ grade for flawless governance');

  const gamingInput = {
    ...cleanInput,
    overAbstractionCount: 1,
  };

  const gamingResult = evaluateProjectGovernance(gamingInput);
  assert(
    gamingResult.bonuses.cleanReuseBonus === 0,
    'Clean reuse bonus nullified when over-abstraction is detected',
  );
  assert(
    gamingResult.antiGamingWarnings.length >= 1,
    'Emitted anti-gaming warning regarding spurious indirection',
  );
  assert(
    gamingResult.antiGamingWarnings[0].includes('over-abstraction'),
    'Warning cites over-abstraction',
  );
}

function testDebtAndGradeAssignment() {
  console.log('--- 3. Testing Severe Technical Debt & Grade Assignment ---');
  const debtInput = {
    stage: 'enterprise',
    totalFiles: 200,
    totalLOC: 30000,
    distributedRedundancyCount: 4,
    pseudoSharedLibraryCount: 3,
    unboundedUtilityCreepCount: 3,
    godObjectUtilityCount: 2,
    overAbstractionCount: 2,
    unpooledHotspotCount: 3,
    unsoundPoolCount: 2,
    negativeRoiPoolCount: 1,
    cleanSharedLibraryCount: 0,
    soundPoolCount: 0,
    issues: [],
  };

  const debtResult = evaluateProjectGovernance(debtInput);
  assert(
    debtResult.compositeScore < 70,
    `Severe governance decay produces low composite score (${debtResult.compositeScore})`,
  );
  assert(debtResult.grade === 'D', 'Assigned grade D for score < 70');
  assert(
    debtResult.deductions.distributedRedundancy > 0,
    'Computed distributed redundancy deduction',
  );
  assert(debtResult.deductions.roleDrift > 0, 'Computed role drift deduction');
  assert(debtResult.deductions.godUtils > 0, 'Computed god utils deduction');
  assert(debtResult.deductions.poolingFlaws > 0, 'Computed pooling flaws deduction');
}

function runTests() {
  testLifecycleCalibration();
  testAntiGamingProtection();
  testDebtAndGradeAssignment();
  console.log(`\nResults: ${passedCount}/${totalCount} assertions passed.`);
}

runTests();
