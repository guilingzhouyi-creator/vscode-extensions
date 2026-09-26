import type * as ts from 'typescript';
import type { NormalizedNode, LanguageAdapter, Position } from './multilang';
import type { IncrementalFileState } from './incremental-state';

/**
 * Module: Core Engine — Shared Type Contracts and Domain Model
 * File Path: src/core/types.ts
 * Architecture Role: compile-time single source of truth for the data contracts crossing the
 *   engine, analyzers, CLI, daemon, reporters, diff stream, and plug-in boundary.
 * Dependencies & Triggers: imports TypeScript's SourceFile type plus NormalizedNode /
 *   LanguageAdapter / Position from ./multilang, IncrementalFileState from
 *   ./incrementalState, EditRange from ./editDiff, and LogLevel from ./logger; re-exports
 *   Position, EditRange, and LogLevel plus the scoring, memory, trajectory, Praxis and
 *   diff (./diffTypes) type surfaces. Imported by analyzers, core modules, CLI/daemon code,
 *   and the api.ts barrel.
 * Responsibilities: define the canonical Issue / IssueLocation / FileMetric records;
 *   threshold, output, comment, security, scale, maturity, and suppression knobs; Analyzer,
 *   AnalyzerContext, VisitFrame, and streaming visit/finalize contracts; AnalyzerDeclaration
 *   and CustomAnalyzerDeclaration registration; ScanConfig / ScanSummary / ScanReport.
 *   The diff, warm-scan and streaming contracts live in ./diffTypes and are re-exported here
 *   so this hub stays under the engine's own large-file fail threshold.
 * Exit Semantics & Design Rationale: this module performs no scanning or control flow; apart
 *   from re-export bindings it is erased at compile time, so importing it has no per-file
 *   cost. Keeping these declarations centralized prevents producer/consumer drift against
 *   report.schema.json and lets implementation modules stay free of cross-cutting imports.
 */

// Re-exported for backward compatibility (utils/ast and other modules import Position here).
export { Position } from './multilang';
// EditRange is produced by editDiff.ts (ts-free) and consumed by the diff API (types below).
export { EditRange } from './edit-diff';

/**
 * Config `off` tokens. The same text disables four unrelated features, so it gets one named
 * constant per meaning instead of a single shared "off" value.
 */

/** CommentLevel token that disables the comments analyzer entirely. */
export const COMMENT_LEVEL_OFF = 'off';

/** SecurityLevel token that disables the security detector. */
export const SECURITY_LEVEL_OFF = 'off';

/** UnsupportedLanguageSeverity token that restores the historic silent behaviour. */
export const UNSUPPORTED_LANGUAGE_SEVERITY_OFF = 'off';

/** Daemon-mode token that never connects to or starts a daemon. */
export const DAEMON_MODE_OFF = 'off';

/** Sentinel token indicating an issue conclusion requires dynamic/runtime verification. */
export const NEED_RUNTIME_EVIDENCE = 'NEED_RUNTIME_EVIDENCE';

/** Severity levels; map to CI/SARIF levels (info->note, warning->warning, error->error). */
export type Severity = 'info' | 'warning' | 'error';

import type { AgentProfileName } from './governance/agent-profiles';
export type { AgentProfileName };

/** Informational severity level; maps to SARIF note level. */
export const SEVERITY_INFO: Severity = 'info';

/** Warning severity level; indicates advisory issues that do not fail quality gate by default. */
export const SEVERITY_WARNING: Severity = 'warning';

/** Error severity level; gate-blocking failure. */
export const SEVERITY_ERROR: Severity = 'error';

/** Canonical TypeScript language identifier. */
export const LANGUAGE_TYPESCRIPT = 'typescript';

/** Canonical JavaScript language identifier. */
export const LANGUAGE_JAVASCRIPT = 'javascript';

/** Canonical Python language identifier. */
export const LANGUAGE_PYTHON = 'python';

/** Canonical Rust language identifier. */
export const LANGUAGE_RUST = 'rust';

/** Canonical GDScript language identifier. */
export const LANGUAGE_GDSCRIPT = 'gdscript';

/** Canonical Go language identifier. */
export const LANGUAGE_GO = 'go';

/** Canonical Shell language identifier. */
export const LANGUAGE_SHELL = 'shell';

/** Canonical PowerShell language identifier. */
export const LANGUAGE_POWERSHELL = 'powershell';

/** Analyzer identifiers are open strings (built-in names + any custom-registered name). */
export type AnalyzerId = string;

/**
 * Source span of one issue: the repository-relative file plus a start and end Position. The
 * span is provenance metadata for reports and suppressions, not a byte-exact edit range.
 */
