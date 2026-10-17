/**
 * Module: Core Engine — Cache Persistence and Serialization Helpers
 * File Path: src/core/cache-persistence.ts
 * Architecture Role: Atomic disk I/O, line-by-line streaming parsers, and serialization
 *   for L1 fingerprints, L2 scan results, and L3 path indexes.
 * Dependencies & Triggers: fs, path, and core types; consumed by CacheStore.
 * Responsibilities: Read/write files atomically (.tmp + rename), parse jsonl safely,
 *   recover from corrupt lines, serialize cache records, probe/clean cache directories,
 *   and support Append-Only (WAL) incremental updates and compaction.
 * Exit Semantics & Design Rationale: Never throws on corrupt lines or failed cleanups.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { Issue, FileMetric } from './types';
import type { Fingerprint } from './cache';

/** Default UTF-8 encoding constant. */
export const ENCODING_UTF8 = 'utf8';
/** Standard newline character constant. */
export const NEWLINE_CHAR = '\n';
/** Probe verification content constant. */
export const PROBE_OK_FLAG = 'ok';
/** Probe file name constant. */
export const PROBE_FILE_NAME = '.probe';
/** Type constant for string type checking. */
export const TYPEOF_STRING = 'string';
/** Type constant for number type checking. */
export const TYPEOF_NUMBER = 'number';
/** Random base constant. */
export const RANDOM_STRING_RADIX = 36;
/** Staging path suffix end index. */
export const STAGING_SUFFIX_SLICE_END = 8;
/** Cache clear directory suffix end index. */
export const CACHE_CLEAR_SUFFIX_END_INDEX = 6;

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
const syncFsAppendText = fs.appendFileSync.bind(fs);
const syncFsMkdir = fs.mkdirSync.bind(fs);
const syncFsStat = fs.statSync.bind(fs);
const syncFsExists = fs.existsSync.bind(fs);
const syncFsRm = fs.rmSync.bind(fs);
const syncFsRename = fs.renameSync.bind(fs);

/**
 * Synchronous I/O barrier isolating blocking filesystem primitives.
 */
export const SyncIoBarrier = {
    readText: (filePath: string): string => syncFsReadText(filePath, ENCODING_UTF8),
    writeText: (filePath: string, data: string): void =>
        syncFsWriteText(filePath, data, ENCODING_UTF8),
    appendText: (filePath: string, data: string): void =>
        syncFsAppendText(filePath, data, ENCODING_UTF8),
    mkdir: (dirPath: string): void => {
        syncFsMkdir(dirPath, { recursive: true });
    },
    statSize: (filePath: string): number => {
        try {
            return syncFsStat(filePath).size;
        } catch {
            return -1;
        }
    },
    queryStat: (filePath: string): fs.Stats => syncFsStat(filePath),
    exists: syncFsExists,
    remove: (targetPath: string): void => {
        try {
            syncFsRm(targetPath, { recursive: true, force: true });
        } catch {
            /* ignore */
        }
    },
    rename: (src: string, dest: string): void => {
        syncFsRename(src, dest);
    },
};

/** Reads file contents synchronously as UTF-8 string. */
export const readTextFileSync = SyncIoBarrier.readText;
/** Writes file contents synchronously as UTF-8 string. */
export const writeTextFileSync = SyncIoBarrier.writeText;
/** Appends file contents synchronously as UTF-8 string. */
export const appendTextFileSync = SyncIoBarrier.appendText;

/**
 * Reads lines from a file synchronously, returning empty array on failure.
 *
 * @param filePath - Path to the file to read.
 * @returns Array of lines read from file.
 */
export function readLinesSafe(filePath: string): string[] {
    try {
        return readTextFileSync(filePath).split(NEWLINE_CHAR);
    } catch {
        return [];
    }
}

/**
 * Appends lines safely to a target file synchronously, creating if absent.
 *
 * @param filePath - Target file path.
 * @param appendContent - Content string to append.
 */
