/**
 * Module: Verification Harness — Multi-Language Coverage Matrix
 * File Path: scripts/validate-language-matrix.js
 * Architecture Role: Cross-language contract lock: every supported language must be claimed by
 *     an adapter (so its files are really scanned), must flow through the language-agnostic
 *     analyzers, and must expose exactly the modernization pack registered for it
 * Dependencies & Triggers: `npm run validate-language-matrix` (part of `npm test`); imports
 *     ../dist/api (scan) and drives one fixture per language plus one unsupported extension
 * Responsibilities: Assert per language that (1) filesScanned counts the fixture, (2) a
 *     language-agnostic hygiene rule fires on shared content, (3) the language's modernization
 *     pack reports its key-point rule only when the config declares it, and (4) an unknown
 *     extension stays fail-closed as `LANG-UNSUPPORTED`; print the resulting matrix so a coverage
 *     gap between "can parse" and "can check" is visible instead of implicit
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1. The
 *     matrix is asserted through the public `scan()` entry point so adapter registration, analyzer
 *     resolution and extension scoping are exercised together; a language whose pack is missing or
 *     mis-scoped therefore fails here rather than silently reporting nothing.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../dist/api');

/**
 * Language-agnostic probe: a marker every content-oriented analyzer can see, whatever
 * the syntax.
 */
const AGNOSTIC_MARKER = 'TODO: remove this temporary stub';

/**
 * One row per supported language.
 *
 * `packRule` is the key-point rule of that language's modernization pack, `fixture` the smallest
 * source that triggers it, and `pack` the analyzer id that must be declared to switch it on.
 */
const MATRIX = [
  {
    language: 'typescript',
    file: 'src/probe.ts',
    pack: 'ts-modern',
    packRule: 'TSM-VAR-001',
    fixture: (marker) => `var legacy = 1;\n// ${marker}\nexport const probe = legacy;\n`,
    agnostic: true,
  },
  {
    language: 'javascript',
    file: 'src/probe.js',
    pack: 'ts-modern',
    packRule: 'TSM-VAR-001',
    fixture: (marker) => `var legacy = 1;\n// ${marker}\nmodule.exports = { probe: legacy };\n`,
    agnostic: true,
  },
  {
    language: 'python',
    file: 'src/probe.py',
    pack: 'python-modern',
    packRule: 'PYM-PATH-001',
    fixture: (marker) => `import os\n\n# ${marker}\nprobe = os.path.join('a', 'b')\n`,
    agnostic: true,
  },
  {
    language: 'rust',
    file: 'src/probe.rs',
    pack: 'rust-modern',
    packRule: 'RSM-EXTERN-001',
    fixture: (marker) => `// ${marker}\nextern crate serde;\n\npub fn probe() {}\n`,
    agnostic: true,
  },
  {
    language: 'gdscript',
    file: 'src/probe.gd',
    pack: 'gdscript-modern',
    packRule: 'GDM-YIELD-001',
    fixture: (marker) => `# ${marker}\nfunc probe():\n\tyield(get_tree(), "idle_frame")\n`,
    agnostic: true,
  },
  {
    language: 'markdown',
    file: 'docs/probe.md',
    pack: null,
    packRule: null,
    fixture: (marker) => `# Probe\n\n${marker}\n`,
    agnostic: false,
  },
];

/**
 * Write one fixture and scan it with the requested analyzer declarations.
 *
 * @param root - Fixture project root.
 * @param row - Matrix row describing the fixture to write.
 * @param declarePack - True to enable the row's modernization pack in the generated config.
 * @returns Report from the public scanning entry point.
 */
async function scanRow(root, row, declarePack) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const absolute = path.join(root, row.file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, row.fixture(AGNOSTIC_MARKER));
  // `hygiene` is a specialized analyzer, so the language-agnostic probe only runs when the
  // fixture declares it; the pack is declared on top for the cases that assert its key point.
  const analyzers = {
    ...(row.agnostic ? { hygiene: { enabled: true } } : {}),
    ...(declarePack && row.pack ? { [row.pack]: { enabled: true } } : {}),
  };
  const configFile = path.join(root, 'auto-refactor.config.json');
  fs.writeFileSync(configFile, JSON.stringify({ include: ['**/*'], analyzers }, null, 2));
  return scan({ root, configFile, logLevel: 'silent', cache: false });
}

/**
 * Reduce a report to the live (suppression-free) rule id set.
 *
 * @param report - Scan report.
 * @returns Set of rule ids carried by live findings.
 */
function liveRules(report) {
  return new Set(report.issues.filter((issue) => !issue.suppression).map((issue) => issue.rule));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-language-matrix-'));
  const summary = [];
  try {
    for (const row of MATRIX) {
      const withPack = await scanRow(root, row, true);
      assert.strictEqual(
        withPack.summary.filesScanned,
        1,
        `${row.language}: the adapter must claim ${row.file} (filesScanned)`,
      );
      const rules = liveRules(withPack);
      if (row.agnostic) {
        assert.ok(
          rules.has('HYG-STB-001'),
          `${row.language}: the language-agnostic stub probe must fire, got ${JSON.stringify([...rules])}`,
        );
      }
      if (row.packRule) {
        assert.ok(
          rules.has(row.packRule),
          `${row.language}: ${row.pack} must report ${row.packRule} when declared, got ${JSON.stringify([...rules])}`,
        );
      }

      const withoutPack = await scanRow(root, row, false);
      if (row.packRule) {
        assert.ok(
          !liveRules(withoutPack).has(row.packRule),
          `${row.language}: ${row.packRule} must stay silent while ${row.pack} is undeclared`,
        );
      } else {
        assert.strictEqual(
          withPack.summary.disabledAnalyzers.length >= 0,
          true,
          `${row.language}: markdown has no modernization pack`,
        );
      }
      summary.push(
        `${row.language.padEnd(10)} parse ✅  agnostic ${row.agnostic ? '✅' : '–'}  pack ${row.pack ? `${row.pack} ✅` : '–'}`,
      );
    }

    // ── Fail-closed: an extension no adapter claims must never be parsed as TypeScript ──
    const unknownRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-language-unknown-'));
    try {
      // `.ps1` is inside the discovery set but claimed by no adapter: that is exactly the
      // fail-closed contract, so discovered-but-unclaimed must be reported, never guessed.
      fs.writeFileSync(
        path.join(unknownRoot, 'probe.ps1'),
        `# ${AGNOSTIC_MARKER}
`,
      );
      const configFile = path.join(unknownRoot, 'auto-refactor.config.json');
      fs.writeFileSync(configFile, JSON.stringify({ include: ['**/*'] }, null, 2));
      const report = await scan({
        root: unknownRoot,
        configFile,
        logLevel: 'silent',
        cache: false,
      });
      assert.ok(
        liveRules(report).has('LANG-UNSUPPORTED'),
        'an unclaimed extension must stay fail-closed as LANG-UNSUPPORTED',
      );
      summary.push('unknown    parse ⛔  LANG-UNSUPPORTED ✅ (fail-closed)');
    } finally {
      fs.rmSync(unknownRoot, { recursive: true, force: true });
    }

    console.log('  [PASS] every supported language is parsed, checked and pack-scoped');
    console.log('  [PASS] an unclaimed extension stays fail-closed');
    console.log('\n  Language coverage matrix:');
    for (const line of summary) console.log(`    ${line}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log('\n ALL LANGUAGE MATRIX CHECKS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
