/**
 * Module: Core Engine — Rule Registry (analyzer entries)
 * File Path: src/core/rules/entries/analyzers.ts
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
    RULE_FAMILY_COMMENTS,
    RULE_FAMILY_ERROR,
    RULE_FAMILY_SECURITY,
    RULE_FAMILY_SIMPLIFY,
    RULE_FAMILY_PYTHON_MODERN,
    LANGUAGE_PYTHON,
} from '../types';
import {
    ANALYZER_COMMENTS,
    ANALYZER_HYGIENE,
    ANALYZER_SECURITY,
    ANALYZER_SIMPLIFY,
    ANALYZER_PYTHON_MODERN,
    RULE_SIM_ARGS_001,
    RULE_SIM_ARGS_002,
    RULE_CMT_HDR_004,
} from '../../scoring/dimensionLiterals';
import { ANALYZER_MODERN_RULES } from './analyzers-modern';
import { ANALYZER_HYGIENE_RULES } from './analyzers-hygiene';

const BUILTIN_DOCS_BASE = 'docs/04-analyzers-and-rules/01-builtin-rules.md#';

/**
 * Constructs a canonical built-in RuleDefinition anchored under the built-in rule catalog.
 *
 * @param id - Canonical rule identifier (e.g. `PRF-MEM-001`).
 * @param family - Rule family grouping identifier.
 * @param analyzer - Owning analyzer adapter name.
 * @param defaultSeverity - Default emission severity level.
 * @param summary - Concise invariant violation description.
 * @param remediation - Actionable fix guidance.
 * @param languages - Target language scope (defaults to all supported languages).
 * @returns Frozen RuleDefinition object registered in RULE_REGISTRY.
 */
function builtinRule(
    id: string,
    family: RuleDefinition['family'],
    analyzer: RuleDefinition['analyzer'],
    defaultSeverity: RuleDefinition['defaultSeverity'],
    summary: string,
    remediation: string,
    languages: readonly string[] = ALL_LANGUAGES,
): RuleDefinition {
    return defineRule({
        id,
        family,
        analyzer,
        canonical: true,
        languages,
        defaultSeverity,
        summary,
        remediation,
        docsAnchor: `${BUILTIN_DOCS_BASE}${id.toLowerCase()}`,
    });
}

/**
 * Constructs a canonical Python-modernization RuleDefinition (`PYM-*`).
 *
 * @param id - Canonical `PYM-*` rule identifier.
 * @param defaultSeverity - Default emission severity level.
 * @param summary - Concise Python modernization violation summary.
 * @param remediation - Target PEP-aligned Python syntax migration guidance.
 * @returns Frozen RuleDefinition scoped to Python sources.
 */
function pythonRule(
    id: string,
    defaultSeverity: RuleDefinition['defaultSeverity'],
    summary: string,
    remediation: string,
): RuleDefinition {
    return builtinRule(
        id,
        RULE_FAMILY_PYTHON_MODERN,
        ANALYZER_PYTHON_MODERN,
        defaultSeverity,
        summary,
        remediation,
        [LANGUAGE_PYTHON],
    );
}

/**
 * Analyzer rule table: every rule whose owner is a built-in analyzer pack.
 *
 * The modernization and architecture families live in ./analyzers-modern and are spread here,
 * so this list stays the single ordered entry point the registry consumes.
 * Domain invariant: every entry carries `canonical: true`, an explicit `docsAnchor` fragment,
 * and unique IDs verified bidirectionally by `scripts/validate-rules-registry.js`.
 */
