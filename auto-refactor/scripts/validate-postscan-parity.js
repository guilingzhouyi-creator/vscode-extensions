/**
 * Module: Verification Harness — Library/CLI Post-Scan Pipeline Parity
 * File Path: scripts/validate-postscan-parity.js
 * Architecture Role: Contract lock for the rule that `scan()` and the CLI observe exactly the
 *     same report: reasoned suppressions, dependency-graph cycle findings, and baseline ratchet
 *     annotations all belong to scan() itself, not to the CLI wrapper
 * Dependencies & Triggers: `npm run validate-postscan-parity` (part of `npm test`); imports
 *     ../dist/api (scan, scanAndRender) and drives a synthetic Python project with a real cycle
 * Responsibilities: Assert the library and CLI paths produce identical issue tuples, suppression
 *     counts, disabled-analyzer lists and ratchet annotations for the same config; assert cycle
 *     findings are suppressible by config (the pass runs before suppression matching); assert
 *     `scan({ baseline })` annotates isNew exactly like the CLI, and that a suppression never
 *     hides a finding from the audit trail
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so CI
 *     fails loudly. Parity is asserted on normalized tuples rather than raw JSON because
 *     generatedAt/root differ per run; everything that can change a verdict must match.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan, scanAndRender } = require('../dist/api');

/**
 * Write a set of fixture files into a directory tree.
 *
 * @param root - Absolute directory that receives the files.
 * @param files - Map of relative path to UTF-8 content.
 */
function writeFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const abs = path.join(root, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/**
 * Reduce a report to the tuples that decide a verdict.
 *
 * @param report - Scan report from either entry point.
 * @returns Comparable shape: issue tuples plus the summary fields that carry annotations.
 */
function normalize(report) {
  return {
    issues: report.issues.map((issue) => ({
      rule: issue.rule,
      file: issue.location.file.replace(/\\/g, '/'),
      line: issue.location.start.line,
      severity: issue.severity,
      suppression: issue.suppression ? issue.suppression.reason : null,
      isNew: Boolean(issue.isNew),
    })),
    suppressedCount: report.summary.suppressedCount ?? 0,
    disabledAnalyzers: report.summary.disabledAnalyzers ?? [],
    ratchetBaselineUsed: Boolean(report.summary.ratchetBaselineUsed),
    filesScanned: report.summary.filesScanned,
  };
}

/**
 * Run the CLI entry point and read back its JSON report.
 *
 * @param options - Scan options shared with the library call.
 * @param out - Report path the CLI must write.
 * @returns Parsed JSON report.
 */
async function cliReport(options, out) {
  const code = await scanAndRender({ ...options, format: 'json', out, cache: false });
  assert.strictEqual(code, 0, `scanAndRender must succeed, exit=${code}`);
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-postscan-'));
  const configPath = path.join(root, 'auto-refactor.config.json');
  const baselinePath = path.join(root, 'baseline.json');
  const cliOut = path.join(root, 'cli-report.json');
  const config = {
    include: ['**/*.py'],
    analyzers: {
      'dependency-graph': { enabled: true, options: { detectCycles: true } },
      comments: { enabled: false },
      governance: { enabled: false },
    },
    suppressions: [
      {
        matchAnalyzer: 'dependency-graph',
        matchRule: 'import-cycle',
        downgradeTo: 'info',
        reason: 'cycle accepted by review board for the parity fixture',
      },
    ],
  };
  const options = { root, configFile: configPath, logLevel: 'silent' };
  try {
    writeFiles(root, {
      'auto-refactor.config.json': JSON.stringify(config, null, 2),
      'app/a.py': 'from app.b import helper\n\n\ndef entry():\n    return helper()\n',
      'app/b.py': 'from app.a import entry\n\n\ndef helper():\n    return entry()\n',
    });

    // ── 1. Suppression applies identically on both entry points ──
    const library = await scan(options);
    const cli = await cliReport(options, cliOut);
    assert.deepStrictEqual(normalize(library), normalize(cli), 'scan() and CLI must agree');
    const cycles = library.issues.filter((issue) => issue.rule === 'import-cycle');
    assert.strictEqual(cycles.length, 1, 'the fixture must contain exactly one cycle finding');
    assert.strictEqual(cycles[0].severity, 'info', 'config suppression must downgrade the cycle');
    assert.ok(cycles[0].suppression, 'the suppression trail must stay attached to the finding');
    assert.strictEqual(library.summary.suppressedCount, 1, 'suppressed findings must be counted');
    assert.strictEqual(
      normalize(library).disabledAnalyzers.includes('comments'),
      true,
      'disabled analyzers must be reported on both paths',
    );
    console.log('  [PASS] library and CLI agree on suppression, cycles and disabled analyzers');

    // ── 2. Baseline ratchet is honored by the library entry point too ──
    const freezeCode = await scanAndRender({
      ...options,
      format: 'json',
      out: cliOut,
      cache: false,
      updateBaseline: baselinePath,
      baselineGranularity: 'grouped',
    });
    assert.strictEqual(freezeCode, 0, 'baseline freeze must succeed');
    const frozen = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    assert.strictEqual(frozen.granularity, 'grouped', 'freeze default must be a grouped baseline');

    const withBaseline = { ...options, baseline: baselinePath, baselineGranularity: 'grouped' };
    const libRatchet = await scan(withBaseline);
    const cliRatchet = await cliReport(withBaseline, cliOut);
    assert.strictEqual(
      libRatchet.summary.ratchetBaselineUsed,
      true,
      'scan() must apply the baseline',
    );
    assert.strictEqual(
      libRatchet.issues.filter((issue) => issue.isNew).length,
      0,
      'an unchanged tree has no new issues',
    );
    assert.deepStrictEqual(
      normalize(libRatchet),
      normalize(cliRatchet),
      'baseline annotations must match between scan() and the CLI',
    );
    console.log('  [PASS] baseline ratchet annotations are identical on both entry points');

    // ── 3. A new finding is flagged as new by both paths, once each ──
    writeFiles(root, {
      'app/c.py': 'from app.d import gamma\n\n\ndef alpha():\n    return gamma()\n',
      'app/d.py': 'from app.c import alpha\n\n\ndef gamma():\n    return alpha()\n',
    });
    const libNew = await scan(withBaseline);
    const cliNew = await cliReport(withBaseline, cliOut);
    const newCount = libNew.issues.filter((issue) => issue.isNew).length;
    assert.ok(newCount > 0, 'a second cycle must break the ratchet');
    assert.strictEqual(
      newCount,
      libNew.issues.filter((issue) => issue.isNew && issue.rule === 'import-cycle').length,
      'cycle findings must never be duplicated by the post-scan pipeline',
    );
    assert.deepStrictEqual(normalize(libNew), normalize(cliNew), 'new-issue verdicts must match');
    console.log('  [PASS] new findings are flagged once and identically on both entry points');

    // ── 4. `matchFile` globs: a directory policy silences only that directory ──
    const globRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-glob-suppress-'));
    try {
      writeFiles(globRoot, {
        'auto-refactor.config.json': JSON.stringify({
          include: ['**/*.ts'],
          analyzers: {
            constants: { enabled: true, options: { magicNumberMin: 3 } },
            comments: { enabled: false },
            governance: { enabled: false },
          },
          suppressions: [
            {
              matchFile: 'scripts/**',
              matchRule: 'magic-number',
              reason: 'fixture policy: script fixtures carry input data, not magic numbers',
            },
          ],
        }),
        'scripts/tool.ts': 'export function scale(x: number): number {\n  return x * 12345;\n}\n',
        'src/app.ts': 'export function scale(x: number): number {\n  return x * 54321;\n}\n',
      });
      const globbed = await scan({
        root: globRoot,
        configFile: path.join(globRoot, 'auto-refactor.config.json'),
        logLevel: 'silent',
        cache: false,
      });
      const magic = globbed.issues.filter((issue) => issue.rule === 'magic-number');
      // Suppressed findings stay in the report (audit trail), so the live set excludes them.
      const inScripts = magic.filter(
        (issue) => issue.location.file.startsWith('scripts/') && !issue.suppression,
      );
      const inSrc = magic.filter(
        (issue) => issue.location.file.startsWith('src/') && !issue.suppression,
      );
      assert.strictEqual(inSrc.length, 1, 'the glob policy must not leak outside its directory');
      assert.strictEqual(inScripts.length, 0, 'the glob policy must silence its directory');
      assert.strictEqual(
        globbed.summary.suppressedCount,
        1,
        'glob-suppressed findings stay counted in the audit trail',
      );
      console.log('  [PASS] matchFile accepts globs and stays scoped to the matched directory');
    } finally {
      fs.rmSync(globRoot, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log('\n ALL POST-SCAN PARITY CHECKS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
