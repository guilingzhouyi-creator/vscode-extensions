/**
 * Module: Core Engine — Language-Agnostic AST Contracts
 * File Path: src/core/ast/multilang.ts
 * Architecture Role: Normalized-AST contract boundary between concrete parser adapters
 *     (TypeScript, oxc, Rust/tree-sitter, GDScript) and traverse.ts plus all analyzers.
 * Dependencies & Triggers: Imported at module load by adapters.ts, the four adapters,
 *     traverse.ts, worker.ts, incrementalState.ts and the analyzers; no side effects.
 * Responsibilities: Declare NodeKind and the NormalizedNode semantic flags (scope, metric,
 *     literal); define LanguageAdapter parse/root/children plus the lazy-projection types
 *     ProjectionPolicy, NodeProjector, ReusedSpan and ProjectionSeed; export the frozen
 *     OTHER_PLACEHOLDER singleton shared by both built-in adapters.
 * Exit Semantics & Design Rationale: Pure contract module with no I/O, no throws and no
 *     per-parse allocation; concrete adapters own parse-failure semantics. Precomputed flags
 *     keep analyzers parser-agnostic and let the engine inline scope derivation with zero
 *     per-node object allocation instead of materializing parent pointers.
 *
 * Multi-language normalization layer.
 *
 * The engine's single-pass multiplexed traversal is language-agnostic: analyzers face a
 * uniform `NormalizedNode` (kind / text / positions / semantic flags) instead of `ts.Xxx`
 * nodes. A `LanguageAdapter` is the only place that knows a concrete parser (TypeScript,
 * tree-sitter-rust, ...) — it produces the normalized tree and answers the question the
 * engine needs while descending: "what are this node's children".
 *
 * Design note vs. docs/02-parsers-and-ast/01-multilang-abstraction.md: the original draft proposed
 * `scopeOf(node, parent, grandparent)` then `childScope(node, className, binding)`. In
 * practice scope derivation needs the *threaded* ancestor className/binding (the engine
 * maintains those while descending, like the old TS-only traversal did), and — since both
 * built-in adapters implemented it with byte-identical rules — the derivation is now
 * INLINED into the engine (see traverse.ts visitNode), expressed purely through normalized
 * flags (`isClassDefining` / `functionLike` / `introducesBinding`). Zero per-node object
 * allocation; a future language whose rules differ can re-introduce an override hook.
 */

/** Language-independent node classification used by analyzers (never `ts.SyntaxKind`). */
export enum NodeKind {
    SourceFile = 'SourceFile',
    Function = 'Function', // Standalone function / fn / arrow function / closure
    Method = 'Method', // Method declared inside a struct / impl / trait / class
    Struct = 'Struct',
    Class = 'Class',
    Impl = 'Impl', // Rust impl / TypeScript class implementation block
    Trait = 'Trait', // Rust trait / behavioral TypeScript interface
    Interface = 'Interface',
    Variable = 'Variable', // let / var binding
    Constant = 'Constant', // const binding
    Field = 'Field', // Struct field / class field
    NumericLiteral = 'NumericLiteral',
    StringLiteral = 'StringLiteral',
    Literal = 'Literal', // Generic literal when no more specific kind applies
    Call = 'Call',
    BinaryExpr = 'BinaryExpr',
    ControlFlow = 'ControlFlow', // if/for/while/match/switch
    Block = 'Block',
    Other = 'Other',
}

/** 1-based line/column position (same convention as core/types Position). */
export interface Position {
    line: number;
    column: number;
}

/**
 * A language-agnostic AST node.
 *
 * Beyond the structural fields from the design doc, adapters precompute a set of *semantic
 * flags* at parse time so the engine and analyzers never need the concrete grammar:
 *   - functionLike / isClassDefining / introducesBinding / bindingName / increasesNesting:
 *     consumed by the engine's threaded scope descent (mirrors the old TS-only rules exactly).
 *   - topLevel / exported: consumed by FileMetricCollector + large-file analyzer.
 *   - isConstBound / tolerated / isConstructor: consumed by the constants / complexity
 *     analyzers (precomputed by the TypeScript adapter with the original TS predicates, which
 *     is what keeps TS output byte-identical).
 * `children` is populated by the adapter (the engine iterates via `adapter.children()`).
 */
