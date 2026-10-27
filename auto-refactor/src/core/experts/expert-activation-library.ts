/**
 * Module: Core Experts - Centralized MoE Expert Activation Library
 * File Path: src/core/experts/expert-activation-library.ts
 * Architecture Role: Centralized intelligence and mathematical projection engine for the MoE
 *   expert activation subsystem. Derives all category, archetype, language, slice-feature, and
 *   memory-tier activation bitmasks via pure algebraic projections from EXPERT_CATALOG.
 * Dependencies & Triggers: Consumes expert-catalog, expert-types, and sliceTypes; consumed by
 *   sparseRuleRouter, sparseMoEGate, sliceAuditService, and daemon.
 * Responsibilities:
 *   1. Provide O(1) indexed lookups and bitmask queries for all 32 MoE experts;
 *   2. Dynamically project category and archetype activation matrices without hardcoding;
 *   3. Generate language-exclusive and language-specific activation bitmasks;
 *   4. Dispatch AST slice feature vectors into 32-bit active bitmasks;
 *   5. Enforce C-04 security fallback policy and manifest structural invariants.
 * Exit Semantics & Design Rationale: Pure, deterministic calculations with zero heap
 *   allocations on bitmask hot paths; guarantees 100% architectural consistency.
 */

import type { ProjectArchetype } from '../types';
import type { DiffSemanticCategory } from '../router/sliceTypes';
import {
    CATEGORY_LITERAL_ONLY,
    CATEGORY_CONTROL_FLOW,
    CATEGORY_INTERFACE_SIGNATURE,
    CATEGORY_IMPORT_EXPORT,
    CATEGORY_COMMENT_DOC_ONLY,
    CATEGORY_GENERAL_CODE,
} from '../router/sliceTypes';
import type { MoEExpertProfile } from './expert-types';
import type { LegacyExpertManifestEntry } from './expert-catalog';
import { EXPERT_CATALOG, EXPERT_BY_ID, EXPERT_BY_BIT } from './expert-catalog';

// ============================================================================
// 1. Pre-Computed Static Projections (Pure Algebraic SSOT)
// ============================================================================

const ALL_DIFF_CATEGORIES = Object.freeze([
    CATEGORY_LITERAL_ONLY,
    CATEGORY_CONTROL_FLOW,
    CATEGORY_INTERFACE_SIGNATURE,
    CATEGORY_IMPORT_EXPORT,
    CATEGORY_COMMENT_DOC_ONLY,
    CATEGORY_GENERAL_CODE,
]);

const ALL_PROJECT_ARCHETYPES = Object.freeze([
    'demo',
    'web',
    'game',
    'library',
    'stdlib',
    'systems_runtime',
] as const);

/**
 * 32-bit bitmask activation matrix per semantic diff category.
 */
export const CATEGORY_BITMASK_MATRIX: Readonly<Record<DiffSemanticCategory, number>> =
    Object.freeze(
        Object.fromEntries(
            ALL_DIFF_CATEGORIES.map((cat) => {
                const mask = EXPERT_CATALOG.reduce((acc, expert) => {
                    return expert.affinities.categories.includes(cat)
                        ? (acc | expert.bit) >>> 0
                        : acc;
                }, 0);
                return [cat, mask];
            }),
        ) as Record<DiffSemanticCategory, number>,
    );

/**
 * String identifier activation matrix per semantic diff category.
 */
export const CATEGORY_ANALYZER_MAP: Readonly<Record<DiffSemanticCategory, readonly string[]>> =
    Object.freeze(
        Object.fromEntries(
            ALL_DIFF_CATEGORIES.map((cat) => [
                cat,
                Object.freeze(
                    EXPERT_CATALOG.filter((expert) =>
                        expert.affinities.categories.includes(cat),
                    ).map((expert) => expert.id),
                ),
            ]),
        ) as Record<DiffSemanticCategory, readonly string[]>,
    );

/**
 * 32-bit bitmask activation matrix per project archetype.
 */
export const ARCHETYPE_BITMASK_MATRIX: Readonly<Record<ProjectArchetype, number>> = Object.freeze(
    Object.fromEntries(
        ALL_PROJECT_ARCHETYPES.map((arch) => {
            const mask = EXPERT_CATALOG.reduce((acc, expert) => {
                return expert.affinities.archetypes.includes(arch) ? (acc | expert.bit) >>> 0 : acc;
            }, 0);
            return [arch, mask];
        }),
    ) as Record<ProjectArchetype, number>,
);

/**
 * String identifier activation matrix per project archetype.
 */
