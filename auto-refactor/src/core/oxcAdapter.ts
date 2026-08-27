import {
  NodeKind,
  NormalizedNode,
  NormalizedAst,
  Position,
  LanguageAdapter,
  NodeProjector,
  ProjectionPolicy,
  ProjectionSeed,
  ReusedSpan,
  OTHER_PLACEHOLDER,
} from './multilang';

/**
 * OxcAdapter — TypeScript/JavaScript parsing via the Rust `oxc-parser` engine.
 *
 * Replaces `ts.createSourceFile` with `oxc.parseSync` while producing the SAME
 * `NormalizedNode` tree contract the TypeScriptAdapter produces, so the engine and
 * analyzers (which only consume normalized semantic flags) are byte-equivalent.
 *
 * The mapping/compensation rules below are the verified plan from docs/02-parsers-and-ast/02-oxc-fastpath.md §5
 * (POC: 18/18 engine-level byte compares PASS against the TypeScriptAdapter):
 *   §5.1  parseSync entry (lang by extension, sourceType 'unambiguous', preserveParens)
 *   §5.2  kindOf mapping table (Logical/Assignment -> BinaryExpr, no-sub template ->
 *         StringLiteral, interpolated template -> Other, Literal by typeof value)
 *   §5.3  structural/flag compensations 1-11 (export-wrapper flatten, method value
 *         inlining, introducesBinding 4 cases, isConstBound, exact tolerated predicates,
 *         SwitchCase default branchWeight 0, increasesNesting set, topLevel/exported,
 *         text rules, name rules)
 *   §5.4  reflection-based child traversal (skip identifiers/type nodes after collecting
 *         literals that live inside type positions, e.g. `type X = 5`)
 *
 * P1-1 (T04): lazy projection. `project()` builds an `OxcProjector` (no normalized tree)
 * that reuses the SAME module-level predicates as the materializing mapNode — kindOf /
 * branchWeightOf / introducesBinding / bindingNameOf / nameOf / posOf / isConstBoundOf /
 * isToleratedOf (zero reimplementation). `forEachChild` turns every compensation rule into
 * raw-child yielding: export flattening (Named/Default -> declaration + __exportStart
 * offset; All -> wrapper + its source literal), method value inlining, TYPE_SKIP literal
 * collection (via raw type-subtree descent so the literal's raw parent is a type node and
 * isToleratedOf computes identically to TS), TSEnumBody flattening, StaticBlock
 * increasesNesting, decorator argument descent.
 *
 * NOTE on loading oxc-parser: the package is ESM-only ("type":"module"). On Node
 * >= 22.12 (this project's runtime) `require(esm)` loads it synchronously. The import
 * is intentionally LAZY (inside parse) so the default `parser:'typescript'` path never
 * touches the native binding unless oxc is actually selected.
 */

/** Loose structural view of an oxc ESTree-style node (reflection traversal). */
interface OxcNode {
  type: string;
  /** UTF-16 code-unit offsets — identical to JS string indices and TS offsets. */
  start: number;
  end: number;
  [key: string]: any;
}

interface OxcParseResult {
  program: OxcNode;
  comments: unknown[];
  errors: unknown[];
}

type ParseSyncFn = (
  filename: string,
  sourceText: string,
  options?: {
    lang?: 'js' | 'jsx' | 'ts' | 'tsx' | 'dts';
    sourceType?: 'script' | 'module' | 'commonjs' | 'unambiguous';
    astType?: 'js' | 'ts';
    preserveParens?: boolean;
  },
) => OxcParseResult;

/** Mirrors the old CONTROL_OR_BLOCK set (depth increment; NOT SwitchCase/CatchClause). */
const CONTROL_OR_BLOCK = new Set([
  'BlockStatement',
  'IfStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchStatement',
  'TryStatement',
]);

/** Mirrors the old isTopLevelDecl set (oxc type names). */
const TOP_LEVEL_DECL = new Set([
  'FunctionDeclaration',
  'ClassDeclaration',
  'TSInterfaceDeclaration',
  'TSEnumDeclaration',
  'TSTypeAliasDeclaration',
  'TSModuleDeclaration',
  'TSDeclareFunction',
  'VariableDeclaration',
]);

/** Function-like unit boundaries (independent functions / arrows / closures). */
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/**
 * Nodes with no semantic value for the analyzers, skipped WITHOUT descending:
 * identifiers, template elements, hashbang, JSX text, and TS *statement* wrappers that
 * the TS adapter would not surface in a way that affects output (import equals, abstract
 * members, ...). Type-position nodes are NOT here — they are handled by TYPE_SKIP_TYPES
 * (literals inside them must still materialize).
 *
 * §2.8 Known Divergences: `StaticBlock` and `TSParameterProperty` are intentionally NOT
 * in this set — the TS adapter materializes their inner literals/functions (static-block
 * body children, parameter default-value literals), so oxc must descend into them too.
 *
 * NOTE: expression-wrapper nodes (TSAsExpression `x as T`, TSTypeAssertion `<T>x`,
 * TSNonNullExpression `x!`, TSSatisfiesExpression `x satisfies T`, TSInstantiationExpression
 * `f<T>()`) and Decorator are intentionally NOT in this set: they carry real expression
 * children whose literals TS materializes (e.g. `100 as any` reports a magic number,
 * `@factory(42)` reports 42). The reflection descent maps the wrapper to an Other node and
 * descends into `expression`; the type side is handled by TYPE_SKIP_TYPES.
 */
