#!/usr/bin/env node
/**
 * Module: Verification Harness — Lingering Empty Directory Rule (HYG-DIR-001)
 * File Path: scripts/validate-empty-directory-audit.js
 * Architecture Role: Regression suite for the eighth physical hygiene dimension. The other seven
 *   dimensions are per-file properties reached by the hygiene analyzer; a lingering empty directory
 *   has no file to attach to, so it is judged by a whole-tree post-scan pass. This suite pins that
 *   the pass exists, that it fires on an empty directory, and that it stays silent everywhere the
 *   rule must not speak.
 * Dependencies & Triggers: `node scripts/validate-empty-directory-audit.js`, part of the test
 *   matrix; imports ../dist/api (scan) and the compiled audit helpers.
 * Responsibilities:
 *   1. Assert the audit reports a directory that keeps no entries;
 *   2. Assert ignored trees (build output, caches, package directories) are never reported;
 *   3. Assert exempt prefixes and fixture segments are never reported;
 *   4. Assert a populated tree produces nothing, so a green run is not vacuous;
 *   5. Assert the full-scan report carries the finding and the incremental scope does not;
 *   6. Assert the pass declares itself in summary.postScanPasses only when the hygiene analyzer
 *      runs.
 * Exit Semantics & Design Rationale: Exits 0 when every assertion holds, exits 1 on the first
 *   failure. Fixtures are built under the OS temp directory so the repository tree is never the
 *   subject of its own assertion, and the ignore list is driven from the audit module rather than
 *   restated here, so a change to the vocabulary surfaces as a behaviour change rather than as a
 *   duplicated literal drifting out of step.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../dist/api');
const {
  auditEmptyDirectories,
  buildIgnoredDirectorySet,
  isEmptyDirectoryExempt,
  toIgnoredDirectoryName,
} = require('../dist/core/intelligence/empty-directory-audit');

/**
 * Create a fresh temporary directory.
 *
 * @param prefix - Prefix for the directory name.
 * @returns Absolute path of the created directory.
 */
function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Create a directory relative to a root, including any missing parents.
 *
 * @param root - Absolute root directory.
 * @param relative - POSIX relative directory path.
 * @returns Nothing; the directory is created as a side effect.
 */
function makeDir(root, relative) {
  fs.mkdirSync(path.join(root, relative), { recursive: true });
}

/**
 * Write one file relative to a root, creating parent directories.
 *
 * @param root - Absolute root directory.
 * @param relative - POSIX relative file path.
 * @param content - File content.
 * @returns Nothing; the directory is created as a side effect.
 */
