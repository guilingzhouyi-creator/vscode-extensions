#!/usr/bin/env node
/**
 * Module: Verification Harness — Hot Path Benchmark (self-bootstrapping)
 * File Path: scripts/bench-hot-paths.js
 * Architecture Role: Records and re-checks the wall time of the engine's own measured hot paths
 *   (source masking, the CMP-* content rules, and a full governance scan) over this repository's
 *   own `src`, so an optimization target is derived by measuring rather than by guessing.
 * Dependencies & Triggers: `npm run bench:hotpaths` (and `-- --update` to re-record); requires a
 *   prior `npm run build` and reads only `src/**\/*.ts`.
 * Responsibilities: Pre-read the corpus outside every timed region, take the best of N rounds per
 *   hot path, print measured milliseconds, compare against the recorded baseline and fail when any
 *   path regresses beyond the declared tolerance.
 * Exit Semantics & Design Rationale: Exits 0 when every path is within tolerance or when
 *   `--update` re-records; exits 1 on a regression so the ratchet cannot be loosened silently.
 *   Timing happens in-process with the corpus cached and I/O excluded, because including file
 *   reads would let disk noise mask a real code regression. Best-of-N (not mean) is used since the
 *   signal is a floor, and the floor is what an optimization actually moves.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, 'bench', 'hot-paths-baseline.json');

/** Rounds per measurement; the best round is reported (the floor is the stable signal). */
const ROUNDS = 5;

/**
 * Maximum tolerated regression per hot path.
 *
 * Tolerance has to match the metric's resolution. The isolated paths resolve single-digit changes,
 * so 8% is a real signal there. The end-to-end scan carries roughly ±5-10% of its own jitter, which
 * was measured directly (the same rule set ranked +181 ms in a single-baseline sweep and -7.5 ms
 * against an interleaved one), so pretending it can resolve 8% would only produce flaky failures.
 */
const REGRESSION_TOLERANCE = {
  'mask-source': 0.08,
  'cmp-rules': 0.08,
  'governance-scan': 0.15,
};

/** Tolerance for any hot path not listed above. */
const DEFAULT_TOLERANCE = 0.15;

/** Masking syntax used for the C family, mirroring the TypeScript preset. */
const CFG_TS = {
  lineComment: '//',
  blockComment: { open: '/*', close: '*/' },
  quoteChars: '\'"`',
  multilineTemplates: true,
  regexLiterals: true,
};

/**
 * Collect every TypeScript file under a directory.
 *
 * @param dir - Directory to walk.
 * @param out - Accumulator for matched absolute paths.
 * @returns Absolute paths of every `.ts` file found.
 */
function tsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) tsFiles(p, out);
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Run a function ROUNDS times and keep the fastest wall time.
 *
 * @param label - Human-readable hot path name.
 * @param body - Work to time; must not perform I/O on the corpus.
 * @returns The best measured duration in milliseconds.
 */
function best(label, body) {
  let fastest = Infinity;
  for (let round = 0; round < ROUNDS; round += 1) {
    const started = process.hrtime.bigint();
    body();
    fastest = Math.min(fastest, Number(process.hrtime.bigint() - started) / 1e6);
  }
  console.log(`  ${label.padEnd(28)} ${fastest.toFixed(1)} ms`);
  return Number(fastest.toFixed(1));
}

/**
 * Read the recorded baseline, if any.
 *
 * @returns Parsed baseline keyed by hot-path name, or an empty object.
 */
function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')).paths ?? {};
  } catch {
    console.log('  (baseline unreadable; treating as empty)');
    return {};
  }
}

/**
 * Time one scan with a set of governance rules disabled.
 *
 * @param api - Loaded engine API.
 * @param cfgDir - Directory holding the throwaway config files.
 * @param apiOpts - Scan options template.
 * @param rulesOff - Rule ids to disable.
 * @returns The best wall time in milliseconds.
 */
