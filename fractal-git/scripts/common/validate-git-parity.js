/**
 * Module: Fractal Git — Git Plumbing Specification & Byte Parity Validator
 * File Path: fractal-git/scripts/common/validate-git-parity.js
 * Architecture Role: Proves that Fractal Git's object framing, canonical tree ordering, and SHA-1
 *   computation match the system Git binary, using Git itself as the reference baseline rather than a second
 *   hand-written expectation.
 * Dependencies & Triggers: Node.js standard library plus the system git binary; invoked by
 *   scripts/ps1/audit-taxis.ps1, npm run gate:parity, and the CI fractal-git job.
 * Responsibilities:
 *   1. Encode blob, tree, commit, and tag objects with the canonical Git byte layout.
 *   2. Build the same objects through git hash-object / git mktree / git commit-tree / git mktag
 *      and compare object ids for every vector.
 *   3. Compare canonical tree entry order with git ls-tree, covering mixed case, non-ASCII names,
 *      directory trailing-slash ordering, and mode-specific framing.
 *   4. Exit non-zero on any divergence; refuse to claim equivalence when the reference baseline is absent and
 *      the caller demanded it with --require-git.
 * Exit Semantics & Design Rationale: Exits 0 only after every vector matched the system git baseline. A missing
 *   git binary is reported explicitly instead of being silently treated as parity, because the
 *   earlier implementation printed an equivalence claim while comparing nothing.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const NUL = String.fromCharCode(0);
const MAX_REPORTED_VIOLATIONS = 40;
const REQUIRE_GIT = process.argv.includes('--require-git');

/**
 * Computes the lowercase hexadecimal SHA-1 of a byte buffer.
 *
 * @param {Buffer} buffer - Bytes to hash.
 * @returns {string} 40-character lowercase hexadecimal digest.
 */
function sha1Hex(buffer) {
    return crypto.createHash('sha1').update(buffer).digest('hex');
}

/**
 * Builds the canonical Git loose-object header: "<kind> <size>NUL".
 *
 * @param {string} kind - Object kind, one of blob, tree, commit, tag.
 * @param {number} size - Payload byte length.
 * @returns {Buffer} Header bytes.
 */
function objectHeader(kind, size) {
    return Buffer.from(kind + ' ' + size + NUL, 'utf8');
}

/**
 * Computes the object id of a framed Git object.
 *
 * @param {string} kind - Object kind.
 * @param {Buffer} payload - Object payload without the header.
 * @returns {string} 40-character lowercase hexadecimal object id.
 */
function computeObjectOid(kind, payload) {
    return sha1Hex(Buffer.concat([objectHeader(kind, payload.length), payload]));
}

/**
 * Computes the canonical blob object id for a payload.
 *
 * @param {Buffer} payload - Raw blob bytes.
 * @returns {string} 40-character lowercase hexadecimal object id.
 */
function computeBlobOid(payload) {
    return computeObjectOid('blob', payload);
}

/**
 * Normalizes the textual Git file mode to its canonical form.
 *
 * Git prints a tree mode as "40000"; callers and fixtures may spell it "040000". Both denote the
 * same entry, and the serialized bytes must carry the canonical spelling.
 *
 * @param {string|number} mode - Mode as text or number.
 * @returns {string} Canonical mode text.
 */
function normalizeMode(mode) {
    const text = String(mode);
    return text === '040000' ? '40000' : text;
}

/**
 * Reports whether a canonicalized mode names a directory.
 *
 * @param {string|number} mode - Entry mode.
 * @returns {boolean} True for tree entries.
 */
function isTreeMode(mode) {
    return normalizeMode(mode) === '40000';
}

/**
 * Produces the comparison key Git uses for tree entries.
 *
 * Directory names take part in ordering as if a slash were appended, so "foo" the directory sorts
 * after "foo.c" while "foo-bar" sorts first. Byte order, not locale order, decides the result.
 *
 * @param {{ name: string, mode: string|number }} entry - Tree entry.
 * @returns {Buffer} UTF-8 comparison key.
 */
function comparisonKey(entry) {
    return Buffer.from(entry.name + (isTreeMode(entry.mode) ? '/' : ''), 'utf8');
}

