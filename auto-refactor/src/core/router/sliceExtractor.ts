/**
 * Module: Core Engine - AST Slice Extractor
 * File Path: src/core/router/sliceExtractor.ts
 * Architecture Role: Fine-grained AST slice extractor that localizes diff changes to minimal
 *   enclosing declaration syntax units and extracts semantic mutation feature vectors.
 * Dependencies & Triggers: Consumed by SparseMoEGateRouter, CallChainImpactTracer, and Praxis
 *   slice audit service.
 * Responsibilities: Map changed line numbers to AST declaration nodes, compute diff deltas,
 *   extract SliceFeatureVector, and assign primary mutation kinds.
 * Exit Semantics & Design Rationale: Synchronous and robust against incomplete syntax trees;
 *   falls back gracefully to top-level block slices when formal AST parsing encounters errors.
 */

import type { ASTSliceNode, SliceFeatureVector, SliceMutationKind } from './sliceTypes';
import { DECLARATION_START_RE } from '../rules/lexical-pattern-registry';
import { fastInspectSliceDelta } from './prefix-triage-index';

/**
 * Candidate declaration boundary detected in source code.
 */
interface DeclarationBoundary {
    name: string;
    kind: string;
    startLine: number;
    endLine: number;
    isExported: boolean;
    declarationLineText: string;
    isIndentationBlock?: boolean;
    baseIndent?: number;
    sawOpeningBrace?: boolean;
    braceDepth?: number;
}

const KIND_CLASS = 'ClassDeclaration';
const KIND_INTERFACE = 'InterfaceDeclaration';
const KIND_TYPE_ALIAS = 'TypeAliasDeclaration';
const KIND_FUNCTION = 'FunctionDeclaration';

const GDSCRIPT_FUNC_RE = /^\s*(?:static\s+)?func\s+([A-Za-z0-9_$]+)/;

function extractDeclarationKind(line: string): string {
    if (line.includes('class ')) return KIND_CLASS;
    if (line.includes('interface ')) return KIND_INTERFACE;
    if (line.includes('type ')) return KIND_TYPE_ALIAS;
    return KIND_FUNCTION;
}

function extractMatchedName(match: RegExpExecArray): string {
    for (let k = 1; k < match.length; k++) {
        if (match[k]) return match[k];
    }
    return 'anonymous';
}

function tryStartBoundary(
    line: string,
    lineNum: number,
    trimmed: string,
): DeclarationBoundary | null {
    let name = '';
    const gdMatch = GDSCRIPT_FUNC_RE.exec(line);
    if (gdMatch) {
        name = gdMatch[1];
    } else {
        const match = DECLARATION_START_RE.exec(line);
        if (!match) return null;
        name = extractMatchedName(match);
    }

    const isIndented =
        /^(?:def|func)\b/.test(trimmed) ||
        (trimmed.endsWith(':') && !line.includes('{') && !line.includes(';'));
    const baseIndent = Math.max(0, line.search(/\S/));

    return {
        name,
        kind: extractDeclarationKind(line),
        startLine: lineNum,
        endLine: lineNum,
        isExported: line.includes('export'),
        declarationLineText: trimmed,
        isIndentationBlock: isIndented,
        baseIndent,
        sawOpeningBrace: false,
        braceDepth: 0,
    };
}

interface LexicalScanState {
    inBlockComment: boolean;
    inStringChar: string | null;
}

function skipCommentOrString(line: string, i: number, state: LexicalScanState): number {
    if (state.inBlockComment) {
        if (line[i] === '*' && line[i + 1] === '/') {
            state.inBlockComment = false;
            return i + 2;
        }
        return i + 1;
    }
    if (state.inStringChar !== null) {
        if (line[i] === '\\') return i + 2;
        if (line[i] === state.inStringChar) {
            state.inStringChar = null;
        }
        return i + 1;
    }
    if ((line[i] === '/' && line[i + 1] === '/') || line[i] === '#') {
        return line.length;
    }
    if (line[i] === '/' && line[i + 1] === '*') {
        state.inBlockComment = true;
        return i + 2;
    }
    const char = line[i];
    if (char === '"' || char === "'" || char === '`') {
        state.inStringChar = char;
        return i + 1;
    }
    return -1;
}

