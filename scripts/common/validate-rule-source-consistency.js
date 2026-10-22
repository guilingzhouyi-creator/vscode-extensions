/**
 * Module: Rule Source Cross-Source Consistency Guard
 * File Path: scripts/common/validate-rule-source-consistency.js
 * Architecture Role: Static guard over the rule source catalogs that feed `rule-catalog.json`,
 *   asserting that a rule id declared by more than one source carries the same severity in each.
 * Dependencies & Triggers: Consumes scripts/common/rule-sources/*.json; invoked by pre-push and
 *   audit-all alongside the closure and counter guards.
 * Responsibilities:
 *   1. Detect rule ids declared by two or more source catalogs;
 *   2. Reject a duplicate whose severity differs between sources, because the generator resolves
 *      duplicates first-wins and the loser is discarded without a word;
 *   3. Reject a source whose own `totalRules` header disagrees with the entries it lists;
 *   4. Report every conflicting id with both severities so the fix is unambiguous.
 * Exit Semantics & Design Rationale: 0 = no cross-source severity conflict, 1 = at least one.
 *   The catalog generator resolves duplicate ids by insertion order (`auto-refactor` before
 *   `global-tooling`), so a `global-rules.json` entry that disagrees is silently dropped. That is how
 *   `ARCH-FAC-001` advertised `error` in one source and `warning` in the catalog for as long as
 *   anyone cared to look: no guard compared the sources against each other, only against the output.
 *   The header check exists because `auto-refactor-rules.json` is a hand-maintained snapshot with no
 *   generator: its `totalRules` sat at 362 while it listed 363 entries, and the generator only ever
 *   validated the *output* catalog, so the source drifted unobserved.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, 'rule-sources');
const SEVERITY_ORDER = Object.freeze(['info', 'warning', 'error']);

/**
 * Reads one source catalog in full, returning null when it is unreadable.
 *
 * @param {string} file - Absolute path to a source catalog.
 * @returns {{rules: Array<object>, totalRules: number|null}|null} Parsed source, or null.
 */
function readSourceDocument(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(parsed)) return { rules: parsed, totalRules: null };
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      totalRules: Number.isInteger(parsed.totalRules) ? parsed.totalRules : null,
    };
  } catch {
    return null;
  }
}

/**
 * Reads one source catalog and returns its rules.
 *
 * @param {string} file - Absolute path to a source catalog.
 * @returns {Array<object>} Rule entries, empty when the file is unreadable.
 */
function readSource(file) {
  const doc = readSourceDocument(file);
  return doc === null ? [] : doc.rules;
}

/**
 * Finds source catalogs whose own header contradicts the entries they list.
 *
 * `auto-refactor-rules.json` carries a `totalRules` header that no generator writes, so it is the one
 * figure in the pipeline with no producer and no consumer check. It read 362 while listing 363 for
 * long enough that four documents quoted the header instead of the entries.
 *
 * @returns {Array<{source: string, declared: number, actual: number}>} Inconsistent headers.
 */
function findHeaderDrift() {
  const drift = [];
  if (!fs.existsSync(SOURCE_DIR)) return drift;
  for (const name of fs.readdirSync(SOURCE_DIR).sort()) {
    if (!name.endsWith('.json')) continue;
    const doc = readSourceDocument(path.join(SOURCE_DIR, name));
    if (doc === null || doc.totalRules === null) continue;
    if (doc.totalRules !== doc.rules.length) {
      drift.push({ source: name, declared: doc.totalRules, actual: doc.rules.length });
    }
  }
  return drift;
}

/**
 * Collects every (id -> {source, severity}) declaration across all source catalogs.
 *
 * @returns {Map<string, Array<{source: string, severity: string}>>} Declarations per rule id.
 */
function collectDeclarations() {
  const index = new Map();
  if (!fs.existsSync(SOURCE_DIR)) return index;
  for (const name of fs.readdirSync(SOURCE_DIR).sort()) {
    if (!name.endsWith('.json')) continue;
    for (const rule of readSource(path.join(SOURCE_DIR, name))) {
      if (!rule || typeof rule.id !== 'string') continue;
      const severity = String(rule.severity || rule.defaultSeverity || 'error').toLowerCase();
      const list = index.get(rule.id) || [];
      list.push({ source: name, severity });
      index.set(rule.id, list);
    }
  }
  return index;
}

/**
 * Finds rule ids whose severity disagrees between sources.
 *
 * @param {Map<string, Array<{source: string, severity: string}>>} index - Declarations per rule id.
 * @returns {Array<{id: string, declarations: Array<{source: string, severity: string}>}>} Conflicts.
 */
