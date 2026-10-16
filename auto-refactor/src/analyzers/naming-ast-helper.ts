/**
 * Module: Static Analysis — TypeScript AST Naming Auditor Helper
 * File Path: src/analyzers/naming-ast-helper.ts
 * Architecture Role: AST-level naming validation helper extracting top-level constant,
 *   collection semantics, single-letter guard, vagueness blacklist, and decoupling clusters.
 * Dependencies & Triggers: Consumed by NamingAnalyzer when processing TypeScript AST nodes.
 * Responsibilities:
 *   1. Validate top-level scalar constants for UPPER_SNAKE_CASE (NAM-GLB-001);
 *   2. Audit identifier names against domain vagueness blacklist (NAM-VAG-001);
 *   3. Enforce single-letter variable scope rules with loop index exemptions (NAM-SGL-001);
 *   4. Verify Map collections express key-value relationship (NAM-COL-001);
 *   5. Detect milestone and process construction jargon in identifiers and tests (NAM-JRG-002);
 *   6. Audit decoupling clusters across discovered symbols (NAM-DEC-001).
 * Exit Semantics & Design Rationale: Stateless pure functional helpers delegating issue creation
 *   to callback; zero exceptions thrown.
 */

import * as ts from 'typescript';
import type { AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import type {
    NamingDecouplingAuditor,
    SymbolEntry,
} from '../core/architecture/naming-decoupling-auditor';
import { ANALYZER_NAMING } from '../core/scoring/dimensionLiterals';
import { hasTransientJargon } from './naming-path-helper';
import type { NamingOptions } from './naming';

/**
 * Context object carrying state for TypeScript AST naming audits.
 */
export interface AstNamingContext {
    readonly ctx: AnalyzerContext;
    readonly opts: NamingOptions;
    readonly issues: Issue[];
    readonly sf: ts.SourceFile;
    readonly vagueSet?: Set<string>;
    readonly singleAllowed?: Set<string>;
    readonly symbols?: SymbolEntry[];
}

/**
 * Structured diagnostic payload for AST naming findings.
 */
export interface AstFindingInput {
    readonly line: number;
    readonly column: number;
    readonly rule: string;
    readonly message: string;
    readonly severity?: Severity;
    readonly detail?: Record<string, unknown>;
    readonly suggestion?: string;
}

/**
 * Emits a structured diagnostic issue directly to the issue accumulator.
 */
function pushAstFinding(aCtx: AstNamingContext, finding: AstFindingInput): void {
    const col = finding.column ?? 1;
    const sev = finding.severity ?? SEVERITY_WARNING;
    const det = finding.detail ?? {};
    aCtx.issues.push({
        id: `naming:${finding.rule}:${aCtx.ctx.filePath}:${finding.line}`,
        analyzer: ANALYZER_NAMING,
        rule: finding.rule,
        severity: sev,
        message: finding.message,
        location: {
            file: aCtx.ctx.filePath,
            start: { line: Math.max(1, finding.line), column: Math.max(1, col) },
            end: { line: Math.max(1, finding.line), column: Math.max(1, col) },
        },
        detail: det,
        suggestion: finding.suggestion,
    });
}

const DEFAULT_VAGUE_WORDS =
    'data temp tmp val value res result ret obj item info param arg foo bar baz thing';

/**
 * Default blacklist of vague and uninformative variable names lacking context.
 */
export const DEFAULT_VAGUE_BLACKLIST = new Set(DEFAULT_VAGUE_WORDS.split(' '));

/**
 * Allowed single-letter loop indices and coordinates.
 */
export const DEFAULT_SINGLE_LETTER_ALLOWED = new Set([
    'i',
    'j',
    'k',
    '_',
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
    'l',
    'm',
    'n',
    'p',
    'r',
    's',
    't',
    'v',
    'w',
    'x',
    'y',
    'z',
]);

const CAMEL_TO_SNAKE_PATTERN = '$1_$2';
const JARGON_PATTERN = '\\b(p[0-9]+|phase[\\s_-]*[0-9]+|st[\\s_-]*[0-9]+|temp|tmp|w' + 'ip)\\b';
const REGEX_IGNORE_CASE = 'i';

const TEST_TITLE_JARGON_RE = new RegExp(JARGON_PATTERN, REGEX_IGNORE_CASE);

const TEST_RUNNER_FUNCTIONS = new Set(['describe', 'it', 'test', 'suite']);

/**
 * Validates top-level scalar variable declarations enforce UPPER_SNAKE_CASE.
 *
 * @param decl - AST variable declaration node.
 * @param name - Variable identifier name.
 * @param pos - Source position line and character coordinates.
 * @param aCtx - AST naming traversal context.
 */
export function checkTopLevelConstantHelper(
    decl: ts.VariableDeclaration,
    name: string,
    pos: ts.LineAndCharacter,
    aCtx: AstNamingContext,
): void {
    if (!decl.initializer) return;
    const init = decl.initializer;
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isClassExpression(init)) {
        return;
    }
    if (isCompositeLiteral(init)) {
        return;
    }
    const isScalar = isScalarLiteral(init);
    if (!isScalar || /^[A-Z][A-Z0-9_]*$/.test(name)) {
        return;
    }

    const suggestionName = name.replace(/([a-z0-9])([A-Z])/g, CAMEL_TO_SNAKE_PATTERN).toUpperCase();
    pushAstFinding(aCtx, {
        line: pos.line + 1,
        column: pos.character + 1,
        rule: 'NAM-GLB-001',
        message: `Top-level constant '${name}' should follow UPPER_SNAKE_CASE naming convention.`,
        severity: SEVERITY_WARNING,
        detail: { name },
        suggestion: `Rename '${name}' to an uppercase snake_case constant (e.g. '${suggestionName}').`,
    });
}

