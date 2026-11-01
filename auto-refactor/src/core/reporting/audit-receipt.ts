/**
 * Module: Core Reporting — Universal Audit Receipt (UAR v1.0)
 * File Path: src/core/reporting/audit-receipt.ts
 * Architecture Role: Token-frugal standardized audit receipt protocol (< 1KB payload)
 *   enabling multi-project, cross-language health state ingestion for AI Agents and unified gates.
 * Dependencies & Triggers: Consumes ../types (ScanReport); invoked by report formatters and
 *   audit gates.
 * Responsibilities:
 *   1. Define strongly-typed AuditReceipt schema for cross-project interoperability.
 *   2. Project verbose scan reports into minimal executive health receipts (< 1KB).
 *   3. Provide deterministic receipt serialization for multi-agent ingestion.
 * Exit Semantics & Design Rationale: Pure, non-throwing transformation adhering to CC <= 10.
 */

import type { ScanReport } from '../types';

/** Wire schema version discriminator for Universal Audit Receipt payloads. */
export const AUDIT_RECEIPT_SCHEMA_VERSION = '1.0' as const;

/**
 * Universal Audit Receipt representing high-level executive health status of a project.
 */
export interface AuditReceipt {
    readonly schemaVersion: typeof AUDIT_RECEIPT_SCHEMA_VERSION;
    readonly project: string;
    readonly generatedAt: string;
    readonly healthScore: number | null;
    readonly grade: string;
    readonly confidence?: number;
    readonly density?: number;
    readonly dimensions: Readonly<Record<string, number>>;
    readonly issuesTotal: number;
    readonly bySeverity: {
        readonly error: number;
        readonly warning: number;
        readonly info: number;
    };
    readonly durationMs?: number;
}

const ROUND_FACTOR_HUNDRED = 100;

/**
 * Rounds numeric metric to 2 decimal places.
 */
function roundToTwoDecimals(numericValue: number | undefined | null): number | undefined {
    if (typeof numericValue === 'number' && Number.isFinite(numericValue)) {
        return Math.round(numericValue * ROUND_FACTOR_HUNDRED) / ROUND_FACTOR_HUNDRED;
    }
    return undefined;
}

/**
 * Projects a full ScanReport into a lightweight Universal Audit Receipt (< 1KB).
 *
 * @param report - Complete scan report
 * @param projectName - Optional project name override (defaults to report.tool)
 * @returns Ultra-compact AuditReceipt struct
 */
export function createAuditReceipt(report: ScanReport, projectName?: string): AuditReceipt {
    const rawScore = report.qualityScore?.compositeScore;
    const roundedScore = roundToTwoDecimals(rawScore);
    const healthScore = roundedScore !== undefined ? roundedScore : null;
    const grade = report.qualityScore?.grade ?? 'N/A';
    const confidence = roundToTwoDecimals(report.qualityScore?.confidence);
    const density = roundToTwoDecimals(report.qualityScore?.effectiveCodeDensity);

    const dimensions: Record<string, number> = {};
    if (report.qualityScore?.indices) {
        Object.entries(report.qualityScore.indices).forEach(([dimensionName, scoreValue]) => {
            const roundedVal = roundToTwoDecimals(scoreValue);
            if (roundedVal !== undefined) {
                dimensions[dimensionName] = roundedVal;
            }
        });
    }

    return {
        schemaVersion: AUDIT_RECEIPT_SCHEMA_VERSION,
        project: projectName || report.tool || 'workspace-module',
        generatedAt: report.generatedAt || new Date().toISOString(),
        healthScore,
        grade,
        ...(confidence !== undefined ? { confidence } : {}),
        ...(density !== undefined ? { density } : {}),
        dimensions,
        issuesTotal: report.summary.issuesTotal,
        bySeverity: {
            error: report.summary.bySeverity.error,
            warning: report.summary.bySeverity.warning,
            info: report.summary.bySeverity.info,
        },
        ...(typeof report.summary.durationMs === 'number'
            ? { durationMs: report.summary.durationMs }
            : {}),
    };
}

/**
 * Serializes an AuditReceipt into formatted JSON string.
 *
 * @param receipt - Input AuditReceipt
 * @returns Formatted JSON string
 */
export function serializeAuditReceipt(receipt: AuditReceipt): string {
    return JSON.stringify(receipt, null, 2);
}