async function timeScanWithRules(api, cfgDir, apiOpts, rulesOff) {
  const rules = {};
  for (const id of rulesOff) rules[id] = { enabled: false };
  const cfgPath = path.join(cfgDir, `ablate-${rulesOff.length}-${rulesOff[0] ?? 'base'}.json`);
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      include: ['src/**/*.ts'],
      analyzers: { governance: { enabled: true, options: { rules } } },
    }),
  );
  let best = Infinity;
  for (let round = 0; round < ROUNDS; round += 1) {
    const started = process.hrtime.bigint();
    await api.scan({ ...apiOpts, configFile: cfgPath });
    best = Math.min(best, Number(process.hrtime.bigint() - started) / 1e6);
  }
  return best;
}

/**
 * Attribute scan cost to individual governance rules, with interleaved baselines.
 *
 * The baseline is re-measured immediately before each ablation rather than once at the start of the
 * sweep. A single leading baseline produced a phantom ranking first time round: the same four rules
 * measured +181 / +106 / +81 / +74 ms in one pass and -7.5 / +4.8 / -9.5 / +0.5 ms when re-measured
 * this way, because a 55-second sweep drifts under JIT and thermal effects. The coherence check
 * below exists to make that failure visible instead of shipping a ranking built on drift: when the
 * deltas sum to more than the baseline, the noise floor has swamped the signal and the ranking must
 * not be used.
 *
 * @param api - Loaded engine API.
 * @param cfgDir - Directory for the throwaway config files.
 * @param apiOpts - Scan options template (root, cache, logLevel).
 * @returns Nothing; prints the ranking and a coherence verdict.
 */
async function ablate(api, cfgDir, apiOpts) {
  const { BUILTIN_GOVERNANCE_RULES } = require(path.join(ROOT, 'dist/core/governance/registry'));
  const ids = BUILTIN_GOVERNANCE_RULES.map((rule) => rule.id);
  console.log(`\n=== Rule attribution over ${ids.length} rules (interleaved baseline) ===`);

  await timeScanWithRules(api, cfgDir, apiOpts, []); // warm the JIT first
  const rows = [];
  for (const id of ids) {
    const base = await timeScanWithRules(api, cfgDir, apiOpts, []);
    const without = await timeScanWithRules(api, cfgDir, apiOpts, [id]);
    rows.push({ id, base, delta: without - base });
  }

  rows.sort((a, b) => b.delta - a.delta);
  const reference = rows.length > 0 ? rows[0].base : 0;
  for (const row of rows) {
    const share = ((row.delta / row.base) * 100).toFixed(1);
    console.log(
      `  ${row.id.padEnd(16)} ${(row.delta >= 0 ? '+' : '') + row.delta.toFixed(1)} ms`.padEnd(28) +
        `${share.padStart(6)}%`,
    );
  }

  const positive = rows.reduce((sum, row) => sum + Math.max(0, row.delta), 0);
  console.log(
    `\n  baseline ~= ${reference.toFixed(0)} ms, sum of positive deltas = ${positive.toFixed(0)} ms`,
  );
  if (positive > reference) {
    console.log(
      '  INCOHERENT: the deltas sum to more than the whole scan, so the ranking is drift, not cost.\n' +
        '  Raise ROUNDS or shorten the sweep before drawing conclusions from it.',
    );
  } else {
    console.log('  Coherent: the deltas fit inside the baseline.');
  }
}

