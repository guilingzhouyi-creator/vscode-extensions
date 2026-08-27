import {
  NodeKind,
  NormalizedNode,
  NormalizedAst,
  LanguageAdapter,
} from './multilang';

/**
 * RustAdapter — parses Rust with tree-sitter-rust (pure syntax, no rustc / type info).
 *
 * The three built-in analyzers are syntax-level, so the tree-sitter CST is sufficient. The
 * adapter maps tree-sitter node types to the normalized model and precomputes the semantic
 * flags the engine/analyzers consume. tree-sitter is required lazily (inside `parse`), so the
 * module loads fine even when the native binding is unavailable — only Rust scanning fails,
 * loudly and locally, in that case.
 *
 * Known approximation: `let x = |..| ...` closures are the binding source for anonymous
 * functions (mirrors TS `const x = () => ...`); macros (println!/format!/...) and attributes
 * are treated as tolerated string contexts (like the TS i18n/JSX tolerations).
 */

// Lazily-initialized shared parser (safe: parse is synchronous, workers get their own copy).
let parser: any = null;
function rustParser(): any {
  if (!parser) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Parser = require('tree-sitter');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Rust = require('tree-sitter-rust');
    const p = new Parser();
    p.setLanguage(Rust);
    parser = p;
  }
  return parser;
}

const TOP_LEVEL_TYPES = new Set([
  'function_item',
  'struct_item',
  'enum_item',
  'impl_item',
  'trait_item',
  'const_item',
  'static_item',
  'use_declaration',
  'mod_item',
  'type_item',
  'union_item',
]);

const BRANCH_TYPES = new Set([
  'if_expression',
  'while_expression',
  'for_expression',
  'loop_expression',
  'match_expression',
  'match_arm',
]);

const NESTING_TYPES = new Set([
  'block',
  'if_expression',
  'while_expression',
  'for_expression',
  'loop_expression',
  'match_expression',
]);

export class RustAdapter implements LanguageAdapter {
  id = 'rust' as const;
  extensions = ['.rs'];

  parse(content: string, _filePath: string): NormalizedAst {
    const tree = rustParser().parse(content);
    return { root: this.mapNode(tree.rootNode, undefined) };
  }

  root(ast: NormalizedAst): NormalizedNode {
    return ast.root;
  }

  children(node: NormalizedNode): NormalizedNode[] {
    return node.children || [];
  }

  // ------------------------------------------------------------------ mapping

  private mapNode(sn: any, parent: any): NormalizedNode {
    const kind = this.kindOf(sn, parent);
    const isLiteral =
      kind === NodeKind.NumericLiteral || kind === NodeKind.StringLiteral;
    const fnLike = kind === NodeKind.Function || kind === NodeKind.Method;
    const isClassDefining =
      kind === NodeKind.Impl || kind === NodeKind.Struct || kind === NodeKind.Trait;
    // P0-4: the expensive introducesBinding predicate (a childForFieldName lookup) is
    // computed ONCE and reused by the three fields below (previously 3 calls per node);
    // `name` is only materialized for the node classes the analyzers/engine consume.
    const isBinding = this.introducesBinding(sn);
    const name = fnLike || isClassDefining || isBinding ? this.nameOf(sn) : undefined;

    const node: NormalizedNode = {
      kind,
      rawKind: sn.type,
      // Literals carry their text (constants analyzer); other nodes skip it (lazy).
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
      // Rust has no constructor keyword — every node is definitively not a constructor.
      // Written explicitly (not left absent) so rust nodes share the same property
      // insertion order / hidden class as the TS and oxc adapters (C6 shape audit).
      isConstructor: false,
    };

    const topLevel = !!parent && parent.type === 'source_file' && TOP_LEVEL_TYPES.has(sn.type);
    node.topLevel = topLevel;
    node.exported =
      topLevel &&
      (sn.namedChildren || []).some(
        (c: any) => c.type === 'visibility_modifier' && c.text.startsWith('pub'),
      );

    if (isLiteral) {
      node.isConstBound = this.isConstBoundOf(sn, parent);
      node.tolerated = this.isToleratedOf(sn, parent);
    }

    // P1-4: only allocate a children array when the node has named children (leaves —
    // identifiers, literals, punctuation — keep `children` undefined). The engine and
    // analyzers already consume via `node.children || []`.
    let kids: NormalizedNode[] | undefined;
    for (const c of sn.namedChildren || []) {
      (kids ??= []).push(this.mapNode(c, sn));
    }
    node.children = kids;
    return node;
  }