export interface IssueLocation {
    /** Relative file path (as scanned) */
    file: string;
    start: Position;
    end: Position;
}

export type {
    SemanticEvidenceStep,
    SemanticReviewDetail,
    TestModernityMetricSummary,
    TestDebtTicket,
} from './semantic-types';

/**
 * Uncertainty and empirical evidence metadata attached to an issue finding.
 *
 * Lets downstream reviewers, agents, and CI distinguish mathematically proven static findings
 * from probabilistic or runtime-dependent warnings.
 */
export interface IssueEvidence {
    /** Confidence score between 0.0 (heuristic) and 1.0 (strict static proof). */
    confidence: number;
    /** True if confirming this finding requires dynamic tracing or runtime execution evidence. */
    requiresRuntime?: boolean;
    /** Rationale for why runtime evidence is required (e.g. NEED_RUNTIME_EVIDENCE). */
    runtimeEvidenceReason?: string;
    [key: string]: unknown;
}

/**
 * A single, structured finding emitted by an analyzer.
 *
 * This is the **canonical output record** of the toolchain (see report.schema.json).
 * `id` is stable within a run: `${analyzer}:${rule}:${file}:${line}`. It is a grouping key,
 * not a unique key: a line that carries several findings of the same rule repeats the id, so
 * consumers that need one row per finding must key on `id` plus `location.start.column` (or
 * count occurrences). The baseline ratchet relies on that multiplicity.
 * `detail` carries machine-readable payloads for CI / code-review integration.
 */
/**
 * Canonical action types that an Agent or automated refactoring bot can execute deterministically.
 */
export type AgentActionType =
    | 'extract_constant'
    | 'hoist_declaration'
    | 'narrow_scope'
    | 'split_function'
    | 'simplify_control_flow'
    | 'replace_token'
    | 'insert_comment_contract'
    | 'guard_recursion'
    | 'use_constant_time_comparison'
    | 'scaffold_constant_library';

/**
 * Machine-actionable mutation payload tailored for AI Agents and automated codemods.
 *
 * Eliminates prose guesswork by supplying structured mutation targets, exact scopes,
 * safe-to-automate certainty flags, and concrete patch metadata.
 */
export interface AgentActionablePayload {
    /** Atomic refactoring action category */
    action: AgentActionType;
    /** Standardized machine rule code (e.g. AR-CONST-001) */
    code: string;
    /** Target scope for declaration or hoisting */
    targetScope?: 'module_top_level' | 'function_local' | 'block_local' | 'shared_domain';
    /** Recommended variable/constant identifier */
    targetSymbol?: string;
    /** Target directory for structured constant library scaffolding */
    targetDirectory?: string;
    /** Recommended module breakdown and symbols for constant library scaffolding */
    suggestedModules?: Array<{ file: string; symbols: string[]; isBarrel?: boolean }>;
    /** Anchor location for declaration insertion */
    insertAnchor?: {
        position: 'after_imports' | 'function_start' | 'before_target';
        line?: number;
    };
    /** Precise edit range and replacement text */
    patch?: {
        range: { startLine: number; startCol: number; endLine: number; endCol: number };
        replacementText: string;
    };
    /** Whether an automated Agent can safely apply this patch without human arbitration */
    safeToAutomate: boolean;
}

/**
 * Canonical refactoring issue reported by an analyzer.
 */
export interface Issue {
    /**
     * Stable, repeatable grouping key: `${analyzer}:${rule}:${file}:${line}`. Unique per
     * (rule, file, line) — not per finding.
     */
    id: string;
    analyzer: AnalyzerId;
    /**
     * Rule within the analyzer, e.g. "magic-number" | "hardcoded-string" | "duplicate-literal" |
     * "large-file" | "high-complexity"
     */
    rule: string;
    severity: Severity;
    message: string;
    location: IssueLocation;
    /** Analyzer-specific structured payload (values, counts, metrics, names...). */
    detail: Record<string, any>;
    /** Optional refactoring suggestion text. */
    suggestion?: string;
    /** Uncertainty and empirical evidence metadata (e.g. confidence score, runtime need). */
    evidence?: IssueEvidence;
    /** Machine-actionable mutation payload for automated Agent refactoring. */
    actionable?: AgentActionablePayload;
    /**
     * Baseline ratchet verdict, set only when a baseline file was compared. True means this
     * finding had no matching credit left in the baseline — a brand-new finding, an extra
     * occurrence of a rule already reported on that line, or a severity escalation of a
     * baselined finding.
     */
    isNew?: boolean;
    /**
     * Declarative suppression trail. Present when a config suppression matched this finding;
     * `reason` is always carried so a silenced finding stays auditable, and `downgraded` marks
     * a severity downgrade applied by the same rule.
     */
    suppression?: { reason: string; downgraded: boolean };
}