export const ARCHETYPE_ANALYZER_MAP: Readonly<Record<ProjectArchetype, readonly string[]>> =
    Object.freeze(
        Object.fromEntries(
            ALL_PROJECT_ARCHETYPES.map((arch) => [
                arch,
                Object.freeze(
                    EXPERT_CATALOG.filter((expert) =>
                        expert.affinities.archetypes.includes(arch),
                    ).map((expert) => expert.id),
                ),
            ]),
        ) as Record<ProjectArchetype, readonly string[]>,
    );

/**
 * Language exclusive analyzer identifier map.
 * Dynamically projected from EXPERT_CATALOG language affinities.
 */
export const LANGUAGE_EXCLUSIVE_ANALYZERS: Readonly<Record<string, readonly string[]>> =
    Object.freeze(
        Object.fromEntries(
            ['typescript', 'javascript', 'python', 'rust', 'gdscript', 'go', 'shell'].map(
                (lang) => {
                    const list = EXPERT_CATALOG.filter((expert) =>
                        expert.affinities.languages?.includes(lang),
                    ).map((expert) => expert.id);
                    return [lang, Object.freeze(list)];
                },
            ),
        ),
    );

/**
 * Pre-computed Set lookups for language exclusive analyzer filters.
 */
export const LANGUAGE_EXCLUSIVE_SETS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze(
    Object.fromEntries(
        Object.entries(LANGUAGE_EXCLUSIVE_ANALYZERS).map(([lang, list]) => [
            lang,
            new Set<string>(list),
        ]),
    ),
);

/**
 * Language exclusive 32-bit bitmask map.
 */
export const LANGUAGE_EXCLUSIVE_BITMASK: Readonly<Record<string, number>> = Object.freeze(
    Object.fromEntries(
        Object.entries(LANGUAGE_EXCLUSIVE_ANALYZERS).map(([lang, list]) => {
            const mask = list.reduce((acc, analyzerId) => {
                const exp = EXPERT_BY_ID.get(analyzerId);
                return exp ? (acc | exp.bit) >>> 0 : acc;
            }, 0);
            return [lang, mask];
        }),
    ),
);

/**
 * All language-specific specialized modernizer analyzer identifiers.
 * Dynamically projected from EXPERT_CATALOG language affinities.
 */
export const ALL_LANGUAGE_SPECIFIC_ANALYZERS: readonly string[] = Object.freeze(
    EXPERT_CATALOG.filter(
        (expert) => expert.affinities.languages && expert.affinities.languages.length > 0,
    ).map((expert) => expert.id),
);

/**
 * 32-bit bitmask of all language-specific specialized modernizers.
 */
export const ALL_LANGUAGE_SPECIFIC_MASK: number =
    ALL_LANGUAGE_SPECIFIC_ANALYZERS.reduce((acc, analyzerId) => {
        const exp = EXPERT_BY_ID.get(analyzerId);
        return exp ? (acc | exp.bit) >>> 0 : acc;
    }, 0) >>> 0;

/**
 * N_shared baseline expert identifiers.
 */
export const SHARED_EXPERTS: readonly string[] = Object.freeze(
    EXPERT_CATALOG.filter((expert) => expert.serving.isShared).map((expert) => expert.id),
);

/**
 * N_shared baseline 32-bit bitmask (Hygiene + Constants).
 */
export const SHARED_EXPERTS_MASK: number =
    EXPERT_CATALOG.reduce((acc, expert) => {
        return expert.serving.isShared ? (acc | expert.bit) >>> 0 : acc;
    }, 0) >>> 0;

/**
 * Hot resident pool 32-bit bitmask (memoryTier === 'resident').
 */
export const HOT_RESIDENT_BITMASK: number =
    EXPERT_CATALOG.reduce((acc, expert) => {
        return expert.serving.memoryTier === 'resident' ? (acc | expert.bit) >>> 0 : acc;
    }, 0) >>> 0;

/**
 * Specialized (non-default) expert 32-bit bitmask.
 */
export const SPECIALIZED_EXPERTS_BITMASK: number =
    EXPERT_CATALOG.reduce((acc, expert) => {
        return expert.governance.isSpecialized ? (acc | expert.bit) >>> 0 : acc;
    }, 0) >>> 0;

/**
 * Pre-computed immutable base score table for every expert bit derived from EXPERT_CATALOG.
 */
export const EXPERT_BASE_SCORES: Readonly<Record<number, number>> = Object.freeze(
    Object.fromEntries(EXPERT_CATALOG.map((expert) => [expert.bit, expert.serving.baseScore])),
);

export { dispatchSliceFeatureBitset } from './slice-dispatcher';

// ============================================================================
// 2. Public Query & Bitmask API
// ============================================================================

