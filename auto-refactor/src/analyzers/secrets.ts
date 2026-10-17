/**
 * Module: Static Analysis — Built-in Analyzer Suite (Secrets Detection)
 * File Path: src/analyzers/secrets.ts
 * Architecture Role: Regex- and entropy-based analyzer adapter implementing the Analyzer
 *   contract; scans raw content line by line and returns Issue[].
 * Dependencies & Triggers: Core types plus `SecretMessages` from ../core/messages/secrets;
 *   triggered by engine analyze()/finalize() passes at security levels basic/full, skipped
 *   when the level is off.
 * Responsibilities: Detect default credential patterns (private-key markers, GitHub ghp_ and
 *   github_pat_ tokens, sk- OpenAI-style keys, AWS AKIA access keys), apply caller-supplied
 *   `patterns`/`extraPatterns`, optionally flag high-entropy tokens (default minLength 24,
 *   threshold 4.2), suppress test/fixture/mock paths by default, and cap findings per file.
 * Exit Semantics & Design Rationale: Returns [] early for level 'off' or suppressed
 *   test/fixture/mock paths; otherwise Issue[] is capped at maxIssuesPerFile (default 50) with
 *   at most one match per line. The cap keeps vendored and minified files from flooding reports.
 *
 * Secrets Analyzer.
 *
 * Line-level credential/secret detection:
 * - Precise token patterns (private key markers, GitHub/AWS/OpenAI-style tokens) — ON by default
 * - Optional high-entropy string detection (Shannon entropy over ≥minLength alnum tokens)
 *   — OFF by default (minified/vendor files can be noisy; opt in per project)
 *
 * Language-agnostic (regex over raw content), cache-friendly like every built-in analyzer.
 * Patterns are fully configurable; `maxIssuesPerFile` caps flood on vendored content.
 * Emitted rules:
 *   - rule: 'secret-detected'
 *   - rule: 'high-entropy-token'
 */

import type {
    Analyzer,
    AnalyzerContext,
    Issue,
    Severity,
    SecurityLevel,
    AgentActionType,
} from '../core/types';
import { SecretMessages } from '../core/messages/secrets';
import {
    auditRegexSafety,
    isRegexSafe,
    safeRegexExecLoop,
    safeRegexTest,
} from '../utils/safe-regex';

/** Named regex source pair used by the built-in and caller-supplied pattern tables. */
interface PatternDef {
    name: string;
    source: string;
}

const RAW_BUILTIN_PATTERNS = `private-key:BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY
github-token:ghp_[A-Za-z0-9]{20,}
github-pat:github_pat_[A-Za-z0-9_]{20,}
openai-style-key:sk-[A-Za-z0-9]{20,}
aws-access-key:AKIA[0-9A-Z]{16}`;

const DEFAULT_PATTERNS: readonly PatternDef[] = Object.freeze(
    RAW_BUILTIN_PATTERNS.split('\n').map((entry) => {
        const colonIndex = entry.indexOf(':');
        return {
            name: entry.slice(0, colonIndex),
            source: entry.slice(colonIndex + 1),
        };
    }),
);

/** Default minimum token length for optional high-entropy secret detection. */
const DEFAULT_ENTROPY_MIN_LENGTH = 24;

/** Default Shannon entropy threshold, in bits per character, for high-entropy detection. */
const DEFAULT_ENTROPY_THRESHOLD = 4.2;

/** Default cap on secret findings reported per file, to avoid flooding reports. */
const DEFAULT_MAX_ISSUES_PER_FILE = 50;

/** ASCII code for a carriage return, used to trim CRLF line endings. */
const CHAR_CODE_CR = 13;

/** Maximum regex-source characters included in a secret finding's message. */
const REGEX_SOURCE_PREVIEW_LENGTH = 40;

const RULE_SECRET_DETECTED = 'secret-detected';
const RULE_HIGH_ENTROPY_TOKEN = 'high-entropy-token';
const ACTION_EXTRACT_CONSTANT: AgentActionType = 'extract_constant';
const ACTIONABLE_CODE_SECRET = 'AR:SCR:001';
const TEMPLATE_SNIPPET_SECRET = 'process.env.SECRET_KEY';
const LEVEL_OFF: SecurityLevel = 'off';
const LEVEL_FULL: SecurityLevel = 'full';
const LEVEL_BASIC: SecurityLevel = 'basic';
const SEVERITY_ERROR: Severity = 'error';
const SEVERITY_WARNING: Severity = 'warning';
const PATTERN_CUSTOM_PREFIX = 'custom-';
const PATTERN_EXTRA_NAME = 'custom-extra';
const MAX_REGEX_SAFETY_SLICE = 40;
const MAX_EXEC_LOOP_ITERATIONS = 100;
const ROUNDING_PRECISION_DIGITS = 2;

