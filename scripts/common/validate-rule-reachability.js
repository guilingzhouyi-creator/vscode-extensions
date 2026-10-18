/**
 * Module: Rule Reachability Guard — Declared Rules Must Have an Execution Surface
 * File Path: scripts/common/validate-rule-reachability.js
 * Architecture Role: Prevents catalog entries from existing without any implementation
 *   surface by asserting each error-severity rule identifier appears in code or config.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path) and
 *   scripts/common/rule-catalog.json; invoked by pre-push gate, audit-all, and CI.
 * Responsibilities:
 *   1. Build a text corpus from gate scripts, analyzer sources, and project configs;
 *   2. Assert every error-severity catalog rule appears in that corpus;
 *   3. Support an explicit manual exception manifest with documented rationale;
 *   4. Report unreachable rules with ownership context and fail closed.
 * Exit Semantics & Design Rationale: 0 = every error rule is referenced by executable
 *   assets, 1 = unreachable rule detected. Documentation-only mentions are excluded from
 *   the corpus so prose cannot satisfy implementation reachability.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CATALOG_FILE = path.join(__dirname, 'rule-catalog.json');
const EXCEPTIONS_FILE = path.join(__dirname, 'rule-reachability-exceptions.json');

const SCAN_ROOTS = Object.freeze([
  'scripts',
  '.githooks',
  '.github/workflows',
  'auto-refactor/src',
  'auto-refactor/scripts',
  'workspace-timing/src',
  'workspace-timing/scripts',
  'WebGames/scripts',
  'WebGames/config',
  'WebGames/backend',
  'WebGames/frontend',
  'WebGames/tests',
  'fractal-git/src',
  'fractal-git/crates',
  'fractal-git/scripts',
  'fractal-git/tests',
]);

const SCAN_EXTENSIONS = new Set(['.js', '.ts', '.ps1', '.sh', '.yml', '.yaml', '.py', '.json', '.gd', '.rs', '.toml']);
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'out', 'archive', '.git', 'target']);
const EXCLUDED_PATTERNS = Object.freeze([
  /rule-catalog\.json$/,
  /rule-sources\//,
  /validate-rule-reachability\.js$/,
  /validate-rule-id-closure\.js$/,
  /commit-msg-forbidden-terms\.json$/,
]);

/**
 * Recursively appends file contents under a directory to the corpus.
 *
 * @param {string} dir - Absolute directory path.
 * @param {string[]} chunks - Corpus accumulator.
 * @returns {void}
 */
function collectCorpus(dir, chunks) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectCorpus(full, chunks);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
      if (EXCLUDED_PATTERNS.some((pattern) => pattern.test(rel))) continue;
      chunks.push(fs.readFileSync(full, 'utf8'));
    }
  }
}

/**
 * Loads manual exceptions keyed by rule ID.
 *
 * @returns {Map<string, string>} Rule ID to rationale map.
 */
function loadExceptions() {
  if (!fs.existsSync(EXCEPTIONS_FILE)) return new Map();
  const parsed = JSON.parse(fs.readFileSync(EXCEPTIONS_FILE, 'utf8'));
  const entries = Array.isArray(parsed.exceptions) ? parsed.exceptions : [];
  return new Map(entries.filter((item) => item.id).map((item) => [item.id, item.reason || 'manual exception']));
}

/**
 * Runs the reachability audit.
 *
 * @returns {Array<object>} Unreachable error rules with exception status.
 */
function runAudit() {
  if (!fs.existsSync(CATALOG_FILE)) {
    throw new Error(`Rule catalog not found: ${path.relative(REPO_ROOT, CATALOG_FILE)}`);
  }
  const chunks = [];
  for (const root of SCAN_ROOTS) collectCorpus(path.join(REPO_ROOT, root), chunks);
  const corpus = chunks.join('\n');

  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
  const exceptions = loadExceptions();
  const unreachable = [];
  for (const rule of catalog.rules || []) {
    if (rule.severity !== 'error') continue;
    if (corpus.includes(rule.id) || exceptions.has(rule.id)) continue;
    unreachable.push({ id: rule.id, project: rule.project, family: rule.family });
  }
  return unreachable;
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  let unreachable;
  try {
    unreachable = runAudit();
  } catch (err) {
    console.error(`[FAIL] Rule reachability audit could not run: ${err.message}`);
    process.exit(1);
  }

  const passed = unreachable.length === 0;
  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'rule-reachability',
          unreachable,
          summary: passed
            ? 'Every error-severity rule is referenced by executable assets.'
            : `${unreachable.length} error rule(s) have no execution surface.`,
        },
        null,
        2,
      ),
    );
    process.exit(passed ? 0 : 1);
  }

  if (passed) {
    console.log('  PASS Rule reachability: every error rule has an execution surface.');
    process.exit(0);
  }

  console.error(`[FAIL] Rule reachability: ${unreachable.length} error rule(s) without implementation references:`);
  for (const rule of unreachable) {
    console.error(`  - ${rule.id} (${rule.project}/${rule.family})`);
  }
  console.error('  Add an implementation reference or a documented entry in rule-reachability-exceptions.json.');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({ runAudit, loadExceptions });
