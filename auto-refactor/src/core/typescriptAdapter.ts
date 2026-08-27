import * as ts from 'typescript';
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
import { createSourceFile, isFunctionLike } from '../utils/ast';

/**
 * TypeScriptAdapter — wraps the existing `typescript` parser with ZERO behavior change.
 *
 * Every semantic flag the engine/analyzers consume is precomputed here by re-applying the
 * EXACT predicates the pre-multilang engine used (scope descent rules from traverse.ts,
 * const-binding + tolerated-context rules from constants.ts, decision-point weights from
 * complexity.ts). That is what guarantees byte-identical TS output after de-TS-ification.
 *
 * P1-1 (lazy projection): the adapter ALSO exposes an optional `project()` capability
 * (`TsNodeProjector`) that skips materializing the full normalized tree. It reuses the SAME
 * module-level predicates below (kindOf / introducesBinding / branchWeightOf / nameOf /
 * posOf / isConstBoundOf / isToleratedOf / isSkippableToken / isTopLevelDecl /
 * hasExportModifier / bindingName) — zero reimplementation, byte-identical inputs.
 */

/** Mirrors the old CONTROL_OR_BLOCK set (depth increment). */
const CONTROL_OR_BLOCK = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.Block,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
]);

/** Mirrors the old isTopLevelDecl set. */
function isTopLevelDecl(n: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isClassDeclaration(n) ||
    ts.isInterfaceDeclaration(n) ||
    ts.isEnumDeclaration(n) ||
    ts.isTypeAliasDeclaration(n) ||
    ts.isModuleDeclaration(n) ||
    ts.isVariableStatement(n)
  );
}

function hasExportModifier(n: ts.Node): boolean {
  const list = (n as any).modifiers as ts.NodeArray<ts.Modifier> | undefined;
  return !!list && list.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Mirrors the old introducesBinding predicate (exactly the four binding-source cases).
 * P1-4: short-circuit by kind FIRST — only the four candidate node kinds reach the
 * original `ts.isXxx`-equivalent branches, so non-candidate nodes (the ~95% majority)
 * pay a single switch dispatch instead of four `ts.is*` predicate calls each.
 */
function introducesBinding(node: ts.Node): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.VariableDeclaration: {
      const v = node as ts.VariableDeclaration;
      return !!v.initializer && isFunctionLike(v.initializer);
    }
    case ts.SyntaxKind.PropertyAssignment: {
      const p = node as ts.PropertyAssignment;
      return isFunctionLike(p.initializer);
    }
    case ts.SyntaxKind.PropertyDeclaration: {
      const p = node as ts.PropertyDeclaration;
      return !!p.initializer && isFunctionLike(p.initializer);
    }
    case ts.SyntaxKind.BinaryExpression: {
      const b = node as ts.BinaryExpression;
      return b.operatorToken.kind === ts.SyntaxKind.EqualsToken && isFunctionLike(b.right);
    }
    default:
      return false;
  }
}

/** Literal node kinds the analyzers consume (constants reads their text as the value). */
const LITERAL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
]);

/**
 * Tokens that carry no semantic value for the analyzers (punctuation, keywords, identifiers)
 * and are skipped during materialization — they are ~80% of all ts nodes. Literals, the
 * bare `function` keyword (complexity locates findings at it) and modifiers (export/async —
 * they keep the complexity startNode rule byte-identical) are NOT skipped.
 */
function isSkippableToken(n: ts.Node): boolean {
  if (!ts.isToken(n)) return false;
  if (LITERAL_KINDS.has(n.kind)) return false;
  if (n.kind === ts.SyntaxKind.FunctionKeyword) return false;
  if (ts.isModifier(n)) return false;
  return true;
}

