#!/usr/bin/env node
/**
 * Module: Verification Harness — Rule Dictionary ↔ Registry Closure
 * File Path: scripts/validate-rule-dictionary-closure.js
 * Architecture Role: Replaces the old cardinality assertion (`>= 270 entries`) with a two-way
 *   closure between the presentation dictionaries and the engine rule registry. A count only
 *   proves the table grew; it cannot prove a key names a rule that exists, nor that an emitted
 *   rule can be explained to a human. Both directions are asserted here instead.
 * Dependencies & Triggers: consumes ../dist/core/rules/registry and
 *   ../dist/core/praxis/presentation/dictionaries/*; registered in scripts/test-parallel.js.
 * Responsibilities:
 *   1. Assert every zh-CN and English key is a registered rule id (no orphan translations).
 *   2. Assert every canonical rule has a zh-CN entry (no untranslated emitted rule).
 *   3. Assert each entry carries real prose rather than echoing its own id (no hollow entry).
 *   4. Assert the English subset is closed too, so an orphan cannot hide in one table only.
 * Exit Semantics & Design Rationale: Exits 0 only when all four closures hold, 1 listing each
 *   violating id. No numeric floor is declared anywhere: a floor decays into a permanent pass as
 *   soon as the tables grow, which is exactly how the previous guard stopped detecting drift.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { RULE_REGISTRY } = require(path.join(ROOT, 'dist/core/rules/registry'));
const { ZH_CN_RULES } = require(
  path.join(ROOT, 'dist/core/praxis/presentation/dictionaries/zh-cn'),
);
const { EN_RULES } = require(path.join(ROOT, 'dist/core/praxis/presentation/dictionaries/en'));

/** Any CJK ideograph proves the prose was translated rather than left in English. */
const CJK_RE = /[\u4e00-\u9fa5]/;

const REGISTERED_IDS = new Set(RULE_REGISTRY.map((rule) => rule.id));
const CANONICAL_IDS = RULE_REGISTRY.filter((rule) => rule.canonical !== false).map(
  (rule) => rule.id,
);

/**
 * Collects ids in `keys` that the registry does not know about.
 *
 * @param keys - Dictionary keys to check.
 * @returns Ids that would render a translation for a rule no analyzer can emit.
 */
function findOrphans(keys) {
  return keys.filter((key) => !REGISTERED_IDS.has(key));
}

/**
 * Collects canonical ids with no entry in `table`.
 *
 * @param table - Dictionary to search.
 * @returns Ids that a human-facing card would render as a bare id.
 */
function findMissing(table) {
  return CANONICAL_IDS.filter((id) => !Object.prototype.hasOwnProperty.call(table, id));
}

/**
 * Collects entries whose prose is not actually prose.
 *
 * A dictionary can satisfy both closures above while every value echoes its own key, which is
 * what a placeholder migration leaves behind. Name equality, empty strings, and untranslated
 * Chinese entries are all treated as hollow.
 *
 * @param table - Dictionary to inspect.
 * @param requiresCjk - True when the entry must carry translated Chinese prose.
 * @returns Ids whose entry cannot be shown to a human as-is.
 */
function findHollow(table, requiresCjk) {
  return Object.entries(table)
    .filter(([id, entry]) => {
      if (typeof entry.name !== 'string' || entry.name.length === 0) return true;
      if (typeof entry.summary !== 'string' || entry.summary.length === 0) return true;
      if (typeof entry.remediation !== 'string' || entry.remediation.length === 0) {
        return true;
      }
      if (entry.name === id) return true;
      return requiresCjk && !CJK_RE.test(entry.name);
    })
    .map(([id]) => id);
}

/**
 * Runs one named assertion and records its verdict.
 *
 * @param name - Assertion description.
 * @param body - Body that throws on violation.
 * @param results - Collector.
 */
function check(name, body, results) {
  try {
    body();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, message: error.message });
  }
}

const results = [];

check(
  'every zh-CN key names a registered rule',
  () => {
    const orphans = findOrphans(Object.keys(ZH_CN_RULES));
    assert.deepStrictEqual(orphans, [], `orphan zh-CN keys: ${orphans.join(', ')}`);
  },
  results,
);

check(
  'every English key names a registered rule',
  () => {
    const orphans = findOrphans(Object.keys(EN_RULES));
    assert.deepStrictEqual(orphans, [], `orphan en keys: ${orphans.join(', ')}`);
  },
  results,
);

check(
  'every canonical rule has a zh-CN entry',
  () => {
    const missing = findMissing(ZH_CN_RULES);
    assert.deepStrictEqual(
      missing,
      [],
      `canonical rules without zh-CN entry: ${missing.join(', ')}`,
    );
  },
  results,
);

check(
  'no zh-CN entry merely echoes its own id',
  () => {
    const hollow = findHollow(ZH_CN_RULES, true);
    assert.deepStrictEqual(hollow, [], `hollow zh-CN entries: ${hollow.join(', ')}`);
  },
  results,
);

check(
  'no English entry is empty or id-only',
  () => {
    const hollow = findHollow(EN_RULES, false);
    assert.deepStrictEqual(hollow, [], `hollow en entries: ${hollow.join(', ')}`);
  },
  results,
);

check(
  'orphan detection rejects an unregistered key and accepts a registered one',
  () => {
    // Negative control: without this, a findOrphans that returned [] unconditionally would
    // pass every closure above while detecting nothing.
    const probe = { 'GHOST-RUL-999': {} };
    assert.deepStrictEqual(findOrphans(Object.keys(probe)), ['GHOST-RUL-999']);
    const real = { [CANONICAL_IDS[0]]: {} };
    assert.deepStrictEqual(findOrphans(Object.keys(real)), []);
  },
  results,
);

check(
  'hollow detection rejects an id-echoing entry and accepts a translated one',
  () => {
    const echo = { [CANONICAL_IDS[0]]: { name: CANONICAL_IDS[0], summary: 's', remediation: 'r' } };
    assert.deepStrictEqual(findHollow(echo, true), [CANONICAL_IDS[0]]);
    const translated = {
      [CANONICAL_IDS[0]]: { name: '实际规则名称', summary: '说明', remediation: '修复' },
    };
    assert.deepStrictEqual(findHollow(translated, true), []);
  },
  results,
);

const failed = results.filter((entry) => !entry.ok);
for (const entry of results) {
  console.log(
    `${entry.ok ? 'PASS' : 'FAIL'} ${entry.name}${entry.ok ? '' : ` — ${entry.message}`}`,
  );
}
if (failed.length > 0) {
  console.error(`\n${failed.length}/${results.length} dictionary closure assertions failed.`);
  process.exit(1);
}

console.log(
  `\n${results.length}/${results.length} closure assertions hold ` +
    `(${Object.keys(ZH_CN_RULES).length} zh-CN / ${Object.keys(EN_RULES).length} en entries, ` +
    `${CANONICAL_IDS.length} canonical rules).`,
);
