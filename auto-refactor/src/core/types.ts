import type * as ts from 'typescript';
import { NormalizedNode, LanguageAdapter, Position } from './multilang';
import type { IncrementalFileState } from './incrementalState';
import { EditRange } from './editDiff';

// Re-exported for backward compatibility (utils/ast and other modules import Position here).
export { Position } from './multilang';
// EditRange is produced by editDiff.ts (ts-free) and consumed by the diff API (types below).
export { EditRange } from './editDiff';

/** Severity levels; map to CI/SARIF levels (info->note, warning->warning, error->error). */
export type Severity = 'info' | 'warning' | 'error';

/** Analyzer identifiers are open strings (built-in names + any custom-registered name). */
export type AnalyzerId = string;

export interface IssueLocation {
  /** Relative file path (as scanned) */
  file: string;
  start: Position;
  end: Position;
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
  /** Rule within the analyzer, e.g. "magic-number" | "hardcoded-string" | "duplicate-literal" | "large-file" | "high-complexity" */
  rule: string;
  severity: Severity;
  message: string;
  location: IssueLocation;
  /** Analyzer-specific structured payload (values, counts, metrics, names...). */
  detail: Record<string, any>;
  /** Optional refactoring suggestion text. */
  suggestion?: string;
}

export interface FileMetric {
  file: string;
  lines: number;
  nonBlankLines: number;
  functions: number;
  maxNestingDepth: number;
  topLevelDeclarations: number;
  exportedSymbols: number;
}

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
}

export type OutputFormat = 'json' | 'sarif' | 'text';

/**
 * TS/JS-family parser selection. 'typescript' is the default (historical `ts.createSourceFile`
 * path); 'oxc' uses the Rust `oxc-parser` engine (byte-equivalent normalized output — see
 * docs/oxc-feasibility.md). Non-TS/JS languages (Rust) are unaffected by this option.
 */
export type ParserKind = 'typescript' | 'oxc';

import { LogLevel } from './logger';
export { LogLevel };

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
 * The single contract every analyzer (built-in or external) implements.
 *
 * **Unifying abstraction of the toolchain**: anything expressible as
 * `analyze(sourceFile, ctx) -> Issue[]` is in scope; anything needing a different
 * input (manifest, lockfile, network, runtime) is out of scope for this contract.
 */
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
   * P0-3: line statistics (lines / nonBlankLines), computed ONCE per file by the engine
   * and shared by every consumer (FileMetricCollector + large-file analyzer), replacing
   * per-analyzer `content.split` calls. Absent when the context was built outside the
   * engine pipeline (e.g. direct `analyze()` calls) — consumers fall back to splitting.
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
   * Line-level incremental state (T03). Present ONLY on the in-process incremental path
   * (a big-file small-change rescan seeded with the previous scan's subtree/memo caches).
   * Absent for the normal cold / worker / standalone paths, where analyzers behave exactly
   * as before. Never changes output bytes — it is a pure performance hint.
   */
  incremental?: IncrementalFileState;
}

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
   * normalized output — see docs/oxc-feasibility.md). Rust files are unaffected.
   */
  parser: ParserKind;
  /** Write the rendered report to this file instead of stdout (machine-readable output). */
  out?: string;
  /**
   * Line-level incremental switch (docs/system-design.md). Default OFF. The runtime gate is
   * `AR_INCREMENTAL=1` (environment wins); this field is the declarative equivalent used by
   * the daemon warm path when the env var is unset.
   */
  incremental?: boolean;
  /** Minimum file line count to attempt line-level incremental (default 1000). */
  incrementalMinLines?: number;
}

export interface ScanReport {
  tool: string;
  /** Tool version (mirrors package.json). */
  version: string;
  generatedAt: string;
  root: string;
  config: ScanConfig;
  summary: {
    filesScanned: number;
    issuesTotal: number;
    bySeverity: Record<Severity, number>;
    byAnalyzer: Record<string, number>;
    /** Wall-clock duration of the scan in milliseconds. */
    durationMs: number;
  };
  issues: Issue[];
  fileMetrics: FileMetric[];
}

/**
 * Warm-scan statistics (docs/warm-scan-design.md §A2.2). Deliberately NOT part of ScanReport —
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
 * A single changed file fed to `scanDiff` / `scanDiffDelta` (docs/diff-interface-spec.md §1.2).
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
 * Diff-scan statistics (docs/diff-interface-spec.md §1.3). Deliberately NOT part of any
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
 * `scanDiffDelta` report — the changed-file SUBSET of a full scan (docs/diff-interface-spec.md
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
  };
  issues: Issue[];
  fileMetrics: FileMetric[];
}
