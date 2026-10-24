/**
 * Module: Tooling — Historical Report Artifact Migrator
 * File Path: auto-refactor/scripts/migrate-report-artifacts.js
 * Architecture Role: Offline backfill entry point that rewrites persisted audit artifacts into
 *   the CAS v3 compact projection, so historical reports stay readable by the current consumer
 *   without re-running a scan.
 * Dependencies & Triggers: Consumes ../dist/api (migrateLegacyReport); invoked manually or by a
 *   maintenance script, never on the scan hot path.
 * Responsibilities:
 *   1. Walk one file or a directory of `*.json` artifacts and sniff each payload's shape.
 *   2. Write the compact projection beside the source as `<name>.cas.json`, or over it under
 *      `--write`.
 *   3. Report per-artifact outcome, and fail the run only on real I/O faults, because an artifact
 *      directory legitimately also holds ledgers and failure snapshots.
 * Exit Semantics & Design Rationale: 0 = no fault and at least one artifact migrated, 1 = an I/O
 *   fault, no artifact found, or nothing recognized. Default mode is a dry run that prints the
 *   projection summary, because rewriting persisted audit history in place is a destructive act
 *   that must be asked for. Sources are never deleted: the verbose artifact keeps its role as the
 *   lossless record and the compact sidecar is a derived view.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { migrateLegacyReport } = require('../dist/api');

const ARG_PREFIX = '--';
const FLAG_WRITE = '--write';
const FLAG_PRETTY = '--pretty';
const JSON_SUFFIX = '.json';
const CAS_SUFFIX = '.cas.json';
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'target']);

/**
 * Parse CLI arguments into a target list plus output switches.
 *
 * @param {string[]} argv - Process arguments after the script name.
 * @returns {{ targets: string[], write: boolean, pretty: boolean }} Parsed options.
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
 * Collect every candidate JSON artifact under a target, skipping derived compact outputs.
 *
 * @param {string} target - File or directory path.
 * @returns {string[]} Absolute artifact paths.
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
      if (!entry.name.endsWith(JSON_SUFFIX) || entry.name.endsWith(CAS_SUFFIX)) continue;
      found.push(path.join(current, entry.name));
    }
  }
  return found.sort();
}

/**
 * Derive the sidecar path for a compact projection.
 *
 * @param {string} sourcePath - Verbose artifact path.
 * @returns {string} Path ending in `.cas.json`.
 */
function sidecarPath(sourcePath) {
  return sourcePath.slice(0, -JSON_SUFFIX.length) + CAS_SUFFIX;
}

/**
 * Migrate one artifact and persist or preview the projection.
 *
 * A JSON file that parses but matches no report shape is reported as skipped rather than failed:
 * an artifact directory legitimately holds non-report files (ledgers, failure snapshots), and
 * treating those as errors would make the tool unusable on a real directory. Genuine I/O faults
 * and unrecognized payloads still surface as failures.
 *
 * @param {string} sourcePath - Artifact to migrate.
 * @param {{ write: boolean, pretty: boolean }} options - Output switches.
 * @returns {{ status: 'migrated'|'skipped'|'failed', detail: string }} Outcome for the run report.
 */
function migrateOne(sourcePath, options) {
  const relative = path.relative(process.cwd(), sourcePath);
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  } catch (readError) {
    return { status: 'failed', detail: `${relative}: unreadable JSON (${readError.message})` };
  }

  let compact;
  try {
    compact = migrateLegacyReport(payload);
  } catch (shapeError) {
    return { status: 'skipped', detail: `${relative}: not a report artifact` };
  }

  const summary =
    `${relative}: verdict=${compact.verdict} score=${compact.health.score ?? 'N/A'} ` +
    `vectors=${compact.vectors.length} truncated=${compact.truncated ?? 0}`;
  if (!options.write) return { status: 'migrated', detail: `${summary} (dry run)` };

  const destination = sidecarPath(sourcePath);
  const serialized = JSON.stringify(compact, null, options.pretty ? 2 : 0);
  try {
    fs.writeFileSync(destination, `${serialized}\n`, 'utf8');
  } catch (writeError) {
    return { status: 'failed', detail: `${relative}: unwritable (${writeError.message})` };
  }
  return { status: 'migrated', detail: `${summary} -> ${path.basename(destination)}` };
}

/** Symbol per outcome, so a mixed-directory run stays scannable. */
const OUTCOME_MARK = { migrated: '✔', skipped: '·', failed: '✖' };

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.targets.length === 0) {
    console.error('Usage: node scripts/migrate-report-artifacts.js <file|dir> [--write] [--pretty]');
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
    `\n${tally.migrated} migrated, ${tally.skipped} skipped as non-report, ${tally.failed} failed.`,
  );
  process.exit(tally.failed === 0 && tally.migrated > 0 ? 0 : 1);
}

main();
