/**
 * Module: Core Engine - All-Reduce Global Semantic Convergence Engine
 * File Path: src/core/scheduler/semantic-convergence.ts
 * Architecture Role: In-memory aggregator implementing All-Reduce style reduction
 *   across distributed review workers and tensor cells without serializing full graphs.
 * Dependencies & Triggers: Consumes Issue and native graph analyzer;
 *   invoked by orchestrator upon cell completion.
 * Responsibilities:
 *   1. Ingest SemanticDelta records containing local issues, symbols, and edges;
 *   2. High-speed deduplication of issues with stable ordering (file -> line -> rule);
 *   3. Reconcile cross-partition symbol collisions and detect cyclic dependency loops;
 *   4. Compute converged quality indices and global review summary.
 * Exit Semantics & Design Rationale: Pure deterministic reduction; never throws.
 */

import type { Issue } from '../types';
import { nativeAnalyzeDependencyGraph } from '../native/native-bridge';

/**
 * Local semantic delta produced by an individual tensor worker or partition.
 */
export interface SemanticDelta {
    readonly partitionId: string;
    readonly issues: Issue[];
    readonly exportedSymbols?: Record<string, string[]>;
    readonly dependencies?: [string, string][];
    readonly executionTimeMs: number;
}

/**
 * Global converged outcome of All-Reduce semantic reduction.
 */
export interface ConvergedReviewResult {
    readonly issues: Issue[];
    readonly issuesCount: number;
    readonly issuesBySeverity: { info: number; warning: number; error: number };
    readonly circularDependencies: string[][];
    readonly totalExecutionTimeMs: number;
    readonly convergedPartitionsCount: number;
    readonly symbolConflicts: { symbol: string; definedIn: string[] }[];
}

/**
 * All-Reduce Semantic Convergence Aggregator.
 */
export class SemanticConvergenceEngine {
    private readonly deltas: SemanticDelta[] = [];

    /**
     * Ingests a local delta from a completed tensor partition.
     */
    public ingestDelta(delta: SemanticDelta): void {
        this.deltas.push(delta);
    }

    /**
     * Executes All-Reduce convergence over all ingested semantic deltas.
     */
    public converge(): ConvergedReviewResult {
        const uniqueIssuesMap = new Map<string, Issue>();
        const allEdges: [string, string][] = [];
        const symbolLocations = new Map<string, Set<string>>();
        let totalExecutionTimeMs = 0;

        for (const delta of this.deltas) {
            totalExecutionTimeMs += delta.executionTimeMs;

            // 1. Ingest and deduplicate issues
            for (const issue of delta.issues) {
                const fingerprint = this.computeIssueFingerprint(issue);
                if (!uniqueIssuesMap.has(fingerprint)) {
                    uniqueIssuesMap.set(fingerprint, issue);
                }
            }

            // 2. Ingest dependency edges
            if (delta.dependencies) {
                for (const edge of delta.dependencies) {
                    allEdges.push(edge);
                }
            }

            // 3. Track exported symbols for cross-partition conflicts
            if (delta.exportedSymbols) {
                for (const [file, symbols] of Object.entries(delta.exportedSymbols)) {
                    for (const sym of symbols) {
                        let locations = symbolLocations.get(sym);
                        if (!locations) {
                            locations = new Set();
                            symbolLocations.set(sym, locations);
                        }
                        locations.add(file);
                    }
                }
            }
        }

        // Sort deduplicated issues deterministically (file -> line -> column -> rule)
        const sortedIssues = Array.from(uniqueIssuesMap.values()).sort((a, b) => {
            const fileA = a.location?.file ?? '';
            const fileB = b.location?.file ?? '';
            const fileCmp = fileA.localeCompare(fileB);
            if (fileCmp !== 0) return fileCmp;
            const lineCmp = (a.location?.start?.line ?? 0) - (b.location?.start?.line ?? 0);
            if (lineCmp !== 0) return lineCmp;
            const colCmp = (a.location?.start?.column ?? 0) - (b.location?.start?.column ?? 0);
            if (colCmp !== 0) return colCmp;
            return a.rule.localeCompare(b.rule);
        });

        // Compute severity counts
        const bySeverity = { info: 0, warning: 0, error: 0 };
        for (const issue of sortedIssues) {
            if (issue.severity === 'error') bySeverity.error++;
            else if (issue.severity === 'warning') bySeverity.warning++;
            else bySeverity.info++;
        }

        // 4. Global graph convergence: detect cross-partition cycles
        const graphAnalysis = nativeAnalyzeDependencyGraph(allEdges);

        // 5. Detect symbol conflicts across files
        const symbolConflicts: { symbol: string; definedIn: string[] }[] = [];
        for (const [symbol, files] of symbolLocations.entries()) {
            if (files.size > 1) {
                symbolConflicts.push({
                    symbol,
                    definedIn: Array.from(files).sort(),
                });
            }
        }

        return {
            issues: sortedIssues,
            issuesCount: sortedIssues.length,
            issuesBySeverity: bySeverity,
            circularDependencies: graphAnalysis.cycles,
            totalExecutionTimeMs,
            convergedPartitionsCount: this.deltas.length,
            symbolConflicts,
        };
    }

    /**
     * Resets the convergence engine state.
     */
    public clear(): void {
        this.deltas.length = 0;
    }

    /**
     * Computes unique deduplication key for an issue.
     */
    private computeIssueFingerprint(issue: Issue): string {
        const file = issue.location?.file ?? '';
        const line = issue.location?.start?.line ?? 0;
        const col = issue.location?.start?.column ?? 0;
        return `${issue.analyzer}:${issue.rule}:${file}:${line}:${col}:${issue.message}`;
    }
}