export function appendLinesSafe(filePath: string, appendContent: string): void {
    if (!appendContent) return;
    try {
        if (!SyncIoBarrier.exists(filePath)) {
            writeFileAtomic(filePath, appendContent);
            return;
        }
        appendTextFileSync(filePath, appendContent);
    } catch {
        /* Best-effort: ignore append failure */
    }
}

/**
 * Atomic write: .tmp-<pid>-<rand> + rename.
 *
 * @param targetFile - Target file path.
 * @param fileContent - Content string to write.
 */
export function writeFileAtomic(targetFile: string, fileContent: string): void {
    const stagingPath = `${targetFile}.tmp-${process.pid}-${Math.random().toString(RANDOM_STRING_RADIX).slice(2, STAGING_SUFFIX_SLICE_END)}`;
    writeTextFileSync(stagingPath, fileContent);
    try {
        SyncIoBarrier.rename(stagingPath, targetFile);
    } catch (e) {
        SyncIoBarrier.remove(stagingPath);
        throw e;
    }
}

/**
 * Probes whether a directory is writable by attempting a probe file write.
 *
 * @param dir - Directory path to probe.
 * @returns True if directory is writable, false otherwise.
 */
export function probeWritable(dir: string): boolean {
    const probe = path.join(dir, PROBE_FILE_NAME);
    try {
        writeTextFileSync(probe, PROBE_OK_FLAG);
        SyncIoBarrier.remove(probe);
        return true;
    } catch {
        return false;
    }
}

function isValidL1(
    candidateObj: unknown,
): candidateObj is { t: string; p: string; m: number; s: number; i?: number } {
    const rawRecord = candidateObj as Record<string, unknown> | null;
    return Boolean(
        rawRecord &&
        rawRecord.t === 'f' &&
        typeof rawRecord.p === TYPEOF_STRING &&
        typeof rawRecord.m === TYPEOF_NUMBER &&
        typeof rawRecord.s === TYPEOF_NUMBER,
    );
}

/**
 * Parses a line from the L1 fingerprint cache into the target map.
 *
 * @param line - Line string to parse.
 * @param targetMap - Map to store parsed L1 fingerprint.
 */
export function parseL1Line(line: string, targetMap: Map<string, Fingerprint>): void {
    try {
        const parsedRecord = JSON.parse(line);
        if (!isValidL1(parsedRecord)) return;
        targetMap.set(parsedRecord.p, {
            mtimeMs: parsedRecord.m,
            size: parsedRecord.s,
            ino: typeof parsedRecord.i === TYPEOF_NUMBER ? parsedRecord.i : undefined,
        });
    } catch {
        /* Best-effort: skip corrupt line */
    }
}

/**
 * Type guard validating whether an object is a valid L2 cache record.
 *
 * @param candidateObj - Object to validate.
 * @returns True if object is a valid L2 record.
 */
export function isValidL2(candidateObj: unknown): candidateObj is {
    t: string;
    k: string;
    p: string;
    issues: Issue[];
    metric?: FileMetric;
    ts?: number;
    fm?: number;
    fs?: number;
} {
    const rawRecord = candidateObj as Record<string, unknown> | null;
    return Boolean(
        rawRecord &&
        rawRecord.t === 'r' &&
        typeof rawRecord.k === TYPEOF_STRING &&
        typeof rawRecord.p === TYPEOF_STRING &&
        Array.isArray(rawRecord.issues),
    );
}

/**
 * Type guard validating whether an object is a valid path index record.
 *
 * @param candidateObj - Object to validate.
 * @returns True if object is a valid path entry.
 */
export function isValidPathEntry(
    candidateObj: unknown,
): candidateObj is { t: string; pk: string; k: string } {
    const rawRecord = candidateObj as Record<string, unknown> | null;
    return Boolean(
        rawRecord &&
        rawRecord.t === 'x' &&
        typeof rawRecord.pk === TYPEOF_STRING &&
        typeof rawRecord.k === TYPEOF_STRING,
    );
}

/**
 * Serializes L1 fingerprint entries into newline-delimited JSON.
 *
 * @param l1 - Map of normalized paths to L1 fingerprints.
 * @returns Serialized NDJSON string.
 */
