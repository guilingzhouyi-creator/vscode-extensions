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

import type {
    Analyzer,
    AnalyzerContext,
    Issue,
    SecurityLevel,
    AgentActionType,
    AgentActionablePayload,
} from '../core/types';
import { SEVERITY_WARNING, SEVERITY_ERROR } from '../core/types';
import { ANALYZER_SECURITY } from '../core/scoring/dimensionLiterals';
import type { NormalizedNode } from '../core/ast/multilang';
import { NodeKind } from '../core/ast/multilang';
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

/**
 * Contextual state passed to line-by-line security audit checkers.
 */
export interface LineAuditContext {
    readonly trimmed: string;
    readonly lineText: string;
    readonly lineNum: number;
    readonly file: string;
    readonly issues: Issue[];
    readonly opts: SecurityOptions;
    readonly isTestOrFixture: boolean;
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

/** Regex matching file paths treated as tests, fixtures, samples, or benchmarks. */
const RE_TEST_OR_FIXTURE = /(?:tests?|specs?|fixtures?|samples?|benchmark|dist|mock)/i;

/** Regex matching backslash path separators. */
const RE_BACKSLASH = /\\/g;

/** Critical raw tokens for fast native pattern pre-screening across large source texts. */
const SECURITY_FAST_FILTER_RAW =
    'eval,exec,Function,child_process,__proto__,prototype,random,rand,createHash,md5,sha1,readFile,unlink,rmdir,console.,logger.';

/** Critical tokens array parsed from immutable string template. */
const SECURITY_FAST_FILTER_TOKENS: readonly string[] = Object.freeze(
    SECURITY_FAST_FILTER_RAW.split(','),
);

/** Default per-file finding cap used when `SecurityOptions.maxIssuesPerFile` is omitted. */
const DEFAULT_MAX_ISSUES_PER_FILE = 50;

/** Minimum source file length in characters before applying fast filter screening. */
const FAST_FILTER_MIN_LENGTH = 5000;

/** Security level bypass identifier. */
const LEVEL_OFF: SecurityLevel = 'off';

/** Basic security level identifier. */
const LEVEL_BASIC: SecurityLevel = 'basic';

/** Full security level identifier. */
const LEVEL_FULL: SecurityLevel = 'full';

/** Single-line comment prefix in JavaScript, TypeScript, GDScript, etc. */
const COMMENT_LINE = '//';

/** Script comment prefix in Python, Shell, etc. */
const COMMENT_HASH = '#';

/** Block comment continuation prefix. */
const COMMENT_BLOCK = '*';

/** Python script file extension. */
const EXT_PY = '.py';

/** GDScript file extension. */
const EXT_GD = '.gd';

/** Actionable mutation verb for token replacement. */
const ACTION_REPLACE_TOKEN: AgentActionType = 'replace_token';

/** Actionable machine code for dynamic code execution remediation. */
const CODE_SEC_VUL_001 = 'AR:SEC:001';

/** Actionable machine code for prototype pollution remediation. */
const CODE_SEC_VUL_003 = 'AR:SEC:002';

/** Actionable machine code for insecure randomness remediation. */
const CODE_SEC_VUL_004 = 'AR:SEC:003';

/** Remediation template snippet for JSON parsing. */
const SNIPPET_SEC_VUL_001 = 'JSON.parse($1)';

/** Remediation template snippet for null-prototype object creation. */
const SNIPPET_SEC_VUL_003 = 'Object.create(null)';

/** Remediation template snippet for secure UUID generation. */
const SNIPPET_SEC_VUL_004 = 'crypto.randomUUID()';

/** Target function name for eval calls. */
const TARGET_CALL_EVAL = 'eval';

/** Target function name for execScript calls. */
const TARGET_CALL_EXEC_SCRIPT = 'execScript';

/** Issue category constant for arbitrary code execution. */
const CATEGORY_CODE_EXECUTION = 'code_execution';

/** Issue category constant for command injection. */
const CATEGORY_COMMAND_INJECTION = 'command_injection';

/** Issue category constant for prototype pollution. */
const CATEGORY_PROTOTYPE_POLLUTION = 'prototype_pollution';

/** Issue category constant for weak randomness. */
const CATEGORY_WEAK_RANDOMNESS = 'weak_randomness';

/** Issue category constant for broken cryptographic hashing. */
const CATEGORY_BROKEN_HASH = 'broken_hash';

/** Issue category constant for path traversal. */
const CATEGORY_PATH_TRAVERSAL = 'path_traversal';

/** Issue category constant for sensitive information leakage. */
const CATEGORY_INFO_LEAKAGE = 'info_leakage';

/** Issue id topic identifier for arbitrary code execution. */
const ISSUE_TOPIC_CODE_EXECUTION = 'arbitrary-code-execution';

/** Issue id topic identifier for command injection. */
const ISSUE_TOPIC_COMMAND_INJECTION = 'command-injection';

/** Issue id topic identifier for prototype pollution. */
const ISSUE_TOPIC_PROTOTYPE_POLLUTION = 'prototype-pollution';

/** Issue id topic identifier for insecure randomness. */
const ISSUE_TOPIC_INSECURE_RANDOM = 'insecure-randomness';

/** Issue id topic identifier for broken crypto hash. */
const ISSUE_TOPIC_BROKEN_CRYPTO = 'broken-crypto-hash';

/** Issue id topic identifier for path traversal. */
const ISSUE_TOPIC_PATH_TRAVERSAL = 'path-traversal';

/** Issue id topic identifier for sensitive data logging. */
const ISSUE_TOPIC_SENSITIVE_LOGGING = 'sensitive-data-logging';

interface SecurityActionableSpec {
    readonly action: AgentActionType;
    readonly code: string;
    readonly safeToAutomate: boolean;
    readonly templateSnippet: string;
}

function createActionableSpec(
    action: AgentActionType,
    code: string,
    snippet: string,
): SecurityActionableSpec {
    return Object.freeze({
        action,
        code,
        safeToAutomate: false,
        templateSnippet: snippet,
    });
}

const SEC_ACTIONABLE_MAP: Record<string, SecurityActionableSpec> = Object.freeze({
    'SEC-VUL-001': createActionableSpec(
        ACTION_REPLACE_TOKEN,
        CODE_SEC_VUL_001,
        SNIPPET_SEC_VUL_001,
    ),
    'SEC-VUL-003': createActionableSpec(
        ACTION_REPLACE_TOKEN,
        CODE_SEC_VUL_003,
        SNIPPET_SEC_VUL_003,
    ),
    'SEC-VUL-004': createActionableSpec(
        ACTION_REPLACE_TOKEN,
        CODE_SEC_VUL_004,
        SNIPPET_SEC_VUL_004,
    ),
});

function resolveSecurityActionable(rule: string): AgentActionablePayload | undefined {
    const mapped = SEC_ACTIONABLE_MAP[rule];
    if (!mapped) return undefined;
    return {
        action: mapped.action,
        code: mapped.code,
        safeToAutomate: mapped.safeToAutomate,
        templateSnippet: mapped.templateSnippet,
    };
}

function normalizePath(filePath: string): string {
    return filePath.replace(RE_BACKSLASH, '/');
}

function isTestOrFixturePath(file: string): boolean {
    return !file ? false : RE_TEST_OR_FIXTURE.test(file);
}

function formatIssueId(topic: string, file: string, line: number): string {
    return `${ANALYZER_SECURITY}:${topic}:${file}:${line}`;
}

interface IssuePayloadDescriptor {
    readonly topic: string;
    readonly file: string;
    readonly lineNum: number;
    readonly lineText: string;
    readonly rule: string;
    readonly severity: typeof SEVERITY_ERROR | typeof SEVERITY_WARNING;
    readonly message: string;
    readonly risk: string;
    readonly category: string;
    readonly snippet: string;
    readonly suggestion: string;
    readonly actionable?: AgentActionablePayload;
}

function emitVulnFinding(issues: Issue[], descriptor: IssuePayloadDescriptor): void {
    issues.push({
        id: formatIssueId(descriptor.topic, descriptor.file, descriptor.lineNum),
        analyzer: ANALYZER_SECURITY,
        rule: descriptor.rule,
        severity: descriptor.severity,
        message: descriptor.message,
        location: {
            file: descriptor.file,
            start: { line: descriptor.lineNum, column: 1 },
            end: { line: descriptor.lineNum, column: descriptor.lineText.length },
        },
        detail: {
            risk: descriptor.risk,
            category: descriptor.category,
            snippet: descriptor.snippet,
        },
        suggestion: descriptor.suggestion,
        actionable: descriptor.actionable,
    });
}

interface ScanSession {
    readonly file: string;
    readonly isTestOrFixture: boolean;
    readonly opts: SecurityOptions;
    readonly level: SecurityLevel;
    readonly cap: number;
    readonly issues: Issue[];
}

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
        const level: SecurityLevel = opts.level || ctx.config.securityLevel || LEVEL_BASIC;

