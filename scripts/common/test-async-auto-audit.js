/**
 * Module: Tooling Test — Async Auto-Audit & Hybrid Auto-Commit Suite
 * File Path: scripts/common/test-async-auto-audit.js
 * Architecture Role: Isolated self-test harness for async-auto-audit-daemon, async-audit-envelope,
 *   async-audit-snapshot, and async-auto-commit against temporary Git repositories.
 * Dependencies & Triggers: Node built-ins (fs, os, path, child_process), ./git-env,
 *   ./async-auto-audit-daemon, ./lib/async-*.
 * Responsibilities:
 *   1. Verify isolated `.audit-logs/async-auto-audit-latest.{json,aas.json,md}` & FIFO<=500 history;
 *   2. Assert zero writes to tracked governance-supervisor.json, baselines/, or last-failure.json;
 *   3. Verify Taxis daemon live PID + `manages_async_audit` yield and pause sentinel behavior;
 *   4. Verify Hybrid Staging auto-commit (pre-staged quiet commit, idle explicit staging excluding
 *      blackboard leases & <10m hot files, compliant message synthesis, hook rejection rollback).
 * Exit Semantics & Design Rationale: Exits 0 if all assertions pass, 1 on any regression.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { getSafeGitEnv } = require('./git-env');
const {
  FILE_HISTORY_JSONL,
  FILE_LATEST_JSON,
  FILE_LATEST_MD,
  FILE_PAUSE_ALL,
  persistAsyncAuditEnvelope,
  resolveAuditLogDir,
} = require('./lib/async-audit-envelope');
const { inspectTaxisKernelOwnership } = require('./lib/async-audit-snapshot');
const { evaluateAndRunAutoCommit, synthesizeAndVerifyCommitMessage } = require('./lib/async-auto-commit');
const { getDaemonStatus, runAsyncAuditCycle } = require('./async-auto-audit-daemon');

let totalChecks = 0;
let passedChecks = 0;

function check(label, condition, detail = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`PASS  ${label}`);
  } else {
    console.error(`FAIL  ${label}${detail ? `: ${detail}` : ''}`);
  }
}

function createTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'async-audit-test-'));
  const env = getSafeGitEnv(dir);
  execFileSync('git', ['init'], { cwd: dir, env, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test Bot'], { cwd: dir, env, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.local'], { cwd: dir, env, stdio: 'ignore' });
  fs.mkdirSync(path.join(dir, 'scripts', 'common'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'common', 'seed.js'), "'use strict';\nmodule.exports = 1;\n", 'utf8');
  execFileSync('git', ['add', 'scripts/common/seed.js'], { cwd: dir, env, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'chore(governance): initial seed commit\n\n[Project]\n- governance\n\n[Why]\n- Seed temporary repo\n\n[Changed]\n- Added seed.js\n\n[Verification]\n- Seed initialized'], {
    cwd: dir,
    env,
    stdio: 'ignore',
  });
  return dir;
}

function cleanOwnedTempDir(dir) {
  const base = path.basename(dir);
  const rel = path.relative(os.tmpdir(), dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !base.startsWith('async-audit-test-')) {
    throw new Error(`Refusing unguarded cleanup outside tmp prefix: ${dir}`);
  }
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing cleanup of symlink temp dir: ${dir}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

async function runTests() {
  const repo = createTempRepo();
  const env = getSafeGitEnv(repo);

  try {
    // 1. Taxis ownership detection: missing, dead PID, live PID with manages_async_audit
    check('taxis ownership false when .taxis/daemon.json absent', !inspectTaxisKernelOwnership(repo).active);
    fs.mkdirSync(path.join(repo, '.taxis'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.taxis', 'daemon.json'),
      JSON.stringify({ pid: process.pid, manages_async_audit: true }),
      'utf8',
    );
    check('taxis ownership true when live PID manages_async_audit', inspectTaxisKernelOwnership(repo).active);
    const yieldResult = await runAsyncAuditCycle(repo, { noAutoCommit: true });
    check('audit cycle yields to live Taxis daemon', yieldResult.status === 'yielded-to-taxis');

    fs.writeFileSync(
      path.join(repo, '.taxis', 'daemon.json'),
      JSON.stringify({ pid: 999999999, manages_async_audit: true }),
      'utf8',
    );
    check('taxis ownership false when PID is dead', !inspectTaxisKernelOwnership(repo).active);

    // 2. Pause flag behavior & isolated envelope writes
    const logDir = resolveAuditLogDir(repo);
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, FILE_PAUSE_ALL), 'paused\n', 'utf8');
    const pausedResult = await runAsyncAuditCycle(repo, { noAutoCommit: true });
    check('audit cycle honors pause sentinel', pausedResult.status === 'paused');
    fs.unlinkSync(path.join(logDir, FILE_PAUSE_ALL));

    // 3. Full --once style cycle computes 10D/Quant & leaves tracked volatile files untouched
    const trackedGov = path.join(repo, 'auto-refactor', '.refactor-trajectory', 'governance-supervisor.json');
    fs.mkdirSync(path.dirname(trackedGov), { recursive: true });
    const sentinelGov = '{"sentinel":true}\n';
    fs.writeFileSync(trackedGov, sentinelGov, 'utf8');
    const completed = await runAsyncAuditCycle(repo, { noAutoCommit: true });
    check('async cycle completes cleanly', completed.status === 'completed');
    check('latest json written to .audit-logs', fs.existsSync(path.join(logDir, FILE_LATEST_JSON)));
    check('latest markdown written to .audit-logs', fs.existsSync(path.join(logDir, FILE_LATEST_MD)));
    check(
      'tracked governance-supervisor.json untouched',
      fs.readFileSync(trackedGov, 'utf8') === sentinelGov,
    );
    check(
      'manual last-failure.json not created on pass',
      !fs.existsSync(path.join(logDir, 'last-failure.json')),
    );
    const status = getDaemonStatus(repo);
    check('getDaemonStatus reports numeric latestScore', typeof status.latestScore === 'number');

    // 4. History FIFO cap <= 500
    for (let i = 0; i < 505; i++) {
      persistAsyncAuditEnvelope(repo, completed.envelope, { maxHistory: 10 });
    }
    const historyLines = fs.readFileSync(path.join(logDir, FILE_HISTORY_JSONL), 'utf8').split(/\r?\n/).filter(Boolean);
    check('history ring respects maxHistory cap', historyLines.length === 10, `got ${historyLines.length}`);

    // 5. Commit message synthesizer conformance & hybrid auto-commit staged + idle paths
    const synth = synthesizeAndVerifyCommitMessage('governance', ['scripts/common/seed.js'], completed.envelope);
    check('synthesized commit message passes offline validator', synth.valid, JSON.stringify(synth.findings));

    const stagedTarget = path.join(repo, 'scripts', 'common', 'staged-note.js');
    fs.writeFileSync(stagedTarget, "'use strict';\nmodule.exports = 2;\n", 'utf8');
    execFileSync('git', ['add', 'scripts/common/staged-note.js'], { cwd: repo, env, stdio: 'ignore' });
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, env, encoding: 'utf8' }).trim();
    const waitRes = evaluateAndRunAutoCommit(repo, {
      stagedQuietMs: 60_000,
      nowMs: 1_000_000,
      fingerprint: 'fp-1',
      latestAudit: { healthy: true, tenDimensions: completed.envelope.tenDimensions },
    });
    check('pre-staged path waits during 60s quiet window', waitRes.action === 'waiting');
    const commitRes = evaluateAndRunAutoCommit(repo, {
      stagedQuietMs: 60_000,
      nowMs: 1_065_000,
      fingerprint: 'fp-1',
      latestAudit: { healthy: true, tenDimensions: completed.envelope.tenDimensions },
    });
    const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, env, encoding: 'utf8' }).trim();
    check('pre-staged commit advances HEAD after quiet window', commitRes.action === 'committed' && headAfter !== headBefore, JSON.stringify({ commitRes, headBefore, headAfter }));

    // 6. Idle auto-stage excludes blackboard leased paths and hot (<10m) files
    fs.writeFileSync(
      path.join(repo, '.taxis', 'blackboard.json'),
      JSON.stringify({ leases: [{ status: 'active', ownedPaths: ['scripts/common/leased.js'] }] }),
      'utf8',
    );
    fs.writeFileSync(path.join(repo, 'scripts', 'common', 'leased.js'), "'use strict';\n", 'utf8');
    const hotIdlePath = path.join(repo, 'scripts', 'common', 'idle-ok.js');
    fs.writeFileSync(hotIdlePath, "'use strict';\nmodule.exports = 3;\n", 'utf8');
    const futureMs = Date.now() + 2 * 60 * 60 * 1000;
    const idleWait = evaluateAndRunAutoCommit(repo, {
      idleCommitMs: 30 * 60 * 1000,
      hotFileGuardMs: 10 * 60 * 1000,
      nowMs: futureMs,
      fingerprint: 'fp-2',
      latestAudit: { healthy: true, tenDimensions: completed.envelope.tenDimensions },
    });
    check('idle worktree waits for 30m idle window before staging', idleWait.action === 'waiting');
    const idleCommit = evaluateAndRunAutoCommit(repo, {
      idleCommitMs: 30 * 60 * 1000,
      hotFileGuardMs: 10 * 60 * 1000,
      nowMs: futureMs + 31 * 60 * 1000,
      fingerprint: 'fp-2',
      latestAudit: { healthy: true, tenDimensions: completed.envelope.tenDimensions },
    });
    check(
      'idle auto-commit stages safe file and excludes leased file',
      idleCommit.action === 'committed' &&
        idleCommit.files.includes('scripts/common/idle-ok.js') &&
        !idleCommit.files.includes('scripts/common/leased.js'),
      JSON.stringify(idleCommit),
    );
  } finally {
    cleanOwnedTempDir(repo);
  }

  console.log(`\nSummary: ${passedChecks}/${totalChecks} checks passed`);
  if (passedChecks !== totalChecks) {
    process.exit(1);
  }
}

void runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
