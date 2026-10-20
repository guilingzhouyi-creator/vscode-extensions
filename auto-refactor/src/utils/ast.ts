/**
 * Module: Core Engine — TypeScript AST Utilities & ts-free Helper Re-export Surface
 * File Path: src/utils/ast.ts
 * Architecture Role: Shared TypeScript-compiler utility layer below the language adapter;
 *   the single definition site of function-like node classification and parent-pointer-bearing
 *   SourceFile creation, plus the compatibility re-export surface for extracted helpers.
 * Dependencies & Triggers: `typescript` (hard top-level import); Position / IssueLocation
 *   types from ../core/types and NormalizedNode from ../core/ast/multilang; imported by
 *   core/ast/typescript-adapter.ts and lazy-required by core/analyzer.ts and core/worker.ts only
 *   when a legacy analyzer needs a real SourceFile on the typescript parser path.
 * Responsibilities: Detect function-like node kinds (declaration, expression, arrow,
 *   method, constructor, getter, setter); create SourceFiles with ScriptTarget.Latest and
 *   setParentNodes:true; map byte offsets to 1-based Position / IssueLocation values;
 *   re-export countLineStats and locN so existing import sites keep compiling.
 * Exit Semantics & Design Rationale: All helpers are synchronous and side-effect-free;
 *   createSourceFile tolerates syntactically invalid text (the compiler keeps diagnostics in
 *   the tree) while getPos/loc assume valid offsets and nodes. Parent pointers are ON because
 *   `naming`, `simplify-inlining` and `naming-candidate-helper` resolve enclosing declarations
 *   through `node.parent`; a pointer-free tree silently drops whole rule families. The separate
 *   ts-free modules keep `typescript` out of the worker hot path.
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
 * Create a TypeScript SourceFile WITH parent pointers (`setParentNodes: true`).
 *
 * Parent pointers are required, not optional: several analyzers walk `node.parent` to resolve
 * the enclosing declaration (`naming` decides whether a `let` sits at module scope,
 * `simplify-inlining` finds the sole call site's enclosing function, `naming-candidate-helper`
 * walks up looking for an `export` modifier). A pointer-free tree makes those walks terminate
 * immediately and the rules silently under-report — measured on this repository as 92 lost
 * `NAM-GLB-001`/`NAM-GLB-002` findings and 13 lost `SIM-INL-001` findings. The parse cost is
 * 5.4% on the repository corpus (283ms -> 298ms for 498 files), a fair price for not losing
 * whole rule families.
 *
 * @param fileName - Logical file name recorded on the resulting SourceFile; it is also what
 *   issue locations report, so callers should pass the repository-relative POSIX path.
 * @param content - Raw source text; syntactically invalid input is tolerated because the
 *   compiler keeps diagnostics inside the returned tree rather than throwing during parse.
 * @returns A `ScriptTarget.Latest` SourceFile whose nodes expose `parent` chains.
 */
export function createSourceFile(fileName: string, content: string): ts.SourceFile {
    return ts.createSourceFile(
        fileName,
        content,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
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
