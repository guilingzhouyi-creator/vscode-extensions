/**
 * Module: Core Scoring — Review Verdict Ledger
 * File Path: src/core/scoring/review-verdict-ledger.ts
 * Architecture Role: The write-back arm of the closed loop. Until this existed the calibration
 *   corpus had a reader and no writer, so a posterior could only be maintained by hand; and the
 *   human review queue had a writer and no reader, so a reviewer's decision went nowhere. This
 *   module turns recorded per-occurrence verdicts into the aggregate counts the arbiter consumes.
 * Dependencies & Triggers: consumes ReviewVerdict records written by `auto-refactor review`; its
 *   aggregate output is serialized into the corpus document that `calibration-corpus.ts` reads.
 * Responsibilities:
 *   1. Validate a recorded verdict, so a hand-edited or truncated ledger cannot invent evidence.
 *   2. Aggregate verdicts into per-rule true/false positive counts, idempotently.
 *   3. Report which rules the ledger speaks about, so a caller can tell "no evidence" from
 *      "evidence that happens to be neutral".
 * Exit Semantics & Design Rationale: Pure and total — no I/O, no clock reads, never throws.
 *
 * Aggregation is recomputed from the whole ledger on every write rather than incremented, and a
 * later verdict for the same occurrence replaces the earlier one. Both properties exist because
 * the alternative corrupts the posterior in a way that is invisible in the output: an incrementing
 * writer that runs twice on the same reviewed finding records two observations for one defect, and
 * a reviewer who corrects a mistake would leave both the wrong and the right verdict standing. An
 * occurrence is identified by rule, file and line, which is stable across re-scans; the issue id is
 * NOT used because it embeds the line number and would fragment one defect into two records the
 * moment the file above it changes.
 */

import type { RuleCalibrationStats } from './confidence-calibration';

/** Document schema tag for the verdict ledger. */
export const REVIEW_VERDICT_LEDGER_SCHEMA = 'review-verdict-ledger/v1';

/** A verdict that the finding described a real defect. */
export const VERDICT_TRUE_POSITIVE = 'true-positive';

/** A verdict that the finding did not describe a real defect. */
export const VERDICT_FALSE_POSITIVE = 'false-positive';

/** The two answers a reviewer can give about one finding occurrence. */
export type ReviewVerdictKind = typeof VERDICT_TRUE_POSITIVE | typeof VERDICT_FALSE_POSITIVE;

/** One recorded human decision about one finding occurrence. */
export interface ReviewVerdictRecord {
    /** Rule the finding was reported under. */
    readonly rule: string;
    /** File the finding pointed at, with forward slashes. */
    readonly file: string;
    /** 1-based line the finding pointed at. */
    readonly line: number;
    /** Reviewer's answer. */
    readonly verdict: ReviewVerdictKind;
    /** Epoch milliseconds of the decision; the newest verdict for an occurrence wins. */
    readonly at: number;
}

/** Result of validating one raw ledger entry. */
type EntryReadResult =
    | { readonly ok: true; readonly record: ReviewVerdictRecord }
    | { readonly ok: false; readonly reason: string };

/** Result of reading a whole ledger. */
export interface ReviewVerdictLedgerReadResult {
    /** Accepted records, newest-verdict-wins already applied. */
    readonly records: ReviewVerdictRecord[];
    /** Human-readable reasons entries were dropped; empty when everything was accepted. */
    readonly rejections: string[];
}

/** Raw entry shape; every field optional so a truncated file stays diagnosable. */
interface VerdictEntryDocument {
    readonly rule?: unknown;
    readonly file?: unknown;
    readonly line?: unknown;
    readonly verdict?: unknown;
    readonly at?: unknown;
}

/** Raw ledger document shape. */
interface VerdictLedgerDocument {
    readonly schema?: unknown;
    readonly verdicts?: unknown;
}

