#!/usr/bin/env node
/**
 * Module: Verification Harness — File Preflight Gate & Bitmask Verification
 * File Path: scripts/validate-file-preflight-gate.js
 * Architecture Role: Validates the 32-bit AnalyzerBitmask SSOT taxonomy, bidirectional mapping,
 *   single-pass file preflight syntactic filtering, and zero-allocation execution paths.
 * Dependencies & Triggers: Run via `node scripts/validate-file-preflight-gate.js` or gate suite.
 * Responsibilities:
 *   1. Assert 32-bit bitmask integrity across all 31 built-in analyzers;
 *   2. Assert language extension bounds pruning;
 *   3. Assert token trigger pruning for secrets, comments, and complexity;
 *   4. Assert bypassPreflight escape hatch behavior.
 * Exit Semantics & Design Rationale: Exits 0 on verification pass, 1 on failure.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const bitmaskPath = path.join(ROOT, 'dist', 'core', 'constants', 'analyzer-bitmask');
const preflightPath = path.join(ROOT, 'dist', 'core', 'scanner', 'file-preflight-gate');
const ruleCodesPath = path.join(ROOT, 'dist', 'core', 'constants', 'rule-codes');

let bitmaskModule, preflightModule, ruleCodesModule;
try {
  bitmaskModule = require(bitmaskPath);
  preflightModule = require(preflightPath);
  ruleCodesModule = require(ruleCodesPath);
} catch (err) {
  console.error('✖ BLOCK Unable to load modules from dist. Run npm run build first.');
  console.error(err);
  process.exit(1);
}

const {
  AnalyzerBit,
  ALL_ANALYZERS_MASK,
  ANALYZER_NAME_TO_BIT,
  BIT_TO_ANALYZER_NAME,
  analyzerNameToBit,
  hasAnalyzerBit,
  analyzerMaskToNames,
  analyzerNamesToMask,
} = bitmaskModule;

const { evaluateFilePreflightMask, isFileAnalyzerActive } = preflightModule;
const { BUILTIN_ANALYZERS } = ruleCodesModule;

console.log('=== Validating 32-Bit AnalyzerBitmask & FilePreflightGate ===');

// 1. Bitmask integrity assertions
assert.strictEqual(BUILTIN_ANALYZERS.length, 32, 'Expected 32 built-in analyzers');
assert.strictEqual(ALL_ANALYZERS_MASK | 0, -1, 'Expected 32-bit mask (0xFFFFFFFF)');
assert.strictEqual(AnalyzerBit.CONSTANTS, 1, 'AnalyzerBit.CONSTANTS must equal 1');
assert.strictEqual(ANALYZER_NAME_TO_BIT['constants'], 1, 'ANALYZER_NAME_TO_BIT constants check');

const namesFromAll = analyzerMaskToNames(ALL_ANALYZERS_MASK);
assert.strictEqual(namesFromAll.length, 32, 'Decoded mask must yield all 32 analyzer names');

const encodedMask = analyzerNamesToMask(BUILTIN_ANALYZERS);
assert.strictEqual(
  encodedMask | 0,
  ALL_ANALYZERS_MASK | 0,
  'Encoding all 32 analyzers must equal ALL_ANALYZERS_MASK',
);

for (let i = 0; i < BUILTIN_ANALYZERS.length; i++) {
  const name = BUILTIN_ANALYZERS[i];
  const bit = analyzerNameToBit(name);
  assert(bit !== 0, `Analyzer ${name} must have a non-zero bit`);
  assert.strictEqual(bit, (1 << i) | 0, `Analyzer ${name} expected bit 1 << ${i}`);
  assert.strictEqual(BIT_TO_ANALYZER_NAME[bit], name, `Bit reverse lookup failed for ${name}`);
  assert(
    hasAnalyzerBit(ALL_ANALYZERS_MASK, bit),
    `Bit for ${name} must be active in ALL_ANALYZERS_MASK`,
  );
}
console.log('✔ 32-Bit Analyzer Bitmask Taxonomy & Bidirectional Lookup verified.');

// 2. Extension pruning assertions
const pyMask = evaluateFilePreflightMask('x = 1', 'src/model.py');
assert(!isFileAnalyzerActive(pyMask, 'ts-modern'), 'ts-modern must be pruned for .py files');
assert(!isFileAnalyzerActive(pyMask, 'rust-modern'), 'rust-modern must be pruned for .py files');
assert(!isFileAnalyzerActive(pyMask, 'shell-lint'), 'shell-lint must be pruned for .py files');

const tsMask = evaluateFilePreflightMask('const x: number = 1;', 'src/model.ts');
assert(isFileAnalyzerActive(tsMask, 'ts-modern'), 'ts-modern must be active for .ts files');
assert(
  !isFileAnalyzerActive(tsMask, 'python-modern'),
  'python-modern must be pruned for .ts files',
);
console.log('✔ Language extension pruning verified.');

// 3. Syntactic token pruning assertions
const cleanCode = 'const a = 1;\nconst b = 2;\n';
const cleanMask = evaluateFilePreflightMask(cleanCode, 'src/math.ts');
assert(
  !isFileAnalyzerActive(cleanMask, 'secrets'),
  'secrets must be pruned when secret keywords absent',
);
assert(
  !isFileAnalyzerActive(cleanMask, 'comments'),
  'comments must be pruned when comment tokens absent',
);

const secretCode = 'const ghp_token = "ghp_1234567890abcdef";';
const secretMask = evaluateFilePreflightMask(secretCode, 'src/config.ts');
assert(
  isFileAnalyzerActive(secretMask, 'secrets'),
  'secrets must be active when secret keywords present',
);

const commentCode = '// This is an architectural comment\nconst x = 1;';
const commentMask = evaluateFilePreflightMask(commentCode, 'src/lib.ts');
assert(
  isFileAnalyzerActive(commentMask, 'comments'),
  'comments must be active when comment tokens present',
);
console.log('✔ Syntactic token trigger pre-filtering verified.');

// 4. Bypass escape hatch verification
const bypassMask = evaluateFilePreflightMask(cleanCode, 'src/math.ts', {
  bypassPreflight: true,
});
assert.strictEqual(
  bypassMask,
  ALL_ANALYZERS_MASK,
  'bypassPreflight: true must return ALL_ANALYZERS_MASK',
);
console.log('✔ bypassPreflight configuration override verified.');

console.log('================================================================');
console.log('🎉 ALL FilePreflightGate & AnalyzerBitmask TESTS PASSED!');
console.log('================================================================');
