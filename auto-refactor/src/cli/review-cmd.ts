/**
 * Module: CLI — Review Verdict Command
 * File Path: src/cli/reviewCmd.ts
 * Architecture Role: The only sanctioned write path into the calibration corpus. Without it the
 *   corpus had a reader and no writer, so evidenced calibration was unreachable outside hand
 *   editing, and a reviewer's answer to a queued finding went nowhere. This command takes those
 *   answers, appends them to the verdict ledger, and re-derives the corpus counts from the whole
 *   ledger.
 * Dependencies & Triggers: Triggered by `auto-refactor review`; uses `review-queue-intake` to read
 *   the work list, `review-verdict-ledger` to validate and aggregate, and fs/path for I/O.
 * Responsibilities:
 *   1. Resolve which occurrences the invocation answers: an explicit rule/file/line, or the whole
 *      queue when neither is given.
 *   2. Skip occurrences that already carry a verdict, so a repeated run cannot restate evidence.
 *   3. Append the new verdicts, then rewrite the corpus from the complete ledger.
 * Exit Semantics & Design Rationale: Resolves to `{ code, text }` rather than calling process.exit,
 *   matching the other commands: 0 when verdicts were recorded or the queue held nothing pending, 1
 *   when the queue or ledger could not be read, 2 on a usage error. The corpus is NOT incremented in
 *   place — it is recomputed from the ledger every time, which is what makes the writer idempotent.
 *   A caller who runs the same review twice gets the same posterior, not twice the evidence.
 *
 * The ledger is the source of truth and the corpus is a projection of it. The reverse arrangement
 * (increment the corpus, log the verdict separately) loses the ability to correct a mistake: a
 * reviewer who flips an answer would leave both counts standing forever.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    parseReviewQueueBody,
    toVerdictRecords,
    unjudged,
    type QueuedOccurrence,
} from '../core/reporting/review-queue-intake';
import {
    REVIEW_VERDICT_LEDGER_SCHEMA,
    VERDICT_FALSE_POSITIVE,
    VERDICT_TRUE_POSITIVE,
    aggregateVerdicts,
    mergeVerdicts as mergeLedgerVerdicts,
    parseReviewVerdictLedger,
    serializeCorpus,
    type ReviewVerdictKind,
    type ReviewVerdictRecord,
} from '../core/scoring/review-verdict-ledger';
import { CALIBRATION_CORPUS_SCHEMA } from '../core/scoring/calibration-corpus';

/** Exit code for a completed review whose input was usable. */
const EXIT_OK = 0;

/** Exit code for unusable input: missing queue, unreadable ledger, unknown verdict. */
const EXIT_INPUT = 1;

/** Exit code for a malformed invocation. */
const EXIT_USAGE = 2;

/** Flag name for the queue file to read. */
const FLAG_QUEUE = '--queue';

/** Flag name for the verdict ledger path. */
const FLAG_LEDGER = '--ledger';

/** Flag name for the corpus document to rewrite. */
const FLAG_CORPUS = '--corpus';

/** Flag name selecting the answer. */
const FLAG_VERDICT = '--verdict';

/** Flag name narrowing the answer to one rule. */
const FLAG_RULE = '--rule';

/** Flag name narrowing the answer to one file. */
const FLAG_FILE = '--file';

/** Flag name narrowing the answer to one line. */
const FLAG_LINE = '--line';

/** Marker printed when the invocation answers the whole queue rather than one occurrence. */
const ALL_PENDING = 'all';

/** Default ledger file name, relative to the corpus directory. */
const DEFAULT_LEDGER_NAME = 'review-verdicts.json';

/** Usage text shown for a malformed invocation. */
const USAGE = [
    'Usage: auto-refactor review --queue <queue.ndjson> --corpus <corpus.json> --verdict <true-positive|false-positive>',
    '',
    'Answers queued review findings and rewrites the calibration corpus from the verdict ledger.',
    '',
    '  --queue <path>     NDJSON written by --review-queue',
    '  --corpus <path>    Calibration corpus to rewrite (read by --confidence-corpus)',
    '  --verdict <kind>   true-positive or false-positive',
    '  --ledger <path>    Verdict ledger; defaults to review-verdicts.json beside the corpus',
    '  --rule <id>        Answer only this rule (omit to answer every pending record)',
    '  --file <path>      Answer only this file',
    '  --line <n>         Answer only this line',
    '',
    'Records already carrying a verdict are skipped, so re-running the same review is safe.',
].join('\n');

