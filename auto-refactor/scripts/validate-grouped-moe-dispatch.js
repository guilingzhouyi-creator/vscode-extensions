/**
 * Module: Verification Harness — DeepSeekMoE Adaptive Bias & DeepEP Grouped Dispatch Validation
 * File Path: scripts/validate-grouped-moe-dispatch.js
 * Architecture Role: Comprehensive integration assertion suite validating Phase 1 DeepSeek-V3 /
 *   DeepEP architectural internalizations:
 *   1. AdaptiveExpertBiasRouter online queue depth feedback, dynamic bias updates, and yield rewards;
 *   2. GroupedExpertDispatcher slice clustering and contiguous batching (All-to-All Dispatch);
 *   3. ExpertFindingCombiner deduplication and deterministic item reduction (All-to-All Combine);
 *   4. SparseMoEGateRouter integration and two-tier adaptive dispatch boundary.
 * Dependencies & Triggers: Consumes dist/api; triggered by test-parallel.js and npm test.
 * Responsibilities: Assert zero false negatives, deterministic load balancing, and exact dedup.
 * Exit Semantics & Design Rationale: Pure assertion runner; exits 0 on full success, 1 on any failure.
 */

const assert = require('assert');
const {
    AdaptiveExpertBiasRouter,
    defaultAdaptiveExpertBiasRouter,
    selectTopKBitmask,
    routeDiffToBitmask,
    GroupedExpertDispatcher,
    defaultGroupedExpertDispatcher,
    ExpertFindingCombiner,
    defaultExpertFindingCombiner,
    defaultSparseMoEGateRouter,
    MAX_FAST_TRACK_CAPACITY,
    analyzerNameToBit,
} = require('../dist/api');