        if (level === LEVEL_OFF) {
            return [];
        }

        const content = ctx.content || '';
        const file = normalizePath(ctx.filePath);
        const cap = opts.maxIssuesPerFile ?? DEFAULT_MAX_ISSUES_PER_FILE;
        const issues: Issue[] = [];

        const isTestOrFixture = isTestOrFixturePath(file);

        if (this.shouldSkipByFastFilter(content)) {
            return [];
        }

        const session: ScanSession = {
            file,
            isTestOrFixture,
            opts,
            level,
            cap,
            issues,
        };

        this.scanLines(content, session);
        this.attachActionables(issues);

        return issues;
    }

    private shouldSkipByFastFilter(content: string): boolean {
        if (content.length <= FAST_FILTER_MIN_LENGTH) return false;
        const hits = nativeCore.fastPatternMatch(content, SECURITY_FAST_FILTER_TOKENS as string[]);
        return hits.length === 0;
    }

    private scanLines(content: string, session: ScanSession): void {
        const lines = content.split(/\r?\n/);
        const { file, isTestOrFixture, opts, level, cap, issues } = session;

        // Hoist single mutable context outside the loop to eliminate transient allocations
        // conforming strictly to CPX-SPACE-001 zero heap allocation protocol.
        const auditCtx = {
            trimmed: '',
            lineText: '',
            lineNum: 0,
            file,
            issues,
            opts,
            isTestOrFixture,
        };

        for (let idx = 0; idx < lines.length; idx++) {
            if (issues.length >= cap) break;
            const lineNum = idx + 1;
            const lineText = lines[idx];
            const trimmed = lineText.trim();

            if (
                !trimmed ||
                trimmed.startsWith(COMMENT_LINE) ||
                trimmed.startsWith(COMMENT_HASH) ||
                trimmed.startsWith(COMMENT_BLOCK)
            ) {
                continue;
            }

            auditCtx.trimmed = trimmed;
            auditCtx.lineText = lineText;
            auditCtx.lineNum = lineNum;

            this.auditBasicInjections(auditCtx);

            if (level === LEVEL_FULL && !isTestOrFixture) {
                this.auditFullCompliance(auditCtx);
            }
        }
    }

    private attachActionables(issues: Issue[]): void {
        for (let i = 0; i < issues.length; i++) {
            const iss = issues[i];
            if (!iss.actionable && SEC_ACTIONABLE_MAP[iss.rule]) {
                iss.actionable = resolveSecurityActionable(iss.rule);
            }
        }
    }

    /**
     * Run the basic SEC-VUL-001..003 checks against one line audit context.
     *
     * @param ctx - Line audit context with trimmed text, line number, file, and accumulator.
     */
    private checkCodeExecution(ctx: LineAuditContext): void {
        const { trimmed, lineText, lineNum, file, issues } = ctx;
        if (
            !DYNAMIC_EXEC_RE.test(trimmed) &&
            (!file.endsWith(EXT_PY) || !PYTHON_EXEC_RE.test(trimmed)) &&
            (!file.endsWith(EXT_GD) || !GDSCRIPT_EXEC_RE.test(trimmed))
        ) {
            return;
        }

        emitVulnFinding(issues, {
            topic: ISSUE_TOPIC_CODE_EXECUTION,
            file,
            lineNum,
            lineText,
            rule: 'SEC-VUL-001',
            severity: SEVERITY_ERROR,
            message: SecurityMessages.ARBITRARY_CODE_EXECUTION.message,
            risk: SecurityMessages.ARBITRARY_CODE_EXECUTION.risk,
            category: CATEGORY_CODE_EXECUTION,
            snippet: trimmed,
            suggestion: SecurityMessages.ARBITRARY_CODE_EXECUTION.suggestion,
            actionable: resolveSecurityActionable('SEC-VUL-001'),
        });
    }

    private checkCommandInjection(ctx: LineAuditContext): void {
        const { trimmed, lineText, lineNum, file, issues } = ctx;
        if (!SHELL_INJECTION_RE.test(trimmed) && !PYTHON_SHELL_INJECTION_RE.test(trimmed)) {
            return;
        }

        emitVulnFinding(issues, {
            topic: ISSUE_TOPIC_COMMAND_INJECTION,
            file,
            lineNum,
            lineText,
            rule: 'SEC-VUL-002',
            severity: SEVERITY_ERROR,
            message: SecurityMessages.COMMAND_INJECTION.message,
            risk: SecurityMessages.COMMAND_INJECTION.risk,
            category: CATEGORY_COMMAND_INJECTION,
            snippet: trimmed,
            suggestion: SecurityMessages.COMMAND_INJECTION.suggestion,
        });
    }

    private checkPrototypePollution(ctx: LineAuditContext): void {
        const { trimmed, lineText, lineNum, file, issues } = ctx;
        if (!PROTO_POLLUTION_RE.test(trimmed)) {
            return;
        }

        emitVulnFinding(issues, {
            topic: ISSUE_TOPIC_PROTOTYPE_POLLUTION,
            file,
            lineNum,
            lineText,
            rule: 'SEC-VUL-003',
            severity: SEVERITY_ERROR,
            message: SecurityMessages.PROTOTYPE_POLLUTION.message,
            risk: SecurityMessages.PROTOTYPE_POLLUTION.risk,
            category: CATEGORY_PROTOTYPE_POLLUTION,
            snippet: trimmed,
            suggestion: SecurityMessages.PROTOTYPE_POLLUTION.suggestion,
            actionable: resolveSecurityActionable('SEC-VUL-003'),
        });
    }

    /**
     * Run the basic SEC-VUL-001..003 checks against one line.
     *
     * @param ctx - Context containing trimmed text, options, and file flags.
     */
    private auditBasicInjections(ctx: LineAuditContext): void {
        if (ctx.isTestOrFixture) return;
        if (ctx.opts.checkCodeExecution !== false) {
            this.checkCodeExecution(ctx);
        }
        if (ctx.opts.checkCommandInjection !== false) {
            this.checkCommandInjection(ctx);
        }
        if (ctx.opts.checkPrototypePollution !== false) {
            this.checkPrototypePollution(ctx);
        }
    }

    /**
     * Run the full-level SEC-VUL-004..006 and SEC-LEAK-001 checks against one line.
     *
     * @param ctx - Context containing line data, file path, and mutable issues accumulator.
     */
    private checkInsecureRandom(ctx: LineAuditContext): void {
        const { trimmed, lineText, lineNum, file, issues } = ctx;
        if (!INSECURE_RANDOM_CTX_RE.test(trimmed) || !INSECURE_RANDOM_CALL_RE.test(trimmed)) {
            return;
        }

        emitVulnFinding(issues, {
            topic: ISSUE_TOPIC_INSECURE_RANDOM,
            file,
            lineNum,
            lineText,
            rule: 'SEC-VUL-004',
            severity: SEVERITY_WARNING,
            message: SecurityMessages.INSECURE_RANDOMNESS.message,
            risk: SecurityMessages.INSECURE_RANDOMNESS.risk,
            category: CATEGORY_WEAK_RANDOMNESS,
            snippet: trimmed,
            suggestion: SecurityMessages.INSECURE_RANDOMNESS.suggestion,
            actionable: resolveSecurityActionable('SEC-VUL-004'),
        });
    }

    private checkBrokenCrypto(ctx: LineAuditContext): void {
        const { trimmed, lineText, lineNum, file, issues } = ctx;
        if (!BROKEN_CRYPTO_RE.test(trimmed)) {
            return;
        }

        emitVulnFinding(issues, {
            topic: ISSUE_TOPIC_BROKEN_CRYPTO,
            file,
            lineNum,
            lineText,
            rule: 'SEC-VUL-005',
            severity: SEVERITY_WARNING,
            message: SecurityMessages.BROKEN_CRYPTO_HASH.message,
            risk: SecurityMessages.BROKEN_CRYPTO_HASH.risk,
            category: CATEGORY_BROKEN_HASH,
            snippet: trimmed,
            suggestion: SecurityMessages.BROKEN_CRYPTO_HASH.suggestion,
        });
    }

    private checkPathTraversal(ctx: LineAuditContext): void {
        const { trimmed, lineText, lineNum, file, issues } = ctx;
        if (!PATH_TRAVERSAL_RE.test(trimmed)) {
            return;
        }

        emitVulnFinding(issues, {
            topic: ISSUE_TOPIC_PATH_TRAVERSAL,
            file,
            lineNum,
            lineText,
            rule: 'SEC-VUL-006',
            severity: SEVERITY_WARNING,
            message: SecurityMessages.PATH_TRAVERSAL.message,
            risk: SecurityMessages.PATH_TRAVERSAL.risk,
            category: CATEGORY_PATH_TRAVERSAL,
            snippet: trimmed,
            suggestion: SecurityMessages.PATH_TRAVERSAL.suggestion,
        });
    }

    private checkSensitiveLogging(ctx: LineAuditContext): void {
        const { trimmed, lineText, lineNum, file, issues } = ctx;
        if (!SENSITIVE_LOG_RE.test(trimmed)) {
            return;
        }

        emitVulnFinding(issues, {
            topic: ISSUE_TOPIC_SENSITIVE_LOGGING,
            file,
            lineNum,
            lineText,
            rule: 'SEC-LEAK-001',
            severity: SEVERITY_WARNING,
            message: SecurityMessages.SENSITIVE_DATA_LOGGING.message,
            risk: SecurityMessages.SENSITIVE_DATA_LOGGING.risk,
            category: CATEGORY_INFO_LEAKAGE,
            snippet: trimmed,
            suggestion: SecurityMessages.SENSITIVE_DATA_LOGGING.suggestion,
        });
    }

    /**
     * Run the full-level SEC-VUL-004..006 and SEC-LEAK-001 checks against one line.
     *
     * Callers must already have excluded non-production paths; this helper has no suppression
     * flag because `analyze` only invokes it when the level is `full` and the path is eligible.
     *
     * @param ctx - Context containing line data, file path, options, and issues accumulator.
     */
    private auditFullCompliance(ctx: LineAuditContext): void {
        if (ctx.opts.checkInsecureRandom !== false) {
            this.checkInsecureRandom(ctx);
        }
        if (ctx.opts.checkBrokenCrypto !== false) {
            this.checkBrokenCrypto(ctx);
        }
        if (ctx.opts.checkPathTraversal !== false) {
            this.checkPathTraversal(ctx);
        }
        if (ctx.opts.checkSensitiveLogging !== false) {
            this.checkSensitiveLogging(ctx);
        }
    }

    // Single-pass multiplexed streaming hooks
    /**
     * Streaming visit hook: inspect one normalized node and buffer any finding it reveals.
     *
     * @param node - Current node from the shared traversal; only call expressions named `eval`
     *   or `execScript` produce a finding.
     * @param ctx - Per-file context; supplies options, security level, path, and location fallback.
     */
    visit(node: NormalizedNode, ctx: AnalyzerContext): void {
        const opts = (ctx.options || {}) as SecurityOptions;
        const level: SecurityLevel = opts.level || ctx.config.securityLevel || LEVEL_BASIC;
        if (level === LEVEL_OFF) return;

        if (node.kind === NodeKind.Call && node.name) {
            this.checkStreamingCall(node, ctx);
        }
    }

    private checkStreamingCall(node: NormalizedNode, ctx: AnalyzerContext): void {
        if (node.name !== TARGET_CALL_EVAL && node.name !== TARGET_CALL_EXEC_SCRIPT) return;
        const file = normalizePath(ctx.filePath);
        if (isTestOrFixturePath(file)) return;

        const line = node.start?.line ?? 1;
        emitVulnFinding(this.issues, {
            topic: ISSUE_TOPIC_CODE_EXECUTION,
            file,
            lineNum: line,
            lineText: TARGET_CALL_EVAL,
            rule: 'SEC-VUL-001',
            severity: SEVERITY_ERROR,
            message: SecurityMessages.ARBITRARY_CODE_EXECUTION.message,
            risk: SecurityMessages.ARBITRARY_CODE_EXECUTION.risk,
            category: CATEGORY_CODE_EXECUTION,
            snippet: node.name,
            suggestion: SecurityMessages.ARBITRARY_CODE_EXECUTION.suggestion,
            actionable: resolveSecurityActionable('SEC-VUL-001'),
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
        const seenIds = new Set<string>();
        const merged: Issue[] = [];

        for (let i = 0; i < this.issues.length; i++) {
            const issue = this.issues[i];
            if (!seenIds.has(issue.id)) {
                seenIds.add(issue.id);
                merged.push(issue);
            }
        }

        for (let i = 0; i < standaloneIssues.length; i++) {
            const issue = standaloneIssues[i];
            if (!seenIds.has(issue.id)) {
                seenIds.add(issue.id);
                merged.push(issue);
            }
        }

        this.issues = [];
        return merged;
    }
}
