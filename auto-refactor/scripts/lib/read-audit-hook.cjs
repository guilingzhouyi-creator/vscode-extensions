'use strict';
/**
 * Module: Verification Harness — fs Read Recorder Preload
 * File Path: scripts/lib/read-audit-hook.cjs
 * Architecture Role: CommonJS preload that counts every file read performed by the scanned process,
 *   so `validate-redundant-reads.js` can measure read amplification.
 * Dependencies & Triggers: Loaded through `NODE_OPTIONS=--require`; writes JSON on process exit.
 * Responsibilities:
 *   1. Wrap `fs.readFileSync` and `fs.promises.readFile` with a counting shim;
 *   2. Emit one row per distinct absolute path with read count and byte volume.
 * Exit Semantics & Design Rationale: Must be CommonJS. Patching `fs` from an ESM module creates a
 *   separate module instance, and the scan then records nothing while appearing to run fine. The
 *   hook never swallows errors: it counts the call, then delegates and lets failures propagate.
 */
const fs = require('fs');
const path = require('path');

const OUTPUT = process.env.AR_READ_AUDIT_OUT;
const reads = new Map();
let active = OUTPUT !== undefined && OUTPUT !== '';

/**
 * Records one read of `file`.
 *
 * @param {string} file - Path passed to the fs call.
 * @param {number} bytes - Bytes produced by the call.
 */
function record(file, bytes) {
    if (!active) return;
    const key = path.resolve(String(file));
    const entry = reads.get(key) || { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += bytes;
    reads.set(key, entry);
}

const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function patchedReadFileSync(file, ...rest) {
    const result = originalReadFileSync.call(this, file, ...rest);
    const size =
        typeof result === 'string' ? Buffer.byteLength(result) : (result && result.length) || 0;
    record(file, size);
    return result;
};

const originalReadFile = fs.promises.readFile;
fs.promises.readFile = async function patchedReadFile(file, ...rest) {
    const result = await originalReadFile.call(this, file, ...rest);
    const size =
        typeof result === 'string' ? Buffer.byteLength(result) : (result && result.length) || 0;
    record(file, size);
    return result;
};

process.on('exit', () => {
    if (!active) return;
    active = false;
    const rows = [...reads.entries()].map(([absPath, entry]) => ({
        path: absPath,
        count: entry.count,
        bytes: entry.bytes,
    }));
    fs.writeFileSync(OUTPUT, JSON.stringify(rows), 'utf8');
});