function findConflicts(index) {
  const conflicts = [];
  for (const [id, declarations] of index) {
    if (declarations.length < 2) continue;
    const distinct = new Set(declarations.map((d) => d.severity));
    if (distinct.size > 1) conflicts.push({ id, declarations });
  }
  return conflicts.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Runs the guard over the shipped source catalogs.
 *
 * @returns {{conflicts: Array<object>, headerDrift: Array<object>}} Both defect classes.
 */
function runAudit() {
  return { conflicts: findConflicts(collectDeclarations()), headerDrift: findHeaderDrift() };
}

/**
 * Proves the detector fires on synthetic input whose verdict is known in advance.
 *
 * A guard that matches nothing also exits 0, which is indistinguishable from a clean corpus. These
 * probes drive the real `findConflicts` rather than a copy, so a regression in the comparison is
 * reported instead of silently passing.
 *
 * @returns {string[]} Probe failures, empty when all pass.
 */
function runSelfProbes() {
  const failures = [];
  const probe = (name, ok) => {
    if (!ok) failures.push(`self-probe failed: ${name}`);
  };

  const build = (declarations) => new Map(Object.entries(declarations));

  probe(
    'identical severity across sources is not a conflict',
    findConflicts(build({ 'probe-rule-alpha': [{ source: 'a.json', severity: 'error' }, { source: 'b.json', severity: 'error' }] }))
      .length === 0,
  );
  probe(
    'differing severity across sources is a conflict',
    findConflicts(build({ 'probe-rule-alpha': [{ source: 'a.json', severity: 'error' }, { source: 'b.json', severity: 'warning' }] }))
      .length === 1,
  );
  probe(
    'a single declaration is never a conflict',
    findConflicts(build({ 'probe-rule-alpha': [{ source: 'a.json', severity: 'error' }] })).length === 0,
  );
  probe(
    'three-way disagreement is reported once',
    findConflicts(
      build({
        'probe-rule-alpha': [
          { source: 'a.json', severity: 'error' },
          { source: 'b.json', severity: 'warning' },
          { source: 'c.json', severity: 'info' },
        ],
      }),
    ).length === 1,
  );
  probe('severity vocabulary is ordered', SEVERITY_ORDER.join(',') === 'info,warning,error');
  probe(
    'a source whose header matches its entries is not drift',
    findHeaderDriftIn([{ name: 'probe.json', declared: 2, entries: 2 }]).length === 0,
  );
  probe(
    'a source whose header understates its entries is drift',
    findHeaderDriftIn([{ name: 'probe.json', declared: 1, entries: 2 }]).length === 1,
  );
  probe(
    'a source with no header is never drift',
    findHeaderDriftIn([{ name: 'probe.json', declared: null, entries: 2 }]).length === 0,
  );

  return failures;
}

/**
 * Pure header-drift comparison, so the probes can drive it without writing fixture files.
 *
 * @param {Array<{name: string, declared: number|null, entries: number}>} sources - Source summaries.
 * @returns {Array<object>} Sources whose declared total disagrees with their entry count.
 */
function findHeaderDriftIn(sources) {
  return sources
    .filter((source) => source.declared !== null && source.declared !== source.entries)
    .map((source) => ({ source: source.name, declared: source.declared, actual: source.entries }));
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  const probes = runSelfProbes();
  if (probes.length > 0) {
    for (const failure of probes) console.error(`✖ ${failure}`);
    process.exit(1);
  }

  const { conflicts, headerDrift } = runAudit();
  const passed = conflicts.length === 0 && headerDrift.length === 0;

  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'rule-source-consistency',
          conflicts,
          headerDrift,
          summary: passed
            ? 'Every rule declared by multiple sources carries one severity, and every source header matches its entries.'
            : `${conflicts.length} severity conflict(s), ${headerDrift.length} source header(s) disagree with their entries.`,
        },
        null,
        2,
      ),
    );
    process.exit(passed ? 0 : 1);
  }

  if (passed) {
    console.log('  PASS Rule source consistency: no cross-source severity conflict, no source header drift.');
    process.exit(0);
  }

  if (conflicts.length > 0) {
    console.error(`✖ BLOCK ${conflicts.length} rule id(s) declare different severities across sources:`);
    for (const conflict of conflicts) {
      const detail = conflict.declarations.map((d) => `${d.source}=${d.severity}`).join(', ');
      console.error(`   • ${conflict.id}: ${detail}`);
    }
    console.error('   The catalog generator resolves duplicates first-wins, so the losing declaration is dropped silently.');
  }
  for (const drift of headerDrift) {
    console.error(`   • ${drift.source}: totalRules=${drift.declared}, entries=${drift.actual}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { runAudit, runSelfProbes, findConflicts, findHeaderDrift, collectDeclarations };
