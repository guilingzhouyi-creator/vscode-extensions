/**
 * Module: Core Engine — Lightweight Scope Graph
 * File Path: src/core/ast/scope-graph.ts
 * Architecture Role: Single-pass scope graph builder and query interface for scope-aware
 *   analysis. Built on-demand when analyzers need scope-aware reasoning.
 * Dependencies & Triggers: NormalizedNode / NodeKind / LanguageAdapter from ./multilang.
 *   Standalone builder — no integration with runStreaming in Phase 1.
 * Responsibilities: Build Scope nodes for each scope boundary (Module, Function, Class);
 *   track variable/constant/function/class bindings; provide lookup (walks up parent chain);
 *   provide shadow detection; provide scope-at-position lookup.
 * Exit Semantics & Design Rationale: Phase 1 is a standalone builder — call buildScopeGraph()
 *   when you need a scope graph. Scopes are plain objects with parent pointers (no cycles).
 *   Bindings use string → BindingInfo maps. Only Module + Function + Class scopes in Phase 1;
 *   Block scopes deferred to Phase 2. Zero overhead when no scope-aware analyzer is enabled.
 */

import type { AnalyzerContext, Issue } from '../types';
import { NodeKind, type NormalizedNode, type LanguageAdapter } from './multilang';
import type { StreamingEntry } from './traverse';

/** Kinds of scope boundaries. */
export type ScopeKind = 'module' | 'function' | 'class';

/** Kinds of bindings (declarations). */
export type BindingKind = 'variable' | 'constant' | 'function' | 'class' | 'parameter' | 'import';

/** Information about a single binding (declaration). */
export interface BindingInfo {
    name: string;
    kind: BindingKind;
    node: NormalizedNode; // The declaration node
    scope: Scope;         // The scope this binding belongs to
}

/** A single scope node in the scope graph. */
export interface Scope {
    kind: ScopeKind;
    parent: Scope | null;
    children: Scope[];
    /** Bindings declared directly in this scope, keyed by name. */
    bindings: Map<string, BindingInfo>;
    /** The AST node that introduced this scope. */
    node: NormalizedNode;
    /** Start line for position-based scope lookup (1-based). */
    startLine: number;
    /** End line (approximate, from the node's end if available). */
    endLine: number;
}

/**
 * Result of a name lookup across scope chains.
 * Contains the closest binding (if found) plus whether it is shadowed by inner scopes.
 */
export interface LookupResult {
    /** The closest binding matching the name, or null if not found. */
    binding: BindingInfo | null;
    /** All bindings matching the name across the scope chain (closest first). */
    all: BindingInfo[];
    /** Whether the name is shadowed — true if more than one binding exists in the chain. */
    shadowed: boolean;
}

/**
 * Determine if a node introduces a new scope boundary.
 * Phase 1: only Module (SourceFile), Function (functionLike), and Class (isClassDefining) scopes.
 *
 * @param node - Normalized node to test.
 * @returns The scope kind or null if the node does not introduce a scope.
 */
function scopeKindForNode(node: NormalizedNode): ScopeKind | null {
    if (node.kind === NodeKind.SourceFile) return 'module';
    if (node.functionLike) return 'function';
    if (node.isClassDefining) return 'class';
    return null;
}

/**
 * Derive the binding kind and name from a node, if it introduces a declaration.
 * Returns null if the node does not introduce a binding.
 *
 * @param node - Normalized node to inspect.
 * @returns [name, kind] tuple, or null if no binding is introduced.
 */
function bindingOf(node: NormalizedNode): [string, BindingKind] | null {
    const name = node.name ?? node.bindingName;
    if (!name) return null;

    if (node.kind === NodeKind.Constant) return [name, 'constant'];
    if (node.kind === NodeKind.Variable) return [name, 'variable'];
    if (node.functionLike) return [name, 'function'];
    if (node.isClassDefining) return [name, 'class'];
    return null;
}

