/**
 * Module: Core Reporting — Compact Report Builder & Legacy Migrator
 * File Path: src/core/reporting/compact-report-migrator.ts
 * Architecture Role: Lossless projection boundary between the verbose ScanReport model and the
 *   positional CAS v3.0 wire format, in both directions, plus shape sniffing for historical
 *   artifacts written before the compact schema existed.
 * Dependencies & Triggers: Consumes ../types and ./compact-report-types; consumed by the
 *   reporter registry (`compact` format), the CLI and the compact-schema verification suite.
 * Responsibilities:
 *   1. Project a ScanReport into CompactScanReport: vectors, palette, bottlenecks, health.
 *   2. Collapse findings one overlap cluster explains into a single representative claim.
 *   3. Hydrate a CompactScanReport back into Issue records and a summary block.
 *   4. Sniff historical artifact shapes (scan report, workspace snapshot, audit baseline,
 *      performance baseline, v0.3 baseline generation) and normalize each into the compact
 *      projection.
 * Exit Semantics & Design Rationale: Pure functions over already-loaded payloads; the only throw
 *   is an explicit rejection of an unrecognized shape, so callers never receive a half-filled
 *   document. Truncation is reported through `truncated` instead of being silently applied,
 *   because a consumer that cannot see dropped findings would read a partial report as complete.
 */

import type { Issue, ScanReport, Severity } from '../types';
import type { QualityDimension, QualityScoreBreakdown } from '../scoring/scoringTypes';
import { OVERLAP_CLUSTERS } from '../rules/overlap-clusters';
import {
    COMPACT_DIMENSION_KEYS,
    COMPACT_SCHEMA_ID,
    COMPACT_SEVERITY_CODE,
    COMPACT_SEVERITY_LABEL,
    type CompactBottleneck,
    type CompactClusterClaim,
    type CompactCounts,
    type CompactHealth,
    type CompactIssueVector,
    type CompactReportOptions,
    type CompactScanReport,
    type HydratedCompactReport,
} from './compact-report-types';

const DEFAULT_MAX_VECTORS = 500;
const DEFAULT_MAX_MESSAGE_CHARS = 160;
const DEFAULT_MAX_BOTTLENECKS = 12;
const DEFAULT_ANALYZER_NAME = 'unknown';
const ELLIPSIS = '…';
const LOCATION_SEPARATOR = ':';
const FIRST_COLUMN = 1;
const SEVERITY_INFO: Severity = 'info';
const SEVERITY_ERROR: Severity = 'error';
const SEVERITY_WARNING: Severity = 'warning';
const VERDICT_BLOCK = 'BLOCK';
const VERDICT_WARN = 'WARN';
const VERDICT_PASS = 'PASS';
const UNKNOWN_GRADE = 'N/A';

/** Aggregate counters derived from a report summary. */
function summarize(report: ScanReport): CompactCounts {
    const { summary } = report;
    const counts: CompactCounts = {
        files: summary.filesScanned,
        issues: summary.issuesTotal,
        errors: summary.bySeverity.error ?? 0,
        warns: summary.bySeverity.warning ?? 0,
        info: summary.bySeverity.info ?? 0,
    };
    return summary.suppressedCount === undefined
        ? counts
        : { ...counts, suppressed: summary.suppressedCount };
}

/** Map a severity label onto its numeric rank; unknown labels rank as informational. */
function severityRank(severity: string): number {
    return COMPACT_SEVERITY_CODE[severity] ?? 0;
}

/** Map a numeric rank back onto the canonical severity label. */
function severityLabel(rank: number): Severity {
    const label = COMPACT_SEVERITY_LABEL[rank] ?? SEVERITY_INFO;
    return label === SEVERITY_ERROR
        ? SEVERITY_ERROR
        : label === SEVERITY_WARNING
          ? SEVERITY_WARNING
          : SEVERITY_INFO;
}

/** Derive the triage verdict from unsuppressed severity counters. */
function resolveVerdict(counts: CompactCounts): CompactScanReport['verdict'] {
    if (counts.errors > 0) return VERDICT_BLOCK;
    return counts.warns > 0 ? VERDICT_WARN : VERDICT_PASS;
}

