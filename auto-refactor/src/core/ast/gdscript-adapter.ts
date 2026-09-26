/**
 * Module: Core Engine — GDScript Language Adapter
 * File Path: src/core/ast/gdscript-adapter.ts
 * Architecture Role: LanguageAdapter implementation that projects GDScript source into the
 *                    language-agnostic NormalizedNode AST consumed by multi-language analyzers.
 * Dependencies & Triggers: Registered by the multi-language adapter registry for `.gd` files;
 *                    relies on the multilang NodeKind/NormalizedNode/NormalizedAst/
 *                    LanguageAdapter/Position contracts.
 * Responsibilities: Parse line-oriented classes/functions/control flow/const declarations into
 *                    nested NormalizedNodes, compute branch weights for cyclomatic decisions,
 *                    extract string/numeric literals with const and tolerance flags, and
 *                    implement root/children traversal.
 * Exit Semantics & Design Rationale: `parse` is synchronous and total for any input—malformed
 *                    or empty text still yields a SourceFile root—so one bad GDScript file cannot
 *                    abort a scan. Regex plus indentation parsing avoids a native Godot parser,
 *                    keeping the adapter project-agnostic and dependency-free.
 */

import type { NormalizedNode, NormalizedAst, LanguageAdapter } from './multilang';
import { NodeKind } from './multilang';

/** String literals shorter than this stay tolerated: they cannot carry a meaningful value. */
const MIN_SIGNIFICANT_STRING_LENGTH = 3;

/**
 * GDScriptAdapter — General-purpose GDScript language adapter for Godot 4.x / 3.x.
 *
 * Implements a pure, robust, lightweight AST & lexical hierarchy parser that maps
 * GDScript declarations, control flows, and literals to `NormalizedNode`.
 *
 * Features:
 * - Maps `class_name` & `class Inner` to `NodeKind.Class` with `isClassDefining = true`.
 * - Maps `func` & `static func` to `NodeKind.Function` / `NodeKind.Method` with
 *   `functionLike = true`.
 * - Computes cyclomatic decision points for `if`, `elif`, `for`, `while`, `match`, and
 *   logical operators.
 * - Extracts numeric & string literals with const-binding and tolerated-context detection.
 * - 100% project-agnostic, zero external native dependencies, ultra-fast execution.
 */
const FUNC_RE = /^\s*(?:static\s+)?func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;
const CLASS_NAME_RE = /^\s*class_name\s+([a-zA-Z_][a-zA-Z0-9_]*)/;
const INNER_CLASS_RE = /^\s*class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:/;
const CONST_DECL_RE = /^\s*const\s+([a-zA-Z_][a-zA-Z0-9_]*)/;
const CONTROL_RE = /^\s*(if|elif|while|for|match)\b/;

interface ScopeFrame {
    indent: number;
    node: NormalizedNode;
}

