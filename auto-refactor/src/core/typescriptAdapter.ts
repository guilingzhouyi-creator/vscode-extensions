import * as ts from 'typescript';
import type {
    NormalizedNode,
    NormalizedAst,
    Position,
    LanguageAdapter,
    NodeProjector,
    ProjectionPolicy,
    ProjectionSeed,
    ReusedSpan,
} from './multilang';
import { NodeKind, OTHER_PLACEHOLDER } from './multilang';
import { createSourceFile, isFunctionLike } from '../utils/ast';

/**
 * Module: Core Engine — TypeScript and JavaScript Language Adapter
 * File Path: src/core/typescriptAdapter.ts
 * Architecture Role: default LanguageAdapter mapping the typescript compiler AST to the
 *   normalized tree; also owns the optional TsNodeProjector lazy fast-path source.
 * Dependencies & Triggers: typescript, ./multilang, ../utils/ast; selected by
 *   core/adapters.ts for .ts/.tsx/.js/.jsx/.mjs/.cjs when parser is 'typescript'; called by
 *   the engine/worker per file and by legacy analyzer paths.
 * Responsibilities: materialize normalized nodes/positions/literals/binding and scope flags
 *   with the exact pre-multilang predicates, skip tokens, reuse incremental function
 *   subtrees, and run Mode A/B projection via TsNodeProjector and its kind table.
 * Exit Semantics & Design Rationale: parse()/project() are synchronous and produce
 *   byte-identical results; exceptions propagate so tryCreateProjector can fall back to
 *   materialized parse(); lazy projection and fixed object shapes cut allocation only.
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

/**
 * Mirrors the old isTopLevelDecl set.
 *
 * @param n - TypeScript node to classify.
 * @returns `true` when `n` is one of the top-level declaration statement kinds tracked by
 * the adapter (function/class/interface/enum/type/module/variable statement).
 */
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

/**
 * Test whether a node carries the `export` modifier.
 *
 * @param n - TypeScript node to inspect; nodes without a modifier list are not exported.
 * @returns `true` when the node's modifier list contains the export keyword.
 */
