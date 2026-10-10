/**
 * Module: Core Engine — Native Acceleration Substantive Facade
 * File Path: src/core/native/index.ts
 * Architecture Role: Substantive facade for native acceleration kernel, shims, and dataflow operators.
 * Dependencies & Triggers: Consumed across analyzers, diff pipeline, and performance benchmarks.
 * Responsibilities:
 *   1. Re-export native types, bridge singletons, and pure JS algorithmic shims;
 *   2. Provide runtime environment probe and defensive capability verification;
 *   3. Enforce immutability and substantive payload guarantees via Object.freeze.
 * Exit Semantics & Design Rationale: Throws TypeError on invalid candidate inspection;
 *   Object.freeze prevents runtime tampering with native acceleration dispatcher.
 */

import {
    nativeCore,
    getNativeCoreStatus,
    nativeHistogramDiff,
    nativeAnalyzeDependencyGraph,
    nativeFastPatternMatch,
    nativeMaskSourceCode,
    nativeCountDuplicateLines,
    nativeDetectCloneBlocks,
    nativeComputeMinHash,
    nativeFindClonePairs,
    nativeComputeDominatorTree,
    nativeSolveDataflow,
} from './native-bridge';
import type { NativeCoreStatus } from './native-types';

export * from './native-types';
export * from './native-bridge';
export * from './native-clone-shim';
export * from './native-flow-shim';

/**
 * Probes current execution environment to report active native acceleration status.
 *
 * @returns Status summary detailing whether compiled Rust bindings or pure JS shims are active.
 */
export function probeNativeAccelerationStatus(): NativeCoreStatus {
    return getNativeCoreStatus();
}

/**
 * Asserts that the active native core instance satisfies operational invariants.
 *
 * @param status - Candidate status object to inspect.
 * @throws TypeError if status is null or fails structure invariants.
 */
export function assertValidNativeStatus(status: unknown): asserts status is NativeCoreStatus {
    if (!status || typeof status !== 'object') {
        throw new TypeError('NativeCoreStatus must be a non-null object');
    }
    const candidate = status as Record<string, unknown>;
    if (typeof candidate.isNativeLoaded !== 'boolean') {
        throw new TypeError('NativeCoreStatus.isNativeLoaded must be a boolean');
    }
    if (typeof candidate.version !== 'string' || candidate.version.length === 0) {
        throw new TypeError('NativeCoreStatus.version must be a non-empty string');
    }
}

/**
 * Substantive immutable facade aggregating native acceleration core and operations.
 */
export const NativeCoreFacade = Object.freeze({
    get status(): NativeCoreStatus {
        return nativeCore.getStatus();
    },
    probeStatus: probeNativeAccelerationStatus,
    assertValidStatus: assertValidNativeStatus,
    histogramDiff: nativeHistogramDiff,
    analyzeDependencyGraph: nativeAnalyzeDependencyGraph,
    fastPatternMatch: nativeFastPatternMatch,
    maskSourceCode: nativeMaskSourceCode,
    countDuplicateLines: nativeCountDuplicateLines,
    detectCloneBlocks: nativeDetectCloneBlocks,
    computeMinHash: nativeComputeMinHash,
    findClonePairs: nativeFindClonePairs,
    computeDominatorTree: nativeComputeDominatorTree,
    solveDataflow: nativeSolveDataflow,
});
