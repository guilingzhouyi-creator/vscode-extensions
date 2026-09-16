/**
 * Module: Core Engine — Normalized Node Location Helpers (ts-free)
 * File Path: src/utils/normalized.ts
 * Architecture Role: Leaf adapter between parser-precomputed `NormalizedNode` byte spans and
 *   the language-agnostic IssueLocation contract; the single supported way to materialize a
 *   normalized node location on the oxc/rust parser paths. Extracted from utils/ast.ts so the
 *   built-in analyzers and worker threads never pull in the `typescript` module.
 * Dependencies & Triggers: Type-only imports of IssueLocation (../core/types) and
 *   NormalizedNode (../core/multilang) that erase at compile time, so no runtime dependency
 *   is added; called by analyzers/complexity.ts and analyzers/constants.ts while visiting
 *   normalized nodes, and re-exported by utils/ast.ts for legacy import sites.
 * Responsibilities: Build `{ file, start, end }` IssueLocations from the byte spans the
 *   adapter sets on literal, function-like and FunctionKeyword nodes; document the position
 *   contract so callers know a position-less node would emit an IssueLocation whose start/end
 *   silently disappear from JSON output instead of raising an error.
 * Exit Semantics & Design Rationale: Synchronous and allocation-thin — one object literal,
 *   no validation, no fallback, no throw; the non-null assertions trust the adapter's
 *   precomputed positions so the hot path avoids re-deriving them, and type-only imports keep
 *   `typescript` out of the bundled runtime for oxc/rust scans.
 */
import type { IssueLocation } from '../core/types';
import type { NormalizedNode } from '../core/multilang';

/**
 * Materialize the source location of a parser-normalized node.
 *
 * @param node - Normalized node carrying the byte offsets the adapter precomputed for
 *   literal, function-like and FunctionKeyword nodes; other node kinds have no positions.
 * @param file - Repository-relative path copied verbatim into the returned location.
 * @returns An IssueLocation spanning `node.start`..`node.end`; when the adapter left the
 *   offsets unset they stay `undefined`, so JSON serialization drops the fields instead of
 *   throwing, and callers must only request locations for positioned node kinds.
 */
export function locN(node: NormalizedNode, file: string): IssueLocation {
    // Architecture contract: positions are lazily materialized (only literal / function-like /
    // FunctionKeyword nodes carry them). Consumers calling locN on such nodes are the
    // only supported path; the `!` assertion documents the contract — if a future
    // analyzer misuses it on a position-less node, JSON output silently drops the
    // fields and the byte-level validation catches it (a natural safety net).
    return { file, start: node.start!, end: node.end! };
}