  private kindOf(sn: any, parent: any): NodeKind {
    switch (sn.type) {
      case 'source_file':
        return NodeKind.SourceFile;
      case 'function_item':
        // A function declared inside an impl/trait block is a method.
        return parent && (parent.type === 'impl_item' || parent.type === 'trait_item')
          ? NodeKind.Method
          : NodeKind.Function;
      case 'closure_expression':
        return NodeKind.Function;
      case 'struct_item':
        return NodeKind.Struct;
      case 'impl_item':
        return NodeKind.Impl;
      case 'trait_item':
        return NodeKind.Trait;
      case 'let_declaration':
      case 'static_item':
        return NodeKind.Variable;
      case 'const_item':
        return NodeKind.Constant;
      case 'integer_literal':
      case 'float_literal':
        return NodeKind.NumericLiteral;
      case 'string_literal':
        return NodeKind.StringLiteral;
      case 'char_literal':
      case 'boolean_literal':
        return NodeKind.Literal;
      case 'call_expression':
        return NodeKind.Call;
      case 'binary_expression':
        return NodeKind.BinaryExpr;
      case 'block':
        return NodeKind.Block;
      default:
        if (BRANCH_TYPES.has(sn.type)) return NodeKind.ControlFlow;
        return NodeKind.Other;
    }
  }

  private branchWeightOf(sn: any): number {
    if (BRANCH_TYPES.has(sn.type)) return 1;
    if (sn.type === 'try_expression') return 1; // `?` operator
    if (sn.type === 'binary_expression') {
      const op = sn.childForFieldName && sn.childForFieldName('operator');
      if (op && (op.text === '&&' || op.text === '||')) return 1;
    }
    return 0;
  }

  private nameOf(sn: any): string | null {
    const name = sn.childForFieldName && sn.childForFieldName('name');
    if (name && name.type === 'identifier') return name.text;
    // `let x = ...` — the pattern is the binding name.
    if (sn.type === 'let_declaration') {
      const pat = sn.childForFieldName && sn.childForFieldName('pattern');
      if (pat) {
        if (pat.type === 'identifier') return pat.text;
        const id = (pat.namedChildren || []).find((c: any) => c.type === 'identifier');
        if (id) return id.text;
      }
    }
    // `impl Foo ...` — the implemented type is the class name.
    if (sn.type === 'impl_item') {
      const ty = sn.childForFieldName && sn.childForFieldName('type');
      if (ty) return ty.text;
    }
    return null;
  }

  /** `let x = |..| ...` — a closure bound to a name (mirrors TS `const x = () => ...`). */
  private introducesBinding(sn: any): boolean {
    if (sn.type !== 'let_declaration') return false;
    const val = sn.childForFieldName && sn.childForFieldName('value');
    return !!val && val.type === 'closure_expression';
  }

  private isConstBoundOf(sn: any, parent: any): boolean {
    if (!parent) return false;
    if (parent.type === 'const_item' || parent.type === 'static_item') return true;
    if (parent.type === 'enum_variant') return true; // discriminant
    return false;
  }

  private isToleratedOf(sn: any, parent: any): boolean {
    if (!parent) return false;
    if (sn.type === 'integer_literal' || sn.type === 'float_literal') {
      if (parent.type === 'index_expression' || parent.type === 'tuple_index_expression')
        return true;
      return false;
    }
    // Strings: macros (println!/format!/panic!...) behave like i18n; attributes are config.
    if (parent.type === 'macro_invocation' || parent.type === 'token_tree') return true;
    if (parent.type === 'attribute_item' || parent.type === 'attribute') return true;
    if (parent.type === 'use_declaration' || parent.type === 'use_wildcard') return true;
    return false;
  }
}
