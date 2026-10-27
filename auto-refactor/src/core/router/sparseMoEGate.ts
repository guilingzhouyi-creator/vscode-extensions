/**
 * Module: Core Engine - Sparse MoE (Mixture-of-Experts) CED Gate Router
 * File Path: src/core/router/sparseMoEGate.ts
 * Architecture Role: Conditional Expert Dispatching (CED) router inspired by asymmetric MoE
 *   architectures; maps localized AST slice feature vectors to minimal sufficient analyzer
 *   subsets (10%~25% activation ratio), bypassing cold analyzers.
 * Dependencies & Triggers: Consumes sliceTypes and dimensionLiterals; consumed by sliceAuditService
 *   and dualTrackPipeline.
 * Responsibilities: Route AST slice nodes to active analyzer subsets, calculate activation
 *   ratio, and record architectural bypass rationale.
 * Exit Semantics & Design Rationale: Deterministic and pure; guarantees safe fail-open fallback
 *   to standard core analyzers when features are unclassifiable.
 */

import { ALL_BUILTIN_ANALYZERS, popcount32 } from './sparseRuleRouter';
import type { ASTSliceNode, SliceFeatureVector, SparseRoutingPlan } from './sliceTypes';
import { dispatchSliceFeatureBitset } from '../experts';
import {
    defaultGroupedExpertDispatcher,
    type GroupedDispatchPlan,
} from '../experts/grouped-dispatcher';
import { ALL_ANALYZERS_MASK, analyzerMaskToNames } from '../constants/analyzer-bitmask';

/** Total available built-in analyzer count for ratio calculation. */
const TOTAL_BUILTIN_ANALYZERS = ALL_BUILTIN_ANALYZERS.length;

/** Fixed decimal places for stable reporting of activation ratio. */
const DECIMAL_PLACES = 3;

/**
 * Select active analyzer ids based on slice feature vector.
 *
 * @param vector - Extracted slice feature vector.
 * @returns Array of chosen active analyzer ids and reason.
 */
function dispatchSliceExperts(vector: SliceFeatureVector): {
    analyzers: string[];
    reasons: string[];
} {
    const { activeAnalyzers, reasons } = dispatchSliceFeatureBitset(vector);
    return { analyzers: activeAnalyzers, reasons };
}

/**
 * Compute skipped analyzers and activation ratio from active analyzers.
 *
 * @param activeAnalyzers - Active analyzer names.
 * @param allAvailable - All available analyzer names.
 * @returns Skipped analyzer names and rounded activation ratio.
 */
function computeRoutingSummary(
    activeAnalyzers: string[],
    allAvailable: readonly string[],
): { skippedAnalyzers: string[]; activationRatio: number } {
    const activeSet = new Set(activeAnalyzers);
    const skippedAnalyzers = allAvailable.filter((analyzerName) => !activeSet.has(analyzerName));
    const totalCount = allAvailable.length > 0 ? allAvailable.length : TOTAL_BUILTIN_ANALYZERS;
    const activationRatio = Number((activeAnalyzers.length / totalCount).toFixed(DECIMAL_PLACES));
    return { skippedAnalyzers, activationRatio };
}

/**
 * SparseMoEGateRouter implements Conditional Expert Dispatching for AST slices.
 */
export class SparseMoEGateRouter {
    /**
     * Route an AST slice node directly to 32-bit active and skipped bitmasks.
     *
     * Provides zero-heap-allocation, single-cycle CED evaluation for slice audit hot paths.
     *
     * @param slice - AST slice node.
     * @param availableMask - Bitmask of enabled analyzers (default: ALL_ANALYZERS_MASK).
     * @returns 32-bit activeMask, skippedMask, activationRatio, and reasons.
     */
    public routeSliceToBitmask(
        slice: ASTSliceNode,
        availableMask: number = ALL_ANALYZERS_MASK,
    ): {
        activeMask: number;
        skippedMask: number;
        activationRatio: number;
        reasons: string[];
    } {
        const { activeMask: rawMask, reasons } = dispatchSliceFeatureBitset(slice.featureVector);
        const activeMask = (rawMask & availableMask) >>> 0;
        const skippedMask = (availableMask & ~activeMask) >>> 0;
        const totalCount = Math.max(1, popcount32(availableMask));
        const activeCount = popcount32(activeMask);
        const activationRatio = Number((activeCount / totalCount).toFixed(DECIMAL_PLACES));

        return {
            activeMask,
            skippedMask,
            activationRatio,
            reasons,
        };
    }