/** Mirrors the old bindingName resolver. */
function bindingName(node: ts.Node, sf: ts.SourceFile): string | null {
  if (ts.isVariableDeclaration(node) && node.initializer && isFunctionLike(node.initializer)) {
    const n = (node.name as ts.Identifier)?.getText?.(sf);
    return n ?? null;
  }
  if (ts.isPropertyAssignment(node) && isFunctionLike(node.initializer)) {
    return node.name.getText(sf);
  }
  if (ts.isPropertyDeclaration(node) && node.initializer && isFunctionLike(node.initializer)) {
    return node.name.getText(sf);
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    isFunctionLike(node.right)
  ) {
    if (ts.isPropertyAccessExpression(node.left)) return node.left.getText(sf);
    if (ts.isIdentifier(node.left)) return node.left.getText(sf);
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Normalized-node predicate layer. These were the TypeScriptAdapter's private methods;
// extracted to module level (logic unchanged) so BOTH the materializing mapNode and the
// lazy TsNodeProjector reuse the exact same implementation (docs/p1-1-design.md §7: predicates
// are reused as-is, never rewritten).
// ---------------------------------------------------------------------------

function kindOf(n: ts.Node): NodeKind {
  switch (n.kind) {
    case ts.SyntaxKind.SourceFile:
      return NodeKind.SourceFile;
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.FunctionExpression:
    case ts.SyntaxKind.ArrowFunction:
      return NodeKind.Function;
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
    case ts.SyntaxKind.Constructor:
      return NodeKind.Method;
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.ClassExpression:
      return NodeKind.Class;
    case ts.SyntaxKind.InterfaceDeclaration:
      return NodeKind.Interface;
    case ts.SyntaxKind.VariableDeclaration:
      return NodeKind.Variable;
    case ts.SyntaxKind.NumericLiteral:
      return NodeKind.NumericLiteral;
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return NodeKind.StringLiteral;
    case ts.SyntaxKind.CallExpression:
    case ts.SyntaxKind.NewExpression:
      return NodeKind.Call;
    case ts.SyntaxKind.BinaryExpression:
      return NodeKind.BinaryExpr;
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.SwitchStatement:
    case ts.SyntaxKind.CaseClause:
    case ts.SyntaxKind.CatchClause:
    case ts.SyntaxKind.TryStatement:
      return NodeKind.ControlFlow;
    case ts.SyntaxKind.Block:
      return NodeKind.Block;
    default:
      return NodeKind.Other;
  }
}

/** Cyclomatic decision-point weight — exact port of complexity.ts `cyclomaticComplexity`. */
function branchWeightOf(n: ts.Node): number {
  switch (n.kind) {
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.SwitchStatement:
    case ts.SyntaxKind.CatchClause:
    case ts.SyntaxKind.CaseClause:
    case ts.SyntaxKind.ConditionalExpression:
      return 1;
    case ts.SyntaxKind.BinaryExpression: {
      const op = (n as ts.BinaryExpression).operatorToken.kind;
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return 1;
      }
      return 0;
    }
    default:
      return 0;
  }
}

function nameOf(n: ts.Node, sf: ts.SourceFile): string | null {
  const name = (n as any).name as ts.Node | undefined;
  if (!name) return null;
  const t = (name as any).getText?.(sf);
  return typeof t === 'string' && t.length > 0 ? t : null;
}

/** Exact port of constants.ts `isConstBound` computation. */
function isConstBoundOf(
  node: ts.Node,
  parent: ts.Node | undefined,
  grandparent: ts.Node | undefined,
): boolean {
  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    parent.initializer === node &&
    grandparent &&
    ts.isVariableDeclarationList(grandparent) &&
    (grandparent.flags & ts.NodeFlags.Const) !== 0
  ) {
    return true;
  }
  if (parent && ts.isEnumMember(parent)) return true;
  return false;
}

