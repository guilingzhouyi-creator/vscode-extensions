/**
 * Module: Core Rules — Complexity, Data Architecture & Performance Rule Entries
 * File Path: src/core/rules/entries/analyzers-modern-architecture.ts
 * Architecture Role: Modular rule catalog for cyclomatic complexity, data architecture,
 *   test modernity, dependency structure, architecture discipline, and performance.
 * Dependencies & Triggers: ../types, dimensionLiterals; consumed by analyzersModern facade.
 * Responsibilities: Export rule definitions for architectural rules within LOC budget (< 900 LOC).
 * Exit Semantics & Design Rationale: Immutable rule catalog array; zero runtime side-effects.
 */

import {
    ALL_LANGUAGES,
    defineRule,
    SEVERITY_INFO,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
    RULE_FAMILY_COMPLEXITY,
    RULE_FAMILY_DATA_ARCHITECTURE,
    RULE_FAMILY_TEST_MODERNITY,
    RULE_FAMILY_DEPENDENCY,
    RULE_FAMILY_ARCHITECTURE,
    RULE_FAMILY_PERFORMANCE,
} from '../types';
import type { RuleDefinition } from '../types';

import {
    ANALYZER_COMPLEXITY,
    ANALYZER_DATA_ARCHITECTURE,
    ANALYZER_TEST_MODERNITY,
    ANALYZER_DEPENDENCY_LAYOUT,
    ANALYZER_ARCHITECTURE,
    ANALYZER_PERFORMANCE,
} from '../../scoring/dimensionLiterals';

function defineLanguageAgnosticRule(
    id: string,
    family: typeof RULE_FAMILY_ARCHITECTURE | typeof RULE_FAMILY_PERFORMANCE,
    analyzer: typeof ANALYZER_ARCHITECTURE | typeof ANALYZER_PERFORMANCE,
    defaultSeverity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
    summary: string,
    remediation: string,
    docsAnchor: string,
): RuleDefinition {
    return defineRule({
        id,
        family,
        analyzer,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity,
        summary,
        remediation,
        docsAnchor,
    });
}

function defineArchitectureRule(
    id: string,
    summary: string,
    remediation: string,
    docsAnchor: string,
): RuleDefinition {
    return defineLanguageAgnosticRule(
        id,
        RULE_FAMILY_ARCHITECTURE,
        ANALYZER_ARCHITECTURE,
        SEVERITY_WARNING,
        summary,
        remediation,
        docsAnchor,
    );
}

function definePerformanceRule(
    id: string,
    defaultSeverity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
    summary: string,
    remediation: string,
    docsAnchor: string,
): RuleDefinition {
    return defineLanguageAgnosticRule(
        id,
        RULE_FAMILY_PERFORMANCE,
        ANALYZER_PERFORMANCE,
        defaultSeverity,
        summary,
        remediation,
        docsAnchor,
    );
}

/**
 * Modern architecture rule definitions covering complexity, data, and performance.
 */
