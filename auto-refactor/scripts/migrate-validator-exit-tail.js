#!/usr/bin/env node
/**
 * Module: Verification Harness — Exit-Tail Migrator
 * File Path: scripts/migrate-validator-exit-tail.js
 * Architecture Role: Rewrites a validator's hand-rolled `entry().catch(...)` tail into a call to the
 *   shared `runEntry`, so the failure contract lives in one place instead of in every script.
 * Dependencies & Triggers: Node stdlib only; run manually with an explicit file list.
 * Responsibilities:
 *   1. Replace exactly one recognised tail shape with the shared entry call.
 *   2. Add the harness import when the file does not already have one.
 *   3. Refuse any file whose tail does not match a known shape, rather than guessing.
 * Exit Semantics & Design Rationale: Exits 0 when every listed file was migrated, 1 when any file was
 *   skipped. Deliberately narrow: it rewrites only the tail and the import, never the verification
 *   logic, so a migration can be reviewed by reading two hunks. The tool refuses ambiguous shapes
 *   because a wrong rewrite would silently disable a failure path — the one thing this work exists to
 *   prevent.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Matches `entry().catch((e) => { ... process.exit(1); });` as the final statement of a file. */
const TAIL_PATTERN = /^(\s*)([A-Za-z_$][\w$]*)\(\)\s*\.\s*catch\(\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*\{[\s\S]*?process\.exit\(1\);[\s\S]*?\}\);\s*$/;

/** Matches an existing harness import so a second one is never added. */
const HARNESS_IMPORT = /require\((['"])\.\/common\/test-runner-harness\1\)/;

/**
 * Finds the tail to replace, refusing any file whose tail is not the final statement.
 *
 * The tail must be the last thing in the file. A script that wraps its entry in `require.main` or
 * exports its functions keeps code after the catch, and rewriting the tail there would delete that
 * code — the first version of this tool did exactly that to a validator with a `require.main` guard.
 * Unknown shapes are refused rather than guessed at.
 *
 * @param lines - File contents split into lines.
 * @returns Object carrying the tail start index and the matched groups, or null.
 */
function findTail(lines) {
    // The catch block is the last statement, so its closing sequence ends the file barring blank lines.
    let end = lines.length - 1;
    while (end >= 0 && lines[end].trim() === '') end -= 1;
    if (end < 0 || lines[end].trim() !== '});') return null;

    // Walk back to the first line that starts the call, bounded to keep the search linear.
    const lowBound = Math.max(0, end - 30);
    for (let start = end; start >= lowBound; start -= 1) {
        const candidate = lines.slice(start, end + 1).join('\n');
        const match = TAIL_PATTERN.exec(`${candidate}\n`);
        if (!match) continue;
        // Reject a match that swallowed a brace-only line: that means a block boundary was crossed.
        const body = lines.slice(start, end + 1);
        if (body.some((line, index) => index > 0 && /^\s*(\}|if\s*\(|module\.exports)/.test(line))) {
            return null;
        }
        return { start, end, match };
    }
    return null;
}

/**
 * Migrates one file in place.
 *
 * @param filePath - Absolute path to the validator.
 * @returns Result descriptor indicating whether the file changed.
 */
function migrateFile(filePath) {
    const original = fs.readFileSync(filePath, 'utf8');
    const name = path.basename(filePath);

    if (HARNESS_IMPORT.test(original)) {
        return { name, status: 'skipped', reason: 'already imports the harness' };
    }

    const lines = original.split('\n');
    const tail = findTail(lines);
    if (!tail) {
        return { name, status: 'skipped', reason: 'unrecognised tail shape' };
    }

    const entryName = tail.match[2];
    const replacement = `${tail.match[1]}runEntry('${name}', ${entryName});`;
    const head = lines.slice(0, tail.start).join('\n').replace(/\s*$/, '');
    const migrated = `${head}\n\n${replacement}\n`;

    // Insert the import after the last existing require statement, and keep a blank line between the
    // import block and whatever follows: a declaration jammed against the import reads as part of it
    // and defeats the file's own spacing contract.
    const requireLines = [...migrated.matchAll(/^const [\s\S]*?require\([^)]*\);\s*$/gm)];
    if (requireLines.length === 0) {
        return { name, status: 'skipped', reason: 'no require block to extend' };
    }
    const lastRequire = requireLines[requireLines.length - 1];
    const insertAt = lastRequire.index + lastRequire[0].length;
    const withImport = `${migrated.slice(0, insertAt)}\nconst { runEntry } = require('./common/test-runner-harness');\n${migrated.slice(
        insertAt,
    )}`;

    // Collapse the blank line the tail replacement may leave before the entry call.
    const normalised = withImport.replace(/\n{3,}runEntry\(/g, '\n\nrunEntry(');
    fs.writeFileSync(filePath, normalised, 'utf8');
    return { name, status: 'migrated', entry: entryName };
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
    console.error('usage: node migrate-validator-exit-tail.js <validator.js> [...]');
    process.exit(1);
}

const results = targets.map((rel) => migrateFile(path.resolve(process.cwd(), rel)));
let skipped = 0;
for (const result of results) {
    if (result.status === 'migrated') {
        console.log(`MIGRATED ${result.name}  entry=${result.entry}`);
    } else {
        skipped += 1;
        console.log(`SKIPPED  ${result.name}  ${result.reason}`);
    }
}
process.exit(skipped === 0 ? 0 : 1);