/** Trim a message to the emission budget, keeping the leading context that identifies it. */
function shorten(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, Math.max(1, maxChars - 1)) + ELLIPSIS;
}

/** Project the ten-dimension breakdown onto short keys, omitting dimensions never evaluated. */
function projectDimensions(breakdown?: QualityScoreBreakdown): Record<string, number> {
    if (!breakdown?.indices) return {};
    const projected: Record<string, number> = {};
    for (const [dimension, score] of Object.entries(breakdown.indices)) {
        if (typeof score !== 'number' || !Number.isFinite(score)) continue;
        projected[COMPACT_DIMENSION_KEYS[dimension as QualityDimension] ?? dimension] = score;
    }
    return projected;
}

/** Build the headline quality block, keeping an unmeasured composite distinguishable from zero. */
function projectHealth(report: ScanReport, options: CompactReportOptions): CompactHealth {
    const breakdown = report.qualityScore;
    const measured =
        breakdown !== undefined && Number.isFinite(breakdown.compositeScore)
            ? breakdown.compositeScore
            : null;
    const override = options.healthOverride;
    const health: CompactHealth = {
        score: override?.score ?? measured,
        grade: override?.grade ?? breakdown?.grade ?? UNKNOWN_GRADE,
    };
    if (breakdown?.coverage !== undefined) health.coverage = breakdown.coverage;
    if (breakdown?.confidence !== undefined) health.confidence = breakdown.confidence;
    const cai = override?.cai ?? report.autonomy?.compositeAutonomyIndex;
    if (typeof cai === 'number' && Number.isFinite(cai)) health.cai = cai;
    return health;
}

/**
 * Aggregate per-dimension deduction entries into ranked bottleneck rows.
 *
 * Each entry contributes its points and one occurrence; grouping is per (rule, dimension) so a
 * rule charged on two dimensions surfaces twice rather than hiding behind one blended total.
 */
function projectBottlenecks(
    breakdown: QualityScoreBreakdown | undefined,
    maxRows: number,
): CompactBottleneck[] {
    const groups = breakdown?.deductionsByDimension;
    if (!groups) return [];
    const aggregated = new Map<string, CompactBottleneck>();
    for (const [dimension, audit] of Object.entries(groups)) {
        const dimKey = COMPACT_DIMENSION_KEYS[dimension as QualityDimension] ?? dimension;
        for (const entry of audit?.entries ?? []) {
            const rule = entry.rule || DEFAULT_ANALYZER_NAME;
            const points = Number.isFinite(entry.points) ? entry.points : 0;
            const key = `${rule}|${dimKey}`;
            const existing = aggregated.get(key);
            if (existing) {
                existing.loss += points;
                existing.count += 1;
            } else {
                aggregated.set(key, { rule, dim: dimKey, loss: points, count: 1 });
            }
        }
    }
    return [...aggregated.values()]
        .sort((left, right) => right.loss - left.loss || left.rule.localeCompare(right.rule))
        .slice(0, maxRows);
}

/** Order findings so the most urgent appear first: severity, then file, then line. */
function compareIssues(left: Issue, right: Issue): number {
    const rankDiff = severityRank(right.severity) - severityRank(left.severity);
    if (rankDiff !== 0) return rankDiff;
    const fileDiff = left.location.file.localeCompare(right.location.file);
    if (fileDiff !== 0) return fileDiff;
    return left.location.start.line - right.location.start.line;
}

/**
 * Split the report's findings into the emitted window, the dropped remainder, and the eligible
 * set the window was cut from.
 *
 * `eligible` is returned because the aggregate projections (`clusters`) must describe the whole
 * report, not the surviving window: a claim covering a coordinate that the cap cut in half would
 * otherwise disappear entirely, which reads as "no overlap here" when the overlap is real.
 */
