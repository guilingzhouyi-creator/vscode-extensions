/**
 * Module: Core Engine — Semantic Graph Praxis Context Enricher
 * File Path: src/core/praxis/semanticEnricher.ts
 * Architecture Role: Bridges the unified SemanticGraph topology into the Praxis Review Cell
 *   by implementing IPraxisContextEnricher; dynamically populates enclosing symbols,
 *   scope ranges, and multi-hop reverse dependency impact closures (impactFiles).
 * Dependencies & Triggers: Consumes IPraxisContextEnricher, ReviewDiffHunk, and
 *   PraxisEnrichedContext from ./contracts; consumes SemanticGraph from core/semantic.
 * Responsibilities: Map physical diff line ranges to semantic nodes, query backward impact
 *   slices, and deduce recommended remediation actions.
 * Exit Semantics & Design Rationale: Never throws; gracefully degrades to header-based
 *   heuristics when no graph or node is matched, preserving historical behavior for Praxis.
 */

import type { IPraxisContextEnricher, PraxisEnrichedContext, ReviewDiffHunk } from './contracts';
import type { SemanticGraph } from '../semantic/semanticGraph';
import { normalizeCanonicalPath } from '../semantic/adapters/path-utils';

/** Threshold in diff line count above which rework is suggested instead of auto-fix */
const HUNK_REWORK_LINE_THRESHOLD = 50;

/**
 * High-precision context enricher for the Praxis ecosystem backed by SemanticGraph topology.
 */
export class SemanticPraxisContextEnricher implements IPraxisContextEnricher {
    private graph?: SemanticGraph;

    public constructor(graph?: SemanticGraph) {
        this.graph = graph;
    }

    /**
     * Dynamically updates or attaches the underlying SemanticGraph instance.
     */
    public setGraph(graph: SemanticGraph): void {
        this.graph = graph;
    }

    /**
     * Enriches a single ReviewDiffHunk with semantic scope and impact closure.
     */
    public enrichHunk(filePath: string, hunk: ReviewDiffHunk): PraxisEnrichedContext {
        const canonicalFile = normalizeCanonicalPath(filePath);
        const startLine = hunk.newSpan.startLine;
        const endLine = startLine + Math.max(0, hunk.newSpan.lineCount - 1);

        // Fallback enclosing symbol from diff hunk header @@ ... @@
        const fallbackSymbol = hunk.header.replace(/^@@.*@@\s*/, '') || undefined;
        const action = hunk.lines.length > HUNK_REWORK_LINE_THRESHOLD ? 'rework' : 'auto_fix';

        if (!this.graph) {
            return {
                enclosingSymbol: fallbackSymbol,
                suggestedAction: action,
            };
        }

        // Search for matching node in the semantic graph covering this line span
        const matchedNode = this.findEnclosingNode(canonicalFile, startLine, endLine);

        if (!matchedNode) {
            return {
                enclosingSymbol: fallbackSymbol,
                suggestedAction: action,
            };
        }

        // Extract backward impact slice (files depending on or calling this symbol)
        const impactSlice = this.graph.getSlice(matchedNode.id, 3, 'backward');
        const impactFiles = Array.from(
            new Set(impactSlice.nodes.map((n) => n.location.file)),
        ).filter((f) => f !== canonicalFile);

        return {
            enclosingSymbol: matchedNode.name,
            symbolKind: matchedNode.kind,
            scopeRange: {
                startLine: matchedNode.location.start.line,
                endLine: matchedNode.location.end.line,
            },
            impactFiles: impactFiles.length > 0 ? impactFiles : undefined,
            suggestedAction: action,
            extraContext: {
                nodeId: matchedNode.id,
                metrics: matchedNode.metrics,
            },
        };
    }

    /**
     * Locates the most specific semantic node covering the given line span in the file.
     */
    private findEnclosingNode(
        canonicalFile: string,
        startLine: number,
        endLine: number,
    ): ReturnType<SemanticGraph['getNode']> {
        if (!this.graph) {
            return undefined;
        }

        const candidates = this.graph.getAllNodes().filter((n) => {
            if (n.location.file !== canonicalFile) {
                return false;
            }
            // Check if node encompasses or overlaps the diff hunk span
            return n.location.start.line <= endLine && n.location.end.line >= startLine;
        });

        if (candidates.length === 0) {
            return undefined;
        }

        // Prioritize more granular nodes: function > type > module
        candidates.sort((a, b) => {
            const kindWeight = (k: string): number => {
                if (k === 'function') return 3;
                if (k === 'type') return 2;
                if (k === 'module') return 1;
                return 0;
            };
            return kindWeight(b.kind) - kindWeight(a.kind);
        });

        return candidates[0];
    }
}