/** Parsed invocation. */
interface ReviewInvocation {
    readonly queue: string;
    readonly corpus: string;
    readonly ledger: string | undefined;
    readonly verdict: ReviewVerdictKind;
    readonly rule: string | undefined;
    readonly file: string | undefined;
    readonly line: number | undefined;
}

/**
 * Reads the value following a flag.
 *
 * @param args - Raw argument list.
 * @param flag - Flag to look for.
 * @returns The value, or undefined when the flag is absent or followed by another flag.
 */
function readFlag(args: readonly string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) return undefined;
    return value;
}

/**
 * Interprets the verdict flag.
 *
 * @param raw - Raw flag value.
 * @returns The verdict kind, or undefined when the token is not one of the two answers.
 */
function readVerdict(raw: string | undefined): ReviewVerdictKind | undefined {
    if (raw === VERDICT_TRUE_POSITIVE) return VERDICT_TRUE_POSITIVE;
    if (raw === VERDICT_FALSE_POSITIVE) return VERDICT_FALSE_POSITIVE;
    return undefined;
}

/**
 * Reads a positive line number from a flag.
 *
 * @param raw - Raw flag value.
 * @returns The line, or undefined when absent or not a positive integer.
 */
function readLineFlag(raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1) return undefined;
    return parsed;
}

/**
 * Validates the raw invocation into a resolved one.
 *
 * @param args - Raw argument list.
 * @returns The invocation, or a usage error string.
 */
function resolveInvocation(args: readonly string[]): ReviewInvocation | string {
    const queue = readFlag(args, FLAG_QUEUE);
    const corpus = readFlag(args, FLAG_CORPUS);
    const verdict = readVerdict(readFlag(args, FLAG_VERDICT));
    if (!queue) return 'missing --queue';
    if (!corpus) return 'missing --corpus';
    if (!verdict) return 'missing or unrecognized --verdict';
    const line = readLineFlag(readFlag(args, FLAG_LINE));
    if (readFlag(args, FLAG_LINE) !== undefined && line === undefined) {
        return '--line must be a positive integer';
    }
    return {
        queue,
        corpus,
        ledger: readFlag(args, FLAG_LEDGER),
        verdict,
        rule: readFlag(args, FLAG_RULE),
        file: readFlag(args, FLAG_FILE)?.replace(/\\/g, '/'),
        line,
    };
}

/**
 * Reads a file, treating absence as an empty body.
 *
 * @param filePath - Path to read.
 * @returns Contents, or undefined when the file does not exist.
 * @throws Propagates read errors other than absence; a permission failure must not look empty.
 */
function readOptional(filePath: string): string | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    return fs.readFileSync(filePath, 'utf8');
}

/**
 * Narrows queued occurrences to the ones the invocation names.
 *
 * @param occurrences - Queued occurrences.
 * @param invocation - Resolved invocation.
 * @returns Occurrences the invocation answers.
 */
function selectTargets(
    occurrences: readonly QueuedOccurrence[],
    invocation: ReviewInvocation,
): QueuedOccurrence[] {
    return occurrences.filter((occurrence) => {
        if (invocation.rule !== undefined && occurrence.rule !== invocation.rule) return false;
        if (invocation.file !== undefined && occurrence.file !== invocation.file) return false;
        if (invocation.line !== undefined && occurrence.line !== invocation.line) return false;
        return true;
    });
}

/**
 * Loads the verdict ledger, distinguishing absent from unreadable.
 *
 * @param ledgerPath - Path to the ledger.
 * @returns Existing records, or a rejection reason.
 */
function loadLedger(ledgerPath: string): ReviewVerdictRecord[] | string {
    let body: string | undefined;
    try {
        body = readOptional(ledgerPath);
    } catch (readError) {
        return `verdict ledger unreadable: ${String(readError)}`;
    }
    if (body === undefined) return [];
    try {
        const parsed = parseReviewVerdictLedger(JSON.parse(body));
        if (parsed.rejections.length > 0) {
            return `verdict ledger has ${parsed.rejections.length} unusable entr(ies): ${parsed.rejections[0]}`;
        }
        return parsed.records;
    } catch (parseError) {
        return `verdict ledger is not valid JSON: ${String(parseError)}`;
    }
}

/**
 * Serializes the ledger document.
 *
 * @param records - Records to persist.
 * @returns Pretty-printed ledger document ending with a newline.
 */
function serializeLedger(records: readonly ReviewVerdictRecord[]): string {
    return (
        JSON.stringify({ schema: REVIEW_VERDICT_LEDGER_SCHEMA, verdicts: records }, null, 2) + '\n'
    );
}

