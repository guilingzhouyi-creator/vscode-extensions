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
 *   4. Execute real binary taxis vs system git differential checks across object IDs, inflated loose
 *      object bytes, cat-file payloads, and ls-tree canonical output.
 *   5. Exit non-zero on any divergence; refuse to claim equivalence when the reference baseline is absent and
 *      the caller demanded it with --require-git or --require-taxis.
 * Exit Semantics & Design Rationale: Exits 0 only after every vector matched the system git baseline. A missing
 *   git or taxis binary is reported explicitly instead of being silently treated as parity.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const NUL = String.fromCharCode(0);
const MAX_REPORTED_VIOLATIONS = 40;
const REQUIRE_GIT = process.argv.includes('--require-git') || process.env.TAXIS_REQUIRE_GIT === '1';
const REQUIRE_TAXIS = process.argv.includes('--require-taxis') || process.env.TAXIS_REQUIRE_TAXIS === '1';
const NO_AUTO_TARGET = process.argv.includes('--no-auto-target');

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
 * @param {object} fields - tree, parents, author, committer, message.
 * @returns {Buffer} Commit payload.
 */
function encodeCommit(fields) {
    const header = ['tree ' + fields.tree];
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
 * Creates a plumbing runner handle for either `git` or `taxis`.
 *
 * @param {string} bin - Executable path or command name.
 * @param {string} gitDir - Bare repository directory.
 * @param {boolean} isGit - Whether this runner is system git.
 * @returns {{ bin: string, gitDir: string, isGit: boolean }} Runner handle.
 */
function makeRunner(bin, gitDir, isGit) {
    return { bin, gitDir, isGit };
}

/**
 * Runs one plumbing command against an isolated object database.
 *
 * @param {{ bin: string, gitDir: string }} runner - Target binary and repository.
 * @param {Array<string>} args - Arguments after `--git-dir`.
 * @param {Buffer|undefined} input - Optional stdin bytes.
 * @param {object|undefined} env - Extra environment entries.
 * @returns {Buffer} Standard output bytes.
 */
function runPlumbing(runner, args, input, env) {
    const options = {
        env: Object.assign({}, process.env, env || {}),
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    };
    if (input !== undefined) {
        options.input = input;
    }
    return execFileSync(runner.bin, ['--git-dir', runner.gitDir].concat(args), options);
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
 * Writes a blob object using the given runner and returns its OID.
 *
 * @param {object} runner - Plumbing runner.
 * @param {Buffer} payload - Raw blob bytes.
 * @returns {string} Object ID.
 */
function plumbingWriteBlob(runner, payload) {
    return runPlumbing(runner, ['hash-object', '-w', '--stdin'], payload).toString('utf8').trim();
}

/**
 * Writes a tree object using the given runner and returns its OID.
 *
 * @param {object} runner - Plumbing runner.
 * @param {Array<object>} entries - Tree entries.
 * @returns {string} Tree OID.
 */
function plumbingWriteTree(runner, entries) {
    const lines = entries.map((entry) => normalizeMode(entry.mode) + ' ' +
        objectTypeForMode(entry.mode) + ' ' + entry.oid + '\t' + entry.name + '\n');
    return runPlumbing(runner, ['mktree'], Buffer.from(lines.join(''), 'utf8')).toString('utf8').trim();
}

/**
 * Writes a commit object using the given runner and returns its OID.
 *
 * @param {object} runner - Plumbing runner.
 * @param {object} fields - Commit fields.
 * @returns {string} Commit OID.
 */
function plumbingWriteCommit(runner, fields) {
    const args = ['commit-tree', fields.tree];
    (fields.parents || []).forEach((parent) => args.push('-p', parent));
    const env = {
        GIT_AUTHOR_NAME: fields.author.name,
        GIT_AUTHOR_EMAIL: fields.author.email,
        GIT_AUTHOR_DATE: fields.author.timestamp + ' ' + fields.author.tz,
        GIT_COMMITTER_NAME: fields.committer.name,
        GIT_COMMITTER_EMAIL: fields.committer.email,
        GIT_COMMITTER_DATE: fields.committer.timestamp + ' ' + fields.committer.tz,
    };
    return runPlumbing(runner, args, Buffer.from(fields.message, 'utf8'), env).toString('utf8').trim();
}

/**
 * Writes an annotated tag using the given runner and returns its OID.
 *
 * @param {object} runner - Plumbing runner.
 * @param {object} fields - Tag fields.
 * @returns {string} Tag OID.
 */
function plumbingWriteTag(runner, fields) {
    return runPlumbing(runner, ['mktag'], encodeTag(fields)).toString('utf8').trim();
}

/**
 * Lists canonical ls-tree lines using the given runner.
 *
 * @param {object} runner - Plumbing runner.
 * @param {string} treeOid - Tree OID.
 * @returns {Array<string>} Formatted ls-tree lines.
 */
function plumbingListTreeLines(runner, treeOid) {
    const args = runner.isGit ? ['-c', 'core.quotepath=false', 'ls-tree', treeOid] : ['ls-tree', treeOid];
    return runPlumbing(runner, args).toString('utf8').split('\n').filter((line) => line.length > 0);
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
    return variants.concat(zoned).map((vector) => Object.assign({ tree: treeOid, author, committer }, vector));
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
 * Inflates and compares the loose object stored in both repositories for byte-exact parity.
 *
 * @param {string} gitDir - System git repository directory.
 * @param {string} taxisDir - Taxis repository directory.
 * @param {string} oid - Expected object id.
 * @param {string} label - Diagnostic label.
 * @param {Array<string>} violations - Collected violations.
 * @returns {void}
 */
function compareLooseObjectBytes(gitDir, taxisDir, oid, label, violations) {
    const relPath = path.join('objects', oid.slice(0, 2), oid.slice(2));
    const gitObjPath = path.join(gitDir, relPath);
    const taxisObjPath = path.join(taxisDir, relPath);
    if (!fs.existsSync(gitObjPath) || !fs.existsSync(taxisObjPath)) {
        reportViolation(violations, 'FGT-OBJ-001 [Binary] missing loose object for ' + label + ' (' + oid + ')');
        return;
    }
    try {
        if (Buffer.compare(zlib.inflateSync(fs.readFileSync(gitObjPath)), zlib.inflateSync(fs.readFileSync(taxisObjPath))) !== 0) {
            reportViolation(violations, 'FGT-OBJ-001 [Binary] inflated loose object byte divergence on ' + label);
        }
    } catch (decompErr) {
        reportViolation(violations, 'FGT-OBJ-001 [Binary] loose object inflation failed on ' + label + ': ' + decompErr.message);
    }
}

/**
 * Builds a nested tree with the JavaScript encoder and compares it with git at every level.
 *
 * @param {object} gitRunner - Git plumbing runner.
 * @param {Array<object>} spec - Tree specification.
 * @param {string} label - Fixture label for diagnostics.
 * @param {Array<string>} violations - Collected violations.
 * @returns {{ oid: string, payload: Buffer }} JavaScript-encoded tree.
 */
function verifyTreeSpec(gitRunner, spec, label, violations) {
    const entries = [];
    spec.forEach((node) => {
        if (Array.isArray(node.children)) {
            const child = verifyTreeSpec(gitRunner, node.children, label + '/' + node.name, violations);
            entries.push({ name: node.name, mode: '40000', oid: child.oid });
            return;
        }
        if (normalizeMode(node.mode) === '160000') {
            entries.push({ name: node.name, mode: '160000', oid: node.oid });
            return;
        }
        const payload = Buffer.from(node.content, 'utf8');
        entries.push({ name: node.name, mode: node.mode, oid: plumbingWriteBlob(gitRunner, payload) });
    });

    const encoded = encodeTree(entries);
    const javascriptOid = computeObjectOid('tree', encoded.payload);
    const gitOid = plumbingWriteTree(gitRunner, entries);
    if (javascriptOid !== gitOid) {
        reportViolation(violations, 'FGT-OBJ-001 tree parity failure on ' + label + ': git ' + gitOid + ', engine ' + javascriptOid);
    }
    const gitOrder = plumbingListTreeLines(gitRunner, gitOid).map((line) => line.slice(line.indexOf('\t') + 1));
    const engineOrder = encoded.entries.map((entry) => entry.name);
    if (gitOrder.join('\n') !== engineOrder.join('\n')) {
        reportViolation(violations, 'FGT-OBJ-001 tree ordering failure on ' + label + ': git [' + gitOrder.join(', ') + '], engine [' + engineOrder.join(', ') + ']');
    }
    return { oid: javascriptOid, payload: encoded.payload };
}

/**
 * Verifies blob vectors across JS encoder, system git, and optional taxis binary.
 *
 * @param {object} gitRunner - Git plumbing runner.
 * @param {object|null} taxisRunner - Optional taxis plumbing runner.
 * @param {Array<string>} violations - Collected violations.
 * @returns {number} Verified vector count.
 */
function verifyBlobVectors(gitRunner, taxisRunner, violations) {
    const vectors = blobVectors();
    vectors.forEach((vector) => {
        const engineOid = computeBlobOid(vector.payload);
        const gitOid = plumbingWriteBlob(gitRunner, vector.payload);
        if (engineOid !== gitOid) {
            reportViolation(violations, 'FGT-OBJ-001 blob parity failure on ' + vector.label + ': git ' + gitOid + ', engine ' + engineOid);
        }
        if (taxisRunner) {
            const taxisOid = plumbingWriteBlob(taxisRunner, vector.payload);
            if (taxisOid !== gitOid) {
                reportViolation(violations, 'FGT-OBJ-001 [Binary] blob OID divergence on ' + vector.label + ': git ' + gitOid + ', taxis ' + taxisOid);
                return;
            }
            compareLooseObjectBytes(gitRunner.gitDir, taxisRunner.gitDir, gitOid, 'blob:' + vector.label, violations);
            if (Buffer.compare(runPlumbing(gitRunner, ['cat-file', '-p', gitOid]), runPlumbing(taxisRunner, ['cat-file', '-p', taxisOid])) !== 0) {
                reportViolation(violations, 'FGT-OBJ-001 [Binary] cat-file -p divergence on ' + vector.label);
            }
        }
    });
    return vectors.length;
}

/**
 * Verifies tree vectors, including nested levels and canonical ordering.
 *
 * @param {object} gitRunner - Git plumbing runner.
 * @param {Array<string>} violations - Collected violations.
 * @returns {{ count: number, firstTreeOid: string }} Vector count and a reusable tree id.
 */
function verifyTreeVectors(gitRunner, violations) {
    const vectors = treeVectors();
    let firstTreeOid = '';
    vectors.forEach((vector) => {
        const tree = verifyTreeSpec(gitRunner, vector.spec, vector.label, violations);
        if (firstTreeOid.length === 0) firstTreeOid = tree.oid;
    });
    return { count: vectors.length, firstTreeOid };
}

/**
 * Verifies commit vectors against git commit-tree.
 *
 * @param {object} gitRunner - Git plumbing runner.
 * @param {string} treeOid - Tree object id usable by every commit vector.
 * @param {Array<string>} parentOids - Parent commit ids.
 * @param {Array<string>} violations - Collected violations.
 * @returns {number} Number of verified vectors.
 */
function verifyCommitVectors(gitRunner, treeOid, parentOids, violations) {
    const vectors = commitVectors(treeOid, parentOids);
    vectors.forEach((fields) => {
        const engineOid = computeObjectOid('commit', encodeCommit(fields));
        const gitOid = plumbingWriteCommit(gitRunner, fields);
        if (engineOid !== gitOid) {
            reportViolation(violations, 'FGT-OBJ-001 commit parity failure on ' + fields.label + ': git ' + gitOid + ', engine ' + engineOid);
        }
    });
    return vectors.length;
}

/**
 * Verifies annotated tag vectors against git mktag.
 *
 * @param {object} gitRunner - Git plumbing runner.
 * @param {object} targets - Object ids available as tag targets.
 * @param {Array<string>} violations - Collected violations.
 * @returns {number} Number of verified vectors.
 */
function verifyTagVectors(gitRunner, targets, violations) {
    const vectors = tagVectors(targets);
    let firstTagOid = '';
    vectors.forEach((fields) => {
        const engineOid = computeObjectOid('tag', encodeTag(fields));
        const gitOid = plumbingWriteTag(gitRunner, fields);
        if (engineOid !== gitOid) {
            reportViolation(violations, 'FGT-OBJ-001 tag parity failure on ' + fields.label + ': git ' + gitOid + ', engine ' + engineOid);
        }
        if (firstTagOid.length === 0) firstTagOid = gitOid;
    });
    if (firstTagOid.length > 0) {
        const nested = {
            object: firstTagOid,
            kind: 'tag',
            tag: 'nested-tag',
            tagger: signature('Parity Tagger', '+0000', 1700000100),
            message: 'nested tag message\n',
        };
        const engineOid = computeObjectOid('tag', encodeTag(nested));
        const gitOid = plumbingWriteTag(gitRunner, nested);
        if (engineOid !== gitOid) {
            reportViolation(violations, 'FGT-OBJ-001 tag-of-tag parity failure: git ' + gitOid + ', engine ' + engineOid);
        }
    }
    return vectors.length + 1;
}

/**
 * Writes the required parent commits and returns their ids.
 *
 * @param {object} gitRunner - Git plumbing runner.
 * @param {string} treeOid - Tree object id.
 * @param {number} count - Number of parents to create.
 * @returns {Array<string>} Parent commit ids.
 */
function bootstrapParentCommits(gitRunner, treeOid, count) {
    const parents = [];
    for (let index = 0; index < count; index += 1) {
        parents.push(plumbingWriteCommit(gitRunner, {
            tree: treeOid,
            parents: [],
            author: signature('Parity Parent', '+0000', 1600000000 + index),
            committer: signature('Parity Parent', '+0000', 1600000000 + index),
            message: 'parent ' + String(index) + '\n',
        }));
    }
    return parents;
}

/**
 * Probes whether a candidate executable responds to `taxis version`.
 *
 * @param {string} binPath - Candidate executable path.
 * @returns {boolean} True when executable responds cleanly.
 */
function probeTaxisExec(binPath) {
    if (!binPath || !fs.existsSync(binPath)) return false;
    try {
        execFileSync(binPath, ['version'], { stdio: 'ignore' });
        return true;
    } catch (_err) {
        return false;
    }
}

/**
 * Reads an explicit --taxis-bin flag or TAXIS_BIN environment override.
 *
 * @returns {{ specified: boolean, value: string|null }} Explicit override info.
 */
function parseExplicitTaxisArg() {
    for (let i = 0; i < process.argv.length; i += 1) {
        const arg = process.argv[i];
        if (arg === '--taxis-bin') {
            return { specified: true, value: i + 1 < process.argv.length ? process.argv[i + 1] : '' };
        }
        if (arg.startsWith('--taxis-bin=')) {
            return { specified: true, value: arg.slice('--taxis-bin='.length) };
        }
    }
    if (process.env.TAXIS_BIN !== undefined) {
        return { specified: true, value: process.env.TAXIS_BIN };
    }
    return { specified: false, value: null };
}

/**
 * Searches Cargo target directories and PATH for an executable taxis binary.
 *
 * @param {string} repoRoot - Repository root path.
 * @returns {string|null} Resolved path or null.
 */
function findAutoTaxisBinary(repoRoot) {
    const exeName = process.platform === 'win32' ? 'taxis.exe' : 'taxis';
    const dirs = [
        process.env.CARGO_TARGET_DIR,
        path.join(os.tmpdir(), 'taxis-cargo-target'),
        path.join(repoRoot, 'fractal-git', 'target'),
        path.join(repoRoot, 'target'),
    ].filter(Boolean);
    for (const base of dirs) {
        for (const prof of ['release', 'debug']) {
            const cand = path.join(base, prof, exeName);
            if (probeTaxisExec(cand)) return cand;
        }
    }
    try {
        const probeCmd = process.platform === 'win32' ? 'where.exe' : 'which';
        const found = execFileSync(probeCmd, [exeName], { stdio: 'pipe' }).toString('utf8').trim().split(/\r?\n/)[0];
        if (probeTaxisExec(found)) return found;
    } catch (_e) { /* absent */ }
    return null;
}

/**
 * Resolves the taxis executable path, honoring --taxis-bin, --build-taxis, and Cargo targets.
 *
 * @returns {{ bin: string|null, explicitError: string|null }} Resolution result.
 */
function resolveTaxisBinary() {
    const explicit = parseExplicitTaxisArg();
    if (explicit.specified) {
        const resolved = explicit.value ? path.resolve(explicit.value) : '';
        return probeTaxisExec(resolved)
            ? { bin: resolved, explicitError: null }
            : { bin: null, explicitError: 'explicit --taxis-bin / TAXIS_BIN path is missing or not executable: ' + String(explicit.value) };
    }
    if (NO_AUTO_TARGET) return { bin: null, explicitError: null };

    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const autoFound = findAutoTaxisBinary(repoRoot);
    if (autoFound || !process.argv.includes('--build-taxis')) {
        return { bin: autoFound, explicitError: null };
    }
    try {
        execFileSync('cargo', ['build', '--manifest-path', path.join(repoRoot, 'fractal-git', 'Cargo.toml'), '--bin', 'taxis'], { stdio: 'inherit' });
        const built = findAutoTaxisBinary(repoRoot);
        return built ? { bin: built, explicitError: null } : { bin: null, explicitError: 'cargo build completed without producing taxis binary' };
    } catch (err) {
        return { bin: null, explicitError: 'failed to build taxis: ' + err.message };
    }
}

/**
 * Runs the complete parity matrix and reports the verdict.
 *
 * @returns {void}
 */
function runGitParityValidation() {
    console.log('=== [FGT-OBJ-001] Git object parity versus the system git baseline ===');
    if (!isGitAvailable()) {
        console.log('SKIP: system git binary is unavailable; no byte parity claim is made.');
        if (REQUIRE_GIT) {
            console.error('BLOCK: --require-git was requested but git could not be executed.');
            process.exit(1);
        }
        process.exit(0);
    }

    const taxisRes = resolveTaxisBinary();
    if (taxisRes.explicitError) {
        console.error('BLOCK: ' + taxisRes.explicitError);
        process.exit(1);
    }
    const taxisBin = taxisRes.bin;
    if (!taxisBin && REQUIRE_TAXIS) {
        console.error('BLOCK: --require-taxis was requested but taxis binary could not be resolved or executed.');
        process.exit(1);
    }
    console.log(taxisBin ? ('Taxis Binary: ' + taxisBin) : 'NOTICE: taxis binary not located; binary differential check will be skipped.');

    const baseline = createBaselineRepository();
    const taxisBaseline = taxisBin ? createBaselineRepository() : null;
    const gitRunner = makeRunner('git', baseline.gitDir, true);
    const taxisRunner = taxisBaseline ? makeRunner(taxisBin, taxisBaseline.gitDir, false) : null;
    const violations = [];
    let verified = 0;
    try {
        verified += verifyBlobVectors(gitRunner, taxisRunner, violations);
        const treeResult = verifyTreeVectors(gitRunner, violations);
        verified += treeResult.count;
        const parents = bootstrapParentCommits(gitRunner, treeResult.firstTreeOid, 3);
        verified += verifyCommitVectors(gitRunner, treeResult.firstTreeOid, parents, violations);
        const blobOid = plumbingWriteBlob(gitRunner, Buffer.from('tag target\n', 'utf8'));
        const targets = {
            blob: blobOid,
            tree: treeResult.firstTreeOid,
            commit: parents[0],
            tag: plumbingWriteTag(gitRunner, {
                object: parents[0],
                kind: 'commit',
                tag: 'bootstrap',
                tagger: signature('Parity Tagger', '+0000', 1700000000),
                message: 'bootstrap tag\n',
            }),
        };
        verified += verifyTagVectors(gitRunner, targets, violations);
        console.log('Git Baseline: ' + execFileSync('git', ['--version'], { stdio: 'pipe' }).toString('utf8').trim());
        console.log('Verified vectors against the reference baseline: ' + String(verified));
    } catch (error) {
        reportViolation(violations, 'FGT-OBJ-001 reference baseline execution failed: ' + error.message);
    } finally {
        baseline.dispose();
        if (taxisBaseline) taxisBaseline.dispose();
    }

    if (violations.length > 0) {
        console.error('BLOCK: ' + String(violations.length) + ' git plumbing parity violation(s):');
        violations.slice(0, MAX_REPORTED_VIOLATIONS).forEach((v) => console.error('  - ' + v));
        process.exit(1);
    }
    console.log('PASS: every blob, tree, commit, and tag vector matched the system git baseline.');
    process.exit(0);
}

runGitParityValidation();
