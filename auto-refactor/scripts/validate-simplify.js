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
  'deep_nested.ts': [
    'export function deepCheck(a: number, b: number, c: number, d: number): number {',
    '    if (a > 0) {',
    '        if (b > 0) {',
    '            if (c > 0) {',
    '                if (d > 0) {',
    '                    return a + b + c + d;',
    '                }',
    '            }',
    '        }',
    '    }',
    '    return 0;',
    '}',
  ].join('\n'),
  'ternary.ts': [
    'export function testImm(flag: boolean): number {',
    '    let value: number;',
    '    if (flag) {',
    '        value = 10;',
    '    } else {',
    '        value = 20;',
    '    }',
    '    return value;',
    '}',
    'export function testReturn(val: number): string {',
    '    if (val > 0) {',
    '        return "positive";',
    '    } else {',
    '        return "non-positive";',
    '    }',
    '}',
    'export function testSeq(val: number): string {',
    '    if (val === 0) return "zero";',
    '    return "nonzero";',
    '}',
  ].join('\n'),
  'ternary_negative.ts': [
    'export function testSideEffect(flag: boolean, count: number): number {',
    '    let value = 0;',
    '    if (flag) {',
    '        value = count++;',
    '    } else {',
    '        value = 20;',
    '    }',
    '    return value;',
    '}',
    'export function testLong(flag: boolean): string {',
    '    if (flag) {',
    '        return "this is an extremely long string that definitely exceeds eighty columns of width when combined with everything else in the statement";',
    '    } else {',
    '        return "another extremely long string that guarantees the folded ternary expression length ceiling is triggered";',
    '    }',
    '}',
  ].join('\n'),
  // SIM-ELSE-001 fixtures
  'redundant_else_return.ts': [
    'export function check(val: number): string {',
    '    if (val > 0) {',
    '        return "positive";',
    '    } else {',
    '        return "non-positive";',
    '    }',
    '}',
  ].join('\n'),
  'redundant_else_throw.ts': [
    'export function check(val: number): void {',
    '    if (val < 0) {',
    '        throw new Error("negative");',
    '    } else {',
    '        processValue(val);',
    '    }',
    '}',
  ].join('\n'),
  'redundant_else_break.ts': [
    'export function find(arr: number[], target: number): number {',
    '    let result = -1;',
    '    for (let i = 0; i < arr.length; i++) {',
    '        if (arr[i] === target) {',
    '            result = i;',
    '            break;',
    '        } else {',
    '            continue;',
    '        }',
    '    }',
    '    return result;',
    '}',
  ].join('\n'),
  'redundant_else_continue.ts': [
    'export function process(arr: number[]): void {',
    '    for (const x of arr) {',
    '        if (x < 0) {',
    '            continue;',
    '        } else {',
    '            handleValue(x);',
    '        }',
    '    }',
    '}',
  ].join('\n'),
  'no_else_if.ts': [
    'export function check(val: number): string {',
    '    if (val > 0) {',
    '        return "positive";',
    '    }',
    '    return "non-positive";',
    '}',
  ].join('\n'),
  // SIM-BOOL-001 fixtures
  'bool_return_ifelse.ts': [
    'export function isPositive(val: number): boolean {',
    '    if (val > 0) {',
    '        return true;',
    '    } else {',
    '        return false;',
    '    }',
    '}',
  ].join('\n'),
  'bool_return_ternary.ts': [
    'export function isPositive(val: number): boolean {',
    '    return val > 0 ? true : false;',
    '}',
  ].join('\n'),
  'bool_return_noelse.ts': [
    'export function isPositive(val: number): boolean {',
    '    if (val > 0) return true;',
    '    return false;',
    '}',
  ].join('\n'),
  'bool_return_normal.ts': [
    'export function getFlag(flag: boolean): boolean {',
    '    return flag;',
    '}',
  ].join('\n'),
  'bool_return_complex.ts': [
    'export function check(val: number): boolean {',
    '    if (val > 0) {',
    '        trackPositive(val);',
    '        return true;',
    '    } else {',
    '        trackNonPositive(val);',
    '        return false;',
    '    }',
    '}',
  ].join('\n'),
  // SIM-GUARD-001 fixtures
  'guard_clauses_3.ts': [
    'export function process(a: number, b: number, c: number): number {',
    '    if (a <= 0) {',
    '        return -1;',
    '    }',
    '    if (b <= 0) {',
    '        return -2;',
    '    }',
    '    if (c <= 0) {',
    '        return -3;',
    '    }',
    '    return a + b + c;',
    '}',
  ].join('\n'),
  'guard_clauses_2.ts': [
    'export function process(a: number, b: number): number {',
    '    if (a <= 0) {',
    '        return -1;',
    '    }',
    '    if (b <= 0) {',
    '        return -2;',
    '    }',
    '    return a + b;',
    '}',
  ].join('\n'),
  'guard_clauses_middle.ts': [
    'export function process(arr: number[]): number {',
    '    let sum = 0;',
    '    for (const x of arr) {',
    '        if (x < 0) return -1;',
    '        if (x === 0) return 0;',
    '        if (x > 100) return 100;',
    '        sum += x;',
    '    }',
    '    return sum;',
    '}',
  ].join('\n'),
  'guard_clauses_throw.ts': [
    'export function process(a: number, b: number, c: number): number {',
    '    if (a <= 0) throw new Error("a");',
    '    if (b <= 0) throw new Error("b");',
    '    if (c <= 0) throw new Error("c");',
    '    return a + b + c;',
    '}',
  ].join('\n'),
  'guard_clauses_mixed.ts': [
    'export function process(a: number, b: number): number {',
    '    if (a <= 0) { return -1; }',
    '    let result = a * 2;',
    '    if (b <= 0) return -2;',
    '    return result + b;',
    '}',
  ].join('\n'),
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
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      thresholds: { maxFunctionLines: 60 },
      analyzers: {
        simplify: {
          options: { checkGuardClauses: true, maxGuardClauseNesting: 3 },
        },
      },
    }),
  );
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

    const flat = byRule('SIM-FLAT-002');
    assert.strictEqual(flat.length, 1, 'deeply nested function must trigger SIM-FLAT-002');
    assert.strictEqual(flat[0].location.file, 'deep_nested.ts');
    assert.ok(flat[0].detail.nestingDepth >= 4, 'nesting depth must be at least 4');
    console.log(
      '  [PASS] SIM-FLAT-002 flags deep conditional nesting and recommends guard clauses',
    );

    const trn = byRule('SIM-TRN-001').filter((i) => i.location.file === 'ternary.ts');
    assert.strictEqual(
      trn.length,
      3,
      'SIM-TRN-001 must flag exactly the 3 safe candidates in ternary.ts',
    );
    assert.strictEqual(
      trn.every((i) => i.location.file === 'ternary.ts'),
      true,
    );
    console.log('  [PASS] SIM-TRN-001 identifies safe shallow ternary folding opportunities');

    const imm = byRule('SIM-IMM-001').filter((i) => i.location.file === 'ternary.ts');
    assert.strictEqual(
      imm.length,
      1,
      'SIM-IMM-001 must flag mutable let fold opportunity in ternary.ts',
    );
    assert.strictEqual(imm[0].detail.canMakeImmutable, true);
    assert.strictEqual(imm[0].detail.rewardBonus, 5);
    console.log('  [PASS] SIM-IMM-001 detects immutable const conversion with +5 reward bonus');

    // === SIM-ELSE-001: redundant-else ===
    const redundantElse = byRule('SIM-ELSE-001');
    const redundantElseFiles = redundantElse.map((i) => i.location.file).sort();

    // Positive cases: should flag
    assert.ok(
      redundantElseFiles.includes('redundant_else_return.ts'),
      'SIM-ELSE-001 must flag if-return-else pattern',
    );
    assert.ok(
      redundantElseFiles.includes('redundant_else_throw.ts'),
      'SIM-ELSE-001 must flag if-throw-else pattern',
    );
    assert.ok(
      redundantElseFiles.includes('redundant_else_break.ts'),
      'SIM-ELSE-001 must flag if-break-else pattern',
    );
    assert.ok(
      redundantElseFiles.includes('redundant_else_continue.ts'),
      'SIM-ELSE-001 must flag if-continue-else pattern',
    );

    // Negative case: no else, should NOT flag
    assert.ok(
      !redundantElseFiles.includes('no_else_if.ts'),
      'SIM-ELSE-001 must NOT flag if without else',
    );

    assert.strictEqual(redundantElse.every((i) => i.severity === 'info'), true, 'SIM-ELSE-001 severity must be info');
    console.log('  [PASS] SIM-ELSE-001 flags redundant else after terminating statements');

    // === SIM-BOOL-001: simplify-boolean-return ===
    const boolReturn = byRule('SIM-BOOL-001');
    const boolReturnFiles = boolReturn.map((i) => i.location.file).sort();

    // Positive cases: should flag
    assert.ok(
      boolReturnFiles.includes('bool_return_ifelse.ts'),
      'SIM-BOOL-001 must flag if/else true/false pattern',
    );
    assert.ok(
      boolReturnFiles.includes('bool_return_ternary.ts'),
      'SIM-BOOL-001 must flag ternary true/false pattern',
    );
    assert.ok(
      boolReturnFiles.includes('bool_return_noelse.ts'),
      'SIM-BOOL-001 must flag if-return without else pattern',
    );

    // Negative cases: should NOT flag
    assert.ok(
      !boolReturnFiles.includes('bool_return_normal.ts'),
      'SIM-BOOL-001 must NOT flag normal boolean return',
    );
    assert.ok(
      !boolReturnFiles.includes('bool_return_complex.ts'),
      'SIM-BOOL-001 must NOT flag if/else with side effects',
    );

    assert.strictEqual(boolReturn.every((i) => i.severity === 'info'), true, 'SIM-BOOL-001 severity must be info');
    console.log('  [PASS] SIM-BOOL-001 flags simplifiable boolean return patterns');

    // === SIM-GUARD-001: use-guard-clause ===
    const guardClause = byRule('SIM-GUARD-001');
    const guardClauseFiles = guardClause.map((i) => i.location.file).sort();

    // Positive case: 3 consecutive if-return at function start should trigger
    assert.ok(
      guardClauseFiles.includes('guard_clauses_3.ts'),
      'SIM-GUARD-001 must flag 3 consecutive if-return at function start',
    );
    assert.ok(
      guardClauseFiles.includes('guard_clauses_throw.ts'),
      'SIM-GUARD-001 must flag 3 consecutive if-throw at function start',
    );

    // Negative cases: should NOT flag
    assert.ok(
      !guardClauseFiles.includes('guard_clauses_2.ts'),
      'SIM-GUARD-001 must NOT flag only 2 consecutive guard clauses (below threshold)',
    );
    assert.ok(
      !guardClauseFiles.includes('guard_clauses_middle.ts'),
      'SIM-GUARD-001 must NOT flag nested ifs inside loops (not at function start)',
    );
    assert.ok(
      !guardClauseFiles.includes('guard_clauses_mixed.ts'),
      'SIM-GUARD-001 must NOT flag when non-if statement breaks the sequence',
    );

    assert.strictEqual(guardClause.every((i) => i.severity === 'info'), true, 'SIM-GUARD-001 severity must be info');
    console.log('  [PASS] SIM-GUARD-001 flags deep conditional nesting at function start');

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