/**
 * Per-file structural metrics embedded in ScanReport: line and non-blank-line counts, function
 * count, maximum nesting depth, and top-level/exported declaration counts.
 */
export interface FileMetric {
    file: string;
    lines: number;
    nonBlankLines: number;
    functions: number;
    maxNestingDepth: number;
    topLevelDeclarations: number;
    exportedSymbols: number;
}

/**
 * Global numeric thresholds shared by built-in analyzers and deep-merged into each analyzer's
 * options. Values are absolute counts or lengths; a lower value makes the corresponding rule
 * more eager, a higher value makes it quieter.
 */
export interface Thresholds {
    // constants
    /** Numeric literals whose absolute value is below this are ignored. */
    magicNumberMin: number;
    /** A literal repeated >= this many times in a file becomes a duplicate-literal finding. */
    duplicateLiteralThreshold: number;
    /** Minimum string length to be considered a hardcoded-string candidate. */
    hardcodedStringMinLength: number;
    // large-file
    fileLinesWarn: number;
    fileLinesFail: number;
    fileFunctionsWarn: number;
    /**
     * Effective Code Lines (ECL) warning threshold
     * (excluding comments/blank lines/closing wrappers).
     */
    effectiveLocWarn?: number;
    /** Effective Code Lines (ECL) failure threshold. */
    effectiveLocFail?: number;
    // complexity
    complexityWarn: number;
    complexityFail: number;
    // simplify
    /** Functions longer than this many lines raise `long-function` (SIM-LONG-001). */
    maxFunctionLines: number;
    // semantic complexity
    /** Cross-function and cross-file polynomial time complexity derivation flag. */
    checkCrossFunctionComplexity?: boolean;
    /** Distinguish bounded small collections from dynamic unbounded streams. */
    distinguishBoundedCollections?: boolean;
    // data architecture
    /** Flag unpaginated full-collection or table scans on online request paths. */
    checkUnboundedQueries?: boolean;
    /** Flag N+1 iterative queries in loops or mapping closures. */
    checkNPlusOne?: boolean;
    /** Flag redundant cross-layer serialization/deserialization cycles. */
    checkRedundantSerialization?: boolean;
    /** Flag excessive redundant defensive validation within trusted domain contexts. */
    checkDefensiveExcess?: boolean;
    // test modernity
    /** Minimum acceptable Effective Modern Test Density (EMTD) score. */
    minEmtd?: number;
    /** Minimum acceptable Current Business Contract Coverage Rate (CBCR). */
    minCbcr?: number;
    /** Flag test suites validating deprecated contracts or testing mock stubs only. */
    flagDeprecatedContractTests?: boolean;
    /** Flag tautological, vacuous, or non-verifying test assertions. */
    flagTautologicalAssertions?: boolean;
    // dependency layout
    /** Enforce language-specific file layout and import grouping ordering. */
    enforceFileLayout?: boolean;
    /** Allow audited in-function imports with @lazy / @optional / @platform tags. */
    allowAuditedInFunctionImports?: boolean;
    /** Flag hardcoded unmanaged remote URLs or network endpoints. */
    flagUnmanagedResources?: boolean;
    // generalized architecture
    /** Enforce headless decoupled architecture on core business logic. */
    enforceHeadless?: boolean;
    /** Flag cross-domain private internal bypasses. */
    flagCrossDomainBypass?: boolean;
    /** Flag implicit shared mutable global state coupling decoupled domains. */
    flagMutableGlobalCoupling?: boolean;
    /** Flag structural layering illusions where directory separation masks inverted calls. */
    flagLayeringIllusions?: boolean;
    /** Flag configuration or environment leakage into domain logic. */
    flagConfigLeakage?: boolean;
    /** Protected keywords for configuration leakage detection. */
    protectedConfigKeywords?: string[];
}

/**
 * Report serialization format: `json` for structured consumers, `sarif` for CI code scanning,
 * or `text` for human-readable stdout.
 */
export type OutputFormat = 'json' | 'sarif' | 'text';

/**
 * Depth of the comments analyzer: `off` disables it, `basic` reports header/doc gaps at info
 * severity, `standard` adds trivial-documentation detection, and `strict` enforces all six
 * header fields, escalates missing docs to warnings, and requires async concurrency notes.
 */
export type CommentLevel = typeof COMMENT_LEVEL_OFF | 'basic' | 'standard' | 'strict';

/**
 * Depth of the security analyzer: `off` disables it, `basic` runs the core rules, and `full`
 * enables the extended rule set.
 */
