#!/usr/bin/env node
/**
 * Module: Static Quality Gate — Self-Audit Ratchet Runner
 * File Path: scripts/gate-self.js
 * Architecture Role: Self-hosted dogfooding gate; runs this engine's own analyzers over this
 *   repository's sources with the project config, then ratchets the result against a frozen
 *   grouped baseline so only NEW findings at/above the chosen severity can fail the build
 * Dependencies & Triggers: `npm run gate` / `gate:self`; requires a prior `npm run build`
 * Responsibilities: Scan `src/**\/*.ts` + `scripts/*.js` with `auto-refactor.config.json`,
 *   compare against `baselines/self-scan.baseline.json`, print a concise verdict (counts plus
 *   the new blocking findings), and propagate the CLI exit code; `--update` refreezes the
 *   baseline, `--severity <info|warning|error>` selects the blocking threshold
 * Exit Semantics & Design Rationale: 0 = no new blocking finding vs the baseline,
 *   1 = new blocking finding (or unreadable baseline), 2 = usage/precondition error.
 *   The grouped baseline is the ratchet: line shifts are tolerated, growth is not; existing
 *   debt stays visible in the report while every new finding must be justified or fixed.
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'dist', 'index.js');
const CONFIG = path.join(ROOT, 'auto-refactor.config.json');
const BASELINE = path.join(ROOT, 'baselines', 'self-scan.baseline.json');
const INCLUDE = 'src/**/*.ts,scripts/*.js';
// Kept outside the work tree: a gate must never leave artifacts that need ignore rules.
const REPORT = path.join(os.tmpdir(), `auto-refactor-self-scan-${process.pid}.json`);

const args = process.argv.slice(2);
const update = args.includes('--update');
const severityIndex = args.indexOf('--severity');
const severity = severityIndex >= 0 ? args[severityIndex + 1] : 'error';
if (!['info', 'warning', 'error'].includes(severity)) {
  process.stderr.write(`[gate:self] invalid --severity: ${severity}\n`);
  process.exit(2);
}

if (!fs.existsSync(CLI)) {
  process.stderr.write('[gate:self] dist/index.js missing — run "npm run build" first\n');
  process.exit(2);
}
if (!update && !fs.existsSync(BASELINE)) {
  process.stderr.write(
    `[gate:self] baseline missing: ${path.relative(ROOT, BASELINE)}\n` +
      '[gate:self] run "npm run gate:self:update" to freeze the current state first\n',
  );
  process.exit(2);
}
fs.mkdirSync(path.dirname(BASELINE), { recursive: true });

const cliArgs = [
  CLI,
  'scan',
  '--root',
  ROOT,
  '--config',
  CONFIG,
  '--include',
  INCLUDE,
  '--format',
  'json',
  '--out',
  REPORT,
  '--baseline-granularity',
  'grouped',
  '--no-cache',
  '--no-daemon',
  '--log-level',
  'warn',
];
if (update) {
  // A freeze is a review action: it records the current state and must not gate on it, or a
  // repository that legitimately carries existing error-severity debt could never refreeze.
  cliArgs.push('--update-baseline', BASELINE);
} else {
  cliArgs.push('--baseline', BASELINE, '--fail-on-severity', severity);
}

const result = spawnSync(process.execPath, cliArgs, { cwd: ROOT, stdio: 'inherit' });
if (result.error) {
  process.stderr.write(`[gate:self] failed to launch CLI: ${result.error.message}\n`);
  process.exit(2);
}
const code = result.status === null ? 2 : result.status;

// The machine-readable report carries the ratchet annotations; summarize it instead of dumping
// the full text report (the repository legitimately carries thousands of baselined findings).
let summary = null;
try {
  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const blocking = report.issues.filter(
    (issue) =>
      issue.isNew &&
      !issue.suppression &&
      ({ info: 0, warning: 1, error: 2 }[issue.severity] ?? 1) >=
        ({ info: 0, warning: 1, error: 2 }[severity] ?? 2),
  );
  summary = {
    files: report.summary.filesScanned,
    issues: report.summary.issuesTotal,
    suppressed: report.summary.suppressedCount ?? 0,
    newBlocking: blocking.length,
  };
  for (const issue of blocking.slice(0, 10)) {
    process.stdout.write(
      `[gate:self]   NEW ${issue.severity}: ${issue.analyzer}/${issue.rule} ` +
        `${issue.location.file}:${issue.location.start.line} — ${issue.message}\n`,
    );
  }
  if (blocking.length > 10) {
    process.stdout.write(`[gate:self]   … and ${blocking.length - 10} more new finding(s)\n`);
  }
} catch {
  /* ignore: report unreadable — fall through to the exit code alone */
}
fs.rmSync(REPORT, { force: true });

if (summary) {
  process.stdout.write(
    `[gate:self] files=${summary.files} issues=${summary.issues} ` +
      `suppressed=${summary.suppressed} newBlocking(${severity})=${summary.newBlocking}\n`,
  );
}
process.stdout.write(
  `[gate:self] ${update ? 'baseline updated' : `self-scan ratchet (severity=${severity})`} → ${code === 0 ? 'PASS' : 'FAIL'}\n`,
);
process.exit(code);
