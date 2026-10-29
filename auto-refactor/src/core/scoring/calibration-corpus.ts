/**
 * Module: Core Scoring — Calibration Corpus Loader
 * File Path: src/core/scoring/calibration-corpus.ts
 * Architecture Role: The intake valve between recorded review history and the arbiter. Until
 *   this existed, `confidence-calibration.json` was a documented format with nothing reading it:
 *   the arbiter accepted `ruleCalibrationStats` and no caller ever supplied any, so every rule
 *   stayed at its self-reported score no matter how much evidence the project had accumulated.
 * Dependencies & Triggers: consumes the on-disk corpus written by
 *   scripts/harvest-calibration-outcomes.js; called by reportFinalizer before the arbitration
 *   pass runs.
 * Responsibilities:
 *   1. Parse and validate a corpus document into `RuleCalibrationStats[]`.
 *   2. Reject an entry that would corrupt the posterior (negative counts, self-contradicting
 *      totals) rather than coercing it into something plausible.
 *   3. Report why a corpus was unusable, so a caller can warn instead of silently degrading.
 * Exit Semantics & Design Rationale: Fail-soft by design but never silent. A missing or
 *   malformed corpus yields no statistics and a stated reason, because the honest consequence of
 *   bad evidence is "no evidence", which leaves every confidence exactly where it was before this
 *   module existed. Throwing would turn a reporting convenience into a scan failure; swallowing
 *   the reason would hide a corpus that has quietly stopped being maintained.
 */

import type { RuleCalibrationStats } from './confidence-calibration';
import { sha256Hex } from '../cache-key';

/** Document schema tag this loader understands. */
export const CALIBRATION_CORPUS_SCHEMA = 'confidence-calibration-corpus/v1';

/** Number of digest characters kept as the corpus fingerprint. */
const CORPUS_DIGEST_CHARS = 16;

/**
 * Fingerprints the accepted evidence so a report can name the exact model it was judged against.
 *
 * Hashing only the accepted, sorted statistics rather than the file bytes is deliberate: two
 * corpora that differ in formatting, note text or rejected entries describe the same posterior,
 * and giving them different fingerprints would make the provenance look like it changed when the
 * judgement did not. The reverse matters more — a corpus whose counts moved must produce a
 * different digest, or a report could claim evidence it never used.
 *
 * @param stats - Accepted per-rule statistics.
 * @returns 16-character digest over the canonical statistics.
 */
export function fingerprintCorpus(stats: readonly RuleCalibrationStats[]): string {
    const canonical = stats
        .map((entry) => `${entry.rule}\u0000${entry.truePositives}\u0000${entry.falsePositives}`)
        .sort()
        .join('\n');
    return sha256Hex(canonical).slice(0, CORPUS_DIGEST_CHARS);
}

/** One corpus entry as it appears on disk. */
interface CorpusEntryDocument {
    readonly rule?: unknown;
    readonly truePositives?: unknown;
    readonly falsePositives?: unknown;
}

/** Corpus document shape; every field is optional so a truncated file is still diagnosable. */
interface CalibrationCorpusDocument {
    readonly schema?: unknown;
    readonly rules?: unknown;
}

/** Result of loading a corpus: the accepted statistics plus why anything was rejected. */
export interface CalibrationCorpusLoadResult {
    /** Statistics accepted; empty when the document was unusable. */
    readonly stats: RuleCalibrationStats[];
    /** Human-readable reasons entries were dropped; empty when the whole document was accepted. */
    readonly rejections: string[];
}

/** Reason reported when the document is not the object this loader expects. */
const REASON_NOT_OBJECT = 'corpus root is not an object';
const REASON_SCHEMA = 'corpus schema tag is not the supported one';
const REASON_RULES = 'corpus rules field is not an array';
const REASON_ENTRY_SHAPE = 'entry is not an object';
const REASON_RULE_ID = 'entry has no non-empty string rule id';
const REASON_COUNTS = 'entry has a negative or non-integer outcome count';
const REASON_EMPTY = 'entry has no observations at all';

/**
 * Reads one outcome count, accepting only a non-negative integer.
 *
 * Numbers arriving from JSON survive as numbers, but a hand-edited file may carry a string. The
 * safe reading is "not a count" rather than a coercion: `Math.max(0, Number(x))` would silently
 * turn a typo into zero or, worse, turn `true` into one fabricated observation.
 *
 * @param value - Raw field value.
 * @returns The count, or undefined when the value is not a valid count.
 */
function readCount(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return undefined;
    return value;
}

