/**
 * Module: Core Engine — Python Language Adapter
 * File Path: src/core/ast/python-adapter.ts
 * Architecture Role: LanguageAdapter implementation that translates a tree-sitter-python
 *     CST into the normalized AST consumed by the shared single-pass traversal
 * Dependencies & Triggers: imports the NodeKind / NormalizedNode / NormalizedAst /
 *     LanguageAdapter contracts from ./multilang; lazily requires tree-sitter and
 *     tree-sitter-python inside parse(); triggered when a .py file is routed to the Python
 *     adapter in-process or in a worker
 * Responsibilities: Map tree-sitter node types to NodeKind; precompute semantic flags
 *     (functionLike, class definitions, method-vs-function, topLevel/exported, binding,
 *     nesting, branch weight, const-bound and tolerated literals); carry literal text and
 *     build normalized children arrays
 * Exit Semantics & Design Rationale: `parse` is synchronous and throws when the native
 *     binding cannot be loaded; the lazy require keeps this module importable and confines
 *     grammar failures to Python scans. A syntax-only CST is sufficient because every
 *     built-in analyzer is syntax-level; docstring/decorator/subscript/dict-key literals are
 *     tolerated so the constants analyzer reports real magic values instead of prose.
 */

import type { NormalizedNode, NormalizedAst, LanguageAdapter } from './multilang';
import { NodeKind } from './multilang';

// Lazily-initialized shared parser (safe: parse is synchronous, workers get their own copy).
let parser: any = null;

/**
 * Lazily initialize and return the shared tree-sitter-python parser.
 *
 * @returns The cached Parser configured with the Python grammar; the first call requires the
 *     native bindings, later calls reuse the same instance.
 */
function pythonParser(): any {
    if (!parser) {
        const Parser = require('tree-sitter');
        const Python = require('tree-sitter-python');
        const p = new Parser();
        p.setLanguage(Python);
        parser = p;
    }
    return parser;
}

/** Branch constructs that each add one to a function's cyclomatic complexity. */
const BRANCH_TYPES = new Set([
    'if_statement',
    'elif_clause',
    'for_statement',
    'while_statement',
    'except_clause',
    'case_clause',
    'conditional_expression',
    'boolean_operator',
    'for_in_clause',
    'if_clause',
]);

/** Control/block nodes whose children sit one nesting level deeper. */
const NESTING_TYPES = new Set([
    'block',
    'if_statement',
    'elif_clause',
    'else_clause',
    'for_statement',
    'while_statement',
    'try_statement',
    'except_clause',
    'finally_clause',
    'with_statement',
    'match_statement',
    'case_clause',
]);

/** tree-sitter-python node type for a class definition; class/top-level classification. */
const PY_CLASS_DEFINITION = 'class_definition';

/** tree-sitter-python node type for an assignment; name/binding resolution. */
const PY_ASSIGNMENT = 'assignment';

/** tree-sitter-python node type for a bare identifier; name and const-target lookup. */
const PY_IDENTIFIER = 'identifier';

/** Declaration node types that count as a top-level symbol when they sit at module scope. */
const TOP_LEVEL_TYPES = new Set([
    'function_definition',
    PY_CLASS_DEFINITION,
    'decorated_definition',
    'if_statement',
    'type_alias_statement',
]);

/** `MAX_RETRIES`-style names: Python's conventional module-level constant shape. */
const CONSTANT_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/** Inheritance context carried down the recursion while mapping one file. */
interface MapContext {
    /** True inside a module-level constant assignment (literal values are const-bound). */
    constBound: boolean;
}

/**
 * Python LanguageAdapter translating a tree-sitter-python CST into the shared normalized AST.
 *
 * Contract: `id` is `'python'` and `extensions` is `['.py']`, so the adapter registry routes
 * `.py` files here; `parse` materializes the whole tree eagerly and `root` / `children`
 * expose it to the shared single-pass traversal without any further parsing.
 */
export class PythonAdapter implements LanguageAdapter {
    id = 'python' as const;
    extensions = ['.py'];

    /**
     * Parse Python source text into a fully materialized normalized AST.
     *
     * @param content - Raw Python source text; CST positions become 1-based line/column pairs.
     * @param _filePath - Accepted for LanguageAdapter symmetry; diagnostics carry the caller path.
     * @returns The normalized AST whose root is the synthetic module (source-file) node.
     * @throws Error when the lazy `tree-sitter` / `tree-sitter-python` require fails.
     */
    parse(content: string, _filePath: string): NormalizedAst {
        const tree = pythonParser().parse(content);
        return { root: this.mapNode(tree.rootNode, undefined, { constBound: false }) };
    }

    /**
     * Return the root node of a parsed Python AST.
     *
     * @param ast - Normalized AST produced by `parse`.
     * @returns The module node owning every top-level statement.
     */
    root(ast: NormalizedAst): NormalizedNode {
        return ast.root;
    }

    /**
     * Return the normalized children of a node.
     *
     * @param node - Any normalized node produced by this adapter.
     * @returns Child array in source order; leaves yield an empty array.
     */
    children(node: NormalizedNode): NormalizedNode[] {
        return node.children || [];
    }