/**
 * Compares two tree entries with Git's canonical byte ordering.
 *
 * @param {{ name: string, mode: string|number }} left - Left entry.
 * @param {{ name: string, mode: string|number }} right - Right entry.
 * @returns {number} Negative, zero, or positive per Buffer.compare.
 */
function compareTreeEntries(left, right) {
    return Buffer.compare(comparisonKey(left), comparisonKey(right));
}

/**
 * Serializes tree entries in canonical order.
 *
 * Each record is "<mode> <name>NUL<20-byte-object-id>". The directory trailing-slash rule applies
 * to ordering only; the stored name never contains the slash.
 *
 * @param {Array<{ name: string, mode: string|number, oid: string }>} entries - Unsorted entries.
 * @returns {{ payload: Buffer, entries: Array<object> }} Payload and canonical order.
 */
function encodeTree(entries) {
    const ordered = entries.slice().sort(compareTreeEntries);
    const chunks = ordered.map((entry) => {
        const oidBytes = Buffer.from(entry.oid, 'hex');
        if (oidBytes.length !== 20) {
            throw new Error('tree entry ' + entry.name + ' carries a non-20-byte object id');
        }
        return Buffer.concat([
            Buffer.from(normalizeMode(entry.mode) + ' ' + entry.name + NUL, 'utf8'),
            oidBytes,
        ]);
    });
    return { payload: Buffer.concat(chunks), entries: ordered };
}

/**
 * Renders one identity line exactly as Git stores it in commit and tag objects.
 *
 * @param {{ name: string, email: string, timestamp: number, tz: string }} identity - Signature.
 * @returns {string} "<name> <email> <timestamp> <tz>".
 */
function identityLine(identity) {
    return identity.name + ' <' + identity.email + '> ' + identity.timestamp + ' ' + identity.tz;
}

/**
 * Serializes a commit payload.
 *
 * The message is copied verbatim; Git does not append a newline when a caller supplies a message
 * through stdin, so adding one here would change the object id.
 *
 * @param {object} fields - tree, parents, author, committer, message.
 * @returns {Buffer} Commit payload.
 */
function encodeCommit(fields) {
    const header = [];
    header.push('tree ' + fields.tree);
    (fields.parents || []).forEach((parent) => header.push('parent ' + parent));
    header.push('author ' + identityLine(fields.author));
    header.push('committer ' + identityLine(fields.committer));
    return Buffer.concat([
        Buffer.from(header.join('\n') + '\n\n', 'utf8'),
        Buffer.from(fields.message, 'utf8'),
    ]);
}

/**
 * Serializes an annotated tag payload.
 *
 * @param {object} fields - object, kind, tag, tagger, message.
 * @returns {Buffer} Tag payload.
 */
function encodeTag(fields) {
    const header = ['object ' + fields.object, 'type ' + fields.kind, 'tag ' + fields.tag];
    if (fields.tagger) {
        header.push('tagger ' + identityLine(fields.tagger));
    }
    return Buffer.concat([
        Buffer.from(header.join('\n') + '\n\n', 'utf8'),
        Buffer.from(fields.message, 'utf8'),
    ]);
}

/**
 * Detects whether the system git binary can be executed.
 *
 * @returns {boolean} True when git responds to --version.
 */
function isGitAvailable() {
    try {
        execFileSync('git', ['--version'], { stdio: 'ignore' });
        return true;
    } catch (_error) {
        return false;
    }
}

/**
 * Runs one git command against an isolated object database.
 *
 * @param {string} gitDir - Temporary git directory.
 * @param {Array<string>} args - Arguments after the git-dir switch.
 * @param {Buffer|undefined} input - Optional stdin bytes.
 * @param {object|undefined} env - Extra environment entries.
 * @returns {Buffer} Standard output bytes.
 */
function runGit(gitDir, args, input, env) {
    const options = {
        env: Object.assign({}, process.env, env || {}),
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    };
    if (input !== undefined) {
        options.input = input;
    }
    return execFileSync('git', ['--git-dir', gitDir].concat(args), options);
}

/**
 * Creates an isolated object database for reference baseline validation calls.
 *
 * @returns {{ gitDir: string, dispose: Function }} Baseline environment.
 */
function createBaselineRepository() {
    const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractal-git-parity-'));
    execFileSync('git', ['init', '--quiet', '--bare', gitDir], { stdio: 'ignore' });
    return {
        gitDir,
        dispose() {
            fs.rmSync(gitDir, { recursive: true, force: true });
        },
    };
}