const SKIP_TYPES = new Set([
  'Identifier',
  'TemplateElement',
  'PrivateIdentifier',
  'Hashbang',
  'JSXIdentifier',
  'JSXText',
  'JSXNamespacedName',
  'JSXMemberExpression',
  'JSXOpeningFragment',
  'JSXClosingFragment',
  'JSXSpreadAttribute',
  'JSXSpreadChild',
  'ImportAttribute',
  'Super',
  'MetaProperty',
  // TS statement/expression wrappers (kept out of the tree — output-equivalent to the
  // TypeScriptAdapter's materialization for every analyzer/engine consumer).
  'TSImportEqualsDeclaration',
  'TSNamespaceExportDeclaration',
  'TSExportAssignment',
  'TSEmptyBodyFunctionExpression',
  'TSAbstractMethodDefinition',
  'TSAbstractPropertyDefinition',
  'TSAbstractAccessorProperty',
  'AccessorProperty',
]);

/**
 * TS *type-position* nodes: the node itself is not materialized (matching the TS adapter's
 * skippable-token semantics for keyword types), but any `Literal` inside it IS materialized
 * with tolerated=true — the TypeScript adapter materializes literals in type positions
 * (`type X = 5`, `const y: 42 = 42`), and tolerated literals still join duplicate-literal
 * grouping, so collecting them is required for byte-equivalence.
 */
const TYPE_SKIP_TYPES = new Set([
  'TSTypeAnnotation',
  'TSTypeReference',
  'TSNumberKeyword',
  'TSStringKeyword',
  'TSBooleanKeyword',
  'TSAnyKeyword',
  'TSUnknownKeyword',
  'TSNullKeyword',
  'TSUndefinedKeyword',
  'TSVoidKeyword',
  'TSNeverKeyword',
  'TSObjectKeyword',
  'TSBigIntKeyword',
  'TSIntrinsicKeyword',
  'TSSymbolKeyword',
  'TSThisType',
  'TSLiteralType',
  'TSUnionType',
  'TSIntersectionType',
  'TSArrayType',
  'TSTupleType',
  'TSOptionalType',
  'TSRestType',
  'TSTypeOperator',
  'TSIndexedAccessType',
  'TSConditionalType',
  'TSInferType',
  'TSMappedType',
  'TSNamedTupleMember',
  'TSTemplateLiteralType',
  'TSConstructorType',
  'TSFunctionType',
  'TSImportType',
  'TSQualifiedName',
  'TSTypeQuery',
  'TSTypePredicate',
  'TSParenthesizedType',
  'TSJSDocNullableType',
  'TSJSDocNonNullableType',
  'TSJSDocUnknownType',
  'TSTypeParameter',
  'TSTypeParameterDeclaration',
  'TSTypeParameterInstantiation',
  'TSPropertySignature',
  'TSMethodSignature',
  'TSCallSignatureDeclaration',
  'TSConstructSignatureDeclaration',
  'TSIndexSignature',
  'TSInterfaceBody',
  'TSInterfaceHeritage',
  'TSClassImplements',
  'TSExternalModuleReference',
]);

/** Parse context threaded through one file's mapping (adapter stays stateless between files). */
interface Ctx {
  src: string;
  lineStarts: number[];
}

// oxc-parser is ESM-only; load lazily so the default TypeScript path never requires it.
let _parseSync: ParseSyncFn | null = null;

function parseSyncSafe(
  filename: string,
  sourceText: string,
  options: Parameters<ParseSyncFn>[2],
): OxcParseResult {
  if (!_parseSync) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('oxc-parser') as { parseSync: ParseSyncFn };
    _parseSync = mod.parseSync;
  }
  return _parseSync(filename, sourceText, options);
}

/** §4: build the line-start table (\n -> next line start) used for 1-based positions. */
function computeLineStarts(content: string): number[] {
  const lineStarts: number[] = [];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) lineStarts.push(i + 1);
  }
  return lineStarts;
}

// ---------------------------------------------------------------------------
// Module-level predicates — the SINGLE implementation shared by the materializing
// mapNode (via the OxcAdapter private delegates below) and the lazy OxcProjector
// (docs/02-parsers-and-ast/03-lazy-projection.md §7: predicates are reused as-is, never rewritten).
// ---------------------------------------------------------------------------

/** §5.2 kindOf mapping table. */
function oxcKindOf(n: OxcNode): NodeKind {
  switch (n.type) {
    case 'Program':
      return NodeKind.SourceFile;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'TSDeclareFunction': // `declare function f(): void` — TS sees a FunctionDeclaration
      return NodeKind.Function;
    case 'MethodDefinition':
    case 'Property': // object method shorthand m() {} -> TS MethodDeclaration
      if (n.type === 'Property' && n.method !== true) return NodeKind.Other;
      return NodeKind.Method;
    case 'ClassDeclaration':
    case 'ClassExpression':
      return NodeKind.Class;
    case 'TSInterfaceDeclaration':
      return NodeKind.Interface;
    case 'VariableDeclaration':
      return NodeKind.Variable;
    case 'Literal':
      if (typeof n.value === 'number') return NodeKind.NumericLiteral;
      if (typeof n.value === 'string') return NodeKind.StringLiteral;
      return NodeKind.Other; // bigint / regex / null — matches TS BigIntLiteral -> Other
    case 'TemplateLiteral':
      return (n.expressions || []).length === 0 ? NodeKind.StringLiteral : NodeKind.Other;
    case 'CallExpression':
    case 'NewExpression':
      return NodeKind.Call;
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'AssignmentExpression': // && / || / ?? / = all collapse to BinaryExpr (TS parity)
      return NodeKind.BinaryExpr;
    case 'IfStatement':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'SwitchStatement':
    case 'SwitchCase':
    case 'CatchClause':
    case 'TryStatement':
      return NodeKind.ControlFlow;
    case 'BlockStatement':
      return NodeKind.Block;
    default:
      return NodeKind.Other;
  }
}

