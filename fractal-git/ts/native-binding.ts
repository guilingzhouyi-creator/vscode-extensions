/**
 * Module: Fractal Git — Pure-TypeScript Git Object Engine
 * File Path: ts/native-binding.ts
 * Architecture Role: In-process implementation of the canonical Git object encoders (blob,
 *   tree, commit) plus the fractal ref writer. The historical module name is retained for
 *   import compatibility, but this package compiles, ships, and loads no native `.node`
 *   binding: the pure-TypeScript engine below is the active and only engine.
 * Dependencies & Triggers: Consumed by the primary fractal git facade and the Praxis client SDK.
 * Responsibilities: Expose Git loose-object hashing/encoding, recursive canonical tree assembly
 *   from slash-separated staged paths, canonical commit payload serialization, and ref updates.
 * Exit Semantics & Design Rationale: Emits bytes identical to `git hash-object`,
 *   `git write-tree`, and `git commit-tree` (locked by tests/ts/git-parity.test.ts); fails fast
 *   with explicit errors on illegal staging input; satisfies CC <= 15 and Depth <= 4.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { GIT_FILE_MODE } from './constants';
import type {
    FractalCommitMeta,
    FractalRefDescriptor,
    GitSignature,
    MaterializeCommitRequest,
    MaterializeCommitResult,
    ReclamationSummary,
    StagedFileEntry,
} from './contracts';

/** Canonical five-digit directory entry mode used inside tree objects (never `040000`). */
const CANONICAL_DIRECTORY_MODE = '40000';

/** Leaf modes whose content is persisted as a loose blob in this repository. */
const BLOB_FILE_MODES: ReadonlySet<string> = new Set([
    GIT_FILE_MODE.REGULAR,
    GIT_FILE_MODE.EXECUTABLE,
    GIT_FILE_MODE.SYMLINK,
]);

/** Complete closed set of leaf modes accepted from a staged file entry. */
const LEAF_FILE_MODES: ReadonlySet<string> = new Set([
    ...BLOB_FILE_MODES,
    GIT_FILE_MODE.GITLINK,
]);

/** Hexadecimal object id exactly as printed by Git plumbing commands. */
const RE_OBJECT_ID = /^[0-9a-fA-F]{40}$/;

/** Numeric Git timezone offset such as `+0000` or `-0700`. */
const RE_TZ_OFFSET = /^[+-][0-9]{4}$/;

/** One staged leaf already bound to the object id its tree entry will point at. */
interface StagedTreeLeaf {
    readonly segments: readonly string[];
    readonly name: string;
    readonly mode: string;
    readonly oid: string;
}

/** Mutable in-memory directory node used while assembling nested Git trees. */
interface DirectoryNode {
    readonly name: string;
    readonly directories: Map<string, DirectoryNode>;
    readonly leaves: Map<string, StagedTreeLeaf>;
}

/** One ordered tree entry awaiting binary serialization. */
interface SerializedTreeEntry {
    readonly name: string;
    readonly isDirectory: boolean;
    readonly mode: string;
    readonly oid: string;
}

/** Author and committer identities resolved for one commit request. */
interface ResolvedSignatures {
    readonly author: GitSignature;
    readonly committer: GitSignature;
}

/** Monotonic counter guaranteeing unique temporary filenames within the same millisecond. */
let tempFileSequence = 0;

/**
 * Generates a collision-free temporary file path next to `targetPath`.
 */
function nextTempFilePath(targetPath: string): string {
    tempFileSequence = (tempFileSequence + 1) & 0x7fffffff;
    return `${targetPath}.tmp_${process.pid}_${Date.now()}_${tempFileSequence}`;
}

/**
 * Computes canonical Git SHA-1 OID for a blob header + payload.
 */
export function computeGitBlobOid(payload: Uint8Array): string {
    const header = Buffer.from(`blob ${payload.length}\0`);
    const hasher = crypto.createHash('sha1');
    hasher.update(header);
    hasher.update(payload);
    return hasher.digest('hex');
}

