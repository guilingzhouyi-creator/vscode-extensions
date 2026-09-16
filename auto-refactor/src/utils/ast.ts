/**
 * Module: Core Engine — TypeScript AST Utilities & ts-free Helper Re-export Surface
 * File Path: src/utils/ast.ts
 * Architecture Role: Shared TypeScript-compiler utility layer below the language adapter;
 *   the single definition site of function-like node classification and parent-pointer-free
 *   SourceFile creation, plus the compatibility re-export surface for extracted helpers.
 * Dependencies & Triggers: `typescript` (hard top-level import); Position / IssueLocation
 *   types from ../core/types and NormalizedNode from ../core/multilang; imported by
 *   core/typescriptAdapter.ts and lazy-required by core/analyzer.ts and core/worker.ts only
 *   when a legacy analyzer needs a real SourceFile on the typescript parser path.
 * Responsibilities: Detect function-like node kinds (declaration, expression, arrow,
 *   method, constructor, getter, setter); create SourceFiles with ScriptTarget.Latest and
 *   setParentNodes:false; map byte offsets to 1-based Position / IssueLocation values;
 *   re-export countLineStats and locN so existing import sites keep compiling.
 * Exit Semantics & Design Rationale: All helpers are synchronous and side-effect-free;
 *   createSourceFile tolerates syntactically invalid text (the compiler keeps diagnostics in
 *   the tree) while getPos/loc assume valid offsets and nodes. Parent pointers are skipped
 *   because profiling measured ~15-20% faster parsing and analyzers thread the parent
 *   context they need explicitly; the separate ts-free modules keep `typescript` out of the
 *   worker hot path.
 */
import * as ts from 'typescript';
import type { Position, IssueLocation } from '../core/types';

// Re-export the ts-free helpers so existing import sites (main-process consumers, the
// analyzer `analyze()` contract) keep working unchanged. NOTE: importing these THROUGH
// this module still loads `typescript` (this module requires it at the top level), so the
// worker hot path must import them from the ts-free modules directly:
//   - `countLineStats` from './linestats'
//   - `locN` from './normalized'
export { countLineStats } from './linestats';
export { locN } from './normalized';

/** Function-like node kinds that constitute a separate complexity/unit boundary. */
const FUNCTION_LIKE = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.FunctionExpression,
    ts.SyntaxKind.ArrowFunction,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.Constructor,
    ts.SyntaxKind.GetAccessor,
    ts.SyntaxKind.SetAccessor,
]);

/**
 * Report whether a node belongs to the function-like kinds that form complexity boundaries.
 *
 * Function declarations, function and arrow expressions, methods, constructors, getters and
 * setters count as separate units; every other kind, including `undefined`, does not.
 *
 * @param node - Candidate node taken from a SourceFile traversal; may be `undefined` at a
 *   traversal boundary, in which case the answer is `false` rather than an error.
 * @returns `true` only for the exact kinds registered in `FUNCTION_LIKE`, otherwise `false`.
 */
export function isFunctionLike(node: ts.Node | undefined): boolean {
    return !!node && FUNCTION_LIKE.has(node.kind);
}

/**
 * Create a TypeScript SourceFile WITHOUT parent pointers (setParentNodes: false).
 *
 * Skipping parent pointers is a deliberate, measured performance choice: profiling showed it
 * cuts parse time by ~15-20% on large codebases. Everything we need (line/column, text,
 * children, kind) is available from the node itself plus the SourceFile, so analyzers thread
 * any required context (parent/grandparent, enclosing class) explicitly through their traversal.
 *
 * @param fileName - Logical file name recorded on the resulting SourceFile; it is also what
 *   issue locations report, so callers should pass the repository-relative POSIX path.
 * @param content - Raw source text; syntactically invalid input is tolerated because the
 *   compiler keeps diagnostics inside the returned tree rather than throwing during parse.
 * @returns A `ScriptTarget.Latest` SourceFile with parent pointers disabled; traversals must
 *   thread parent context explicitly because `node.parent` is always undefined.
 */
export function createSourceFile(fileName: string, content: string): ts.SourceFile {
    return ts.createSourceFile(
        fileName,
        content,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ false,
    );
}

/**
 * Convert a zero-based character offset into a 1-based line and column position.
 *
 * @param sf - SourceFile that owns the offset and supplies the line map.
 * @param pos - Zero-based character offset; it must fall inside the file, because an
 *   out-of-range value is clamped by the compiler line map and yields a meaningless position.
 * @returns A `Position` with 1-based `line` and `column`, matching the issue-reporting model.
 */
export function getPos(sf: ts.SourceFile, pos: number): Position {
    const lc = sf.getLineAndCharacterOfPosition(pos);
    return { line: lc.line + 1, column: lc.character + 1 };
}

/**
 * Build an issue location spanning a node from its start (inclusive) to its end (exclusive).
 *
 * @param sf - SourceFile used for both the reported file name and the offset-to-line mapping.
 * @param node - Node to locate; leading trivia is skipped by `getStart`, so the location points
 *   at the first meaningful token rather than at preceding whitespace or comments.
 * @returns An `IssueLocation` whose `start` and `end` are 1-based positions in `sf.fileName`.
 */
export function loc(sf: ts.SourceFile, node: ts.Node): IssueLocation {
    return {
        file: sf.fileName,
        start: getPos(sf, node.getStart(sf)),
        end: getPos(sf, node.getEnd()),
    };
}
