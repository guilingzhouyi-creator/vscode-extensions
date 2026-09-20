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
import { globToRegExp, matchAny } from '../../fileDiscovery';

/** Governance category shared by every performance rule exported from this file. */
const PERFORMANCE_CATEGORY = 'performance';

/** Line-comment prefix skipped by the line-scanning rules in this file. */
const LINE_COMMENT = '//';

const LOOP_HEAD_RE = /^\s*(?:for|while)\s*[({:]/;
const LINEAR_SEARCH_RE = /\b([a-zA-Z0-9_$]+)\.(find|indexOf|includes)\s*\(/;
const EXPENSIVE_OPS = [
    'GameConfig.get_',
    'JSON.parse(',
    'fs.readFileSync(',
    'new RegExp(',
    'readFileSync(',
];
const TIMER_CALL_RE = /set(?:Timeout|Interval)\s*\(/;
const TIMER_LITERAL_RE = /,\s*(\d+)\s*[,)]/;
const SYNC_FS_RE =
    /\b(?:readFileSync|writeFileSync|appendFileSync|copyFileSync|readdirSync|accessSync|existsSync|statSync|lstatSync|rmSync|rmdirSync|mkdirSync|openSync|closeSync|renameSync|unlinkSync)\s*\(/;
const SYNC_CALL_PATTERN = 'Sync(';

/**
 * GOV-PRF-001: In-Loop Invariant & Configuration Lookup (ADV-PRF-001 generalized).
 * Detects expensive or invariant operations inside loops.
 */
export const LoopInvariantRule: GovernanceRule = {
    id: 'GOV-PRF-001',
    name: 'Loop-Invariant Expensive Operation Hoisting',
    category: PERFORMANCE_CATEGORY,
    severity: 'warning',
    risk: 'high',
    rationale:
        'Performing invariant I/O, regex construction, or repetitive configuration lookups in loops incurs severe CPU/throughput penalties.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes('for') && !ctx.content.includes('while')) return null;

        const violations: GovernanceViolation[] = [];
        const lines = ctx.masked;

        let inLoop = false;
        let loopIndent = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(LINE_COMMENT) || trimmed.startsWith('#')) continue;

            const indent = line.search(/\S/);

            if (inLoop && indent <= loopIndent) {
                inLoop = false;
            }

            if (LOOP_HEAD_RE.test(line)) {
                inLoop = true;
                loopIndent = indent;
                continue;
            }

            if (inLoop) {
                for (const op of EXPENSIVE_OPS) {
                    if (line.includes(op)) {
                        violations.push({
                            ruleId: 'GOV-PRF-001',
                            message: `Potentially loop-invariant expensive operation \`${op.replace(/[(_]/g, '')}\` executed inside loop body.`,
                            line: i + 1,
                            column: line.indexOf(op) + 1,
                            suggestion:
                                'Hoist the configuration lookup or expensive resource creation before the loop.',
                            fixable: false,
                            evidence: {
                                confidence: 0.7,
                                requiresRuntime: true,
                                runtimeEvidenceReason: NEED_RUNTIME_EVIDENCE,
                            },
                        });
                        break;
                    }
                }
            }
        }

        return violations.length > 0 ? violations : null;
    },
};

const FN_SET_TIMEOUT = 'setTimeout';
const FN_SET_INTERVAL = 'setInterval';

/**
 * Evaluates whether a line within a loop body performs an unindexed linear search.
 */
function checkLinearSearchHit(line: string, lineIndex: number): GovernanceViolation | null {
    const m = line.match(LINEAR_SEARCH_RE);
    if (!m) return null;
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
    let inLoop = false;
    let loopIndent = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(LINE_COMMENT) || trimmed.startsWith('#')) continue;

        const indent = line.search(/\S/);
        if (inLoop && indent <= loopIndent) {
            inLoop = false;
        }

        if (LOOP_HEAD_RE.test(line)) {
            inLoop = true;
            loopIndent = indent;
            continue;
        }

        if (inLoop) {
            const hit = checkLinearSearchHit(line, i);
            if (hit) violations.push(hit);
        }
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
    severity: 'info',
    risk: 'medium',
    rationale:
        'Calling linear search (.find / .indexOf / .includes) inside a loop scales at O(N*M); pre-indexing in Map/Set optimizes to O(N).',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (!ctx.content.includes('for') && !ctx.content.includes('while')) return null;
        const violations = collectLinearSearchViolations(ctx.masked);
        return violations.length > 0 ? violations : null;
    },
};

/**
 * GOV-PRF-003: Unclamped Timer Literal (generalized from workspace-timing's PERF-TIMER-LITERAL).
 * Flags setInterval/setTimeout whose delay is a numeric literal — bypasses centralized
 * clamping and historically caused ~1ms busy-loop CPU/IO hotspots when misconfigured.
 */
export const TimerLiteralRule: GovernanceRule = {
    id: 'GOV-PRF-003',
    name: 'Unclamped Timer Delay Literal',
    category: PERFORMANCE_CATEGORY,
    severity: 'error',
    risk: 'high',
    rationale:
        'Numeric timer delays bypass centralized clamping; a literal of <=0 triggers a ~1ms busy loop (CPU/IO hotspot).',
    isFixable: false,
    languages: ['typescript', 'javascript'],
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
 * GOV-PRF-004: Synchronous FS in Extension-Host / Server Code (generalized from
 * workspace-timing's PERF-SYNC-FS). Blocking sync I/O stalls the host event loop.
 */
export const SyncIoRule: GovernanceRule = {
    id: 'GOV-PRF-004',
    name: 'Synchronous FS Blocking the Host Event Loop',
    category: PERFORMANCE_CATEGORY,
    severity: 'warning',
    risk: 'medium',
    rationale:
        'Sync fs calls block the host event loop (UI jank in IDE extensions, request stalls on servers).',
    isFixable: false,
    languages: ['typescript', 'javascript'],
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        if (/\.(d\.ts)$/.test(ctx.filePath)) return null;
        if (/(^|\/)(tests?|__tests__)\//.test(ctx.filePath)) return null;
        if (!ctx.content.includes(SYNC_CALL_PATTERN)) return null;

        // Shared policy key with the performance analyzer (PRF-IO-001): CLI entry points and
        // validation/benchmark harnesses are synchronous by design, so their sync fs calls are a
        // documented decision rather than event-loop debt.
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
            if (!line.includes(SYNC_CALL_PATTERN)) continue;
            if (line.trim().startsWith(LINE_COMMENT)) continue;
            if (SYNC_FS_RE.test(line)) {
                violations.push({
                    ruleId: 'GOV-PRF-004',
                    message:
                        'Synchronous fs call blocks the host event loop (UI jank / request stall source).',
                    line: i + 1,
                    column: line.search(SYNC_FS_RE) + 1,
                    suggestion:
                        'Use fs/promises or the host async fs API (e.g. vscode.workspace.fs).',
                    fixable: false,
                });
            }
        }
        return violations.length > 0 ? violations : null;
    },
};
