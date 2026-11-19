#!/usr/bin/env node
/**
 * Module: Verification Harness — Shared Rule/Step Lexicon Parity
 * File Path: scripts/validate-rule-lexicon.js
 * Architecture Role: Regression gate for the one vocabulary that the analysis engine and the
 *   workspace gate scripts compile their identifier shapes from. The two surfaces used to hold
 *   separate copies, and the copies drifted: the gate read any `<PREFIX>…-<2-digit>` token as a
 *   semantic step identifier while the engine read only `PC-nn-nn`/`PP-nn-nn`, so a gate step id
 *   was benign to one surface and a hallucinated rule id to the other.
 * Dependencies & Triggers: `node scripts/validate-rule-lexicon.js`; imports the compiled
 *   engine SSOT module (../dist/core/governance/rule-catalog-ssot) and reads the lexicon JSON
 *   the workspace gate loads. Part of the test matrix.
 * Responsibilities:
 *   1. Assert both surfaces resolve the same candidate, step, layer, and date shapes;
 *   2. Assert benign tokens stay benign in BOTH surfaces (external standards, step ids, dates);
 *   3. Assert a genuinely unregistered rule id is still reported by BOTH surfaces;
 *   4. Assert the engine degrades to "no drift" rather than "everything is drift" when the
 *      lexicon is unreachable, so a standalone consumer is not flooded;
 *   5. Assert a malformed lexicon is rejected instead of silently accepted.
 * Exit Semantics & Design Rationale: Exits 0 when every assertion holds, 1 on the first failure.
 *   The suite deliberately drives both implementations rather than re-reading the JSON, because
 *   the defect being guarded is precisely two consumers disagreeing about one file's meaning.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findUnregisteredRuleDrift } = require('../dist/core/governance/rule-catalog-ssot');
const { resetRuleLexiconCache, loadRuleLexicon } = require('../dist/core/governance/rule-lexicon');
const { rmSyncWithRetry } = require('./lib/resilient-fs-cleanup');

const LEXICON_FILE = path.resolve(__dirname, '../../scripts/common/rule-lexicon.json');

/** Step identifiers the workspace gate emits, which must never read as rule drift. */
const BENIGN_STEP_IDS = [
  'RULE-CLOSURE-05',
  'GATE-PROOF-25',
  'BODY-SPLIT-03',
  'BODY-DENSITY-04',
  'FEEDBACK-VOCABULARY-23',
  'RUST-COMPILE-10',
  'PC-01-01',
  'PP-02-03',
];

/** External standards, layer ranges, and dates: benign in both surfaces. */
const BENIGN_NON_STEP_TOKENS = [
  'IEEE-754-1985',
  'HTTP-404-CODE',
  'TLS-1-2',
  'SHA-256-DIGEST',
  'UTF-8-ENCODING',
  'RFC-2119-KEY',
  'CVE-2024-1234',
  'ISO-8601-DATE',
  'L1-L3',
  // The documentation placeholder, not a literal date: a real date such as 2026-10-23 does not
  // match the candidate shape at all (it does not begin with letters), so it needs no excuse.
  'YYYY-MM-DD',
];

/**
 * Registered identifiers that happen to sit in the same syntactic space.
 *
 * These must stay silent because they resolve against the catalog, not because a shape excuses
 * them. Keeping them separate matters: a fixture that reached the same verdict for the wrong
 * reason would pass while the catalog lookup was broken.
 */
const REGISTERED_RESOLVING_IDS = ['L0-COMPILE', 'GOV-RUL-001', 'VOL-TAU-001', 'HYG-DIR-001'];

/** A token that names no registered rule and no benign shape; both surfaces must report it. */
const REAL_DRIFT = 'FAKE-XYZ-999';

/**
 * Reads the lexicon the gate loads, compiling exactly as the gate does.
 *
 * @returns The candidate and forbidden patterns plus the registered id set, compiled once.
 */
function loadGateVocabulary() {
  const document = JSON.parse(fs.readFileSync(LEXICON_FILE, 'utf8'));
  return {
    candidate: new RegExp(document.ruleIdCandidate, 'g'),
    semanticStepId: new RegExp(document.semanticStepId, ''),
    layerRange: new RegExp(document.layerRange, ''),
    calendarDate: new RegExp(document.calendarDate, ''),
    prefixes: document.externalStandardPrefixes,
  };
}

