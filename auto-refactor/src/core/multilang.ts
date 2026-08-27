/**
 * Multi-language normalization layer.
 *
 * The engine's single-pass multiplexed traversal is language-agnostic: analyzers face a
 * uniform `NormalizedNode` (kind / text / positions / semantic flags) instead of `ts.Xxx`
 * nodes. A `LanguageAdapter` is the only place that knows a concrete parser (TypeScript,
 * tree-sitter-rust, ...) — it produces the normalized tree and answers the question the
 * engine needs while descending: "what are this node's children".
 *
 * Design note vs. docs/multilang-architecture.md: the original draft proposed
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
  Function = 'Function', // 自由函数 / fn / 箭头函数 / 闭包
  Method = 'Method', // 结构体/impl/trait/class 内的方法
  Struct = 'Struct',
  Class = 'Class',
  Impl = 'Impl', // Rust impl / TS 类实现块
  Trait = 'Trait', // Rust trait / TS interface(行为)
  Interface = 'Interface',
  Variable = 'Variable', // let / var
  Constant = 'Constant', // const
  Field = 'Field', // 结构体字段 / 类字段
  NumericLiteral = 'NumericLiteral',
  StringLiteral = 'StringLiteral',
  Literal = 'Literal', // 泛型字面量（无子类型时）
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
   * Optional (P2-1): the ONLY consumer is complexity.ts locating findings at the bare
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

export interface NormalizedAst {
  root: NormalizedNode;
}

// ---------------------------------------------------------------------------
// P1-1: lazy projection (fast path) — see docs/p1-1-design.md §2.
//
// The materialized path (`parse` → `runStreaming`) builds the ENTIRE normalized tree
// before analyzers run. The projection path instead asks the adapter for a `NodeProjector`
// that can (a) project a single raw node on demand and (b) iterate a raw node's children
// lazily. The engine keeps the visit dispatch + threaded scope derivation (the byte-level
// equivalence core) in `runStreamingProjected` (traverse.ts) and stays ts-free.
// ---------------------------------------------------------------------------

/**
 * Projection strategy derived once per file from the set of ENABLED streaming analyzers
 * (docs/p1-1-design.md §2.2). Every boolean drives which normalized fields the projector may
 * skip constructing — a field with zero consumers is never built on the fast path.
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
   */
  project(
    raw: unknown,
    parentRaw: unknown | undefined,
    grandparentRaw: unknown | undefined,
  ): NormalizedNode;
  /**
   * Iterate a raw node's children in materialized order (ts.forEachChild + the same
   * skip/展平 rules). Returns a lazy iterable for ordinary nodes; for Mode B function-like
   * nodes returns the already-materialized subtree children (shared with complexity's
   * re-walk — the engine and the re-walk see the SAME objects).
   */
  forEachChild(raw: unknown): Iterable<unknown>;
  /** Whether `raw` is the source-file root (L/M detect top-level via parent.kind === SourceFile). */
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
 * (docs/system-design.md §3.3). Reuse requires the function's START LINE and START COLUMN
 * to be unchanged (its own byte interval is untouched) AND its source text byte-identical;
 * a line/column-stable function keeps every embedded position stable even when a SAME-LINE
 * edit elsewhere shifted its absolute byte offset. Both adapters compute this from their
 * native raw node.
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
 * (docs/system-design.md §3). When present, the adapter may reuse a previously-materialized
 * function subtree (`reuseSubtree`) instead of re-projecting it, and must record every
 * function subtree it builds (`cacheSubtree`) for the NEXT scan. Absent ⇒ zero behavior
 * change (full materialization, byte-identical to the historical path).
 */
export interface ProjectionSeed {
  /**
   * INC-Mode-1 lookup: return the cached normalized children for a function whose byte span
   * + source text is unchanged, or null to build fresh.
   */
  reuseSubtree(span: ReusedSpan): NormalizedNode[] | null;
  /** Record a function's normalized children under its byte span for the next scan. */
  cacheSubtree(span: ReusedSpan, children: NormalizedNode[]): void;
  /**
   * OPTIONAL analyzer-memo signal: the adapters call this right after `reuseSubtree` hits so
   * the per-file state can record `node` as a reused function (and collect its literal nodes)
   * for complexity/constants result reuse. Absent ⇒ memo is simply not seeded (full rescan).
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
   */
  parse(content: string, filePath: string, seed?: ProjectionSeed): NormalizedAst;
  /**
   * P1-1 OPTIONAL: build a lazy-projection source for a file (no normalized tree).
   * Return null when the fast path cannot apply for this file/parser. Called by the
   * routing gate ONLY when: AR_FASTPATH=1, no legacy analyzers, and every enabled
   * streaming analyzer is in FAST_PATH_ANALYZERS. A throwing implementation is caught
   * by the caller, which falls back to parse()+runStreaming() (never crashes).
   */
  project?(content: string, filePath: string, policy: ProjectionPolicy): NodeProjector | null;
  /** Return the root node of a parsed AST. */
  root(ast: NormalizedAst): NormalizedNode;
  /** Return the node's children (engine iterates these during the single descent). */
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
