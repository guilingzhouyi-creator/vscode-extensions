#!/usr/bin/env node
/**
 * Module: Verification Harness — Project Neutrality of the Shared Engine
 * File Path: scripts/validate-project-neutrality.js
 * Architecture Role: Repo-hygiene guard asserting the engine stays project-agnostic — rules may
 *     bind to a language and to declared options, never to a consuming project
 * Dependencies & Triggers: `npm run validate-project-neutrality` (part of `npm test`); node's
 *     assert/fs/path only
 * Responsibilities: Assert that no consumer identifier appears in src/scripts/presets/docs;
 *     assert shipped presets are language-scoped (no suppressions, include globs anchored with
 *     the double-star prefix, no file-scoped policy); assert project conventions exist as
 *     declared options rather than hardcoded engine literals
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so CI
 *     fails loudly. This harness names the currently known consumer identifiers on purpose — it
 *     is the single place allowed to, and it excludes itself from its own scan, the same
 *     self-reference avoidance the mojibake rule applies.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
/** Core consumer identifiers the shared engine core (src/presets/templates) must never mention. */
const CORE_CONSUMER_IDENTIFIERS = ['nomos', 'portal', 'workspace-timing', 'webgames', 'kalar'];
/** Legacy forbidden identifiers that must never appear anywhere in the repository. */
const LEGACY_FORBIDDEN_IDENTIFIERS = ['nomos', 'portal'];

const CORE_DIRS = ['src', 'presets', 'templates'];
const INTEGRATION_HARNESSES = new Set([
  'validate-triplane-cross-project.js',
  'validate-gate-system.js',
  'validate-gate-governance.js',
  'validate-feedback-adaptive-supervisor.js',
  'validate-frontend-architecture-governance.js',
  'validate-generalized.js',
  'validate-precision-governance.js',
  'validate-compact-ledger.js',
]);

const INTEGRATION_DOCS = new Set(['05-consumer-integration.md', 'README.md']);

const SELF = 'validate-project-neutrality.js';

/**
 * Collect every non-ignored file under a directory, excluding this harness itself.
 *
 * @param dir - Absolute directory to walk.
 * @param out - Accumulator for absolute file paths.
 * @returns The accumulated file paths.
 */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, out);
    } else if (entry.name !== SELF) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Assert the engine repository carries no consumer-project coupling.
 *
 * @returns Nothing; throws on the first violation.
 */
function run() {
  const coreRe = new RegExp(`\\b(?:${CORE_CONSUMER_IDENTIFIERS.join('|')})\\b`, 'i');
  const legacyRe = new RegExp(`\\b(?:${LEGACY_FORBIDDEN_IDENTIFIERS.join('|')})\\b`, 'i');
  const offenders = [];

  // 1. Verify engine core (src, presets, templates) strictly carries ZERO consumer identifiers
  for (const dir of CORE_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (coreRe.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}:${index + 1}`);
        }
      });
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `engine core (src/presets/templates) must stay strictly project-agnostic; consumer identifier found at: ${offenders.join(', ')}`,
  );
  console.log('  [PASS] engine core (src/presets/templates) is 100% project-agnostic');

  // 2. Verify scripts and documentation: zero legacy forbidden tokens, and active consumer names
  // allowed only inside explicit integration test harnesses and consumer specs.
  const scriptAndDocOffenders = [];
  for (const dir of ['scripts', 'docs']) {
    for (const file of walk(path.join(ROOT, dir))) {
      const base = path.basename(file);
      const isIntegration =
        (dir === 'scripts' && INTEGRATION_HARNESSES.has(base)) ||
        (dir === 'docs' && INTEGRATION_DOCS.has(base));

      const re = isIntegration ? legacyRe : coreRe;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (re.test(line)) {
          scriptAndDocOffenders.push(`${path.relative(ROOT, file)}:${index + 1}`);
        }
      });
    }
  }
  assert.deepStrictEqual(
    scriptAndDocOffenders,
    [],
    `scripts and docs carry unauthorized consumer coupling at: ${scriptAndDocOffenders.join(', ')}`,
  );
  console.log('  [PASS] scripts and docs observe strict consumer boundary constraints');

  const presetDir = path.join(ROOT, 'presets');
  const presets = fs.readdirSync(presetDir).filter((name) => name.endsWith('.json'));
  assert.ok(presets.length > 0, 'at least one language-scoped preset must ship');
  for (const name of presets) {
    const raw = fs.readFileSync(path.join(presetDir, name), 'utf8');
    const preset = JSON.parse(raw);
    assert.ok(
      !('suppressions' in preset),
      `${name}: project policy (suppressions) must not ship in a language preset`,
    );
    assert.ok(
      !raw.includes('matchFile'),
      `${name}: file-scoped policy belongs to the consumer config, not a preset`,
    );
    for (const glob of preset.include || []) {
      assert.ok(
        String(glob).startsWith('**/'),
        `${name}: include glob '${glob}' must be language-scoped (**/ prefix)`,
      );
    }
  }
  console.log(
    '  [PASS] shipped presets are language-scoped (no suppressions, **/-anchored includes)',
  );

  const commentsSrc = fs.readFileSync(path.join(ROOT, 'src/analyzers/comments.ts'), 'utf8');
  const hygieneSrc = fs.readFileSync(path.join(ROOT, 'src/analyzers/hygiene.ts'), 'utf8');
  assert.ok(
    commentsSrc.includes('directiveTokens'),
    'project directive vocabulary must be inflowed via comments.options.directiveTokens',
  );
  assert.ok(
    hygieneSrc.includes('jargonPatterns'),
    'project jargon vocabulary must be inflowed via hygiene.options.jargonPatterns',
  );
  console.log('  [PASS] project conventions are declared options, not engine literals');
}

try {
  run();
  console.log('\n ALL PROJECT NEUTRALITY CHECKS PASSED SUCCESSFULLY!');
} catch (error) {
  console.error('\n[FAIL]', error && error.message ? error.message : error);
  process.exit(1);
}
