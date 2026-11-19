#!/usr/bin/env node
/**
 * Module: Verification Harness — Naming Governance Suite
 * File Path: scripts/validate-naming-suite.js
 * Architecture Role: Integration suite for naming rules (NAM-FIL-001 through NAM-COL-001).
 * Dependencies & Triggers: `npm run validate-naming-suite`; imports ../dist/api and assert.
 * Responsibilities: Assert file/dir naming conventions, global constants, mutable state,
 *   type/member casing, vague blacklist, single-letter guard, and collection semantics.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on failure. The failure tail
 *   comes from the shared harness entry rather than a local catch, centralizing exit contracts.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('../dist/api');
const { runEntry } = require('./common/test-runner-harness');
const { rmSyncWithRetry } = require('./lib/resilient-fs-cleanup');

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
    'def check_python_vars():',
    '    x = 10',
    '    _ = 20',
    '    fn = 30',
    '    res = 40',
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
    'type bad_go_type struct {}',
    'type PhaseOneManager struct {}',
    'const MaxTimeout = 60',
    'const temp_limit = 10',
    'func bananaApple() {}',
    'func GetUserData() {}',
    'func processGoItems() {',
    '    x := 10',
    '    _ = 20',
    '    var res = 30',
    '    var fn = "short"',
    '    var tempVal = 40',
    '    for i := 0; i < 10; i++ {',
    '        itemIdx := i',
    '    }',
    '}',
    'func TestGoFeature() {',
    '    x := 99',
    '    data := 100',
    '}',
  ].join('\n'),

  'src/clean-module/polyglot_sample.gd': [
    'class_name bad_gd_class',
    'const bad_gd_const = 5',
    'const MAX_SPEED = 100',
    'const AccountService = preload("res://account_service.gd")',
    'const bad_preload_ref = preload("res://bad_ref.gd")',
    'func banana_apple():',
    '    pass',
    'func update_player_state():',
    '    var x = 10',
    '    var _ = 20',
    '    var res = 30',
    '    var fn = null',
    '    var temp_val = 40',
    '    for i in range(10):',
    '        var count = i',
  ].join('\n'),

  'src/clean-module/polyglot_sample.rs': [
    'pub struct bad_rust_struct {}',
    'pub const bad_rust_const: u32 = 1;',
    'pub const fn valid_const_fn() -> u32 { 42 }',
    'pub fn banana_apple() {}',
    'pub fn parse_data() {',
    '    let x = 20;',
    '    let _ = 30;',
    '    let mut i = 0;',
    '    let data = 40;',
    '    let fn = 50;',
    '}',
    '#[test]',
    'fn test_my_feature() {',
    '    let x = 99;',
    '    let data = 100;',
    '}',
  ].join('\n'),
};

/**
 * Evaluates whether an issue matches an optional file extension and exact symbol name.
 *
 * @param issue - Diagnostic issue emitted by NamingAnalyzer.
 * @param symbolName - Expected `detail.name` identifier.
 * @param ext - Optional trailing file extension filter (e.g. `.rs`, `.go`, `.gd`).
 * @returns True when extension and `detail.name` match.
 */
function matchesSymbolIssue(issue, symbolName, ext) {
  const extMatch = !ext || (issue.location && issue.location.file.endsWith(ext));
  return Boolean(extMatch && issue.detail && issue.detail.name === symbolName);
}

/**
 * Asserts at least one diagnostic in `issues` targets `symbolName`.
 *
 * @param issues - Filtered rule issues.
 * @param symbolName - Target identifier expected to trigger the rule.
 * @param ext - Optional file extension filter.
 * @param message - Assertion failure message.
 */
function assertHasSymbolIssue(issues, symbolName, ext, message) {
  assert.ok(
    issues.some((issue) => matchesSymbolIssue(issue, symbolName, ext)),
    message || `Expected symbol ${symbolName} to trigger rule`,
  );
}

/**
 * Asserts zero diagnostics in `issues` target an exempted `symbolName`.
 *
 * @param issues - Filtered rule issues.
 * @param symbolName - Identifier expected to remain exempt.
 * @param ext - Optional file extension filter.
 * @param message - Assertion failure message.
 */
