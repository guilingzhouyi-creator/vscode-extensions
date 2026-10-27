/**
 * Module: Core Experts - Expert Finding Combiner (DeepEP MoE Combine Primitive)
 * File Path: src/core/experts/expert-combiner.ts
 * Architecture Role: Collective gathering and reduction engine inspired by DeepEP (Deep Expert
 *   Parallelism) All-to-All Combine. Gathers findings from distributed expert execution batches,
 *   deduplicates overlapping rule hits, sorts issues deterministically, and re-associates them
 *   with their original review items.
 * Dependencies & Triggers: Consumes Issue and Severity from ../types, GroupedDispatchPlan from
 *   grouped-dispatcher; consumed by SparseMoEGateRouter and multi-file review pipelines.
 * Responsibilities:
 *   1. Gather raw findings emitted across disparate expert batches;
 *   2. Deduplicate overlapping findings using composite anchor keys;
 *   3. Re-assemble findings into per-item reports with active analyzer manifests;
 *   4. Zero memory leakage and bounded algorithmic complexity (CC <= 15).
 * Exit Semantics & Design Rationale: Deterministic, immutable result maps; preserves original
 *   issue coordinates; never throws.
 */

import type { Issue } from '../types';
import type { DispatchableReviewItem, GroupedDispatchPlan } from './grouped-dispatcher';

/** Composite coordinate key delimiter for duplicate identification. */
const DEDUP_KEY_DELIMITER = '|';

/** Reusable static comparator sorting issues by start position ascending. */
function compareIssuesByPosition(issueA: Issue, issueB: Issue): number {
    const lineDiff = issueA.location.start.line - issueB.location.start.line;
    return lineDiff !== 0 ? lineDiff : issueA.location.start.column - issueB.location.start.column;
}

/** Immutable empty issues array to eliminate per-iteration transient allocations. */
const EMPTY_ISSUES_ARRAY: readonly Issue[] = Object.freeze([]);

/**
 * Normalized intermediate finding structure emitted by an expert analyzer batch.
 */
export interface RawExpertFinding {
    /** Target review item ID (sliceId or file relative path). */
    readonly itemId: string;
    /** Relative repository file path. */
    readonly filePath: string;
    /** Analyzer identifier that emitted this finding. */
    readonly analyzer: string;
    /** Specific rule identifier (e.g. 'SIM-ARGS-001', 'hardcoded-string'). */
    readonly rule: string;
    /** Severity level of the finding. */
    readonly severity: Issue['severity'];
    /** Explanatory message. */
    readonly message: string;
    /** 1-based start line number. */
    readonly line: number;
    /** 1-based start column number. */
    readonly column: number;
    /** Optional detailed metadata. */
    readonly detail?: Record<string, unknown>;
}

/**
 * Consolidated per-item report aggregating all verified findings across active experts.
 */
export interface CombinedItemReport {
    /** Target review item ID. */
    readonly itemId: string;
    /** Relative repository file path. */
    readonly filePath: string;
    /** Deduplicated, deterministically sorted issues for this item. */
    readonly issues: readonly Issue[];
    /** List of active expert analyzers that contributed to this item. */
    readonly activeAnalyzers: readonly string[];
    /** Total violation count. */
    readonly totalViolations: number;
}

/**
 * Builds a deterministic deduplication string key for a finding.
 */
function buildDedupKey(filePath: string, line: number, column: number, rule: string): string {
    return `${filePath}${DEDUP_KEY_DELIMITER}${line}${DEDUP_KEY_DELIMITER}${column}${DEDUP_KEY_DELIMITER}${rule}`;
}

/**
 * ExpertFindingCombiner implements DeepEP-style Gather & Reduction across MoE analyzer batches.
 */
export class ExpertFindingCombiner {
    /**
     * Converts a RawExpertFinding into a standard Auto-Refactor Issue structure.
     *
     * @param finding - Normalized raw finding.
     * @returns Standard Issue object.
     */
    public findingToIssue(finding: RawExpertFinding): Issue {
        return {
            id: `${finding.analyzer}:${finding.rule}:${finding.filePath}:${finding.line}:${finding.column}`,
            analyzer: finding.analyzer,
            rule: finding.rule,
            severity: finding.severity,
            message: finding.message,
            location: {
                file: finding.filePath,
                start: { line: finding.line, column: finding.column },
                end: { line: finding.line, column: finding.column },
            },
            detail: finding.detail ?? {},
        };
    }