export function serializeL1(l1: Map<string, Fingerprint>): string {
    const lines: string[] = [];
    for (const [relPath, fingerprint] of l1) {
        const lineObj: Record<string, unknown> = {
            t: 'f',
            p: relPath,
            m: fingerprint.mtimeMs,
            s: fingerprint.size,
        };
        if (fingerprint.ino !== undefined) lineObj.i = fingerprint.ino;
        lines.push(JSON.stringify(lineObj));
    }
    return lines.join(NEWLINE_CHAR) + (lines.length ? NEWLINE_CHAR : '');
}

/**
 * Serializes L2 cache entries into newline-delimited JSON.
 *
 * @param l2 - Map of cache keys to L2 records.
 * @returns Serialized NDJSON string.
 */
export function serializeL2(l2: Map<string, L2EntryRecord>): string {
    const lines: string[] = [];
    for (const entry of l2.values()) {
        const lineObj: Record<string, unknown> = {
            t: 'r',
            k: entry.k,
            p: entry.p,
            issues: entry.issues,
            metric: entry.metric,
            ts: entry.ts,
        };
        if (entry.fm !== undefined) lineObj.fm = entry.fm;
        if (entry.fs !== undefined) lineObj.fs = entry.fs;
        lines.push(JSON.stringify(lineObj));
    }
    return lines.join(NEWLINE_CHAR) + (lines.length ? NEWLINE_CHAR : '');
}

/**
 * Extracts fingerprint digest from a composite L2 key string.
 *
 * @param keyString - Key string to extract hash from.
 * @returns Extracted hash or empty string.
 */
export function extractFingerprintHash(keyString: string): string {
    const matchResult = /^v1:([0-9a-f]+):[0-9a-f]+$/.exec(keyString);
    return matchResult ? matchResult[1] : '';
}

/**
 * Computes deterministic path key for secondary path-indexed lookup.
 *
 * @param l2key - L2 key string.
 * @param relPath - Relative file path.
 * @param mtimeMs - Modification timestamp in ms.
 * @param size - File size in bytes.
 * @returns Deterministic path key string.
 */
export function computePathKey(
    l2key: string,
    relPath: string,
    mtimeMs?: number,
    size?: number,
): string {
    const fingerprintMtimeMs = typeof mtimeMs === TYPEOF_NUMBER ? String(mtimeMs) : '*';
    const fingerprintSizeBytes = typeof size === TYPEOF_NUMBER ? String(size) : '*';
    return `${extractFingerprintHash(l2key)}\u0000${relPath}\u0000${fingerprintMtimeMs}\u0000${fingerprintSizeBytes}`;
}

/**
 * Serializes path index entries into newline-delimited JSON.
 *
 * @param l2ByPath - Map of normalized paths to L2 records.
 * @returns Serialized NDJSON string.
 */
export function serializePaths(l2ByPath: Map<string, L2EntryRecord>): string {
    const lines: string[] = [];
    for (const [pathKey, entryRecord] of l2ByPath) {
        lines.push(JSON.stringify({ t: 'x', pk: pathKey, k: entryRecord.k }));
    }
    return lines.join(NEWLINE_CHAR) + (lines.length ? NEWLINE_CHAR : '');
}

/**
 * Serializes newly added dirty L2 entries into path index NDJSON for Append-Only (WAL) updates.
 *
 * @param dirtyEntries - Iterable collection of dirty L2 entry records.
 * @returns Serialized NDJSON string.
 */
export function serializeDirtyPaths(dirtyEntries: Iterable<L2EntryRecord>): string {
    const lines: string[] = [];
    for (const entry of dirtyEntries) {
        const pathKey = computePathKey(entry.k, entry.p, entry.fm, entry.fs);
        lines.push(JSON.stringify({ t: 'x', pk: pathKey, k: entry.k }));
    }
    return lines.join(NEWLINE_CHAR) + (lines.length ? NEWLINE_CHAR : '');
}

/**
 * Safely removes or renames a cache directory.
 *
 * @param dir - Cache directory path.
 * @returns True if removed or renamed successfully, false otherwise.
 */