/**
 * Retrieve expert profile by string identifier.
 *
 * @param expertId - Catalog identifier exactly as declared in the expert manifest.
 * @returns The matching profile, or undefined when the identifier is not registered.
 */
export function getExpertProfile(expertId: string): MoEExpertProfile | undefined {
    return EXPERT_BY_ID.get(expertId);
}

/**
 * Retrieve expert profile by 32-bit single-word bitmask.
 *
 * @param bit - Single-bit mask value; multi-bit masks address no single expert.
 * @returns The profile holding that bit, or undefined when the bit is unassigned.
 */
export function getExpertProfileByBit(bit: number): MoEExpertProfile | undefined {
    return EXPERT_BY_BIT.get(bit);
}

/**
 * Retrieve all 32 expert profiles.
 *
 * @returns The frozen catalog in declaration order; callers must not sort or mutate it.
 */
export function getAllExpertProfiles(): readonly MoEExpertProfile[] {
    return EXPERT_CATALOG;
}

/**
 * Query active 32-bit bitmask for a semantic diff category.
 *
 * @param category - Semantic category of the change being classified.
 * @returns The combined expert bitmask, or zero when the category activates no expert.
 */
export function getCategoryBitmask(category: DiffSemanticCategory): number {
    return CATEGORY_BITMASK_MATRIX[category] || 0;
}

/**
 * Query active 32-bit bitmask for a project archetype.
 *
 * @param archetype - Project archetype detected for the current workspace.
 * @returns The combined expert bitmask, or zero when the archetype activates no expert.
 */
export function getArchetypeBitmask(archetype: ProjectArchetype): number {
    return ARCHETYPE_BITMASK_MATRIX[archetype] || 0;
}

/**
 * Query active 32-bit bitmask for an exclusive programming language.
 *
 * @param language - Language name as recognised by the language adapters; matched
 *   case-insensitively.
 * @returns The combined expert bitmask, or zero when the language activates no exclusive expert.
 */
export function getLanguageExclusiveBitmask(language: string): number {
    return LANGUAGE_EXCLUSIVE_BITMASK[language.toLowerCase()] || 0;
}

// ============================================================================
// 3. Backward-Compatible Matrix Derivation & Validation Shims
// ============================================================================

/**
 * Dynamically derive the category-to-analyzer mapping matrix.
 *
 * Fully backward-compatible with legacy deriveCategoryMatrix(manifest).
 *
 * @param _manifest - Legacy manifest argument, accepted for signature compatibility only. The
 *   catalog is now compiled in, so the value is ignored and passing it changes nothing.
 * @returns The frozen category-to-analyzer map.
 */
export function deriveCategoryMatrix(
    _manifest?: readonly LegacyExpertManifestEntry[],
): Record<DiffSemanticCategory, readonly string[]> {
    return CATEGORY_ANALYZER_MAP;
}

/**
 * Dynamically derive the archetype-to-analyzer mapping matrix.
 *
 * Fully backward-compatible with legacy deriveArchetypeMatrix(manifest).
 *
 * @param _manifest - Legacy manifest argument, accepted for signature compatibility only. The
 *   catalog is now compiled in, so the value is ignored and passing it changes nothing.
 * @returns The frozen archetype-to-analyzer map.
 */
export function deriveArchetypeMatrix(
    _manifest?: readonly LegacyExpertManifestEntry[],
): Record<ProjectArchetype, readonly string[]> {
    return ARCHETYPE_ANALYZER_MAP;
}

/**
 * Validate manifest integrity and normative constraints (C-01, C-02, C-04, N-08).
 *
 * @param manifest - List of expert manifests to validate.
 */
export function validateExpertManifest(manifest: readonly LegacyExpertManifestEntry[]): void {
    const ids = new Set<string>();
    for (const entry of manifest) {
        if (ids.has(entry.id)) {
            throw new Error(`[DUPLICATE_EXPERT_ID] Duplicate expert id: ${entry.id}`);
        }
        ids.add(entry.id);

        if (!entry.signals || entry.signals.length === 0) {
            throw new Error(`[EMPTY_SIGNALS] Expert ${entry.id} must declare at least one signal`);
        }

        if (entry.steadyCostUs < 0) {
            throw new Error(`[INVALID_COST] Expert ${entry.id} steadyCostUs must be non-negative`);
        }

        if (entry.weight <= 0) {
            throw new Error(`[INVALID_WEIGHT] Expert ${entry.id} weight must be positive`);
        }

        // C-04: Security family strictly prohibited from fallback 'skip'
        if (entry.isSecurityFamily && entry.fallback === 'skip') {
            throw new Error(
                `[SECURITY_FALLBACK_VIOLATION] Security expert ${entry.id} cannot declare fallback 'skip'`,
            );
        }
    }
}