/** §5.3.7: cyclomatic decision-point weight (SwitchCase default -> 0). */
function oxcBranchWeightOf(n: OxcNode): number {
  switch (n.type) {
    case 'IfStatement':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'SwitchStatement':
    case 'CatchClause':
    case 'ConditionalExpression':
      return 1;
    case 'SwitchCase':
      // TS DefaultClause (no test) carries branchWeight 0; real `case x:` = 1
      return n.test ? 1 : 0;
    case 'BinaryExpression':
    case 'LogicalExpression': {
      const op = n.operator;
      if (op === '&&' || op === '||' || op === '??') return 1;
      return 0;
    }
    default:
      return 0;
  }
}

/** §5.3.4: the four binding-source cases (init/right is function-like). */
function oxcIntroducesBinding(n: OxcNode): boolean {
  if (n.type === 'VariableDeclarator' && n.init && isFnLikeType(n.init.type)) return true;
  if (n.type === 'Property' && !n.method && isFnLikeType(n.value && n.value.type)) return true;
  if (n.type === 'PropertyDefinition' && n.value && isFnLikeType(n.value.type)) return true;
  if (n.type === 'AssignmentExpression' && n.operator === '=' && isFnLikeType(n.right && n.right.type)) return true;
  return false;
}

/** §5.3.11: binding names (id.name / key text / left MemberExpression property). */
function oxcBindingNameOf(n: OxcNode, ctx: Ctx): string | null {
  if (n.type === 'VariableDeclarator') {
    return n.id && typeof n.id.name === 'string' ? n.id.name : null;
  }
  if (n.type === 'Property' || n.type === 'PropertyDefinition') {
    return n.key ? oxcKeyText(n.key, ctx) : null;
  }
  if (n.type === 'AssignmentExpression') {
    // TS uses the FULL left-hand-side text as the binding name ("exports.handler",
    // "obj.run", "x" for identifiers) — `getText` of the whole left node.
    if (n.left && (n.left.type === 'MemberExpression' || n.left.type === 'Identifier')) {
      return ctx.src.slice(n.left.start, n.left.end);
    }
    return null;
  }
  return null;
}

/** §5.3.11: display names (function/class id.name, method key text). */
function oxcNameOf(n: OxcNode, ctx: Ctx): string | null {
  if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'TSDeclareFunction') {
    return n.id && typeof n.id.name === 'string' ? n.id.name : null;
  }
  if (n.type === 'ArrowFunctionExpression') return null;
  if (n.type === 'MethodDefinition' || (n.type === 'Property' && n.method === true)) {
    return n.key ? oxcKeyText(n.key, ctx) : null;
  }
  if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') {
    return n.id && typeof n.id.name === 'string' ? n.id.name : null;
  }
  return null;
}

function oxcKeyText(key: OxcNode, ctx: Ctx): string {
  if (typeof key.name === 'string' && key.name.length > 0) return key.name;
  return ctx.src.slice(key.start, key.end);
}

/** §5.3.5: isConstBound — const declarator init or enum member. */
function oxcIsConstBoundOf(
  node: OxcNode,
  parent: OxcNode | undefined,
  grandparent: OxcNode | undefined,
): boolean {
  if (
    parent &&
    parent.type === 'VariableDeclarator' &&
    parent.init === node &&
    grandparent &&
    grandparent.type === 'VariableDeclaration' &&
    grandparent.kind === 'const'
  ) {
    return true;
  }
  if (parent && parent.type === 'TSEnumMember') return true;
  return false;
}

function oxcIsTypeNodeType(t: string): boolean {
  return (
    TYPE_SKIP_TYPES.has(t) ||
    t === 'TSLiteralType' ||
    t === 'TSTypeReference' ||
    t === 'TSTypeAnnotation'
  );
}

/** §5.3.6: exact tolerated-context predicates (numeric + string). */
function oxcIsToleratedOf(node: OxcNode, p: OxcNode | undefined, ctx: Ctx): boolean {
  if (!p) return false;
  const isNumeric = typeof node.value === 'number';
  if (isNumeric) {
    if (p.type === 'MemberExpression' && p.computed) return true;
    if (p.type === 'MemberExpression') return true;
    if (p.type === 'Property' && p.key === node) return true;
    if (p.type === 'TSEnumMember') return true;
    if (oxcIsTypeNodeType(p.type)) return true;
    if (p.type === 'SwitchCase' && p.test === node) return true;
    return false;
  }
  // string tolerations
  if (p.type === 'ImportDeclaration' || p.type === 'TSImportEqualsDeclaration') return true;
  if (p.type === 'Property' && p.key === node) return true;
  if (p.type === 'MemberExpression' && !p.computed) return true;
  if (p.type === 'JSXAttribute' && p.name === node) return true;
  if (p.type === 'JSXElement' || p.type === 'JSXOpeningElement') return false;
  // i18n: t('...'), i18n.t('...'), translate('...')
  if (p.type === 'CallExpression' && Array.isArray(p.arguments) && p.arguments.includes(node)) {
    const callee = p.callee ? ctx.src.slice(p.callee.start, p.callee.end) : '';
    if (/\b(t|i18n\.\w*|translate|fmt|formatMessage)\s*$/.test(callee)) return true;
  }
  return false;
}

/** Function-like unit boundary for the projection subtree (methods included). */
function oxcIsFnLikeNode(n: OxcNode): boolean {
  const kind = oxcKindOf(n);
  return kind === NodeKind.Function || kind === NodeKind.Method;
}

/** §4: 1-based line/column from a UTF-16 offset (binary search over line starts). */
function oxcPosOf(off: number, ctx: Ctx): Position {
  const ls = ctx.lineStarts;
  let lo = -1;
  let hi = ls.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ls[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 2, column: off - (lo >= 0 ? ls[lo] : 0) + 1 };
}

