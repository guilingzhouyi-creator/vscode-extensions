/**
 * Module: Static Analysis — Built-in Analyzer Suite (Performance)
 * File Path: src/analyzers/performance.ts
 * Architecture Role: Analyzer adapter implementing the Analyzer contract; single-pass,
 *   line-oriented heuristic scanner over raw file content.
 * Dependencies & Triggers: Core types and `PerformanceMessages` from ../core/messages;
 *   triggered by engine analyze()/finalize() passes for every scanned source file.
 * Responsibilities: Flag loop nesting at or above `maxLoopNesting` (default 3) as
 *   PRF-ALG-001, transient allocations inside loops as PRF-MEM-001, and blocking sync I/O
 *   such as fs.readFileSync/execSync/time.sleep as PRF-IO-001.
 * Exit Semantics & Design Rationale: Returns Issue[] and never throws; checks are opt-out via
 *   PerformanceOptions. Indentation tracking for Python/GDScript and brace counting for
 *   C-like languages let one line scanner serve the polyglot file set; PRF-IO-001 is escalated
 *   to error inside async functions or _process/_physics_process/tick/render contexts.
 */
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import { PerformanceMessages } from '../core/messages';
import { globToRegExp, matchAny } from '../core/fileDiscovery';
import { detectUnboundedGrowth } from '../core/intelligence/dataFlow';

/** Default maximum loop nesting depth before PRF-ALG-001 is emitted. */
const DEFAULT_MAX_LOOP_NESTING = 3;

/** Loop nesting depth at or above which PRF-ALG-001 escalates to error severity. */
const LOOP_DEPTH_ERROR_THRESHOLD = 4;

/** ASCII code for a carriage return, used to trim CRLF line endings. */
const CHAR_CODE_CR = 13;

/** ASCII code for a space, counted as leading indentation whitespace. */
const CHAR_CODE_SPACE = 32;

/** ASCII code for a tab, counted as leading indentation whitespace. */
const CHAR_CODE_TAB = 9;

interface PerformanceOptions {
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
}

