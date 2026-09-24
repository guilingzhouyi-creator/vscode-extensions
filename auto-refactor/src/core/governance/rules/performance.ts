/**
 * Module: Core Engine - Governance Rules - Performance
 * File Path: src/core/governance/rules/performance.ts
 * Architecture Role: File-level rule provider exporting LoopInvariantRule,
 *     InLoopLinearSearchRule, TimerLiteralRule and SyncIoRule for the governance analyzer.
 * Dependencies & Triggers: Imports shared governance types; registry language gating limits
 *     TimerLiteralRule and SyncIoRule to TypeScript/JavaScript; checkFile runs once per file in
 *     GovernanceAnalyzer.finalize during scan, CI and daemon executions.
 * Responsibilities: LoopInvariantRule tracks loop indentation and flags expensive config/JSON/regex
 *     or sync-read operations in loop bodies; InLoopLinearSearchRule flags .find/.indexOf/.includes
 *     used inside loops; TimerLiteralRule rejects non-zero numeric setTimeout/setInterval delays;
 *     SyncIoRule reports sync fs calls except in declaration and test files.
 * Exit Semantics & Design Rationale: checkFile returns null when a file is clean and a violation
 *     list otherwise; it never throws and findings are non-fixable guidance. Hoisting avoids O(N*M)
 *     rescans, numeric timer literals bypass clamping (zero/negative can spin a ~1ms busy loop),
 *     and sync I/O stalls the host event loop, so each rule encodes the failure mode it prevents.
 */
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';
import { NEED_RUNTIME_EVIDENCE } from '../../types';
import { globToRegExp, matchAny } from '../../file-discovery';

/** Governance category shared by every performance rule exported from this file. */
const PERFORMANCE_CATEGORY = 'performance';

const SEVERITY_WARN = 'warning' as const;
const SEVERITY_INFO_LEVEL = 'info' as const;
const RISK_HIGH = 'high' as const;
const RISK_MEDIUM = 'medium' as const;

/** Line-comment prefix skipped by the line-scanning rules in this file. */
const LINE_COMMENT = '//';