function hasExportModifier(n: ts.Node): boolean {
    const list = (n as any).modifiers as ts.NodeArray<ts.Modifier> | undefined;
    return !!list && list.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/**
 * Mirrors the old introducesBinding predicate (exactly the four binding-source cases).
 * Kind-first short-circuit: only the four candidate node kinds reach the original
 * `ts.isXxx`-equivalent branches, so non-candidate nodes (the ~95% majority) pay a
 * single switch dispatch instead of four `ts.is*` predicate calls each.
 *
 * @param node - TypeScript node to classify.
 * @returns `true` for the four binding-source shapes: function-valued variable and
 * property declarations, plus function-valued `=` binary assignments.
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
 *
 * @param n - node to test.
 * @returns `true` when the node is a punctuation/keyword/identifier token that carries no
 * semantic value for the analyzers and can be skipped during materialization.
 */
function isSkippableToken(n: ts.Node): boolean {
    if (!ts.isToken(n)) return false;
    if (LITERAL_KINDS.has(n.kind)) return false;
    if (n.kind === ts.SyntaxKind.FunctionKeyword) return false;
    if (ts.isModifier(n)) return false;
    return true;
}

/**
 * Mirrors the old bindingName resolver.
 *
 * @param node - candidate binding-source node.
 * @param sf - source file used to resolve identifier and property text.
 * @returns the bound name for a function-valued declaration or assignment, or `null` when
 * the node is not a binding source or its name cannot be resolved.
 */
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
// lazy TsNodeProjector reuse the exact same implementation
// (docs/02-parsers-and-ast/03-lazy-projection.md §7: predicates are reused as-is, never
// rewritten).
// ---------------------------------------------------------------------------

/**
 * Map a raw TypeScript SyntaxKind to the normalized NodeKind consumed by the analyzers.
 *
 * @param n - raw TypeScript node.
 * @returns the normalized kind; unmapped kinds fall back to `NodeKind.Other`, while the
 * branch compound kinds map to `NodeKind.ControlFlow`.
 */
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

/**
 * Cyclomatic decision-point weight — exact port of complexity.ts `cyclomaticComplexity`.
 *
 * @param n - raw TypeScript node.
 * @returns `1` for branch kinds and the short-circuit `&&`/`||`/`??` operators, otherwise
 * `0`.
 */
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

/**
 * Resolve the declared name of a node for the consumers that need it.
 *
 * @param n - raw TypeScript node that may carry a `name` field.
 * @param sf - source file used to print the name text.
 * @returns the non-empty name text, or `null` when the node has no name or the name is
 * empty.
 */
/**
 * Callee name of a call expression, reduced to its final segment (`a.b.c()` -> `c`).
 *
 * The symbol index needs the referenced NAME, not the receiver chain: `x.login()` and
 * `service.login()` both reference a `login` declaration, and a member receiver is not itself a
 * cross-file fact the analyzers can resolve today.
 *
 * @param n - Candidate node.
 * @param sf - Owning source file, used for text extraction.
 * @returns The callee name, or null when the node is not a call expression.
 */
function calleeNameOf(n: ts.Node, sf: ts.SourceFile): string | null {
    if (!ts.isCallExpression(n)) return null;
    const text = n.expression.getText(sf);
    if (text.length === 0) return null;
    const dot = text.lastIndexOf('.');
    return dot >= 0 ? text.slice(dot + 1) : text;
}

function nameOf(n: ts.Node, sf: ts.SourceFile): string | null {
    const name = (n as any).name as ts.Node | undefined;
    if (!name) return null;
    const t = (name as any).getText?.(sf);
    return typeof t === 'string' && t.length > 0 ? t : null;
}

/**
 * Exact port of constants.ts `isConstBound` computation.
 *
 * @param node - literal node whose const-bound status is being resolved.
 * @param parent - raw parent node; may be undefined at the root.
 * @param grandparent - raw grandparent node; may be undefined near the root.
 * @returns `true` when the literal is the initializer of a `const` declaration or an enum
 * member discriminant.
 */
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

/**
 * Exact port of constants.ts tolerated-context rules (numeric + string).
 *
 * @param node - literal node to classify.
 * @param p - raw parent node; `undefined` means the literal has no tolerated context.
 * @param sf - source file used to print call callees for the i18n heuristic.
 * @returns `true` when the literal sits in a context (index/key/type/import/i18n call,
 * and so on) where the constants analyzer must not report it.
 */
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

/**
 * Convert a character offset into a 1-based line/column position.
 *
 * @param pos - absolute character offset inside the source file.
 * @param sf - source file providing the line map.
 * @returns the normalized position with 1-based line and column numbers.
 */
function posOf(pos: number, sf: ts.SourceFile): Position {
    const lc = sf.getLineAndCharacterOfPosition(pos);
    return { line: lc.line + 1, column: lc.character + 1 };
}

// ---------------------------------------------------------------------------
// Per-SyntaxKind lookup table: the projector's hot path calls four predicates
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
    /**
     * Kind any consumer can observe
     * (literal/function/class/binding-source/scope/FunctionKeyword/top-level-decl).
     */
    special: boolean;
}

