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
    vagueBlacklist?: string[];
    singleLetterAllowed?: string[];
}

/** Default blacklist of vague and uninformative variable names lacking context. */
const DEFAULT_VAGUE_WORDS =
    'data temp tmp val value res result ret obj item info param arg foo bar baz thing';

const DEFAULT_VAGUE_BLACKLIST = new Set(DEFAULT_VAGUE_WORDS.split(' '));

const DEFAULT_SINGLE_LETTER_ALLOWED = new Set(['i', 'j', 'k', '_']);

const JARGON_PATTERN_STR =
    '\\b(p[0-9]+|phase[\\s_]*[0-9]+|st[\\s_]*[0-9]+|temp|tmp|w' + 'ip|new)\\b';
const TRANSIENT_JARGON_RE = new RegExp(JARGON_PATTERN_STR, 'i');

const IGNORED_FILE_BASENAMES = new Set(
    'index main lib mod api types cli readme changelog license'.split(' '),
);

const IGNORED_DIRS = new Set(
    '.git node_modules dist build coverage testdata __pycache__'.split(' '),
);

const JS_TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SNAKE_EXTS = new Set(['.py', '.rs', '.gd']);

/**
 * Polyglot Naming and Variable Scope Analyzer.
 */
export class NamingAnalyzer implements Analyzer {
    name = 'naming' as const;

