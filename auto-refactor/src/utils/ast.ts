import * as ts from 'typescript';
import { Position, IssueLocation } from '../core/types';
import { NormalizedNode } from '../core/multilang';

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
 */
export function createSourceFile(fileName: string, content: string): ts.SourceFile {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, /* setParentNodes */ false);
}

export function getPos(sf: ts.SourceFile, pos: number): Position {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, column: lc.character + 1 };
}

export function loc(sf: ts.SourceFile, node: ts.Node): IssueLocation {
  return {
    file: sf.fileName,
    start: getPos(sf, node.getStart(sf)),
    end: getPos(sf, node.getEnd()),
  };
}