export interface NormalizedNode {
    kind: NodeKind;
    /**
     * Language-native kind string (ts.SyntaxKind name / tree-sitter node type).
     * Optional: the ONLY consumer is complexity.ts locating findings at the bare
     * `function` keyword (`first.rawKind === 'FunctionKeyword'`), so adapters only assign
     * it where it is observable and leave it unset elsewhere (saves a per-node property
     * write + reverse-kind lookup during materialization).
     */
    rawKind?: string;
    /**
     * Source text of this node, when materialized. Lazily populated: currently only literal
     * nodes carry it (the constants analyzer reads `text` as the literal value); other nodes
     * leave it undefined so large subtrees are never copied during parsing.
     */
    text?: string;
    /**
     * Node position (1-based line/column), lazily materialized for performance.
     * ONLY the following node kinds are guaranteed to carry `start`/`end`:
     *   - literal nodes (constants analyzer reads `start.line` / `locN`)
     *   - function-like nodes (complexity analyzer reads `start.line` / `locN`)
     *   - the bare `function` keyword node (complexity points findings at it)
     * All other nodes leave them undefined; consumers MUST go through `locN()`,
     * which asserts presence (a missing position would drop JSON fields and fail
     * the byte-level validation).
     */
    start?: Position;
    end?: Position;
    /** Declaration/identifier name, when applicable. */
    name?: string | null;
    isNumeric?: boolean;
    isString?: boolean;
    /** True when this node's initializer/right-hand side is function-like (binding source). */
    hasFunctionInitializer?: boolean;
    /** Cyclomatic decision-point weight (if/for/while/match/switch/case/?/&&/||...). Default 0. */
    branchWeight?: number;
    /** Precomputed children (adapter-owned). */
    children?: NormalizedNode[];

    // ---- engine scope-descent flags ----
    /** Function-like unit boundary (independent function / method / arrow / closure). */
    functionLike?: boolean;
    /** class/struct/impl/trait: children inherit `className = name`. */
    isClassDefining?: boolean;
    /** `const x = () => ...` / `obj.m = () => ...`: children inherit `binding = name`. */
    introducesBinding?: boolean;
    /** The binding name introduced by this node (when introducesBinding). */
    bindingName?: string | null;
    /** Control/block node: children sit one nesting level deeper. */
    increasesNesting?: boolean;

    // ---- metric / analyzer flags ----
    /** Top-level declaration (direct child of the source file). */
    topLevel?: boolean;
    /** Top-level and exported (export modifier / export assignment / export declaration). */
    exported?: boolean;
    /** Literal bound by a const declaration / enum member (skips constant findings). */
    isConstBound?: boolean;
    /** Literal in a tolerated context (index/property key/i18n/import path/JSX...). */
    tolerated?: boolean;
    /** TS constructor declaration (complexity naming). */
    isConstructor?: boolean;
}

/**
 * Root wrapper returned by every adapter's `parse`; `root` is always the normalized
 * source-file node whose children are the file's top-level declarations.
 */
export interface NormalizedAst {
    root: NormalizedNode;
}

// ---------------------------------------------------------------------------
// Lazy projection (fast path) — see docs/02-parsers-and-ast/03-lazy-projection.md §2.
//
// The materialized path (`parse` → `runStreaming`) builds the ENTIRE normalized tree
// before analyzers run. The projection path instead asks the adapter for a `NodeProjector`
// that can (a) project a single raw node on demand and (b) iterate a raw node's children
// lazily. The engine keeps the visit dispatch + threaded scope derivation (the byte-level
// equivalence core) in `runStreamingProjected` (traverse.ts) and stays ts-free.
// ---------------------------------------------------------------------------

/**
 * Projection strategy derived once per file from the set of ENABLED streaming analyzers
 * (docs/02-parsers-and-ast/03-lazy-projection.md §2.2). Every boolean drives which
 * normalized fields the projector may skip constructing — a field with zero consumers is
 * never built on the fast path.
 */