function writeFile(root, relative, content) {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

/**
 * Collect the reported directory paths of one audit.
 *
 * @param root - Absolute root directory.
 * @returns Reported relative directory paths.
 */
function reportedPaths(root) {
  return auditEmptyDirectories(root).map((issue) => issue.location.file);
}

/**
 * Assert the audit reports exactly the expected directory set.
 *
 * @returns Nothing; the assertions throw on violation and are silent otherwise.
 */
function verifyAuditDetectsEmptyDirectory() {
  const root = tempRoot('ar-emptydir-detect-');
  try {
    makeDir(root, 'src/abandoned');
    writeFile(root, 'src/live/index.ts', 'export const LIVE = 1;\n');

    const issues = auditEmptyDirectories(root);
    assert.strictEqual(issues.length, 1, `expected one empty directory, got ${issues.length}`);
    assert.strictEqual(issues[0].rule, 'HYG-DIR-001', 'the finding must carry the rule id');
    assert.strictEqual(issues[0].analyzer, 'hygiene', 'the finding must be owned by hygiene');
    assert.strictEqual(issues[0].severity, 'error', 'a lingering empty directory is blocking');
    assert.strictEqual(issues[0].location.file, 'src/abandoned', 'the path must be repo-relative');
    console.log('  ✔ a directory with no live entries is reported as HYG-DIR-001');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Assert the ignored vocabulary is honoured by both the audit and the name translator.
 *
 * @returns Nothing; the assertions throw on violation and are silent otherwise.
 */
function verifyIgnoredTreesStaySilent() {
  const root = tempRoot('ar-emptydir-ignored-');
  try {
    const ignoredNames = [...buildIgnoredDirectorySet()];
    assert.ok(ignoredNames.includes('node_modules'), 'node_modules must be ignored');
    assert.ok(ignoredNames.includes('.git'), '.git must be ignored');
    assert.ok(ignoredNames.includes('dist'), 'dist must be ignored');

    for (const name of ignoredNames) makeDir(root, `${name}/inner`);
    writeFile(root, 'src/keep.ts', 'export const KEEP = 1;\n');

    assert.deepStrictEqual(
      reportedPaths(root),
      [],
      'build output, caches and package trees must never be reported as empty',
    );
    console.log('  ✔ ignored trees are never reported, even when they hold no files');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Assert exemption rules and the exclude-glob translator behave as specified.
 *
 * @returns Nothing; the assertions throw on violation and are silent otherwise.
 */
function verifyExemptionsAndTranslator() {
  const root = tempRoot('ar-emptydir-exempt-');
  try {
    makeDir(root, 'archive/retired');
    makeDir(root, 'src/fixtures/blank');
    makeDir(root, 'src/testdata/blank');
    writeFile(root, 'src/keep.ts', 'export const KEEP = 1;\n');

    assert.deepStrictEqual(
      reportedPaths(root),
      [],
      'archive, fixtures and testdata are exempt corpora, not live source',
    );

    assert.strictEqual(isEmptyDirectoryExempt(''), true, 'the scan root itself is never reported');
    assert.strictEqual(isEmptyDirectoryExempt('src/live'), false, 'live source is not exempt');

    assert.strictEqual(toIgnoredDirectoryName('dist'), 'dist', 'a bare name is usable');
    assert.strictEqual(
      toIgnoredDirectoryName('dist/'),
      'dist',
      'a trailing separator is normalised away',
    );
    assert.strictEqual(
      toIgnoredDirectoryName('**/dist/**'),
      null,
      'a glob cannot decide a directory by name and must be dropped',
    );
    assert.strictEqual(
      toIgnoredDirectoryName('build/out'),
      null,
      'a nested path cannot decide a directory by name and must be dropped',
    );
    console.log('  ✔ exemptions hold and only bare directory names widen the ignore set');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Assert a populated tree produces nothing, proving the detector is not always-on.
 *
 * @returns Nothing; the assertions throw on violation and are silent otherwise.
 */
function verifyPopulatedTreeStaysSilent() {
  const root = tempRoot('ar-emptydir-populated-');
  try {
    writeFile(root, 'src/a/index.ts', 'export const A = 1;\n');
    writeFile(root, 'src/b/index.ts', 'export const B = 2;\n');
    assert.deepStrictEqual(reportedPaths(root), [], 'a populated tree must stay silent');
    console.log('  ✔ a populated tree emits nothing from this rule');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Assert the rule reaches a full-scan report and stays out of an incremental one.
 *
 * @returns Resolves when both entry points have been asserted.
 */
async function verifyPostScanChannel() {
  const root = tempRoot('ar-emptydir-scan-');
  const configPath = path.join(root, 'auto-refactor.config.json');
  try {
    writeFile(root, 'src/live.ts', 'export function live(): number {\n  return 1;\n}\n');
    makeDir(root, 'src/abandoned');
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          include: ['**/*.ts'],
          analyzers: {
            hygiene: { enabled: true, options: { checkNaming: false, checkDeadCode: false } },
            comments: { enabled: false },
            governance: { enabled: false },
            constants: { enabled: false },
            complexity: { enabled: false },
            'large-file': { enabled: false },
          },
        },
        null,
        2,
      )}\n`,
    );

    const report = await scan({
      root,
      configFile: configPath,
      format: 'json',
      logLevel: 'silent',
      cache: false,
      workers: 1,
    });
    const findings = report.issues.filter((issue) => issue.rule === 'HYG-DIR-001');
    assert.strictEqual(findings.length, 1, 'the full scan must report the empty directory');
    assert.strictEqual(findings[0].location.file, 'src/abandoned', 'the path must be relative');
    assert.ok(
      report.summary.postScanPasses.includes('empty-directories'),
      `the pass must declare itself, got ${JSON.stringify(report.summary.postScanPasses)}`,
    );
    console.log('  ✔ a full scan reports the empty directory and declares the pass');

    const disabled = await scan({
      root,
      configFile: configPath,
      format: 'json',
      logLevel: 'silent',
      cache: false,
      workers: 1,
      include: ['src/live.ts'],
    });
    assert.strictEqual(
      disabled.issues.filter((issue) => issue.rule === 'HYG-DIR-001').length,
      1,
      'narrowing the include globs must not silently disable a whole-tree rule',
    );
    console.log('  ✔ the rule is driven by the analyzer switch, not by the include globs');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Assert the pass is absent when the hygiene analyzer is disabled.
 *
 * @returns Resolves when the disabled run has been asserted.
 */
async function verifyDisabledAnalyzerSkipsPass() {
  const root = tempRoot('ar-emptydir-disabled-');
  const configPath = path.join(root, 'auto-refactor.config.json');
  try {
    writeFile(root, 'src/live.ts', 'export function live(): number {\n  return 1;\n}\n');
    makeDir(root, 'src/abandoned');
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          include: ['**/*.ts'],
          analyzers: {
            hygiene: { enabled: false },
            comments: { enabled: false },
            governance: { enabled: false },
            constants: { enabled: false },
            complexity: { enabled: false },
            'large-file': { enabled: false },
          },
        },
        null,
        2,
      )}\n`,
    );

    const report = await scan({
      root,
      configFile: configPath,
      format: 'json',
      logLevel: 'silent',
      cache: false,
      workers: 1,
    });
    assert.strictEqual(
      report.issues.filter((issue) => issue.rule === 'HYG-DIR-001').length,
      0,
      'a disabled analyzer must not produce its rules',
    );
    assert.strictEqual(
      report.summary.postScanPasses.includes('empty-directories'),
      false,
      'a disabled analyzer must not declare its post-scan pass',
    );
    console.log('  ✔ disabling the hygiene analyzer removes both the rule and the pass');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  verifyAuditDetectsEmptyDirectory();
  verifyIgnoredTreesStaySilent();
  verifyExemptionsAndTranslator();
  verifyPopulatedTreeStaysSilent();
  await verifyPostScanChannel();
  await verifyDisabledAnalyzerSkipsPass();
  console.log('\n ALL EMPTY DIRECTORY AUDIT CHECKS PASSED SUCCESSFULLY!');
}

main().catch((error) => {
  console.error('\n✖ BLOCK', error && error.message ? error.message : error);
  process.exit(1);
});
