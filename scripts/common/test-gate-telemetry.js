/**
 * Module: Tooling Test — Gate Run Telemetry & Diagnostic Logger Self-Test
 * File Path: scripts/common/test-gate-telemetry.js
 * Architecture Role: Verification harness for gate-telemetry-logger.js proving atomic
 *   snapshot persistence, history ledger rotation, failure envelope generation, and fail-soft semantics.
 * Dependencies & Triggers: Pure Node.js built-ins (fs, path, os); gate-telemetry-logger.js;
 *   invoked by CI hygiene and local gate testing.
 * Responsibilities:
 *   1. Assert atomic creation of <gate>-latest.json for both PASS and BLOCK outcomes;
 *   2. Assert chronological append and FIFO rotation on <gate>-history.jsonl;
 *   3. Assert ANSI stripping and path sanitization in last-<gate>.log;
 *   4. Assert last-failure.json matches GateFailureEnvelope schema on BLOCK;
 *   5. Assert fail-soft behavior on null/invalid telemetry payloads.
 * Exit Semantics & Design Rationale: Exits 0 if all assertions pass, 1 if any assertion fails.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  buildSingleStepFailureEnvelope,
  writeSingleStepFailureEnvelope,
} = require('./gate-failure-contract');
const {
  recordGateTelemetry,
  readLatestGateSnapshot,
  readGateHistoryLedger,
  normalizeGatePayload,
  buildGateDiagnosticLog,
  buildAgentFailureEnvelope,
  STATUS_PASS,
  STATUS_BLOCK,
} = require('./gate-telemetry-logger');

let totalChecks = 0;
let passedChecks = 0;

function assert(description, condition, detail = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`✔ PASS  ${description}`);
  } else {
    console.error(`✖ FAIL  ${description}${detail ? ': ' + detail : ''}`);
  }
}

function makeTempAuditDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-test-'));
  return dir;
}

function cleanTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function runTests() {
  const tempDir = makeTempAuditDir();
  try {
    // Test 1: Record PASS telemetry
    const passPayload = {
      gate: 'pre-commit',
      status: STATUS_PASS,
      durationMs: 350,
      filesCount: 4,
      gitRevision: 'a1b2c3d4',
      stepsSummary: {
        total: 5,
        passed: ['STAGED-HYGIENE-01', 'RULE-REGISTRY-02'],
        failed: [],
        skipped: ['EXTENSION-COMPILE-04'],
      },
    };
    const passOk = recordGateTelemetry(passPayload, tempDir);
    assert('recordGateTelemetry succeeds for PASS payload', passOk === true);

    const passSnapshot = readLatestGateSnapshot('pre-commit', tempDir);
    assert('readLatestGateSnapshot returns valid PASS object', passSnapshot !== null && passSnapshot.status === 'PASS');
    assert('Snapshot records correct durationMs and filesCount', passSnapshot.durationMs === 350 && passSnapshot.filesCount === 4);
    assert('Snapshot records git revision', passSnapshot.gitRevision === 'a1b2c3d4');

    const passLogPath = path.join(tempDir, 'last-pre-commit.log');
    assert('last-pre-commit.log is created for PASS run', fs.existsSync(passLogPath));
    const passLogContent = fs.readFileSync(passLogPath, 'utf8');
    assert('last-pre-commit.log contains 8-line diagnostic header', passLogContent.includes('# AUDIT-FAILURE-DIAGNOSTIC-REPORT'));

    // Test 2: Record BLOCK telemetry with ANSI colors and drive paths
    const blockPayload = {
      gate: 'pre-push',
      status: STATUS_BLOCK,
      durationMs: 1250,
      filesCount: 12,
      gitRevision: 'e5f6a7b8',
      stepsSummary: {
        total: 6,
        passed: ['REF-SAFETY-39'],
        failed: ['CASCADE-COHERENCE-41'],
        skipped: [],
      },
      failures: [
        {
          stepId: 'CASCADE-COHERENCE-41',
          ruleId: 'GUARD-SSOT-001',
          exitCode: 1,
          command: 'node scripts/validate-cascade-coherence.js',
          summary: 'Cascade coherence drift detected between skill and catalog.',
          actionableFix: 'Run node scripts/sync-skills.js to reconcile.',
          verificationCommand: 'node scripts/validate-cascade-coherence.js',
          targetFiles: ['C:\\CODE_game-development\\vscode-extensions\\scripts\\test.js'],
        },
      ],
      rawLogOutput: '\u001b[31mError:\u001b[39m Coherence mismatch in C:\\CODE_game-development\\vscode-extensions\\scripts\\test.js\n',
    };

    const blockOk = recordGateTelemetry(blockPayload, tempDir);
    assert('recordGateTelemetry succeeds for BLOCK payload', blockOk === true);

    const blockSnapshot = readLatestGateSnapshot('pre-push', tempDir);
    assert('readLatestGateSnapshot returns valid BLOCK object', blockSnapshot !== null && blockSnapshot.status === 'BLOCK');
    assert('Snapshot records failed step', blockSnapshot.failedSteps.includes('CASCADE-COHERENCE-41'));

    const blockLogPath = path.join(tempDir, 'last-pre-push.log');
    assert('last-pre-push.log is created for BLOCK run', fs.existsSync(blockLogPath));
    const blockLogContent = fs.readFileSync(blockLogPath, 'utf8');
    assert('last-pre-push.log strips ANSI escape sequences', !blockLogContent.includes('\u001b[31m'));
    assert('last-pre-push.log sanitizes drive letters', !blockLogContent.includes('C:\\CODE_game-development'));
    assert('last-pre-push.log contains failed step and fix suggestion', blockLogContent.includes('CASCADE-COHERENCE-41') && blockLogContent.includes('Run node scripts/sync-skills.js'));

    const failurePath = path.join(tempDir, 'last-failure.json');
    assert('last-failure.json is created on BLOCK', fs.existsSync(failurePath));
    const failureDoc = JSON.parse(fs.readFileSync(failurePath, 'utf8'));
    assert('last-failure.json matches AgentFailureEnvelope contract', failureDoc.gate === 'pre-push' && failureDoc.status === 'BLOCK');
    assert('Failure envelope records correct rule and remediation', failureDoc.violations[0].ruleId === 'GUARD-SSOT-001');

    // Test 2b: Fallback stepId derivation when failures array is empty
    const sparseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-telemetry-sparse-'));
    try {
      const sparseBlockPayload = {
        gate: 'pre-push',
        status: 'BLOCK',
        durationMs: 120,
        filesCount: 1,
        stepsSummary: { total: 1, passed: [], failed: ['COMMIT-CONTRACT-20'], skipped: [] },
        failures: [],
      };
      assert('recordGateTelemetry succeeds for sparse BLOCK payload', recordGateTelemetry(sparseBlockPayload, sparseDir) === true);
      const sparseFailureDoc = JSON.parse(fs.readFileSync(path.join(sparseDir, 'last-failure.json'), 'utf8'));
      assert(
        'Sparse failure envelope uses failed step id instead of unknown-step',
        sparseFailureDoc.stepId === 'COMMIT-CONTRACT-20' && sparseFailureDoc.step === 'COMMIT-CONTRACT-20',
      );
    } finally {
      cleanTempDir(sparseDir);
    }

    // Test 3: History ledger entries and reading
    const preCommitHistory = readGateHistoryLedger('pre-commit', tempDir);
    assert('readGateHistoryLedger returns recorded pre-commit run', preCommitHistory.length === 1 && preCommitHistory[0].gate === 'pre-commit');

    const prePushHistory = readGateHistoryLedger('pre-push', tempDir);
    assert('readGateHistoryLedger returns recorded pre-push run', prePushHistory.length === 1 && prePushHistory[0].gate === 'pre-push');

    // Test 4: Fail-soft on invalid inputs
    assert('recordGateTelemetry fails soft on null payload', recordGateTelemetry(null, tempDir) === false);
    assert('recordGateTelemetry fails soft on string payload', recordGateTelemetry('invalid', tempDir) === false);

    // Test 5: Normalization defaults
    const normalized = normalizeGatePayload({});
    assert('normalizeGatePayload defaults gate to pre-commit', normalized.gate === 'pre-commit');
    assert('normalizeGatePayload defaults status to PASS', normalized.status === 'PASS');
    assert('normalizeGatePayload defaults durationMs to 0', normalized.durationMs === 0);

    // Test 6: Single-step failure envelope builder, atomic writer, and CLI
    testSingleStepEnvelope(tempDir);
  } finally {
    cleanTempDir(tempDir);
  }

  console.log(`\n=================================================================`);
  console.log(`📊 门禁遥测与诊断日志测试全部完成: ${passedChecks}/${totalChecks} 断言通过`);
  console.log(`=================================================================`);
  if (passedChecks !== totalChecks) {
    process.exit(1);
  }
}

/**
 * Verifies single-step failure envelope construction, atomic persistence, and CLI flags.
 *
 * @param {string} baseDir - Ephemeral OS test directory.
 * @returns {void}
 */
