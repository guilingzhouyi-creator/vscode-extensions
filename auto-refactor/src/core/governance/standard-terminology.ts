/**
 * Module: Core Governance — Single Source of Truth Positive Standard Terminology Catalog
 * File Path: src/core/governance/standard-terminology.ts
 * Architecture Role: Central taxonomy, standardized remediation action verbs, and diagnostic
 *   verdict specifications for the dual-faced review architecture (Agent-Facing & Human-Facing).
 * Dependencies & Triggers: Consumed by types.ts, terminology-engine.ts, reporters, and analyzers.
 * Responsibilities:
 *   1. Declare the canonical 6-domain defect taxonomies (Taxonomy).
 *   2. Declare the machine-actionable remediation verbs (Remediation Actions).
 *   3. Declare standardized diagnostic verdicts (BLOCK, WARN, INFO, PASS).
 *   4. Provide deterministic catalog lookups and format helpers for dual-faced presentation.
 * Exit Semantics & Design Rationale: Fully immutable, frozen catalogs; zero side-effects. Every
 *   field is English because this module is machine-facing: a translation here would be prose the
 *   i18n cleanliness guard cannot see, and an agent reading the catalog would receive a mix of
 *   languages depending on which entry it happened to look up. The localized rendering of each
 *   taxonomy and verb lives in the presentation dictionaries, keyed by the same codes.
 */

/** Six canonical defect taxonomies governing workspace quality dimensions */
export type DefectTaxonomyCategory =
    'ARCH_LAYER' | 'CTRL_FLOW' | 'NUM_PREC' | 'TEST_MODERN' | 'GOV_NORM' | 'SEC_GUARD';

/** Metadata describing a defect taxonomy domain */
export interface DefectTaxonomySpec {
    readonly code: DefectTaxonomyCategory;
    readonly title: string;
    readonly description: string;
}

/** Single source of truth specifications for defect taxonomies */
export const DEFECT_TAXONOMY_SPECS: Readonly<Record<DefectTaxonomyCategory, DefectTaxonomySpec>> =
    Object.freeze({
        ARCH_LAYER: Object.freeze({
            code: 'ARCH_LAYER',
            title: 'Architectural Layer Boundary',
            description:
                'Boundary compliance, clean separation of concerns, and dependency graph integrity.',
        }),
        CTRL_FLOW: Object.freeze({
            code: 'CTRL_FLOW',
            title: 'Control Flow & Complexity',
            description:
                'Cyclomatic complexity, nesting depth limits, and guard-clause flattening.',
        }),
        NUM_PREC: Object.freeze({
            code: 'NUM_PREC',
            title: 'Numerical & Floating-Point Precision',
            description:
                'Precision rounding standards (0.01), IEEE 754 negative zero prevention, and compact ledger boundaries.',
        }),
        TEST_MODERN: Object.freeze({
            code: 'TEST_MODERN',
            title: 'Test Modernity & Invariant Verification',
            description:
                'Elimination of tautological assertions, fragile floating-point equality, and mock-only integrity illusions.',
        }),
        GOV_NORM: Object.freeze({
            code: 'GOV_NORM',
            title: 'Engineering Norms & Terminology Sanitization',
            description:
                'Physical naming conventions, zero empty files, and objective technical prose sanitization.',
        }),
        SEC_GUARD: Object.freeze({
            code: 'SEC_GUARD',
            title: 'Security & Secret Guard',
            description:
                'High-entropy secret detection, token leaks, and defensive security boundaries.',
        }),
    });

/** Standardized remediation action verb enumeration */
export type StandardActionVerb =
    | 'extract_pure_predicate'
    | 'apply_guard_clause'
    | 'align_numeric_precision'
    | 'replace_with_tolerance_assertion'
    | 'sanitize_prose_terminology'
    | 'decouple_facade'
    | 'extract_constant'
    | 'hoist_declaration'
    | 'narrow_scope'
    | 'split_function'
    | 'simplify_control_flow'
    | 'replace_token'
    | 'insert_comment_contract'
    | 'guard_recursion'
    | 'use_constant_time_comparison'
    | 'scaffold_constant_library'
    | 'scaffold_gate_system'
    | 'request_clarification'
    | 'rename_symbol'
    | 'introduce_parameter_object'
    | 'decompose_module'
    | 'inline_orphan_function'
    | 'melt_trampoline'
    | 'compact_diluted_lines'
    | 'decompose_congested_tokens'
    | 'enrich_facade'
    | 'eliminate_tautological_loop';

