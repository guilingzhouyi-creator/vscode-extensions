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
import type { Analyzer, AnalyzerContext, Issue, AgentActionType } from '../core/types';
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
import { attachActionableMetadata, createLineIssue } from '../core/rules/diagnostic-catalog';

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

const PRF_ACTIONABLE_MAP: Record<
    string,
    { action: AgentActionType; code: string; safeToAutomate: boolean; templateSnippet: string }
> = {
    'loop-transient-allocation': {
        action: 'hoist_declaration',
        code: 'AR:PRF:001',
        safeToAutomate: false,
        templateSnippet:
            'const scratch = []; // hoist allocation outside loop\nfor (...) { scratch.length = 0; }',
    },
    'PRF-MEM-001': {
        action: 'hoist_declaration',
        code: 'AR:PRF:001',
        safeToAutomate: false,
        templateSnippet:
            'const scratch = []; // hoist allocation outside loop\nfor (...) { scratch.length = 0; }',
    },
    'PRF-MEM-002': {
        action: 'hoist_declaration',
        code: 'AR:PRF:001',
        safeToAutomate: false,
        templateSnippet:
            'const scratch = []; // hoist allocation outside loop\nfor (...) { scratch.length = 0; }',
    },
    'expensive-loop-operation': {
        action: 'hoist_declaration',
        code: 'AR:PRF:002',
        safeToAutomate: false,
        templateSnippet:
            'const cachedValue = computeExpensive();\nfor (...) { /* use cachedValue */ }',
    },
    'regex-in-loop': {
        action: 'hoist_declaration',
        code: 'AR:PRF:003',
        safeToAutomate: false,
        templateSnippet: 'const PATTERN = /.../;\nfor (...) { PATTERN.test(...); }',
    },
    'PRF-ALG-002': {
        action: 'hoist_declaration',
        code: 'AR:PRF:004',
        safeToAutomate: false,
        templateSnippet:
            '// Pre-build index or use index cursor instead of linear lookup/shift\nconst indexMap = new Map();',
    },
};

/** One physical source line as produced by `extractNextLine`, minus the cursor. */
interface ScannedLine {
    readonly lineText: string;
    readonly trimmed: string;
}

/**
 * Per-file invariants threaded through every stage of one line-oriented audit pass.
 *
 * Bundling them gives each stage a single handle instead of five positional arguments. The
 * object holds references to the caller's mutable `scanState`, `loopStack` and `issues`, so
 * every stage still mutates the same instances and the pass stays behaviourally identical.
 */
interface ScanPassContext {
    readonly ctx: AnalyzerContext;
    readonly scanConfig: PerformanceScanConfig;
    readonly scanState: LineScanState;
    readonly loopStack: LoopScope[];
    readonly issues: Issue[];
}

/**
 * Rule id, finding text, severity and payload for one emitted performance issue.
 *
 * `rule` and `message` are both strings and were previously adjacent positional arguments,
 * so swapping them produced a wrong id without any compile error; naming them removes that
 * class of mistake.
 */
interface PerformanceFinding {
    readonly rule: string;
    readonly message: string;
    readonly severity: 'info' | 'warning' | 'error';
    readonly detail: Record<string, any>;
    readonly suggestion?: string;
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

    public resetState(): void {
        // Stateless performance line-scanner - safe for pool reuse
    }

    /**
     * Analyze one source file and collect every performance issue found in its raw content.
     *
     * The pass is synchronous and self-contained: loop depth, indentation and async scope are
     * recomputed from `ctx.content` on every call, so no state leaks between files and repeated
     * calls share no mutable state. It never throws; disabled checks simply yield no issues.
     *
     * @param sourceFile - Parsed TypeScript source file; kept for the Analyzer contract
     *   but not read,
     *             because the heuristics run over raw `ctx.content` instead of the AST.
     * @param ctx - Scan context with the normalized file path, raw text and option overrides.
     * @returns Performance issues ordered by line; severity is `info`, `warning` or `error`.
     */
    analyze(
        sourceFile: import('typescript').SourceFile | undefined,
        ctx: AnalyzerContext,
    ): Issue[] {
        void sourceFile;
        const opts = (ctx.options || {}) as PerformanceOptions;
        const issues: Issue[] = [];
        const content = ctx.content || '';
        const len = content.length;
        const file = ctx.filePath.replace(/\\/g, '/');

        const scanConfig = createScanConfig(opts, file);

        let lineStart = 0;
        let lineIdx = 0;
        const scanState: LineScanState = {
            inAsyncFunction: false,
            inBlockComment: false,
            asyncBraceDepth: 0,
            asyncIndent: -1,
        };
        const loopStack: LoopScope[] = [];
        const pass: ScanPassContext = { ctx, scanConfig, scanState, loopStack, issues };

        while (lineStart < len) {
            const nextLine = extractNextLine(content, len, lineStart);
            lineStart = nextLine.nextStart;

            if (handleComments(nextLine.trimmed, scanConfig.isIndentBased, scanState)) {
                lineIdx++;
                continue;
            }

            this.scanLineContent(pass, nextLine, lineIdx);

            lineIdx++;
        }

        if (opts.checkUnboundedGrowth === true) {
            issues.push(...detectUnboundedGrowth(ctx.filePath, content));
        }

        attachActionableMetadata(issues, PRF_ACTIONABLE_MAP);

        return issues;
    }

