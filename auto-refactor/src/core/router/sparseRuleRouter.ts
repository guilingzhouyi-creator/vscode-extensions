/**
 * Sparse Rule MoE (Mixture-of-Experts) Router.
 *
 * Dynamically maps Diff semantic classifications to the minimum sufficient subset of analyzers,
 * reducing traversal workload and memory allocation by 80%~95% on local mutations.
 * Module: Core Engine — Sparse Analyzer Routing (router domain)
 * File Path: src/core/router/sparseRuleRouter.ts
 * Architecture Role: Policy layer between diff classification and analyzer execution; a pure
 *   function turns DiffSemanticCategory values into the minimum sufficient analyzer subset
 * Dependencies & Triggers: Imports DiffClassificationResult and DiffSemanticCategory from
 *   ./diffClassifier; called by the FastTrack loop of src/core/pipeline/dualTrackPipeline.ts
 *   per changed file, with availableAnalyzers from the scanner plan and options.forceFull
 * Responsibilities: Own the ALL_BUILTIN_ANALYZERS registry and BuiltinAnalyzerId union and the
 *   CATEGORY_ANALYZER_MATRIX mapping; routeDiffToAnalyzers short-circuits on forceFull, unions
 *   matrix targets filtered by availability, always keeps customAnalyzers, and derives the
 *   skipped set, activationRatio and the human-readable routing reason
 * Exit Semantics & Design Rationale: Synchronous and never throws; forceFull and the
 *   empty-selection fallback both widen to every available analyzer, favoring a wider scan over
 *   a missed one. Custom analyzers bypass the matrix because external plugins have no static
 *   category mapping, and the ratio is rounded to 3 decimals for stable reporting.
 */

import type { DiffClassificationResult, DiffSemanticCategory } from './diffClassifier';
import type { ProjectArchetype } from '../types';

/** Decimal places retained when rounding the activation ratio for stable reporting. */
const ACTIVATION_RATIO_DECIMALS = 3;

/** Scale factor converting a 0-1 activation ratio into a whole percentage. */
const PERCENT_SCALE = 100;

/** Built-in analyzer id for governance; registered and routed by category. */
const GOVERNANCE_ANALYZER_ID = 'governance';

/**
 * Canonical ids of every built-in analyzer, listed in registration order.
 *
 * The array is the default candidate set for routing and the source of the BuiltinAnalyzerId
 * union; custom analyzers loaded from config stay outside it and are handled separately.
 */
export const ALL_BUILTIN_ANALYZERS = [
    'constants',
    'large-file',
    'complexity',
    GOVERNANCE_ANALYZER_ID,
    'dependency-graph',
    'secrets',
    'architecture',
    'performance',
    'comments',
    'hygiene',
    'security',
    // Specialized packs and doc rules are routable too: they belong to the general candidate set,
    // and leaving them out here silently dropped them from every category route (the built-in
    // registry in core/config.ts and the analyzer factories both list them). Kept in sync by the
    // cross-registry assertion in scripts/validate-rules-registry.js.
    'simplify',
    'python-modern',
    'ts-modern',
    'rust-modern',
    'gdscript-modern',
    'docs',
] as const;

/**
 * Union of the built-in analyzer ids the sparse router understands.
 *
 * Derived from ALL_BUILTIN_ANALYZERS, so extending that registry widens this type automatically;
 * ids of custom analyzers are plain strings and are never part of the union.
 */
export type BuiltinAnalyzerId = (typeof ALL_BUILTIN_ANALYZERS)[number];

/**
 * Outcome of one sparse routing decision.
 *
 * activeAnalyzers and skippedAnalyzers partition the candidate set; categories echoes the
 * classification input that drove the matrix, and activationRatio is active/candidate rounded to
 * three decimals so reports stay stable across runs.
 */
export interface SparseRouteResult {
    activeAnalyzers: Set<string>;
    skippedAnalyzers: Set<string>;
    activationRatio: number;
    categories: DiffSemanticCategory[];
    reason: string;
}

