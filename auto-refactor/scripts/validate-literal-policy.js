/**
 * Module: Verification Harness — Literal Policy Layers (constants analyzer)
 * File Path: scripts/validate-literal-policy.js
 * Architecture Role: Contract lock for the three-layer literal policy: the constants analyzer
 *     must honor `analyzers.constants.options.ignoreLiterals`, the GLOBAL `thresholds` layer must
 *     reach the same option (it only cascades keys the analyzer declares), and neither layer may
 *     silence unrelated duplicates by accident
 * Dependencies & Triggers: `npm run validate-literal-policy` (part of `npm test`); imports
 *     ../dist/api (scan) and drives a synthetic TypeScript fixture whose only purpose is two
 *     duplicated literals — one structural (`/`) and one semantic (`warning`)
 * Responsibilities: Assert both matching forms of `ignoreLiterals` (bare token and quoted
 *     literal), assert the global layer cascades into `ctx.options`, assert the per-analyzer
 *     layer still wins, assert the duplicate pass honors `classifyLiterals` (benign delimiters
 *     out, vocabulary in), and assert `duplicateLiteralThreshold` keeps gating what remains
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so a
 *     silent loss of findings fails the build. The fixture asserts on the LIVE finding set
 *     (suppression-free) because suppressed findings stay in the report by design; ignoring a
 *     token must remove the finding, not merely annotate it.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../dist/api');
const { classifyLiteral } = require('../dist/core/governance/semanticLiterals');

/**
 * Fixture source: two literals repeated three times each inside a function body, which is the
 * smallest shape that the duplicate-literal pass considers (const-bound and tolerated contexts
 * are skipped by design).
 */
const FIXTURE = [
  'export function classify(mode: string): string {',
  "  if (mode === '/') return '/';",
  "  if (mode === 'warning') return 'warning';",
  "  if (mode === 'info') return 'warning';",
  "  return '/';",
  '}',
  '',
].join('\n');

/**
 * Scan the fixture with one config and return the duplicate-literal values it reports.
 *
 * @param root - Fixture project root.
 * @param name - Config file name to write inside the fixture root.
 * @param config - Config object to persist before scanning.
 * @returns Sorted literal texts (`'/'`, `'warning'`) that the constants analyzer still reports.
 */
async function literalFindings(root, name, config) {
  const configFile = path.join(root, name);
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  const report = await scan({ root, configFile, logLevel: 'silent', cache: false });
  return report.issues
    .filter((issue) => issue.rule === 'duplicate-literal')
    .map((issue) => issue.detail.value)
    .sort();
}

/**
 * Base config: only the constants analyzer runs, so the assertions cannot be perturbed by
 * governance or comment findings on the synthetic fixture.
 *
 * @returns Config object with an explicit include and a single enabled analyzer.
 */