/**
 * Audits test title arguments in call expressions for milestone/sprint jargon.
 *
 * @param node - AST call expression node.
 * @param sf - Source file representation.
 * @param aCtx - AST naming traversal context.
 */
export function checkCallExpressionJargonHelper(
    node: ts.CallExpression,
    sf: ts.SourceFile,
    aCtx: AstNamingContext,
): void {
    if (!ts.isIdentifier(node.expression) || !TEST_RUNNER_FUNCTIONS.has(node.expression.text)) {
        return;
    }
    const [arg0] = node.arguments;
    if (!arg0 || (!ts.isStringLiteral(arg0) && !ts.isNoSubstitutionTemplateLiteral(arg0))) {
        return;
    }
    if (!TEST_TITLE_JARGON_RE.test(arg0.text)) {
        return;
    }
    const pos = sf.getLineAndCharacterOfPosition(arg0.getStart(sf));
    pushAstFinding(aCtx, {
        line: pos.line + 1,
        column: pos.character + 1,
        rule: 'NAM-JRG-002',
        message: `Test title '${arg0.text}' contains transient construction jargon or milestone marker.`,
        severity: SEVERITY_WARNING,
        detail: { title: arg0.text },
        suggestion: 'Remove transient process markers from test description.',
    });
}

/**
 * Audits identifier strings for construction or sprint milestone jargon.
 *
 * @param name - Identifier string to inspect.
 * @param pos - Source position line and character coordinates.
 * @param aCtx - AST naming traversal context.
 */
export function checkSymbolJargonHelper(
    name: string,
    pos: ts.LineAndCharacter,
    aCtx: AstNamingContext,
): void {
    if (!hasTransientJargon(name)) {
        return;
    }
    pushAstFinding(aCtx, {
        line: pos.line + 1,
        column: pos.character + 1,
        rule: 'NAM-JRG-002',
        message: `Symbol or test identifier '${name}' contains transient construction jargon or milestone marker.`,
        severity: SEVERITY_WARNING,
        detail: { name },
        suggestion: 'Replace transient process markers with semantic domain naming.',
    });
}

