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
    SymbolDeclarationKind,
    SymbolEntry,
} from '../core/architecture/naming-decoupling-auditor';
import { auditFunctionSemantics } from './naming-path-helper';

/** Structured diagnostic payload for Python naming findings. */
export interface PythonFindingInput {
    readonly line: number;
    readonly rule: string;
    readonly message: string;
    readonly detail: Record<string, unknown>;
    readonly suggestion?: string;
}

/** Callback factory for instantiating canonical Issue records. */
export type IssueFactory = (finding: PythonFindingInput) => Issue;

/** Callback checker for registering and validating decoupling symbol entries. */
export type DecouplingChecker = (
    name: string,
    kind: SymbolDeclarationKind,
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
    checkLengths?: boolean;
    minFunctionWords?: number;
    maxFunctionWords?: number;
    minFunctionLength?: number;
    maxFunctionLength?: number;
    enforceVerbNounContract?: boolean;
    enforceMorphemeCheck?: boolean;
    vagueBlacklist?: string[];
}

/**
 * Execution context carrying state, options, and callbacks for Python naming audits.
 */
export interface PythonNamingContext {
    readonly opts: PythonNamingOptions;
    readonly vagueSet: Set<string>;
    readonly hasTransientJargon: (name: string) => boolean;
    readonly mkIssue: IssueFactory;
    readonly checkDecouplingSymbol: DecouplingChecker;
    readonly issues: Issue[];
    readonly symbols?: SymbolEntry[];
}

const MIN_PYTHON_FUNCTION_LENGTH = 3;
const MAX_PYTHON_FUNCTION_LENGTH = 50;
const MIN_CLUSTER_SYMBOLS = 4;

const KIND_TYPE: SymbolDeclarationKind = 'type';
const KIND_CONSTANT: SymbolDeclarationKind = 'constant';
const KIND_VARIABLE: SymbolDeclarationKind = 'variable';
const KIND_FUNCTION: SymbolDeclarationKind = 'function';

/**
 * Audits a Python class declaration line for PascalCase naming and decoupling constraints.
 *
 * @param line - Line text containing class declaration.
 * @param lineIdx - 0-indexed line number.
 * @param pCtx - Python naming traversal context.
 */
export function auditPythonClass(line: string, lineIdx: number, pCtx: PythonNamingContext): void {
    const classMatch = /^class\s+([A-Za-z0-9_]+)/.exec(line);
    if (!classMatch) return;
    const className = classMatch[1];
    if (pCtx.opts.checkTypes !== false && !/^[A-Z][a-zA-Z0-9]*$/.test(className)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                rule: 'NAM-TYP-001',
                message: `Python class '${className}' should follow PascalCase convention.`,
                detail: { name: className },
                suggestion: `Rename class '${className}' to PascalCase.`,
            }),
        );
    }
    if (pCtx.opts.checkJargon !== false && pCtx.hasTransientJargon(className)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                rule: 'NAM-JRG-002',
                message: `Python class '${className}' contains transient construction jargon.`,
                detail: { name: className },
                suggestion: 'Replace transient process markers with semantic domain naming.',
            }),
        );
    }
    pCtx.checkDecouplingSymbol(className, KIND_TYPE, { line: lineIdx, character: 0 }, pCtx.symbols);
}

/**
 * Audits a Python assignment line for vague names, single letters, and jargon.
 *
 * @param line - Line text containing assignment.
 * @param lineIdx - 0-indexed line number.
 * @param pCtx - Python naming traversal context.
 */
export function auditPythonAssignment(
    line: string,
    lineIdx: number,
    pCtx: PythonNamingContext,
): void {
    const assignMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/.exec(line);
    if (!assignMatch) return;
    const varName = assignMatch[1];
    if (pCtx.opts.checkVagueNames !== false && pCtx.vagueSet.has(varName.toLowerCase())) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                rule: 'NAM-VAG-001',
                message: `Identifier '${varName}' is vague and uninformative; lacks domain context.`,
                detail: { name: varName },
                suggestion: `Replace '${varName}' with a domain-qualified identifier.`,
            }),
        );
    }
    if (pCtx.opts.checkSingleLetters !== false && varName.length === 1 && varName !== '_') {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                rule: 'NAM-SGL-001',
                message: `Single-letter variable name '${varName}' hurts readability.`,
                detail: { name: varName },
                suggestion: `Replace '${varName}' with a meaningful name.`,
            }),
        );
    }
    if (pCtx.opts.checkJargon !== false && pCtx.hasTransientJargon(varName)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                rule: 'NAM-JRG-002',
                message: `Python identifier '${varName}' contains transient construction jargon.`,
                detail: { name: varName },
                suggestion: 'Replace transient process markers with semantic domain naming.',
            }),
        );
    }
    const isUpper = /^[A-Z0-9_]+$/.test(varName);
    pCtx.checkDecouplingSymbol(
        varName,
        isUpper ? KIND_CONSTANT : KIND_VARIABLE,
        { line: lineIdx, character: 0 },
        pCtx.symbols,
    );
}

