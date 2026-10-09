/**
 * Module: Verification Harness — Legacy Rule-id Alias Window
 * File Path: scripts/validate-rule-aliases.js
 * Architecture Role: Contract lock for the alias window that lets a canonical rename land without
 *     breaking frozen baselines or `matchRule` suppressions written against the legacy id
 * Dependencies & Triggers: `npm run validate-rule-aliases` (part of `npm test`); imports
 *     ../dist/core/rules/aliases and drives the mapping plus the registry it mirrors
 * Responsibilities: Assert the alias table covers the registry's non-canonical ids exactly (no
 *     missing entry, no entry without a registered id), that every target is canonical-shaped and
 *     unique, that resolution is idempotent and unknown ids stay themselves, and that the table is
 *     frozen against accidental runtime mutation
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1. The window
 *     is the safety net that makes the eventual id flip a non-breaking change, so a table that
 *     drifts from the registry (a new legacy id, a stale entry, two rules mapped to one target)
 *     must fail here rather than silently break consumer baselines later.
 */
'use strict';

const assert = require('assert');

const {
  LEGACY_RULE_ALIASES,
  areAliasForms,
  auditAliasWindow,
  canonicalRuleId,
  isCanonical3LetterForm,
  legacyRuleIds,
  toCanonicalRuleId,
} = require('../dist/core/rules/aliases');
const {
  CANONICAL_3LETTER_GLOSSARY,
  normalizeTopicCode,
  toCanonicalRuleId: pureToCanonicalRuleId,
} = require('../dist/core/rules/topic-catalog');
const { RULE_ID_PATTERN } = require('../dist/core/rules/registry');