const SECRETS_ACTIONABLE_MAP: Record<
    string,
    { action: AgentActionType; code: string; safeToAutomate: boolean; templateSnippet: string }
> = {
    [RULE_SECRET_DETECTED]: {
        action: ACTION_EXTRACT_CONSTANT,
        code: ACTIONABLE_CODE_SECRET,
        safeToAutomate: false,
        templateSnippet: TEMPLATE_SNIPPET_SECRET,
    },
};

/**
 * Context parameters required to construct a canonical secret Issue record.
 */
export interface SecretIssueContext {
    readonly ctx: AnalyzerContext;
    readonly line: number;
    readonly rule: string;
    readonly message: string;
    readonly detail: Record<string, any>;
    readonly severity: Severity;
    readonly suggestion?: string;
}

/**
 * Line-level context passed to internal secret and entropy checkers.
 */
export interface SecretLineAuditContext {
    readonly lineText: string;
    readonly line: number;
    readonly ctx: AnalyzerContext;
    readonly issues: Issue[];
}

/**
 * Optional configuration for secret detection.
 *
 * Every field is optional. `patterns` replaces the built-in table, while `extraPatterns` appends
 * to whichever table is active. `entropy` is off by default unless the scan level is `full`;
 * `maxIssuesPerFile` caps flooding on vendored or minified content. The analyzer treats the
 * object as read-only and never mutates it.
 */
export interface SecretsOptions {
    /**
     * Complete replacement of default pattern table (regex source strings).
     * Built-in defaults used when unset.
     */
    patterns?: string[];
    /** Append additional patterns on top of default (or custom) patterns. */
    extraPatterns?: string[];
    /** High-entropy string detection (default off). */
    entropy?: {
        enabled?: boolean;
        /** Minimum token length, default 32 */
        minLength?: number;
        /** Shannon entropy threshold (bit/char), default 4.5 */
        threshold?: number;
        severity?: Severity;
    };
    /** Maximum issues per file (caps flooding on vendored content), default 50 */
    maxIssuesPerFile?: number;
    /**
     * Suppress secret detection in test / fixture / spec / mock paths.
     * Default true unless level is full or explicitly set to false.
     */
    ignoreInTests?: boolean;
    /** Additional substring markers or patterns to ignore. */
    ignoreMarkers?: string[];
}

/**
 * Compute the Shannon entropy of a token in bits per character.
 *
 * @param sourceText - Token to measure; an empty string yields 0 instead of dividing by zero.
 * @returns Entropy in bits per character, using a base-2 logarithm over the character histogram.
 */
function computeShannonEntropy(sourceText: string): number {
    if (!sourceText) return 0;
    const charFrequencyMap = new Map<string, number>();
    for (let charIndex = 0; charIndex < sourceText.length; charIndex++) {
        const charToken = sourceText[charIndex];
        const previousCount = charFrequencyMap.get(charToken) ?? 0;
        charFrequencyMap.set(charToken, previousCount + 1);
    }
    let entropyValue = 0;
    const totalChars = sourceText.length;
    for (const charCount of charFrequencyMap.values()) {
        const probability = charCount / totalChars;
        entropyValue -= probability * Math.log2(probability);
    }
    return entropyValue;
}

interface CompiledSecretPattern {
    name: string;
    re: RegExp;
}

interface ResolvedEntropyConfig {
    enabled: boolean;
    minLength: number;
    threshold: number;
    severity: Severity;
}

function shouldSkipSecrets(normPath: string, level: SecurityLevel, opts: SecretsOptions): boolean {
    if (level === LEVEL_OFF) return true;
    const isTestOrFixture = /(?:tests?|specs?|fixtures?|mocks?|benchmark)[\\/]/i.test(normPath);
    const ignoreInTests =
        opts.ignoreInTests !== undefined ? opts.ignoreInTests : level !== LEVEL_FULL;
    return isTestOrFixture && ignoreInTests;
}

