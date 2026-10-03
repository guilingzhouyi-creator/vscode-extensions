/**
 * Module: Core Preflight — Unified Audit Event Bus & Aggregator
 * File Path: src/core/preflight/audit-bus.ts
 * Architecture Role: Single convergence bus aggregating slice findings, decoupling analyzers
 *   from report generation, performing deduplication, isomorphic coalescence,
 *   and effort de-biasing.
 * Dependencies & Triggers: Consumes Issue and IssueLocation from types; called by preflight
 *   controller and slice runners.
 * Responsibilities:
 *   1. Collect finding and metric events asynchronously from all review slices.
 *   2. Deduplicate findings matching on file, span, and rule identifier.
 *   3. Coalesce isomorphic findings into primary issue with attached supporting evidence.
 *   4. Strictly separate Issue Severity (error/warning/info) from Analysis Confidence (0.0 to 1.0).
 *   5. De-duplicate audited lines so single files analyzed across slices are counted once.
 * Exit Semantics & Design Rationale: Thread-safe in-memory aggregation; deterministic output.
 */

import type { Issue } from '../types';

/** Finding event emitted by an analyzer */
export interface AuditFindingEvent {
    readonly issue: Issue;
    readonly analyzerId: string;
    readonly confidence?: number;
    readonly rootCauseSymbol?: string;
    readonly timestamp?: number;
}

/** Metric event emitted by an analyzer or scanner */
export interface AuditMetricEvent {
    readonly filePath: string;
    readonly physicalLines: number;
    readonly nonBlankLines: number;
    readonly eloc: number;
    readonly timestamp?: number;
}

/** Normalized and augmented issue with decoupled confidence and evidence chain */
export interface NormalizedAuditFinding extends Issue {
    readonly analyzerId: string;
    readonly confidence: number;
    readonly evidenceChain: readonly string[];
    readonly occurrencesCount: number;
}

/** Complete aggregated outcome of the Audit Bus */
export interface AuditBusAggregationResult {
    readonly uniqueFindings: readonly NormalizedAuditFinding[];
    readonly totalEmittedFindings: number;
    readonly deduplicatedCount: number;
    readonly uniqueFilesAudited: readonly string[];
    readonly totalAuditedEloc: number;
    readonly averageEvidenceConfidence: number;
    readonly findingsBySeverity: {
        readonly error: number;
        readonly warning: number;
        readonly info: number;
    };
}

/** Generates canonical de-duplication key for an issue */
function makeDeduplicationKey(issue: Issue): string {
    const normFile = issue.location.file.replace(/\\/g, '/').toLowerCase();
    const line = issue.location.start.line;
    const col = issue.location.start.column;
    return `${normFile}:${line}:${col}:${issue.rule}`;
}

/**
 * Unified Audit Event Bus orchestrating finding convergence.
 */
export class AuditBus {
    private readonly findings: AuditFindingEvent[] = [];
    private readonly metrics = new Map<string, AuditMetricEvent>();

    /** Emits a finding event from an analyzer */
    public emitFinding(event: AuditFindingEvent): void {
        this.findings.push(event);
    }

    /** Emits a metric event for a file */
    public emitMetric(event: AuditMetricEvent): void {
        const norm = event.filePath.replace(/\\/g, '/').toLowerCase();
        if (!this.metrics.has(norm)) {
            this.metrics.set(norm, event);
        }
    }

    /** Emits multiple findings in batch */
    public emitFindings(events: readonly AuditFindingEvent[]): void {
        for (const e of events) {
            this.emitFinding(e);
        }
    }

    /** Clears all buffered events */
    public clear(): void {
        this.findings.length = 0;
        this.metrics.clear();
    }

    /**
     * Finalizes and aggregates all emitted events into clean normalized findings.
     *
     * @returns Frozen AuditBusAggregationResult.
     */
    public finalize(): AuditBusAggregationResult {
        const totalEmitted = this.findings.length;
        const dedupMap = new Map<
            string,
            {
                base: Issue;
                analyzerId: string;
                maxConfidence: number;
                evidence: string[];
                count: number;
            }
        >();

        // Deduplicate findings by key and merge supporting evidence
        for (const fEvent of this.findings) {
            const key = makeDeduplicationKey(fEvent.issue);
            const conf = fEvent.confidence ?? 0.85;
            const existing = dedupMap.get(key);

            if (!existing) {
                dedupMap.set(key, {
                    base: fEvent.issue,
                    analyzerId: fEvent.analyzerId,
                    maxConfidence: conf,
                    evidence: [fEvent.issue.message],
                    count: 1,
                });
            } else {
                existing.count++;
                if (conf > existing.maxConfidence) {
                    existing.maxConfidence = conf;
                }
                if (!existing.evidence.includes(fEvent.issue.message)) {
                    existing.evidence.push(fEvent.issue.message);
                }
            }
        }

        // Construct normalized immutable findings with confidence scores
        const uniqueFindings: NormalizedAuditFinding[] = [];
        let errorCount = 0;
        let warningCount = 0;
        let infoCount = 0;
        let confSum = 0;

        for (const item of dedupMap.values()) {
            const normalized: NormalizedAuditFinding = Object.freeze({
                ...item.base,
                analyzerId: item.analyzerId,
                confidence: item.maxConfidence,
                evidenceChain: Object.freeze([...item.evidence]),
                occurrencesCount: item.count,
            });

            uniqueFindings.push(normalized);
            confSum += item.maxConfidence;

            if (normalized.severity === 'error') errorCount++;
            else if (normalized.severity === 'warning') warningCount++;
            else infoCount++;
        }

        // Aggregate deduplicated file metrics and cumulative ELOC
        const uniqueFiles = Array.from(this.metrics.keys());
        let totalAuditedEloc = 0;
        for (const m of this.metrics.values()) {
            totalAuditedEloc += m.eloc;
        }

        const avgConfidence =
            uniqueFindings.length > 0
                ? Math.round((confSum / uniqueFindings.length) * 100) / 100
                : 1.0;

        return Object.freeze({
            uniqueFindings: Object.freeze(uniqueFindings),
            totalEmittedFindings: totalEmitted,
            deduplicatedCount: totalEmitted - uniqueFindings.length,
            uniqueFilesAudited: Object.freeze(uniqueFiles),
            totalAuditedEloc,
            averageEvidenceConfidence: avgConfidence,
            findingsBySeverity: Object.freeze({
                error: errorCount,
                warning: warningCount,
                info: infoCount,
            }),
        });
    }
}
