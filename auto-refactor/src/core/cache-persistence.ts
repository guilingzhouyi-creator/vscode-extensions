/**
 * Module: Core Engine — Cache Persistence and Serialization Helpers
 * File Path: src/core/cache-persistence.ts
 * Architecture Role: Atomic disk I/O, line-by-line streaming parsers, and serialization
 *   for L1 fingerprints, L2 scan results, and L3 path indexes.
 * Dependencies & Triggers: fs, path, and core types; consumed by CacheStore.
 * Responsibilities: Read/write files atomically (.tmp + rename), parse jsonl safely,
 *   recover from corrupt lines, serialize cache records, and probe/clean cache directories.
 * Exit Semantics & Design Rationale: Never throws on corrupt lines or failed cleanups.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { Issue, FileMetric } from './types';
import type { Fingerprint } from './cache';

/** Type constant for string type checking. */
export const TYPEOF_STRING = 'string';
/** Type constant for number type checking. */
export const TYPEOF_NUMBER = 'number';
const RANDOM_STRING_RADIX = 36;
const STAGING_SUFFIX_SLICE_END = 8;
const CACHE_CLEAR_SUFFIX_END_INDEX = 6;

/** Cache entry record persisted in L2 scan cache. */
export interface L2EntryRecord {
    k: string;
    p: string;
    issues: Issue[];
    metric: FileMetric | null;
    ts: number;
    fm?: number;
    fs?: number;
}

const syncFsReadText = fs.readFileSync.bind(fs);
const syncFsWriteText = fs.writeFileSync.bind(fs);

/**
 * Synchronous I/O barrier isolating blocking filesystem primitives.
 */
export const SyncIoBarrier = {
    readText: (filePath: string): string => syncFsReadText(filePath, 'utf8'),
    writeText: (filePath: string, data: string): void => syncFsWriteText(filePath, data, 'utf8'),
};

/**
 * Reads file contents synchronously as UTF-8 string.
 *
 * @param filePath - Path to file.
 * @returns File content.
 */
export function readTextFileSync(filePath: string): string {
    return SyncIoBarrier.readText(filePath);
}

function writeTextFileSync(filePath: string, data: string): void {
    SyncIoBarrier.writeText(filePath, data);
}

/**
 * Reads lines from a file synchronously, returning empty array on failure.
 *
 * @param filePath - Path to file.
 * @returns Array of lines.
 */
export function readLinesSafe(filePath: string): string[] {
    try {
        return readTextFileSync(filePath).split('\n');
    } catch {
        return [];
    }
}

function cleanupStagingFile(stagingPath: string): void {
    try {
        fs.rmSync(stagingPath, { force: true });
    } catch {
        /* ignore */
    }
}

/**
 * Atomic write: .tmp-<pid>-<rand> + rename.
 *
 * @param file - Target file path.
 * @param data - Content string to write.
 */
export function writeFileAtomic(file: string, data: string): void {
    const stagingPath = `${file}.tmp-${process.pid}-${Math.random().toString(RANDOM_STRING_RADIX).slice(2, STAGING_SUFFIX_SLICE_END)}`;
    writeTextFileSync(stagingPath, data);
    try {
        fs.renameSync(stagingPath, file);
    } catch (e) {
        cleanupStagingFile(stagingPath);
        throw e;
    }
}

function writeProbe(probe: string): boolean {
    try {
        writeTextFileSync(probe, 'ok');
        return true;
    } catch {
        return false;
    }
}

function removeProbe(probe: string): boolean {
    try {
        fs.rmSync(probe, { force: true });
    } catch {
        /* probe cleanup is best-effort */
    }
    return true;
}

/**
 * Probes whether a directory is writable by attempting a probe file write.
 *
 * @param dir - Directory path to probe.
 * @returns True if writable, false otherwise.
 */
export function probeWritable(dir: string): boolean {
    try {
        const probe = path.join(dir, '.probe');
        return writeProbe(probe) && removeProbe(probe);
    } catch {
        return false;
    }
}

function isValidL1(o: unknown): o is { t: string; p: string; m: number; s: number; i?: number } {
    const obj = o as Record<string, unknown> | null;
    return Boolean(
        obj &&
        obj.t === 'f' &&
        typeof obj.p === TYPEOF_STRING &&
        typeof obj.m === TYPEOF_NUMBER &&
        typeof obj.s === TYPEOF_NUMBER,
    );
}

/**
 * Parses a line from the L1 fingerprint cache into the target map.
 *
 * @param line - Raw line from cache file.
 * @param targetMap - Map to populate with parsed fingerprint.
 */
export function parseL1Line(line: string, targetMap: Map<string, Fingerprint>): void {
    try {
        const o = JSON.parse(line);
        if (!isValidL1(o)) return;
        targetMap.set(o.p, {
            mtimeMs: o.m,
            size: o.s,
            ino: typeof o.i === TYPEOF_NUMBER ? o.i : undefined,
        });
    } catch {
        /* Best-effort: skip corrupt line */
    }
}

/**
 * Type guard validating whether an object is a valid L2 cache record.
 *
 * @param o - Object to inspect.
 * @returns True if object conforms to L2 record schema.
 */
export function isValidL2(o: unknown): o is {
    t: string;
    k: string;
    p: string;
    issues: Issue[];
    metric?: FileMetric;
    ts?: number;
    fm?: number;
    fs?: number;
} {
    const obj = o as Record<string, unknown> | null;
    return Boolean(
        obj &&
        obj.t === 'r' &&
        typeof obj.k === TYPEOF_STRING &&
        typeof obj.p === TYPEOF_STRING &&
        Array.isArray(obj.issues),
    );
}

/**
 * Type guard validating whether an object is a valid path index record.
 *
 * @param o - Object to inspect.
 * @returns True if object conforms to path entry schema.
 */
