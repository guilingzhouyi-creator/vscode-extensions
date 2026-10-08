/**
 * Module: Static Analysis — Naming Governance Python Source Auditor
 * File Path: src/analyzers/naming-python-helper.ts
 * Architecture Role: Modular helper for analyzing Python source lines for naming conventions,
 *   transient jargon, vague identifiers, and symbol decoupling clusters.
 * Dependencies & Triggers: Consumed by NamingAnalyzer to keep physical LOC under threshold.
 * Responsibilities:
 *   1. Audit Python class definitions for PascalCase and transient jargon.
 *   2. Audit Python variable assignments for vague identifiers and single-letter guards.
 *   3. Run decoupling cluster audits on Python symbol entries (NAM-DEC-001).
 * Exit Semantics & Design Rationale: Pure functional helper returning Issue[]; zero side effects.
 */

import type { Issue } from '../core/types';
import type {
    NamingDecouplingAuditor,
    SymbolEntry,
} from '../core/architecture/naming-decoupling-auditor';

/** Callback factory for instantiating canonical Issue records. */
export type IssueFactory = (
    line: number,
    rule: string,
    msg: string,
    detail: Record<string, unknown>,
    sugg?: string,
) => Issue;

/** Callback checker for registering and validating decoupling symbol entries. */
export type DecouplingChecker = (
    name: string,
    kind: any,
    loc: { line: number; character: number },
    symbols?: SymbolEntry[],
) => void;

/**
 * Options configuring Python-specific naming and decoupling checks.
 */
export interface PythonNamingOptions {
    checkTypes?: boolean;
    checkVagueNames?: boolean;
    checkSingleLetters?: boolean;
    checkJargon?: boolean;
    checkDecoupling?: boolean;
    vagueBlacklist?: string[];
}

/**
 * Audits a Python class declaration line for PascalCase naming and decoupling constraints.
 *
 * @param line - Line text containing class declaration.
 * @param lineIdx - 0-indexed line number.
 * @param opts - Python naming options.
 * @param hasTransientJargon - Jargon predicate callback.
 * @param mkIssue - Issue factory callback.
 * @param checkDecouplingSymbol - Decoupling symbol checker callback.
 * @param issues - Output issue accumulator.
 * @param symbols - Optional symbol entry accumulator.
 */
export function auditPythonClass(
    line: string,
    lineIdx: number,
    opts: PythonNamingOptions,
    hasTransientJargon: (name: string) => boolean,
    mkIssue: IssueFactory,
    checkDecouplingSymbol: DecouplingChecker,
    issues: Issue[],
    symbols?: SymbolEntry[],
): void {
    const classMatch = /^class\s+([A-Za-z0-9_]+)/.exec(line);
    if (!classMatch) return;
    const className = classMatch[1];
    if (opts.checkTypes !== false && !/^[A-Z][a-zA-Z0-9]*$/.test(className)) {
        issues.push(
            mkIssue(
                lineIdx + 1,
                'NAM-TYP-001',
                `Python class '${className}' should follow PascalCase convention.`,
                { name: className },
                `Rename class '${className}' to PascalCase.`,
            ),
        );
    }
    if (opts.checkJargon !== false && hasTransientJargon(className)) {
        issues.push(
            mkIssue(
                lineIdx + 1,
                'NAM-JRG-002',
                `Python class '${className}' contains transient construction jargon.`,
                { name: className },
                'Replace transient process markers with semantic domain naming.',
            ),
        );
    }
    checkDecouplingSymbol(className, 'class', { line: lineIdx, character: 0 }, symbols);
}

/**
 * Audits a Python assignment line for vague names, single letters, and jargon.
 *
 * @param line - Line text containing assignment.
 * @param lineIdx - 0-indexed line number.
 * @param opts - Python naming options.
 * @param vagueSet - Vague naming identifiers blacklist.
 * @param hasTransientJargon - Jargon predicate callback.
 * @param mkIssue - Issue factory callback.
 * @param checkDecouplingSymbol - Decoupling symbol checker callback.
 * @param issues - Output issue accumulator.
 * @param symbols - Optional symbol entry accumulator.
 */