/**
 * Scope graph query interface. Holds the built graph and provides lookup / shadow /
 * position-based scope queries.
 *
 * Instances are created by `buildScopeGraph()`; consumers should not construct this directly.
 */
export class ScopeGraph {
    private _root: Scope | null = null;
    private _allScopes: Scope[] = [];

    /** @internal — populated by buildScopeGraph(). */
    _addScope(scope: Scope): void {
        this._allScopes.push(scope);
        if (!this._root) this._root = scope;
    }

    // ─── Query API ────────────────────────────────────────────────────

    /**
     * Look up a name in the scope chain starting from the given scope.
     * Walks up parent scopes until found or reaching the root.
     *
     * @param name - The variable/function/class name to look up.
     * @param fromScope - The scope to start from (innermost); defaults to root if omitted.
     * @returns LookupResult with the closest binding, all matches, and shadow status.
     */
    lookup(name: string, fromScope?: Scope | null): LookupResult {
        const all: BindingInfo[] = [];
        let scope: Scope | null = fromScope ?? this._root;
        while (scope) {
            const binding = scope.bindings.get(name);
            if (binding) all.push(binding);
            scope = scope.parent;
        }
        return {
            binding: all[0] ?? null,
            all,
            shadowed: all.length > 1,
        };
    }

    /**
     * Check if a name is shadowed — i.e., an inner scope declares the same name
     * as an outer scope, hiding the outer one.
     *
     * @param name - The variable/function/class name to check.
     * @param fromScope - The scope to start checking from (inner scope).
     * @returns True if the name has multiple declarations across the scope chain.
     */
    isShadowed(name: string, fromScope?: Scope | null): boolean {
        return this.lookup(name, fromScope).shadowed;
    }

    /**
     * Find the innermost scope that contains the given line number.
     * Useful for "what is the scope at this position" queries.
     *
     * @param line - 1-based line number.
     * @returns The innermost scope containing line, or null if no scope matches.
     */
    getScopeAtLine(line: number): Scope | null {
        if (!this._root) return null;
        return this.findInnermostScope(this._root, line);
    }

    private findInnermostScope(scope: Scope, line: number): Scope | null {
        if (line < scope.startLine || line > scope.endLine) return null;
        for (const child of scope.children) {
            const found = this.findInnermostScope(child, line);
            if (found) return found;
        }
        return scope;
    }

    /** Get the root (module-level) scope. */
    getRoot(): Scope | null {
        return this._root;
    }

    /** Total number of scopes in the graph. */
    get scopeCount(): number {
        return this._allScopes.length;
    }

    /** Total number of bindings across all scopes. */
    get bindingCount(): number {
        let count = 0;
        for (const scope of this._allScopes) {
            count += scope.bindings.size;
        }
        return count;
    }

    /**
     * @internal — finalize end lines for scopes whose node lacked an end position.
     * Called by both buildScopeGraph() and ScopeGraphStreamer after traversal completes.
     */
    _finalize(): void {
        if (this._root && this._root.endLine === 0) {
            finalizeEndLines(this._root, this._root.startLine);
        }
    }
}

/**
 * Build a scope graph by walking the AST once.
 *
 * This is a standalone builder — call it when you need a scope graph for a file.
 * Phase 1 design: independent of runStreaming, no extra per-file overhead unless
 * a scope-aware analyzer explicitly requests it. Phase 2 will integrate into
 * runStreaming for zero extra traversal.
 *
 * Scope boundaries (Phase 1):
 *   - SourceFile → module scope
 *   - functionLike nodes → function scope
 *   - isClassDefining nodes → class scope
 *
 * Bindings are derived from normalized flags:
 *   - Variable/Constant nodes → variable / constant bindings
 *   - Named functionLike nodes → function bindings (registered in parent scope)
 *   - Named isClassDefining nodes → class bindings (registered in parent scope)
 *
 * @param adapter - Language adapter supplying children() over the normalized tree.
 * @param root - Normalized SourceFile root node.
 * @returns A fully built ScopeGraph ready for querying.
 */