/** Specification contract for a standardized remediation action verb */
export interface ActionVerbSpec {
    readonly verb: StandardActionVerb;
    readonly taxonomy: DefectTaxonomyCategory;
    readonly description: string;
    readonly safeToAutomateDefault: boolean;
    readonly typicalFixTemplate: string;
}

/** Canonical register of 21 machine-actionable remediation verbs */
export const ACTION_VERB_SPECS: Readonly<Record<StandardActionVerb, ActionVerbSpec>> =
    Object.freeze({
        extract_pure_predicate: Object.freeze({
            verb: 'extract_pure_predicate',
            taxonomy: 'CTRL_FLOW',
            description:
                'Extract multi-branch or regex conditions into an independent, stateless pure function to reduce CC.',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'function isPredicateName(arg: Type): boolean { return ...; }',
        }),
        apply_guard_clause: Object.freeze({
            verb: 'apply_guard_clause',
            taxonomy: 'CTRL_FLOW',
            description:
                'Invert branching condition to return early, flattening nested indentation.',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'if (!condition) return defaultValue;',
        }),
        align_numeric_precision: Object.freeze({
            verb: 'align_numeric_precision',
            taxonomy: 'NUM_PREC',
            description:
                'Normalize calculation rounding to 0.01 precision and normalize IEEE 754 negative zero.',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'Math.round(val * 100) / 100 + 0',
        }),
        replace_with_tolerance_assertion: Object.freeze({
            verb: 'replace_with_tolerance_assertion',
            taxonomy: 'TEST_MODERN',
            description:
                'Replace brittle floating-point direct equality with tolerance matchers (e.g. toBeCloseTo or isScoreEqual).',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'expect(actual).toBeCloseTo(expected, 2)',
        }),
        sanitize_prose_terminology: Object.freeze({
            verb: 'sanitize_prose_terminology',
            taxonomy: 'GOV_NORM',
            description:
                'Replace informal, hyperbolic, or speculative terminology with objective factual statements.',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'State verifiable technical scope and bounds.',
        }),
        decouple_facade: Object.freeze({
            verb: 'decouple_facade',
            taxonomy: 'ARCH_LAYER',
            description:
                'Eliminate single-line vacuous trampoline files or satisfy facade ELOC/contract budget.',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'Inline export target and delete trampoline module.',
        }),
        extract_constant: Object.freeze({
            verb: 'extract_constant',
            taxonomy: 'GOV_NORM',
            description:
                'Extract naked literal number or string into a single-source-of-truth constant.',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'const CONSTANT_NAME = value;',
        }),
        hoist_declaration: Object.freeze({
            verb: 'hoist_declaration',
            taxonomy: 'CTRL_FLOW',
            description:
                'Hoist invariants, regex compilations, or object allocations outside of hot loops.',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'const invariant = init(); while (...) { use(invariant); }',
        }),
        narrow_scope: Object.freeze({
            verb: 'narrow_scope',
            taxonomy: 'ARCH_LAYER',
            description:
                'Restrict excessive symbol or module visibility to private/internal boundaries.',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'Remove export modifier or relocate to internal file.',
        }),
        split_function: Object.freeze({
            verb: 'split_function',
            taxonomy: 'CTRL_FLOW',
            description:
                'Decompose a monolithic function into focused, single-responsibility sub-procedures.',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'Extract sub-steps into helper procedures.',
        }),
        simplify_control_flow: Object.freeze({
            verb: 'simplify_control_flow',
            taxonomy: 'CTRL_FLOW',
            description: 'Simplify convoluted boolean expressions or nested ternary operators.',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'Simplify boolean flags via lookup tables or early exits.',
        }),
        replace_token: Object.freeze({
            verb: 'replace_token',
            taxonomy: 'GOV_NORM',
            description: 'Replace obsolete or deprecated language keywords and syntax tokens.',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'Replace var with const/let.',
        }),
        insert_comment_contract: Object.freeze({
            verb: 'insert_comment_contract',
            taxonomy: 'GOV_NORM',
            description:
                'Provide structured JSDoc contract declarations (@param, @returns, @throws).',
            safeToAutomateDefault: true,
            typicalFixTemplate: '/** @param x - Description\n * @returns Result */',
        }),
        guard_recursion: Object.freeze({
            verb: 'guard_recursion',
            taxonomy: 'CTRL_FLOW',
            description:
                'Add depth or visited-set guard to recursive traversals to prevent stack overflow.',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'if (depth > MAX_DEPTH || visited.has(node)) return;',
        }),
        use_constant_time_comparison: Object.freeze({
            verb: 'use_constant_time_comparison',
            taxonomy: 'SEC_GUARD',
            description:
                'Use timing-safe equality comparison for cryptographic tokens and signatures.',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'crypto.timingSafeEqual(bufA, bufB)',
        }),
        scaffold_constant_library: Object.freeze({
            verb: 'scaffold_constant_library',
            taxonomy: 'GOV_NORM',
            description: 'Organize scattered domain literals into a cohesive constant registry.',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'Export clustered constants under a domain namespace.',
        }),
        scaffold_gate_system: Object.freeze({
            verb: 'scaffold_gate_system',
            taxonomy: 'GOV_NORM',
            description: 'Establish standard pre-commit or pre-push verification gates.',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'Wire script into hooks and manifest.',
        }),
        request_clarification: Object.freeze({
            verb: 'request_clarification',
            taxonomy: 'GOV_NORM',
            description:
                'Request clarification when specifications, naming intent, or structural requirements are ambiguous.',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'Request clarification from team or domain specification.',
        }),
        rename_symbol: Object.freeze({
            verb: 'rename_symbol',
            taxonomy: 'GOV_NORM',
            description:
                'Rename symbol to adhere to canonical naming conventions and communicate clear semantic intent.',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'Rename identifier across declarations and references.',
        }),
        introduce_parameter_object: Object.freeze({
            verb: 'introduce_parameter_object',
            taxonomy: 'CTRL_FLOW',
            description:
                'Group multiple related function parameters into a cohesive parameter object or options interface.',
            safeToAutomateDefault: false,
            typicalFixTemplate:
                'interface Options { ... }\nfunction target(options: Options): void;',
        }),
        decompose_module: Object.freeze({
            verb: 'decompose_module',
            taxonomy: 'ARCH_LAYER',
            description:
                'Decompose an oversized or multi-responsibility module into cohesive single-responsibility submodules.',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'Extract cohesive procedures and types into dedicated submodules.',
        }),
        inline_orphan_function: Object.freeze({
            verb: 'inline_orphan_function',
            taxonomy: 'CTRL_FLOW',
            description:
                'Inline a single-use orphan function into its sole call site to eliminate parameter mud and enhance locality.',
            safeToAutomateDefault: true,
            typicalFixTemplate: '// Inline orphan function body into call site',
        }),
        melt_trampoline: Object.freeze({
            verb: 'melt_trampoline',
            taxonomy: 'ARCH_LAYER',
            description:
                'Melt a single-target forwarding wrapper or trampoline so callers directly access the underlying target.',
            safeToAutomateDefault: true,
            typicalFixTemplate:
                '// Redirect call directly to destination symbol and eliminate trampoline',
        }),
        compact_diluted_lines: Object.freeze({
            verb: 'compact_diluted_lines',
            taxonomy: 'GOV_NORM',
            description:
                'Merge vertically fragmented line breaks or over-split chain calls into concise statements.',
            safeToAutomateDefault: true,
            typicalFixTemplate: '// Consolidate fragmented expressions onto cohesive lines',
        }),
        decompose_congested_tokens: Object.freeze({
            verb: 'decompose_congested_tokens',
            taxonomy: 'CTRL_FLOW',
            description:
                'Break down horizontally congested expressions (tau > 20 tokens/line) with intermediate local constants.',
            safeToAutomateDefault: true,
            typicalFixTemplate: 'const intermediate = ...;\nreturn use(intermediate);',
        }),
        enrich_facade: Object.freeze({
            verb: 'enrich_facade',
            taxonomy: 'ARCH_LAYER',
            description:
                'Enrich an empty facade with parameter contract verification, domain aggregation, or immutability freezing.',
            safeToAutomateDefault: false,
            typicalFixTemplate: 'export const Facade = Object.freeze({ ... });',
        }),
        eliminate_tautological_loop: Object.freeze({
            verb: 'eliminate_tautological_loop',
            taxonomy: 'CTRL_FLOW',
            description:
                'Eliminate zero-entropy state transitions or trivial loops with direct access or pure filters.',
            safeToAutomateDefault: true,
            typicalFixTemplate: '// Replace loop with direct lookup or pure filter',
        }),
    });