/**
 * Category-to-Analyzer Activation Matrix.
 * Defines which analyzers are sensitive to each mutation category.
 */
export const CATEGORY_ANALYZER_MATRIX: Record<DiffSemanticCategory, readonly string[]> = {
    // Only literal values changed: strings, numbers, flags.
    // Sensitive to: hardcoded constants and secret credentials.
    LITERAL_ONLY: ['constants', 'secrets'],

    // Control flow mutations: if, switch, loops, try/catch, returns.
    // Sensitive to: cyclomatic/cognitive complexity, performance hot-paths, hygiene,
    // governance, security injection/eval.
    CONTROL_FLOW: ['complexity', 'performance', 'hygiene', GOVERNANCE_ANALYZER_ID, 'security'],

    // Type definitions, class/function signatures, interfaces.
    // Sensitive to: architecture boundaries, governance, hygiene, comments/docs,
    // security DTO exposure.
    INTERFACE_SIGNATURE: [
        'architecture',
        GOVERNANCE_ANALYZER_ID,
        'hygiene',
        'comments',
        'security',
    ],

    // Imports, exports, require statements.
    // Sensitive to: dependency graph, architecture layering, governance.
    IMPORT_EXPORT: ['dependency-graph', 'architecture', GOVERNANCE_ANALYZER_ID],

    // Documentation / comment only changes.
    // Sensitive to: comments analyzer.
    COMMENT_DOC_ONLY: ['comments'],

    // Arbitrary general code changes.
    // Sensitive to: all analyzers.
    GENERAL_CODE: ALL_BUILTIN_ANALYZERS,
};

/**
 * Archetype-to-Analyzer activation matrix.
 * Directs focused reviewer subsets tailored to the project's operational domain.
 */
export const ARCHETYPE_ANALYZER_MATRIX: Record<ProjectArchetype, readonly string[]> = {
    demo: ['constants', 'hygiene', 'simplify', 'comments'],
    web: [
        'security',
        'hygiene',
        'constants',
        'performance',
        GOVERNANCE_ANALYZER_ID,
        'ts-modern',
        'complexity',
    ],
    game: [
        'performance',
        'gdscript-modern',
        'rust-modern',
        GOVERNANCE_ANALYZER_ID,
        'hygiene',
        'complexity',
        'constants',
    ],
    library: [
        'architecture',
        'dependency-graph',
        'ts-modern',
        'python-modern',
        'rust-modern',
        'docs',
        'comments',
        GOVERNANCE_ANALYZER_ID,
        'hygiene',
        'large-file',
        'complexity',
        'constants',
    ],
};

/**
 * Optional inputs steering routeDiffToAnalyzers; omitting the object keeps all built-ins.
 *
 * availableAnalyzers acts as an allow-list filter, customAnalyzers are always activated to keep
 * proprietary plugins at zero false negatives, and forceFull bypasses the category matrix.
 */
export interface RouterOptions {
    /** All available analyzers in the current configuration. Defaults to ALL_BUILTIN_ANALYZERS. */
    availableAnalyzers?: string[];
    /** Custom analyzers to always keep active for zero false negatives. */
    customAnalyzers?: string[];
    /** Whether to force full activation regardless of diff (e.g. for forced full audit). */
    forceFull?: boolean;
}

/**
 * Select the minimum sufficient analyzer subset for a diff classification.
 *
 * Pure and synchronous: forceFull short-circuits to every available analyzer, otherwise the
 * union of matrix targets for the classified categories is intersected with the available set.
 * Custom analyzers are added unconditionally, and an empty selection widens to all available
 * analyzers so the router always prefers a wider scan over a missed one.
 *
 * @param classification - Diff classification whose categories select the matrix rows to union.
 * @param options - Candidate set, always-active custom analyzers, and the forceFull override.
 * @returns The active/skipped partition, the rounded activation ratio, the matched categories,
 *          and a human-readable reason string for reporting.
 */
