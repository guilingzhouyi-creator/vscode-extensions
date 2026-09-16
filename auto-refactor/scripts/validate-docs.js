#!/usr/bin/env node
/**
 * Module: Verification Harness — Documentation Rule Key Points
 * File Path: scripts/validate-docs.js
 * Architecture Role: Integration suite for the `docs` analyzer rules internalized from the
 *     format-level document rules: fence balance, dead references, duplicated prose
 * Dependencies & Triggers: `npm run validate-docs` (part of `npm test`); imports ../dist/api
 *     (scan) plus node's assert/fs/os/path
 * Responsibilities: Assert .md discovery no longer raises LANG-UNSUPPORTED; assert unbalanced
 *     fences, dead relative references and duplicated prose are flagged while a clean document
 *     and an existing reference stay silent
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so CI
 *     fails loudly; the disposable workspace is always removed in `finally`. Every rule is
 *     paired with a clean document because a documentation linter that flags healthy docs is
 *     worse than no linter at all.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('../dist/api');

const CLEAN = [
  '# Clean guide',
  '',
  'See [notes](docs/notes.md) for details, and `docs/notes.md` in code form.',
  '',
  '```bash',
  'npm run gate',
  '```',
  '',
  'One prose sentence lives here and appears exactly once.',
  '',
].join('\n');

const BROKEN = [
  '# Broken guide',
  '',
  'See [gone](docs/missing.md) for details.',
  '',
  '```python',
  'print("never closed")',
  '',
  'This sentence explains the retry policy in one canonical place.',
  '',
  'This sentence explains the retry policy in one canonical place.',
  '',
].join('\n');

/**
 * Write the fixtures into a disposable workspace.
 *
 * @param root - Absolute workspace directory.
 * @returns Absolute path of the generated config file.
 */
function writeWorkspace(root) {
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'notes.md'), '# Notes\n');
  fs.writeFileSync(path.join(root, 'clean.md'), CLEAN);
  fs.writeFileSync(path.join(root, 'broken.md'), BROKEN);
  const configPath = path.join(root, 'ar.config.json');
  fs.writeFileSync(configPath, JSON.stringify({}));
  return configPath;
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-docs-'));
  try {
    const configFile = writeWorkspace(root);
    const report = await scan({
      root,
      configFile,
      include: ['**/*.md'],
      analyzers: ['docs'],
      cache: false,
      daemon: 'off',
      logLevel: 'silent',
      respectGitignore: false,
      workers: 1,
    });

    assert.ok(
      !report.issues.some((i) => i.rule === 'LANG-UNSUPPORTED'),
      'markdown must be claimed by an adapter, not reported as an unsupported language',
    );
    console.log('  [PASS] .md is adapter-claimed (no LANG-UNSUPPORTED)');

    const rulesIn = (file) => report.issues.filter((i) => i.location.file === file);
    const broken = rulesIn('broken.md');
    assert.strictEqual(
      broken.filter((i) => i.rule === 'DOC-FEN-001').length,
      1,
      'the unbalanced fence must be reported once',
    );
    assert.strictEqual(
      broken.filter((i) => i.rule === 'DOC-LNK-001').length,
      1,
      'the dead relative reference must be reported',
    );
    assert.strictEqual(
      broken.filter((i) => i.rule === 'DOC-DUP-001').length,
      1,
      'duplicated prose must be reported once per document',
    );
    console.log('  [PASS] fence, dead reference and duplicate prose are all detected');

    assert.deepStrictEqual(rulesIn('clean.md'), [], 'a healthy document must stay silent');
    console.log('  [PASS] clean document (balanced fence + resolvable reference) stays silent');

    assert.ok(
      !report.issues.some((i) => i.location.file === 'docs/notes.md'),
      'referenced target document must not be flagged',
    );
    console.log('  [PASS] referenced target document stays silent');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run()
  .then(() => {
    console.log('\n ALL DOCUMENTATION KEY POINTS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
