/**
 * Module: Core Engine — Lightweight Scope Graph
 * File Path: src/core/ast/scope-graph.ts
 * Architecture Role: Single-pass scope graph builder and query interface for scope-aware
 *   analysis. Built on-demand when analyzers need scope-aware reasoning.
 * Dependencies & Triggers: NormalizedNode / NodeKind / LanguageAdapter from ./multilang.
 *   Standalone on-demand builder — operates independently from runStreaming.
 * Responsibilities: Build Scope nodes for each scope boundary (Module, Function, Class);
 *   track variable/constant/function/class bindings; provide lookup (walks up parent chain);
 *   provide shadow detection; provide scope-at-position lookup.
 * Exit Semantics & Design Rationale: Provides both a Standalone On-Demand Builder
 *   (buildScopeGraph()) and a Streaming Pipelined Builder (ScopeGraphStreamer).
 *   Scopes are plain objects with parent pointers (no cycles). Bindings use
 *   string → BindingInfo maps. Captures Module + Function + Class scopes with
 *   zero overhead when no scope-aware analyzer is enabled.
 */

import type { AnalyzerContext, Issue } from '../types';
import { NodeKind, type NormalizedNode, type LanguageAdapter } from './multilang';
import type { StreamingEntry } from './traverse';
import { nativeCore } from '../native/native-bridge';
import type {
    NativeBindingInput,
    NativeScopeInput,
    NativeShadowingResult,
} from '../native/native-types';

const SCOPE_KINDS = {
    MODULE: 'module',
    FUNCTION: 'function',
    CLASS: 'class',
} as const;

const BINDING_KINDS = {
    CONSTANT: 'constant',
    VARIABLE: 'variable',
    FUNCTION: 'function',
    CLASS: 'class',
    PARAMETER: 'parameter',
    IMPORT: 'import',
} as const;

const STREAMER_ANALYZER_NAME = '__scope_graph__';

const NATIVE_BINDINGS = {
    VARIABLE: 0,
    CONSTANT: 1,
    FUNCTION: 2,
    CLASS: 3,
    PARAMETER: 4,
    IMPORT: 5,
} as const;

const NATIVE_SCOPES = {
    MODULE: 0,
    FUNCTION: 1,
    CLASS: 2,
} as const;

/** Kinds of scope boundaries. */
export type ScopeKind = 'module' | 'function' | 'class';

/** Kinds of bindings (declarations). */
export type BindingKind = 'variable' | 'constant' | 'function' | 'class' | 'parameter' | 'import';