    private scanLineContent(pass: ScanPassContext, nextLine: ScannedLine, lineIdx: number): void {
        const { scanConfig, scanState, loopStack } = pass;
        updateIndentLoops(nextLine.lineText, scanConfig.isIndentBased, loopStack);
        if (
            scanConfig.isIndentBased &&
            scanState.inAsyncFunction &&
            nextLine.trimmed !== '' &&
            calculateIndent(nextLine.lineText) <= scanState.asyncIndent &&
            !this.isAsyncDeclaration(nextLine.trimmed)
        ) {
            scanState.inAsyncFunction = false;
            scanState.asyncIndent = -1;
        }
        if (this.isAsyncDeclaration(nextLine.trimmed)) {
            scanState.inAsyncFunction = true;
            scanState.asyncBraceDepth = 0;
            scanState.asyncIndent = calculateIndent(nextLine.lineText);
        }

        this.checkLoopNesting(pass, nextLine, lineIdx);
        this.auditAllocations(pass, nextLine.trimmed, lineIdx);
        this.auditLinearLookups(pass, nextLine.trimmed, lineIdx);
        this.auditIo(pass, nextLine, lineIdx);
        this.auditBraces(pass, nextLine.trimmed);
    }

    private auditAllocations(pass: ScanPassContext, trimmed: string, lineIdx: number): void {
        const { scanConfig, loopStack } = pass;
        if (
            loopStack.length > 0 &&
            scanConfig.checkAlloc &&
            !scanConfig.allocAllowlisted &&
            !LOOP_KEYWORD_RE.test(trimmed)
        ) {
            this.checkTransientAllocation(pass, trimmed, lineIdx);
        }
    }

    private auditLinearLookups(pass: ScanPassContext, trimmed: string, lineIdx: number): void {
        const { scanConfig, loopStack } = pass;
        const { checkLinearLookups } = scanConfig;
        if (loopStack.length > 0 && checkLinearLookups && !LOOP_KEYWORD_RE.test(trimmed)) {
            this.checkLinearCollectionLookup(pass, trimmed, lineIdx);
        }
    }

    private auditIo(pass: ScanPassContext, nextLine: ScannedLine, lineIdx: number): void {
        const { scanConfig } = pass;
        if (scanConfig.checkIO && !scanConfig.syncIoAllowlisted) {
            this.checkBlockingIo(pass, nextLine, lineIdx);
        }
    }

