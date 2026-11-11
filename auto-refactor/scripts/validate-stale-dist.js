#!/usr/bin/env node
/**
 * Module: Verification Harness — Stale Build Artifact Guard
 * File Path: scripts/validate-stale-dist.js
 * Architecture Role: Guards the gap between a rename and the build output. `tsc` with
 *   `incremental: true` emits new files but never deletes the output of a source file that has
 *   since been renamed or removed, so `dist/` accumulates modules no source owns. That is not a
 *   cosmetic leftover: every validator in this repository loads code from `dist/`, so a stale
 *   artifact means the suite can assert against an implementation that no longer exists — and it
 *   passes, because the old file is genuinely self-consistent.
 * Dependencies & Triggers: reads tsconfig.json for the source and output roots; registered in
 *   scripts/test-parallel.js and run by `npm test`.
 * Responsibilities:
 *   1. Map every emitted .js under dist/ back to the source file that should own it.
 *   2. Report artifacts with no corresponding source, excluding declaration and map siblings.
 *   3. Fail with the exact stale paths, so the fix is a deletion rather than an investigation.
 * Exit Semantics & Design Rationale: Exits 0 when dist/ is a faithful projection of src/, 1 when
 *   any orphan remains. Only `.js` is checked: `.d.ts`, `.js.map` and `.tsbuildinfo` siblings are
 *   derived from the same compile and disappear with their `.js`, so listing them would triple the
 *   report without adding a distinct failure. A missing dist/ is not a failure — `npm run build`
 *   has simply not run yet, and the caller that needs it will build.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'src');

/** Extensions that are derived from a compiled module and must not be judged on their own. */
const DERIVED_SUFFIXES = ['.d.ts', '.js.map', '.d.ts.map'];

/**
 * Reports whether a file is a compiled module rather than a derived sibling.
 *
 * @param fileName - Base name of the file.
 * @returns True for a `.js` file that is not itself a declaration or map.
 */
function isCompiledModule(fileName) {
  if (!fileName.endsWith('.js')) return false;
  return !DERIVED_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

/**
 * Walks a directory and returns every file path relative to it.
 *
 * @param dir - Directory to walk.
 * @returns Relative paths using forward slashes.
 */
function listFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      found.push(path.relative(dir, full).replace(/\\/g, '/'));
    }
  };
  walk(dir);
  return found;
}

/**
 * Collects emitted modules under dist/.
 *
 * @returns Relative module paths.
 */
function emittedModules() {
  return listFiles(DIST).filter((relative) => isCompiledModule(path.basename(relative)));
}

/**
 * Collects source files that could own an emitted module.
 *
 * @returns Relative source paths without extension, using forward slashes.
 */
function sourceStems() {
  const stems = new Set();
  for (const relative of listFiles(SRC)) {
    if (!/\.(ts|tsx|js|mts|cts)$/.test(relative)) continue;
    if (relative.endsWith('.d.ts')) continue;
    stems.add(relative.replace(/\.(tsx?|mts|cts|js)$/, ''));
  }
  return stems;
}

/**
 * Finds emitted modules whose owning source no longer exists.
 *
 * @param emitted - Relative module paths under dist/.
 * @param stems - Relative source stems under src/.
 * @returns Orphaned artifacts, sorted.
 */
function findOrphans(emitted, stems) {
  const orphans = [];
  for (const relative of emitted) {
    const stem = relative.replace(/\.js$/, '');
    if (stems.has(stem)) continue;
    orphans.push(relative);
  }
  return orphans.sort();
}

function main() {
  console.log('=== Stale Build Artifact Guard ===');

  if (!fs.existsSync(DIST)) {
    console.log('\n  ✔ no dist/ present; nothing can be stale.');
    console.log('\nConclusion: build output absent, guard not applicable ✔');
    return;
  }
  assert.ok(fs.existsSync(SRC), 'src/ must exist when dist/ does');

  const emitted = emittedModules();
  const orphans = findOrphans(emitted, sourceStems());

  console.log(
    `\n  scanned ${emitted.length} emitted module(s) against ${sourceStems().size} source stem(s).`,
  );

  if (orphans.length > 0) {
    console.error(
      `\n✖ ${orphans.length} build artifact(s) have no owning source — validators would load stale code:`,
    );
    for (const orphan of orphans.slice(0, 20)) console.error(`    dist/${orphan}`);
    if (orphans.length > 20) console.error(`    ... and ${orphans.length - 20} more`);
    console.error(
      '\nFix: delete the listed files (or run a clean build). A rename without a clean',
    );
    console.error('build leaves the previous output behind because tsc never deletes.');
    process.exit(1);
  }

  console.log('  ✔ every emitted module maps back to a current source file.');
  console.log('\nConclusion: dist/ is a faithful projection of src/ ✔');
}

try {
  main();
} catch (error) {
  console.error(`\n✖ Stale artifact guard failed: ${error.message}`);
  process.exit(1);
}
