/**
 * Module: Core Engine — Baseline Ratchet & Grouping Manager
 * File Path: src/core/reporting/baselineManager.ts
 * Architecture Role: Storage and evaluation layer for baseline snapshots and ratchet diffs.
 * Dependencies & Triggers: fs, ../types, ../logger; invoked by reportFinalizer post-scan.
 * Responsibilities: Serialize baseline snapshots (grouped counts or one row per distinct issue
 *   id, each carrying a severity histogram) and decide which current findings have no credit left.
 * Exit Semantics & Design Rationale: The ratchet consumes one credit per baselined occurrence, so
 *   a finding is new when its key is absent, when the key already spent every occurrence it had
 *   (same-line growth), or when its severity outranks every credit recorded for that key
 *   (warning→error escalation). Reading ids as a set — the pre-1.2 behaviour — hid both, because
 *   one id covers every finding of a rule on a line and severity never entered the comparison.
 */

import * as fs from 'fs';
import type { ScanReport, Issue, Severity } from '../types';
import type { Logger } from '../logger';

/** Baseline ratchet granularity that compares per-(analyzer|rule|file) counts. */
export const BASELINE_GRANULARITY_GROUPED = 'grouped';

/**
 * Baseline payload version written by this build. 1.2.0 adds a per-key severity histogram to both
 * granularities. Version 1.0.0 (id list) and 1.1.0 (grouped counts) stay readable, but a legacy
 * baseline records no severity, so escalation detection starts only after a re-freeze.
 */
export const BASELINE_VERSION = '1.2.0';

/** Bucket that absorbs every severity; used when a baseline recorded none (legacy payloads). */
const UNKNOWN_SEVERITY = 'unknown';

/** Severity ordering. A credit only absorbs findings at or below its own severity. */
const SEVERITY_RANK: Record<string, number> = { info: 0, warning: 1, error: 2 };

/**
 * One grouped baseline row: the comparison key, how many findings it stood for, and how those
 * findings were distributed across severities at freeze time (absent in 1.1.0 baselines).
 */
export interface GroupedBaselineRow {
    key: string;
    count: number;
    severities?: Record<string, number>;
}

/** Occurrence counts per severity, keyed by severity name. */
type SeverityHistogram = Record<string, number>;

/** Remaining absorption capacity of one comparison key. */
interface BaselineCredits {
    /** Occurrences still available per severity bucket; mutated as credits are consumed. */
    buckets: Map<string, number>;
    /** Total unconsumed occurrences across every bucket. */
    remaining: number;
}

/** A baseline payload as written to disk; legacy versions simply omit the newer fields. */
interface BaselinePayload {
    version?: string;
    granularity?: string;
    timestamp?: string;
    groups?: GroupedBaselineRow[];
    issues?: string[];
    severities?: Record<string, SeverityHistogram>;
}

/** Parsed baseline plus whether it recorded severity (1.2.0+) or only occurrence counts. */
interface BaselineSnapshot {
    credits: Map<string, BaselineCredits>;
    severityAware: boolean;
}

/** Comparison key for grouped granularity: analyzer, rule and repository-relative file. */
function issueGroupKey(issue: Issue): string {
    return `${issue.analyzer}|${issue.rule}|${issue.location.file.replace(/\\/g, '/')}`;
}

/**
 * Aggregate issue occurrences by analyzer, rule, and repository-relative file path.
 *
 * @param issues - Issues to group.
 * @returns Grouped rows carrying occurrence counts and per-severity histograms.
 */
export function groupCounts(issues: Issue[]): GroupedBaselineRow[] {
    const rows = new Map<string, { count: number; severities: SeverityHistogram }>();
    for (const issue of issues) {
        const key = issueGroupKey(issue);
        const row = rows.get(key) ?? { count: 0, severities: {} };
        row.count += 1;
        row.severities[issue.severity] = (row.severities[issue.severity] ?? 0) + 1;
        rows.set(key, row);
    }
    return [...rows].map(([key, row]) => ({ key, count: row.count, severities: row.severities }));
}

/**
 * Build the per-id severity histograms stored alongside an id-granularity baseline.
 *
 * @param issues - Issues of the frozen report.
 * @returns Occurrence counts per severity for every distinct issue id.
 */