const REASON_NOT_OBJECT = 'ledger root is not an object';
const REASON_SCHEMA = 'ledger schema tag is not the supported one';
const REASON_ENTRIES = 'ledger verdicts field is not an array';
const REASON_ENTRY_SHAPE = 'verdict entry is not an object';
const REASON_RULE = 'verdict entry has no non-empty string rule id';
const REASON_FILE = 'verdict entry has no non-empty string file';
const REASON_LINE = 'verdict entry has no positive integer line';
const REASON_KIND = 'verdict entry has an unrecognized verdict';
const REASON_TIME = 'verdict entry has no finite non-negative timestamp';

/**
 * Reads a 1-based line number, accepting only a positive integer.
 *
 * @param value - Raw field value.
 * @returns The line, or undefined when the value is not a valid line.
 */
function readLine(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return undefined;
    return value;
}

/**
 * Reads a decision timestamp, accepting only a finite non-negative number.
 *
 * @param value - Raw field value.
 * @returns The timestamp, or undefined when the value is not usable for ordering.
 */
function readTimestamp(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
    return value;
}

/**
 * Validates one raw verdict entry.
 *
 * The verdict token is checked against the two allowed values rather than coerced: an unrecognized
 * token is almost always a typo in a hand-edited ledger, and silently reading it as one of the two
 * would attach a real observation to the wrong answer.
 *
 * @param entry - Raw entry from the document.
 * @returns Accepted record, or a rejection reason.
 */
function readVerdictEntry(entry: VerdictEntryDocument): EntryReadResult {
    const rule = entry.rule;
    if (typeof rule !== 'string' || rule.length === 0) return { ok: false, reason: REASON_RULE };
    const file = entry.file;
    if (typeof file !== 'string' || file.length === 0) return { ok: false, reason: REASON_FILE };
    const line = readLine(entry.line);
    if (line === undefined) return { ok: false, reason: REASON_LINE };
    const verdict = entry.verdict;
    if (verdict !== VERDICT_TRUE_POSITIVE && verdict !== VERDICT_FALSE_POSITIVE) {
        return { ok: false, reason: REASON_KIND };
    }
    const at = readTimestamp(entry.at);
    if (at === undefined) return { ok: false, reason: REASON_TIME };
    return { ok: true, record: { rule, file: file.replace(/\\/g, '/'), line, verdict, at } };
}

/**
 * Builds the identity under which two verdicts describe the same occurrence.
 *
 * @param record - Accepted verdict record.
 * @returns Composite key of rule, file and line.
 */
function occurrenceKey(record: ReviewVerdictRecord): string {
    return `${record.rule}\u0000${record.file}\u0000${record.line}`;
}

/**
 * Keeps the newest verdict per occurrence.
 *
 * A reviewer correcting an earlier decision is the common case, and it must leave exactly one
 * verdict standing. Ties on timestamp resolve to the later entry in document order, which makes a
 * hand-appended correction win even when the author did not update the timestamp.
 *
 * @param records - Accepted records in document order.
 * @returns One record per occurrence, in first-seen order.
 */
function newestPerOccurrence(records: readonly ReviewVerdictRecord[]): ReviewVerdictRecord[] {
    const byOccurrence = new Map<string, ReviewVerdictRecord>();
    const order: string[] = [];
    for (const record of records) {
        const key = occurrenceKey(record);
        const existing = byOccurrence.get(key);
        if (existing === undefined) order.push(key);
        if (existing === undefined || record.at >= existing.at) byOccurrence.set(key, record);
    }
    const kept: ReviewVerdictRecord[] = [];
    for (const key of order) {
        const record = byOccurrence.get(key);
        if (record) kept.push(record);
    }
    return kept;
}

/**
 * Parses a verdict ledger document.
 *
 * @param document - Parsed JSON value, of unknown shape.
 * @returns Accepted records plus rejection reasons.
 */