/** Exact port of constants.ts tolerated-context rules (numeric + string). */
function isToleratedOf(node: ts.Node, p: ts.Node | undefined, sf: ts.SourceFile): boolean {
  if (!p) return false;
  // numeric tolerations
  if (ts.isNumericLiteral(node)) {
    if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
    if (ts.isPropertyAccessExpression(p)) return true;
    if (ts.isPropertyAssignment(p) && p.name === node) return true;
    if (ts.isEnumMember(p)) return true;
    if (ts.isTypeNode(p)) return true;
    if (ts.isCaseClause(p)) return true;
    return false;
  }
  // string tolerations
  if (ts.isImportDeclaration(p) || ts.isImportEqualsDeclaration(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isPropertyAccessExpression(p)) return true;
  if (ts.isJsxAttribute(p) && p.name === node) return true;
  if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p)) return false;
  // i18n: t('...'), i18n.t('...'), translate('...')
  if (ts.isCallExpression(p) && p.arguments.includes(node as ts.Expression)) {
    const callee = p.expression.getText(sf);
    if (/\b(t|i18n\.\w*|translate|fmt|formatMessage)\s*$/.test(callee)) return true;
  }
  return false;
}

function posOf(pos: number, sf: ts.SourceFile): Position {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, column: lc.character + 1 };
}

// ---------------------------------------------------------------------------
// Per-SyntaxKind lookup table (P1-1 perf): the projector's hot path calls four predicates
// per node (kindOf / isFunctionLike / branchWeightOf / CONTROL_OR_BLOCK + class detection).
// Each of those is a pure function of `n.kind` (branchWeightOf only additionally inspects
// BinaryExpression's operator, handled at the use site), so we memoize their outputs into
// ONE array indexed by ts.SyntaxKind — the projector pays a single array access instead of
// four dispatches. The table is DERIVED from the exact predicates above (no logic
// duplication → byte-equivalent to mapNode's classification).
// ---------------------------------------------------------------------------

interface TsKindInfo {
  kind: NodeKind;
  fnLike: boolean;
  /** branchWeight for kind-only cases; BinaryExpression is 0 here (operator checked at use). */
  branch: number;
  increasesNesting: boolean;
  isClassDefining: boolean;
  /** 0 = not a consumed literal, 1 = NumericLiteral, 2 = StringLiteral. */
  literal: 0 | 1 | 2;
  /** Kind any consumer can observe (literal/function/class/binding-source/scope/FunctionKeyword/top-level-decl). */
  special: boolean;
}

/**
 * Runtime max ts.SyntaxKind: numeric enums expose BOTH numeric values and reverse-mapped
 * names — filter to numbers and take the max. Derived dynamically so a future TypeScript
 * upgrade (new SyntaxKind > 420) never overflows the fixed-size table.
 */
function maxSyntaxKind(): number {
  let max = 0;
  for (const v of Object.values(ts.SyntaxKind)) {
    if (typeof v === 'number' && v > max) max = v;
  }
  return max;
}

/** ts.SyntaxKind values are dense-ish integers; size the table to the runtime max. */
const TS_KIND_INFO_MAX = maxSyntaxKind() + 1;

/** Kinds that can be binding sources (introducesBinding candidates). */
const BINDING_SOURCE_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.BinaryExpression,
]);

/** Kinds whose topLevel/exported flags are observable (isTopLevelDecl). */
const TOP_LEVEL_DECL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableStatement,
]);

const TS_KIND_INFO: TsKindInfo[] = (() => {
  const table: TsKindInfo[] = new Array(TS_KIND_INFO_MAX);
  for (let k = 0; k < TS_KIND_INFO_MAX; k++) {
    const kindNum = k as ts.SyntaxKind;
    // branchWeightOf reads `.operatorToken` for BinaryExpression — a fake node has none.
    const branch =
      kindNum === ts.SyntaxKind.BinaryExpression ? 0 : branchWeightOf({ kind: kindNum } as ts.Node);
    const isClassDefining =
      ts.isClassDeclaration({ kind: kindNum } as ts.Node) ||
      ts.isClassExpression({ kind: kindNum } as ts.Node);
    const kind = kindOf({ kind: kindNum } as ts.Node);
    const literal =
      kindNum === ts.SyntaxKind.NumericLiteral
        ? 1
        : kindNum === ts.SyntaxKind.StringLiteral || kindNum === ts.SyntaxKind.NoSubstitutionTemplateLiteral
          ? 2
          : 0;
    const special =
      literal !== 0 ||
      isFunctionLike({ kind: kindNum } as ts.Node) ||
      isClassDefining ||
      CONTROL_OR_BLOCK.has(kindNum) ||
      kindNum === ts.SyntaxKind.FunctionKeyword ||
      BINDING_SOURCE_KINDS.has(kindNum) ||
      TOP_LEVEL_DECL_KINDS.has(kindNum);
    table[k] = {
      kind,
      fnLike: isFunctionLike({ kind: kindNum } as ts.Node),
      branch,
      increasesNesting: CONTROL_OR_BLOCK.has(kindNum),
      isClassDefining,
      literal,
      special,
    };
  }
  return table;
})();

