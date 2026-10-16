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
    type NamingActionablePayload,
    type NamingDiagnosticRecord,
    type SymbolIndexLike,
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
    isSimpleArrowFunction,
    type AstNamingContext,
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

/**
 * Structured diagnostic payload for formatting naming issues.
 */
export interface NamingFindingInput {
    readonly line: number;
    readonly column?: number;
    readonly rule: string;
    readonly message: string;
    readonly severity?: Severity;
    readonly detail?: Record<string, unknown>;
    readonly suggestion?: string;
    readonly actionable?: NamingActionablePayload;
}

/** Scope context for variable audits. */
export interface VariableScope {
    readonly isTopLevel: boolean;
    readonly inLoop: boolean;
    readonly isConst?: boolean;
}

/** Target description for variable naming checks. */
export interface VariableTarget {
    readonly name: string;
    readonly decl: ts.Node;
    readonly pos: ts.LineAndCharacter;
    readonly isTopLevel?: boolean;
}

const JS_TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const CATALOG_PATH_RE = /(?:literals|constants|dictionar(?:y|ies)|tokens|rule-?table)/i;

const KIND_CONSTANT: SymbolDeclarationKind = 'constant';
const KIND_VARIABLE: SymbolDeclarationKind = 'variable';
const KIND_TYPE: SymbolDeclarationKind = 'type';
const KIND_MEMBER: SymbolDeclarationKind = 'member';
const KIND_FUNCTION: SymbolDeclarationKind = 'function';

const MAX_STATEMENT_PREVIEW_LENGTH = 40;
const MIN_DECOUPLING_SYMBOLS_COUNT = 4;

/**
 * Determines whether a file path represents a dedicated constants, literals, or dictionary table
 * where centralized definition clustering is expected and architectural decoupling proposals
 * would cause harmful mechanical fragmentation.
 */
function isCatalogOrLiteralsPath(filePath: string): boolean {
    return Boolean(filePath && CATALOG_PATH_RE.test(filePath.replace(/\\/g, '/')));
}

/**
 * Polyglot Naming and Variable Scope Analyzer.
 */
export class NamingAnalyzer implements Analyzer {
    readonly name = ANALYZER_NAMING;
    private readonly decouplingAuditor = new NamingDecouplingAuditor();

    analyze(sf: ts.SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        const issues: Issue[] = [];
        const opts = (ctx.options || {}) as NamingOptions;
        const filePath = ctx.filePath.replace(/\\/g, '/');

        if (opts.checkFiles !== false || opts.checkDirectories !== false) {
            auditFileAndDirectoryPaths({
                filePath,
                opts,
                ctx,
                mkIssue: (finding) => this.formatIssue(ctx, finding),
                issues,
            });
        }

        const ext = path.extname(filePath).toLowerCase();
        this.dispatchLanguageAudit(ext, sf, ctx, issues);

        issues.sort(
            (a, b) =>
                a.location.start.line - b.location.start.line ||
                a.location.start.column - b.location.start.column ||
                a.rule.localeCompare(b.rule),
        );

        return issues;
    }

    private resolveSourceFile(ctx: AnalyzerContext): ts.SourceFile | undefined {
        if (!ctx.content) return undefined;
        return ts.createSourceFile(ctx.filePath, ctx.content, ts.ScriptTarget.Latest, true);
    }

    /**
     * Dispatches naming analysis to language-specific auditors based on file extension.
     */
    private dispatchLanguageAudit(
        ext: string,
        sf: ts.SourceFile | undefined,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const opts = (ctx.options || {}) as NamingOptions;
        if (JS_TS_EXTS.has(ext)) {
            const sourceFile = sf ?? this.resolveSourceFile(ctx);
            if (sourceFile) {
                this.auditTypeScriptAst(sourceFile, opts, ctx, issues);
            }
            return;
        }

        if (ext === '.py') {
            this.auditPythonSource(ctx.content || '', ctx, issues);
            return;
        }

        if (ext === '.go' || ext === '.rs' || ext === '.gd') {
            auditPolyglotSource(ctx.content || '', ext, {
                opts,
                ctx,
                mkIssue: (finding) => this.formatIssue(ctx, finding),
                issues,
            });
        }
    }