/** §5.3.10: Literal text via `raw`; no-interpolation TemplateLiteral via span slice. */
function oxcLiteralText(n: OxcNode, ctx: Ctx): string {
  if (n.type === 'TemplateLiteral') return ctx.src.slice(n.start, n.end);
  return n.raw != null ? String(n.raw) : ctx.src.slice(n.start, n.end);
}

function isFnLikeType(t: string | undefined): boolean {
  return !!t && FN_TYPES.has(t);
}

export class OxcAdapter implements LanguageAdapter {
  id = 'oxc' as const;
  extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

  parse(content: string, filePath: string, seed?: ProjectionSeed): NormalizedAst {
    // §2.8 Known Divergence (.d.ts): the default `**/*.ts` include glob matches `.d.ts`
    // files, so route them to oxc's dedicated `dts` language mode (TS parses them as
    // ScriptKind.TS). Must be checked BEFORE the generic `.ts` suffix test.
    const lang = filePath.endsWith('.d.ts')
      ? 'dts'
      : /\.tsx$/i.test(filePath)
        ? 'tsx'
        : /\.ts$/i.test(filePath)
          ? 'ts'
          : /\.jsx$/i.test(filePath)
            ? 'jsx'
            : 'js';
    const res = parseSyncSafe(filePath, content, {
      lang,
      sourceType: 'unambiguous', // aligns with TS createSourceFile auto module/script detection
      preserveParens: true, // must stay default: ParenthesizedExpression matches TS tree
    });
    // res.errors is intentionally ignored — the pipeline never consumed TS parseDiagnostics
    // either (parse always yields an AST, matching createSourceFile's behavior).
    const ctx: Ctx = { src: content, lineStarts: computeLineStarts(content) };
    const program = res.program;
    const root = this.mapNode(program, undefined, undefined, undefined, ctx, seed);
    // Top-level: flatten export wrappers so an export never materializes as a node
    // (otherwise maxNestingDepth would be off by one vs the TS tree).
    const children: NormalizedNode[] = [];
    for (const stmt of program.body || []) {
      const mapped = this.mapTopStatement(stmt, program, ctx, seed);
      if (mapped) children.push(mapped);
    }
    root.children = children;
    return { root };
  }

  /**
   * P1-1 (T04): build a lazy-projection source for a file. Parses ONCE with oxc (the ESTree
   * deserialization cannot be skipped) but does NOT materialize the normalized tree — the
   * OxcProjector projects nodes on demand and yields raw children lazily.
   */
  project(content: string, filePath: string, policy: ProjectionPolicy): NodeProjector | null {
    const lang = filePath.endsWith('.d.ts')
      ? 'dts'
      : /\.tsx$/i.test(filePath)
        ? 'tsx'
        : /\.ts$/i.test(filePath)
          ? 'ts'
          : /\.jsx$/i.test(filePath)
            ? 'jsx'
            : 'js';
    const res = parseSyncSafe(filePath, content, {
      lang,
      sourceType: 'unambiguous',
      preserveParens: true,
    });
    return new OxcProjector(res.program, content, policy);
  }

  root(ast: NormalizedAst): NormalizedNode {
    return ast.root;
  }

  children(node: NormalizedNode): NormalizedNode[] {
    return node.children || [];
  }

  // ------------------------------------------------------------------ mapping