export type SecurityLevel = typeof SECURITY_LEVEL_OFF | 'basic' | 'full';

/**
 * How the engine reports a source file that no language adapter claims. Such files are still
 * discovered (their extension is in the walker allow-list) and would otherwise be parsed by the
 * generic fallback adapter, yielding zero AST signal with no warning — a fail-open that silently
 * understates findings. `error` (default) fails closed; `warning` surfaces it without blocking;
 * `off` restores the historic silent behaviour.
 */
export type UnsupportedLanguageSeverity =
    'error' | 'warning' | typeof UNSUPPORTED_LANGUAGE_SEVERITY_OFF;

/**
 * Project scale bucket used to tune thresholds and scoring, ordered from `micro` to
 * `enterprise`.
 */
export type ScaleGrade = 'micro' | 'small' | 'medium' | 'large' | 'enterprise';
/**
 * Project maturity tier used for threshold tuning, ordered from `demo` (least governance) to
 * `industrial` (most governance).
 */
export type MaturityTier = 'demo' | 'prototype' | 'production' | 'industrial';

/**
 * Architectural layer label assigned to a directory by the project profiler and consumed by
 * governance and routing rules.
 */
export type ArchitectureLayer =
    'domain' | 'application' | 'infrastructure' | 'interface' | 'test' | 'tooling' | 'shared';

/**
 * One buildable sub-project discovered inside a repository: a display name, its root-relative
 * path, and optional build system, primary language, and framework list.
 */
export interface ProjectPartition {
    name: string;
    path: string;
    buildSystem?: string;
    primaryLanguage?: string;
    frameworks?: string[];
}

/**
 * Project archetype classification driving sparse reviewer routing and review budgets.
 */
export type ProjectArchetype =
    | 'demo'
    | 'web'
    | 'game'
    | 'library'
    | 'stdlib'
    | 'systems_runtime';

/**
 * Sparse-routing decision for the detected archetype, published in ScanSummary.
 *
 * `active`/`skipped` are the **routing recommendation** (analyzers, not reviewers, despite the
 * field name kept for compatibility). They describe what sparse routing would enable — not what
 * actually ran — unless `applied` is true. What actually ran is reported by `disabledAnalyzers`
 * (config-driven) and `byAnalyzer`, so a reader must never infer "this analyzer did not run"
 * from `skipped` alone.
 */
export interface ActivatedReviewersSummary {
    archetype: ProjectArchetype;
    active: string[];
    skipped: string[];
    activationRatio: number;
    reason: string;
    /**
     * True when sparse routing was actually applied to this scan (`sparseRouting: true`).
     * When false, the lists above are advisory only and the effective analyzer set is the
     * configured one.
     */
    applied: boolean;
}

/**
 * Auto-detected project profile: build systems, language distribution, primary language,
 * frameworks, directory-to-layer semantics, the polyglot flag, and partitions.
 */
export interface ProjectProfile {
    buildSystems: string[];
    languages: Record<string, number>;
    primaryLanguage: string;
    frameworks: string[];
    directorySemantics: Record<string, ArchitectureLayer>;
    isPolyglot: boolean;
    partitions: ProjectPartition[];
    archetype?: ProjectArchetype;
}

/**
 * TS/JS-family parser selection. 'typescript' is the default (historical `ts.createSourceFile`
 * path); 'oxc' uses the Rust `oxc-parser` engine (byte-equivalent normalized output — see
 * docs/02-parsers-and-ast/02-oxc-fastpath.md). Non-TS/JS languages (Rust) are unaffected by this
 * option.
 */
export type ParserKind = 'typescript' | 'oxc';

import { LogLevel } from './logger';
export { LogLevel };

/**
 * Declarative suppression: every field is optional except `reason`; a rule matches when
 * ALL present matchers hit. Inspired by consumer adapters that each reimplemented
 * "justified exemption" locally — promoted into the engine so suppressions are
 * visible, auditable and consistent across every consumer.
 */
export interface SuppressionRule {
    /** Relative file path (POSIX) as reported in issues; may be exact path. */
    matchFile?: string;
    matchAnalyzer?: string;
    matchRule?: string;
    /**
     * Symbol name from `detail.function`/`detail.name`; bare name matches qualified names
     * ('recover' hits 'RecoveryService.recover').
     */
    matchSymbol?: string;
    /** When set, the matched issue keeps flowing with its severity lowered to this level. */
    downgradeTo?: Severity;
    /**
     * Why this suppression exists. Rendered into the report — suppressions must never be silent.
     */
    reason: string;
}