/**
 * Writes a document, creating its parent directory.
 *
 * @param filePath - Destination path.
 * @param body - Contents to write.
 */
function writeDocument(filePath: string, body: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, body, 'utf8');
}

/**
 * Reports whether the invocation names a specific occurrence.
 *
 * A narrowing flag means the caller pointed at a decision rather than sweeping the queue, which is
 * what distinguishes a deliberate correction from a repeated bulk run.
 *
 * @param invocation - Resolved invocation.
 * @returns True when at least one narrowing flag was supplied.
 */
function isNarrowed(invocation: ReviewInvocation): boolean {
    return (
        invocation.rule !== undefined ||
        invocation.file !== undefined ||
        invocation.line !== undefined
    );
}

/**
 * Resolves which queued occurrences this invocation answers.
 *
 * The distinction is deliberate and load-bearing. A narrowed invocation names a specific
 * occurrence, so it is taken as a considered answer and allowed to overwrite an earlier one —
 * that is how a reviewer corrects a mistake. An unnarrowed invocation sweeps the queue, so it
 * skips everything already judged; otherwise every routine re-run would restate the whole
 * backlog and, worse, silently keep an old wrong answer standing by re-recording it as new.
 *
 * @param occurrences - Queued occurrences.
 * @param invocation - Resolved invocation.
 * @param existing - Verdicts already recorded.
 * @returns Occurrences to answer.
 */
function resolveTargets(
    occurrences: readonly QueuedOccurrence[],
    invocation: ReviewInvocation,
    existing: readonly ReviewVerdictRecord[],
): QueuedOccurrence[] {
    const selected = selectTargets(occurrences, invocation);
    return isNarrowed(invocation) ? selected : unjudged(selected, existing);
}

/**
 * Applies the new verdicts over the existing ones, newest verdict wins per occurrence.
 *
 * Merging through the ledger's own deduplication rather than trusting the append order is what
 * makes a correction survive a later bulk run: the bulk run skips judged occurrences, so it cannot
 * resurrect a superseded answer.
 *
 * @param existing - Verdicts already recorded.
 * @param recorded - Newly recorded verdicts.
 * @returns Merged records, one per occurrence.
 */
function mergeVerdicts(
    existing: readonly ReviewVerdictRecord[],
    recorded: readonly ReviewVerdictRecord[],
): ReviewVerdictRecord[] {
    return mergeLedgerVerdicts(existing, recorded);
}

/**
 * Answers queued review findings and rewrites the calibration corpus.
 *
 * @param args - Raw argument list after the `review` subcommand.
 * @returns Exit code plus the text to show the caller.
 */
export function reviewCommand(args: readonly string[]): { code: number; text: string } {
    const invocation = resolveInvocation(args);
    if (typeof invocation === 'string') return { code: EXIT_USAGE, text: `${USAGE}\n\n${invocation}` };

    const ledgerPath =
        invocation.ledger ?? path.join(path.dirname(invocation.corpus), DEFAULT_LEDGER_NAME);

    let queueBody: string | undefined;
    try {
        queueBody = readOptional(invocation.queue);
    } catch (readError) {
        return { code: EXIT_INPUT, text: `review queue unreadable: ${String(readError)}` };
    }
    if (queueBody === undefined) {
        return { code: EXIT_INPUT, text: `review queue not found: ${invocation.queue}` };
    }

    const intake = parseReviewQueueBody(queueBody);
    const existing = loadLedger(ledgerPath);
    if (typeof existing === 'string') return { code: EXIT_INPUT, text: existing };

    const targets = resolveTargets(intake.occurrences, invocation, existing);
    if (targets.length === 0) {
        return {
            code: EXIT_OK,
            text:
                `Nothing to record: no pending record matches the selection ` +
                `(${intake.occurrences.length} queued, ${existing.length} already judged).`,
        };
    }

    const recorded = toVerdictRecords(targets, invocation.verdict, Date.now());
    const merged = mergeVerdicts(existing, recorded);
    const stats = aggregateVerdicts(merged);

    writeDocument(ledgerPath, serializeLedger(merged));
    writeDocument(invocation.corpus, serializeCorpus(stats, CALIBRATION_CORPUS_SCHEMA));

    return {
        code: EXIT_OK,
        text: [
            `Recorded ${recorded.length} verdict(s) as ${invocation.verdict} ` +
                `(${invocation.rule ?? ALL_PENDING}).`,
            `Ledger: ${ledgerPath} (${merged.length} record(s)).`,
            `Corpus: ${invocation.corpus} (${stats.length} rule(s) with evidence).`,
        ].join('\n'),
    };
}