function assertNoSymbolIssue(issues, symbolName, ext, message) {
  assert.ok(
    !issues.some((issue) => matchesSymbolIssue(issue, symbolName, ext)),
    message || `Expected symbol ${symbolName} to remain exempt`,
  );
}

/**
 * Materializes multi-language naming fixtures and analyzer config in a temp workspace.
 *
 * @param root - Temporary workspace root path.
 */
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

/**
 * Verifies file-level (`NAM-FIL-001`) and directory-level (`NAM-DIR-001`) naming gates.
 *
 * @param byRule - Lookup helper returning issues emitted for a rule ID.
 */
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
    '  ✔ NAM-FIL-001 flags non-conforming file names, invalid lengths, and transient jargon',
  );

  const dirIssues = byRule('NAM-DIR-001');
  assert.ok(dirIssues.length >= 1, 'DirtyCamelDir should trigger NAM-DIR-001');
  console.log('  ✔ NAM-DIR-001 flags non-kebab/camelCase directory names');
}

/**
 * Verifies top-level constants, mutable globals, types, and class member casing rules.
 *
 * @param byRule - Lookup helper returning issues emitted for a rule ID.
 */
function verifyGlobalsAndTypes(byRule) {
  const glb1 = byRule('NAM-GLB-001');
  assertHasSymbolIssue(glb1, 'badConst');
  assertNoSymbolIssue(glb1, 'GOOD_CONST');
  assertNoSymbolIssue(glb1, 'arrowFn');
  console.log('  ✔ NAM-GLB-001 flags lowercase module constants, exempting functions');

  const glb2 = byRule('NAM-GLB-002');
  assert.strictEqual(glb2.length, 1, 'mutableGlobal let should trigger NAM-GLB-002');
  console.log('  ✔ NAM-GLB-002 flags mutable top-level let declarations');

  const typ = byRule('NAM-TYP-001');
  assertHasSymbolIssue(typ, 'goodClass');
  assertHasSymbolIssue(typ, 'goodInterface');
  assertNoSymbolIssue(typ, 'ValidScanner');
  console.log('  ✔ NAM-TYP-001 flags non-PascalCase class and interface definitions');

  const mbr = byRule('NAM-MBR-001');
  assertHasSymbolIssue(mbr, 'BadMethod');
  assertNoSymbolIssue(mbr, 'goodMethod');
  console.log('  ✔ NAM-MBR-001 flags non-camelCase methods and members');
}

/**
 * Verifies vague variable names, single-letter rules, and collection naming semantics.
 *
 * @param byRule - Lookup helper returning issues emitted for a rule ID.
 */
function verifyVariablesAndCollections(byRule) {
  const vag = byRule('NAM-VAG-001');
  assert.ok(vag.some((i) => i.detail && i.detail.name === 'res'));
  assert.ok(vag.some((i) => i.detail && i.detail.name === 'data'));
  assert.ok(!vag.some((i) => i.detail && i.detail.name === 'parseResult'));
  assert.ok(!vag.some((i) => i.location.file.includes('destructuring-test.ts')));
  console.log('  ✔ NAM-VAG-001 flags vague identifiers and exempts property-destructuring');

  const sgl = byRule('NAM-SGL-001');
  assert.ok(sgl.some((i) => i.detail && i.detail.name === 'p'));
  assert.ok(!sgl.some((i) => i.detail && i.detail.name === 'i'));
  assert.ok(!sgl.some((i) => i.detail && i.detail.name === '_'));
  console.log('  ✔ NAM-SGL-001 flags single letter variables (exempting loop indices)');

  const col = byRule('NAM-COL-001');
  assert.ok(col.some((i) => i.detail && i.detail.name === 'myTable'));
  assert.ok(!col.some((i) => i.detail && i.detail.name === 'ruleById'));
  console.log('  ✔ NAM-COL-001 checks Map relationship semantics');
}

/**
 * Verifies detection of transient sprint/phase jargon in identifiers and test titles.
 *
 * @param byRule - Lookup helper returning issues emitted for a rule ID.
 */
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
    '  ✔ NAM-JRG-002 flags transient construction jargon across TS and Python code/tests',
  );
}

