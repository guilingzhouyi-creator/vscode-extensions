/**
 * Module: Daemon — Immutable Snapshot Config & Entry Validator
 * File Path: src/daemon/snapshot-validation.ts
 * Architecture Role: Fail-closed validation and Git-object hashing helpers for immutable
 *   `scan_snapshot` requests before execution by `./snapshot-handler`.
 * Dependencies & Triggers: Node crypto, ../core/types, ../core/config/config,
 *   ../core/review/source-snapshot, and ./protocol.
 * Responsibilities:
 *   1. Validate raw snapshot `ScanConfig` inputs and enforce explicit/valid archetypes;
 *   2. Decode caller-supplied UTF-8/base64 payloads and verify Git blob SHA-1 digests;
 *   3. Sanitize repository IDs and derive canonical tree SHA-1 hashes.
 * Exit Semantics & Design Rationale: Throws explicit error codes on bad paths, archetypes,
 *   or digest mismatches so invalid snapshots fail before entering workspace evaluation.
 */

import { createHash } from 'node:crypto';
import type { ProjectArchetype, ScanConfig } from '../core/types';
import { resolveConfig } from '../core/config/config';
import type { SnapshotCaptureEntry, SnapshotFileMode } from '../core/review/source-snapshot';
import type { SnapshotScanEntryInput } from './protocol';

const VALID_ARCHETYPES = new Set<ProjectArchetype>([
    'demo',
    'web',
    'game',
    'library',
    'stdlib',
    'systems_runtime',
]);
const MAX_REPO_ID_CHARS = 128;
const DEFAULT_REPOSITORY_ID = 'snapshot-repo';
const MODE_REGULAR_FILE: SnapshotFileMode = '100644';
const MODE_GIT_SUBMODULE = '160000' as const;
const ALGO_GIT_SHA1 = 'git-sha1' as const;
const DEFAULT_SILENT_LOG_LEVEL = 'silent' as const;

/** Options controlling daemon-side immutable snapshot scan execution. */
export interface SnapshotScanOptions {
    readonly signal?: AbortSignal;
    readonly repositoryId?: string;
    readonly treeSha1?: string;
    readonly maxEntries?: number;
    readonly maxBlobBytes?: number;
    readonly maxTotalBytes?: number;
}

/**
 * Git object digest helper matching `git hash-object` for snapshot verification.
 *
 * @param bytes - Raw file byte payload to hash.
 * @returns Lowercase hexadecimal Git blob SHA-1 digest.
 */
export function computeGitBlobSha1(bytes: Uint8Array): string {
    return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}

/**
 * Derive deterministic canonical tree SHA-1 over sorted snapshot capture entries.
 *
 * @param entries - Verified snapshot capture entries with Git object digests.
 * @returns Deterministic canonical tree SHA-1 hex digest.
 */
export function deriveSnapshotTreeSha1(entries: readonly SnapshotCaptureEntry[]): string {
    const hash = createHash('sha1');
    const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    for (const entry of sorted) {
        hash.update(`${entry.mode} ${entry.path}\0${entry.object.value}\n`);
    }
    return hash.digest('hex');
}

/**
 * Sanitize repository identifier to safe filesystem/evidence characters.
 *
 * @param rawId - Caller-supplied repository identifier candidate.
 * @returns Sanitized identifier clamped to safe characters.
 */
export function sanitizeRepositoryId(rawId: string): string {
    const clean = rawId.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, MAX_REPO_ID_CHARS);
    return !clean || !/^[A-Za-z0-9]/.test(clean) ? DEFAULT_REPOSITORY_ID : clean;
}

function readStrProp(record: Record<string, unknown>, key: string): string | undefined {
    const propVal = record[key];
    return typeof propVal === 'string' ? propVal : undefined;
}

function readStrListProp(record: Record<string, unknown>, key: string): string[] | undefined {
    const propVal = record[key];
    return Array.isArray(propVal) ? (propVal as string[]) : undefined;
}

function resolveSnapshotLogLevel(configJson: Record<string, unknown>): ScanConfig['logLevel'] {
    return (readStrProp(configJson, 'logLevel') ??
        DEFAULT_SILENT_LOG_LEVEL) as ScanConfig['logLevel'];
}

function resolveSnapshotAnalyzers(
    rawAnalyzers: unknown,
    fallback: ScanConfig['analyzers'],
): ScanConfig['analyzers'] {
    const isMap =
        Boolean(rawAnalyzers) && typeof rawAnalyzers === 'object' && !Array.isArray(rawAnalyzers);
    return isMap ? (rawAnalyzers as ScanConfig['analyzers']) : fallback;
}

