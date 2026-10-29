/**
 * Module: Core Engine — Human Review Queue Projection
 * File Path: src/core/reporting/review-queue.ts
 * Architecture Role: The escalation arm of confidence adjudication. The arbiter decides what an
 *   automated tier can settle; the residue is a question only a person can answer. This module
 *   turns that residue into a deterministic, machine-readable work list instead of letting it
 *   dissolve into an undifferentiated findings dump that a reviewer must re-triage by hand.
 * Dependencies & Triggers: consumes ArbitratedFinding and the calibration anchors from
 *   ../scoring; invoked by reportFinalizer when `reviewQueue` names an output path.
 * Responsibilities:
 *   1. Assign every unresolved finding exactly one category under a stated precedence, so no
 *      finding is counted twice and none is silently dropped.
 *   2. Order the records deterministically and emit one NDJSON line each, so two runs over the
 *      same report produce byte-identical output.
 *   3. Report the record count so the caller can log the queue depth.
 * Exit Semantics & Design Rationale: Pure projection plus a single write. A write failure
 *   propagates, unlike the fail-soft suppression path: a queue the caller explicitly asked for
 *   must surface its error, because a missing file is indistinguishable from an empty queue.
 *   A report with nothing to review writes nothing and returns zero.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ArbitratedFinding } from '../scoring/finding-confidence-arbiter';
import { CALIBRATION_SHRINKAGE_ANCHOR } from '../scoring/confidence-calibration';

/** Category token for a finding no automated tier could settle at all. */
export const QUEUE_NEEDS_HUMAN = 'needs-human';

/** Category token for a finding that only runtime evidence can confirm or refute. */
export const QUEUE_RUNTIME_EVIDENCE = 'runtime-evidence';

/** Category token for a finding whose rule has never been observed to resolve. */
export const QUEUE_UNCALIBRATED = 'uncalibrated';

/** Category token for a well-observed rule the arbiter still could not promote. */
export const QUEUE_ADVISORY = 'advisory';

/** Categories in the order a reviewer should work through them. */
export type ReviewQueueCategory =
    | typeof QUEUE_NEEDS_HUMAN
    | typeof QUEUE_RUNTIME_EVIDENCE
    | typeof QUEUE_UNCALIBRATED
    | typeof QUEUE_ADVISORY;

/** One unit of human review work, in the shape written to the queue file. */
export interface ReviewQueueRecord {
    /** Why this finding reached a human, as one of the four categories. */
    readonly category: ReviewQueueCategory;
    /** Rule id the finding was reported under. */
    readonly rule: string;
    /** Analyzer that produced the finding. */
    readonly analyzer: string;
    /** File the finding points at. */
    readonly file: string;
    /** 1-based line of the finding. */
    readonly line: number;
    /** Severity the analyzer assigned. */
    readonly severity: string;
    /** Tier the arbiter assigned. */
    readonly tier: string;
    /** Adjudicated confidence in [0, 1]. */
    readonly conf: number;
    /** Observations behind that confidence; zero means the score is a self-report. */
    readonly calibrationSampleSize: number;
    /** Whether the analyzer stated that only runtime evidence can settle the finding. */
    readonly requiresRuntime: boolean;
    /** Arbiter's own explanation, carried verbatim so the reviewer sees the real reason. */
    readonly rationale: string;
}

/** Numeric precedence per category; lower is reviewed first. */
const CATEGORY_PRECEDENCE: Record<ReviewQueueCategory, number> = {
    [QUEUE_NEEDS_HUMAN]: 0,
    [QUEUE_RUNTIME_EVIDENCE]: 1,
    [QUEUE_UNCALIBRATED]: 2,
    [QUEUE_ADVISORY]: 3,
};

/**
 * Decides whether one arbitrated finding needs a human, and under which category.
 *
 * Precedence is deliberate and total, and the exclusions are what keep the queue a work list
 * rather than a second copy of the report.
 *
 * A blocking finding is excluded first: the automated tier already answered it, and queueing it
 * would double-count the same work. A suppressed finding is excluded next: someone already
 * decided it, with a recorded reason. An **actionable** finding is excluded third, and that
 * exclusion is load-bearing: it carries a patch the pipeline trusts, so sending it to a person
 * spends review attention on work a codemod can do. Without this rule the queue degenerates into
 * "every finding whose rule has no outcome history", which on a young rule set is nearly
 * everything.
 *
 * Note the exclusion keys on the tier, not on the mere presence of a patch. A patch attached to a
 * finding the evidence demoted to advisory is exactly what a reviewer must see — the record says
 * the proposed fix is usually wrong, and only a person can decide that for this instance. Keying
 * on `executablePatch` alone would hide those, which is the opposite of the queue's purpose.
 *
 * Among the rest, runtime need outranks missing calibration because no amount of outcome history
 * can settle a question that requires executing the code, and missing calibration outranks a bare
 * advisory vote because the first says "we have no evidence" while the second says "we have
 * evidence and it still is not enough".
 *
 * The advisory branch is narrowed to rules the posterior already considers reliable. The
 * interesting case is a rule with enough observations behind it that the arbiter's refusal to
 * promote it is a signal rather than ignorance.
 *
 * @param finding - Arbitrated finding from the post-scan arbitration pass.
 * @returns Category to file it under, or undefined when no human is needed.
 */
