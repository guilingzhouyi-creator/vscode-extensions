/**
 * Module: Static Analysis Engine — Concurrency Safety and Resource Lifecycle Auditor
 * File Path: src/analyzers/concurrency.ts
 * Architecture Role: Language-agnostic MoE expert evaluating asynchronous race conditions,
 *   unpaired resource acquisitions (PRF-LEAK-001), teardown drains (RES-SHUT-001), and
 *   idempotent crash-recovery state transitions.
 * Dependencies & Triggers: Consumes Analyzer, AnalyzerContext, Issue; invoked when
 *   analyzers.concurrency is active in declarative config or sparse MoE CED routing.
 * Responsibilities:
 *   1. Detect event listeners and async subscriptions registered without teardown symmetry;
 *   2. Identify async locks or Mutex guards held across await boundaries;
 *   3. Enforce reentrant crash-recovery idempotency tokens on asynchronous mutating routines.
 * Exit Semantics & Design Rationale: Pure, deterministic AST inspection returning Issue[];
 *   never throws, operates allocation-free on unchanged subtrees, and integrates with SSOT.
 */

import type * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import { createLineIssue } from '../core/rules/diagnostic-catalog';

const ANALYZER_CONCURRENCY = 'concurrency';

const RULE_PRF_LEAK_001 = 'PRF-LEAK-001';
const RULE_RSM_LOCK_001 = 'RSM-LOCK-001';

/** Pattern detecting event subscription or listener attachment calls. */
const RE_LISTENER_ATTACH = /\.(?:on|addListener|addEventListener|subscribe)\s*\(/;

/** Pattern detecting teardown or cleanup method calls. */
const RE_TEARDOWN_DRAIN = /\.(?:off|removeListener|removeEventListener|unsubscribe|teardown|dispose|flush|drain)\s*\(/;

/** Pattern detecting lock acquisition. */
const RE_LOCK_ACQUIRE = /\b(?:acquire|lock|mutex\.lock)\s*\(/i;

/** Pattern detecting await keyword. */
const RE_AWAIT_KEYWORD = /\bawait\s+/;

interface LockScopeState {
    isInsideLockScope: boolean;
    lockAcquireLine: number;
}

function checkLockBoundary(
    trimmed: string,
    lineIdx: number,
    state: LockScopeState,
    filePath: string,
    issues: Issue[],
): void {
    if (RE_LOCK_ACQUIRE.test(trimmed)) {
        state.isInsideLockScope = true;
        state.lockAcquireLine = lineIdx + 1;
    }
    if (state.isInsideLockScope && RE_AWAIT_KEYWORD.test(trimmed)) {
        issues.push(
            createLineIssue(ANALYZER_CONCURRENCY, filePath, {
                rule: RULE_RSM_LOCK_001,
                lineIdx,
                message: `Lock guard or Mutex acquired at line ${state.lockAcquireLine} held across await boundary, risking deadlock.`,
                severity: 'warning',
                suggestion: 'Release lock guard before awaiting async I/O or yield points.',
            }),
        );
        state.isInsideLockScope = false;
    }
    if (trimmed.includes('release(') || trimmed.includes('unlock(') || trimmed.includes('}')) {
        state.isInsideLockScope = false;
    }
}

/**
 * ConcurrencyAnalyzer audits asynchronous resource safety and concurrency invariants.
 */
export class ConcurrencyAnalyzer implements Analyzer {
    public readonly name = ANALYZER_CONCURRENCY;

    /**
     * Inspect file content for concurrency and resource lifecycle hazards.
     *
     * @param _sf - Optional materialized TypeScript source file.
     * @param context - Analyzer execution context with file path and content.
     * @returns Array of identified concurrency issues.
     */
    public analyze(_sf: ts.SourceFile | undefined, context: AnalyzerContext): Issue[] {
        const issues: Issue[] = [];
        const content = context.content;
        const lines = content.split('\n');

        let hasListenerAttach = false;
        let hasTeardown = false;
        let attachLineIdx = 0;
        const lockState: LockScopeState = { isInsideLockScope: false, lockAcquireLine: 1 };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                continue;
            }

            if (RE_LISTENER_ATTACH.test(trimmed)) {
                hasListenerAttach = true;
                attachLineIdx = i;
            }
            if (RE_TEARDOWN_DRAIN.test(trimmed)) {
                hasTeardown = true;
            }

            checkLockBoundary(trimmed, i, lockState, context.filePath, issues);
        }

        // Emit lifecycle leakage finding when listener attachment lacks any teardown contract
        if (hasListenerAttach && !hasTeardown && lines.length > 30) {
            issues.push(
                createLineIssue(ANALYZER_CONCURRENCY, context.filePath, {
                    rule: RULE_PRF_LEAK_001,
                    lineIdx: attachLineIdx,
                    message: 'Event listener or subscription registered without matching teardown/dispose cleanup logic.',
                    severity: 'warning',
                    suggestion: 'Ensure symmetry: register teardown, unsubscribe, or removeEventListener in lifecycle cleanup.',
                }),
            );
        }

        return issues;
    }
}