async function main() {
  const update = process.argv.includes('--update');
  const maskMod = require(path.join(ROOT, 'dist/core/sourceMask'));
  const api = require(path.join(ROOT, 'dist/api'));
  const rules = require(path.join(ROOT, 'dist/core/governance/rules/compressionBounds'));
  const benchDir = path.join(ROOT, 'bench');
  fs.mkdirSync(benchDir, { recursive: true });

  // `--ablate` answers "where does the scan time actually go?" instead of "is this path slower than
  // it was?"; it is a separate mode because it takes minutes rather than seconds.
  if (process.argv.includes('--ablate')) {
    await ablate(api, benchDir, { root: ROOT, cache: false, logLevel: 'error' });
    return;
  }

  const files = tsFiles(path.join(ROOT, 'src'));
  // Pre-read outside every timed region: the benchmark measures code, not the filesystem.
  const corpus = files.map((f) => ({ path: f, content: fs.readFileSync(f, 'utf8') }));
  const bytes = corpus.reduce((sum, f) => sum + f.content.length, 0);
  let totalLines = 0;
  for (const f of corpus) totalLines += f.content.split('\n').length;
  console.log(
    `\n=== Hot paths over ${files.length} files / ${totalLines} lines / ${bytes} bytes ` +
      `(best of ${ROUNDS}, I/O excluded) ===`,
  );

  const results = {};

  results['mask-source'] = best('mask-source', () => {
    for (const f of corpus) maskMod.maskSourceText(f.content, CFG_TS);
  });

  // The per-file context, mask included, is built OUTSIDE the timed region: this path measures the
  // rules themselves, not the masker. Folding the mask in would hide a rule-level regression.
  const ruleContexts = corpus.map((f) => ({
    node: null,
    ctx: {},
    depth: 0,
    className: null,
    binding: null,
    capabilities: { languageId: 'typescript' },
    filePath: f.path,
    content: f.content,
    lines: f.content.split('\n'),
    masked: maskMod.maskSourceText(f.content, CFG_TS).masked,
  }));

  results['cmp-rules'] = best('cmp-rules', () => {
    for (const ctx of ruleContexts) {
      rules.GiantExpressionRule.checkFile(ctx);
      rules.SingleLineMultiSemanticRule.checkFile(ctx);
      rules.CallbackDepthRule.checkFile(ctx);
      rules.CognitiveDensityRule.checkFile(ctx);
    }
  });

  const cfgDir = path.join(ROOT, 'bench');
  fs.mkdirSync(cfgDir, { recursive: true });
  const cfgPath = path.join(cfgDir, '.hot-paths-config.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({ include: ['src/**/*.ts'], analyzers: { governance: { enabled: true } } }),
  );

  // Async paths are timed with an awaited loop rather than the synchronous `best` helper.
  let scanBest = Infinity;
  let issueCount = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const started = process.hrtime.bigint();
    const report = await api.scan({
      root: ROOT,
      configFile: cfgPath,
      cache: false,
      logLevel: 'error',
    });
    scanBest = Math.min(scanBest, Number(process.hrtime.bigint() - started) / 1e6);
    issueCount = report.issues.length;
  }
  console.log(
    `  ${'governance-scan'.padEnd(28)} ${scanBest.toFixed(1)} ms  (${issueCount} issues)`,
  );
  results['governance-scan'] = Number(scanBest.toFixed(1));

  const previous = readBaseline();

  console.log('\n=== Baseline comparison ===');
  const regressions = [];
  for (const [name, value] of Object.entries(results)) {
    const before = previous[name];
    if (before === undefined) {
      console.log(`  ${name.padEnd(28)} no baseline recorded`);
      continue;
    }
    const delta = ((value - before) / before) * 100;
    const tolerance = (REGRESSION_TOLERANCE[name] ?? DEFAULT_TOLERANCE) * 100;
    const sign = delta >= 0 ? '+' : '';
    const mark = delta > tolerance ? 'REGRESSION' : 'ok';
    console.log(
      `  ${name.padEnd(28)} ${before} -> ${value} ms  (${sign}${delta.toFixed(1)}%) ${mark}`,
    );
    if (delta > tolerance) {
      regressions.push(`${name} (+${delta.toFixed(1)}% > ${tolerance.toFixed(0)}%)`);
    }
  }

  if (update) {
    fs.writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), corpusBytes: bytes, paths: results }, null, 2)}\n`,
    );
    console.log(`\nRecorded baseline -> ${path.relative(ROOT, BASELINE_PATH)}`);
    return;
  }

  if (regressions.length > 0) {
    console.error(
      `\nFAIL: ${regressions.join('; ')} — regressed beyond the per-path tolerance ` +
        `versus the recorded baseline.`,
    );
    console.error('Re-run with `--update` only after confirming the change is intended.');
    process.exit(1);
  }
  console.log('\nAll hot paths within their per-path tolerance of the baseline.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
