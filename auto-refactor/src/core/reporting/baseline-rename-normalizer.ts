/**
 * Module: Baseline Reporting — Rename Path Normalizer (GOV-RTC-002)
 * File Path: src/core/reporting/baseline-rename-normalizer.ts
 * Architecture Role: Normalizes grouped baseline keys across file renames so refactoring
 *   file movements do not trigger false-positive baseline expansion rejections.
 * Dependencies & Triggers: Consumed by baseline-ratchet.ts during baseline updates.
 * Responsibilities: Parse compound grouped baseline keys, match old paths against the rename
 *   mapping table, rewrite group keys to updated paths, and preserve existing finding counts.
 * Exit Semantics & Design Rationale: Deterministic pure in-memory transformer; returns
 *   unmodified keys when pathRemap is empty or keys do not match, guaranteeing zero data loss.
 */

import type { GroupedBaselineRow } from './baselineManager';

/** Minimum component count in a grouped baseline key: analyzer|rule|filePath. */
const MIN_GROUP_KEY_PARTS = 3;

/** Group key delimiter token. */
const GROUP_KEY_SEPARATOR = '|';

/** Forward slash replacement token. */
const FORWARD_SLASH = '/';

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
    const parts = key.split(GROUP_KEY_SEPARATOR);
    if (parts.length < MIN_GROUP_KEY_PARTS) return key;
    const filePath = parts.slice(2).join(GROUP_KEY_SEPARATOR);
    const normalizedKey = filePath.replace(/\\/g, FORWARD_SLASH);
    const target = pathRemap[filePath] ?? pathRemap[normalizedKey];
    if (target) {
        return `${parts[0]}|${parts[1]}|${target.replace(/\\/g, FORWARD_SLASH)}`;
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
