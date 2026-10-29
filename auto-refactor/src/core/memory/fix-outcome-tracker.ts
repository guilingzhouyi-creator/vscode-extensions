/**
 * Module: Core Engine — Fix Outcome Reconciliation
 * File Path: src/core/memory/fix-outcome-tracker.ts
 * Architecture Role: Closes the review loop. Every audit until now wrote `fixResults: []`, so a
 *   file could be re-audited a hundred times and its review memory still claimed nothing had ever
 *   been fixed. This module compares the previous record of a file against the findings of the
 *   current audit and turns the difference into historical fix outcomes.
 * Dependencies & Triggers: consumes ReviewMemoryRecord/HistoricalFixResult from ./types; called
 *   by core/pipeline/dualTrackPipeline and core/reporting/reportBuilder immediately before they
 *   upsert a record, with the pre-upsert record in hand.
 * Responsibilities:
 *   1. Derive the rule set that used to fire on a file and no longer does.
 *   2. Append one HistoricalFixResult per audit that resolved anything, keeping the newest
 *      entries and dropping the oldest so the record stays bounded.
 *   3. Leave every other rule out of the outcome: persistence is not a fix, and treating it as
 *      one would inflate the record with entries that describe nothing that changed.
 * Exit Semantics & Design Rationale: Pure and total — no I/O, no clock reads beyond the caller's
 *   timestamp, never throws. Rules are matched by id rather than by issue id: an issue id embeds
 *   the line number, so a fixed finding that merely shifted lines would look both resolved and
 *   newly introduced. Resolution is recorded but deliberately NOT counted as evidence in either
 *   direction for confidence calibration; the reasons a finding can disappear (line deleted, rule
 *   narrowed, file regenerated) are not the same as the finding having been wrong.
 */

import type { HistoricalFixResult, ReviewMemoryRecord } from './types';
import type { Issue } from '../types';

/**
 * Maximum fix-result entries kept per file.
 *
 * A file audited on every commit would otherwise accumulate one entry per audit for as long as
 * the project lives, and the whole point of the record is that it stays small enough to load on
 * every scan. The newest entries are the ones a reviewer can still act on.
 */
export const MAX_FIX_RESULTS_PER_FILE = 24;

/** Prefix of the synthetic patch id used when a resolution was observed, not applied by us. */
const RESCAN_PATCH_PREFIX = 'rescan:';

/** Description recorded for a resolution observed on re-audit. */
const RESCAN_DESCRIPTION = 'rule no longer fires on re-audit of this file';

const EMPTY_FIX_RESULTS: readonly HistoricalFixResult[] = Object.freeze([]);

/**
 * Derives the rules that fired on the previous audit and no longer fire now.
 *
 * A rule still present in the current findings is not resolved, however its line number moved.
 * A rule absent from both sides is not resolved either — it was never reported, so nothing about
 * it changed.
 *
 * `activeAnalyzers` is what stops a configuration change from masquerading as a repair. Disabling
 * an analyzer makes all of its rules stop firing, and without this guard the next audit would
 * record that silence as a fix for every one of them — inflating the history with work nobody did
 * and, worse, teaching any downstream consumer that those rules were wrong. A rule is credited
 * only when the analyzer that produces it was actually part of this audit.
 *
 * @param previous - Review-memory record from the last audit, if any.
 * @param currentIssues - Findings of the audit being recorded.
 * @param activeAnalyzers - Analyzers that ran in this audit; omit to credit every analyzer.
 * @returns Sorted rule ids that disappeared, empty when nothing was resolved.
 */
export function deriveResolvedRules(
    previous: ReviewMemoryRecord | undefined,
    currentIssues: readonly Issue[],
    activeAnalyzers?: readonly string[],
): string[] {
    if (!previous || previous.ruleHits.length === 0) return [];

    const currentRules = new Set<string>();
    for (const issue of currentIssues) currentRules.add(issue.rule);

    const ran = activeAnalyzers ? new Set(activeAnalyzers) : undefined;
    const resolved = new Set<string>();
    for (const hit of previous.ruleHits) {
        if (!hit.rule || currentRules.has(hit.rule)) continue;
        if (ran && !ran.has(hit.analyzer)) continue;
        resolved.add(hit.rule);
    }
    if (resolved.size === 0) return [];
    return Array.from(resolved).sort();
}

/**
 * Builds the fix-result entry describing one audit's resolutions.
 *
 * @param resolvedRules - Rules that stopped firing.
 * @param revisionId - Stable id of the audit that observed the resolution.
 * @param timestamp - Observation time in epoch milliseconds.
 * @param agentUid - Agent identity recorded with the audit.
 * @returns A single fix result whose `fixedRules` lists every rule resolved at once.
 */
function buildRescanResult(
    resolvedRules: readonly string[],
    revisionId: string,
    timestamp: number,
    agentUid: string,
): HistoricalFixResult {
    return {
        patchId: `${RESCAN_PATCH_PREFIX}${revisionId}`,
        description: RESCAN_DESCRIPTION,
        timestamp,
        agentUid,
        success: true,
        fixedRules: [...resolvedRules],
    };
}

/**
 * Reconciles the retained fix history with the resolutions of the current audit.
 *
 * Newest entries are kept. An identical resolution recorded twice for the same revision is not
 * duplicated, because a caller that retries a scan must not multiply its own evidence.
 *
 * @param previousResults - Fix results already stored on the record.
 * @param resolvedRules - Rules that stopped firing in this audit.
 * @param revisionId - Stable id of the audit that observed the resolution.
 * @param timestamp - Observation time in epoch milliseconds.
 * @param agentUid - Agent identity recorded with the audit.
 * @returns Bounded fix-result list, ordered oldest to newest.
 */
export function reconcileFixResults(
    previousResults: readonly HistoricalFixResult[] | undefined,
    resolvedRules: readonly string[],
    revisionId: string,
    timestamp: number,
    agentUid: string,
): HistoricalFixResult[] {
    const retained = previousResults ?? EMPTY_FIX_RESULTS;
    if (resolvedRules.length === 0) return [...retained];

    const entry = buildRescanResult(resolvedRules, revisionId, timestamp, agentUid);
    const merged = retained.filter((existing) => existing.patchId !== entry.patchId);
    merged.push(entry);
    if (merged.length <= MAX_FIX_RESULTS_PER_FILE) return merged;
    return merged.slice(merged.length - MAX_FIX_RESULTS_PER_FILE);
}
