/**
 * Module: Core Reporting — Review Queue Intake
 * File Path: src/core/reporting/review-queue-intake.ts
 * Architecture Role: The read-back arm of the human review loop. The queue exporter writes a work
 *   list for a person; nothing read it back, so a reviewer's answer had no path into the pipeline
 *   and the same findings were queued on every run regardless of how often they had been judged.
 *   This module parses that file and pairs each record with an answer.
 * Dependencies & Triggers: consumes the NDJSON written by `review-queue.ts`; called by the
 *   `review` CLI command before it appends verdicts to the ledger.
 * Responsibilities:
 *   1. Parse an NDJSON queue file, rejecting lines that are not queue records.
 *   2. Pair each parsed record with a reviewer's answer, keeping the pairing total and explicit.
 *   3. Report which queued occurrences already carry a verdict, so a caller can skip them.
 * Exit Semantics & Design Rationale: Pure and total — no I/O, no clock reads, never throws.
 *
 * The intake deliberately reads only what the answer needs: rule, file and line. The exporter's
 * richer fields (confidence, rationale, category) describe why the finding reached a person, and
 * carrying them into the ledger would freeze a judgement that a later run may legitimately revise.
 */

import type { ReviewVerdictKind, ReviewVerdictRecord } from '../scoring/review-verdict-ledger';

/** Fields of an exported queue record this module needs. */
export interface QueuedOccurrence {
    /** Rule the finding was reported under. */
    readonly rule: string;
    /** File the finding pointed at. */
    readonly file: string;
    /** 1-based line the finding pointed at. */
    readonly line: number;
}

/** Result of reading a queue file. */
export interface QueueIntakeResult {
    /** Parsed occurrences, in file order. */
    readonly occurrences: QueuedOccurrence[];
    /** Human-readable reasons lines were skipped; empty when every line parsed. */
    readonly rejections: string[];
}

/** Reason reported when a line is not a JSON object. */
const REASON_LINE_SHAPE = 'queue line is not a JSON object';

/**
 * Reads one queue line into an occurrence.
 *
 * Only reachable fields are required: a queue written by an older build may lack fields the current
 * exporter emits, and refusing the whole line over a field the answer does not use would make the
 * intake reject its own history.
 *
 * @param value - Parsed JSON value of one line.
 * @returns Occurrence, or undefined when the line is not a usable queue record.
 */
function readOccurrence(value: unknown): QueuedOccurrence | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const record = value as { rule?: unknown; file?: unknown; line?: unknown };
    if (typeof record.rule !== 'string' || record.rule.length === 0) return undefined;
    if (typeof record.file !== 'string' || record.file.length === 0) return undefined;
    const line = record.line;
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) return undefined;
    return { rule: record.rule, file: record.file.replace(/\\/g, '/'), line };
}

/**
 * Parses an NDJSON queue body.
 *
 * A blank line is skipped rather than rejected: trailing newlines are normal in NDJSON and calling
 * them a defect would train the reader to ignore the rejection list.
 *
 * @param body - Raw file contents.
 * @returns Parsed occurrences plus one reason per unusable line.
 */
export function parseReviewQueueBody(body: string): QueueIntakeResult {
    const occurrences: QueuedOccurrence[] = [];
    const rejections: string[] = [];
    const lines = body.split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.length === 0) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            rejections.push(`queue line is not valid JSON: ${line.slice(0, 60)}`);
            continue;
        }
        const occurrence = readOccurrence(parsed);
        if (!occurrence) {
            rejections.push(REASON_LINE_SHAPE);
            continue;
        }
        occurrences.push(occurrence);
    }
    return { occurrences, rejections };
}

/**
 * Keys an occurrence for comparison against recorded verdicts.
 *
 * Must match the ledger's own identity rule, or the same defect would be queued and judged under
 * two different keys.
 *
 * @param occurrence - Queued occurrence.
 * @returns Composite key of rule, file and line.
 */
export function occurrenceKey(occurrence: QueuedOccurrence): string {
    return `${occurrence.rule}\u0000${occurrence.file}\u0000${occurrence.line}`;
}

/**
 * Pairs queued occurrences with a reviewer's answer.
 *
 * Every occurrence receives the same verdict because the command that calls this takes one answer
 * for one rule at one location; applying a single answer to a batch would attach judgements the
 * reviewer never made.
 *
 * @param occurrences - Occurrences to answer.
 * @param verdict - Reviewer's answer.
 * @param at - Epoch milliseconds of the decision.
 * @returns Ledger records ready to append.
 */
export function toVerdictRecords(
    occurrences: readonly QueuedOccurrence[],
    verdict: ReviewVerdictKind,
    at: number,
): ReviewVerdictRecord[] {
    return occurrences.map((occurrence) => ({
        rule: occurrence.rule,
        file: occurrence.file,
        line: occurrence.line,
        verdict,
        at,
    }));
}

/**
 * Reports which occurrences already carry a verdict.
 *
 * Used to skip re-judging, so a second run over a stale queue does not restate decisions and does
 * not inflate the ledger.
 *
 * @param occurrences - Queued occurrences.
 * @param existing - Verdict records already in the ledger.
 * @returns Keys of occurrences that are already judged.
 */
export function judgedKeys(
    occurrences: readonly QueuedOccurrence[],
    existing: readonly ReviewVerdictRecord[],
): Set<string> {
    const judged = new Set<string>();
    for (const record of existing) judged.add(occurrenceKey(record));
    const pending = new Set<string>();
    for (const occurrence of occurrences) {
        const key = occurrenceKey(occurrence);
        if (judged.has(key)) pending.add(key);
    }
    return pending;
}

/**
 * Returns the occurrences that still need a decision.
 *
 * @param occurrences - Queued occurrences.
 * @param existing - Verdict records already in the ledger.
 * @returns Occurrences whose key is absent from the ledger, in input order.
 */
export function unjudged(
    occurrences: readonly QueuedOccurrence[],
    existing: readonly ReviewVerdictRecord[],
): QueuedOccurrence[] {
    const judged = judgedKeys(occurrences, existing);
    return occurrences.filter((occurrence) => !judged.has(occurrenceKey(occurrence)));
}
