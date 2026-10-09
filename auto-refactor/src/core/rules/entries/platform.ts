/**
 * Module: Core Engine — Rule Registry (platform entries)
 * File Path: src/core/rules/entries/platform.ts
 * Architecture Role: Declarative rule metadata for one domain; the index in ./registry.ts
 *   concatenates every domain into the single RULE_REGISTRY source of truth.
 * Dependencies & Triggers: core rule types plus defineRule(); consumed by ./registry.ts
 * Responsibilities: List { id, family, analyzer, canonical flag, legacy reason, languages,
 *   default severity, summary, remediation, docs anchor } for each emitted rule id.
 * Exit Semantics & Design Rationale: Pure data, no behaviour. Entries are grouped by owning
 *   domain (governance rules vs built-in analyzer rules vs platform/legacy ids) so the registry
 *   stays readable and never becomes a monolith.
 */
import type { RuleDefinition } from '../types';
import {
    ALL_LANGUAGES,
    defineRule,
    SEVERITY_INFO,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
    RULE_FAMILY_ARCHITECTURE,
    RULE_FAMILY_DEPENDENCY,
    RULE_FAMILY_LEGACY,
    RULE_FAMILY_LANG,
    RULE_FAMILY_COMPLEXITY,
    RULE_FAMILY_LARGE_FILE,
    RULE_FAMILY_PERFORMANCE,
    RULE_FAMILY_CONSTANTS,
    RULE_FAMILY_SECURITY,
    RULE_FAMILY_ENGINE,
    LEGACY_REASON_ID_NOT_CANONICAL,
} from '../types';
import {
    ANALYZER_ARCHITECTURE,
    ANALYZER_DEPENDENCY_GRAPH,
    ANALYZER_CONSTANTS,
    ANALYZER_COMPLEXITY,
    ANALYZER_SECRETS,
    ANALYZER_LARGE_FILE,
    ANALYZER_PERFORMANCE,
} from '../../scoring/dimensionLiterals';

/** Built-in engine pseudo-analyzer identity for runtime/bootstrap errors. */
const ANALYZER_ENGINE = 'engine';

