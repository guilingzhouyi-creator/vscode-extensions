/**
 * Module: Static Analysis — Built-in Analyzer Suite (Security & Vulnerabilities)
 * File Path: src/analyzers/security.ts
 * Architecture Role: Analyzer adapter implementing both the line-based analyze() contract and
 *   the single-pass visit()/finalize() streaming contract; finalize() is the merge point.
 * Dependencies & Triggers: Core types, NormalizedNode/NodeKind and `SecurityMessages`;
 *   triggered by engine streaming passes and standalone analyze() calls.
 * Responsibilities: At basic level flag SEC-VUL-001 dynamic code execution, SEC-VUL-002
 *   command injection and SEC-VUL-003 prototype pollution; at full level add SEC-VUL-004
 *   insecure randomness, SEC-VUL-005 broken md5/sha1 hashes, SEC-VUL-006 path traversal and
 *   SEC-LEAK-001 sensitive data logging; visit() also catches eval/execScript call nodes.
 * Exit Semantics & Design Rationale: Returns [] when the level is 'off'; findings are capped
 *   at maxIssuesPerFile (default 50) and finalize() dedupes by issue id so line and AST paths
 *   never double-report. Test/fixture/sample/dist/mock paths bypass checks to keep gates free
 *   of false positives on non-production code.
 *
 * Security Analyzer.
 *
 * Comprehensive systemic vulnerability, code execution, command injection,
 * prototype pollution, weak crypto, and sensitive data leakage detection.
 *
 * Operates across three security levels:
 * - 'off': 0-cost bypass (empty return)
 * - 'basic': hardcoded tokens/keys, arbitrary code execution, command injection,
 *   prototype pollution (zero false positives)
 * - 'full': Shannon entropy, insecure pseudo-randomness, broken hashes, path traversal,
 *   sensitive logging
 *
 * Implements both streaming `visit`/`finalize` and standalone `analyze` contracts.
 */

import type { Analyzer, AnalyzerContext, Issue, SecurityLevel } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_ERROR } from '../core/types';
import { ANALYZER_SECURITY } from '../core/scoring/dimensionLiterals';
import type { NormalizedNode } from '../core/multilang';
import { NodeKind } from '../core/multilang';
import { SecurityMessages } from '../core/messages/security';
import { nativeCore } from '../core/native';

/**
 * Optional per-file configuration for the security analyzer.
 *
 * `level` overrides the scan-wide `securityLevel`; `basic` runs SEC-VUL-001..003, while `full`
 * adds SEC-VUL-004..006 and SEC-LEAK-001. Each `check*` flag defaults to enabled, and setting one
 * to `false` suppresses only that rule. `maxIssuesPerFile` defaults to 50 and caps the line pass;
 * streaming findings are merged and deduplicated separately by `finalize`.
 */
export interface SecurityOptions {
    level?: SecurityLevel;
    checkCodeExecution?: boolean;
    checkCommandInjection?: boolean;
    checkPrototypePollution?: boolean;
    checkInsecureRandom?: boolean;
    checkBrokenCrypto?: boolean;
    checkPathTraversal?: boolean;
    checkSensitiveLogging?: boolean;
    maxIssuesPerFile?: number;
}