/**
 * Verifies identifier name is not in domain vagueness blacklist.
 *
 * @param name - Identifier name to audit.
 * @param pos - Source position line and character coordinates.
 * @param aCtx - AST naming traversal context.
 */
export function checkIdentifierVaguenessHelper(
    name: string,
    pos: ts.LineAndCharacter,
    aCtx: AstNamingContext,
): void {
    const vagueSet = aCtx.vagueSet ?? DEFAULT_VAGUE_BLACKLIST;
    if (aCtx.opts.checkVagueNames === false || !vagueSet.has(name.toLowerCase())) {
        return;
    }
    pushAstFinding(aCtx, {
        line: pos.line + 1,
        column: pos.character + 1,
        rule: 'NAM-VAG-001',
        message: `Identifier '${name}' is vague and uninformative; lacks domain context.`,
        severity: SEVERITY_WARNING,
        detail: { name },
        suggestion: `Replace '${name}' with a domain-qualified identifier (e.g. 'parseResult', 'userData', 'tokenPayload').`,
    });
}

/**
 * Enforces single-letter identifier restrictions with loop-index tolerance.
 *
 * @param name - Variable identifier name.
 * @param pos - Source position line and character coordinates.
 * @param inLoop - True if variable is declared inside loop scope.
 * @param aCtx - AST naming traversal context.
 */
export function checkSingleLetterHelper(
    name: string,
    pos: ts.LineAndCharacter,
    inLoop: boolean,
    aCtx: AstNamingContext,
): void {
    if (aCtx.opts.checkSingleLetters === false) return;
    if (name.length !== 1 || !/^[a-zA-Z]$/.test(name)) return;
    const singleAllowed = aCtx.singleAllowed ?? DEFAULT_SINGLE_LETTER_ALLOWED;
    if (name === '_' || (inLoop && singleAllowed.has(name))) return;

    pushAstFinding(aCtx, {
        line: pos.line + 1,
        column: pos.character + 1,
        rule: 'NAM-SGL-001',
        message: `Single-letter variable name '${name}' hurts code readability.`,
        severity: SEVERITY_WARNING,
        detail: { name, inLoop },
        suggestion: `Replace '${name}' with a meaningful descriptive name; only loop indices ('i','j','k') and '_' are tolerated.`,
    });
}

/**
 * Audits Map collections to ensure variable naming describes key-value relationship.
 *
 * @param name - Identifier name of collection variable.
 * @param init - Optional initializer expression node.
 * @param pos - Source position line and character coordinates.
 * @param aCtx - AST naming traversal context.
 */
export function checkCollectionNamingHelper(
    name: string,
    init: ts.Expression | undefined,
    pos: ts.LineAndCharacter,
    aCtx: AstNamingContext,
): void {
    if (aCtx.opts.checkCollections === false || !init) return;
    if (!ts.isNewExpression(init) || !init.expression || !ts.isIdentifier(init.expression)) {
        return;
    }
    if (init.expression.text !== 'Map') return;
    if (/(By[A-Z0-9]|To[A-Z0-9]|Map|Dict|Mapping)/.test(name) || /(To|By|Map|Dict)$/i.test(name)) {
        return;
    }

    pushAstFinding(aCtx, {
        line: pos.line + 1,
        column: pos.character + 1,
        rule: 'NAM-COL-001',
        message: `Map '${name}' should describe key-value relation in its name.`,
        severity: SEVERITY_INFO,
        detail: { name },
        suggestion: `Rename '${name}' to describe key-value relationship (e.g. '${name}ByKey', '${name}ToValue').`,
    });
}

/**
 * Audits decoupling clusters across discovered symbols.
 *
 * @param discoveredSymbols - Collection of discovered symbols in file.
 * @param decouplingAuditor - Auditor instance evaluating decoupling clusters.
 * @param aCtx - AST naming traversal context.
 */