function selectIssues(
    issues: readonly Issue[],
    options: CompactReportOptions,
): { emitted: Issue[]; eligible: Issue[]; truncated: number } {
    const includeInfo = options.includeInfo === true;
    const eligible = includeInfo ? [...issues] : issues.filter((i) => i.severity !== SEVERITY_INFO);
    eligible.sort(compareIssues);
    const maxVectors = options.maxVectors ?? DEFAULT_MAX_VECTORS;
    return {
        emitted: eligible.slice(0, maxVectors),
        eligible,
        truncated: Math.max(0, eligible.length - maxVectors),
    };
}

/** Resolve the palette index for an analyzer name, appending it on first sight. */
function paletteIndex(palette: string[], index: Map<string, number>, analyzer: string): number {
    const known = index.get(analyzer);
    if (known !== undefined) return known;
    const assigned = palette.length;
    palette.push(analyzer);
    index.set(analyzer, assigned);
    return assigned;
}

/** Compose one positional vector from a finding. */
function toVector(issue: Issue, analyzerIndex: number, maxChars: number): CompactIssueVector {
    const action = issue.actionable?.action ?? null;
    const location = `${issue.location.file}${LOCATION_SEPARATOR}${issue.location.start.line}`;
    return [
        issue.rule,
        severityRank(issue.severity),
        location,
        shorten(issue.message ?? '', maxChars),
        action,
        analyzerIndex,
    ];
}

/** Build the palette and vector matrix, collecting anchors for blocking findings. */
function projectVectors(
    issues: readonly Issue[],
    options: CompactReportOptions,
): { pal: string[]; vectors: CompactIssueVector[]; anchors: Record<string, string> } {
    const maxChars = options.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;
    const pal: string[] = [];
    const index = new Map<string, number>();
    const anchors: Record<string, string> = {};
    const vectors = issues.map((issue) => {
        const vector = toVector(issue, paletteIndex(pal, index, issue.analyzer), maxChars);
        if (issue.severity === SEVERITY_ERROR && options.anchorProvider) {
            const slice = options.anchorProvider(issue);
            if (slice) anchors[vector[2]] = slice;
        }
        return vector;
    });
    return { pal, vectors, anchors };
}

/** Cluster keys indexed by member rule id, so a claim lookup never scans the cluster table. */
const CLUSTER_KEYS_BY_RULE: ReadonlyMap<string, readonly string[]> = (() => {
    const index = new Map<string, string[]>();
    for (const cluster of OVERLAP_CLUSTERS) {
        for (const member of cluster.members) {
            const keys = index.get(member);
            if (keys) {
                keys.push(cluster.key);
            } else {
                index.set(member, [cluster.key]);
            }
        }
    }
    return index;
})();

/** Bucket accumulator for one (coordinate, cluster) pair, reused across findings. */
interface ClaimBucket {
    readonly at: string;
    readonly cluster: string;
    readonly rules: string[];
    readonly ruleSet: Set<string>;
    /** Highest severity rank seen so far in this bucket. */
    topRank: number;
    /** Rule id holding `topRank`; ties resolve to the lexicographically smaller id. */
    primary: string;
}

/** Read or create the bucket for one (coordinate, cluster) pair. */
function claimBucket(
    buckets: Map<string, ClaimBucket>,
    order: string[],
    at: string,
    cluster: string,
): ClaimBucket {
    const key = `${at}|${cluster}`;
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: ClaimBucket = {
        at,
        cluster,
        rules: [],
        ruleSet: new Set(),
        topRank: -1,
        primary: '',
    };
    buckets.set(key, created);
    order.push(key);
    return created;
}

/** Fold one finding into its bucket, tracking the representative rule in the same pass. */
function foldIntoBucket(bucket: ClaimBucket, issue: Issue): void {
    if (!bucket.ruleSet.has(issue.rule)) {
        bucket.ruleSet.add(issue.rule);
        bucket.rules.push(issue.rule);
    }
    const rank = severityRank(issue.severity);
    if (rank > bucket.topRank || (rank === bucket.topRank && issue.rule < bucket.primary)) {
        bucket.topRank = rank;
        bucket.primary = issue.rule;
    }
}