/**
 * Writes a blob with git hash-object and returns its id.
 *
 * @param {string} gitDir - Baseline git directory.
 * @param {Buffer} payload - Blob bytes.
 * @returns {string} Object id assigned by git.
 */
function gitWriteBlob(gitDir, payload) {
    return runGit(gitDir, ['hash-object', '-w', '--stdin'], payload).toString('utf8').trim();
}

/**
 * Maps an entry mode to the object type mktree expects.
 *
 * @param {string|number} mode - Entry mode.
 * @returns {string} blob, tree, or commit.
 */
function objectTypeForMode(mode) {
    if (isTreeMode(mode)) {
        return 'tree';
    }
    return normalizeMode(mode) === '160000' ? 'commit' : 'blob';
}

/**
 * Writes a tree with git mktree and returns its id.
 *
 * @param {string} gitDir - Baseline git directory.
 * @param {Array<{ name: string, mode: string|number, oid: string }>} entries - Unsorted entries.
 * @returns {string} Tree object id assigned by git.
 */
function gitWriteTree(gitDir, entries) {
    const lines = entries.map((entry) => normalizeMode(entry.mode) + ' ' +
        objectTypeForMode(entry.mode) + ' ' + entry.oid + '\t' + entry.name + '\n');
    return runGit(gitDir, ['mktree'], Buffer.from(lines.join(''), 'utf8')).toString('utf8').trim();
}

/**
 * Creates a commit through git commit-tree with a fixed identity.
 *
 * @param {string} gitDir - Baseline git directory.
 * @param {object} fields - tree, parents, author, committer, message.
 * @returns {string} Commit object id assigned by git.
 */
function gitWriteCommit(gitDir, fields) {
    const args = ['commit-tree', fields.tree];
    (fields.parents || []).forEach((parent) => {
        args.push('-p', parent);
    });
    const env = {
        GIT_AUTHOR_NAME: fields.author.name,
        GIT_AUTHOR_EMAIL: fields.author.email,
        GIT_AUTHOR_DATE: fields.author.timestamp + ' ' + fields.author.tz,
        GIT_COMMITTER_NAME: fields.committer.name,
        GIT_COMMITTER_EMAIL: fields.committer.email,
        GIT_COMMITTER_DATE: fields.committer.timestamp + ' ' + fields.committer.tz,
    };
    return runGit(gitDir, args, Buffer.from(fields.message, 'utf8'), env).toString('utf8').trim();
}

/**
 * Writes an annotated tag with git mktag and returns its id.
 *
 * @param {string} gitDir - Baseline git directory.
 * @param {object} fields - object, kind, tag, tagger, message.
 * @returns {string} Tag object id assigned by git.
 */
function gitWriteTag(gitDir, fields) {
    return runGit(gitDir, ['mktag'], encodeTag(fields)).toString('utf8').trim();
}

/**
 * Lists tree entries in the order git stores them.
 *
 * @param {string} gitDir - Baseline git directory.
 * @param {string} treeOid - Tree object id.
 * @returns {Array<string>} Entry names in canonical order.
 */
function gitListTreeNames(gitDir, treeOid) {
    const output = runGit(gitDir, ['-c', 'core.quotepath=false', 'ls-tree', treeOid]).toString('utf8');
    return output.split('\n').filter((line) => line.length > 0).map((line) => {
        const tab = line.indexOf('\t');
        return line.slice(tab + 1);
    });
}

/**
 * Builds blob vectors: empty, text, binary, non-ASCII, control characters, and large payloads.
 *
 * @returns {Array<{ label: string, payload: Buffer }>} Blob vectors.
 */
