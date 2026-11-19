/**
 * Module: Tooling Library — Single-Step Failure Envelope Builder & CLI
 * File Path: scripts/common/lib/gate-envelope-cli.js
 * Architecture Role: Single-source constructor, atomic writer, and CLI handler for
 *   single-step GateFailureEnvelope payloads invoked by PowerShell and Bash gate runners.
 * Dependencies & Triggers: Pure Node.js built-ins (fs, path, crypto) and lazy
 *   ../gate-failure-contract helpers (stripAnsi, sanitizePath, ensureLf); invoked via
 *   scripts/common/gate-failure-contract.js --write-envelope.
 * Responsibilities:
 *   1. Normalize and sanitize single-step failure fields into GateFailureEnvelope JSON;
 *   2. Persist envelope atomically via PID-salted staged rename with UTF-8 no-BOM LF;
 *   3. Parse CLI flags (--gate, --step-id, --target-file, --out, --print, etc.).
 * Exit Semantics & Design Rationale: Pure library + CLI dispatcher; lazy contract lookup
 *   prevents circular require loops when re-exported from gate-failure-contract.js.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALUE_FLAG_MAP = Object.freeze({
  '--gate': 'gate',
  '--step-id': 'stepId',
  '--step-title': 'stepTitle',
  '--rule-id': 'ruleId',
  '--exit-code': 'exitCode',
  '--run-id': 'runId',
  '--command': 'command',
  '--summary': 'summary',
  '--actionable-fix': 'actionableFix',
  '--verify-cmd': 'verifyCmd',
  '--fast-recheck': 'fastRecheck',
  '--log-file': 'logFile',
  '--out': 'out',
});

let cachedContract = null;

/**
 * Resolves failure contract helpers lazily to avoid circular module initialization.
 *
 * @param {object} [deps] - Optional injected helper contract.
 * @returns {object} Contract exports containing stripAnsi, sanitizePath, ensureLf, and constants.
 */
function getContract(deps) {
  if (deps && typeof deps.stripAnsi === 'function') return deps;
  if (!cachedContract) {
    cachedContract = require('../gate-failure-contract');
  }
  return cachedContract;
}

/**
 * Strips ANSI escapes and sanitizes local drive-letter paths in text fields.
 *
 * @param {object} contract - Failure contract helpers.
 * @param {*} value - Raw field value.
 * @param {string} [fallback=''] - Default value when empty or nullish.
 * @returns {string} Sanitized string.
 */
function cleanText(contract, value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;
  return contract.sanitizePath(contract.stripAnsi(String(value)));
}

/**
 * Normalizes an exit code value into an integer, defaulting to 1.
 *
 * @param {*} raw - Numeric or string exit code.
 * @returns {number} Integer exit code.
 */
function parseExitCode(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
  if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) {
    return Number.parseInt(raw.trim(), 10);
  }
  return 1;
}

/**
 * Resolves default verification and fast-recheck commands for a gate entry.
 *
 * @param {string} gate - Gate identifier.
 * @returns {{ verify: string, recheck: string }} Default command pair.
 */
function resolveDefaultCommands(gate) {
  if (gate === 'commit-msg') {
    return {
      verify: 'pwsh -File scripts/ps1/commit-msg-gate.ps1',
      recheck: 'pwsh -File scripts/ps1/commit-msg-gate.ps1 -Agent <msg-file>',
    };
  }
  if (gate === 'audit-all') {
    return {
      verify: 'pwsh -File scripts/ps1/audit-all.ps1',
      recheck: 'pwsh -File scripts/ps1/audit-all.ps1 -Fast',
    };
  }
  return {
    verify: `pwsh -File scripts/ps1/${gate}-gate.ps1`,
    recheck: `pwsh -File scripts/ps1/${gate}-gate.ps1 -Agent`,
  };
}

/**
 * Builds a single-step Agent failure envelope matching buildAgentFailureEnvelope schema.
 *
 * @param {object} [options] - Single-step failure options.
 * @returns {object} Normalized GateFailureEnvelope object.
 */