/**
 * Look up the memoized per-kind info, with a CONSERVATIVE fallback for any SyntaxKind the
 * runtime table did not cover (future TypeScript upgrades): compute the flags directly via
 * the predicates and mark the node special (never placeholder) so the fast path stays
 * byte-equivalent instead of degrading to a bogus undefined dereference.
 */
function kindInfoFor(n: ts.Node): TsKindInfo {
  const info = TS_KIND_INFO[n.kind];
  if (info) return info;
  const kindNum = n.kind;
  return {
    kind: kindOf(n),
    fnLike: isFunctionLike(n),
    branch: kindNum === ts.SyntaxKind.BinaryExpression ? 0 : branchWeightOf(n),
    increasesNesting: CONTROL_OR_BLOCK.has(kindNum),
    isClassDefining: ts.isClassDeclaration(n) || ts.isClassExpression(n),
    literal:
      kindNum === ts.SyntaxKind.NumericLiteral
        ? 1
        : kindNum === ts.SyntaxKind.StringLiteral || kindNum === ts.SyntaxKind.NoSubstitutionTemplateLiteral
          ? 2
          : 0,
    special: true, // conservative: never treat an unknown kind as a placeholder
  };
}

export class TypeScriptAdapter implements LanguageAdapter {
  id = 'typescript' as const;
  extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

  parse(content: string, filePath: string, seed?: ProjectionSeed): NormalizedAst {
    const sf = createSourceFile(filePath, content);
    return { root: this.mapNode(sf, undefined, undefined, sf, seed) };
  }

  /**
   * P1-1: build a lazy-projection source for a file. Creates ONLY the ts.SourceFile (the
   * projector needs it for positions/text) — the full normalized tree is never built.
   */
  project(content: string, filePath: string, policy: ProjectionPolicy): NodeProjector | null {
    const sf = createSourceFile(filePath, content);
    return new TsNodeProjector(sf, policy);
  }

  root(ast: NormalizedAst): NormalizedNode {
    return ast.root;
  }

  children(node: NormalizedNode): NormalizedNode[] {
    return node.children || [];
  }

  // ------------------------------------------------------------------ mapping

