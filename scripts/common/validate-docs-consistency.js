/**
 * Module: Documentation Consistency Guard — Counts and Script References
 * File Path: scripts/common/validate-docs-consistency.js
 * Architecture Role: Prevents governance documents from drifting away from the SSOT by
 *   rejecting hardcoded rule counts and dead references to script entry points.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path);
 *   invoked by pre-push gate, audit-all, and CI.
 * Responsibilities:
 *   1. Reject hardcoded rule counts in root governance and skill documents;
 *   2. Verify every backticked scripts/** path in core documents exists on disk;
 *   3. Emit line-accurate diagnostics with human and JSON output;
 *   4. Fail closed when a scanned document is unreadable.
 * Exit Semantics & Design Rationale: 0 = documents are count-free and reference only
 *   existing scripts, 1 = drift detected. Counts belong to rule-catalog.json; duplicating
 *   them in prose guarantees staleness after the next rule addition.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');

const COUNT_SCAN_FILES = Object.freeze([
  'AGENTS.md',
  'scripts/README.md',
  'docs/system-spec/script-governance-architecture.md',
  'auto-refactor/DOCS.md',
  'WebGames/scripts/README.md',
]);

const COUNT_SCAN_GLOBS = Object.freeze([
  '.agents/skills',
]);

const PATH_SCAN_FILES = Object.freeze([
  'AGENTS.md',
  'scripts/README.md',
  'docs/system-spec/script-governance-architecture.md',
]);

const STALE_COUNT_PATTERN = /\b(?:428|464|468|470)\b/;
const SCRIPT_REFERENCE_PATTERN = /`(scripts\/[A-Za-z0-9_./-]+\.(?:js|ps1|sh|json|md))`/g;

/**
 * Recursively collects Markdown files under a directory.
 *
 * @param {string} dir - Absolute directory path.
 * @returns {string[]} Absolute file paths.
 */
function collectMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdown(full));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Loads the authoritative rule totals from the single-source catalog.
 *
 * @returns {{ total: number, byProject: Record<string, number> }|null} Catalog totals.
 */
function loadCatalogTotals() {
  const catalogPath = path.join(REPO_ROOT, 'scripts/common/rule-catalog.json');
  if (!fs.existsSync(catalogPath)) return null;
  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const byProject = {};
    for (const rule of catalog.rules) {
      byProject[rule.project] = (byProject[rule.project] || 0) + 1;
    }
    return { total: catalog.totalRules, byProject };
  } catch {
    return null;
  }
}

/**
 * Scans a file for hardcoded rule counts that disagree with the catalog.
 *
 * Replaces a fixed blacklist of historical numbers (428/464/468/470), which let
 * 359, 338 and 473 drift indefinitely because they were never listed.
 *
 * @param {string} file - Absolute file path.
 * @param {Array<object>} violations - Collector array.
 * @param {object|null} totals - Authoritative totals from the catalog.
 * @returns {void}
 */
function scanCounts(file, violations, totals) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (STALE_COUNT_PATTERN.test(line)) {
      violations.push({
        type: 'STALE_RULE_COUNT',
        file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
        line: index + 1,
        detail: 'Hardcoded rule count detected; reference rule-catalog.json instead.',
      });
      return;
    }
    if (!totals) return;

    // Only totals are checked. Subset claims such as "29 条工程规则" describe a
    // category, not the catalog total, and must not be flagged. Prose is matched
    // only when a totality marker precedes the number.
    const countPattern =
      /(?:全量|总计|共|内置|注册|收录|SSOT|全工作区|workspace[-\s]?wide|total|built-?in|registered)\D{0,12}?(\d{2,4})\s*(?:条|规则|rules?\b)/gi;
    let match;
    while ((match = countPattern.exec(line)) !== null) {
      const claimed = Number(match[1]);
      const isKnownTotal = claimed === totals.total || Object.values(totals.byProject).includes(claimed);
      if (!isKnownTotal) {
        violations.push({
          type: 'RULE_COUNT_DRIFT',
          file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
          line: index + 1,
          detail: `Claims ${claimed} rules as a total, but rule-catalog.json has ${totals.total}.`,
        });
      }
    }

  });
}


/**
 * Scans a file for backticked script references that do not exist.
 *
 * @param {string} file - Absolute file path.
 * @param {Array<object>} violations - Collector array.
 * @returns {void}
 */
function scanScriptReferences(file, violations) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    let match;
    SCRIPT_REFERENCE_PATTERN.lastIndex = 0;
    while ((match = SCRIPT_REFERENCE_PATTERN.exec(line)) !== null) {
      const rel = match[1];
      if (!fs.existsSync(path.join(REPO_ROOT, rel))) {
        violations.push({
          type: 'DEAD_SCRIPT_REFERENCE',
          file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
          line: index + 1,
          detail: rel,
        });
      }
    }
  });
}

/**
 * Runs the documentation consistency audit.
 *
 * @returns {Array<object>} Detected violations.
 */
function runAudit() {
  const violations = [];
  const totals = loadCatalogTotals();
  const countFiles = [
    ...COUNT_SCAN_FILES.map((rel) => path.join(REPO_ROOT, rel)),
    ...COUNT_SCAN_GLOBS.flatMap((rel) => collectMarkdown(path.join(REPO_ROOT, rel))),
  ];
  for (const file of countFiles) {
    if (fs.existsSync(file)) scanCounts(file, violations, totals);
  }
  for (const rel of PATH_SCAN_FILES) {
    const file = path.join(REPO_ROOT, rel);
    if (fs.existsSync(file)) scanScriptReferences(file, violations);
  }
  return violations;
}


/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  const violations = runAudit();
  const passed = violations.length === 0;

  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'docs-consistency',
          violations,
          summary: passed
            ? 'Governance documents contain no hardcoded rule counts or dead script references.'
            : `${violations.length} documentation drift item(s) detected.`,
        },
        null,
        2,
      ),
    );
    process.exit(passed ? 0 : 1);
  }

  if (passed) {
    console.log('  PASS Documentation consistency: counts and script references are aligned.');
    process.exit(0);
  }

  console.error(`[FAIL] Documentation consistency: ${violations.length} drift item(s):`);
  for (const item of violations) {
    console.error(`  - ${item.file}:${item.line} [${item.type}] ${item.detail}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({ runAudit });
