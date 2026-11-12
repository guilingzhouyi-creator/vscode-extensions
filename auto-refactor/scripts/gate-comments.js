#!/usr/bin/env node
/**
 * Module: Static Quality Gate — Strict Comment Ratchet Runner
 * File Path: scripts/gate-comments.js
 * Architecture Role: Self-hosted comment gate; boots the built CLI in strict mode
 * Dependencies & Triggers: `npm run gate` / `gate:comments`; requires `npm run build` output
 * Responsibilities: Scan src/**.ts and scripts/*.js with the comments analyzer at strict
 *                   level against the grouped baseline, and propagate the CLI exit code
 * Exit Semantics & Design Rationale: 0 = no new violations vs the baseline, 1 = new violation
 *                   at/above warning (or unreadable baseline), 2 = usage/precondition error.
 *                   The grouped baseline is the ratchet: line shifts are tolerated, growth is
 *                   not; `--update` is the only sanctioned rewrite path.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'dist', 'index.js');
const BASELINE = path.join(ROOT, 'baselines', 'comments.strict.baseline.json');
const INCLUDE = 'src/**/*.ts,scripts/*.js';

const args = process.argv.slice(2);
const update = args.includes('--update');
const forceExpand = args.includes('--force-expand');

if (!fs.existsSync(CLI)) {
  process.stderr.write('[gate:comments] dist/index.js missing — run "npm run build" first\n');
  process.exit(2);
}

if (!update && !fs.existsSync(BASELINE)) {
  process.stderr.write(
    `[gate:comments] baseline missing: ${path.relative(ROOT, BASELINE)}\n` +
      '[gate:comments] run "npm run gate:comments:update" to freeze the current state first\n',
  );
  process.exit(2);
}

if (update) {
  // The CLI writes the baseline verbatim and does not create parent directories; a first-time
  // freeze must therefore make the target directory exist beforehand.
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
}

const cliArgs = [
  CLI,
  'scan',
  '--root',
  ROOT,
  '--include',
  INCLUDE,
  '--analyzers',
  'comments',
  '--comment-level',
  'strict',
  '--format',
  'text',
  '--baseline',
  BASELINE,
  '--baseline-granularity',
  'grouped',
  '--fail-on-severity',
  'warning',
  '--no-cache',
  '--no-daemon',
  '--log-level',
  'warn',
];

if (update) {
  cliArgs.push('--update-baseline', BASELINE);
  if (forceExpand) {
    cliArgs.push('--force-baseline-expand');
  }
}

const result = spawnSync(process.execPath, cliArgs, { cwd: ROOT, stdio: 'inherit' });

if (result.error) {
  process.stderr.write(`[gate:comments] failed to launch CLI: ${result.error.message}\n`);
  process.exit(2);
}

const code = result.status === null ? 2 : result.status;

const DOC_PROSE_WINDOW_LIMIT = 8;
const IGNORED_SRC_DIRS_RE = /node_modules|dist|\.auto-refactor-cache|reports/;

/**
 * Recursively collects `.ts` files under `dir`, skipping build and cache folders.
 *
 * @param dir - Directory root to walk.
 * @param acc - Accumulated file paths.
 * @returns Collected TypeScript file paths.
 */
function collectTsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_SRC_DIRS_RE.test(full)) collectTsFiles(full, acc);
      continue;
    }
    if (full.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

/**
 * Counts non-tag prose lines inside a docblock ending before `close`.
 *
 * @param lines - File lines.
 * @param open - Opening `/**` line index.
 * @param close - Closing `*\/` line index.
 * @returns Prose line count.
 */
function countProseLines(lines, open, close) {
  let prose = 0;
  for (let cursor = open; cursor < close; cursor += 1) {
    const body = lines[cursor].trim();
    if (!body.startsWith('@') && body !== '/**' && body !== '*') prose += 1;
  }
  return prose;
}

/**
 * Finds docblocks preceding exported functions in `filePath` that overflow the analyzer window.
 *
 * @param filePath - TypeScript file path.
 * @returns Finding lines for blocks exceeding the prose limit.
 */
function findOversizedBlocksInFile(filePath) {
  const findings = [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*export (async )?function/.test(lines[i])) continue;
    let close = i - 1;
    while (close >= 0 && lines[close].trim() !== '*/') close -= 1;
    if (close < 0) continue;
    let open = close;
    while (open >= 0 && !lines[open].trim().startsWith('/**')) open -= 1;
    if (open < 0) continue;
    const prose = countProseLines(lines, open, close);
    if (prose > DOC_PROSE_WINDOW_LIMIT) {
      findings.push(`${path.relative(ROOT, filePath)}:${open + 1} (${prose} prose lines)`);
    }
  }
  return findings;
}

/**
 * Reports documentation blocks that the analyzer cannot see in full.
 *
 * `CMT-CON-001` reads only the last few comment lines of a block, so a long parameter list can push
 * a correct concurrency sentence out of view and produce a message that reads like the sentence is
 * missing. When the run fails, this walks the sources and names each block that overflows, so the
 * operator is told to shorten the block rather than to add a duplicate sentence.
 *
 * @returns Lines describing every overflowing block, empty when none overflow.
 */
function describeOversizedBlocks() {
  const findings = [];
  for (const full of collectTsFiles(path.join(ROOT, 'src'))) {
    findings.push(...findOversizedBlocksInFile(full));
  }
  return findings;
}

if (code !== 0 && !update) {
  const oversized = describeOversizedBlocks();
  if (oversized.length > 0) {
    process.stdout.write(
      `[gate:comments] ${oversized.length} doc block(s) exceed the ${DOC_PROSE_WINDOW_LIMIT}-line window the analyzer reads:\n`,
    );
    for (const finding of oversized.slice(0, 10)) process.stdout.write(`  ${finding}\n`);
  }
}

process.stdout.write(
  `[gate:comments] ${update ? 'baseline updated' : 'strict ratchet'} → ${code === 0 ? '✔ PASS' : '✖ BLOCK'}\n`,
);
process.exit(code);
