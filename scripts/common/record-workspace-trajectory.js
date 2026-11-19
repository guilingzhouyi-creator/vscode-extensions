/**
 * Module: Tooling — Workspace Trajectory Accumulator & Recorder
 * File Path: scripts/common/record-workspace-trajectory.js
 * Architecture Role: Records multi-project audit-all quality results into the unified
 *   long-term .refactor-trajectory ledger, ensuring cross-project trajectory continuity.
 * Dependencies & Triggers: Consumes baseline reports, Git commit HEAD, and active runs;
 *   invoked by audit-all.ps1 and audit-all.sh at conclusion of review.
 * Responsibilities:
 *   1. Assemble compact trajectory run entry adhering to <350B byte envelope;
 *   2. Append atomically to active-runs.ndjson ledger;
 *   3. Enforce rotating archive window and update lifetime summary statistics.
 * Exit Semantics & Design Rationale: Exits 0 on successful ledger append, 1 on severe failure.
 *   Guarantees long-term immutable record of workspace quality trajectory without unbounded storage growth.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MAX_RECORD_BYTE_SIZE = 350;
const DEFAULT_MAX_ROLLING_RUNS = 100;

function safeReadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

const TEN_DIMENSIONS_CONTRACT = require('./ten-dimensions-contract.json');
const CANONICAL_DIMENSIONS = Object.freeze(
  TEN_DIMENSIONS_CONTRACT.dimensions.map((dimension) => dimension.key),
);

function resolveLedgerDir(root) {
  const candidates = [
    path.join(root, 'auto-refactor', '.refactor-trajectory'),
    path.join(root, '.refactor-trajectory'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function readRefFromPacked(gitDir, refName) {
  const packedPath = path.join(gitDir, 'packed-refs');
  if (!fs.existsSync(packedPath)) {
    return null;
  }
  const packed = fs.readFileSync(packedPath, 'utf8');
  for (const line of packed.split('\n')) {
    if (line.endsWith(refName)) {
      return line.split(' ')[0].slice(0, 8);
    }
  }
  return null;
}

function readGitHeadFromDisk(root) {
  try {
    const gitDir = path.join(root, '.git');
    if (!fs.existsSync(gitDir)) {
      return '00000000';
    }
    const headPath = path.join(gitDir, 'HEAD');
    if (!fs.existsSync(headPath)) {
      return '00000000';
    }
    const head = fs.readFileSync(headPath, 'utf8').trim();
    if (!head.startsWith('ref: ')) {
      return head.length >= 7 ? head.slice(0, 8) : '00000000';
    }
    const refName = head.slice(5);
    const refPath = path.join(gitDir, refName);
    if (fs.existsSync(refPath)) {
      return fs.readFileSync(refPath, 'utf8').trim().slice(0, 8);
    }
    return readRefFromPacked(gitDir, refName) || '00000000';
  } catch {
    // Best-effort: ignore disk read errors and return fallback revision
    return '00000000';
  }
}

function getGitRevision(root) {
  try {
    const out = execSync('git rev-parse --short HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out.length > 0) {
      return out.slice(0, 8);
    }
  } catch {
    // Best-effort: fall back to direct .git reading when git CLI is inaccessible
  }

  return readGitHeadFromDisk(root);
}

function loadBaselineMetrics(root) {
  const baselinePath = path.join(root, 'auto-refactor', 'reports', 'self-audit-baseline.json');
  const baseline = safeReadJson(baselinePath);
  const latestAuditPath = path.join(root, '.audit-logs', 'audit-latest.json');
  const latestAudit = safeReadJson(latestAuditPath);
  if (!baseline && !latestAudit) {
    return null;
  }
  return {
    ...(baseline || {}),
    workspaceAudit: latestAudit,
  };
}

function extractCanonicalScore(baseline) {
  if (!baseline) {
    return null;
  }
  const wsScore = baseline.workspaceAudit?.workspaceHealthScore;
  if (typeof wsScore === 'number' && Number.isFinite(wsScore) && wsScore > 0) {
    return Math.round(wsScore * 100) / 100;
  }
  const raw = baseline.metrics?.compositeScore ?? baseline.eightPillars?.compositeScore ?? null;
  if (raw === null || raw === undefined) {
    return null;
  }
  const num = Number(raw);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
}

function extractCanonicalVector(baseline) {
  let tenDims = baseline?.workspaceAudit?.tenDimensions;
  if (!tenDims || typeof tenDims !== 'object') {
    tenDims = baseline?.tenDimensions;
  }
  if (!tenDims || typeof tenDims !== 'object') {
    const latestAudit = safeReadJson(path.join(REPO_ROOT, '.audit-logs', 'audit-latest.json'));
    tenDims = latestAudit?.tenDimensions;
  }
  if (!tenDims || typeof tenDims !== 'object') {
    return null;
  }
  const vector = CANONICAL_DIMENSIONS.map((dim) => {
    const val = Number(tenDims[dim]);
    return Number.isFinite(val) ? Math.round(val * 100) / 100 : null;
  });
  return vector.some((item) => item !== null) ? vector : null;
}

/**
 * Resolves live 5D ELOC counters from the active codebase and Git differential, falling back to
 * `baseline.trajectory.runEloc` only when live workspace measurement is unavailable.
 *
 * @param {object|null} baseline - Parsed self-audit baseline.
 * @param {string} [root] - Repository root for live codebase/diff ELOC measurement.
 * @returns {{proc: number|null, uniq: number|null, chg: number|null, sem: number|null, reloc: number, cosm: number, available: boolean}}
 *   Counters plus an availability flag.
 */
