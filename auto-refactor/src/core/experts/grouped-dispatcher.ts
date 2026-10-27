/**
 * Module: Core Experts - Grouped Expert Dispatcher (DeepEP MoE Dispatch Primitive)
 * File Path: src/core/experts/grouped-dispatcher.ts
 * Architecture Role: High-throughput collective dispatch engine inspired by DeepEP (Deep Expert
 *   Parallelism) All-to-All Dispatch. Groups disparate AST slices and diff inputs into contiguous,
 *   single-expert execution batches, eliminating redundant AST traversals and analyzer churn.
 * Dependencies & Triggers: Consumes expert-catalog, analyzer-bitmask, and sliceTypes; consumed by
 *   SparseMoEGateRouter, slice-dispatcher, and multi-file audit pipelines.
 * Responsibilities:
 *   1. Scatter/cluster review items into contiguous per-expert execution batches;
 *   2. Compute aggregate expert activation masks and compression ratios;
 *   3. Execute batched analyzer kernels with cooperative event-loop yields;
 *   4. Provide zero-unnecessary-allocation typed dispatch plans.
 * Exit Semantics & Design Rationale: Deterministic, pure plan generation; handles empty item lists
 *   safely; guarantees bounded CC <= 15 and Depth <= 4.
 */

import { analyzerMaskToNames } from '../constants/analyzer-bitmask';
import { EXPERT_BY_BIT } from './expert-catalog';
import type { ASTSliceNode } from '../router/sliceTypes';

/** Number of batches processed before yielding the event loop to prevent starvation. */
const BATCH_YIELD_INTERVAL = 8;

/** Total maximum supported MoE experts matching 32-bit integer capacity. */
const TOTAL_ROUTER_EXPERTS = 32;

/**
 * Universal interface for review items that can be routed and grouped for expert execution.
 */
export interface DispatchableReviewItem {
    /** Unique identifier for this item (e.g. sliceId or file relative path). */
    readonly id: string;
    /** Relative repository file path. */
    readonly filePath: string;
    /** 32-bit active analyzer bitmask computed by MoE CED router. */
    readonly activeMask: number;
    /** Optional source file content. */
    readonly content?: string;
    /** Optional underlying AST slice node reference. */
    readonly slice?: ASTSliceNode;
}

/**
 * Contiguous execution batch containing all items assigned to a single expert analyzer.
 */
export interface ExpertExecutionBatch<
    TItem extends DispatchableReviewItem = DispatchableReviewItem,
> {
    /** 32-bit bitmask corresponding to this expert (1 << index). */
    readonly expertBit: number;
    /** Canonical string identifier of this expert (e.g. 'complexity', 'constants'). */
    readonly expertId: string;
    /** Contiguous list of review items routed to this expert. */
    readonly items: readonly TItem[];
}

/**
 * Consolidated execution plan produced by the GroupedExpertDispatcher.
 */
export interface GroupedDispatchPlan<
    TItem extends DispatchableReviewItem = DispatchableReviewItem,
> {
    /** Total number of unique input items evaluated. */
    readonly totalItems: number;
    /** Dispatched per-expert execution batches. */
    readonly batches: readonly ExpertExecutionBatch<TItem>[];
    /** Bitwise OR union of all active expert bits across all items. */
    readonly activeExpertMask: number;
    /** Array of active expert string identifiers. */
    readonly activeExpertIds: readonly string[];
    /** Average activation ratio across all items (0.0 to 1.0). */
    readonly averageActivationRatio: number;
}

/**
 * Function contract for executing a single analyzer kernel over a contiguous batch of items.
 */
export type BatchedKernelExecutor<TItem extends DispatchableReviewItem, TResult> = (
    expertId: string,
    batchItems: readonly TItem[],
) => Promise<readonly TResult[]> | readonly TResult[];

/**
 * GroupedExpertDispatcher implements DeepEP-style All-to-All Dispatch for AST slices and files.
 */
export class GroupedExpertDispatcher {
    /**
     * Builds a grouped dispatch plan from an array of review items.
     *
     * Clusters items by active expert bit, coalescing disparate slices into contiguous batches
     * so each analyzer runs once across all relevant items rather than per-item.
     *
     * @param items - Array of dispatchable review items with activeMasks.
     * @returns Consolidated GroupedDispatchPlan.
     */
    public buildDispatchPlan<TItem extends DispatchableReviewItem>(
        items: readonly TItem[],
    ): GroupedDispatchPlan<TItem> {
        if (items.length === 0) {
            return {
                totalItems: 0,
                batches: [],
                activeExpertMask: 0,
                activeExpertIds: [],
                averageActivationRatio: 0,
            };
        }

        const buckets: TItem[][] = Array.from({ length: TOTAL_ROUTER_EXPERTS }, () => []);
        let unionMask = 0;
        let cumulativeRatio = 0;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const mask = item.activeMask >>> 0;
            unionMask |= mask;

            let activeInItem = 0;
            for (let bitIdx = 0; bitIdx < TOTAL_ROUTER_EXPERTS; bitIdx++) {
                const bit = (1 << bitIdx) >>> 0;
                if ((mask & bit) !== 0) {
                    buckets[bitIdx].push(item);
                    activeInItem++;
                }
            }
            cumulativeRatio += activeInItem / TOTAL_ROUTER_EXPERTS;
        }

        const batches: ExpertExecutionBatch<TItem>[] = [];
        for (let bitIdx = 0; bitIdx < TOTAL_ROUTER_EXPERTS; bitIdx++) {
            const bucketItems = buckets[bitIdx];
            if (bucketItems.length > 0) {
                const expertBit = (1 << bitIdx) >>> 0;
                const profile = EXPERT_BY_BIT.get(expertBit);
                const expertId = profile?.id ?? `unknown_expert_${bitIdx}`;
                batches.push({
                    expertBit,
                    expertId,
                    items: bucketItems,
                });
            }
        }

        const activeExpertIds = analyzerMaskToNames(unionMask);
        const averageActivationRatio = Number((cumulativeRatio / items.length).toFixed(3));

        return {
            totalItems: items.length,
            batches,
            activeExpertMask: unionMask >>> 0,
            activeExpertIds,
            averageActivationRatio,
        };
    }

    /**
     * Executes the grouped dispatch plan using the provided batch kernel executor.
     *
     * Cooperatively yields the event loop periodically to prevent starving UI / daemon loops.
     *
     * @param plan - Grouped dispatch plan.
     * @param executor - Async or sync kernel executor function.
     * @returns Map of expertId to array of raw execution results.
     */
    public async executeBatches<TItem extends DispatchableReviewItem, TResult>(
        plan: GroupedDispatchPlan<TItem>,
        executor: BatchedKernelExecutor<TItem, TResult>,
    ): Promise<Map<string, readonly TResult[]>> {
        const resultsByExpert = new Map<string, readonly TResult[]>();

        for (let i = 0; i < plan.batches.length; i++) {
            const batch = plan.batches[i];
            const batchResults = await executor(batch.expertId, batch.items);
            resultsByExpert.set(batch.expertId, batchResults);

            if ((i + 1) % BATCH_YIELD_INTERVAL === 0) {
                await new Promise((resolve) => setImmediate(resolve));
            }
        }

        return resultsByExpert;
    }
}

/** Default singleton instance of GroupedExpertDispatcher. */
export const defaultGroupedExpertDispatcher = new GroupedExpertDispatcher();