const LOOP_HEAD_RE = /^\s*(?:for|while)\s*[({:]/;
const LINEAR_SEARCH_RE = /\b([a-zA-Z0-9_$]+)\.(find|indexOf|includes)\s*\(/;
const TEXT_VARIABLE_RE =
    /^(?:line|str|text|content|src|name|token|word|buf|buffer|key|val|value|raw|msg|message|query|url|path|file|specifier|uri|route|comment|prefix|suffix|pattern|char|cmd|arg|call|norm|pkg|trimmed|cleanLine|source|code|chunk|segment|snippet|title|desc|body|header|s|[a-zA-Z0-9_$]*(?:str|text|line|content|name|msg|query|url|path|file|specifier|uri|route|buf|buffer|pattern|chunk|slice|segment|expr|raw|comment|arg|call|norm|pkg|snippet|desc|body|title)|s)$/i;
const EXPENSIVE_OPS_RE =
    /GameConfig\.get_|JSON\.parse\(|fs\.readFileSync\(|new RegExp\(|readFileSync\(/;
const TIMER_CALL_RE = /set(?:Timeout|Interval)\s*\(/;
const TIMER_LITERAL_RE = /,\s*(\d+)\s*[,)]/;
const SYNC_FS_RE =
    /\b(?:readFileSync|writeFileSync|appendFileSync|copyFileSync|readdirSync|accessSync|existsSync|statSync|lstatSync|rmSync|rmdirSync|mkdirSync|openSync|closeSync|renameSync|unlinkSync)\s*\(/;

/**
 * Checks if a line in a loop body executes an expensive loop-invariant operation.
 */
function checkExpensiveLoopOp(
    line: string,
    lineIndex: number,
    violations: GovernanceViolation[],
): void {
    const match = line.match(EXPENSIVE_OPS_RE);
    if (!match) return;
    const op = match[0];
    violations.push({
        ruleId: 'GOV-PRF-001',
        message: `Potentially loop-invariant expensive operation \`${op.replace(/[(_]/g, '')}\` executed inside loop body.`,
        line: lineIndex + 1,
        column: match.index != null ? match.index + 1 : 1,
        suggestion:
            'Hoist the configuration lookup or expensive resource creation before the loop.',
        fixable: false,
        evidence: {
            confidence: 0.7,
            requiresRuntime: true,
            runtimeEvidenceReason: NEED_RUNTIME_EVIDENCE,
        },
    });
}

interface LoopContext {
    inLoop: boolean;
    loopIndent: number;
    loopBraces: number;
}

const CODE_OPEN_BRACE = 123;
const CODE_CLOSE_BRACE = 125;

/**
 * Counts net change in curly braces within a line.
 */
function countBraceDelta(line: string): number {
    let delta = 0;
    for (let i = 0; i < line.length; i++) {
        const code = line.charCodeAt(i);
        if (code === CODE_OPEN_BRACE) delta++;
        else if (code === CODE_CLOSE_BRACE) delta--;
    }
    return delta;
}

/**
 * Advances the loop tracking state based on line indentation and brace balance.
 */
function advanceLoopState(ctx: LoopContext, line: string, indent: number): boolean {
    if (ctx.inLoop) {
        if (ctx.loopBraces > 0) {
            ctx.loopBraces += countBraceDelta(line);
            if (ctx.loopBraces <= 0) {
                ctx.inLoop = false;
                return false;
            }
        } else if (indent <= ctx.loopIndent) {
            ctx.inLoop = false;
        }
    }
    if (LOOP_HEAD_RE.test(line)) {
        ctx.inLoop = true;
        ctx.loopIndent = indent;
        ctx.loopBraces = countBraceDelta(line);
        return false;
    }
    return ctx.inLoop;
}

/**
 * GOV-PRF-001: In-Loop Invariant & Configuration Lookup (ADV-PRF-001 generalized).
 * Detects expensive or invariant operations inside loops.
 */
export const LoopInvariantRule: GovernanceRule = {
    id: 'GOV-PRF-001',
    name: 'Loop-Invariant Expensive Operation Hoisting',
    category: PERFORMANCE_CATEGORY,
    severity: SEVERITY_WARN,
    risk: RISK_HIGH,
    rationale:
        'Performing invariant I/O, regex construction, or repetitive configuration lookups in loops incurs severe CPU/throughput penalties.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes('for') && !ctx.content.includes('while')) return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;
        const loopCtx: LoopContext = { inLoop: false, loopIndent: 0, loopBraces: 0 };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(LINE_COMMENT) || trimmed.startsWith('#')) continue;

            const indent = line.search(/\S/);
            const active = advanceLoopState(loopCtx, line, indent);
            if (active) {
                checkExpensiveLoopOp(line, i, violations);
            }
        }

        return violations.length > 0 ? violations : null;
    },
};

const FN_SET_TIMEOUT = 'setTimeout';
const FN_SET_INTERVAL = 'setInterval';
const METHOD_INCLUDES = 'includes';
const METHOD_INDEXOF = 'indexOf';

/**
 * Evaluates whether a line within a loop body performs an unindexed linear search.
 */
function checkLinearSearchHit(line: string, lineIndex: number): GovernanceViolation | null {
    const m = line.match(LINEAR_SEARCH_RE);
    if (!m) return null;
    if (TEXT_VARIABLE_RE.test(m[1]) && (m[2] === METHOD_INCLUDES || m[2] === METHOD_INDEXOF)) {
        return null;
    }
    if (m[2] === METHOD_INCLUDES || m[2] === METHOD_INDEXOF) {
        return {
            ruleId: 'GOV-PRF-005',
            message: `Array linear lookup \`${m[1]}.${m[2]}()\` inside loop body creates quadratic O(N*M) time complexity.`,
            line: lineIndex + 1,
            column: line.indexOf(m[0]) + 1,
            suggestion: `Hoist array to Set before loop: \`const ${m[1]}Set = new Set(${m[1]});\` and use \`${m[1]}Set.has(...)\` for O(1) lookups.`,
            fixable: false,
            evidence: {
                confidence: 0.7,
                requiresRuntime: true,
                runtimeEvidenceReason: NEED_RUNTIME_EVIDENCE,
            },
        };
    }
    return {
        ruleId: 'GOV-PRF-002',
        message: `Linear search \`${m[1]}.${m[2]}()\` inside loop body creates quadratic O(N*M) time complexity.`,
        line: lineIndex + 1,
        column: line.indexOf(m[0]) + 1,
        suggestion: `Consider caching \`${m[1]}\` into a Set or Map before the loop for O(1) lookups.`,
        fixable: false,
        evidence: {
            confidence: 0.65,
            requiresRuntime: true,
            runtimeEvidenceReason: NEED_RUNTIME_EVIDENCE,
        },
    };
}

/**
 * Evaluates whether a line contains an unclamped numeric timer literal.
 */
function checkTimerLiteralHit(line: string, lineIndex: number): GovernanceViolation | null {
    if (!line.includes(FN_SET_TIMEOUT) && !line.includes(FN_SET_INTERVAL)) return null;
    if (line.trim().startsWith(LINE_COMMENT) || line.trim().startsWith('*')) return null;
    const call = line.match(TIMER_CALL_RE);
    if (!call) return null;
    const after = line.slice(line.indexOf('(') + 1);
    const literal = after.match(TIMER_LITERAL_RE);
    if (!literal || Number(literal[1]) === 0) return null;
    return {
        ruleId: 'GOV-PRF-003',
        message: `Timer delay uses numeric literal ${literal[1]}ms — bypasses centralized clamping (config or named constant expected).`,
        line: lineIndex + 1,
        column: line.indexOf('set') + 1,
        suggestion:
            'Use a named constant (e.g. MS_PER_X) or a config value; runtime clamps have a 1000ms floor.',
        fixable: false,
    };
}

/**
 * Scans masked lines and collects unindexed linear searches inside loop bodies.
 */
function collectLinearSearchViolations(lines: string[]): GovernanceViolation[] {
    const violations: GovernanceViolation[] = [];
    const loopCtx: LoopContext = { inLoop: false, loopIndent: 0, loopBraces: 0 };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(LINE_COMMENT) || trimmed.startsWith('#')) continue;

        const indent = line.search(/\S/);
        const active = advanceLoopState(loopCtx, line, indent);
        if (!active) continue;

        const hit = checkLinearSearchHit(line, i);
        if (hit) violations.push(hit);
    }
    return violations;
}

/**
 * GOV-PRF-002: In-Loop Linear Array Lookup.
 * Flags nested linear searches inside loops that could benefit from Map/Set indexing.
 */
export const InLoopLinearSearchRule: GovernanceRule = {
    id: 'GOV-PRF-002',
    name: 'In-Loop Linear Search Optimization',
    category: PERFORMANCE_CATEGORY,
    severity: SEVERITY_INFO_LEVEL,
    risk: RISK_MEDIUM,
    rationale:
        'Calling linear search (.find / .indexOf / .includes) inside a loop scales at O(N*M); pre-indexing in Map/Set optimizes to O(N).',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes('for') && !ctx.content.includes('while')) return null;

        const violations = collectLinearSearchViolations(ctx.masked);
        const filtered = violations.filter((v) => v.ruleId === 'GOV-PRF-002');
        return filtered.length > 0 ? filtered : null;
    },
};

/**
 * GOV-PRF-005: In-Loop Array Pre-Hashing Rule.
 * Flags array .includes() / .indexOf() lookups inside loops that should be hoisted into Sets.
 */
export const InLoopArrayPreHashRule: GovernanceRule = {
    id: 'GOV-PRF-005',
    name: 'In-Loop Array Set Pre-Indexing',
    category: PERFORMANCE_CATEGORY,
    severity: SEVERITY_INFO_LEVEL,
    risk: RISK_MEDIUM,
    rationale:
        'Calling array linear search (.includes / .indexOf) inside a loop degrades performance to O(N*M); pre-indexing in a Set outside the loop optimizes to O(1).',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes('for') && !ctx.content.includes('while')) return null;

        const violations = collectLinearSearchViolations(ctx.masked);
        const filtered = violations.filter((v) => v.ruleId === 'GOV-PRF-005');
        return filtered.length > 0 ? filtered : null;
    },
};

