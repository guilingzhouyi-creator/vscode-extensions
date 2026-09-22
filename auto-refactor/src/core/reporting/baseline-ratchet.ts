/**
 * Module: Core Engine — Baseline Ratchet Down & Update Processor
 * File Path: src/core/reporting/baseline-ratchet.ts
 * Architecture Role: Storage and ratchet-down evaluation kernel for baseline snapshots.
 * Dependencies & Triggers: fs, ../types, ../logger; invoked by baselineManager and reportFinalizer.
 * Responsibilities: Enforce downward-only ratchet logic on baseline groups, prune resolved debt,
 *   reject unexpected debt expansions, and persist updated baseline snapshots asynchronously.
 * Exit Semantics & Design Rationale: Downward-only ratchet guarantees debt monotonicity: resolved
 *   groups are removed, decreased counts are ratified, and new finding keys or count increases
 *   are rejected unless explicit permission (--force-baseline-expand) is provided.
 */

import * as fs from 'fs';
import type { Issue, ScanReport } from '../types';
import type { Logger } from '../logger';
import {
    BASELINE_GRANULARITY_GROUPED,
    BASELINE_VERSION,
    groupCounts,
    idSeverityHistograms,
    issueGroupKey,
    readGroupedCredits,
    readIdCredits,
    selectNewIssues,
    LEGACY_ESCALATION_NOTICE,
    type GroupedBaselineRow,
    type BaselinePayload,
    type BaselineSnapshot,
} from './baselineManager';

/** Typeof 'object' string comparison token. */
const TYPEOF_OBJECT = 'object';

/** Error object code property name token. */
const PROPERTY_CODE = 'code';

/** File not found error code for asynchronous baseline reading. */
const ERROR_CODE_ENOENT = 'ENOENT';

/**
 * Canonical rule identifier for baseline refactoring rename path normalization (GOV-RTC-002).
 */
export const RULE_GOV_RTC_002 = 'GOV-RTC-002';

/**
 * Result of applying downward ratchet to baseline groups.
 */
export interface RatchetDownResult {
    groups: GroupedBaselineRow[];
    prunedKeys: string[];
    decreasedCount: number;
    expandedKeys: string[];
}

/**
 * Options controlling baseline update behaviour.
 */
export interface BaselineUpdateOptions {
    /** When true, forbids baseline growth and prunes resolved groups. Default true. */
    ratchetDown?: boolean;
    /** When true, forces overwriting the baseline even if debt counts grow. Default false. */
    forceExpand?: boolean;
    /**
     * Optional path remap dictionary (oldPath -> newPath) for refactoring
     * normalization (GOV-RTC-002).
     */
    pathRemap?: Record<string, string>;
}

/**
 * Remap a grouped baseline key if its file portion matches a path remap dictionary.
 * Group key format: `${analyzer}|${rule}|${filePath}`.
 *
 * @param key - Original group key.
 * @param pathRemap - Mapping from old relative path to new relative path.
 * @returns Remapped group key or original key if not matched.
 */
export function remapGroupKey(key: string, pathRemap?: Record<string, string>): string {
    if (!pathRemap) return key;
    const parts = key.split('|');
    if (parts.length < 3) return key;
    const filePath = parts.slice(2).join('|');
    const target = pathRemap[filePath] ?? pathRemap[filePath.replace(/\\/g, '/')];
    if (target) {
        return `${parts[0]}|${parts[1]}|${target.replace(/\\/g, '/')}`;
    }
    return key;
}

/**
 * Normalizes existing baseline groups with path remapping for refactoring migrations (GOV-RTC-002).
 *
 * @param groups - Prior baseline groups.
 * @param pathRemap - Mapping dictionary from old paths to new paths.
 * @returns Group list with normalized paths.
 */
export function normalizeGroupsForRename(
    groups: GroupedBaselineRow[],
    pathRemap?: Record<string, string>,
): GroupedBaselineRow[] {
    if (!pathRemap || Object.keys(pathRemap).length === 0) return groups;
    return groups.map((g) => {
        const remappedKey = remapGroupKey(g.key, pathRemap);
        if (remappedKey !== g.key) {
            return {
                ...g,
                key: remappedKey,
            };
        }
        return g;
    });
}

/**
 * Mutating state container used while comparing baseline groups.
 */
interface RatchetAccumulator {
    groups: GroupedBaselineRow[];
    prunedKeys: string[];
    expandedKeys: string[];
    decreasedCount: number;
}

/**
 * Process a single existing baseline row against current findings.
 *
 * @param existing - Existing baseline row from disk.
 * @param current - Current grouped row if present.
 * @param allowExpansion - Whether baseline expansion is allowed.
 * @param acc - Output state accumulator.
 */