/**
 * Encodes and zlib-compresses a loose object, writing it atomically to `.git/objects/`.
 */
export function writeLooseObjectToDisk(
    gitDir: string,
    type: 'blob' | 'tree' | 'commit',
    payload: Uint8Array,
): { oid: string; objectPath: string } {
    const header = Buffer.from(`${type} ${payload.length}\0`);
    const raw = Buffer.concat([header, payload]);
    const oid = crypto.createHash('sha1').update(raw).digest('hex');

    const prefix = oid.slice(0, 2);
    const suffix = oid.slice(2);
    const targetDir = path.join(gitDir, 'objects', prefix);
    const targetFile = path.join(targetDir, suffix);

    if (!fs.existsSync(targetFile)) {
        fs.mkdirSync(targetDir, { recursive: true });
        const compressed = zlib.deflateSync(raw);
        const tmpFile = nextTempFilePath(targetFile);
        fs.writeFileSync(tmpFile, compressed);
        fs.renameSync(tmpFile, targetFile);
    }

    return { oid, objectPath: targetFile };
}

/**
 * Normalizes one staged repository-relative path into individual tree segments.
 *
 * Mirrors the Rust index normalizer (backslashes to slashes, edge slashes trimmed) while
 * additionally rejecting empty, `.`, and `..` segments so every emitted tree is legal.
 */
function parseStagedPath(rawPath: string): readonly string[] {
    const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (normalized.length === 0) {
        throw new Error(`Cannot stage an empty path: '${rawPath}'`);
    }
    const segments = normalized.split('/');
    for (const segment of segments) {
        if (segment.length === 0 || segment === '.' || segment === '..') {
            throw new Error(
                `Invalid staged path '${rawPath}': '${segment}' is not a legal tree entry name`,
            );
        }
    }
    return segments;
}

/**
 * Validates a staged file mode against the closed set of Git tree leaf modes.
 */
function assertLeafMode(mode: string, stagedPath: string): string {
    if (!LEAF_FILE_MODES.has(mode)) {
        const allowed = [...LEAF_FILE_MODES].join(', ');
        throw new Error(
            `Unsupported staged file mode '${mode}' for '${stagedPath}'; expected one of ${allowed}`,
        );
    }
    return mode;
}

/**
 * Converts staged content into the byte buffer persisted as a loose object.
 */
function toPayloadBuffer(content: Uint8Array | string): Buffer {
    return typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
}

/**
 * Validates and normalizes a 40-character hexadecimal object id.
 */
function assertObjectId(oid: string, role: string): string {
    if (!RE_OBJECT_ID.test(oid)) {
        throw new Error(`Invalid ${role} object id '${oid}'`);
    }
    return oid.toLowerCase();
}

/**
 * Decodes the commit id carried by a gitlink entry (mode `160000`).
 */
function readGitlinkOid(content: Uint8Array | string, stagedPath: string): string {
    const text = typeof content === 'string'
        ? content
        : Buffer.from(content).toString('utf8');
    return assertObjectId(text.trim(), `gitlink '${stagedPath}'`);
}

/**
 * Persists the object a staged leaf points at and returns that object id.
 */
function writeStagedLeafObject(gitDir: string, file: StagedFileEntry, mode: string): string {
    if (mode === GIT_FILE_MODE.GITLINK) {
        return readGitlinkOid(file.content, file.path);
    }
    return writeLooseObjectToDisk(gitDir, 'blob', toPayloadBuffer(file.content)).oid;
}

/**
 * Creates one empty directory node for a normalized tree segment.
 */
function createDirectoryNode(name: string): DirectoryNode {
    return { name, directories: new Map<string, DirectoryNode>(), leaves: new Map<string, StagedTreeLeaf>() };
}

/**
 * Descends into a child directory node, creating it while rejecting file/directory collisions.
 */