function compileSecretPatterns(opts: SecretsOptions): CompiledSecretPattern[] {
    const base = opts.patterns
        ? opts.patterns.map((source, i) => ({ name: `${PATTERN_CUSTOM_PREFIX}${i + 1}`, source }))
        : DEFAULT_PATTERNS;

    // Validate user-supplied patterns for ReDoS risk. Patterns with known
    // dangerous constructs (nested quantifiers, alternation-inside-quantifiers)
    // are skipped with a console warning rather than silently running risky
    // regexes on untrusted file content.
    const compiled: CompiledSecretPattern[] = [];

    for (const p of base) {
        if (opts.patterns && !isRegexSafe(p.source)) {
            const warnings = auditRegexSafety(p.source);
            console.warn(`[secrets] Skipping unsafe pattern "${p.name}": ${warnings.join('; ')}`);
            continue;
        }
        compiled.push({ name: p.name, re: new RegExp(p.source) });
    }

    if (opts.extraPatterns) {
        for (const source of opts.extraPatterns) {
            if (!isRegexSafe(source)) {
                const warnings = auditRegexSafety(source);
                console.warn(
                    `[secrets] Skipping unsafe extraPattern "${source.slice(0, MAX_REGEX_SAFETY_SLICE)}": ${warnings.join('; ')}`,
                );
                continue;
            }
            compiled.push({ name: PATTERN_EXTRA_NAME, re: new RegExp(source) });
        }
    }

    return compiled;
}

/**
 * Line-oriented analyzer for hardcoded credentials and optional high-entropy tokens.
 *
 * The analyzer is synchronous and keeps no mutable per-file state, so one instance can be shared
 * across files without locks. Each call rebuilds its pattern list from the merged options; invalid
 * caller-supplied expressions therefore fail the current call rather than corrupting later ones.
 */
function resolveEntropyConfig(opts: SecretsOptions, level: SecurityLevel): ResolvedEntropyConfig {
    return {
        enabled: opts.entropy?.enabled !== undefined ? opts.entropy.enabled : level === LEVEL_FULL,
        minLength: opts.entropy?.minLength ?? DEFAULT_ENTROPY_MIN_LENGTH,
        threshold: opts.entropy?.threshold ?? DEFAULT_ENTROPY_THRESHOLD,
        severity: (opts.entropy?.severity ?? SEVERITY_WARNING) as Severity,
    };
}

/**
 * Secrets and credentials leak analyzer.
 * Detects hardcoded passwords, tokens, API keys, private keys, and high-entropy strings.
 */
export class SecretsAnalyzer implements Analyzer {
    name = 'secrets' as const;

    /**
     * Analyze one file and return bounded secret findings.
     *
     * @param sf - Parsed TypeScript source file; unused because detection reads `ctx.content`.
     * @param ctx - Per-file context with raw content, normalized path, merged options, and level.
     * @returns At most `maxIssuesPerFile` issues, at most one per line; empty for off/suppressed.
     * @throws SyntaxError - When a caller-supplied pattern string is not a valid regex.
     */
    analyze(sf: import('typescript').SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        void sf;
        const opts = (ctx.options || {}) as SecretsOptions & { level?: SecurityLevel };
        const level: SecurityLevel = opts.level || ctx.config.securityLevel || LEVEL_BASIC;
        const normPath = ctx.filePath.replace(/\\/g, '/');
        if (shouldSkipSecrets(normPath, level, opts)) {
            return [];
        }

        const patterns = compileSecretPatterns(opts);
        const entropy = resolveEntropyConfig(opts, level);
        const cap = opts.maxIssuesPerFile ?? DEFAULT_MAX_ISSUES_PER_FILE;

        const content = ctx.content || '';
        const len = content.length;
        const issues: Issue[] = [];

        let lineStart = 0;
        let line = 1;

        while (lineStart < len) {
            if (issues.length >= cap) break;
            const { lineText, nextStart } = this.extractNextLine(content, lineStart, len);

            const auditCtx: SecretLineAuditContext = { lineText, line, ctx, issues };
            const matchedSecret = this.checkSecretPatterns(auditCtx, patterns);
            if (!matchedSecret && entropy.enabled) {
                this.checkEntropyTokens(auditCtx, entropy);
            }

            line++;
            lineStart = nextStart;
        }

        for (const issueItem of issues) {
            if (!issueItem.actionable && SECRETS_ACTIONABLE_MAP[issueItem.rule]) {
                const mapped = SECRETS_ACTIONABLE_MAP[issueItem.rule];
                issueItem.actionable = {
                    action: mapped.action,
                    code: mapped.code,
                    safeToAutomate: mapped.safeToAutomate,
                    templateSnippet: mapped.templateSnippet,
                };
            }
        }

        return issues;
    }

