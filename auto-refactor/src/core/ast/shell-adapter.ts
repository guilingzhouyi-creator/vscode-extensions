/**
 * Module: Core Engine — Shell Script Adapter
 * File Path: src/core/ast/shell-adapter.ts
 * Architecture Role: Minimal LanguageAdapter claiming the POSIX-shell and PowerShell extensions
 *   so gate scripts are discoverable and judged by line-oriented rules instead of falling back to
 *   the TypeScript parser.
 * Dependencies & Triggers: multilang contracts (`NodeKind`/`NormalizedNode`/`NormalizedAst`/
 *   `LanguageAdapter`); routed whenever a `.sh`/`.bash`/`.zsh`/`.ps1`/`.psm1`/`.psd1` file is
 *   scanned.
 * Responsibilities: Return a statement-free normalized AST (one source-file root, no children)
 *   so AST-based analyzers contribute nothing while the shell analyzers, which read
 *   `ctx.content` directly, do the judging.
 * Exit Semantics & Design Rationale: `parse` is pure and never throws. Shell has no AST that the
 *   shared NormalizedNode IR models, and fabricating one would mislead complexity, constants, and
 *   dependency-graph into reading shell text as program structure. Claiming the extension is what
 *   prevents the engine's fail-closed LANG-UNSUPPORTED diagnostic for the file type the gate
 *   guards themselves are written in: gate feedback vocabulary is exactly what needs judging, and
 *   it lives in these scripts.
 *
 *   Both dialects share one adapter because the shell analyzers already select their dialect rules
 *   from the path; splitting the adapter by dialect would duplicate the same childless root twice
 *   without changing any verdict.
 */
import type { NormalizedNode, NormalizedAst, LanguageAdapter } from './multilang';
import { NodeKind } from './multilang';

/**
 * Shell language adapter: an empty document root plus the traversal contract.
 */
export class ShellAdapter implements LanguageAdapter {
    id = 'shell' as const;
    extensions = ['.sh', '.bash', '.zsh', '.ps1', '.psm1', '.psd1'];

    /**
     * Build the document AST for a shell script.
     *
     * @param _content - Raw script text (the shell analyzers read it from the analyzer context).
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
     * @returns An empty array: shell exposes no traversable nodes under this IR.
     */
    children(node: NormalizedNode): NormalizedNode[] {
        return node.children || [];
    }

    /**
     * Construct the childless document root shared by every parsed script.
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