export function removeCacheDir(dir: string): boolean {
    if (!SyncIoBarrier.exists(dir)) return true;
    try {
        SyncIoBarrier.remove(dir);
        return true;
    } catch {
        try {
            const stale = path.join(
                path.dirname(dir),
                `.auto-refactor-cache-clear-${Date.now()}-${Math.random().toString(RANDOM_STRING_RADIX).slice(2, CACHE_CLEAR_SUFFIX_END_INDEX)}`,
            );
            SyncIoBarrier.rename(dir, stale);
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Reads file contents asynchronously as UTF-8 string.
 *
 * @param filePath - Path to file.
 * @returns Promise resolving to file content.
 */
export async function readTextFileAsync(filePath: string): Promise<string> {
    return await fs.promises.readFile(filePath, ENCODING_UTF8);
}

/**
 * Writes file contents asynchronously as UTF-8 string.
 *
 * @param filePath - Path to file.
 * @param fileContent - Content string to write.
 */
export async function writeTextFileAsync(filePath: string, fileContent: string): Promise<void> {
    await fs.promises.writeFile(filePath, fileContent, ENCODING_UTF8);
}

/**
 * Appends file contents asynchronously as UTF-8 string.
 *
 * @param filePath - Path to file.
 * @param appendContent - Content string to append.
 */
export async function appendTextFileAsync(filePath: string, appendContent: string): Promise<void> {
    await fs.promises.appendFile(filePath, appendContent, ENCODING_UTF8);
}

/**
 * Reads lines from a file asynchronously using streaming, returning empty array on failure.
 *
 * @param filePath - Path to file.
 * @returns Promise resolving to an array of lines.
 */
export async function readLinesSafeAsync(filePath: string): Promise<string[]> {
    try {
        if (!SyncIoBarrier.exists(filePath)) {
            return [];
        }
        const lines: string[] = [];
        const fileStream = fs.createReadStream(filePath, { encoding: ENCODING_UTF8 });
        const lineReader = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });
        for await (const line of lineReader) {
            lines.push(line);
        }
        return lines;
    } catch {
        return [];
    }
}

/**
 * Atomic write asynchronously: .tmp-<pid>-<rand> + rename.
 *
 * @param targetFile - Target file path.
 * @param fileContent - Content string to write.
 */
export async function writeFileAtomicAsync(targetFile: string, fileContent: string): Promise<void> {
    const stagingPath = `${targetFile}.tmp-${process.pid}-${Math.random().toString(RANDOM_STRING_RADIX).slice(2, STAGING_SUFFIX_SLICE_END)}`;
    await writeTextFileAsync(stagingPath, fileContent);
    try {
        await fs.promises.rename(stagingPath, targetFile);
    } catch (e) {
        try {
            await fs.promises.unlink(stagingPath);
        } catch {
            /* ignore */
        }
        throw e;
    }
}

/**
 * Appends lines safely to a target file asynchronously, creating if absent.
 *
 * @param filePath - Target file path.
 * @param appendContent - Content string to append.
 */
export async function appendLinesSafeAsync(filePath: string, appendContent: string): Promise<void> {
    if (!appendContent) return;
    try {
        if (!SyncIoBarrier.exists(filePath)) {
            await writeFileAtomicAsync(filePath, appendContent);
            return;
        }
        await appendTextFileAsync(filePath, appendContent);
    } catch {
        /* Best-effort: ignore append failure */
    }
}

/**
 * Probes asynchronously whether a directory is writable by attempting a probe file write.
 *
 * @param dir - Directory path to probe.
 * @returns Promise resolving to true if writable, false otherwise.
 */
export async function probeWritableAsync(dir: string): Promise<boolean> {
    const probe = path.join(dir, PROBE_FILE_NAME);
    try {
        await writeTextFileAsync(probe, PROBE_OK_FLAG);
        try {
            await fs.promises.unlink(probe);
        } catch {
            /* probe cleanup is best-effort */
        }
        return true;
    } catch {
        return false;
    }
}
