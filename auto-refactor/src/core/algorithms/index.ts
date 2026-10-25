/**
 * Module: Core Algorithms — Foundation Algorithms Barrel
 * File Path: src/core/algorithms/index.ts
 * Architecture Role: Single source of truth export barrel for graph traversal,
 *   hashing, text metrics, and set algebra algorithm operators.
 * Dependencies & Triggers: Zero external dependencies; pure algorithmic operators.
 * Responsibilities: Re-export graph, hash, text-metrics, and set-algebra operators
 *   with an immutable facade satisfying ARCH-FAC-001.
 * Exit Semantics & Design Rationale: Static frozen facade; zero runtime overhead.
 */

import * as hashOps from './hash';
import * as textMetricsOps from './text-metrics';
import * as setAlgebraOps from './set-algebra';
import * as graphOps from './graph';

export * from './hash';
export * from './text-metrics';
export * from './set-algebra';
export * from './graph';

/** Subsystem facade providing frozen access to foundational algorithmic operators. */
export const AlgorithmOperators = Object.freeze({
    hash: Object.freeze({ ...hashOps }),
    textMetrics: Object.freeze({ ...textMetricsOps }),
    setAlgebra: Object.freeze({ ...setAlgebraOps }),
    graph: Object.freeze({ ...graphOps }),
});