/**
 * Collapse findings that one overlap cluster explains into a single representative claim.
 *
 * Scope is deliberately narrow — same coordinate, same cluster — because that is exactly the
 * condition under which two rules describe one defect. Findings at different lines are never
 * merged: each is a distinct repair site, and hiding the second would make the compact view look
 * cleaner than the code actually is.
 *
 * Single pass: every finding is folded into the buckets its rule participates in, reading the
 * cluster keys from an index instead of searching the cluster table. The representative rule is
 * elected during the same fold, so no per-bucket sort or second scan is needed.
 *
 * @param issues - The eligible finding set, before the emission cap is applied. Passing the capped
 *   window instead would tie the claim set to the vector budget: a coordinate whose members
 *   straddle the cap keeps only its leading member and reports no overlap at all, and a small
 *   budget drops every claim. Claims are aggregate triage facts, so they describe what was found,
 *   while `truncated` already tells the consumer how much was withheld.
 * @returns One claim per (coordinate, cluster) pair that carried at least two distinct members.
 */
function projectClusters(issues: readonly Issue[]): CompactClusterClaim[] {
    const buckets = new Map<string, ClaimBucket>();
    const order: string[] = [];
    for (const issue of issues) {
        const keys = CLUSTER_KEYS_BY_RULE.get(issue.rule);
        if (!keys) continue;
        const at = `${issue.location.file}${LOCATION_SEPARATOR}${issue.location.start.line}`;
        for (const cluster of keys) {
            foldIntoBucket(claimBucket(buckets, order, at, cluster), issue);
        }
    }

    const claims: CompactClusterClaim[] = [];
    for (const key of order) {
        const bucket = buckets.get(key) as ClaimBucket;
        if (bucket.rules.length < 2) continue;
        claims.push({
            at: bucket.at,
            cluster: bucket.cluster,
            rules: bucket.rules,
            primary: bucket.primary,
        });
    }
    return claims.sort(
        (left, right) =>
            left.at.localeCompare(right.at) || left.cluster.localeCompare(right.cluster),
    );
}

/**
 * Project a complete ScanReport into the compact CAS v3.0 document.
 *
 * @param report - Scan result to project; treated as read-only.
 * @param options - Emission policy controlling caps, info inclusion and anchor extraction.
 * @returns Compact document carrying the same verdict, counters and dimension scores.
 */
export function buildCompactReport(
    report: ScanReport,
    options: CompactReportOptions = {},
): CompactScanReport {
    const counts = summarize(report);
    const selection = selectIssues(report.issues ?? [], options);
    const projected = projectVectors(selection.emitted, options);
    const compact: CompactScanReport = {
        schema: COMPACT_SCHEMA_ID,
        tool: report.tool,
        version: report.version,
        ts: report.generatedAt,
        root: report.root,
        verdict: resolveVerdict(counts),
        counts,
        health: projectHealth(report, options),
        dimensions: projectDimensions(report.qualityScore),
        bottlenecks: projectBottlenecks(
            report.qualityScore,
            options.maxBottlenecks ?? DEFAULT_MAX_BOTTLENECKS,
        ),
        pal: projected.pal,
        vectors: projected.vectors,
    };
    if (Object.keys(projected.anchors).length > 0) compact.anchors = projected.anchors;
    const claims = projectClusters(selection.eligible);
    if (claims.length > 0) compact.clusters = claims;
    if (selection.truncated > 0) compact.truncated = selection.truncated;
    const notes = report.summary.warnings;
    if (notes && notes.length > 0) compact.notes = notes;
    return compact;
}

/**
 * Serialize a compact document; indent is opt-in because the wire format is token-sensitive.
 *
 * @param report - Scan result to project; treated as read-only.
 * @param options - Emission policy plus the optional `pretty` switch.
 * @returns Serialized CAS v3 document, newline-terminated.
 */
export function toCompactReportJson(
    report: ScanReport,
    options: CompactReportOptions & { readonly pretty?: boolean } = {},
): string {
    return JSON.stringify(
        buildCompactReport(report, options),
        null,
        options.pretty === true ? 2 : 0,
    );
}