function resolveElocCounters(baseline, root) {
  if (root) {
    try {
      const { collectLiveDiff5DEloc } = require('./lib/workspace-eloc-rollup');
      const live = collectLiveDiff5DEloc(root);
      if (live && live.available) {
        return {
          proc: Number(live.processedEloc) || 0,
          uniq: Number(live.uniqueEloc) || 0,
          chg: Number(live.changedEloc) || 0,
          sem: Number(live.semanticEloc) || 0,
          reloc: Number(live.relocatedEloc) || 0,
          cosm: Number(live.cosmeticEloc) || 0,
          available: true,
        };
      }
    } catch {
      // Fallback to baseline snapshot counters if live diff inspection fails.
    }
  }
  const runEloc = baseline?.trajectory?.runEloc;
  if (!runEloc) {
    return { proc: null, uniq: null, chg: null, sem: null, reloc: 0, cosm: 0, available: false };
  }
  return {
    proc: Number(runEloc.processed) || 0,
    uniq: Number(runEloc.unique) || 0,
    chg: Number(runEloc.changed) || 0,
    sem: Number(runEloc.semantic) || 0,
    reloc: 0,
    cosm: 0,
    available: true,
  };
}

function extractDebtCounters(baseline) {
  const byDebtTier = baseline?.metrics?.byDebtTier;
  const critical = Number(byDebtTier?.critical) || 0;
  return {
    add: 0,
    res: 0,
    reg: critical,
  };
}