  private mapTopStatement(
    stmt: OxcNode,
    program: OxcNode,
    ctx: Ctx,
    seed?: ProjectionSeed,
  ): NormalizedNode | null {
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) {
      stmt.declaration.__exported = true;
      return this.mapNode(stmt.declaration, program, undefined, stmt, ctx, seed);
    }
    if (stmt.type === 'ExportDefaultDeclaration') {
      stmt.declaration.__exported = true;
      return this.mapNode(stmt.declaration, program, undefined, stmt, ctx, seed);
    }
    if (stmt.type === 'ExportAllDeclaration') {
      // §2.8 Known Divergence (`export * from './mod'`): TS materializes the
      // ExportDeclaration (Other) and descends into the moduleSpecifier StringLiteral.
      // The literal is NOT tolerated (ExportDeclaration is absent from TS's string
      // tolerated-context list) → it reports hardcoded-string. Materialize the wrapper +
      // its source so oxc matches TS exactly (previously the whole node was skipped).
      return this.mapNode(stmt, program, undefined, undefined, ctx, seed);
    }
    return this.mapNode(stmt, program, undefined, undefined, ctx, seed);
  }

  private mapNode(
    n: OxcNode,
    parent: OxcNode | undefined,
    grandparent: OxcNode | undefined,
    exportWrapper: OxcNode | undefined,
    ctx: Ctx,
    seed?: ProjectionSeed,
  ): NormalizedNode {
    const t = n.type;
    const isMethodSource = t === 'MethodDefinition' || (t === 'Property' && n.method === true);
    const kind = oxcKindOf(n);
    const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
    const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
    const isClassDefining = t === 'ClassDeclaration' || t === 'ClassExpression';
    const isBinding = oxcIntroducesBinding(n);
    // P0-1: positions are only materialized for nodes that can appear in an Issue
    // (literals and function-like units). Everything else skips the conversions.
    const needsPos = isLiteral || fnLike;
    // P0-4: names only for the classes the analyzers/engine consume.
    const needsName = fnLike || isClassDefining || isBinding;

    // §3.2: an export-wrapped function/class must point at the wrapper's start (the
    // `export` keyword) to match TS getStart() which includes modifiers.
    let startOff = n.start;
    const endOff = n.end;
    if ((fnLike || isClassDefining) && n.__exported && exportWrapper) {
      startOff = exportWrapper.start;
    }

    const node: NormalizedNode = {
      kind,
      rawKind: t,
      text: isLiteral ? oxcLiteralText(n, ctx) : undefined,
      start: needsPos ? oxcPosOf(startOff, ctx) : undefined,
      end: needsPos ? oxcPosOf(endOff, ctx) : undefined,
      name: needsName ? oxcNameOf(n, ctx) : undefined,
      isNumeric: kind === NodeKind.NumericLiteral,
      isString: kind === NodeKind.StringLiteral,
      branchWeight: oxcBranchWeightOf(n),
      functionLike: fnLike,
      isClassDefining,
      introducesBinding: isBinding,
      bindingName: isBinding ? oxcBindingNameOf(n, ctx) : null,
      hasFunctionInitializer: isBinding,
      // §2.8 Known Divergence (StaticBlock): the TS tree wraps the static body in a
      // `Block` (which IS in CONTROL_OR_BLOCK), so the body statements sit one nesting
      // level deeper than the class members. oxc's StaticBlock exposes the statements
      // directly (no BlockStatement wrapper), so flag the node itself to replicate the
      // Block's depth increment — matching TS maxNestingDepth byte-for-byte.
      increasesNesting: CONTROL_OR_BLOCK.has(t) || t === 'StaticBlock',
      isConstructor: t === 'MethodDefinition' && n.kind === 'constructor',
      children: [],
    };

    const topLevel = !!parent && parent.type === 'Program' && TOP_LEVEL_DECL.has(t);
    node.topLevel = topLevel;
    node.exported = topLevel && (!!n.__exported || t === 'TSExportAssignment');

    if (isLiteral) {
      node.isConstBound = oxcIsConstBoundOf(n, parent, grandparent);
      node.tolerated = oxcIsToleratedOf(n, parent, ctx);
    }

    // P2-5 (INC-Mode-1): reuse a previously-materialized function subtree when its byte span
    // + source text are unchanged, skipping the reflection walk + allocation below.
    let span: ReusedSpan | undefined;
    if (seed && fnLike) {
      const startPos = oxcPosOf(n.start, ctx);
      span = {
        startLine: startPos.line,
        startColumn: startPos.column,
        startByte: n.start,
        endByte: n.end,
        sourceText: ctx.src.slice(n.start, n.end),
      };
      const reused = seed.reuseSubtree(span);
      if (reused) {
        node.children = reused;
        seed.cacheSubtree(span, reused);
        if (seed.markReused) seed.markReused(node, span);
        return node;
      }
    }

    // §5.4: reflection-based child traversal (objects/arrays whose entries are nodes).
    for (const key of Object.keys(n)) {
      if (key === 'parent' || key === 'type' || key === 'start' || key === 'end' || key === '__exported') continue;
      const v = n[key];
      if (v == null) continue;
      if (Array.isArray(v)) {
        for (const item of v) this.pushChild(node, item, n, parent, isMethodSource, ctx, seed);
      } else if (typeof v === 'object' && typeof (v as OxcNode).type === 'string') {
        this.pushChild(node, v as OxcNode, n, parent, isMethodSource, ctx, seed);
      }
    }
    if (seed && span) seed.cacheSubtree(span, node.children || []);
    return node;
  }

  private pushChild(
    node: NormalizedNode,
    item: OxcNode | null | undefined,
    oxcParent: OxcNode,
    oxcGrandparent: OxcNode | undefined,
    inlineFnValue: boolean,
    ctx: Ctx,
    seed?: ProjectionSeed,
  ): void {
    if (item == null) return;
    // §3.4: a method's `value: FunctionExpression` is inlined — the TS tree has no nested
    // FunctionExpression for methods (params/body are direct children of the method).
    if (inlineFnValue && item.type === 'FunctionExpression') {
      for (const key of Object.keys(item)) {
        if (key === 'parent' || key === 'type' || key === 'start' || key === 'end') continue;
        const v = item[key];
        if (v == null) continue;
        if (Array.isArray(v)) {
          for (const sub of v) this.pushChild(node, sub, item, oxcParent, false, ctx, seed);
        } else if (typeof v === 'object' && typeof (v as OxcNode).type === 'string') {
          this.pushChild(node, v as OxcNode, item, oxcParent, false, ctx, seed);
        }
      }
      return;
    }
    // Type-position nodes: materialize inner literals (tolerated), skip the type itself.
    if (TYPE_SKIP_TYPES.has(item.type)) {
      this.collectLiteralsInType(item, node, ctx);
      return;
    }
    if (SKIP_TYPES.has(item.type)) return;
    // Nested export wrappers (e.g. inside namespace bodies): flatten like the top level.
    // The wrapper is passed through so a directly-wrapped function/class points its start
    // at the `export` keyword (TS getStart includes modifiers).
    if (item.type === 'ExportAllDeclaration') {
      // §2.8 Known Divergence: a nested `export * from './mod'` — TS descends into the
      // moduleSpecifier StringLiteral too (tolerated=false → hardcoded-string).
      if (item.source) {
        node.children!.push(this.mapNode(item.source, oxcParent, oxcGrandparent, item, ctx, seed));
      }
      return;
    }
    if (
      item.type === 'ExportNamedDeclaration' ||
      item.type === 'ExportDefaultDeclaration'
    ) {
      if (item.declaration) {
        item.declaration.__exported = true;
        node.children!.push(this.mapNode(item.declaration, oxcParent, oxcGrandparent, item, ctx, seed));
      }
      return;
    }
    // TSEnumBody: members become direct children (TS EnumDeclaration has no body wrapper).
    if (item.type === 'TSEnumBody') {
      for (const m of item.members || []) this.pushChild(node, m, oxcParent, oxcGrandparent, false, ctx, seed);
      return;
    }
    const child = this.mapNode(item, oxcParent, oxcGrandparent, undefined, ctx, seed);
    node.children!.push(child);
  }

  /**
   * Materialize Literal descendants of a type node, matching the TypeScript adapter's
   * tolerated rules EXACTLY:
   *   - numeric literals  -> tolerated=true  (TS isToleratedNumericContext has a
   *     `ts.isTypeNode(parent)` branch)
   *   - string literals   -> tolerated=false (TS isToleratedStringContext has NO
   *     isTypeNode branch -> `type Role = 'admin' | ...` still reports hardcoded-string)
   */
  private collectLiteralsInType(typeNode: OxcNode, container: NormalizedNode, ctx: Ctx): void {
    const stack: OxcNode[] = [typeNode];
    while (stack.length) {
      const cur = stack.pop();
      if (cur == null) continue;
      if (cur.type === 'Literal') {
        const kind =
          typeof cur.value === 'string'
            ? NodeKind.StringLiteral
            : typeof cur.value === 'number'
              ? NodeKind.NumericLiteral
              : NodeKind.Other;
        if (kind !== NodeKind.Other) {
          container.children!.push({
            kind,
            rawKind: 'Literal',
            text: oxcLiteralText(cur, ctx),
            start: oxcPosOf(cur.start, ctx),
            end: oxcPosOf(cur.end, ctx),
            isNumeric: kind === NodeKind.NumericLiteral,
            isString: kind === NodeKind.StringLiteral,
            branchWeight: 0,
            isConstBound: false,
            tolerated: kind === NodeKind.NumericLiteral,
            children: [],
          });
        }
        continue;
      }
      const children: OxcNode[] = [];
      for (const k of Object.keys(cur)) {
        if (k === 'parent' || k === 'type' || k === 'start' || k === 'end') continue;
        const v = cur[k];
        if (v == null) continue;
        if (Array.isArray(v)) {
          for (const x of v) if (x && typeof x === 'object') children.push(x as OxcNode);
        } else if (typeof v === 'object') {
          children.push(v as OxcNode);
        }
      }
      // Push in reverse so the LIFO stack pops them in source order — TS forEachChild
      // visits literals left-to-right, and same-line findings must keep that order.
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }
}

