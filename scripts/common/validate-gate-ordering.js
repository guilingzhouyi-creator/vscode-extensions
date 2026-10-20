/**
 * Module: Gate Script Ordering and Vocabulary Guard
 * File Path: scripts/common/validate-gate-ordering.js
 * Architecture Role: Static guard over gate entry points, asserting that every helper a runner
 *   calls is already defined where the call executes, and that no entry point prints a status
 *   token outside the closed PASS/BLOCK/SKIP/WARN vocabulary.
 * Dependencies & Triggers: Consumes gate-step-registry.json and the gate entry-point corpus;
 *   invoked by pre-push and audit-all alongside the feedback vocabulary guard.
 * Responsibilities:
 *   1. Reject a Bash call to a function defined further down the file (bash resolves at call time,
 *      so the call aborts with 127 rather than deferring);
 *   2. Reject a PowerShell call to a function defined further down the file (same failure mode);
 *   3. Reject a status token outside the four-state vocabulary on an operator-facing line;
 *   4. Report file-and-line diagnostics for every finding.
 * Exit Semantics & Design Rationale: 0 = ordering and vocabulary clean, 1 = at least one finding.
 *   The failure this guards is invisible to every other check: a script that aborts on its first
 *   line still has valid syntax, passes lint, and exits non-zero, so the only symptom is that the
 *   gate has silently stopped running.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const REGISTRY = require('./gate-step-registry');

/** Entry points, resolved from the registry so a new entry is guarded automatically. */
function collectEntryPoints() {
  const files = [];
  for (const entryId of REGISTRY.listEntryIds()) {
    const entry = REGISTRY.getEntry(entryId);
    for (const rel of Object.values(entry.scripts || {})) {
      const full = path.join(REPO_ROOT, rel);
      if (fs.existsSync(full)) files.push({ entryId, rel: rel.replace(/\\/g, '/'), full });
    }
  }
  return files;
}

/**
 * Collects top-level function definitions with their 1-based line numbers.
 *
 * @param {string[]} lines - File lines.
 * @returns {Map<string, number>} Function name to definition line.
 */
function collectDefinitions(lines) {
  const defs = new Map();
  lines.forEach((line, index) => {
    const match = /^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_-]*)\s*\(\)\s*\{/.exec(line)
      || /^function\s+([A-Za-z][A-Za-z0-9_-]*)\s*\{/.exec(line);
    if (match && !defs.has(match[1])) defs.set(match[1], index + 1);
  });
  return defs;
}

/** Comment-only or documentation lines never execute. */
function isInert(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//');
}

/**
 * Finds calls that execute before the called function is defined.
 *
 * @param {string[]} lines - File lines.
 * @param {Map<string, number>} defs - Definition lines.
 * @returns {Array<{ line: number, name: string, definedAt: number }>} Ordering findings.
 */
function findEarlyCalls(lines, defs) {
  const findings = [];
  lines.forEach((line, index) => {
    if (isInert(line)) return;
    const lineNo = index + 1;
    for (const [name, definedAt] of defs) {
      if (lineNo >= definedAt) continue;
      const callRe = new RegExp(`(?:^|[;&|(!]|\\bthen|\\bdo|\\belse)\\s*${name}\\b(?!\\s*\\()`);
      if (callRe.test(line)) findings.push({ line: lineNo, name, definedAt });
    }
  });
  return findings;
}

/** Status tokens that are not part of the closed vocabulary. */
const STATUS_TOKEN = /\[(FAIL|FAILED|OK|SUCCESS|ERROR|DONE|N\/A|NA|INFO)\]/g;

/**
 * Finds non-closed status tokens on operator-facing output lines.
 *
 * @param {string[]} lines - File lines.
 * @returns {Array<{ line: number, token: string, text: string }>} Vocabulary findings.
 */
function findStatusTokens(lines) {
  const findings = [];
  const emits = /(echo|Write-Host|Write-Output|Write-Error|Write-Warning|printf|console\.(?:log|error|warn))/;
  lines.forEach((line, index) => {
    if (isInert(line) || !emits.test(line)) return;
    STATUS_TOKEN.lastIndex = 0;
    let match = STATUS_TOKEN.exec(line);
    while (match !== null) {
      findings.push({ line: index + 1, token: match[1], text: line.trim().slice(0, 100) });
      match = STATUS_TOKEN.exec(line);
    }
  });
  return findings;
}

/**
 * Runs the ordering and vocabulary audit.
 *
 * @returns {Array<object>} Findings.
 */
function runAudit() {
  const findings = [];
  for (const { entryId, rel, full } of collectEntryPoints()) {
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    const defs = collectDefinitions(lines);
    for (const item of findEarlyCalls(lines, defs)) {
      findings.push({
        type: 'GUARD-ORD-001',
        entry: entryId,
        file: rel,
        line: item.line,
        detail: `'${item.name}' is called at line ${item.line} but defined at line ${item.definedAt}`,
      });
    }
    for (const item of findStatusTokens(lines)) {
      findings.push({
        type: 'GUARD-FBK-001',
        entry: entryId,
        file: rel,
        line: item.line,
        detail: `status token [${item.token}] outside PASS/BLOCK/SKIP/WARN: ${item.text}`,
      });
    }
  }
  return findings;
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  const findings = runAudit();
  const passed = findings.length === 0;

  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'gate-ordering',
          findings,
          summary: passed
            ? 'Every gate helper is defined before its first call and every verdict uses the closed vocabulary.'
            : `${findings.length} ordering or vocabulary defect(s) detected.`,
        },
        null,
        2,
      ),
    );
    process.exit(passed ? 0 : 1);
  }

  if (passed) {
    console.log('  ✔ PASS  gate-ordering  门禁助手定义先于调用且判定词表闭包');
    process.exit(0);
  }

  console.error('✖ BLOCK  gate-ordering');
  for (const item of findings) {
    console.error(`  - [${item.type}] ${item.file}:${item.line} ${item.detail}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({ runAudit, collectEntryPoints, findEarlyCalls, findStatusTokens, collectDefinitions });
