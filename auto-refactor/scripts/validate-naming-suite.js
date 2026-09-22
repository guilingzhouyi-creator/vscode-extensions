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
};

function writeWorkspace(root) {
  for (const [relPath, content] of Object.entries(FIXTURES)) {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function verifyFileAndDirRules(byRule) {
  const filIssues = byRule('NAM-FIL-001');
  assert.ok(filIssues.length >= 3, `NAM-FIL-001 should catch non-standard names`);
  const filFiles = filIssues.map((i) => path.basename(i.location.file));
  assert.ok(filFiles.includes('CamelFile.ts'));
  assert.ok(filFiles.includes('test_snake_file.ts'));
  assert.ok(filFiles.includes('invalid-python.py'));
  assert.ok(filFiles.includes(JARGON_TEST_NAME));
  console.log('  [PASS] NAM-FIL-001 flags non-conforming file names and transient jargon');

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

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-naming-'));
  try {
    writeWorkspace(root);
    const report = await scan({
      root,
      include: ['src/**/*.ts', 'src/**/*.py'],
      analyzers: ['naming'],
      cache: false,
      daemon: 'off',
      logLevel: 'silent',
      respectGitignore: false,
      workers: 1,
    });

    const byRule = (rule) => report.issues.filter((i) => i.rule === rule);
    verifyFileAndDirRules(byRule);
    verifyGlobalsAndTypes(byRule);
    verifyVariablesAndCollections(byRule);
    verifyJargonRules(byRule);

    console.log('\n ALL NAMING SUITE VERIFICATION CHECKS PASSED SUCCESSFULLY!\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
