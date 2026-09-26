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

import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_ERROR } from '../core/types';

/** Relevant source extensions for standard library and systems runtime analysis */
const STDLIB_EXTS = new Set([
    '.rs', '.go', '.py', '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.ts', '.js',
]);

const TEST_PATH_RE = /(?:\/tests?\/|\/fixtures\/|_test\.[a-z]+|\.test\.[a-z]+|\.spec\.[a-z]+|^test_)/i;
const CRYPTO_KEYWORD_RE = /(?:crypto|hash|token|secret|digest|cipher|signature|subtle|constant_time|hmac|sha256|blake3|keccak|aes_)/i;
const TARGET_CFG_RE = /(?:#\[cfg\(target_os|#\[cfg\(target_arch|#if defined\(__linux__\)|#ifdef _WIN32)/;
const FALLBACK_RE = /(?:compile_error!|#error|unsupported platform|cfg\(not\(any\()/;
const NO_STD_CONTEXT_RE = /(?:#!\[no_std\]|#!\[no_core\]|\/no_std\/|\/core\/)/;
const IMPLICIT_ALLOC_RE = /(?:\bBox::new\s*\(|\bVec::new\s*\(|\balloc::boxed::Box\b|\balloc::vec::Vec\b|\b(?:malloc|calloc)\s*\()/;
const RUST_PUB_FN_RE = /^\s*pub(?:\s*\([^)]*\))?\s*(?:async\s+)?(?:unsafe\s+)?fn\s+([a-zA-Z0-9_]+)/;
const RUST_PANIC_RE = /(?:\bpanic!\s*\(|\b(?:todo!|unimplemented!)\s*\(|\.unwrap\(\))/;
const GO_PUB_FN_RE = /^func\s+(?:\([^)]+\)\s+)?([A-Z][a-zA-Z0-9_]*)\s*\(/;
const FN_DEF_RE = /(?:fn|function|def)\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/;
const DEPTH_GUARD_PARAM_RE = /\b(?:depth|level|limit|fuel|recursion_limit|max_depth)\b/i;
const DEPTH_GUARD_BODY_RE = /\bif\s+.*(?:depth|level|limit|fuel|recursion_limit|max_depth)\b/i;

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
    name = 'stdlib' as const;

    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    analyze(_sf: unknown, ctx: AnalyzerContext): Issue[] {
        const content = ctx.content || '';
        const file = ctx.filePath.replace(/\\/g, '/');
        if (content.length === 0) return [];

        const dot = file.lastIndexOf('.');
        if (dot === -1) return [];
        const ext = file.slice(dot).toLowerCase();
        if (!STDLIB_EXTS.has(ext)) return [];

        const issues: Issue[] = [];
        const isTest = TEST_PATH_RE.test(file);

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
        issues.push({
            id: `stdlib:${rule}:${file}:${line}`,
            analyzer: this.name,
            rule,
            severity,
            message,
            location: {
                file,
                start: { line, column: 1 },
                end: { line, column: 1 },
            },
            suggestion,
            detail,
        });
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

            const pubMatch = RUST_PUB_FN_RE.exec(line);
            if (pubMatch) {
                inFn = true;
                fnName = pubMatch[1];
                depth = 0;
            }
            if (!inFn) continue;

            depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

            if (RUST_PANIC_RE.test(line)) {
                this.emitIssue(
                    issues,
                    file,
                    i + 1,
                    'STDLIB-PANIC-001',
                    SEVERITY_WARNING,
                    `标准库公开接口 \`${fnName}\` 包含可能崩溃的裸 panic/unwrap 逃逸调用。`,
                    '公开 API 应返回 Result<T, E> 或 Option<T>，使用 match 或 ? 操作符解包。',
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

            const pubGo = GO_PUB_FN_RE.exec(line);
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
                    `公开函数 \`${fnName}\` 包含裸 panic 调用。`,
                    '应返回显式 error 参数并在调用点处理。',
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
        if (!NO_STD_CONTEXT_RE.test(content + ' ' + file)) return;

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (isComment(line.trim())) continue;

            if (IMPLICIT_ALLOC_RE.test(line)) {
                this.emitIssue(
                    issues,
                    file,
                    i + 1,
                    'STDLIB-ALLOC-001',
                    SEVERITY_ERROR,
                    `no_std 裸机上下文检测到隐式动态堆内存分配。`,
                    '在 no_std 作用域下使用固定容量栈缓冲、引用切片或预分配内存池。',
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
                        `底层 unsafe 块缺少强制的 // SAFETY: 契约证明。`,
                        '在 unsafe 块前添加 // SAFETY: 说明为何调用者前提与内存不变量得以保证。',
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
            !CRYPTO_KEYWORD_RE.test(file) &&
            !CRYPTO_KEYWORD_RE.test(content.slice(0, 1000))
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
                    `密码学/哈希敏感比对存在字节短路分支，易受时序侧信道攻击。`,
                    '改用恒定时间比对（例如 constant_time_eq 或累加异或位），避免提前退出。',
                );
            }
        }
    }

    /**
     * STDLIB-RECURSION-001: Unbounded recursion lacking depth limits.
     */
    private checkUnboundedRecursion(content: string, file: string, issues: Issue[]): void {
        const lines = content.split('\n');
        let currentFn = '';
        let fnHasDepthGuard = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const fnMatch = FN_DEF_RE.exec(line);
            if (fnMatch) {
                currentFn = fnMatch[1];
                fnHasDepthGuard = DEPTH_GUARD_PARAM_RE.test(fnMatch[2]);
                continue;
            }

            if (!currentFn || fnHasDepthGuard) continue;

            if (DEPTH_GUARD_BODY_RE.test(line)) {
                fnHasDepthGuard = true;
                continue;
            }

            if (new RegExp(`\\b${currentFn}\\s*\\(`).test(line) && !line.includes('fn ') && !line.includes('def ')) {
                this.emitIssue(
                    issues,
                    file,
                    i + 1,
                    'STDLIB-RECURSION-001',
                    SEVERITY_WARNING,
                    `函数 \`${currentFn}\` 存在递归自调用，但缺少显式深度限制参数或防卫。`,
                    '引入显式 depth / recursion_limit 参数并在超限时返回错误，或改用迭代循环。',
                    { functionName: currentFn },
                );
                currentFn = '';
            }
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
        if (!TARGET_CFG_RE.test(content)) return;
        if (FALLBACK_RE.test(content)) return;

        this.emitIssue(
            issues,
            file,
            1,
            'STDLIB-PORT-001',
            SEVERITY_WARNING,
            `平台特定条件编译块缺少 compile_error! 或 #error 不支持平台阻断兜底。`,
            '添加 #[cfg(not(any(...)))] compile_error!("Unsupported target OS/Arch"); 兜底。',
        );
    }
}