// ---------------------------------------------------------------------------
// P1-1 (T04): oxc lazy projector (Mode A + Mode B). See docs/02-parsers-and-ast/03-lazy-projection.md §2.7.
//
// The materialized path's reflection `pushChild` turns every compensation rule into a
// "push a normalized child" branch; here the SAME rules are expressed as "yield a raw
// child" so the engine's descent (runStreamingProjected) sees the identical raw sequence
// and per-node parent/grandparent chain the materialized mapNode produced:
//   - export flattening  — ExportNamed/DefaultDeclaration yield their `declaration`
//     (marked __exported + __exportStart so project() can offset fnLike/class starts);
//     ExportAllDeclaration yields the wrapper, whose own forEachChild yields `source`.
//   - method value inline — a method's FunctionExpression value yields ITS children
//     (params/body) directly, never the FunctionExpression itself.
//   - TYPE_SKIP literal collection — the type node is yielded (not collapsed); the engine
//     descends it and the literal's raw parent is a type node, so isToleratedOf computes
//     the same tolerated=true(numeric)/false(string) values as the materialized collector.
//   - TSEnumBody — flattened to its members.
//   - StaticBlock — yields body statements; project() flags increasesNesting=true.
//   - decorators — not skipped; their expression subtrees (with literal args) are yielded.
//
// Mode B (complexity enabled): function-like nodes eagerly materialize their subtree via
// cheapProject (same T5 shape as TsNodeProjector) and the engine's descent shares those
// cached objects with complexity's re-walk — lowest drift risk.
// ---------------------------------------------------------------------------
export class OxcProjector implements NodeProjector {
  readonly root: unknown;
  private readonly ctx: Ctx;
  private readonly policy: ProjectionPolicy;
  /** Mode B: function raw node → its direct non-skippable RAW children (engine descent). */
  private readonly functionSubtrees = new Map<OxcNode, OxcNode[]>();
  /** Mode B: raw subtree node → projected subtree node (non-functionLike; engine + X share). */
  private readonly subtreeCache = new Map<OxcNode, NormalizedNode>();
  /** Mode B: raw subtree node → its non-skippable RAW children (built once by buildSubtree). */
  private readonly rawChildrenCache = new Map<OxcNode, OxcNode[]>();

  constructor(program: OxcNode, content: string, policy: ProjectionPolicy) {
    this.root = program;
    this.ctx = { src: content, lineStarts: computeLineStarts(content) };
    this.policy = policy;
  }

  isSourceFile(raw: unknown): boolean {
    return !!raw && (raw as OxcNode).type === 'Program';
  }