/**
 * Verifies Python function identifier bounds (`NAM-LEN-002`) and dunder exemptions.
 *
 * @param byRule - Lookup helper returning issues emitted for a rule ID.
 */
function verifyFunctionLengthRules(byRule) {
  const len2Issues = byRule('NAM-LEN-002');
  assert.ok(len2Issues.length >= 2, 'NAM-LEN-002 should catch short and long python functions');
  assertHasSymbolIssue(
    len2Issues,
    'fn',
    undefined,
    'short python function fn should trigger NAM-LEN-002',
  );
  assert.ok(
    len2Issues.some(
      (i) => i.detail && i.detail.name && i.detail.name.startsWith('this_is_an_extremely_long'),
    ),
    'excessively long python function should trigger NAM-LEN-002',
  );
  assertNoSymbolIssue(
    len2Issues,
    '__init__',
    undefined,
    'dunder methods such as __init__ should be exempt from NAM-LEN-002',
  );
  console.log('  ✔ NAM-LEN-002 flags short/long Python function names, exempting dunder methods');
}

const { getTunedAnalyzerOptions } = require('../dist/core/profiler/scaleTuner');

const SCALE_TIER_EXPECTATIONS = [
  ['micro', 1, 3, 3, 35, 1, 3, 3, 35],
  ['medium', 2, 4, 4, 48, 2, 4, 4, 45],
  ['large', 2, 5, 4, 55, 2, 5, 4, 50],
];

/**
 * Verifies adaptive scaleTuner bounds across micro, medium, and large repository tiers.
 */
function verifyScaleTunerNamingOptions() {
  for (const [
    tier,
    minFW,
    maxFW,
    minFL,
    maxFL,
    minFnW,
    maxFnW,
    minFnL,
    maxFnL,
  ] of SCALE_TIER_EXPECTATIONS) {
    const opts = getTunedAnalyzerOptions(tier, 'naming', {});
    assert.strictEqual(opts.minFileWords, minFW);
    assert.strictEqual(opts.maxFileWords, maxFW);
    assert.strictEqual(opts.minFileLength, minFL);
    assert.strictEqual(opts.maxFileLength, maxFL);
    assert.strictEqual(opts.minFunctionWords, minFnW);
    assert.strictEqual(opts.maxFunctionWords, maxFnW);
    assert.strictEqual(opts.minFunctionLength, minFnL);
    assert.strictEqual(opts.maxFunctionLength, maxFnL);
    assert.strictEqual(opts.enforceVerbNounContract, true);
    assert.strictEqual(opts.enforceMorphemeCheck, true);
  }

  console.log('  ✔ scaleTuner provides correct adaptive naming options across tiers');
}

/** Verifies morpheme phonetics (`NAM-FIL-001`) and verb-noun contracts (`NAM-LEN-002`). */
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
  console.log('  ✔ NAM-FIL-001 flags word count bounds and pure-consonant morphemes');

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
  console.log('  ✔ NAM-LEN-002 flags verb-noun contract across TS, Python, Go, and Rust');
}

/** Verifies Rust polyglot naming diagnostics and test-module exemptions. */
function verifyRustPolyglotNaming(byRule) {
  const typIssues = byRule('NAM-TYP-001');
  assertHasSymbolIssue(
    typIssues,
    'bad_rust_struct',
    '.rs',
    'Rust bad_rust_struct should trigger NAM-TYP-001',
  );

  const glbIssues = byRule('NAM-GLB-001');
  assertHasSymbolIssue(
    glbIssues,
    'bad_rust_const',
    '.rs',
    'Rust bad_rust_const should trigger NAM-GLB-001',
  );
  assertNoSymbolIssue(
    glbIssues,
    'fn',
    '.rs',
    'const fn should not trigger NAM-GLB-001 on keyword fn',
  );

  const sglIssues = byRule('NAM-SGL-001');
  assertHasSymbolIssue(
    sglIssues,
    'x',
    '.rs',
    'Rust single-letter variable x should trigger NAM-SGL-001',
  );
  assertNoSymbolIssue(sglIssues, '_', '.rs', 'Rust wildcard _ should be exempt from NAM-SGL-001');
  assertNoSymbolIssue(sglIssues, 'i', '.rs', 'Rust loop index i should be exempt from NAM-SGL-001');
  assert.strictEqual(
    sglIssues.filter((i) => i.location.file.endsWith('.rs')).length,
    1,
    'Only non-test variable x should trigger NAM-SGL-001; test x must be exempted',
  );

  const vagIssues = byRule('NAM-VAG-001');
  assertHasSymbolIssue(vagIssues, 'data', '.rs', 'Rust variable data should trigger NAM-VAG-001');
  assert.strictEqual(
    vagIssues.filter((i) => i.location.file.endsWith('.rs')).length,
    1,
    'Only non-test variable data should trigger NAM-VAG-001; test data must be exempted',
  );

  console.log('  ✔ NAM-TYP-001, NAM-GLB-001, NAM-SGL-001, NAM-VAG-001 verified for Rust');
}

