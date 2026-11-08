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
    | { readonly mode: '100644' | '100755' | '120000'; readonly bytes: Uint8Array; readonly byteLength: number }
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
    | (SnapshotReadBase & { readonly kind: 'unsupported'; readonly reason: 'invalid-utf8'; readonly bytes: Uint8Array })
    | (SnapshotReadBase & {
        readonly kind: 'text'; readonly bytes: Uint8Array; readonly content: string;
        readonly encoding: 'utf-8'; readonly bom: boolean;
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

/**
 * Check exact portable repository paths; normalization cannot change their identity.
 *
 * @param path - Repository-relative POSIX path supplied by the snapshot manifest.
 * @returns Nothing; throws when the path is ambiguous or outside the portable profile.
 */
export function assertSnapshotPath(path: string): void {
    if (typeof path !== 'string' || path.length === 0 || path.length > 1024 ||
        /[\\:<>"|?*\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(path) || path !== path.normalize('NFC')) {
        throw new Error('Invalid snapshot path');
    }
    for (const component of path.split('/')) {
        if (!component || component === '.' || component === '..' || /[. ]$/.test(component) ||
            component.toLowerCase() === '.git' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component)) {
            throw new Error('Ambiguous snapshot path');
        }
    }
}

function copyObject(object: SnapshotGitObject): SnapshotGitObject {
    if (object?.algorithm !== 'git-sha1' || !/^[0-9a-f]{40}$/.test(object.value)) {
        throw new Error('Invalid snapshot object identity');
    }
    return Object.freeze({ algorithm: 'git-sha1', value: object.value });
}

function assertBudget(budget: SnapshotBudget): void {
    for (const value of [budget.maxEntries, budget.maxBlobBytes, budget.maxTotalBytes]) {
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid snapshot budget');
    }
}

function assertNoPathCollisions(entries: readonly SnapshotEntry[]): void {
    const paths = new Set<string>();
    const spellings = new Map<string, string>();
    for (const entry of entries) {
        let prefix = '';
        for (const component of entry.path.split('/')) {
            prefix = prefix ? `${prefix}/${component}` : component;
            const foldedPrefix = prefix.toLowerCase().normalize('NFC');
            const previous = spellings.get(foldedPrefix);
            if (previous !== undefined && previous !== prefix) {
                throw new Error('Snapshot directory spelling collision');
            }
            spellings.set(foldedPrefix, prefix);
        }
        const folded = entry.path.toLowerCase().normalize('NFC');
        if (paths.has(folded)) throw new Error('Snapshot path collision');
        paths.add(folded);
    }
    for (const entry of entries) {
        const components = entry.path.toLowerCase().normalize('NFC').split('/');
        components.pop();
        while (components.length > 0) {
            if (paths.has(components.join('/'))) throw new Error('Snapshot file/directory collision');
            components.pop();
        }
    }
}

function captureEntry(
    input: SnapshotCaptureEntry,
    budget: SnapshotBudget,
    remaining: number,
): StoredEntry {
    assertSnapshotPath(input.path);
    const object = copyObject(input.object);
    if (input.mode === '160000') {
        return {
            metadata: Object.freeze({ path: input.path, mode: input.mode, object, byteLength: 0 }),
        };
    }
    if (!['100644', '100755', '120000'].includes(input.mode)) throw new Error('Unsupported snapshot file mode');
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
            path: input.path, mode: input.mode, object, byteLength: bytes.length,
        }),
        bytes,
    };
}

function lineEnding(content: string): 'none' | 'lf' | 'crlf' | 'cr' | 'mixed' {
    let lf = false;
    let crlf = false;
    let cr = false;
    for (let index = 0; index < content.length; index++) {
        if (content[index] === '\r') {
            if (content[index + 1] === '\n') {
                crlf = true;
                index++;
            } else {
                cr = true;
            }
        } else if (content[index] === '\n') lf = true;
    }
    if (Number(lf) + Number(crlf) + Number(cr) > 1) return 'mixed';
    if (crlf) return 'crlf';
    if (lf) return 'lf';
    return cr ? 'cr' : 'none';
}

function readEntry(stored: StoredEntry): SnapshotRead {
    const base = { ...stored.metadata, source: 'immutable-snapshot' as const };
    if (stored.metadata.mode === '160000') return Object.freeze({ ...base, kind: 'submodule' });
    if (!stored.bytes) throw new Error('Snapshot blob bytes are missing');
    const bytes = Buffer.from(stored.bytes);
    if (stored.metadata.mode === '120000') return Object.freeze({ ...base, kind: 'symlink', bytes });
    if (bytes.includes(0)) return Object.freeze({ ...base, kind: 'binary', bytes });
    let content: string;
    try {
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        return Object.freeze({ ...base, kind: 'unsupported', reason: 'invalid-utf8', bytes });
    }
    return Object.freeze({
        ...base, kind: 'text', bytes, content, encoding: 'utf-8',
        bom: bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
        lineEnding: lineEnding(content),
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
    descriptor: Omit<SourceSnapshotIdentity, 'manifestDigest'> & { readonly manifestDigest?: SnapshotDigest },
    inputs: readonly SnapshotCaptureEntry[],
    budget: SnapshotBudget,
): SourceSnapshot {
    assertBudget(budget);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(descriptor.repositoryId)) {
        throw new Error('Invalid snapshot repository identity');
    }
    const tree = copyObject(descriptor.tree);
    if (inputs.length > budget.maxEntries) throw new Error('Snapshot entry budget exceeded');
    const stored = new Map<string, StoredEntry>();
    const entries: SnapshotEntry[] = [];
    let total = 0;
    for (const input of inputs) {
        const captured = captureEntry(input, budget, budget.maxTotalBytes - total);
        total += captured.metadata.byteLength;
        entries.push(captured.metadata);
        stored.set(captured.metadata.path, captured);
    }
    assertNoPathCollisions(entries);
    entries.sort((left, right) => left.path < right.path ? -1 : Number(left.path > right.path));
    const tuples = entries.map((entry) => [
        entry.path, entry.mode, entry.object.algorithm, entry.object.value, entry.byteLength,
    ]);
    const value = createHash('sm3').update(JSON.stringify(['source-snapshot-manifest-v1', tuples])).digest('hex');
    if (descriptor.manifestDigest && (descriptor.manifestDigest.algorithm !== 'sm3' || descriptor.manifestDigest.value !== value)) {
        throw new Error('Snapshot manifest digest mismatch');
    }
    const identity = Object.freeze({
        repositoryId: descriptor.repositoryId, tree, manifestDigest: Object.freeze({ algorithm: 'sm3' as const, value }),
    });
    return Object.freeze({
        source: 'immutable-snapshot' as const, identity, entries: Object.freeze(entries),
        read(path: string, expectedObject?: SnapshotGitObject): SnapshotRead {
            assertSnapshotPath(path);
            const captured = stored.get(path);
            if (!captured) {
                if (expectedObject) throw new Error('Expected snapshot path is missing');
                return Object.freeze({ kind: 'missing', path, source: 'immutable-snapshot' });
            }
            if (expectedObject && (expectedObject.algorithm !== 'git-sha1' || expectedObject.value !== captured.metadata.object.value)) {
                throw new Error('Requested snapshot object identity mismatch');
            }
            return readEntry(captured);
        },
    });
}