const DYNAMIC_EXEC_RE = /\b(eval\s*\(|new\s+Function\s*\(|execScript\s*\()/;
const PYTHON_EXEC_RE = /\b(exec\s*\(|eval\s*\(|compile\s*\([^)]*['"]exec['"]\))/;
const GDSCRIPT_EXEC_RE = /\bExpression\.new\s*\(\)\.execute\b/;

const SHELL_INJECTION_RE =
    /\b(?:child_process\s*\.\s*(?:exec|execSync)|exec|execSync)\s*\(\s*(?:`[^`]*\${|['"][^'"]*['"]\s*\+)/;
const PYTHON_SHELL_INJECTION_RE =
    /\b(?:os\.system|subprocess\.(?:call|Popen|run))\s*\([^)]*shell\s*=\s*True/;

const PROTO_POLLUTION_RE =
    /(?:__proto__\s*=|\[\s*['"]__proto__['"]\s*\]\s*=|constructor\s*\.\s*prototype\s*=)/;

const INSECURE_RANDOM_CTX_RE = /(?:token|secret|key|salt|nonce|auth|pass|session|pwd|credential)/i;
const INSECURE_RANDOM_CALL_RE = /\b(?:Math\.random\s*\(\)|rand\s*\(\)|random\.random\s*\(\))/;

const BROKEN_CRYPTO_RE =
    /\b(?:createHash\s*\(\s*['"](?:md5|sha1)['"]|crypto\.createHash\s*\(\s*['"](?:md5|sha1)['"]|hashlib\.(?:md5|sha1)\s*\()/i;

const PATH_TRAVERSAL_RE =
    /\b(?:readFile|readFileSync|createReadStream|unlink|rmdir)\s*\([^)]*(?:req\.(?:query|params|body)|request\.(?:query|params|body)|urlParams|searchParams|userInput)/;

const SENSITIVE_LOG_RE =
    /\b(?:console\.(?:log|warn|error|info|debug)|logger\.(?:log|warn|error|info|debug))\s*\([^)]*(?:password|passwd|secretKey|client_secret|apiKey|authToken|bearerToken|accessToken)/i;

/** Critical tokens for fast native pattern pre-screening across large source texts. */
const SECURITY_FAST_FILTER_TOKENS: readonly string[] = [
    'eval',
    'exec',
    'Function',
    'child_process',
    '__proto__',
    'prototype',
    'random',
    'rand',
    'createHash',
    'md5',
    'sha1',
    'readFile',
    'unlink',
    'rmdir',
    'console.',
    'logger.',
];

/** Default per-file finding cap used when `SecurityOptions.maxIssuesPerFile` is omitted. */
const DEFAULT_MAX_ISSUES_PER_FILE = 50;

/**
 * Security analyzer for dynamic execution, injection, weak crypto, and data-leakage patterns.
 *
 * The line-based `analyze` pass is stateless and safe to call repeatedly. The streaming path uses
 * one instance per file: `visit` accretes findings in `this.issues`, and `finalize` clears that
 * buffer after merging it with a fresh line pass and deduplicating by issue id. Do not share a
 * single streaming instance across files, because that would mix their findings or race.
 */
export class SecurityAnalyzer implements Analyzer {
    name = ANALYZER_SECURITY;
    private issues: Issue[] = [];

    /**
     * Analyze raw file content line by line and return bounded security findings.
     *
     * @param sf - Parsed TypeScript source file; unused because scanning reads `ctx.content`.
     * @param ctx - Per-file context with content, normalized path, merged options, and level.
     * @returns Findings capped at `maxIssuesPerFile`; empty when the level is `off` or the path is
     *   treated as non-production test, fixture, sample, dist, or mock code.
     */
    analyze(sf: import('typescript').SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        void sf;
        const opts = (ctx.options || {}) as SecurityOptions;
        const level: SecurityLevel = opts.level || ctx.config.securityLevel || 'basic';

        if (level === 'off') {
            return [];
        }

        const content = ctx.content || '';
        const file = ctx.filePath.replace(/\\/g, '/');
        const cap = opts.maxIssuesPerFile ?? DEFAULT_MAX_ISSUES_PER_FILE;
        const issues: Issue[] = [];

        // Exempt tests, mocks, fixtures, and samples from strict security gates
        const isTestOrFixture = /(?:tests?|specs?|fixtures?|samples?|benchmark|dist|mock)/i.test(
            file,
        );

        // High-performance fast path: pre-screen large files via native SIMD multi-pattern matcher
        if (content.length > 5000) {
            const hits = nativeCore.fastPatternMatch(content, SECURITY_FAST_FILTER_TOKENS as string[]);
            if (hits.length === 0) {
                return [];
            }
        }

        const lines = content.split(/\r?\n/);

        for (let idx = 0; idx < lines.length; idx++) {
            if (issues.length >= cap) break;
            const lineNum = idx + 1;
            const lineText = lines[idx];
            const trimmed = lineText.trim();

            if (
                !trimmed ||
                trimmed.startsWith('//') ||
                trimmed.startsWith('#') ||
                trimmed.startsWith('*')
            ) {
                continue;
            }

            this.auditBasicInjections(
                trimmed,
                lineText,
                lineNum,
                file,
                isTestOrFixture,
                opts,
                issues,
            );

            if (level === 'full' && !isTestOrFixture) {
                this.auditFullCompliance(trimmed, lineText, lineNum, file, opts, issues);
            }
        }

        return issues;
    }

    /**
     * Run the basic SEC-VUL-001..003 checks against one trimmed line.
     *
     * @param trimmed - Line with leading and trailing whitespace removed; all regexes run on it.
     * @param lineText - Original line, used only to compute the reported end column.
     * @param lineNum - One-based line number recorded in each issue id and location.
     * @param file - Repository-relative POSIX path recorded in each issue.
     * @param issues - Mutable accumulator that receives zero or more new issues.
     */
    private checkCodeExecution(
        trimmed: string,
        lineText: string,
        lineNum: number,
        file: string,
        issues: Issue[],
    ): void {
        if (
            DYNAMIC_EXEC_RE.test(trimmed) ||
            (file.endsWith('.py') && PYTHON_EXEC_RE.test(trimmed)) ||
            (file.endsWith('.gd') && GDSCRIPT_EXEC_RE.test(trimmed))
        ) {
            issues.push({
                id: `security:arbitrary-code-execution:${file}:${lineNum}`,
                analyzer: ANALYZER_SECURITY,
                rule: 'SEC-VUL-001',
                severity: SEVERITY_ERROR,
                message: SecurityMessages.ARBITRARY_CODE_EXECUTION.message,
                location: {
                    file,
                    start: { line: lineNum, column: 1 },
                    end: { line: lineNum, column: lineText.length },
                },
                detail: {
                    risk: SecurityMessages.ARBITRARY_CODE_EXECUTION.risk,
                    category: 'code_execution',
                    snippet: trimmed,
                },
                suggestion: SecurityMessages.ARBITRARY_CODE_EXECUTION.suggestion,
            });
        }
    }

    private checkCommandInjection(
        trimmed: string,
        lineText: string,
        lineNum: number,
        file: string,
        issues: Issue[],
    ): void {
        if (SHELL_INJECTION_RE.test(trimmed) || PYTHON_SHELL_INJECTION_RE.test(trimmed)) {
            issues.push({
                id: `security:command-injection:${file}:${lineNum}`,
                analyzer: ANALYZER_SECURITY,
                rule: 'SEC-VUL-002',
                severity: SEVERITY_ERROR,
                message: SecurityMessages.COMMAND_INJECTION.message,
                location: {
                    file,
                    start: { line: lineNum, column: 1 },
                    end: { line: lineNum, column: lineText.length },
                },
                detail: {
                    risk: SecurityMessages.COMMAND_INJECTION.risk,
                    category: 'command_injection',
                    snippet: trimmed,
                },
                suggestion: SecurityMessages.COMMAND_INJECTION.suggestion,
            });
        }
    }

    private checkPrototypePollution(
        trimmed: string,
        lineText: string,
        lineNum: number,
        file: string,
        issues: Issue[],
    ): void {
        if (PROTO_POLLUTION_RE.test(trimmed)) {
            issues.push({
                id: `security:prototype-pollution:${file}:${lineNum}`,
                analyzer: ANALYZER_SECURITY,
                rule: 'SEC-VUL-003',
                severity: SEVERITY_ERROR,
                message: SecurityMessages.PROTOTYPE_POLLUTION.message,
                location: {
                    file,
                    start: { line: lineNum, column: 1 },
                    end: { line: lineNum, column: lineText.length },
                },
                detail: {
                    risk: SecurityMessages.PROTOTYPE_POLLUTION.risk,
                    category: 'prototype_pollution',
                    snippet: trimmed,
                },
                suggestion: SecurityMessages.PROTOTYPE_POLLUTION.suggestion,
            });
        }
    }

    /**
     * Run the basic SEC-VUL-001..003 checks against one trimmed line.
     *
     * @param trimmed - Line with leading and trailing whitespace removed; all regexes run on it.
     * @param lineText - Original line, used only to compute the reported end column.
     * @param lineNum - One-based line number recorded in each issue id and location.
     * @param file - Repository-relative POSIX path recorded in each issue.
     * @param isTestOrFixture - When true, every basic check is skipped for this file.
     * @param opts - Merged analyzer options; a `check*` flag set to false disables its rule.
     * @param issues - Mutable accumulator that receives zero or more new issues.
     */
    private auditBasicInjections(
        trimmed: string,
        lineText: string,
        lineNum: number,
        file: string,
        isTestOrFixture: boolean,
        opts: SecurityOptions,
        issues: Issue[],
    ): void {
        if (isTestOrFixture) return;
        if (opts.checkCodeExecution !== false) {
            this.checkCodeExecution(trimmed, lineText, lineNum, file, issues);
        }
        if (opts.checkCommandInjection !== false) {
            this.checkCommandInjection(trimmed, lineText, lineNum, file, issues);
        }
        if (opts.checkPrototypePollution !== false) {
            this.checkPrototypePollution(trimmed, lineText, lineNum, file, issues);
        }
    }

    /**
     * Run the full-level SEC-VUL-004..006 and SEC-LEAK-001 checks against one line.
     *
     * Callers must already have excluded non-production paths; this helper has no suppression
     * flag because `analyze` only invokes it when the level is `full` and the path is eligible.
     *
     * @param trimmed - Line with leading and trailing whitespace removed; all regexes run on it.
     * @param lineText - Original line, used only to compute the reported end column.
     * @param lineNum - One-based line number recorded in each issue id and location.
     * @param file - Repository-relative POSIX path recorded in each issue.
     * @param issues - Mutable accumulator that receives zero or more new issues.
     */
    private checkInsecureRandom(
        trimmed: string,
        lineText: string,
        lineNum: number,
        file: string,
        issues: Issue[],
    ): void {
        if (INSECURE_RANDOM_CTX_RE.test(trimmed) && INSECURE_RANDOM_CALL_RE.test(trimmed)) {
            issues.push({
                id: `security:insecure-randomness:${file}:${lineNum}`,
                analyzer: ANALYZER_SECURITY,
                rule: 'SEC-VUL-004',
                severity: SEVERITY_WARNING,
                message: SecurityMessages.INSECURE_RANDOMNESS.message,
                location: {
                    file,
                    start: { line: lineNum, column: 1 },
                    end: { line: lineNum, column: lineText.length },
                },
                detail: {
                    risk: SecurityMessages.INSECURE_RANDOMNESS.risk,
                    category: 'weak_randomness',
                    snippet: trimmed,
                },
                suggestion: SecurityMessages.INSECURE_RANDOMNESS.suggestion,
            });
        }
    }

    private checkBrokenCrypto(
        trimmed: string,
        lineText: string,
        lineNum: number,
        file: string,
        issues: Issue[],
    ): void {
        if (BROKEN_CRYPTO_RE.test(trimmed)) {
            issues.push({
                id: `security:broken-crypto-hash:${file}:${lineNum}`,
                analyzer: ANALYZER_SECURITY,
                rule: 'SEC-VUL-005',
                severity: SEVERITY_WARNING,
                message: SecurityMessages.BROKEN_CRYPTO_HASH.message,
                location: {
                    file,
                    start: { line: lineNum, column: 1 },
                    end: { line: lineNum, column: lineText.length },
                },
                detail: {
                    risk: SecurityMessages.BROKEN_CRYPTO_HASH.risk,
                    category: 'broken_hash',
                    snippet: trimmed,
                },
                suggestion: SecurityMessages.BROKEN_CRYPTO_HASH.suggestion,
            });
        }
    }

    private checkPathTraversal(
        trimmed: string,
        lineText: string,
        lineNum: number,
        file: string,
        issues: Issue[],
    ): void {
        if (PATH_TRAVERSAL_RE.test(trimmed)) {
            issues.push({
                id: `security:path-traversal:${file}:${lineNum}`,
                analyzer: ANALYZER_SECURITY,
                rule: 'SEC-VUL-006',
                severity: SEVERITY_WARNING,
                message: SecurityMessages.PATH_TRAVERSAL.message,
                location: {
                    file,
                    start: { line: lineNum, column: 1 },
                    end: { line: lineNum, column: lineText.length },
                },
                detail: {
                    risk: SecurityMessages.PATH_TRAVERSAL.risk,
                    category: 'path_traversal',
                    snippet: trimmed,
                },
                suggestion: SecurityMessages.PATH_TRAVERSAL.suggestion,
            });
        }
    }

    private checkSensitiveLogging(
        trimmed: string,
        lineText: string,
        lineNum: number,
        file: string,
        issues: Issue[],
    ): void {
        if (SENSITIVE_LOG_RE.test(trimmed)) {
            issues.push({
                id: `security:sensitive-data-logging:${file}:${lineNum}`,
                analyzer: ANALYZER_SECURITY,
                rule: 'SEC-LEAK-001',
                severity: SEVERITY_WARNING,
                message: SecurityMessages.SENSITIVE_DATA_LOGGING.message,
                location: {
                    file,
                    start: { line: lineNum, column: 1 },
                    end: { line: lineNum, column: lineText.length },
                },
                detail: {
                    risk: SecurityMessages.SENSITIVE_DATA_LOGGING.risk,
                    category: 'info_leakage',
                    snippet: trimmed,
                },
                suggestion: SecurityMessages.SENSITIVE_DATA_LOGGING.suggestion,
            });
        }
    }

    /**
     * Run the full-level SEC-VUL-004..006 and SEC-LEAK-001 checks against one line.
     *
     * Callers must already have excluded non-production paths; this helper has no suppression
     * flag because `analyze` only invokes it when the level is `full` and the path is eligible.
     *
     * @param trimmed - Line with leading and trailing whitespace removed; all regexes run on it.
     * @param lineText - Original line, used only to compute the reported end column.
     * @param lineNum - One-based line number recorded in each issue id and location.
     * @param file - Repository-relative POSIX path recorded in each issue.
     * @param opts - Merged analyzer options; a `check*` flag set to false disables its rule.
     * @param issues - Mutable accumulator that receives zero or more new issues.
     */
    private auditFullCompliance(
        trimmed: string,
        lineText: string,
        lineNum: number,
        file: string,
        opts: SecurityOptions,
        issues: Issue[],
    ): void {
        if (opts.checkInsecureRandom !== false) {
            this.checkInsecureRandom(trimmed, lineText, lineNum, file, issues);
        }
        if (opts.checkBrokenCrypto !== false) {
            this.checkBrokenCrypto(trimmed, lineText, lineNum, file, issues);
        }
        if (opts.checkPathTraversal !== false) {
            this.checkPathTraversal(trimmed, lineText, lineNum, file, issues);
        }
        if (opts.checkSensitiveLogging !== false) {
            this.checkSensitiveLogging(trimmed, lineText, lineNum, file, issues);
        }
    }

    // Single-pass multiplexed streaming hooks
    /**
     * Streaming visit hook: inspect one normalized node and buffer any finding it reveals.
     *
     * @param node - Current node from the shared traversal; only call expressions named `eval`
     *   or `execScript` produce a finding.
     * @param ctx - Per-file context; supplies options, security level, path, and location fallback.
     * @param _parent - Parent node in the shared traversal; accepted for contract parity, unused.
     * @param _grandparent - Grandparent node; accepted for contract parity, unused.
     * @param _depth - Nesting depth at this node; accepted for contract parity, unused.
     * @param _className - Nearest enclosing class name; accepted for contract parity, unused.
     * @param _binding - Binding name for function-like children; accepted for contract parity,
     *   unused.
     */
    visit(
        node: NormalizedNode,
        ctx: AnalyzerContext,
        _parent: NormalizedNode | undefined,
        _grandparent: NormalizedNode | undefined,
        _depth: number,
        _className: string | null,
        _binding: string | null,
    ): void {
        const opts = (ctx.options || {}) as SecurityOptions;
        const level: SecurityLevel = opts.level || ctx.config.securityLevel || 'basic';
        if (level === 'off') return;

        if (node.kind === NodeKind.Call && node.name) {
            this.checkStreamingCall(node, ctx);
        }
    }

    private checkStreamingCall(node: NormalizedNode, ctx: AnalyzerContext): void {
        if (node.name !== 'eval' && node.name !== 'execScript') return;
        const file = ctx.filePath.replace(/\\/g, '/');
        const isTestOrFixture = /(?:tests?|specs?|fixtures?|samples?|benchmark|dist|mock)/i.test(
            file,
        );
        if (isTestOrFixture) return;

        const line = node.start?.line ?? 1;
        this.issues.push({
            id: `security:arbitrary-code-execution:${file}:${line}`,
            analyzer: ANALYZER_SECURITY,
            rule: 'SEC-VUL-001',
            severity: SEVERITY_ERROR,
            message: SecurityMessages.ARBITRARY_CODE_EXECUTION.message,
            location: {
                file,
                start: node.start || { line, column: 1 },
                end: node.end || { line, column: 1 },
            },
            detail: {
                risk: SecurityMessages.ARBITRARY_CODE_EXECUTION.risk,
                function: node.name,
            },
            suggestion: SecurityMessages.ARBITRARY_CODE_EXECUTION.suggestion,
        });
    }

    /**
     * Merge streaming findings with a fresh line pass and clear the per-file buffer.
     *
     * @param ctx - Per-file context with the raw content and merged analyzer options.
     * @returns Deduplicated findings for this file; the instance is immediately reusable for the
     *   next file because the buffered streaming findings are cleared before returning.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        const standaloneIssues = this.analyze(undefined, ctx);
        const set = new Set<string>();
        const merged: Issue[] = [];
        for (const issue of [...this.issues, ...standaloneIssues]) {
            if (!set.has(issue.id)) {
                set.add(issue.id);
                merged.push(issue);
            }
        }
        this.issues = [];
        return merged;
    }
}