export function auditDecouplingClustersHelper(
    discoveredSymbols: SymbolEntry[],
    decouplingAuditor: NamingDecouplingAuditor,
    aCtx: AstNamingContext,
): void {
    const clusterFindings = decouplingAuditor.auditClusters(discoveredSymbols);
    const flaggedDecouplingSymbols = new Set<string>();
    for (const issue of aCtx.issues) {
        if (issue.rule === 'NAM-DEC-001') {
            const sym = (issue.detail as Record<string, unknown>)?.symbol;
            if (typeof sym === 'string') {
                flaggedDecouplingSymbols.add(sym);
            }
        }
    }

    for (const finding of clusterFindings) {
        if (!flaggedDecouplingSymbols.has(finding.symbol)) {
            flaggedDecouplingSymbols.add(finding.symbol);
            pushAstFinding(aCtx, {
                line: finding.line,
                column: finding.column,
                rule: 'NAM-DEC-001',
                message: finding.message,
                severity: SEVERITY_WARNING,
                detail: {
                    symbol: finding.symbol,
                    length: finding.length,
                    segments: finding.segments,
                    suggestedDomainDirectory: finding.suggestedDomainDirectory,
                    suggestedSymbol: finding.suggestedSymbol,
                    actionableProposal: finding.actionableProposal,
                },
                suggestion: finding.actionableProposal.rationale,
            });
        }
    }
}

const SCALAR_SYNTAX_KINDS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.NumericLiteral,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TrueKeyword,
    ts.SyntaxKind.FalseKeyword,
    ts.SyntaxKind.BigIntLiteral,
    ts.SyntaxKind.RegularExpressionLiteral,
]);

/**
 * Strips type assertions and parenthesization from a constant initializer.
 *
 * @param expr - Expression AST node to unwrap.
 * @returns Deeply unwrapped inner expression node.
 */
export function unwrapConstantInitializer(expr: ts.Expression): ts.Expression {
    let current = expr;
    while (
        ts.isAsExpression(current) ||
        ts.isTypeAssertionExpression(current) ||
        ts.isParenthesizedExpression(current) ||
        ts.isNonNullExpression(current)
    ) {
        current = current.expression;
    }
    return current;
}

/**
 * Checks whether an expression represents a composite collection/object literal.
 *
 * @param expr - Expression AST node to inspect.
 * @returns True if expression is an object or array literal.
 */
export function isCompositeLiteral(expr: ts.Expression): boolean {
    const unwrapped = unwrapConstantInitializer(expr);
    return ts.isObjectLiteralExpression(unwrapped) || ts.isArrayLiteralExpression(unwrapped);
}

/**
 * Checks whether an expression is a scalar primitive literal.
 *
 * @param expr - Expression AST node to inspect.
 * @returns True if expression is a scalar primitive literal.
 */
export function isScalarLiteral(expr: ts.Expression): boolean {
    let unwrapped = unwrapConstantInitializer(expr);
    const isUnaryPlusOrMinus =
        ts.isPrefixUnaryExpression(unwrapped) &&
        (unwrapped.operator === ts.SyntaxKind.PlusToken ||
            unwrapped.operator === ts.SyntaxKind.MinusToken);
    if (isUnaryPlusOrMinus) {
        unwrapped = (unwrapped as ts.PrefixUnaryExpression).operand;
    }
    return SCALAR_SYNTAX_KINDS.has(unwrapped.kind);
}

const MAX_SIMPLE_ARROW_LINES = 4;

/**
 * Checks whether an AST node is a single-line or single-expression arrow function.
 *
 * @param node - AST node to test.
 * @param sf - Source file providing position offsets.
 * @returns True if node is a single-line or concise-body arrow function.
 */
export function isSimpleArrowFunction(node: ts.Node, sf: ts.SourceFile): boolean {
    if (!ts.isArrowFunction(node)) return false;
    if (!ts.isBlock(node.body) || node.body.statements.length <= 1) return true;
    const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
    return endLine - startLine <= MAX_SIMPLE_ARROW_LINES;
}