  private mapNode(
    n: ts.Node,
    parentTs: ts.Node | undefined,
    grandparentTs: ts.Node | undefined,
    sf: ts.SourceFile,
    seed?: ProjectionSeed,
  ): NormalizedNode {
    const kind = kindOf(n);
    const isLiteral =
      kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
    const fnLike = isFunctionLike(n);
    const isBinding = introducesBinding(n); // expensive predicate — compute once
    const isClassDefining = ts.isClassDeclaration(n) || ts.isClassExpression(n);
    // P0-1: positions are only materialized for nodes that can appear in an Issue
    // (literals, function-like units, and the bare `function` keyword). Every other
    // node skips the two line/column conversions + two Position objects (~86% of nodes).
    const needsPos = isLiteral || fnLike || n.kind === ts.SyntaxKind.FunctionKeyword;
    // P0-4: `name` is only materialized for the three node classes the analyzers/engine
    // consume (function-like units for complexity/large-file naming, class definitions for
    // the threaded className, and binding sources for the binding name). ~80% of nodes
    // (variable/property/parameter names etc.) skip the getText sub-string allocation.
    const needsName = fnLike || isClassDefining || isBinding;
    const name = needsName ? nameOf(n, sf) : undefined;

    const node: NormalizedNode = {
      kind,
      // P2-1: rawKind is only observable where complexity.ts reads it — the bare
      // `function` keyword (`first.rawKind === 'FunctionKeyword'`). Everything else
      // leaves it unset (skips the reverse SyntaxKind lookup for ~8600 nodes/file).
      rawKind: n.kind === ts.SyntaxKind.FunctionKeyword ? 'FunctionKeyword' : undefined,
      // Copy the node text only for literals (the constants analyzer reads it as the
      // literal value); materializing text for every node copies whole subtrees for free.
      text: isLiteral ? n.getText(sf) : undefined,
      start: needsPos ? posOf(n.getStart(sf), sf) : undefined,
      end: needsPos ? posOf(n.getEnd(), sf) : undefined,
      name,
      isNumeric: kind === NodeKind.NumericLiteral,
      isString: kind === NodeKind.StringLiteral,
      branchWeight: branchWeightOf(n),
      functionLike: fnLike,
      isClassDefining,
      introducesBinding: isBinding,
      bindingName: isBinding ? bindingName(n, sf) : null,
      hasFunctionInitializer: isBinding,
      increasesNesting: CONTROL_OR_BLOCK.has(n.kind),
      isConstructor: ts.isConstructorDeclaration(n),
    };

    const topLevel = !!parentTs && ts.isSourceFile(parentTs) && isTopLevelDecl(n);
    node.topLevel = topLevel;
    node.exported =
      topLevel &&
      (hasExportModifier(n) || ts.isExportAssignment(n) || ts.isExportDeclaration(n));

    if (isLiteral) {
      node.isConstBound = isConstBoundOf(n, parentTs, grandparentTs);
      node.tolerated = isToleratedOf(n, parentTs, sf);
    }

    // P1-4: only allocate a children array when the node actually has non-skippable
    // children (leaf nodes — the majority — keep `children` undefined). The engine and
    // every analyzer already go through `node.children || []`, so this is a pure
    // allocation win (~5-7k fewer arrays per large file).
    // P2-5 (INC-Mode-1): reuse a previously-materialized function subtree when its byte span
    // + source text are unchanged, skipping the recursive predicate + allocation below. The
    // cached children carry positions that are byte-identical because the function occupies
    // the same byte range in the new content (verified by `reuseSubtree`).
    let span: ReusedSpan | undefined;
    if (seed && fnLike) {
      const startPos = posOf(n.getStart(sf), sf);
      span = {
        startLine: startPos.line,
        startColumn: startPos.column,
        startByte: n.getStart(sf),
        endByte: n.getEnd(),
        sourceText: n.getText(sf),
      };
      const reused = seed.reuseSubtree(span);
      if (reused) {
        node.children = reused;
        seed.cacheSubtree(span, reused);
        if (seed.markReused) seed.markReused(node, span);
        return node;
      }
    }

    let kids: NormalizedNode[] | undefined;
    ts.forEachChild(n, (c) => {
      if (isSkippableToken(c)) return; // ~80% of nodes are useless punctuation/identifiers
      (kids ??= []).push(this.mapNode(c, n, parentTs, sf, seed));
    });
    node.children = kids;
    if (seed && span) seed.cacheSubtree(span, kids || []);
    return node;
  }
}

// ---------------------------------------------------------------------------
// P1-1: TS lazy projector (Mode A + Mode B).
// ---------------------------------------------------------------------------

/**
 * Lazy projection source for TypeScript-family files (docs/p1-1-design.md §2.5).
 *
 * Mode A (complexity disabled): `project()` returns T0 placeholders for non-consumed nodes
 * and real projections only for literals / scope / top-level / binding / function-like
 * nodes; `forEachChild()` is a raw-driven lazy generator (no normalized children arrays).
 *
 * Mode B (complexity enabled): function-like nodes eagerly materialize their function
 * subtree via `projectSubtree()` — cheap projections with the fixed C6 field order
 * `{kind, functionLike, branchWeight, increasesNesting, children}` (optional fields kept as
 * undefined placeholders to avoid hidden-class splits). Nested function-like children are
 * projected as self-nodes only (no body recursion); the engine builds their subtree when it
 * descends into them. The engine's descent and complexity's re-walk share the SAME subtree
 * objects (lowest drift risk).
 */