/** Verifies Go polyglot naming diagnostics and test-function exemptions. */
function verifyGoPolyglotNaming(byRule) {
  const typIssues = byRule('NAM-TYP-001');
  assertHasSymbolIssue(
    typIssues,
    'bad_go_type',
    '.go',
    'Go bad_go_type should trigger NAM-TYP-001',
  );

  const jrgIssues = byRule('NAM-JRG-002');
  assertHasSymbolIssue(
    jrgIssues,
    'PhaseOneManager',
    '.go',
    'Go PhaseOneManager should trigger NAM-JRG-002',
  );
  assertHasSymbolIssue(jrgIssues, 'temp_limit', '.go', 'Go temp_limit should trigger NAM-JRG-002');

  const sglIssues = byRule('NAM-SGL-001');
  assertHasSymbolIssue(
    sglIssues,
    'x',
    '.go',
    'Go single-letter variable x should trigger NAM-SGL-001',
  );
  assertNoSymbolIssue(sglIssues, '_', '.go', 'Go wildcard _ should be exempt from NAM-SGL-001');
  assertNoSymbolIssue(sglIssues, 'i', '.go', 'Go loop index i should be exempt from NAM-SGL-001');
  assert.strictEqual(
    sglIssues.filter((i) => i.location.file.endsWith('.go')).length,
    1,
    'Only non-test variable x should trigger NAM-SGL-001 in Go; test x must be exempted',
  );

  const vagIssues = byRule('NAM-VAG-001');
  assertHasSymbolIssue(vagIssues, 'res', '.go', 'Go variable res should trigger NAM-VAG-001');
  assert.strictEqual(
    vagIssues.filter((i) => i.location.file.endsWith('.go')).length,
    1,
    'Only non-test variable res should trigger NAM-VAG-001 in Go; test data must be exempted',
  );

  console.log('  ✔ NAM-TYP-001, NAM-JRG-002, NAM-SGL-001, NAM-VAG-001 verified for Go');
}

/** Verifies GDScript polyglot naming diagnostics and preload exemptions. */
function verifyGDScriptPolyglotNaming(byRule) {
  const typIssues = byRule('NAM-TYP-001');
  assert.ok(
    typIssues.some(
      (i) => i.location.file.endsWith('.gd') && i.detail && i.detail.name === 'bad_gd_class',
    ),
    'GDScript bad_gd_class should trigger NAM-TYP-001',
  );

  const glbIssues = byRule('NAM-GLB-001');
  assert.ok(
    glbIssues.some(
      (i) => i.location.file.endsWith('.gd') && i.detail && i.detail.name === 'bad_gd_const',
    ),
    'GDScript bad_gd_const should trigger NAM-GLB-001',
  );
  assert.ok(
    !glbIssues.some(
      (i) => i.location.file.endsWith('.gd') && i.detail && i.detail.name === 'MAX_SPEED',
    ),
    'GDScript MAX_SPEED constant should be valid',
  );
  assert.ok(
    !glbIssues.some(
      (i) => i.location.file.endsWith('.gd') && i.detail && i.detail.name === 'AccountService',
    ),
    'GDScript PascalCase preload binding AccountService should be exempt from NAM-GLB-001',
  );
  assert.ok(
    typIssues.some(
      (i) => i.location.file.endsWith('.gd') && i.detail && i.detail.name === 'bad_preload_ref',
    ),
    'GDScript snake_case preload binding bad_preload_ref should trigger NAM-TYP-001',
  );

  const sglIssues = byRule('NAM-SGL-001');
  assert.ok(
    sglIssues.some((i) => i.location.file.endsWith('.gd') && i.detail && i.detail.name === 'x'),
    'GDScript single-letter variable x should trigger NAM-SGL-001',
  );
  assert.ok(
    !sglIssues.some((i) => i.location.file.endsWith('.gd') && i.detail && i.detail.name === '_'),
    'GDScript wildcard _ should be exempt from NAM-SGL-001',
  );
  assert.ok(
    !sglIssues.some((i) => i.location.file.endsWith('.gd') && i.detail && i.detail.name === 'i'),
    'GDScript loop index i should be exempt from NAM-SGL-001',
  );

  const vagIssues = byRule('NAM-VAG-001');
  assert.ok(
    vagIssues.some((i) => i.location.file.endsWith('.gd') && i.detail && i.detail.name === 'res'),
    'GDScript variable res should trigger NAM-VAG-001',
  );

  console.log('  ✔ NAM-TYP-001, NAM-GLB-001, NAM-SGL-001, NAM-VAG-001 verified for GDScript');
}