function idSeverityHistograms(issues: Issue[]): Record<string, SeverityHistogram> {
    const histograms: Record<string, SeverityHistogram> = {};
    for (const issue of issues) {
        const histogram = histograms[issue.id] ?? {};
        histogram[issue.severity] = (histogram[issue.severity] ?? 0) + 1;
        histograms[issue.id] = histogram;
    }
    return histograms;
}

/**
 * Build one credit ledger entry.
 *
 * A recorded histogram is authoritative — it is the only record of how severe the baselined
 * findings were. Without one the entry falls back to a single `unknown` bucket that absorbs every
 * severity, which preserves the count-only behaviour of pre-1.2 baselines.
 *
 * @param count - Occurrences recorded for the key.
 * @param severities - Per-severity occurrence counts, when the baseline recorded them.
 * @returns Credit ledger entry for that key.
 */
function creditFrom(count: number, severities?: SeverityHistogram): BaselineCredits {
    const entries = severities ? Object.entries(severities) : [];
    if (entries.length === 0) {
        return { buckets: new Map([[UNKNOWN_SEVERITY, count]]), remaining: count };
    }
    const buckets = new Map(entries);
    return { buckets, remaining: [...buckets.values()].reduce((a, b) => a + b, 0) };
}

/**
 * Consume one baseline credit for a finding.
 *
 * The exact severity bucket is tried first; otherwise any bucket at least as severe may absorb the
 * finding, so a baselined error absorbs a later warning while a baselined warning never absorbs a
 * later error. An `unknown` bucket (legacy baseline) absorbs everything.
 *
 * @param credits - Mutable ledger entry for the finding's key.
 * @param severity - Severity of the finding asking for a credit.
 * @returns True when a credit was consumed, false when the finding must be reported as new.
 */
function consumeCredit(credits: BaselineCredits, severity: Severity): boolean {
    if (credits.remaining <= 0) return false;
    const exact = credits.buckets.get(severity) ?? 0;
    if (exact > 0) {
        credits.buckets.set(severity, exact - 1);
        credits.remaining -= 1;
        return true;
    }
    const rank = SEVERITY_RANK[severity] ?? 0;
    for (const [bucket, available] of credits.buckets) {
        const bucketRank =
            bucket === UNKNOWN_SEVERITY ? Number.POSITIVE_INFINITY : (SEVERITY_RANK[bucket] ?? 0);
        if (available > 0 && bucketRank >= rank) {
            credits.buckets.set(bucket, available - 1);
            credits.remaining -= 1;
            return true;
        }
    }
    return false;
}

/**
 * Read the credit ledger of a grouped baseline.
 *
 * @param groups - Grouped rows as stored in the payload.
 * @returns Credit ledger plus whether any row recorded severities.
 */
function readGroupedCredits(groups: GroupedBaselineRow[]): BaselineSnapshot {
    const credits = new Map<string, BaselineCredits>();
    let severityAware = false;
    for (const group of groups) {
        if (group.severities) severityAware = true;
        credits.set(group.key, creditFrom(group.count ?? 0, group.severities));
    }
    return { credits, severityAware };
}

/**
 * Read the credit ledger of an id-granularity baseline.
 *
 * 1.2.0 writes one row per distinct id plus its histogram, so the row count alone no longer
 * carries multiplicity; older baselines repeat a row per occurrence, and that occurrence count is
 * the fallback. Keys only present in the histogram are kept so a hand-trimmed id list cannot turn
 * baselined findings into false new ones.
 *
 * @param ids - Issue ids recorded in the payload.
 * @param severities - Per-id severity histograms, when the baseline recorded them.
 * @returns Credit ledger plus whether the payload recorded severities.
 */
function readIdCredits(
    ids: string[],
    severities?: Record<string, SeverityHistogram>,
): BaselineSnapshot {
    const occurrences = new Map<string, number>();
    for (const id of ids) {
        occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
    }
    // Union with the histogram keys: an id carrying a credit only in `severities` keeps it, so a
    // hand-trimmed id list can never turn a baselined finding into a false new one.
    for (const id of Object.keys(severities ?? {})) {
        if (!occurrences.has(id)) occurrences.set(id, 0);
    }
    const credits = new Map<string, BaselineCredits>();
    for (const id of occurrences.keys()) {
        credits.set(id, creditFrom(occurrences.get(id) ?? 0, severities?.[id]));
    }
    return { credits, severityAware: Boolean(severities) };
}

