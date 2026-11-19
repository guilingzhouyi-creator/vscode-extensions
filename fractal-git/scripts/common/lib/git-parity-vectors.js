/**
 * Module: Fractal Git — Git Plumbing Parity Vector Datasets & Fixture Builders
 * File Path: fractal-git/scripts/common/lib/git-parity-vectors.js
 * Architecture Role: Holds the canonical 57-vector test matrix (blob, tree, commit, and annotated tag
 *   fixtures) used by validate-git-parity.js to verify byte-exact Git plumbing equivalence.
 * Dependencies & Triggers: Consumed by fractal-git/scripts/common/validate-git-parity.js; pure Node.js
 *   with zero external dependencies.
 * Responsibilities:
 *   1. Provide deterministic blob payloads spanning empty, binary, NUL, UTF-8, and multi-KB shapes.
 *   2. Provide nested tree specifications covering mixed-case, trailing-slash directory sorting,
 *      executable/symlink modes, and gitlink entries.
 *   3. Build commit, parent bootstrap, and annotated tag fixtures across multiple timezones and kinds.
 * Exit Semantics & Design Rationale: Library module exporting pure fixture builders; keeps static
 *   vector data isolated from plumbing runner and verification logic.
 */
'use strict';

const BLOB_TEXT_VECTORS = Object.freeze([
  { label: 'empty blob', bytes: [] },
  { label: 'plain text with newline', utf8: 'hello world\n' },
  { label: 'plain text without newline', utf8: 'hello world' },
  { label: 'binary payload', bytes: [0x00, 0xff, 0xfe, 0x01, 0x7f] },
  { label: 'carriage return line feed', utf8: 'line\r\nline\r\n' },
  { label: 'tab separated columns', utf8: 'a\tb\tc\n' },
  { label: 'latin accented text', utf8: 'École très fréquentée\n' },
  { label: 'emoji text', utf8: '阶段完成 🚀\n' },
  { label: 'invalid utf-8 bytes', bytes: [0xff, 0xfe, 0x80, 0x81] },
  { label: 'single newline', utf8: '\n' },
  { label: 'embedded nul byte', bytes: [0x61, 0x00, 0x62] },
]);

const TREE_VECTOR_FIXTURES = Object.freeze([
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
]);

const COMMIT_TIMEZONES = Object.freeze(['-0500', '+0000', '+0530']);
const TAG_MESSAGES = Object.freeze([
  'tag message\n',
  'tag message without newline',
  '阶段标签\n',
  'multi line\ntag body\n',
]);

/**
 * Creates a fixed signature for baseline validation calls.
 *
 * @param {string} name - Person name.
 * @param {string} tz - Time zone offset text.
 * @param {number} timestamp - Seconds since the epoch.
 * @returns {{ name: string, email: string, timestamp: number, tz: string }} Signature.
 */
function buildSignature(name, tz, timestamp) {
  return { name, email: 'parity@example.com', timestamp, tz };
}

/**
 * Builds blob vectors: empty, text, binary, non-ASCII, control characters, and large payloads.
 *
 * @returns {Array<{ label: string, payload: Buffer }>} 14 blob vectors.
 */
function buildBlobVectors() {
  const vectors = BLOB_TEXT_VECTORS.map((entry) => ({
    label: entry.label,
    payload: entry.bytes ? Buffer.from(entry.bytes) : Buffer.from(entry.utf8, 'utf8'),
  }));
  vectors.push(
    { label: 'four kilobyte line', payload: Buffer.from('a'.repeat(4096) + '\n', 'utf8') },
    { label: 'all zero bytes', payload: Buffer.alloc(256, 0) },
    { label: 'repeated deterministic noise', payload: Buffer.from(Array.from({ length: 512 }, (_v, i) => (i * 37) % 256)) },
  );
  return vectors;
}

/**
 * Returns nested tree fixtures used by both the encoder and the reference baseline.
 *
 * @returns {Array<{ label: string, spec: Array<object> }>} 12 tree fixtures.
 */
function buildTreeVectors() {
  return TREE_VECTOR_FIXTURES;
}

/**
 * Builds commit vectors that vary parent count, message shape, and time zone.
 *
 * @param {string} treeOid - Tree object id to embed.
 * @param {Array<string>} parentOids - Parent object ids available for octopus commits.
 * @returns {Array<object>} 13 commit fixtures with expected fields.
 */
