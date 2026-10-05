/**
 * Module: Tooling — Workspace Trajectory Accumulator & Recorder
 * File Path: scripts/common/record-workspace-trajectory.js
 * Architecture Role: Records multi-project audit-all quality results into the unified
 *   long-term .refactor-trajectory ledger, ensuring cross-project trajectory continuity.
 * Dependencies & Triggers: Invoked by audit-all.ps1 and audit-all.sh at conclusion of review.
 * Exit Semantics: Exits 0 on successful ledger append, 1 on severe failure.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MAX_RECORD_BYTE_SIZE = 350;
const DEFAULT_MAX_ROLLING_RUNS = 100;

const CANONICAL_DIMENSIONS = [
  'architectureConsistency',
  'semanticPurity',
  'codeSecurity',
  'performanceEfficiency',
  'standardization',
  'modernity',
  'maintainability',
  'commentQuality',
  'duplication',
  'techDebtRisk',
];

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
  if (!fs.existsSync(baselinePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(baselinePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractCanonicalScore(baseline) {
  if (!baseline) {
    return null;
  }
  const raw = baseline.metrics?.compositeScore ?? baseline.eightPillars?.compositeScore ?? null;
  if (raw === null || raw === undefined) {
    return null;
  }
  const num = Number(raw);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : null;
}

function extractCanonicalVector(baseline) {
  if (!baseline || !baseline.tenDimensions || typeof baseline.tenDimensions !== 'object') {
    return [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
  }
  return CANONICAL_DIMENSIONS.map((dim) => {
    const val = Number(baseline.tenDimensions[dim]);
    return Number.isFinite(val) ? Math.round(val * 100) / 100 : 100;
  });
}

function resolveElocCounters(baseline) {
  let proc = 0;
  let uniq = 0;
  let chg = 0;
  let sem = 0;

  if (baseline) {
    if (baseline.trajectory?.runEloc) {
      proc = Number(baseline.trajectory.runEloc.processed) || 0;
      uniq = Number(baseline.trajectory.runEloc.unique) || 0;
      chg = Number(baseline.trajectory.runEloc.changed) || 0;
      sem = Number(baseline.trajectory.runEloc.semantic) || 0;
    } else if (baseline.scope?.filesScanned) {
      const count = Number(baseline.scope.filesScanned);
      proc = Math.round(count * 202.05);
      uniq = Math.round(count * 163.89);
    }
  }

  return { proc, uniq, chg, sem };
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

  if (byteLen > MAX_RECORD_BYTE_SIZE && record.score) {
    const compacted = {
      ...record,
      score: {
        ...record.score,
        bef: typeof record.score.bef === 'number' ? Math.round(record.score.bef * 10) / 10 : record.score.bef,
        aft: typeof record.score.aft === 'number' ? Math.round(record.score.aft * 10) / 10 : record.score.aft,
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

function main() {
  const root = path.resolve(__dirname, '..', '..');
  const args = process.argv.slice(2);
  const isFailed = args.includes('--fail') || args.includes('--failed');
  const gateCode = isFailed ? 'FAIL' : 'PASS';
  const gatePass = !isFailed;

  const ledgerDir = resolveLedgerDir(root);
  if (!fs.existsSync(ledgerDir)) {
    try {
      fs.mkdirSync(ledgerDir, { recursive: true });
    } catch {
      // best-effort
    }
  }

  const activeRunsPath = path.join(ledgerDir, 'active-runs.ndjson');
  const revision = getGitRevision(root);
  const runId = String(Date.now()).slice(-12);
  const baseline = loadBaselineMetrics(root);

  const scoreVal = extractCanonicalScore(baseline);
  const vector = extractCanonicalVector(baseline);
  const eloc = resolveElocCounters(baseline);
  const debt = extractDebtCounters(baseline);

  const prevRecord = readPreviousRecord(activeRunsPath);
  const scoreBef =
    prevRecord && prevRecord.score && typeof prevRecord.score.aft === 'number'
      ? prevRecord.score.aft
      : scoreVal;
  const scoreAft = scoreVal;
  const qedVal = computeQedYield(scoreBef, scoreAft, eloc.chg, eloc.sem);

  const record = {
    t: Date.now(),
    rev: revision,
    id: runId,
    mod: 'workspace',
    agent: 'audit-all',
    eloc: {
      proc: eloc.proc,
      uniq: eloc.uniq,
      chg: eloc.chg,
      sem: eloc.sem,
      reloc: 0,
      cosm: 0,
    },
    score: {
      bef: scoreBef,
      aft: scoreAft,
      vec: vector,
      qed: qedVal,
    },
    debt: {
      add: debt.add,
      res: debt.res,
      reg: debt.reg,
    },
    gate: {
      pass: gatePass,
      code: gateCode,
    },
  };

  const line = serializeCompactRecordLine(record);
  const byteLen = Buffer.byteLength(line, 'utf8');

  fs.appendFileSync(activeRunsPath, line + '\n', 'utf8');
  pruneActiveRunsIfExceeded(activeRunsPath, DEFAULT_MAX_ROLLING_RUNS);
  console.log(`  ✔ [Trajectory] Workspace audit run appended to ledger (${byteLen}B, rev: ${revision})`);
}

main();

