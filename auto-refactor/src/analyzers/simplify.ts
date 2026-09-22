/**
 * Module: Static Analysis Engine — Simplification & Structure Smells
 * File Path: src/analyzers/simplify.ts
 * Architecture Role: Polyglot smell detector for long functions, commented-out code, empty
 *   implementations and debug output; language-neutral rule set usable by every adapter
 * Dependencies & Triggers: core types plus NodeKind for adapter-provided function spans, locN
 *   for issue locations, and globToRegExp/matchAny for the debug-output allow-list; enabled
 *   only when a config declares `analyzers.simplify`
 * Responsibilities: Measure function line spans (SIM-LONG-001); flag blocks of >= 3
 *   consecutive code-shaped comment lines (SIM-COMC-001); flag function bodies that are only
 *   `pass`/`...` or `{}` (SIM-EMPTY-001); flag debug print/console output outside allow-listed
 *   paths (SIM-PRNT-001)
 * Exit Semantics & Design Rationale: Pure detector — never throws and returns [] for empty
 *   content. Function length uses adapter-materialized start/end lines (the normalized AST
 *   guarantee for function-like nodes) so the measurement stays language-agnostic, while the
 *   three line-based rules use conservative, keyword-anchored patterns: a false "delete this
 *   code" suggestion is far more expensive than a missed smell.
 */
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import { SEVERITY_WARNING } from '../core/types';
import { ANALYZER_SIMPLIFY } from '../core/scoring/dimensionLiterals';
import type { NormalizedNode } from '../core/multilang';
import { NodeKind } from '../core/multilang';
import { locN } from '../utils/normalized';
import { globToRegExp, matchAny } from '../core/file-discovery';

/** Per-analyzer tunables (declared in `defaultAnalyzerOptions().simplify`). */
interface SimplifyOptions {
    maxFunctionLines?: number;
    commentedCodeMinLines?: number;
    printAllowPatterns?: string[];
    checkGuardClauses?: boolean;
    maxGuardClauseNesting?: number;
}

const DEFAULT_MAX_FUNCTION_LINES = 60;
const DEFAULT_MIN_COMMENTED_CODE_LINES = 3;
const DEFAULT_MAX_GUARD_CLAUSE_NESTING = 3;
const DEFAULT_PRINT_ALLOW_PATTERNS = [
    '**/cli/**',
    '**/scripts/**',
    '**/tests/**',
    '**/test/**',
    '**/bench/**',
    '**/benchmark*/**',
    '**/*.test.*',
    '**/*.spec.*',
];

/** Keyword-anchored "this comment is code" heuristic, language-neutral. */
const CODE_SHAPED_RE =
    /^(?:def|class|function|fn|func|return|raise|throw|import|from|if|for|while|switch|try|except|catch|with|const|let|var|public|private|protected|async|await|yield|break|continue|else|elif|namespace|using|struct|enum|interface)\b/;