  project(
    raw: unknown,
    parentRaw: unknown | undefined,
    grandparentRaw: unknown | undefined,
  ): NormalizedNode {
    const n = raw as OxcNode;
    // Mode B subtree nodes were projected once by buildSubtree; reuse the SAME object the
    // complexity re-walk sees (the engine's visit and the re-walk cannot drift).
    const cached = this.subtreeCache.get(n);
    if (cached) return cached;

    // The root must always be a real projection: L/M detect top-level children via
    // parent.kind === SourceFile, so a placeholder root would zero all top-level metrics.
    if (this.isSourceFile(n)) return { kind: NodeKind.SourceFile };

    const t = n.type;
    const kind = oxcKindOf(n);
    const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
    const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
    const isClassDefining = t === 'ClassDeclaration' || t === 'ClassExpression';
    const isBinding = oxcIntroducesBinding(n);
    const isScope = CONTROL_OR_BLOCK.has(t) || t === 'StaticBlock';

    // T0 placeholder fast path — a kind with NO consumer-observable fields collapses to the
    // shared frozen singleton (mirrors TsNodeProjector's special-kind gate). Literals are
    // only projected when constants needs them; Binary/Logical are never binding sources.
    if (isLiteral && !this.policy.needLiterals) return OTHER_PLACEHOLDER;
    if (t === 'BinaryExpression' || t === 'LogicalExpression') return OTHER_PLACEHOLDER;
    if (t === 'AssignmentExpression' && n.operator !== '=') return OTHER_PLACEHOLDER;
    const topLevel = !!parentRaw && this.isSourceFile(parentRaw) && TOP_LEVEL_DECL.has(t);
    if (!isLiteral && !fnLike && !isClassDefining && !isBinding && !isScope && !topLevel) {
      return OTHER_PLACEHOLDER;
    }

    // §3.2 export compensation: the flattened declaration carries __exportStart (set by
    // forEachChild's export branch) so fnLike/class starts point at the `export` keyword.
    let startOff = n.start;
    if ((fnLike || isClassDefining) && n.__exported && typeof n.__exportStart === 'number') {
      startOff = n.__exportStart;
    }

    const needsPos = this.policy.needPositions && (isLiteral || fnLike);
    const needsName = this.policy.needNames && (fnLike || isClassDefining || isBinding);

    const node: NormalizedNode = {
      kind,
      text: isLiteral && this.policy.needLiterals ? oxcLiteralText(n, this.ctx) : undefined,
      start: needsPos ? oxcPosOf(startOff, this.ctx) : undefined,
      end: needsPos ? oxcPosOf(n.end, this.ctx) : undefined,
      name: needsName ? oxcNameOf(n, this.ctx) : undefined,
      branchWeight: oxcBranchWeightOf(n),
      functionLike: fnLike,
      isClassDefining,
      introducesBinding: isBinding,
      bindingName: isBinding && needsName ? oxcBindingNameOf(n, this.ctx) : undefined,
      increasesNesting: isScope,
      isConstructor: this.policy.needComplexity && t === 'MethodDefinition' && n.kind === 'constructor',
    };
    node.topLevel = topLevel;
    node.exported = topLevel && (!!n.__exported || t === 'TSExportAssignment');
    if (isLiteral && this.policy.needLiterals) {
      node.isConstBound = oxcIsConstBoundOf(
        n,
        parentRaw as OxcNode | undefined,
        grandparentRaw as OxcNode | undefined,
      );
      node.tolerated = oxcIsToleratedOf(n, parentRaw as OxcNode | undefined, this.ctx);
    }
    // Mode B: function-like nodes eagerly materialize their subtree (shared with X re-walk).
    if (this.policy.needComplexity && fnLike) {
      node.children = this.projectSubtree(
        n,
        parentRaw as OxcNode | undefined,
        grandparentRaw as OxcNode | undefined,
      );
    }
    return node;
  }