/** Split a `file:line` location token on its last separator, tolerating separator-free input. */
function splitLocation(location: string): { file: string; line: number } {
    const cut = location.lastIndexOf(LOCATION_SEPARATOR);
    if (cut <= 0) return { file: location, line: FIRST_COLUMN };
    const parsed = Number.parseInt(location.slice(cut + 1), 10);
    return {
        file: location.slice(0, cut),
        line: Number.isFinite(parsed) && parsed > 0 ? parsed : FIRST_COLUMN,
    };
}

/** Rebuild one Issue record from a positional vector and the analyzer palette. */
function toIssue(vector: CompactIssueVector, pal: readonly string[]): Issue {
    const [rule, rank, location, message, action, analyzerIndex] = vector;
    const analyzer =
        typeof analyzerIndex === 'number' && analyzerIndex >= 0
            ? (pal[analyzerIndex] ?? DEFAULT_ANALYZER_NAME)
            : DEFAULT_ANALYZER_NAME;
    const { file, line } = splitLocation(location);
    const issue: Issue = {
        id: `${analyzer}:${rule}:${file}:${line}`,
        analyzer,
        rule,
        severity: severityLabel(rank),
        message,
        location: {
            file,
            start: { line, column: FIRST_COLUMN },
            end: { line, column: FIRST_COLUMN },
        },
        detail: {},
    };
    if (action) issue.detail = { action };
    return issue;
}

/**
 * Hydrate a compact document back into the legacy report shape.
 *
 * The reconstruction is complete for every field the vector layout carries; composite
 * dimensions, weights and the deduction audit trail are not recoverable, so callers needing
 * them must consume the original ScanReport instead of a hydrated projection.
 *
 * @param compact - Document previously produced by `buildCompactReport`.
 * @returns Reconstructed issues plus a summary block, and whether findings were dropped.
 */
export function hydrateCompactReport(compact: CompactScanReport): HydratedCompactReport {
    const issues = compact.vectors.map((vector) => toIssue(vector, compact.pal ?? []));
    return {
        report: {
            tool: compact.tool,
            version: compact.version,
            generatedAt: compact.ts,
            root: compact.root,
            issues,
            summary: {
                filesScanned: compact.counts.files,
                issuesTotal: compact.counts.issues,
                bySeverity: {
                    error: compact.counts.errors,
                    warning: compact.counts.warns,
                    info: compact.counts.info,
                },
                durationMs: 0,
            },
        },
        partial: (compact.truncated ?? 0) > 0,
    };
}

/**
 * Narrow an unknown payload to a compact document by its protocol discriminator.
 *
 * @param payload - Candidate value of unknown shape.
 * @returns True when the value declares the CAS v3 schema and carries a vector array.
 */
export function isCompactReport(payload: unknown): payload is CompactScanReport {
    if (typeof payload !== 'object' || payload === null) return false;
    const candidate = payload as Record<string, unknown>;
    return candidate.schema === COMPACT_SCHEMA_ID && Array.isArray(candidate.vectors);
}

/** Narrow an unknown payload to the verbose ScanReport shape. */
function isScanReport(payload: unknown): payload is ScanReport {
    if (typeof payload !== 'object' || payload === null) return false;
    const candidate = payload as Record<string, unknown>;
    return typeof candidate.summary === 'object' && Array.isArray(candidate.issues);
}

/** Read a finite number from an unknown field, or undefined when the field is not numeric. */
function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Narrow an unknown field to a plain object record, or undefined when it is not one. */
function readObject(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)
        : undefined;
}

/** Read a numeric field with a zero fallback, for counters that are legitimately absent. */
function readCount(source: Record<string, unknown>, field: string): number {
    return readNumber(source[field]) ?? 0;
}

/** Read a long-form dimension map (workspace snapshots use the full dimension names). */
function readDimensionMap(value: unknown): Record<string, number> {
    const indices = readObject(value);
    if (!indices) return {};
    return projectDimensions({ indices } as QualityScoreBreakdown);
}

