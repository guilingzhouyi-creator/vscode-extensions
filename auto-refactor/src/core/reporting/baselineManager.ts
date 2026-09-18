/**
 * Module: Core Engine — Baseline Ratchet & Grouping Manager
 * File Path: src/core/reporting/baselineManager.ts
 * Architecture Role: Storage and evaluation layer for baseline snapshots and ratchet diffs.
 * Dependencies & Triggers: fs, ../types, ../logger; invoked by reportFinalizer post-scan.
 * Responsibilities: Serialize baseline snapshots, calculate group counts, compare issue sets.
 * Exit Semantics & Design Rationale: Provides asynchronous baseline persistence and in-place
 *   ratchet annotations; separates baseline I/O from post-scan analysis passes.
 */

import * as fs from 'fs';
import type { ScanReport, Issue } from '../types';
import { Logger } from '../logger';

/** Baseline ratchet granularity that compares per-(analyzer|rule|file) counts. */
export const BASELINE_GRANULARITY_GROUPED = 'grouped';

/**
 * Aggregate issue occurrences by analyzer, rule, and repository-relative file path.
 *
 * @param issues - Issues to group.
 * @returns Array of grouped counts suitable for grouped baseline storage.
 */
export function groupCounts(issues: Issue[]): Array<{ key: string; count: number }> {
    return [
        ...issues.reduce((m, i) => {
            const key = `${i.analyzer}|${i.rule}|${i.location.file.replace(/\\/g, '/')}`;
            m.set(key, (m.get(key) ?? 0) + 1);
            return m;
        }, new Map<string, number>()),
    ].map(([key, count]) => ({ key, count }));
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
    const baselineData =
        granularity === BASELINE_GRANULARITY_GROUPED
            ? {
                  version: '1.1.0',
                  granularity,
                  timestamp: new Date().toISOString(),
                  groups: groupCounts(report.issues),
              }
            : {
                  version: '1.0.0',
                  timestamp: new Date().toISOString(),
                  issues: report.issues.map((i) => i.id),
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
        const baselineData = JSON.parse(raw);
        let newIssues: Issue[];
        if (
            baselineData.granularity === BASELINE_GRANULARITY_GROUPED &&
            Array.isArray(baselineData.groups)
        ) {
            const baseMap = new Map<string, number>(
                (baselineData.groups as Array<{ key: string; count?: number }>).map((g) => [
                    g.key,
                    g.count ?? 0,
                ]),
            );
            const consumed = new Map<string, number>();
            newIssues = report.issues.filter((i) => {
                const k = `${i.analyzer}|${i.rule}|${i.location.file.replace(/\\/g, '/')}`;
                const used = consumed.get(k) ?? 0;
                consumed.set(k, used + 1);
                return used >= (baseMap.get(k) ?? 0);
            });
        } else {
            const baselineSet = new Set<string>(baselineData.issues || []);
            newIssues = report.issues.filter((i) => !baselineSet.has(i.id));
        }
        for (const i of newIssues) (i as any).isNew = true;
        (report.summary as any).ratchetBaselineUsed = true;
        logger.info(
            `baseline ratchet(${baselineData.granularity ?? 'id'}): accepted=${
                baselineData.granularity === BASELINE_GRANULARITY_GROUPED
                    ? (baselineData.groups || []).length
                    : (baselineData.issues || []).length
            } newIssues=${newIssues.length}`,
        );
    } catch (e) {
        logger.warn(`Failed to read baseline file: ${e}`);
    }
}