function descendIntoDirectory(parent: DirectoryNode, segment: string): DirectoryNode {
    if (parent.leaves.has(segment)) {
        throw new Error(`Staged path conflict: '${segment}' is staged as both a file and a directory`);
    }
    const existing = parent.directories.get(segment);
    if (existing) {
        return existing;
    }
    const created = createDirectoryNode(segment);
    parent.directories.set(segment, created);
    return created;
}

/**
 * Inserts one staged leaf into the recursive directory structure.
 */
function insertTreeLeaf(root: DirectoryNode, leaf: StagedTreeLeaf): void {
    let current = root;
    for (const segment of leaf.segments.slice(0, -1)) {
        current = descendIntoDirectory(current, segment);
    }
    if (current.directories.has(leaf.name)) {
        throw new Error(`Staged path conflict: '${leaf.name}' is staged as both a file and a directory`);
    }
    if (current.leaves.has(leaf.name)) {
        throw new Error(`Duplicate staged path: '${leaf.segments.join('/')}'`);
    }
    current.leaves.set(leaf.name, leaf);
}

/**
 * Compares two tree entries using Git's canonical byte ordering.
 *
 * Directory names participate as if they ended with a trailing `/`, so `foo.c` sorts before
 * the directory `foo`. Comparison is raw UTF-8 byte order (Buffer.compare), never locale aware.
 */
function compareCanonicalTreeEntries(left: SerializedTreeEntry, right: SerializedTreeEntry): number {
    const leftLen = left.name.length;
    const rightLen = right.name.length;
    let i = 0;
    let j = 0;
    while (i < leftLen && j < rightLen) {
        const leftCp = left.name.codePointAt(i)!;
        const rightCp = right.name.codePointAt(j)!;
        if (leftCp !== rightCp) {
            return leftCp - rightCp;
        }
        i += leftCp > 0xffff ? 2 : 1;
        j += rightCp > 0xffff ? 2 : 1;
    }
    if (i < leftLen) {
        const leftCp = left.name.codePointAt(i)!;
        const rightEndByte = right.isDirectory ? 0x2f : -1;
        return leftCp !== rightEndByte ? leftCp - rightEndByte : 1;
    }
    if (j < rightLen) {
        const rightCp = right.name.codePointAt(j)!;
        const leftEndByte = left.isDirectory ? 0x2f : -1;
        return leftEndByte !== rightCp ? leftEndByte - rightCp : -1;
    }
    return (left.isDirectory ? 1 : 0) - (right.isDirectory ? 1 : 0);
}

/**
 * Serializes ordered tree entries into the canonical binary tree payload.
 */
function serializeTreePayload(entries: readonly SerializedTreeEntry[]): Buffer {
    const chunks: Buffer[] = [];
    for (const entry of entries) {
        chunks.push(Buffer.from(`${entry.mode} ${entry.name}\0`, 'utf8'));
        chunks.push(Buffer.from(entry.oid, 'hex'));
    }
    return Buffer.concat(chunks);
}

/**
 * Recursively serializes one directory node into canonical Git tree objects.
 *
 * @returns Object id of the tree written for the supplied node.
 */
function writeCanonicalTree(gitDir: string, node: DirectoryNode): string {
    const entries: SerializedTreeEntry[] = [];
    for (const leaf of node.leaves.values()) {
        entries.push({ name: leaf.name, isDirectory: false, mode: leaf.mode, oid: leaf.oid });
    }
    for (const directory of node.directories.values()) {
        entries.push({
            name: directory.name,
            isDirectory: true,
            mode: CANONICAL_DIRECTORY_MODE,
            oid: writeCanonicalTree(gitDir, directory),
        });
    }
    entries.sort(compareCanonicalTreeEntries);
    return writeLooseObjectToDisk(gitDir, 'tree', serializeTreePayload(entries)).oid;
}

/**
 * Writes every staged leaf object and assembles the canonical root tree.
 *
 * @returns Object id of the root tree.
 */
