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
import { detectUnboundedGrowth } from '../core/intelligence/dataFlow';

import {
    LOOP_DEPTH_ERROR_THRESHOLD,
    type PerformanceOptions,
    type PerformanceScanConfig,
    LOOP_KEYWORD_RE,
    TRANSIENT_ALLOC_RE,
    HIGH_RISK_OBJECT_ALLOC_RE,
    type LoopScope,
    type LineScanState,
    extractNextLine,
    handleComments,
    createScanConfig,
    calculateIndent,
    updateIndentLoops,
    updateBraceLoops,
    extractLinearLookupMethod,
} from './performance-helpers';

const NAME_FS_READ = 'fs.readFileSync';
const NAME_FS_WRITE = 'fs.writeFileSync';
const NAME_FS_APPEND = 'fs.appendFileSync';
const NAME_EXEC_SYNC = 'execSync';
const NAME_CP_EXEC_SYNC = 'cp.execSync';
const NAME_TIME_SLEEP = 'time.sleep';
const NAME_OS_DELAY = 'OS.delay';
const NAME_SUBPROCESS_RUN = 'subprocess.run';
const NAME_OS_SYSTEM = 'os.system';

const BLOCKING_IO_PATTERNS = [
    { pattern: /\bfs\.readFileSync\s*\(/, name: NAME_FS_READ },
    { pattern: /\bfs\.writeFileSync\s*\(/, name: NAME_FS_WRITE },
    { pattern: /\bfs\.appendFileSync\s*\(/, name: NAME_FS_APPEND },
    { pattern: /\bchild_process\.execSync\s*\(/, name: NAME_EXEC_SYNC },
    { pattern: /\bcp\.execSync\s*\(/, name: NAME_CP_EXEC_SYNC },
    { pattern: /\btime\.sleep\s*\(/, name: NAME_TIME_SLEEP },
    { pattern: /\bOS\.delay\s*\(/, name: NAME_OS_DELAY },
    { pattern: /\bsubprocess\.(?:run|check_output|call)\s*\(/, name: NAME_SUBPROCESS_RUN },
    { pattern: /\bos\.system\s*\(/, name: NAME_OS_SYSTEM },
];

const SEVERITY_WARNING = 'warning' as const;
const SEVERITY_INFO = 'info' as const;
const SEVERITY_ERROR = 'error' as const;

const RULE_PRF_ALG_001 = 'PRF-ALG-001';
const RULE_PRF_ALG_002 = 'PRF-ALG-002';
const RULE_PRF_MEM_001 = 'PRF-MEM-001';
const RULE_PRF_MEM_002 = 'PRF-MEM-002';
const RULE_PRF_IO_001 = 'PRF-IO-001';

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
    analyze(sf: import('typescript').SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        void sf;
        const opts = (ctx.options || {}) as PerformanceOptions;
        const issues: Issue[] = [];
        const content = ctx.content || '';
        const len = content.length;
        const file = ctx.filePath.replace(/\\/g, '/');

        const scanConfig = createScanConfig(opts, file);

        let lineStart = 0;
        let lineIdx = 0;
        const scanState: LineScanState = { inAsyncFunction: false, inBlockComment: false };
        const loopStack: LoopScope[] = [];

        while (lineStart < len) {
            const nextLine = extractNextLine(content, len, lineStart);
            lineStart = nextLine.nextStart;

            if (handleComments(nextLine.trimmed, scanConfig.isIndentBased, scanState)) {
                lineIdx++;
                continue;
            }

            this.scanLineContent(nextLine, lineIdx, ctx, scanConfig, scanState, loopStack, issues);

            lineIdx++;
        }

        if (opts.checkUnboundedGrowth === true) {
            issues.push(...detectUnboundedGrowth(ctx.filePath, content));
        }

        return issues;
    }

    private scanLineContent(
        nextLine: { lineText: string; trimmed: string },
        lineIdx: number,
        ctx: AnalyzerContext,
        scanConfig: PerformanceScanConfig,
        scanState: LineScanState,
        loopStack: LoopScope[],
        issues: Issue[],
    ): void {
        updateIndentLoops(nextLine.lineText, scanConfig.isIndentBased, loopStack);
        if (this.isAsyncDeclaration(nextLine.trimmed)) {
            scanState.inAsyncFunction = true;
        }

        this.checkLoopNesting(
            nextLine.trimmed,
            nextLine.lineText,
            scanConfig.maxNesting,
            lineIdx,
            ctx,
            loopStack,
            issues,
        );

        this.auditAllocations(nextLine.trimmed, lineIdx, ctx, scanConfig, loopStack, issues);
        this.auditLinearLookups(nextLine.trimmed, lineIdx, ctx, scanConfig, loopStack, issues);
        this.auditIo(nextLine.trimmed, nextLine.lineText, lineIdx, scanConfig, scanState, ctx, issues);
        this.auditBraces(nextLine.trimmed, scanConfig, loopStack);
    }

    private auditAllocations(
        trimmed: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        scanConfig: PerformanceScanConfig,
        loopStack: LoopScope[],
        issues: Issue[],
    ): void {
        if (loopStack.length > 0 && scanConfig.checkAlloc && !scanConfig.allocAllowlisted) {
            this.checkTransientAllocation(trimmed, lineIdx, ctx, loopStack.length, issues);
        }
    }

    private auditLinearLookups(
        trimmed: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        scanConfig: PerformanceScanConfig,
        loopStack: LoopScope[],
        issues: Issue[],
    ): void {
        if (
            loopStack.length > 0 &&
            scanConfig.checkLinearLookups &&
            !LOOP_KEYWORD_RE.test(trimmed)
        ) {
            this.checkLinearCollectionLookup(trimmed, lineIdx, ctx, loopStack.length, issues);
        }
    }

    private auditIo(
        trimmed: string,
        lineText: string,
        lineIdx: number,
        scanConfig: PerformanceScanConfig,
        scanState: LineScanState,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (scanConfig.checkIO && !scanConfig.syncIoAllowlisted) {
            this.checkBlockingIo(trimmed, lineText, lineIdx, scanState.inAsyncFunction, ctx, issues);
        }
    }

    private auditBraces(
        trimmed: string,
        scanConfig: PerformanceScanConfig,
        loopStack: LoopScope[],
    ): void {
        if (scanConfig.isIndentBased) return;
        updateBraceLoops(trimmed, loopStack);
        if (
            loopStack.length > 0 &&
            !loopStack[loopStack.length - 1].usesBrace &&
            trimmed.endsWith(';')
        ) {
            loopStack.pop();
        }
    }

    isAsyncDeclaration(trimmed: string): boolean {
        return (
            /\basync\s+(?:function|[A-Za-z0-9_$]+\s*\(|\()/.test(trimmed) ||
            /^async\s+def\b/.test(trimmed)
        );
    }

    checkLoopNesting(
        trimmed: string,
        lineText: string,
        maxNesting: number,
        lineIdx: number,
        ctx: AnalyzerContext,
        loopStack: LoopScope[],
        issues: Issue[],
    ): void {
        if (!LOOP_KEYWORD_RE.test(trimmed)) return;

        const indent = calculateIndent(lineText);
        const currentDepth = loopStack.length + 1;
        loopStack.push({
            depth: currentDepth,
            indent,
            usesBrace: trimmed.includes('{'),
        });

        if (currentDepth >= maxNesting) {
            const desc = PerformanceMessages.NESTED_LOOP_COMPLEXITY(currentDepth, maxNesting);
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    RULE_PRF_ALG_001,
                    desc.message,
                    currentDepth >= LOOP_DEPTH_ERROR_THRESHOLD ? SEVERITY_ERROR : SEVERITY_WARNING,
                    { loopDepth: currentDepth, threshold: maxNesting },
                    desc.suggestion,
                ),
            );
        }
    }

    checkTransientAllocation(
        trimmed: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        loopDepth: number,
        issues: Issue[],
    ): void {
        if (/^\s*throw\b|\bthrow\s+new\b/.test(trimmed)) return;
        const isHighRisk = HIGH_RISK_OBJECT_ALLOC_RE.test(trimmed);
        const isGeneralAlloc = TRANSIENT_ALLOC_RE.test(trimmed);
        if (!isHighRisk && !isGeneralAlloc) return;

        if (isHighRisk) {
            const poolDesc = PerformanceMessages.HIGH_PRESSURE_OBJECT_ALLOCATION(loopDepth);
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    RULE_PRF_MEM_002,
                    poolDesc.message,
                    SEVERITY_WARNING,
                    { loopDepth },
                    poolDesc.suggestion,
                ),
            );
        }
        if (isGeneralAlloc) {
            const desc = PerformanceMessages.TRANSIENT_LOOP_ALLOCATION(loopDepth);
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    RULE_PRF_MEM_001,
                    desc.message,
                    SEVERITY_INFO,
                    { loopDepth },
                    desc.suggestion,
                ),
            );
        }
    }

    checkBlockingIo(
        trimmed: string,
        lineText: string,
        lineIdx: number,
        inAsyncFunction: boolean,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        for (const io of BLOCKING_IO_PATTERNS) {
            if (!io.pattern.test(trimmed)) continue;

            const isCriticalContext =
                inAsyncFunction || /(_process|_physics_process|tick|render)/.test(lineText);
            const desc = PerformanceMessages.BLOCKING_SYNC_IO(io.name, inAsyncFunction);
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx,
                    RULE_PRF_IO_001,
                    desc.message,
                    isCriticalContext ? SEVERITY_ERROR : SEVERITY_WARNING,
                    { api: io.name, inAsync: inAsyncFunction },
                    desc.suggestion,
                ),
            );
            break;
        }
    }

    checkLinearCollectionLookup(
        trimmed: string,
        lineIdx: number,
        ctx: AnalyzerContext,
        loopDepth: number,
        issues: Issue[],
    ): void {
        const methodName = extractLinearLookupMethod(trimmed);
        if (!methodName) return;

        const desc = PerformanceMessages.LINEAR_COLLECTION_LOOKUP_IN_LOOP(methodName, loopDepth);
        issues.push(
            this.mkIssue(
                ctx,
                lineIdx,
                RULE_PRF_ALG_002,
                desc.message,
                SEVERITY_WARNING,
                { loopDepth, methodName },
                desc.suggestion,
            ),
        );
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
        return this.analyze(undefined, ctx);
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


