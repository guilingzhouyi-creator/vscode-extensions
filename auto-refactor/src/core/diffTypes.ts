/**
 * Module: Core Engine — Diff, Warm-Scan and Streaming Contracts
 * File Path: src/core/diffTypes.ts
 * Architecture Role: Canonical declarations for the incremental/diff surface: scan options,
 *   refactoring patches, stream events, warm/diff statistics and the delta report.
 * Dependencies & Triggers: type-only imports from ./types, ./logger, ./editDiff and
 *   ./praxis/contracts; re-exported by ./types so existing import sites keep working.
 * Responsibilities: Define ScanDiffOptions, RefactoringPatch, DiffStreamEvent, WarmStats,
 *   DiffInput, DiffStats and DiffDeltaReport.
 * Exit Semantics & Design Rationale: Every import is `import type`, so the emitted module only
 *   carries the contract-token constants the unions above are derived from and the ./types
 *   barrel stays free of a runtime cycle. Split out of types.ts to keep that hub below the
 *   large-file fail threshold of the engine itself; the barrel re-exports the types, so
 *   existing import sites keep working while the tokens have exactly one definition site.
 */
import type {
    DAEMON_MODE_OFF,
    FileMetric,
    Issue,
    MaturityTier,
    OutputFormat,
    ParserKind,
    ScanConfig,
    ScanSummary,
    SecurityLevel,
    Severity,
} from './types';
import type { LogLevel } from './logger';
import type { EditRange } from './editDiff';
import type { PraxisPluginHooks, ReviewDiffHunk } from './praxis/contracts';
import type { ModuleDependencyGraph } from './dependencyGraph';

/** Daemon mode that probes an existing daemon; `'off'` stays in DAEMON_MODE_OFF. */
export const DAEMON_MODE_AUTO = 'auto';
/** Daemon mode that starts a daemon when none is running. */
export const DAEMON_MODE_ON = 'on';
/** Baseline granularity token comparing exact issue ids. */
export const GRANULARITY_ID = 'id';
/** Baseline granularity token comparing per-(analyzer|rule|file) counts. */
export const GRANULARITY_GROUPED = 'grouped';
/** Streaming mode emitting every event. */
export const STREAM_MODE_FULL = 'full';
/** Streaming mode emitting findings only. */
export const STREAM_MODE_ISSUES_ONLY = 'issues_only';
/** Streaming mode emitting the final summary only. */
export const STREAM_MODE_SUMMARY_ONLY = 'summary_only';
/** Streaming mode emitting nothing (batch scan semantics). */
export const STREAM_MODE_DISABLED = 'disabled';
/** Diff-stream event tag: a file scan started. */
export const EVENT_FILE_START = 'file_start';
/** Diff-stream event tag: a hunk is ready for review. */
export const EVENT_HUNK_READY = 'hunk_ready';
/** Diff-stream event tag: a finding was produced. */
export const EVENT_ISSUE_FOUND = 'issue_found';
/** Diff-stream event tag: a file finished with per-file stats. */
export const EVENT_FILE_DONE = 'file_done';
/** Diff-stream event tag: the stream ended with the total summary. */
export const EVENT_STREAM_END = 'stream_end';
/** Diff input discriminant carrying both old and new content. */
export const DIFF_KIND_FULL = 'full';
/** Diff input discriminant carrying edit ranges instead of the old content. */
export const DIFF_KIND_RANGES = 'ranges'; /**
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
    daemon?: typeof DAEMON_MODE_AUTO | typeof DAEMON_MODE_ON | typeof DAEMON_MODE_OFF;
    parser?: ParserKind;
    verifyDiskContent?: boolean;
    /** Path to baseline.json for ratchet comparison; mirrors ScanOptions so diff modes carry
     * the same post-scan semantics as a full scan (suppressions + baseline annotations). */
    baseline?: string;
    /** Save current findings into a new baseline.json (grouped by default). */
    updateBaseline?: string;
    /** Baseline ratchet comparison granularity: id (exact issue id) | grouped. */
    baselineGranularity?: typeof GRANULARITY_ID | typeof GRANULARITY_GROUPED;
    praxisHooks?: PraxisPluginHooks;
    /** Optional module dependency graph for cross-file impact analysis. */
    dependencyGraph?: ModuleDependencyGraph;
    /**
     * Streaming control mode: 'full' | 'issues_only' | 'summary_only' | 'disabled' (default 'full')
     */
    streamingMode?:
        | typeof STREAM_MODE_FULL
        | typeof STREAM_MODE_ISSUES_ONLY
        | typeof STREAM_MODE_SUMMARY_ONLY
        | typeof STREAM_MODE_DISABLED;
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
    | { type: typeof EVENT_FILE_START; filePath: string; oldHash?: string; newHash?: string }
    | { type: typeof EVENT_HUNK_READY; filePath: string; hunk: ReviewDiffHunk }
    | { type: typeof EVENT_ISSUE_FOUND; filePath: string; issue: Issue; fix?: RefactoringPatch }
    | {
          type: typeof EVENT_FILE_DONE;
          filePath: string;
          stats: { durationMs: number; issuesCount: number };
      }
    | { type: typeof EVENT_STREAM_END; totalSummary: ScanSummary };

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
          kind: typeof DIFF_KIND_FULL;
          /** Relative-to-root POSIX path (same convention as `collectFiles`, '/'-separated). */
          filePath: string;
          oldContent: string;
          newContent: string;
          oldContentHash?: string;
          newContentHash?: string;
      }
    | {
          kind: typeof DIFF_KIND_RANGES;
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
