/**
 * Module: Core Engine - AST Slice Extractor Pointer Facade
 * File Path: src/core/ast/sliceExtractor.ts
 * Architecture Role: Canonical ast-namespace facade re-exporting and wrapping ASTSliceExtractor
 *   for architecture boundary convergence and semantic slice localization.
 * Dependencies & Triggers: Consumed by legacy AST consumers, Praxis slice, and routers.
 * Responsibilities: Export ASTSliceExtractor class, default instance, and direct extraction facade.
 * Exit Semantics & Design Rationale: Bounded synchronous slice extractor delegation.
 */

import { ASTSliceExtractor, defaultASTSliceExtractor } from '../router/sliceExtractor';
import type { ASTSliceNode } from '../router/sliceTypes';

export * from '../router/sliceExtractor';
export * from '../router/sliceTypes';

/** Extracts AST diff slices between old and new file contents using the default extractor.
 * @param filePath - Path of the source file being analyzed.
 * @param oldContent - Baseline file text before modification.
 * @param newContent - Modified file text to diff against baseline.
 * @param changedLines - Optional line numbers touched in the modification.
 * @returns Extracted semantic AST slices spanning the diff. */
export function extractASTSlices(
    filePath: string,
    oldContent: string,
    newContent: string,
    changedLines?: number[],
): ASTSliceNode[] {
    return defaultASTSliceExtractor.extractSlices(filePath, oldContent, newContent, changedLines);
}

/** Instantiates a fresh AST slice extractor instance.
 * @returns Newly allocated ASTSliceExtractor instance. */
export function createASTSliceExtractor(): ASTSliceExtractor {
    return new ASTSliceExtractor();
}

/** Filters AST slice nodes by their primary mutation classification.
 * @param slices - Input collection of extracted AST slice nodes.
 * @param kind - Target primary mutation kind identifier.
 * @returns Filtered subset matching the requested mutation kind. */
export function filterSlicesByMutationKind(
    slices: readonly ASTSliceNode[],
    kind: string,
): ASTSliceNode[] {
    return slices.filter((slice) => slice.primaryKind === kind);
}

const SLICE_AXIS_MAP: ReadonlyArray<readonly [keyof ASTSliceNode['featureVector'], string]> = [
    ['hasSignatureMutation', 'signature'],
    ['hasControlFlowMutation', 'controlFlow'],
    ['hasIoMutation', 'io'],
    ['hasAsyncMutation', 'async'],
    ['hasTypeMutation', 'type'],
];

function createEmptyVectorCounts(total: number): Record<string, number> {
    const counts: Record<string, number> = { total };
    for (const [, axisKey] of SLICE_AXIS_MAP) {
        counts[axisKey] = 0;
    }
    return counts;
}

/** Summarizes slice mutation counts across signature, control flow, I/O, async, and type axes.
 * @param slices - Extracted AST slice nodes to summarize.
 * @returns Counts aggregated per structural mutation axis. */
export function summarizeSliceVectors(slices: readonly ASTSliceNode[]): Record<string, number> {
    const counts = createEmptyVectorCounts(slices.length);
    for (const slice of slices) {
        const vector = slice.featureVector;
        for (const [flagKey, axisKey] of SLICE_AXIS_MAP) {
            if (vector[flagKey]) {
                counts[axisKey]++;
            }
        }
    }
    return counts;
}