/**
 * Runtime max ts.SyntaxKind: numeric enums expose BOTH numeric values and reverse-mapped
 * names — filter to numbers and take the max. Derived dynamically so a future TypeScript
 * upgrade (new SyntaxKind > 420) never overflows the fixed-size table.
 *
 * @returns the largest numeric value found in the runtime `ts.SyntaxKind` enum.
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
            kindNum === ts.SyntaxKind.BinaryExpression
                ? 0
                : branchWeightOf({ kind: kindNum } as ts.Node);
        const isClassDefining =
            ts.isClassDeclaration({ kind: kindNum } as ts.Node) ||
            ts.isClassExpression({ kind: kindNum } as ts.Node);
        const kind = kindOf({ kind: kindNum } as ts.Node);
        const literal =
            kindNum === ts.SyntaxKind.NumericLiteral
                ? 1
                : kindNum === ts.SyntaxKind.StringLiteral ||
                    kindNum === ts.SyntaxKind.NoSubstitutionTemplateLiteral
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
 *
 * @param n - raw TypeScript node whose kind flags are needed.
 * @returns the memoized per-kind info; unknown future kinds get a conservatively computed
 * entry marked `special` so they are never treated as placeholders.
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
                : kindNum === ts.SyntaxKind.StringLiteral ||
                    kindNum === ts.SyntaxKind.NoSubstitutionTemplateLiteral
                  ? 2
                  : 0,
        special: true, // conservative: never treat an unknown kind as a placeholder
    };
}

/**
 * Default LanguageAdapter for TypeScript and JavaScript family files, and the owner of the
 * optional lazy TsNodeProjector fast path.
 *
 * Contract: `id` is `'typescript'` and `extensions` covers `.ts/.tsx/.js/.jsx/.mjs/.cjs`;
 * `parse` builds the complete normalized tree that the legacy analyzers consume, while
 * `project` builds only the lazy projection source for mode A/B. Both paths derive their
 * flags from the same module-level predicates, keeping projection byte-equivalent to
 * materialization.
 *
 * Failure semantics: `parse` and `project` are synchronous and never swallow exceptions
 * raised while decoding the source; callers that need the materialized fallback (such as
 * `tryCreateProjector`) catch them and call `parse` instead.
 */
export class TypeScriptAdapter implements LanguageAdapter {
    id = 'typescript' as const;
    extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

    /**
     * Parse TypeScript/JavaScript source text into a fully materialized normalized AST.
     *
     * @param content - raw source text; every consumed position is reported as 1-based
     * line/column coordinates.
     * @param filePath - virtual path that selects the TypeScript ScriptKind (and therefore
     * whether JSX/TSX syntax is enabled); it is also used for diagnostics.
     * @param seed - optional incremental projection seed; when a function-like subtree is
     * byte-identical to a cached one, its previously materialized children are reused
     * instead of rebuilt.
     * @returns the normalized AST whose root is the synthetic source-file node.
     * @throws Propagates any error the TypeScript parser raises while decoding the source,
     * so callers can fall back to another parser or surface the failure.
     */
    parse(content: string, filePath: string, seed?: ProjectionSeed): NormalizedAst {
        const sf = createSourceFile(filePath, content);
        return { root: this.mapNode(sf, undefined, undefined, sf, seed) };
    }

    /**
     * Build a lazy-projection source for a file: creates ONLY the ts.SourceFile (the
     * projector needs it for positions/text) — the full normalized tree is never built.
     *
     * @param content - raw source text to project.
     * @param filePath - virtual path selecting the TypeScript ScriptKind.
     * @param policy - projection policy deciding which optional fields (literals,
     * positions, names, complexity weight) are materialized on demand.
     * @returns a TsNodeProjector over the parsed source; the nullable return exists for
     * LanguageAdapter implementations that cannot project, while this one always returns
     * an instance.
     * @throws Propagates any error raised while decoding the source into a ts.SourceFile.
     */
    project(content: string, filePath: string, policy: ProjectionPolicy): NodeProjector | null {
        const sf = createSourceFile(filePath, content);
        return new TsNodeProjector(sf, policy);
    }

    /**
     * Return the root node of a parsed AST.
     *
     * @param ast - normalized AST produced by `parse`.
     * @returns the synthetic source-file node that owns every top-level item.
     */
    root(ast: NormalizedAst): NormalizedNode {
        return ast.root;
    }

    /**
     * Return the normalized children of a node.
     *
     * @param node - any normalized node produced by this adapter.
     * @returns the child array in materialized order, or an empty array for leaves (whose
     * `children` field is intentionally left undefined to save allocations).
     */
    children(node: NormalizedNode): NormalizedNode[] {
        return node.children || [];
    }

    // ------------------------------------------------------------------ mapping

