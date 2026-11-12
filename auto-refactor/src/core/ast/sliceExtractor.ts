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

export function extractASTSlices(
    filePath: string,
    oldContent: string,
    newContent: string,
    changedLines?: number[],
): ASTSliceNode[] {
    return defaultASTSliceExtractor.extractSlices(filePath, oldContent, newContent, changedLines);
}

export function createASTSliceExtractor(): ASTSliceExtractor {
    return new ASTSliceExtractor();
}

export function filterSlicesByMutationKind(
    slices: readonly ASTSliceNode[],
    kind: string,
): ASTSliceNode[] {
    return slices.filter((slice) => slice.primaryKind === kind);
}

export function summarizeSliceVectors(
    slices: readonly ASTSliceNode[],
): Record<string, number> {
    const counts: Record<string, number> = {
        total: slices.length,
        signature: 0,
        controlFlow: 0,
        io: 0,
        async: 0,
        type: 0,
    };
    for (let i = 0; i < slices.length; i++) {
        const slice = slices[i];
        if (slice.featureVector.hasSignatureMutation) counts.signature++;
        if (slice.featureVector.hasControlFlowMutation) counts.controlFlow++;
        if (slice.featureVector.hasIoMutation) counts.io++;
        if (slice.featureVector.hasAsyncMutation) counts.async++;
        if (slice.featureVector.hasTypeMutation) counts.type++;
    }
    return counts;
}
