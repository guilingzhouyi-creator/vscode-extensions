/**
 * Module: Core Codemod — Constant Extraction AST Safety Guards
 * File Path: src/core/codemod/transforms/extract-constant-guards.ts
 * Architecture Role: Provides fail-closed TypeScript AST validators for safe literal detection,
 *   import-anchor resolution, duplicate binding checks, and enclosing-scope shadowing prevention.
 * Dependencies & Triggers: Invoked exclusively by extract-constant.ts during fix planning.
 * Responsibilities: Validate target file kinds and identifiers, resolve non-overlapping declaration
 *   anchors after import prologues, and guard against TDZ/redeclaration/shadowing hazards.
 * Exit Semantics & Design Rationale: Pure stateless AST inspection; returns null or false on any
 *   parse diagnostic or ambiguous syntax context so `--fix` never corrupts source semantics.
 */

import * as path from 'path';
import * as ts from 'typescript';
import { isContentlessName } from '../../../utils/placeholder-names';
import type { TextEdit } from '../types';

/** Binding audit outcome for a candidate top-level constant identifier. */
export interface TopLevelBindingStatus {
    readonly conflict: boolean;
    readonly matchingConstEndOffset: number | null;
}

/** Context bundle passed across top-level statement binding checks. */
interface BindingAuditContext {
    readonly sourceFile: ts.SourceFile;
    readonly targetSymbol: string;
    readonly rawLiteral: string;
}

const VALID_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const FIRST_COLUMN = 1;
const MIN_BLANK_GAP_NEWLINES = 2;
const JS_TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SCRIPT_EXTENSION_KINDS: Readonly<Record<string, ts.ScriptKind>> = Object.freeze({
    '.tsx': ts.ScriptKind.TSX,
    '.jsx': ts.ScriptKind.JSX,
    '.js': ts.ScriptKind.JS,
    '.mjs': ts.ScriptKind.JS,
    '.cjs': ts.ScriptKind.JS,
});
const RESERVED_WORDS = new Set(
    (
        'await arguments break case catch class const continue debugger default delete do else ' +
        'enum eval export extends false finally for function if implements import in Infinity ' +
        'instanceof interface let NaN new null package private protected public return static ' +
        'super switch this throw true try typeof undefined var void while with yield'
    ).split(' '),
);
const NAMED_PROPERTY_PARENT_KINDS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.PropertyAssignment,
    ts.SyntaxKind.PropertySignature,
    ts.SyntaxKind.PropertyDeclaration,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.EnumMember,
]);
const TOP_NAMED_DECL_KINDS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.InterfaceDeclaration,
    ts.SyntaxKind.TypeAliasDeclaration,
    ts.SyntaxKind.EnumDeclaration,
    ts.SyntaxKind.ModuleDeclaration,
    ts.SyntaxKind.ImportEqualsDeclaration,
]);

/**
 * Checks whether a file path targets a JavaScript/TypeScript source module.
 *
 * @param filePath - Candidate source file path.
 * @returns True when the file path targets JS/TS source or is unset.
 */
export function isSupportedJsTsPath(filePath: string): boolean {
    if (!filePath) return true;
    const ext = path.extname(filePath).toLowerCase();
    return ext === '' || JS_TS_EXTENSIONS.has(ext);
}

/**
 * Validates that a candidate constant name is a non-reserved, meaningful JS/TS identifier.
 *
 * @param targetSymbol - Suggested constant identifier.
 * @returns True if identifier syntax, reserved-word, and content checks pass.
 */
export function checkSafeTargetSymbol(targetSymbol: string): boolean {
    if (!VALID_IDENTIFIER_RE.test(targetSymbol) || RESERVED_WORDS.has(targetSymbol)) {
        return false;
    }
    return !isContentlessName(targetSymbol);
}

/**
 * Parses source text into a TypeScript AST and returns null when any syntax error exists.
 *
 * @param filePath - Logical file path used to select script kind.
 * @param sourceText - Raw module source text.
 * @returns Parsed AST SourceFile when parseDiagnostics are empty, otherwise null.
 */
export function parseCleanSourceFile(filePath: string, sourceText: string): ts.SourceFile | null {
    if (!sourceText || sourceText.trim().length === 0) return null;
    const ext = path.extname(filePath).toLowerCase();
    const scriptKind = SCRIPT_EXTENSION_KINDS[ext] ?? ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(
        filePath || 'target.ts',
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        scriptKind,
    );
    const diags = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
        .parseDiagnostics;
    return diags && diags.length > 0 ? null : sourceFile;
}