export interface ProjectionPolicy {
    /** complexity enabled → function subtrees need branchWeight/children (Mode B re-walk). */
    needComplexity: boolean;
    /** constants enabled → literals need full projection (text/pos/isConstBound/tolerated). */
    needLiterals: boolean;
    /** complexity || large-file → functionLike/class/binding nodes need name. */
    needNames: boolean;
    /** complexity || constants → literals/functions/FunctionKeyword need positions. */
    needPositions: boolean;
    // NOTE: FileMetricCollector always runs → topLevel/exported are projected unconditionally
    // on top-level nodes (the engine cannot skip them).
    /**
     * Request declaration names/positions and call-site names for the cross-file symbol index.
     *
     * The projector is otherwise driven by which analyzers run; the index is a scan-wide product,
     * so it asks for its own facts instead of piggy-backing on an analyzer's policy.
     */
    needSymbols?: boolean;
}

/**
 * Language-agnostic "project-on-demand source". The engine only depends on these three
 * primitives, so traverse.ts never imports a concrete parser (keeps the oxc worker's
 * lazy-typescript benefit intact).
 */
export interface NodeProjector {
    /** Root raw node (the SourceFile). */
    readonly root: unknown;
    /**
     * Project one raw node into a NormalizedNode (one per visit; may return the shared
     * OTHER_PLACEHOLDER singleton). Signature matches mapNode(n, parentTs, grandparentTs, sf)
     * so the TypeScript projector reuses every existing predicate with identical inputs.
     * `parentRaw`/`grandparentRaw` are threaded from the engine's raw-ancestor stack.
     *
     * @param raw - Raw parser node to normalize; it must belong to this projector's tree.
     * @param parentRaw - Raw parent threaded by the engine, or `undefined` for the root.
     * @param grandparentRaw - Raw grandparent threaded by the engine, or `undefined` near the
     *   root; callers must preserve the engine's ancestry order for scope predicates.
     * @returns A normalized node, possibly the shared `OTHER_PLACEHOLDER` singleton when the raw
     *   node carries no consumer-observable field.
     */
    project(
        raw: unknown,
        parentRaw: unknown | undefined,
        grandparentRaw: unknown | undefined,
    ): NormalizedNode;
    /**
     * Iterate a raw node's children in materialized order (ts.forEachChild + the same
     * skip/flatten rules). Returns a lazy iterable for ordinary nodes; for Mode B function-like
     * nodes returns the already-materialized subtree children (shared with complexity's
     * re-walk — the engine and the re-walk see the SAME objects).
     *
     * @param raw - Raw parser node whose normalized children are requested.
     * @returns Raw children in materialized order; function-like Mode B nodes may reuse cached
     *   children so the engine and the complexity re-walk observe identical objects.
     */
    forEachChild(raw: unknown): Iterable<unknown>;
    /**
     * Whether `raw` is the source-file root (L/M detect top-level via parent.kind === SourceFile).
     *
     * @param raw - Raw parser node to test.
     * @returns `true` only for the projector's source-file root, never for a nested node.
     */
    isSourceFile(raw: unknown): boolean;
}

/**
 * Shared T0 placeholder — a frozen process-wide singleton (zero allocation per use).
 * Safe for every visit + engine scope derivation: missing flags read as falsy (matching
 * real non-scope nodes), kind is always `Other` so it can never be confused with the
 * SourceFile root or a literal/function/scope node.
 */
export const OTHER_PLACEHOLDER: NormalizedNode = Object.freeze({ kind: NodeKind.Other });

/**
 * Position + source text of a function subtree — the INC-Mode-1 reuse key
 * (docs/03-incremental-and-diff/01-line-level-incremental.md §3.3). Reuse requires the
 * function's START LINE and START COLUMN to be unchanged (its own byte interval is
 * untouched) AND its source text byte-identical; a line/column-stable function keeps every
 * embedded position stable even when a SAME-LINE edit elsewhere shifted its absolute byte
 * offset. Both adapters compute this from their native raw node.
 */
export interface ReusedSpan {
    startLine: number;
    startColumn: number;
    startByte: number;
    endByte: number;
    sourceText: string;
}

/**
 * Optional seed threaded into `LanguageAdapter.parse()` for line-level incremental
 * (docs/03-incremental-and-diff/01-line-level-incremental.md §3). When present, the
 * adapter may reuse a previously-materialized function subtree (`reuseSubtree`) instead of
 * re-projecting it, and must record every function subtree it builds (`cacheSubtree`) for
 * the NEXT scan. Absent ⇒ zero behavior change (full materialization, byte-identical to the
 * historical path).
 */