export function buildScopeGraph(adapter: LanguageAdapter, root: NormalizedNode): ScopeGraph {
    const graph = new ScopeGraph();
    const scopeStack: Scope[] = [];
    let currentScope: Scope | null = null;

    /** Record a binding in the current scope, if the node introduces one. */
    function recordBinding(node: NormalizedNode): void {
        if (!currentScope) return;
        const info = bindingOf(node);
        if (!info) return;
        const [name, kind] = info;
        // First declaration wins (defensive: same name declared twice in one scope
        // is a language-level error, not a scope-graph concern).
        if (!currentScope.bindings.has(name)) {
            currentScope.bindings.set(name, {
                name,
                kind,
                node,
                scope: currentScope,
            });
        }
    }

    function walk(node: NormalizedNode): void {
        const kind = scopeKindForNode(node);
        const isScopeBoundary = kind !== null;

        // 1. Record any binding this node introduces into the CURRENT (parent) scope.
        //    For function/class declarations, the name belongs to the enclosing scope,
        //    not the scope introduced by the function/class itself.
        recordBinding(node);

        // 2. If this node introduces a scope, create it and push it onto the stack.
        if (isScopeBoundary) {
            const parentScope = currentScope;
            const scope: Scope = {
                kind: kind!,
                parent: parentScope,
                children: [],
                bindings: new Map(),
                node,
                startLine: node.start?.line ?? 0,
                endLine: node.end?.line ?? 0,
            };
            if (parentScope) {
                parentScope.children.push(scope);
            }
            graph._addScope(scope);
            scopeStack.push(scope);
            currentScope = scope;
        }

        // 3. Recurse into children.
        for (const child of adapter.children(node)) {
            walk(child);
        }

        // 4. If this node introduced a scope, pop it from the stack.
        if (isScopeBoundary) {
            scopeStack.pop();
            currentScope = scopeStack[scopeStack.length - 1] ?? null;
        }
    }

    walk(root);

    // Finalize end lines for scopes whose node lacked an end position.
    // The root (module) scope gets its start line as a fallback — consumers
    // that need accurate end lines should rely on nodes with known end positions.
    if (graph.getRoot() && graph.getRoot()!.endLine === 0) {
        finalizeEndLines(graph.getRoot()!, graph.getRoot()!.startLine);
    }

    return graph;
}

/**
 * Propagate end-line information down the scope tree. Scopes without an explicit
 * end line inherit their parent's end line (approximate but sufficient for
 * position-based lookup when the parser did not populate end positions).
 *
 * @param scope - Current scope to process.
 * @param parentEnd - End line of the parent scope (inherited if scope has no end).
 */
function finalizeEndLines(scope: Scope, parentEnd: number): void {
    if (scope.endLine === 0) {
        scope.endLine = parentEnd;
    }
    for (const child of scope.children) {
        finalizeEndLines(child, scope.endLine);
    }
}

// ─── Streaming Scope Graph Builder ────────────────────────────────────

/**
 * Streaming scope graph builder that integrates with `runStreaming`.
 * Builds the scope graph in the single shared pass — zero extra traversal.
 *
 * Usage:
 *   const scopeBuilder = new ScopeGraphStreamer(root);
 *   const entries = [scopeBuilder.asEntry(ctx), ...otherEntries];
 *   runStreaming(adapter, root, entries);
 *   const graph = scopeBuilder.graph;
 *
 * Ordering note: the streamer entry MUST be first in the entries array so that:
 *   - its `visit` runs first (scope is pushed before other analyzers visit)
 *   - its `leave` runs last (scope is popped after other analyzers leave)
 *
 * This is a Phase 2 integration — replaces the standalone `buildScopeGraph()`
 * for scope-aware analyzers that already participate in the streaming pass.
 */
