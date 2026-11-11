/**
 * Module: Review — Immutable Source Snapshot
 * File Path: src/core/review/source-snapshot.ts
 * Architecture Role: Bounded source-byte boundary independent of mutable workspace reads.
 * Dependencies & Triggers: Node crypto; consumed by snapshot scan and future object-store adapters.
 * Responsibilities: Bind paths, modes, lengths and blob identities; preserve non-text states.
 * Exit Semantics & Design Rationale: Invalid input never falls back to host files or empty text.
 */
import { createHash } from 'node:crypto';

/** Git blob object hash descriptor binding snapshot content identity. */
export interface SnapshotGitObject {
    readonly algorithm: 'git-sha1';
    readonly value: string;
}
/** Cryptographic SM3 manifest digest descriptor for snapshot provenance. */
export interface SnapshotDigest {
    readonly algorithm: 'sm3';
    readonly value: string;
}
/** Immutable repository, tree, and manifest identity tuple for a snapshot. */
export interface SourceSnapshotIdentity {
    readonly repositoryId: string;
    readonly tree: SnapshotGitObject;
    readonly manifestDigest: SnapshotDigest;
}
/** Git file mode literal supported inside source snapshots. */
export type SnapshotFileMode = '100644' | '100755' | '120000' | '160000';
/** Raw capture entry payload supplied when constructing a source snapshot. */
export type SnapshotCaptureEntry = {
    readonly path: string;
    readonly object: SnapshotGitObject;
} & (
    | {
          readonly mode: '100644' | '100755' | '120000';
          readonly bytes: Uint8Array;
          readonly byteLength: number;
      }
    | { readonly mode: '160000' }
);
/** Validated immutable manifest metadata for one entry in a snapshot. */
export interface SnapshotEntry {
    readonly path: string;
    readonly mode: SnapshotFileMode;
    readonly object: SnapshotGitObject;
    readonly byteLength: number;
}
/** Resource ceiling parameters bounding snapshot entry counts and byte sizes. */
export interface SnapshotBudget {
    readonly maxEntries: number;
    readonly maxBlobBytes: number;
    readonly maxTotalBytes: number;
}
interface SnapshotReadBase extends SnapshotEntry {
    readonly source: 'immutable-snapshot';
}
/** Discriminated read result classifying text, binary, missing, and unsupported entries. */
export type SnapshotRead =
    | { readonly kind: 'missing'; readonly path: string; readonly source: 'immutable-snapshot' }
    | (SnapshotReadBase & { readonly kind: 'submodule' })
    | (SnapshotReadBase & { readonly kind: 'binary' | 'symlink'; readonly bytes: Uint8Array })
    | (SnapshotReadBase & {
          readonly kind: 'unsupported';
          readonly reason: 'invalid-utf8';
          readonly bytes: Uint8Array;
      })
    | (SnapshotReadBase & {
          readonly kind: 'text';
          readonly bytes: Uint8Array;
          readonly content: string;
          readonly encoding: 'utf-8';
          readonly bom: boolean;
          readonly lineEnding: 'none' | 'lf' | 'crlf' | 'cr' | 'mixed';
      });
/** Read-only source snapshot port decoupled from mutable workspace filesystem access. */
export interface SourceSnapshot {
    readonly source: 'immutable-snapshot';
    readonly identity: SourceSnapshotIdentity;
    readonly entries: readonly SnapshotEntry[];
    read(path: string, expectedObject?: SnapshotGitObject): SnapshotRead;
}
interface StoredEntry {
    readonly metadata: SnapshotEntry;
    readonly bytes?: Buffer;
}

const MAX_SNAPSHOT_PATH_LEN = 1024;
const ALGO_GIT_SHA1 = 'git-sha1';
const ALGO_SM3 = 'sm3';
const MODE_REGULAR = '100644';
const MODE_EXECUTABLE = '100755';
const MODE_SYMLINK = '120000';
const MODE_SUBMODULE = '160000';
const BLOB_MODES: ReadonlySet<string> = new Set([MODE_REGULAR, MODE_EXECUTABLE, MODE_SYMLINK]);
const SOURCE_IMMUTABLE_SNAPSHOT = 'immutable-snapshot';
const MANIFEST_SCHEMA_TAG = 'source-snapshot-manifest-v1';
const ENCODING_UTF8 = 'utf-8';
const ENDING_NONE = 'none';
const ENDING_LF = 'lf';
const ENDING_CRLF = 'crlf';
const ENDING_CR = 'cr';
const ENDING_MIXED = 'mixed';
const KIND_SUBMODULE = 'submodule';
const KIND_SYMLINK = 'symlink';
const KIND_BINARY = 'binary';
const KIND_UNSUPPORTED = 'unsupported';
const KIND_TEXT = 'text';
const KIND_MISSING = 'missing';
const REASON_INVALID_UTF8 = 'invalid-utf8';
const UTF8_BOM_LEN = 3;
const UTF8_BOM_BYTE_0 = 0xef;
const UTF8_BOM_BYTE_1 = 0xbb;
const UTF8_BOM_BYTE_2 = 0xbf;

