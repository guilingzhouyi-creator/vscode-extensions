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
import { SEVERITY_WARNING } from '../core/types';
import { ANALYZER_NAMING } from '../core/scoring/dimensionLiterals';
import {
    NamingDecouplingAuditor,
    type SymbolDeclarationKind,
    type SymbolEntry,
} from '../core/architecture/naming-decoupling-auditor';
import { auditPythonSourceHelper } from './naming-python-helper';
import { auditPolyglotSource } from './naming-polyglot-helper';
import {
    auditFileAndDirectoryPaths,
    hasTransientJargon,
    APPROVED_ACTION_VERBS,
} from './naming-path-helper';
import {
    NamingMessages,
    ALLOWED_SHORT_NAMES,
    MAX_VARIABLE_NAME_LENGTH,
    MAX_FUNCTION_NAME_LENGTH,
    auditFunctionNameLengthsAndAbbreviations,
    auditVariableNameLengthsAndAbbreviations,
    auditMemberAbbreviation,
    isSimpleArrowFunction,
    type NamingActionablePayload,
} from './naming-candidate-helper';
import {
    DEFAULT_VAGUE_BLACKLIST,
    DEFAULT_SINGLE_LETTER_ALLOWED,
    checkTopLevelConstantHelper,
    checkCallExpressionJargonHelper,
    checkSymbolJargonHelper,
    checkIdentifierVaguenessHelper,
    checkSingleLetterHelper,
    checkCollectionNamingHelper,
    auditDecouplingClustersHelper,
} from './naming-ast-helper';