/**
 * Select the findings that have no baseline credit left, consuming credits in report order.
 *
 * @param issues - Current findings, in report order.
 * @param snapshot - Parsed baseline ledger.
 * @param keyOf - Key function matching the baseline granularity.
 * @returns Findings to annotate as new.
 */
function selectNewIssues(
    issues: Issue[],
    snapshot: BaselineSnapshot,
    keyOf: (issue: Issue) => string,
): Issue[] {
    const newIssues: Issue[] = [];
    for (const issue of issues) {
        const credit = snapshot.credits.get(keyOf(issue));
        if (!credit || !consumeCredit(credit, issue.severity)) newIssues.push(issue);
    }
    return newIssues;
}

/**
 * Persist the current scan issues to a baseline snapshot file.
 *
 * @param report - Completed scan report to serialize.
 * @param updateBaselinePath - Destination path for baseline JSON.
 * @param granularity - Ratchet granularity ('id' or 'grouped').
 * @param logger - Logger instance for operational telemetry.
 * Concurrency: asynchronous I/O operation; safe for single-threaded runtime.
 */
export async function handleBaselineUpdate(
    report: ScanReport,
    updateBaselinePath: string,
    granularity: string,
    logger: Logger,
): Promise<void> {
    const timestamp = new Date().toISOString();
    const baselineData: BaselinePayload =
        granularity === BASELINE_GRANULARITY_GROUPED
            ? {
                  version: BASELINE_VERSION,
                  granularity,
                  timestamp,
                  groups: groupCounts(report.issues),
              }
            : {
                  version: BASELINE_VERSION,
                  granularity: 'id',
                  timestamp,
                  // One row per distinct id: multiplicity and severity live in the histogram,
                  // so an id is never repeated once per same-line finding.
                  issues: [...new Set(report.issues.map((i) => i.id))],
                  severities: idSeverityHistograms(report.issues),
              };
    await fs.promises.writeFile(
        updateBaselinePath,
        JSON.stringify(baselineData, null, 2) + '\n',
        'utf8',
    );
    logger.info(`baseline written to ${updateBaselinePath} (granularity=${granularity})`);
}

/**
 * Compare scan issues against an existing baseline snapshot and mark new issues.
 *
 * @param report - Completed scan report to annotate in-place.
 * @param baselinePath - Source path for baseline JSON snapshot.
 * @param logger - Logger instance for operational telemetry.
 * Concurrency: asynchronous I/O operation; safe for single-threaded runtime.
 */
export async function handleBaselineRatchet(
    report: ScanReport,
    baselinePath: string,
    logger: Logger,
): Promise<void> {
    if (!fs.existsSync(baselinePath)) return;
    try {
        const raw = await fs.promises.readFile(baselinePath, 'utf8');
        const baselineData = JSON.parse(raw) as BaselinePayload;
        const groups = baselineData.groups ?? [];
        const ids = baselineData.issues ?? [];
        const isGrouped = baselineData.granularity === BASELINE_GRANULARITY_GROUPED;
        const snapshot = isGrouped
            ? readGroupedCredits(groups)
            : readIdCredits(ids, baselineData.severities);
        const newIssues = selectNewIssues(
            report.issues,
            snapshot,
            isGrouped ? issueGroupKey : (issue: Issue) => issue.id,
        );
        for (const issue of newIssues) issue.isNew = true;
        report.summary.ratchetBaselineUsed = true;
        const accepted = isGrouped ? groups.length : ids.length;
        logger.info(
            `baseline ratchet(${baselineData.granularity ?? 'id'}): accepted=${accepted} ` +
                `newIssues=${newIssues.length}` +
                (snapshot.severityAware
                    ? ''
                    : ' [legacy baseline: severity escalation stays undetectable until a re-freeze]'),
        );
    } catch (e) {
        logger.warn(`Failed to read baseline file: ${e}`);
    }
}
