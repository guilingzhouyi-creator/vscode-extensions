#!/usr/bin/env node
/**
 * Module: Verification Harness — Comment Hygiene Rule Key Points
 * File Path: scripts/validate-comment-hygiene.js
 * Architecture Role: Unit-level contract suite for the language-agnostic comment-hygiene
 *     rules: mojibake, comment width, separator consistency, small-module banners
 * Dependencies & Triggers: `npm run validate-comment-hygiene` (part of `npm test`); imports
 *     ../dist/api (CommentAnalyzer) plus node's assert
 * Responsibilities: Assert mojibake severity and detection; assert the 100-column comment
 *     width rule with its directive exemption and code-line non-interference; assert mixed
 *     separator detection with bare-divider exemption; assert the small-module banner rule;
 *     assert that the stylistic trio stays silent at `basic`
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so CI
 *     fails loudly. Fixtures are assembled from string arrays so this harness never trips the
 *     very rules it verifies (a raw banner/divider line in the file would be self-flagged).
 */
'use strict';

const assert = require('assert');
const { CommentAnalyzer } = require('../dist/api');

const analyzer = new CommentAnalyzer();

/**
 * Run the comment analyzer over an in-memory fixture.
 *
 * @param content - Fixture source text.
 * @param level - Comment level to evaluate (`basic` | `standard` | `strict`).
 * @returns The emitted issues for the synthetic file path.
 */
function analyze(content, level) {
  return analyzer.analyze(null, {
    filePath: 'src/probe.ts',
    content,
    options: { level },
    config: { commentLevel: level },
  });
}

/**
 * Collect the rule ids present in a fixture run.
 *
 * @param content - Fixture source text.
 * @param level - Comment level to evaluate.
 * @returns A set of rule ids.
 */
function rulesOf(content, level) {
  return new Set(analyze(content, level).map((issue) => issue.rule));
}

const HEADER = [
  '/**',
  ' * Module: Probe',
  ' * File Path: src/probe.ts',
  ' * Architecture Role: Fixture',
  ' * Dependencies & Triggers: none',
  ' * Responsibilities: fixture',
  ' * Exit Semantics & Design Rationale: fixture',
  ' */',
];

function run() {
  const mojibake = HEADER.concat(['const café = "\uFFFD";']).join('\n');
  const mojibakeIssues = analyze(mojibake, 'standard').filter((i) => i.rule === 'CMT-MOJI-001');
  assert.strictEqual(mojibakeIssues.length, 1, 'replacement character must raise CMT-MOJI-001');
  assert.strictEqual(mojibakeIssues[0].severity, 'error', 'mojibake is an error-severity defect');
  console.log('  [PASS] mojibake detected at error severity');

  const longComment = HEADER.concat(['// ' + 'x'.repeat(130), 'export const ok = 1;']).join('\n');
  assert.ok(
    rulesOf(longComment, 'standard').has('CMT-WID-001'),
    'over-wide comment must be flagged',
  );
  const directive = HEADER.concat([
    '// eslint-disable-next-line no-console ' + 'y'.repeat(120),
    'export const ok = 1;',
  ]).join('\n');
  assert.ok(
    !rulesOf(directive, 'standard').has('CMT-WID-001'),
    'long tool directives keep their exemption',
  );
  const longCode = HEADER.concat(['export const longCodeLine = "' + 'z'.repeat(140) + '";']).join(
    '\n',
  );
  assert.ok(
    !rulesOf(longCode, 'standard').has('CMT-WID-001'),
    'non-comment code lines are outside the comment-width rule',
  );
  console.log('  [PASS] comment width applies to comments only, with directive exemption');

  // Project vocabulary must be declarable, never hardcoded: an undeclared directive token is
  // flagged, and the very same fixture is exempt once the project declares the token.
  const projectDirective = HEADER.concat([
    '// acme:ignore-next-line reason="generated" ' + 'w'.repeat(80),
    'export const ok = 1;',
  ]).join('\n');
  assert.ok(
    rulesOf(projectDirective, 'standard').has('CMT-WID-001'),
    'undeclared directive tokens must not be silently exempt',
  );
  const declaredDirective = analyzer.analyze(null, {
    filePath: 'src/probe.ts',
    content: projectDirective,
    options: { level: 'standard', directiveTokens: ['acme:ignore-next-line'] },
    config: { commentLevel: 'standard' },
  });
  assert.ok(
    !declaredDirective.some((issue) => issue.rule === 'CMT-WID-001'),
    'project-declared directive tokens become exempt',
  );
  console.log('  [PASS] directive exemption is opt-in per project (no hardcoded tokens)');

  const mixed = HEADER.concat([
    '# ── Section A ──',
    'export const a = 1;',
    '# ──────── Section B',
    'export const b = 2;',
  ]).join('\n');
  assert.ok(
    rulesOf(mixed, 'standard').has('CMT-SEP-001'),
    'mixed separator styles must be flagged',
  );
  const bareOnly = HEADER.concat([
    '# ──────────────────',
    'export const a = 1;',
    '// ──────────────────',
  ]).join('\n');
  assert.ok(
    !rulesOf(bareOnly, 'standard').has('CMT-SEP-001'),
    'bare divider rules are decorative and exempt',
  );
  console.log('  [PASS] separator consistency enforced, bare dividers exempt');

  const smallBanner = ['# ══════════════════', 'export const a = 1;'].join('\n');
  assert.ok(
    rulesOf(smallBanner, 'standard').has('CMT-BAN-001'),
    'small modules must not use banners',
  );
  const largeBanner = ['# ══════════════════']
    .concat(Array.from({ length: 160 }, (_, i) => `export const value${i} = ${i};`))
    .join('\n');
  assert.ok(
    !rulesOf(largeBanner, 'standard').has('CMT-BAN-001'),
    'banners stay allowed in substantial modules (>= 150 lines)',
  );
  console.log('  [PASS] banner rule scoped to modules under the line limit');

  const basicRules = rulesOf(longComment, 'basic');
  assert.ok(basicRules.has('CMT-MOJI-001') === false, 'mojibake still runs at basic');
  assert.ok(
    !basicRules.has('CMT-WID-001') &&
      !basicRules.has('CMT-BAN-001') &&
      !basicRules.has('CMT-SEP-001'),
    'stylistic hygiene rules start at standard level',
  );
  assert.ok(
    rulesOf(mojibake, 'basic').has('CMT-MOJI-001'),
    'mojibake must be audited from the basic level upward',
  );
  console.log('  [PASS] level gating: mojibake at basic, stylistic trio at standard');
}

try {
  run();
  console.log('\n ALL COMMENT HYGIENE KEY POINTS PASSED SUCCESSFULLY!');
} catch (error) {
  console.error('\n[FAIL]', error && error.message ? error.message : error);
  process.exit(1);
}