const CODE_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*\s*(?:[-+*/%]?=|\+\+|--|\.[A-Za-z_]\w*\s*=|\()/;

/** Debug-output call sites across the supported languages. */
const DEBUG_PRINT_RE =
    /\b(?:print|pprint|breakpoint|dbg!|println!|eprintln!)\s*\(|\bconsole\.(?:log|debug|info|trace)\s*\(/;

const PY_DEF_RE = /^(\s*)(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(/;
// Only `pass` counts as an empty body: an ellipsis body is the idiomatic Protocol/ABC
// stub marker, so flagging it would produce false positives on interface declarations.
const PY_EMPTY_BODY_RE = /^pass\s*$/;
const BRACE_EMPTY_ONE_LINER_RE = /\b(?:function|fn|func)\s+[A-Za-z_]\w*[^;{]*\{\s*\}\s*$/;
const BRACE_OPEN_RE = /\b(?:function|fn|func)\s+[A-Za-z_]\w*[^;{]*\{\s*$/;
const BRACE_CLOSE_RE = /^\s*\}\s*;?\s*$/;
const COMMENT_MARKERS = ['//', '#', '*'];
const CHAR_DOUBLE_QUOTE = '"';
const CHAR_SINGLE_QUOTE = "'";
const TRIPLE_DOUBLE_QUOTE = '"""';
const TRIPLE_SINGLE_QUOTE = "'''";
type DocstringQuote = typeof CHAR_DOUBLE_QUOTE | typeof CHAR_SINGLE_QUOTE;

function computeControlFlowNesting(rootNode: NormalizedNode): number {
    const rootChildren = rootNode.children;
    if (!rootChildren || rootChildren.length === 0) return 0;

    let max = 0;
    const nodeStack: NormalizedNode[] = [];
    const depthStack: number[] = [];

    for (let i = 0; i < rootChildren.length; i++) {
        const child = rootChildren[i];
        if (!child.functionLike) {
            const nextDepth = child.kind === NodeKind.ControlFlow || child.increasesNesting ? 1 : 0;
            nodeStack.push(child);
            depthStack.push(nextDepth);
        }
    }

    while (nodeStack.length > 0) {
        const currentNode = nodeStack.pop()!;
        const currentDepth = depthStack.pop()!;
        if (currentDepth > max) max = currentDepth;

        const children = currentNode.children;
        if (children) {
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                if (!child.functionLike) {
                    const inc =
                        child.kind === NodeKind.ControlFlow || child.increasesNesting ? 1 : 0;
                    nodeStack.push(child);
                    depthStack.push(currentDepth + inc);
                }
            }
        }
    }
    return max;
}

/**
 * Simplification and structure-smell analyzer (language-agnostic).
 *
 * `visit` records over-long functions from adapter positions; `finalize` appends the
 * line-based smell scan. The engine instantiates a fresh analyzer per file, so the
 * collector never leaks across files.
 */
export class SimplifyAnalyzer implements Analyzer {
    name = ANALYZER_SIMPLIFY;

    private longFunctions: Issue[] = [];

    /**
     * Record functions whose measured span exceeds `maxFunctionLines`.
     *
     * @param node - Every visited node; only function-like nodes are measured.
     * @param ctx - Analyzer context (file path, options, content).
     * @param opts - Merged analyzer options.
     * @param name - Display name of the function or method.
     */
    private checkFunctionLength(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        opts: SimplifyOptions,
        name: string,
    ): void {
        const limit = opts.maxFunctionLines ?? DEFAULT_MAX_FUNCTION_LINES;
        const length = (node.end?.line ?? 0) - (node.start?.line ?? 0) + 1;
        if (length > limit) {
            this.longFunctions.push({
                id: `simplify:SIM-LONG-001:${ctx.filePath}:${node.start?.line ?? 1}`,
                analyzer: ANALYZER_SIMPLIFY,
                rule: 'SIM-LONG-001',
                severity: SEVERITY_WARNING,
                message: `Function "${name}" spans ${length} lines (limit ${limit}).`,
                location: locN(node, ctx.filePath),
                detail: { function: name, lines: length, limit },
                suggestion:
                    'Extract cohesive steps into named helpers so the top-level flow reads as a short sequence of intent.',
            });
        }
    }

    private checkGuardClauseNesting(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        opts: SimplifyOptions,
        name: string,
    ): void {
        if (!opts.checkGuardClauses) return;
        const maxNesting = computeControlFlowNesting(node);
        const maxAllowed = opts.maxGuardClauseNesting ?? DEFAULT_MAX_GUARD_CLAUSE_NESTING;
        if (maxNesting > maxAllowed) {
            this.longFunctions.push({
                id: `simplify:SIM-FLAT-002:${ctx.filePath}:${node.start?.line ?? 1}`,
                analyzer: ANALYZER_SIMPLIFY,
                rule: 'SIM-FLAT-002',
                severity: SEVERITY_WARNING,
                message: `Function "${name}" has nested conditional control-flow depth ${maxNesting} (limit ${maxAllowed}). Flatten with guard clauses.`,
                location: locN(node, ctx.filePath),
                detail: { function: name, nestingDepth: maxNesting, limit: maxAllowed },
                suggestion:
                    'Invert deep conditionals and return early with guard clauses to flatten control flow.',
            });
        }
    }

    visit(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        _parent?: NormalizedNode,
        _grandparent?: NormalizedNode,
        _depth?: number,
        className?: string | null,
        binding?: string | null,
    ): void {
        if (!node.functionLike || !node.start || !node.end) return;
        const opts = (ctx.options || {}) as SimplifyOptions;
        const name = this.nameFor(node, className ?? null, binding ?? null);
        this.checkFunctionLength(node, ctx, opts, name);
        this.checkGuardClauseNesting(node, ctx, opts, name);
    }

    /**
     * Emit collected long-function findings plus the line-based smell scan.
     *
     * @param ctx - Analyzer context carrying the file content and options.
     * @returns All findings for the file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.longFunctions.concat(this.scanContent(ctx));
    }

    /**
     * Standalone `analyze()` contract: run the line-based scan without a normalized AST.
     *
     * The engine's streaming path uses `visit` + `finalize`, so function-span measurement is
     * unavailable here; callers of this compatibility entry point still get every content rule.
     *
     * @param _sf - Unused TypeScript source file (kept for the analyzer contract).
     * @param ctx - Analyzer context carrying the file content and options.
     * @returns The content-rule findings for the file.
     */
    analyze(_sf: unknown, ctx: AnalyzerContext): Issue[] {
        return this.scanContent(ctx);
    }

    /**
     * Run the line-based rules over the file content.
     *
     * @param ctx - Analyzer context carrying the file content and options.
     * @returns Findings for commented-out code, empty implementations and debug output.
     */
    private scanContent(ctx: AnalyzerContext): Issue[] {
        const content = ctx.content || '';
        if (!content) return [];
        const file = ctx.filePath.replace(/\\/g, '/');
        const opts = (ctx.options || {}) as SimplifyOptions;
        const lines = content.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
        const issues: Issue[] = [];

        this.detectCommentedOutCode(lines, file, opts, ctx, issues);
        this.detectEmptyImplementations(lines, file, ctx, issues);
        this.detectDebugOutput(lines, file, opts, ctx, issues);

        return issues;
    }

    /**
     * Flag blocks of consecutive code-shaped comment lines.
     *
     * @param lines - File content split into physical lines.
     * @param file - Normalized file path.
     * @param opts - Analyzer options (`commentedCodeMinLines`).
     * @param ctx - Analyzer context.
     * @param issues - Accumulator for emitted issues.
     */
    private detectCommentedOutCode(
        lines: string[],
        file: string,
        opts: SimplifyOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const min = opts.commentedCodeMinLines ?? DEFAULT_MIN_COMMENTED_CODE_LINES;
        let streak = 0;
        let start = 0;
        const flush = (endIndex: number): void => {
            if (streak >= min) {
                issues.push({
                    id: `simplify:SIM-COMC-001:${file}:${start + 1}`,
                    analyzer: ANALYZER_SIMPLIFY,
                    rule: 'SIM-COMC-001',
                    severity: SEVERITY_WARNING,
                    message: `Suspected commented-out code: ${streak} consecutive code-shaped comment lines.`,
                    location: {
                        file,
                        start: { line: start + 1, column: 1 },
                        end: { line: endIndex, column: 1 },
                    },
                    detail: { lines: streak, first: lines[start].trim() },
                    suggestion:
                        'Delete the block (history lives in git) or restore it to real code.',
                });
            }
            streak = 0;
        };
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            const marker = COMMENT_MARKERS.find((m) => trimmed.startsWith(m));
            const body = marker ? trimmed.slice(marker.length).trim() : '';
            const codeShaped =
                !!marker &&
                body.length > 0 &&
                (CODE_SHAPED_RE.test(body) || CODE_ASSIGN_RE.test(body));
            if (codeShaped) {
                if (streak === 0) start = i;
                streak++;
            } else {
                flush(i);
            }
        }
        flush(lines.length);
    }

    /**
     * Flag functions whose entire body is `pass`, `...`, or an empty brace pair.
     *
     * @param lines - File content split into physical lines.
     * @param file - Normalized file path.
     * @param lineIndex - Zero-based line index of the detected empty placeholder.
     * @param issues - Accumulator for emitted issues.
     */
    private emitEmptyIssue(
        lines: string[],
        file: string,
        lineIndex: number,
        issues: Issue[],
    ): void {
        issues.push({
            id: `simplify:SIM-EMPTY-001:${file}:${lineIndex + 1}`,
            analyzer: ANALYZER_SIMPLIFY,
            rule: 'SIM-EMPTY-001',
            severity: SEVERITY_WARNING,
            message: 'Empty implementation: the function body is only a placeholder.',
            location: {
                file,
                start: { line: lineIndex + 1, column: 1 },
                end: { line: lineIndex + 1, column: 1 },
            },
            detail: { line: lines[lineIndex].trim() },
            suggestion:
                'Implement the body, raise an explicit not-implemented error, or remove the declaration.',
        });
    }

    private isBraceBlockEmpty(lines: string[], startIndex: number): boolean {
        if (BRACE_EMPTY_ONE_LINER_RE.test(lines[startIndex])) {
            return true;
        }
        if (BRACE_OPEN_RE.test(lines[startIndex])) {
            let j = startIndex + 1;
            while (
                j < lines.length &&
                (lines[j].trim() === '' || lines[j].trim().startsWith('//'))
            ) {
                j++;
            }
            return j < lines.length && BRACE_CLOSE_RE.test(lines[j]);
        }
        return false;
    }

    private skipPythonLeadingCommentsAndDocstrings(lines: string[], startIndex: number): number {
        let j = startIndex;
        while (j < lines.length) {
            const trimmed = lines[j].trim();
            if (trimmed === '' || trimmed.startsWith('#')) {
                j++;
                continue;
            }
            if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
                const marker = trimmed.startsWith('"""') ? '"""' : "'''";
                if (trimmed.split(marker).length - 1 >= 2) {
                    j++;
                    continue;
                }
                j++;
                while (j < lines.length && !lines[j].includes(marker)) j++;
                j++;
                continue;
            }
            break;
        }
        return j;
    }

    private updateDocstringState(
        raw: string,
        trimmed: string,
        inTriple: DocstringQuote | null,
    ): DocstringQuote | null {
        if (inTriple) {
            const closers =
                inTriple === CHAR_DOUBLE_QUOTE
                    ? raw.split(TRIPLE_DOUBLE_QUOTE).length - 1
                    : raw.split(TRIPLE_SINGLE_QUOTE).length - 1;
            return closers > 0 ? null : inTriple;
        }
        if (trimmed.startsWith(TRIPLE_DOUBLE_QUOTE) || trimmed.startsWith(TRIPLE_SINGLE_QUOTE)) {
            const marker = trimmed.startsWith(TRIPLE_DOUBLE_QUOTE)
                ? TRIPLE_DOUBLE_QUOTE
                : TRIPLE_SINGLE_QUOTE;
            return trimmed.split(marker).length - 1 < 2
                ? marker === TRIPLE_DOUBLE_QUOTE
                    ? CHAR_DOUBLE_QUOTE
                    : CHAR_SINGLE_QUOTE
                : null;
        }
        return null;
    }

    private checkEmptyAtLine(lines: string[], file: string, i: number, issues: Issue[]): void {
        const def = PY_DEF_RE.exec(lines[i]);
        if (def) {
            if (this.pythonBodyIsEmpty(lines, i, def[1].length)) {
                this.emitEmptyIssue(lines, file, i, issues);
            }
            return;
        }
        if (this.isBraceBlockEmpty(lines, i)) {
            this.emitEmptyIssue(lines, file, i, issues);
        }
    }

    /**
     * Identify empty implementation blocks across physical lines.
     *
     * @param lines - Physical lines of the file.
     * @param file - Normalized file path.
     * @param _ctx - Analyzer context.
     * @param issues - Accumulator for emitted issues.
     */
    private detectEmptyImplementations(
        lines: string[],
        file: string,
        _ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        let inTriple: '"' | "'" | null = null;
        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const trimmedLine = raw.trim();
            const nextTriple = this.updateDocstringState(raw, trimmedLine, inTriple);
            if (inTriple !== null || nextTriple !== null) {
                inTriple = nextTriple;
                continue;
            }
            this.checkEmptyAtLine(lines, file, i, issues);
        }
    }

    /**
     * Report whether a Python function's effective body is only `pass`/`...`.
     *
     * Skips a leading docstring (single- or multi-line) before testing the body, then verifies
     * the placeholder is the last statement of the block by indentation.
     *
     * @param lines - File content split into physical lines.
     * @param defIndex - Index of the `def` line.
     * @param defIndent - Indentation width of the `def` keyword.
     * @returns True when the body consists solely of a placeholder.
     */
    private pythonBodyIsEmpty(lines: string[], defIndex: number, defIndent: number): boolean {
        const j = this.skipPythonLeadingCommentsAndDocstrings(lines, defIndex + 1);
        if (j >= lines.length || !PY_EMPTY_BODY_RE.test(lines[j].trim())) return false;
        if (this.indentWidth(lines[j]) <= defIndent) return false;
        let k = j + 1;
        while (k < lines.length && (lines[k].trim() === '' || lines[k].trim().startsWith('#'))) k++;
        return k >= lines.length || this.indentWidth(lines[k]) <= defIndent;
    }

    /**
     * Count the leading-space indentation width of a line.
     *
     * @param line - Raw physical line.
     * @returns The number of leading spaces (tabs count as one column).
     */
    private indentWidth(line: string): number {
        const match = /^\s*/.exec(line);
        return match ? match[0].length : 0;
    }

    /**
     * Flag debug output outside the allow-listed paths.
     *
     * @param lines - File content split into physical lines.
     * @param file - Normalized file path.
     * @param opts - Analyzer options (`printAllowPatterns`).
     * @param ctx - Analyzer context.
     * @param issues - Accumulator for emitted issues.
     */
    private detectDebugOutput(
        lines: string[],
        file: string,
        opts: SimplifyOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const patterns = (opts.printAllowPatterns ?? DEFAULT_PRINT_ALLOW_PATTERNS).map((p) =>
            globToRegExp(p),
        );
        if (patterns.length > 0 && matchAny(patterns, file)) return;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
                continue;
            }
            if (!DEBUG_PRINT_RE.test(lines[i])) {
                continue;
            }
            issues.push({
                id: `simplify:SIM-PRNT-001:${file}:${i + 1}`,
                analyzer: ANALYZER_SIMPLIFY,
                rule: 'SIM-PRNT-001',
                severity: SEVERITY_WARNING,
                message:
                    'Debug output call in non-CLI code: route diagnostics through the project logger.',
                location: {
                    file,
                    start: { line: i + 1, column: 1 },
                    end: { line: i + 1, column: 1 },
                },
                detail: { line: trimmed },
                suggestion:
                    'Use the structured logger (or remove the statement); debug output bypasses log levels and leaks to production stdout.',
            });
        }
    }

    /**
     * Resolve a human-readable name for a function-like node.
     *
     * @param node - Function-like normalized node.
     * @param className - Enclosing class name, when the engine threaded one.
     * @param binding - Enclosing binding name for anonymous functions.
     * @returns The resolved display name.
     */
    private nameFor(
        node: NormalizedNode,
        className: string | null,
        binding: string | null,
    ): string {
        if (node.kind === NodeKind.Method && !node.isConstructor) {
            const m = node.name ?? 'anonymous';
            return className ? className + '.' + m : m;
        }
        if (node.kind === NodeKind.Function && node.name) return node.name;
        return binding ?? (className ? className + '.<anonymous>' : 'anonymous');
    }
}