/**
 * Declarative per-analyzer registration entry.
 * The presence of a key in `ScanConfig.analyzers` IS the registration itself —
 * the engine resolves each name to a built-in factory (or a custom module via `customAnalyzers`).
 */
export interface AnalyzerDeclaration {
    /** Set false to skip this analyzer without removing the declaration. Default: true. */
    enabled?: boolean;
    /** Per-analyzer options, deep-merged on top of the global `thresholds` into `ctx.options`. */
    options?: Record<string, any>;
}

/**
 * Declarative registration of an EXTERNAL analyzer module (the "plug-in" mechanism).
 * The module is loaded at runtime via `require(module)` and must export a class/object
 * implementing the `Analyzer` contract. No engine code change is required to add one.
 */
export interface CustomAnalyzerDeclaration {
    /** Unique analyzer id; referenced/enabled from `ScanConfig.analyzers`. */
    name: AnalyzerId;
    /** Module path or package specifier. Resolved relative to the config file's directory. */
    module: string;
    enabled?: boolean;
    /** Mutation signals triggering this custom analyzer (Fail-Closed, N-08). */
    signals?: readonly string[];
    /** Execution track for this custom analyzer ('fast' | 'deep' | 'off') (N-08). */
    track?: string;
    options?: Record<string, any>;
}

/**
 * Contextual scope threaded by the scanner through its single shared AST descent and handed
 * to every streaming analyzer's `visit` hook. Replaces the per-analyzer `node.parent` chains
 * (which would force `setParentNodes:true` at parse time — a measurable perf cost) and lets
 * analyzers reconstruct the contextual information they need without re-walking the tree.
 *
 *   parent / grandparent — the AST parent and grandparent of the current node
 *   depth              — control/block nesting depth at this node (0 at top level)
 *   className          — nearest enclosing class/object name, or null
 *   binding            — name this node's function-like children are bound to
 *                        (const x = () => …, obj.m = () => …, a.b = () => …), or null
 */
export interface VisitFrame {
    parent?: NormalizedNode;
    grandparent?: NormalizedNode;
    depth: number;
    className: string | null;
    binding: string | null;
}

/**
 * The single contract every analyzer (built-in or external) implements.
 *
 * **Unifying abstraction of the toolchain**: anything expressible as
 * `analyze(sourceFile, ctx) -> Issue[]` is in scope; anything needing a different input
 * (manifest, lockfile, network, runtime) is out of scope. Built-ins may also implement the
 * optional streaming hooks below, which the scanner drives in one shared AST walk.
 */
export interface Analyzer {
    /** Stable analyzer id (should match the registration key). */
    name: string;
    /** Contract/implementation version, e.g. 1. Informational; used for compatibility checks. */
    version?: number;
    /**
     * Optional explicit dependency on other analyzer ids. The scheduler runs prerequisites
     * first (topological order). Current built-in analyzers are stateless and set this to [].
     * Declared only when an analyzer needs another analyzer's side effects — which the
     * current pure-function model does not require.
     */
    dependsOn?: AnalyzerId[];
    /**
     * Standalone entry point. Run against one source file; return zero or more structured
     * Issues. Must not throw.
     *
     * This is the contract every analyzer (built-in or external) MUST implement and is what
     * the engine falls back to for analyzers that do not opt into the streaming model below.
     * Built-in analyzers implement this by delegating to the shared single-pass traversal, so
     * calling `analyze` directly (e.g. from a unit test or a script) still works and yields the
     * same results as the multiplexed engine path.
     */
    analyze(sf: ts.SourceFile | undefined, ctx: AnalyzerContext): Issue[];
    /**
     * OPTIONAL streaming hook — part of the single-pass multiplexed traversal.
     *
     * When present, the scanner drives ONE shared `ts.forEachChild` walk over the file and, for
     * every node, calls `visit(node, ctx, frame)` on every streaming analyzer, then calls
     * `finalize(ctx)` once to emit accumulated issues. This eliminates the N separate full-tree
     * walks an analyzer would otherwise perform, and lets all streaming analyzers share a single
     * traversal — a 2–4× analyzer-side speedup on large files.
     *
     * State accumulated in `visit` must be per-file: the engine instantiates a FRESH analyzer
     * per file for the streaming path, so instances are never reused across files (and thus never
     * shared across concurrently scanned files). `analyze` is still expected to work standalone.
     */
    visit?(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        parent: NormalizedNode | undefined,
        grandparent: NormalizedNode | undefined,
        depth: number,
        className: string | null,
        binding: string | null,
    ): void;
    /** Called once after the shared traversal completes; returns accumulated issues. */
    finalize?(ctx: AnalyzerContext): Issue[];
}

