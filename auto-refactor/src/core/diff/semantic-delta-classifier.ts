/**
 * Module: Core Diff — Semantic Delta Classifier & ELOC Decomposer
 * File Path: src/core/diff/semantic-delta-classifier.ts
 * Architecture Role: Distinguishes genuine semantic code changes from pure entity relocations,
 *   formatting/comment whitespace changes, and empty forwarders.
 *   Calculates orthogonal ELOC counters (processed, unique, changed, semantic, relocated, cosmetic).
 * Dependencies & Triggers: Consumes edit-diff (fastDiff), constant-relocation-detector,
 *   block-fingerprint-cache, and eloc-types.
 * Exit Semantics: Pure deterministic mathematical analysis over before/after string pairs; zero I/O.
 */

import type {
    ElocCounters,
    SemanticChangeCategory,
    SemanticDeltaResult,
    BlockFingerprint,
} from '../trajectory/eloc-types';
import {
    extractBlockFingerprints,
    countBlockEloc,
} from '../trajectory/block-fingerprint-cache';
import {
    extractConstantEntities,
    analyzeConstantTransitions,
} from './constant-relocation-detector';
import { fastDiff } from './edit-diff';
import { DIFF_OP_INSERT, DIFF_OP_DELETE, type DiffOp } from './myers-algorithm';

/**
 * Checks if a trimmed line is empty or purely a comment.
 *
 * @param line - Text line to check.
 * @returns True when line is whitespace-only or a comment.
 */
function isCommentOrBlankLine(line: string): boolean {
    const trimmed = line.trim();
    return (
        trimmed.length === 0 ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith(';')
    );
}

/**
 * Checks if a trimmed line is a trivial forwarder, pass, or return-only wrapper.
 */
function isBoilerplateLine(line: string): boolean {
    const trimmed = line.trim();
    return (
        trimmed === 'pass' ||
        trimmed === 'pass;' ||
        trimmed === 'export {};' ||
        trimmed === 'return;' ||
        /^(?:public|private|protected)?\s*(?:get|set)?\s*\w+\(\)\s*:\s*\w+\s*\{\s*return\s+this\.\w+;\s*\}$/.test(trimmed)
    );
}

/**
 * Matches old AST blocks against new AST blocks to detect pure structural relocations.
 */
function detectRelocatedBlocks(
    oldBlocks: BlockFingerprint[],
    newBlocks: BlockFingerprint[],
    filePath: string,
): {
    relocatedBlocks: SemanticDeltaResult['relocatedBlocks'];
    relocatedEloc: number;
    relocatedBlockFingerprints: Set<string>;
} {
    const oldByFp = new Map<string, { block: BlockFingerprint; index: number }>();
    for (let i = 0; i < oldBlocks.length; i++) {
        const ob = oldBlocks[i];
        if (!oldByFp.has(ob.fingerprint)) {
            oldByFp.set(ob.fingerprint, { block: ob, index: i });
        }
    }

    const relocatedBlocks: SemanticDeltaResult['relocatedBlocks'] = [];
    const relocatedBlockFingerprints = new Set<string>();
    let relocatedEloc = 0;

    let lastOldIndex = -1;
    for (let j = 0; j < newBlocks.length; j++) {
        const nb = newBlocks[j];
        const match = oldByFp.get(nb.fingerprint);
        if (match) {
            const isCrossFile = match.block.filePath !== nb.filePath;
            const isNameChanged = match.block.name !== nb.name;
            const isOrderReversed = match.index < lastOldIndex;

            if (isCrossFile || isNameChanged || isOrderReversed) {
                relocatedBlocks.push({
                    name: nb.name,
                    kind: nb.kind,
                    oldLocation: { file: match.block.filePath, line: match.block.startLine },
                    newLocation: { file: nb.filePath, line: nb.startLine },
                    eloc: nb.eloc,
                });
                relocatedBlockFingerprints.add(nb.fingerprint);
                relocatedEloc += nb.eloc;
            } else {
                lastOldIndex = match.index;
            }
        }
    }

    return { relocatedBlocks, relocatedEloc, relocatedBlockFingerprints };
}

interface LineDiffMetrics {
    addedEloc: number;
    deletedEloc: number;
    cosmeticEloc: number;
    boilerplateEloc: number;
}

/**
 * Classifies an individual line as cosmetic, boilerplate, or normal logic.
 */
function classifySingleLine(line: string): { isCosmetic: boolean; isBoilerplate: boolean } {
    if (isCommentOrBlankLine(line)) {
        return { isCosmetic: true, isBoilerplate: false };
    }
    if (isBoilerplateLine(line)) {
        return { isCosmetic: false, isBoilerplate: true };
    }
    return { isCosmetic: false, isBoilerplate: false };
}

/**
 * Applies line classification findings into cumulative line metrics.
 */
function applyLineMetrics(
    line: string,
    isInsert: boolean,
    metrics: LineDiffMetrics,
): void {
    const res = classifySingleLine(line);
    if (res.isCosmetic) {
        metrics.cosmeticEloc++;
        return;
    }
    if (isInsert) {
        metrics.addedEloc++;
    } else {
        metrics.deletedEloc++;
    }
    if (res.isBoilerplate) {
        metrics.boilerplateEloc++;
    }
}

/**
 * Inspects diff operations and line content to count added, deleted, cosmetic, and boilerplate lines.
 */