    // ------------------------------------------------------------------ mapping

    /**
     * Recursively materialize one tree-sitter node and its named children.
     *
     * @param sn - Raw tree-sitter node to map.
     * @param parent - Raw parent used for literal-context and tolerated-context flags.
     * @param ctx - Inheritance context propagated from enclosing declarations.
     * @returns The normalized node with the exact field shape the analyzers consume.
     */
    private mapNode(sn: any, parent: any, ctx: MapContext): NormalizedNode {
        const kind = this.kindOf(sn);
        const isLiteral =
            kind === NodeKind.NumericLiteral ||
            kind === NodeKind.StringLiteral ||
            (kind === NodeKind.Literal && this.isAtomLiteral(sn));
        const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
        const isClassDefining = kind === NodeKind.Class;
        const isBinding = this.introducesBinding(sn);
        // Call nodes carry the callee text so the cross-file symbol index can resolve references;
        // `a.b()` reduces to the final segment, matching the TypeScript adapter's contract.
        const callCallee = sn.type === 'call' ? this.callNameOf(sn) : null;
        const name =
            callCallee ?? (fnLike || isClassDefining || isBinding ? this.nameOf(sn) : undefined);

        const node: NormalizedNode = {
            kind,
            rawKind: sn.type,
            // Literals carry their raw source text (constants analyzer reads it as the value).
            text: isLiteral ? sn.text : undefined,
            start: { line: sn.startPosition.row + 1, column: sn.startPosition.column + 1 },
            end: { line: sn.endPosition.row + 1, column: sn.endPosition.column + 1 },
            name,
            isNumeric: kind === NodeKind.NumericLiteral,
            isString: kind === NodeKind.StringLiteral,
            branchWeight: this.branchWeightOf(sn),
            functionLike: fnLike,
            isClassDefining,
            introducesBinding: isBinding,
            bindingName: isBinding ? (name ?? null) : null,
            hasFunctionInitializer: isBinding,
            increasesNesting: NESTING_TYPES.has(sn.type),
            // Python has no constructor keyword; `__init__` stays a plain Method so complexity
            // reports the idiomatic `Class.__init__` name instead of a synthetic "constructor".
            isConstructor: false,
        };

        const topLevel = this.isTopLevel(sn);
        node.topLevel = topLevel;
        node.exported = topLevel && !this.isPrivateName(this.nameOf(sn));

        if (isLiteral) {
            node.isConstBound = ctx.constBound || parent?.type === PY_ASSIGNMENT;
            node.tolerated = this.isToleratedOf(sn, parent);
        }

        const childCtx: MapContext = {
            constBound: ctx.constBound || (sn.type === PY_ASSIGNMENT && this.isConstTarget(sn)),
        };
        let kids: NormalizedNode[] | undefined;
        for (const c of sn.namedChildren || []) {
            const kid = this.mapNode(c, sn, childCtx);
            (kids ??= []).push(kid);
        }
        node.children = kids;
        return node;
    }

    /**
     * Map a tree-sitter node type to the normalized NodeKind.
     *
     * @param sn - Raw tree-sitter node.
     * @returns The normalized kind; branch types map to ControlFlow, unknown types to Other.
     */
    private kindOf(sn: any): NodeKind {
        switch (sn.type) {
            case 'module':
                return NodeKind.SourceFile;
            case 'function_definition':
                return this.isClassMember(sn) ? NodeKind.Method : NodeKind.Function;
            case 'lambda':
                return NodeKind.Function;
            case PY_CLASS_DEFINITION:
                return NodeKind.Class;
            case PY_ASSIGNMENT:
                return this.isConstTarget(sn) ? NodeKind.Constant : NodeKind.Variable;
            case 'integer':
            case 'float':
                return NodeKind.NumericLiteral;
            case 'string':
            case 'concatenated_string':
                return NodeKind.StringLiteral;
            case 'true':
            case 'false':
            case 'none':
                return NodeKind.Literal;
            case 'call':
                return NodeKind.Call;
            case 'binary_operator':
                return NodeKind.BinaryExpr;
            case 'block':
                return NodeKind.Block;
            default:
                if (BRANCH_TYPES.has(sn.type)) return NodeKind.ControlFlow;
                return NodeKind.Other;
        }
    }

    /**
     * Compute the cyclomatic branch weight of a node.
     *
     * @param sn - Raw tree-sitter node.
     * @returns `1` for branch constructs (if/elif/for/while/except/case/`and`/`or`/ternary),
     *     otherwise `0`.
     */
    private branchWeightOf(sn: any): number {
        return BRANCH_TYPES.has(sn.type) ? 1 : 0;
    }

    /**
     * Resolve whether a function is a direct member of a class body.
     *
     * Walks outward through the block/decorator wrappers so decorated methods are still
     * recognized, while functions nested inside a method body stay plain functions.
     *
     * @param sn - Raw `function_definition` node.
     * @returns `true` when the nearest enclosing declaration is a class definition.
     */
    private isClassMember(sn: any): boolean {
        let p = sn.parent;
        while (p && (p.type === 'decorated_definition' || p.type === 'block')) p = p.parent;
        return !!p && p.type === PY_CLASS_DEFINITION;
    }

