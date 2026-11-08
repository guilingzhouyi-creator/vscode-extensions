/**
 * Module: Persistence Template — Append-Only WAL & Atomic Checkpoint Compactor
 * File Path: .agents/skills/tiered-cache-and-wal-persistence/templates/atomic-wal-checkpoint-skeleton.ts
 * Architecture Role: Reference scaffold for crash-safe L1/L2 cache persistence combining
 *   in-memory map state, append-only NDJSON WAL records, and PID-salted atomic rename compaction.
 * Dependencies & Triggers: Loaded on demand (JIT) when implementing or refactoring cache
 *   persistence, WAL journals, or checkpoint workers.
 * Responsibilities:
 *   1. Record fingerprint mutations with monotonic sequence numbers;
 *   2. Replay NDJSON WAL lines idempotently on startup recovery;
 *   3. Compact base + WAL state into a PID-salted staging path before atomic rename.
 * Design Rationale: Prevents 0-byte torn writes on crash and eliminates concurrent flush
 *   collisions between foreground CLI runs and background daemon workers.
 */

import * as fs from 'fs';

export interface WalFingerprintRecord {
    readonly pathKey: string;
    readonly mtimeMs: number;
    readonly sizeBytes: number;
    readonly seq: number;
}

/**
 * Generates a collision-resistant staging path in the same directory as the target file.
 *
 * @param targetPath - Destination file path.
 * @returns PID- and random-salted staging file path.
 */
export function buildPidStagingPath(targetPath: string): string {
    const salt = Math.random().toString(36).slice(2, 8);
    return `${targetPath}.tmp-${process.pid}-${salt}`;
}

/**
 * Replays newline-delimited JSON WAL records idempotently into a state map.
 *
 * @param rawNdjson - Raw NDJSON string from disk.
 * @returns Map of pathKey to the newest WalFingerprintRecord by sequence number.
 */
export function replayWalRecords(rawNdjson: string): Map<string, WalFingerprintRecord> {
    const state = new Map<string, WalFingerprintRecord>();
    for (const rawLine of rawNdjson.split('\n')) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
            continue;
        }
        const parsed = JSON.parse(trimmed) as WalFingerprintRecord;
        const existing = state.get(parsed.pathKey);
        if (!existing || parsed.seq >= existing.seq) {
            state.set(parsed.pathKey, parsed);
        }
    }
    return state;
}

/**
 * Atomically writes compacted records to targetPath via a PID-salted staging file.
 *
 * @param targetPath - Final snapshot file path on disk.
 * @param records - Iterable collection of fingerprint records.
 */
export function writeCompactedSnapshotAtomic(
    targetPath: string,
    records: Iterable<WalFingerprintRecord>,
): void {
    const lines: string[] = [];
    for (const rec of records) {
        lines.push(JSON.stringify(rec));
    }
    const payload = `${lines.join('\n')}\n`;
    const stagingPath = buildPidStagingPath(targetPath);
    try {
        fs.writeFileSync(stagingPath, payload, 'utf8');
        fs.renameSync(stagingPath, targetPath);
    } catch (err) {
        try {
            fs.rmSync(stagingPath, { force: true });
        } catch {
            // ignore: best-effort cleanup of failed staging artifact
        }
        throw err;
    }
}