/**
 * Check exact portable repository paths; normalization cannot change their identity.
 *
 * @param path - Repository-relative POSIX path supplied by the snapshot manifest.
 * @returns Nothing; throws when the path is ambiguous or outside the portable profile.
 */
export function assertSnapshotPath(path: string): void {
    if (
        typeof path !== 'string' ||
        path.length === 0 ||
        path.length > MAX_SNAPSHOT_PATH_LEN ||
        /[\\:<>"|?*\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(path) ||
        path !== path.normalize('NFC')
    ) {
        throw new Error('Invalid snapshot path');
    }
    for (const component of path.split('/')) {
        if (
            !component ||
            component === '.' ||
            component === '..' ||
            /[. ]$/.test(component) ||
            component.toLowerCase() === '.git' ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component)
        ) {
            throw new Error('Ambiguous snapshot path');
        }
    }
}

function copyObject(object: SnapshotGitObject): SnapshotGitObject {
    if (object?.algorithm !== ALGO_GIT_SHA1 || !/^[0-9a-f]{40}$/.test(object.value)) {
        throw new Error('Invalid snapshot object identity');
    }
    return Object.freeze({ algorithm: ALGO_GIT_SHA1, value: object.value });
}

function assertBudget(budget: SnapshotBudget): void {
    for (const limitValue of [budget.maxEntries, budget.maxBlobBytes, budget.maxTotalBytes]) {
        if (!Number.isSafeInteger(limitValue) || limitValue < 0)
            throw new Error('Invalid snapshot budget');
    }
}

function assertNoPathCollisions(entries: readonly SnapshotEntry[]): void {
    const paths = new Set<string>();
    const prefixByFoldedMap = new Map<string, string>();
    for (const entry of entries) {
        let prefix = '';
        for (const component of entry.path.split('/')) {
            prefix = prefix ? `${prefix}/${component}` : component;
            const foldedPrefix = prefix.toLowerCase().normalize('NFC');
            const previous = prefixByFoldedMap.get(foldedPrefix);
            if (previous !== undefined && previous !== prefix) {
                throw new Error('Snapshot directory spelling collision');
            }
            prefixByFoldedMap.set(foldedPrefix, prefix);
        }
        const folded = entry.path.toLowerCase().normalize('NFC');
        if (paths.has(folded)) throw new Error('Snapshot path collision');
        paths.add(folded);
    }
    for (const entry of entries) {
        const components = entry.path.toLowerCase().normalize('NFC').split('/');
        components.pop();
        while (components.length > 0) {
            if (paths.has(components.join('/')))
                throw new Error('Snapshot file/directory collision');
            components.pop();
        }
    }
}

function buildCapturedEntry(
    input: SnapshotCaptureEntry,
    budget: SnapshotBudget,
    remaining: number,
): StoredEntry {
    assertSnapshotPath(input.path);
    const object = copyObject(input.object);
    if (input.mode === MODE_SUBMODULE) {
        return {
            metadata: Object.freeze({ path: input.path, mode: input.mode, object, byteLength: 0 }),
        };
    }
    if (!BLOB_MODES.has(input.mode)) throw new Error('Unsupported snapshot file mode');
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength !== input.byteLength) {
        throw new Error('Snapshot declared byte length mismatch');
    }
    if (input.byteLength > budget.maxBlobBytes || input.byteLength > remaining) {
        throw new Error('Snapshot byte budget exceeded');
    }
    const bytes = Buffer.from(input.bytes);
    const digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (digest !== object.value) throw new Error('Snapshot blob identity mismatch');
    return {
        metadata: Object.freeze({
            path: input.path,
            mode: input.mode,
            object,
            byteLength: bytes.length,
        }),
        bytes,
    };
}

function detectLineEnding(content: string): 'none' | 'lf' | 'crlf' | 'cr' | 'mixed' {
    let hasLf = false;
    let hasCrlf = false;
    let hasCr = false;
    for (let index = 0; index < content.length; index++) {
        if (content[index] === '\r') {
            if (content[index + 1] === '\n') {
                hasCrlf = true;
                index++;
            } else {
                hasCr = true;
            }
        } else if (content[index] === '\n') hasLf = true;
    }
    if (Number(hasLf) + Number(hasCrlf) + Number(hasCr) > 1) return ENDING_MIXED;
    if (hasCrlf) return ENDING_CRLF;
    if (hasLf) return ENDING_LF;
    return hasCr ? ENDING_CR : ENDING_NONE;
}