async function main() {
  // ── 1. The table mirrors the registry's legacy set exactly ──
  const audit = auditAliasWindow();
  assert.deepStrictEqual(
    audit.missingAlias,
    [],
    `every registered legacy id needs an alias, missing ${JSON.stringify(audit.missingAlias)}`,
  );
  assert.deepStrictEqual(
    audit.unknownAlias,
    [],
    `every alias key must be a registered rule, unknown ${JSON.stringify(audit.unknownAlias)}`,
  );
  assert.deepStrictEqual(
    audit.malformedTarget,
    [],
    `every target must match RULE_ID_PATTERN, malformed ${JSON.stringify(audit.malformedTarget)}`,
  );
  assert.deepStrictEqual(
    audit.duplicateTargets,
    [],
    `two legacy ids must never share a target, duplicates ${JSON.stringify(audit.duplicateTargets)}`,
  );
  assert.ok(
    legacyRuleIds().length > 0,
    'the fixture is meaningless unless the registry still lists legacy ids',
  );
  console.log('  [PASS] the alias table mirrors the registry legacy set one-to-one');

  // ── 2. Targets are canonical, and canonical ids are never themselves aliased ──
  for (const [legacy, target] of Object.entries(LEGACY_RULE_ALIASES)) {
    assert.ok(RULE_ID_PATTERN.test(target), `${legacy} -> ${target} is not canonical-shaped`);
    assert.ok(!(target in LEGACY_RULE_ALIASES), `${target} must not be an alias key (no chains)`);
    assert.strictEqual(
      canonicalRuleId(target),
      target,
      `canonicalRuleId(${target}) must be stable`,
    );
  }
  console.log('  [PASS] alias targets are canonical and chain-free');

  // ── 3. Resolution is idempotent and keeps unknown ids untouched ──
  for (const legacy of Object.keys(LEGACY_RULE_ALIASES)) {
    const once = canonicalRuleId(legacy);
    assert.strictEqual(canonicalRuleId(once), once, `resolution must be idempotent for ${legacy}`);
  }
  assert.strictEqual(canonicalRuleId('CUSTOM-ZZZ-001'), 'CUSTOM-ZZZ-001');
  assert.strictEqual(canonicalRuleId('anything-goes'), 'anything-goes');
  console.log('  [PASS] resolution is idempotent and unknown ids resolve to themselves');

  // ── 4. Matching treats both spellings as the same rule, and only those ──
  assert.strictEqual(areAliasForms('large-file', 'BIG-SIZE-001'), true);
  assert.strictEqual(areAliasForms('BIG-SIZE-001', 'large-file'), true);
  assert.strictEqual(areAliasForms('large-file', 'large-file'), true);
  assert.strictEqual(areAliasForms('large-file', 'secret-detected'), false);
  assert.strictEqual(areAliasForms('BIG-SIZE-001', 'SEC-TOK-001'), false);
  console.log('  [PASS] both spellings match the same rule and unrelated ids stay apart');

  // ── 5. The published table cannot be mutated at runtime ──
  assert.ok(Object.isFrozen(LEGACY_RULE_ALIASES), 'the alias table must be frozen');
  console.log('  [PASS] the alias table is frozen against runtime mutation');

  // ── 6. Canonical 3-letter glossary is frozen, non-empty, and sampled accurately ──
  assert.ok(
    Object.isFrozen(CANONICAL_3LETTER_GLOSSARY),
    'CANONICAL_3LETTER_GLOSSARY must be frozen',
  );
  assert.ok(Object.keys(CANONICAL_3LETTER_GLOSSARY).length > 0, 'glossary must be non-empty');
  assert.strictEqual(CANONICAL_3LETTER_GLOSSARY['DISP'], 'DSP');
  assert.strictEqual(CANONICAL_3LETTER_GLOSSARY['CONNECT'], 'CNT');
  assert.strictEqual(CANONICAL_3LETTER_GLOSSARY['ONREADY'], 'RDY');
  assert.strictEqual(CANONICAL_3LETTER_GLOSSARY['ERROR'], 'ERR');
  assert.strictEqual(CANONICAL_3LETTER_GLOSSARY['INCLUDES'], 'INC');
  console.log('  [PASS] CANONICAL_3LETTER_GLOSSARY is frozen and samples match specifications');

  // ── 7. normalizeTopicCode produces 3-letter uppercase for all known non-3 topics
  // and preserves 3-letter ──
  for (const [topic, expected] of Object.entries(CANONICAL_3LETTER_GLOSSARY)) {
    const normalized = normalizeTopicCode(topic);
    assert.strictEqual(normalized, expected, `normalizeTopicCode(${topic}) mismatch`);
    assert.strictEqual(normalized.length, 3, `normalized length of ${topic} must be 3`);
    assert.strictEqual(
      normalized,
      normalized.toUpperCase(),
      `normalized ${topic} must be uppercase`,
    );
  }
  assert.strictEqual(normalizeTopicCode('DSP'), 'DSP');
  assert.strictEqual(normalizeTopicCode('SEC'), 'SEC');
  assert.strictEqual(normalizeTopicCode('MEM'), 'MEM');
  assert.strictEqual(normalizeTopicCode('CYC'), 'CYC');
  console.log(
    '  [PASS] normalizeTopicCode normalizes non-3-letter topics and preserves 3-letter topics',
  );

  // ── 8. toCanonicalRuleId maps family-topic-seq correctly ──
  assert.strictEqual(pureToCanonicalRuleId('ARCH-DISP-001'), 'ARCH-DSP-001');
  assert.strictEqual(pureToCanonicalRuleId('GDM-ONREADY-001'), 'GDM-RDY-001');
  assert.strictEqual(pureToCanonicalRuleId('TSM-INCLUDES-001'), 'TSM-INC-001');
  assert.strictEqual(toCanonicalRuleId('ARCH-DISP-001'), 'ARCH-DSP-001');
  assert.strictEqual(toCanonicalRuleId('GDM-ONREADY-001'), 'GDM-RDY-001');
  assert.strictEqual(toCanonicalRuleId('TSM-INCLUDES-001'), 'TSM-INC-001');
  assert.strictEqual(toCanonicalRuleId('large-file'), 'BIG-SZE-001');
  assert.strictEqual(pureToCanonicalRuleId('not-a-rule'), 'not-a-rule');
  assert.strictEqual(toCanonicalRuleId('not-a-rule'), 'not-a-rule');
  console.log('  [PASS] toCanonicalRuleId converts rules to canonical 3-letter format');

  // ── 9. areAliasForms cross-version equivalence & isCanonical3LetterForm verification ──
  assert.strictEqual(areAliasForms('ARCH-DISP-001', 'ARCH-DSP-001'), true);
  assert.strictEqual(areAliasForms('TSM-INCLUDES-001', 'TSM-INC-001'), true);
  assert.strictEqual(areAliasForms('large-file', 'BIG-SZE-001'), true);
  assert.strictEqual(areAliasForms('GDM-ONREADY-001', 'GDM-RDY-001'), true);
  assert.strictEqual(areAliasForms('ARCH-DISP-001', 'TSM-INC-001'), false);

  assert.strictEqual(isCanonical3LetterForm('TSM-INC-001'), true);
  assert.strictEqual(isCanonical3LetterForm('BIG-SZE-001'), true);
  assert.strictEqual(isCanonical3LetterForm('GDM-RDY-001'), true);
  assert.strictEqual(isCanonical3LetterForm('SH-CMD-001'), true);
  assert.strictEqual(isCanonical3LetterForm('PS-CMD-001'), true);
  assert.strictEqual(isCanonical3LetterForm('TSM-INCLUDES-001'), false);
  assert.strictEqual(isCanonical3LetterForm('large-file'), false);
  assert.strictEqual(isCanonical3LetterForm('ARCH-DISP-001'), false);
  assert.strictEqual(isCanonical3LetterForm(''), false);
  assert.strictEqual(isCanonical3LetterForm(null), false);
  console.log(
    '  [PASS] areAliasForms cross-version equivalence and isCanonical3LetterForm verified',
  );
}

main()
  .then(() => {
    console.log('\n ALL RULE ALIAS CHECKS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
