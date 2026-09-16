import type * as ts from 'typescript';
import type { NormalizedNode, LanguageAdapter, Position } from './multilang';
import type { IncrementalFileState } from './incrementalState';
import type { EditRange } from './editDiff';

/**
 * Module: Core Engine — Shared Type Contracts and Domain Model
 * File Path: src/core/types.ts
 * Architecture Role: compile-time single source of truth for the data contracts crossing the
 *   engine, analyzers, CLI, daemon, reporters, diff stream, and plug-in boundary.
 * Dependencies & Triggers: imports TypeScript's SourceFile type plus NormalizedNode /
 *   LanguageAdapter / Position from ./multilang, IncrementalFileState from
 *   ./incrementalState, EditRange from ./editDiff, and LogLevel from ./logger; re-exports
 *   Position, EditRange, and LogLevel plus the scoring, memory, trajectory, and Praxis type
 *   surfaces. Imported by analyzers, core modules, CLI/daemon code, and the api.ts barrel.
 * Responsibilities: define the canonical Issue / IssueLocation / FileMetric records;
 *   threshold, output, comment, security, scale, maturity, and suppression knobs; Analyzer,
 *   AnalyzerContext, VisitFrame, and streaming visit/finalize contracts; AnalyzerDeclaration
 *   and CustomAnalyzerDeclaration registration; ScanConfig / ScanSummary / ScanReport;
 *   RefactoringPatch, ScanDiffOptions, DiffInput, DiffStreamEvent, WarmStats, DiffStats, and
 *   DiffDeltaReport for the diff API.
 * Exit Semantics & Design Rationale: this module performs no scanning or control flow; apart
 *   from re-export bindings it is erased at compile time, so importing it has no per-file
 *   cost. Keeping these declarations centralized prevents producer/consumer drift against
 *   report.schema.json and lets implementation modules stay free of cross-cutting imports.
 */

// Re-exported for backward compatibility (utils/ast and other modules import Position here).
export { Position } from './multilang';
// EditRange is produced by editDiff.ts (ts-free) and consumed by the diff API (types below).
export { EditRange } from './editDiff';

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

/**
 * Uncertainty and empirical evidence metadata attached to an issue finding.
 * Allows downstream reviewers/agents/CI to distinguish mathematically proven
 * static bugs from probabilistic or runtime-dependent warnings.
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
 * `id` is stable within a run: `${analyzer}:${rule}:${file}:${line}`.
 * `detail` carries machine-readable payloads for CI / code-review integration.
 */
