/**
 * Module: Core Engine — Rule Registry (governance entries)
 * File Path: src/core/rules/entries/governance.ts
 * Architecture Role: Declarative rule metadata for one domain; the index in ./registry.ts
 *   concatenates every domain into the single RULE_REGISTRY source of truth.
 * Dependencies & Triggers: core rule types plus defineRule(); consumed by ./registry.ts
 * Responsibilities: List { id, family, analyzer, canonical flag, legacy reason, languages,
 *   default severity, summary, remediation, docs anchor } for each emitted rule id.
 * Exit Semantics & Design Rationale: Pure data, no behaviour. Entries are grouped by owning
 *   domain (governance rules vs built-in analyzer rules vs platform/legacy ids) so the registry
 *   stays readable and never becomes a monolith.
 */
import type { RuleDefinition, RuleSeverity } from '../types';
import {
    ALL_LANGUAGES,
    defineRule,
    RULE_FAMILY_GOVERNANCE,
    RULE_FAMILY_CMP,
    RULE_FAMILY_NUMERIC,
    SEVERITY_INFO,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
    LANGUAGE_TYPESCRIPT,
    LANGUAGE_JAVASCRIPT,
    LANGUAGE_PYTHON,
    LANGUAGE_RUST,
} from '../types';
import { ANALYZER_GOVERNANCE } from '../../scoring/dimensionLiterals';

/** Languages the CMP-* family is declared for. */
const CMP_LANGUAGES: readonly string[] = [LANGUAGE_TYPESCRIPT, LANGUAGE_JAVASCRIPT];
const LANGUAGES_TS_JS: readonly string[] = [LANGUAGE_TYPESCRIPT, LANGUAGE_JAVASCRIPT];
const LANGUAGES_TS: readonly string[] = [LANGUAGE_TYPESCRIPT];
const LANGUAGES_EXC_001: readonly string[] = [
    LANGUAGE_TYPESCRIPT,
    LANGUAGE_JAVASCRIPT,
    LANGUAGE_PYTHON,
];
const LANGUAGES_RUST: readonly string[] = [LANGUAGE_RUST];

function defineGov(
    id: string,
    languages: readonly string[],
    defaultSeverity: RuleSeverity,
    summary: string,
    remediation: string,
    docsAnchor: string,
): RuleDefinition {
    return defineRule({
        id,
        family: RULE_FAMILY_GOVERNANCE,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages,
        defaultSeverity,
        summary,
        remediation,
        docsAnchor,
    });
}

function defineCmp(
    id: string,
    defaultSeverity: RuleSeverity,
    summary: string,
    remediation: string,
    docsAnchor: string,
): RuleDefinition {
    return defineRule({
        id,
        family: RULE_FAMILY_CMP,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: CMP_LANGUAGES,
        defaultSeverity,
        summary,
        remediation,
        docsAnchor,
    });
}

