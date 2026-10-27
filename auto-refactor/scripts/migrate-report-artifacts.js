/**
 * Module: Tooling — Agent Audit Schema (AAS v1.0) Artifact Migrator
 * File Path: auto-refactor/scripts/migrate-report-artifacts.js
 * Architecture Role: Offline projection entry point that rewrites persisted audit artifacts into
 *   the Agent Audit Schema (AAS v1.0) compact projection (*.aas.json).
 * Dependencies & Triggers: Consumes ../dist/api (buildAasReport, toAasJson); invoked manually or
 *   by maintenance scripts, never on the scan hot path.
 * Responsibilities:
 *   1. Walk one file or a directory of *.json artifacts and project each report payload into AAS v1.0.
 *   2. Write the AAS projection beside the source as <name>.aas.json, or overwrite under --write.
 *   3. Enforce zero legacy CAS v3 (*.cas.json) artifacts are generated.
 * Exit Semantics & Design Rationale: 0 = success, 1 = I/O fault or no valid artifact found.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { buildAasReport, toAasJson } = require('../dist/api');

const ARG_PREFIX = '--';
const FLAG_WRITE = '--write';
const FLAG_PRETTY = '--pretty';
const JSON_SUFFIX = '.json';
const AAS_SUFFIX = '.aas.json';
const CAS_SUFFIX = '.cas.json';
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'target']);

/**
 * Parse CLI arguments into a target list plus output switches.
 *
 * @param argv - Process arguments after the script name.
 * @returns Parsed options.
 */
function parseArgs(argv) {
  const options = { targets: [], write: false, pretty: false };
  for (const arg of argv) {
    if (arg === FLAG_WRITE) {
      options.write = true;
    } else if (arg === FLAG_PRETTY) {
      options.pretty = true;
    } else if (!arg.startsWith(ARG_PREFIX)) {
      options.targets.push(arg);
    }
  }
  return options;
}

/**
 * Collect candidate JSON artifacts, skipping derived projections.
 *
 * @param target - File or directory path.
 * @returns Absolute artifact paths.
 */
function collectArtifacts(target) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return [];
  if (fs.statSync(resolved).isFile()) return [resolved];
  const found = [];
  const stack = [resolved];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) stack.push(path.join(current, entry.name));
        continue;
      }
      if (
        !entry.name.endsWith(JSON_SUFFIX) ||
        entry.name.endsWith(AAS_SUFFIX) ||
        entry.name.endsWith(CAS_SUFFIX)
      ) {
        continue;
      }
      found.push(path.join(current, entry.name));
    }
  }
  return found.sort();
}

/**
 * Derive the sidecar path for an AAS v1.0 projection.
 *
 * @param sourcePath - Verbose artifact path.
 * @returns Path ending in `.aas.json`.
 */
function sidecarPath(sourcePath) {
  return sourcePath.slice(0, -JSON_SUFFIX.length) + AAS_SUFFIX;
}

function extractScore(payload) {
  if (Number.isFinite(payload?.health?.score)) return payload.health.score;
  if (Number.isFinite(payload?.baselineMetrics?.compositeScore))
    return payload.baselineMetrics.compositeScore;
  if (Number.isFinite(payload?.cai)) return payload.cai;
  return 100;
}

function extractTotal(payload) {
  if (Number.isFinite(payload?.baselineMetrics?.issuesTotal))
    return payload.baselineMetrics.issuesTotal;
  if (Number.isFinite(payload?.summary?.issuesTotal)) return payload.summary.issuesTotal;
  if (Array.isArray(payload?.issues)) return payload.issues.length;
  return 0;
}

function extractGrade(payload, score) {
  if (payload?.health?.grade) return payload.health.grade;
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  return 'B';
}

/**
 * Convert any supported artifact into an AAS v1.0 report object.
 *
 * @param payload - Parsed artifact.
 * @returns AAS v1.0 AgentAuditReport object.
 */
function projectToAas(payload) {
  if (payload && payload.schema === 'aas-v1') {
    return payload;
  }
  if (payload && payload.summary && Array.isArray(payload.issues)) {
    return buildAasReport(payload);
  }

  const score = extractScore(payload);
  const total = extractTotal(payload);
  const grade = extractGrade(payload, score);

  return {
    schema: 'aas-v1',
    tool: payload?.tool || 'auto-refactor',
    version: payload?.version || '0.4.0',
    timestamp: payload?.timestamp || payload?.generatedAt || new Date().toISOString(),
    root: payload?.root || '',
    verdict: total > 0 ? 'WARN' : 'PASS',
    health: {
      score,
      grade,
      counts: {
        files: payload?.summary?.filesScanned || 0,
        total,
        errors: payload?.baselineMetrics?.errorsTotal || 0,
        warns: payload?.baselineMetrics?.warningsTotal || total,
        info: payload?.baselineMetrics?.infoTotal || 0,
      },
    },
    defaultVerify: 'npm test',
    dimensions: payload?.dimensions || {},
    bottlenecks: [],
    topology: {
      L1_CONTRACT: [],
      L2_INFRA: [],
      L3_CONFIG: [],
      L4_BUSINESS: [],
      L5_GOVERNANCE: [],
    },
    files: {},
    truncated: total,
  };
}

/**
 * Migrate one artifact to AAS v1.0.
 *
 * @param sourcePath - Artifact path.
 * @param options - CLI options.
 * @returns Result status and detail.
 */
function migrateOne(sourcePath, options) {
  const relative = path.relative(process.cwd(), sourcePath);
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  } catch (readError) {
    return { status: 'failed', detail: `${relative}: unreadable JSON (${readError.message})` };
  }

  let aas;
  try {
    aas = projectToAas(payload);
  } catch (err) {
    return { status: 'skipped', detail: `${relative}: not a report artifact (${err.message})` };
  }

  const destination = sidecarPath(sourcePath);
  const summary = `${relative}: verdict=${aas.verdict} score=${aas.health.score ?? 'N/A'} files=${Object.keys(aas.files || {}).length}`;

  if (!options.write) {
    return { status: 'migrated', detail: `${summary} (dry run -> ${path.basename(destination)})` };
  }

  const serialized = JSON.stringify(aas, null, options.pretty ? 2 : 0);
  try {
    fs.writeFileSync(destination, `${serialized}\n`, 'utf8');
  } catch (writeError) {
    return { status: 'failed', detail: `${relative}: unwritable (${writeError.message})` };
  }
  return { status: 'migrated', detail: `${summary} -> ${path.basename(destination)}` };
}

const OUTCOME_MARK = { migrated: '✔', skipped: '·', failed: '✖' };

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.targets.length === 0) {
    console.error(
      'Usage: node scripts/migrate-report-artifacts.js <file|dir> [--write] [--pretty]',
    );
    process.exit(1);
  }

  const artifacts = options.targets.flatMap(collectArtifacts);
  if (artifacts.length === 0) {
    console.error('No JSON artifacts found under the given targets.');
    process.exit(1);
  }

  const tally = { migrated: 0, skipped: 0, failed: 0 };
  for (const artifact of artifacts) {
    const outcome = migrateOne(artifact, options);
    tally[outcome.status] += 1;
    console.log(`  ${OUTCOME_MARK[outcome.status]} ${outcome.detail}`);
  }

  console.log(
    `\n${tally.migrated} migrated into AAS v1.0, ${tally.skipped} skipped, ${tally.failed} failed.`,
  );
  process.exit(tally.failed === 0 && tally.migrated > 0 ? 0 : 1);
}

main();
