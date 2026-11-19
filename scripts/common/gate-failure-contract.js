/**
 * Module: Governance Guard — Workspace Gate Failure Contract & Naming Topology
 * File Path: scripts/common/gate-failure-contract.js
 * Architecture Role: Single source of truth for failure diagnostic naming topology,
 *   physical hygiene formatting (LF, UTF-8, ANSI stripping), metadata headers,
 *   and structured failure envelope schemas across PowerShell and Bash audit runners.
 * Dependencies & Triggers: Pure Node.js built-ins (path, os); consumed by audit-all,
 *   log-rotator.js, and record-workspace-audit.js.
 * Responsibilities:
 *   1. Enforce strict EBNF naming topology for failure logs and watchdog timeouts.
 *   2. Generate standardized 8-field metadata headers for raw diagnostic logs.
 *   3. Enforce payload physical hygiene: strip ANSI, sanitize absolute paths, guarantee single EOF LF.
 *   4. Construct and validate Agent-Native GateFailureEnvelope structures.
 * Exit Semantics & Design Rationale: Pure library functions, non-throwing validators,
 *   deterministic regex matching. CC <= 10, Depth <= 3.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildSingleStepFailureEnvelope,
  writeSingleStepFailureEnvelope,
  runEnvelopeCli,
} = require('./lib/gate-envelope-cli');

const PROTOCOL_VERSION = '1.0.0';
const AUDIT_FAILURE_SNAPSHOT_NAME = 'audit-failure-latest.json';
const FAILURES_SUBDIR = 'failures';
const TIMEOUTS_SUBDIR = 'timeouts';

const STATUS_PASS = 'PASS';
const STATUS_BLOCK = 'BLOCK';
const STATUS_SKIP = 'SKIP';
const STATUS_WARN = 'WARN';

const STATUS_VOCABULARY = Object.freeze([
  STATUS_PASS,
  STATUS_BLOCK,
  STATUS_SKIP,
  STATUS_WARN,
]);

const VALID_PILLAR_IDS = Object.freeze([
  'hygiene-01',
  'rules-02',
  'timing-03',
  'webgames-04',
  'engine-05',
  'rust-06',
]);

const VALID_AAS_LAYERS = Object.freeze([
  'L1_CONTRACT',
  'L2_PHYSICAL',
  'L3_COMPLEXITY',
  'L4_QUALITY',
  'L5_GOVERNANCE',
]);

const VALID_STREAM_TYPES = Object.freeze(['out', 'err']);

/** Regular expression used to strip ANSI escape codes when writing to log files. */
const ANSI_ESCAPE_REGEX = /\u001b\[[0-9;]*m/g;

/** File system absolute drive letter pattern across lines and messages */
const DRIVE_PATH_REGEX = /[a-zA-Z]:[\\/][^ \r\n\t"']+/g;

/** Strict regex for failure log filenames */
const FAILURE_LOG_REGEX =
  /^fail-(?:hygiene-01|rules-02|timing-03|webgames-04|engine-05|rust-06)-[a-z0-9-]+-\d{8}-\d{6}(?:-\d{2})?\.(?:out|err)\.log$/;

/** Strict regex for watchdog timeout filenames */
const TIMEOUT_LOG_REGEX =
  /^timeout-(?:audit-all|pre-commit|pre-push)-[a-z0-9-]+-\d{8}-\d{6}\.log$/;

/** Strict regex for singleton snapshot filenames */
const SNAPSHOT_REGEX = /^[a-z0-9-]+-latest\.(?:json|aas\.json|md)$/;

/**
 * Strips ANSI terminal color escapes from a raw string.
 *
 * @param {string} text - Raw input string.
 * @returns {string} Clean string without ANSI sequences.
 */
function stripAnsi(text) {
  if (typeof text !== 'string') return '';
  return text.replace(ANSI_ESCAPE_REGEX, '');
}

/**
 * Normalizes absolute local drive paths to repository-relative representation.
 *
 * @param {string} value - Raw path or text containing paths.
 * @returns {string} Sanitized string with workspace tokens.
 */
function sanitizePath(value) {
  if (typeof value !== 'string') return '';
  return value.replace(DRIVE_PATH_REGEX, (match) => {
    const norm = match.replace(/\\/g, '/');
    return norm.replace(/^[a-zA-Z]:\/[^/]+\/[^/]+\//, '<workspace>/');
  });
}

/**
 * Ensures text uses standard UNIX LF (\n) and terminates with a single EOF LF.
 *
 * @param {string} text - Raw input string.
 * @returns {string} Clean text with pure LF and exactly one trailing LF.
 */
function ensureLf(text) {
  if (typeof text !== 'string') return '\n';
  const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const trimmedEnd = clean.replace(/\n+$/, '');
  return trimmedEnd.length > 0 ? `${trimmedEnd}\n` : '\n';
}

/**
 * Checks if a filename adheres to the strict failure diagnostic log naming contract.
 *
 * @param {string} fileName - Base name of target file.
 * @returns {boolean} True if matching naming topology.
 */
function isValidFailureLogName(fileName) {
  return typeof fileName === 'string' && FAILURE_LOG_REGEX.test(fileName);
}

/**
 * Checks if a filename adheres to the strict timeout log naming contract.
 *
 * @param {string} fileName - Base name of target file.
 * @returns {boolean} True if matching naming topology.
 */
function isValidTimeoutLogName(fileName) {
  return typeof fileName === 'string' && TIMEOUT_LOG_REGEX.test(fileName);
}

/**
 * Formats a timestamp into a compact YYYYMMDD-HHmmss representation.
 *
 * @param {Date|string|number} [dateInput] - Optional date input, defaults to now.
 * @returns {string} Formatted timestamp.
 */
function formatCompactTimestamp(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const min = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

/**
 * Generates a compliant failure log filename adhering to the four-part topology.
 *
 * @param {object} params - Parameters object.
 * @param {string} params.pillarId - One of VALID_PILLAR_IDS.
 * @param {string} params.stepId - Unique step kebab-case identifier.
 * @param {string} [params.stream='err'] - 'out' or 'err'.
 * @param {string} [params.timestamp] - Compact timestamp, defaults to now.
 * @param {string|number} [params.seqId] - Optional sequence collision id (01-99).
 * @returns {string} Normalized filename.
 */
function buildFailureLogFileName(params) {
  const pillarId = (params.pillarId || 'engine-05').toLowerCase();
  const stepId = (params.stepId || 'unknown-step').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const stream = params.stream === 'out' ? 'out' : 'err';
  const ts = params.timestamp || formatCompactTimestamp();
  const seqSuffix = params.seqId != null ? `-${String(params.seqId).padStart(2, '0')}` : '';

  const fileName = `fail-${pillarId}-${stepId}-${ts}${seqSuffix}.${stream}.log`;
  if (!FAILURE_LOG_REGEX.test(fileName)) {
    // Fallback safe normalization if stepId was corrupted
    const safeStep = 'step';
    return `fail-${pillarId}-${safeStep}-${ts}.${stream}.log`;
  }
  return fileName;
}

/**
 * Generates the standardized 8-line metadata header block for raw diagnostic logs.
 *
 * @param {object} params - Header parameters.
 * @returns {string} Clean header text ending in LF.
 */
function buildFailureLogHeader(params) {
  const pillar = params.pillarId || 'UNKNOWN-PILLAR';
  const stepId = params.stepId || 'unknown-step';
  const ruleId = params.ruleId || 'GUARD-SYS-001';
  const command = sanitizePath(params.command || 'unknown-command');
  const workingDir = sanitizePath(params.workingDir || '.');
  const exitCode = Number.isInteger(params.exitCode) ? params.exitCode : 1;
  const elapsedMs = Number.isFinite(params.elapsedMs) ? Math.round(params.elapsedMs) : 0;
  const recordedAt = params.recordedAt || new Date().toISOString();
  const gitRev = params.gitRevision || '00000000';
  const platform = `${os.platform()}-${os.arch()}`;

  const lines = [
    '# ==============================================================================',
    '# AUDIT-FAILURE-DIAGNOSTIC-REPORT',
    `# Pillar:        ${pillar}`,
    `# StepId:        ${stepId}`,
    `# RuleId:        ${ruleId}`,
    `# Command:       ${command}`,
    `# WorkingDir:    ${workingDir}`,
    `# ExitCode:      ${exitCode}`,
    `# ElapsedMs:     ${elapsedMs}`,
    `# RecordedAt:    ${recordedAt} (Git: ${gitRev})`,
    `# Platform:      ${platform}`,
    '# ==============================================================================',
    `# --- [DIAGNOSTIC LOG STREAM BEGIN: ${params.stream === 'out' ? 'STDOUT' : 'STDERR'}] ---`,
  ];

  return lines.join('\n') + '\n';
}

/**
 * Constructs a fully normalized GateFailureEnvelope adhering to JSON Schema.
 *
 * @param {object} params - Envelope parameters.
 * @returns {object} Validated failure envelope object.
 */
function buildFailureEnvelope(params) {
  const recordedAt = params.recordedAt || new Date().toISOString();
  const gitRevision = (params.gitRevision || '00000000').slice(0, 8);
  const elapsedSeconds = Number.isFinite(params.elapsedSeconds) ? Number(params.elapsedSeconds.toFixed(2)) : 0;
  const failuresInput = Array.isArray(params.failures) ? params.failures : [];

  const failures = failuresInput.map((f, idx) => {
    const pillarId = String(f.pillarId || `PILLAR-${idx + 1}`);
    const stepName = String(f.stepName || f.stepId || 'Unknown Step');
    const stepId = String(f.stepId || `step-${idx + 1}`).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const exitCode = Number.isInteger(f.exitCode) ? f.exitCode : 1;
    const command = sanitizePath(String(f.command || ''));
    const logFilePath = f.logFilePath ? sanitizePath(String(f.logFilePath)) : undefined;
    const errorSummary = stripAnsi(String(f.errorSummary || 'Step execution returned non-zero exit code.'));
    const errorStackSnippet = ensureLf(stripAnsi(sanitizePath(String(f.errorStackSnippet || ''))));
    const targetFiles = Array.isArray(f.targetFiles) ? f.targetFiles.map((p) => sanitizePath(String(p))) : [];
    const violationRules = Array.isArray(f.violationRules) ? f.violationRules.map(String) : [];
    const aasLayer = VALID_AAS_LAYERS.includes(f.aasLayer) ? f.aasLayer : 'L1_CONTRACT';
    const actionableFix = stripAnsi(String(f.actionableFix || 'Inspect the failure output and resolve the reported errors.'));
    const verificationCommand = sanitizePath(String(f.verificationCommand || command));

    return {
      pillarId,
      stepName,
      stepId,
      exitCode,
      command,
      ...(logFilePath ? { logFilePath } : {}),
      errorSummary,
      errorStackSnippet,
      targetFiles,
      violationRules,
      aasLayer,
      actionableFix,
      verificationCommand,
    };
  });

  const uniquePillars = new Set(failures.map((f) => f.pillarId));
  const allVerificationCommands = Array.from(new Set(failures.map((f) => f.verificationCommand).filter(Boolean)));
  const primaryPillar = failures.length > 0 ? failures[0].pillarId : 'NONE';
  const quickRecheckCommand = 'pwsh -File scripts/ps1/audit-all.ps1 -Fast';

  return {
    protocolVersion: PROTOCOL_VERSION,
    recordedAt,
    gitRevision,
    status: STATUS_BLOCK,
    elapsedSeconds,
    failedPillarsCount: uniquePillars.size,
    totalStepsFailed: failures.length,
    failures,
    agentDirectives: {
      primaryRemediationPillar: primaryPillar,
      allVerificationCommands,
      quickRecheckCommand,
    },
  };
}

/**
 * Persists a standardized failure diagnostic log file with compliant 8-field header and ANSI-stripped body.
 *
 * @param {string} destFilePath - Target log file destination path.
 * @param {object} headerParams - Metadata parameters for Header block.
 * @param {string} [rawLogPath] - Path to raw temporary output file.
 * @returns {boolean} True on success.
 */
function writeDiagnosticLogFile(destFilePath, headerParams, rawLogPath) {
  try {
    const dir = path.dirname(destFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const header = buildFailureLogHeader(headerParams);
    let body = '\n';
    if (rawLogPath && fs.existsSync(rawLogPath)) {
      const raw = fs.readFileSync(rawLogPath, 'utf8');
      body = ensureLf(stripAnsi(raw));
    }
    const finalContent = header + body;
    fs.writeFileSync(destFilePath, finalContent, 'utf8');
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  PROTOCOL_VERSION,
  AUDIT_FAILURE_SNAPSHOT_NAME,
  FAILURES_SUBDIR,
  TIMEOUTS_SUBDIR,
  STATUS_PASS,
  STATUS_BLOCK,
  STATUS_SKIP,
  STATUS_WARN,
  STATUS_VOCABULARY,
  VALID_PILLAR_IDS,
  VALID_AAS_LAYERS,
  VALID_STREAM_TYPES,
  FAILURE_LOG_REGEX,
  TIMEOUT_LOG_REGEX,
  SNAPSHOT_REGEX,
  stripAnsi,
  sanitizePath,
  ensureLf,
  isValidFailureLogName,
  isValidTimeoutLogName,
  formatCompactTimestamp,
  buildFailureLogFileName,
  buildFailureLogHeader,
  buildFailureEnvelope,
  writeDiagnosticLogFile,
  buildSingleStepFailureEnvelope,
  writeSingleStepFailureEnvelope,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--write-log' && args[1] && args[2]) {
    const dest = args[1];
    let headerParams = {};
    try {
      headerParams = JSON.parse(args[2]);
    } catch {
      headerParams = {};
    }
    const rawPath = args[3] || '';
    const ok = writeDiagnosticLogFile(dest, headerParams, rawPath);
    process.exit(ok ? 0 : 1);
  }
  if (args[0] === '--write-envelope') {
    try {
      runEnvelopeCli(args.slice(1));
      process.exit(0);
    } catch (err) {
      process.stderr.write(`✖ [Gate-Envelope] ${err.message}\n`);
      process.exit(1);
    }
  }
}