function buildCanonicalTree(gitDir: string, files: readonly StagedFileEntry[]): string {
    const root = createDirectoryNode('');
    for (const file of files) {
        const segments = parseStagedPath(file.path);
        const mode = assertLeafMode(file.mode, file.path);
        const oid = writeStagedLeafObject(gitDir, file, mode);
        insertTreeLeaf(root, { segments, name: segments[segments.length - 1], mode, oid });
    }
    return writeCanonicalTree(gitDir, root);
}

/**
 * Validates one identity field so it cannot break the canonical commit header layout.
 */
function assertIdentityField(value: string, field: string): void {
    if (value.length === 0 || value.includes('<') || value.includes('>') || value.includes('\n')) {
        throw new Error(`Invalid ${field} '${value}'`);
    }
}

/**
 * Formats one Git signature line: `name <email> timestamp timezone`.
 */
function formatSignature(signature: GitSignature, role: string): string {
    assertIdentityField(signature.name, `${role} name`);
    assertIdentityField(signature.email, `${role} email`);
    if (!Number.isInteger(signature.timestampSec) || signature.timestampSec < 0) {
        throw new Error(`${role} timestamp must be a non-negative integer number of seconds`);
    }
    const tzOffset = signature.tzOffset ?? '+0000';
    if (!RE_TZ_OFFSET.test(tzOffset)) {
        throw new Error(`${role} timezone offset '${tzOffset}' must look like '+0000' or '-0700'`);
    }
    return `${signature.name} <${signature.email}> ${signature.timestampSec} ${tzOffset}`;
}

/**
 * Resolves the author and committer identities recorded in the commit header.
 *
 * Explicit signatures win (the differential parity harness depends on them); otherwise the
 * legacy `authorName`/`authorEmail` pair plus the current wall clock is used, and the committer
 * defaults to the resolved author exactly like Git does when both identities coincide.
 */
function resolveSignatures(req: MaterializeCommitRequest): ResolvedSignatures {
    const timestampSec = Math.floor(Date.now() / 1000);
    const author: GitSignature = req.authorSignature ?? {
        name: req.authorName,
        email: req.authorEmail,
        timestampSec,
    };
    return { author, committer: req.committerSignature ?? author };
}

interface CommitPayloadInput {
    readonly treeOid: string;
    readonly parentOids: readonly string[];
    readonly message: string;
    readonly agentMeta: FractalCommitMeta | undefined;
    readonly signatures: ResolvedSignatures;
}

/**
 * Assembles the canonical commit payload: object headers, one blank line, then the message.
 *
 * Git's header order (tree, every parent, author, committer) participates in the object identity.
 * The message section is appended verbatim; when agent metadata is present it follows after one
 * blank line as a `Praxis-Agent-Meta` trailer. The payload always ends with exactly one newline,
 * matching `git commit-tree` fed the same message bytes.
 */
function buildCommitPayload(input: CommitPayloadInput): Buffer {
    const headerLines = [`tree ${assertObjectId(input.treeOid, 'tree')}`];
    for (const parentOid of input.parentOids) {
        headerLines.push(`parent ${assertObjectId(parentOid, 'parent')}`);
    }
    headerLines.push(`author ${formatSignature(input.signatures.author, 'author')}`);
    headerLines.push(`committer ${formatSignature(input.signatures.committer, 'committer')}`);

    const trailer = input.agentMeta ? `\n\nPraxis-Agent-Meta: ${JSON.stringify(input.agentMeta)}` : '';
    const payloadText = `${headerLines.join('\n')}\n\n${input.message}${trailer}`;
    return Buffer.from(payloadText, 'utf8');
}

/**
 * Resolves the on-disk ref file path, refusing traversal outside the git directory.
 */
