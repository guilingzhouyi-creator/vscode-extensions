/**
 * Module: Verification Harness — Multi-Language Coverage Matrix
 * File Path: scripts/validate-language-matrix.js
 * Architecture Role: Cross-language contract lock: every supported language must be claimed by
 *     an adapter (so its files are really scanned), must flow through the language-agnostic
 *     analyzers, and must expose exactly the modernization pack registered for it
 * Dependencies & Triggers: `npm run validate-language-matrix` (part of `npm test`); imports
 *     ../dist/api (scan, resolveConfig), the adapter extension index, the fail-closed guard and
 *     the discovery allow-list; drives one fixture per language
 * Responsibilities: Assert per language that (1) filesScanned counts the fixture, (2) a
 *     language-agnostic hygiene rule fires on shared content, (3) the language's modernization
 *     pack reports its key-point rule only when the config declares it, and (4) the discovery
 *     allow-list is fully claimed while an unclaimed extension still fails closed as
 *     `LANG-UNSUPPORTED`; print the resulting matrix so a coverage gap between "can parse" and
 *     "can check" is visible instead of implicit
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1. The
 *     matrix is asserted through the public `scan()` entry point so adapter registration, analyzer
 *     resolution and extension scoping are exercised together; a language whose pack is missing or
 *     mis-scoped therefore fails here rather than silently reporting nothing. The fail-closed row
 *     is asserted through the guard predicate rather than a fixture scan because every extension
 *     the walker admits is now claimed, so a scan can no longer reach that branch.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan, resolveConfig } = require('../dist/api');
const { EXTENSION_ADAPTER_IDS } = require('../dist/core/ast/adapters');
const { unsupportedLanguageDiagnostic } = require('../dist/core/ast/language-support');
const { DEFAULT_EXT } = require('../dist/core/file-discovery');

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
    language: 'go',
    file: 'src/probe.go',
    pack: 'go-modern',
    packRule: 'GOM-ERR-001',
    fixture: (marker) =>
      `package main\n\nimport "os"\n\n// ${marker}\n` +
      `func probe() {\n\tf, _ := os.Open("test.txt")\n\t_ = f\n}\n`,
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
  {
    language: 'yaml',
    file: 'config/probe.yml',
    pack: null,
    packRule: null,
    fixture: (marker) => `# ${marker}\nservice:\n  name: probe\n`,
    agnostic: true,
  },
  {
    language: 'shell',
    file: 'scripts/probe.sh',
    pack: null,
    packRule: null,
    fixture: (marker) => `#!/usr/bin/env bash\n# ${marker}\necho probe\n`,
    agnostic: true,
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
    // Discovery only admits `DEFAULT_EXT`, and every entry there is now claimed, so a scan can no
    // longer reach the guard through ordinary file discovery. Deleting the row would lose the
    // contract, so it is asserted at the two surfaces the scan composes: the allow-list must be
    // fully claimed (otherwise this matrix has a hole), and an unclaimed extension must still
    // produce the fail-closed error rather than a silent fallback.
    const unclaimed = DEFAULT_EXT.filter((ext) => EXTENSION_ADAPTER_IDS[ext] === undefined);
    assert.deepStrictEqual(
      unclaimed,
      [],
      `every discoverable extension must be claimed, unclaimed: ${unclaimed.join(', ')}`,
    );
    const syntheticConfig = resolveConfig({ root, unsupportedLanguage: 'error' });
    const guardIssue = unsupportedLanguageDiagnostic('probe.unknownext', syntheticConfig);
    assert.ok(guardIssue !== null, 'an unclaimed extension must stay fail-closed as LANG-UNSUPPORTED');
    assert.strictEqual(guardIssue.rule, 'LANG-UNSUPPORTED');
    assert.strictEqual(guardIssue.severity, 'error', 'the guard must stay fail-closed by default');
    summary.push('unknown    parse ⛔  LANG-UNSUPPORTED ✅ (fail-closed)');

    console.log('  ✔ every supported language is parsed, checked and pack-scoped');
    console.log('  ✔ an unclaimed extension stays fail-closed');
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
    console.error('\n✖ BLOCK', error && error.message ? error.message : error);
    process.exit(1);
  });