/**
 * Verifies `NAM-LEN-001` and AAS v1.0 actionable rename payloads across polyglot fixtures.
 *
 * @param byRule - Lookup helper returning issues emitted for a rule ID.
 */
function verifyPolyglotVariableLengthsAndActionable(byRule) {
  const len1Issues = byRule('NAM-LEN-001');
  assert.ok(
    len1Issues.some((i) => i.location.file.endsWith('.go') && i.detail && i.detail.name === 'fn'),
    'Go variable fn should trigger NAM-LEN-001',
  );
  assert.ok(
    len1Issues.some((i) => i.location.file.endsWith('.gd') && i.detail && i.detail.name === 'fn'),
    'GDScript variable fn should trigger NAM-LEN-001',
  );
  assert.ok(
    len1Issues.some((i) => i.location.file.endsWith('.rs') && i.detail && i.detail.name === 'fn'),
    'Rust variable fn should trigger NAM-LEN-001',
  );
  assert.ok(
    len1Issues.some((i) => i.location.file.endsWith('.py') && i.detail && i.detail.name === 'fn'),
    'Python variable fn should trigger NAM-LEN-001',
  );

  const polyglotIssues = [...len1Issues, ...byRule('NAM-TYP-001'), ...byRule('NAM-GLB-001')].filter(
    (i) => !i.location.file.endsWith('.ts'),
  );
  assert.ok(polyglotIssues.length >= 8, 'Expected polyglot issues with actionable payloads');
  for (const issue of polyglotIssues) {
    assert.ok(
      issue.actionable,
      `Issue ${issue.rule} in ${issue.location.file} must attach actionable payload`,
    );
    assert.strictEqual(issue.actionable.action, 'replace_token');
    assert.strictEqual(issue.actionable.taxonomy, 'GOV_NORM');
    assert.ok(issue.actionable.targetSymbol, 'Actionable payload must contain targetSymbol');
  }

  console.log(
    '  ✔ NAM-LEN-001 and AAS v1.0 actionable payload verified across Go, GDScript, Rust, and Python',
  );
}

/**
 * Executes the end-to-end naming governance scan suite against an ephemeral workspace.
 */
async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-naming-'));
  try {
    writeWorkspace(root);
    const report = await scan({
      root,
      include: ['src/**/*.ts', 'src/**/*.py', 'src/**/*.go', 'src/**/*.rs', 'src/**/*.gd'],
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
    verifyRustPolyglotNaming(byRule);
    verifyGoPolyglotNaming(byRule);
    verifyGDScriptPolyglotNaming(byRule);
    verifyPolyglotVariableLengthsAndActionable(byRule);

    console.log('\n ALL NAMING SUITE VERIFICATION CHECKS PASSED SUCCESSFULLY!\n');
  } finally {
    rmSyncWithRetry(root, { recursive: true, force: true });
  }
}

runEntry('validate-naming-suite.js', run);
