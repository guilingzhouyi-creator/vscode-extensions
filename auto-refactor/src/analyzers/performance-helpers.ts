/**
 * Module: Static Analysis — Performance Analyzer Helpers & Types
 * File Path: src/analyzers/performance-helpers.ts
 * Architecture Role: Supporting constants, regex patterns, and scan context state
 *   types extracted from PerformanceAnalyzer to maintain single-responsibility and
 *   keep physical file length strictly under the 400-line budget.
 * Dependencies & Triggers: Consumed exclusively by performance.ts during source code
 *   scanning passes.
 * Responsibilities: Declare regex matchers for loops, transient allocations, synchronous I/O,
 *   and provide line extraction and comment handling helper routines.
 * Exit Semantics & Design Rationale: Pure constants, types, and stateless scanning functions;
 *   no side effects or mutable module state.
 */
import { globToRegExp, matchAny } from '../core/file-discovery';

/** Default maximum loop nesting depth before PRF-ALG-001 is emitted. */
export const DEFAULT_MAX_LOOP_NESTING = 3;

/** Loop nesting depth at or above which PRF-ALG-001 escalates to error severity. */
export const LOOP_DEPTH_ERROR_THRESHOLD = 4;

/** ASCII code for a carriage return, used to trim CRLF line endings. */
export const CHAR_CODE_CR = 13;

/** ASCII code for a space, counted as leading indentation whitespace. */
export const CHAR_CODE_SPACE = 32;

/** ASCII code for a tab, counted as leading indentation whitespace. */
export const CHAR_CODE_TAB = 9;

/**
 * Configuration options for tuning loop nesting, blocking I/O, and allocation checks.
 */
export interface PerformanceOptions {
    maxLoopNesting?: number;
    checkBlockingIO?: boolean;
    checkTransientAllocations?: boolean;
    /** Opt-in check for unbounded memory growth leaks in loops and timers (PRF-LEAK-001). */
    checkUnboundedGrowth?: boolean;
    /**
     * Path globs whose synchronous I/O is a documented policy (CLI entry points, validation and
     * benchmark harnesses are synchronous by design). Shared with the governance rule GOV-PRF-004
     * through the global `thresholds` layer, so one policy key silences both without muting the
     * analyzers elsewhere.
     */
    blockingIoAllowPatterns?: string[];
    /**
     * Path globs whose transient allocation is by design (scripts, test harnesses,
     * profiling tools).
     */
    allocationAllowPatterns?: string[];
}

/**
 * Regex pattern matching loop construct keywords across polyglot source languages.
 */