    /**
     * Resolve whether a node is a module-scope declaration.
     *
     * Python wraps module-level assignments in an `expression_statement`, so the wrapper — not
     * the inner `assignment` — is the direct child the metric collectors count. Imports are
     * deliberately excluded: they bind a name but are not exported declarations, matching how
     * the TypeScript adapter treats import statements.
     *
     * @param sn - Raw tree-sitter node.
     * @returns `true` for declarations directly under the module.
     */
    private isTopLevel(sn: any): boolean {
        const p = sn.parent;
        if (!p || p.type !== 'module') return false;
        if (TOP_LEVEL_TYPES.has(sn.type)) return true;
        return (
            sn.type === 'expression_statement' &&
            (sn.namedChildren || []).some((c: any) => c.type === PY_ASSIGNMENT)
        );
    }

    /**
     * Resolve whether an assignment targets a module-level constant name.
     *
     * @param sn - Raw `assignment` node.
     * @returns `true` when the left-hand side is a single `UPPER_SNAKE_CASE` identifier.
     */
    private isConstTarget(sn: any): boolean {
        const left = sn.childForFieldName && sn.childForFieldName('left');
        return !!left && left.type === PY_IDENTIFIER && CONSTANT_NAME_RE.test(left.text);
    }

    /**
     * Resolve the declared name of a node for naming consumers.
     *
     * @param sn - Raw tree-sitter node.
     * @returns The resolved non-empty name, or null when the node has none.
     */
    /**
     * Callee name of a tree-sitter `call` node, reduced to its final segment.
     *
     * @param sn - `call` syntax node.
     * @returns Callee text (final segment for attribute access), or null when absent.
     */
    private callNameOf(sn: any): string | null {
        const fn =
            typeof sn.childForFieldName === 'function' ? sn.childForFieldName('function') : null;
        const text = fn && typeof fn.text === 'string' ? fn.text : null;
        if (!text) return null;
        const dot = text.lastIndexOf('.');
        return dot >= 0 ? text.slice(dot + 1) : text;
    }

    private nameOf(sn: any): string | null {
        if (sn.type === 'decorated_definition') {
            const inner = (sn.namedChildren || []).find(
                (c: any) => c.type === 'function_definition' || c.type === PY_CLASS_DEFINITION,
            );
            return inner ? this.nameOf(inner) : null;
        }
        if (sn.type === 'expression_statement') {
            const inner = (sn.namedChildren || []).find((c: any) => c.type === PY_ASSIGNMENT);
            return inner ? this.nameOf(inner) : null;
        }
        const name = sn.childForFieldName && sn.childForFieldName('name');
        if (name && name.type === PY_IDENTIFIER) return name.text;
        if (sn.type === PY_ASSIGNMENT) {
            const left = sn.childForFieldName && sn.childForFieldName('left');
            if (left) {
                if (left.type === PY_IDENTIFIER) return left.text;
                const id = (left.namedChildren || []).find((c: any) => c.type === PY_IDENTIFIER);
                if (id) return id.text;
            }
        }
        return null;
    }

    /**
     * Report whether a name is private by Python convention.
     *
     * @param name - Resolved symbol name, or null when the node has none.
     * @returns `true` for underscore-prefixed names, which the export metric must not count.
     */
    private isPrivateName(name: string | null): boolean {
        return !!name && name.startsWith('_');
    }

    /**
     * Report whether a `lambda` is bound to a name by its assignment.
     *
     * @param sn - Raw tree-sitter node.
     * @returns `true` for `handler = lambda ...`, mirroring TS `const handler = () => ...`.
     */
    private introducesBinding(sn: any): boolean {
        if (sn.type !== PY_ASSIGNMENT) return false;
        const right = sn.childForFieldName && sn.childForFieldName('right');
        return !!right && right.type === 'lambda';
    }

    /**
     * Report whether a `true`/`false`/`none` node is a real atom literal.
     *
     * @param sn - Raw tree-sitter node.
     * @returns Always true; keeps the literal classification explicit for future grammars.
     */
    private isAtomLiteral(sn: any): boolean {
        return sn.type === 'true' || sn.type === 'false' || sn.type === 'none';
    }

    /**
     * Resolve whether a literal sits in a tolerated context.
     *
     * @param sn - Literal node to classify.
     * @param parent - Raw parent; undefined means the literal has no parent context.
     * @returns `true` for docstrings/bare expressions, decorator arguments, subscript indices
     *     and dictionary keys, where the constants analyzer must stay silent.
     */
    private isToleratedOf(sn: any, parent: any): boolean {
        if (!parent) return false;
        if (parent.type === 'expression_statement') return true;
        if (parent.type === 'decorator') return true;
        if (parent.type === 'subscript') return true;
        if (parent.type === 'pair') {
            const key = parent.childForFieldName && parent.childForFieldName('key');
            return !!key && key.startIndex === sn.startIndex;
        }
        return false;
    }
}