    private auditBraces(pass: ScanPassContext, trimmed: string): void {
        const { scanConfig, scanState, loopStack } = pass;
        if (scanConfig.isIndentBased) return;
        if (scanState.inAsyncFunction) {
            for (let i = 0; i < trimmed.length; i++) {
                const ch = trimmed.charCodeAt(i);
                if (ch === 123) {
                    scanState.asyncBraceDepth++;
                } else if (ch === 125) {
                    scanState.asyncBraceDepth--;
                    if (scanState.asyncBraceDepth <= 0) {
                        scanState.inAsyncFunction = false;
                        scanState.asyncBraceDepth = 0;
                        break;
                    }
                }
            }
        }
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

    private checkLoopNesting(pass: ScanPassContext, nextLine: ScannedLine, lineIdx: number): void {
        const { scanConfig, loopStack } = pass;
        const { trimmed, lineText } = nextLine;
        if (!LOOP_KEYWORD_RE.test(trimmed)) return;

        const indent = calculateIndent(lineText);
        const currentDepth = loopStack.length + 1;
        loopStack.push({
            depth: currentDepth,
            indent,
            usesBrace: trimmed.includes('{'),
        });

        if (currentDepth >= scanConfig.maxNesting) {
            const desc = PerformanceMessages.NESTED_LOOP_COMPLEXITY(
                currentDepth,
                scanConfig.maxNesting,
            );
            const severity =
                currentDepth >= LOOP_DEPTH_ERROR_THRESHOLD ? SEVERITY_ERROR : SEVERITY_WARNING;
            pass.issues.push(
                this.mkIssue(pass.ctx, lineIdx, {
                    rule: RULE_PRF_ALG_001,
                    message: desc.message,
                    severity,
                    detail: { loopDepth: currentDepth, threshold: scanConfig.maxNesting },
                    suggestion: desc.suggestion,
                }),
            );
        }
    }

    private checkTransientAllocation(
        pass: ScanPassContext,
        trimmed: string,
        lineIdx: number,
    ): void {
        if (/^\s*throw\b|\bthrow\s+new\b/.test(trimmed)) return;
        if (/^(?:export\s+)?(?:interface|type)\b/.test(trimmed)) return;
        if (
            /^(?:readonly\s+)?[A-Za-z_$][A-Za-z0-9_$]*\??\s*:/.test(trimmed) &&
            !trimmed.includes('=')
        ) {
            return;
        }
        const runtimeLine = trimmed
            .replace(/(?<=[A-Za-z0-9_$>])\[\s*\]/g, '')
            .replace(/\bas\s+\{[^}]*\}?/g, '');
        const isHighRisk = HIGH_RISK_OBJECT_ALLOC_RE.test(runtimeLine);
        const isGeneralAlloc = TRANSIENT_ALLOC_RE.test(runtimeLine);
        if (!isHighRisk && !isGeneralAlloc) return;

        const loopDepth = pass.loopStack.length;
        if (isHighRisk) {
            const poolDesc = PerformanceMessages.HIGH_PRESSURE_OBJECT_ALLOCATION(loopDepth);
            pass.issues.push(
                this.mkIssue(pass.ctx, lineIdx, {
                    rule: RULE_PRF_MEM_002,
                    message: poolDesc.message,
                    severity: SEVERITY_WARNING,
                    detail: { loopDepth },
                    suggestion: poolDesc.suggestion,
                }),
            );
        }
        if (isGeneralAlloc) {
            const desc = PerformanceMessages.TRANSIENT_LOOP_ALLOCATION(loopDepth);
            pass.issues.push(
                this.mkIssue(pass.ctx, lineIdx, {
                    rule: RULE_PRF_MEM_001,
                    message: desc.message,
                    severity: SEVERITY_INFO,
                    detail: { loopDepth },
                    suggestion: desc.suggestion,
                }),
            );
        }
    }

    private checkBlockingIo(pass: ScanPassContext, nextLine: ScannedLine, lineIdx: number): void {
        const { trimmed, lineText } = nextLine;
        const inAsyncFunction = pass.scanState.inAsyncFunction;
        for (const ioPattern of BLOCKING_IO_PATTERNS) {
            if (!ioPattern.pattern.test(trimmed)) continue;

            const isCriticalContext =
                inAsyncFunction || /(_process|_physics_process|tick|render)/.test(lineText);
            const desc = PerformanceMessages.BLOCKING_SYNC_IO(ioPattern.name, inAsyncFunction);
            pass.issues.push(
                this.mkIssue(pass.ctx, lineIdx, {
                    rule: RULE_PRF_IO_001,
                    message: desc.message,
                    severity: isCriticalContext ? SEVERITY_ERROR : SEVERITY_WARNING,
                    detail: { api: ioPattern.name, inAsync: inAsyncFunction },
                    suggestion: desc.suggestion,
                }),
            );
            break;
        }
    }

    private checkLinearCollectionLookup(
        pass: ScanPassContext,
        trimmed: string,
        lineIdx: number,
    ): void {
        const methodName = extractLinearLookupMethod(trimmed);
        if (!methodName) return;

        const loopDepth = pass.loopStack.length;
        const desc = PerformanceMessages.LINEAR_COLLECTION_LOOKUP_IN_LOOP(methodName, loopDepth);
        pass.issues.push(
            this.mkIssue(pass.ctx, lineIdx, {
                rule: RULE_PRF_ALG_002,
                message: desc.message,
                severity: SEVERITY_WARNING,
                detail: { loopDepth, methodName },
                suggestion: desc.suggestion,
            }),
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
     * the severity and rule-specific payload in one finding descriptor, which keeps the two
     * adjacent string fields (`rule`, `message`) from being swapped positionally.
     *
     * @param ctx - Scan context providing the normalized file path.
     * @param lineIdx - 0-based content line index; stored as the 1-based issue line.
     * @param finding - Rule id, finding text, severity and rule-specific payload for one issue.
     * @returns The issue ready to append to the analyzer result array.
     */
    private mkIssue(ctx: AnalyzerContext, lineIdx: number, finding: PerformanceFinding): Issue {
        return createLineIssue(
            this.name,
            ctx.filePath,
            {
                lineIdx,
                rule: finding.rule,
                message: finding.message,
                severity: finding.severity,
                detail: finding.detail,
                suggestion: finding.suggestion,
            },
            PRF_ACTIONABLE_MAP,
        );
    }
}