/** Context handed to each analyzer for a single source file. */
export interface AnalyzerContext {
    filePath: string; // relative path
    content: string;
    /**
     * Line statistics (lines / nonBlankLines) computed ONCE per file by the engine and shared
     * by every consumer (FileMetricCollector + large-file analyzer), replacing per-analyzer
     * `content.split` calls. Absent when the context was built outside the engine pipeline
     * (e.g. direct `analyze()` calls) — consumers fall back to splitting.
     */
    lineStats?: { lines: number; nonBlankLines: number };
    /**
     * Normalized AST root for this file. Present in the streaming path for every language;
     * external plugins may ignore it and use `sourceFile` instead.
     */
    root: NormalizedNode;
    /** The adapter that parsed this file (analyzers rarely need it, but it's available). */
    adapter: LanguageAdapter;
    /**
     * The ts.SourceFile for TypeScript-family files. Present when the scanned file is TS/JS
     * (kept for external plug-ins and the legacy `analyze` contract); undefined for other
     * languages (e.g. Rust), which external TS-only plug-ins cannot analyze.
     */
    sourceFile?: ts.SourceFile;
    config: ScanConfig;
    /** Merged options for THIS analyzer: global `thresholds` + the analyzer's own `options`. */
    options: Record<string, any>;
    /**
     * Line-level incremental state. Present ONLY on the in-process incremental path (a
     * big-file small-change rescan seeded with the previous scan's subtree/memo caches).
     * Absent for the normal cold / worker / standalone paths, where analyzers behave exactly
     * as before. Never changes output bytes — it is a pure performance hint.
     */
    incremental?: IncrementalFileState;
}

/** Declarative tolerance policy for function call arguments. */
export interface ToleratedCallArgumentPolicy {
    argIndex: number;
    allowedValues?: (number | string)[];
    allowedPattern?: string;
}

/** Declarative literal policy configuration. */
export interface LiteralPolicyConfig {
    toleratedCallArguments?: Record<string, ToleratedCallArgumentPolicy>;
}

/**
 * Fully resolved scan configuration: file discovery globs, analyzer registry, global
 * thresholds, execution controls, and reporting fields. Produced by resolveConfig, which
 * layers built-in defaults, the config file, and API/CLI overrides.
 */
export interface ScanConfig {
    root: string;
    /** Directory used to resolve relative `module` paths in customAnalyzers. Set internally. */
    baseDir: string;
    /** Glob patterns relative to root; a file must match at least one. */
    include: string[];
    /** Glob patterns or directory names to exclude. */
    exclude: string[];
    /** Declarative analyzer registry: name -> { enabled, options }. */
    analyzers: Record<AnalyzerId, AnalyzerDeclaration>;
    /** External plug-in modules registered declaratively. */
    customAnalyzers?: CustomAnalyzerDeclaration[];
    thresholds: Thresholds;
    format: OutputFormat;
    /** When true, process exits non-zero if any 'error' issue is found (CI gate). */
    failOnIssue: boolean;
    /**
     * Severity threshold for the CI gate (generalization of the boolean `failOnIssue`):
     * process exits non-zero when any blocking issue (post-baseline, post-suppression) has
     * severity >= this level. `info` blocks on everything, `warning` on warnings+errors.
     * When set together with `failOnIssue`, the more specific `failOnSeverity` wins.
     */
    failOnSeverity?: Severity;
    /**
     * Whether on-disk caches may be written. Derived from the `cache` scan option (`--no-cache`
     * sets it false): a scan with caching disabled must leave no trace on disk, which includes the
     * review-memory log next to the L1/L2 cache. Default true.
     */
    cacheEnabled?: boolean;
    /**
     * Declarative, reason-carrying suppressions (applied post-scan, pre-baseline).
     * Matched issues stay in the report for auditability: downgraded via `downgradeTo`,
     * or fully suppressed (kept at original severity, excluded from gate counting).
     */
    suppressions?: SuppressionRule[];
    /** Baseline ratchet comparison granularity. Default 'id' (exact issue id, line-sensitive). */
    baselineGranularity?: 'id' | 'grouped';
    /** Declarative literal tolerance policy for function call arguments and standard patterns. */
    literalPolicy?: LiteralPolicyConfig;
    /** Optional path to a dynamic telemetry profile (JSON). */
    telemetry?: string;
    /** Loaded dynamic telemetry evidence DTO for tri-plane fusion quality synthesis. */
    telemetryData?: import('./dynamic/dynamic-types').DynamicEvidenceDTO;

