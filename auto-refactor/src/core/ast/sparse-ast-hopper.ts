/**
 * Module: Core Engine — Sparse AST Hopper (Subtree Pruning Kernel)
 * File Path: src/core/ast/sparse-ast-hopper.ts
 * Architecture Role: Node-level pruning kernel sitting between the replay window and the shared
 *   traversal. The bounded replay planners decide which line span must be re-audited; this hopper
 *   converts that span into a subtree-skip decision so the traversal never descends into branches
 *   that lie wholly outside the span.
 * Dependencies & Triggers: Consumes NormalizedNode from ./multilang; used by runStreaming and
 *   runStreamingProjected in ./traverse when a line-bounded window is supplied.
 * Responsibilities:
 *   1. Classify a node as inside, wrapping, before or after the active window in O(1).
 *   2. Report subtree-skip eligibility without mutating the tree or allocating per node.
 *   3. Accumulate visit/prune counters so the saving is measured instead of asserted.
 * Exit Semantics & Design Rationale: Pure predicates with no I/O and no throws. A node is prunable
 *   only when its ENTIRE extent lies outside the window; a node that merely starts or ends outside
 *   still wraps nodes inside, so pruning it would hide real findings. Nodes without a materialized
 *   position are never pruned — an unknown extent cannot prove absence of content, and a silent
 *   false negative costs more than the pruning saves.
 */

import type { NormalizedNode } from './multilang';

/** Placement of one node relative to the active window. */
export type HopperVerdict = 'inside' | 'wraps' | 'before' | 'after' | 'unknown';

/** Mutable counters describing how much of the tree the hopper removed. */
export interface SparseHopperStats {
    /** Nodes dispatched to analyzer hooks. */
    visited: number;
    /** Nodes whose entire subtree was skipped. */
    pruned: number;
}

/** Immutable line window the hopper prunes against. */
export interface SparseHopperWindow {
    /** 1-based inclusive first line that must be audited. */
    readonly startLine: number;
    /** 1-based inclusive last line that must be audited. */
    readonly endLine: number;
}

/**
 * Create zeroed hopper counters.
 *
 * @returns Fresh stats object owned by one traversal.
 */
export function createSparseHopperStats(): SparseHopperStats {
    return { visited: 0, pruned: 0 };
}

/**
 * Classify a node against the window using only materialized positions.
 *
 * @param node - Candidate node from the normalized tree.
 * @param window - Active window, or undefined when the whole file is audited.
 * @returns Placement verdict; `unknown` whenever a boundary position is missing.
 */
export function classifyNodeForWindow(
    node: NormalizedNode,
    window: SparseHopperWindow | undefined,
): HopperVerdict {
    if (!window) return 'inside';
    const start = node.start?.line;
    const end = node.end?.line;
    if (start === undefined || end === undefined) return 'unknown';
    if (end < window.startLine) return 'before';
    if (start > window.endLine) return 'after';
    if (start >= window.startLine && end <= window.endLine) return 'inside';
    return 'wraps';
}

/**
 * Decide whether the node's whole subtree can be skipped.
 *
 * @param node - Candidate node from the normalized tree.
 * @param window - Active window, or undefined when the whole file is audited.
 * @returns True only when the complete extent sits outside the window.
 */
export function isSubtreePrunable(
    node: NormalizedNode,
    window: SparseHopperWindow | undefined,
): boolean {
    const verdict = classifyNodeForWindow(node, window);
    return verdict === 'before' || verdict === 'after';
}

/**
 * Decide whether the node itself should be dispatched to analyzer hooks.
 *
 * Wrapping nodes are dispatched: they hold the scope context (class names, bindings) that the
 * analyzers rely on, and dropping them would change nesting depth for the nodes that follow.
 *
 * @param node - Candidate node from the normalized tree.
 * @param window - Active window, or undefined when the whole file is audited.
 * @returns True when the node lies inside the window or cannot be classified.
 */
export function shouldDispatchNode(
    node: NormalizedNode,
    window: SparseHopperWindow | undefined,
): boolean {
    if (!window) return true;
    const verdict = classifyNodeForWindow(node, window);
    return verdict === 'inside' || verdict === 'wraps' || verdict === 'unknown';
}

/**
 * Total nodes the hopper accounted for.
 *
 * @param stats - Counters accumulated during one traversal.
 * @returns Visited plus pruned nodes.
 */
export function totalHopperNodes(stats: SparseHopperStats): number {
    return stats.visited + stats.pruned;
}

/**
 * Fraction of the tree the hopper removed, as a 0..1 ratio.
 *
 * @param stats - Counters accumulated during one traversal.
 * @returns Pruned ratio; zero when no node was accounted for.
 */
export function hopperPruneRatio(stats: SparseHopperStats): number {
    const total = totalHopperNodes(stats);
    return total === 0 ? 0 : stats.pruned / total;
}
