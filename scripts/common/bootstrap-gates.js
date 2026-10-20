/**
 * Module: Gate Bootstrap — One-Command Local Gate Provisioning
 * File Path: scripts/common/bootstrap-gates.js
 * Architecture Role: Cross-platform provisioning entry that activates Git hooks and
 *   installs the build dependencies required by fail-closed gate checks.
 * Dependencies & Triggers: Consumes Node.js child_process plus npm/pwsh/bash on PATH;
 *   invoked by `npm run gate:bootstrap` or manually before first commit.
 * Responsibilities:
 *   1. Activate repository hooks through the platform-specific installer;
 *   2. Install missing dependencies for auto-refactor and workspace-timing;
 *   3. Build auto-refactor dist artifacts required by registry and AST checks;
 *   4. Report each provisioning step with explicit pass/fail semantics.
 * Exit Semantics & Design Rationale: 0 = hooks active and dependencies ready,
 *   1 = a provisioning step failed. Fail-fast prevents committing with a half-ready gate.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const IS_WINDOWS = process.platform === 'win32';
const NPM_COMMAND = IS_WINDOWS ? 'npm.cmd' : 'npm';

/**
 * Executes a command in the repository root and inherits stdio.
 *
 * @param {string} command - Executable name.
 * @param {string[]} args - Argument list.
 * @param {string} label - Human-readable step label.
 * @returns {boolean} True when the command exits successfully.
 */
function runStep(command, args, label) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit', shell: false });
  if (result.error) {
    console.error(`  FAIL ${label}: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`  FAIL ${label} (exit ${result.status})`);
    return false;
  }
  console.log(`  PASS ${label}`);
  return true;
}

/**
 * Resolves the hook installer command for the current platform.
 *
 * @returns {{command: string, args: string[]}|null} Installer invocation or null when unavailable.
 */
function resolveHookInstaller() {
  const ps1 = path.join(REPO_ROOT, 'scripts/ps1/install-hooks.ps1');
  const sh = path.join(REPO_ROOT, 'scripts/sh/install-hooks.sh');
  const hasPwsh = spawnSync(IS_WINDOWS ? 'pwsh.exe' : 'pwsh', ['-v'], { stdio: 'ignore' }).status === 0;
  if (hasPwsh && fs.existsSync(ps1)) {
    return { command: 'pwsh', args: ['-File', ps1] };
  }
  if (fs.existsSync(sh)) {
    return { command: 'bash', args: [sh] };
  }
  return null;
}

/**
 * Ensures a subproject has node_modules installed.
 *
 * @param {string} project - Subproject directory name.
 * @param {string[]} extraArgs - Additional npm arguments.
 * @returns {boolean} True when dependencies are present or installed successfully.
 */
function ensureDependencies(project, extraArgs = []) {
  const modulesDir = path.join(REPO_ROOT, project, 'node_modules');
  if (fs.existsSync(modulesDir)) {
    console.log(`\n✔ ${project} dependencies already present`);
    return true;
  }
  return runStep(NPM_COMMAND, ['ci', '--prefix', project, ...extraArgs], `Install ${project} dependencies`);
}

/**
 * Ensures auto-refactor compiled artifacts exist.
 *
 * @returns {boolean} True when dist is present or built successfully.
 */
function ensureAutoRefactorBuild() {
  const distDir = path.join(REPO_ROOT, 'auto-refactor', 'dist');
  if (fs.existsSync(distDir)) {
    console.log('\n✔ auto-refactor dist already present');
    return true;
  }
  return runStep(NPM_COMMAND, ['--prefix', 'auto-refactor', 'run', 'build'], 'Build auto-refactor dist');
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const installer = resolveHookInstaller();
  if (!installer) {
    console.error('FAIL No hook installer found under scripts/ps1 or scripts/sh');
    process.exit(1);
  }
  if (!runStep(installer.command, installer.args, 'Activate Git hooks')) process.exit(1);
  if (!ensureDependencies('auto-refactor', ['--legacy-peer-deps', '--ignore-scripts'])) process.exit(1);
  if (!ensureDependencies('workspace-timing', ['--ignore-scripts'])) process.exit(1);
  if (!ensureAutoRefactorBuild()) process.exit(1);

  console.log('\n✔ 门禁钩子激活完成。提交前可运行 `npm run gate:precommit` 预审。');
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({ resolveHookInstaller, ensureDependencies });