export class TsNodeProjector implements NodeProjector {
  readonly root: unknown;
  private readonly sf: ts.SourceFile;
  private readonly policy: ProjectionPolicy;
  /** Mode B: function raw node → its direct non-skippable RAW children (engine descent). */
  private readonly functionSubtrees = new Map<ts.Node, ts.Node[]>();
  /** Mode B: raw subtree node → projected subtree node (non-functionLike; engine + X share). */
  private readonly subtreeCache = new Map<ts.Node, NormalizedNode>();
  /**
   * Mode B: raw subtree node → its non-skippable RAW children (built once by buildSubtree).
   * Lets forEachChild() serve the engine's descent without re-walking ts.forEachChild over
   * every subtree node (the materialized path's mapNode also walks each node exactly once).
   */
  private readonly rawChildrenCache = new Map<ts.Node, ts.Node[]>();

  constructor(sf: ts.SourceFile, policy: ProjectionPolicy) {
    this.sf = sf;
    this.root = sf;
    this.policy = policy;
  }

  isSourceFile(raw: unknown): boolean {
    return !!raw && (raw as ts.Node).kind === ts.SyntaxKind.SourceFile;
  }

  project(
    raw: unknown,
    parentRaw: unknown | undefined,
    grandparentRaw: unknown | undefined,
  ): NormalizedNode {
    const n = raw as ts.Node;

    // Mode B subtree nodes were projected once by projectSubtree; reuse the SAME object
    // the complexity re-walk sees (the engine's visit and the re-walk cannot drift).
    const cached = this.subtreeCache.get(n);
    if (cached) return cached;

    // The root must always be a real projection: L/M detect top-level children via
    // parent.kind === SourceFile, so a placeholder root would zero all top-level metrics.
    if (this.isSourceFile(n)) return { kind: NodeKind.SourceFile };

    const k = n.kind;
    const info = kindInfoFor(n);
    const fnLike = info.fnLike;
    const isLiteral = info.literal !== 0;
    const isScope = info.increasesNesting;
    const isFuncKw = k === ts.SyntaxKind.FunctionKeyword;

    // T0 placeholder fast path: a kind with NO consumer-observable fields, or a non-=
    // BinaryExpression (never a binding source / scope / top-level / literal), is the
    // shared frozen singleton — one array index + one operator check, zero predicates.
    if (!info.special) return OTHER_PLACEHOLDER;
    if (isLiteral && !this.policy.needLiterals) return OTHER_PLACEHOLDER;
    if (isFuncKw && !this.policy.needComplexity) return OTHER_PLACEHOLDER;
    if (k === ts.SyntaxKind.BinaryExpression && (n as ts.BinaryExpression).operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
      return OTHER_PLACEHOLDER;
    }

    const isClassDefining = info.isClassDefining;
    const isBinding = introducesBinding(n);
    const topLevel = !!parentRaw && this.isSourceFile(parentRaw) && isTopLevelDecl(n);

    // Remaining special kinds that are not actually observed at this position (e.g. a
    // VariableDeclaration whose initializer is not function-like, a non-top-level
    // VariableStatement) still collapse to the placeholder. FunctionKeyword survives only
    // when complexity needs it (rawKind + position for the startNode rule); consumed
    // literals (needLiterals already checked above) always fall through to T3.
    if (!isLiteral && !fnLike && !isClassDefining && !isBinding && !isScope && !(isFuncKw && this.policy.needComplexity) && !topLevel) {
      return OTHER_PLACEHOLDER;
    }

    const needsPos = this.policy.needPositions && (isLiteral || fnLike || isFuncKw);
    const needsName = this.policy.needNames && (fnLike || isClassDefining || isBinding);

    const node: NormalizedNode = {
      kind: info.kind,
      rawKind: isFuncKw && this.policy.needComplexity ? 'FunctionKeyword' : undefined,
      text: isLiteral && this.policy.needLiterals ? n.getText(this.sf) : undefined,
      start: needsPos ? posOf(n.getStart(this.sf), this.sf) : undefined,
      end: needsPos ? posOf(n.getEnd(), this.sf) : undefined,
      name: needsName ? nameOf(n, this.sf) : undefined,
      functionLike: fnLike,
      isClassDefining,
      introducesBinding: isBinding,
      bindingName: isBinding && needsName ? bindingName(n, this.sf) : undefined,
      increasesNesting: isScope,
      isConstructor: this.policy.needComplexity && ts.isConstructorDeclaration(n),
    };
    node.topLevel = topLevel;
    node.exported =
      topLevel &&
      (hasExportModifier(n) || ts.isExportAssignment(n) || ts.isExportDeclaration(n));
    if (isLiteral && this.policy.needLiterals) {
      node.isConstBound = isConstBoundOf(
        n,
        parentRaw as ts.Node | undefined,
        grandparentRaw as ts.Node | undefined,
      );
      node.tolerated = isToleratedOf(n, parentRaw as ts.Node | undefined, this.sf);
    }
    // Mode B: function-like nodes eagerly materialize their subtree (shared with X re-walk).
    if (this.policy.needComplexity && fnLike) {
      node.children = this.projectSubtree(
        n,
        parentRaw as ts.Node | undefined,
        grandparentRaw as ts.Node | undefined,
      );
    }
    return node;
  }