export const LOOP_KEYWORD_RE =
    /\b(?:for\s*\(|for\s+await\s*\(|while\s*\(|for\s+[A-Za-z0-9_$]+\s+in\s+|for\s+[A-Za-z0-9_$]+\s+of\s+|while\s+[^\n:]+:|for\s+[A-Za-z0-9_$]+\s*:=\s*range\b|for\s+[^{;]+\bin\b[^{;]*\{|loop\s*\{|for\s*\{)/;

/**
 * General transient allocations in loop: temporary buffers, arrays, slices (PRF-MEM-001).
 */
export const TRANSIENT_ALLOC_RE =
    /\b(?:new\s+(?:Array|Object|Map|Set|RegExp|Buffer)|Buffer\.alloc|\[\s*\]|\{\s*\}|Vec::new|HashMap::new|vec!|Array\(\)|Dictionary\(\)|list\(\)|dict\(\)|\.new\(|\.duplicate\()\b/;

/**
 * High-pressure class instantiations and deep copies violating object pooling contracts
 * (PRF-MEM-002 / ADV-PRF-002).
 */
export const HIGH_RISK_OBJECT_ALLOC_RE =
    /(?:\bnew\s+(?!(?:Error|TypeError|RangeError|SyntaxError|Map|Set|RegExp|Date|Worker|Promise|Int8Array|Uint8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array)\b)[A-Z][A-Za-z0-9_$]*|\.new\s*\(|\.duplicate\s*\(\s*true\s*\)|copy\.deepcopy\s*\()/;

/**
 * Represents an active loop frame in the lexical nesting stack.
 */
export interface LoopScope {
    depth: number;
    indent: number;
    usesBrace: boolean;
}

/**
 * Mutable state tracking asynchronous routines and block comments across lines.
 */
export interface LineScanState {
    inAsyncFunction: boolean;
    inBlockComment: boolean;
}

/**
 * Extracts the next logical line from raw source text while normalizing line endings.
 *
 * @param content - Full file source text.
 * @param len - Length of content string.
 * @param lineStart - 0-based character index where the line begins.
 * @returns Structured slice with original line text, trimmed content, and next start index.
 */
export function extractNextLine(
    content: string,
    len: number,
    lineStart: number,
): { lineText: string; trimmed: string; nextStart: number } {
    let lineEnd = content.indexOf('\n', lineStart);
    let nextStart: number;
    if (lineEnd === -1) {
        lineEnd = len;
        nextStart = len;
    } else {
        nextStart = lineEnd + 1;
        if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === CHAR_CODE_CR) {
            lineEnd--;
        }
    }
    const lineText = content.slice(lineStart, lineEnd);
    return { lineText, trimmed: lineText.trim(), nextStart };
}

const SKIP_LINE_RE = /^(?:\s*$|\/\/|#|\*)/;

/**
 * Filters comment lines and updates block-comment state across C-style and Python/GDScript sources.
 *
 * @param trimmed - Line text trimmed of leading/trailing whitespace.
 * @param isIndentBased - Whether the scanned language uses indentation scopes (.py/.gd).
 * @param state - Mutable scan state tracking block-comment flags.
 * @returns True if the line is a comment or blank line and should be skipped.
 */
export function handleComments(
    trimmed: string,
    isIndentBased: boolean,
    state: LineScanState,
): boolean {
    if (state.inBlockComment) {
        if (trimmed.includes('*/') || trimmed.includes('"""')) {
            state.inBlockComment = false;
        }
        return true;
    }
    const isBlockStart = trimmed.startsWith('/*') || (isIndentBased && trimmed.startsWith('"""'));
    if (isBlockStart) {
        if (!trimmed.endsWith('*/') && !trimmed.endsWith('"""')) {
            state.inBlockComment = true;
        }
        return true;
    }
    return SKIP_LINE_RE.test(trimmed);
}

/**
 * Normalized runtime configuration driving the performance single-pass scan.
 */
export interface PerformanceScanConfig {
    maxNesting: number;
    checkAlloc: boolean;
    checkIO: boolean;
    syncIoAllowlisted: boolean;
    allocAllowlisted: boolean;
    isIndentBased: boolean;
}

/**
 * Builds normalized scan configuration from analyzer context options and file extension.
 *
 * @param opts - Performance options supplied by user configuration.
 * @param file - Normalized POSIX file path.
 * @returns Fully populated PerformanceScanConfig struct.
 */
export function createScanConfig(opts: PerformanceOptions, file: string): PerformanceScanConfig {
    const maxNesting = opts.maxLoopNesting ?? DEFAULT_MAX_LOOP_NESTING;
    const checkIO = opts.checkBlockingIO !== false;
    const checkAlloc = opts.checkTransientAllocations !== false;

    const syncIoAllowPatterns = (opts.blockingIoAllowPatterns ?? []).map((g) => globToRegExp(g));
    const syncIoAllowlisted = syncIoAllowPatterns.length > 0 && matchAny(syncIoAllowPatterns, file);

    const allocAllowPatterns = (opts.allocationAllowPatterns ?? []).map((g) => globToRegExp(g));
    const allocAllowlisted = allocAllowPatterns.length > 0 && matchAny(allocAllowPatterns, file);

    const isIndentBased = file.endsWith('.py') || file.endsWith('.gd');

    return {
        maxNesting,
        checkAlloc,
        checkIO,
        syncIoAllowlisted,
        allocAllowlisted,
        isIndentBased,
    };
}