    // ---- unified execution / observability controls ----
    /** Log verbosity. Default 'info'. Logs go to stderr so stdout stays machine-readable. */
    logLevel: LogLevel;
    /** Optional log file (append). When set, logs mirror there in addition to stderr. */
    logFile?: string;
    /**
     * File-level parallelism: max number of files analyzed concurrently.
     * Default = min(4, os.cpus().length). 1 = fully serial.
     */
    concurrency: number;
    /**
     * Worker-thread parallelism for the parse+analyze stage (the dominant CPU cost).
     *   0 = auto  → spawn min(os.cpus().length, 8) workers
     *   1 = in-process (single thread; also used as automatic fallback on any worker failure)
     *   N > 1     → spawn exactly N worker threads
     * Files are mutually independent, so parsing+analysis parallelizes cleanly across cores.
     * Defaults to 0 (auto). Ignored (forced in-process) when fewer than 4 files are scanned.
     */
    workers: number;
    /**
     * If true (default), respect a root-level `.gitignore` while discovering files, in addition
     * to the explicit `exclude` list. Prevents scanning generated/ignored artifacts and is both
     * a correctness and a performance win on real repositories.
     */
    respectGitignore: boolean;
    /**
     * If true, an analyzer that throws is reported as an `error`-severity Issue
     * (and therefore can fail the CI gate via `failOnIssue`). If false (default),
     * such faults are reported as `info` and never fail the build.
     */
    failOnAnalyzerError: boolean;
    /**
     * TS/JS-family parser: 'typescript' (default) or 'oxc' (Rust oxc-parser, byte-equivalent
     * normalized output — see docs/02-parsers-and-ast/02-oxc-fastpath.md). Rust files are
     * unaffected.
     */
    parser: ParserKind;
    /** Write the rendered report to this file instead of stdout (machine-readable output). */
    out?: string;
    /**
     * Line-level incremental switch (docs/03-incremental-and-diff/01-line-level-incremental.md).
     * Default OFF. The runtime gate is
     * `AR_INCREMENTAL=1` (environment wins); this field is the declarative equivalent used by
     * the daemon warm path when the env var is unset.
     */
    incremental?: boolean;
    /** Minimum file line count to attempt line-level incremental (default 1000). */
    incrementalMinLines?: number;
    /** Leveled comment audit: 'off' | 'basic' | 'standard' (default) | 'strict'. */
    commentLevel?: CommentLevel;
    /** Leveled security audit: 'off' | 'basic' (default) | 'full'. */
    securityLevel?: SecurityLevel;
    /**
     * How to report files whose extension no adapter can parse (see
     * `UnsupportedLanguageSeverity`). Default `error`: a scan never silently returns
     * zero AST findings for a language it cannot actually parse.
     */
    unsupportedLanguage?: UnsupportedLanguageSeverity;
    /**
     * Dynamic scale tuning: adjust thresholds and weights based on project scale (default true).
     */
    autoTuneScale?: boolean;
    /** Automatically detected or explicitly supplied project profile. */
    profile?: ProjectProfile;
    /** Evaluated project scale grade (micro, small, medium, large, enterprise). */
    scaleGrade?: ScaleGrade;
    /**
     * Evaluated or specified project maturity tier ('demo' | 'prototype' | 'production' |
     * 'industrial').
     */
    maturityTier?: MaturityTier;
    /** Optional AbortSignal for cooperative scan cancellation. */
    signal?: AbortSignal;
    /** Enable semantic literal classification (URLs, ports, status codes, paths, SVGs). */
    classifyLiterals?: boolean;
    /** Enable granular rule names for classified literals (literal-url, literal-port, etc.). */
    granularRules?: boolean;
    /** Enable review memory & semantic reuse (default true when caching is enabled). */
    memory?: boolean;
    /** Active Agent UID performing or commanding this scan. */
    agentUid?: string;
    /** Custom dimension weights for transparent quality scoring. */
    scoringWeights?: Record<string, number>;
    /** Explicit or auto-detected project archetype ('demo' | 'web' | 'game' | 'library'). */
    archetype?: ProjectArchetype;
    /** Whether to activate sparse rule routing based on project archetype. */
    sparseRouting?: boolean;
}

/**
 * Aggregate counts for one scan: files scanned, total issues, issues by severity, issues by
 * analyzer, and wall-clock duration in milliseconds. `disabledAnalyzers` names the built-in
 * analyzers the effective config left switched off, so a skipped rule family can never be
 * mistaken for a clean result; `warnings` carries config self-check notes such as a disabled
 * language pack while files of that language were scanned.
 */