  /**
   * Iterate a raw node's children in materialized order. Returns an ARRAY (not a generator —
   * measured ~2.4x faster than a per-node generator under the engine's recursive descent).
   *
   * Mode B: function-like nodes descend through their materialized subtree's RAW children;
   * other subtree nodes return their CACHED raw children (built once by buildSubtree — the
   * engine's descent never re-walks ts.forEachChild). Ordinary (top-level / Mode A) nodes
   * do a fresh ts.forEachChild + isSkippableToken walk — same order + skip rule as
   * materialization.
   */
  forEachChild(raw: unknown): Iterable<unknown> {
    const n = raw as ts.Node;
    if (this.policy.needComplexity && isFunctionLike(n)) {
      let kids = this.functionSubtrees.get(n);
      if (!kids) {
        // Defensive only: project() normally built the subtree before forEachChild() runs.
        kids = [];
        ts.forEachChild(n, (c) => {
          if (!isSkippableToken(c)) kids!.push(c);
        });
        this.functionSubtrees.set(n, kids);
      }
      return kids;
    }
    if (this.policy.needComplexity) {
      const cached = this.rawChildrenCache.get(n);
      if (cached) return cached;
    }
    const kids: ts.Node[] = [];
    ts.forEachChild(n, (c) => {
      if (!isSkippableToken(c)) kids.push(c);
    });
    return kids;
  }

  // ------------------------------------------------------------ Mode B subtree

  /**
   * Eagerly materialize a function's subtree (cheap projections) and record the function's
   * direct RAW children for the engine's descent. Nested function-like children are only
   * projected as cheap self-nodes (no body recursion) — complexity's re-walk skips them and
   * the engine builds their own subtree when it descends into them.
   */
  private projectSubtree(
    fn: ts.Node,
    parentRaw: ts.Node | undefined,
    _grandparentRaw: ts.Node | undefined,
  ): NormalizedNode[] {
    const rawChildren: ts.Node[] = [];
    const children = this.buildSubtree(fn, parentRaw, rawChildren);
    this.functionSubtrees.set(fn, rawChildren);
    return children;
  }

