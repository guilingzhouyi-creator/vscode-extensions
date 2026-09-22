/**
 * Module: Core Router — Dynamic Activation Matrix Derivation
 * File Path: src/core/router/expert-matrices.ts
 * Architecture Role: Pure derivation functions for category and archetype activation
 *   matrices from the expert manifest single source of truth (C-01, C-02, §2-2).
 * Dependencies & Triggers: Pure functions; invoked by router initialization and testing guards.
 * Responsibilities:
 *   1. Dynamically compute category-to-analyzer mapping matrix from expert signals.
 *   2. Dynamically compute archetype-to-analyzer activation matrix from expert declarations.
 * Exit Semantics & Design Rationale: Pure deterministic calculation with zero I/O and zero
 *   side effects.
 */

import type { ProjectArchetype } from '../types';
import {
    ANALYZER_CONSTANTS,
    ANALYZER_LARGE_FILE,
    ANALYZER_COMPLEXITY,
    ANALYZER_GOVERNANCE,
    ANALYZER_DEPENDENCY_GRAPH,
    ANALYZER_ARCHITECTURE,
    ANALYZER_PERFORMANCE,
    ANALYZER_COMMENTS,
    ANALYZER_HYGIENE,
    ANALYZER_SECURITY,
    ANALYZER_SIMPLIFY,
    ANALYZER_PYTHON_MODERN,
    ANALYZER_TYPESCRIPT_MODERN,
    ANALYZER_RUST_MODERN,
    ANALYZER_GDSCRIPT_MODERN,
    ANALYZER_DOCS,
} from '../scoring/dimensionLiterals';
import type { ExpertManifestEntry } from './expert-manifest';
const SIG_LITERAL = 'LITERAL';
const SIG_CONTROL_FLOW = 'CONTROL_FLOW';
const SIG_INTERFACE_SIGNATURE = 'INTERFACE_SIGNATURE';
const SIG_IMPORT_EXPORT = 'IMPORT_EXPORT';
const SIG_COMMENT_DOC_ONLY = 'COMMENT_DOC_ONLY';
const SIG_DOC_COMMENT = 'DOC_COMMENT';
const SIG_GENERAL_CODE = 'GENERAL_CODE';

const CAT_LITERAL_ONLY = 'LITERAL_ONLY';
const CAT_CONTROL_FLOW = 'CONTROL_FLOW';
const CAT_INTERFACE_SIGNATURE = 'INTERFACE_SIGNATURE';
const CAT_IMPORT_EXPORT = 'IMPORT_EXPORT';
const CAT_COMMENT_DOC_ONLY = 'COMMENT_DOC_ONLY';
const CAT_GENERAL_CODE = 'GENERAL_CODE';

function mapSignalToCategory(sig: string, entryId: string): string | null {
    switch (sig) {
        case SIG_LITERAL:
            return CAT_LITERAL_ONLY;
        case SIG_CONTROL_FLOW:
            return CAT_CONTROL_FLOW;
        case SIG_INTERFACE_SIGNATURE:
            return CAT_INTERFACE_SIGNATURE;
        case SIG_IMPORT_EXPORT:
            return CAT_IMPORT_EXPORT;
        case SIG_COMMENT_DOC_ONLY:
            return CAT_COMMENT_DOC_ONLY;
        case SIG_DOC_COMMENT:
            return entryId === ANALYZER_COMMENTS ? CAT_COMMENT_DOC_ONLY : null;
        case SIG_GENERAL_CODE:
            return CAT_GENERAL_CODE;
        default:
            return null;
    }
}

function populateEntryCategories(
    entry: ExpertManifestEntry,
    result: Record<string, string[]>,
): void {
    for (let s = 0; s < entry.signals.length; s++) {
        const cat = mapSignalToCategory(entry.signals[s], entry.id);
        if (cat) {
            result[cat].push(entry.id);
        }
    }
}

/**
 * Dynamically derive the category-to-analyzer mapping matrix from manifest signals.
 *
 * @param manifest - Expert manifest entries.
 * @returns Map of category name to list of activated analyzer ids.
 */
export function deriveCategoryMatrix(
    manifest: readonly ExpertManifestEntry[],
): Record<string, readonly string[]> {
    const result: Record<string, string[]> = {
        [CAT_LITERAL_ONLY]: [],
        [CAT_CONTROL_FLOW]: [],
        [CAT_INTERFACE_SIGNATURE]: [],
        [CAT_IMPORT_EXPORT]: [],
        [CAT_COMMENT_DOC_ONLY]: [],
        [CAT_GENERAL_CODE]: [],
    };

    for (const entry of manifest) {
        populateEntryCategories(entry, result);
    }

    return result;
}

/**
 * Dynamically derive the archetype-to-analyzer mapping matrix.
 *
 * @param manifest - Expert manifest entries.
 * @returns Map of project archetype to activated analyzer ids.
 */
export function deriveArchetypeMatrix(
    manifest: readonly ExpertManifestEntry[],
): Record<ProjectArchetype, readonly string[]> {
    const byId = new Map(manifest.map((e) => [e.id, e]));

    const pick = (ids: readonly string[]) => ids.filter((id) => byId.has(id));

    return {
        demo: pick([ANALYZER_CONSTANTS, ANALYZER_HYGIENE, ANALYZER_SIMPLIFY, ANALYZER_COMMENTS]),
        web: pick([
            ANALYZER_SECURITY,
            ANALYZER_HYGIENE,
            ANALYZER_CONSTANTS,
            ANALYZER_PERFORMANCE,
            ANALYZER_GOVERNANCE,
            ANALYZER_TYPESCRIPT_MODERN,
            ANALYZER_COMPLEXITY,
        ]),
        game: pick([
            ANALYZER_PERFORMANCE,
            ANALYZER_GDSCRIPT_MODERN,
            ANALYZER_RUST_MODERN,
            ANALYZER_GOVERNANCE,
            ANALYZER_HYGIENE,
            ANALYZER_COMPLEXITY,
            ANALYZER_CONSTANTS,
        ]),
        library: pick([
            ANALYZER_ARCHITECTURE,
            ANALYZER_DEPENDENCY_GRAPH,
            ANALYZER_TYPESCRIPT_MODERN,
            ANALYZER_PYTHON_MODERN,
            ANALYZER_RUST_MODERN,
            ANALYZER_DOCS,
            ANALYZER_COMMENTS,
            ANALYZER_GOVERNANCE,
            ANALYZER_HYGIENE,
            ANALYZER_LARGE_FILE,
            ANALYZER_COMPLEXITY,
            ANALYZER_CONSTANTS,
        ]),
    };
}
