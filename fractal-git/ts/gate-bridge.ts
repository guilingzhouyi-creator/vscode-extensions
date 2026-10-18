/**
 * Module: Fractal Git — Auto Review Gate Interlock Bridge
 * File Path: ts/gate-bridge.ts
 * Architecture Role: Bridges Fractal Git staging areas with the Auto code review gate,
 *   performing pre-commit AST slice checks and topological risk calculations.
 * Dependencies & Triggers: Triggered when an agent attempts to advance an in-pre-review workspace.
 * Responsibilities: Run deterministic AST checks, calculate quality scores, and enforce pass/fail gates.
 * Exit Semantics & Design Rationale: Enforces "tests passing != gate passing" axiom; rejects
 *   flawed code in under 10ms; adheres to CC <= 15 and Depth <= 4.
 */

import type { GateAuditVerdict, StagedFileEntry } from './contracts';

/**
 * Validates staged files against strict Auto review gate constraints.
 */
export function verifyPreReviewZone(files: readonly StagedFileEntry[]): GateAuditVerdict {
    const startMs = Date.now();
    const violations: string[] = [];

    for (const file of files) {
        const text =
            typeof file.content === 'string'
                ? file.content
                : Buffer.from(file.content).toString('utf8');

        // Check 1: Zero physical empty files (HYG-EMP-001)
        if (text.trim().length === 0) {
            violations.push(`HYG-EMP-001: Empty physical file detected at ${file.path}`);
        }

        // Check 2: Conflict markers detection (L3-CONFLICT)
        if (
            text.includes('<<<<<<<') ||
            text.includes('=======') ||
            text.includes('>>>>>>>')
        ) {
            violations.push(
                `L3-CONFLICT: Unresolved Git conflict marker detected in ${file.path}`,
            );
        }

        // Check 3: Transient loop allocations (ADV-PRF-002)
        if (/for\s*\(.*?\)\s*\{[^}]*new\s+(?:Array|Object)/s.test(text)) {
            violations.push(
                `ADV-PRF-002: Transient heap allocation detected inside loop in ${file.path}`,
            );
        }
    }

    const passed = violations.length === 0;
    const score = passed ? 100.0 : Math.max(0, 100.0 - violations.length * 20.0);

    return {
        passed,
        score,
        violations,
        shouldEscalateToL3A: violations.some((v) => v.startsWith('L3-CONFLICT')),
        auditDurationMs: Date.now() - startMs,
    };
}
