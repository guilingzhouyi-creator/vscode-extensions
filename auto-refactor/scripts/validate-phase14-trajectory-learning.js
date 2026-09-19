/**
 * Module: Verification Harness - Phase 14 Historical Trajectory Learning & Recipe Extraction
 * File Path: scripts/validate-phase14-trajectory-learning.js
 * Architecture Role: Comprehensive verification harness for Bad-to-Good trajectory learning,
 *   refactoring recipe synthesis, precondition matching, regression detection (GOV-TRJ-001),
 *   and Praxis trajectory learning facade SPI integration.
 * Dependencies & Triggers: Consumes ../dist/api; executed in test-parallel runner.
 * Responsibilities: Validate all 6 core functional gates of Phase 14.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passing,
 *   throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const {
  TrajectoryRecipeExtractor,
  RegressionTrajectoryDetector,
  createPraxisTrajectoryLearningService,
} = require('../dist/api');

async function main() {
  console.log('================================================================');
  console.log('🧪 Verifying Phase 14: Trajectory Learning & Recipe Extraction');
  console.log('================================================================');

  const extractor = new TrajectoryRecipeExtractor();
  const detector = new RegressionTrajectoryDetector();
  const service = createPraxisTrajectoryLearningService(extractor, detector);

  // --------------------------------------------------------------------------
  // Gate 1: Trajectory Ingestion & Extract-Method Recipe Synthesis
  // --------------------------------------------------------------------------
  console.log('\n[Gate 1] Verifying Bad->Good decomposition into extract-method recipe...');
  const beforeMonolith = `
function processBatchOrder(orders: any[], config: any) {
    let total = 0;
    for (let i = 0; i < orders.length; i++) {
        const item = orders[i];
        if (item.active) {
            if (item.price > 100) {
                total += item.price * 0.9;
            } else if (item.price > 50) {
                total += item.price * 0.95;
            } else {
                total += item.price;
            }
        }
        if (item.taxable) {
            total += item.price * 0.08;
        }
        if (item.shippingRequired) {
            total += 15.0;
        }
        console.log("Processed item: " + item.id);
    }
    return total;
}
// Extra padding lines to simulate 40+ line monolithic block
// line 25
// line 26
// line 27
// line 28
// line 29
// line 30
// line 31
// line 32
// line 33
// line 34
// line 35
// line 36
// line 37
// line 38
// line 39
`;

  const afterModular = `
function calculateItemDiscount(price: number): number {
    if (price > 100) return price * 0.9;
    if (price > 50) return price * 0.95;
    return price;
}

function calculateItemTax(item: any): number {
    return item.taxable ? item.price * 0.08 : 0;
}

function processBatchOrder(orders: any[], config: any) {
    let total = 0;
    for (const item of orders) {
        if (!item.active) continue;
        total += calculateItemDiscount(item.price);
        total += calculateItemTax(item);
        if (item.shippingRequired) total += 15.0;
    }
    return total;
}
`;

  const monolithInput = {
    trajectoryId: 'trj-monolith-001',
    filePath: 'src/orders/processor.ts',
    beforeContent: beforeMonolith,
    afterContent: afterModular,
    beforeScore: { compositeScore: 65, dimensions: {} },
    afterScore: { compositeScore: 88, dimensions: {} },
    language: 'typescript',
  };

  const recipe1 = extractor.extractRecipeFromTrajectory(monolithInput);
  assert(recipe1 !== undefined, 'Expected recipe to be extracted from Bad->Good trajectory');
  assert.strictEqual(recipe1.category, 'extract-method');
  assert(recipe1.recipeId.startsWith('REC-SPLIT-'), 'Recipe ID must have REC-SPLIT prefix');
  assert(recipe1.operations.length > 0, 'Operations must contain split-function steps');
  assert.strictEqual(recipe1.operations[0].opKind, 'split-function');
  assert.strictEqual(recipe1.expectedQualityGain, 23, 'Expected Δscore of 23');
  console.log(`  ✔ Synthesized Recipe: ${recipe1.recipeId} (${recipe1.name})`);

  // --------------------------------------------------------------------------
  // Gate 2: Parameter Object & Strategy Dispatch Synthesis
  // --------------------------------------------------------------------------
  console.log('\n[Gate 2] Verifying parameter-object and strategy-dispatch patterns...');
  const beforeParams = `
function createCustomerProfile(
    firstName: string,
    lastName: string,
    email: string,
    phone: string,
    address: string
) {
    return { firstName, lastName, email, phone, address };
}
`;
  const afterParams = `
interface CustomerProfileOptions {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
}

function createCustomerProfile(options: CustomerProfileOptions) {
    return { ...options };
}
`;

  const paramInput = {
    trajectoryId: 'trj-param-002',
    filePath: 'src/users/profile.ts',
    beforeContent: beforeParams,
    afterContent: afterParams,
    language: 'typescript',
  };

  const recipe2 = extractor.extractRecipeFromTrajectory(paramInput);
  assert(recipe2 !== undefined, 'Expected parameter-object recipe');
  assert.strictEqual(recipe2.category, 'parameter-object');
  assert.strictEqual(recipe2.operations[0].opKind, 'introduce-parameter-object');
  console.log(`  ✔ Synthesized Recipe: ${recipe2.recipeId} (${recipe2.name})`);

  // Strategy dispatch pattern
  const beforeSwitch = `
function handleEvent(eventType: string, payload: any) {
    switch(eventType) {
        case 'CREATE': return doCreate(payload);
        case 'UPDATE': return doUpdate(payload);
        case 'DELETE': return doDelete(payload);
        case 'PURGE': return doPurge(payload);
        default: throw new Error('Unknown');
    }
}
`;
  const afterStrategy = `
const eventHandlers: Record<string, (p: any) => any> = {
    CREATE: doCreate,
    UPDATE: doUpdate,
    DELETE: doDelete,
    PURGE: doPurge,
};

function handleEvent(eventType: string, payload: any) {
    const handler = eventHandlers[eventType];
    if (!handler) throw new Error('Unknown');
    return handler(payload);
}
`;

  const strategyInput = {
    trajectoryId: 'trj-strat-003',
    filePath: 'src/events/dispatcher.ts',
    beforeContent: beforeSwitch,
    afterContent: afterStrategy,
    language: 'typescript',
  };

  const recipe3 = extractor.extractRecipeFromTrajectory(strategyInput);
  assert(recipe3 !== undefined, 'Expected strategy-dispatch recipe');
  assert.strictEqual(recipe3.category, 'strategy-dispatch');
  console.log(`  ✔ Synthesized Recipe: ${recipe3.recipeId} (${recipe3.name})`);

  // --------------------------------------------------------------------------
  // Gate 3: Recipe Precondition Matching & Recommendation
  // --------------------------------------------------------------------------
  console.log('\n[Gate 3] Verifying recipe precondition matching on candidate code...');
  service.registerRecipe(recipe1);
  service.registerRecipe(recipe2);
  service.registerRecipe(recipe3);

  const candidateMonolith = `
function billingRun(accounts: any[]) {
    for (let i = 0; i < accounts.length; i++) {
        // complex block spanning 35+ lines
        let x = accounts[i].balance;
        if (x > 100) x += 10;
        accounts[i].balance = x;
    }
}
// line 10
// line 11
// line 12
// line 13
// line 14
// line 15
// line 16
// line 17
// line 18
// line 19
// line 20
// line 21
// line 22
// line 23
// line 24
// line 25
// line 26
// line 27
// line 28
// line 29
// line 30
// line 31
// line 32
`;

  const recommendations = service.matchRecipes(candidateMonolith, 'typescript');
  assert(recommendations.length > 0, 'Candidate monolith must match at least one recipe');
  assert(
    recommendations.some((r) => r.category === 'extract-method'),
    'Should recommend extract-method recipe',
  );
  console.log(`  ✔ Found ${recommendations.length} matching recipe recommendations`);

  // --------------------------------------------------------------------------
  // Gate 4: Flip-Flop Cyclic Regression Detection (GOV-TRJ-001)
  // --------------------------------------------------------------------------
  console.log('\n[Gate 4] Verifying cyclic oscillation & flip-flop detection (GOV-TRJ-001)...');
  const revisions = [
    {
      revisionId: 'rev-001',
      fileHash: 'hash-aaa',
      astDigest: 'ast-aaa',
      timestamp: 1000,
      agentUid: 'agent-alice',
      qualityScore: { compositeScore: 70, dimensions: {} },
      ruleHitIds: [],
    },
    {
      revisionId: 'rev-002',
      fileHash: 'hash-bbb',
      astDigest: 'ast-bbb',
      timestamp: 2000,
      agentUid: 'agent-bob',
      qualityScore: { compositeScore: 85, dimensions: {} },
      ruleHitIds: [],
    },
    {
      revisionId: 'rev-003',
      fileHash: 'hash-aaa', // Reverted back to rev-001 without forward progress!
      astDigest: 'ast-aaa',
      timestamp: 3000,
      agentUid: 'agent-charlie',
      qualityScore: { compositeScore: 68, dimensions: {} },
      ruleHitIds: [],
    },
  ];

  const regIssues = detector.detectRegressions('src/core/payment.ts', revisions);
  assert(regIssues.length >= 1, 'Expected at least 1 cyclic regression issue');
  assert.strictEqual(regIssues[0].rule, 'GOV-TRJ-001');
  assert.strictEqual(regIssues[0].severity, 'error');
  assert(regIssues[0].message.includes('Cyclic flip-flop detected'));
  console.log(`  ✔ Emitted blocking issue: ${regIssues[0].rule} -> ${regIssues[0].message}`);

  // --------------------------------------------------------------------------
  // Gate 5: Praxis Trajectory Learning Service Facade
  // --------------------------------------------------------------------------
  console.log('\n[Gate 5] Verifying Praxis trajectory learning service facade...');
  const verdict = await service.learnFromTrajectory(monolithInput);
  assert.strictEqual(verdict.hasBadToGoodImprovement, true);
  assert(verdict.qualityDelta > 0);
  assert(verdict.extractedRecipe !== undefined);
  assert(verdict.durationMs >= 0);
  console.log(
    `  ✔ Praxis Verdict: ΔScore=+${verdict.qualityDelta.toFixed(1)} | ` +
      `Recipe=${verdict.extractedRecipe.recipeId} | Duration=${verdict.durationMs}ms`,
  );

  // --------------------------------------------------------------------------
  // Gate 6: Sub-15ms Performance Benchmark
  // --------------------------------------------------------------------------
  console.log('\n[Gate 6] Measuring latency over 100 trajectory learning cycles...');
  const tStart = Date.now();
  const iterations = 100;
  for (let i = 0; i < iterations; i++) {
    service.matchRecipes(candidateMonolith, 'typescript');
    detector.detectRegressions('src/test.ts', revisions);
  }
  const tTotal = Date.now() - tStart;
  const avgMs = tTotal / iterations;
  console.log(
    `  ✔ Processed ${iterations} cycles in ${tTotal}ms (Average: ${avgMs.toFixed(2)}ms per cycle)`,
  );
  assert(avgMs < 15.0, `Average latency (${avgMs.toFixed(2)}ms) exceeded 15ms threshold`);

  console.log('\n================================================================');
  console.log('🎉 ALL 6 GATES OF PHASE 14 VERIFIED SUCCESSFULLY!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('\n❌ Phase 14 validation failed:', err);
  process.exit(1);
});
