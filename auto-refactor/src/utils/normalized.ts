/**
 * Helpers for the language-agnostic `NormalizedNode` model (NO TypeScript dependency).
 *
 * Extracted from utils/ast.ts so the built-in analyzers and worker threads never pull in
 * the `typescript` module on the oxc/rust parser paths. This file must NEVER import
 * `typescript` (or any module that does) — both imports below are type-only and are
 * erased at compile time.
 */
import type { IssueLocation } from '../core/types';
import type { NormalizedNode } from '../core/multilang';

/** Location for a normalized node (positions are precomputed by the adapter). */
export function locN(node: NormalizedNode, file: string): IssueLocation {
  // P0-1: positions are lazily materialized (only literal / function-like /
  // FunctionKeyword nodes carry them). Consumers calling locN on such nodes are the
  // only supported path; the `!` assertion documents the contract — if a future
  // analyzer misuses it on a position-less node, JSON output silently drops the
  // fields and the byte-level validation catches it (a natural safety net).
  return { file, start: node.start!, end: node.end! };
}