function isSafeLiteralNode(node: ts.Node): boolean {
    if (
        ts.isNumericLiteral(node) ||
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)
    ) {
        return true;
    }
    return (
        ts.isPrefixUnaryExpression(node) &&
        (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken) &&
        ts.isNumericLiteral(node.operand)
    );
}

function checkUnsafeLiteralParent(node: ts.Node): boolean {
    const parent = node.parent;
    if (!parent) return true;
    if (ts.isLiteralTypeNode(parent) || ts.isTypeNode(parent)) return true;
    if (NAMED_PROPERTY_PARENT_KINDS.has(parent.kind)) {
        return (parent as { name?: ts.Node }).name === node;
    }
    if (ts.isJsxAttribute(parent) && parent.initializer === node) return true;
    return (
        ts.isImportDeclaration(parent) ||
        ts.isExportDeclaration(parent) ||
        ts.isExternalModuleReference(parent)
    );
}

/**
 * Locates an extractable literal AST node matching exact character offsets.
 *
 * @param sourceFile - Parsed TypeScript source file AST.
 * @param startOffset - Inclusive start character offset of the target literal.
 * @param endOffset - Exclusive end character offset of the target literal.
 * @returns Matched safe literal AST node, or null if absent or in an unsafe syntax position.
 */
export function findSafeLiteralNodeAtSpan(
    sourceFile: ts.SourceFile,
    startOffset: number,
    endOffset: number,
): ts.Node | null {
    let matched: ts.Node | null = null;
    function visitNode(node: ts.Node): void {
        if (matched) return;
        const nodeStart = node.getStart(sourceFile);
        const nodeEnd = node.getEnd();
        if (nodeEnd < startOffset || nodeStart > endOffset) return;
        if (nodeStart === startOffset && nodeEnd === endOffset && isSafeLiteralNode(node)) {
            matched = node;
            return;
        }
        ts.forEachChild(node, visitNode);
    }
    visitNode(sourceFile);
    return matched && !checkUnsafeLiteralParent(matched) ? matched : null;
}

/**
 * Verifies that an issue's expected literal value matches the AST literal slice.
 *
 * @param literalNode - AST literal node at target span.
 * @param sliceText - Exact source slice text.
 * @param expectedValue - Optional diagnostic literal value metadata.
 * @returns True if metadata matches the AST literal or no value metadata was specified.
 */
