/**
 * Module: Verification Harness — Rule Registry Consistency
 * File Path: scripts/validate-rules-registry.js
 * Architecture Role: Single-source-of-truth guard for rule identity: every rule id the engine
 *     can emit must be registered, every registered id must be emitted, and the canonical naming
 *     convention (FAMILY-TOPIC-NNN) plus documentation coverage must stay measurable
 * Dependencies & Triggers: `npm run validate-rules-registry` (part of `npm test`); imports
 *     ../dist/core/rules/registry and statically scans src/**\/*.ts for emitted id literals
 * Responsibilities: Assert registry uniqueness and non-empty summary/remediation; assert the
 *     canonical pattern on canonical entries and a legacy reason on legacy ones; assert the
 *     emitted-id set equals the registered-id set (no orphans in either direction); assert the
 *     family prefix of canonical ids matches their declared family; report documentation coverage
 *     (a number that later batches must raise, not a hidden gap)
 * Exit Semantics & Design Rationale: Rejects on the first structural violation and exits 1 so CI
 *     fails loudly. Documentation coverage is printed instead of failing while the docs generator
 *     is still being rolled out; the coverage number is stable output so a regression is visible
 *     in CI logs even before it becomes fatal.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs', '04-analyzers-and-rules', '01-builtin-rules.md');

const {
  RULE_REGISTRY,
  RULE_ID_PATTERN,
  getRule,
  rulesForAnalyzer,
} = require('../dist/core/rules/registry');

const { LEGACY_RULE_ALIASES } = require('../dist/core/rules/aliases');
const { BUILTIN_FACTORIES } = require('../dist/core/analyzerRegistry');
const { BUILTIN_ANALYZERS } = require('../dist/core/config');
const { ALL_BUILTIN_ANALYZERS } = require('../dist/core/router/sparseRuleRouter');

const CANONICAL = new RegExp(RULE_ID_PATTERN.source);

/**
 * Collect every rule id literal the engine's own sources can emit.
 *
 * @returns Map of rule id to the set of source files that mention it.
 */
function emittedRuleIds() {
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (full.endsWith('.ts')) files.push(full);
    }
  })(path.join(ROOT, 'src'));

  const found = new Map();
  const contexts = [
    /rule(?:Id)?:\s*'([A-Za-z][A-Za-z0-9-]*)'/g,
    /mkIssue\(\s*[^,]+,\s*[^,]+,\s*'([A-Za-z][A-Za-z0-9-]*)'/g,
    // Positional helpers: `emit(i, 'PYM-PATH-001', …)` / `flag(lineIdx, 'HYG-BLT-001', …)`.
    /(?:emit|flag|describe|reportIssue|pushIssue)\(\s*[^,]+,\s*'([A-Za-z][A-Za-z0-9-]*)'/g,
    // Safety net: the canonical shape is distinctive enough to match anywhere in the sources.
    /'([A-Z]{2,6}(?:-[A-Z0-9]{2,}){1,3}-\d{3})'/g,
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const re of contexts) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(text)) !== null) {
        const id = match[1];
        if (/^(info|warning|error|string|number|boolean|object)$/.test(id)) continue;
        if (!found.has(id)) found.set(id, new Set());
        found.get(id).add(path.relative(ROOT, file).split(path.sep).join('/'));
      }
    }
  }
  return found;
}

/**
 * Extract the rule ids documented in the built-in rules table.
 *
 * @returns Set of documented rule ids.
 */
function documentedRuleIds() {
  const text = fs.readFileSync(DOCS, 'utf8');
  const ids = new Set();
  for (const line of text.split('\n')) {
    const match = line.match(/^\|\s*`([A-Za-z][A-Za-z0-9-]*)`\s*\|/);
    if (match) ids.add(match[1]);
  }
  return ids;
}