/** platform rules. */
export const PLATFORM_RULES: readonly RuleDefinition[] = [
    defineRule({
        id: 'analyzer-error',
        family: RULE_FAMILY_ENGINE,
        analyzer: ANALYZER_ENGINE,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Analyzer threw an unhandled exception on a single file (escalates to error if failOnAnalyzerError is set).',
        remediation:
            'Fix the analyzer defect; for known external data issues, keep info severity for tracking.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#analyzer-error',
    }),
    defineRule({
        id: 'ARCH-DIR-001',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Core reverse flow: domain layer inversely depends on outer application, infrastructure, or interface layers.',
        remediation:
            'Invert dependencies: declare interface contracts in the domain layer and implement them in outer layers.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-dir-001',
    }),
    defineRule({
        id: 'ARCH-DIR-002',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Layer bypass: interface layer controllers bypass application services to directly couple with infrastructure implementations.',
        remediation:
            'Introduce application services to orchestrate business workflows between controllers and infrastructure.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-dir-002',
    }),
    defineRule({
        id: 'ARCH-LEAK-001',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Responsibility leak: pure domain models directly reference or leak external frameworks (Express, Vue, Godot, ORM).',
        remediation:
            'Use POJO or native language entities for domain models, isolating external framework types via adapters.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-leak-001',
    }),
    defineRule({
        id: 'ARCH-LEAK-002',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Layer boundary breach: outer implementations are directly referenced by inner layers (Clean/DDD inverted hierarchy).',
        remediation:
            'Restore unidirectional dependencies (inner declares interface, outer implements) or move file to appropriate layer.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-leak-002',
    }),
    defineRule({
        id: 'ARCH-HDL-001',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Headless architecture breach: core business logic or calculation modules directly bind to UI/IDE view frameworks.',
        remediation:
            'Decouple core logic from display frameworks, maintaining headless standalone execution and testability.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-hdl-001',
    }),
    defineRule({
        id: 'ARCH-BND-001',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Cross-domain internal penetration: bypassing public export facade contracts to directly access private internal implementations.',
        remediation:
            'Access domain capabilities exclusively through public export facade APIs; avoid direct imports from /internal/ or /private/.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-bnd-001',
    }),
    defineRule({
        id: 'ARCH-GLB-001',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Implicit global mutable state: modules are tightly coupled via top-level global variables or static singletons.',
        remediation:
            'Refactor to dependency injection or on-demand instances, eliminating shared mutable static singletons.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-glb-001',
    }),
    defineRule({
        id: 'ARCH-DIR-003',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Formal layering illusion: directory structure appears separated, but call graphs and data flows violate layer boundaries.',
        remediation:
            'Align call dependency flows so inner domain defines contracts and outer infrastructure implements them.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-dir-003',
    }),
    defineRule({
        id: 'ARCH-CFG-001',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Environment configuration leak: pure domain models directly read environment variables or disk configuration files.',
        remediation:
            'Parse environment configurations at the application assembly layer and inject strongly-typed values into domain models.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-cfg-001',
    }),
    defineRule({
        id: 'ARCH-DISP-001',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Monolithic dispatchers with excessive branches (> 8) tightly couple domain logic, violating the Open-Closed Principle.',
        remediation:
            'Refactor to dictionary/Map table-driven dispatch or Strategy pattern, decoupling branch business logic.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-disp-001',
    }),
    defineRule({
        id: 'ARCH-DSP-002',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Dispatcher closure fragmentation: Object literal defines excessive inline function closures (>= 15), causing closure explosion and function inflation.',
        remediation:
            'Refactor into cohesive switch dispatchers (CC <= 10) or top-level named handler functions to eliminate closure fragmentation.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-dsp-002',
    }),
    defineRule({
        id: 'ARCH-TMP-001',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Monolithic template renderer coupling: oversized function concatenates deep HTML/SVG/DSL templates without subcomponent decomposition.',
        remediation:
            'Decompose into domain-orthogonal partial components (Header/Card/Graph Partials) driven by structured ViewModels.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-tmp-001',
    }),
    defineRule({
        id: 'clean-layer-violation',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary: 'Layering boundary breach in incremental pipeline (clean-layer semantics).',
        remediation:
            'Adjust dependency direction according to layer hierarchy or hoist/sink implementations to proper layers.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#clean-layer-violation',
    }),
    defineRule({
        id: 'disallowed-import',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_GRAPH,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Declarative import boundary violation: cross-group dependency or unauthorized external package import.',
        remediation:
            'Adjust imports according to allowGroups/allowExternal configurations or explicitly register an exemption.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#disallowed-import',
    }),
    defineRule({
        id: 'duplicate-literal',
        family: RULE_FAMILY_CONSTANTS,
        analyzer: ANALYZER_CONSTANTS,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Identical literal frequency exceeds threshold in the same file (default >= 3 occurrences).',
        remediation: 'Aggregate repeated literals and extract them into shared constants.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#duplicate-literal',
    }),
    defineRule({
        id: 'nested-constant',
        family: RULE_FAMILY_CONSTANTS,
        analyzer: ANALYZER_CONSTANTS,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Redundant constant nesting: indirect constant aliases, deep constant objects, or pseudo-constants in nested scopes.',
        remediation:
            'Inline redundant aliases or hoist constants to module-level single sources of truth, eliminating deep object nesting.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#nested-constant',
    }),
    defineRule({
        id: 'high-complexity',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Function cyclomatic complexity exceeds threshold.',
        remediation:
            'Extract named helper functions, use early returns instead of deep nesting, or split functions by responsibility.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#high-complexity',
    }),
    defineRule({
        id: 'high-entropy-token',
        family: RULE_FAMILY_SECURITY,
        analyzer: ANALYZER_SECRETS,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'High-entropy string detected, suspected of being a secret credential or API token.',
        remediation:
            'Move credentials to configuration or secret managers; if a false positive, suppress with matchRule and documented rationale.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#high-entropy-token',
    }),
    defineRule({
        id: 'import-cycle',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_GRAPH,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Module-level cyclic dependency detected (covering Python relative imports and package resolution).',
        remediation:
            'Extract shared contracts into independent submodules or use lazy imports to break dependency cycles.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#import-cycle',
    }),
    defineRule({
        id: 'large-file',
        family: RULE_FAMILY_LARGE_FILE,
        analyzer: ANALYZER_LARGE_FILE,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'File physical line count or function count exceeds architecture threshold.',
        remediation:
            'Decompose module by cohesive responsibilities, or move utility functions to dedicated files.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#large-file',
    }),
    defineRule({
        id: 'secret-detected',
        family: RULE_FAMILY_SECURITY,
        analyzer: ANALYZER_SECRETS,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary: 'Suspected hardcoded credential detected based on pattern matching.',
        remediation:
            'Revoke and rotate the exposed credential; load sensitive tokens from environment variables or vaults.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#secret-detected',
    }),
    defineRule({
        id: 'unused-export',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_GRAPH,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Exported symbol has zero external references across the workspace (TS/JS scope).',
        remediation: 'Remove unused exports or restrict symbol visibility to module-private scope.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#unused-export',
    }),
    defineRule({
        id: 'unused-module',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_GRAPH,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Module is never imported by any other file (outside entry whitelist).',
        remediation: 'Delete the dead module or add its entry pattern to entryGlobs.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#unused-module',
    }),
    defineRule({
        id: 'expensive-loop-operation',
        family: RULE_FAMILY_PERFORMANCE,
        analyzer: ANALYZER_PERFORMANCE,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Expensive deep copy (.duplicate(true)) or blocking serialization/IO executed inside a loop.',
        remediation:
            'Eliminate deep copies on hot paths; use read-only views or lightweight references instead.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#expensive-loop-operation',
    }),
    defineRule({
        id: 'high-algorithmic-complexity',
        family: RULE_FAMILY_PERFORMANCE,
        analyzer: ANALYZER_PERFORMANCE,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Multiple nested loops create potential O(N^2)/O(N^3) complexity hotspots or implicit linear searches.',
        remediation:
            'Refactor nested loops or pre-build Map/Set indexes to reduce lookups to O(1).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#high-algorithmic-complexity',
    }),
    defineRule({
        id: 'loop-transient-allocation',
        family: RULE_FAMILY_PERFORMANCE,
        analyzer: ANALYZER_PERFORMANCE,
        canonical: false,
        legacyReason: LEGACY_REASON_ID_NOT_CANONICAL,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Transient heap allocation inside a loop (ADV-PRF-002), violating the zero-transient-allocation contract.',
        remediation:
            'Hoist object instantiation outside the loop or utilize object pool patterns (ADV-POOL-001).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#loop-transient-allocation',
    }),
];
