/**
 * Module: Verification Harness — TypeScript/JavaScript Modernization Pack
 * File Path: scripts/validate-ts-modern.js
 * Architecture Role: Key-point lock for the `ts-modern` language pack: every rule must fire on
 *     its canonical shape, stay silent on the negative shapes, and stay inside its language scope
 * Dependencies & Triggers: `npm run validate-ts-modern` (part of `npm test`); imports ../dist/api
 *     (scan) and drives synthetic fixtures written into a temp directory
 * Responsibilities: Assert all ten TSM rules hit; assert strings, comments, template literals,
 *     regex-`replace` patterns and identifiers that merely contain `any` stay silent; assert the
 *     type rules skip plain JavaScript and declaration files; assert the pack is default-off until
 *     a config declares `analyzers['ts-modern']`; assert the `indexOf` boundary rule fires on the
 *     `>= 0` / `!== -1` shapes but not on an unrelated comparison
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so a pack
 *     that silently stops reporting (or starts over-reporting) fails the build. Fixtures are
 *     scanned through the public `scan()` entry point, so the harness exercises adapter + analyzer
 *     resolution rather than a hand-constructed context.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../dist/api');

/** One diagnostic shape per rule: the pack must report every id in this list exactly once. */
const ALL_RULE_IDS = [
  'TSM-VAR-001',
  'TSM-REQUIRE-001',
  'TSM-CTOR-001',
  'TSM-ARGS-001',
  'TSM-SPREAD-001',
  'TSM-INCLUDES-001',
  'TSM-SUBSTR-001',
  'TSM-REPLACE-001',
  'TSM-ANY-001',
  'TSM-TYPE-001',
];

/** Rules that need type annotations, so they must stay silent outside TypeScript sources. */
const TYPED_RULE_IDS = ['TSM-ANY-001', 'TSM-TYPE-001'];

/** Positive fixture: each line triggers exactly one rule, and the import triggers TSM-TYPE-001. */
const POSITIVE = [
  "import { Used, OnlyType, unused } from './helper';",
  '',
  'var legacy = 1;',
  "const loaded = require('./helper');",
  'const list = new Array();',
  'function total() {',
  '  return arguments.length;',
  '}',
  'const merged = Object.assign({}, { a: 1 });',
  "if (name.indexOf('x') !== -1) {",
  '  consume(name);',
  '}',
  'const head = name.substr(0, 2);',
  "const swapped = name.replace('a', 'b');",
  'const loose: any = 1;',
  'const used: Used = makeUsed();',
  'const onlyType: OnlyType = makeOnlyType();',
  'consume(loaded);',
  'consume(list);',
  'consume(merged);',
  'consume(head);',
  'consume(swapped);',
  'consume(loose);',
  'consume(used);',
  'consume(onlyType);',
  'consume(unused);',
  '',
].join('\n');

/** Negative fixture: the same keywords inside literals, comments and unrelated identifiers. */
const NEGATIVE = [
  'const text = "var x = 1; // not code";',
  '// var legacy = 2;',
  "/* const loaded = require('helper'); */",
  'const template = `new Array()`;',
  "const regexReplace = name.replace(/a/g, 'b');",
  'const company = 1;',
  'const many = 2;',
  "const message = 'arguments.length and text.substr(0, 1)';",
  '',
].join('\n');

/** Scanner comparison that keeps the boundary rule honest. */
const BOUNDARY_FIRES = "const found = name.indexOf('x') >= 0;\n";
const BOUNDARY_SILENT = "const index = name.indexOf('x') === 2;\n";

/**
 * Write files and scan the tree with the given analyzer declarations.
 *
 * @param root - Fixture project root.
 * @param files - Map of relative path to UTF-8 content.
 * @param analyzers - Declarative analyzer block for the generated config file.
 * @returns Live (suppression-free) `TSM-*` findings.
 */
async function scanFixture(root, files, analyzers) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const absolute = path.join(root, name);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  const configFile = path.join(root, 'auto-refactor.config.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify({ include: ['**/*.ts', '**/*.js'], analyzers }, null, 2),
  );
  const report = await scan({ root, configFile, logLevel: 'silent', cache: false });
  return report.issues.filter((issue) => issue.rule.startsWith('TSM-'));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-ts-modern-'));
  const packOn = { 'ts-modern': { enabled: true } };
  try {
    // ── 1. Every rule fires on its canonical shape ──
    const hits = await scanFixture(root, { 'src/positive.ts': POSITIVE }, packOn);
    const hitIds = [...new Set(hits.map((issue) => issue.rule))].sort();
    assert.deepStrictEqual(
      hitIds,
      [...ALL_RULE_IDS].sort(),
      `the pack must report every rule, got ${JSON.stringify(hitIds)}`,
    );
    console.log('  [PASS] all ten ts-modern rules fire on their canonical shape');

    // ── 2. Literals, comments and lookalike identifiers stay silent ──
    const silent = await scanFixture(root, { 'src/negative.ts': NEGATIVE }, packOn);
    assert.deepStrictEqual(
      silent.map((issue) => `${issue.rule}:${issue.location.file}`),
      [],
      `the mask must suppress comments, strings and lookalike names, got ${JSON.stringify(silent)}`,
    );
    console.log('  [PASS] strings, comments, templates and lookalike names stay silent');

    // ── 3. Language scope: JS keeps the syntax rules, drops the typed ones; .d.ts is excluded ──
    const jsHits = await scanFixture(root, { 'src/positive.js': POSITIVE }, packOn);
    const jsIds = [...new Set(jsHits.map((issue) => issue.rule))].sort();
    for (const typed of TYPED_RULE_IDS) {
      assert.ok(!jsIds.includes(typed), `${typed} must not run on plain JavaScript`);
    }
    assert.strictEqual(
      jsIds.length,
      ALL_RULE_IDS.length - TYPED_RULE_IDS.length,
      `JavaScript must keep the syntax rules, got ${JSON.stringify(jsIds)}`,
    );
    const declaration = await scanFixture(root, { 'src/positive.d.ts': POSITIVE }, packOn);
    assert.deepStrictEqual(declaration, [], 'declaration files carry no runtime code to modernize');
    console.log('  [PASS] type rules skip JavaScript and declaration files are excluded');

    // ── 4. The pack is opt-in: without a declaration no TSM finding may appear ──
    const off = await scanFixture(root, { 'src/positive.ts': POSITIVE }, {});
    assert.deepStrictEqual(off, [], 'the specialized pack must stay off until it is declared');
    console.log('  [PASS] ts-modern stays default-off until a config declares it');

    // ── 5. The indexOf boundary rule fires on the modern-worthy comparison only ──
    const boundary = await scanFixture(
      root,
      { 'src/boundary-fires.ts': BOUNDARY_FIRES, 'src/boundary-silent.ts': BOUNDARY_SILENT },
      packOn,
    );
    const files = boundary.map((issue) => issue.location.file.replace(/\\/g, '/'));
    assert.deepStrictEqual(
      [...new Set(files)].sort(),
      ['src/boundary-fires.ts'],
      `only the >= 0 comparison is a modernization finding, got ${JSON.stringify(files)}`,
    );
    console.log('  [PASS] indexOf boundary rule fires on >= 0 and stays silent otherwise');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log('\n ALL TS-MODERN CHECKS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
