/**
 * Module: Static Analysis Engine — Standard Library & Systems Runtime Verification
 * File Path: src/analyzers/stdlib.ts
 * Architecture Role: Content and AST-assisted analyzer enforcing the six mission-critical
 *   invariants for standard libraries, bare-metal kernels, and systems runtime modules.
 * Dependencies & Triggers: core types only; enabled when a config declares `analyzers.stdlib`
 *   or when project profiler identifies archetype as stdlib or systems_runtime.
 * Responsibilities:
 *   1. STDLIB-PANIC-001: Flag bare panic/unwrap/abort in public API entry points;
 *   2. STDLIB-ALLOC-001: Intercept implicit heap allocations in no_std/kernel contexts;
 *   3. STDLIB-UNSAFE-001: Enforce mandatory // SAFETY: proof contracts on unsafe blocks;
 *   4. STDLIB-CONST-001: Detect variable-time short-circuit returns
 *      in cryptographic hash/token comparisons;
 *   5. STDLIB-RECURSION-001: Flag unbounded recursive algorithm routines lacking depth limits;
 *   6. STDLIB-PORT-001: Guard platform-specific conditional compilation blocks
 *      against missing fallback compile_error.
 * Exit Semantics & Design Rationale: Deterministic line and block scanner, never throws,
 *   returns [] on irrelevant files or test suites.
 */

import type { Analyzer, AnalyzerContext, Issue, AgentActionType } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_ERROR } from '../core/types';
import { createLineIssue } from '../core/rules/diagnostic-catalog';
import {
    ANALYZER_STDLIB,
    CODE_STB_PANIC_ESCAPE,
    CODE_STB_DYNAMIC_ALLOC,
    CODE_STB_MISSING_SAFETY,
    CODE_STB_TIMING_ATTACK,
    CODE_STB_UNBOUNDED_RECURSION,
    CODE_STB_CONDITIONAL_COMPILATION,
    REGEX,
} from '../core/constants';

/** Relevant source extensions for standard library and systems runtime analysis */
const STDLIB_EXTS = new Set([
    '.rs',
    '.go',
    '.py',
    '.c',
    '.cc',
    '.cpp',
    '.cxx',
    '.h',
    '.hpp',
    '.ts',
    '.js',
]);

/**
 * Entry-point names that are invoked by an external driver rather than by the function itself.
 *
 * `main()` calling `main()` never appears in a healthy program, and a top-level `main().catch(...)`
 * is a call site, not a self-call. Treating the driver's own invocation as recursion made the rule
 * fire on nearly every script entry point.
 */
const ENTRY_POINT_NAMES: ReadonlySet<string> = new Set([
    'main',
    'run',
    'bootstrap',
    'start',
    'cli',
    'entry',
]);

/** Character codes for brace tracking; comparing codes avoids re-compiling a regex per line. */
const CODE_OPEN_BRACE = 0x7b;
const CODE_CLOSE_BRACE = 0x7d;

/**
 * Strip string, template, regular-expression literals and line comments from one line.
 *
 * Braces inside any literal are not code structure. A regex literal in particular carries `{m,n}`
 * quantifiers and `\{` escapes, so leaving it in place made the per-line brace balance drift
 * positive and pushed every later function frame onto the wrong depth. That drift is what made
 * non-recursive helpers look like unguarded recursion.
 *
 * The regex pattern is deliberately conservative: the opening slash must follow an operator or an
 * opening bracket (optionally across whitespace), so division such as `x = a / b / c` is not
 * mistaken for a literal. A slash preceded by an identifier, digit, `)` or `]` ends an expression,
 * not starts a pattern.
 *
 * @param line - Raw source line.
 * @returns The line with literal and comment bodies replaced by placeholders.
 */
