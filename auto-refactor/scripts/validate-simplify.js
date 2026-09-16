#!/usr/bin/env node
/**
 * Module: Verification Harness — Simplification Rule Key Points
 * File Path: scripts/validate-simplify.js
 * Architecture Role: Integration suite for the `simplify` analyzer rules internalized from
 *     the language-neutral simplification rule set
 * Dependencies & Triggers: `npm run validate-simplify` (part of `npm test`); imports ../dist/api
 *     (scan) plus node's assert/fs/os/path
 * Responsibilities: Assert long-function measurement and its threshold cascade; assert the
 *     commented-out-code streak rule (and that prose comments stay silent); assert empty
 *     implementations for both `pass`/docstring Python bodies and brace-language `{}` bodies;
 *     assert debug-output detection with its CLI/script allow-list
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so CI
 *     fails loudly; the disposable workspace is always removed in `finally`. Every rule is
 *     asserted on both a positive and a near-miss fixture, because a smell detector whose
 *     negative case is untested will eventually start deleting healthy code.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('../dist/api');

const LONG_BODY = Array.from({ length: 65 }, (_, i) => `    const value${i} = ${i};`);
const MEDIUM_BODY = Array.from({ length: 45 }, (_, i) => `    const value${i} = ${i};`);

const FIXTURES = {
  'long.ts': ['export function longOne(): void {'].concat(LONG_BODY, ['}']).join('\n'),
  'medium.ts': ['export function mediumOne(): void {'].concat(MEDIUM_BODY, ['}']).join('\n'),
  'commented.py': [
    '# def old_helper(a):',
    '#     return a + 1',
    '#     if a > 0:',
    'def keep():',
    '    return 1',
    '',
  ].join('\n'),
  'prose.py': [
    '# 这里解释为什么需要重试：',
    '# 网络抖动时立刻失败会让用户看到错误，',
    '# 因此采用指数退避策略。',
    'def keep():',
    '    return 1',
    '',
  ].join('\n'),
  'tiny_comment.py': ['# value = 1', '# value = 2', 'def keep():', '    return 1', ''].join('\n'),
  'empty.py': [
    'def stub():',
    '    """Docstring."""',
    '    pass',
    '',
    '',
    'def real():',
    '    return 1',
    '',
  ].join('\n'),
  'empty.ts': [
    'export function noop() {}',
    'export function real(): number {',
    '    return 1;',
    '}',
  ].join('\n'),
  'debug.py': ['def worker():', '    print("debug")', '    return 1', ''].join('\n'),
  'protocol_stub.py': [
    '"""Module docstring."""',
    'from typing import Protocol',
    '',
    '',
    'class Transport(Protocol):',
    '    """Docstring."""',
    '',
    '    def send(self, message: str) -> bool:',
    '        """Docstring."""',
    '        ...',
    '',
  ].join('\n'),
  'docstring_example.py': ['"""Module docstring.', '', 'def legacy():', '    pass', '"""', ''].join(
    '\n',
  ),
  'cli/tool.py': ['def main():', '    print("cli output")', ''].join('\n'),
  'scripts/tool.py': ['def main():', '    print("script output")', ''].join('\n'),
};

/**
 * Write every fixture plus a threshold-override config into a disposable workspace.
 *
 * @param root - Absolute workspace directory.
 * @returns Absolute path of the generated config file.
 */
function writeWorkspace(root) {
  for (const [name, content] of Object.entries(FIXTURES)) {
    const abs = path.join(root, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const configPath = path.join(root, 'ar.config.json');
  fs.writeFileSync(configPath, JSON.stringify({ thresholds: { maxFunctionLines: 60 } }));
  return configPath;
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-simplify-'));
  try {
    const configFile = writeWorkspace(root);
    const report = await scan({
      root,
      configFile,
      include: ['**/*.ts', '**/*.py'],
      analyzers: ['simplify'],
      cache: false,
      daemon: 'off',
      logLevel: 'silent',
      respectGitignore: false,
      workers: 1,
    });
    const byRule = (rule) => report.issues.filter((i) => i.rule === rule);

    const long = byRule('SIM-LONG-001');
    assert.strictEqual(long.length, 1, 'exactly one over-long function expected');
    assert.strictEqual(long[0].location.file, 'long.ts');
    assert.ok(long[0].detail.lines >= 66, 'span must cover the whole function');
    console.log('  [PASS] SIM-LONG-001 flags only the over-long function');

    assert.ok(
      !report.issues.some((i) => i.location.file === 'medium.ts'),
      'a 47-line function stays below the default 60-line limit',
    );

    const comments = byRule('SIM-COMC-001');
    assert.strictEqual(comments.length, 1, 'only the 3-line code-shaped streak qualifies');
    assert.strictEqual(comments[0].location.file, 'commented.py');
    console.log('  [PASS] SIM-COMC-001 flags code-shaped streaks, prose stays silent');

    const empty = byRule('SIM-EMPTY-001')
      .map((i) => i.location.file)
      .sort();
    assert.deepStrictEqual(
      empty,
      ['empty.py', 'empty.ts'],
      'both placeholder bodies must be flagged',
    );
    console.log('  [PASS] SIM-EMPTY-001 covers pass/docstring and {} bodies only');

    assert.ok(
      !report.issues.some(
        (i) =>
          i.rule === 'SIM-EMPTY-001' &&
          ['protocol_stub.py', 'docstring_example.py'].includes(i.location.file),
      ),
      'ellipsis Protocol stubs and docstring-embedded examples must stay silent',
    );
    console.log('  [PASS] ellipsis stubs and docstring examples are not empty implementations');

    const debug = byRule('SIM-PRNT-001');
    assert.strictEqual(debug.length, 1, 'only non-CLI debug output qualifies');
    assert.strictEqual(debug[0].location.file, 'debug.py');
    console.log('  [PASS] SIM-PRNT-001 exempts cli/ and scripts/ paths');

    const strictConfig = path.join(root, 'strict.config.json');
    fs.writeFileSync(
      strictConfig,
      JSON.stringify({
        thresholds: { maxFunctionLines: 40 },
        analyzers: { simplify: { enabled: true, options: { maxFunctionLines: 40 } } },
      }),
    );
    const strictReport = await scan({
      root,
      configFile: strictConfig,
      include: ['medium.ts'],
      analyzers: ['simplify'],
      cache: false,
      daemon: 'off',
      logLevel: 'silent',
      respectGitignore: false,
      workers: 1,
    });
    assert.strictEqual(
      strictReport.issues.filter((i) => i.rule === 'SIM-LONG-001').length,
      1,
      'a lower threshold must flag the previously acceptable 47-line function',
    );
    console.log('  [PASS] maxFunctionLines threshold is honoured from config');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run()
  .then(() => {
    console.log('\n ALL SIMPLIFICATION KEY POINTS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