/**
 * Validate raw snapshot configuration and guarantee a non-empty root and supported archetype.
 *
 * @param configJson - Raw configuration payload from snapshot client request.
 * @param signal - Optional cancellation AbortSignal for long-running scan cancellation.
 * @returns Normalized non-cached ScanConfig bound to an explicit supported archetype.
 */
export function resolveValidatedSnapshotConfig(
    configJson: Record<string, unknown>,
    signal?: AbortSignal,
): ScanConfig {
    const rootPath = configJson ? readStrProp(configJson, 'root') : undefined;
    if (!rootPath || !rootPath.trim()) {
        throw new Error('INVALID_SNAPSHOT_CONFIG: snapshot scan requires a non-empty root path');
    }
    const rawArch = configJson.archetype;
    if (
        rawArch !== undefined &&
        (typeof rawArch !== 'string' || !VALID_ARCHETYPES.has(rawArch as ProjectArchetype))
    ) {
        throw new Error(`INVALID_ARCHETYPE: unsupported archetype "${String(rawArch)}"`);
    }
    const baseResolved = resolveConfig({
        root: rootPath,
        configFile: readStrProp(configJson, 'configFile'),
        analyzers: readStrListProp(configJson, 'analyzers'),
        archetype: typeof rawArch === 'string' ? (rawArch as ProjectArchetype) : undefined,
        cache: false,
        sparseRouting: false,
        persistGovernanceSnapshot: false,
        logLevel: resolveSnapshotLogLevel(configJson),
        signal,
    });
    const include = readStrListProp(configJson, 'include');
    const exclude = readStrListProp(configJson, 'exclude');
    const resolved: ScanConfig = {
        ...baseResolved,
        ...(include ? { include } : {}),
        ...(exclude ? { exclude } : {}),
        analyzers: resolveSnapshotAnalyzers(configJson.analyzers, baseResolved.analyzers),
        cacheEnabled: false,
        sparseRouting: false,
        persistGovernanceSnapshot: false,
        signal,
    };
    if (!resolved.archetype || !VALID_ARCHETYPES.has(resolved.archetype)) {
        throw new Error('MISSING_ARCHETYPE: scan_snapshot requires explicit or configured archetype');
    }
    return resolved;
}

/**
 * Convert and verify one incoming snapshot wire entry into a `SnapshotCaptureEntry`.
 *
 * @param rawEntry - Wire snapshot entry carrying UTF-8 content or base64 bytes.
 * @returns Verified snapshot capture entry with canonical Git object digest.
 */
export function buildSnapshotCaptureEntry(rawEntry: SnapshotScanEntryInput): SnapshotCaptureEntry {
    if (!rawEntry || typeof rawEntry.path !== 'string') {
        throw new Error('INVALID_SNAPSHOT_ENTRY: entry path must be a string');
    }
    const mode: SnapshotFileMode = rawEntry.mode ?? MODE_REGULAR_FILE;
    if (mode === MODE_GIT_SUBMODULE) {
        if (!rawEntry.gitSha1 || !/^[0-9a-f]{40}$/.test(rawEntry.gitSha1)) {
            throw new Error('INVALID_SNAPSHOT_ENTRY: submodule entry requires gitSha1');
        }
        return {
            path: rawEntry.path,
            mode: MODE_GIT_SUBMODULE,
            object: { algorithm: ALGO_GIT_SHA1, value: rawEntry.gitSha1 },
        };
    }
    let bytes: Buffer | null = null;
    if (typeof rawEntry.bytesBase64 === 'string') {
        bytes = Buffer.from(rawEntry.bytesBase64, 'base64');
    } else if (typeof rawEntry.content === 'string') {
        bytes = Buffer.from(rawEntry.content, 'utf8');
    }
    if (!bytes) {
        throw new Error(`INVALID_SNAPSHOT_ENTRY: "${rawEntry.path}" needs content or bytesBase64`);
    }
    const sha1 = computeGitBlobSha1(bytes);
    if (rawEntry.gitSha1 !== undefined && rawEntry.gitSha1 !== sha1) {
        throw new Error(`SNAPSHOT_SHA_MISMATCH: "${rawEntry.path}" expected ${sha1}`);
    }
    return {
        path: rawEntry.path,
        mode,
        bytes,
        byteLength: bytes.byteLength,
        object: { algorithm: ALGO_GIT_SHA1, value: sha1 },
    };
}