function buildCommitVectors(treeOid, parentOids) {
  const author = buildSignature('Parity Author', '+0800', 1700000000);
  const committer = buildSignature('Parity Committer', '+0800', 1700000000);
  const variants = [
    { label: 'root commit without parents', parents: [], message: 'initial commit\n' },
    { label: 'single parent merge-free commit', parents: [parentOids[0]], message: 'second commit\n' },
    { label: 'two parent merge commit', parents: [parentOids[0], parentOids[1]], message: "Merge branch 'feature/x'\n" },
    { label: 'three parent octopus commit', parents: [parentOids[0], parentOids[1], parentOids[2]], message: 'octopus\n' },
    { label: 'message without trailing newline', parents: [], message: 'no newline at end' },
    { label: 'multi line message', parents: [], message: 'subject line\n\nbody paragraph one\nbody paragraph two\n' },
    { label: 'leading blank line in message', parents: [], message: '\nmessage after blank line\n' },
    { label: 'non ascii message', parents: [], message: '阶段交付完成 🚀\n' },
    { label: 'tab inside message', parents: [], message: 'col1\tcol2\n' },
    { label: 'carriage return inside message', parents: [], message: 'line one\r\nline two\n' },
  ];
  const zoned = COMMIT_TIMEZONES.map((tz, index) => ({
    label: `time zone ${tz} commit`,
    parents: [],
    message: `zone variant ${index}\n`,
    author: buildSignature('Parity Author', tz, 1700000000 + index),
    committer: buildSignature('Parity Committer', tz, 1700000000 + index),
  }));
  return variants.concat(zoned).map((vector) => Object.assign({ tree: treeOid, author, committer }, vector));
}

/**
 * Builds annotated tag vectors for every target kind plus timezone variants.
 *
 * @param {{ commit: string, tree: string, blob: string, tag: string }} targets - Target object ids.
 * @returns {Array<object>} 17 tag fixtures (nested tag added separately by runner).
 */
function buildTagVectors(targets) {
  const tagger = buildSignature('Parity Tagger', '+0800', 1700000000);
  const kinds = [
    { kind: 'commit', object: targets.commit },
    { kind: 'tree', object: targets.tree },
    { kind: 'blob', object: targets.blob },
    { kind: 'tag', object: targets.tag },
  ];
  const vectors = [];
  kinds.forEach((entry, kindIndex) => {
    TAG_MESSAGES.forEach((message, messageIndex) => {
      vectors.push({
        label: `tag over ${entry.kind} message ${messageIndex}`,
        object: entry.object,
        kind: entry.kind,
        tag: `v0.${kindIndex}.${messageIndex}`,
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
    tagger: buildSignature('Parity Tagger', '-0800', 1700000200),
    message: 'zoned tag message\n',
  });
  return vectors;
}

/**
 * Builds bootstrap parent commit and tag fixtures for multi-parent and tag-of-tag vectors.
 *
 * @param {string} treeOid - Tree object id for parent commits.
 * @param {number} index - Parent ordinal index.
 * @returns {object} Commit field payload.
 */
function buildParentCommitFields(treeOid, index) {
  const sig = buildSignature('Parity Parent', '+0000', 1600000000 + index);
  return { tree: treeOid, parents: [], author: sig, committer: sig, message: `parent ${index}\n` };
}

/**
 * Builds bootstrap and nested tag payloads referencing existing Git objects.
 *
 * @param {string} targetOid - Target object id.
 * @param {string} kind - Target object kind (`commit` or `tag`).
 * @param {string} tag - Tag name.
 * @returns {object} Tag field payload.
 */
function buildTagFixture(targetOid, kind, tag) {
  const isNested = kind === 'tag';
  return {
    object: targetOid,
    kind,
    tag,
    tagger: buildSignature('Parity Tagger', '+0000', isNested ? 1700000100 : 1700000000),
    message: isNested ? 'nested tag message\n' : 'bootstrap tag\n',
  };
}

module.exports = {
  buildBlobVectors,
  buildTreeVectors,
  buildCommitVectors,
  buildTagVectors,
  buildParentCommitFields,
  buildTagFixture,
};