export const ANALYZER_RULES: readonly RuleDefinition[] = [
    // ── Comment Quality & Header Contracts (CMT-*) ──
    // Enforces 6-field module headers, 100-col comment width, and concurrency JSDoc contracts.
    defineRule({
        id: 'CMT-BAN-001',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Banner divider (═) used in small file (< 150 lines).',
        remediation:
            'Remove banner divider bars from files under 150 lines; use concise section headers instead.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-ban-001',
    }),
    defineRule({
        id: 'CMT-CON-001',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Async exported function lacks concurrency scheduling assumptions, reentrancy, or idempotence contract.',
        remediation:
            'Document concurrency assumptions, reentrancy guards, lock scope, or idempotence semantics in JSDoc.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-con-001',
    }),
    defineRule({
        id: 'CMT-DOC-001',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Public exported symbol lacks Docstring/JSDoc description, parameters, or return type documentation.',
        remediation:
            'Add JSDoc or docstring summary alongside parameter and return descriptions on public exported symbols.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-doc-001',
    }),
    defineRule({
        id: 'CMT-DOC-002',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Tautological redundant comment merely repeating symbol or function name.',
        remediation:
            'Rewrite tautological comments to state design rationale, invariants, or edge cases rather than echoing symbol names.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-doc-002',
    }),
    defineRule({
        id: 'CMT-HDR-001',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Source file missing top-level file header comment explaining responsibility and design intent.',
        remediation:
            'Add a top-level file header comment describing module responsibility, dependencies, and design intent.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-hdr-001',
    }),
    defineRule({
        id: 'CMT-HDR-002',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Standard strict six-field file header missing one of six mandatory fields (Module, File Path, Architecture Role, Dependencies & Triggers, Responsibilities, Exit Semantics & Design Rationale).',
        remediation:
            'Include all six required header fields (Module, File Path, Architecture Role, Dependencies & Triggers, Responsibilities, Exit Semantics & Design Rationale).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-hdr-002',
    }),
    defineRule({
        id: 'CMT-HDR-003',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'File header declared path does not match actual physical file path.',
        remediation:
            'Update the File Path header field to match the exact relative path of the source file on disk.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-hdr-003',
    }),
    defineRule({
        id: RULE_CMT_HDR_004,
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'File layout order violation: top-level six-field module header comment must precede all non-directive code statements.',
        remediation:
            'Relocate module header JSDoc block to line 1 immediately following optional shebang or encoding directive.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-hdr-004',
    }),
    defineRule({
        id: 'CMT-INT-001',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Documented contract (pure, side-effect free, thread-safe) contradicts actual AST data flow or side effects.',
        remediation:
            'Update comments to reflect actual behavior, or refactor code to eliminate undeclared side effects.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-int-001',
    }),
    defineRule({
        id: 'CMT-LNG-001',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Comment language deviates from dominant project or domain standard.',
        remediation: 'Align comment language with the project standard to maintain consistency.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-lng-001',
    }),
    defineRule({
        id: 'CMT-LNG-002',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Unordered interleaving of languages in comments within a single file.',
        remediation: 'Standardize on a single comment language per file to avoid fragmentation.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-lng-002',
    }),
    defineRule({
        id: 'CMT-MOJI-001',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Encoding corruption detected (U+FFFD replacement characters, UTF-8 decoded as Latin-1, or Windows-1252 mojibake).',
        remediation:
            'Re-encode the file in UTF-8 without BOM and replace corrupted or mojibake byte sequences cleanly.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-moji-001',
    }),
    defineRule({
        id: 'CMT-SEP-001',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Inconsistent section separator styles mixed in same file (short ── title ── vs long ──── title).',
        remediation:
            'Standardize on a single consistent section separator style throughout the file.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-sep-001',
    }),
    defineRule({
        id: 'CMT-TRM-001',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Comment or docstring contains non-factual terminology, casual phrasing, hyperbolic assertions, or emotional slurs.',
        remediation:
            'Express technical specifications, design rationale, and boundary invariants using neutral and verifiable terms.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-trm-001',
    }),
    defineRule({
        id: 'CMT-VMD-001',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Low semantic comment density or verbatim line-by-line translation without explaining intent.',
        remediation:
            'Focus comments on design rationale and boundary invariants rather than restating code.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-vmd-001',
    }),
    defineRule({
        id: 'CMT-WID-001',
        family: RULE_FAMILY_COMMENTS,
        analyzer: ANALYZER_COMMENTS,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Comment or docstring physical line length exceeds 100 columns.',
        remediation:
            'Wrap comment or docstring lines cleanly so every physical comment line stays at or below 100 columns.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#cmt-wid-001',
    }),
    // ── Documentation & Error Discipline Rules (DOC-*, ERR-*) ──
    defineRule({
        id: 'DOC-DUP-001',
        family: 'DOC',
        analyzer: 'docs',
        canonical: true,
        languages: ['markdown'],
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Duplicate content lines (>= 24 chars) detected in documentation.',
        remediation: 'Consolidate duplicate sections into a single source with cross-references.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#doc-dup-001',
    }),
    defineRule({
        id: 'DOC-FEN-001',
        family: 'DOC',
        analyzer: 'docs',
        canonical: true,
        languages: ['markdown'],
        defaultSeverity: SEVERITY_ERROR,
        summary: 'Unclosed Markdown code fence detected.',
        remediation:
            'Add closing code fence backticks to prevent subsequent sections from being swallowed.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#doc-fen-001',
    }),
    defineRule({
        id: 'DOC-LNK-001',
        family: 'DOC',
        analyzer: 'docs',
        canonical: true,
        languages: ['markdown'],
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Backtick path or relative link points to non-existent file.',
        remediation: 'Update link to valid target path or annotate as example/deprecated.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#doc-lnk-001',
    }),
    defineRule({
        id: 'DOC-TRM-001',
        family: 'DOC',
        analyzer: 'docs',
        canonical: true,
        languages: ['markdown'],
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Documentation prose contains promotional slogans, hyperbolic claims, or unstandardized milestone jargon.',
        remediation:
            'Adopt neutral and pragmatic technical descriptions, describing concrete capabilities and verifiable architectures.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#doc-trm-001',
    }),
    defineRule({
        id: 'ERR-FLT-001',
        family: RULE_FAMILY_ERROR,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Unhandled floating promise: asynchronous operation executed without await, return, void, or .catch() error handler.',
        remediation:
            'Awaited via await, return to caller, void discarded with void operator, or handle via .catch() to ensure asynchronous reliability.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#err-flt-001',
    }),
    defineRule({
        id: 'ERR-MSG-001',
        family: RULE_FAMILY_ERROR,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Vague or empty error diagnostic message: thrown error lacks actionable diagnostic context, root cause details, or troubleshooting hints.',
        remediation:
            'Provide clear diagnostic context, expected versus actual states, and root cause hints to maintain high debuggability (ESR diagnostic standard).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#err-msg-001',
    }),
    defineRule({
        id: 'ERR-PRP-001',
        family: RULE_FAMILY_ERROR,
        analyzer: ANALYZER_HYGIENE,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Error code re-thrown across declarations or propagating through excessive call stack hops.',
        remediation:
            'Unify error taxonomy with named error types and transform errors at boundary layers.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#err-prp-001',
    }),
    // ── Hygiene, Performance & Python Modernization Rules (PRF-*, PYM-*) ──
    ...ANALYZER_HYGIENE_RULES,
    defineRule({
        id: 'PRF-ALG-001',
        family: 'PRF',
        analyzer: 'performance',
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Deep nested loops (>= 3 levels) detected, creating potential O(N^3) computational hotspots.',
        remediation: 'Pre-index inner data using Map/Set to reduce search complexity to O(1).',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#prf-alg-001',
    }),
    defineRule({
        id: 'PRF-IO-001',
        family: 'PRF',
        analyzer: 'performance',
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Synchronous blocking I/O invoked inside async context or high-frequency frame loop.',
        remediation:
            'Migrate to asynchronous non-blocking APIs to avoid blocking the event loop or main thread.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#prf-io-001',
    }),
    defineRule({
        id: 'PRF-LEAK-001',
        family: 'PRF',
        analyzer: 'performance',
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Unbounded collection growth inside loop or timer, risking O(t) or O(n) memory leaks.',
        remediation: 'Enforce capacity limits, LRU eviction, or periodic pruning on collections.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#prf-leak-001',
    }),
    defineRule({
        id: 'PRF-MEM-001',
        family: 'PRF',
        analyzer: 'performance',
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Transient heap allocation inside high-frequency loop (new Array, new Object, .duplicate(true)).',
        remediation: 'Hoist buffers or objects outside loop and reset in-place inside loop.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#prf-mem-001',
    }),
    defineRule({
        id: 'PRF-MEM-002',
        family: 'PRF',
        analyzer: 'performance',
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Transient heap allocation in high-load hot paths; object pooling required (ADV-PRF-002).',
        remediation:
            'Adopt object pool pattern and invoke reset_state() upon acquisition and release.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#prf-mem-002',
    }),
    // ── Python 3.11+ Modernization Rules (PYM-*) ──
    // Enforces PEP 585 built-in generics, PEP 604 union syntax, PEP 615 UTC, and async safety.
    pythonRule(
        'PYM-ABC-001',
        SEVERITY_ERROR,
        'Importing abstract collections from typing instead of collections.abc.',
        'Import abstract collections directly from collections.abc.',
    ),
    pythonRule(
        'PYM-ASYNC-001',
        SEVERITY_ERROR,
        'Blocking call or un-awaited synchronous call executed inside async function.',
        'Migrate to asynchronous equivalents (asyncio, httpx, async repositories).',
    ),
    pythonRule(
        'PYM-DATETIME-001',
        SEVERITY_ERROR,
        'Legacy timezone.utc usage detected.',
        'Migrate to datetime.UTC (PEP 615).',
    ),
    pythonRule(
        'PYM-DEFAULT-001',
        SEVERITY_WARNING,
        'Mutable default argument (=[], ={}, =set()) detected in function signature.',
        'Use None as sentinel default and construct mutable collection inside function body.',
    ),
    pythonRule(
        'PYM-FSTRING-001',
        SEVERITY_WARNING,
        'Legacy % string formatting detected.',
        'Migrate to modern f-strings.',
    ),
    pythonRule(
        'PYM-GENERIC-001',
        SEVERITY_ERROR,
        'Legacy container generics from typing (List, Dict, Set, Tuple) detected.',
        'Use built-in generic types (list, dict, set, tuple) (PEP 585).',
    ),
    pythonRule(
        'PYM-IMPORT-001',
        SEVERITY_WARNING,
        'Module-level imports not grouped into 3 sections or not sorted alphabetically.',
        'Group imports according to PEP 8 and sort alphabetically within sections.',
    ),
    pythonRule(
        'PYM-OPEN-001',
        SEVERITY_WARNING,
        'open() call not managed within a with statement block.',
        'Wrap open() in with open(...) as handle: block to guarantee resource cleanup.',
    ),
    pythonRule(
        'PYM-PATH-001',
        SEVERITY_WARNING,
        'Legacy os.path usage detected.',
        'Migrate to pathlib.Path for object-oriented filesystem operations.',
    ),
    pythonRule(
        'PYM-RAISE-001',
        SEVERITY_WARNING,
        'Exception raised inside except block without from clause, losing exception chain.',
        'Use raise X from exc to preserve chain, or bare raise to rethrow.',
    ),
    pythonRule(
        'PYM-SLOTS-001',
        SEVERITY_WARNING,
        'Non-inheriting @dataclass does not declare slots=True.',
        'Add slots=True to @dataclass; if __dict__ is required, declare slots=False explicitly.',
    ),
    pythonRule(
        'PYM-UNION-001',
        SEVERITY_ERROR,
        'Legacy Optional[...] or Union[...] used in type annotation or alias.',
        'Migrate to PEP 604 pipe syntax (X | None).',
    ),
    // ── Security & Simplification Rules (SEC-*, SIM-*) ──
    // Intercepts leaked secrets, arbitrary code execution, high-complexity dead code, and stubs.
    defineRule({
        id: 'SEC-LEAK-001',
        family: RULE_FAMILY_SECURITY,
        analyzer: ANALYZER_SECURITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Sensitive data (passwords, tokens, PII) logged or exposed in exceptions.',
        remediation:
            'Sanitize sensitive fields before logging, or log only identifiers and hashes.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sec-leak-001',
    }),
    defineRule({
        id: 'SEC-VUL-001',
        family: RULE_FAMILY_SECURITY,
        analyzer: ANALYZER_SECURITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary: 'Arbitrary dynamic code execution detected (eval, exec, Function constructor).',
        remediation:
            'Use explicit branches or table dispatch; use sandboxed interpreters if dynamic evaluation is required.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sec-vul-001',
    }),
    defineRule({
        id: 'SEC-VUL-002',
        family: RULE_FAMILY_SECURITY,
        analyzer: ANALYZER_SECURITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_ERROR,
        summary: 'Command injection: concatenating external input into shell/subprocess execution.',
        remediation:
            'Use argument arrays (execFile/spawn without shell) and validate input against allowlists.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sec-vul-002',
    }),
    defineRule({
        id: 'SEC-VUL-003',
        family: RULE_FAMILY_SECURITY,
        analyzer: ANALYZER_SECURITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Prototype pollution: writing externally controlled keys to object prototypes.',
        remediation:
            'Reject __proto__, constructor, and prototype keys, or use Map for external data.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sec-vul-003',
    }),
    defineRule({
        id: 'SEC-VUL-004',
        family: RULE_FAMILY_SECURITY,
        analyzer: ANALYZER_SECURITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Insecure pseudo-random number generator (Math.random) used in security-sensitive context.',
        remediation:
            'Use cryptographically secure random sources such as crypto.randomUUID or randomBytes.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sec-vul-004',
    }),
    defineRule({
        id: 'SEC-VUL-005',
        family: RULE_FAMILY_SECURITY,
        analyzer: ANALYZER_SECURITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Weak hash algorithm (MD5/SHA-1) used for integrity or password hashing.',
        remediation:
            'Use SHA-256 or higher for digests, and salted slow hashes (bcrypt/argon2) for passwords.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sec-vul-005',
    }),
    defineRule({
        id: 'SEC-VUL-006',
        family: RULE_FAMILY_SECURITY,
        analyzer: ANALYZER_SECURITY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Path traversal: concatenating external input directly into file paths.',
        remediation:
            'Normalize and verify path stays within allowed root directory, rejecting parent directory (..) segments.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sec-vul-006',
    }),
    defineRule({
        id: RULE_SIM_ARGS_001,
        family: RULE_FAMILY_SIMPLIFY,
        analyzer: ANALYZER_SIMPLIFY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Function signature parameter count exceeds threshold (> 4 parameters); refactoring with a ParameterObject recommended.',
        remediation:
            'Group related parameters into a cohesive parameter object or options interface to simplify call-sites.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sim-args-001',
    }),
    defineRule({
        id: RULE_SIM_ARGS_002,
        family: RULE_FAMILY_SIMPLIFY,
        analyzer: ANALYZER_SIMPLIFY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary:
            'Minimum parameter count threshold breached: public handler, listener, or solver function declares 0 parameters, risking implicit coupling with mutable global state.',
        remediation:
            'Declare explicit context or payload parameter instead of reading implicit module-level state.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sim-args-002',
    }),
    defineRule({
        id: 'SIM-COMC-001',
        family: RULE_FAMILY_SIMPLIFY,
        analyzer: ANALYZER_SIMPLIFY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Consecutive lines of commented-out code detected.',
        remediation:
            'Delete commented code (relying on git history) or restore it as executable code.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sim-comc-001',
    }),
    defineRule({
        id: 'SIM-EMPTY-001',
        family: RULE_FAMILY_SIMPLIFY,
        analyzer: ANALYZER_SIMPLIFY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Empty function body containing only pass, ellipsis (...), or empty block.',
        remediation:
            'Implement function body, throw NotImplemented error explicitly, or delete the stub.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sim-empty-001',
    }),
    defineRule({
        id: 'SIM-FLAT-002',
        family: RULE_FAMILY_SIMPLIFY,
        analyzer: ANALYZER_SIMPLIFY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Deeply nested branching logic exceeds nesting threshold (depth <= 3).',
        remediation: 'Refactor nested if/else statements using guard clauses with early returns.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sim-flat-002',
    }),
    defineRule({
        id: 'SIM-IMM-001',
        family: RULE_FAMILY_SIMPLIFY,
        analyzer: ANALYZER_SIMPLIFY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Eliminate uninitialized mutable let bindings by folding if-else into immutable const ternary.',
        remediation: 'Refactor let x; if (c) x = a; else x = b; into const x = c ? a : b;.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sim-imm-001',
    }),
    defineRule({
        id: 'SIM-INL-001',
        family: RULE_FAMILY_SIMPLIFY,
        analyzer: ANALYZER_SIMPLIFY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Single-use orphan function has high vector similarity with parent; inlining utility exceeds threshold.',
        remediation:
            'Collocate or inline single-use micro-fragments into caller to improve spatial locality.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sim-inl-001',
    }),
    defineRule({
        id: 'SIM-LONG-001',
        family: RULE_FAMILY_SIMPLIFY,
        analyzer: ANALYZER_SIMPLIFY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Function physical line count exceeds maximum threshold (default 60 lines).',
        remediation:
            'Extract cohesive steps into named helper functions, keeping top-level flow concise.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sim-long-001',
    }),
    defineRule({
        id: 'SIM-PRNT-001',
        family: RULE_FAMILY_SIMPLIFY,
        analyzer: ANALYZER_SIMPLIFY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_WARNING,
        summary: 'Raw debug print statements leaking into production outputs.',
        remediation: 'Use structured logging or remove debug prints.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sim-prnt-001',
    }),
    defineRule({
        id: 'SIM-TRN-001',
        family: RULE_FAMILY_SIMPLIFY,
        analyzer: ANALYZER_SIMPLIFY,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: SEVERITY_INFO,
        summary:
            'Redundant if-else branch can be simplified into a single-line ternary expression.',
        remediation:
            'Collapse single-assignment or return branches into a clean ternary expression.',
        docsAnchor: 'docs/04-analyzers-and-rules/01-builtin-rules.md#sim-trn-001',
    }),
    ...ANALYZER_MODERN_RULES,
];