    /**
     * Deduplicates raw findings and groups them by item identifier.
     */
    private populateDeduplicatedIssues(
        rawFindings: readonly RawExpertFinding[],
        itemIssuesMap: Map<string, Issue[]>,
    ): void {
        const seenKeys = new Set<string>();
        for (let i = 0; i < rawFindings.length; i++) {
            const finding = rawFindings[i];
            const dedupKey = buildDedupKey(
                finding.filePath,
                finding.line,
                finding.column,
                finding.rule,
            );

            if (seenKeys.has(dedupKey)) {
                continue;
            }
            seenKeys.add(dedupKey);

            let issues = itemIssuesMap.get(finding.itemId);
            if (!issues) {
                issues = [];
                itemIssuesMap.set(finding.itemId, issues);
            }
            issues.push(this.findingToIssue(finding));
        }
    }

    /**
     * Builds reports for explicitly supplied original review items.
     */
    private buildReportsFromOriginalItems<TItem extends DispatchableReviewItem>(
        originalItems: readonly TItem[],
        itemIssuesMap: Map<string, Issue[]>,
        activeExpertIds: readonly string[],
        reports: Map<string, CombinedItemReport>,
    ): void {
        for (let i = 0; i < originalItems.length; i++) {
            const item = originalItems[i];
            const issues = itemIssuesMap.get(item.id);
            if (issues && issues.length > 1) {
                issues.sort(compareIssuesByPosition);
            }

            reports.set(item.id, {
                itemId: item.id,
                filePath: item.filePath,
                issues: issues ?? EMPTY_ISSUES_ARRAY,
                activeAnalyzers: activeExpertIds,
                totalViolations: issues ? issues.length : 0,
            });
        }
    }

    /**
     * Builds reports directly from collected findings when no original items were provided.
     */
    private buildReportsFromItemIssues(
        itemIssuesMap: Map<string, Issue[]>,
        activeExpertIds: readonly string[],
        reports: Map<string, CombinedItemReport>,
    ): void {
        for (const [itemId, issues] of itemIssuesMap.entries()) {
            if (issues.length > 1) {
                issues.sort(compareIssuesByPosition);
            }

            const firstIssue = issues[0];
            reports.set(itemId, {
                itemId,
                filePath: firstIssue ? firstIssue.location.file : 'unknown',
                issues,
                activeAnalyzers: activeExpertIds,
                totalViolations: issues.length,
            });
        }
    }

    /**
     * Combines, deduplicates, and organizes raw findings across all expert batches into
     * consolidated per-item reports.
     *
     * @param rawFindings - Array of raw findings from all executed batches.
     * @param dispatchPlan - Original GroupedDispatchPlan used for dispatching.
     * @param originalItems - Original items array for preserving items that had zero findings.
     * @returns Map of itemId to CombinedItemReport.
     */
    public combineFindings<TItem extends DispatchableReviewItem>(
        rawFindings: readonly RawExpertFinding[],
        dispatchPlan: GroupedDispatchPlan<TItem>,
        originalItems?: readonly TItem[],
    ): Map<string, CombinedItemReport> {
        const itemIssuesMap = new Map<string, Issue[]>();
        this.populateDeduplicatedIssues(rawFindings, itemIssuesMap);

        const reports = new Map<string, CombinedItemReport>();
        if (originalItems) {
            this.buildReportsFromOriginalItems(
                originalItems,
                itemIssuesMap,
                dispatchPlan.activeExpertIds,
                reports,
            );
        } else {
            this.buildReportsFromItemIssues(itemIssuesMap, dispatchPlan.activeExpertIds, reports);
        }

        return reports;
    }
}

/** Default singleton instance of ExpertFindingCombiner. */
export const defaultExpertFindingCombiner = new ExpertFindingCombiner();