    /**
     * Finalizes analysis pass across source file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(ctx.sourceFile, ctx);
    }

    /**
     * Constructs a standardized naming Issue object.
     */
    private formatIssue(ctx: AnalyzerContext, finding: NamingFindingInput): Issue {
        const line = Math.max(1, finding.line);
        const column = Math.max(1, finding.column ?? 1);
        return {
            id: `naming:${finding.rule}:${ctx.filePath}:${line}`,
            analyzer: ANALYZER_NAMING,
            rule: finding.rule,
            severity: finding.severity ?? SEVERITY_WARNING,
            message: finding.message,
            location: {
                file: ctx.filePath,
                start: { line, column },
                end: { line, column },
            },
            detail: finding.detail ?? {},
            suggestion: finding.suggestion,
            actionable: finding.actionable,
        };
    }

    /**
     * Emits a diagnostic finding into the AST naming context issue list.
     */
    private emitDiagnostic(aCtx: AstNamingContext, diagnostic: NamingDiagnosticRecord): void {
        aCtx.issues.push(this.formatIssue(aCtx.ctx, diagnostic));
    }

    /**
     * Resolves symbol index from analysis context or runtime options without unsafe casting.
     */
    private extractSymbolIndex(ctx: AnalyzerContext): SymbolIndexLike | undefined {
        const direct = (ctx as { symbolIndex?: SymbolIndexLike }).symbolIndex;
        const fromOpts = (ctx.options as { symbolIndex?: SymbolIndexLike } | undefined)
            ?.symbolIndex;
        return direct ?? fromOpts;
    }

    private resolveSymbolIndexAndEmitter(aCtx: AstNamingContext): {
        readonly index: SymbolIndexLike | undefined;
        readonly emit: (d: NamingDiagnosticRecord) => void;
    } {
        return {
            index: this.extractSymbolIndex(aCtx.ctx),
            emit: (d: NamingDiagnosticRecord) => this.emitDiagnostic(aCtx, d),
        };
    }

    /**
     * Audits function name lengths, abbreviations, and verb-noun contract.
     */
    private checkFunctionName(
        name: string,
        node: ts.Node,
        pos: ts.LineAndCharacter,
        aCtx: AstNamingContext,
    ): void {
        const { index, emit } = this.resolveSymbolIndexAndEmitter(aCtx);
        auditFunctionNameLengthsAndAbbreviations(name, node, pos, aCtx.ctx, aCtx.opts, index, emit);
    }

    /**
     * Audits variable naming lengths, abbreviations, and scope contracts.
     */
    private checkVariableName(target: VariableTarget, aCtx: AstNamingContext): void {
        const { index, emit } = this.resolveSymbolIndexAndEmitter(aCtx);
        auditVariableNameLengthsAndAbbreviations(
            target.name,
            target.decl,
            target.isTopLevel ?? false,
            target.pos,
            aCtx.ctx,
            aCtx.opts,
            index,
            emit,
        );
    }