/** Shared envelope fields every historical-artifact adapter supplies. */
interface SnapshotEnvelopeParams {
    readonly tool: string;
    readonly version: string;
    readonly ts: string;
    readonly root: string;
    readonly counts: CompactCounts;
    readonly score: number;
    readonly grade: string;
    readonly cai?: number;
    readonly dimensions: Record<string, number>;
    /** Verdict override for artifacts whose own status field outranks the counter derivation. */
    readonly verdict?: CompactScanReport['verdict'];
}

/**
 * Assemble the compact envelope shared by every adapter.
 *
 * Centralizing assembly keeps each adapter down to shape detection plus counter resolution, which
 * is what stops the growing set of supported artifact generations from inflating any one
 * function past the complexity budget.
 *
 * @param params - Resolved envelope fields.
 * @returns Compact projection with no vectors, since no historical artifact stores findings.
 */
function buildSnapshotEnvelope(params: SnapshotEnvelopeParams): CompactScanReport {
    const health: CompactHealth = { score: params.score, grade: params.grade };
    if (params.cai !== undefined) health.cai = params.cai;
    const compact: CompactScanReport = {
        schema: COMPACT_SCHEMA_ID,
        tool: params.tool,
        version: params.version,
        ts: params.ts,
        root: params.root,
        verdict: params.verdict ?? resolveVerdict(params.counts),
        counts: params.counts,
        health,
        dimensions: params.dimensions,
        bottlenecks: [],
        pal: [],
        vectors: [],
    };
    if (params.counts.issues > 0) compact.truncated = params.counts.issues;
    return compact;
}

/**
 * Normalize the aggregate snapshot written by the unified workspace audit.
 *
 * That artifact records a health score and dimension map but no individual findings, so the
 * projection carries zero vectors and declares the whole debt count as truncated. Its `status`
 * field is authoritative for the verdict because a failing audit can still report a high score.
 *
 * @param payload - Candidate snapshot object.
 * @returns Compact projection, or undefined when the shape does not match.
 */
function adaptWorkspaceSnapshot(payload: Record<string, unknown>): CompactScanReport | undefined {
    const score = readNumber(payload.workspaceHealthScore);
    if (score === undefined) return undefined;
    const debt = readCount(payload, 'totalDebt');
    return buildSnapshotEnvelope({
        tool: 'workspace-audit',
        version: String(payload.protocolVersion ?? ''),
        ts: String(payload.recordedAt ?? ''),
        root: String(payload.gitRevision ?? ''),
        counts: { files: 0, issues: debt, errors: 0, warns: debt, info: 0 },
        score,
        grade: String(payload.grade ?? UNKNOWN_GRADE),
        cai: readNumber(payload.autonomyRate),
        dimensions: readDimensionMap(payload.tenDimensions),
        verdict: payload.status === 'PASS' ? VERDICT_PASS : VERDICT_BLOCK,
    });
}

/**
 * Resolve the total finding count from either baseline generation.
 *
 * The current generation reports `totalIssues`; the v0.3 line reports only the blocking counts, so
 * its total is their sum.
 *
 * @param metricRecord - Counter block of the baseline artifact.
 * @returns Total findings recorded by that generation.
 */
function readBaselineTotal(metricRecord: Record<string, unknown>): number {
    const explicit = readNumber(metricRecord.totalIssues);
    if (explicit !== undefined) return explicit;
    const warnings = readCount(metricRecord, 'blockingWarningCount');
    return warnings + readCount(metricRecord, 'blockingErrorCount');
}

/**
 * Resolve the counter block for a baseline artifact of either generation.
 *
 * @param metricRecord - Counter block of the baseline artifact.
 * @param scope - Optional scan scope block carrying the file count.
 * @returns Counters for the compact envelope.
 */
function readBaselineCounts(
    metricRecord: Record<string, unknown>,
    scope: Record<string, unknown> | undefined,
): CompactCounts {
    const total = readBaselineTotal(metricRecord);
    const suppressed = readNumber(metricRecord.suppressedCount);
    return {
        files: scope ? readCount(scope, 'filesScanned') : 0,
        issues: total,
        errors: readCount(metricRecord, 'blockingErrorCount'),
        warns: readNumber(metricRecord.blockingWarningCount) ?? total,
        info: 0,
        ...(suppressed !== undefined ? { suppressed } : {}),
    };
}

