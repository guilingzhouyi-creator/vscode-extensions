/**
 * Module: Core Engine — Structured Data Adapter (YAML)
 * File Path: src/core/ast/data-adapter.ts
 * Architecture Role: Minimal LanguageAdapter claiming `.yml`/`.yaml` so pipeline definitions and
 *   configuration are discoverable and served to line-oriented rules instead of falling back to
 *   the TypeScript parser.
 * Dependencies & Triggers: multilang contracts (`NodeKind`/`NormalizedNode`/`NormalizedAst`/
 *   `LanguageAdapter`); routed whenever a `.yml` or `.yaml` file is scanned.
 * Responsibilities: Return a statement-free normalized AST (one source-file root, no children)
 *   so AST-based analyzers contribute nothing while text-oriented rules run on the raw lines.
 * Exit Semantics & Design Rationale: `parse` is pure and never throws. YAML carries no code AST,
 *   and fabricating nodes would make complexity/constants/large-file read indentation and keys as
 *   program structure. Claiming the extension is what prevents the engine's fail-closed
 *   LANG-UNSUPPORTED diagnostic for a file type we do intend to audit: a CI workflow is gate
 *   surface, and gate feedback vocabulary lives there.
 *
 *   This is deliberately the same shape as the markdown adapter rather than a shared base class.
 *   The two claim different languages for different reasons (documentation prose vs. pipeline
 *   configuration), and a shared base would invite one to be changed to suit the other.
 */
import { BaseAstAdapter, NodeKind, type NormalizedNode, type NormalizedAst } from './multilang';

/**
 * Structured-data adapter for YAML: an empty document root plus the traversal contract.
 */
export class DataAdapter extends BaseAstAdapter {
    id = 'yaml' as const;
    extensions = ['.yml', '.yaml'];

    /**
     * Build the document AST for a YAML file.
     *
     * @param _content - Raw YAML text (line-based rules read it from the analyzer context).
     * @param _filePath - Accepted for LanguageAdapter symmetry.
     * @returns An AST whose root is a childless source-file node.
     */
    parse(_content: string, _filePath: string): NormalizedAst {
        return { root: this.documentRoot() };
    }

    /**
     * Construct the childless document root shared by every parsed YAML file.
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
