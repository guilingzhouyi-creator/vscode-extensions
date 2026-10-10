/**
 * Module: Static Analysis — Built-in Analyzer Suite (Naming Governance & Scope Hygiene)
 * File Path: src/analyzers/naming.ts
 * Architecture Role: Polyglot naming analyzer implementing the Analyzer contract;
 *   verifies file, directory, global constant, mutable top-level state, type, member,
 *   and variable naming conventions.
 * Dependencies & Triggers: Node `path`, TypeScript AST types, and `ANALYZER_NAMING`;
 *   triggered by engine analyze passes when naming is enabled or invoked standalone.
 * Responsibilities: Enforce NAM-FIL-001 (file conventions & anti-jargon), NAM-DIR-001
 *   (directory naming), NAM-GLB-001 (UPPER_SNAKE_CASE module constants), NAM-GLB-002
 *   (prohibit mutable module let/var), NAM-TYP-001 (PascalCase types & classes),
 *   NAM-MBR-001 (camelCase members & methods), NAM-VAG-001 (vague identifier blacklist),
 *   NAM-SGL-001 (scope-aware single letter guard), and NAM-COL-001 (collection semantics).
 * Exit Semantics & Design Rationale: Always returns Issue[] and never throws; options
 *   allow fine-grained toggling. AST-driven for TS and line-driven for other languages.
 */
import * as path from 'path';
import * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_WARNING, SEVERITY_INFO } from '../core/types';
import { ANALYZER_NAMING } from '../core/scoring/dimensionLiterals';
import {
    NamingDecouplingAuditor,
    type SymbolDeclarationKind,
    type SymbolEntry,
} from '../core/architecture/naming-decoupling-auditor';
import { auditPythonSourceHelper } from './naming-python-helper';
import { auditFileAndDirectoryPaths, hasTransientJargon } from './naming-path-helper';
import {
    NamingMessages,
    ALLOWED_SHORT_NAMES,
    MAX_VARIABLE_NAME_LENGTH,
    MAX_FUNCTION_NAME_LENGTH,
    auditFunctionNameLengthsAndAbbreviations,
    auditVariableNameLengthsAndAbbreviations,
    auditMemberAbbreviation,
    isCompositeLiteral,
    isScalarLiteral,
    isSimpleArrowFunction,
    type NamingActionablePayload,
} from './naming-candidate-helper';

export { NamingMessages, ALLOWED_SHORT_NAMES, MAX_VARIABLE_NAME_LENGTH, MAX_FUNCTION_NAME_LENGTH };

/**
 * Tunable options for NamingAnalyzer.
 */
export interface NamingOptions {
    checkFiles?: boolean;
    checkDirectories?: boolean;
    checkGlobals?: boolean;
    checkTypes?: boolean;
    checkMembers?: boolean;
    checkVagueNames?: boolean;
    checkSingleLetters?: boolean;
    checkCollections?: boolean;
    checkJargon?: boolean;
    checkDecoupling?: boolean;
    checkLengths?: boolean;
    checkAbbreviations?: boolean;
    vagueBlacklist?: string[];
    singleLetterAllowed?: string[];
}

/** Default blacklist of vague and uninformative variable names lacking context. */
const DEFAULT_VAGUE_WORDS =
    'data temp tmp val value res result ret obj item info param arg foo bar baz thing';

const DEFAULT_VAGUE_BLACKLIST = new Set(DEFAULT_VAGUE_WORDS.split(' '));

const DEFAULT_SINGLE_LETTER_ALLOWED = new Set(['i', 'j', 'k', '_']);

const CAMEL_TO_SNAKE_PATTERN = '$1_$2';

const TEST_TITLE_JARGON_RE = new RegExp(
    '\\b(p[0-9]+|phase[\\s_-]*[0-9]+|st[\\s_-]*[0-9]+|temp|tmp|w' + 'ip)\\b',
    'i',
);

const TEST_RUNNER_FUNCTIONS = new Set(['describe', 'it', 'test', 'suite']);