function blobVectors() {
    const longLine = Buffer.from('a'.repeat(4096) + '\n', 'utf8');
    return [
        { label: 'empty blob', payload: Buffer.alloc(0) },
        { label: 'plain text with newline', payload: Buffer.from('hello world\n', 'utf8') },
        { label: 'plain text without newline', payload: Buffer.from('hello world', 'utf8') },
        { label: 'binary payload', payload: Buffer.from([0x00, 0xff, 0xfe, 0x01, 0x7f]) },
        { label: 'carriage return line feed', payload: Buffer.from('line\r\nline\r\n', 'utf8') },
        { label: 'tab separated columns', payload: Buffer.from('a\tb\tc\n', 'utf8') },
        { label: 'latin accented text', payload: Buffer.from('École très fréquentée\n', 'utf8') },
        { label: 'emoji text', payload: Buffer.from('阶段完成 🚀\n', 'utf8') },
        { label: 'invalid utf-8 bytes', payload: Buffer.from([0xff, 0xfe, 0x80, 0x81]) },
        { label: 'single newline', payload: Buffer.from('\n', 'utf8') },
        { label: 'four kilobyte line', payload: longLine },
        { label: 'all zero bytes', payload: Buffer.alloc(256, 0) },
        { label: 'embedded nul byte', payload: Buffer.from([0x61, 0x00, 0x62]) },
        { label: 'repeated deterministic noise', payload: Buffer.from(Array.from({ length: 512 }, (_v, i) => (i * 37) % 256)) },
    ];
}

/**
 * Returns nested tree fixtures used by both the encoder and the reference baseline.
 *
 * @returns {Array<{ label: string, spec: Array<object> }>} Tree fixtures.
 */
function treeVectors() {
    return [
        { label: 'empty tree', spec: [] },
        { label: 'single regular file', spec: [{ name: 'a.txt', mode: '100644', content: 'a\n' }] },
        {
            label: 'mixed case names',
            spec: [
                { name: 'Zebra.txt', mode: '100644', content: 'z\n' },
                { name: 'apple.txt', mode: '100644', content: 'a\n' },
            ],
        },
        {
            label: 'latin accented names',
            spec: [
                { name: 'École.txt', mode: '100644', content: 'e\n' },
                { name: 'ecole.txt', mode: '100644', content: 'e\n' },
            ],
        },
        {
            label: 'same prefix file and directory',
            spec: [
                { name: 'foo', mode: '40000', children: [{ name: 'inside.txt', mode: '100644', content: 'i\n' }] },
                { name: 'foo-bar', mode: '100644', content: 'd\n' },
                { name: 'foo.c', mode: '100644', content: 'c\n' },
            ],
        },
        {
            label: 'executable and symlink modes',
            spec: [
                { name: 'run.sh', mode: '100755', content: '#!/bin/sh\n' },
                { name: 'link', mode: '120000', content: 'target.txt' },
            ],
        },
        { label: 'space inside name', spec: [{ name: 'with space.txt', mode: '100644', content: 's\n' }] },
        {
            label: 'nested directories',
            spec: [{
                name: 'src',
                mode: '40000',
                children: [{
                    name: 'core',
                    mode: '40000',
                    children: [{ name: 'main.rs', mode: '100644', content: 'fn main() {}\n' }],
                }],
            }],
        },
        {
            label: 'directory name and dotted file',
            spec: [
                { name: 'docs', mode: '40000', children: [{ name: 'readme.md', mode: '100644', content: '# docs\n' }] },
                { name: 'docs.md', mode: '100644', content: '# file\n' },
            ],
        },
        {
            label: 'gitlink entry',
            spec: [{ name: 'vendor', mode: '160000', oid: '1234567890123456789012345678901234567890' }],
        },
        {
            label: 'many entries across categories',
            spec: [
                { name: 'A.txt', mode: '100644', content: 'upper\n' },
                { name: '_under.txt', mode: '100644', content: 'under\n' },
                { name: 'a.txt', mode: '100644', content: 'lower\n' },
                { name: 'b-dash.txt', mode: '100644', content: 'dash\n' },
                { name: 'b.dot.txt', mode: '100644', content: 'dot\n' },
                { name: 'b', mode: '40000', children: [{ name: 'child.txt', mode: '100644', content: 'child\n' }] },
                { name: '阶段.md', mode: '100644', content: '阶段\n' },
            ],
        },
        {
            label: 'deep tree with directories at two levels',
            spec: [{
                name: 'packages',
                mode: '40000',
                children: [
                    { name: 'alpha', mode: '40000', children: [{ name: 'index.ts', mode: '100644', content: 'export {};\n' }] },
                    { name: 'beta', mode: '40000', children: [{ name: 'index.ts', mode: '100644', content: 'export {};\n' }] },
                ],
            }],
        },
    ];
}