    /**
     * Route an ASTSliceNode to a SparseRoutingPlan with active and cold bypassed analyzers.
     *
     * @param slice - Localized AST slice node.
     * @param allAvailable - Optional list of currently enabled analyzers.
     * @returns SparseRoutingPlan with bounded activation ratio.
     */
    public routeSlice(
        slice: ASTSliceNode,
        allAvailable: readonly string[] = ALL_BUILTIN_ANALYZERS,
    ): SparseRoutingPlan {
        if (allAvailable === ALL_BUILTIN_ANALYZERS) {
            const bitResult = this.routeSliceToBitmask(slice, ALL_ANALYZERS_MASK);
            return {
                sliceId: slice.sliceId,
                filePath: slice.filePath,
                activeAnalyzers: analyzerMaskToNames(bitResult.activeMask),
                skippedAnalyzers: analyzerMaskToNames(bitResult.skippedMask),
                activationRatio: bitResult.activationRatio,
                reasons: bitResult.reasons,
            };
        }

        const { analyzers, reasons } = dispatchSliceExperts(slice.featureVector);
        const availableSet = new Set(allAvailable);
        const activeAnalyzers = analyzers.filter((analyzerName) => availableSet.has(analyzerName));
        const { skippedAnalyzers, activationRatio } = computeRoutingSummary(
            activeAnalyzers,
            allAvailable,
        );

        return {
            sliceId: slice.sliceId,
            filePath: slice.filePath,
            activeAnalyzers,
            skippedAnalyzers,
            activationRatio,
            reasons,
        };
    }

    /**
     * Route multiple AST slices and combine their active analyzer union.
     *
     * @param slices - List of AST slice nodes.
     * @param allAvailable - Available analyzers.
     * @returns Combined sparse routing plan.
     */
    public routeCombinedSlices(
        slices: ASTSliceNode[],
        allAvailable: readonly string[] = ALL_BUILTIN_ANALYZERS,
    ): SparseRoutingPlan {
        if (slices.length === 0) {
            return {
                sliceId: 'empty-slice',
                filePath: 'unknown',
                activeAnalyzers: [],
                skippedAnalyzers: Array.from(allAvailable),
                activationRatio: 0,
                reasons: ['No slice mutations detected: full bypass'],
            };
        }

        const unionActive = new Set<string>();
        const allReasons: string[] = [];
        const seenReasons = new Set<string>();

        for (const slice of slices) {
            const plan = this.routeSlice(slice, allAvailable);
            for (const analyzerName of plan.activeAnalyzers) {
                unionActive.add(analyzerName);
            }
            for (const reason of plan.reasons) {
                if (!seenReasons.has(reason)) {
                    seenReasons.add(reason);
                    allReasons.push(reason);
                }
            }
        }

        const activeAnalyzers = Array.from(unionActive);
        const { skippedAnalyzers, activationRatio } = computeRoutingSummary(
            activeAnalyzers,
            allAvailable,
        );

        return {
            sliceId: slices.map((sliceItem) => sliceItem.sliceId).join(','),
            filePath: slices[0].filePath,
            activeAnalyzers,
            skippedAnalyzers,
            activationRatio,
            reasons: allReasons,
        };
    }

    /**
     * Build a contiguous GroupedDispatchPlan across multiple AST slices using DeepEP grouping.
     *
     * @param slices - List of AST slice nodes.
     * @param availableMask - Bitmask of enabled analyzers.
     * @returns Consolidated GroupedDispatchPlan.
     */
    public buildGroupedDispatchPlan(
        slices: ASTSliceNode[],
        availableMask: number = ALL_ANALYZERS_MASK,
    ): GroupedDispatchPlan<{
        id: string;
        filePath: string;
        activeMask: number;
        slice: ASTSliceNode;
    }> {
        const items = slices.map((slice) => {
            const { activeMask } = this.routeSliceToBitmask(slice, availableMask);
            return {
                id: slice.sliceId,
                filePath: slice.filePath,
                activeMask,
                slice,
            };
        });
        return defaultGroupedExpertDispatcher.buildDispatchPlan(items);
    }
}

/** Default singleton instance of SparseMoEGateRouter. */
export const defaultSparseMoEGateRouter = new SparseMoEGateRouter();