/** Information about a single binding (declaration). */
export interface BindingInfo {
    name: string;
    kind: BindingKind;
    node: NormalizedNode; // The declaration node
    scope: Scope; // The scope this binding belongs to
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
 * Scope boundaries: Module (SourceFile), Function (functionLike), and Class
 *   (isClassDefining) scopes.
 *
 * @param node - Normalized node to test.
 * @returns The scope kind or null if the node does not introduce a scope.
 */
function resolveScopeKindForNode(node: NormalizedNode): ScopeKind | null {
    if (node.kind === NodeKind.SourceFile) return SCOPE_KINDS.MODULE;
    if (node.functionLike) return SCOPE_KINDS.FUNCTION;
    return node.isClassDefining ? SCOPE_KINDS.CLASS : null;
}

/**
 * Derive the binding kind and name from a node, if it introduces a declaration.
 * Returns null if the node does not introduce a binding.
 *
 * @param node - Normalized node to inspect.
 * @returns [name, kind] tuple, or null if no binding is introduced.
 */
function resolveBindingOfNode(node: NormalizedNode): [string, BindingKind] | null {
    const name = node.name ?? node.bindingName;
    if (!name) return null;

    if (node.kind === NodeKind.Constant) return [name, BINDING_KINDS.CONSTANT];
    if (node.kind === NodeKind.Variable) return [name, BINDING_KINDS.VARIABLE];
    if (node.functionLike) return [name, BINDING_KINDS.FUNCTION];
    return node.isClassDefining ? [name, BINDING_KINDS.CLASS] : null;
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
    lookupBinding(name: string, fromScope?: Scope | null): LookupResult {
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

    /** Compatibility alias for lookupBinding. */
    lookup(name: string, fromScope?: Scope | null): LookupResult {
        return this.lookupBinding(name, fromScope);
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
        return this.lookupBinding(name, fromScope).shadowed;
    }

    /**
     * Leverages native acceleration kernel to execute single-pass batch detection of
     * all variable shadowing incidents across the entire scope graph.
     *
     * @returns Array of detected variable shadowing incidents.
     */
    detectAllShadowing(): NativeShadowingResult[] {
        const scopes: NativeScopeInput[] = [];
        const scopeIndexByScope = new Map<Scope, number>();
        for (let i = 0; i < this._allScopes.length; i++) {
            scopeIndexByScope.set(this._allScopes[i], i);
        }
        for (let i = 0; i < this._allScopes.length; i++) {
            const scopeItem = this._allScopes[i];
            const parentIdx = scopeItem.parent ? (scopeIndexByScope.get(scopeItem.parent) ?? -1) : -1;
            const kindCode =
                scopeItem.kind === SCOPE_KINDS.FUNCTION
                    ? NATIVE_SCOPES.FUNCTION
                    : scopeItem.kind === SCOPE_KINDS.CLASS
                        ? NATIVE_SCOPES.CLASS
                        : NATIVE_SCOPES.MODULE;
            scopes.push({
                parent: parentIdx,
                kind: kindCode,
                startLine: scopeItem.startLine,
                endLine: scopeItem.endLine,
            });
        }
        const bindings: NativeBindingInput[] = [];
        for (let i = 0; i < this._allScopes.length; i++) {
            const scopeItem = this._allScopes[i];
            for (const binding of scopeItem.bindings.values()) {
                const bKindCode =
                    binding.kind === BINDING_KINDS.CONSTANT
                        ? NATIVE_BINDINGS.CONSTANT
                        : binding.kind === BINDING_KINDS.FUNCTION
                            ? NATIVE_BINDINGS.FUNCTION
                            : binding.kind === BINDING_KINDS.CLASS
                                ? NATIVE_BINDINGS.CLASS
                                : binding.kind === BINDING_KINDS.PARAMETER
                                    ? NATIVE_BINDINGS.PARAMETER
                                    : binding.kind === BINDING_KINDS.IMPORT
                                        ? NATIVE_BINDINGS.IMPORT
                                        : NATIVE_BINDINGS.VARIABLE;
                bindings.push({
                    scopeId: i,
                    name: binding.name,
                    kind: bKindCode,
                    line: binding.node.start?.line ?? 0,
                });
            }
        }
        return nativeCore.analyzeScopeShadowing(scopes, bindings);
    }

    /**
     * Find the innermost scope that contains the given line number.
     * Useful for "what is the scope at this position" queries.
     *
     * @param line - 1-based line number.
     * @returns The innermost scope containing line, or null if no scope matches.
     */
    getScopeAtLine(line: number): Scope | null {
        return !this._root ? null : this.findInnermostScope(this._root, line);
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
    _finalizeScopes(): void {
        if (this._root && this._root.endLine === 0) {
            finalizeEndLines(this._root, this._root.startLine);
        }
    }
}

/** Creates and links a new Scope node. */
function createScopeNode(kind: ScopeKind, parent: Scope | null, node: NormalizedNode): Scope {
    const scope: Scope = {
        kind,
        parent,
        children: [],
        bindings: new Map(),
        node,
        startLine: node.start?.line ?? 0,
        endLine: node.end?.line ?? 0,
    };
    if (parent) {
        parent.children.push(scope);
    }
    return scope;
}

/** Record a binding in the given scope, if the node introduces one. */
function recordScopeBinding(targetScope: Scope | null, node: NormalizedNode): void {
    if (!targetScope) return;
    const bindingInfo = resolveBindingOfNode(node);
    if (!bindingInfo) return;
    const [name, kind] = bindingInfo;
    if (!targetScope.bindings.has(name)) {
        targetScope.bindings.set(name, {
            name,
            kind,
            node,
            scope: targetScope,
        });
    }
}

/**
 * Build a scope graph by walking the AST once.
 *
 * This is a Standalone On-Demand Builder — call it when you need a scope graph for a file.
 * Independent of runStreaming, with no extra per-file overhead unless a scope-aware analyzer
 * explicitly requests it. For pipelined execution within traversal, see ScopeGraphStreamer.
 *
 * Scope boundaries:
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

    function walk(node: NormalizedNode): void {
        const kind = resolveScopeKindForNode(node);
        const isScopeBoundary = kind !== null;

        recordScopeBinding(currentScope, node);

        if (isScopeBoundary) {
            const scope = createScopeNode(kind, currentScope, node);
            graph._addScope(scope);
            scopeStack.push(scope);
            currentScope = scope;
        }

        for (const child of adapter.children(node)) {
            walk(child);
        }

        if (isScopeBoundary) {
            scopeStack.pop();
            currentScope = scopeStack[scopeStack.length - 1] ?? null;
        }
    }

    walk(root);

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
 * Usage: instantiate `new ScopeGraphStreamer(root)`, prepend its `asEntry(ctx)`
 * to the entries array, run `runStreaming(adapter, root, entries)`, and
 * inspect the generated `scopeBuilder.graph`.
 *
 * Ordering note: the streamer entry MUST be first in the entries array so that:
 *   - its `visit` runs first (scope is pushed before other analyzers visit)
 *   - its `leave` runs last (scope is popped after other analyzers leave)
 *
 * This is a Streaming Pipelined Builder integration — operates alongside or
 * replaces the standalone on-demand `buildScopeGraph()` for scope-aware analyzers
 * that participate in the streaming pass.
 */
export class ScopeGraphStreamer {
    /** Analyzer name for registration / error reporting. */
    readonly name = STREAMER_ANALYZER_NAME;

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
        const kind = resolveScopeKindForNode(root);
        if (kind !== null) {
            const scope = createScopeNode(kind, null, root);
            this.graph._addScope(scope);
            this.scopeStack.push(scope);
            this.currentScope = scope;
        }
    }

    /**
     * Pre-order hook: record bindings and enter new scopes.
     * Called by runStreaming for each node (excluding the root).
     */
    visit(node: NormalizedNode): void {
        recordScopeBinding(this.currentScope, node);

        const kind = resolveScopeKindForNode(node);
        if (kind !== null) {
            const scope = createScopeNode(kind, this.currentScope, node);
            this.graph._addScope(scope);
            this.scopeStack.push(scope);
            this.currentScope = scope;
        }
    }

    /**
     * Post-order hook: leave scopes introduced by this node.
     * Called by runStreaming after recursing into children.
     */
    leave(node: NormalizedNode): void {
        if (resolveScopeKindForNode(node) !== null) {
            this.scopeStack.pop();
            this.currentScope = this.scopeStack[this.scopeStack.length - 1] ?? null;
        }
    }

    /**
     * Finalize the scope graph after traversal completes.
     * @returns Empty issue array (streamer produces no issues).
     */
    finalize(_ctx: AnalyzerContext): Issue[] {
        this.graph._finalizeScopes();
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
}
