/**
 * Module: Hardcoded Scale Count Guard
 * File Path: scripts/common/validate-hardcoded-counts.js
 * Architecture Role: Static guard over the script corpus, rejecting operator-facing success
 *   messages that embed a scale count as a literal instead of deriving it from the measured data.
 * Dependencies & Triggers: Scans scripts/, fractal-git/scripts/, WebGames/scripts/,
 *   auto-refactor/scripts/ and workspace-timing/scripts/; invoked by pre-push and CI.
 * Responsibilities:
 *   1. Prove its own detector still fires before trusting a clean result (built-in probes);
 *   2. Reject a literal count followed by a Chinese counting unit on an output line;
 *   3. Ignore counts that arrive through template interpolation or format placeholders;
 *   4. Report file-and-line diagnostics for every finding.
 * Exit Semantics & Design Rationale: 0 = no hardcoded scale counts, 1 = at least one finding or a
 *   failed self-probe. A hardcoded count is a second source of truth that silently expires: the
 *   check keeps running, the number keeps being printed, and nobody notices they disagree. The
 *   self-probes exist because this guard's own first version used `\b` before a Chinese unit and
 *   a `{2,5}` quantifier, which made it match nothing at all while still exiting 0.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');

const SCAN_ROOTS = Object.freeze([
  'scripts',
  'fractal-git/scripts',
  'WebGames/scripts',
  'auto-refactor/scripts',
  'workspace-timing/scripts',
]);

const SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.py', '.ps1', '.sh']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'out', '__pycache__', 'archive', 'fixtures', 'config']);

/**
 * A literal integer followed by a Chinese counting unit.
 *
 * No `\b` and no `{2,5}`: `\b` does not hold between a digit and a CJK character, and restricting
 * to two or more digits silently drops single-digit counts such as `5 项`.
 *
 * `组` is included because a test-suite total ("12 组契约测试") is a measurement of how many
 * contracts actually ran, so it expires exactly like a file count does.
 */
const COUNT_PATTERN = /\d{1,5}\s*(份|个脚本|项|条规则|文件|张图|步|组)/;

/** Output statements: only these lines reach an operator. */
const EMIT_PATTERN = /(console\.(log|info|warn|error)|process\.(stdout|stderr)\.write|print\(|Write-Host|Write-Output|Write-Error|Write-Warning|echo\s)/;

/** Structural constants that are contracts, not measurements. */
const STRUCTURAL_ALLOWLIST = Object.freeze([
  /仅允许包含\s*4\s*份/,
  /严格仅允许包含\s*4\s*份/,
  /共\s*4\s*份/,
  /全量\s*15\s*项\s*Schema/,
]);

/**
 * Self-probes: the detector must fire on every sample, or the guard reports itself broken.
 *
 * A clean corpus run cannot distinguish "the detector works" from "the detector never fires", and
 * this guard was written after exactly that failure mode shipped once.
 */
const SELF_PROBES = Object.freeze([
  '扫描 74 份活动脚本',
  '共 498 条规则',
  '12 个脚本',
  '1660 文件',
  '5 项违规',
]);

/**
 * Verifies the detector against the probe corpus.
 *
 * @returns {string[]} Probe samples the detector failed to match.
 */
function runSelfProbes() {
  return SELF_PROBES.filter((probe) => !COUNT_PATTERN.test(probe));
}

/**
 * Recursively collects scannable files.
 *
 * @param {string} dir - Absolute directory.
 * @param {string[]} acc - Accumulator.
 * @returns {string[]} Absolute file paths.
 */
function collectFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, acc);
      continue;
    }
    if (SCAN_EXTENSIONS.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

/**
 * Strips interpolated segments so a dynamic count is not mistaken for a literal one.
 *
 * @param {string} line - Source line.
 * @returns {string} Line with `${...}`, `{...}` and `%s`/`%d` placeholders removed.
 */
function stripInterpolation(line) {
  return line
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/%[sd]/g, '');
}

/**
 * Audits one file for hardcoded scale counts on output lines.
 *
 * @param {string} file - Absolute file path.
 * @returns {Array<object>} Findings.
 */
function auditFile(file) {
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  const findings = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (/^(#|\/\/|\*|"""|''')/.test(trimmed)) return;
    if (!EMIT_PATTERN.test(line)) return;
    const stripped = stripInterpolation(line);
    if (!COUNT_PATTERN.test(stripped)) return;
    if (STRUCTURAL_ALLOWLIST.some((pattern) => pattern.test(line))) return;
    const match = COUNT_PATTERN.exec(stripped);
    findings.push({
      type: 'GUARD-COUNT-001',
      file: rel,
      line: index + 1,
      detail: `写死的规模计数「${match[0]}」应改为由实测数据渲染: ${trimmed.slice(0, 100)}`,
    });
  });
  return findings;
}

/**
 * Runs the hardcoded count audit.
 *
 * @returns {{ findings: Array<object>, probeFailures: string[] }} Audit result.
 */
function runAudit() {
  const findings = [];
  for (const target of SCAN_ROOTS) {
    for (const file of collectFiles(path.join(REPO_ROOT, target))) {
      findings.push(...auditFile(file));
    }
  }
  return { findings, probeFailures: runSelfProbes() };
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  const { findings, probeFailures } = runAudit();
  const passed = findings.length === 0 && probeFailures.length === 0;

  if (isAgent) {
    console.log(JSON.stringify({
      protocolVersion: '1.0.0',
      status: passed ? 'PASS' : 'BLOCK',
      gate: 'hardcoded-counts',
      probeFailures,
      findings,
      summary: passed
        ? 'Every operator-facing count is derived from measured data.'
        : `${findings.length} hardcoded count(s), ${probeFailures.length} failed probe(s).`,
    }, null, 2));
    process.exit(passed ? 0 : 1);
  }

  if (probeFailures.length > 0) {
    console.error('✖ BLOCK  hardcoded-counts  检测器自检失败，以下样本未被识别：');
    for (const probe of probeFailures) console.error(`  - ${probe}`);
    process.exit(1);
  }

  if (passed) {
    console.log('  ✔ PASS  hardcoded-counts  面向操作者的计数均来自实测数据');
    process.exit(0);
  }

  console.error('✖ BLOCK  hardcoded-counts');
  for (const item of findings) {
    console.error(`  - [${item.type}] ${item.file}:${item.line} ${item.detail}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({ runAudit, auditFile, runSelfProbes, stripInterpolation, COUNT_PATTERN, SELF_PROBES });
