/**
 * Module: Verification Harness — Compression Lower Bounds & Uncertainty Model (Batch B6)
 * File Path: scripts/validate-compression-bounds.js
 * Architecture Role: Verification test suite asserting:
 *   1. EXACT detection counts across all four CMP-* rules (CMP-EXP-001, CMP-LIN-001,
 *      CMP-CAL-001, CMP-DEN-001), so silent over-firing fails too;
 *   2. Uncertainty model: `summary.uncertainty` describes the issue list it is published with,
 *      `averageConfidence` is omitted (never 1.0) when no finding carries evidence, and findings
 *      that are statically decidable do not claim runtime evidence;
 *   3. A false-positive rate computed over all CMP emissions with a negative corpus in the
 *      numerator, plus a real-corpus guard on the production files that once false-positived.
 * Dependencies & Triggers: Wireable into `npm test` and gate scripts; requires ../dist/api.
 * Responsibilities: Run deterministic scans over synthetic fixtures and real modules; assert
 *   exact findings, evidence shapes, and absence of false alarms on both corpora.
 * Exit Semantics & Design Rationale: Process exits with code 0 on test pass, or throws an
 *   assertion error with non-zero exit on mismatch. Every assertion is written to be falsifiable:
 *   the FP rate has a positive-set floor so it cannot pass vacuously, and the real-corpus guard
 *   fails if any of the 12 previously false-positive production files regresses.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { scan } = require('../dist/api');
const { GovernanceAnalyzer } = require('../dist/analyzers/governance');

console.log('=== [1/3] Testing Compression Bounds Fixtures (100% Hit Rate) ===');

const COMPRESSION_FIXTURES = {
  // CMP-EXP-001: Giant nested ternary and long logical chain
  'src/giant_expr.ts': [
    'export function computeScore(a: number, b: number, c: number, d: number, e: number): number {',
    '  const res = a ? (b ? c : d) : (e ? 1 : 2);',
    '  const flag = a > 0 && b > 0 && c > 0 && d > 0 && e > 0 && a + b > 10;',
    '  return flag ? res : 0;',
    '}',
    '',
  ].join('\n'),

  // CMP-LIN-001: Single line multi-semantic statements
  'src/multi_semantic.ts': [
    'export function runLifecycle(): void {',
    '  initSystem(); startWorkers(); monitorHealth();',
    '  let stepA = 1; let stepB = 2;',
    '  console.log(stepA + stepB);',
    '}',
    'function initSystem() {}',
    'function startWorkers() {}',
    'function monitorHealth() {}',
    '',
  ].join('\n'),

  // CMP-CAL-001: Callback chain nesting depth >= 3
  'src/callback_depth.ts': [
    'export function loadChain(): void {',
    '  fetchData((data1: any) => {',
    '    processData(data1, (data2: any) => {',
    '      saveData(data2, (result: any) => {',
    '        console.log(result);',
    '      });',
    '    });',
    '  });',
    '}',
    'function fetchData(cb: any) { cb(1); }',
    'function processData(d: any, cb: any) { cb(d); }',
    'function saveData(d: any, cb: any) { cb(d); }',
    '',
  ].join('\n'),

  // CMP-DEN-001: cognitive token density — a genuinely compressed bit packing. A `&&` chain is
  // NOT bitwise density: counting it here used to double-report the giant_expr logical chain, which
  // CMP-EXP-001 already owns.
  'src/cognitive_density.ts': [
    'export function pack(v: number, m: number, f: number, o: number, s: number, g: number): number {',
    '  const p=(v<<3|m>>2)&~f^(o+((s?g:1)<<1));',
    '  return p;',
    '}',
    '',
  ].join('\n'),

  // Clean file: clean idioms that must NOT trigger CMP-* rules (FP protection)
  'src/clean_code.ts': [
    'export function calculateArea(width: number, height: number): number {',
    '  if (width <= 0 || height <= 0) {',
    '    return 0;',
    '  }',
    '  const isSquare = width === height ? true : false;',
    '  const simpleTernary = width > 10 ? width : 10;',
    '  for (let i = 0; i < 5; i++) {',
    '    // standard loop with semicolons',
    '  }',
    '  return width * height;',
    '}',
    '',
  ].join('\n'),
};

/**
 * Idiomatic constructs that must NEVER produce a CMP finding.
 *
 * Each entry reproduces a shape that produced a false positive before the family read the shared
 * masked view: JSDoc prose that looks like statements, regex literals, type-level unions and
 * intersections, URLs, division chains, single-line arrow bodies and CLI usage text.
 */
