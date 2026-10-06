/**
 * Module: Core Engine — Unified Single-Pass AST Dispatcher
 * File Path: src/core/ast/unified-ast-visitor.ts
 * Architecture Role: Single-pass traversal dispatcher over TypeScript SourceFile AST nodes;
 *   routes nodes to subscribed listeners via an inverted SyntaxKind index.
 * Dependencies & Triggers: typescript compiler API; consumed by AST analyzers, codemods,
 *   and refactoring pipelines to replace multiple repetitive AST traversals.
 * Responsibilities:
 *   1. Register AstNodeListener instances with optional SyntaxKind filtering;
 *   2. Maintain an inverted index (Map<SyntaxKind, AstNodeListener[]>) for O(1) kind lookup;
 *   3. Execute single DFS traversal (ts.forEachChild) dispatching enter/leave events;
 *   4. Guarantee zero heap allocations in inner traversal loops and strict call stack order.
 * Exit Semantics & Design Rationale: Traversal is synchronous and deterministically propagates
 *   exceptions; pre-allocated traversal stacks and indexed loops eliminate transient GC pressure.
 */

import * as ts from 'typescript';

/**
 * Listener interface for observing TypeScript AST nodes during unified traversal.
 */
export interface AstNodeListener {
    /** Unique diagnostic or functional identifier for the listener. */
    name: string;
    /** Optional syntax kind filter; when defined, only matching node kinds trigger enter/leave. */
    kinds?: ts.SyntaxKind[];
    /**
     * Pre-order visitor hook called upon entering an AST node.
     *
     * @param node - The current TypeScript AST node being entered.
     * @param parent - The immediate parent AST node, or undefined if visiting the root.
     * @param depth - Current 0-based tree depth from the traversal root.
     */
    enter?(node: ts.Node, parent?: ts.Node, depth?: number): void;
    /**
     * Post-order visitor hook called upon leaving an AST node after visiting all its children.
     *
     * @param node - The current TypeScript AST node being left.
     * @param parent - The immediate parent AST node, or undefined if visiting the root.
     * @param depth - Current 0-based tree depth from the traversal root.
     */
    leave?(node: ts.Node, parent?: ts.Node, depth?: number): void;
}

/**
 * High-performance single-pass AST visitor that multiplexes node events to listeners
 * using an inverted SyntaxKind index and zero-allocation DFS child iteration.
 */
export class UnifiedAstVisitor {
    private readonly listeners: AstNodeListener[] = [];
    private readonly kindListeners = new Map<ts.SyntaxKind, AstNodeListener[]>();
    private readonly allListeners: AstNodeListener[] = [];
    private readonly nodeStack: (ts.Node | undefined)[] = [];
    private currentDepth = 0;

    /**
     * Reusable child traversal callback bound to this visitor instance.
     * Avoids per-node closure allocation during ts.forEachChild recursion.
     */
    private readonly traverse = (node: ts.Node): void => {
        const depth = this.currentDepth;
        const parent = depth > 0 ? this.nodeStack[depth - 1] : undefined;

        this.dispatchEnter(node, parent, depth);

        this.nodeStack[depth] = node;
        this.currentDepth = depth + 1;

        ts.forEachChild(node, this.traverse);

        this.currentDepth = depth;
        this.nodeStack[depth] = undefined;

        this.dispatchLeave(node, parent, depth);
    };

    /**
     * Registers an AST node listener and updates the SyntaxKind inverted index.
     *
     * @param listener - The AST node listener to subscribe.
     */
    public register(listener: AstNodeListener): void {
        this.listeners.push(listener);

        if (listener.kinds === undefined) {
            this.allListeners.push(listener);
            return;
        }

        const seen = new Set<ts.SyntaxKind>();
        for (let i = 0; i < listener.kinds.length; i++) {
            const kind = listener.kinds[i];
            if (seen.has(kind)) {
                continue;
            }
            seen.add(kind);

            let bucket = this.kindListeners.get(kind);
            if (bucket === undefined) {
                bucket = [];
                this.kindListeners.set(kind, bucket);
            }
            bucket.push(listener);
        }
    }

    /**
     * Executes a single-pass depth-first search over the provided TypeScript SourceFile AST,
     * dispatching enter and leave events to all registered listeners.
     *
     * @param sourceFile - The TypeScript SourceFile root node to traverse.
     */
    public walk(sourceFile: ts.SourceFile): void {
        if (!sourceFile) {
            return;
        }

        this.currentDepth = 0;
        try {
            this.traverse(sourceFile);
        } finally {
            this.currentDepth = 0;
            this.nodeStack.fill(undefined);
        }
    }

    /**
     * Internal helper to dispatch pre-order enter notifications.
     */
    private dispatchEnter(node: ts.Node, parent: ts.Node | undefined, depth: number): void {
        const all = this.allListeners;
        for (let i = 0; i < all.length; i++) {
            const callback = all[i].enter;
            if (callback !== undefined) {
                callback(node, parent, depth);
            }
        }

        const specific = this.kindListeners.get(node.kind);
        if (specific === undefined) {
            return;
        }

        for (let i = 0; i < specific.length; i++) {
            const callback = specific[i].enter;
            if (callback !== undefined) {
                callback(node, parent, depth);
            }
        }
    }

    /**
     * Internal helper to dispatch post-order leave notifications.
     */
    private dispatchLeave(node: ts.Node, parent: ts.Node | undefined, depth: number): void {
        const specific = this.kindListeners.get(node.kind);
        if (specific !== undefined) {
            for (let i = specific.length - 1; i >= 0; i--) {
                const callback = specific[i].leave;
                if (callback !== undefined) {
                    callback(node, parent, depth);
                }
            }
        }

        const all = this.allListeners;
        for (let i = all.length - 1; i >= 0; i--) {
            const callback = all[i].leave;
            if (callback !== undefined) {
                callback(node, parent, depth);
            }
        }
    }
}
