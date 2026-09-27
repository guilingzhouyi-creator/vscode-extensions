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
 * Computes unique deduplication key for an issue.
 */
function computeIssueFingerprint(issue: Issue): string {
    const file = issue.location?.file ?? '';
    const line = issue.location?.start?.line ?? 0;
    const col = issue.location?.start?.column ?? 0;
    return `${issue.analyzer}:${issue.rule}:${file}:${line}:${col}:${issue.message}`;
}

/**
 * Records a file location for an exported symbol, avoiding transient Set allocations.
 */
function recordSymbolLocation(
    sym: string,
    file: string,
    symbolLocations: Map<string, string[]>,
): void {
    const locations = symbolLocations.get(sym);
    if (!locations) {
        symbolLocations.set(sym, [file]);
        return;
    }
    if (!locations.includes(file)) {
        locations.push(file);
    }
}

/**
 * Ingests and deduplicates issues across all semantic deltas.
 */
function ingestDeltaIssues(deltas: SemanticDelta[]): Map<string, Issue> {
    const uniqueIssuesMap = new Map<string, Issue>();
    for (const delta of deltas) {
        for (const issue of delta.issues) {
            const fingerprint = computeIssueFingerprint(issue);
            if (!uniqueIssuesMap.has(fingerprint)) {
                uniqueIssuesMap.set(fingerprint, issue);
            }
        }
    }
    return uniqueIssuesMap;
}

/**
 * Collects dependency edges from deltas for graph cycle analysis.
 */
function ingestDeltaEdges(deltas: SemanticDelta[]): [string, string][] {
    const allEdges: [string, string][] = [];
    for (const delta of deltas) {
        if (!delta.dependencies) {
            continue;
        }
        for (const edge of delta.dependencies) {
            allEdges.push(edge);
        }
    }
    return allEdges;
}

/**
 * Ingests exported symbols across deltas for cross-partition collision detection.
 */
function ingestExportedSymbols(deltas: SemanticDelta[]): Map<string, string[]> {
    const symbolLocations = new Map<string, string[]>();
    for (const delta of deltas) {
        const exported = delta.exportedSymbols;
        if (!exported) {
            continue;
        }
        for (const file of Object.keys(exported)) {
            const symbols = exported[file];
            if (!symbols) {
                continue;
            }
            for (const sym of symbols) {
                recordSymbolLocation(sym, file, symbolLocations);
            }
        }
    }
    return symbolLocations;
}

/**
 * Deterministically sorts unique issues by file, line, column, and rule.
 */
function sortDeduplicatedIssues(uniqueIssues: Iterable<Issue>): Issue[] {
    return Array.from(uniqueIssues).sort((a, b) => {
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
}

/**
 * Counts issues partitioned by severity tier.
 */
function countIssuesBySeverity(sortedIssues: Issue[]): {
    info: number;
    warning: number;
    error: number;
} {
    const bySeverity = { info: 0, warning: 0, error: 0 };
    for (const issue of sortedIssues) {
        if (issue.severity === 'error') {
            bySeverity.error++;
        } else if (issue.severity === 'warning') {
            bySeverity.warning++;
        } else {
            bySeverity.info++;
        }
    }
    return bySeverity;
}

/**
 * Identifies duplicate symbol definitions across disparate files.
 */
function detectSymbolConflicts(
    symbolLocations: Map<string, string[]>,
): { symbol: string; definedIn: string[] }[] {
    const symbolConflicts: { symbol: string; definedIn: string[] }[] = [];
    for (const [symbol, files] of symbolLocations.entries()) {
        if (files.length > 1) {
            symbolConflicts.push({
                symbol,
                definedIn: files.slice().sort(),
            });
        }
    }
    return symbolConflicts;
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
        let totalExecutionTimeMs = 0;
        for (const delta of this.deltas) {
            totalExecutionTimeMs += delta.executionTimeMs;
        }

        const uniqueIssuesMap = ingestDeltaIssues(this.deltas);
        const allEdges = ingestDeltaEdges(this.deltas);
        const symbolLocations = ingestExportedSymbols(this.deltas);

        const sortedIssues = sortDeduplicatedIssues(uniqueIssuesMap.values());
        const bySeverity = countIssuesBySeverity(sortedIssues);
        const graphAnalysis = nativeAnalyzeDependencyGraph(allEdges);
        const symbolConflicts = detectSymbolConflicts(symbolLocations);

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
    public computeIssueFingerprint(issue: Issue): string {
        return computeIssueFingerprint(issue);
    }
}