/**
 * Creates a fixed signature for baseline validation calls.
 *
 * @param {string} name - Person name.
 * @param {string} tz - Time zone offset text.
 * @param {number} timestamp - Seconds since the epoch.
 * @returns {{ name: string, email: string, timestamp: number, tz: string }} Signature.
 */
function signature(name, tz, timestamp) {
    return { name, email: 'parity@example.com', timestamp, tz };
}

/**
 * Builds commit vectors that vary parent count, message shape, and time zone.
 *
 * @param {string} treeOid - Tree object id to embed.
 * @param {Array<string>} parentOids - Parent object ids available for octopus commits.
 * @returns {Array<object>} Commit fixtures with expected fields.
 */
function commitVectors(treeOid, parentOids) {
    const author = signature('Parity Author', '+0800', 1700000000);
    const committer = signature('Parity Committer', '+0800', 1700000000);
    const variants = [
        { label: 'root commit without parents', parents: [], message: 'initial commit\n' },
        { label: 'single parent merge-free commit', parents: [parentOids[0]], message: 'second commit\n' },
        { label: 'two parent merge commit', parents: [parentOids[0], parentOids[1]], message: 'Merge branch \'feature/x\'\n' },
        { label: 'three parent octopus commit', parents: [parentOids[0], parentOids[1], parentOids[2]], message: 'octopus\n' },
        { label: 'message without trailing newline', parents: [], message: 'no newline at end' },
        { label: 'multi line message', parents: [], message: 'subject line\n\nbody paragraph one\nbody paragraph two\n' },
        { label: 'leading blank line in message', parents: [], message: '\nmessage after blank line\n' },
        { label: 'non ascii message', parents: [], message: '阶段交付完成 🚀\n' },
        { label: 'tab inside message', parents: [], message: 'col1\tcol2\n' },
        { label: 'carriage return inside message', parents: [], message: 'line one\r\nline two\n' },
    ];
    const zones = ['-0500', '+0000', '+0530'];
    const zoned = zones.map((tz, index) => ({
        label: 'time zone ' + tz + ' commit',
        parents: [],
        message: 'zone variant ' + String(index) + '\n',
        author: signature('Parity Author', tz, 1700000000 + index),
        committer: signature('Parity Committer', tz, 1700000000 + index),
    }));
    const all = variants.concat(zoned);
    return all.map((vector) => Object.assign({
        tree: treeOid,
        author,
        committer,
    }, vector));
}

/**
 * Builds annotated tag vectors for every target kind plus tagger-presence variants.
 *
 * @param {object} targets - blob, tree, commit, and tag ids.
 * @returns {Array<object>} Tag fixtures.
 */
function tagVectors(targets) {
    const tagger = signature('Parity Tagger', '+0800', 1700000000);
    const messages = ['tag message\n', 'tag message without newline', '阶段标签\n', 'multi line\ntag body\n'];
    const kinds = [
        { kind: 'commit', object: targets.commit },
        { kind: 'tree', object: targets.tree },
        { kind: 'blob', object: targets.blob },
        { kind: 'tag', object: targets.tag },
    ];
    const vectors = [];
    kinds.forEach((entry, kindIndex) => {
        messages.forEach((message, messageIndex) => {
            vectors.push({
                label: 'tag over ' + entry.kind + ' message ' + String(messageIndex),
                object: entry.object,
                kind: entry.kind,
                tag: 'v0.' + String(kindIndex) + '.' + String(messageIndex),
                tagger,
                message,
            });
        });
    });
    vectors.push({
        label: 'tag with alternate time zone',
        object: targets.commit,
        kind: 'commit',
        tag: 'zoned-tag',
        tagger: signature('Parity Tagger', '-0800', 1700000200),
        message: 'zoned tag message\n',
    });
    return vectors;
}

/**
 * Records a divergence in the shared report.
 *
 * @param {Array<string>} violations - Collected violation messages.
 * @param {string} message - Human readable divergence.
 * @returns {void}
 */
function reportViolation(violations, message) {
    violations.push(message);
}

/**
 * Builds a nested tree with the JavaScript encoder and compares it with git at every level.
 *
 * @param {string} gitDir - Baseline git directory.
 * @param {Array<object>} spec - Tree specification.
 * @param {string} label - Fixture label for diagnostics.
 * @param {Array<string>} violations - Collected violations.
 * @returns {{ oid: string, payload: Buffer }} JavaScript-encoded tree.
 */
