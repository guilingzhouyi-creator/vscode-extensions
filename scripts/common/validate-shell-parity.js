/**
 * Module: Shell Parity Guard — Linux Command Surface Verification
 * File Path: scripts/common/validate-shell-parity.js
 * Architecture Role: Executable contract check that proves the Linux command surface
 *   documented in AGENTS.md actually resolves to a working implementation on this host,
 *   instead of trusting a prose claim.
 * Dependencies & Triggers: Node.js standard libraries (child_process, fs, path);
 *   invoked by pre-push gate, audit-all and CI, or manually as `node scripts/common/validate-shell-parity.js`.
 * Responsibilities:
 *   1. Assert the parity library exists and declares both GNU and native fallback paths;
 *   2. Assert every command named in AGENTS.md is present in the library binding table;
 *   3. Probe the resolved command surface through pwsh and report the active mode;
 *   4. Reject documentation that promises commands the library cannot bind.
 * Exit Semantics & Design Rationale: 0 = documented surface matches the bindable surface,
 *   1 = drift detected or probe failed. The guard exists because the previous AGENTS.md
 *   promised a toolchain that was never installed, and prose cannot be regression-tested.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const PARITY_LIB = path.join(REPO_ROOT, 'scripts/ps1/lib/linux-parity.ps1');
const AGENTS_MD = path.join(REPO_ROOT, 'AGENTS.md');

/**
 * Commands AGENTS.md promises must be bindable. Kept as an explicit list rather than a regex
 * sweep so adding a promise to the document requires adding it here, which is the point.
 */
const DOCUMENTED_COMMANDS = Object.freeze([
  'rg', 'fd', 'bat', 'sd', 'jq', 'yq',
  'grep', 'find', 'ls', 'cat', 'head', 'tail', 'wc', 'sort', 'uniq',
  'sed', 'awk', 'cut', 'tr', 'diff', 'xargs', 'env', 'date', 'true', 'false',
  'mkdir', 'rm', 'cp', 'mv', 'touch', 'test', 'which', 'basename', 'dirname', 'seq',
]);

/**
 * Collects a finding.
 *
 * @param {Array<{kind: string, detail: string}>} findings - Accumulator.
 * @param {string} kind - Finding category.
 * @param {string} detail - Human-readable explanation.
 * @returns {void}
 */
function addFinding(findings, kind, detail) {
  findings.push({ kind, detail });
}

/**
 * Verifies the parity library declares a binding entry for every documented command.
 *
 * @param {string} source - Parity library source text.
 * @param {Array<{kind: string, detail: string}>} findings - Accumulator.
 * @returns {void}
 */
function auditBindingTable(source, findings) {
  for (const command of DOCUMENTED_COMMANDS) {
    const gnuPattern = new RegExp(`'${command}'\\s*=\\s*'${command}\\.exe'`);
    const bridgePattern = new RegExp(`function global:${command}\\b`);
    const modernPattern = new RegExp(`'${command}'\\s*=\\s*'${command}'`);
    const covered = gnuPattern.test(source) || bridgePattern.test(source) || modernPattern.test(source);
    if (!covered) {
      addFinding(findings, 'UNBOUND_COMMAND', `AGENTS.md promises '${command}' but the parity library has no binding for it`);
    }
  }
}

/**
 * Verifies the parity library declares both resolution paths.
 *
 * @param {string} source - Parity library source text.
 * @param {Array<{kind: string, detail: string}>} findings - Accumulator.
 * @returns {void}
 */
function auditResolutionPaths(source, findings) {
  if (!/function Resolve-LinuxParityGnuRoot/.test(source)) {
    addFinding(findings, 'MISSING_GNU_PATH', 'parity library must resolve a GNU coreutils root');
  }
  if (!/function Register-LinuxParityFallback/.test(source)) {
    addFinding(findings, 'MISSING_FALLBACK_PATH', 'parity library must provide a PowerShell-native fallback path');
  }
  if (!/function Test-LinuxParityRestrictedHost/.test(source)) {
    addFinding(findings, 'MISSING_RESTRICTED_PROBE', 'parity library must detect restricted (sandboxed) hosts');
  }
  if (!/function Test-LinuxParityGnuExecutable/.test(source)) {
    addFinding(
      findings,
      'MISSING_EXEC_PROBE',
      'parity library must verify the GNU sentinel actually executes; directory presence is not evidence',
    );
  }
  if (!/Remove-Item -LiteralPath "Alias:\$Name" -Force/.test(source)) {
    addFinding(findings, 'MISSING_ALIAS_FORCE', 'alias removal must use -Force; several Linux-named aliases are read-only');
  }
  if (!/MyInvocation\.ExpectingInput/.test(source)) {
    addFinding(findings, 'MISSING_PIPE_PROBE', 'pipeline detection must use $MyInvocation.ExpectingInput; `if ($input)` blocks on stdin');
  }
}