/** governance rules. */
export const GOVERNANCE_RULES: readonly RuleDefinition[] = [
    defineGov(
        'GOV-AGN-001',
        ALL_LANGUAGES,
        SEVERITY_ERROR,
        'Concurrent modifications by multiple agents produce architectural boundary breaches, cross-module dependency cycles, or contract incompatibilities.',
        'Align architectural boundaries and scopes across parallel agents, eliminate cross-module cyclic dependencies, and enforce unidirectional layering contracts.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-agn-001',
    ),
    defineGov(
        'GOV-SLC-001',
        ALL_LANGUAGES,
        SEVERITY_ERROR,
        'AST slice mutation introduces breaking signature drift or uncontained side-effects propagating across external call chains.',
        'Ensure slice edits are strictly backward-compatible or synchronously refactor all external call sites across affected chains.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-slc-001',
    ),
    defineGov(
        'GOV-TRJ-001',
        ALL_LANGUAGES,
        SEVERITY_ERROR,
        'Historical trajectory exhibits cyclic regressions, flip-flop oscillations, or re-introduces previously eliminated architectural anti-patterns.',
        'Maintain monotonic quality improvement in refactor trajectories; prevent re-introducing architectural anti-patterns previously eliminated by recipes.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-trj-001',
    ),
    defineGov(
        'GOV-DBG-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Debug and console print statements clutter standard outputs, leak diagnostics, and can degrade I/O throughput.',
        'Remove debugging print statements or migrate to structured logging with appropriate log levels.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-dbg-001',
    ),
    defineGov(
        'GOV-MSG-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Underlying diagnostic messages and remediations must use standard English centrally managed by constant dictionaries, prohibiting hardcoded non-ASCII or inline strings at emitter sites.',
        'Extract inline error messages to centralized constant pools under src/core/messages/ and ensure phrasing conforms to industry technical English.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-msg-001',
    ),
    defineGov(
        'GOV-RTC-002',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Baseline debt entries must track physical file rename operations without artificial inflation or false positive churn. Monotonic downward ratchets must remap prior baselines to new paths upon refactoring.',
        'Apply pathRemap normalization during baseline updates and gate convergence to ensure continuous inheritance of legacy debt and prevent false inflation.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-rtc-002',
    ),
    defineGov(
        'GOV-EXC-001',
        LANGUAGES_EXC_001,
        SEVERITY_ERROR,
        'Empty catch blocks silently swallow exceptions, causing silent data corruption or masking critical failures. A catch whose body carries an explicit rationale marker (best-effort / ignore / intentional / expected) is treated as a documented decision instead of a silent swallow.',
        'Handle, log, or explicitly rethrow the error; if best-effort ignore is intended, include an explicit rationale tag in the catch block.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-exc-001',
    ),
    defineGov(
        'GOV-EXC-002',
        LANGUAGES_RUST,
        SEVERITY_WARNING,
        'Naked `.unwrap()` causes unrecoverable process panics in production upon Err or None.',
        'Avoid naked unwrap() or expect(); handle errors explicitly via matching branches or propagate via Result/Option.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-exc-002',
    ),
    defineGov(
        'GOV-EXC-003',
        LANGUAGES_EXC_001,
        SEVERITY_ERROR,
        'Pseudo-catch blocks containing only dummy non-handling statements (void 0, dead assignment) silently swallow exceptions without logging or documented rationale.',
        'Add structured logging or rethrowing to dummy catch/except blocks, or document intent with an explicit rationale tag (e.g., best-effort, expected).',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-exc-003',
    ),
    defineGov(
        'GOV-FIL-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Inconsistent file naming causes cross-platform casing issues and impairs modular discovery.',
        'Rename file according to target language conventions (kebab-case for TS/JS, snake_case for Python/Rust/GDScript).',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-fil-001',
    ),
    defineGov(
        'GOV-FIL-002',
        ALL_LANGUAGES,
        SEVERITY_INFO,
        'Substantial production modules must declare their architectural role and responsibility boundary.',
        'Correct file header declaration path or complete missing mandatory header fields.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-fil-002',
    ),
    defineGov(
        'GOV-LOG-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Deeply nested control flows (> 5 levels) create high cognitive load and increase defect risk.',
        'Reduce nesting depth: use guard clauses with early returns, extract helper functions, or flatten branching logic.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-log-001',
    ),
    defineGov(
        'GOV-LOG-002',
        ALL_LANGUAGES,
        SEVERITY_INFO,
        'Vacuous wrapper methods that purely forward calls without validation or translation add unnecessary indirection.',
        'Remove passthrough forwarders so callers invoke target directly, or merge cohesive responsibilities.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-log-002',
    ),
    defineGov(
        'GOV-GAM-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Anti-gaming violation: artificial function splitting, tautological test padding, or empty boilerplate gaming quality metrics.',
        'Maintain cohesive business logic and write substantive test assertions; eliminate empty boilerplate and tautological tests.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-gam-001',
    ),
    defineGov(
        'GOV-MNT-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Deep class inheritance hierarchies (> 2 levels) introduce fragile base class problems; composition is preferred.',
        'Flatten inheritance hierarchy: favor composition over inheritance, or extract shared behavior into standalone utility modules.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-mnt-001',
    ),
    defineGov(
        'GOV-MNT-002',
        ALL_LANGUAGES,
        SEVERITY_ERROR,
        'Domain layer must remain clean and portable; importing UI or CLI presentation frameworks introduces severe coupling.',
        'Invert dependencies: declare ports/interfaces within the domain layer and implement them in outer presentation/infrastructure layers.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-mnt-002',
    ),
    defineGov(
        'GOV-PRF-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Performing invariant I/O, regex construction, or repetitive configuration lookups in loops incurs severe CPU/throughput penalties.',
        'Hoist loop-invariant expressions and expensive calculations outside the loop body.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-001',
    ),
    defineGov(
        'GOV-PRF-002',
        ALL_LANGUAGES,
        SEVERITY_INFO,
        'Calling linear search (.find / .indexOf / .includes) inside a loop scales at O(N*M); pre-indexing in Map/Set optimizes to O(N).',
        'Use a Set or Map for O(1) membership lookups to eliminate quadratic nested linear scans inside loops.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-002',
    ),
    defineGov(
        'GOV-PRF-003',
        LANGUAGES_TS_JS,
        SEVERITY_ERROR,
        'Numeric timer delays bypass centralized clamping; a literal of <=0 triggers a ~1ms busy loop (CPU/IO hotspot).',
        'Use named constants or centralized configuration for timer delays to avoid bypassing unified clamping safeguards.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-003',
    ),
    defineGov(
        'GOV-PRF-004',
        LANGUAGES_TS_JS,
        SEVERITY_WARNING,
        'Sync fs calls block the host event loop (UI jank in IDE extensions, request stalls on servers).',
        'Migrate to asynchronous I/O; declare blockingIoAllowPatterns for CLI batch processes where synchronous operations are permitted.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-004',
    ),
    defineGov(
        'GOV-PRF-005',
        ALL_LANGUAGES,
        SEVERITY_INFO,
        'Calling array linear lookups (.includes / .indexOf) inside loops creates quadratic O(N*M) overhead; pre-indexing into a Set hoisted outside the loop optimizes membership tests to O(1).',
        'Hoist read-only arrays to pre-indexed Sets before the loop (const set = new Set(arr)) and use set.has() for O(1) lookups.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-prf-005',
    ),
    defineGov(
        'GOV-DAT-001',
        ALL_LANGUAGES,
        SEVERITY_INFO,
        'Functions declaring excessive discrete scalar parameters (>= 5) exhibit Data Clumps smell; parameters should be aggregated into a named Context or Options interface.',
        'Aggregate discrete parameters into a strongly-typed structured context model (such as a Context or Options interface).',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-dat-001',
    ),
    defineGov(
        'GOV-SAN-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Transient task tags and batch jargon (pXX/phaseXX/stXX/wip) compromise architectural longevity and create documentation drift.',
        'Remove temporary ticket, phase, or batch jargon and replace with enduring domain and architectural terminology.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-san-001',
    ),
    defineGov(
        'GOV-STD-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Redundant if-then-else returning boolean literals increases cyclomatic complexity and mental overhead.',
        'Return the boolean expression directly instead of wrapping it in redundant if/else branches.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-std-001',
    ),
    defineGov(
        'GOV-STD-002',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Legacy constructs (e.g. `var` in modern TS/JS, dead `pass` in GDScript) violate language idiomatic standards.',
        'Replace deprecated language constructs (such as var or legacy keys) with modern idioms.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-std-002',
    ),
    defineGov(
        'GOV-TYP-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Implicit loose typing hides type errors at runtime and weakens static safety guarantees.',
        'Provide explicit type annotations for variables, constants, and parameters.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-001',
    ),
    defineGov(
        'GOV-TYP-002',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Unannotated function signatures compromise API boundaries and allow unintended type drift.',
        'Add explicit return type annotations to function and method signatures.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-002',
    ),
    defineGov(
        'GOV-TYP-003',
        LANGUAGES_TS,
        SEVERITY_WARNING,
        'Naked `any` bypasses the entire compiler type checker, leaking type instability.',
        'Replace naked any with unknown or specific union types; document rationale for controlled casts at dynamic boundaries.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-003',
    ),
    defineGov(
        'GOV-TYP-004',
        LANGUAGES_TS,
        SEVERITY_WARNING,
        'Passing or assigning `undefined as any` or `null as any` indicates an Interface Segregation Principle (ISP) violation.',
        'Declare target parameters as optional union types or segregate interfaces to eliminate forced undefined/null as any casts.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-004',
    ),
    defineGov(
        'GOV-TYP-005',
        LANGUAGES_TS,
        SEVERITY_WARNING,
        'Accessing properties via `(expr as any).prop` bypasses compiler type safety and indicates missing type narrowing guards.',
        'Use standard type narrowing predicates (e.g., ts.canHaveModifiers or isXxx) to guard property access instead of any casts.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-004',
    ),
    defineGov(
        'GOV-TYP-006',
        LANGUAGES_TS,
        SEVERITY_WARNING,
        'Exported functions, classes, and public methods must specify explicit return types to protect public API contracts.',
        'Add explicit return type annotations to exported public functions and methods to preserve API contract stability.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-typ-006',
    ),
    defineCmp(
        'CMP-EXP-001',
        SEVERITY_WARNING,
        'Giant expressions with deeply nested ternaries or unbounded logical chains create cognitive overload and obscure branching logic.',
        'Break complex nested ternaries or long boolean chains into named intermediate constants or explicit if-else statements.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#cmp-exp-001',
    ),
    defineCmp(
        'CMP-LIN-001',
        SEVERITY_WARNING,
        'Cramming multiple distinct statements or side-effects onto a single line impairs stack traces, debug stepping, and code readability.',
        'Split multiple statements or side-effects on a single line across multiple lines, adhering to single responsibility per line.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#cmp-lin-001',
    ),
    defineCmp(
        'CMP-CAL-001',
        SEVERITY_WARNING,
        'Deeply nested inline callback chains create callback hell, complicate exception propagation, and mask race conditions.',
        'Flatten callback chains using async/await, Promise chaining, or extract named top-level functions.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#cmp-cal-001',
    ),
    defineCmp(
        'CMP-DEN-001',
        SEVERITY_WARNING,
        'Dense syntactic packing of bitwise, arithmetic and conditional operators without naming or spacing exceeds human cognitive chunking capacity.',
        'Reduce cognitive density: add spacing and named intermediate variables to break down complex expressions.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#cmp-den-001',
    ),
    defineGov(
        'GOV-BLS-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Cross-tier monolithic change blast radius breaches atomic staging boundaries across docs, contracts, config, domains, and tooling.',
        'Decompose monolithic blast radius into atomic commits ordered by architectural dependency (docs -> core -> infra -> config -> business -> refactor).',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-bls-001',
    ),
    defineGov(
        'GOV-RUL-001',
        ALL_LANGUAGES,
        SEVERITY_ERROR,
        'Static review rule identifier drift or hallucination: mentioned rule ID is not registered in the single-source rule catalog.',
        'Verify rule catalog single source of truth and reference registered rule IDs; never invent hallucinated rule codes.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-rul-001',
    ),
    defineGov(
        'GOV-ARC-001',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Historical dossier nomenclature leaks into production sources, tests, or commit headers outside the archived directory white-list.',
        'Restrict historical dossier nomenclature strictly to archive white-list paths; express user-facing docs and commit messages in terms of product features.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-arc-001',
    ),
    defineGov(
        'GOV-SAN-002',
        ALL_LANGUAGES,
        SEVERITY_WARNING,
        'Objective technical language guard: text contains promotional rhetoric, absolute claims, emotional disparagement, or process buzzwords.',
        'Replace promotional rhetoric and absolute assertions with objective technical descriptions and reproducible verification facts.',
        'docs/04-analyzers-and-rules/01-builtin-rules.md#gov-san-002',
    ),
    defineRule({
        id: 'NUM-PREC-001',
        family: RULE_FAMILY_NUMERIC,
        analyzer: ANALYZER_GOVERNANCE,
        canonical: true,
        languages: LANGUAGES_TS_JS,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Lossy precision rounding or mismatched scaling detected in mathematical calculation path, risking IEEE 754 drift.',
        remediation:
            'Use standard 0.01 precision rounding (e.g. * 100 / 100) or explicit tolerance bounds to preserve precision.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#num-prec-001',
    }),
];