export function checkLiteralValueMatch(
    literalNode: ts.Node,
    sliceText: string,
    expectedValue: unknown,
): boolean {
    if (typeof expectedValue !== 'string' || expectedValue.length === 0) return true;
    if (sliceText === expectedValue) return true;
    if (ts.isStringLiteral(literalNode) || ts.isNoSubstitutionTemplateLiteral(literalNode)) {
        const stripped = expectedValue.replace(/^(['"`])([\s\S]*)\1$/, '$2');
        return literalNode.text === stripped || literalNode.text === expectedValue;
    }
    return false;
}

function isStaticRequireStatement(stmt: ts.Statement): boolean {
    if (!ts.isVariableStatement(stmt)) return false;
    const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
    if (mods && mods.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        return false;
    }
    return stmt.declarationList.declarations.every((decl) => {
        if (!decl.initializer || !ts.isCallExpression(decl.initializer)) return false;
        const callee = decl.initializer.expression;
        return (
            ts.isIdentifier(callee) &&
            callee.text === 'require' &&
            decl.initializer.arguments.length === 1 &&
            ts.isStringLiteral(decl.initializer.arguments[0])
        );
    });
}

function findLastPrologueOrImport(sourceFile: ts.SourceFile): ts.Statement | null {
    let lastAnchor: ts.Statement | null = null;
    for (const stmt of sourceFile.statements) {
        const isDirective = ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression);
        const isImportLike =
            ts.isImportDeclaration(stmt) ||
            ts.isImportEqualsDeclaration(stmt) ||
            isStaticRequireStatement(stmt);
        if (!isDirective && !isImportLike) break;
        lastAnchor = stmt;
    }
    return lastAnchor;
}

function computeNoImportInsertOffset(sourceFile: ts.SourceFile, firstStmt: ts.Statement): number {
    const stmtStart = firstStmt.getStart(sourceFile);
    const comments = ts.getLeadingCommentRanges(sourceFile.text, firstStmt.pos) ?? [];
    if (comments.length === 0) return stmtStart;
    const lastComment = comments[comments.length - 1];
    const gapText = sourceFile.text.slice(lastComment.end, stmtStart);
    const hasBlankLineGap = (gapText.match(/\n/g) ?? []).length >= MIN_BLANK_GAP_NEWLINES;
    const lastText = sourceFile.text.slice(lastComment.pos, lastComment.end);
    const isFileHeader =
        lastText.includes('Module:') ||
        lastText.includes('File Path:') ||
        lastText.includes('@file');
    return !hasBlankLineGap && lastText.startsWith('/**') && !isFileHeader
        ? lastComment.pos
        : stmtStart;
}

/**
 * Computes an atomic TextEdit inserting a top-level constant right after imports/directives.
 *
 * @param sourceFile - Parsed TypeScript source file AST.
 * @param lines - Pre-split source lines of the target file.
 * @param declarationLine - Statement text declaring the extracted constant.
 * @returns Atomic TextEdit alongside the insertion character offset for TDZ verification.
 */
export function buildDeclarationInsertionEdit(
    sourceFile: ts.SourceFile,
    lines: readonly string[],
    declarationLine: string,
): { readonly edit: TextEdit; readonly insertOffset: number } {
    const anchorStmt = findLastPrologueOrImport(sourceFile);
    if (anchorStmt) {
        const endOffset = anchorStmt.getEnd();
        const endPos = sourceFile.getLineAndCharacterOfPosition(endOffset);
        const tailText = (lines[endPos.line] ?? '').slice(endPos.character).trim();
        const canInsertOnNextLine =
            (tailText.length === 0 || tailText.startsWith('//')) && endPos.line + 1 < lines.length;
        const targetLine = canInsertOnNextLine ? endPos.line + 2 : endPos.line + 1;
        const targetCol = canInsertOnNextLine ? FIRST_COLUMN : endPos.character + 1;
        const inlineTrailBreak = tailText.length > 0 && !tailText.startsWith('//') ? '\n' : '';
        const newText = canInsertOnNextLine
            ? `${declarationLine}\n`
            : `\n${declarationLine}${inlineTrailBreak}`;
        return {
            edit: {
                startLine: targetLine,
                startCol: targetCol,
                endLine: targetLine,
                endCol: targetCol,
                newText,
            },
            insertOffset: endOffset,
        };
    }
    const firstStmt = sourceFile.statements[0];
    const targetOffset = firstStmt ? computeNoImportInsertOffset(sourceFile, firstStmt) : 0;
    const pos = sourceFile.getLineAndCharacterOfPosition(targetOffset);
    const col = pos.character + 1;
    return {
        edit: {
            startLine: pos.line + 1,
            startCol: col,
            endLine: pos.line + 1,
            endCol: col,
            newText: `${declarationLine}\n`,
        },
        insertOffset: targetOffset,
    };
}

function checkBindingNameContains(nameNode: ts.BindingName, targetSymbol: string): boolean {
    if (ts.isIdentifier(nameNode)) return nameNode.text === targetSymbol;
    for (const element of nameNode.elements) {
        if (ts.isBindingElement(element) && checkBindingNameContains(element.name, targetSymbol)) {
            return true;
        }
    }
    return false;
}

function checkImportClauseHasSymbol(clause: ts.ImportClause, targetSymbol: string): boolean {
    if (clause.name?.text === targetSymbol) return true;
    const named = clause.namedBindings;
    if (!named) return false;
    if (ts.isNamespaceImport(named)) return named.name.text === targetSymbol;
    return named.elements.some((specifier) => specifier.name.text === targetSymbol);
}

function inspectVariableStmtBinding(
    stmt: ts.VariableStatement,
    audit: BindingAuditContext,
    hasPriorConstMatch: boolean,
): { readonly status: 'none' | 'match' | 'conflict'; readonly endOffset: number | null } {
    const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
    const decls = stmt.declarationList.declarations;
    let matchedEnd: number | null = null;
    for (const decl of decls) {
        if (!checkBindingNameContains(decl.name, audit.targetSymbol)) continue;
        const initText = decl.initializer?.getText(audit.sourceFile).trim();
        const isExactReusableConst =
            isConst &&
            ts.isIdentifier(decl.name) &&
            decls.length === 1 &&
            initText === audit.rawLiteral &&
            !hasPriorConstMatch &&
            matchedEnd === null;
        if (!isExactReusableConst) {
            return { status: 'conflict', endOffset: null };
        }
        matchedEnd = stmt.getEnd();
    }
    return matchedEnd !== null
        ? { status: 'match', endOffset: matchedEnd }
        : { status: 'none', endOffset: null };
}

function checkStatementDeclaresTopName(stmt: ts.Statement, targetSymbol: string): boolean {
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
        return checkImportClauseHasSymbol(stmt.importClause, targetSymbol);
    }
    if (!TOP_NAMED_DECL_KINDS.has(stmt.kind)) return false;
    const declName = (stmt as { name?: ts.Node }).name;
    return Boolean(declName && ts.isIdentifier(declName) && declName.text === targetSymbol);
}

/**
 * Inspects top-level module bindings for existing declarations or incompatible collisions.
 *
 * @param sourceFile - Parsed TypeScript source file AST.
 * @param targetSymbol - Proposed constant identifier.
 * @param rawLiteral - Exact source slice text of the literal to initialize.
 * @returns Conflict flag and optional end offset of an existing matching `const` declaration.
 */
export function inspectTopLevelBinding(
    sourceFile: ts.SourceFile,
    targetSymbol: string,
    rawLiteral: string,
): TopLevelBindingStatus {
    const audit: BindingAuditContext = { sourceFile, targetSymbol, rawLiteral };
    let matchingConstEndOffset: number | null = null;
    for (const stmt of sourceFile.statements) {
        if (ts.isVariableStatement(stmt)) {
            const outcome = inspectVariableStmtBinding(
                stmt,
                audit,
                matchingConstEndOffset !== null,
            );
            if (outcome.status === 'conflict') {
                return { conflict: true, matchingConstEndOffset: null };
            }
            if (outcome.status === 'match') {
                matchingConstEndOffset = outcome.endOffset;
            }
            continue;
        }
        if (checkStatementDeclaresTopName(stmt, targetSymbol)) {
            return { conflict: true, matchingConstEndOffset: null };
        }
    }
    return { conflict: false, matchingConstEndOffset };
}

function checkStatementLocalShadow(stmt: ts.Statement, targetSymbol: string): boolean {
    if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
            if (checkBindingNameContains(decl.name, targetSymbol)) return true;
        }
        return false;
    }
    const isNamedDecl =
        ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt);
    return isNamedDecl && stmt.name?.text === targetSymbol;
}