function stripLiteralsAndComments(line: string): string {
    return line
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`(?:\\.|[^`\\])*`/g, '``')
        .replace(
            /(^|[(,=:[!&|?{};\s])\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g,
            '$1RE',
        )
        .replace(/\/\/.*$/, '');
}

/**
 * Locate the first body-opening brace at or after `from`.
 *
 * Implemented as a direct character scan to keep the per-line cost flat: the scanner calls this
 * once per line, so an `indexOf` here would nest a linear string search inside the line loop.
 *
 * @param text - Source line with literals and comments removed.
 * @param from - Zero-based offset to start scanning at.
 * @returns Zero-based brace offset, or -1 when the line opens no body.
 */
function findBodyBrace(text: string, from: number): number {
    for (let i = from; i < text.length; i++) {
        if (text.charCodeAt(i) === CODE_OPEN_BRACE) return i;
    }
    return -1;
}

/**
 * Net brace balance of one already-stripped line.
 *
 * @param text - Source line with literals and comments removed.
 * @returns Open braces minus close braces.
 */
function braceDelta(text: string): number {
    let delta = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code === CODE_OPEN_BRACE) delta++;
        else if (code === CODE_CLOSE_BRACE) delta--;
    }
    return delta;
}

/** One function body currently being scanned, with the depth its braces opened at. */
interface RecursionFrame {
    readonly name: string;
    readonly bodyDepth: number;
    /** Matches a bare call of `name`; a member call such as `x.name(` is a different function. */
    readonly bareCallPattern: RegExp;
    /** Matches the same call anywhere, used only to tell a member call from an unrelated line. */
    readonly anyCallPattern: RegExp;
    guarded: boolean;
}

/** A reportable recursive self-invocation. */
interface RecursionSite {
    readonly functionName: string;
    readonly line: number;
}

/**
 * Build the frame for a function whose body opening brace has just been seen.
 *
 * @param name - Declared function name.
 * @param params - Full parameter list text, including any lines it spanned.
 * @param depthBefore - Brace depth before the declaration line.
 * @returns Frame tracking that function body.
 */
function buildRecursionFrame(name: string, params: string, depthBefore: number): RecursionFrame {
    return {
        name,
        bodyDepth: depthBefore + 1,
        bareCallPattern: new RegExp(`(?:^|[^\\w.])${name}\\s*\\(`),
        anyCallPattern: new RegExp(`\\b${name}\\s*\\(`),
        guarded: REGEX.SYNTAX.STDLIB_DEPTH_GUARD_PARAM.test(params) || ENTRY_POINT_NAMES.has(name),
    };
}

/**
 * Record the self-invocation of one frame, when the frame is unguarded and the code calls it.
 *
 * A bare call is required. `this.target.forwardCall(a, b)` inside `forwardCall` invokes a different
 * object's method, and `scanner.scan()` inside `analyze` invokes a different type's method; neither
 * can recurse into the function being scanned, so both are skipped even though the identifier
 * matches. Only a name that appears without a receiver is a genuine self-invocation.
 *
 * @param frame - Innermost open function body.
 * @param code - Line text with literals and comments removed.
 * @param line - One-based line number for the finding.
 * @param sites - Collector receiving discovered sites.
 */
function recordSelfCall(
    frame: RecursionFrame,
    code: string,
    line: number,
    sites: RecursionSite[],
): void {
    if (REGEX.SYNTAX.STDLIB_DEPTH_GUARD_BODY.test(code)) {
        frame.guarded = true;
        return;
    }
    if (frame.guarded) return;
    if (!frame.anyCallPattern.test(code)) return;
    if (frame.bareCallPattern.test(code)) sites.push({ functionName: frame.name, line });
}

/**
 * Collect recursive self-invocations that lack a depth guard.
 *
 * A finding requires the call to sit inside the declared body of the same function. Tracking the
 * brace depth of each frame is what makes that true: without it a name stayed "current" until the
 * next declaration or the end of the file, so every later call to the function — including the
 * driver's own top-level `main().catch(...)` invocation — was read as a self-call. Parameter lists
 * that span several lines are accumulated until the opening brace, so a guard declared on a
 * continuation line still suppresses the finding. A body that opens and closes on one line is
 * inspected immediately, since its frame would otherwise be popped before the line is scanned.
 *
 * @param content - Whole file content.
 * @returns Self-invocations that no guard covers.
 */
function collectRecursionSites(content: string): RecursionSite[] {
    const lines = content.split('\n');
    const sites: RecursionSite[] = [];
    const frames: RecursionFrame[] = [];
    let depth = 0;
    let pendingName: string | null = null;
    let pendingParams = '';

    const closeFinishedFrames = (): void => {
        while (frames.length > 0 && depth < frames[frames.length - 1]!.bodyDepth) frames.pop();
    };

    const openFrame = (
        name: string,
        params: string,
        depthBefore: number,
        code: string,
        openIndex: number,
        lineNumber: number,
    ): void => {
        const frame = buildRecursionFrame(name, params, depthBefore);
        frames.push(frame);
        depth = depthBefore + braceDelta(code);
        if (depth >= frame.bodyDepth) return;
        recordSelfCall(frame, code.slice(openIndex + 1), lineNumber, sites);
        frames.pop();
    };

    for (let i = 0; i < lines.length; i++) {
        const code = stripLiteralsAndComments(lines[i]);
        const depthBefore = depth;
        const lineNumber = i + 1;

        if (pendingName !== null) {
            const openIndex = findBodyBrace(code, 0);
            const declaredName: string = pendingName;
            const params = pendingParams + (openIndex >= 0 ? code.slice(0, openIndex) : code);
            pendingName = null;
            if (openIndex >= 0) {
                openFrame(declaredName, params, depthBefore, code, openIndex, lineNumber);
            } else {
                pendingName = declaredName;
                pendingParams = params;
                depth = depthBefore + braceDelta(code);
            }
            closeFinishedFrames();
            continue;
        }

        const declaration = REGEX.SYNTAX.STDLIB_FN_DEF.exec(code);
        if (declaration !== null) {
            const openIndex = findBodyBrace(code, declaration.index + declaration[0].length);
            const params =
                openIndex >= 0
                    ? declaration[2] + code.slice(declaration.index, openIndex)
                    : declaration[2];
            if (openIndex >= 0) {
                openFrame(declaration[1], params, depthBefore, code, openIndex, lineNumber);
            } else {
                pendingName = declaration[1];
                pendingParams = params;
                depth = depthBefore + braceDelta(code);
            }
            closeFinishedFrames();
            continue;
        }

        const frame = frames[frames.length - 1];
        if (frame !== undefined) recordSelfCall(frame, code, lineNumber, sites);

        depth = depthBefore + braceDelta(code);
        closeFinishedFrames();
    }

    return sites;
}

function isComment(trimmed: string): boolean {
    return /^(?:\/\/|\/\*|\*)/.test(trimmed);
}

function hasSafetyComment(lines: string[], i: number): boolean {
    const start = Math.max(0, i - 4);
    for (let k = i - 1; k >= start; k--) {
        if (/^(?:\/\/|\/\*)\s*SAFETY:/i.test(lines[k].trim())) return true;
    }
    return i + 1 < lines.length && /^(?:\/\/|\/\*)\s*SAFETY:/i.test(lines[i + 1].trim());
}

/**
 * Standard Library & Systems Runtime Safety Analyzer.
 */
export class StdlibAnalyzer implements Analyzer {
    name = ANALYZER_STDLIB;

    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    analyze(_sourceFile: unknown, ctx: AnalyzerContext): Issue[] {
        const content = ctx.content || '';
        const file = ctx.filePath.replace(/\\/g, '/');
        if (content.length === 0) return [];

        const dot = file.lastIndexOf('.');
        if (dot === -1) return [];
        const ext = file.slice(dot).toLowerCase();
        if (!STDLIB_EXTS.has(ext)) return [];

        const issues: Issue[] = [];
        const isTest = REGEX.LITERAL.TEST_PATH.test(file);

        if (!isTest) {
            this.checkPublicApiPanics(content, file, ext, issues);
            this.checkNoStdImplicitAllocations(content, file, ext, issues);
        }
        this.checkUnsafeSafetyContracts(content, file, ext, issues);
        this.checkConstantTimeComparisons(content, file, issues);
        if (!isTest) {
            this.checkUnboundedRecursion(content, file, issues);
            this.checkPlatformPortabilityFallback(content, file, ext, issues);
        }

        return issues;
    }

    private emitIssue(
        issues: Issue[],
        file: string,
        line: number,
        rule: string,
        severity: typeof SEVERITY_WARNING | typeof SEVERITY_ERROR,
        message: string,
        suggestion: string,
        detail: Record<string, unknown> = {},
    ): void {
        const actionableMap: Record<
            string,
            { action: AgentActionType; code: string; safe: boolean }
        > = {
            'STDLIB-PANIC-001': {
                action: 'replace_token',
                code: CODE_STB_PANIC_ESCAPE,
                safe: false,
            },
            'STDLIB-ALLOC-001': {
                action: 'replace_token',
                code: CODE_STB_DYNAMIC_ALLOC,
                safe: false,
            },
            'STDLIB-UNSAFE-001': {
                action: 'insert_comment_contract',
                code: CODE_STB_MISSING_SAFETY,
                safe: true,
            },
            'STDLIB-CONST-001': {
                action: 'use_constant_time_comparison',
                code: CODE_STB_TIMING_ATTACK,
                safe: false,
            },
            'STDLIB-RECURSION-001': {
                action: 'guard_recursion',
                code: CODE_STB_UNBOUNDED_RECURSION,
                safe: false,
            },
            'STDLIB-PORT-001': {
                action: 'insert_comment_contract',
                code: CODE_STB_CONDITIONAL_COMPILATION,
                safe: true,
            },
        };

        const targetActionable = actionableMap[rule];

        const issue = createLineIssue(this.name, file, {
            lineIdx: Math.max(0, line - 1),
            rule,
            severity,
            message,
            suggestion,
            detail,
        });
        if (targetActionable) {
            issue.actionable = {
                action: targetActionable.action,
                code: targetActionable.code,
                targetSymbol: (detail.functionName as string) || undefined,
                safeToAutomate: targetActionable.safe,
            };
        }
        issues.push(issue);
    }

    /**
     * STDLIB-PANIC-001: Flag bare panic/unwrap in public API functions.
     */
    private checkPublicApiPanics(
        content: string,
        file: string,
        ext: string,
        issues: Issue[],
    ): void {
        if (ext === '.rs') {
            this.checkRustPublicPanics(content, file, issues);
        } else if (ext === '.go') {
            this.checkGoPublicPanics(content, file, issues);
        }
    }

    private checkRustPublicPanics(content: string, file: string, issues: Issue[]): void {
        const lines = content.split('\n');
        let inFn = false;
        let fnName = '';
        let depth = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (isComment(trimmed)) continue;

            const pubMatch = REGEX.SYNTAX.RUST_FN.exec(line);
            if (pubMatch) {
                inFn = true;
                fnName = pubMatch[1];
                depth = 0;
            }
            if (!inFn) continue;

            depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

            if (REGEX.SYNTAX.STDLIB_RUST_PANIC.test(line)) {
                this.emitIssue(
                    issues,
                    file,
                    i + 1,
                    'STDLIB-PANIC-001',
                    SEVERITY_WARNING,
                    `Public API \`${fnName}\` contains potentially crashing naked panic/unwrap invocation.`,
                    'Public APIs should return Result<T, E> or Option<T>; handle unwraps explicitly using match or the ? operator.',
                    { functionName: fnName },
                );
            }
            if (depth <= 0 && line.includes('}')) inFn = false;
        }
    }

    private checkGoPublicPanics(content: string, file: string, issues: Issue[]): void {
        const lines = content.split('\n');
        let inFn = false;
        let fnName = '';
        let depth = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (isComment(trimmed)) continue;

            const pubGo = REGEX.SYNTAX.STDLIB_GO_PUB_FN.exec(line);
            if (pubGo) {
                inFn = true;
                fnName = pubGo[1];
                depth = 0;
            }
            if (!inFn) continue;

            depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

            if (/\bpanic\s*\(/.test(line)) {
                this.emitIssue(
                    issues,
                    file,
                    i + 1,
                    'STDLIB-PANIC-001',
                    SEVERITY_WARNING,
                    `Public function \`${fnName}\` contains direct panic invocation.`,
                    'Return explicit error parameter and handle it at call sites.',
                    { functionName: fnName },
                );
            }
            if (depth <= 0 && line.includes('}')) inFn = false;
        }
    }

    /**
     * STDLIB-ALLOC-001: Intercept implicit heap escapes in no_std / systems contexts.
     */
    private checkNoStdImplicitAllocations(
        content: string,
        file: string,
        ext: string,
        issues: Issue[],
    ): void {
        if (ext !== '.rs' && ext !== '.c' && ext !== '.cpp') return;
        if (!REGEX.SYNTAX.STDLIB_NO_STD_CONTEXT.test(content + ' ' + file)) return;

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (isComment(line.trim())) continue;

            if (REGEX.SYNTAX.STDLIB_IMPLICIT_ALLOC.test(line)) {
                this.emitIssue(
                    issues,
                    file,
                    i + 1,
                    'STDLIB-ALLOC-001',
                    SEVERITY_ERROR,
                    'Implicit dynamic heap allocation detected in no_std bare-metal context.',
                    'Use fixed-capacity stack buffer, reference slices, or preallocated memory pool in no_std context.',
                );
            }
        }
    }

    /**
     * STDLIB-UNSAFE-001: Enforce // SAFETY: contract proofs on unsafe blocks.
     */
    private checkUnsafeSafetyContracts(
        content: string,
        file: string,
        ext: string,
        issues: Issue[],
    ): void {
        if (ext !== '.rs' && ext !== '.c' && ext !== '.cpp') return;

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (isComment(line.trim())) continue;

            if (/\bunsafe\s*(?:\{|fn\b|trait\b|impl\b)/.test(line)) {
                if (!hasSafetyComment(lines, i)) {
                    this.emitIssue(
                        issues,
                        file,
                        i + 1,
                        'STDLIB-UNSAFE-001',
                        SEVERITY_ERROR,
                        'Unsafe block lacks mandatory // SAFETY: invariant contract proof.',
                        'Prepend // SAFETY: explaining why caller preconditions and memory invariants are upheld.',
                    );
                }
            }
        }
    }

    /**
     * STDLIB-CONST-001: Flag short-circuit early returns in cryptographic hash comparisons.
     */
    private checkConstantTimeComparisons(content: string, file: string, issues: Issue[]): void {
        if (
            !REGEX.SYNTAX.STDLIB_CRYPTO_KEYWORD.test(file) &&
            !REGEX.SYNTAX.STDLIB_CRYPTO_KEYWORD.test(content.slice(0, 1000))
        ) {
            return;
        }

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed.startsWith('//')) continue;

            if (
                /if\s+[a-zA-Z0-9_]+\[[a-zA-Z0-9_]+\]\s*!==?\s*[a-zA-Z0-9_]+\[[a-zA-Z0-9_]+\]\s*(?:\{\s*)?return\s+false/i.test(
                    trimmed,
                )
            ) {
                this.emitIssue(
                    issues,
                    file,
                    i + 1,
                    'STDLIB-CONST-001',
                    SEVERITY_WARNING,
                    'Timing side-channel vulnerability: short-circuit byte comparison in cryptographic context.',
                    'Use constant-time comparison (e.g. constant_time_eq or bitwise XOR accumulator) to prevent early termination.',
                );
            }
        }
    }

    /**
     * STDLIB-RECURSION-001: Unbounded recursion lacking depth limits.
     *
     * Emits one finding per self-invocation that sits inside the declared body of the same
     * function and carries no depth guard. Brace tracking keeps the function context scoped to its
     * own body, so a later call site outside that body is not mistaken for recursion.
     */
    private checkUnboundedRecursion(content: string, file: string, issues: Issue[]): void {
        for (const site of collectRecursionSites(content)) {
            this.emitIssue(
                issues,
                file,
                site.line,
                'STDLIB-RECURSION-001',
                SEVERITY_WARNING,
                `Function \`${site.functionName}\` has recursive self-invocation without explicit depth limit parameter or guard.`,
                'Introduce explicit depth/recursion_limit parameter returning error upon limit, or convert to iterative loop.',
                { functionName: site.functionName },
            );
        }
    }

    /**
     * STDLIB-PORT-001: Platform conditional compilation missing fallback.
     */
    private checkPlatformPortabilityFallback(
        content: string,
        file: string,
        ext: string,
        issues: Issue[],
    ): void {
        if (ext !== '.rs' && ext !== '.c' && ext !== '.h') return;
        if (!REGEX.SYNTAX.STDLIB_TARGET_CFG.test(content)) return;
        if (REGEX.SYNTAX.STDLIB_FALLBACK.test(content)) return;

        this.emitIssue(
            issues,
            file,
            1,
            'STDLIB-PORT-001',
            SEVERITY_WARNING,
            'Platform-specific conditional compilation block lacks compile_error! or #error fallback for unsupported platforms.',
            'Add #[cfg(not(any(...)))] compile_error!("Unsupported target OS/Arch"); fallback guard.',
        );
    }
}