function readPreviousRecord(activeRunsPath) {
  if (!fs.existsSync(activeRunsPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(activeRunsPath, 'utf8').trim();
    if (!content) {
      return null;
    }
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return null;
    }
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

function computeQedYield(beforeScore, afterScore, chgEloc, semEloc) {
  if (beforeScore === null || afterScore === null) {
    return 0;
  }
  const rawDeltaQ = Math.round((afterScore - beforeScore) * 10000) / 10000;
  let deltaQSemantic = rawDeltaQ;
  if (semEloc === 0 && chgEloc > 0 && rawDeltaQ > 0) {
    deltaQSemantic = 0;
  }
  const effectiveSemanticEloc = Math.max(1, semEloc);
  return Math.round((deltaQSemantic / effectiveSemanticEloc) * 10000) / 10000;
}

function serializeCompactRecordLine(record) {
  let line = JSON.stringify(record);
  let byteLen = Buffer.byteLength(line, 'utf8');

  if (byteLen > MAX_RECORD_BYTE_SIZE) {
    const compacted = {
      ...record,
      id: String(record.id || '').slice(-8),
      mod: 'ws',
      agent: 'audit',
      score: {
        ...record.score,
        bef: typeof record.score.bef === 'number' ? Math.round(record.score.bef * 100) / 100 : record.score.bef,
        aft: typeof record.score.aft === 'number' ? Math.round(record.score.aft * 100) / 100 : record.score.aft,
      },
    };
    line = JSON.stringify(compacted);
    byteLen = Buffer.byteLength(line, 'utf8');
  }

  if (byteLen > MAX_RECORD_BYTE_SIZE) {
    console.error(`  ❌ Record line exceeds ${MAX_RECORD_BYTE_SIZE}B limit (${byteLen}B)`);
    process.exit(1);
  }

  return line;
}

function pruneActiveRunsIfExceeded(activeFile, maxRuns = DEFAULT_MAX_ROLLING_RUNS) {
  try {
    if (!fs.existsSync(activeFile)) return;
    const content = fs.readFileSync(activeFile, 'utf8');
    const lines = content
      .trim()
      .split('\n')
      .filter((l) => l.trim().length > 0);
    if (lines.length > maxRuns) {
      const recentLines = lines.slice(-maxRuns);
      fs.writeFileSync(activeFile, recentLines.join('\n') + '\n', 'utf8');
    }
  } catch {
    // best-effort
  }
}

/**
 * Reads `--name=value` style options out of argv.
 *
 * Only these two options use the equals form on purpose: they are optional annotations, and a caller that
 * forgets the `=` must not silently produce a record that claims skills were activated. An unknown or
 * valueless form is reported and skipped rather than guessed.
 *
 * @param {string[]} args - Raw argv.
 * @returns {{skills: string[]|null, preset: string|null, warnings: string[]}} Parsed annotations.
 */
function parseActivationArgs(args) {
  const warnings = [];
  let skills = null;
  let preset = null;
  for (const arg of args) {
    if (arg.startsWith('--skills=')) {
      const parsed = arg
        .slice('--skills='.length)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      skills = parsed.length > 0 ? parsed : null;
      if (skills === null) warnings.push('--skills= 为空，已忽略');
      continue;
    }
    if (arg.startsWith('--preset=')) {
      const value = arg.slice('--preset='.length).trim();
      preset = value.length > 0 ? value : null;
      if (preset === null) warnings.push('--preset= 为空，已忽略');
      continue;
    }
    if (arg === '--skills' || arg === '--preset') {
      warnings.push(`${arg} 需要 '=' 形式的取值（如 ${arg}=a,b），已忽略`);
    }
  }
  return { skills, preset, warnings };
}

/**
 * Appends the activation annotation to a sidecar ledger.
 *
 * The main run record has a hard 360-byte envelope and currently sits at ~343B, so even a single skill
 * name would exceed it. Raising the envelope to fit telemetry would weaken a guard that exists to keep the
 * ledger readable, so the annotation lives in its own file, keyed by run id. A sidecar also keeps the
 * semantics honest: an absent sidecar means "activation was not recorded", which is different from
 * "zero skills were activated" and stays distinguishable.
 *
 * @param {string} ledgerDir - Ledger directory.
 * @param {string} runId - Run identifier matching the main record.
 * @param {{skills: string[]|null, preset: string|null}} activation - Parsed annotation.
 * @returns {number} Bytes written, or 0 when nothing was recorded.
 */
function appendActivationSidecar(ledgerDir, runId, activation) {
  if (!activation.skills && !activation.preset) return 0;
  const entry = { id: runId, t: Date.now() };
  if (activation.skills) entry.skills = activation.skills;
  if (activation.preset) entry.preset = activation.preset;
  const line = `${JSON.stringify(entry)}\n`;
  try {
    fs.appendFileSync(path.join(ledgerDir, 'activation.ndjson'), line, 'utf8');
    return Buffer.byteLength(line, 'utf8');
  } catch (error) {
    console.warn(`  ⚠ 激活遥测写入失败（${error.message}），主记录已落盘`);
    return 0;
  }
}

/**
 * Resolves which ledger directory this run writes to.
 *
 * @param {string} root - Repository root.
 * @param {boolean} commitLedger - Whether the run targets the tracked ledger.
 * @returns {{ledgerDir: string, trackedLedgerDir: string}} Target and tracked directories.
 */
function resolveLedgerTargets(root, commitLedger) {
  const trackedLedgerDir = resolveLedgerDir(root);
  const ledgerDir = commitLedger ? trackedLedgerDir : path.join(root, '.audit-logs', 'trajectory');
  if (!fs.existsSync(ledgerDir)) {
    try {
      fs.mkdirSync(ledgerDir, { recursive: true });
    } catch {
      // best-effort
    }
  }
  return { ledgerDir, trackedLedgerDir };
}

/**
 * Assembles score, ELOC and debt counters into one record payload.
 *
 * @param {object|null} baseline - Parsed self-audit baseline.
 * @param {object} previous - Previous record, used to carry the before score forward.
 * @returns {{record: object, elocAvailable: boolean}} Record body fragments.
 */
function buildRecordPayload(baseline, previous, root) {
  const scoreVal = extractCanonicalScore(baseline);
  const vector = extractCanonicalVector(baseline);
  const eloc = resolveElocCounters(baseline, root);
  const debt = extractDebtCounters(baseline);
  const scoreBef = previous && previous.score && typeof previous.score.aft === 'number'
    ? previous.score.aft
    : scoreVal;
  const qedVal = eloc.available ? computeQedYield(scoreBef, scoreVal, eloc.chg, eloc.sem) : 0;
  return {
    elocAvailable: eloc.available,
    record: {
      // 五维 ELOC 计数缺席时整块省略：写入 null 或 0 都会被下游当成真实测量值。
      ...(eloc.available
        ? {
            eloc: {
              proc: eloc.proc,
              uniq: eloc.uniq,
              chg: eloc.chg,
              sem: eloc.sem,
              reloc: eloc.reloc || 0,
              cosm: eloc.cosm || 0,
            },
          }
        : { elocUnavailable: true }),
      score: {
        bef: scoreBef,
        aft: scoreVal,
        ...(vector ? { vec: vector } : {}),
        qed: qedVal,
      },
      debt: { add: debt.add, res: debt.res, reg: debt.reg },
    },
  };
}

/**
 * Renders the one-line run summary, naming the activation state only when it was recorded.
 *
 * @param {object} params - Summary inputs.
 * @returns {string} Console line.
 */
function renderRunSummary(params) {
  const { ledgerScope, byteLen, revision, activationBytes, activation } = params;
  const activationNote = activationBytes > 0
    ? `，activation=${activationBytes}B（${(activation.skills || []).length} skills）`
    : '，activation 未记录';
  return `  ✔ [Trajectory] Workspace audit run appended to ${ledgerScope} (${byteLen}B, rev: ${revision}${activationNote})`;
}

function main() {
  const root = path.resolve(__dirname, '..', '..');
  const args = process.argv.slice(2);
  const isFailed = args.includes('--fail') || args.includes('--failed');
  const commitLedger = args.includes('--commit-ledger');
  const dryRun = args.includes('--dry-run');
  const activation = parseActivationArgs(args);
  for (const warning of activation.warnings) {
    console.warn(`  ⚠ ${warning}`);
  }

  const { ledgerDir, trackedLedgerDir } = resolveLedgerTargets(root, commitLedger);
  const trackedRunsPath = path.join(trackedLedgerDir, 'active-runs.ndjson');
  const activeRunsPath = path.join(ledgerDir, 'active-runs.ndjson');
  const revision = getGitRevision(root);
  const runId = String(Date.now()).slice(-12);
  const baseline = loadBaselineMetrics(root);
  const previous =
    readPreviousRecord(activeRunsPath) ||
    (commitLedger ? null : readPreviousRecord(trackedRunsPath));
  const payload = buildRecordPayload(baseline, previous, root);

  const record = {
    t: Date.now(),
    rev: revision,
    id: runId,
    mod: 'workspace',
    agent: 'audit-all',
    ...payload.record,
    gate: { pass: !isFailed, code: isFailed ? 'BLOCK' : 'PASS' },
  };

  const line = serializeCompactRecordLine(record);
  if (dryRun) {
    console.log(renderRunSummary({
      ledgerScope: 'dry-run (no disk write)',
      byteLen: Buffer.byteLength(line, 'utf8'),
      revision,
      activationBytes: 0,
      activation,
    }));
    return;
  }
  fs.appendFileSync(activeRunsPath, line + '\n', 'utf8');
  pruneActiveRunsIfExceeded(activeRunsPath, DEFAULT_MAX_ROLLING_RUNS);

  const activationBytes = appendActivationSidecar(ledgerDir, runId, activation);
  console.log(renderRunSummary({
    ledgerScope: commitLedger ? 'tracked ledger' : 'runtime .audit-logs',
    byteLen: Buffer.byteLength(line, 'utf8'),
    revision,
    activationBytes,
    activation,
  }));
}

main();