/**
 * GOV-PRF-003: Non-Clamped Timer Literal.
 * Flags non-zero numeric literals passed to setTimeout/setInterval.
 */
export const TimerLiteralRule: GovernanceRule = {
    id: 'GOV-PRF-003',
    name: 'Non-Clamped Timer Literal Delay',
    category: PERFORMANCE_CATEGORY,
    severity: SEVERITY_WARN,
    risk: RISK_MEDIUM,
    languages: ['typescript', 'javascript'],
    rationale:
        'Hardcoded timer delays bypass centralized clamping and platform-specific background throttling.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes(FN_SET_TIMEOUT) && !ctx.content.includes(FN_SET_INTERVAL)) {
            return null;
        }

        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;

        for (let i = 0; i < lines.length; i++) {
            const hit = checkTimerLiteralHit(lines[i], i);
            if (hit) violations.push(hit);
        }

        return violations.length > 0 ? violations : null;
    },
};

/**
 * GOV-PRF-004: Synchronous File I/O in Host Event Loop.
 * Flags sync fs calls in TypeScript/JavaScript outside test or allowlisted files.
 */
export const SyncIoRule: GovernanceRule = {
    id: 'GOV-PRF-004',
    name: 'Synchronous File I/O Blocking Host Event Loop',
    category: PERFORMANCE_CATEGORY,
    severity: SEVERITY_WARN,
    risk: RISK_HIGH,
    languages: ['typescript', 'javascript'],
    rationale:
        'Synchronous file I/O blocks the host JavaScript event loop, causing severe UI freezes or stalling concurrent request processing.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (/\.(d\.ts)$/.test(ctx.filePath)) return null;
        if (/(^|\/)(tests?|__tests__)\//.test(ctx.filePath)) return null;

        // Shared policy key with the performance analyzer (PRF-IO-001): When the dedicated
        // performance analyzer is actively enabled in the scan plan, PRF-IO-001 is the
        // canonical analyzer rule for synchronous I/O; suppress GOV-PRF-004 to
        // eliminate duplicate findings.
        const analyzers = (
            ctx.ctx.options as { analyzers?: Record<string, { enabled?: boolean }> } | undefined
        )?.analyzers;
        if (analyzers?.performance?.enabled === true) {
            return null;
        }

        // CLI entry points and validation/benchmark harnesses are synchronous by design,
        // so their sync fs calls are a documented decision rather than event-loop debt.
        const allowPatterns = (
            ctx.ctx.options as { blockingIoAllowPatterns?: string[] } | undefined
        )?.blockingIoAllowPatterns;
        if (allowPatterns?.length) {
            const normalized = ctx.filePath.replace(/\\/g, '/');
            if (
                matchAny(
                    allowPatterns.map((glob) => globToRegExp(glob)),
                    normalized,
                )
            )
                return null;
        }
        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!SYNC_FS_RE.test(line)) continue;
            if (line.trim().startsWith(LINE_COMMENT)) continue;
            violations.push({
                ruleId: 'GOV-PRF-004',
                message:
                    'Synchronous fs call blocks the host event loop (UI jank / request stall source).',
                line: i + 1,
                column: line.search(SYNC_FS_RE) + 1,
                suggestion: 'Use fs/promises or the host async fs API (e.g. vscode.workspace.fs).',
                fixable: false,
            });
        }
        return violations.length > 0 ? violations : null;
    },
};