function readEntry(stored: StoredEntry): SnapshotRead {
    const base: SnapshotReadBase = { ...stored.metadata, source: SOURCE_IMMUTABLE_SNAPSHOT };
    if (stored.metadata.mode === MODE_SUBMODULE)
        return Object.freeze({ ...base, kind: KIND_SUBMODULE });
    if (!stored.bytes) throw new Error('Snapshot blob bytes are missing');
    const bytes = Buffer.from(stored.bytes);
    if (stored.metadata.mode === MODE_SYMLINK)
        return Object.freeze({ ...base, kind: KIND_SYMLINK, bytes });
    if (bytes.includes(0)) return Object.freeze({ ...base, kind: KIND_BINARY, bytes });
    let content: string;
    try {
        content = new TextDecoder(ENCODING_UTF8, { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        return Object.freeze({
            ...base,
            kind: KIND_UNSUPPORTED,
            reason: REASON_INVALID_UTF8,
            bytes,
        });
    }
    return Object.freeze({
        ...base,
        kind: KIND_TEXT,
        bytes,
        content,
        encoding: ENCODING_UTF8,
        bom:
            bytes.length >= UTF8_BOM_LEN &&
            bytes[0] === UTF8_BOM_BYTE_0 &&
            bytes[1] === UTF8_BOM_BYTE_1 &&
            bytes[2] === UTF8_BOM_BYTE_2,
        lineEnding: detectLineEnding(content),
    });
}

/**
 * Capture a bounded set of verified bytes without any filesystem access.
 *
 * The manifest digest is SM3 of UTF-8 JSON `["source-snapshot-manifest-v1", entries]`,
 * where entries are path-sorted `[path, mode, algorithm, objectId, byteLength]` tuples.
 * Strings are exact NFC paths; tuple arrays avoid object-key ordering ambiguities.
 * O(total bytes + path sorting), with memory bounded by the explicit host budget.
 * Tree membership and repository authorization remain the supplying adapter's responsibility.
 *
 * @param descriptor - Declared repository/tree identity and optional expected manifest digest.
 * @param inputs - Complete fixed manifest entries, including link and submodule modes.
 * @param budget - Trusted host limits; no unbounded/default capture is permitted.
 * @returns An immutable read port whose returned byte buffers are independent copies.
 */
export function captureSourceSnapshot(
    descriptor: Omit<SourceSnapshotIdentity, 'manifestDigest'> & {
        readonly manifestDigest?: SnapshotDigest;
    },
    inputs: readonly SnapshotCaptureEntry[],
    budget: SnapshotBudget,
): SourceSnapshot {
    assertBudget(budget);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(descriptor.repositoryId)) {
        throw new Error('Invalid snapshot repository identity');
    }
    const tree = copyObject(descriptor.tree);
    if (inputs.length > budget.maxEntries) throw new Error('Snapshot entry budget exceeded');
    const entryByPathMap = new Map<string, StoredEntry>();
    const entries: SnapshotEntry[] = [];
    let total = 0;
    for (const input of inputs) {
        const captured = buildCapturedEntry(input, budget, budget.maxTotalBytes - total);
        total += captured.metadata.byteLength;
        entries.push(captured.metadata);
        entryByPathMap.set(captured.metadata.path, captured);
    }
    assertNoPathCollisions(entries);
    entries.sort((left, right) => (left.path < right.path ? -1 : Number(left.path > right.path)));
    const tuples = entries.map((entry) => [
        entry.path,
        entry.mode,
        entry.object.algorithm,
        entry.object.value,
        entry.byteLength,
    ]);
    const manifestHash = createHash(ALGO_SM3)
        .update(JSON.stringify([MANIFEST_SCHEMA_TAG, tuples]))
        .digest('hex');
    if (
        descriptor.manifestDigest &&
        (descriptor.manifestDigest.algorithm !== ALGO_SM3 ||
            descriptor.manifestDigest.value !== manifestHash)
    ) {
        throw new Error('Snapshot manifest digest mismatch');
    }
    const identity = Object.freeze({
        repositoryId: descriptor.repositoryId,
        tree,
        manifestDigest: Object.freeze({ algorithm: ALGO_SM3, value: manifestHash }),
    });
    return Object.freeze({
        source: SOURCE_IMMUTABLE_SNAPSHOT,
        identity,
        entries: Object.freeze(entries),
        read(path: string, expectedObject?: SnapshotGitObject): SnapshotRead {
            assertSnapshotPath(path);
            const captured = entryByPathMap.get(path);
            if (!captured) {
                if (expectedObject) throw new Error('Expected snapshot path is missing');
                return Object.freeze({
                    kind: KIND_MISSING,
                    path,
                    source: SOURCE_IMMUTABLE_SNAPSHOT,
                });
            }
            if (
                expectedObject &&
                (expectedObject.algorithm !== ALGO_GIT_SHA1 ||
                    expectedObject.value !== captured.metadata.object.value)
            ) {
                throw new Error('Requested snapshot object identity mismatch');
            }
            return readEntry(captured);
        },
    });
}