export class ScopeGraphStreamer {
    /** Analyzer name for registration / error reporting. */
    readonly name = '__scope_graph__';

    /** The built scope graph, available after finalize(). */
    readonly graph: ScopeGraph = new ScopeGraph();

    private scopeStack: Scope[] = [];
    private currentScope: Scope | null = null;

    /**
     * Create a streaming scope builder. The root node initializes the module scope.
     *
     * @param root - Normalized SourceFile root node (the same root passed to runStreaming).
     */
    constructor(root: NormalizedNode) {
        // Initialize the module scope from the root SourceFile.
        // runStreaming never dispatches the root to visit(), so we bootstrap here.
        const kind = scopeKindForNode(root);
        if (kind !== null) {
            const scope: Scope = {
                kind,
                parent: null,
                children: [],
                bindings: new Map(),
                node: root,
                startLine: root.start?.line ?? 0,
                endLine: root.end?.line ?? 0,
            };
            this.graph._addScope(scope);
            this.scopeStack.push(scope);
            this.currentScope = scope;
        }
    }

    /**
     * Pre-order hook: record bindings and enter new scopes.
     * Called by runStreaming for each node (excluding the root).
     */
    visit(
        node: NormalizedNode,
        _ctx: AnalyzerContext,
        _parent: NormalizedNode | undefined,
        _grandparent: NormalizedNode | undefined,
        _depth: number,
        _className: string | null,
        _binding: string | null,
    ): void {
        // 1. Record any binding this node introduces into the CURRENT (parent) scope.
        //    For function/class declarations, the name belongs to the enclosing scope,
        //    not the scope introduced by the function/class itself.
        this.recordBinding(node);

        // 2. If this node introduces a scope, create it and push it onto the stack.
        const kind = scopeKindForNode(node);
        if (kind !== null) {
            const parentScope = this.currentScope;
            const scope: Scope = {
                kind,
                parent: parentScope,
                children: [],
                bindings: new Map(),
                node,
                startLine: node.start?.line ?? 0,
                endLine: node.end?.line ?? 0,
            };
            if (parentScope) {
                parentScope.children.push(scope);
            }
            this.graph._addScope(scope);
            this.scopeStack.push(scope);
            this.currentScope = scope;
        }
    }

    /**
     * Post-order hook: leave scopes introduced by this node.
     * Called by runStreaming after recursing into children.
     */
    leave(
        node: NormalizedNode,
        _ctx: AnalyzerContext,
        _parent: NormalizedNode | undefined,
        _grandparent: NormalizedNode | undefined,
        _depth: number,
        _className: string | null,
        _binding: string | null,
    ): void {
        if (scopeKindForNode(node) !== null) {
            this.scopeStack.pop();
            this.currentScope = this.scopeStack[this.scopeStack.length - 1] ?? null;
        }
    }

    /**
     * Finalize the scope graph after traversal completes.
     * @returns Empty issue array (streamer produces no issues).
     */
    finalize(_ctx: AnalyzerContext): Issue[] {
        this.graph._finalize();
        return [];
    }

    /**
     * Create a StreamingEntry-compatible object for use with runStreaming.
     * Place this entry FIRST in the entries array so the scope stack is
     * correct for all other analyzers.
     */
    asEntry(ctx: AnalyzerContext): StreamingEntry {
        return { analyzer: this, ctx };
    }

    /** Record a binding in the current scope, if the node introduces one. */
    private recordBinding(node: NormalizedNode): void {
        if (!this.currentScope) return;
        const info = bindingOf(node);
        if (!info) return;
        const [name, kind] = info;
        // First declaration wins (defensive: same name declared twice in one scope
        // is a language-level error, not a scope-graph concern).
        if (!this.currentScope.bindings.has(name)) {
            this.currentScope.bindings.set(name, {
                name,
                kind,
                node,
                scope: this.currentScope,
            });
        }
    }
}