function verifyTreeSpec(gitDir, spec, label, violations) {
    const entries = [];
    spec.forEach((node) => {
        if (Array.isArray(node.children)) {
            const child = verifyTreeSpec(gitDir, node.children, label + '/' + node.name, violations);
            entries.push({ name: node.name, mode: '40000', oid: child.oid });
            return;
        }
        if (normalizeMode(node.mode) === '160000') {
            entries.push({ name: node.name, mode: '160000', oid: node.oid });
            return;
        }
        const payload = Buffer.from(node.content, 'utf8');
        const oid = gitWriteBlob(gitDir, payload);
        entries.push({ name: node.name, mode: node.mode, oid });
    });

    const encoded = encodeTree(entries);
    const javascriptOid = computeObjectOid('tree', encoded.payload);
    const gitOid = gitWriteTree(gitDir, entries);
    if (javascriptOid !== gitOid) {
        reportViolation(violations, 'FGT-OBJ-001 tree parity failure on ' + label + ': git ' +
            gitOid + ', engine ' + javascriptOid);
    }
    const gitOrder = gitListTreeNames(gitDir, gitOid);
    const engineOrder = encoded.entries.map((entry) => entry.name);
    if (gitOrder.join('\n') !== engineOrder.join('\n')) {
        reportViolation(violations, 'FGT-OBJ-001 tree ordering failure on ' + label +
            ': git [' + gitOrder.join(', ') + '], engine [' + engineOrder.join(', ') + ']');
    }
    return { oid: javascriptOid, payload: encoded.payload };
}

/**
 * Verifies blob vectors against git hash-object.
 *
 * @param {string} gitDir - Baseline git directory.
 * @param {Array<string>} violations - Collected violations.
 * @returns {number} Number of verified vectors.
 */
function verifyBlobVectors(gitDir, violations) {
    blobVectors().forEach((vector) => {
        const engineOid = computeBlobOid(vector.payload);
        const gitOid = gitWriteBlob(gitDir, vector.payload);
        if (engineOid !== gitOid) {
            reportViolation(violations, 'FGT-OBJ-001 blob parity failure on ' + vector.label +
                ': git ' + gitOid + ', engine ' + engineOid);
        }
    });
    return blobVectors().length;
}

/**
 * Verifies tree vectors, including nested levels and canonical ordering.
 *
 * @param {string} gitDir - Baseline git directory.
 * @param {Array<string>} violations - Collected violations.
 * @returns {{ count: number, firstTreeOid: string }} Vector count and a reusable tree id.
 */
function verifyTreeVectors(gitDir, violations) {
    const vectors = treeVectors();
    let firstTreeOid = '';
    vectors.forEach((vector) => {
        const tree = verifyTreeSpec(gitDir, vector.spec, vector.label, violations);
        if (firstTreeOid.length === 0) {
            firstTreeOid = tree.oid;
        }
    });
    return { count: vectors.length, firstTreeOid };
}

/**
 * Verifies commit vectors against git commit-tree.
 *
 * @param {string} gitDir - Baseline git directory.
 * @param {string} treeOid - Tree object id usable by every commit vector.
 * @param {Array<string>} parentOids - Parent commit ids.
 * @param {Array<string>} violations - Collected violations.
 * @returns {number} Number of verified vectors.
 */
function verifyCommitVectors(gitDir, treeOid, parentOids, violations) {
    const vectors = commitVectors(treeOid, parentOids);
    vectors.forEach((fields) => {
        const engineOid = computeObjectOid('commit', encodeCommit(fields));
        const gitOid = gitWriteCommit(gitDir, fields);
        if (engineOid !== gitOid) {
            reportViolation(violations, 'FGT-OBJ-001 commit parity failure on ' + fields.label +
                ': git ' + gitOid + ', engine ' + engineOid);
        }
    });
    return vectors.length;
}

/**
 * Verifies annotated tag vectors against git mktag.
 *
 * @param {string} gitDir - Baseline git directory.
 * @param {object} targets - Object ids available as tag targets.
 * @param {Array<string>} violations - Collected violations.
 * @returns {number} Number of verified vectors.
 */