    /**
     * Recursively materialize one raw node and its non-skippable children.
     *
     * The field shape and flag predicates are the byte-compatible contract every legacy
     * analyzer consumes; incremental seeds are consulted only for function-like nodes.
     *
     * @param n - raw TypeScript node to materialize.
     * @param parentTs - raw parent used for top-level and literal-context flags.
     * @param grandparentTs - raw grandparent used for const-bound literal flags.
     * @param sf - source file used for text and position lookups.
     * @param seed - optional incremental seed enabling subtree reuse for unchanged
     * function-like nodes; `undefined` disables reuse.
     * @returns the materialized normalized node.
     */
    private mapNode(
        n: ts.Node,
        parentTs: ts.Node | undefined,
        grandparentTs: ts.Node | undefined,
        sf: ts.SourceFile,
        seed?: ProjectionSeed,
    ): NormalizedNode {
        const kind = kindOf(n);
        const isLiteral = kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
        const fnLike = isFunctionLike(n);
        const isBinding = introducesBinding(n); // expensive predicate — compute once
        const isClassDefining = ts.isClassDeclaration(n) || ts.isClassExpression(n);
        // Positions are only materialized for nodes that can appear in an Issue
        // (literals, function-like units, and the bare `function` keyword). Every other
        // node skips the two line/column conversions + two Position objects (~86% of nodes).
        const isCall = kind === NodeKind.Call;
        const needsPos = isLiteral || fnLike || n.kind === ts.SyntaxKind.FunctionKeyword || isCall;
        // `name` is materialized for the node classes the analyzers/engine and the cross-file
        // symbol index consume (function-like units for complexity/large-file naming, class
        // definitions for the threaded className, binding sources for the binding name, and call
        // nodes for the referenced callee). Other nodes (~80%) skip the getText allocation.
        const needsName = fnLike || isClassDefining || isBinding || isCall;
        const name = isCall ? calleeNameOf(n, sf) : needsName ? nameOf(n, sf) : undefined;

        const node: NormalizedNode = {
            kind,
            // rawKind is only observable where complexity.ts reads it — the bare
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

        // Only allocate a children array when the node actually has non-skippable
        // children (leaf nodes — the majority — keep `children` undefined). The engine and
        // every analyzer already go through `node.children || []`, so this is a pure
        // allocation win (~5-7k fewer arrays per large file).
        // Reuse a previously-materialized function subtree when its byte span
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
// TS lazy projector (Mode A + Mode B).
// ---------------------------------------------------------------------------

/**
 * Lazy projection source for TypeScript-family files
 * (docs/02-parsers-and-ast/03-lazy-projection.md §2.5).
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

    /**
     * Create a lazy projection source over an already parsed source file.
     *
     * Initializes the empty mode-B caches (function subtrees, projected subtrees, raw child
     * lists) so the first projection only fills the cache it actually needs.
     *
     * @param sf - parsed TypeScript source file used for text and position lookups.
     * @param policy - projection policy shared by every node produced by this projector.
     */
    constructor(sf: ts.SourceFile, policy: ProjectionPolicy) {
        this.sf = sf;
        this.root = sf;
        this.policy = policy;
    }

    /**
     * Test whether a raw node is the TypeScript SourceFile root.
     *
     * @param raw - raw node emitted by this projector, or `undefined` when the engine asks
     * about the parent of the root.
     * @returns `true` only for a ts.SourceFile node; placeholders, undefined and every
     * other node kind yield `false`.
     */
    isSourceFile(raw: unknown): boolean {
        return !!raw && (raw as ts.Node).kind === ts.SyntaxKind.SourceFile;
    }

    /**
     * Project one raw TypeScript node into its normalized (possibly placeholder) form.
     *
     * Cache semantics: mode-B subtree nodes come from the subtree cache so the engine visit
     * and the complexity re-walk observe the same object; nodes without any
     * consumer-observable field collapse to the shared frozen placeholder instance.
     *
     * @param raw - raw ts.Node to project.
     * @param parentRaw - raw parent used to resolve top-level and literal-context flags.
     * @param grandparentRaw - raw grandparent used to resolve const-bound literal flags.
     * @returns the normalized node, reusing a cached subtree projection when one exists.
     */
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
        if (
            k === ts.SyntaxKind.BinaryExpression &&
            (n as ts.BinaryExpression).operatorToken.kind !== ts.SyntaxKind.EqualsToken
        ) {
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
        // Call nodes survive the placeholder gate when the scan needs symbol facts (every scan
        // does — policyFromAnalyzers sets `needSymbols`): without this the cross-file index saw an
        // empty projection while the materialized path saw every call site.
        const symbolCall = this.policy.needSymbols === true && info.kind === NodeKind.Call;
        if (
            !isLiteral &&
            !fnLike &&
            !isClassDefining &&
            !isBinding &&
            !isScope &&
            !symbolCall &&
            !(isFuncKw && this.policy.needComplexity) &&
            !topLevel
        ) {
            return OTHER_PLACEHOLDER;
        }

        // Call nodes always carry name + position: the cross-file symbol index consumes them on
        // every scan, independently of which analyzers the projection policy was built for.
        // `needSymbols` (set by policyFromAnalyzers) additionally names/positions declarations so
        // the projection fast path feeds the same index the materialized path does.
        const isCall = info.kind === NodeKind.Call;
        const wantsSymbols = this.policy.needSymbols === true;
        const declaration = fnLike || isClassDefining || isBinding;
        const needsPos =
            isCall ||
            (this.policy.needPositions && (isLiteral || fnLike || isFuncKw)) ||
            (wantsSymbols && declaration);
        const needsName = isCall || ((this.policy.needNames || wantsSymbols) && declaration);

        const node: NormalizedNode = {
            kind: info.kind,
            rawKind: isFuncKw && this.policy.needComplexity ? 'FunctionKeyword' : undefined,
            text: isLiteral && this.policy.needLiterals ? n.getText(this.sf) : undefined,
            start: needsPos ? posOf(n.getStart(this.sf), this.sf) : undefined,
            end: needsPos ? posOf(n.getEnd(), this.sf) : undefined,
            name: isCall ? calleeNameOf(n, this.sf) : needsName ? nameOf(n, this.sf) : undefined,
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
     *
     * @param raw - raw node whose children should be iterated.
     * @returns an iterable of non-skippable raw children in materialized order.
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
     *
     * @param fn - function-like raw node whose body subtree is being materialized.
     * @param parentRaw - raw parent of `fn`, used when projecting its direct children.
     * @param _grandparentRaw - accepted for signature symmetry with buildSubtree and
     * intentionally unused; grandparent context is not needed at this level.
     * @returns the projected direct children of `fn`, in materialized order.
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

    /**
     * Recursively materialize the cheap projection of every non-function-like descendant of
     * `fn`, while collecting the raw children the engine needs for its descent.
     *
     * @param fn - raw subtree root; its direct children are projected and non-function-like
     * descendants are recursed into.
     * @param parentRaw - raw parent of `fn`, forwarded so literal context flags (const-bound
     * and tolerated) match the materializing path.
     * @param rawOut - collector receiving the direct raw children of `fn`; `null` for
     * recursive calls that only need the projected children.
     * @returns the projected children array for `fn`, including nested projections.
     */
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
     *
     * @param n - raw node to project cheaply.
     * @param parentRaw - raw parent used for literal-context flags.
     * @param grandparentRaw - raw grandparent used for const-bound literal flags.
     * @returns the cheap normalized node; non-function-like results are cached for reuse.
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
            } else if (info.kind === NodeKind.Call) {
                // Subtree materialization must name calls too: the cross-file symbol index reads
                // them here exactly as it does on the top-level projection path, and this C6
                // builder is what a Mode B function body actually produces.
                node.name = calleeNameOf(n, this.sf) ?? undefined;
                node.start = posOf(n.getStart(this.sf), this.sf);
                node.end = posOf(n.getEnd(), this.sf);
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