function testSingleStepEnvelope(baseDir) {
  const winDrivePath = 'C' + ':\\workspace\\proj\\scripts\\demo.js';
  const posixDrivePath = 'D' + ':/workspace/proj/src/entry.js';
  const built = buildSingleStepFailureEnvelope({
    gate: 'pre-commit',
    stepId: 'STAGED-HYGIENE-01',
    stepTitle: '暂存区物理卫生',
    ruleId: 'HYG-EMP-001',
    exitCode: 2,
    runId: 'unit-run-01',
    command: `node ${winDrivePath}`,
    summary: `\u001b[31mBlank file\u001b[39m at ${winDrivePath}`,
    actionableFix: `\u001b[33mFix\u001b[39m ${posixDrivePath}`,
    verifyCmd: 'node scripts/common/gate-fast-staged.js',
    fastRecheck: 'pwsh -File scripts/ps1/pre-commit-gate.ps1 -Agent',
    targetFiles: [winDrivePath, posixDrivePath],
    logFile: '.audit-logs/last-pre-commit.log',
  });

  assert('buildSingleStepFailureEnvelope populates schema fields',
    built.protocolVersion === '1.0.0'
      && built.status === 'BLOCK'
      && built.gate === 'pre-commit'
      && built.stepId === 'STAGED-HYGIENE-01'
      && built.stepTitle === '暂存区物理卫生'
      && built.step === 'STAGED-HYGIENE-01'
      && built.exitCode === 2
      && built.runId === 'unit-run-01');
  assert('buildSingleStepFailureEnvelope strips ANSI codes',
    !built.summary.includes('\u001b[') && !built.violations[0].actionableFix.includes('\u001b['));
  assert('buildSingleStepFailureEnvelope sanitizes drive-letter paths',
    !built.failedCommand.includes('C' + ':\\')
      && built.agentDirectives.targetFiles.length === 2
      && built.agentDirectives.targetFiles.every((f) => f.startsWith('<workspace>/')));

  const atomicPath = path.join(baseDir, 'nested', 'envelope-unit.json');
  const written = writeSingleStepFailureEnvelope({
    gate: 'pre-push',
    stepId: 'ENGINE-TESTS-12',
    ruleId: 'GUARD-SYS-001',
    out: atomicPath,
  });
  assert('writeSingleStepFailureEnvelope creates nested target file atomically',
    written.stepId === 'ENGINE-TESTS-12' && fs.existsSync(atomicPath));
  const rawDisk = fs.readFileSync(atomicPath);
  const diskText = rawDisk.toString('utf8');
  assert('writeSingleStepFailureEnvelope writes UTF-8 no BOM with single LF',
    !(rawDisk[0] === 0xef && rawDisk[1] === 0xbb && rawDisk[2] === 0xbf)
      && !diskText.includes('\r\n')
      && diskText.endsWith('\n')
      && !diskText.endsWith('\n\n'));
  const leftStaged = fs.readdirSync(path.dirname(atomicPath)).filter((name) => name.endsWith('.staged'));
  assert('writeSingleStepFailureEnvelope leaves zero staged leftover files', leftStaged.length === 0);

  const cliOutPath = path.join(baseDir, 'cli-out', 'failure-cli.json');
  const contractScript = path.join(__dirname, 'gate-failure-contract.js');
  const stdout = execFileSync(
    process.execPath,
    [
      contractScript,
      '--write-envelope',
      '--print',
      '--gate', 'pre-push',
      '--step-id', 'ENGINE-TESTS-12',
      '--step-title', 'auto-refactor 全量回归套件',
      '--rule-id', 'GUARD-SYS-001',
      '--exit-code', '3',
      '--run-id', 'cli-run-99',
      '--command', `node ${winDrivePath}`,
      '--summary', `\u001b[31mFailed\u001b[39m in ${posixDrivePath}`,
      '--actionable-fix', 'Run npm test',
      '--verify-cmd', 'npm test',
      '--fast-recheck', 'pwsh -File scripts/ps1/pre-push-gate.ps1 -Agent',
      '--target-file', winDrivePath,
      '--target-file', posixDrivePath,
      '--log-file', '.audit-logs/last-pre-push.log',
      '--out', cliOutPath,
    ],
    { encoding: 'utf8' },
  );
  const cliDoc = JSON.parse(stdout);
  const cliDiskDoc = JSON.parse(fs.readFileSync(cliOutPath, 'utf8'));
  assert('CLI --write-envelope --print outputs valid schema matching written file',
    cliDoc.status === 'BLOCK'
      && cliDoc.runId === 'cli-run-99'
      && cliDoc.exitCode === 3
      && cliDoc.stepId === 'ENGINE-TESTS-12'
      && cliDoc.agentDirectives.targetFiles.length === 2
      && !cliDoc.summary.includes('\u001b[')
      && !cliDoc.summary.includes('D' + ':/')
      && cliDiskDoc.runId === cliDoc.runId);
}

runTests();