  /**
   * Iterate a raw node's children in materialized order (the same skip/展平 rules the
   * materialized mapNode+pushChild applied, expressed as raw-child yielding). Returns an
   * ARRAY (not a generator — measured faster under the engine's recursive descent).
   *
   * Mode B: function-like nodes descend through their materialized subtree's RAW children;
   * other subtree nodes return their CACHED raw children (built once by buildSubtree — the
   * engine's descent never re-walks reflection). Ordinary (top-level / Mode A) nodes do a
   * fresh reflection walk — same order + skip rules as materialization.
   */
  forEachChild(raw: unknown): Iterable<unknown> {
    const n = raw as OxcNode;
    // Program: top-level export flattening (mapTopStatement semantics).
    if (this.isSourceFile(n)) {
      const out: OxcNode[] = [];
      for (const stmt of n.body || []) {
        if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) {
          stmt.declaration.__exported = true;
          stmt.declaration.__exportStart = stmt.start;
          out.push(stmt.declaration);
        } else if (stmt.type === 'ExportDefaultDeclaration') {
          stmt.declaration.__exported = true;
          stmt.declaration.__exportStart = stmt.start;
          out.push(stmt.declaration);
        } else {
          // ExportAllDeclaration (and every other statement) is yielded as-is; the
          // wrapper's own forEachChild surfaces its `source` StringLiteral.
          out.push(stmt);
        }
      }
      return out;
    }
    if (this.policy.needComplexity && oxcIsFnLikeNode(n)) {
      let kids = this.functionSubtrees.get(n);
      if (!kids) {
        // Defensive only: project() normally built the subtree before forEachChild() runs.
        kids = this.rawChildrenOf(n);
        this.functionSubtrees.set(n, kids);
      }
      return kids;
    }
    if (this.policy.needComplexity) {
      const cached = this.rawChildrenCache.get(n);
      if (cached) return cached;
    }
    const kids = this.rawChildrenOf(n);
    if (this.policy.needComplexity && kids.length > 0) this.rawChildrenCache.set(n, kids);
    return kids;
  }

  // ------------------------------------------------------------ raw child walk

  /**
   * Reflection-based raw child walk — the projection twin of mapNode's pushChild loop.
   * Produces the exact raw sequence the materialized path turned into node.children.
   */
  private rawChildrenOf(n: OxcNode): OxcNode[] {
    const out: OxcNode[] = [];
    this.collectInto(n, out);
    return out;
  }

  private collectInto(n: OxcNode, out: OxcNode[]): void {
    const isMethodSource = n.type === 'MethodDefinition' || (n.type === 'Property' && n.method === true);
    for (const key of Object.keys(n)) {
      if (key === 'parent' || key === 'type' || key === 'start' || key === 'end' || key === '__exported' || key === '__exportStart') continue;
      const v = n[key];
      if (v == null) continue;
      if (Array.isArray(v)) {
        for (const item of v) this.pushRaw(out, item, isMethodSource);
      } else if (typeof v === 'object' && typeof (v as OxcNode).type === 'string') {
        this.pushRaw(out, v as OxcNode, isMethodSource);
      }
    }
  }

  private pushRaw(out: OxcNode[], item: OxcNode | null | undefined, inlineFnValue: boolean): void {
    if (item == null) return;
    // §3.4 method value inlining: the FunctionExpression itself is never yielded — its
    // params/body become direct children of the method (mirrors pushChild's inline branch).
    if (inlineFnValue && item.type === 'FunctionExpression') {
      this.collectInto(item, out);
      return;
    }
    // Type-position nodes: yield the type node itself; the engine descends it so the
    // literal's raw parent is a type node and isToleratedOf computes the same values as
    // the materialized collectLiteralsInType (numeric → tolerated, string → not).
    if (TYPE_SKIP_TYPES.has(item.type)) {
      out.push(item);
      return;
    }
    if (SKIP_TYPES.has(item.type)) return;
    // Nested export wrappers: same flattening as the top level (materialized pushChild).
    if (item.type === 'ExportAllDeclaration') {
      // `export * from './mod'` — the source StringLiteral is yielded (hardcoded-string).
      if (item.source) out.push(item.source);
      return;
    }
    if (item.type === 'ExportNamedDeclaration' || item.type === 'ExportDefaultDeclaration') {
      if (item.declaration) {
        item.declaration.__exported = true;
        item.declaration.__exportStart = item.start;
        out.push(item.declaration);
      }
      return;
    }
    // TSEnumBody: members become direct children (TS EnumDeclaration has no body wrapper).
    if (item.type === 'TSEnumBody') {
      for (const m of item.members || []) this.pushRaw(out, m, false);
      return;
    }
    out.push(item);
  }

  // ------------------------------------------------------------ Mode B subtree

  /**
   * Eagerly materialize a function's subtree (cheap projections) and record the function's
   * direct RAW children for the engine's descent. Nested function-like children are only
   * projected as cheap self-nodes (no body recursion) — complexity's re-walk skips them and
   * the engine builds their own subtree when it descends into them.
   */
  private projectSubtree(
    fn: OxcNode,
    parentRaw: OxcNode | undefined,
    _grandparentRaw: OxcNode | undefined,
  ): NormalizedNode[] {
    const rawChildren: OxcNode[] = [];
    const children = this.buildSubtree(fn, parentRaw, rawChildren);
    this.functionSubtrees.set(fn, rawChildren);
    return children;
  }

  private buildSubtree(
    fn: OxcNode,
    parentRaw: OxcNode | undefined,
    rawOut: OxcNode[] | null,
  ): NormalizedNode[] {
    const children: NormalizedNode[] = [];
    const rawChildren: OxcNode[] = [];
    for (const c of this.rawChildrenOf(fn)) {
      rawChildren.push(c);
      if (rawOut) rawOut.push(c);
      // A child c of fn has raw parent = fn and raw grandparent = parentRaw — the same
      // (n, parentTs, grandparentTs) inputs mapNode uses, so isConstBoundOf/isToleratedOf
      // (which need the literal's raw VariableDeclaration/DeclarationList/call ancestors)
      // compute identically on the subtree path.
      const proj = this.cheapProject(c, fn, parentRaw);
      children.push(proj);
      if (!oxcIsFnLikeNode(c)) {
        proj.children = this.buildSubtree(c, fn, null);
      }
    }
    // Cache the raw children so the engine's descent (forEachChild) never re-walks
    // reflection over a subtree node — the walk cost moves to the one-time build.
    if (rawChildren.length > 0) this.rawChildrenCache.set(fn, rawChildren);
    return children;
  }

  /**
   * Cheap projection for a Mode B subtree node. Fixed C6 field order
   * `{kind, functionLike, branchWeight, increasesNesting, children}` — optional fields stay
   * undefined placeholders so common expression nodes share one hidden class. Literals are
   * T3-projected (constants still consumes them); scope/binding sources carry the engine's
   * scope flags. Non-function-like nodes are cached so the engine's visit reuses the same
   * object the complexity re-walk sees.
   */
  private cheapProject(
    n: OxcNode,
    parentRaw: OxcNode | undefined,
    grandparentRaw: OxcNode | undefined,
  ): NormalizedNode {
    const t = n.type;
    const kind = oxcKindOf(n);
    const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
    const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;

    // C6 core shape (fixed field order; optional fields are undefined placeholders).
    const node: NormalizedNode = {
      kind,
      functionLike: fnLike,
      branchWeight: oxcBranchWeightOf(n),
      increasesNesting: CONTROL_OR_BLOCK.has(t) || t === 'StaticBlock',
      children: undefined,
    };

    if (fnLike) {
      // Nested function-like: self-only projection (no body recursion). X skips it during
      // the re-walk; the engine builds its own subtree when it descends into it.
      if (this.policy.needNames) node.name = oxcNameOf(n, this.ctx);
      if (this.policy.needPositions) {
        node.start = oxcPosOf(n.start, this.ctx);
        node.end = oxcPosOf(n.end, this.ctx);
      }
      if (this.policy.needComplexity) {
        node.isConstructor = t === 'MethodDefinition' && n.kind === 'constructor';
      }
    } else {
      if (t === 'ClassDeclaration' || t === 'ClassExpression') {
        node.isClassDefining = true;
        if (this.policy.needNames) node.name = oxcNameOf(n, this.ctx);
      } else if (oxcIntroducesBinding(n)) {
        node.introducesBinding = true;
        if (this.policy.needNames) node.bindingName = oxcBindingNameOf(n, this.ctx);
      }
      if (isLiteral) {
        if (this.policy.needLiterals) {
          node.text = oxcLiteralText(n, this.ctx);
          node.start = oxcPosOf(n.start, this.ctx);
          node.end = oxcPosOf(n.end, this.ctx);
          node.isConstBound = oxcIsConstBoundOf(n, parentRaw, grandparentRaw);
          node.tolerated = oxcIsToleratedOf(n, parentRaw, this.ctx);
        }
      }
    }

    if (!fnLike) this.subtreeCache.set(n, node);
    return node;
  }
}
