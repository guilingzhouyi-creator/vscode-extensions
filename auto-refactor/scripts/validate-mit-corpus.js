#!/usr/bin/env node
/**
 * Module: Verification Harness — Real-World MIT Open Source Corpus Validation
 * File Path: scripts/validate-mit-corpus.js
 * Architecture Role: Regression guard asserting parser correctness, ignore policy root anchoring,
 *   multi-language actionable diagnostic formatting, and language idiom tolerations against
 *   real-world open-source projects (Day.js, Zustand, Bottle).
 * Dependencies & Triggers: dist/ core modules; executed as part of `npm test` and `test:parallel`.
 * Responsibilities:
 *   1. Assert .gitignore root path anchoring (/dir does not match src/dir).
 *   2. Assert multi-language suggestion generator conforms to Python, Rust, GDScript, and
 *      TS syntax.
 *   3. Assert language standard idioms (typeof operands, relative module imports) are tolerated.
 *   4. Assert dedicated constants modules exempt constant definitions from circular magic
 *      number flagging.
 *   5. When local MIT project checkouts are available, verify end-to-end scanner stability and
 *      metrics.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passing, 1 on any regression.
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { parseGitignoreLines } = require('../dist/core/policy/gitignore');
const { inferFineGrainedFileRole } = require('../dist/core/intelligence/file-role-inference');
const { ConstantsAnalyzer } = require('../dist/analyzers/constants');
const { createSourceFile } = require('../dist/utils/ast');

let total = 0;
let passed = 0;

function check(desc, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✔ [PASS] ${desc}`);
  } catch (err) {
    console.error(`  ✖ [FAIL] ${desc}: ${err.message}`);
    process.exitCode = 1;
  }
}

async function checkAsync(desc, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✔ [PASS] ${desc}`);
  } catch (err) {
    console.error(`  ✖ [FAIL] ${desc}: ${err.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('--- Validating Gitignore Root Path Anchoring ---');

  check('gitignore leading slash anchors strictly to repository root', () => {
    const gitignoreLines = ['/locale', '/plugin', 'dist/', 'node_modules/'];
    const isIgnored = parseGitignoreLines(gitignoreLines);

    // Root-level matches
    assert.strictEqual(isIgnored('locale'), true);
    assert.strictEqual(isIgnored('locale/zh-cn.js'), true);
    assert.strictEqual(isIgnored('plugin/custom.js'), true);

    // Deep subdirectories with identical names MUST NOT be filtered
    assert.strictEqual(isIgnored('src/locale/zh-cn.js'), false);
    assert.strictEqual(isIgnored('src/plugin/custom.js'), false);
    assert.strictEqual(isIgnored('packages/dayjs/src/locale/en.js'), false);
  });

  console.log('--- Validating Dedicated Constants File Recognition ---');

  check('file-role-inference classifies singular and plural constant modules', () => {
    assert.strictEqual(inferFineGrainedFileRole('src/constant.js').role, 'config_constant');
    assert.strictEqual(inferFineGrainedFileRole('src/constants.ts').role, 'config_constant');
    assert.strictEqual(inferFineGrainedFileRole('lib/configs/app.json').role, 'config_constant');
    assert.strictEqual(inferFineGrainedFileRole('src/locale/zh-cn.js').role, 'config_constant');
  });

  check(
    'constant file arithmetic declarations are exempt from circular magic number flagging',
    () => {
      const constantModuleText = [
        'export const SECONDS_A_MINUTE = 60;',
        'export const SECONDS_A_HOUR = SECONDS_A_MINUTE * 60;',
        'export const SECONDS_A_DAY = SECONDS_A_HOUR * 24;',
        'export const SECONDS_A_WEEK = SECONDS_A_DAY * 7;',
        'export const MILLISECONDS_A_SECOND = 1000;',
      ].join('\n');

      const analyzer = new ConstantsAnalyzer();
      const issues = analyzer.analyze(createSourceFile('src/constant.js', constantModuleText), {
        filePath: 'src/constant.js',
        content: constantModuleText,
        options: { magicNumberMin: 5 },
      });

      const magicNumberIssues = issues.filter((i) => i.rule === 'magic-number');
      assert.strictEqual(
        magicNumberIssues.length,
        0,
        `Expected 0 magic-number issues in constant definition file, got ${magicNumberIssues.length}`,
      );
    },
  );

  console.log('--- Validating Language-Aware Diagnostic Suggestions ---');

  check('constants analyzer formats language-appropriate suggestion syntax', () => {
    const analyzer = new ConstantsAnalyzer();

    // 1. Python file suggestion test
    const pyText = 'def get_url():\n    return "http://localhost:8080/api/v1"\n';
    const pyIssues = analyzer.analyze(createSourceFile('app.py', pyText), {
      filePath: 'app.py',
      content: pyText,
      options: { hardcodedStringMinLength: 5 },
    });

    const pyStringIssue = pyIssues.find((i) => i.rule === 'hardcoded-string');
    if (pyStringIssue && pyStringIssue.suggestion) {
      assert.strictEqual(
        pyStringIssue.suggestion.includes('const '),
        false,
        'Python suggestion must not contain "const"',
      );
      assert.strictEqual(
        pyStringIssue.suggestion.endsWith(';'),
        false,
        'Python suggestion must not end with a semicolon',
      );
      assert.strictEqual(
        pyStringIssue.suggestion.includes('='),
        true,
        'Python suggestion must contain assignment',
      );
    }

    // 2. TypeScript / JavaScript suggestion test
    const tsText = 'function getUrl() {\n    return "http://localhost:8080/api/v1";\n}\n';
    const tsIssues = analyzer.analyze(createSourceFile('app.ts', tsText), {
      filePath: 'app.ts',
      content: tsText,
      options: { hardcodedStringMinLength: 5 },
    });

    const tsStringIssue = tsIssues.find((i) => i.rule === 'hardcoded-string');
    if (tsStringIssue && tsStringIssue.suggestion) {
      assert.strictEqual(
        tsStringIssue.suggestion.startsWith('const '),
        true,
        'TS suggestion must start with "const "',
      );
      assert.strictEqual(
        tsStringIssue.suggestion.endsWith(';'),
        true,
        'TS suggestion must terminate with semicolon',
      );
    }
  });

  check('suggested constant names starting with digits receive safe prefix', () => {
    const analyzer = new ConstantsAnalyzer();
    const code = ['const a = "0";', 'const b = "0";', 'const c = "0";', 'const d = "0";'].join(
      '\n',
    );
    const issues = analyzer.analyze(createSourceFile('test.js', code), {
      filePath: 'test.js',
      content: code,
      options: { duplicateLiteralThreshold: 3 },
    });

    const dup = issues.find((i) => i.rule === 'duplicate-literal');
    if (dup && dup.suggestion) {
      assert.strictEqual(
        /\bconst\s+[0-9]/.test(dup.suggestion),
        false,
        `Constant name must not start with a digit: ${dup.suggestion}`,
      );
      assert.strictEqual(
        dup.suggestion.includes('CONST_0'),
        true,
        `Expected CONST_0 prefix in suggestion: ${dup.suggestion}`,
      );
    }
  });

  console.log('--- Validating Language Standard Idiom Toleration ---');

  check('typeof comparisons and relative import paths are tolerated', () => {
    const code = [
      "import '../vanilla';",
      "const isFunc = typeof x === 'function';",
      "const isStr = typeof y === 'string';",
      "const isNum = typeof z === 'number';",
      "const isObj = typeof w === 'object';",
      "const isBool = typeof a === 'boolean';",
      "const isUndef = typeof b === 'undefined';",
    ].join('\n');

    const analyzer = new ConstantsAnalyzer();
    const issues = analyzer.analyze(createSourceFile('middleware.ts', code), {
      filePath: 'middleware.ts',
      content: code,
      options: { hardcodedStringMinLength: 4, classifyLiterals: true },
    });

    const hardcoded = issues.filter((i) => i.rule === 'hardcoded-string');
    assert.strictEqual(
      hardcoded.length,
      0,
      `Expected 0 hardcoded-string issues for typeof and relative imports, got: ${JSON.stringify(hardcoded.map((i) => i.message))}`,
    );
  });

  // End-to-end check when scratch repositories are present
  const scratchRoot = path.join(__dirname, '..', 'scratch', 'repos');
  const dayjsPath = path.join(scratchRoot, 'dayjs');
  const zustandPath = path.join(scratchRoot, 'zustand');
  const bottlePath = path.join(scratchRoot, 'bottle');

  if (fs.existsSync(dayjsPath) && fs.existsSync(zustandPath) && fs.existsSync(bottlePath)) {
    console.log('--- Validating Real MIT Project Checkouts ---');
    const { scan } = require('../dist/api');

    await checkAsync('Day.js real-world scan coverage and precision', async () => {
      const rep = await scan({ root: dayjsPath, include: ['src/**/*.js'] });
      assert.ok(
        rep.summary.filesScanned >= 180,
        `Expected >= 180 files, got ${rep.summary.filesScanned}`,
      );
      const constantFileIssues = (rep.issues || []).filter(
        (i) => i.location && i.location.file.includes('constant.js') && i.rule === 'magic-number',
      );
      assert.strictEqual(
        constantFileIssues.length,
        0,
        `Expected 0 magic-number issues in dayjs constant.js, got ${constantFileIssues.length}`,
      );
    });

    await checkAsync('Zustand real-world scan precision', async () => {
      const rep = await scan({ root: zustandPath, include: ['src/**/*.ts'] });
      assert.ok(
        rep.summary.filesScanned >= 10,
        `Expected >= 10 files, got ${rep.summary.filesScanned}`,
      );
      const devtoolsIssues = (rep.issues || []).filter(
        (i) => i.location && i.location.file.includes('devtools.ts'),
      );
      // devtools previously had 4+ false positives ('function', '../vanilla', 'zustand/devtools')
      const falsePositives = devtoolsIssues.filter(
        (i) =>
          i.detail &&
          (i.detail.value === "'function'" ||
            i.detail.value === "'../vanilla'" ||
            i.detail.value === "'zustand/devtools'"),
      );
      assert.strictEqual(
        falsePositives.length,
        0,
        'Zustand devtools must have 0 false positive literals',
      );
    });

    await checkAsync('Bottle Python real-world scan syntax compliance', async () => {
      const rep = await scan({ root: bottlePath, include: ['bottle.py'] });
      assert.strictEqual(rep.summary.filesScanned, 1);
      const pyConstIssues = (rep.issues || []).filter(
        (i) => (i.suggestion && i.rule.includes('constant')) || i.rule === 'hardcoded-string',
      );
      for (const iss of pyConstIssues.slice(0, 10)) {
        if (iss.suggestion) {
          assert.strictEqual(
            iss.suggestion.includes('const '),
            false,
            `Python suggestion must not contain "const": ${iss.suggestion}`,
          );
        }
      }
    });
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed}/${total} assertions passed.`);
  console.log(`========================================\n`);

  if (process.exitCode && process.exitCode !== 0) {
    process.exit(process.exitCode);
  }
}

main().catch((err) => {
  console.error('Fatal validation error:', err);
  process.exit(1);
});