function processExistingRow(
    existing: GroupedBaselineRow,
    current: GroupedBaselineRow | undefined,
    allowExpansion: boolean,
    acc: RatchetAccumulator,
): void {
    if (!current || current.count === 0) {
        acc.prunedKeys.push(existing.key);
        acc.decreasedCount += existing.count;
        return;
    }

    if (current.count < existing.count) {
        acc.decreasedCount += existing.count - current.count;
        acc.groups.push({
            key: existing.key,
            count: current.count,
            severities: current.severities,
        });
        return;
    }

    if (current.count === existing.count) {
        acc.groups.push({
            key: existing.key,
            count: existing.count,
            severities: current.severities || existing.severities,
        });
        return;
    }

    if (allowExpansion) {
        acc.groups.push(current);
    } else {
        acc.expandedKeys.push(
            `${existing.key} (existing=${existing.count}, current=${current.count})`,
        );
        acc.groups.push(existing);
    }
}

/**
 * Check if a current finding key is brand new and not present in the existing baseline.
 *
 * @param key - Group comparison key.
 * @param current - Current finding row.
 * @param existingMap - Map of existing baseline rows.
 * @param allowExpansion - Whether baseline expansion is allowed.
 * @param acc - Output state accumulator.
 */
function checkNewKey(
    key: string,
    current: GroupedBaselineRow,
    existingMap: Map<string, GroupedBaselineRow>,
    allowExpansion: boolean,
    acc: RatchetAccumulator,
): void {
    if (existingMap.has(key)) return;
    if (allowExpansion) {
        acc.groups.push(current);
    } else {
        acc.expandedKeys.push(`${key} (new finding key, count=${current.count})`);
    }
}

/**
 * Apply a strict downward-only ratchet to grouped baseline rows against current findings.
 *
 * @param existingGroups - Baseline groups currently stored on disk.
 * @param currentIssues - Issues produced by the current scan.
 * @param allowExpansion - If false, count increases and new keys are tracked as expansions.
 * @returns Ratcheted baseline groups, pruned keys, and delta statistics.
 */
export function ratchetDownGroups(
    existingGroups: GroupedBaselineRow[],
    currentIssues: Issue[],
    allowExpansion = false,
    pathRemap?: Record<string, string>,
): RatchetDownResult {
    const priorGroups = pathRemap
        ? normalizeGroupsForRename(existingGroups, pathRemap)
        : existingGroups;
    const currentGrouped = groupCounts(currentIssues);
    const currentMap = new Map<string, GroupedBaselineRow>(currentGrouped.map((g) => [g.key, g]));
    const existingMap = new Map<string, GroupedBaselineRow>(priorGroups.map((g) => [g.key, g]));

    const acc: RatchetAccumulator = {
        groups: [],
        prunedKeys: [],
        expandedKeys: [],
        decreasedCount: 0,
    };

    for (const [, existing] of existingMap) {
        processExistingRow(existing, currentMap.get(existing.key), allowExpansion, acc);
    }

    for (const [key, current] of currentMap) {
        checkNewKey(key, current, existingMap, allowExpansion, acc);
    }

    return acc;
}

/**
 * Asynchronously read and parse existing baseline if available.
 *
 * @param filePath - Path to baseline JSON file.
 * @returns Parsed baseline payload or null on missing/corrupt file.
 */
async function tryReadExistingBaseline(filePath: string): Promise<BaselinePayload | null> {
    try {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw) as BaselinePayload;
    } catch {
        return null;
    }
}

/**
 * Resolve the final grouped rows to write during a baseline update.
 *
 * @param existing - Existing baseline payload read from disk.
 * @param reportIssues - Findings from current scan report.
 * @param options - Update options including force-expand override.
 * @param logger - Logger instance for operational telemetry.
 * @returns Grouped rows ready for serialization.
 */
function resolveGroupsForUpdate(
    existing: BaselinePayload | null,
    reportIssues: Issue[],
    options: BaselineUpdateOptions,
    logger: Logger,
): GroupedBaselineRow[] {
    if (existing?.groups && Array.isArray(existing.groups) && !options.forceExpand) {
        const result = ratchetDownGroups(
            existing.groups,
            reportIssues,
            Boolean(options.forceExpand),
            options.pathRemap,
        );
        if (result.expandedKeys.length > 0) {
            logger.warn(
                `Baseline update rejected ${result.expandedKeys.length} expansion(s) ` +
                    `under ratchet-down policy. New debt must be fixed or suppressed.`,
            );
        }
        logger.info(
            `baseline ratchet-down: pruned=${result.prunedKeys.length} ` +
                `decreasedCount=${result.decreasedCount} totalGroups=${result.groups.length}`,
        );
        return result.groups;
    }
    return groupCounts(reportIssues);
}