export function auditPythonAssignment(
    line: string,
    lineIdx: number,
    opts: PythonNamingOptions,
    vagueSet: Set<string>,
    hasTransientJargon: (name: string) => boolean,
    mkIssue: IssueFactory,
    checkDecouplingSymbol: DecouplingChecker,
    issues: Issue[],
    symbols?: SymbolEntry[],
): void {
    const assignMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/.exec(line);
    if (!assignMatch) return;
    const varName = assignMatch[1];
    if (opts.checkVagueNames !== false && vagueSet.has(varName.toLowerCase())) {
        issues.push(
            mkIssue(
                lineIdx + 1,
                'NAM-VAG-001',
                `Identifier '${varName}' is vague and uninformative; lacks domain context.`,
                { name: varName },
                `Replace '${varName}' with a domain-qualified identifier.`,
            ),
        );
    }
    if (opts.checkSingleLetters !== false && varName.length === 1 && varName !== '_') {
        issues.push(
            mkIssue(
                lineIdx + 1,
                'NAM-SGL-001',
                `Single-letter variable name '${varName}' hurts readability.`,
                { name: varName },
                `Replace '${varName}' with a meaningful name.`,
            ),
        );
    }
    if (opts.checkJargon !== false && hasTransientJargon(varName)) {
        issues.push(
            mkIssue(
                lineIdx + 1,
                'NAM-JRG-002',
                `Python identifier '${varName}' contains transient construction jargon.`,
                { name: varName },
                'Replace transient process markers with semantic domain naming.',
            ),
        );
    }
    const isUpper = /^[A-Z0-9_]+$/.test(varName);
    checkDecouplingSymbol(
        varName,
        isUpper ? 'constant' : 'variable',
        { line: lineIdx, character: 0 },
        symbols,
    );
}

/**
 * Main helper driving Python line-by-line lexical and naming audits.
 *
 * @param content - Full file text content.
 * @param opts - Python naming options.
 * @param vagueSet - Vague naming identifiers blacklist.
 * @param hasTransientJargon - Jargon predicate callback.
 * @param mkIssue - Issue factory callback.
 * @param checkDecouplingSymbol - Decoupling symbol checker callback.
 * @param decouplingAuditor - Naming decoupling auditor instance.
 * @param issues - Output issue accumulator.
 */
export function auditPythonSourceHelper(
    content: string,
    opts: PythonNamingOptions,
    vagueSet: Set<string>,
    hasTransientJargon: (name: string) => boolean,
    mkIssue: IssueFactory,
    checkDecouplingSymbol: DecouplingChecker,
    decouplingAuditor: NamingDecouplingAuditor,
    issues: Issue[],
): void {
    const lines = content.split('\n');
    const symbols: SymbolEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#') || !line) continue;
        auditPythonClass(
            line,
            i,
            opts,
            hasTransientJargon,
            mkIssue,
            checkDecouplingSymbol,
            issues,
            symbols,
        );
        auditPythonAssignment(
            line,
            i,
            opts,
            vagueSet,
            hasTransientJargon,
            mkIssue,
            checkDecouplingSymbol,
            issues,
            symbols,
        );
    }

    if (opts.checkDecoupling !== false && symbols.length >= 4) {
        const clusterFindings = decouplingAuditor.auditClusters(symbols);
        const flaggedSymbols = new Set<string>();
        for (const issue of issues) {
            if (issue.rule === 'NAM-DEC-001') {
                const sym = (issue.detail as Record<string, unknown>)?.symbol;
                if (typeof sym === 'string') {
                    flaggedSymbols.add(sym);
                }
            }
        }
        for (const finding of clusterFindings) {
            if (flaggedSymbols.has(finding.symbol)) {
                continue;
            }
            flaggedSymbols.add(finding.symbol);
            issues.push(
                mkIssue(
                    finding.line,
                    'NAM-DEC-001',
                    finding.message,
                    {
                        symbol: finding.symbol,
                        length: finding.length,
                        segments: finding.segments,
                        suggestedDomainDirectory: finding.suggestedDomainDirectory,
                        suggestedSymbol: finding.suggestedSymbol,
                        actionableProposal: finding.actionableProposal,
                    },
                    finding.actionableProposal.rationale,
                ),
            );
        }
    }
}