export function categorizeForReview(finding: ArbitratedFinding): ReviewQueueCategory | undefined {
    if (finding.mustBlock || finding.isSuppressed) return undefined;
    if (finding.tier === 'actionable') return undefined;
    const requiresRuntime = finding.issue.evidence?.requiresRuntime === true;
    if (requiresRuntime) {
        return finding.confidenceSource === 'uncalibrated'
            ? QUEUE_NEEDS_HUMAN
            : QUEUE_RUNTIME_EVIDENCE;
    }
    if (finding.confidenceSource === 'uncalibrated') return QUEUE_UNCALIBRATED;
    if (
        finding.tier === 'advisory' &&
        (finding.calibrationSampleSize ?? 0) >= CALIBRATION_SHRINKAGE_ANCHOR
    ) {
        return QUEUE_ADVISORY;
    }
    return undefined;
}

/**
 * Projects one arbitrated finding into a queue record.
 *
 * @param finding - Arbitrated finding already known to need review.
 * @param category - Category resolved by {@link categorizeForReview}.
 * @returns Record with every field a reviewer needs to act without re-reading the report.
 */
function buildRecord(finding: ArbitratedFinding, category: ReviewQueueCategory): ReviewQueueRecord {
    return {
        category,
        rule: finding.issue.rule,
        analyzer: finding.issue.analyzer,
        file: finding.issue.location.file.replace(/\\/g, '/'),
        line: finding.issue.location.start.line,
        severity: finding.issue.severity,
        tier: finding.tier,
        conf: Number(finding.confidence.toFixed(4)),
        calibrationSampleSize: finding.calibrationSampleSize ?? 0,
        requiresRuntime: finding.issue.evidence?.requiresRuntime === true,
        rationale: finding.rationale,
    };
}

/**
 * Orders queue records so the file is stable across runs.
 *
 * Total order, no ties left to the sort implementation: category, then file, line, rule and
 * analyzer. Two records can still share all five when the same rule fires twice on one line, but
 * then they are indistinguishable anyway, so their relative order cannot change the bytes.
 *
 * @param left - First record.
 * @param right - Second record.
 * @returns Negative, zero, or positive per the conventional comparator contract.
 */
function compareRecords(left: ReviewQueueRecord, right: ReviewQueueRecord): number {
    const byCategory = CATEGORY_PRECEDENCE[left.category] - CATEGORY_PRECEDENCE[right.category];
    if (byCategory !== 0) return byCategory;
    if (left.file !== right.file) return left.file < right.file ? -1 : 1;
    if (left.line !== right.line) return left.line - right.line;
    if (left.rule !== right.rule) return left.rule < right.rule ? -1 : 1;
    if (left.analyzer !== right.analyzer) return left.analyzer < right.analyzer ? -1 : 1;
    return 0;
}

/**
 * Builds the ordered review queue for a report.
 *
 * @param findings - Every arbitrated finding, including suppressed and clustered ones.
 * @returns Deterministically ordered records; empty when nothing needs a human.
 */
export function buildReviewQueue(findings: readonly ArbitratedFinding[]): ReviewQueueRecord[] {
    const records: ReviewQueueRecord[] = [];
    for (const finding of findings) {
        const category = categorizeForReview(finding);
        if (!category) continue;
        records.push(buildRecord(finding, category));
    }
    return records.sort(compareRecords);
}

/**
 * Counts the records in the narrowest category, the intersection of "no calibration evidence"
 * and "only runtime can settle it".
 *
 * Exported so the summary counter and the queue file can be asserted against each other: if the
 * two ever disagree, one of them is lying about how much human work exists.
 *
 * @param records - Ordered queue records.
 * @returns Number of records filed as needing a human.
 */
export function countNeedsHuman(records: readonly ReviewQueueRecord[]): number {
    let count = 0;
    for (const record of records) {
        if (record.category === QUEUE_NEEDS_HUMAN) count += 1;
    }
    return count;
}

/**
 * Serializes queue records as newline-delimited JSON, one record per line.
 *
 * @param records - Ordered queue records.
 * @returns NDJSON body ending with a newline, or an empty string for an empty queue.
 */
export function serializeReviewQueue(records: readonly ReviewQueueRecord[]): string {
    if (records.length === 0) return '';
    let body = '';
    for (const record of records) body += JSON.stringify(record) + '\n';
    return body;
}

/**
 * Writes the review queue to disk.
 *
 * The parent directory is created when missing, because the caller named a path rather than a
 * directory and refusing to write into a fresh `reports/` folder would make the flag useless on
 * a first run. An empty queue still truncates the file: a stale queue from a previous run would
 * otherwise look like current work.
 *
 * @param targetPath - File path to write; parents are created as needed.
 * @param records - Ordered queue records.
 * @returns Number of records written.
 * @throws Propagates filesystem errors; the caller asked for this file, so silence would lie.
 * Concurrency: idempotent and last-writer-wins. Two callers targeting one path in parallel
 * produce one of the two complete bodies, never an interleaved one, because the write is a
 * single `writeFile` call; neither caller may assume its own body survived.
 */
export async function writeReviewQueue(
    targetPath: string,
    records: readonly ReviewQueueRecord[],
): Promise<number> {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, serializeReviewQueue(records), 'utf8');
    return records.length;
}