const NEGATIVE_FIXTURES = {
  'src/neg_jsdoc.ts': [
    '/**',
    ' * Wraps the streaming contract; finalize() is the merge point.',
    ' */',
    'export function run(): void {}',
    '',
  ].join('\n'),
  'src/neg_regex.ts': [
    'const COMMENT_LINE_RE = /^\\s*(?:\\/\\/|\\/\\*|\\*|#)/;',
    'export default COMMENT_LINE_RE;',
    '',
  ].join('\n'),
  'src/neg_union.ts': [
    'export type Mode = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";',
    '',
  ].join('\n'),
  'src/neg_intersection.ts': ['export type All = A & B & C & D & E & F & G & H & I;', ''].join(
    '\n',
  ),
  'src/neg_url.ts': [
    "const url = 'https://example.com/a/b/c';",
    "const alt = 'http://x/y/z/w';",
    '',
  ].join('\n'),
  'src/neg_division.ts': [
    'export function ratio(a: number, b: number, c: number, d: number): number {',
    '  const r = a / b / c / d;',
    '  return r;',
    '}',
    '',
  ].join('\n'),
  'src/neg_arrow_block.ts': [
    'export const pair = (): number[] => {',
    '  return [1, 2];',
    '};',
    '',
  ].join('\n'),
  'src/neg_usage.ts': [
    'export const USAGE = `',
    '  --concurrency <n>   Max files in parallel (single-process mode; default: cpus)',
    '`;',
    '',
  ].join('\n'),
};

