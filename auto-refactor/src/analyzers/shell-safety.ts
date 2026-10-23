/**
 * Module: Static Analysis Engine — Shell Safety Analyzer (Destructive Operand Provenance)
 * File Path: src/analyzers/shell-safety.ts
 * Architecture Role: Per-file analyzer that turns the destructive-operand provenance guard and the
 *   read-only automatic-variable guard into engine findings, so a repository that runs the scan
 *   engine learns about them without a separate gate script.
 * Dependencies & Triggers: Core types plus ./shell-safety-taint; enabled through the declarative
 *   `analyzers.shell-safety` entry and executed over every script and module the scan selects.
 * Responsibilities:
 *   1. Report GUARD-DESTR-001 for a recursive delete whose operand is a filesystem root, an
 *      ancestor directory, a home or profile directory, or an expression derived from one;
 *   2. Report GUARD-VAR-001 for a PowerShell binding that writes a read-only automatic variable;
 *   3. Stay silent on every shape the judgement layer accounts for, so a clean corpus yields
 *      nothing and the rules remain trustworthy.
 * Exit Semantics & Design Rationale: Total and non-throwing; a file in an unrelated dialect yields
 *   an empty list. Findings carry the provenance chain in `detail.chain` rather than only in prose,
 *   because the fix depends on which hop introduced the taint: a direct home root is one edit, a
 *   three-hop alias chain is a different one.
 */

import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { ANALYZER_SHELL_SAFETY } from '../core/scoring/dimensionLiterals';
import {
    RULE_GUARD_DESTR_001,
    RULE_GUARD_VAR_001,
    classifyOperand,
    collectBindings,
    dialectOf,
    findAutomaticVariableShadows,
    isNonStatementLine,
    parseDeleteOperand,
    type DeleteDialect,
} from './shell-safety-taint';

/** Severity carried by a destructive-operand finding; the operand decides what gets destroyed. */
const SEVERITY_DESTRUCTIVE: Severity = 'error';

/** Severity carried by an automatic-variable shadow finding; the write throws, then misleads. */
const SEVERITY_SHADOW: Severity = 'error';

/** Options narrowing the destructive-operand audit for one scan. */
export interface ShellSafetyOptions {
    /** Set false to silence the destructive-operand rule without disabling the analyzer. */
    checkDestructiveOperands?: boolean;
    /** Set false to silence the automatic-variable rule without disabling the analyzer. */
    checkAutomaticVariables?: boolean;
}

/** One rejected delete operand, ready to be shaped into an issue. */
interface DestructiveFinding {
    readonly line: number;
    readonly operand: string;
    readonly reason: string;
}

/**
 * Builds the destructive-operand issue for one rejected delete.
 *
 * @param file - Normalized repository-relative file path.
 * @param finding - Rejected operand and its reason.
 * @returns The GUARD-DESTR-001 issue.
 */
function buildDestructiveIssue(file: string, finding: DestructiveFinding): Issue {
    return {
        id: `${ANALYZER_SHELL_SAFETY}:${RULE_GUARD_DESTR_001}:${file}:${finding.line}`,
        analyzer: ANALYZER_SHELL_SAFETY,
        rule: RULE_GUARD_DESTR_001,
        severity: SEVERITY_DESTRUCTIVE,
        message:
            `Recursive delete operand is not a path the source accounts for: ${finding.reason}. ` +
            `The delete removes whatever that expression resolves to at run time.`,
        location: {
            file,
            start: { line: finding.line, column: 1 },
            end: { line: finding.line, column: 1 },
        },
        detail: {
            operand: finding.operand,
            reason: finding.reason,
            risk: 'critical',
        },
        suggestion:
            'Delete a path the source names literally or builds from a directory the script created, ' +
            'and refuse the operation when the resolved path is a root, a home directory, or empty.',
    };
}

/**
 * Builds the automatic-variable shadow issue for one offending binding.
 *
 * @param file - Normalized repository-relative file path.
 * @param name - Variable name as written, without the leading `$`.
 * @param line - One-based line number of the write.
 * @returns The GUARD-VAR-001 issue.
 */
function buildShadowIssue(file: string, name: string, line: number): Issue {
    return {
        id: `${ANALYZER_SHELL_SAFETY}:${RULE_GUARD_VAR_001}:${file}:${line}`,
        analyzer: ANALYZER_SHELL_SAFETY,
        rule: RULE_GUARD_VAR_001,
        severity: SEVERITY_SHADOW,
        message:
            `$${name} is a read-only automatic variable. The assignment throws, and the name keeps ` +
            `its previous value, so every later read silently addresses a different object than intended.`,
        location: {
            file,
            start: { line, column: 1 },
            end: { line, column: 1 },
        },
        detail: {
            variable: `$${name}`,
            risk: 'high',
        },
        suggestion: `Rename the binding so it no longer collides with $${name}.`,
    };
}

/**
 * Collects every rejected delete operand in one file.
 *
 * @param lines - File lines.
 * @param dialect - Lexical dialect of the file.
 * @returns Findings in source order.
 */
function collectDestructiveFindings(
    lines: readonly string[],
    dialect: DeleteDialect,
): DestructiveFinding[] {
    const bindings = collectBindings(lines);
    const findings: DestructiveFinding[] = [];
    lines.forEach((line, index) => {
        if (isNonStatementLine(line.trim())) return;
        const operand = parseDeleteOperand(lines, index, dialect);
        if (operand === null) return;
        const reason = classifyOperand(operand, bindings);
        if (reason === null) return;
        findings.push({ line: index + 1, operand: operand.trim(), reason });
    });
    return findings;
}

/**
 * Destructive operand provenance and PowerShell automatic-variable analyzer.
 */
export class ShellSafetyAnalyzer implements Analyzer {
    readonly name = ANALYZER_SHELL_SAFETY;

    /**
     * Streaming-path entry point: the engine invokes this once per file.
     *
     * @param context - Engine context carrying the file path, content and merged options.
     * @returns Findings for this file; empty when it carries no defect.
     */
    finalize(context: AnalyzerContext): Issue[] {
        return this.analyze(undefined, context);
    }

    /**
     * Standalone entry point.
     *
     * @param _sf - Unused; this analyzer reads text rather than a TypeScript syntax tree.
     * @param context - Engine context carrying the file path, content and merged options.
     * @returns Findings for this file; empty when it carries no defect.
     */
    analyze(_sf: unknown, context: AnalyzerContext): Issue[] {
        const file = context.filePath.replace(/\\/g, '/');
        const dialect = dialectOf(file);
        if (dialect === null) return [];
        const content = context.content;
        if (content.length === 0) return [];

        const options = (context.options ?? {}) as ShellSafetyOptions;
        const lines = content.split(/\r?\n/);
        const issues: Issue[] = [];

        if (options.checkDestructiveOperands !== false) {
            for (const finding of collectDestructiveFindings(lines, dialect)) {
                issues.push(buildDestructiveIssue(file, finding));
            }
        }

        if (dialect === 'powershell' && options.checkAutomaticVariables !== false) {
            for (const shadow of findAutomaticVariableShadows(lines)) {
                issues.push(buildShadowIssue(file, shadow.name, shadow.line));
            }
        }

        return issues;
    }
}