/**
 * Persist the current scan issues to a baseline snapshot file.
 *
 * @param report - Completed scan report to serialize.
 * @param updateBaselinePath - Destination path for baseline JSON.
 * @param granularity - Ratchet granularity ('id' or 'grouped').
 * @param logger - Logger instance for operational telemetry.
 * @param options - Optional ratchet-down / force-expand overrides.
 * Concurrency: asynchronous I/O operation; safe for single-threaded runtime.
 */
export async function handleBaselineUpdate(
    report: ScanReport,
    updateBaselinePath: string,
    granularity: string,
    logger: Logger,
    options: BaselineUpdateOptions = {},
): Promise<void> {
    const timestamp = new Date().toISOString();
    let baselineData: BaselinePayload;

    if (granularity === BASELINE_GRANULARITY_GROUPED) {
        const existing = await tryReadExistingBaseline(updateBaselinePath);
        const groups = resolveGroupsForUpdate(existing, report.issues, options, logger);
        baselineData = {
            version: BASELINE_VERSION,
            granularity,
            timestamp,
            groups,
        };
    } else {
        baselineData = {
            version: BASELINE_VERSION,
            granularity: 'id',
            timestamp,
            issues: [...new Set(report.issues.map((i) => i.id))],
            severities: idSeverityHistograms(report.issues),
        };
    }

    await fs.promises.writeFile(
        updateBaselinePath,
        JSON.stringify(baselineData, null, 2) + '\n',
        'utf8',
    );
    logger.info(`baseline written to ${updateBaselinePath} (granularity=${granularity})`);
}

/**
 * Type guard for ENOENT filesystem errors.
 */
function isEnoentError(error: unknown): boolean {
    if (!error || typeof error !== TYPEOF_OBJECT) {
        return false;
    }
    return (error as Record<string, unknown>)[PROPERTY_CODE] === ERROR_CODE_ENOENT;
}

/**
 * Select the key extraction function based on baseline granularity.
 */
function selectKeyExtractor(isGrouped: boolean): (issue: Issue) => string {
    if (isGrouped) return issueGroupKey;
    return (issue: Issue) => issue.id;
}

/**
 * Mark identified new issues as new in-place.
 */
function markIssuesAsNew(issues: Issue[]): void {
    for (let i = 0; i < issues.length; i++) {
        issues[i].isNew = true;
    }
}

/**
 * Resolve snapshot and accepted count according to baseline granularity.
 */
function resolveBaselineSnapshot(baselineData: BaselinePayload): {
    snapshot: BaselineSnapshot;
    accepted: number;
} {
    const isGrouped = baselineData.granularity === BASELINE_GRANULARITY_GROUPED;
    if (isGrouped) {
        const groups = baselineData.groups ?? [];
        return {
            snapshot: readGroupedCredits(groups),
            accepted: groups.length,
        };
    }
    const ids = baselineData.issues ?? [];
    return {
        snapshot: readIdCredits(ids, baselineData.severities),
        accepted: ids.length,
    };
}

/**
 * Log read errors unless the file is cleanly absent.
 */
function logBaselineReadError(err: unknown, logger: Logger): void {
    if (isEnoentError(err)) return;
    logger.warn(`Failed to read baseline file: ${err}`);
}

/**
 * Read baseline file asynchronously, ignoring missing files.
 */
function readBaselineFile(baselinePath: string, logger: Logger): Promise<string | null> {
    return fs.promises.readFile(baselinePath, 'utf8').catch((err: unknown) => {
        logBaselineReadError(err, logger);
        return null;
    });
}

/**
 * Apply parsed baseline snapshot to current report issues.
 */
function applyBaselinePayload(
    report: ScanReport,
    baselineData: BaselinePayload,
    logger: Logger,
): void {
    const { snapshot, accepted } = resolveBaselineSnapshot(baselineData);
    const isGrouped = baselineData.granularity === BASELINE_GRANULARITY_GROUPED;
    const keyFn = selectKeyExtractor(isGrouped);
    const newIssues = selectNewIssues(report.issues, snapshot, keyFn);
    markIssuesAsNew(newIssues);
    report.summary.ratchetBaselineUsed = true;
    const legacyNotice = snapshot.severityAware ? '' : LEGACY_ESCALATION_NOTICE;
    logger.info(
        `baseline ratchet(${baselineData.granularity ?? 'id'}): accepted=${accepted} ` +
            `newIssues=${newIssues.length}${legacyNotice}`,
    );
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
    const raw = await readBaselineFile(baselinePath, logger);
    if (!raw) return;

    try {
        const baselineData = JSON.parse(raw) as BaselinePayload;
        applyBaselinePayload(report, baselineData, logger);
    } catch (parseErr: unknown) {
        logger.warn(`Failed to parse baseline file: ${parseErr}`);
    }
}
