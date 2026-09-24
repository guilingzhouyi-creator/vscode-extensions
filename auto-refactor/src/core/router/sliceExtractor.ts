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

const DECLARATION_START_RE =
    /^\s*(?:export\s+)?(?:async\s+)?(?:default\s+)?(?:function\s+([A-Za-z0-9_$]+)|class\s+([A-Za-z0-9_$]+)|interface\s+([A-Za-z0-9_$]+)|type\s+([A-Za-z0-9_$]+)|const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|def\s+([A-Za-z0-9_$]+)|fn\s+([A-Za-z0-9_$]+))/;

const CONTROL_FLOW_RE =
    /\b(if|else|for|while|switch|case|match|return|throw|try|catch|break|continue|yield)\b/;
const ASYNC_RE = /\b(async|await|Promise|Future|tokio|spawn)\b/;
const IO_RE = /\b(fs\.|fetch|http|process\.|child_process|exec|spawn|open|socket|read|write)\b/;
const TYPE_RE = /(:\s*[A-Z][A-Za-z0-9_<>[\]|&]*|\bas\s+[A-Za-z0-9_<>[\]]+|\binterface\b|\btype\b)/;
const LITERAL_RE = /(^|\s)(['"][^'"]*['"]|\b\d+(\.\d+)?\b|\btrue\b|\bfalse\b)/;
const COMMENT_LINE_RE = /^\s*(?:\/\/|\/\*|\*|#)/;

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
}

/**
 * Scan lines to detect declaration boundaries using block nesting tracking.
 *
 * @param lines - Array of source lines.
 * @returns List of detected declaration boundaries.
 */
function scanDeclarationBoundaries(lines: string[]): DeclarationBoundary[] {
    const boundaries: DeclarationBoundary[] = [];
    let current: DeclarationBoundary | null = null;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const line = lines[i];
        const trimmed = line.trim();

        if (!current) {
            const match = DECLARATION_START_RE.exec(line);
            if (match) {
                let name = 'anonymous';
                for (let k = 1; k < match.length; k++) {
                    if (match[k]) {
                        name = match[k];
                        break;
                    }
                }
                const isExported = line.includes('export');
                let kind = 'FunctionDeclaration';
                if (line.includes('class ')) kind = 'ClassDeclaration';
                else if (line.includes('interface ')) kind = 'InterfaceDeclaration';
                else if (line.includes('type ')) kind = 'TypeAliasDeclaration';

                current = {
                    name,
                    kind,
                    startLine: lineNum,
                    endLine: lineNum,
                    isExported,
                    declarationLineText: trimmed,
                };
                braceDepth = 0;
            }
        }

        if (current) {
            for (const ch of line) {
                if (ch === '{') braceDepth++;
                else if (ch === '}') braceDepth--;
            }
            current.endLine = lineNum;

            if (
                braceDepth <= 0 &&
                (line.includes('}') || current.kind === 'TypeAliasDeclaration')
            ) {
                boundaries.push(current);
                current = null;
                braceDepth = 0;
            }
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
    let isDocOnly = addedLines.length > 0;
    let hasControlFlowMutation = false;
    let hasLiteralMutation = false;
    let hasAsyncMutation = false;
    let hasIoMutation = false;
    let hasTypeMutation = false;

    for (const line of addedLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (!COMMENT_LINE_RE.test(trimmed)) {
            isDocOnly = false;
        }
        if (CONTROL_FLOW_RE.test(trimmed)) {
            hasControlFlowMutation = true;
        }
        if (ASYNC_RE.test(trimmed)) {
            hasAsyncMutation = true;
        }
        if (IO_RE.test(trimmed)) {
            hasIoMutation = true;
        }
        if (TYPE_RE.test(trimmed)) {
            hasTypeMutation = true;
        }
        if (LITERAL_RE.test(trimmed)) {
            hasLiteralMutation = true;
        }
    }

    return {
        hasSignatureMutation: signatureChanged,
        hasControlFlowMutation,
        hasLiteralMutation,
        hasAsyncMutation,
        hasIoMutation,
        hasTypeMutation,
        isDocOnly,
    };
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
    const oldLines = new Set(oldContent.split(/\r?\n/).map((l) => l.trim()));
    const newL = newContent.split(/\r?\n/);
    const changed: number[] = [];

    for (let i = 0; i < newL.length; i++) {
        const trimmed = newL[i].trim();
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
        const b = boundaries[mid];
        if (lineNum < b.startLine) {
            high = mid - 1;
        } else if (lineNum > b.endLine) {
            low = mid + 1;
        } else {
            return b;
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
    const newSig = sliceNewLines[0]?.trim() || '';
    const signatureChanged = oldSig !== newSig;

    const oldLinesSet = new Set(sliceOldLines);
    const addedLines = sliceNewLines.filter((l) => !oldLinesSet.has(l));
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