function checkCallableOrCatchShadow(node: ts.Node, targetSymbol: string): boolean {
    if (ts.isFunctionLike(node)) {
        for (const param of node.parameters) {
            if (checkBindingNameContains(param.name, targetSymbol)) return true;
        }
    }
    const isNamedExpr =
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassExpression(node);
    if (isNamedExpr && node.name?.text === targetSymbol) return true;
    return Boolean(
        ts.isCatchClause(node) &&
        node.variableDeclaration &&
        checkBindingNameContains(node.variableDeclaration.name, targetSymbol),
    );
}

function checkLoopOrBlockShadow(node: ts.Node, targetSymbol: string): boolean {
    const isLoop =
        ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node);
    if (isLoop && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
        for (const decl of node.initializer.declarations) {
            if (checkBindingNameContains(decl.name, targetSymbol)) return true;
        }
    }
    if (ts.isBlock(node) || ts.isCaseClause(node)) {
        for (const stmt of node.statements) {
            if (checkStatementLocalShadow(stmt, targetSymbol)) return true;
        }
    }
    return false;
}

/**
 * Checks whether any enclosing lexical scope shadows the target constant identifier.
 *
 * @param targetNode - Literal AST node inside the target usage expression.
 * @param targetSymbol - Proposed top-level constant identifier.
 * @returns True if any enclosing scope declares or binds `targetSymbol`.
 */
export function hasEnclosingScopeShadow(targetNode: ts.Node, targetSymbol: string): boolean {
    let cursor = targetNode.parent;
    while (cursor && !ts.isSourceFile(cursor)) {
        if (
            checkCallableOrCatchShadow(cursor, targetSymbol) ||
            checkLoopOrBlockShadow(cursor, targetSymbol)
        ) {
            return true;
        }
        cursor = cursor.parent;
    }
    return false;
}