/**
 * Validates one corpus entry into a statistics record.
 *
 * @param entry - Raw entry from the document.
 * @returns Accepted record, or a rejection reason.
 */
function readEntry(
    entry: CorpusEntryDocument,
): { ok: true; stats: RuleCalibrationStats } | { ok: false; reason: string } {
    const rule = entry.rule;
    if (typeof rule !== 'string' || rule.length === 0) return { ok: false, reason: REASON_RULE_ID };
    const truePositives = readCount(entry.truePositives);
    const falsePositives = readCount(entry.falsePositives);
    if (truePositives === undefined || falsePositives === undefined) {
        return { ok: false, reason: REASON_COUNTS };
    }
    if (truePositives + falsePositives === 0) return { ok: false, reason: REASON_EMPTY };
    return { ok: true, stats: { rule, truePositives, falsePositives } };
}

/**
 * Splits a raw rules array into accepted statistics and rejection reasons.
 *
 * Extracted from `parseCalibrationCorpus` so the document-level shape checks and the
 * per-entry checks each stay legible; combining them in one function crossed the complexity
 * threshold that the engine enforces on itself.
 *
 * @param entries - Raw rules array, element types unknown.
 * @returns Accepted statistics plus one reason per dropped entry.
 */
function readEntries(entries: readonly unknown[]): CalibrationCorpusLoadResult {
    const stats: RuleCalibrationStats[] = [];
    const rejections: string[] = [];
    const seen = new Set<string>();
    for (const rawEntry of entries) {
        if (typeof rawEntry !== 'object' || rawEntry === null) {
            rejections.push(REASON_ENTRY_SHAPE);
            continue;
        }
        const parsed = readEntry(rawEntry as CorpusEntryDocument);
        if (!parsed.ok) {
            rejections.push(parsed.reason);
            continue;
        }
        if (seen.has(parsed.stats.rule)) {
            rejections.push(`duplicate rule id '${parsed.stats.rule}'`);
            continue;
        }
        seen.add(parsed.stats.rule);
        stats.push(parsed.stats);
    }
    return { stats, rejections };
}

/**
 * Parses a corpus document into rule statistics.
 *
 * A duplicate rule id is a corpus bug rather than a merge case: two entries claiming different
 * histories for one rule means the file has been edited by two sources, and picking either would
 * make the posterior depend on document order. Both are rejected and the reason names the rule.
 *
 * @param document - Parsed JSON value, of unknown shape.
 * @returns Accepted statistics plus rejection reasons.
 */
export function parseCalibrationCorpus(document: unknown): CalibrationCorpusLoadResult {
    if (typeof document !== 'object' || document === null) {
        return { stats: [], rejections: [REASON_NOT_OBJECT] };
    }
    const corpus = document as CalibrationCorpusDocument;
    if (corpus.schema !== undefined && corpus.schema !== CALIBRATION_CORPUS_SCHEMA) {
        return { stats: [], rejections: [REASON_SCHEMA] };
    }
    if (corpus.rules === undefined) return { stats: [], rejections: [] };
    if (!Array.isArray(corpus.rules)) return { stats: [], rejections: [REASON_RULES] };
    return readEntries(corpus.rules);
}

/**
 * Loads a corpus file from disk.
 *
 * A missing file is not an error: most projects never write one, and the pre-calibration
 * behaviour is the correct behaviour for them. The read is injected and asynchronous so the
 * caller can hand over the async filesystem API rather than blocking the event loop with a
 * synchronous read inside an already-async post-scan pass.
 *
 * @param corpusPath - Path to the corpus document, or undefined to skip loading.
 * @param readFile - Async reader returning the file body, or undefined when it does not exist.
 * @returns Accepted statistics plus rejection reasons; empty when the path is absent.
 */
export async function loadCalibrationCorpus(
    corpusPath: string | undefined,
    readFile: (filePath: string) => Promise<string | undefined>,
): Promise<CalibrationCorpusLoadResult> {
    if (!corpusPath) return { stats: [], rejections: [] };
    let raw: string | undefined;
    try {
        raw = await readFile(corpusPath);
    } catch (readError) {
        return { stats: [], rejections: [`corpus unreadable: ${String(readError)}`] };
    }
    if (raw === undefined) return { stats: [], rejections: [] };
    try {
        return parseCalibrationCorpus(JSON.parse(raw));
    } catch (parseError) {
        return { stats: [], rejections: [`corpus is not valid JSON: ${String(parseError)}`] };
    }
}