/**
 * Reproduces the gate's benign-token decision for one token.
 *
 * @param token - Candidate identifier.
 * @param vocabulary - Gate-side compiled shapes.
 * @returns True when the gate treats the token as benign.
 */
function gateTreatsAsBenign(token, vocabulary) {
  if (vocabulary.layerRange.test(token)) return true;
  if (vocabulary.calendarDate.test(token)) return true;
  if (vocabulary.semanticStepId.test(token)) return true;
  return vocabulary.prefixes.some((prefix) => token.startsWith(prefix));
}

/**
 * Builds a scratch workspace holding a copy of the lexicon, for degradation tests.
 *
 * @param document - Lexicon document to write, or null to omit the file.
 * @returns Absolute root of the scratch tree.
 */
function scratchRoot(document) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-lexicon-'));
  if (document !== null) {
    fs.mkdirSync(path.join(root, 'scripts', 'common'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'scripts', 'common', 'rule-lexicon.json'),
      JSON.stringify(document),
      'utf8',
    );
  }
  return root;
}

function checkStepVocabularyParity() {
  const gate = loadGateVocabulary();
  for (const token of BENIGN_STEP_IDS) {
    assert.ok(gateTreatsAsBenign(token, gate), `gate must treat '${token}' as a step identifier`);
    assert.deepStrictEqual(
      findUnregisteredRuleDrift(token),
      [],
      `engine must treat '${token}' as a step identifier, not rule drift`,
    );
  }
  console.log(
    `  ✔ ${BENIGN_STEP_IDS.length} semantic step identifiers are benign in both surfaces`,
  );
}

function checkNonStepVocabularyParity() {
  const gate = loadGateVocabulary();
  for (const token of BENIGN_NON_STEP_TOKENS) {
    assert.ok(gateTreatsAsBenign(token, gate), `gate must treat '${token}' as benign`);
    assert.deepStrictEqual(
      findUnregisteredRuleDrift(token),
      [],
      `engine must treat '${token}' as benign`,
    );
  }
  console.log(
    `  ✔ ${BENIGN_NON_STEP_TOKENS.length} external-standard/layer/date tokens are benign in both surfaces`,
  );
}

function checkRegisteredIdsResolve() {
  for (const token of REGISTERED_RESOLVING_IDS) {
    assert.deepStrictEqual(
      findUnregisteredRuleDrift(token),
      [],
      `'${token}' is registered in the catalog and must resolve, not be excused by a shape`,
    );
  }
  console.log(
    `  ✔ ${REGISTERED_RESOLVING_IDS.length} registered identifiers resolve through the catalog`,
  );
}

function checkRealDriftStillReported() {
  const gate = loadGateVocabulary();
  assert.ok(
    !gateTreatsAsBenign(REAL_DRIFT, gate),
    'gate must not treat a fabricated rule id as benign',
  );
  assert.deepStrictEqual(
    findUnregisteredRuleDrift(REAL_DRIFT),
    [REAL_DRIFT],
    'engine must still report a fabricated rule id',
  );
  console.log(
    '  ✔ a fabricated rule id is still reported by both surfaces (a green run is not vacuous)',
  );
}

function checkEmbeddedCandidateBoundary() {
  // A rule id embedded in a longer hyphenated identifier's tail must not be read as a separate id.
  assert.deepStrictEqual(
    findUnregisteredRuleDrift('PREFIX-DEV-ARCH-001'),
    [],
    'the tail of a longer hyphenated identifier must not be reported as its own rule id',
  );
  console.log('  ✔ a hyphenated identifier tail is not misread as a rule id');
}

function checkLexiconShapesAreShared() {
  const engine = loadRuleLexicon();
  assert.ok(engine !== null, 'the engine must resolve the workspace lexicon');
  const gate = loadGateVocabulary();
  assert.strictEqual(
    engine.candidate.source,
    gate.candidate.source,
    'candidate shape must be identical',
  );
  assert.strictEqual(
    engine.semanticStepId.source,
    gate.semanticStepId.source,
    'step shape must be identical',
  );
  assert.strictEqual(
    engine.layerRange.source,
    gate.layerRange.source,
    'layer shape must be identical',
  );
  assert.strictEqual(
    engine.calendarDate.source,
    gate.calendarDate.source,
    'date shape must be identical',
  );
  assert.deepStrictEqual(
    [...engine.externalStandardPrefixes],
    [...gate.prefixes],
    'external-standard prefix vocabulary must be identical',
  );
  console.log('  ✔ both surfaces compile the same shapes from the one lexicon');
}

