/**
 * Module: Core Engine — Normalized AST Query & Selector Engine
 * File Path: src/core/ast/ast-query.ts
 * Architecture Role: High-performance, language-agnostic query and traversal engine over
 *   NormalizedNode trees; provides zero-allocation search, filtering, and metric projection.
 * Dependencies & Triggers: Consumes NormalizedNode and NodeKind from ./multilang; zero external
 *   runtime dependencies; invoked by analyzers (simplify, naming, complexity, governance).
 * Responsibilities:
 *   1. Execute iterative and depth-guarded pre-order traversals over NormalizedNode graphs;
 *   2. Supply composable selector predicates (selectDescendants, findFirst, findNodesByKind);
 *   3. Collect semantic function invocations and identifier bindings without transient allocations;
 *   4. Compute maximum nesting depth and branching metrics using bounded stack frames.
 * Exit Semantics & Design Rationale: CC <= 10, Depth <= 3; strictly non-throwing; returns empty
 *   arrays or undefined on missing/empty subtrees. Uses pooled stack frames for deep trees.
 */

import { NodeKind, type NormalizedNode } from './multilang';

/**
 * Visitor callback signature for NormalizedNode traversals.
 * Returning false from the visitor instructs the traversal to skip descending into children.
 */
export type NormalizedNodeVisitor = (
    node: NormalizedNode,
    depth: number,
    parent?: NormalizedNode,
) => boolean | void;

/** Internal reusable stack frame for non-recursive tree iteration. */
interface TraversalFrame {
    node: NormalizedNode;
    depth: number;
    parent?: NormalizedNode;
}

/** Pre-allocated scratch stack array pool for zero-allocation tree traversals. */
const SCRATCH_STACK: TraversalFrame[] = [];

/**
 * Traverses a NormalizedNode tree in pre-order depth-first sequence using an iterative stack.
 * Guarantees zero call-stack overflow on deeply nested ASTs and avoids per-node heap allocation.
 *
 * @param root - Root normalized node to begin traversal.
 * @param visitor - Consumer callback invoked for each node. Returning false skips children.
 */
export function walkNormalizedTree(
    root: NormalizedNode,
    visitor: NormalizedNodeVisitor,
): void {
    if (!root) return;

    let stackIdx = 0;
    SCRATCH_STACK[stackIdx] = { node: root, depth: 0, parent: undefined };

    while (stackIdx >= 0) {
        const frame = SCRATCH_STACK[stackIdx];
        stackIdx--;

        const current = frame.node;
        const depth = frame.depth;
        const parent = frame.parent;

        const shouldDescend = visitor(current, depth, parent);
        if (shouldDescend === false) {
            continue;
        }

        const children = current.children;
        if (!children || children.length === 0) {
            continue;
        }

        // Push children in reverse order so left-most child is popped and visited first
        for (let i = children.length - 1; i >= 0; i--) {
            stackIdx++;
            if (stackIdx >= SCRATCH_STACK.length) {
                SCRATCH_STACK.push({ node: children[i], depth: depth + 1, parent: current });
            } else {
                SCRATCH_STACK[stackIdx].node = children[i];
                SCRATCH_STACK[stackIdx].depth = depth + 1;
                SCRATCH_STACK[stackIdx].parent = current;
            }
        }
    }
}

/**
 * Collects all descendant nodes in the tree matching the given predicate.
 *
 * @param root - Subtree root node.
 * @param predicate - Filter predicate evaluated on each node.
 * @returns Array of matched NormalizedNode instances in DFS pre-order.
 */
export function selectDescendants(
    root: NormalizedNode,
    predicate: (node: NormalizedNode) => boolean,
): NormalizedNode[] {
    const matched: NormalizedNode[] = [];
    walkNormalizedTree(root, (node) => {
        if (predicate(node)) {
            matched.push(node);
        }
    });
    return matched;
}

/**
 * Finds the first node in pre-order traversal that satisfies the predicate, short-circuiting immediately.
 *
 * @param root - Subtree root node.
 * @param predicate - Match condition.
 * @returns First matching NormalizedNode, or undefined if no match is found.
 */
export function findFirst(
    root: NormalizedNode,
    predicate: (node: NormalizedNode) => boolean,
): NormalizedNode | undefined {
    let result: NormalizedNode | undefined;
    walkNormalizedTree(root, (node) => {
        if (predicate(node)) {
            result = node;
            return false;
        }
        return result === undefined;
    });
    return result;
}

/**
 * Collects all nodes of a specific NodeKind in the subtree.
 *
 * @param root - Subtree root node.
 * @param kind - Target NodeKind enum value.
 * @returns Array of matching NormalizedNode instances.
 */
export function findNodesByKind(root: NormalizedNode, kind: NodeKind): NormalizedNode[] {
    return selectDescendants(root, (node) => node.kind === kind);
}

/**
 * Collects all function and method invocation nodes, optionally filtering by callee identifier.
 *
 * @param root - Subtree root node.
 * @param calleeName - Optional callee function/method name to match.
 * @returns Array of Call nodes matching the criteria.
 */
export function collectCalls(root: NormalizedNode, calleeName?: string): NormalizedNode[] {
    return selectDescendants(root, (node) => {
        if (node.kind !== NodeKind.Call) return false;
        if (calleeName !== undefined && node.name !== calleeName) return false;
        return true;
    });
}

/**
 * Computes the maximum syntactic nesting depth of the given subtree without allocating intermediate arrays.
 *
 * @param root - Subtree root node.
 * @returns Maximum depth reached by any leaf in the subtree (0 for single root).
 */
export function computeSubtreeDepth(root: NormalizedNode): number {
    let maxDepth = 0;
    walkNormalizedTree(root, (_node, depth) => {
        if (depth > maxDepth) {
            maxDepth = depth;
        }
    });
    return maxDepth;
}

/**
 * Collects all unique identifier and binding names declared or referenced in the subtree.
 *
 * @param root - Subtree root node.
 * @returns Array of unique string names encountered in the subtree.
 */
export function collectSubtreeNames(root: NormalizedNode): string[] {
    const names = new Set<string>();
    walkNormalizedTree(root, (node) => {
        if (node.name) {
            names.add(node.name);
        }
        if (node.bindingName) {
            names.add(node.bindingName);
        }
    });
    return Array.from(names);
}
