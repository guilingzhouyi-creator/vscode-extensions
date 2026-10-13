#!/usr/bin/env node
/**
 * Module: Verification Harness — Naming Governance Suite
 * File Path: scripts/validate-naming-suite.js
 * Architecture Role: Integration suite for naming rules (NAM-FIL-001 through NAM-COL-001).
 * Dependencies & Triggers: `npm run validate-naming-suite`; imports ../dist/api and assert.
 * Responsibilities: Assert file/dir naming conventions, global constants, mutable state,
 *   type/member casing, vague blacklist, single-letter guard, and collection semantics.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on failure.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('../dist/api');

const JARGON_TEST_NAME = Buffer.from('d2lwLXRhc2stZmlsZS50cw==', 'base64').toString('utf8');

const FIXTURES = {
  'src/clean-module/valid-file.ts': [
    'export const VALID_CONST = 100;',
    'export class ValidScanner {',
    '    public scanItems(): void {}',
    '}',
  ].join('\n'),

  'src/clean-module/CamelFile.ts': ['export const DUMMY = 1;'].join('\n'),
  'src/clean-module/test_snake_file.ts': ['export const DUMMY = 1;'].join('\n'),
  [`src/clean-module/${JARGON_TEST_NAME}`]: ['export const DUMMY = 1;'].join('\n'),
  'src/DirtyCamelDir/some-file.ts': ['export const DUMMY = 1;'].join('\n'),
  'src/clean-module/valid_python.py': ['class ValidClass:', '    pass'].join('\n'),
  'src/clean-module/invalid-python.py': ['class ValidClass:', '    pass'].join('\n'),
  'src/clean-module/x.ts': ['export const DUMMY = 1;'].join('\n'),
  'src/clean-module/ui.ts': ['export const DUMMY = 1;'].join('\n'),
  'src/clean-module/this-is-an-excessively-long-file-name-that-exceeds-fifty-five-characters-limit-domain.ts':
    ['export const DUMMY = 1;'].join('\n'),
  'src/clean-module/python_func_lengths.py': [
    'def fn():',
    '    pass',
    'def this_is_an_extremely_long_python_function_name_that_exceeds_fifty_characters_limit():',
    '    pass',
    'def __init__(self):',
    '    pass',
  ].join('\n'),

  'src/clean-module/xyz-qwr-bcdf.ts': ['export const DUMMY = 1;'].join('\n'),
  'src/clean-module/one-two-three-four-five-six-seven.ts': ['export const DUMMY = 1;'].join('\n'),
  'src/clean-module/ts-verbs-test.ts': [
    'export function bananaApple(): void {}',
    'export function fetchXyz(): void {}',
    'export function executeQProcess(): void {}',
    'export function onClick(): void {}',
  ].join('\n'),
  'src/clean-module/python_verbs.py': [
    'def banana_apple():',
    '    pass',
    'def fetch_xyz():',
    '    pass',
    'def execute_q_process():',
    '    pass',
    'def __repr__(self):',
    '    return "ok"',
    'def test_banana():',
    '    pass',
  ].join('\n'),

  'src/clean-module/globals-test.ts': [
    'export const GOOD_CONST = "hello";',
    'export const badConst = "should_be_upper";',
    'export let mutableGlobal = 42;',
    'export const arrowFn = () => 1;',
  ].join('\n'),

  'src/clean-module/types-members-test.ts': [
    'export class goodClass {}',
    'export interface goodInterface {}',
    'export class ValidMemberClass {',
    '    public BadMethod(): void {}',
    '    public goodMethod(): void {}',
    '}',
  ].join('\n'),

  'src/clean-module/variables-test.ts': [
    'export function checkVariables(paramValue: string): void {',
    '    const parseResult = 10;',
    '    const res = 20;',
    '    const data = 30;',
    '    const p = "single_letter";',
    '    const _ = "discard_ok";',
    '    for (let i = 0; i < 10; i++) {',
    '        const inner = i;',
    '    }',
    '}',
  ].join('\n'),

  'src/clean-module/destructuring-test.ts': [
    'export function handleResponse(payload: any): void {',
    '    const { data } = payload;',
    '}',
  ].join('\n'),

  'src/clean-module/collections-test.ts': [
    'export function testCollections(): void {',
    '    const ruleById = new Map();',
    '    const myTable = new Map();',
    '}',
  ].join('\n'),

  'src/clean-module/jargon-symbols-test.ts': [
    'export const phase1Result = 42;',
    'export class PhaseTwoHandler {',
    '    public p0Execute(): void {}',
    '}',
    'export function checkFlow(wipFlag: boolean): void {',
    '    const tempBuffer = 10;',
    '}',
    'describe("test phase 1 features", () => {',
    '    it("verify p0 regression", () => {});',
    '});',
  ].join('\n'),

  'src/clean-module/jargon_python.py': ['class PhaseOneWorker:', '    pass', 'temp_var = 123'].join(
    '\n',
  ),

  'src/clean-module/polyglot_sample.go': [
    'package clean',
    'func bananaApple() {}',
    'func GetUserData() {}',
  ].join('\n'),

  'src/clean-module/polyglot_sample.rs': [
    'pub fn banana_apple() {}',
    'pub fn parse_data() {}',
  ].join('\n'),
};

function writeWorkspace(root) {
  for (const [relPath, content] of Object.entries(FIXTURES)) {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  fs.writeFileSync(
    path.join(root, 'auto-refactor.config.json'),
    JSON.stringify({
      analyzers: {
        naming: {
          enabled: true,
          options: {
            maxFileWords: 4,
            enforceVerbNounContract: true,
            enforceMorphemeCheck: true,
          },
        },
      },
    }),
  );
}

function verifyFileAndDirRules(byRule) {
  const filIssues = byRule('NAM-FIL-001');
  assert.ok(
    filIssues.length >= 5,
    `NAM-FIL-001 should catch non-standard names and invalid lengths`,
  );
  const filFiles = filIssues.map((i) => path.basename(i.location.file));
  assert.ok(filFiles.includes('CamelFile.ts'));
  assert.ok(filFiles.includes('test_snake_file.ts'));
  assert.ok(filFiles.includes('invalid-python.py'));
  assert.ok(filFiles.includes(JARGON_TEST_NAME));
  assert.ok(
    filFiles.includes('x.ts'),
    'x.ts should trigger NAM-FIL-001 for being excessively short',
  );
  assert.ok(
    !filFiles.includes('ui.ts'),
    'ui.ts is on the allowed short stems whitelist and should pass',
  );
  assert.ok(
    filFiles.some((f) => f.startsWith('this-is-an-excessively-long')),
    'excessively long file name should trigger NAM-FIL-001',
  );
  console.log(
    '  [PASS] NAM-FIL-001 flags non-conforming file names, invalid lengths, and transient jargon',
  );

  const dirIssues = byRule('NAM-DIR-001');
  assert.ok(dirIssues.length >= 1, 'DirtyCamelDir should trigger NAM-DIR-001');
  console.log('  [PASS] NAM-DIR-001 flags non-kebab/camelCase directory names');
}

function verifyGlobalsAndTypes(byRule) {
  const glb1 = byRule('NAM-GLB-001');
  assert.ok(glb1.some((i) => i.detail && i.detail.name === 'badConst'));
  assert.ok(!glb1.some((i) => i.detail && i.detail.name === 'GOOD_CONST'));
  assert.ok(!glb1.some((i) => i.detail && i.detail.name === 'arrowFn'));
  console.log('  [PASS] NAM-GLB-001 flags lowercase module constants, exempting functions');

  const glb2 = byRule('NAM-GLB-002');
  assert.strictEqual(glb2.length, 1, 'mutableGlobal let should trigger NAM-GLB-002');
  console.log('  [PASS] NAM-GLB-002 flags mutable top-level let declarations');

  const typ = byRule('NAM-TYP-001');
  assert.ok(typ.some((i) => i.detail && i.detail.name === 'goodClass'));
  assert.ok(typ.some((i) => i.detail && i.detail.name === 'goodInterface'));
  assert.ok(!typ.some((i) => i.detail && i.detail.name === 'ValidScanner'));
  console.log('  [PASS] NAM-TYP-001 flags non-PascalCase class and interface definitions');

  const mbr = byRule('NAM-MBR-001');
  assert.ok(mbr.some((i) => i.detail && i.detail.name === 'BadMethod'));
  assert.ok(!mbr.some((i) => i.detail && i.detail.name === 'goodMethod'));
  console.log('  [PASS] NAM-MBR-001 flags non-camelCase methods and members');
}

function verifyVariablesAndCollections(byRule) {
  const vag = byRule('NAM-VAG-001');
  assert.ok(vag.some((i) => i.detail && i.detail.name === 'res'));
  assert.ok(vag.some((i) => i.detail && i.detail.name === 'data'));
  assert.ok(!vag.some((i) => i.detail && i.detail.name === 'parseResult'));
  assert.ok(!vag.some((i) => i.location.file.includes('destructuring-test.ts')));
  console.log('  [PASS] NAM-VAG-001 flags vague identifiers and exempts property-destructuring');

  const sgl = byRule('NAM-SGL-001');
  assert.ok(sgl.some((i) => i.detail && i.detail.name === 'p'));
  assert.ok(!sgl.some((i) => i.detail && i.detail.name === 'i'));
  assert.ok(!sgl.some((i) => i.detail && i.detail.name === '_'));
  console.log('  [PASS] NAM-SGL-001 flags single letter variables (exempting loop indices)');

  const col = byRule('NAM-COL-001');
  assert.ok(col.some((i) => i.detail && i.detail.name === 'myTable'));
  assert.ok(!col.some((i) => i.detail && i.detail.name === 'ruleById'));
  console.log('  [PASS] NAM-COL-001 checks Map relationship semantics');
}

function verifyJargonRules(byRule) {
  const jrg = byRule('NAM-JRG-002');
  assert.ok(jrg.length >= 6, `Expected at least 6 NAM-JRG-002 issues, got ${jrg.length}`);
  assert.ok(jrg.some((i) => i.detail && i.detail.name === 'phase1Result'));
  assert.ok(jrg.some((i) => i.detail && i.detail.name === 'PhaseTwoHandler'));
  assert.ok(jrg.some((i) => i.detail && i.detail.name === 'p0Execute'));
  assert.ok(jrg.some((i) => i.detail && i.detail.name === 'wipFlag'));
  assert.ok(jrg.some((i) => i.detail && i.detail.name === 'tempBuffer'));
  assert.ok(jrg.some((i) => i.detail && i.detail.title === 'test phase 1 features'));
  assert.ok(jrg.some((i) => i.detail && i.detail.title === 'verify p0 regression'));
  assert.ok(jrg.some((i) => i.detail && i.detail.name === 'PhaseOneWorker'));
  assert.ok(jrg.some((i) => i.detail && i.detail.name === 'temp_var'));
  console.log(
    '  [PASS] NAM-JRG-002 flags transient construction jargon across TS and Python code/tests',
  );
}

function verifyFunctionLengthRules(byRule) {
  const len2Issues = byRule('NAM-LEN-002');
  assert.ok(len2Issues.length >= 2, 'NAM-LEN-002 should catch short and long python functions');
  assert.ok(
    len2Issues.some((i) => i.detail && i.detail.name === 'fn'),
    'short python function fn should trigger NAM-LEN-002',
  );
  assert.ok(
    len2Issues.some(
      (i) => i.detail && i.detail.name && i.detail.name.startsWith('this_is_an_extremely_long'),
    ),
    'excessively long python function should trigger NAM-LEN-002',
  );
  assert.ok(
    !len2Issues.some((i) => i.detail && i.detail.name === '__init__'),
    'dunder methods such as __init__ should be exempt from NAM-LEN-002',
  );
  console.log(
    '  [PASS] NAM-LEN-002 flags short/long Python function names, exempting dunder methods',
  );
}

const { getTunedAnalyzerOptions } = require('../dist/core/profiler/scaleTuner');

function verifyScaleTunerNamingOptions() {
  const microOpts = getTunedAnalyzerOptions('micro', 'naming', {});
  assert.strictEqual(microOpts.minFileWords, 1);
  assert.strictEqual(microOpts.maxFileWords, 3);
  assert.strictEqual(microOpts.minFileLength, 3);
  assert.strictEqual(microOpts.maxFileLength, 35);
  assert.strictEqual(microOpts.minFunctionWords, 1);
  assert.strictEqual(microOpts.maxFunctionWords, 3);
  assert.strictEqual(microOpts.minFunctionLength, 3);
  assert.strictEqual(microOpts.maxFunctionLength, 35);
  assert.strictEqual(microOpts.enforceVerbNounContract, true);
  assert.strictEqual(microOpts.enforceMorphemeCheck, true);

  const medOpts = getTunedAnalyzerOptions('medium', 'naming', {});
  assert.strictEqual(medOpts.minFileWords, 2);
  assert.strictEqual(medOpts.maxFileWords, 4);
  assert.strictEqual(medOpts.minFileLength, 4);
  assert.strictEqual(medOpts.maxFileLength, 48);
  assert.strictEqual(medOpts.minFunctionWords, 2);
  assert.strictEqual(medOpts.maxFunctionWords, 4);
  assert.strictEqual(medOpts.minFunctionLength, 4);
  assert.strictEqual(medOpts.maxFunctionLength, 45);
  assert.strictEqual(medOpts.enforceVerbNounContract, true);
  assert.strictEqual(medOpts.enforceMorphemeCheck, true);

  const largeOpts = getTunedAnalyzerOptions('large', 'naming', {});
  assert.strictEqual(largeOpts.minFileWords, 2);
  assert.strictEqual(largeOpts.maxFileWords, 5);
  assert.strictEqual(largeOpts.minFileLength, 4);
  assert.strictEqual(largeOpts.maxFileLength, 55);
  assert.strictEqual(largeOpts.minFunctionWords, 2);
  assert.strictEqual(largeOpts.maxFunctionWords, 5);
  assert.strictEqual(largeOpts.minFunctionLength, 4);
  assert.strictEqual(largeOpts.maxFunctionLength, 50);
  assert.strictEqual(largeOpts.enforceVerbNounContract, true);
  assert.strictEqual(largeOpts.enforceMorphemeCheck, true);

  console.log('  [PASS] scaleTuner provides correct adaptive naming options across tiers');
}

function verifyAdaptiveNamingRules(byRule) {
  const filIssues = byRule('NAM-FIL-001');
  assert.ok(
    filIssues.some((i) => i.location.file.includes('xyz-qwr-bcdf')),
    'xyz-qwr-bcdf should trigger NAM-FIL-001 for invalid morpheme phonetics',
  );
  assert.ok(
    filIssues.some((i) => i.location.file.includes('one-two-three-four-five-six-seven')),
    'excessive word segments file should trigger NAM-FIL-001',
  );
  console.log('  [PASS] NAM-FIL-001 flags word count bounds and pure-consonant morphemes');

  const lenIssues = byRule('NAM-LEN-002');
  assert.ok(
    lenIssues.some((i) => i.detail && i.detail.name === 'bananaApple'),
    'bananaApple should trigger NAM-LEN-002 for missing verb-noun contract',
  );
  assert.ok(
    lenIssues.some((i) => i.detail && i.detail.name === 'fetchXyz'),
    'fetchXyz should trigger NAM-LEN-002 for morpheme phonetics failure',
  );
  assert.ok(
    lenIssues.some((i) => i.detail && i.detail.name === 'executeQProcess'),
    'executeQProcess should trigger NAM-LEN-002 for single-letter fragment',
  );
  assert.ok(
    !lenIssues.some((i) => i.detail && i.detail.name === 'onClick'),
    'onClick should be exempt from verb-noun rule as event callback',
  );
  assert.ok(
    lenIssues.some((i) => i.detail && i.detail.name === 'banana_apple'),
    'Python banana_apple should trigger NAM-LEN-002 for verb-noun contract violation',
  );
  assert.ok(
    lenIssues.some((i) => i.detail && i.detail.name === 'fetch_xyz'),
    'Python fetch_xyz should trigger NAM-LEN-002 for morpheme phonetics failure',
  );
  assert.ok(
    lenIssues.some((i) => i.detail && i.detail.name === 'execute_q_process'),
    'Python execute_q_process should trigger NAM-LEN-002 for single-letter fragment',
  );
  assert.ok(
    !lenIssues.some((i) => i.detail && i.detail.name === '__repr__'),
    'Python __repr__ dunder method should be exempt',
  );
  assert.ok(
    !lenIssues.some((i) => i.detail && i.detail.name === 'test_banana'),
    'Python test_banana test method should be exempt',
  );
  assert.ok(
    lenIssues.some(
      (i) => i.location.file.endsWith('.go') && i.detail && i.detail.name === 'bananaApple',
    ),
    'Go bananaApple should trigger NAM-LEN-002 for verb-noun contract violation',
  );
  assert.ok(
    lenIssues.some(
      (i) => i.location.file.endsWith('.rs') && i.detail && i.detail.name === 'banana_apple',
    ),
    'Rust banana_apple should trigger NAM-LEN-002 for verb-noun contract violation',
  );
  console.log('  [PASS] NAM-LEN-002 flags verb-noun contract across TS, Python, Go, and Rust');
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-naming-'));
  try {
    writeWorkspace(root);
    const report = await scan({
      root,
      include: ['src/**/*.ts', 'src/**/*.py', 'src/**/*.go', 'src/**/*.rs'],
      analyzers: ['naming'],
      cache: false,
      daemon: 'off',
      logLevel: 'silent',
      respectGitignore: false,
      workers: 1,
    });

    const byRule = (rule) => report.issues.filter((i) => i.rule === rule);
    verifyScaleTunerNamingOptions();
    verifyFileAndDirRules(byRule);
    verifyGlobalsAndTypes(byRule);
    verifyVariablesAndCollections(byRule);
    verifyJargonRules(byRule);
    verifyFunctionLengthRules(byRule);
    verifyAdaptiveNamingRules(byRule);

    console.log('\n ALL NAMING SUITE VERIFICATION CHECKS PASSED SUCCESSFULLY!\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
