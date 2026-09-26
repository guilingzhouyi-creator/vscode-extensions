/**
 * Module: Validation Test — Source Masking Dual-Track Equivalence
 * File Path: test/validate-mask-equivalence.js
 * Architecture Role: Validates 100% byte equivalence between Rust native SIMD
 *   masking operator and Pure JS fallback shim across multiple languages.
 */

'use strict';

const assert = require('assert');
const {
  maskSourceText,
  maskSourceTextJs,
  languageIdFromPath,
  maskPresetForLanguage,
} = require('../dist/core/policy/source-mask');
const { PureJsNativeShim } = require('../dist/core/native/native-bridge');

const TEST_CASES = [
  {
    fileName: 'sample.ts',
    content: [
      '// TypeScript single line comment',
      'const greeting = "Hello, \\"world\\"! /* not a comment */";',
      '/* Multi-line comment',
      '   spanning lines */',
      'const template = `Hello ${name} // not comment`;',
      'const regex = /[a-z]+(\\/[0-9]+)/g; // regex literal',
    ].join('\n'),
  },
  {
    fileName: 'script.py',
    content: [
      '# Python comment',
      'msg = "Hello # not comment"',
      'doc = """Multi-line docstring',
      'with # comment inside',
      '"""',
      'print(doc)',
    ].join('\n'),
  },
  {
    fileName: 'build.sh',
    content: [
      '#!/bin/bash',
      '# Shell script comment',
      'NAME="World # not comment"',
      'echo "Hello $NAME"',
    ].join('\n'),
  },
  {
    fileName: 'player.gd',
    content: [
      '# GDScript comment',
      'var health = 100',
      'var name = "Godot # not comment"',
      'func take_damage(amount):',
      '\thealth -= amount',
    ].join('\n'),
  },
  {
    fileName: 'engine.rs',
    content: [
      '// Rust comment',
      '/* Block comment */',
      'let msg = "Hello \\"Rust\\"";',
      'let raw = r#"Raw "string" literal"#;',
    ].join('\n'),
  },
];

function runValidation() {
  console.log('=== Running Masking Dual-Track Equivalence Tests ===');
  let passCount = 0;

  for (const testCase of TEST_CASES) {
    const lang = languageIdFromPath(testCase.fileName);
    const config = maskPresetForLanguage(lang);

    // Track A: Top-level maskSourceText (uses native Rust SIMD if available)
    const resultNativeOrActive = maskSourceText(testCase.content, config);

    // Track B: Explicit Pure JS Implementation
    const resultPureJs = maskSourceTextJs(testCase.content, config);

    // Verify 100% equivalence
    assert.strictEqual(
      resultNativeOrActive.raw.length,
      resultPureJs.raw.length,
      `Raw line count mismatch for ${testCase.fileName}`
    );
    assert.strictEqual(
      resultNativeOrActive.masked.length,
      resultPureJs.masked.length,
      `Masked line count mismatch for ${testCase.fileName}`
    );

    for (let i = 0; i < resultNativeOrActive.masked.length; i++) {
      assert.strictEqual(
        resultNativeOrActive.masked[i],
        resultPureJs.masked[i],
        `Masked line ${i + 1} mismatch for ${testCase.fileName}:\n` +
        `Native: "${resultNativeOrActive.masked[i]}"\n` +
        `PureJS: "${resultPureJs.masked[i]}"`
      );
    }

    console.log(`  ✓ ${testCase.fileName}: ${resultNativeOrActive.raw.length} lines 100% byte-for-byte identical`);
    passCount += 1;
  }

  console.log(`\nAll ${passCount} masking equivalence test cases passed with 100% parity!`);
}

runValidation();