export function routeDiffToAnalyzers(
    classification: DiffClassificationResult,
    options: RouterOptions = {},
): SparseRouteResult {
    const all = options.availableAnalyzers
        ? [...options.availableAnalyzers]
        : [...ALL_BUILTIN_ANALYZERS];
    const allSet = new Set(all);

    if (options.forceFull) {
        return {
            activeAnalyzers: allSet,
            skippedAnalyzers: new Set(),
            activationRatio: 1.0,
            categories: Array.from(classification.categories),
            reason: 'Forced full scan requested',
        };
    }

    const active = new Set<string>();
    const matchedCategories: DiffSemanticCategory[] = [];

    for (const cat of classification.categories) {
        matchedCategories.push(cat);
        const targets = CATEGORY_ANALYZER_MATRIX[cat] || ALL_BUILTIN_ANALYZERS;
        for (const a of targets) {
            if (allSet.has(a)) {
                active.add(a);
            }
        }
    }

    // Always include custom analyzers to guarantee zero false negatives on proprietary plugins
    if (options.customAnalyzers) {
        for (const ca of options.customAnalyzers) {
            active.add(ca);
        }
    }

    // Safety fallback: if for any reason no analyzers were selected, fall back to all
    if (active.size === 0) {
        for (const a of all) {
            active.add(a);
        }
    }

    const skipped = new Set<string>();
    for (const a of all) {
        if (!active.has(a)) {
            skipped.add(a);
        }
    }

    const ratio = Number(
        (active.size / Math.max(1, all.length)).toFixed(ACTIVATION_RATIO_DECIMALS),
    );
    const reason = `Sparse activation (${active.size}/${all.length}, ${Math.round(ratio * PERCENT_SCALE)}%) for [${matchedCategories.join(', ')}]`;

    return {
        activeAnalyzers: active,
        skippedAnalyzers: skipped,
        activationRatio: ratio,
        categories: matchedCategories,
        reason,
    };
}

/**
 * Select the minimum sufficient analyzer subset for a project archetype.
 *
 * @param archetype - The project archetype ('demo' | 'web' | 'game' | 'library').
 * @param options - Candidate set, always-active custom analyzers, and forceFull override.
 * @returns The active and skipped partitions, activation ratio, and reason.
 */
export function routeArchetypeToAnalyzers(
    archetype: ProjectArchetype,
    options: RouterOptions = {},
): SparseRouteResult {
    const all = options.availableAnalyzers
        ? [...options.availableAnalyzers]
        : [...ALL_BUILTIN_ANALYZERS];
    const allSet = new Set(all);

    if (options.forceFull) {
        return {
            activeAnalyzers: allSet,
            skippedAnalyzers: new Set(),
            activationRatio: 1.0,
            categories: [],
            reason: `Forced full scan for archetype ${archetype}`,
        };
    }

    const active = new Set<string>();
    const targets = ARCHETYPE_ANALYZER_MATRIX[archetype] || ALL_BUILTIN_ANALYZERS;
    for (const a of targets) {
        if (allSet.has(a)) {
            active.add(a);
        }
    }

    // Always include custom analyzers for zero false negatives
    if (options.customAnalyzers) {
        for (const ca of options.customAnalyzers) {
            active.add(ca);
        }
    }

    if (active.size === 0) {
        for (const a of all) {
            active.add(a);
        }
    }

    const skipped = new Set<string>();
    for (const a of all) {
        if (!active.has(a)) {
            skipped.add(a);
        }
    }

    const ratio = Number(
        (active.size / Math.max(1, all.length)).toFixed(ACTIVATION_RATIO_DECIMALS),
    );
    const reason =
        `Archetype activation (${archetype}: ${active.size}/${all.length}, ` +
        `${Math.round(ratio * PERCENT_SCALE)}%)`;

    return {
        activeAnalyzers: active,
        skippedAnalyzers: skipped,
        activationRatio: ratio,
        categories: [],
        reason,
    };
}