function scanLineBraces(
    line: string,
    state: LexicalScanState,
): { delta: number; sawOpen: boolean } {
    let delta = 0;
    let sawOpen = false;
    let i = 0;
    while (i < line.length) {
        const next = skipCommentOrString(line, i, state);
        if (next !== -1) {
            i = next;
            continue;
        }
        if (line[i] === '{') {
            delta++;
            sawOpen = true;
        } else if (line[i] === '}') {
            delta--;
        }
        i++;
    }
    return { delta, sawOpen };
}

function advanceIndentationBlock(
    current: DeclarationBoundary,
    line: string,
    lineNum: number,
    trimmed: string,
): boolean {
    if (trimmed === '' || trimmed.startsWith('#')) {
        return true;
    }
    const lineIndent = line.search(/\S/);
    if (lineIndent > (current.baseIndent ?? 0)) {
        current.endLine = lineNum;
        return true;
    }
    return false;
}

function advanceBraceBlock(
    current: DeclarationBoundary,
    line: string,
    lineNum: number,
    state: LexicalScanState,
): boolean {
    const scan = scanLineBraces(line, state);
    if (scan.sawOpen) {
        current.sawOpeningBrace = true;
    }
    current.braceDepth = (current.braceDepth ?? 0) + scan.delta;
    current.endLine = lineNum;
    if (
        current.sawOpeningBrace &&
        current.braceDepth <= 0 &&
        (line.includes('}') || current.kind === KIND_TYPE_ALIAS)
    ) {
        return false;
    }
    return true;
}

/**
 * Scan lines to detect declaration boundaries using lexical and indentation tracking.
 *
 * @param lines - Array of source lines.
 * @returns List of detected declaration boundaries.
 */
function scanDeclarationBoundaries(lines: string[]): DeclarationBoundary[] {
    const boundaries: DeclarationBoundary[] = [];
    let current: DeclarationBoundary | null = null;
    const lexicalState: LexicalScanState = { inBlockComment: false, inStringChar: null };

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const line = lines[i];
        const trimmed = line.trim();

        if (!current) {
            current = tryStartBoundary(line, lineNum, trimmed);
            if (
                current &&
                !current.isIndentationBlock &&
                !advanceBraceBlock(current, line, lineNum, lexicalState)
            ) {
                boundaries.push(current);
                current = null;
            }
            continue;
        }

        const stillOpen = current.isIndentationBlock
            ? advanceIndentationBlock(current, line, lineNum, trimmed)
            : advanceBraceBlock(current, line, lineNum, lexicalState);

        if (!stillOpen) {
            boundaries.push(current);
            current = current.isIndentationBlock ? tryStartBoundary(line, lineNum, trimmed) : null;
        }
    }

    if (current) {
        boundaries.push(current);
    }

    return boundaries;
}

/**
 * Inspect added or changed text to extract feature indicators.
 *
 * @param addedLines - Newly added or modified lines.
 * @param signatureChanged - Whether declaration signature line changed.
 * @returns Populated SliceFeatureVector.
 */
function inspectSliceDelta(addedLines: string[], signatureChanged: boolean): SliceFeatureVector {
    return fastInspectSliceDelta(addedLines, signatureChanged);
}

/**
 * Determine the primary semantic mutation kind based on feature priority.
 *
 * @param vector - Extracted slice feature vector.
 * @returns Assigned primary mutation kind.
 */
function resolvePrimaryKind(vector: SliceFeatureVector): SliceMutationKind {
    if (vector.hasSignatureMutation) return 'signature';
    if (vector.hasIoMutation) return 'io';
    if (vector.hasAsyncMutation) return 'async';
    if (vector.hasControlFlowMutation) return 'control-flow';
    if (vector.hasTypeMutation) return 'type-annotation';
    if (vector.isDocOnly) return 'doc-comment';
    if (vector.hasLiteralMutation) return 'literal';
    return 'general';
}

/**
 * Derives 1-based changed line numbers by comparing old and new source text.
 *
 * @param oldContent - Source text before change.
 * @param newContent - Source text after change.
 * @returns Array of 1-based changed line numbers.
 */
function deriveChangedLineNumbers(oldContent: string, newContent: string): number[] {
    const oldLines = new Set(oldContent.split(/\r?\n/).map((lineText) => lineText.trim()));
    const incomingLines = newContent.split(/\r?\n/);
    const changed: number[] = [];

    for (let i = 0; i < incomingLines.length; i++) {
        const trimmed = incomingLines[i].trim();
        if (trimmed && !oldLines.has(trimmed)) {
            changed.push(i + 1);
        }
    }
    return changed.length > 0 ? changed : [1];
}

