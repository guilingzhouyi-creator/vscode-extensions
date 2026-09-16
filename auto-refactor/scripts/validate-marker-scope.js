#!/usr/bin/env node
/**
 * Module: Verification Harness — Marker Scope (vocabulary listing vs applied tag)
 * File Path: scripts/validate-marker-scope.js
 * Architecture Role: Ratchet over the one predicate that decides whether a jargon marker is
 *   documentation ABOUT the vocabulary or a task USING it. Both directions are asserted, because
 *   the failure mode in each direction is the one people actually reach for: dropping the guard
 *   makes every rule report its own description, and loosening it silences the rule on the exact
 *   text it exists to catch.
 * Dependencies & Triggers: `npm run validate-marker-scope`; requires the shared predicate from
 *   `dist/core/governance/markerScope`, so a prior `npm run build` is needed.
 * Responsibilities: Assert that slash-delimited listings are exempt in both the spaced and the
 *   unspaced form, and that an applied tag is still reported - including the hard case where the
 *   marker sits directly after a comment opener, since treating that slash as a delimiter would
 *   exempt every tagged comment in the corpus.
 * Exit Semantics & Design Rationale: Exits 1 if any sample disagrees with its expectation, so a
 *   "fix" that merely widens the exemption cannot be merged silently. The negative samples are
 *   deliberately the first thing a maintainer would try to weaken, which is why they live in the
 *   same file as the positive ones rather than in a comment.
 */
'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');
const { isVocabularyEnumeration } = require(path.join(ROOT, 'dist/core/governance/markerScope'));

/** The marker shape the predicate is exercised against, matching the jargon rules it serves. */
const MARKER_RE = /\b(?:wip|p[0-9]+|phase[\s_]*[0-9]+|st[\s_]*[0-9]+)\b/i;

/**
 * Samples: [line, expectExempt, why it must come out that way].
 * The first five are NEGATIVE samples - they must stay reported.
 */
const SAMPLES = [
  ['// wip: remove before release', false, 'applied tag directly after a // opener'],
  ['//WIP fix this', false, 'no space after the opener; the opener is not a delimiter'],
  ['   // p1 cleanup', false, 'applied phase tag'],
  ['// still wip', false, 'marker inside prose, not inside a list'],
  [' * wip handling', false, 'applied tag in a block comment'],
  ['/* wip */', false, 'bare block-comment tag, not a list'],
  ['pN/stN/phase N/wip', true, 'canonical vocabulary listing, unspaced'],
  ['jargon / WIP marker', true, 'listing with spaces around the slash'],
  ['// p1/stN/phase 2/wip', true, 'listing that begins right after the opener'],
  ['wip/p2/st3', true, 'marker first in the list'],
];

function main() {
  console.log('\n=== Marker Scope: vocabulary listing vs applied tag ===');

  const failures = [];
  let positives = 0;
  let negatives = 0;

  for (const [line, expectExempt, why] of SAMPLES) {
    const match = MARKER_RE.exec(line);
    if (!match) {
      failures.push(`sample does not contain a marker: ${JSON.stringify(line)}`);
      continue;
    }
    const got = isVocabularyEnumeration(line, match.index, match[0]);
    if (expectExempt) positives += 1;
    else negatives += 1;
    if (got === expectExempt) {
      console.log(`  [PASS] ${got ? 'exempt ' : 'reported'}  ${JSON.stringify(line)}`);
      continue;
    }
    failures.push(
      `${JSON.stringify(line)} expected ${expectExempt ? 'exempt' : 'reported'}, got ` +
        `${got ? 'exempt' : 'reported'} (${why})`,
    );
  }

  if (failures.length === 0) {
    console.log(
      `  [PASS] ${negatives} applied tags still reported, ${positives} listings still exempt`,
    );
    console.log('  ALL MARKER SCOPE CHECKS PASSED');
    return 0;
  }

  for (const f of failures) console.log(`  [FAIL] ${f}`);
  console.log(`  MARKER SCOPE FAILURES = ${failures.length}`);
  return 1;
}

process.exit(main());