async function main() {
    console.log('=== [1/5] Testing AdaptiveExpertBiasRouter Load Balancing & Yield Feedback ===');

    const router = new AdaptiveExpertBiasRouter();
    router.reset();

    const bitComplexity = analyzerNameToBit('complexity');
    const bitComments = analyzerNameToBit('comments');
    const bitNaming = analyzerNameToBit('naming');

    assert(bitComplexity > 0, 'Complexity bit must be valid');
    assert(bitComments > 0, 'Comments bit must be valid');
    assert(bitNaming > 0, 'Naming bit must be valid');

    // 1. Initial ranking with zero bias
    const initialRanked = router.scoreAndRankCandidateBits(bitComplexity | bitComments | bitNaming);
    assert.strictEqual(initialRanked.length, 3, 'Should rank all 3 candidate bits');

    // 2. Simulate overload on complexity (queue depth = 10 >> target 2)
    router.calibrateBiases([
        {
            bit: bitComplexity,
            currentQueueDepth: 10,
            rollingAvgLatencyUs: 1500,
            totalDispatches: 20,
            actionableFindingsYield: 0,
        },
        {
            bit: bitComments,
            currentQueueDepth: 1,
            rollingAvgLatencyUs: 200,
            totalDispatches: 20,
            actionableFindingsYield: 15, // High yield bonus
        },
    ]);

    const complexityBias = router.getBiasForBit(bitComplexity);
    const commentsBias = router.getBiasForBit(bitComments);
    const commentsYieldReward = router.getYieldRewardForBit(bitComments);

    assert(complexityBias < 0, `Complexity should receive negative bias on overload, got ${complexityBias}`);
    assert(commentsBias > 0, `Comments under target depth should receive positive bias, got ${commentsBias}`);
    assert(commentsYieldReward > 0, `Comments should receive positive yield reward, got ${commentsYieldReward}`);

    console.log(`✔ Dynamic bias verified: complexity=${complexityBias.toFixed(3)}, comments=${commentsBias.toFixed(3)}, reward=${commentsYieldReward.toFixed(3)}`);

    console.log('=== [2/5] Testing Bias State Snapshot Export & Import Persistence ===');
    const snapshot = router.exportSnapshot();
    assert.strictEqual(snapshot.version, 1, 'Snapshot version should be 1');
    assert(snapshot.dynamicBiases.length === 32, 'Snapshot should retain 32 bias values');

    const freshRouter = new AdaptiveExpertBiasRouter();
    freshRouter.importSnapshot(snapshot);
    assert.strictEqual(
        freshRouter.getBiasForBit(bitComplexity),
        complexityBias,
        'Imported router should match exported complexity bias',
    );
    assert.strictEqual(
        freshRouter.getYieldRewardForBit(bitComments),
        commentsYieldReward,
        'Imported router should match exported yield reward',
    );
    console.log('✔ BiasStateSnapshot serialization and restoration verified');

    console.log('=== [3/5] Testing selectTopKBitmask Dynamic Bias Integration ===');
    // Overload naming (queue depth = 100) so that high-yield comments overtakes it in Top-2 selection
    router.calibrateBiases([
        {
            bit: bitNaming,
            currentQueueDepth: 100,
            rollingAvgLatencyUs: 5000,
            totalDispatches: 50,
            actionableFindingsYield: 0,
        },
    ]);

    const candidateMask = bitComplexity | bitComments | bitNaming;
    const { activeMask, overflowMask } = selectTopKBitmask(candidateMask, 2, router);
    assert((activeMask & bitComments) !== 0, 'High-yield comments expert should be active');
    assert((activeMask & bitNaming) === 0, 'Overloaded naming expert should be demoted to overflow');
    console.log(`✔ selectTopKBitmask with AdaptiveExpertBiasRouter routed active=0x${activeMask.toString(16)}, overflow=0x${overflowMask.toString(16)}`);

    console.log('=== [4/5] Testing GroupedExpertDispatcher DeepEP-Style Batching ===');
    const dispatcher = new GroupedExpertDispatcher();

    const sampleItems = [
        {
            id: 'slice-1',
            filePath: 'src/core/parser.ts',
            activeMask: bitComplexity | bitComments,
        },
        {
            id: 'slice-2',
            filePath: 'src/core/tokenizer.ts',
            activeMask: bitComments | bitNaming,
        },
        {
            id: 'slice-3',
            filePath: 'src/utils/math.ts',
            activeMask: bitComplexity,
        },
    ];

    const plan = dispatcher.buildDispatchPlan(sampleItems);
    assert.strictEqual(plan.totalItems, 3, 'Plan should encompass all 3 items');
    assert.strictEqual(plan.batches.length, 3, 'Should produce 3 distinct expert batches (complexity, comments, naming)');

    const complexityBatch = plan.batches.find((b) => b.expertBit === bitComplexity);
    assert(complexityBatch, 'Complexity batch should exist');
    assert.strictEqual(complexityBatch.items.length, 2, 'Complexity batch should group slice-1 and slice-3');

    const commentsBatch = plan.batches.find((b) => b.expertBit === bitComments);
    assert(commentsBatch, 'Comments batch should exist');
    assert.strictEqual(commentsBatch.items.length, 2, 'Comments batch should group slice-1 and slice-2');

    const namingBatch = plan.batches.find((b) => b.expertBit === bitNaming);
    assert(namingBatch, 'Naming batch should exist');
    assert.strictEqual(namingBatch.items.length, 1, 'Naming batch should group slice-2');

    // Test batched execution
    const executedResults = await dispatcher.executeBatches(plan, (expertId, items) => {
        return items.map((item) => ({
            itemId: item.id,
            filePath: item.filePath,
            analyzer: expertId,
            rule: `test-${expertId}-rule`,
            severity: 'warning',
            message: `Mock issue from ${expertId}`,
            line: 10,
            column: 1,
        }));
    });

    assert.strictEqual(executedResults.size, 3, 'Should execute all 3 batches');
    console.log('✔ GroupedExpertDispatcher correctly clustered and executed contiguous batches');

    console.log('=== [5/5] Testing ExpertFindingCombiner Gather & Reduction ===');
    const combiner = new ExpertFindingCombiner();

    const rawFindings = [
        {
            itemId: 'slice-1',
            filePath: 'src/core/parser.ts',
            analyzer: 'complexity',
            rule: 'high-complexity',
            severity: 'warning',
            message: 'High cyclomatic complexity',
            line: 42,
            column: 5,
        },
        {
            itemId: 'slice-1',
            filePath: 'src/core/parser.ts',
            analyzer: 'complexity',
            rule: 'high-complexity', // Duplicate finding on same anchor
            severity: 'warning',
            message: 'Duplicate emission of high complexity',
            line: 42,
            column: 5,
        },
        {
            itemId: 'slice-1',
            filePath: 'src/core/parser.ts',
            analyzer: 'comments',
            rule: 'missing-jsdoc',
            severity: 'info',
            message: 'Missing function JSDoc',
            line: 10,
            column: 1,
        },
        {
            itemId: 'slice-2',
            filePath: 'src/core/tokenizer.ts',
            analyzer: 'naming',
            rule: 'NAM-DEC-001',
            severity: 'warning',
            message: 'Non-standard identifier casing',
            line: 15,
            column: 8,
        },
    ];

    const reports = combiner.combineFindings(rawFindings, plan, sampleItems);
    assert.strictEqual(reports.size, 3, 'Should produce combined reports for all 3 original items');

    const report1 = reports.get('slice-1');
    assert(report1, 'Report for slice-1 must exist');
    assert.strictEqual(report1.issues.length, 2, 'Duplicate finding must be eliminated (expected 2 unique issues)');
    assert.strictEqual(report1.issues[0].rule, 'missing-jsdoc', 'Issues must be sorted by line number ascending');
    assert.strictEqual(report1.issues[1].rule, 'high-complexity', 'Second issue at line 42');

    const report3 = reports.get('slice-3');
    assert(report3, 'Report for slice-3 with zero issues must still exist');
    assert.strictEqual(report3.issues.length, 0, 'Slice-3 should have 0 issues');

    // Test SparseMoEGateRouter.buildGroupedDispatchPlan
    const mockSliceNodes = [
        {
            sliceId: 'sl-1',
            filePath: 'test.ts',
            startLine: 1,
            endLine: 20,
            nodeKind: 'FunctionDeclaration',
            symbolName: 'parse',
            isExported: true,
            featureVector: {
                hasSignatureMutation: false,
                hasControlFlowMutation: true,
                hasLiteralMutation: false,
                hasAsyncMutation: false,
                hasIoMutation: false,
                hasTypeMutation: false,
                isDocOnly: false,
            },
            primaryKind: 'control-flow',
        },
    ];
    const gateGroupedPlan = defaultSparseMoEGateRouter.buildGroupedDispatchPlan(mockSliceNodes);
    assert(gateGroupedPlan.totalItems === 1, 'Gate grouped plan should process 1 slice');
    assert(gateGroupedPlan.batches.length > 0, 'Gate grouped plan should contain active batches');
    console.log('✔ ExpertFindingCombiner deduplication and SparseMoEGateRouter integration verified');

    console.log('\n================================================================');
    console.log('🎉 ALL DeepSeekMoE Adaptive Bias & DeepEP Grouped Dispatch Tests PASSED!');
    console.log('================================================================');
}

main().catch((err) => {
    console.error('Validation failed with error:', err);
    process.exit(1);
});