function resolveRefPath(gitDir: string, gitRef: string): string {
    const refPath = path.join(gitDir, gitRef);
    const relative = path.relative(gitDir, refPath);
    if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Invalid fractal ref '${gitRef}': must stay inside the git directory`);
    }
    return refPath;
}

/**
 * Atomically points one fractal ref at a freshly written commit object.
 */
function writeRefFile(gitDir: string, gitRef: string, commitOid: string): void {
    const refPath = resolveRefPath(gitDir, gitRef);
    fs.mkdirSync(path.dirname(refPath), { recursive: true });
    const tmpRef = nextTempFilePath(refPath);
    fs.writeFileSync(tmpRef, `${commitOid}\n`, 'utf8');
    fs.renameSync(tmpRef, refPath);
}

/**
 * Pure-TypeScript commit materializer: writes blobs, a recursive canonical tree, a canonical
 * commit object, and advances the target ref.
 */
export function materializeCommitPure(
    gitDir: string,
    req: MaterializeCommitRequest,
): MaterializeCommitResult {
    const startMs = Date.now();

    // 1. Write every leaf object and assemble the nested canonical tree.
    const treeOid = buildCanonicalTree(gitDir, req.files);

    // 2. Serialize the commit payload in git's canonical header order.
    const signatures = resolveSignatures(req);
    const commitPayload = buildCommitPayload({
        treeOid,
        parentOids: req.parentCommitOids,
        message: req.message,
        agentMeta: req.agentMeta,
        signatures,
    });
    const { oid: commitOid } = writeLooseObjectToDisk(gitDir, 'commit', commitPayload);

    // 3. Advance the fractal ref atomically.
    writeRefFile(gitDir, req.targetRef.gitRef, commitOid);

    return {
        commitOid,
        treeOid,
        targetRef: req.targetRef.gitRef,
        durationMs: Date.now() - startMs,
    };
}

/**
 * Options controlling physical worktree and ref removal during workspace reclamation.
 */
export interface ReclaimWorkspaceOptions {
    readonly targetRef: FractalRefDescriptor;
    readonly physicalDir?: string;
    readonly deleteRef?: boolean;
}

function assertSafeReclaimDirectory(physicalDir: string, gitDir: string): string {
    if (!physicalDir || physicalDir.trim().length === 0) {
        throw new Error('Invalid physicalDir: path must be non-empty');
    }
    const resolvedTarget = path.resolve(physicalDir);
    const parsedTarget = path.parse(resolvedTarget);
    if (resolvedTarget === parsedTarget.root) {
        throw new Error(`Refusing to delete filesystem root: ${resolvedTarget}`);
    }
    const resolvedGitDir = path.resolve(gitDir);
    const repoRoot = path.basename(resolvedGitDir) === '.git' ? path.dirname(resolvedGitDir) : resolvedGitDir;
    if (
        resolvedTarget === resolvedGitDir ||
        resolvedTarget === repoRoot ||
        resolvedGitDir.startsWith(resolvedTarget + path.sep)
    ) {
        throw new Error(`Refusing to delete repository root or ancestor: ${resolvedTarget}`);
    }
    return resolvedTarget;
}

/**
 * Pure-TS physical workspace reclamation engine.
 */
export function reclaimWorkspacePure(
    gitDir: string,
    workspaceId: string,
    options: ReclaimWorkspaceOptions,
): ReclamationSummary {
    const startMs = Date.now();
    let removed = false;

    if (options.physicalDir) {
        const safePhysicalDir = assertSafeReclaimDirectory(options.physicalDir, gitDir);
        if (fs.existsSync(safePhysicalDir)) {
            fs.rmSync(safePhysicalDir, { recursive: true, force: true });
            removed = true;
        }
    }

    if (options.deleteRef) {
        const refPath = resolveRefPath(gitDir, options.targetRef.gitRef);
        if (fs.existsSync(refPath)) {
            fs.unlinkSync(refPath);
        }
    }

    return {
        workspaceId,
        targetRef: options.targetRef.gitRef,
        physicalPathRemoved: removed,
        durationMs: Date.now() - startMs,
    };
}