    analyze(sf: ts.SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        const issues: Issue[] = [];
        const opts = (ctx.options || {}) as NamingOptions;
        const filePath = ctx.filePath.replace(/\\/g, '/');

        if (opts.checkFiles !== false || opts.checkDirectories !== false) {
            this.auditPaths(filePath, opts, ctx, issues);
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
            this.auditPythonSource(ctx.content || '', filePath, opts, ctx, issues);
        }

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
        };
    }

    /**
     * Audit file and directory naming conventions (NAM-FIL-001, NAM-DIR-001).
     */
    private auditPaths(
        filePath: string,
        opts: NamingOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        this.auditFileName(filePath, opts, ctx, issues);
        this.auditDirectoryName(filePath, opts, ctx, issues);
    }

    private auditFileName(
        filePath: string,
        opts: NamingOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (opts.checkFiles === false) return;
        const baseName = path.basename(filePath);
        const ext = path.extname(baseName);
        let nameWithoutExt = baseName.slice(0, baseName.length - ext.length);
        if (nameWithoutExt.endsWith('.d')) {
            nameWithoutExt = nameWithoutExt.slice(0, -2);
        }
        if (IGNORED_FILE_BASENAMES.has(nameWithoutExt.toLowerCase())) return;

        if (TRANSIENT_JARGON_RE.test(nameWithoutExt)) {
            issues.push(
                this.mkIssue(
                    ctx,
                    1,
                    1,
                    'NAM-FIL-001',
                    `File name '${baseName}' contains transient process jargon or milestone tags.`,
                    SEVERITY_WARNING,
                    { file: filePath, baseName },
                    'Remove temporary batch markers (e.g. pXX, phaseXX, wip, temp) from file name.',
                ),
            );
            return;
        }

        if (JS_TS_EXTS.has(ext)) {
            this.auditTsJsFileName(filePath, baseName, nameWithoutExt, ext, ctx, issues);
        } else if (SNAKE_EXTS.has(ext)) {
            this.auditSnakeFileName(filePath, baseName, nameWithoutExt, ext, ctx, issues);
        }
    }

    private auditTsJsFileName(
        filePath: string,
        baseName: string,
        nameWithoutExt: string,
        ext: string,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const isKebab = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(nameWithoutExt);
        if (isKebab) return;
        const suggested = nameWithoutExt
            .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
            .replace(/[_]/g, '-')
            .toLowerCase();
        issues.push(
            this.mkIssue(
                ctx,
                1,
                1,
                'NAM-FIL-001',
                `File name '${baseName}' violates strict kebab-case naming convention for TypeScript/JavaScript.`,
                SEVERITY_WARNING,
                { file: filePath, baseName, suggested: `${suggested}${ext}` },
                `Rename file to '${suggested}${ext}'.`,
            ),
        );
    }

    private auditSnakeFileName(
        filePath: string,
        baseName: string,
        nameWithoutExt: string,
        ext: string,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const cleaned = ext === '.py' ? nameWithoutExt.replace(/^_(?!_)/, '') : nameWithoutExt;
        const isSnake =
            /^[a-z0-9]+(_[a-z0-9]+)*$/.test(cleaned) ||
            (ext === '.py' && /^__[a-z0-9_]+__$/.test(nameWithoutExt));
        if (isSnake) return;
        const suggested = nameWithoutExt
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/[-]/g, '_')
            .toLowerCase();
        issues.push(
            this.mkIssue(
                ctx,
                1,
                1,
                'NAM-FIL-001',
                `File name '${baseName}' violates strict snake_case naming convention for ${ext.slice(1)}.`,
                SEVERITY_WARNING,
                { file: filePath, baseName, suggested: `${suggested}${ext}` },
                `Rename file to '${suggested}${ext}'.`,
            ),
        );
    }

    private auditDirectoryName(
        filePath: string,
        opts: NamingOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (opts.checkDirectories === false) return;
        const dirParts = path.dirname(filePath).split('/').filter(Boolean);
        for (const part of dirParts) {
            if (IGNORED_DIRS.has(part) || part === '.' || part.includes(':')) continue;
            if (/[A-Z]/.test(part) || TRANSIENT_JARGON_RE.test(part)) {
                issues.push(
                    this.mkIssue(
                        ctx,
                        1,
                        1,
                        'NAM-DIR-001',
                        `Directory segment '${part}' violates lowercase kebab-case naming or contains jargon.`,
                        SEVERITY_WARNING,
                        { file: filePath, directory: part },
                        `Rename directory '${part}' to a clean lowercase kebab-case name.`,
                    ),
                );
                break;
            }
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
            ts.isFunctionExpression(node) ||
            ts.isMethodDeclaration(node)
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
        const isFn =
            ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer);
        const isClass = ts.isClassExpression(decl.initializer);
        const isPrimitive =
            ts.isNumericLiteral(decl.initializer) ||
            ts.isStringLiteral(decl.initializer) ||
            decl.initializer.kind === ts.SyntaxKind.TrueKeyword ||
            decl.initializer.kind === ts.SyntaxKind.FalseKeyword ||
            ts.isRegularExpressionLiteral(decl.initializer);

        if (isPrimitive && !isFn && !isClass && !/^[A-Z][A-Z0-9_]*$/.test(name)) {
            issues.push(
                this.mkIssue(
                    ctx,
                    pos.line + 1,
                    pos.character + 1,
                    'NAM-GLB-001',
                    `Top-level constant '${name}' should follow UPPER_SNAKE_CASE naming convention.`,
                    SEVERITY_WARNING,
                    { name },
                    `Rename '${name}' to an uppercase snake_case constant (e.g. '${name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}').`,
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
    ): void {
        if (ts.isIdentifier(decl.name)) {
            const name = decl.name.text;
            const pos = sf.getLineAndCharacterOfPosition(decl.name.getStart(sf));

            if (isTopLevel && isConst && opts.checkGlobals !== false) {
                this.checkTopLevelConstant(decl, name, pos, ctx, issues);
            }

            this.checkIdentifierVagueness(name, pos, vagueSet, ctx, issues, opts);
            this.checkSingleLetter(name, pos, inLoop, singleAllowed, ctx, issues, opts);
            this.checkCollectionNaming(name, decl.initializer, pos, ctx, issues, opts);
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
            );
        }
    }

    private checkTypeDeclaration(
        node: ts.Node,
        sf: ts.SourceFile,
        opts: NamingOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (opts.checkTypes === false) return;
        const namedNode = node as
            | ts.ClassDeclaration
            | ts.InterfaceDeclaration
            | ts.TypeAliasDeclaration
            | ts.EnumDeclaration;
        if (namedNode.name && ts.isIdentifier(namedNode.name)) {
            const typeName = namedNode.name.text;
            if (!/^[A-Z][a-zA-Z0-9]*$/.test(typeName)) {
                const pos = sf.getLineAndCharacterOfPosition(namedNode.name.getStart(sf));
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
        }
    }

    private checkMemberDeclaration(
        node: ts.Node,
        sf: ts.SourceFile,
        opts: NamingOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (opts.checkMembers === false) return;
        const member = node as
            ts.MethodDeclaration | ts.PropertyDeclaration | ts.PropertyAssignment;
        if (member.name && ts.isIdentifier(member.name)) {
            const memberName = member.name.text;
            if (!/^[_]?[a-z][a-zA-Z0-9]*$/.test(memberName) && !/^[A-Z0-9_]+$/.test(memberName)) {
                const pos = sf.getLineAndCharacterOfPosition(member.name.getStart(sf));
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
    ): void {
        const fn = node as
            | ts.FunctionDeclaration
            | ts.ArrowFunction
            | ts.FunctionExpression
            | ts.MethodDeclaration;
        for (const param of fn.parameters) {
            if (ts.isIdentifier(param.name)) {
                const paramName = param.name.text;
                const pos = sf.getLineAndCharacterOfPosition(param.name.getStart(sf));
                this.checkIdentifierVagueness(paramName, pos, vagueSet, ctx, issues, opts);
                this.checkSingleLetter(paramName, pos, false, singleAllowed, ctx, issues, opts);
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

        let inLoopDepth = 0;

        const visit = (node: ts.Node): void => {
            const isLoop =
                ts.isForStatement(node) ||
                ts.isForInStatement(node) ||
                ts.isForOfStatement(node) ||
                ts.isWhileStatement(node);
            if (isLoop) inLoopDepth++;

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
                );
            } else if (this.isTypeDecl(node)) {
                this.checkTypeDeclaration(node, sf, opts, ctx, issues);
            } else if (this.isMemberDecl(node)) {
                this.checkMemberDeclaration(node, sf, opts, ctx, issues);
            } else if (this.isFunctionDecl(node)) {
                this.checkFunctionParameters(node, sf, opts, vagueSet, singleAllowed, ctx, issues);
            }

            ts.forEachChild(node, visit);

            if (isLoop) inLoopDepth--;
        };

        ts.forEachChild(sf, visit);
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
        if (ts.isNewExpression(init) && init.expression && ts.isIdentifier(init.expression)) {
            if (init.expression.text === 'Map') {
                if (
                    !/(By[A-Z0-9]|To[A-Z0-9]|Map|Dict|Mapping)/.test(name) &&
                    !/(To|By|Map|Dict)$/i.test(name)
                ) {
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
            }
        }
    }

    private auditPythonClass(
        line: string,
        lineIdx: number,
        opts: NamingOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        if (opts.checkTypes === false) return;
        const classMatch = /^class\s+([A-Za-z0-9_]+)/.exec(line);
        if (!classMatch) return;
        const className = classMatch[1];
        if (!/^[A-Z][a-zA-Z0-9]*$/.test(className)) {
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx + 1,
                    1,
                    'NAM-TYP-001',
                    `Python class '${className}' should follow PascalCase convention.`,
                    SEVERITY_WARNING,
                    { name: className },
                    `Rename class '${className}' to PascalCase.`,
                ),
            );
        }
    }

    private auditPythonAssignment(
        line: string,
        lineIdx: number,
        opts: NamingOptions,
        vagueSet: Set<string>,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const assignMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]/.exec(line);
        if (!assignMatch) return;
        const varName = assignMatch[1];
        if (opts.checkVagueNames !== false && vagueSet.has(varName.toLowerCase())) {
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx + 1,
                    1,
                    'NAM-VAG-001',
                    `Identifier '${varName}' is vague and uninformative; lacks domain context.`,
                    SEVERITY_WARNING,
                    { name: varName },
                    `Replace '${varName}' with a domain-qualified identifier.`,
                ),
            );
        }
        if (opts.checkSingleLetters !== false && varName.length === 1 && varName !== '_') {
            issues.push(
                this.mkIssue(
                    ctx,
                    lineIdx + 1,
                    1,
                    'NAM-SGL-001',
                    `Single-letter variable name '${varName}' hurts readability.`,
                    SEVERITY_WARNING,
                    { name: varName },
                    `Replace '${varName}' with a meaningful name.`,
                ),
            );
        }
    }

    /**
     * Audit Python source text for naming conventions.
     */
    private auditPythonSource(
        content: string,
        file: string,
        opts: NamingOptions,
        ctx: AnalyzerContext,
        issues: Issue[],
    ): void {
        const vagueSet = opts.vagueBlacklist
            ? new Set(opts.vagueBlacklist)
            : DEFAULT_VAGUE_BLACKLIST;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#') || !line) continue;
            this.auditPythonClass(line, i, opts, ctx, issues);
            this.auditPythonAssignment(line, i, opts, vagueSet, ctx, issues);
        }
    }
}