const JS_TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Polyglot Naming and Variable Scope Analyzer.
 */
export class NamingAnalyzer implements Analyzer {
    name = 'naming' as const;
    private decouplingAuditor = new NamingDecouplingAuditor();

    analyze(sf: ts.SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        const issues: Issue[] = [];
        const opts = (ctx.options || {}) as NamingOptions;
        const filePath = ctx.filePath.replace(/\\/g, '/');

        if (opts.checkFiles !== false || opts.checkDirectories !== false) {
            auditFileAndDirectoryPaths(
                filePath,
                opts,
                ctx,
                (line, rule, message, detail, suggestion) =>
                    this.mkIssue(ctx, line, 1, rule, message, SEVERITY_WARNING, detail, suggestion),
                issues,
            );
        }

        const ext = path.extname(filePath).toLowerCase();
        if (JS_TS_EXTS.has(ext)) {
            const sourceFile =
                sf ||
                (ctx.content
                    ? ts.createSourceFile(filePath, ctx.content, ts.ScriptTarget.Latest, true)
                    : undefined);
            if (sourceFile) {
                this.auditTypeScriptAst(sourceFile, opts, ctx, issues);
            }
        } else if (ext === '.py') {
            this.auditPythonSource(ctx.content || '', opts, ctx, issues);
        }

        issues.sort(
            (a, b) =>
                a.location.start.line - b.location.start.line ||
                a.location.start.column - b.location.start.column ||
                a.rule.localeCompare(b.rule),
        );

        return issues;
    }

    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(ctx.sourceFile, ctx);
    }

    private mkIssue(
        ctx: AnalyzerContext,
        line: number,
        column: number,
        rule: string,
        message: string,
        severity: Severity,
        detail: Record<string, unknown>,
        suggestion?: string,
        actionable?: NamingActionablePayload,
    ): Issue {
        return {
            id: `naming:${rule}:${ctx.filePath}:${line}`,
            analyzer: ANALYZER_NAMING,
            rule,
            severity,
            message,
            location: {
                file: ctx.filePath,
                start: { line: Math.max(1, line), column: Math.max(1, column) },
                end: { line: Math.max(1, line), column: Math.max(1, column) },
            },
            detail,
            suggestion,
            actionable,
        };
    }

    private getSymbolIndex(ctx: AnalyzerContext): any {
        return (ctx as any).symbolIndex || (ctx.options as any)?.symbolIndex;
    }

    private checkFunctionName(
        name: string,
        node: ts.Node,
        pos: { line: number; character: number },
        ctx: AnalyzerContext,
        issues: Issue[],
        opts: NamingOptions,
    ): void {
        auditFunctionNameLengthsAndAbbreviations(
            name,
            node,
            pos,
            ctx,
            opts,
            this.getSymbolIndex(ctx),
            (line, column, rule, message, severity, detail, suggestion, actionable) => {
                issues.push(
                    this.mkIssue(
                        ctx,
                        line,
                        column,
                        rule,
                        message,
                        severity,
                        detail,
                        suggestion,
                        actionable,
                    ),
                );
            },
        );
    }

    private checkVariableName(
        name: string,
        decl: ts.Node,
        isTopLevel: boolean,
        pos: { line: number; character: number },
        ctx: AnalyzerContext,
        issues: Issue[],
        opts: NamingOptions,
    ): void {
        auditVariableNameLengthsAndAbbreviations(
            name,
            decl,
            isTopLevel,
            pos,
            ctx,
            opts,
            this.getSymbolIndex(ctx),
            (line, column, rule, message, severity, detail, suggestion, actionable) => {
                issues.push(
                    this.mkIssue(
                        ctx,
                        line,
                        column,
                        rule,
                        message,
                        severity,
                        detail,
                        suggestion,
                        actionable,
                    ),
                );
            },
        );
    }

    private checkDecouplingSymbol(
        name: string,
        kind: SymbolDeclarationKind,
        pos: { line: number; character: number },
        opts: NamingOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
        symbols?: SymbolEntry[],
    ): void {
        if (symbols) {
            symbols.push({
                name,
                kind,
                line: pos.line + 1,
                column: pos.character + 1,
            });
        }
        if (opts.checkDecoupling === false) return;
        const finding = this.decouplingAuditor.auditIdentifier(
            name,
            kind,
            pos.line + 1,
            pos.character + 1,
        );
        if (finding) {
            issues.push(
                this.mkIssue(
                    ctx,
                    finding.line,
                    finding.column,
                    'NAM-DEC-001',
                    finding.message,
                    SEVERITY_WARNING,
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

    private isTypeDecl(node: ts.Node): boolean {
        return (
            ts.isClassDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isEnumDeclaration(node)
        );
    }

    private isMemberDecl(node: ts.Node): boolean {
        return (
            ts.isMethodDeclaration(node) ||
            ts.isPropertyDeclaration(node) ||
            ts.isPropertyAssignment(node)
        );
    }

    private isFunctionDecl(node: ts.Node): boolean {
        return (
            ts.isFunctionDeclaration(node) ||
            ts.isArrowFunction(node) ||
            ts.isFunctionExpression(node)
        );
    }

    private checkTopLevelConstant(
        decl: ts.VariableDeclaration,
        name: string,
        pos: { line: number; character: number },
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (!decl.initializer) return;
        const init = decl.initializer;
        const isFn = ts.isArrowFunction(init) || ts.isFunctionExpression(init);
        const isClass = ts.isClassExpression(init);
        if (isFn || isClass) return;

        // Composite object dictionaries (ObjectLiteralExpression,
        // ArrayLiteralExpression, or with as const)
        // are permitted to use camelCase (or UPPER_SNAKE_CASE).
        if (isCompositeLiteral(init)) {
            return;
        }

        // Only scalar constants enforce UPPER_SNAKE_CASE
        const isScalar = isScalarLiteral(init);
        if (isScalar && !/^[A-Z][A-Z0-9_]*$/.test(name)) {
            issues.push(
                this.mkIssue(
                    ctx,
                    pos.line + 1,
                    pos.character + 1,
                    'NAM-GLB-001',
                    `Top-level constant '${name}' should follow UPPER_SNAKE_CASE naming convention.`,
                    SEVERITY_WARNING,
                    { name },
                    `Rename '${name}' to an uppercase snake_case constant (e.g. '${name.replace(/([a-z0-9])([A-Z])/g, CAMEL_TO_SNAKE_PATTERN).toUpperCase()}').`,
                ),
            );
        }
    }

    private checkBindingPattern(
        pattern: ts.BindingPattern,
        sf: ts.SourceFile,
        opts: NamingOptions,
        vagueSet: Set<string>,
        singleAllowed: Set<string>,
        inLoop: boolean,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        for (const elem of pattern.elements) {
            if (ts.isBindingElement(elem) && ts.isIdentifier(elem.name)) {
                const elemName = elem.name.text;
                const elemPos = sf.getLineAndCharacterOfPosition(elem.name.getStart(sf));
                const isPropertyMatch =
                    !elem.propertyName ||
                    (ts.isIdentifier(elem.propertyName) && elem.propertyName.text === elemName);
                if (!isPropertyMatch) {
                    this.checkVariableName(elemName, elem, false, elemPos, ctx, issues, opts);
                    this.checkIdentifierVagueness(elemName, elemPos, vagueSet, ctx, issues, opts);
                }
                this.checkSingleLetter(elemName, elemPos, inLoop, singleAllowed, ctx, issues, opts);
            }
        }
    }

    private checkVariableDeclaration(
        decl: ts.VariableDeclaration,
        isTopLevel: boolean,
        isConst: boolean,
        sf: ts.SourceFile,
        opts: NamingOptions,
        vagueSet: Set<string>,
        singleAllowed: Set<string>,
        inLoop: boolean,
        ctx: AnalyzerContext,
        issues: Issue[],
        symbols?: SymbolEntry[],
    ): void {
        if (ts.isIdentifier(decl.name)) {
            const name = decl.name.text;
            const pos = sf.getLineAndCharacterOfPosition(decl.name.getStart(sf));

            if (isTopLevel && isConst && opts.checkGlobals !== false) {
                this.checkTopLevelConstant(decl, name, pos, ctx, issues);
            }

            this.checkVariableName(name, decl, isTopLevel, pos, ctx, issues, opts);
            this.checkIdentifierVagueness(name, pos, vagueSet, ctx, issues, opts);
            this.checkSingleLetter(name, pos, inLoop, singleAllowed, ctx, issues, opts);
            this.checkCollectionNaming(name, decl.initializer, pos, ctx, issues, opts);
            if (opts.checkJargon !== false) {
                this.checkSymbolJargon(name, pos, ctx, issues);
            }
            this.checkDecouplingSymbol(
                name,
                isConst ? 'constant' : 'variable',
                pos,
                opts,
                ctx,
                issues,
                symbols,
            );
        } else if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
            this.checkBindingPattern(
                decl.name,
                sf,
                opts,
                vagueSet,
                singleAllowed,
                inLoop,
                ctx,
                issues,
            );
        }
    }

    private checkVariableStatement(
        node: ts.VariableStatement,
        sf: ts.SourceFile,
        opts: NamingOptions,
        vagueSet: Set<string>,
        singleAllowed: Set<string>,
        inLoopDepth: number,
        ctx: AnalyzerContext,
        issues: Issue[],
        symbols?: SymbolEntry[],
    ): void {
        const isConst = Boolean(node.declarationList.flags & ts.NodeFlags.Const);
        const isTopLevel = node.parent === sf;
        if (isTopLevel && !isConst && opts.checkGlobals !== false) {
            const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            issues.push(
                this.mkIssue(
                    ctx,
                    pos.line + 1,
                    pos.character + 1,
                    'NAM-GLB-002',
                    'Module-level mutable variable declaration (`let`/`var`) introduces implicit global state.',
                    SEVERITY_WARNING,
                    { statement: node.getText(sf).slice(0, 40) },
                    'Refactor top-level mutable state into function-scoped variables, class instances, or explicit state holders.',
                ),
            );
        }

        for (const decl of node.declarationList.declarations) {
            this.checkVariableDeclaration(
                decl,
                isTopLevel,
                isConst,
                sf,
                opts,
                vagueSet,
                singleAllowed,
                inLoopDepth > 0,
                ctx,
                issues,
                symbols,
            );
        }
    }

    private checkTypeDeclaration(
        node: ts.Node,
        sf: ts.SourceFile,
        opts: NamingOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
        symbols?: SymbolEntry[],
    ): void {
        if (opts.checkTypes === false) return;
        const namedNode = node as
            | ts.ClassDeclaration
            | ts.InterfaceDeclaration
            | ts.TypeAliasDeclaration
            | ts.EnumDeclaration;
        if (namedNode.name && ts.isIdentifier(namedNode.name)) {
            const typeName = namedNode.name.text;
            const pos = sf.getLineAndCharacterOfPosition(namedNode.name.getStart(sf));
            if (!/^[A-Z][a-zA-Z0-9]*$/.test(typeName)) {
                issues.push(
                    this.mkIssue(
                        ctx,
                        pos.line + 1,
                        pos.character + 1,
                        'NAM-TYP-001',
                        `Type or class definition '${typeName}' should follow PascalCase naming convention.`,
                        SEVERITY_WARNING,
                        { name: typeName },
                        `Rename '${typeName}' to PascalCase (e.g. '${typeName[0].toUpperCase()}${typeName.slice(1)}').`,
                    ),
                );
            }
            if (opts.checkJargon !== false) {
                this.checkSymbolJargon(typeName, pos, ctx, issues);
            }
            this.checkDecouplingSymbol(typeName, 'type', pos, opts, ctx, issues, symbols);
        }
    }

    private checkMemberDeclaration(
        node: ts.Node,
        sf: ts.SourceFile,
        opts: NamingOptions,
        vagueSet: Set<string>,
        singleAllowed: Set<string>,
        ctx: AnalyzerContext,
        issues: Issue[],
        symbols?: SymbolEntry[],
    ): void {
        if (opts.checkMembers === false) return;
        const member = node as
            ts.MethodDeclaration | ts.PropertyDeclaration | ts.PropertyAssignment;
        if (member.name && ts.isIdentifier(member.name)) {
            const memberName = member.name.text;
            const pos = sf.getLineAndCharacterOfPosition(member.name.getStart(sf));
            if (!/^[_]?[a-z][a-zA-Z0-9]*$/.test(memberName) && !/^[A-Z0-9_]+$/.test(memberName)) {
                issues.push(
                    this.mkIssue(
                        ctx,
                        pos.line + 1,
                        pos.character + 1,
                        'NAM-MBR-001',
                        `Member or method '${memberName}' should follow camelCase naming convention.`,
                        SEVERITY_WARNING,
                        { name: memberName },
                        `Rename member '${memberName}' to camelCase.`,
                    ),
                );
            }
            if (ts.isMethodDeclaration(member)) {
                this.checkFunctionName(memberName, member, pos, ctx, issues, opts);
                this.checkFunctionParameters(
                    member,
                    sf,
                    opts,
                    vagueSet,
                    singleAllowed,
                    ctx,
                    issues,
                    symbols,
                );
            } else {
                auditMemberAbbreviation(
                    memberName,
                    member,
                    pos,
                    ctx,
                    opts,
                    this.getSymbolIndex(ctx),
                    (line, column, rule, message, severity, detail, suggestion, actionable) => {
                        issues.push(
                            this.mkIssue(
                                ctx,
                                line,
                                column,
                                rule,
                                message,
                                severity,
                                detail,
                                suggestion,
                                actionable,
                            ),
                        );
                    },
                );
            }
            if (opts.checkJargon !== false) {
                this.checkSymbolJargon(memberName, pos, ctx, issues);
            }
            this.checkDecouplingSymbol(memberName, 'member', pos, opts, ctx, issues, symbols);
        }
    }

    private checkFunctionParameters(
        node: ts.Node,
        sf: ts.SourceFile,
        opts: NamingOptions,
        vagueSet: Set<string>,
        singleAllowed: Set<string>,
        ctx: AnalyzerContext,
        issues: Issue[],
        symbols?: SymbolEntry[],
    ): void {
        const fn = node as
            | ts.FunctionDeclaration
            | ts.ArrowFunction
            | ts.FunctionExpression
            | ts.MethodDeclaration;
        if (ts.isFunctionDeclaration(node) && node.name) {
            const pos = sf.getLineAndCharacterOfPosition(node.name.getStart(sf));
            this.checkFunctionName(node.name.text, node, pos, ctx, issues, opts);
            if (opts.checkJargon !== false) {
                this.checkSymbolJargon(node.name.text, pos, ctx, issues);
            }
            this.checkDecouplingSymbol(node.name.text, 'function', pos, opts, ctx, issues, symbols);
        }
        const isExemptVague = isSimpleArrowFunction(node, sf);
        for (const param of fn.parameters) {
            if (ts.isIdentifier(param.name)) {
                const paramName = param.name.text;
                const pos = sf.getLineAndCharacterOfPosition(param.name.getStart(sf));
                this.checkVariableName(paramName, param, false, pos, ctx, issues, opts);
                if (!isExemptVague) {
                    this.checkIdentifierVagueness(paramName, pos, vagueSet, ctx, issues, opts);
                }
                this.checkSingleLetter(paramName, pos, false, singleAllowed, ctx, issues, opts);
                if (opts.checkJargon !== false) {
                    this.checkSymbolJargon(paramName, pos, ctx, issues);
                }
            }
        }
    }

    /**
     * Audit TypeScript AST for global constants, types, members, vague words,
     * and single-letter bindings.
     */
    private auditTypeScriptAst(
        sf: ts.SourceFile,
        opts: NamingOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const vagueSet = opts.vagueBlacklist
            ? new Set(opts.vagueBlacklist)
            : DEFAULT_VAGUE_BLACKLIST;
        const singleAllowed = opts.singleLetterAllowed
            ? new Set(opts.singleLetterAllowed)
            : DEFAULT_SINGLE_LETTER_ALLOWED;

        const discoveredSymbols: SymbolEntry[] = [];
        let inLoopDepth = 0;

        const visit = (node: ts.Node): void => {
            const isLoop =
                ts.isForStatement(node) ||
                ts.isForInStatement(node) ||
                ts.isForOfStatement(node) ||
                ts.isWhileStatement(node);
            if (isLoop) inLoopDepth++;

            this.dispatchAstNode(
                node,
                sf,
                opts,
                vagueSet,
                singleAllowed,
                inLoopDepth,
                ctx,
                issues,
                discoveredSymbols,
            );

            ts.forEachChild(node, visit);

            if (isLoop) inLoopDepth--;
        };

        ts.forEachChild(sf, visit);

        if (opts.checkDecoupling !== false && discoveredSymbols.length >= 4) {
            const clusterFindings = this.decouplingAuditor.auditClusters(discoveredSymbols);
            const flaggedDecouplingSymbols = new Set<string>();
            for (const issue of issues) {
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
                    issues.push(
                        this.mkIssue(
                            ctx,
                            finding.line,
                            finding.column,
                            'NAM-DEC-001',
                            finding.message,
                            SEVERITY_WARNING,
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
    }

    private dispatchAstNode(
        node: ts.Node,
        sf: ts.SourceFile,
        opts: NamingOptions,
        vagueSet: Set<string>,
        singleAllowed: Set<string>,
        inLoopDepth: number,
        ctx: AnalyzerContext,
        issues: Issue[],
        symbols?: SymbolEntry[],
    ): void {
        if (ts.isVariableStatement(node)) {
            this.checkVariableStatement(
                node,
                sf,
                opts,
                vagueSet,
                singleAllowed,
                inLoopDepth,
                ctx,
                issues,
                symbols,
            );
        } else if (this.isTypeDecl(node)) {
            this.checkTypeDeclaration(node, sf, opts, ctx, issues, symbols);
        } else if (this.isMemberDecl(node)) {
            this.checkMemberDeclaration(
                node,
                sf,
                opts,
                vagueSet,
                singleAllowed,
                ctx,
                issues,
                symbols,
            );
        } else if (this.isFunctionDecl(node)) {
            this.checkFunctionParameters(
                node,
                sf,
                opts,
                vagueSet,
                singleAllowed,
                ctx,
                issues,
                symbols,
            );
        } else if (ts.isCallExpression(node) && opts.checkJargon !== false) {
            this.checkCallExpressionJargon(node, sf, ctx, issues);
        }
    }

    private checkCallExpressionJargon(
        node: ts.CallExpression,
        sf: ts.SourceFile,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (!ts.isIdentifier(node.expression) || !TEST_RUNNER_FUNCTIONS.has(node.expression.text)) {
            return;
        }
        const arg0 = node.arguments[0];
        if (!arg0 || (!ts.isStringLiteral(arg0) && !ts.isNoSubstitutionTemplateLiteral(arg0))) {
            return;
        }
        if (TEST_TITLE_JARGON_RE.test(arg0.text)) {
            const pos = sf.getLineAndCharacterOfPosition(arg0.getStart(sf));
            issues.push(
                this.mkIssue(
                    ctx,
                    pos.line + 1,
                    pos.character + 1,
                    'NAM-JRG-002',
                    `Test title '${arg0.text}' contains transient construction jargon or milestone marker.`,
                    SEVERITY_WARNING,
                    { title: arg0.text },
                    'Remove transient process markers from test description.',
                ),
            );
        }
    }

    private checkSymbolJargon(
        name: string,
        pos: { line: number; character: number },
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (hasTransientJargon(name)) {
            issues.push(
                this.mkIssue(
                    ctx,
                    pos.line + 1,
                    pos.character + 1,
                    'NAM-JRG-002',
                    `Symbol or test identifier '${name}' contains transient construction jargon or milestone marker.`,
                    SEVERITY_WARNING,
                    { name },
                    'Replace transient process markers with semantic domain naming.',
                ),
            );
        }
    }

    private checkIdentifierVagueness(
        name: string,
        pos: { line: number; character: number },
        vagueSet: Set<string>,
        ctx: AnalyzerContext,
        issues: Issue[],
        opts: NamingOptions,
    ): void {
        if (opts.checkVagueNames === false) return;
        if (vagueSet.has(name.toLowerCase())) {
            issues.push(
                this.mkIssue(
                    ctx,
                    pos.line + 1,
                    pos.character + 1,
                    'NAM-VAG-001',
                    `Identifier '${name}' is vague and uninformative; lacks domain context.`,
                    SEVERITY_WARNING,
                    { name },
                    `Replace '${name}' with a domain-qualified identifier (e.g. 'parseResult', 'userData', 'tokenPayload').`,
                ),
            );
        }
    }

    private checkSingleLetter(
        name: string,
        pos: { line: number; character: number },
        inLoop: boolean,
        singleAllowed: Set<string>,
        ctx: AnalyzerContext,
        issues: Issue[],
        opts: NamingOptions,
    ): void {
        if (opts.checkSingleLetters === false) return;
        if (name.length === 1 && /^[a-zA-Z]$/.test(name)) {
            if (inLoop && singleAllowed.has(name)) return;
            if (name === '_') return;
            issues.push(
                this.mkIssue(
                    ctx,
                    pos.line + 1,
                    pos.character + 1,
                    'NAM-SGL-001',
                    `Single-letter variable name '${name}' hurts code readability.`,
                    SEVERITY_WARNING,
                    { name, inLoop },
                    `Replace '${name}' with a meaningful descriptive name; only loop indices ('i','j','k') and '_' are tolerated.`,
                ),
            );
        }
    }

    private checkCollectionNaming(
        name: string,
        init: ts.Expression | undefined,
        pos: { line: number; character: number },
        ctx: AnalyzerContext,
        issues: Issue[],
        opts: NamingOptions,
    ): void {
        if (opts.checkCollections === false || !init) return;
        if (!ts.isNewExpression(init) || !init.expression || !ts.isIdentifier(init.expression)) {
            return;
        }
        if (init.expression.text !== 'Map') return;
        if (
            /(By[A-Z0-9]|To[A-Z0-9]|Map|Dict|Mapping)/.test(name) ||
            /(To|By|Map|Dict)$/i.test(name)
        ) {
            return;
        }

        issues.push(
            this.mkIssue(
                ctx,
                pos.line + 1,
                pos.character + 1,
                'NAM-COL-001',
                `Map '${name}' should describe key-value relation in its name.`,
                SEVERITY_INFO,
                { name },
                `Rename Map to express relationship (e.g. '${name}ById', '${name}ToTarget', or '${name}Map').`,
            ),
        );
    }

    private auditPythonSource(
        content: string,
        opts: NamingOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const vagueSet = opts.vagueBlacklist
            ? new Set(opts.vagueBlacklist)
            : DEFAULT_VAGUE_BLACKLIST;

        auditPythonSourceHelper(
            content,
            opts,
            vagueSet,
            hasTransientJargon,
            (line, rule, msg, detail, sugg) =>
                this.mkIssue(ctx, line, 1, rule, msg, SEVERITY_WARNING, detail, sugg),
            (name, kind, loc, syms) =>
                this.checkDecouplingSymbol(name, kind, loc, opts, ctx, issues, syms),
            this.decouplingAuditor,
            issues,
        );
    }
}