/** Canonical diagnostic verdict enumeration */
export type StandardDiagnosticVerdict = 'BLOCK' | 'WARN' | 'INFO' | 'PASS';

interface TaxonomyPrefixMapping {
    readonly prefixes: readonly string[];
    readonly category: DefectTaxonomyCategory;
}

/**
 * Prefix-to-taxonomy mappings, most specific first.
 *
 * Prefixes are matched against the whole rule id, so a family entry such as `SIM-` would claim
 * every rule in that family. That is why control-flow coverage names the two topics that are
 * genuinely about branching and nesting (`SIM-CMP`, `SIM-FLAT`) rather than the whole `SIM`
 * family, which also holds dead-code, inheritance and wrapper rules that no control-flow taxonomy
 * describes. A rule whose family has no dedicated taxonomy falls through to GOV_NORM, and the
 * caller can distinguish that from an explicit norm rule by the family prefix.
 *
 * `ADV-BND` and `ADV-DEC` are architecture boundaries; the remaining `ADV-*` topics (typing,
 * naming, configuration, runtime contract) are engineering norms. Naming the boundary topics
 * explicitly keeps them out of GOV_NORM without giving the whole `ADV-` family the wrong label.
 */
const TAXONOMY_PREFIX_MAPPINGS: readonly TaxonomyPrefixMapping[] = Object.freeze([
    { prefixes: ['ADV-CMP', 'ADV-NST', 'SIM-CMP', 'SIM-FLAT'], category: 'CTRL_FLOW' },
    { prefixes: ['NUM-', 'PREC-'], category: 'NUM_PREC' },
    { prefixes: ['TST-', 'TEST-'], category: 'TEST_MODERN' },
    { prefixes: ['SEC-', 'SECRET-', 'ADV-RNG'], category: 'SEC_GUARD' },
    {
        prefixes: ['ARCH-', 'LAYER-', 'LAY-', 'DEP-', 'FAC-', 'ADV-BND', 'ADV-DEC'],
        category: 'ARCH_LAYER',
    },
]);

function matchesTaxonomyPrefix(upper: string, prefixes: readonly string[]): boolean {
    for (const prefix of prefixes) {
        if (upper.startsWith(prefix)) return true;
    }
    return false;
}

/**
 * Resolves the defect taxonomy category for a canonical rule ID.
 *
 * @param ruleId - Canonical rule ID (e.g. ADV-CMP-001, NUM-PREC-001)
 * @returns Categorized defect taxonomy
 */
export function resolveRuleTaxonomy(ruleId: string): DefectTaxonomyCategory {
    if (!ruleId) {
        return 'GOV_NORM';
    }
    const upper = ruleId.toUpperCase();
    for (const mapping of TAXONOMY_PREFIX_MAPPINGS) {
        if (matchesTaxonomyPrefix(upper, mapping.prefixes)) {
            return mapping.category;
        }
    }
    return 'GOV_NORM';
}

/**
 * Validates whether an action verb is registered in the standard SSOT catalog.
 *
 * @param verb - Action verb candidate string
 * @returns True if registered
 */
export function isStandardActionVerb(verb: string): verb is StandardActionVerb {
    return Object.prototype.hasOwnProperty.call(ACTION_VERB_SPECS, verb);
}
