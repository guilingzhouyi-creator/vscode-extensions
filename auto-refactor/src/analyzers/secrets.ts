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
 */

import type { Analyzer, AnalyzerContext, Issue, Severity, SecurityLevel } from '../core/types';
import { SecretMessages } from '../core/messages/secrets';

/** Named regex source pair used by the built-in and caller-supplied pattern tables. */
interface PatternDef {
    name: string;
    source: string;
}

const DEFAULT_PATTERNS: PatternDef[] = [
    { name: 'private-key', source: 'BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY' },
    { name: 'github-token', source: 'ghp_[A-Za-z0-9]{20,}' },
    { name: 'github-pat', source: 'github_pat_[A-Za-z0-9_]{20,}' },
    { name: 'openai-style-key', source: 'sk-[A-Za-z0-9]{20,}' },
    { name: 'aws-access-key', source: 'AKIA[0-9A-Z]{16}' },
];

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
 * @param s - Token to measure; an empty string yields 0 instead of dividing by zero.
 * @returns Entropy in bits per character, using a base-2 logarithm over the character histogram.
 */
function shannonEntropy(s: string): number {
    if (!s) return 0;
    const freq = new Map<string, number>();
    for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
    let h = 0;
    for (const n of freq.values()) {
        const p = n / s.length;
        h -= p * Math.log2(p);
    }
    return h;
}

/**
 * Line-oriented analyzer for hardcoded credentials and optional high-entropy tokens.
 *
 * The analyzer is synchronous and keeps no mutable per-file state, so one instance can be shared
 * across files without locks. Each call rebuilds its pattern list from the merged options; invalid
 * caller-supplied expressions therefore fail the current call rather than corrupting later ones.
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
    analyze(sf: import('typescript').SourceFile, ctx: AnalyzerContext): Issue[] {
        const opts = (ctx.options || {}) as SecretsOptions & { level?: SecurityLevel };
        const level: SecurityLevel = opts.level || ctx.config.securityLevel || 'basic';
        if (level === 'off') {
            return [];
        }

        const normPath = ctx.filePath.replace(/\\/g, '/');
        const isTestOrFixture = /(?:tests?|specs?|fixtures?|mocks?|benchmark)[\\/]/i.test(normPath);
        const ignoreInTests =
            opts.ignoreInTests !== undefined ? opts.ignoreInTests : level !== 'full';
        if (isTestOrFixture && ignoreInTests) {
            return [];
        }

        const base = opts.patterns
            ? opts.patterns.map((source, i) => ({ name: `custom-${i + 1}`, source }))
            : DEFAULT_PATTERNS;
        const patterns = [
            ...base.map((p) => ({ name: p.name, re: new RegExp(p.source) })),
            ...(opts.extraPatterns ?? []).map((source) => ({
                name: 'custom-extra',
                re: new RegExp(source),
            })),
        ];
        const entropy = {
            enabled: opts.entropy?.enabled !== undefined ? opts.entropy.enabled : level === 'full',
            minLength: opts.entropy?.minLength ?? DEFAULT_ENTROPY_MIN_LENGTH,
            threshold: opts.entropy?.threshold ?? DEFAULT_ENTROPY_THRESHOLD,
            severity: (opts.entropy?.severity ?? 'warning') as Severity,
        };
        const cap = opts.maxIssuesPerFile ?? DEFAULT_MAX_ISSUES_PER_FILE;

        const content = ctx.content || '';
        const len = content.length;
        const issues: Issue[] = [];
        const TOKEN_RE = /[A-Za-z0-9_\-=]{16,}/g;

        let lineStart = 0;
        let line = 1;

        while (lineStart < len) {
            if (issues.length >= cap) break;
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
            let matchedSecret = false;
            for (const p of patterns) {
                if (p.re.test(lineText)) {
                    const desc = SecretMessages.HARDCODED_SECRET(
                        p.name,
                        p.re.source.slice(0, REGEX_SOURCE_PREVIEW_LENGTH),
                    );
                    issues.push(
                        this.mkIssue(
                            ctx,
                            line,
                            'secret-detected',
                            desc.message,
                            { kind: p.name },
                            'error',
                            desc.suggestion,
                        ),
                    );
                    matchedSecret = true;
                    break; // At most one issue per line
                }
            }

            if (!matchedSecret && entropy.enabled) {
                TOKEN_RE.lastIndex = 0;
                let t: RegExpExecArray | null;
                while ((t = TOKEN_RE.exec(lineText)) !== null) {
                    const h = shannonEntropy(t[0]);
                    if (h >= entropy.threshold && t[0].length >= entropy.minLength) {
                        const desc = SecretMessages.HIGH_ENTROPY_TOKEN(h, t[0].length);
                        issues.push(
                            this.mkIssue(
                                ctx,
                                line,
                                'high-entropy-token',
                                desc.message,
                                { entropy: Number(h.toFixed(2)), length: t[0].length },
                                entropy.severity,
                                desc.suggestion,
                            ),
                        );
                        break;
                    }
                }
            }

            line++;
            lineStart = nextStart;
        }

        return issues;
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
        return this.analyze(undefined as any, ctx);
    }

    /**
     * Create one issue with an analyzer-qualified id and a normalized POSIX file path.
     *
     * @param ctx - Context supplying the raw file path that is normalized for the report.
     * @param line - One-based line number of the finding.
     * @param rule - Analyzer-local rule id, for example `secret-detected`.
     * @param message - Human-readable finding text.
     * @param detail - Structured payload whose keys depend on the rule that matched.
     * @param severity - Severity forwarded to reporters and the CI gate.
     * @param suggestion - Optional remediation; a credential-handling fallback is used when absent.
     * @returns A fully populated `Issue` with 1-based columns and a stable id.
     */
    private mkIssue(
        ctx: AnalyzerContext,
        line: number,
        rule: string,
        message: string,
        detail: Record<string, any>,
        severity: Severity,
        suggestion?: string,
    ): Issue {
        const file = ctx.filePath.replace(/\\/g, '/');
        return {
            id: `${this.name}:${rule}:${file}:${line}`,
            analyzer: this.name,
            rule,
            severity,
            message,
            location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
            detail,
            suggestion:
                suggestion ||
                'Extract credentials from source code; inject via environment variables or secret managers',
        };
    }
}