/**
 * Normalize the engine's own audit baseline artifact.
 *
 * Two generations of this artifact exist: the current one nests counters under `metrics`, while
 * the v0.3 line used `baselineMetrics` with a different counter set. Both are read here so a
 * historical baseline does not have to be regenerated before it can be inspected.
 *
 * @param payload - Candidate baseline object.
 * @returns Compact projection, or undefined when the shape does not match.
 */
function adaptBaselineSnapshot(payload: Record<string, unknown>): CompactScanReport | undefined {
    const metricRecord = readObject(payload.metrics) ?? readObject(payload.baselineMetrics);
    if (!metricRecord) return undefined;
    const score = readNumber(metricRecord.compositeScore);
    if (score === undefined) return undefined;
    const scope = readObject(payload.scope);
    return buildSnapshotEnvelope({
        tool: 'auto-refactor',
        version: String(readObject(payload.versions)?.engineVersion ?? ''),
        ts: String(payload.timestamp ?? payload.generatedAt ?? ''),
        root: String(scope?.root ?? ''),
        counts: readBaselineCounts(metricRecord, scope),
        score,
        grade: String(metricRecord.grade ?? UNKNOWN_GRADE),
        cai: readNumber(metricRecord.autonomyRate),
        dimensions: readDimensionMap(payload.tenDimensions),
    });
}

/**
 * Normalize the multi-dimensional performance baseline artifact.
 *
 * That artifact records throughput and latency measurements plus one aggregate quality reading;
 * it carries no findings, so the projection reports its debt counters as unavailable rather than
 * inventing an issue count from latency numbers.
 *
 * @param payload - Candidate performance baseline object.
 * @returns Compact projection, or undefined when the shape does not match.
 */
function adaptPerformanceBaseline(payload: Record<string, unknown>): CompactScanReport | undefined {
    const healthRecord = readObject(readObject(payload.dimensions)?.architectureAndHealth);
    if (!healthRecord) return undefined;
    const score = readNumber(healthRecord.qualityScore);
    if (score === undefined) return undefined;
    const corpus = readObject(payload.corpus);
    return buildSnapshotEnvelope({
        tool: 'auto-refactor',
        version: String(payload.commit ?? ''),
        ts: String(payload.generatedAt ?? ''),
        root: String(payload.commit ?? ''),
        counts: {
            files: corpus ? readCount(corpus, 'files') : 0,
            issues: readCount(healthRecord, 'highDebt') + readCount(healthRecord, 'criticalDebt'),
            errors: readCount(healthRecord, 'criticalDebt'),
            warns: readCount(healthRecord, 'highDebt'),
            info: 0,
        },
        score,
        grade: String(healthRecord.grade ?? UNKNOWN_GRADE),
        dimensions: {},
    });
}

/**
 * Normalize any supported historical artifact into the compact schema.
 *
 * Accepts a compact document (returned unchanged), a verbose scan report, the unified workspace
 * audit snapshot, the engine audit baseline (current and v0.3 generations) and the
 * multi-dimensional performance baseline. Any other shape is rejected explicitly rather than
 * being coerced into an empty document that would read as a clean scan.
 *
 * @param payload - Parsed JSON artifact of unknown shape.
 * @param options - Emission policy applied when the payload needs projecting.
 * @returns Compact document for the payload.
 * @throws Error when the payload matches no supported shape.
 */
export function migrateLegacyReport(
    payload: unknown,
    options: CompactReportOptions = {},
): CompactScanReport {
    if (isCompactReport(payload)) return payload;
    if (isScanReport(payload)) return buildCompactReport(payload, options);
    if (typeof payload === 'object' && payload !== null) {
        const candidate = payload as Record<string, unknown>;
        const adapted =
            adaptWorkspaceSnapshot(candidate) ??
            adaptBaselineSnapshot(candidate) ??
            adaptPerformanceBaseline(candidate);
        if (adapted) return adapted;
    }
    throw new Error('Unrecognized report artifact: expected cas-v3, ScanReport or audit snapshot');
}