export function parseReviewVerdictLedger(document: unknown): ReviewVerdictLedgerReadResult {
    if (typeof document !== 'object' || document === null) {
        return { records: [], rejections: [REASON_NOT_OBJECT] };
    }
    const ledger = document as VerdictLedgerDocument;
    if (ledger.schema !== undefined && ledger.schema !== REVIEW_VERDICT_LEDGER_SCHEMA) {
        return { records: [], rejections: [REASON_SCHEMA] };
    }
    if (ledger.verdicts === undefined) return { records: [], rejections: [] };
    if (!Array.isArray(ledger.verdicts)) return { records: [], rejections: [REASON_ENTRIES] };
    const accepted: ReviewVerdictRecord[] = [];
    const rejections: string[] = [];
    for (const rawEntry of ledger.verdicts) {
        if (typeof rawEntry !== 'object' || rawEntry === null) {
            rejections.push(REASON_ENTRY_SHAPE);
            continue;
        }
        const parsed = readVerdictEntry(rawEntry as VerdictEntryDocument);
        if (!parsed.ok) {
            rejections.push(parsed.reason);
            continue;
        }
        accepted.push(parsed.record);
    }
    return { records: newestPerOccurrence(accepted), rejections };
}

/**
 * Merges new verdicts over existing ones, keeping one record per occurrence.
 *
 * Exported because the identity rule must have exactly one implementation: a caller that merged by
 * appending and then aggregated would count a corrected finding twice, once right and once wrong,
 * and the posterior would drift toward whichever answer happened to be recorded first. Newest
 * timestamp wins; ties resolve to the newly supplied record, so an immediate correction does not
 * have to wait for the clock to advance.
 *
 * @param existing - Verdicts already recorded.
 * @param incoming - Newly recorded verdicts.
 * @returns One record per occurrence, existing records first.
 */
export function mergeVerdicts(
    existing: readonly ReviewVerdictRecord[],
    incoming: readonly ReviewVerdictRecord[],
): ReviewVerdictRecord[] {
    return newestPerOccurrence([...existing, ...incoming]);
}

/**
 * Aggregates per-occurrence verdicts into per-rule outcome counts.
 *
 * Counting occurrences rather than reviewer actions is what keeps the posterior honest: a rule that
 * fired twice on one file and was judged wrong twice contributes two false positives, because two
 * separate findings were shown to a person and both were noise.
 *
 * @param records - Accepted verdict records, one per occurrence.
 * @returns Per-rule counts sorted by rule id, so the serialized corpus is canonical.
 */
export function aggregateVerdicts(records: readonly ReviewVerdictRecord[]): RuleCalibrationStats[] {
    const byRule = new Map<string, { truePositives: number; falsePositives: number }>();
    for (const record of records) {
        const bucket = byRule.get(record.rule) ?? { truePositives: 0, falsePositives: 0 };
        if (record.verdict === VERDICT_TRUE_POSITIVE) bucket.truePositives += 1;
        else bucket.falsePositives += 1;
        byRule.set(record.rule, bucket);
    }
    const stats: RuleCalibrationStats[] = [];
    for (const [rule, bucket] of byRule) {
        stats.push({ rule, truePositives: bucket.truePositives, falsePositives: bucket.falsePositives });
    }
    return stats.sort((left, right) => (left.rule < right.rule ? -1 : left.rule > right.rule ? 1 : 0));
}

/**
 * Lists the rule ids the ledger has evidence about.
 *
 * Exported so a caller can distinguish an empty posterior (no rule judged yet) from a posterior
 * that happens to be neutral, which a bare count cannot express.
 *
 * @param stats - Aggregated statistics.
 * @returns Rule ids in ascending order.
 */
export function coveredRules(stats: readonly RuleCalibrationStats[]): string[] {
    return stats.map((entry) => entry.rule);
}

/**
 * Serializes aggregated counts into the corpus document the arbiter reads.
 *
 * @param stats - Aggregated per-rule statistics.
 * @param schemaTag - Corpus schema tag to declare; supplied by the caller to avoid a cycle with
 *   the loader that defines it.
 * @returns Pretty-printed corpus document ending with a newline.
 */
export function serializeCorpus(stats: readonly RuleCalibrationStats[], schemaTag: string): string {
    const document = {
        schema: schemaTag,
        rules: stats.map((entry) => ({
            rule: entry.rule,
            truePositives: entry.truePositives,
            falsePositives: entry.falsePositives,
        })),
    };
    return JSON.stringify(document, null, 2) + '\n';
}