function baseConfig() {
  return {
    include: ['src/**/*.ts'],
    analyzers: {
      constants: { enabled: true },
      'large-file': { enabled: false },
      complexity: { enabled: false },
      governance: { enabled: false },
      comments: { enabled: false },
      security: { enabled: false },
      secrets: { enabled: false },
      architecture: { enabled: false },
      performance: { enabled: false },
      hygiene: { enabled: false },
      simplify: { enabled: false },
    },
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-literal-policy-'));
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'dup.ts'), FIXTURE);

    // ── 1. Baseline: both duplicates are reported, so later cases prove a policy took effect ──
    const baseline = await literalFindings(root, 'c1.json', baseConfig());
    assert.deepStrictEqual(
      baseline,
      ["'/'", "'warning'"],
      `the fixture must expose both duplicates, got ${JSON.stringify(baseline)}`,
    );
    console.log('  [PASS] duplicate-literal reports both fixture literals by default');

    // ── 2. Per-analyzer policy: bare token and quoted literal both match ──
    const perAnalyzer = await literalFindings(root, 'c2.json', {
      ...baseConfig(),
      analyzers: {
        ...baseConfig().analyzers,
        constants: { enabled: true, options: { ignoreLiterals: ['/', "'warning'"] } },
      },
    });
    assert.deepStrictEqual(
      perAnalyzer,
      [],
      `analyzers.constants.options.ignoreLiterals must accept bare and quoted forms, got ${JSON.stringify(perAnalyzer)}`,
    );
    console.log('  [PASS] per-analyzer ignoreLiterals matches bare tokens and quoted literals');

    // ── 3. Global policy: `thresholds.ignoreLiterals` cascades into ctx.options ──
    const globalLayer = await literalFindings(root, 'c3.json', {
      ...baseConfig(),
      thresholds: { ignoreLiterals: ['warning'] },
    });
    assert.deepStrictEqual(
      globalLayer,
      ["'/'"],
      `thresholds.ignoreLiterals must reach the constants analyzer, got ${JSON.stringify(globalLayer)}`,
    );
    console.log('  [PASS] global thresholds.ignoreLiterals cascades into the constants analyzer');

    // ── 4. Precedence: the per-analyzer block still wins over the global layer ──
    const precedence = await literalFindings(root, 'c4.json', {
      ...baseConfig(),
      thresholds: { ignoreLiterals: ['/'] },
      analyzers: {
        ...baseConfig().analyzers,
        constants: { enabled: true, options: { ignoreLiterals: ['warning'] } },
      },
    });
    assert.deepStrictEqual(
      precedence,
      ["'/'"],
      `the per-analyzer block must override the global layer, got ${JSON.stringify(precedence)}`,
    );
    console.log('  [PASS] per-analyzer ignoreLiterals overrides the global threshold layer');

    // ── 5. Thresholds still gate what is left after ignoring ──
    const threshold = await literalFindings(root, 'c5.json', {
      ...baseConfig(),
      thresholds: { duplicateLiteralThreshold: 5 },
    });
    assert.deepStrictEqual(
      threshold,
      [],
      `duplicateLiteralThreshold must gate the remaining findings, got ${JSON.stringify(threshold)}`,
    );
    console.log('  [PASS] duplicateLiteralThreshold still gates non-ignored duplicates');

    // ── 6. classifyLiterals reaches the duplicate pass: benign delimiters are not extractable ──
    const classified = await literalFindings(root, 'c6.json', {
      ...baseConfig(),
      classifyLiterals: true,
    });
    assert.deepStrictEqual(
      classified,
      ["'warning'"],
      `classifyLiterals must drop the benign '/' but keep vocabulary, got ${JSON.stringify(classified)}`,
    );
    console.log('  [PASS] classifyLiterals suppresses benign delimiters in the duplicate pass');

    // ── 7. Classifier vocabulary: escape spellings and docstring fences are delimiters ──
    // The control characters reach the classifier as the ESCAPE TEXT written in source
    // (backslash+n), which is a different string from the byte it denotes, and Python fences are
    // grammar delimiters; both must classify as benign, while real vocabulary must stay reported.
    for (const escape of ['\\n', '\\r', '\\t', '\\r\\n']) {
      assert.strictEqual(
        classifyLiteral(`'${escape}'`, false).isReasonable,
        true,
        `the escape spelling ${JSON.stringify(escape)} must classify as a delimiter`,
      );
    }
    for (const fence of ['"""', "'''"]) {
      assert.strictEqual(
        classifyLiteral(`'${fence}'`, false).isReasonable,
        true,
        `the ${JSON.stringify(fence)} docstring fence must classify as a delimiter`,
      );
    }
    assert.strictEqual(
      classifyLiteral("'warning'", false).isReasonable,
      false,
      'contract vocabulary must stay reportable',
    );
    console.log('  [PASS] escape spellings and docstring fences classify as benign delimiters');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log('\n ALL LITERAL POLICY CHECKS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
