/**
 * Module: Core Codemod — Constant Anchor Line Scanner
 * File Path: src/core/codemod/transforms/constant-anchor-scanner.ts
 * Architecture Role: Scans file source headers to identify the optimal insertion point
 *   for top-level constants immediately after shebangs, directives, and import blocks.
 * Dependencies & Triggers: Consumed by extract-constant and patch-engine.
 * Responsibilities:
 *   1. Track single-line and multi-line import statements and block comments;
 *   2. Determine insertion coordinates right after last import statement;
 *   3. Fall back to line 1 or directive boundary when no imports exist.
 * Exit Semantics & Design Rationale: Pure string line scanning with zero AST allocation.
 */

interface LineScanState {
    insertLine: number;
    inBlockComment: boolean;
    importDepth: number;
    inImport: boolean;
}

const FIRST_LINE = 1;
const LINE_ADVANCE_AFTER_STMT = 2;
const DELIMITER_DELTA: Readonly<Record<string, number>> = Object.freeze({
    '{': 1,
    '(': 1,
    '}': -1,
    ')': -1,
});
const DIRECTIVE_PROLOGUES = new Set([
    "'use strict';",
    '"use strict";',
    "'use strict'",
    '"use strict"',
]);

function isModuleImportStart(trimmed: string): boolean {
    if (
        trimmed.startsWith('import ') ||
        trimmed.startsWith('import{') ||
        trimmed.startsWith('import(')
    ) {
        return true;
    }
    return /^(?:const|let|var)\s+.+=\s*require\s*\(/.test(trimmed);
}

function computeDelimiterDelta(line: string): number {
    let delta = 0;
    let activeQuote = '';
    for (let index = 0; index < line.length; index++) {
        const character = line[index];
        if (character === '\\') {
            index++;
            continue;
        }
        if (activeQuote) {
            if (character === activeQuote) activeQuote = '';
            continue;
        }
        if (character === "'" || character === '"') {
            activeQuote = character;
            continue;
        }
        delta += DELIMITER_DELTA[character] ?? 0;
    }
    return delta;
}

function advanceMultiLineImportState(trimmed: string, index: number, state: LineScanState): void {
    state.importDepth += computeDelimiterDelta(trimmed);
    state.insertLine = index + LINE_ADVANCE_AFTER_STMT;
    const isClosed =
        state.importDepth <= 0 && (trimmed.endsWith(';') || /from\s+['"][^'"]+['"]/.test(trimmed));
    if (isClosed) {
        state.inImport = false;
        state.importDepth = 0;
    }
}

function advanceCommentOrImportLine(trimmed: string, state: LineScanState): boolean {
    if (state.inBlockComment) {
        if (trimmed.includes('*/')) state.inBlockComment = false;
        return true;
    }
    if (!trimmed.startsWith('/*')) return false;
    if (!trimmed.includes('*/')) state.inBlockComment = true;
    return true;
}

function advanceHeaderScanLine(trimmed: string, index: number, state: LineScanState): boolean {
    if (advanceCommentOrImportLine(trimmed, state)) return true;
    if (state.inImport) {
        advanceMultiLineImportState(trimmed, index, state);
        return true;
    }
    if ((index === 0 && trimmed.startsWith('#!')) || DIRECTIVE_PROLOGUES.has(trimmed)) {
        state.insertLine = index + LINE_ADVANCE_AFTER_STMT;
        return true;
    }
    if (!isModuleImportStart(trimmed)) {
        return trimmed.length === 0 || trimmed.startsWith('//');
    }
    const depth = computeDelimiterDelta(trimmed);
    state.insertLine = index + LINE_ADVANCE_AFTER_STMT;
    const isMissingFrom =
        !trimmed.endsWith(';') &&
        /^import\s+(?:type\s+)?[{*]/.test(trimmed) &&
        !trimmed.includes('from');
    if (depth > 0 || isMissingFrom) {
        state.inImport = true;
        state.importDepth = depth;
    }
    return true;
}

/**
 * Resolves the 1-indexed line number where a top-level constant should be inserted.
 *
 * @param lines - Array of source file lines.
 * @returns 1-indexed target line number for constant declaration insertion.
 */
export function resolveConstantInsertionLine(lines: readonly string[]): number {
    const state: LineScanState = {
        insertLine: FIRST_LINE,
        inBlockComment: false,
        importDepth: 0,
        inImport: false,
    };
    for (let index = 0; index < lines.length; index++) {
        const trimmed = lines[index].trim();
        if (!advanceHeaderScanLine(trimmed, index, state)) {
            return state.insertLine === FIRST_LINE ? index + 1 : state.insertLine;
        }
    }
    return state.insertLine;
}