  private buildSubtree(
    fn: ts.Node,
    parentRaw: ts.Node | undefined,
    rawOut: ts.Node[] | null,
  ): NormalizedNode[] {
    const children: NormalizedNode[] = [];
    const rawChildren: ts.Node[] = [];
    ts.forEachChild(fn, (c) => {
      if (isSkippableToken(c)) return;
      rawChildren.push(c);
      if (rawOut) rawOut.push(c);
      // A child c of fn has raw parent = fn and raw grandparent = parentRaw — the same
      // (n, parentTs, grandparentTs) inputs mapNode uses, so isConstBoundOf/isToleratedOf
      // (which need the literal's raw VariableDeclaration/DeclarationList/call ancestors)
      // compute identically on the subtree path.
      const proj = this.cheapProject(c, fn, parentRaw);
      children.push(proj);
      if (!isFunctionLike(c)) {
        proj.children = this.buildSubtree(c, fn, null);
      }
    });
    // Cache the raw children so the engine's descent (forEachChild) never re-walks
    // ts.forEachChild over a subtree node — the walk cost moves to the one-time build.
    if (rawChildren.length > 0) this.rawChildrenCache.set(fn, rawChildren);
    return children;
  }

  /**
   * Cheap projection for a Mode B subtree node. Fixed C6 field order
   * `{kind, functionLike, branchWeight, increasesNesting, children}` — optional fields stay
   * undefined placeholders so common expression nodes share one hidden class. Literals are
   * T3-projected (constants still consumes them); scope/binding sources carry the engine's
   * scope flags; the bare `function` keyword carries rawKind+pos (complexity's startNode
   * rule, §3.2 fixture 9). Non-function-like nodes are cached so the engine's visit reuses
   * the same object the complexity re-walk sees.
   */
  private cheapProject(
    n: ts.Node,
    parentRaw: ts.Node | undefined,
    grandparentRaw: ts.Node | undefined,
  ): NormalizedNode {
    const info = kindInfoFor(n);
    const kind = info.kind;
    const fnLike = info.fnLike;
    const isLiteral = info.literal !== 0;
    // branchWeightOf(BinaryExpression) needs the operator; the table stores 0 for it.
    const branchWeight =
      n.kind === ts.SyntaxKind.BinaryExpression ? branchWeightOf(n) : info.branch;

    // C6 core shape (fixed field order; optional fields are undefined placeholders).
    const node: NormalizedNode = {
      kind,
      functionLike: fnLike,
      branchWeight,
      increasesNesting: info.increasesNesting,
      children: undefined,
    };

    if (fnLike) {
      // Nested function-like: self-only projection (no body recursion). X skips it during
      // the re-walk; the engine builds its own subtree when it descends into it.
      if (this.policy.needNames) node.name = nameOf(n, this.sf);
      if (this.policy.needPositions) {
        node.start = posOf(n.getStart(this.sf), this.sf);
        node.end = posOf(n.getEnd(), this.sf);
      }
      if (this.policy.needComplexity) node.isConstructor = ts.isConstructorDeclaration(n);
    } else {
      if (info.isClassDefining) {
        node.isClassDefining = true;
        if (this.policy.needNames) node.name = nameOf(n, this.sf);
      } else if (introducesBinding(n)) {
        node.introducesBinding = true;
        if (this.policy.needNames) node.bindingName = bindingName(n, this.sf);
      }
      if (isLiteral) {
        if (this.policy.needLiterals) {
          node.text = n.getText(this.sf);
          node.start = posOf(n.getStart(this.sf), this.sf);
          node.end = posOf(n.getEnd(), this.sf);
          node.isConstBound = isConstBoundOf(n, parentRaw, grandparentRaw);
          node.tolerated = isToleratedOf(n, parentRaw, this.sf);
        }
      } else if (n.kind === ts.SyntaxKind.FunctionKeyword) {
        if (this.policy.needComplexity) node.rawKind = 'FunctionKeyword';
        if (this.policy.needPositions) {
          node.start = posOf(n.getStart(this.sf), this.sf);
          node.end = posOf(n.getEnd(), this.sf);
        }
      }
    }

    if (!fnLike) this.subtreeCache.set(n, node);
    return node;
  }
}