function verifyTagVectors(gitDir, targets, violations) {
    const vectors = tagVectors(targets);
    let firstTagOid = '';
    vectors.forEach((fields) => {
        const engineOid = computeObjectOid('tag', encodeTag(fields));
        const gitOid = gitWriteTag(gitDir, fields);
        if (engineOid !== gitOid) {
            reportViolation(violations, 'FGT-OBJ-001 tag parity failure on ' + fields.label +
                ': git ' + gitOid + ', engine ' + engineOid);
        }
        if (firstTagOid.length === 0) {
            firstTagOid = gitOid;
        }
    });
    // A tag targeting a tag proves the nested type header too.
    if (firstTagOid.length > 0) {
        const nested = {
            object: firstTagOid,
            kind: 'tag',
            tag: 'nested-tag',
            tagger: signature('Parity Tagger', '+0000', 1700000100),
            message: 'nested tag message\n',
        };
        const engineOid = computeObjectOid('tag', encodeTag(nested));
        const gitOid = gitWriteTag(gitDir, nested);
        if (engineOid !== gitOid) {
            reportViolation(violations, 'FGT-OBJ-001 tag-of-tag parity failure: git ' + gitOid +
                ', engine ' + engineOid);
        }
    }
    return vectors.length + 1;
}

/**
 * Writes the required parent commits and returns their ids.
 *
 * @param {string} gitDir - Baseline git directory.
 * @param {string} treeOid - Tree object id.
 * @param {number} count - Number of parents to create.
 * @returns {Array<string>} Parent commit ids.
 */
function bootstrapParentCommits(gitDir, treeOid, count) {
    const parents = [];
    for (let index = 0; index < count; index += 1) {
        const fields = {
            tree: treeOid,
            parents: [],
            author: signature('Parity Parent', '+0000', 1600000000 + index),
            committer: signature('Parity Parent', '+0000', 1600000000 + index),
            message: 'parent ' + String(index) + '\n',
        };
        parents.push(gitWriteCommit(gitDir, fields));
    }
    return parents;
}

/**
 * Runs the complete parity matrix and reports the verdict.
 *
 * @returns {void}
 */
function runGitParityValidation() {
    console.log('=== [FGT-OBJ-001] Git object parity versus the system git baseline ===');
    const gitAvailable = isGitAvailable();
    if (!gitAvailable) {
        console.log('SKIP: system git binary is unavailable; no byte parity claim is made.');
        if (REQUIRE_GIT) {
            console.error('BLOCK: --require-git was requested but git could not be executed.');
            process.exit(1);
        }
        process.exit(0);
    }

    const baseline = createBaselineRepository();
    const violations = [];
    let verified = 0;
    try {
        verified += verifyBlobVectors(baseline.gitDir, violations);
        const treeResult = verifyTreeVectors(baseline.gitDir, violations);
        verified += treeResult.count;
        const parents = bootstrapParentCommits(baseline.gitDir, treeResult.firstTreeOid, 3);
        verified += verifyCommitVectors(baseline.gitDir, treeResult.firstTreeOid, parents, violations);
        const blobOid = gitWriteBlob(baseline.gitDir, Buffer.from('tag target\n', 'utf8'));
        const targets = {
            blob: blobOid,
            tree: treeResult.firstTreeOid,
            commit: parents[0],
            tag: gitWriteTag(baseline.gitDir, {
                object: parents[0],
                kind: 'commit',
                tag: 'bootstrap',
                tagger: signature('Parity Tagger', '+0000', 1700000000),
                message: 'bootstrap tag\n',
            }),
        };
        verified += verifyTagVectors(baseline.gitDir, targets, violations);
        const version = execFileSync('git', ['--version'], { stdio: 'pipe' }).toString('utf8').trim();
        console.log('Git Baseline: ' + version);
        console.log('Verified vectors against the reference baseline: ' + String(verified));
    } catch (error) {
        reportViolation(violations, 'FGT-OBJ-001 reference baseline execution failed: ' + error.message);
    } finally {
        baseline.dispose();
    }

    if (violations.length > 0) {
        console.error('BLOCK: ' + String(violations.length) + ' git plumbing parity violation(s):');
        violations.slice(0, MAX_REPORTED_VIOLATIONS).forEach((violation) => {
            console.error('  - ' + violation);
        });
        process.exit(1);
    }
    console.log('PASS: every blob, tree, commit, and tag vector matched the system git baseline.');
    process.exit(0);
}

runGitParityValidation();