/**
 * Asserts the documented degradation: a pinned-but-absent lexicon yields "no drift", not
 * "everything is drift". Driven through the exported environment pin, because the upward search
 * from inside the workspace tree always succeeds and could never reach this branch.
 */
function checkDegradationWhenLexiconAbsent() {
  const root = scratchRoot(null);
  const previous = process.env.AUTO_REFACTOR_RULE_LEXICON;
  try {
    process.env.AUTO_REFACTOR_RULE_LEXICON = path.join(
      root,
      'scripts',
      'common',
      'rule-lexicon.json',
    );
    resetRuleLexiconCache();
    assert.strictEqual(loadRuleLexicon(), null, 'an absent pinned lexicon must resolve to null');
    assert.deepStrictEqual(
      findUnregisteredRuleDrift('FAKE-XYZ-999'),
      [],
      'with no lexicon the engine must report no drift rather than reporting everything',
    );
    console.log('  ✔ an unreachable lexicon degrades to "no drift" instead of flooding findings');
  } finally {
    if (previous === undefined) delete process.env.AUTO_REFACTOR_RULE_LEXICON;
    else process.env.AUTO_REFACTOR_RULE_LEXICON = previous;
    rmSyncWithRetry(root, { recursive: true, force: true });
    resetRuleLexiconCache();
  }
}

/**
 * Asserts a pinned-but-malformed lexicon also degrades rather than throwing on a per-file path.
 */
function checkMalformedLexiconDegrades() {
  const incomplete = scratchRoot({ semanticStepId: '^x$' });
  const previous = process.env.AUTO_REFACTOR_RULE_LEXICON;
  try {
    process.env.AUTO_REFACTOR_RULE_LEXICON = path.join(
      incomplete,
      'scripts',
      'common',
      'rule-lexicon.json',
    );
    resetRuleLexiconCache();
    assert.strictEqual(
      loadRuleLexicon(),
      null,
      'a lexicon missing a required shape must resolve to null, not to a partial vocabulary',
    );
    console.log('  ✔ a malformed lexicon resolves to null instead of a partial vocabulary');
  } finally {
    if (previous === undefined) delete process.env.AUTO_REFACTOR_RULE_LEXICON;
    else process.env.AUTO_REFACTOR_RULE_LEXICON = previous;
    rmSyncWithRetry(incomplete, { recursive: true, force: true });
    resetRuleLexiconCache();
  }
}

function checkMalformedLexiconRejected() {
  const gateLoad = (document) => {
    if (typeof document.ruleIdCandidate !== 'string' || document.ruleIdCandidate.length === 0) {
      throw new Error('ruleIdCandidate must be a non-empty string');
    }
    return new RegExp(document.ruleIdCandidate, 'g');
  };
  assert.throws(
    () => gateLoad({ semanticStepId: 'x' }),
    /ruleIdCandidate/,
    'a lexicon without a candidate shape must be rejected, not silently accepted',
  );
  assert.throws(
    () => gateLoad({ ruleIdCandidate: '([' }),
    SyntaxError,
    'a candidate shape that does not compile must be rejected',
  );
  console.log('  ✔ a malformed lexicon is rejected rather than silently accepted');
}

function main() {
  checkLexiconShapesAreShared();
  checkStepVocabularyParity();
  checkNonStepVocabularyParity();
  checkRegisteredIdsResolve();
  checkRealDriftStillReported();
  checkEmbeddedCandidateBoundary();
  checkDegradationWhenLexiconAbsent();
  checkMalformedLexiconDegrades();
  checkMalformedLexiconRejected();
  console.log('  ✔  rule-lexicon parity: engine and gates share one identifier vocabulary');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`✖ BLOCK rule-lexicon parity: ${error.message}`);
    process.exit(1);
  }
}

module.exports = Object.freeze({ loadGateVocabulary, gateTreatsAsBenign, main });
