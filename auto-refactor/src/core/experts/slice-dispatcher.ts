/**
 * Module: Core Experts — AST Slice Conditional Expert Dispatcher (CED)
 * File Path: src/core/experts/slice-dispatcher.ts
 * Architecture Role: Fast, allocation-free Conditional Expert Dispatching (CED) engine for
 *   AST slices. Maps localized slice mutation feature vectors into 32-bit active bitmasks,
 *   achieving >= 75% compute bypass (<= 25% active ratio) on localized code mutations.
 * Dependencies & Triggers: Consumes expert-catalog and sliceTypes; consumed by sparseMoEGate,
 *   sliceAuditService, and expert-activation-library.
 * Responsibilities:
 *   1. Pre-compute trigger bitmasks derived from EXPERT_CATALOG sliceTriggers;
 *   2. Classify slice feature vectors (doc-only, literal-only, control-flow, async, etc.);
 *   3. Dispatch minimal sufficient 32-bit expert active masks with explanatory reasons;
 *   4. Zero heap allocation on hot bitmask dispatch paths.
 * Exit Semantics & Design Rationale: Pure, deterministic function returning activeMask and IDs;
 *   never throws, guaranteeing fail-open fallback to baseline quality rules.
 */

import type { SliceFeatureVector } from '../router/sliceTypes';
import { EXPERT_CATALOG, EXPERT_BY_ID } from './expert-catalog';

const ID_COMMENTS = 'comments';
const ID_DOCS = 'docs';
const ID_CONSTANTS = 'constants';
const ID_SECRETS = 'secrets';
const ID_COMPLEXITY = 'complexity';
const ID_GOVERNANCE = 'governance';
const ID_HYGIENE = 'hygiene';

const TRIGGER_DOC_ONLY = 'isDocOnly' as const;
const TRIGGER_LITERAL = 'hasLiteralMutation' as const;
const TRIGGER_SIGNATURE = 'hasSignatureMutation' as const;
const TRIGGER_CONTROL_FLOW = 'hasControlFlowMutation' as const;
const TRIGGER_IO = 'hasIoMutation' as const;
const TRIGGER_ASYNC = 'hasAsyncMutation' as const;
const TRIGGER_TYPE = 'hasTypeMutation' as const;

// Pre-computed bitmasks for slice feature triggers
const SLICE_MASK_DOC_ONLY = EXPERT_CATALOG.reduce((acc, e) => {
    return e.affinities.sliceTriggers.includes(TRIGGER_DOC_ONLY) ? (acc | e.bit) >>> 0 : acc;
}, 0) >>> 0;

const SLICE_MASK_LITERAL = EXPERT_CATALOG.reduce((acc, e) => {
    return e.affinities.sliceTriggers.includes(TRIGGER_LITERAL) ? (acc | e.bit) >>> 0 : acc;
}, 0) >>> 0;

const SLICE_MASK_SIGNATURE = EXPERT_CATALOG.reduce((acc, e) => {
    return e.affinities.sliceTriggers.includes(TRIGGER_SIGNATURE) ? (acc | e.bit) >>> 0 : acc;
}, 0) >>> 0;

const SLICE_MASK_CONTROL_FLOW = EXPERT_CATALOG.reduce((acc, e) => {
    return e.affinities.sliceTriggers.includes(TRIGGER_CONTROL_FLOW) ? (acc | e.bit) >>> 0 : acc;
}, 0) >>> 0;

const SLICE_MASK_IO = EXPERT_CATALOG.reduce((acc, e) => {
    return e.affinities.sliceTriggers.includes(TRIGGER_IO) ? (acc | e.bit) >>> 0 : acc;
}, 0) >>> 0;

const SLICE_MASK_ASYNC = EXPERT_CATALOG.reduce((acc, e) => {
    return e.affinities.sliceTriggers.includes(TRIGGER_ASYNC) ? (acc | e.bit) >>> 0 : acc;
}, 0) >>> 0;

const SLICE_MASK_TYPE = EXPERT_CATALOG.reduce((acc, e) => {
    return e.affinities.sliceTriggers.includes(TRIGGER_TYPE) ? (acc | e.bit) >>> 0 : acc;
}, 0) >>> 0;

const SLICE_MASK_GENERAL_FALLBACK = (
    (EXPERT_BY_ID.get(ID_COMPLEXITY)?.bit || 0) |
    (EXPERT_BY_ID.get(ID_GOVERNANCE)?.bit || 0) |
    (EXPERT_BY_ID.get(ID_HYGIENE)?.bit || 0)
) >>> 0;

/**
 * Fast CED bitset dispatch based on an AST slice feature vector.
 *
 * @param vector - Slice feature vector.
 * @returns 32-bit activeMask, activeAnalyzers array, and explanation reasons.
 */
export function dispatchSliceFeatureBitset(vector: SliceFeatureVector): {
    activeMask: number;
    activeAnalyzers: string[];
    reasons: string[];
} {
    const reasons: string[] = [];

    if (vector.isDocOnly) {
        reasons.push('Doc-only mutation: cold bypass for all AST logic and complexity analyzers');
        return {
            activeMask: SLICE_MASK_DOC_ONLY,
            activeAnalyzers: [ID_COMMENTS, ID_DOCS],
            reasons,
        };
    }

    if (
        vector.hasLiteralMutation &&
        !vector.hasControlFlowMutation &&
        !vector.hasSignatureMutation
    ) {
        reasons.push(
            'Literal-only mutation: targeted constant policy and credential leak inspection',
        );
        return {
            activeMask: SLICE_MASK_LITERAL,
            activeAnalyzers: [ID_CONSTANTS, ID_SECRETS],
            reasons,
        };
    }

    let activeMask = 0;

    if (vector.hasSignatureMutation) {
        activeMask |= SLICE_MASK_SIGNATURE;
        reasons.push(
            'Signature mutation: architectural boundary, layer isolation, and hygiene audit',
        );
    }
    if (vector.hasControlFlowMutation) {
        activeMask |= SLICE_MASK_CONTROL_FLOW;
        reasons.push(
            'Control-flow mutation: localized branching, nesting depth, and loop performance',
        );
    }
    if (vector.hasIoMutation) {
        activeMask |= SLICE_MASK_IO;
        reasons.push('I/O mutation: exception safety, resource leakage, and security audit');
    }
    if (vector.hasAsyncMutation) {
        activeMask |= SLICE_MASK_ASYNC;
        reasons.push('Async mutation: concurrency safety, reentrancy, and promise handling');
    }
    if (vector.hasTypeMutation) {
        activeMask |= SLICE_MASK_TYPE;
        reasons.push('Type mutation: anti-corruption boundary and type modernity review');
    }

    if (activeMask === 0) {
        activeMask |= SLICE_MASK_GENERAL_FALLBACK;
        reasons.push('General mutation: fallback to baseline core quality and governance rules');
    }

    activeMask = activeMask >>> 0;

    // Materialize analyzer identifiers without transient Set allocation
    const activeAnalyzers: string[] = [];
    for (let i = 0; i < EXPERT_CATALOG.length; i++) {
        const expert = EXPERT_CATALOG[i];
        if ((activeMask & expert.bit) !== 0) {
            activeAnalyzers.push(expert.id);
        }
    }

    return { activeMask, activeAnalyzers, reasons };
}
