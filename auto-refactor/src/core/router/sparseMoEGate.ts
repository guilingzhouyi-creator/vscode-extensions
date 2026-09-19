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

import {
    ANALYZER_ARCHITECTURE,
    ANALYZER_COMMENTS,
    ANALYZER_COMPLEXITY,
    ANALYZER_CONSTANTS,
    ANALYZER_DATA_ARCHITECTURE,
    ANALYZER_DOCS,
    ANALYZER_GOVERNANCE,
    ANALYZER_HYGIENE,
    ANALYZER_PERFORMANCE,
    ANALYZER_SECRETS,
    ANALYZER_SECURITY,
    ANALYZER_SIMPLIFY,
    ANALYZER_TYPESCRIPT_MODERN,
} from '../scoring/dimensionLiterals';
import { ALL_BUILTIN_ANALYZERS } from './sparseRuleRouter';
import type { ASTSliceNode, SliceFeatureVector, SparseRoutingPlan } from './sliceTypes';

/** Total available built-in analyzer count for ratio calculation. */
const TOTAL_BUILTIN_ANALYZERS = ALL_BUILTIN_ANALYZERS.length;

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
    const activeSet = new Set<string>();
    const reasons: string[] = [];

    if (vector.isDocOnly) {
        activeSet.add(ANALYZER_COMMENTS);
        activeSet.add(ANALYZER_DOCS);
        reasons.push('Doc-only mutation: cold bypass for all AST logic and complexity analyzers');
        return { analyzers: Array.from(activeSet), reasons };
    }

    if (
        vector.hasLiteralMutation &&
        !vector.hasControlFlowMutation &&
        !vector.hasSignatureMutation
    ) {
        activeSet.add(ANALYZER_CONSTANTS);
        activeSet.add(ANALYZER_SECRETS);
        reasons.push(
            'Literal-only mutation: targeted constant policy and credential leak inspection',
        );
        return { analyzers: Array.from(activeSet), reasons };
    }

    if (vector.hasSignatureMutation) {
        activeSet.add(ANALYZER_ARCHITECTURE);
        activeSet.add(ANALYZER_DATA_ARCHITECTURE);
        activeSet.add(ANALYZER_GOVERNANCE);
        activeSet.add(ANALYZER_HYGIENE);
        reasons.push(
            'Signature mutation: architectural boundary, layer isolation, and hygiene audit',
        );
    }

    if (vector.hasControlFlowMutation) {
        activeSet.add(ANALYZER_COMPLEXITY);
        activeSet.add(ANALYZER_SIMPLIFY);
        activeSet.add(ANALYZER_PERFORMANCE);
        activeSet.add(ANALYZER_GOVERNANCE);
        reasons.push(
            'Control-flow mutation: localized branching, nesting depth, and loop performance',
        );
    }

    if (vector.hasIoMutation) {
        activeSet.add(ANALYZER_SECURITY);
        activeSet.add(ANALYZER_PERFORMANCE);
        activeSet.add(ANALYZER_GOVERNANCE);
        reasons.push('I/O mutation: exception safety, resource leakage, and security audit');
    }

    if (vector.hasAsyncMutation) {
        activeSet.add(ANALYZER_PERFORMANCE);
        activeSet.add(ANALYZER_GOVERNANCE);
        activeSet.add(ANALYZER_COMPLEXITY);
        reasons.push('Async mutation: concurrency safety, reentrancy, and promise handling');
    }

    if (vector.hasTypeMutation) {
        activeSet.add(ANALYZER_DATA_ARCHITECTURE);
        activeSet.add(ANALYZER_TYPESCRIPT_MODERN);
        reasons.push('Type mutation: anti-corruption boundary and type modernity review');
    }

    if (activeSet.size === 0) {
        activeSet.add(ANALYZER_COMPLEXITY);
        activeSet.add(ANALYZER_GOVERNANCE);
        activeSet.add(ANALYZER_HYGIENE);
        reasons.push('General mutation: fallback to baseline core quality and governance rules');
    }

    return { analyzers: Array.from(activeSet), reasons };
}

/**
 * SparseMoEGateRouter implements Conditional Expert Dispatching for AST slices.
 */
export class SparseMoEGateRouter {
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
        const { analyzers, reasons } = dispatchSliceExperts(slice.featureVector);
        const availableSet = new Set(allAvailable);
        const activeAnalyzers = analyzers.filter((a) => availableSet.has(a));
        const activeSet = new Set(activeAnalyzers);
        const skippedAnalyzers = allAvailable.filter((a) => !activeSet.has(a));
        const totalCount = allAvailable.length > 0 ? allAvailable.length : TOTAL_BUILTIN_ANALYZERS;
        const activationRatio = Number((activeAnalyzers.length / totalCount).toFixed(3));

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

        for (const slice of slices) {
            const plan = this.routeSlice(slice, allAvailable);
            for (const a of plan.activeAnalyzers) {
                unionActive.add(a);
            }
            for (const r of plan.reasons) {
                if (!allReasons.includes(r)) {
                    allReasons.push(r);
                }
            }
        }

        const activeAnalyzers = Array.from(unionActive);
        const skippedAnalyzers = allAvailable.filter((a) => !unionActive.has(a));
        const totalCount = allAvailable.length > 0 ? allAvailable.length : TOTAL_BUILTIN_ANALYZERS;
        const activationRatio = Number((activeAnalyzers.length / totalCount).toFixed(3));

        return {
            sliceId: slices.map((s) => s.sliceId).join(','),
            filePath: slices[0].filePath,
            activeAnalyzers,
            skippedAnalyzers,
            activationRatio,
            reasons: allReasons,
        };
    }
}

/** Default singleton instance of SparseMoEGateRouter. */
export const defaultSparseMoEGateRouter = new SparseMoEGateRouter();