    private extractNextLine(
        content: string,
        lineStart: number,
        len: number,
    ): { lineText: string; nextStart: number } {
        let lineEnd = content.indexOf('\n', lineStart);
        if (lineEnd === -1) return { lineText: content.slice(lineStart, len), nextStart: len };
        const nextStart = lineEnd + 1;
        if (lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === CHAR_CODE_CR) {
            lineEnd--;
        }
        return { lineText: content.slice(lineStart, lineEnd), nextStart };
    }

    private checkSecretPatterns(
        context: SecretLineAuditContext,
        patterns: CompiledSecretPattern[],
    ): boolean {
        for (const p of patterns) {
            // Use safeRegexTest: direct for short lines, bounded for long lines
            // (e.g. minified content on a single line). All secret patterns are
            // keyword-level triggers, so truncating long lines is safe.
            if (safeRegexTest(p.re, context.lineText)) {
                const desc = SecretMessages.HARDCODED_SECRET(
                    p.name,
                    p.re.source.slice(0, REGEX_SOURCE_PREVIEW_LENGTH),
                );
                context.issues.push(
                    this.makeSecretIssue({
                        ctx: context.ctx,
                        line: context.line,
                        rule: RULE_SECRET_DETECTED,
                        message: desc.message,
                        detail: { kind: p.name },
                        severity: SEVERITY_ERROR,
                        suggestion: desc.suggestion,
                    }),
                );
                return true; // At most one issue per line
            }
        }
        return false;
    }

    private checkEntropyTokens(
        context: SecretLineAuditContext,
        entropy: ResolvedEntropyConfig,
    ): void {
        const TOKEN_RE = /[A-Za-z0-9_\-=]{16,}/g;
        // Use bounded exec loop to cap work on extremely long lines (e.g. minified).
        // TOKEN_RE itself has no nested quantifiers, but a very long alphanumeric
        // line could produce thousands of matches — the iteration cap prevents
        // unbounded entropy computation per line.
        safeRegexExecLoop(
            TOKEN_RE,
            context.lineText,
            (tokenMatch) => {
                const tokenEntropy = computeShannonEntropy(tokenMatch[0]);
                if (
                    tokenEntropy >= entropy.threshold &&
                    tokenMatch[0].length >= entropy.minLength
                ) {
                    const desc = SecretMessages.HIGH_ENTROPY_TOKEN(
                        tokenEntropy,
                        tokenMatch[0].length,
                    );
                    context.issues.push(
                        this.makeSecretIssue({
                            ctx: context.ctx,
                            line: context.line,
                            rule: RULE_HIGH_ENTROPY_TOKEN,
                            message: desc.message,
                            detail: {
                                entropy: Number(tokenEntropy.toFixed(ROUNDING_PRECISION_DIGITS)),
                                length: tokenMatch[0].length,
                            },
                            severity: entropy.severity,
                            suggestion: desc.suggestion,
                        }),
                    );
                    return false; // Stop at first match per line (at most one per line)
                }
                return true; // Continue scanning
            },
            MAX_EXEC_LOOP_ITERATIONS,
        );
    }

    /**
     * Finalize hook for callers that use the streaming analyzer contract.
     *
     * @param ctx - Per-file context with the raw content and merged analyzer options.
     * @returns The same bounded findings that `analyze` would return for `ctx`; no state is
     *   accumulated between calls because this analyzer does not implement `visit`.
     * @throws SyntaxError - When a caller-supplied pattern string is not a valid regex.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    /**
     * Create one issue with an analyzer-qualified id and a normalized POSIX file path.
     *
     * @param params - Context parameters required to construct canonical secret issue.
     * @returns A fully populated `Issue` with 1-based columns and a stable id.
     */
    private makeSecretIssue(params: SecretIssueContext): Issue {
        const file = params.ctx.filePath.replace(/\\/g, '/');
        const mapped = SECRETS_ACTIONABLE_MAP[params.rule];
        const actionable = mapped
            ? {
                  action: mapped.action,
                  code: mapped.code,
                  safeToAutomate: mapped.safeToAutomate,
                  templateSnippet: mapped.templateSnippet,
              }
            : undefined;
        return {
            id: `${this.name}:${params.rule}:${file}:${params.line}`,
            analyzer: this.name,
            rule: params.rule,
            severity: params.severity,
            message: params.message,
            location: {
                file,
                start: { line: params.line, column: 1 },
                end: { line: params.line, column: 1 },
            },
            detail: params.detail,
            suggestion:
                params.suggestion ||
                'Extract credentials from source code; inject via environment variables or secret managers',
            actionable,
        };
    }
}