function checkPythonFunctionLength(
    fnName: string,
    lineIdx: number,
    pCtx: PythonNamingContext,
): boolean {
    const isSpecialMethod = /^__[a-zA-Z0-9_]+__$/.test(fnName);
    if (pCtx.opts.checkLengths === false || isSpecialMethod) return false;

    const minLen = pCtx.opts.minFunctionLength ?? MIN_PYTHON_FUNCTION_LENGTH;
    const maxLen = pCtx.opts.maxFunctionLength ?? MAX_PYTHON_FUNCTION_LENGTH;

    if (fnName.length < minLen) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                rule: 'NAM-LEN-002',
                message: `Python function or method name '${fnName}' is too short (< ${minLen} characters); lacks semantic description.`,
                detail: { name: fnName, length: fnName.length, minLen },
                suggestion: `Rename '${fnName}' to a descriptive snake_case verb-noun phrase with at least ${minLen} characters.`,
            }),
        );
        return true;
    }

    if (fnName.length >= maxLen) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                rule: 'NAM-LEN-002',
                message: `Python function or method name '${fnName}' is excessively long (>= ${maxLen} characters); consider simplifying or decomposing.`,
                detail: { name: fnName, length: fnName.length, maxLen },
                suggestion: `Refactor '${fnName}' to reduce verbosity or decompose responsibilities into smaller procedures.`,
            }),
        );
        return true;
    }

    return false;
}

/**
 * Audits a Python function declaration line for length constraints and process jargon.
 *
 * @param line - Line text containing function definition.
 * @param lineIdx - 0-indexed line number.
 * @param pCtx - Python naming traversal context.
 */
export function auditPythonFunction(
    line: string,
    lineIdx: number,
    pCtx: PythonNamingContext,
): void {
    const fnMatch = /^def\s+([A-Za-z0-9_]+)\s*\(/.exec(line);
    if (!fnMatch) return;
    const fnName = fnMatch[1];

    if (checkPythonFunctionLength(fnName, lineIdx, pCtx)) {
        return;
    }

    const cleanName = fnName.replace(/^_+|_+$/g, '');
    const segments = cleanName.split('_').filter((s) => s.length > 0);
    const finding = auditFunctionSemantics(fnName, segments, pCtx.opts);
    if (finding) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                rule: 'NAM-LEN-002',
                message: finding.message,
                detail: { name: fnName, findingType: finding.type, token: finding.token },
                suggestion: `Refactor Python function '${fnName}' according to engineering naming standards.`,
            }),
        );
    }

    if (pCtx.opts.checkJargon !== false && pCtx.hasTransientJargon(fnName)) {
        pCtx.issues.push(
            pCtx.mkIssue({
                line: lineIdx + 1,
                rule: 'NAM-JRG-002',
                message: `Python function '${fnName}' contains transient construction jargon.`,
                detail: { name: fnName },
                suggestion: 'Replace transient process markers with semantic domain naming.',
            }),
        );
    }

    pCtx.checkDecouplingSymbol(
        fnName,
        KIND_FUNCTION,
        { line: lineIdx, character: 0 },
        pCtx.symbols,
    );
}

function auditPythonDecouplingClusters(
    symbols: SymbolEntry[],
    decouplingAuditor: NamingDecouplingAuditor,
    pCtx: PythonNamingContext,
): void {
    const clusterFindings = decouplingAuditor.auditClusters(symbols);
    const flaggedSymbols = new Set<string>();
    for (const issue of pCtx.issues) {
        if (issue.rule === 'NAM-DEC-001') {
            const sym = (issue.detail as Record<string, unknown>)?.symbol;
            if (typeof sym === 'string') {
                flaggedSymbols.add(sym);
            }
        }
    }
    for (const finding of clusterFindings) {
        if (flaggedSymbols.has(finding.symbol)) continue;
        flaggedSymbols.add(finding.symbol);
        pCtx.issues.push(
            pCtx.mkIssue({
                line: finding.line,
                rule: 'NAM-DEC-001',
                message: finding.message,
                detail: {
                    symbol: finding.symbol,
                    length: finding.length,
                    segments: finding.segments,
                    suggestedDomainDirectory: finding.suggestedDomainDirectory,
                    suggestedSymbol: finding.suggestedSymbol,
                    actionableProposal: finding.actionableProposal,
                },
                suggestion: finding.actionableProposal.rationale,
            }),
        );
    }
}

/**
 * Main helper driving Python line-by-line lexical and naming audits.
 *
 * @param content - Full file text content.
 * @param pCtx - Python naming traversal context.
 * @param decouplingAuditor - Naming decoupling auditor instance.
 */
export function auditPythonSourceHelper(
    content: string,
    pCtx: PythonNamingContext,
    decouplingAuditor: NamingDecouplingAuditor,
): void {
    const lines = content.split('\n');
    const symbols: SymbolEntry[] = [];
    const scopedCtx: PythonNamingContext = { ...pCtx, symbols };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#') || !line) continue;
        auditPythonClass(line, i, scopedCtx);
        auditPythonFunction(line, i, scopedCtx);
        auditPythonAssignment(line, i, scopedCtx);
    }

    if (pCtx.opts.checkDecoupling !== false && symbols.length >= MIN_CLUSTER_SYMBOLS) {
        auditPythonDecouplingClusters(symbols, decouplingAuditor, scopedCtx);
    }
}