const BLOCKING_IO_PATTERNS = [
    { pattern: /\bfs\.readFileSync\s*\(/, name: 'fs.readFileSync' },
    { pattern: /\bfs\.writeFileSync\s*\(/, name: 'fs.writeFileSync' },
    { pattern: /\bfs\.appendFileSync\s*\(/, name: 'fs.appendFileSync' },
    { pattern: /\bchild_process\.execSync\s*\(/, name: 'execSync' },
    { pattern: /\bcp\.execSync\s*\(/, name: 'cp.execSync' },
    { pattern: /\btime\.sleep\s*\(/, name: 'time.sleep' },
    { pattern: /\bOS\.delay\s*\(/, name: 'OS.delay' },
    { pattern: /\bsubprocess\.(?:run|check_output|call)\s*\(/, name: 'subprocess.run' },
    { pattern: /\bos\.system\s*\(/, name: 'os.system' },
];

const LOOP_KEYWORD_RE =
    /\b(?:for\s*\(|for\s+await\s*\(|while\s*\(|for\s+[A-Za-z0-9_$]+\s+in\s+|for\s+[A-Za-z0-9_$]+\s+of\s+|while\s+[^\n:]+:|for\s+[A-Za-z0-9_$]+\s*:=\s*range\b|for\s+[^{;]+\bin\b[^{;]*\{|loop\s*\{|for\s*\{)/;

const TRANSIENT_ALLOC_RE =
    /\b(?:new\s+(?:Array|Object|Map|Set|RegExp|Buffer)|Buffer\.alloc|\[\s*\]|\{\s*\}|Vec::new|HashMap::new|vec!|Array\(\)|Dictionary\(\)|list\(\)|dict\(\)|\.new\(|\.duplicate\()\b/;

interface LoopScope {
    depth: number;
    indent: number;
    usesBrace: boolean;
}

/**
 * Detect performance hazards in one source file with a single line-oriented pass: nested loops
 * (PRF-ALG-001), transient allocations inside loops (PRF-MEM-001) and blocking synchronous I/O
 * (PRF-IO-001).
 *
 * Contract: the analyzer is stateless and synchronous; `analyze` derives all loop and
 * async-scope state from `ctx.content` per call, so repeated calls are independent and never
 * throw. Options are opt-out: `maxLoopNesting` defaults to 3, while `checkBlockingIO` and
 * `checkTransientAllocations` default to enabled. Indentation tracking serves Python and
 * GDScript, brace counting serves C-like languages, and PRF-IO-001 is escalated to error inside
 * async functions or `_process`/`_physics_process`/`tick`/`render` contexts.
 */
export class PerformanceAnalyzer implements Analyzer {
    name = 'performance' as const;

    /**
     * Analyze one source file and collect every performance issue found in its raw content.
     *
     * The pass is synchronous and self-contained: loop depth, indentation and async scope are
     * recomputed from `ctx.content` on every call, so no state leaks between files and repeated
     * calls share no mutable state. It never throws; disabled checks simply yield no issues.
     *
     * @param sf - Parsed TypeScript source file; kept for the Analyzer contract but not read,
     *             because the heuristics run over raw `ctx.content` instead of the AST.
     * @param ctx - Scan context with the normalized file path, raw text and option overrides.
     * @returns Performance issues ordered by line; severity is `info`, `warning` or `error`.
     */
    analyze(sf: import('typescript').SourceFile, ctx: AnalyzerContext): Issue[] {
        const opts = (ctx.options || {}) as PerformanceOptions;
        const maxNesting = opts.maxLoopNesting ?? DEFAULT_MAX_LOOP_NESTING;
        const checkIO = opts.checkBlockingIO !== false;
        const checkAlloc = opts.checkTransientAllocations !== false;

        const issues: Issue[] = [];
        const content = ctx.content || '';
        const len = content.length;
        const file = ctx.filePath.replace(/\\/g, '/');

        // One policy decision per file: CLI-style paths may legitimately use synchronous fs.
        const syncIoAllowPatterns = (opts.blockingIoAllowPatterns ?? []).map((g) =>
            globToRegExp(g),
        );
        const syncIoAllowlisted =
            syncIoAllowPatterns.length > 0 && matchAny(syncIoAllowPatterns, file);

        // Detect indentation-based languages (Python, GDScript) vs brace-based languages
        const isIndentBased = file.endsWith('.py') || file.endsWith('.gd');

        let lineStart = 0;
        let lineIdx = 0;
        let inAsyncFunction = false;
        let inBlockComment = false;
        const loopStack: LoopScope[] = [];

        while (lineStart < len) {
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
            const trimmed = lineText.trim();

            // Handle multiline comments (/* ... */, """ ... """)
            if (inBlockComment) {
                if (trimmed.includes('*/') || trimmed.includes('"""')) {
                    inBlockComment = false;
                }
                lineIdx++;
                lineStart = nextStart;
                continue;
            }
            if (trimmed.startsWith('/*') || (isIndentBased && trimmed.startsWith('"""'))) {
                if (!trimmed.endsWith('*/') && !trimmed.endsWith('"""')) {
                    inBlockComment = true;
                }
                lineIdx++;
                lineStart = nextStart;
                continue;
            }
            if (trimmed.startsWith('*')) {
                // JSDoc continuation line
                lineIdx++;
                lineStart = nextStart;
                continue;
            }

            if (trimmed !== '' && !trimmed.startsWith('//') && !trimmed.startsWith('#')) {
                // Calculate leading indentation whitespace
                let indent = 0;
                while (
                    indent < lineText.length &&
                    (lineText.charCodeAt(indent) === CHAR_CODE_SPACE ||
                        lineText.charCodeAt(indent) === CHAR_CODE_TAB)
                ) {
                    indent++;
                }

                // For indentation-based languages, exit loops when indent drops back
                if (isIndentBased && loopStack.length > 0) {
                    while (
                        loopStack.length > 0 &&
                        indent <= loopStack[loopStack.length - 1].indent
                    ) {
                        loopStack.pop();
                    }
                }

                // Check async scope
                if (
                    /\basync\s+(?:function|[A-Za-z0-9_$]+\s*\(|\()/.test(trimmed) ||
                    /^async\s+def\b/.test(trimmed)
                ) {
                    inAsyncFunction = true;
                }

                // Check loop start
                if (LOOP_KEYWORD_RE.test(trimmed)) {
                    const currentDepth = loopStack.length + 1;
                    loopStack.push({
                        depth: currentDepth,
                        indent,
                        usesBrace: trimmed.includes('{'),
                    });

                    if (currentDepth >= maxNesting) {
                        const desc = PerformanceMessages.NESTED_LOOP_COMPLEXITY(
                            currentDepth,
                            maxNesting,
                        );
                        issues.push(
                            this.mkIssue(
                                ctx,
                                lineIdx,
                                'PRF-ALG-001',
                                desc.message,
                                currentDepth >= LOOP_DEPTH_ERROR_THRESHOLD ? 'error' : 'warning',
                                { loopDepth: currentDepth, threshold: maxNesting },
                                desc.suggestion,
                            ),
                        );
                    }
                }

                // Check transient allocations inside loop
                if (loopStack.length > 0 && checkAlloc) {
                    if (TRANSIENT_ALLOC_RE.test(trimmed)) {
                        const desc = PerformanceMessages.TRANSIENT_LOOP_ALLOCATION(
                            loopStack.length,
                        );
                        issues.push(
                            this.mkIssue(
                                ctx,
                                lineIdx,
                                'PRF-MEM-001',
                                desc.message,
                                'info',
                                { loopDepth: loopStack.length },
                                desc.suggestion,
                            ),
                        );
                    }
                }

                // Check blocking I/O in async or game-loop routines
                if (checkIO && !syncIoAllowlisted) {
                    for (const io of BLOCKING_IO_PATTERNS) {
                        if (io.pattern.test(trimmed)) {
                            const isCriticalContext =
                                inAsyncFunction ||
                                /(_process|_physics_process|tick|render)/.test(lineText);
                            const desc = PerformanceMessages.BLOCKING_SYNC_IO(
                                io.name,
                                inAsyncFunction,
                            );
                            issues.push(
                                this.mkIssue(
                                    ctx,
                                    lineIdx,
                                    'PRF-IO-001',
                                    desc.message,
                                    isCriticalContext ? 'error' : 'warning',
                                    { api: io.name, inAsync: inAsyncFunction },
                                    desc.suggestion,
                                ),
                            );
                            break;
                        }
                    }
                }

                // For brace-based languages, decrease loop depth on closing brace
                if (!isIndentBased && trimmed.includes('}')) {
                    const closes = (trimmed.match(/\}/g) || []).length;
                    for (let c = 0; c < closes; c++) {
                        if (loopStack.length > 0) {
                            loopStack.pop();
                        }
                    }
                }
            }

            lineIdx++;
            lineStart = nextStart;
        }

        // Opt-in, like every other new capability in this engine (crossFileLiteralClusters,
        // errorPropagation, the language packs): a content-heuristic detector must not enter an
        // existing consumer's gate merely because the analyzer itself is enabled.
        if (opts.checkUnboundedGrowth === true) {
            issues.push(...detectUnboundedGrowth(ctx.filePath, content));
        }

        return issues;
    }

    /**
     * Finalize the analyzer by replaying the full content pass.
     *
     * The engine lifecycle calls `finalize` without a SourceFile, so the `sf` argument is passed
     * through as `undefined`; the method is therefore equivalent to `analyze` and inherits its
     * stateless, non-throwing, synchronous contract.
     *
     * @param ctx - Scan context with the normalized file path, raw text and option overrides.
     * @returns The same issues `analyze` returns for `ctx`, ordered by line.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined as any, ctx);
    }

    /**
     * Build a normalized Issue at a 1-based line for one performance rule.
     *
     * Centralizes id/location shaping so every rule emits the same schema; the caller supplies
     * the severity and rule-specific payload.
     *
     * @param ctx - Scan context providing the normalized file path.
     * @param lineIdx - 0-based content line index; stored as the 1-based issue line.
     * @param rule - Rule id such as PRF-ALG-001.
     * @param message - Human-readable finding text.
     * @param severity - Issue severity chosen by the rule.
     * @param detail - Rule-specific structured payload for machine consumers.
     * @param suggestion - Optional remediation hint surfaced in text output.
     * @returns The issue ready to append to the analyzer result array.
     */
    private mkIssue(
        ctx: AnalyzerContext,
        lineIdx: number,
        rule: string,
        message: string,
        severity: 'info' | 'warning' | 'error',
        detail: Record<string, any>,
        suggestion?: string,
    ): Issue {
        const line = lineIdx + 1;
        const file = ctx.filePath.replace(/\\/g, '/');
        return {
            id: `${this.name}:${rule}:${file}:${line}`,
            analyzer: this.name,
            rule,
            severity,
            message,
            location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
            detail,
            suggestion,
        };
    }
}