export {
    NamingMessages,
    ALLOWED_SHORT_NAMES,
    MAX_VARIABLE_NAME_LENGTH,
    MAX_FUNCTION_NAME_LENGTH,
    APPROVED_ACTION_VERBS,
};

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
    minFileLength?: number;
    maxFileLength?: number;
    minFileWords?: number;
    maxFileWords?: number;
    minFunctionLength?: number;
    maxFunctionLength?: number;
    minFunctionWords?: number;
    maxFunctionWords?: number;
    enforceVerbNounContract?: boolean;
    enforceMorphemeCheck?: boolean;
    allowedShortFiles?: string[];
    vagueBlacklist?: string[];
    singleLetterAllowed?: string[];
}

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
        this.dispatchLanguageAudit(ext, sf, ctx, opts, issues);

        issues.sort(
            (a, b) =>
                a.location.start.line - b.location.start.line ||
                a.location.start.column - b.location.start.column ||
                a.rule.localeCompare(b.rule),
        );

        return issues;
    }

    /**
     * Dispatches naming analysis to language-specific auditors based on file extension.
     *
     * @param ext - Normalized lowercase file extension.
     * @param sf - Optional parsed TypeScript SourceFile.
     * @param ctx - Execution analysis context.
     * @param opts - Naming analyzer configuration options.
     * @param issues - Output issues collection.
     */
    private dispatchLanguageAudit(
        ext: string,
        sf: ts.SourceFile | undefined,
        ctx: AnalyzerContext,
        opts: NamingOptions,
        issues: Issue[],
    ): void {
        if (JS_TS_EXTS.has(ext)) {
            const sourceFile =
                sf ||
                (ctx.content
                    ? ts.createSourceFile(ctx.filePath, ctx.content, ts.ScriptTarget.Latest, true)
                    : undefined);
            if (sourceFile) {
                this.auditTypeScriptAst(sourceFile, opts, ctx, issues);
            }
            return;
        }

        if (ext === '.py') {
            this.auditPythonSource(ctx.content || '', opts, ctx, issues);
            return;
        }

        if (ext === '.go' || ext === '.rs' || ext === '.gd') {
            auditPolyglotSource(
                ctx.content || '',
                ext,
                opts,
                ctx,
                (c, line, col, rule, msg, sev, detail, sugg) =>
                    this.mkIssue(c, line, col, rule, msg, sev, detail, sugg),
                issues,
            );
        }
    }

    /**
     * Finalizes analysis pass across source file.
     *
     * @param ctx - Execution analysis context.
     * @returns Array of issues identified in the source file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(ctx.sourceFile, ctx);
    }

    /**
     * Constructs a standardized naming Issue object.
     *
     * @param ctx - Execution analysis context.
     * @param line - 1-based source line index.
     * @param column - 1-based source column offset.
     * @param rule - SSOT rule identifier string.
     * @param message - Diagnostic message text.
     * @param severity - Issue severity classification.
     * @param detail - Structured diagnostic payload dictionary.
     * @param suggestion - Optional actionable resolution guidance.
     * @param actionable - Optional machine-executable fix payload.
     * @returns Formatted issue descriptor.
     */
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

    /**
     * Resolves symbol index from analysis context or runtime options.
     *
     * @param ctx - Execution analysis context.
     * @returns Symbol index instance or undefined.
     */
    private getSymbolIndex(ctx: AnalyzerContext): any {
        return (ctx as any).symbolIndex || (ctx.options as any)?.symbolIndex;
    }

    /**
     * Audits function name lengths, abbreviations, and verb-noun contract.
     *
     * @param name - Identifier string of the function.
     * @param node - AST node representation.
     * @param pos - Source position line and character offsets.
     * @param ctx - Execution analysis context.
     * @param issues - Output issues collection.
     * @param opts - Naming analyzer configuration options.
     */
    private checkFunctionName(
        name: string,
        node: ts.Node,
        pos: ts.LineAndCharacter,
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

    /**
     * Audits variable naming lengths, abbreviations, and scope contracts.
     *
     * @param name - Identifier string of the variable.
     * @param decl - AST variable declaration node.
     * @param isTopLevel - True if declared at module root scope.
     * @param pos - Source position line and character offsets.
     * @param ctx - Execution analysis context.
     * @param issues - Output issues collection.
     * @param opts - Naming analyzer configuration options.
     */
    private checkVariableName(
        name: string,
        decl: ts.Node,
        isTopLevel: boolean,
        pos: ts.LineAndCharacter,
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

    /**
     * Records discovered symbol and evaluates architectural decoupling boundaries.
     *
     * @param name - Symbol identifier string.
     * @param kind - Semantic classification kind of declaration.
     * @param pos - Source position coordinates.
     * @param opts - Naming analyzer configuration options.
     * @param ctx - Execution analysis context.
     * @param issues - Output issues collection.
     * @param symbols - Optional symbol index accumulator.
     */
    private checkDecouplingSymbol(
        name: string,
        kind: SymbolDeclarationKind,
        pos: ts.LineAndCharacter,
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

    /** Predicate determining whether an AST node represents a type declaration. */
    private isTypeDecl(node: ts.Node): boolean {
        return (
            ts.isClassDeclaration(node) ||
            ts.isInterfaceDeclaration(node) ||
            ts.isTypeAliasDeclaration(node) ||
            ts.isEnumDeclaration(node)
        );
    }

    /** Predicate determining whether an AST node represents an object or class member. */
    private isMemberDecl(node: ts.Node): boolean {
        return (
            ts.isMethodDeclaration(node) ||
            ts.isPropertyDeclaration(node) ||
            ts.isPropertyAssignment(node)
        );
    }

    /** Predicate determining whether an AST node represents a function structure. */
    private isFunctionDecl(node: ts.Node): boolean {
        return (
            ts.isFunctionDeclaration(node) ||
            ts.isArrowFunction(node) ||
            ts.isFunctionExpression(node)
        );
    }

    /** Verifies top-level scalar constants follow UPPER_SNAKE_CASE. */
    private checkTopLevelConstant(
        decl: ts.VariableDeclaration,
        name: string,
        pos: { line: number; character: number },
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        checkTopLevelConstantHelper(
            decl,
            name,
            pos,
            ctx,
            (c, line, col, rule, msg, sev, detail, sugg) =>
                this.mkIssue(c, line, col, rule, msg, sev, detail, sugg),
            issues,
        );
    }

    /** Audits destructuring patterns for vague identifiers and single letters. */
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
        const isArrow = ts.isArrowFunction(node) || ts.isFunctionExpression(node);
        const isExemptVague = isSimpleArrowFunction(node, sf);
        for (const param of fn.parameters) {
            if (ts.isIdentifier(param.name)) {
                const paramName = param.name.text;
                const pos = sf.getLineAndCharacterOfPosition(param.name.getStart(sf));
                this.checkVariableName(paramName, param, false, pos, ctx, issues, opts);
                if (!isExemptVague) {
                    this.checkIdentifierVagueness(paramName, pos, vagueSet, ctx, issues, opts);
                    this.checkSingleLetter(
                        paramName,
                        pos,
                        isArrow,
                        singleAllowed,
                        ctx,
                        issues,
                        opts,
                    );
                }
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
            this.auditDecouplingClusters(discoveredSymbols, ctx, issues);
        }
    }

    private auditDecouplingClusters(
        discoveredSymbols: SymbolEntry[],
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        auditDecouplingClustersHelper(
            discoveredSymbols,
            this.decouplingAuditor,
            ctx,
            (c, line, col, rule, msg, sev, detail, sugg) =>
                this.mkIssue(c, line, col, rule, msg, sev, detail, sugg),
            issues,
        );
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
        checkCallExpressionJargonHelper(
            node,
            sf,
            ctx,
            (c, line, col, rule, msg, sev, detail, sugg) =>
                this.mkIssue(c, line, col, rule, msg, sev, detail, sugg),
            issues,
        );
    }

    private checkSymbolJargon(
        name: string,
        pos: ts.LineAndCharacter,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        checkSymbolJargonHelper(
            name,
            pos,
            ctx,
            (c, line, col, rule, msg, sev, detail, sugg) =>
                this.mkIssue(c, line, col, rule, msg, sev, detail, sugg),
            issues,
        );
    }

    private checkIdentifierVagueness(
        name: string,
        pos: ts.LineAndCharacter,
        vagueSet: Set<string>,
        ctx: AnalyzerContext,
        issues: Issue[],
        opts: NamingOptions,
    ): void {
        checkIdentifierVaguenessHelper(
            name,
            pos,
            vagueSet,
            ctx,
            opts,
            (c, line, col, rule, msg, sev, detail, sugg) =>
                this.mkIssue(c, line, col, rule, msg, sev, detail, sugg),
            issues,
        );
    }

    private checkSingleLetter(
        name: string,
        pos: ts.LineAndCharacter,
        inLoop: boolean,
        singleAllowed: Set<string>,
        ctx: AnalyzerContext,
        issues: Issue[],
        opts: NamingOptions,
    ): void {
        checkSingleLetterHelper(
            name,
            pos,
            inLoop,
            singleAllowed,
            ctx,
            opts,
            (c, line, col, rule, msg, sev, detail, sugg) =>
                this.mkIssue(c, line, col, rule, msg, sev, detail, sugg),
            issues,
        );
    }

    private checkCollectionNaming(
        name: string,
        init: ts.Expression | undefined,
        pos: ts.LineAndCharacter,
        ctx: AnalyzerContext,
        issues: Issue[],
        opts: NamingOptions,
    ): void {
        checkCollectionNamingHelper(
            name,
            init,
            pos,
            ctx,
            opts,
            (c, line, col, rule, msg, sev, detail, sugg) =>
                this.mkIssue(c, line, col, rule, msg, sev, detail, sugg),
            issues,
        );
    }

    /**
     * Audits Python source content for function names, length, and anti-jargon conventions.
     *
     * @param content - Raw python source code content string.
     * @param opts - Analyzer naming configuration options.
     * @param ctx - Execution context.
     * @param issues - Output issues accumulator.
     */
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