export interface ProjectionSeed {
    /**
     * INC-Mode-1 lookup: return the cached normalized children for a function whose byte span
     * + source text is unchanged, or null to build fresh.
     *
     * @param span - Byte span plus source text that identify the candidate function subtree.
     * @returns Cached normalized children on an exact span/text hit, otherwise `null` so the
     *   adapter builds the subtree from the raw parser node.
     */
    reuseSubtree(span: ReusedSpan): NormalizedNode[] | null;
    /**
     * Record a function's normalized children under its byte span for the next scan.
     *
     * @param span - Byte span plus source text that key the cached children.
     * @param children - Materialized normalized children of the function subtree.
     */
    cacheSubtree(span: ReusedSpan, children: NormalizedNode[]): void;
    /**
     * OPTIONAL analyzer-memo signal: the adapters call this right after `reuseSubtree` hits so
     * the per-file state can record `node` as a reused function (and collect its literal nodes)
     * for complexity/constants result reuse. Absent ⇒ memo is simply not seeded (full rescan).
     *
     * @param node - Normalized function node whose subtree was reused.
     * @param span - Byte span under which the subtree was reused.
     */
    markReused?(node: NormalizedNode, span: ReusedSpan): void;
}

/**
 * Contract every language adapter implements. Adapters are stateless between files
 * (parse materializes everything into the normalized tree), so a single instance can be
 * shared across concurrently scanned files — including inside worker threads.
 */
export interface LanguageAdapter {
    /** Unique id, used for the registry / config keys. */
    id: string;
    /** File extensions this adapter claims (lowercase, leading dot). */
    extensions: string[];
    /**
     * Parse source content into a normalized AST. An optional `seed` enables function-subtree
     * reuse (line-level incremental); omitted ⇒ full materialization (default, byte-identical).
     *
     * @param content - Full source text of the file to parse.
     * @param filePath - Path used for adapter-specific language detection and diagnostics.
     * @param seed - Optional incremental projection seed; absent means all subtrees are built
     *   fresh and no cache callbacks fire.
     * @returns Normalized AST whose root is the source-file node.
     */
    parse(content: string, filePath: string, seed?: ProjectionSeed): NormalizedAst;
    /**
     * Optional fast path: build a lazy-projection source for a file (no normalized tree).
     * Return null when the fast path cannot apply for this file/parser. Called by the
     * routing gate ONLY when: AR_FASTPATH=1, no legacy analyzers, and every enabled
     * streaming analyzer is in FAST_PATH_ANALYZERS. A throwing implementation is caught
     * by the caller, which falls back to parse()+runStreaming() (never crashes).
     *
     * @param content - Full source text of the file to project lazily.
     * @param filePath - Path used for adapter-specific language detection.
     * @param policy - Projection policy describing which normalized fields the analyzers need.
     * @returns A lazy projector, or `null` when this parser cannot serve the fast path and the
     *   caller must fall back to `parse` plus streaming traversal.
     */
    project?(content: string, filePath: string, policy: ProjectionPolicy): NodeProjector | null;
    /**
     * Return the root node of a parsed AST.
     *
     * @param ast - Normalized AST returned by `parse`.
     * @returns The source-file node at the top of the normalized tree.
     */
    root(ast: NormalizedAst): NormalizedNode;
    /**
     * Return the node's children (engine iterates these during the single descent).
     *
     * @param node - Normalized node whose direct children are requested.
     * @returns Direct normalized children in source order; leaf nodes yield an empty array.
     */
    children(node: NormalizedNode): NormalizedNode[];
    /**
     * NOTE: the old `childScope(node, className, binding)` interface method was removed.
     * Both built-in adapters implemented it with byte-identical rules based on the
     * normalized flags, so the engine now inlines the derivation (traverse.ts visitNode)
     * with zero per-node object allocation. Language-specific scope behavior is expressed
     * through the normalized flags alone (`isClassDefining` / `functionLike` /
     * `introducesBinding` / `bindingName`).
     */
}