export const ANALYZER_MODERN_ARCHITECTURE_RULES: readonly RuleDefinition[] = [
    defineRule({
        id: 'CPX-TIME-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Unbounded polynomial time complexity across function/file boundaries: nested' +
                'iteration call chains incur prohibitive overhead.',
        remediation:
            'Pre-build inner dataset into Map/Set indices to reduce composite complexity to O(N).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-time-001',
    }),
    defineRule({
        id: 'CPX-SPACE-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Unbounded transient memory allocation and repeated full materialization inside hot loops.',
        remediation:
            'Hoist object/buffer allocations outside the loop and execute in-place reset and reuse inside the loop.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-space-001',
    }),
    defineRule({
        id: 'CPX-REC-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Recursive or mutually recursive call chain without guaranteed termination guards across functions/files.',
        remediation:
            'Introduce explicit depth accumulator parameters with termination bounds, or refactor' +
                'into an iterative worklist.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-rec-001',
    }),
    defineRule({
        id: 'CPX-AMP-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Complexity amplification trap: blocking I/O or serialization implicitly nested in' +
                'iteration or hot call chains.',
        remediation: 'Batch I/O and serialization calls outside the loop.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-amp-001',
    }),
    defineRule({
        id: 'DAT-QRY-001',
        family: RULE_FAMILY_DATA_ARCHITECTURE,
        analyzer: ANALYZER_DATA_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Unbounded data retrieval or full-table in-memory filtering in online request paths.',
        remediation:
            'Add cursor pagination or Limit/Offset clauses to strictly bound retrieval volumes per query.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dat-qry-001',
    }),
    defineRule({
        id: 'DAT-NPL-001',
        family: RULE_FAMILY_DATA_ARCHITECTURE,
        analyzer: ANALYZER_DATA_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'N+1 query pattern and repeated storage calls within iteration or mapping contexts.',
        remediation:
            'Hoist queries outside the loop using batch IN queries or DataLoader batching patterns.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dat-npl-001',
    }),
    defineRule({
        id: 'DAT-SER-001',
        family: RULE_FAMILY_DATA_ARCHITECTURE,
        analyzer: ANALYZER_DATA_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary: 'Repeated serialization and deserialization cycles across internal call chains.',
        remediation:
            'Pass strongly typed native objects through internal call chains, serializing' +
                'exclusively at network boundaries.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dat-ser-001',
    }),
    defineRule({
        id: 'DAT-DEF-001',
        family: RULE_FAMILY_DATA_ARCHITECTURE,
        analyzer: ANALYZER_DATA_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary: 'Redundant defensive validations within trusted internal domain boundaries.',
        remediation:
            'Perform comprehensive validation once at trust boundaries; rely on immutable types' +
                'within internal domains.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dat-def-001',
    }),
    defineRule({
        id: 'DAT-LAY-001',
        family: RULE_FAMILY_DATA_ARCHITECTURE,
        analyzer: ANALYZER_DATA_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Data access abstraction leak: business core directly manipulates persistence drivers or storage details.',
        remediation:
            'Encapsulate storage driver interactions within repository implementations; domain' +
                'layer must only depend on repository contracts.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dat-lay-001',
    }),
    defineRule({
        id: 'TST-ILS-001',
        family: RULE_FAMILY_TEST_MODERNITY,
        analyzer: ANALYZER_TEST_MODERNITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Test completeness illusion: tests solely verify mock configurations or bind to' +
                'deprecated business contracts.',
        remediation:
            'Migrate tests to verify active business contracts and actual domain state transitions.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tst-ils-001',
    }),
    defineRule({
        id: 'TST-SKP-001',
        family: RULE_FAMILY_TEST_MODERNITY,
        analyzer: ANALYZER_TEST_MODERNITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Skipped, quarantined, or disabled test cases lingering indefinitely in core business domains.',
        remediation:
            'Fix and reactivate test cases, or formally register them into the test debt backlog' +
                'with milestone targets.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tst-skp-001',
    }),
    defineRule({
        id: 'TST-TAU-001',
        family: RULE_FAMILY_TEST_MODERNITY,
        analyzer: ANALYZER_TEST_MODERNITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Ineffective test lacking substantive business assertions or containing tautological assertions.',
        remediation:
            'Replace tautological assertions with substantive verification of business entity' +
                'outputs and error boundaries.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tst-tau-001',
    }),
    defineRule({
        id: 'TST-DEN-001',
        family: RULE_FAMILY_TEST_MODERNITY,
        analyzer: ANALYZER_TEST_MODERNITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Effective Modern Test Density (EMTD) or Current Business Coverage Ratio (CBCR) below' +
                'threshold in critical business modules.',
        remediation:
            'Add contract tests and boundary tests for high-risk semantic units to enhance fault detection capability.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tst-den-001',
    }),
    defineRule({
        id: 'TST-DBT-001',
        family: RULE_FAMILY_TEST_MODERNITY,
        analyzer: ANALYZER_TEST_MODERNITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Lagging test technical debt without registered milestone convergence plan or assigned owner.',
        remediation:
            'Assign responsible agent and target convergence milestone in the test debt registry.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tst-dbt-001',
    }),
    defineRule({
        id: 'TST-TOP-001',
        family: RULE_FAMILY_TEST_MODERNITY,
        analyzer: ANALYZER_TEST_MODERNITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Polyglot test topology dual-track discipline: embedding test code blocks in' +
                'TS/GDScript production files is strictly prohibited.',
        remediation:
            'Migrate embedded test logic in non-Rust production files to standalone test files' +
                '(*.test.ts); place Rust tests in #[cfg(test)] sections with Agent-readable' +
                'comments.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tst-top-001',
    }),
    defineRule({
        id: 'TST-FLT-001',
        family: RULE_FAMILY_TEST_MODERNITY,
        analyzer: ANALYZER_TEST_MODERNITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Fragile floating-point assertion: test directly asserts equality on raw float' +
                'literals without tolerance or formula derivation.',
        remediation:
            'Derive expected values via mathematical formula or use tolerance assertions (such as' +
                'toBeCloseTo or is_equal_approx).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#tst-flt-001',
    }),
    defineRule({
        id: 'DEP-ORD-001',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_LAYOUT,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'File layout and import grouping do not conform to modern polyglot engineering standards.',
        remediation: 'Reorder imports to: Stdlib -> ThirdParty -> InternalShared -> Local.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dep-ord-001',
    }),
    defineRule({
        id: 'DEP-LAZ-001',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_LAYOUT,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Function-scoped lazy import without audit declaration or documented rationale.',
        remediation:
            'Hoist imports to file header, or annotate with @lazy/@optional documenting architectural intent.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dep-laz-001',
    }),
    defineRule({
        id: 'DEP-RES-001',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_LAYOUT,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Scattered hardcoded unmanaged external URLs, file paths, or connection strings in business logic.',
        remediation:
            'Extract external resource addresses into configuration files or a service discovery registry.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dep-res-001',
    }),
    defineRule({
        id: 'DEP-WLD-001',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_LAYOUT,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Wildcard import impairs explicit dependency tracking and tree-shaking optimization.',
        remediation: 'Use explicit named imports to clearly declare module dependency surface.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dep-wld-001',
    }),
    defineRule({
        id: 'DEP-INV-001',
        family: RULE_FAMILY_DEPENDENCY,
        analyzer: ANALYZER_DEPENDENCY_LAYOUT,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary:
            'Dependency inversion violation: lower-level infrastructure or common modules' +
                'inversely depend on high-level business modules.',
        remediation:
            'Eliminate inverted dependency via Inversion of Control (IoC) or event bus decoupling.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dep-inv-001',
    }),
    defineRule({
        id: 'ARCH-CFG-002',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Declared configuration property is never referenced in decisions, control flow, or' +
                'calculations across the codebase (dead configuration).',
        remediation:
            'Remove unused dead configuration entries or wire them to corresponding business switches/policies.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-cfg-002',
    }),
    defineRule({
        id: 'ARCH-CFG-003',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Duplicate configuration entries declared across multiple locations, violating single source of truth.',
        remediation:
            'Consolidate duplicate configuration entries into a single configuration table or inheritance hierarchy.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-cfg-003',
    }),
    defineRule({
        id: 'ARCH-CFG-004',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Implicit configuration scatter: business code directly reads environment variables or tuning constants.',
        remediation:
            'Extract scattered environment variables and tuning parameters into a unified' +
                'configuration object injected via parameters.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-cfg-004',
    }),
    defineRule({
        id: 'ARCH-CFG-005',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Unstructured configuration access: accessing configuration in an unstructured,' +
                'arbitrary manner across layers without a centralized registry.',
        remediation:
            'Establish a unified configuration access layer or registry to centralize configuration reads.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-cfg-005',
    }),
    defineRule({
        id: 'ARCH-CFG-006',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Configuration tightly coupled with domain logic: domain models directly bind to' +
                'specific config file formats or disk parsers.',
        remediation:
            'Decouple using interfaces or typed policy objects assembled by outer layers and' +
                'injected into domain core.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-cfg-006',
    }),
    defineRule({
        id: 'ARCH-CFG-007',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Configuration over-abstraction: simple static configuration introduces excessive' +
                'unnecessary indirection and forwarding layers.',
        remediation:
            'Prune redundant wrapper layers to match project scale and provide direct,' +
                'lightweight configuration access.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-cfg-007',
    }),
    defineRule({
        id: 'ARCH-DEC-002',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Polyglot AST parsing and adapter logic must be decoupled into independent adapter' +
                'modules; analyzer core must not mix AST construction details.',
        remediation:
            'Extract multi-language AST construction into src/core/semantic/adapters/ independent' +
                'adapters; analyzers must only interact with NormalizedNode interfaces.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-dec-002',
    }),
    defineRule({
        id: 'CPX-BUD-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Elastic complexity budget exceeded based on comprehensive language, role, scope, and clarity metrics.',
        remediation:
            'Split functions by responsibility or flatten nested branching into strategy tables or state machines.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-bud-001',
    }),
    defineRule({
        id: 'CPX-JST-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Uncontrolled complexity without architectural justification: high complexity' +
                'originates from chaotic nesting and responsibility piling.',
        remediation:
            'Streamline core responsibilities, isolate mixed control flows, and separate side effects.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-jst-001',
    }),
    defineRule({
        id: 'ARCH-BLR-001',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'File boundary imbalance: multiple high-complexity functions in a single file lack' +
                'semantic cohesion, abnormally aggregating responsibilities.',
        remediation:
            'Split file into highly cohesive independent domain modules based on semantic and state boundaries.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-blr-001',
    }),
    defineRule({
        id: 'ARCH-SKL-001',
        family: RULE_FAMILY_ARCHITECTURE,
        analyzer: ANALYZER_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Strategy skeleton candidate: detected complex workflows sharing isomorphic' +
                'pre-validation and post-execution teardown steps.',
        remediation:
            'Extract common execution skeleton (template method or higher-order function' +
                'orchestration), injecting divergent steps as strategies.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-skl-001',
    }),
    defineRule({
        id: 'CPX-HOP-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Artificial splitting gaming: artificially deflating complexity by generating' +
                'excessive single-line pass-through forwarding functions.',
        remediation:
            'Eliminate trivial pass-through wrappers; focus on semantic reusability and domain cohesion.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-hop-001',
    }),
    defineRule({
        id: 'CPX-NEST-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Uncontrolled deep control flow nesting: control flow nesting level exceeds elastic' +
                'budget for context type (business > 3, state machine > 5).',
        remediation:
            'Flatten control flow using guard clauses with early returns, or isolate complex' +
                'branching into substate handlers.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-nest-001',
    }),
    defineRule({
        id: 'CPX-NEST-002',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Deep long-span control flow escape: unstructured control flow escape' +
                '(return/break/throw) executed in deep nesting (>= 4) far from function header.',
        remediation:
            'Use localized guard clauses for early validation, or extract deep long-span blocks' +
                'into pure helper operators to shorten cognitive span.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-nest-002',
    }),
    defineRule({
        id: 'CPX-STM-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'State machine dispatch structure standard: single branch within state machine' +
                'branches exceeds 30 LOC, degrading dispatch skeleton clarity.',
        remediation:
            'Extract long single-branch logic into dedicated action handlers, preserving a pure' +
                'state transition dispatch skeleton.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-stm-001',
    }),
    defineRule({
        id: 'CPX-RED-001',
        family: RULE_FAMILY_COMPLEXITY,
        analyzer: ANALYZER_COMPLEXITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Distributed redundant complexity: highly similar algorithms, calculations, or' +
                'validations scattered across multiple files creating latent complexity.',
        remediation:
            'Evaluate shared logic and extract into domain utilities, eliminating copy-paste duplication.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cpx-red-001',
    }),
    defineArchitectureRule(
        'ARCH-ROL-001',
        'File entity role imbalance and pseudo-shared library: file carries excessive mutable' +
            'state or coupled logic but is heavily imported as a shared library.',
        'Strip domain mutable state, define stable input/output boundaries, and construct' +
            'genuinely low-coupling shared libraries.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-rol-001',
    ),
    defineArchitectureRule(
        'ARCH-ROL-002',
        'Business module harboring unbounded common capabilities: domain module internally hosts' +
            'and exports general infrastructure or utilities.',
        'Sink common utilities into appropriate shared or infrastructure layers, keeping domain' +
            'modules focused and single-purpose.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-rol-002',
    ),
    defineArchitectureRule(
        'ARCH-UTL-001',
        'Kitchen-sink utility antipattern: detected utils/common dumping ground file accumulating' +
            'heterogeneous unstructured logic.',
        'Refactor following 4-tier diversion: pure operators to algorithms, constants to constant' +
            'library, rules to policies, converters to infra.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-utl-001',
    ),
    defineArchitectureRule(
        'ARCH-ABS-001',
        'Over-abstraction and redundant indirection: introducing cross-layer forwarding' +
            'trampolines, inverted dependencies, or cycles for trivial commonalities.',
        'Eliminate negative-return trampolines and artificial abstractions; allow legitimate' +
            'localized implementations within isolated domains.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-abs-001',
    ),
    defineArchitectureRule(
        'ARCH-FAC-001',
        'Hollow facade payload and insufficient density: facade module lacks substantive domain' +
            'orchestration, schema validation, or immutability contracts.',
        'Implement substantive orchestration, immutability freezing, and schema validation or' +
            'eliminate the vacuous facade wrapper.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-fac-001',
    ),
    definePerformanceRule(
        'PRF-POL-001',
        SEVERITY_WARNING,
        'Hot path expensive resources lack reuse pooling: frequent allocation of heavy objects,' +
            'buffers, or connections in loops or hot calls.',
        'Introduce object/buffer pooling mechanisms and reclaim resources at lifecycle termination.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#prf-pol-001',
    ),
    definePerformanceRule(
        'PRF-POL-002',
        SEVERITY_ERROR,
        'Resource pool lacks state reset contract or capacity ceiling: missing reset_state' +
            'contract or unbounded growth causes data corruption and leaks.',
        'Implement object return reset logic and enforce high-watermark eviction limits on pool capacity.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#prf-pol-002',
    ),
    definePerformanceRule(
        'PRF-POL-003',
        SEVERITY_WARNING,
        'Negative-return excessive pooling: introducing pooling overhead for tiny, lightweight' +
            'value objects or cold paths.',
        'Remove negative-return pooling wrappers; use direct value objects or short-lived transient allocations.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#prf-pol-003',
    ),
    defineArchitectureRule(
        'ARCH-CFG-008',
        'Flat configuration sprawl antipattern: large volume of configuration files sprawled' +
            'across root directory without domain isomorphic hierarchy.',
        'Establish domain isomorphic directory structure (e.g.' +
            'config/domains/<domain>/core.json), centralizing configuration per domain.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-cfg-008',
    ),
    defineArchitectureRule(
        'ARCH-CFG-009',
        'Configuration sub-table routing contract breach: unregistered sub-table detached from' +
            'core routing contract, lacking dot-notation routing.',
        'Register sub-table in main configuration table and connect to dot-notation routing and' +
            'fine-grained hot-reload guards.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#arch-cfg-009',
    ),
    defineRule({
        id: 'DAT-RES-001',
        family: RULE_FAMILY_DATA_ARCHITECTURE,
        analyzer: ANALYZER_DATA_ARCHITECTURE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Resource registry bidirectional mapping inconsistency or dangling asset: resource' +
                'center contains empty paths or dangling references.',
        remediation:
            'Ensure symmetric bidirectional registration in resource center; repair or prune' +
                'dangling paths and orphaned assets.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#dat-res-001',
    }),
    definePerformanceRule(
        'PRF-POL-004',
        SEVERITY_WARNING,
        'Streaming chunk loading lacks ring buffer reuse: repeated instantiation of temporary' +
            'buffers during streaming I/O or chunked reading.',
        'Introduce circular ring buffer (RingBuffer) or fixed-size buffer pool (BufferPool) to' +
            'achieve zero-copy slot reuse.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#prf-pol-004',
    ),
    definePerformanceRule(
        'PRF-ALG-002',
        SEVERITY_WARNING,
        'Linear collection scan antipattern in loop: performing linear searches' +
            '(find/includes/has/in list) inside loops degrading complexity to O(N*M).',
        'Pre-build external collection into Map or Dictionary hash index before the loop to' +
            'reduce inner lookup to O(1) and overall to O(N+M).',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#prf-alg-002',
    ),
];