/**
 * Binary search for a declaration boundary enclosing the given line number.
 *
 * @param boundaries - Ordered list of declaration boundaries.
 * @param lineNum - 1-based target line number.
 * @returns The matching boundary if found, undefined otherwise.
 */
function findEnclosingBoundary(
    boundaries: DeclarationBoundary[],
    lineNum: number,
): DeclarationBoundary | undefined {
    let low = 0;
    let high = boundaries.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const boundary = boundaries[mid];
        if (lineNum < boundary.startLine) {
            high = mid - 1;
        } else if (lineNum > boundary.endLine) {
            low = mid + 1;
        } else {
            return boundary;
        }
    }
    return undefined;
}

/**
 * Constructs an ASTSliceNode for an enclosing declaration boundary.
 */
function createBoundarySliceNode(
    filePath: string,
    match: DeclarationBoundary,
    oldLines: string[],
    newLines: string[],
): ASTSliceNode {
    const sliceOldLines = oldLines.slice(match.startLine - 1, match.endLine);
    const sliceNewLines = newLines.slice(match.startLine - 1, match.endLine);
    const oldSig = sliceOldLines[0]?.trim() || '';
    const incomingSignature = sliceNewLines[0]?.trim() || '';
    const signatureChanged = oldSig !== incomingSignature;

    const oldLinesSet = new Set(sliceOldLines);
    const addedLines = sliceNewLines.filter((lineText) => !oldLinesSet.has(lineText));
    const vector = inspectSliceDelta(addedLines, signatureChanged);
    const primaryKind = resolvePrimaryKind(vector);

    return {
        sliceId: `slice:${filePath}:${match.name}:${match.startLine}`,
        filePath,
        startLine: match.startLine,
        endLine: match.endLine,
        nodeKind: match.kind,
        symbolName: match.name,
        isExported: match.isExported,
        featureVector: vector,
        primaryKind,
    };
}

/**
 * Constructs an ASTSliceNode for a top-level uncontained modification.
 */
function createFallbackSliceNode(filePath: string, lineNum: number, rawLine: string): ASTSliceNode {
    const vector = inspectSliceDelta([rawLine], false);
    return {
        sliceId: `slice:${filePath}:top-level:${lineNum}`,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        nodeKind: 'TopLevelStatement',
        symbolName: 'top-level',
        isExported: rawLine.includes('export'),
        featureVector: vector,
        primaryKind: resolvePrimaryKind(vector),
    };
}

/**
 * ASTSliceExtractor isolates code mutations to minimal containing declaration nodes.
 */
export class ASTSliceExtractor {
    /**
     * Extract AST slice nodes matching the given changed lines.
     *
     * @param filePath - Path to file being analyzed.
     * @param oldContent - Content prior to modification.
     * @param newContent - Content after modification.
     * @param explicitChangedLines - Optional pre-computed changed line numbers.
     * @returns Array of localized ASTSliceNode instances.
     */
    public extractSlices(
        filePath: string,
        oldContent: string,
        newContent: string,
        explicitChangedLines?: number[],
    ): ASTSliceNode[] {
        const changedLines =
            explicitChangedLines && explicitChangedLines.length > 0
                ? explicitChangedLines
                : deriveChangedLineNumbers(oldContent, newContent);

        const newLines = newContent.split(/\r?\n/);
        const oldLines = oldContent.split(/\r?\n/);
        const boundaries = scanDeclarationBoundaries(newLines);
        const sliceMap = new Map<string, ASTSliceNode>();

        for (const lineNum of changedLines) {
            const match = findEnclosingBoundary(boundaries, lineNum);

            if (match) {
                if (!sliceMap.has(match.name)) {
                    sliceMap.set(
                        match.name,
                        createBoundarySliceNode(filePath, match, oldLines, newLines),
                    );
                }
            } else {
                const fallbackKey = `top-level:${lineNum}`;
                if (!sliceMap.has(fallbackKey)) {
                    const rawLine = newLines[lineNum - 1] || '';
                    sliceMap.set(fallbackKey, createFallbackSliceNode(filePath, lineNum, rawLine));
                }
            }
        }

        return Array.from(sliceMap.values());
    }
}

/** Global default instance of ASTSliceExtractor. */
export const defaultASTSliceExtractor = new ASTSliceExtractor();