export interface ScanSummary {
    /**
     * Cross-file symbol-index coverage for this scan, or undefined when the scan path could not
     * build one. Reviewers and agents query the index through `api.querySymbols`; the counters
     * here are the evidence that the foundation actually ran.
     */
    /** Cross-file call graph derived from the shared symbol index. */
    callGraph?: {
        callers: number;
        callees: number;
        edges: number;
        resolvedEdges: number;
        unresolvedEdges: number;
        crossFileEdges: number;
        attributedEdges: number;
        builtFrom: string;
    };
    /** Cross-file literal intelligence published by the shared traversal. */
    literalIndex?: {
        files: number;
        values: number;
        occurrences: number;
        crossFileValues: number;
        multiMeaningValues: number;
        byRole: Record<string, number>;
        builtFrom: string;
    };
    symbolIndex?: {
        /** Files whose tree contributed symbols. */
        files: number;
        /** Recorded declaration sites. */
        definitions: number;
        /** Distinct declared names. */
        definitionNames: number;
        /** Recorded call sites. */
        references: number;
        /** Call sites resolving to a declaration owned by another file. */
        crossFileReferences: number;
        /** Whether the underlying trees were materialized or lazily projected. */
        builtFrom: 'materialized' | 'projection';
    };
    /** Sparse reviewer activation decision published on the main scan path. */
    activatedReviewers?: ActivatedReviewersSummary;
    /**
     * Uncertainty metrics summarizing findings requiring runtime verification and average
     * confidence.
     */
    uncertainty?: {
        requiresRuntimeCount: number;
        averageConfidence: number;
    };
    filesScanned: number;
    issuesTotal: number;
    bySeverity: Record<Severity, number>;
    byAnalyzer: Record<string, number>;
    durationMs: number;
    /** High-precision scan duration in microseconds from process.hrtime.bigint(). */
    latencyUs?: number;
    /** Effective Agent security profile under which the scan executed. */
    agentProfile?: AgentProfileName;
    /** Ratio of actually executed analyzers against suggested routing plan. */
    appliedRatio?: number;
    /** Recorded degradation and budget fallback events during scan. */
    degraded?: Array<{ reason: string; timestamp: string }>;
    /** Expert analyzer ids skipped because mutation signals did not trigger them. */
    expertsSkippedBySignal?: string[];
    /** Built-in analyzer ids disabled by the effective config (sorted by registry order). */
    disabledAnalyzers?: string[];
    /** Config self-check notes (ineffective globs, disabled language packs, cache fallbacks). */
    warnings?: string[];
    /**
     * Findings matched by a declarative suppression. They stay in `issues` with their
     * `suppression` trail attached, and are excluded from gate counting.
     */
    suppressedCount?: number;
    /** True when a baseline file was read and per-issue `isNew` annotations were applied. */
    ratchetBaselineUsed?: boolean;
    /**
     * Post-scan passes that actually ran for this report, in execution order: `suppressions`,
     * `dependency-graph` (full scans only — cross-file facts need the complete module set) and
     * `baseline`. Incremental scans omit `dependency-graph` and say so in `warnings`.
     */
    postScanPasses?: string[];
}

/**
 * Complete scan result serialized by every reporter: tool provenance, the effective config,
 * aggregate summary, issues, per-file metrics, and optional quality-score breakdowns.
 */
export interface ScanReport {
    tool: string;
    version: string;
    generatedAt: string;
    root: string;
    config: ScanConfig;
    summary: ScanSummary;
    issues: Issue[];
    fileMetrics: FileMetric[];
    /** Overall project transparent quality scoring breakdown */
    qualityScore?: import('./scoring/scoringTypes').QualityScoreBreakdown;
    /** Per-file transparent quality scoring breakdown */
    fileQualityScores?: Record<string, import('./scoring/scoringTypes').QualityScoreBreakdown>;
    /**
     * Tri-plane unified governance quality assessment (Static Q_s, Dynamic Q_d,
     * Feedback Q_f, Fused Q_tot).
     */
    triPlaneQuality?: import('./scoring/fusion-scorer').UnifiedQualityAssessment;
    /**
     * In-house self-development ratio and code autonomy index (CAI).
     */
    autonomy?: import('./scoring/autonomy-scorer').AutonomyEvaluation;
}

export * from './scoring/scoringTypes';
export * from './memory/types';
export * from './trajectory/types';
export * from './praxis/contracts';
export type { DynamicEvidenceDTO } from './dynamic/dynamic-types';
/**
 * Diff, warm-scan and streaming contracts. Declared in ./diffTypes and re-exported here so the
 * type hub stays a single import site for consumers without carrying the declarations itself.
 */
export type {
    DiffDeltaReport,
    DiffInput,
    DiffStats,
    DiffStreamEvent,
    RefactoringPatch,
    ScanDiffOptions,
    WarmStats,
} from './diff-types';