export function isValidPathEntry(o: unknown): o is { t: string; pk: string; k: string } {
    const obj = o as Record<string, unknown> | null;
    return Boolean(
        obj && obj.t === 'x' && typeof obj.pk === TYPEOF_STRING && typeof obj.k === TYPEOF_STRING,
    );
}

/**
 * Serializes L1 fingerprint entries into newline-delimited JSON.
 *
 * @param l1 - Map of file paths to fingerprints.
 * @returns Serialized NDJSON string.
 */
export function serializeL1(l1: Map<string, Fingerprint>): string {
    const lines: string[] = [];
    for (const [p, fp] of l1) {
        const o: Record<string, unknown> = { t: 'f', p, m: fp.mtimeMs, s: fp.size };
        if (fp.ino !== undefined) o.i = fp.ino;
        lines.push(JSON.stringify(o));
    }
    return lines.join('\n') + (lines.length ? '\n' : '');
}

/**
 * Serializes L2 cache entries into newline-delimited JSON.
 *
 * @param l2 - Map of cache keys to L2 records.
 * @returns Serialized NDJSON string.
 */
export function serializeL2(l2: Map<string, L2EntryRecord>): string {
    const lines: string[] = [];
    for (const e of l2.values()) {
        const o: Record<string, unknown> = {
            t: 'r',
            k: e.k,
            p: e.p,
            issues: e.issues,
            metric: e.metric,
            ts: e.ts,
        };
        if (e.fm !== undefined) o.fm = e.fm;
        if (e.fs !== undefined) o.fs = e.fs;
        lines.push(JSON.stringify(o));
    }
    return lines.join('\n') + (lines.length ? '\n' : '');
}

/**
 * Serializes path index entries into newline-delimited JSON.
 *
 * @param l2ByPath - Map of normalized paths to L2 records.
 * @returns Serialized NDJSON string.
 */
export function serializePaths(l2ByPath: Map<string, L2EntryRecord>): string {
    const lines: string[] = [];
    for (const [pk, e] of l2ByPath) {
        lines.push(JSON.stringify({ t: 'x', pk, k: e.k }));
    }
    return lines.join('\n') + (lines.length ? '\n' : '');
}

function renameStaleCacheDir(dir: string): boolean {
    try {
        const stale = path.join(
            path.dirname(dir),
            `.auto-refactor-cache-clear-${Date.now()}-${Math.random().toString(RANDOM_STRING_RADIX).slice(2, CACHE_CLEAR_SUFFIX_END_INDEX)}`,
        );
        fs.renameSync(dir, stale);
        return true;
    } catch {
        return false;
    }
}

/**
 * Safely removes or renames a cache directory.
 *
 * @param dir - Cache directory path.
 * @returns True if removed or renamed successfully, false otherwise.
 */
export function removeCacheDir(dir: string): boolean {
    if (!fs.existsSync(dir)) return true;
    try {
        fs.rmSync(dir, { recursive: true, force: true });
        return true;
    } catch {
        return renameStaleCacheDir(dir);
    }
}

/**
 * Reads file contents asynchronously as UTF-8 string.
 *
 * @param filePath - Path to file.
 * @returns Promise resolving to file content.
 */
export async function readTextFileAsync(filePath: string): Promise<string> {
    return await fs.promises.readFile(filePath, 'utf8');
}

/**
 * Writes file contents asynchronously as UTF-8 string.
 *
 * @param filePath - Path to file.
 * @param data - Content string to write.
 */
export async function writeTextFileAsync(filePath: string, data: string): Promise<void> {
    await fs.promises.writeFile(filePath, data, 'utf8');
}

/**
 * Reads lines from a file asynchronously using streaming, returning empty array on failure.
 *
 * @param filePath - Path to file.
 * @returns Promise resolving to an array of lines.
 */
export async function readLinesSafeAsync(filePath: string): Promise<string[]> {
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        const lines: string[] = [];
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });
        for await (const line of rl) {
            lines.push(line);
        }
        return lines;
    } catch {
        return [];
    }
}

async function cleanupStagingFileAsync(stagingPath: string): Promise<void> {
    try {
        await fs.promises.unlink(stagingPath);
    } catch {
        /* ignore */
    }
}

/**
 * Atomic write asynchronously: .tmp-<pid>-<rand> + rename.
 *
 * @param file - Target file path.
 * @param data - Content string to write.
 */
export async function writeFileAtomicAsync(file: string, data: string): Promise<void> {
    const stagingPath = `${file}.tmp-${process.pid}-${Math.random().toString(RANDOM_STRING_RADIX).slice(2, STAGING_SUFFIX_SLICE_END)}`;
    await fs.promises.writeFile(stagingPath, data, 'utf8');
    try {
        await fs.promises.rename(stagingPath, file);
    } catch (e) {
        await cleanupStagingFileAsync(stagingPath);
        throw e;
    }
}

async function writeProbeAsync(probe: string): Promise<boolean> {
    try {
        await writeTextFileAsync(probe, 'ok');
        return true;
    } catch {
        return false;
    }
}

async function removeProbeAsync(probe: string): Promise<boolean> {
    try {
        await fs.promises.unlink(probe);
    } catch {
        /* probe cleanup is best-effort */
    }
    return true;
}

/**
 * Probes asynchronously whether a directory is writable by attempting a probe file write.
 *
 * @param dir - Directory path to probe.
 * @returns Promise resolving to true if writable, false otherwise.
 */
export async function probeWritableAsync(dir: string): Promise<boolean> {
    try {
        const probe = path.join(dir, '.probe');
        return (await writeProbeAsync(probe)) && (await removeProbeAsync(probe));
    } catch {
        return false;
    }
}
