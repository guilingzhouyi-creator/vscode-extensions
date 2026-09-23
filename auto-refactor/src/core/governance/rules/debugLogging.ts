/**
 * Module: Core Engine - Governance Rules - Debug Logging
 * File Path: src/core/governance/rules/debugLogging.ts
 * Architecture Role: File-level rule provider exporting DiagnosticLeakRule; the registry hands it
 *     to GovernanceAnalyzer, which invokes checkFile once per file in finalize().
 * Dependencies & Triggers: Imports the shared governance types and builds cached word/call regexes
 *     from ctx.capabilities.debugIdentifiers; runs on every scan/CI pass that enables governance.
 * Responsibilities: getDbgPatterns compiles and memoizes identifier regexes per identifier set;
 *     GOV-DBG-001 scans non-comment lines and reports debug/diagnostic calls in production code;
 *     the rule skips tests, testdata, benchmarks, scripts, samples, index.ts and cli.ts paths.
 * Exit Semantics & Design Rationale: checkFile returns null for excluded or clean files and a
 *     violation list for hits; it never throws, and findings are advisory warnings. The Map cache
 *     and ASCII prefix pre-check avoid repeated regex compilation and per-line allocation because
 *     debug output leaks diagnostics and can degrade production I/O throughput.
 */
import { fileNameEndsWith, isToolOrTestScript } from '../pathScope';
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';

/** ASCII code for a space, skipped while advancing past a line's leading whitespace. */
const CHAR_CODE_SPACE = 32;

/** ASCII code for a tab, skipped while advancing past a line's leading whitespace. */
const CHAR_CODE_TAB = 9;

/** ASCII code for `#`, the marker that starts a hash-style comment line. */
const CHAR_CODE_HASH = 35;

/** ASCII code for `/`, used to recognize a `//` comment opener. */
const CHAR_CODE_SLASH = 47;

/** ASCII code for `*`, used to recognize a block-comment continuation line. */
const CHAR_CODE_ASTERISK = 42;

interface CachedDbgPattern {
    id: string;
    wordRe: RegExp;
    callRe: RegExp;
}

const DBG_PATTERN_CACHE = new Map<string, CachedDbgPattern[]>();

function getDbgPatterns(identifiers: string[]): CachedDbgPattern[] {
    const key = identifiers.join('|');
    let patterns = DBG_PATTERN_CACHE.get(key);
    if (!patterns) {
        patterns = identifiers.map((dbg) => {
            const escaped = dbg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return {
                id: dbg,
                wordRe: new RegExp(`\\b${escaped}\\b`),
                callRe: new RegExp(`\\b${escaped}\\s*(?:\\(|;|\\b)`),
            };
        });
        DBG_PATTERN_CACHE.set(key, patterns);
    }
    return patterns;
}

/**
 * GOV-DBG-001: Diagnostic & Debug Statements in Production Code.
 * Ensures debugging statements do not leak into production paths.
 */
/**
 * Checks a single masked line against active diagnostic patterns.
 */
function checkDebugLine(
    line: string,
    lineIndex: number,
    patterns: ReturnType<typeof getDbgPatterns>,
    violations: GovernanceViolation[],
): void {
    // Fast ASCII comment pre-check (zero string allocation)
    let startIdx = 0;
    while (
        startIdx < line.length &&
        (line.charCodeAt(startIdx) === CHAR_CODE_SPACE ||
            line.charCodeAt(startIdx) === CHAR_CODE_TAB)
    ) {
        startIdx++;
    }
    if (startIdx >= line.length) return;
    const c0 = line.charCodeAt(startIdx);
    if (c0 === CHAR_CODE_HASH || c0 === CHAR_CODE_SLASH || c0 === CHAR_CODE_ASTERISK) {
        return;
    }

    for (let pIdx = 0; pIdx < patterns.length; pIdx++) {
        const pat = patterns[pIdx];
        if (!pat.wordRe.test(line)) continue;

        if (pat.callRe.test(line)) {
            const m = line.match(pat.wordRe);
            violations.push({
                ruleId: 'GOV-DBG-001',
                message: `Diagnostic call \`${pat.id}\` found in production file.`,
                line: lineIndex + 1,
                column: m && m.index != null ? m.index + 1 : line.search(pat.wordRe) + 1,
                suggestion:
                    'Remove debug statement or route through a configurable Logger interface.',
                fixable: false,
            });
            break;
        }
    }
}

/**
 * GOV-DBG-001: Diagnostic & Debug Statements in Production Code.
 * Ensures debugging statements do not leak into production paths.
 */
export const DiagnosticLeakRule: GovernanceRule = {
    id: 'GOV-DBG-001',
    name: 'Diagnostic & Debug Statements in Production Paths',
    category: 'debug_logging',
    severity: 'warning',
    risk: 'medium',
    rationale:
        'Debug and console print statements clutter standard outputs, leak diagnostics, and can degrade I/O throughput.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        // Skip tests, benchmarks, samples, and CLI entry points where console is normal.
        // Directory membership goes through the shared segment test rather than a substring:
        // `p.includes('/scripts/')` never matched the repository-relative paths this engine
        // produces (`scripts/bench.js` has no leading slash), so the guard was dead code and
        // reported 472 findings on this repository's own scripts directory.
        if (
            isToolOrTestScript(ctx.filePath) ||
            fileNameEndsWith(ctx.filePath, ['index.ts', 'cli.ts'])
        ) {
            return null;
        }

        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;
        const patterns = getDbgPatterns(ctx.capabilities.debugIdentifiers);

        if (!patterns.some((p) => ctx.content.includes(p.id))) {
            return null;
        }

        for (let i = 0; i < lines.length; i++) {
            checkDebugLine(lines[i], i, patterns, violations);
        }

        return violations.length > 0 ? violations : null;
    },
};