export interface Issue {
    /** Stable id, unique within a run: `${analyzer}:${rule}:${file}:${line}` */
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
    // complexity
    complexityWarn: number;
    complexityFail: number;
    // simplify
    /** Functions longer than this many lines raise `long-function` (SIM-LONG-001). */
    maxFunctionLines: number;
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
export type ProjectArchetype = 'demo' | 'web' | 'game' | 'library';

/**
 * Summary of sparse reviewer activation published in ScanSummary.
 */
export interface ActivatedReviewersSummary {
    archetype: ProjectArchetype;
    active: string[];
    skipped: string[];
    activationRatio: number;
    reason: string;
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
    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[];
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
    /** Built-in analyzer ids disabled by the effective config (sorted by registry order). */
    disabledAnalyzers?: string[];
    /** Config self-check notes (ineffective globs, disabled language packs, cache fallbacks). */
    warnings?: string[];
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
}

export * from './scoring/scoringTypes';
export * from './memory/types';
export * from './trajectory/types';
import type { PraxisPluginHooks, ReviewDiffHunk } from './praxis/contracts';
export * from './praxis/contracts';
/**
 * Options accepted by scanDiff and scanDiffDelta: the ScanOptions subset plus diff-specific
 * controls for disk verification, Praxis hooks, dependency graph, streaming, and memory.
 */
export interface ScanDiffOptions {
    root?: string;
    configFile?: string;
    format?: OutputFormat;
    analyzers?: string[];
    failOnIssue?: boolean;
    include?: string[];
    exclude?: string[];
    logLevel?: LogLevel;
    logFile?: string;
    concurrency?: number;
    workers?: number;
    respectGitignore?: boolean;
    failOnAnalyzerError?: boolean;
    cache?: boolean;
    cacheDir?: string;
    cacheCustom?: boolean;
    daemon?: 'auto' | 'on' | typeof DAEMON_MODE_OFF;
    parser?: ParserKind;
    verifyDiskContent?: boolean;
    /** Path to baseline.json for ratchet comparison; mirrors ScanOptions so diff modes carry
     * the same post-scan semantics as a full scan (suppressions + baseline annotations). */
    baseline?: string;
    /** Save current findings into a new baseline.json (grouped by default). */
    updateBaseline?: string;
    /** Baseline ratchet comparison granularity: id (exact issue id) | grouped. */
    baselineGranularity?: 'id' | 'grouped';
    praxisHooks?: PraxisPluginHooks;
    /** Optional module dependency graph for cross-file impact analysis */
    dependencyGraph?: any;
    /**
     * Streaming control mode: 'full' | 'issues_only' | 'summary_only' | 'disabled' (default 'full')
     */
    streamingMode?: 'full' | 'issues_only' | 'summary_only' | 'disabled';
    /** Max streaming events before rate-limiting suppression (default unlimited) */
    maxStreamEvents?: number;
    /** Toggle emitting individual hunk events (default true) */
    emitHunks?: boolean;
    /** Active Agent UID performing or commanding this scan. */
    agentUid?: string;
    /** Enable review memory & semantic reuse (default true when caching is enabled). */
    memory?: boolean;
    /** Leveled security audit: 'off' | 'basic' (default) | 'full'. */
    securityLevel?: SecurityLevel;
    /**
     * Evaluated or specified project maturity tier ('demo' | 'prototype' | 'production' |
     * 'industrial').
     */
    maturityTier?: MaturityTier;
    /** Optional AbortSignal for cooperative cancellation. */
    signal?: AbortSignal;
}

/**
 * Self-contained refactoring proposal: the originating rule, a human-readable title, concrete
 * text edits with line/column ranges, and an optional ready-to-apply unified patch.
 */
export interface RefactoringPatch {
    ruleId: string;
    title: string;
    edits: Array<{
        range: { startLine: number; startCol: number; endLine: number; endCol: number };
        newText: string;
    }>;
    unifiedPatch?: string;
}

/**
 * Discriminated union of diff-stream events: file start, hunk ready, issue found (with an
 * optional fix), file done with per-file stats, and stream end with the total summary.
 */
export type DiffStreamEvent =
    | { type: 'file_start'; filePath: string; oldHash?: string; newHash?: string }
    | { type: 'hunk_ready'; filePath: string; hunk: ReviewDiffHunk }
    | { type: 'issue_found'; filePath: string; issue: Issue; fix?: RefactoringPatch }
    | { type: 'file_done'; filePath: string; stats: { durationMs: number; issuesCount: number } }
    | { type: 'stream_end'; totalSummary: ScanSummary };

/**
 * Warm-scan statistics (docs/01-architecture/02-pipeline-and-caching.md §A2.2). Deliberately NOT
 * part of ScanReport —
 * stats are returned as a sibling field of scanWarm() so the report bytes stay identical
 * between cold and warm paths.
 */
export interface WarmStats {
    /** Whether the scan actually ran through the daemon (false ⇒ degraded to cold). */
    daemonUsed: boolean;
    /** L1 hits (file unchanged + session result reused, 0 reads). */
    l1Hit: number;
    /** L2 hits (content hash matched → cached issues/metric reused). */
    l2Hit: number;
    /** Files whose results came from any cache (L1+L2). */
    cacheHit: number;
    /** Files discovered. */
    cacheTotal: number;
    /** Files actually parsed+analyzed this scan. */
    analyzed: number;
    /** Whether the daemon worker pool was warm (hybrid startup disabled). */
    poolWarm: boolean;
    /** Wall-clock time spent inside the daemon (0 for degraded cold scans). */
    daemonMs: number;
    /** Files analyzed via the line-level incremental path this scan (0 when disabled). */
    incrementalFiles: number;
    /** Function-subtree reuse hits across incremental files this scan (0 when disabled). */
    incrementalHit: number;
}

/**
 * A single changed file fed to `scanDiff` / `scanDiffDelta`
 * (docs/03-incremental-and-diff/02-diff-interface-spec.md §1.2).
 * Discriminated union: `kind:'full'` supplies both old+new content (Myers runs internally);
 * `kind:'ranges'` supplies the new content plus the diff system's edit ranges (Myers skipped).
 * For `kind:'ranges'`, the three byte fields are UTF-8 byte offsets into the NEW content's
 * raw byte stream; the entry point converts them to UTF-16 code-unit offsets (src/core/utf8.ts).
 * Content fields accept a `string`; a `Buffer` may be passed at the API boundary and is decoded
 * with `buf.toString('utf8')` (BOM preserved) before reaching the engine.
 */
export type DiffInput =
    | {
          kind: 'full';
          /** Relative-to-root POSIX path (same convention as `collectFiles`, '/'-separated). */
          filePath: string;
          oldContent: string;
          newContent: string;
          oldContentHash?: string;
          newContentHash?: string;
      }
    | {
          kind: 'ranges';
          filePath: string;
          newContent: string;
          /** startByte/oldEndByte/newEndByte are UTF-8 byte offsets (converted at entry). */
          editRanges: EditRange[];
          /** Optional; a resident daemon state may supply the previous content instead. */
          oldContent?: string;
          oldContentHash?: string;
          newContentHash?: string;
      };

/**
 * Diff-scan statistics (docs/03-incremental-and-diff/02-diff-interface-spec.md §1.3). Deliberately
 * NOT part of any
 * report — a sibling field of `scanDiff`/`scanDiffDelta` so report bytes never change.
 */
export interface DiffStats extends WarmStats {
    /** Diff inputs that actually participated (deduped + filtered to discovered files). */
    diffFiles: number;
    /** Diff inputs dropped (illegal path / not discovered / non-source extension). */
    diffIgnored: number;
    /** Changed files short-circuited as no-op (old===new or empty editRanges). */
    byteEqual: number;
    /** Changed files routed through the line-level incremental path. */
    diffIncremental: number;
    /** Changed files that fell back to a full rescan. */
    diffFull: number;
    /** `kind:'ranges'` inputs (Myers skipped). */
    rangesProvided: number;
    /** `kind:'ranges'` inputs that fell back to full (no state / no oldContent / invalid). */
    rangesFallback: number;
    /** `kind:'ranges'` inputs whose oldContent came from the resident daemon state. */
    oldContentFromDaemon: number;
}

/**
 * `scanDiffDelta` report — the changed-file SUBSET of a full scan
 * (docs/03-incremental-and-diff/02-diff-interface-spec.md
 * §1.5). Not byte-equivalent to a cold scan by itself (it is a subset); its contract is
 * `delta.report ≡ filter(scanDiff.report, changed-file set)` per issue/metric, in the same
 * relative order.
 */
export interface DiffDeltaReport {
    tool: string;
    version: string;
    generatedAt: string;
    root: string;
    config: ScanConfig;
    summary: {
        filesScanned: number;
        issuesTotal: number;
        bySeverity: Record<Severity, number>;
        byAnalyzer: Record<string, number>;
        durationMs: number;
        suppressedCount?: number;
        warnings?: string[];
        postScanPasses?: string[];
    };
    issues: Issue[];
    fileMetrics: FileMetric[];
}
