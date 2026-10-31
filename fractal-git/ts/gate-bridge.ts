/**
 * Module: Fractal Git — Auto Review Gate Interlock Bridge
 * File Path: ts/gate-bridge.ts
 * Architecture Role: Bridges Fractal Git staging areas with the Auto code review gate,
 *   performing pre-commit AST slice checks and topological risk calculations.
 * Dependencies & Triggers: Triggered when an agent attempts to advance an in-pre-review workspace.
 * Responsibilities: Run deterministic AST and hygiene checks, compute scores,
 *   and enforce pass/fail gates.
 * Exit Semantics & Design Rationale: Enforces "tests passing != gate passing" axiom; rejects
 *   flawed code in under 10ms; adheres to CC <= 15 and Depth <= 4.
 */

import type { GateAuditVerdict, StagedFileEntry } from './contracts';

/** Regular expression detecting unresolved Git conflict markers in source content. */
const RE_CONFLICT_MARKERS = /^(?:<{7}|={7}|>{7})/m;

/** Regular expression detecting transient heap allocations inside loops (TS/JS and Rust). */
const RE_LOOP_ALLOC_TS = /for\s*\([^)]*\)\s*\{[^}]*new\s+(?:Array|Object|Map|Set)/s;
const RE_LOOP_ALLOC_RS =
    /(?:for|while|loop)\s+[^{]*\{[^}]*\b(?:Vec::new|\.to_string\(\)|\.to_owned\(\)|format!\()/s;

/** Regular expression detecting unwrap/expect panic patterns in production Rust code. */
const RE_UNWRAP_RS = /(?:\.unwrap\(\)|\.expect\()/;

/**
 * Detects line-anchored Git conflict markers (`<<<<<<<`, exact `=======`, `>>>>>>>`),
 * matching `fg-gate::conflict_guard::scan_conflict_markers` without false positives on
 * Markdown/ASCII divider banners (`========`).
 */
function hasLineAnchoredConflictMarker(text: string): boolean {
    const lines = text.split('\n');
    for (const rawLine of lines) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (
            line === '<<<<<<<' ||
            line.startsWith('<<<<<<< ') ||
            line === '=======' ||
            line === '>>>>>>>' ||
            line.startsWith('>>>>>>> ')
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Checks a single staged file against hygiene and zero-allocation constraints.
 *
 * @param file - Staged file entry to inspect.
 * @param violations - Mutable array accumulating violation strings.
 */
function auditSingleFile(file: StagedFileEntry, violations: string[]): void {
    const text = typeof file.content === 'string'
        ? file.content
        : Buffer.from(file.content).toString('utf8');

    // 1. Zero physical empty (HYG-EMP-001) or whitespace-only files (HYG-EMP-002)
    if (text.length === 0) {
        violations.push(`HYG-EMP-001: Empty physical file detected at ${file.path}`);
        return;
    }
    if (text.trim().length === 0) {
        violations.push(`HYG-EMP-002: Whitespace-only physical file detected at ${file.path}`);
        return;
    }

    // 2. Unresolved Git merge conflict markers (FGT-GAT-001)
    if (RE_CONFLICT_MARKERS.test(text) && hasLineAnchoredConflictMarker(text)) {
        violations.push(`FGT-GAT-001: Unresolved Git conflict marker detected in ${file.path}`);
    }

    // 3. Transient heap allocations in hot loop iterations (FGT-PRF-001)
    if (RE_LOOP_ALLOC_TS.test(text) || RE_LOOP_ALLOC_RS.test(text)) {
        violations.push(
            `FGT-PRF-001: Transient heap allocation detected inside loop in ${file.path}`
        );
    }

    // 4. Naked unwrap or expect panic risks in production Rust files (FGT-ERR-001)
    if (file.path.endsWith('.rs') && !file.path.includes('tests/') && RE_UNWRAP_RS.test(text)) {
        violations.push(
            `FGT-ERR-001: Unsafe unwrap/expect call detected in production Rust file ${file.path}`
        );
    }
}

/**
 * Validates staged files against strict Auto review gate constraints.
 *
 * @param files - Readonly array of candidate files staged in the pre-review zone.
 * @returns Comprehensive gate verdict with score, violation list, and escalation flag.
 */
export function verifyPreReviewZone(files: readonly StagedFileEntry[]): GateAuditVerdict {
    const startMs = Date.now();
    const violations: string[] = [];

    for (const file of files) {
        auditSingleFile(file, violations);
    }

    const passed = violations.length === 0;
    const score = passed ? 100.0 : Math.max(0, 100.0 - violations.length * 20.0);
    const shouldEscalateToL3A = violations.some(
        (v) => v.startsWith('FGT-GAT-001') || v.startsWith('FGT-ERR-001')
    );

    return {
        passed,
        score,
        violations,
        shouldEscalateToL3A,
        auditDurationMs: Date.now() - startMs,
    };
}
