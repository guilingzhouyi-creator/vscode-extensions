/**
 * Module: Core Engine — Markdown Documentation Adapter
 * File Path: src/core/ast/markdown-adapter.ts
 * Architecture Role: Minimal LanguageAdapter claiming `.md` so documentation is discovered and
 *     served to content-oriented rules instead of silently falling back to the TypeScript parser
 * Dependencies & Triggers: multilang contracts (`NodeKind`/`NormalizedNode`/`NormalizedAst`/
 *     `LanguageAdapter`); routed whenever a `.md` file is scanned
 * Responsibilities: Return a statement-free normalized AST (one source-file root, no children)
 *     so AST-based analyzers contribute nothing while line-based documentation rules run
 * Exit Semantics & Design Rationale: `parse` is pure and never throws. Markdown has no code
 *     AST, and fabricating nodes would make complexity/constants/large-file analyze prose as
 *     code; claiming the extension is what prevents the engine's fail-closed
 *     LANG-UNSUPPORTED diagnostic for a file type we do intend to audit.
 */
import type { NormalizedNode, NormalizedAst, LanguageAdapter } from './multilang';
import { NodeKind } from './multilang';

/**
 * Markdown language adapter: an empty document root plus the standard traversal contract.
 */
export class MarkdownAdapter implements LanguageAdapter {
    id = 'markdown' as const;
    extensions = ['.md'];

    /**
     * Build the document AST for a markdown file.
     *
     * @param _content - Raw markdown text (line-based rules read it from the analyzer context).
     * @param _filePath - Accepted for LanguageAdapter symmetry.
     * @returns An AST whose root is a childless source-file node.
     */
    parse(_content: string, _filePath: string): NormalizedAst {
        return { root: this.documentRoot() };
    }

    /**
     * Return the root node of a parsed document AST.
     *
     * @param ast - Normalized AST produced by `parse`.
     * @returns The childless document root.
     */
    root(ast: NormalizedAst): NormalizedNode {
        return ast.root;
    }

    /**
     * Return the normalized children of a node.
     *
     * @param node - Any node produced by this adapter.
     * @returns An empty array: markdown exposes no traversable nodes.
     */
    children(node: NormalizedNode): NormalizedNode[] {
        return node.children || [];
    }

    /**
     * Construct the childless document root shared by every parsed markdown file.
     *
     * @returns A normalized source-file node carrying the uniform adapter field shape.
     */
    private documentRoot(): NormalizedNode {
        return {
            kind: NodeKind.SourceFile,
            rawKind: 'document',
            functionLike: false,
            isClassDefining: false,
            introducesBinding: false,
            bindingName: null,
            hasFunctionInitializer: false,
            increasesNesting: false,
            isConstructor: false,
            topLevel: true,
            exported: false,
        };
    }
}