    /**
     * Records discovered symbol and evaluates architectural decoupling boundaries.
     */
    private checkDecouplingSymbol(
        name: string,
        kind: SymbolDeclarationKind,
        pos: { line: number; character: number },
        aCtx: AstNamingContext,
    ): void {
        if (aCtx.symbols) {
            aCtx.symbols.push({
                name,
                kind,
                line: pos.line + 1,
                column: pos.character + 1,
            });
        }
        if (aCtx.opts.checkDecoupling === false || isCatalogOrLiteralsPath(aCtx.ctx.filePath))
            return;
        const finding = this.decouplingAuditor.auditIdentifier(
            name,
            kind,
            pos.line + 1,
            pos.character + 1,
        );
        if (finding) {
            aCtx.issues.push(
                this.formatIssue(aCtx.ctx, {
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
                }),
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

    /** Audits individual binding element in destructuring patterns. */
    private auditBindingElement(
        elem: ts.BindingElement,
        inLoop: boolean,
        aCtx: AstNamingContext,
    ): void {
        if (!ts.isIdentifier(elem.name)) return;
        const elemName = elem.name.text;
        const elemPos = aCtx.sf.getLineAndCharacterOfPosition(elem.name.getStart(aCtx.sf));
        const isPropertyMatch =
            !elem.propertyName ||
            (ts.isIdentifier(elem.propertyName) && elem.propertyName.text === elemName);
        if (!isPropertyMatch) {
            this.checkVariableName({ name: elemName, decl: elem, pos: elemPos }, aCtx);
            checkIdentifierVaguenessHelper(elemName, elemPos, aCtx);
        }
        checkSingleLetterHelper(elemName, elemPos, inLoop, aCtx);
    }

    /** Audits destructuring patterns for vague identifiers and single letters. */
    private checkBindingPattern(
        pattern: ts.BindingPattern,
        inLoop: boolean,
        aCtx: AstNamingContext,
    ): void {
        for (const elem of pattern.elements) {
            if (ts.isBindingElement(elem)) {
                this.auditBindingElement(elem, inLoop, aCtx);
            }
        }
    }

    private checkVariableDeclaration(
        decl: ts.VariableDeclaration,
        scope: VariableScope,
        aCtx: AstNamingContext,
    ): void {
        if (ts.isIdentifier(decl.name)) {
            const name = decl.name.text;
            const pos = aCtx.sf.getLineAndCharacterOfPosition(decl.name.getStart(aCtx.sf));

            if (scope.isTopLevel && scope.isConst && aCtx.opts.checkGlobals !== false) {
                checkTopLevelConstantHelper(decl, name, pos, aCtx);
            }

            this.checkVariableName({ name, decl, pos, isTopLevel: scope.isTopLevel }, aCtx);
            checkIdentifierVaguenessHelper(name, pos, aCtx);
            checkSingleLetterHelper(name, pos, scope.inLoop, aCtx);
            checkCollectionNamingHelper(name, decl.initializer, pos, aCtx);
            if (aCtx.opts.checkJargon !== false) {
                checkSymbolJargonHelper(name, pos, aCtx);
            }
            this.checkDecouplingSymbol(
                name,
                scope.isConst ? KIND_CONSTANT : KIND_VARIABLE,
                pos,
                aCtx,
            );
            return;
        }

        if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
            this.checkBindingPattern(decl.name, scope.inLoop, aCtx);
        }
    }

    private checkVariableStatement(
        node: ts.VariableStatement,
        inLoopDepth: number,
        aCtx: AstNamingContext,
    ): void {
        const isConst = Boolean(node.declarationList.flags & ts.NodeFlags.Const);
        const isTopLevel = node.parent === aCtx.sf;
        if (isTopLevel && !isConst && aCtx.opts.checkGlobals !== false) {
            const pos = aCtx.sf.getLineAndCharacterOfPosition(node.getStart(aCtx.sf));
            aCtx.issues.push(
                this.formatIssue(aCtx.ctx, {
                    line: pos.line + 1,
                    column: pos.character + 1,
                    rule: 'NAM-GLB-002',
                    message:
                        'Module-level mutable variable declaration (`let`/`var`) introduces implicit global state.',
                    severity: SEVERITY_WARNING,
                    detail: {
                        statement: node.getText(aCtx.sf).slice(0, MAX_STATEMENT_PREVIEW_LENGTH),
                    },
                    suggestion:
                        'Refactor top-level mutable state into function-scoped variables, class instances, or explicit state holders.',
                }),
            );
        }

        const scope: VariableScope = {
            isTopLevel,
            isConst,
            inLoop: inLoopDepth > 0,
        };

        for (const decl of node.declarationList.declarations) {
            this.checkVariableDeclaration(decl, scope, aCtx);
        }
    }

    private checkTypeDeclaration(node: ts.Node, aCtx: AstNamingContext): void {
        if (aCtx.opts.checkTypes === false) return;
        const namedNode = node as
            | ts.ClassDeclaration
            | ts.InterfaceDeclaration
            | ts.TypeAliasDeclaration
            | ts.EnumDeclaration;
        if (!namedNode.name || !ts.isIdentifier(namedNode.name)) return;

        const typeName = namedNode.name.text;
        const pos = aCtx.sf.getLineAndCharacterOfPosition(namedNode.name.getStart(aCtx.sf));
        if (!/^[A-Z][a-zA-Z0-9]*$/.test(typeName)) {
            aCtx.issues.push(
                this.formatIssue(aCtx.ctx, {
                    line: pos.line + 1,
                    column: pos.character + 1,
                    rule: 'NAM-TYP-001',
                    message: `Type or class definition '${typeName}' should follow PascalCase naming convention.`,
                    severity: SEVERITY_WARNING,
                    detail: { name: typeName },
                    suggestion: `Rename '${typeName}' to PascalCase (e.g. '${typeName[0].toUpperCase()}${typeName.slice(1)}').`,
                }),
            );
        }
        if (aCtx.opts.checkJargon !== false) {
            checkSymbolJargonHelper(typeName, pos, aCtx);
        }
        this.checkDecouplingSymbol(typeName, KIND_TYPE, pos, aCtx);
    }

    private auditMemberCamelCase(
        name: string,
        pos: ts.LineAndCharacter,
        aCtx: AstNamingContext,
    ): void {
        if (/^[_]?[a-z][a-zA-Z0-9]*$/.test(name) || /^[A-Z0-9_]+$/.test(name)) {
            return;
        }
        aCtx.issues.push(
            this.formatIssue(aCtx.ctx, {
                line: pos.line + 1,
                column: pos.character + 1,
                rule: 'NAM-MBR-001',
                message: `Member or method '${name}' should follow camelCase naming convention.`,
                severity: SEVERITY_WARNING,
                detail: { name },
                suggestion: `Rename member '${name}' to camelCase.`,
            }),
        );
    }

    private checkMemberDeclaration(node: ts.Node, aCtx: AstNamingContext): void {
        if (aCtx.opts.checkMembers === false) return;
        const member = node as
            ts.MethodDeclaration | ts.PropertyDeclaration | ts.PropertyAssignment;
        if (!member.name || !ts.isIdentifier(member.name)) return;

        const memberName = member.name.text;
        const pos = aCtx.sf.getLineAndCharacterOfPosition(member.name.getStart(aCtx.sf));
        this.auditMemberCamelCase(memberName, pos, aCtx);

        if (ts.isMethodDeclaration(member)) {
            this.checkFunctionName(memberName, member, pos, aCtx);
            this.checkFunctionParameters(member, aCtx);
        } else {
            const { index, emit } = this.resolveSymbolIndexAndEmitter(aCtx);
            auditMemberAbbreviation(memberName, member, pos, aCtx.ctx, aCtx.opts, index, emit);
        }

        if (aCtx.opts.checkJargon !== false) {
            checkSymbolJargonHelper(memberName, pos, aCtx);
        }
        this.checkDecouplingSymbol(memberName, KIND_MEMBER, pos, aCtx);
    }

    /** Audits an individual parameter of a function or method. */
    private auditFunctionParameter(
        paramDecl: ts.ParameterDeclaration,
        isArrow: boolean,
        isExemptVague: boolean,
        aCtx: AstNamingContext,
    ): void {
        if (!ts.isIdentifier(paramDecl.name)) return;
        const paramName = paramDecl.name.text;
        const pos = aCtx.sf.getLineAndCharacterOfPosition(paramDecl.name.getStart(aCtx.sf));
        this.checkVariableName({ name: paramName, decl: paramDecl, pos }, aCtx);
        if (!isExemptVague) {
            checkIdentifierVaguenessHelper(paramName, pos, aCtx);
            checkSingleLetterHelper(paramName, pos, isArrow, aCtx);
        }
        if (aCtx.opts.checkJargon !== false) {
            checkSymbolJargonHelper(paramName, pos, aCtx);
        }
    }

    private checkFunctionParameters(node: ts.Node, aCtx: AstNamingContext): void {
        const fn = node as
            | ts.FunctionDeclaration
            | ts.ArrowFunction
            | ts.FunctionExpression
            | ts.MethodDeclaration;
        if (ts.isFunctionDeclaration(node) && node.name) {
            const pos = aCtx.sf.getLineAndCharacterOfPosition(node.name.getStart(aCtx.sf));
            this.checkFunctionName(node.name.text, node, pos, aCtx);
            if (aCtx.opts.checkJargon !== false) {
                checkSymbolJargonHelper(node.name.text, pos, aCtx);
            }
            this.checkDecouplingSymbol(node.name.text, KIND_FUNCTION, pos, aCtx);
        }
        const isArrow = ts.isArrowFunction(node) || ts.isFunctionExpression(node);
        const isExemptVague = isSimpleArrowFunction(node, aCtx.sf);
        for (const paramDecl of fn.parameters) {
            this.auditFunctionParameter(paramDecl, isArrow, isExemptVague, aCtx);
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
        const aCtx: AstNamingContext = {
            ctx,
            opts,
            issues,
            sf,
            vagueSet,
            singleAllowed,
            symbols: discoveredSymbols,
        };

        let inLoopDepth = 0;
        const visit = (node: ts.Node): void => {
            const isLoop =
                ts.isForStatement(node) ||
                ts.isForInStatement(node) ||
                ts.isForOfStatement(node) ||
                ts.isWhileStatement(node);
            if (isLoop) inLoopDepth++;

            this.dispatchAstNode(node, inLoopDepth, aCtx);

            ts.forEachChild(node, visit);

            if (isLoop) inLoopDepth--;
        };

        ts.forEachChild(sf, visit);

        if (
            opts.checkDecoupling !== false &&
            discoveredSymbols.length >= MIN_DECOUPLING_SYMBOLS_COUNT
        ) {
            this.auditDecouplingClusters(aCtx);
        }
    }

    private auditDecouplingClusters(aCtx: AstNamingContext): void {
        if (!aCtx.symbols || isCatalogOrLiteralsPath(aCtx.ctx.filePath)) return;
        auditDecouplingClustersHelper(aCtx.symbols, this.decouplingAuditor, aCtx);
    }

    private dispatchAstNode(node: ts.Node, inLoopDepth: number, aCtx: AstNamingContext): void {
        if (ts.isVariableStatement(node)) {
            this.checkVariableStatement(node, inLoopDepth, aCtx);
            return;
        }
        if (this.isTypeDecl(node)) {
            this.checkTypeDeclaration(node, aCtx);
            return;
        }
        if (this.isMemberDecl(node)) {
            this.checkMemberDeclaration(node, aCtx);
            return;
        }
        if (this.isFunctionDecl(node)) {
            this.checkFunctionParameters(node, aCtx);
            return;
        }
        if (ts.isCallExpression(node) && aCtx.opts.checkJargon !== false) {
            checkCallExpressionJargonHelper(node, aCtx.sf, aCtx);
        }
    }

    /**
     * Audits Python source content for function names, length, and anti-jargon conventions.
     */
    private auditPythonSource(content: string, ctx: AnalyzerContext, issues: Issue[]): void {
        const opts = (ctx.options || {}) as NamingOptions;
        const vagueSet = opts.vagueBlacklist
            ? new Set(opts.vagueBlacklist)
            : DEFAULT_VAGUE_BLACKLIST;

        auditPythonSourceHelper(
            content,
            {
                opts,
                vagueSet,
                hasTransientJargon,
                mkIssue: (finding) => this.formatIssue(ctx, finding),
                checkDecouplingSymbol: (name, kind, loc, syms) => {
                    const pyCtx: AstNamingContext = {
                        ctx,
                        opts,
                        issues,
                        sf: undefined as unknown as ts.SourceFile,
                        symbols: syms,
                    };
                    this.checkDecouplingSymbol(
                        name,
                        kind,
                        { line: loc.line - 1, character: loc.character - 1 },
                        pyCtx,
                    );
                },
                issues,
            },
            this.decouplingAuditor,
        );
    }
}