function findCallClosingParen(rawLine: string, openIdx: number): number {
    let depth = 1;
    let inStr: string | null = null;
    for (let i = openIdx + 1; i < rawLine.length; i++) {
        const ch = rawLine[i];
        if (inStr) {
            if (ch === '\\') {
                i++;
            } else if (ch === inStr) {
                inStr = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            inStr = ch;
        } else if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function tryParseClassDecl(
    rawLine: string,
    lineNum: number,
    indent: number,
    parentNode: NormalizedNode,
    scopeStack: ScopeFrame[],
): boolean {
    const mClassName = rawLine.match(CLASS_NAME_RE);
    if (mClassName) {
        const classNode: NormalizedNode = {
            kind: NodeKind.Class,
            name: mClassName[1],
            isClassDefining: true,
            topLevel: true,
            exported: true,
            start: { line: lineNum, column: indent + 1 },
            end: { line: lineNum, column: rawLine.length + 1 },
            children: [],
        };
        parentNode.children ||= [];
        parentNode.children.push(classNode);
        return true;
    }
    const mInnerClass = rawLine.match(INNER_CLASS_RE);
    if (mInnerClass) {
        const innerClassNode: NormalizedNode = {
            kind: NodeKind.Class,
            name: mInnerClass[1],
            isClassDefining: true,
            topLevel: false,
            start: { line: lineNum, column: indent + 1 },
            end: { line: lineNum, column: rawLine.length + 1 },
            children: [],
        };
        parentNode.children ||= [];
        parentNode.children.push(innerClassNode);
        scopeStack.push({ indent, node: innerClassNode });
        return true;
    }
    return false;
}

function tryParseFuncDecl(
    rawLine: string,
    lineNum: number,
    indent: number,
    parentNode: NormalizedNode,
    scopeStack: ScopeFrame[],
    adapter: GDScriptAdapter,
): boolean {
    const mFunc = rawLine.match(FUNC_RE);
    if (!mFunc) return false;
    const isMethod =
        scopeStack.length > 1 && scopeStack[scopeStack.length - 1].node.isClassDefining;
    const fnNode: NormalizedNode = {
        kind: isMethod ? NodeKind.Method : NodeKind.Function,
        name: mFunc[1],
        functionLike: true,
        increasesNesting: true,
        topLevel: indent === 0,
        start: { line: lineNum, column: indent + 1 },
        end: { line: lineNum, column: rawLine.length + 1 },
        children: [],
    };
    parentNode.children ||= [];
    parentNode.children.push(fnNode);
    scopeStack.push({ indent, node: fnNode });
    adapter.extractLiterals(rawLine, lineNum, fnNode, false);
    return true;
}

function tryParseControlStmt(
    rawLine: string,
    lineNum: number,
    indent: number,
    parentNode: NormalizedNode,
    scopeStack: ScopeFrame[],
    adapter: GDScriptAdapter,
): boolean {
    const mCtrl = rawLine.match(CONTROL_RE);
    if (!mCtrl) return false;
    let weight = 1;
    const opMatches = rawLine.match(/\b(and|or)\b|&&|\|\|/g);
    if (opMatches) weight += opMatches.length;
    const ctrlNode: NormalizedNode = {
        kind: NodeKind.ControlFlow,
        branchWeight: weight,
        increasesNesting: true,
        start: { line: lineNum, column: indent + 1 },
        end: { line: lineNum, column: rawLine.length + 1 },
        children: [],
    };
    parentNode.children ||= [];
    parentNode.children.push(ctrlNode);
    scopeStack.push({ indent, node: ctrlNode });
    adapter.extractLiterals(rawLine, lineNum, ctrlNode, false);
    return true;
}

function tryParseStructureStmt(
    rawLine: string,
    lineNum: number,
    indent: number,
    parentNode: NormalizedNode,
    scopeStack: ScopeFrame[],
    adapter: GDScriptAdapter,
): boolean {
    return (
        tryParseClassDecl(rawLine, lineNum, indent, parentNode, scopeStack) ||
        tryParseFuncDecl(rawLine, lineNum, indent, parentNode, scopeStack, adapter) ||
        tryParseControlStmt(rawLine, lineNum, indent, parentNode, scopeStack, adapter)
    );
}

export class GDScriptAdapter implements LanguageAdapter {
    id = 'gdscript' as const;
    extensions = ['.gd'];

    parse(content: string, _filePath: string): NormalizedAst {
        const lines = content.split(/\r?\n/);
        const rootNode: NormalizedNode = {
            kind: NodeKind.SourceFile,
            start: { line: 1, column: 1 },
            end: { line: Math.max(1, lines.length), column: 1 },
            children: [],
        };

        const scopeStack: ScopeFrame[] = [{ indent: -1, node: rootNode }];

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const lineNum = lineIdx + 1;
            const rawLine = lines[lineIdx];
            const trimmed = rawLine.trim();

            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            const indent = rawLine.search(/\S/);

            // Pop scopes when indent decreases
            while (scopeStack.length > 1 && indent <= scopeStack[scopeStack.length - 1].indent) {
                scopeStack.pop();
            }

            const parentNode = scopeStack[scopeStack.length - 1].node;

            if (tryParseStructureStmt(rawLine, lineNum, indent, parentNode, scopeStack, this)) {
                continue;
            }

            // Const declaration vs normal statement
            const isConstBound = CONST_DECL_RE.test(rawLine);
            const stmtNode: NormalizedNode = {
                kind: isConstBound ? NodeKind.Constant : NodeKind.Other,
                start: { line: lineNum, column: indent + 1 },
                end: { line: lineNum, column: rawLine.length + 1 },
                children: [],
            };
            parentNode.children ||= [];
            parentNode.children.push(stmtNode);

            this.extractLiterals(rawLine, lineNum, stmtNode, isConstBound);
        }

        return { root: rootNode };
    }

    root(ast: NormalizedAst): NormalizedNode {
        return ast.root;
    }

    children(node: NormalizedNode): NormalizedNode[] {
        return node.children || [];
    }

    /**
     * Check if a string literal token represents a dictionary key or subscript index in GDScript:
     * 1. Dictionary key: followed by a colon (e.g. `"key": value` or `{"key": value}`).
     * 2. Subscript index: preceded by `[` which follows an expression and followed by `]` (e.g. `data["key"]`).
     */
    private isDictionaryKeyOrSubscript(rawLine: string, matchIdx: number, matchLen: number): boolean {
        const afterStr = rawLine.slice(matchIdx + matchLen);
        // 1. Dictionary key: `"key": val`
        if (/^\s*:\s*/.test(afterStr)) {
            return true;
        }

        // 2. Subscript index: `target["key"]`
        const beforeStr = rawLine.slice(0, matchIdx);
        const isIndexedAccess = /[A-Za-z0-9_\)\]]\s*\[\s*$/.test(beforeStr);
        if (isIndexedAccess && /^\s*\]/.test(afterStr)) {
            return true;
        }

        return false;
    }

    /** Check if a numeric literal is an index inside a subscript expression, e.g. `arr[0]`. */
    private isNumericSubscriptIndex(rawLine: string, matchIdx: number, matchLen: number): boolean {
        const beforeStr = rawLine.slice(0, matchIdx);
        const afterStr = rawLine.slice(matchIdx + matchLen);
        return /[A-Za-z0-9_\)\]]\s*\[\s*$/.test(beforeStr) && /^\s*\]/.test(afterStr);
    }

    /**
     * Tokenizes and extracts numeric and string literals from a line of GDScript.
     */
    extractLiterals(
        rawLine: string,
        lineNum: number,
        parentNode: NormalizedNode,
        isConstBound: boolean,
    ): void {
        // Check if line contains legacy tolerated idioms (preload/get_node/logging/$) — the whole
        // line is exempt. GameConfig.* / render_narrative / emit_narrative_by_key calls carry
        // canonical config keys (cf. WebGames audit_config_unused.py three-tier references); they
        // are tolerated at token level only (isInsideTolerantCall), so stray hardcoded strings
        // elsewhere on the same line are still flagged.
        const isLegacyToleratedLine =
            /\b(preload|load|get_node|push_error|push_warning|print|printerr)\b|\$/.test(rawLine);

        // String literals ("..." or '...')
        const strRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;
        let match: RegExpExecArray | null;

        while ((match = strRegex.exec(rawLine)) !== null) {
            const fullText = match[0];
            const col = match.index + 1;
            const strVal = match[1] !== undefined ? match[1] : match[2];
            const isDictOrIndex = this.isDictionaryKeyOrSubscript(rawLine, match.index, fullText.length);

            const litNode: NormalizedNode = {
                kind: NodeKind.StringLiteral,
                text: strVal,
                isString: true,
                isConstBound,
                tolerated:
                    isLegacyToleratedLine ||
                    isDictOrIndex ||
                    strVal.length < MIN_SIGNIFICANT_STRING_LENGTH ||
                    this.isInsideTolerantCall(rawLine, match.index),
                start: { line: lineNum, column: col },
                end: { line: lineNum, column: col + fullText.length },
            };
            parentNode.children ||= [];
            parentNode.children.push(litNode);
        }

        // Numeric literals (integer, float, hex)
        // Avoid matching numbers inside strings or identifiers
        const codeWithoutStrings = rawLine.replace(strRegex, (m) => ' '.repeat(m.length));
        const numRegex = /\b(0x[0-9a-fA-F]+|\d+\.\d+|\d+)\b/g;

        while ((match = numRegex.exec(codeWithoutStrings)) !== null) {
            const numText = match[0];
            const col = match.index + 1;
            const isSubscriptIndex = this.isNumericSubscriptIndex(rawLine, match.index, numText.length);

            const litNode: NormalizedNode = {
                kind: NodeKind.NumericLiteral,
                text: numText,
                isNumeric: true,
                isConstBound,
                tolerated:
                    isLegacyToleratedLine ||
                    isSubscriptIndex ||
                    this.isInsideTolerantCall(rawLine, match.index),
                start: { line: lineNum, column: col },
                end: { line: lineNum, column: col + numText.length },
            };
            parentNode.children ||= [];
            parentNode.children.push(litNode);
        }
    }

    /**
     * Token-level tolerance: returns true when the 0-based `col0` position lies inside the
     * argument span of a GameConfig.* / render_narrative / emit_narrative_by_key or engine
     * method call. Only literals that are actual arguments of these calls carry canonical
     * names/keys and are exempt; the rest of the line stays analyzable.
     */
    private isInsideTolerantCall(rawLine: string, col0: number): boolean {
        const callRe =
            /\b(?:GameConfig\.[A-Za-z0-9_]+|render_narrative|emit_narrative_by_key|get|set|has|get_meta|set_meta|has_meta|emit_signal|connect|disconnect|is_action_pressed|is_action_just_pressed|is_action_just_released|play|play_backwards|change_scene_to_file|rpc|rpc_id)\s*\(/g;
        let cm: RegExpExecArray | null;
        while ((cm = callRe.exec(rawLine)) !== null) {
            const openIdx = cm.index + cm[0].lastIndexOf('(');
            const closeIdx = findCallClosingParen(rawLine, openIdx);
            if (closeIdx !== -1 && col0 >= openIdx && col0 <= closeIdx) {
                return true;
            }
        }
        return false;
    }
}