function buildSingleStepFailureEnvelope(options = {}) {
  const opts = options || {};
  const contract = getContract(opts.contract);
  const gate = cleanText(contract, opts.gate, 'pre-commit') || 'pre-commit';
  const stepId = cleanText(contract, opts.stepId, `${gate}-unknown-step`) || `${gate}-unknown-step`;
  const stepTitle = cleanText(contract, opts.stepTitle, stepId) || stepId;
  const ruleId = cleanText(contract, opts.ruleId, 'GUARD-SYS-001') || 'GUARD-SYS-001';
  const exitCode = parseExitCode(opts.exitCode);
  const runId = cleanText(contract, opts.runId) || `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const recordedAt = cleanText(contract, opts.recordedAt) || new Date().toISOString();
  const command = cleanText(contract, opts.command);
  const verifyInput = cleanText(contract, opts.verifyCmd || opts.verificationCommand);
  const defaults = resolveDefaultCommands(gate);
  const failedCommand = command || verifyInput;
  const verificationCommand = verifyInput || command || defaults.verify;
  const fastRecheckCommand = cleanText(contract, opts.fastRecheck || opts.fastRecheckCommand) || defaults.recheck;
  const summary = cleanText(contract, opts.summary) || `${gate} gate check encountered violations (${stepId}).`;
  const actionableFix = cleanText(contract, opts.actionableFix) || 'Resolve reported errors.';
  const logFile = cleanText(contract, opts.logFile) || `.audit-logs/last-${gate}.log`;
  const rawTargets = Array.isArray(opts.targetFiles) ? opts.targetFiles : (opts.targetFile ? [opts.targetFile] : []);
  const targetFiles = rawTargets.map((item) => cleanText(contract, item)).filter(Boolean);

  return {
    protocolVersion: contract.PROTOCOL_VERSION,
    runId,
    recordedAt,
    status: contract.STATUS_BLOCK,
    gate,
    step: stepTitle,
    stepTitle,
    stepId,
    failedCommand,
    exitCode,
    summary,
    logFile,
    violations: [
      {
        ruleId,
        severity: contract.STATUS_BLOCK,
        file: targetFiles[0] || '.',
        message: summary,
        actionableFix,
        verificationCommand,
      },
    ],
    agentDirectives: {
      targetFiles,
      remediationPriority: [ruleId],
      verificationCommand,
      fastRecheckCommand,
    },
  };
}

/**
 * Atomically writes UTF-8 LF text via PID-salted sibling staged file and rename.
 *
 * @param {string} targetPath - Destination file path.
 * @param {string} content - UTF-8 LF payload.
 * @returns {void}
 */
function writeAtomicUtf8(targetPath, content) {
  const resolved = path.resolve(targetPath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const token = `${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  const stagedPath = path.join(dir, `.${path.basename(resolved)}.${token}.staged`);
  try {
    fs.writeFileSync(stagedPath, content, 'utf8');
    fs.renameSync(stagedPath, resolved);
  } catch (err) {
    if (fs.existsSync(stagedPath)) {
      try {
        fs.unlinkSync(stagedPath);
      } catch {
        // Ignore cleanup failure for ephemeral staged file
      }
    }
    throw err;
  }
}

/**
 * Builds and optionally persists a single-step failure envelope atomically.
 *
 * @param {object} [options] - Envelope options including optional `out` / `outFile`.
 * @returns {object} Constructed GateFailureEnvelope object.
 */
function writeSingleStepFailureEnvelope(options = {}) {
  const opts = options || {};
  const contract = getContract(opts.contract);
  const envelope = buildSingleStepFailureEnvelope(opts);
  const outPath = opts.out || opts.outFile || '';
  if (outPath) {
    const json = contract.ensureLf(JSON.stringify(envelope, null, 2));
    writeAtomicUtf8(String(outPath), json);
  }
  return envelope;
}

/**
 * Parses CLI flags for `--write-envelope`.
 *
 * @param {string[]} args - CLI arguments after `--write-envelope`.
 * @returns {object} Parsed options object.
 */
function parseEnvelopeArgs(args) {
  const opts = { targetFiles: [], print: false, noWrite: false };
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--print') {
      opts.print = true;
      continue;
    }
    if (token === '--no-write') {
      opts.noWrite = true;
      continue;
    }
    const eqIdx = token.indexOf('=');
    const flag = eqIdx > 0 ? token.slice(0, eqIdx) : token;
    const field = flag === '--target-file' ? 'targetFiles' : VALUE_FLAG_MAP[flag];
    if (!field) continue;
    const value = eqIdx > 0 ? token.slice(eqIdx + 1) : (i + 1 < args.length ? args[++i] : '');
    if (field === 'targetFiles') {
      if (value) opts.targetFiles.push(value);
    } else {
      opts[field] = value;
    }
  }
  return opts;
}

/**
 * Executes `--write-envelope` CLI dispatch, writing atomically and printing on `--print`.
 *
 * @param {string[]} args - CLI arguments after `--write-envelope`.
 * @returns {object} Constructed GateFailureEnvelope object.
 */
function runEnvelopeCli(args) {
  const opts = parseEnvelopeArgs(Array.isArray(args) ? args : []);
  if (!opts.out && !opts.noWrite) {
    opts.out = path.resolve(__dirname, '..', '..', '..', '.audit-logs', 'last-failure.json');
  }
  const envelope = writeSingleStepFailureEnvelope(opts);
  if (opts.print) {
    const contract = getContract(opts.contract);
    process.stdout.write(contract.ensureLf(JSON.stringify(envelope, null, 2)));
  }
  return envelope;
}

module.exports = Object.freeze({
  buildSingleStepFailureEnvelope,
  writeSingleStepFailureEnvelope,
  runEnvelopeCli,
});