function run() {
  // ── 1. Structural integrity of the registry itself ──
  const ids = RULE_REGISTRY.map((rule) => rule.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'registry ids must be unique');
  for (const rule of RULE_REGISTRY) {
    assert.ok(rule.summary && rule.summary.trim(), `${rule.id}: summary must not be empty`);
    assert.ok(
      rule.remediation && rule.remediation.trim(),
      `${rule.id}: remediation must not be empty`,
    );
    assert.ok(
      !/<(?:TODO|FIXME|TBD|PLACEHOLDER|XXX)[^>]*>|^(?:TODO|FIXME|TBD):\s/im.test(rule.summary),
      `${rule.id}: summary contains unfinished placeholder marker`,
    );
    assert.ok(
      !/<(?:TODO|FIXME|TBD|PLACEHOLDER|XXX)[^>]*>|^(?:TODO|FIXME|TBD):\s/im.test(rule.remediation),
      `${rule.id}: remediation contains unfinished placeholder marker`,
    );
    assert.ok(rule.analyzer && rule.analyzer !== 'unknown', `${rule.id}: analyzer must be known`);
    assert.ok(rule.docsAnchor.includes('#'), `${rule.id}: docsAnchor must point at an anchor`);
    if (rule.canonical) {
      assert.ok(CANONICAL.test(rule.id), `${rule.id}: canonical id must match FAMILY-TOPIC-NNN`);
      assert.strictEqual(
        rule.family,
        rule.id.split('-')[0],
        `${rule.id}: family must equal the canonical prefix`,
      );
    } else {
      assert.ok(
        rule.legacyReason && rule.legacyReason.trim(),
        `${rule.id}: a non-canonical id must declare legacyReason`,
      );
    }
  }
  assert.strictEqual(RULE_ID_PATTERN.test('CMT-MOJI-001'), true, 'pattern must accept canonical');
  assert.strictEqual(RULE_ID_PATTERN.test('magic-number'), false, 'pattern must reject legacy');
  assert.strictEqual(getRule('GOV-EXC-001').analyzer, 'governance', 'lookup must resolve owners');
  assert.ok(rulesForAnalyzer('hygiene').length >= 8, 'analyzer lookup must group rules');
  console.log(
    `  [PASS] registry integrity: ${RULE_REGISTRY.length} rules, unique, fully described`,
  );

  // ── 2. Emitted set must equal the registered set ──
  // The alias window names the canonical ids a later batch will emit. They live in aliases.ts as
  // data, not as emissions, so the declaration site is discounted for ids the table targets —
  // any other mention of the same id still counts as an emission and must stay registered.
  const aliasTargets = new Set(Object.values(LEGACY_RULE_ALIASES));
  const aliasSource = 'src/core/rules/aliases.ts'; // stored repo-relative, POSIX separators
  const emitted = emittedRuleIds();
  for (const [id, files] of [...emitted.entries()]) {
    if (!aliasTargets.has(id)) continue;
    const remaining = new Set([...files].filter((file) => file !== aliasSource));
    if (remaining.size === 0) emitted.delete(id);
    else emitted.set(id, remaining);
  }
  assert.strictEqual(
    aliasTargets.size,
    Object.keys(LEGACY_RULE_ALIASES).length,
    'every legacy id must map to its own canonical target',
  );
  console.log(
    `  [PASS] alias window declares ${aliasTargets.size} planned canonical ids (not emitted yet)`,
  );
  const missingFromRegistry = [...emitted.keys()].filter((id) => !getRule(id)).sort();
  const neverEmitted = ids.filter((id) => !emitted.has(id)).sort();
  assert.deepStrictEqual(
    missingFromRegistry,
    [],
    `rules emitted but not registered: ${missingFromRegistry.join(', ')}`,
  );
  assert.deepStrictEqual(
    neverEmitted,
    [],
    `rules registered but never emitted: ${neverEmitted.join(', ')}`,
  );
  console.log(`  [PASS] registry covers exactly the emitted set (${emitted.size} ids, no orphans)`);

  // ── 2b. Every registry surface must describe the same analyzer set ──
  // Four registries have to agree or an analyzer silently disappears from one execution path:
  // factories (instantiation), BUILTIN_ANALYZERS (declarative defaults), ALL_BUILTIN_ANALYZERS
  // (sparse routing), and the rule entries (what each analyzer emits).
  const factoryIds = Object.keys(BUILTIN_FACTORIES).sort();
  const declaredIds = [...BUILTIN_ANALYZERS].sort();
  const routedIds = [...ALL_BUILTIN_ANALYZERS].sort();
  assert.deepStrictEqual(
    factoryIds,
    declaredIds,
    `analyzer factories and BUILTIN_ANALYZERS must list the same ids`,
  );
  const unrouted = declaredIds.filter((id) => !routedIds.includes(id));
  assert.deepStrictEqual(
    unrouted,
    [],
    `built-in analyzers missing from ALL_BUILTIN_ANALYZERS (they would be dropped by routing): ${unrouted.join(', ')}`,
  );
  const unknownOwners = [...new Set(RULE_REGISTRY.map((rule) => rule.analyzer))].filter(
    (analyzer) => !factoryIds.includes(analyzer) && analyzer !== 'engine',
  );
  assert.deepStrictEqual(
    unknownOwners,
    [],
    `rules owned by analyses without a factory: ${unknownOwners.join(', ')}`,
  );
  console.log(
    `  [PASS] analyzer registries agree (${factoryIds.length} analyzers across factories/config/router)`,
  );

  // ── 3. Naming split must be measurable (legacy ids need an alias window) ──
  const legacy = RULE_REGISTRY.filter((rule) => !rule.canonical)
    .map((rule) => rule.id)
    .sort();
  console.log(`  [PASS] canonical ${ids.length - legacy.length} / legacy ${legacy.length}`);
  if (legacy.length > 0) {
    console.log(`         legacy ids pending an alias window: ${legacy.join(', ')}`);
  }

  // ── 4. Documentation coverage must stay visible and non-regressing ──
  const documented = documentedRuleIds();
  const covered = ids.filter((id) => documented.has(id));
  assert.ok(
    covered.length >= 25,
    `documentation coverage regressed: ${covered.length}/${ids.length} rules documented`,
  );
  const coverageLabel =
    covered.length === ids.length
      ? `docs coverage ${covered.length}/${ids.length} (every registered rule has a docs row)`
      : `docs coverage ${covered.length}/${ids.length} (undocumented ids listed below)`;
  console.log(`  [PASS] ${coverageLabel}`);
  const uncovered = ids.filter((id) => !documented.has(id)).sort();
  if (uncovered.length > 0) {
    console.log(`         undocumented: ${uncovered.join(', ')}`);
  }
}

try {
  run();
  console.log('\n ALL RULE REGISTRY CONSISTENCY CHECKS PASSED SUCCESSFULLY!');
} catch (error) {
  console.error('\n[FAIL]', error && error.message ? error.message : error);
  process.exit(1);
}
