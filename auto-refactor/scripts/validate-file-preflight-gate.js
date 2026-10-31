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

const MODULE_ASSERT = 'assert';
const MODULE_PATH = 'path';
const assert = require(MODULE_ASSERT);
const path = require(MODULE_PATH);

const ROOT = path.join(__dirname, '..');
const DIR_DIST = 'dist';
const DIR_CORE = 'core';
const DIR_CONSTANTS = 'constants';
const DIR_SCANNER = 'scanner';
const FILE_ANALYZER_BITMASK = 'analyzer-bitmask';
const FILE_FILE_PREFLIGHT_GATE = 'file-preflight-gate';
const FILE_RULE_CODES = 'rule-codes';

const BITMASK_PATH = path.join(ROOT, DIR_DIST, DIR_CORE, DIR_CONSTANTS, FILE_ANALYZER_BITMASK);
const PREFLIGHT_PATH = path.join(ROOT, DIR_DIST, DIR_CORE, DIR_SCANNER, FILE_FILE_PREFLIGHT_GATE);
const RULE_CODES_PATH = path.join(ROOT, DIR_DIST, DIR_CORE, DIR_CONSTANTS, FILE_RULE_CODES);

const EXPECTED_BUILTIN_ANALYZERS_COUNT = 32;

const TARGET_ANALYZERS = Object.freeze({
  constants: 'constants',
  tsModern: 'ts-modern',
  rustModern: 'rust-modern',
  shellLint: 'shell-lint',
  pythonModern: 'python-modern',
  secrets: 'secrets',
  comments: 'comments',
});

const SAMPLE_PATH_PY = 'src/model.py';
const SAMPLE_PATH_TS = 'src/model.ts';
const SAMPLE_PATH_MATH = 'src/math.ts';
const SAMPLE_PATH_CONFIG = 'src/config.ts';
const SAMPLE_PATH_LIB = 'src/lib.ts';

const SAMPLE_CODE_PY = 'x = 1';
const SAMPLE_CODE_TS = 'const x: number = 1;';
const SAMPLE_CLEAN_CODE = 'const a = 1;\nconst b = 2;\n';
const SAMPLE_SECRET_CODE = 'const ghp_token = "ghp_1234567890abcdef";';
const SAMPLE_COMMENT_CODE = '// This is an architectural comment\nconst x = 1;';

function loadPreflightModules() {
  try {
    return Object.freeze({
      bitmask: require(BITMASK_PATH),
      preflight: require(PREFLIGHT_PATH),
      ruleCodes: require(RULE_CODES_PATH),
    });
  } catch (err) {
    console.error('✖ BLOCK Unable to load modules from dist. Run npm run build first.');
    console.error(err);
    process.exit(1);
  }
}

const { bitmask, preflight, ruleCodes } = loadPreflightModules();

const {
  AnalyzerBit,
  ALL_ANALYZERS_MASK,
  ANALYZER_NAME_TO_BIT,
  BIT_TO_ANALYZER_NAME,
  analyzerNameToBit,
  hasAnalyzerBit,
  analyzerMaskToNames,
  analyzerNamesToMask,
} = bitmask;

const { evaluateFilePreflightMask, isFileAnalyzerActive } = preflight;
const { BUILTIN_ANALYZERS } = ruleCodes;

console.log('=== Validating 32-Bit AnalyzerBitmask & FilePreflightGate ===');

// 1. Bitmask integrity assertions
assert.strictEqual(
  BUILTIN_ANALYZERS.length,
  EXPECTED_BUILTIN_ANALYZERS_COUNT,
  'Expected 32 built-in analyzers',
);
assert.strictEqual(ALL_ANALYZERS_MASK | 0, -1, 'Expected 32-bit mask (0xFFFFFFFF)');
assert.strictEqual(AnalyzerBit.CONSTANTS, 1, 'AnalyzerBit.CONSTANTS must equal 1');
assert.strictEqual(
  ANALYZER_NAME_TO_BIT[TARGET_ANALYZERS.constants],
  1,
  'ANALYZER_NAME_TO_BIT constants check',
);

const namesFromAll = analyzerMaskToNames(ALL_ANALYZERS_MASK);
assert.strictEqual(
  namesFromAll.length,
  EXPECTED_BUILTIN_ANALYZERS_COUNT,
  'Decoded mask must yield all 32 analyzer names',
);

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
const pyMask = evaluateFilePreflightMask(SAMPLE_CODE_PY, SAMPLE_PATH_PY);
assert(
  !isFileAnalyzerActive(pyMask, TARGET_ANALYZERS.tsModern),
  'ts-modern must be pruned for .py files',
);
assert(
  !isFileAnalyzerActive(pyMask, TARGET_ANALYZERS.rustModern),
  'rust-modern must be pruned for .py files',
);
assert(
  !isFileAnalyzerActive(pyMask, TARGET_ANALYZERS.shellLint),
  'shell-lint must be pruned for .py files',
);

const tsMask = evaluateFilePreflightMask(SAMPLE_CODE_TS, SAMPLE_PATH_TS);
assert(
  isFileAnalyzerActive(tsMask, TARGET_ANALYZERS.tsModern),
  'ts-modern must be active for .ts files',
);
assert(
  !isFileAnalyzerActive(tsMask, TARGET_ANALYZERS.pythonModern),
  'python-modern must be pruned for .ts files',
);
console.log('✔ Language extension pruning verified.');

// 3. Syntactic token pruning assertions
const cleanMask = evaluateFilePreflightMask(SAMPLE_CLEAN_CODE, SAMPLE_PATH_MATH);
assert(
  !isFileAnalyzerActive(cleanMask, TARGET_ANALYZERS.secrets),
  'secrets must be pruned when secret keywords absent',
);
assert(
  !isFileAnalyzerActive(cleanMask, TARGET_ANALYZERS.comments),
  'comments must be pruned when comment tokens absent',
);

const secretMask = evaluateFilePreflightMask(SAMPLE_SECRET_CODE, SAMPLE_PATH_CONFIG);
assert(
  isFileAnalyzerActive(secretMask, TARGET_ANALYZERS.secrets),
  'secrets must be active when secret keywords present',
);

const commentMask = evaluateFilePreflightMask(SAMPLE_COMMENT_CODE, SAMPLE_PATH_LIB);
assert(
  isFileAnalyzerActive(commentMask, TARGET_ANALYZERS.comments),
  'comments must be active when comment tokens present',
);
console.log('✔ Syntactic token trigger pre-filtering verified.');

// 4. Bypass escape hatch verification
const bypassMask = evaluateFilePreflightMask(SAMPLE_CLEAN_CODE, SAMPLE_PATH_MATH, {
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
