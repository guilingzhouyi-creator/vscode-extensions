#!/usr/bin/env node
/**
 * Module: Verification Harness — Exit-Tail Migrator
 * File Path: scripts/migrate-validator-exit-tail.js
 * Architecture Role: Rewrites a validator's hand-rolled failure tail into the shared harness
 *   handler, so the failure contract lives in one place instead of in every script.
 * Dependencies & Triggers: Node stdlib only; run manually with an explicit file list.
 * Responsibilities:
 *   1. Recognise the three tail shapes these scripts use and rewrite exactly one of them.
 *   2. Add the harness import when missing, at the end of the existing import block.
 *   3. Refuse any file whose tail does not match a known shape, rather than guessing.
 * Exit Semantics & Design Rationale: Exits 0 if all migrated, 1 if skipped. Rewrites only tail
 *   and import, keeping checks intact; refuses ambiguous shapes to preserve failure paths.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HARNESS = "require('./common/test-runner-harness')";

/** Matches an existing harness import so a second one is never added. */
const HARNESS_IMPORT = /require\((['"]).\/common\/test-runner-harness\1\)/;

/** Shape A: `entry().catch((e) => { ... process.exit(1); });` as the file's final statement. */
const BARE_CATCH = /^(\s*)([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\.\s*catch\(\s*\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>\s*\{[\s\S]*?process\.exit\(1\);[\s\S]*?\}\s*\)\s*;\s*$/;

/** Shape B: an async IIFE closed by `})().catch(...)`; the body stays, only the handler changes. */
const IIFE_CATCH = /^(\s*)\}\s*\)\s*\(\s*\)\s*\.\s*catch\(\s*\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>\s*\{[\s\S]*?process\.exit\(1\);[\s\S]*?\}\s*\)\s*;\s*$/;

/** Shape C: a promise chain whose last segment is the catch; the `.then()` success path is kept. */
const CHAIN_CATCH = /^(\s*)\.\s*catch\(\s*\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>\s*\{[\s\S]*?process\.exit\(1\);[\s\S]*?\}\s*\)\s*;\s*$/;

/**
 * Finds the tail to replace, refusing any file whose tail is not the final statement.
 *
 * The tail must be the last thing in the file. A script that wraps its entry in `require.main` or
 * exports its functions keeps code after the catch, and rewriting the tail there would delete
 * that code — v1 of this tool hit a validator carrying a `require.main` guard.
 * Unknown shapes are refused rather than guessed at.
 *
 * @param lines - File contents split into lines.
 * @returns Descriptor carrying the tail start index, its shape, and the captured groups; or null.
 */
function findTail(lines) {
    let end = lines.length - 1;
    while (end >= 0 && lines[end].trim() === '') end -= 1;
    if (end < 0) return null;
    const lastLine = lines[end];
    if (!/\}\s*\)\s*;\s*$/.test(lastLine)) return null;

    const lowBound = Math.max(0, end - 30);
    for (let start = end; start >= lowBound; start -= 1) {
        const candidate = `${lines.slice(start, end + 1).join('\n')}\n`;
        const shapes = [
            ['bare', BARE_CATCH],
            ['iife', IIFE_CATCH],
            ['chain', CHAIN_CATCH],
        ];
        for (const [shape, pattern] of shapes) {
            const match = pattern.exec(candidate);
            if (!match) continue;
            // A match that swallowed a block boundary means the window crossed into unrelated code.
            // The first and last lines are excluded: they are the tail itself, which always carries
            // braces.
            const body = lines.slice(start, end + 1).slice(1, -1);
            if (body.some((line) => /^\s*(\}|if\s*\(|module\.exports)/.test(line))) return null;
            return { start, end, shape, match };
        }
    }
    return null;
}

/**
 * Finds the offset just past the leading import block.
 *
 * Walks top-level statements only, so a `require` embedded in a fixture template string is
 * invisible here. A statement runs from a column-zero line until a line ending in a semicolon; that
 * is enough for the import blocks these validators use, including multi-line destructuring. An
 * import is a statement whose final call is the `require` itself: `require('fs').readFileSync(...)`
 * is ordinary code, and a fixture string may contain either shape.
 *
 * @param source - Whole file contents after the tail was replaced.
 * @returns Offset after the final import's newline, or null when there is no import block.
 */
function findImportInsertAt(source) {
    const lines = source.split('\n');
    let offset = 0;
    let lastEnd = null;
    let seenImport = false;
    let buffer = '';

    for (const line of lines) {
        const length = line.length + 1;
        if (buffer === '' && line.trim() === '') {
            offset += length;
            continue;
        }
        if (buffer === '' && /^[ \t]/.test(line)) {
            offset += length;
            continue;
        }

        buffer += `${line}\n`;
        offset += length;
        if (!/;\s*$/.test(line)) continue;

        const statement = buffer;
        buffer = '';
        if (/require\((['"])[^'"\n]+\1\)\s*;\s*$/m.test(statement)) {
            seenImport = true;
            lastEnd = offset;
        } else if (seenImport) {
            break;
        }
    }

    return lastEnd;
}

/**
 * Rewrites the tail, returning the new body plus the harness members the rewrite needs.
 *
 * @param lines - File contents split into lines.
 * @param tail - Descriptor returned by `findTail`.
 * @param name - Suite name used in the failure banner.
 * @returns Object with the rewritten source and the harness members to import.
 */
function rewriteTail(lines, tail, name) {
    const head = lines.slice(0, tail.start).join('\n').replace(/\s*$/, '');
    const indent = tail.match[1];

    if (tail.shape === 'bare') {
        const entry = tail.match[2];
        return { body: `${head}\n\n${indent}runEntry('${name}', ${entry});\n`, members: ['runEntry'] };
    }
    if (tail.shape === 'iife') {
        const closed = `${head}\n${indent}})().catch(reportFailure('${name}'));\n`;
        return { body: closed, members: ['reportFailure'] };
    }
    // Chain: keep the caller's success path, swap only the handler.
    return { body: `${head}\n${indent}.catch(reportFailure('${name}'));\n`, members: ['reportFailure'] };
}

/**
 * Adds members to an existing destructured harness import.
 *
 * Four validators already pull `createTempTestDir` and friends from the harness, so another
 * import line would be redundant. Their import spans several lines; we append to the last one.
 * Only the exact destructuring block that ends at the harness `require` is touched, so a different
 * module's import is never modified.
 *
 * @param source - Whole file contents.
 * @param members - Harness members the rewrite needs.
 * @returns Source with the members present, or null when the import cannot be extended safely.
 */
function extendHarnessImport(source, members) {
    const lines = source.split('\n');
    const closeIndex = lines.findIndex((line) => /^\}\s*=\s*require\((['"]).\/common\/test-runner-harness\1\)\s*;/.test(line));
    if (closeIndex < 0) return null;

    const openIndex = lines.findIndex((line, index) => index < closeIndex && /^const\s+\{\s*$/.test(line));
    if (openIndex < 0) return null;

    const existing = lines
        .slice(openIndex + 1, closeIndex)
        .join(' ')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const missing = members.filter((m) => !existing.includes(m));
    if (missing.length === 0) return source;

    const lastMemberLine = closeIndex - 1;
    if (!/,\s*$/.test(lines[lastMemberLine])) lines[lastMemberLine] += ',';
    lines.splice(lastMemberLine + 1, 0, ...missing.map((m) => `  ${m},`));
    return lines.join('\n');
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

    const lines = original.split('\n');
    const tail = findTail(lines);
    if (!tail) return { name, status: 'skipped', reason: 'unrecognised tail shape' };

    const { body, members } = rewriteTail(lines, tail, name);
    const alreadyImported = HARNESS_IMPORT.test(original);
    const insertAt = findImportInsertAt(body);
    if (!alreadyImported && insertAt === null) {
        return { name, status: 'skipped', reason: 'no require block to extend' };
    }

    const importLine = `const { ${members.join(', ')} } = ${HARNESS};`;
    const withImport = alreadyImported
        ? extendHarnessImport(body, members)
        : `${body.slice(0, insertAt)}\n${importLine}\n${body.slice(insertAt)}`;
    if (withImport === null) {
        return { name, status: 'skipped', reason: 'harness import cannot be extended safely' };
    }

    fs.writeFileSync(filePath, withImport, 'utf8');
    return { name, status: 'migrated', shape: tail.shape, members };
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
        console.log(`MIGRATED ${result.name}  shape=${result.shape} members=${result.members.join('+')}`);
    } else {
        skipped += 1;
        console.log(`SKIPPED  ${result.name}  ${result.reason}`);
    }
}
process.exit(skipped === 0 ? 0 : 1);
