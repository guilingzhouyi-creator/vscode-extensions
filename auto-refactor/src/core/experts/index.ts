/**
 * Module: Core Experts Facade & Unified Subsystem Entrypoint
 * File Path: src/core/experts/index.ts
 * Architecture Role: Unified substantive public surface for the MoE Expert Subsystem.
 *   Consolidates the authoritative expert catalog, activation library, query functions,
 *   and domain types into an immutable, frozen domain facade (ARCH-FAC-001).
 * Dependencies & Triggers: Consumed by core router, scanner, daemon, and API surfaces.
 * Responsibilities:
 *   1. Re-export domain contracts, catalog lookups, and algebraic projection functions;
 *   2. Provide O(1) query helper queryExpertProfile for polymorphic ID/bit lookups;
 *   3. Provide bitmask formatting helper formatActiveExpertNames;
 *   4. Expose the frozen ExpertActivationSubsystem domain facade.
 * Exit Semantics & Design Rationale: Immutable barrel and substantive facade; runtime overhead
 *   is strictly bounded to one-time shallow namespace freeze upon module initialization.
 */

import type { MoEExpertProfile } from './expert-types';
import {
    EXPERT_CATALOG,
    EXPERT_BY_ID,
    EXPERT_BY_BIT,
    EXPERT_BY_INDEX,
    EXPERT_MANIFEST,
} from './expert-catalog';
import {
    SHARED_EXPERTS,
    SHARED_EXPERTS_MASK,
    ALL_LANGUAGE_SPECIFIC_MASK,
    CATEGORY_BITMASK_MATRIX,
    ARCHETYPE_BITMASK_MATRIX,
    getCategoryBitmask,
    getArchetypeBitmask,
    getLanguageExclusiveBitmask,
    dispatchSliceFeatureBitset,
    deriveCategoryMatrix,
    deriveArchetypeMatrix,
} from './expert-activation-library';

export * from './expert-types';
export * from './expert-catalog';
export * from './expert-activation-library';
export * from './slice-dispatcher';

/**
 * Retrieve an expert profile by either string ID or numeric 32-bit integer bit.
 *
 * @param idOrBit - String identifier (e.g. 'complexity') or 32-bit bit (e.g. 1 << 12).
 * @returns Found MoEExpertProfile or undefined.
 */
export function queryExpertProfile(idOrBit: string | number): MoEExpertProfile | undefined {
    if (typeof idOrBit === 'string') {
        return EXPERT_BY_ID.get(idOrBit);
    }
    return EXPERT_BY_BIT.get(idOrBit);
}

const TOTAL_MOE_EXPERTS = 32;

/**
 * Format a 32-bit active bitmask into an immutable array of human-readable expert IDs.
 *
 * @param bitmask - 32-bit active bitmask.
 * @returns Readonly array of active expert string IDs.
 */
export function formatActiveExpertNames(bitmask: number): readonly string[] {
    const names: string[] = [];
    for (let i = 0; i < TOTAL_MOE_EXPERTS; i++) {
        const bit = 1 << i;
        if ((bitmask & bit) !== 0) {
            const exp = EXPERT_BY_BIT.get(bit);
            if (exp) {
                names.push(exp.id);
            }
        }
    }
    return Object.freeze(names);
}

/**
 * Authoritative unified MoE Expert Subsystem Facade.
 * Sealed with Object.freeze to guarantee substantive immutable runtime payload (ARCH-FAC-001).
 */
export const ExpertActivationSubsystem = Object.freeze({
    catalog: EXPERT_CATALOG,
    byId: EXPERT_BY_ID,
    byBit: EXPERT_BY_BIT,
    byIndex: EXPERT_BY_INDEX,
    manifest: EXPERT_MANIFEST,
    sharedExperts: SHARED_EXPERTS,
    sharedExpertsMask: SHARED_EXPERTS_MASK,
    allLanguageSpecificMask: ALL_LANGUAGE_SPECIFIC_MASK,
    categoryBitmaskMatrix: CATEGORY_BITMASK_MATRIX,
    archetypeBitmaskMatrix: ARCHETYPE_BITMASK_MATRIX,
    queryProfile: queryExpertProfile,
    formatNames: formatActiveExpertNames,
    getCategoryBitmask,
    getArchetypeBitmask,
    getLanguageExclusiveBitmask,
    dispatchSliceFeatureBitset,
    deriveCategoryMatrix,
    deriveArchetypeMatrix,
});