(async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cmp-bounds-'));
  try {
    for (const [relPath, content] of Object.entries({
      ...COMPRESSION_FIXTURES,
      ...NEGATIVE_FIXTURES,
    })) {
      const absPath = path.join(tempRoot, relPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, 'utf8');
    }

    const config = {
      include: ['src/**/*.ts'],
      analyzers: {
        governance: { enabled: true },
        hygiene: { enabled: false },
        constants: { enabled: false },
        complexity: { enabled: false },
      },
    };
    const configPath = path.join(tempRoot, 'auto-refactor.config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

    const report = await scan({
      root: tempRoot,
      configFile: configPath,
      cache: false,
      logLevel: 'error',
    });

    const issues = report.issues;
    console.log(
      `Scanned ${report.summary.filesScanned} fixture files, emitted ${issues.length} issues.`,
    );

    // 1. Assert CMP-EXP-001 hit — EXACT count so silent over-firing is caught too.
    const expIssues = issues.filter((i) => i.rule === 'CMP-EXP-001');
    assert.strictEqual(
      expIssues.length,
      2,
      `Expected exactly 2 CMP-EXP-001, got ${expIssues.length}`,
    );
    assert.ok(expIssues.some((i) => i.message.includes('nested ternary')));
    assert.ok(expIssues.some((i) => i.message.includes('logical chain')));
    console.log(`  [OK] CMP-EXP-001 exact count (${expIssues.length})`);

    // 2. Assert CMP-LIN-001 hit
    const linIssues = issues.filter((i) => i.rule === 'CMP-LIN-001');
    assert.strictEqual(
      linIssues.length,
      2,
      `Expected exactly 2 CMP-LIN-001, got ${linIssues.length}`,
    );
    console.log(`  [OK] CMP-LIN-001 exact count (${linIssues.length})`);

    // 3. Assert CMP-CAL-001 hit. Nesting depth is a purely syntactic fact, so this finding must NOT
    //    claim runtime evidence: a conclusion no execution can settle must not be counted as one.
    const calIssues = issues.filter((i) => i.rule === 'CMP-CAL-001');
    assert.strictEqual(
      calIssues.length,
      1,
      `Expected exactly 1 CMP-CAL-001, got ${calIssues.length}`,
    );
    assert.notStrictEqual(
      calIssues[0].evidence.requiresRuntime,
      true,
      'CMP-CAL-001 is statically decidable and must not claim runtime evidence',
    );
    console.log(`  [OK] CMP-CAL-001 exact count (${calIssues.length}, no runtime claim)`);

    // 4. Assert CMP-DEN-001 hit
    const denIssues = issues.filter((i) => i.rule === 'CMP-DEN-001');
    assert.strictEqual(
      denIssues.length,
      1,
      `Expected exactly 1 CMP-DEN-001, got ${denIssues.length}`,
    );
    console.log(`  [OK] CMP-DEN-001 exact count (${denIssues.length})`);

    // 5. Assert clean file has ZERO CMP-* false positives
    const cleanIssues = issues.filter(
      (i) => i.location.file.includes('clean_code') && i.rule.startsWith('CMP-'),
    );
    assert.strictEqual(
      cleanIssues.length,
      0,
      `Clean code triggered CMP false positives: ${JSON.stringify(cleanIssues)}`,
    );
    console.log(`  [OK] Clean code produced 0 CMP false positives.`);

    console.log('\n=== [2/3] Testing Uncertainty Quantification & Counting ===');
    const uncertainty = report.summary.uncertainty;
    assert.ok(uncertainty, 'report.summary.uncertainty must be published');
    const { requiresRuntimeCount, averageConfidence } = uncertainty;
    console.log(
      `  Uncertainty summary: requiresRuntimeCount=${requiresRuntimeCount}, ` +
        `averageConfidence=${averageConfidence}`,
    );

    // The summary must describe the issue list it is published with, not an earlier revision.
    const runtimeIssues = issues.filter((i) => i.evidence && i.evidence.requiresRuntime === true);
    assert.strictEqual(
      runtimeIssues.length,
      requiresRuntimeCount,
      `summary.requiresRuntimeCount (${requiresRuntimeCount}) must equal the issue list ` +
        `(${runtimeIssues.length})`,
    );

    // `averageConfidence` is the mean over evidence-bearing findings only. With none it must be
    // absent rather than 1.0, which would claim certainty from no evidence at all.
    const withEvidence = issues.filter((i) => i.evidence);
    if (withEvidence.length === 0) {
      assert.strictEqual(
        averageConfidence,
        undefined,
        'with no evidence, averageConfidence must be omitted instead of reporting 1.0',
      );
    } else {
      assert.ok(
        averageConfidence > 0 && averageConfidence <= 1.0,
        'averageConfidence must be between 0 and 1',
      );
    }
    console.log('  [OK] Uncertainty is countable and its confidence claim matches its evidence.');

    console.log('\n=== [3/3] False Positive Rate and Real-Corpus Regression Guard ===');
    // The FP rate is measured over ALL CMP emissions with the negative corpus in the numerator.
    // The previous metric divided findings by scanned LINES, so zero findings read as 0.00% and
    // deleting every rule would have kept the section green.
    const cmpTotal = issues.filter((i) => i.rule.startsWith('CMP-')).length;
    const negativeFiles = new Set(
      Object.keys(NEGATIVE_FIXTURES).map((rel) => path.join(tempRoot, rel).replace(/\\/g, '/')),
    );
    const cmpOnNegative = issues.filter(
      (i) => i.rule.startsWith('CMP-') && negativeFiles.has(i.location.file.replace(/\\/g, '/')),
    ).length;

    assert.ok(
      cmpTotal >= 6,
      `positive fixtures must still fire, or the FP rate is vacuous (got ${cmpTotal})`,
    );
    const fpRate = cmpOnNegative / cmpTotal;
    console.log(
      `  CMP emissions=${cmpTotal}, on negative corpus=${cmpOnNegative} ` +
        `(FP rate ${(fpRate * 100).toFixed(2)}%)`,
    );
    assert.strictEqual(cmpOnNegative, 0, 'idiomatic constructs must produce zero CMP findings');
    console.log(
      '  [OK] FP rate 0.00% against a negative corpus, with the positive set still firing.',
    );

    // Real-corpus guard: every file below produced a CMP false positive before the rules read the
    // shared masked view. Keeping them silent is the regression this suite exists to catch, and
    // they are the reason the synthetic corpus alone is not sufficient evidence.
    const productionSilent = [
      'src/core/multilang.ts',
      'src/core/router/diffClassifier.ts',
      'src/analyzers/simplify.ts',
      'src/core/dependency-graph.ts',
      'src/core/governance/rules/exceptionSafety.ts',
      'src/core/incremental-state.ts',
      'src/core/reporters.ts',
      'src/core/typescript-adapter.ts',
      'src/daemon/server.ts',
      'src/index.ts',
      'src/analyzers/security.ts',
      'src/analyzers/comments.ts',
    ];
    let productionHits = 0;
    for (const rel of productionSilent) {
      const abs = path.join(__dirname, '..', rel);
      const content = fs.readFileSync(abs, 'utf8');
      const analyzer = new GovernanceAnalyzer();
      const fileIssues = analyzer.analyze(
        { text: content },
        { filePath: abs, content, lines: content.split('\n'), options: {} },
      );
      for (const issue of fileIssues.filter((i) => i.rule.startsWith('CMP-'))) {
        productionHits += 1;
        console.log(`      regression: ${issue.rule} ${rel}:${issue.location.start.line}`);
      }
    }
    assert.strictEqual(
      productionHits,
      0,
      `files that once false-positived must stay clean (got ${productionHits})`,
    );
    console.log(`  [OK] ${productionSilent.length} previously false-positive files stay clean.`);

    console.log('\nALL COMPRESSION BOUNDS & UNCERTAINTY MODEL CHECKS PASSED.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})();