/**
 * Runs the parity library through pwsh and reports the resolved mode.
 *
 * The probe asserts three independent facts so the report cannot be satisfied by a
 * declaration alone: the executability probe exists, it agrees with the mode, and the
 * assembled surface actually binds a command. A reachable-but-unexecutable GNU root is
 * the exact failure this guard was written for, and it is invisible to a file-existence
 * check.
 *
 * @param {Array<{kind: string, detail: string}>} findings - Accumulator.
 * @returns {string|null} Resolved mode, or null when the probe failed.
 */
function probeRuntimeMode(findings) {
  const script = [
    `. '${PARITY_LIB.replace(/\\/g, '/')}'`,
    '$summary = Initialize-LinuxParity -Quiet',
    'Write-Output ("MODE=" + $summary.Mode)',
    'Write-Output ("REGISTERED=" + $summary.Registered.Count)',
    'Write-Output ("MISSING=" + $summary.Missing.Count)',
    '$root = Resolve-LinuxParityGnuRoot',
    'if ($root) { Write-Output ("EXECUTABLE=" + (Test-LinuxParityGnuExecutable -GnuRoot $root)) } else { Write-Output "EXECUTABLE=absent" }',
    'Write-Output ("RESTRICTED=" + (Test-LinuxParityRestrictedHost))',
    'Write-Output ("SENTINEL=" + $(if ($summary.Registered.Count -gt 0) { $summary.Registered[0] } else { "" }))',
  ].join('; ');

  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });

  if (result.error) {
    addFinding(findings, 'PROBE_FAILED', `pwsh probe could not start: ${result.error.message}`);
    return null;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(0, 4).join(' ');
    addFinding(findings, 'PROBE_FAILED', `pwsh probe exited ${result.status}: ${detail}`);
    return null;
  }

  const output = result.stdout || '';
  const mode = /MODE=(\S+)/.exec(output);
  const registered = /REGISTERED=(\d+)/.exec(output);
  const executable = /EXECUTABLE=(\S+)/.exec(output);
  if (!mode) {
    addFinding(findings, 'PROBE_FAILED', 'pwsh probe produced no mode line');
    return null;
  }
  if (registered && Number(registered[1]) === 0) {
    addFinding(findings, 'EMPTY_SURFACE', 'parity library registered zero commands');
  }
  // A `gnu` verdict must be backed by a sentinel that really ran; otherwise the report is
  // asserting capability that the host does not have. `absent` is equally disqualifying:
  // no probe ran at all, so nothing backs the claim.
  if (mode[1] === 'gnu' && (!executable || executable[1] !== 'True')) {
    const observed = executable ? executable[1] : 'no-probe';
    addFinding(
      findings,
      'FAIL_OPEN_MODE',
      `mode reported 'gnu' but the sentinel did not execute (EXECUTABLE=${observed})`,
    );
  }
  return mode[1];
}

/**
 * Verifies AGENTS.md actually documents the parity contract.
 *
 * @param {string} agentsText - AGENTS.md content.
 * @param {Array<{kind: string, detail: string}>} findings - Accumulator.
 * @returns {void}
 */
function auditAgentsDocument(agentsText, findings) {
  const required = [
    { pattern: /linux-parity\.ps1/, label: 'parity library path' },
    { pattern: /别名优先级|别名 > 函数/, label: 'alias precedence rule' },
    { pattern: /2>\$null/, label: 'stderr redirect mapping' },
    { pattern: /LINUX_PARITY_GNU_ROOT/, label: 'forced-fallback switch' },
  ];
  for (const item of required) {
    if (!item.pattern.test(agentsText)) {
      addFinding(findings, 'DOC_GAP', `AGENTS.md must document the ${item.label}`);
    }
  }
}

/**
 * Main entrypoint.
 *
 * @returns {number} Process exit code.
 */
function main() {
  const findings = [];

  if (!fs.existsSync(PARITY_LIB)) {
    console.error(`BLOCK  shell-parity  parity library missing: ${path.relative(REPO_ROOT, PARITY_LIB)}`);
    return 1;
  }
  const source = fs.readFileSync(PARITY_LIB, 'utf8');
  auditBindingTable(source, findings);
  auditResolutionPaths(source, findings);

  if (fs.existsSync(AGENTS_MD)) {
    auditAgentsDocument(fs.readFileSync(AGENTS_MD, 'utf8'), findings);
  } else {
    addFinding(findings, 'DOC_GAP', 'AGENTS.md is missing');
  }

  const mode = probeRuntimeMode(findings);

  if (findings.length > 0) {
    console.error(`BLOCK  shell-parity  ${findings.length} finding(s)`);
    for (const item of findings) {
      console.error(`  - [${item.kind}] ${item.detail}`);
    }
    return 1;
  }

  console.log(`PASS  shell-parity  mode=${mode}, documented commands bindable`);
  return 0;
}

process.exit(main());