function analyzeDiffOperations(
    diffOps: DiffOp[],
    oldLines: string[],
    newLines: string[],
): LineDiffMetrics {
    const metrics: LineDiffMetrics = {
        addedEloc: 0,
        deletedEloc: 0,
        cosmeticEloc: 0,
        boilerplateEloc: 0,
    };

    for (const op of diffOps) {
        if (op.type === DIFF_OP_INSERT) {
            applyLineMetrics(newLines[op.bIdx] ?? '', true, metrics);
        } else if (op.type === DIFF_OP_DELETE) {
            applyLineMetrics(oldLines[op.aIdx] ?? '', false, metrics);
        }
    }

    return metrics;
}

/**
 * Determines change category and generates diagnostic rationales.
 */
function resolveSemanticCategory(
    semanticEloc: number,
    totalRelocated: number,
    cosmeticEloc: number,
    boilerplateEloc: number,
    relocatedBlocksCount: number,
): { category: SemanticChangeCategory; rationales: string[] } {
    if (semanticEloc === 0 && totalRelocated > 0 && cosmeticEloc === 0) {
        return {
            category: 'pure-relocation',
            rationales: [`Detected pure relocation of ${relocatedBlocksCount} blocks (${totalRelocated} ELOC).`],
        };
    }
    if (semanticEloc === 0 && cosmeticEloc > 0 && totalRelocated === 0) {
        return {
            category: 'pure-cosmetic',
            rationales: [`Detected ${cosmeticEloc} lines of non-semantic formatting/comment changes.`],
        };
    }
    if (semanticEloc > 0 && totalRelocated === 0 && cosmeticEloc === 0 && boilerplateEloc === 0) {
        return {
            category: 'pure-semantic',
            rationales: [`Detected ${semanticEloc} lines of pure semantic logic modifications.`],
        };
    }
    return {
        category: 'mixed',
        rationales: [
            `Mixed change: ${semanticEloc} semantic ELOC, ${totalRelocated} relocated ELOC, ${cosmeticEloc} cosmetic ELOC, ${boilerplateEloc} boilerplate ELOC.`,
        ],
    };
}

/**
 * Builds zero-delta result for identical file contents.
 */
function buildUnchangedResult(normPath: string, content: string): SemanticDeltaResult {
    const eloc = countBlockEloc(content);
    return {
        filePath: normPath,
        category: 'unchanged',
        counters: {
            processed: eloc,
            unique: eloc,
            changed: 0,
            semantic: 0,
            relocated: 0,
            cosmetic: 0,
            boilerplate: 0,
            added: 0,
            deleted: 0,
            modified: 0,
        },
        relocatedBlocks: [],
        rationales: ['File content is identical (zero delta).'],
    };
}

/**
 * Classifies a before/after content pair into four-tier orthogonal ELOC components.
 *
 * @param filePath - Relative path of the file.
 * @param oldContent - Original text content.
 * @param newContent - Updated text content.
 * @returns Granular SemanticDeltaResult.
 */
export function classifySemanticDelta(
    filePath: string,
    oldContent: string,
    newContent: string,
): SemanticDeltaResult {
    const normPath = filePath.replace(/\\/g, '/');

    if (oldContent === newContent) {
        return buildUnchangedResult(normPath, newContent);
    }

    const oldBlocks = extractBlockFingerprints(normPath, oldContent);
    const newBlocks = extractBlockFingerprints(normPath, newContent);

    // 1. Detect AST block & constant relocations
    const { relocatedBlocks, relocatedEloc } = detectRelocatedBlocks(oldBlocks, newBlocks, normPath);
    const oldConstants = extractConstantEntities(oldContent, normPath);
    const newConstants = extractConstantEntities(newContent, normPath);
    const constantTransitions = analyzeConstantTransitions(oldConstants, newConstants);
    const constantRelocCount = constantTransitions.relocatedCount;

    // 2. Line-level diff analysis
    const oldLines = oldContent.split(/\r?\n/);
    const newLines = newContent.split(/\r?\n/);
    const diffOps = fastDiff(oldLines, newLines);
    const lineMetrics = analyzeDiffOperations(diffOps, oldLines, newLines);

    const totalNewEloc = countBlockEloc(newContent);
    const physicalChanged = lineMetrics.addedEloc + lineMetrics.deletedEloc;

    // 3. Calculate orthogonal ELOC breakdown
    const totalRelocated = relocatedEloc + constantRelocCount;
    const nonSemanticSum = totalRelocated + lineMetrics.cosmeticEloc + lineMetrics.boilerplateEloc;
    const semanticEloc = Math.max(0, physicalChanged - nonSemanticSum);

    // 4. Resolve category
    const { category, rationales } = resolveSemanticCategory(
        semanticEloc,
        totalRelocated,
        lineMetrics.cosmeticEloc,
        lineMetrics.boilerplateEloc,
        relocatedBlocks.length,
    );

    const counters: ElocCounters = {
        processed: totalNewEloc,
        unique: totalNewEloc,
        changed: physicalChanged,
        semantic: semanticEloc,
        relocated: totalRelocated,
        cosmetic: lineMetrics.cosmeticEloc,
        boilerplate: lineMetrics.boilerplateEloc,
        added: lineMetrics.addedEloc,
        deleted: lineMetrics.deletedEloc,
        modified: Math.min(lineMetrics.addedEloc, lineMetrics.deletedEloc),
    };

    return {
        filePath: normPath,
        category,
        counters,
        relocatedBlocks,
        rationales,
    };
}
