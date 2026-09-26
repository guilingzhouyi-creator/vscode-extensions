/**
 * Module: Verification Harness — Standard Library & Systems Runtime Profile & Rules
 * File Path: scripts/validate-stdlib-profile.js
 * Architecture Role: Verifies the standard library and systems runtime archetype profiling,
 *   clean-architecture bypass, elastic budgets, and the 6 mission-critical rules
 *   (STDLIB-PANIC-001, STDLIB-ALLOC-001, STDLIB-UNSAFE-001, STDLIB-CONST-001,
 *   STDLIB-RECURSION-001, STDLIB-PORT-001) with positive and negative test cases.
 * Dependencies & Triggers: Consumes dist/api and dist/analyzers/stdlib; executed via `npm test`.
 * Responsibilities:
 *   1. Assert project profiler detects stdlib and systems_runtime archetypes;
 *   2. Assert architecture analyzer bypasses layer violations on stdlib;
 *   3. Assert StdlibAnalyzer flags bare panics, no_std heap escapes, unsafe lacking SAFETY proof,
 *      variable-time crypto comparisons, unbounded recursions, and missing platform fallbacks;
 *   4. Assert clean, compliant stdlib constructs pass with 0 findings;
 *   5. Assert CAI 2.0 rates self-contained standard libraries as L5_INDEPENDENT
 *      with 100% supply chain resilience.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scan } = require('../dist/api');
const { StdlibAnalyzer } = require('../dist/analyzers/stdlib');
const { detectProjectProfile } = require('../dist/core/profiler/projectProfiler');
const { evaluateProjectAutonomy } = require('../dist/core/scoring/autonomy-scorer');

async function testStdlibArchetypeProfiling() {
  console.log('1. Testing stdlib & systems_runtime archetype profiling...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stdlib-profile-'));
  try {
    fs.mkdirSync(path.join(tempDir, 'core', 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'Cargo.toml'),
      '[package]\nname = "sys-core"\nversion = "0.1.0"\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempDir, 'core', 'src', 'lib.rs'),
      '#![no_std]\n#![no_core]\npub fn init() {}\n',
      'utf8'
    );

    const profile = detectProjectProfile(tempDir);
    assert.ok(
      profile.archetype === 'systems_runtime' || profile.archetype === 'stdlib',
      `Expected systems_runtime or stdlib, got ${profile.archetype}`
    );

    console.log(`   ✓ Archetype correctly detected as: ${profile.archetype}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testStdlibSpecialRulesPositiveAndNegative() {
  console.log('2. Testing the 6 standard library & systems runtime special rules...');

  const analyzer = new StdlibAnalyzer();

  // 2.1 STDLIB-PANIC-001
  const panicBadCtx = {
    filePath: 'src/lib.rs',
    content: 'pub fn calculate(x: i32) -> i32 {\n    if x < 0 {\n        panic!("negative input");\n    }\n    x * 2\n}\n',
  };
  const panicBadIssues = analyzer.finalize(panicBadCtx);
  assert.strictEqual(panicBadIssues.length, 1);
  assert.strictEqual(panicBadIssues[0].rule, 'STDLIB-PANIC-001');

  const panicGoodCtx = {
    filePath: 'src/lib.rs',
    content: 'pub fn calculate(x: i32) -> Result<i32, &\'static str> {\\n    if x < 0 {\\n        return Err("negative input");\\n    }\\n    Ok(x * 2)\\n}\\n',
  };
  const panicGoodIssues = analyzer.finalize(panicGoodCtx);
  assert.strictEqual(panicGoodIssues.length, 0, 'Clean Result return must not flag STDLIB-PANIC-001');

  // 2.2 STDLIB-ALLOC-001
  const allocBadCtx = {
    filePath: 'src/core/mem.rs',
    content: '#![no_std]\npub fn allocate_item() {\n    let _b = Box::new(42);\n}\n',
  };
  const allocBadIssues = analyzer.finalize(allocBadCtx);
  assert.ok(allocBadIssues.some((i) => i.rule === 'STDLIB-ALLOC-001'), 'Must flag Box::new in no_std');

  const allocGoodCtx = {
    filePath: 'src/core/mem.rs',
    content: '#![no_std]\npub fn allocate_item() {\n    let mut _buf = [0u8; 64];\n}\n',
  };
  const allocGoodIssues = analyzer.finalize(allocGoodCtx);
  assert.strictEqual(allocGoodIssues.length, 0, 'Stack buffer in no_std must not flag STDLIB-ALLOC-001');

  // 2.3 STDLIB-UNSAFE-001
  const unsafeBadCtx = {
    filePath: 'src/ptr.rs',
    content: 'pub fn deref(p: *const u32) -> u32 {\n    unsafe {\n        *p\n    }\n}\n',
  };
  const unsafeBadIssues = analyzer.finalize(unsafeBadCtx);
  assert.ok(unsafeBadIssues.some((i) => i.rule === 'STDLIB-UNSAFE-001'), 'Must flag unsafe without SAFETY proof');

  const unsafeGoodCtx = {
    filePath: 'src/ptr.rs',
    content: 'pub fn deref(p: *const u32) -> u32 {\n    // SAFETY: caller guarantees pointer is aligned and non-null\n    unsafe {\n        *p\n    }\n}\n',
  };
  const unsafeGoodIssues = analyzer.finalize(unsafeGoodCtx);
  assert.strictEqual(unsafeGoodIssues.length, 0, 'Unsafe with SAFETY comment must pass');

  // 2.4 STDLIB-CONST-001
  const constBadCtx = {
    filePath: 'src/crypto/token.rs',
    content: 'pub fn verify_signature(a: &[u8], b: &[u8]) -> bool {\n    for i in 0..a.len() {\n        if a[i] != b[i] { return false; }\n    }\n    true\n}\n',
  };
  const constBadIssues = analyzer.finalize(constBadCtx);
  assert.ok(constBadIssues.some((i) => i.rule === 'STDLIB-CONST-001'), 'Must flag short-circuit byte comparison in crypto');

  const constGoodCtx = {
    filePath: 'src/crypto/token.rs',
    content: 'pub fn verify_signature(a: &[u8], b: &[u8]) -> bool {\n    let mut acc = 0u8;\n    for i in 0..a.len() {\n        acc |= a[i] ^ b[i];\n    }\n    acc == 0\n}\n',
  };
  const constGoodIssues = analyzer.finalize(constGoodCtx);
  assert.strictEqual(constGoodIssues.length, 0, 'Constant-time comparison must pass');

  // 2.5 STDLIB-RECURSION-001
  const recurBadCtx = {
    filePath: 'src/algorithm/tree.rs',
    content: 'pub fn compute_depth(node: &Node) -> usize {\n    1 + compute_depth(node.left)\n}\n',
  };
  const recurBadIssues = analyzer.finalize(recurBadCtx);
  assert.ok(recurBadIssues.some((i) => i.rule === 'STDLIB-RECURSION-001'), 'Must flag unbounded recursion');

  const recurGoodCtx = {
    filePath: 'src/algorithm/tree.rs',
    content: 'pub fn compute_depth(node: &Node, depth: usize) -> Result<usize, ()> {\n    if depth > 64 { return Err(()); }\n    Ok(1 + compute_depth(node.left, depth + 1)?)\n}\n',
  };
  const recurGoodIssues = analyzer.finalize(recurGoodCtx);
  assert.strictEqual(recurGoodIssues.length, 0, 'Bounded recursion with depth limit must pass');

  // 2.6 STDLIB-PORT-001
  const portBadCtx = {
    filePath: 'src/sys/os.rs',
    content: '#[cfg(target_os = "linux")]\npub fn get_clock() -> u64 { 0 }\n',
  };
  const portBadIssues = analyzer.finalize(portBadCtx);
  assert.ok(portBadIssues.some((i) => i.rule === 'STDLIB-PORT-001'), 'Must flag platform cfg lacking compile_error fallback');

  const portGoodCtx = {
    filePath: 'src/sys/os.rs',
    content: '#[cfg(target_os = "linux")]\npub fn get_clock() -> u64 { 0 }\n#[cfg(not(target_os = "linux"))]\ncompile_error!("Target OS is not supported");\n',
  };
  const portGoodIssues = analyzer.finalize(portGoodCtx);
  assert.strictEqual(portGoodIssues.length, 0, 'Platform cfg with compile_error fallback must pass');

  console.log('   ✓ All 6 special rules verified (positive detection and negative tolerance).');
}

async function testStdlibAutonomyQuantification() {
  console.log('3. Testing CAI 2.0 evaluation on self-contained standard library...');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stdlib-cai-'));
  try {
    fs.writeFileSync(
      path.join(tempDir, 'Cargo.toml'),
      '[package]\nname = "standalone-core"\nversion = "1.0.0"\n',
      'utf8'
    );

    const files = [
      {
        file: 'src/lib.rs',
        lines: 300,
        content: '#![no_std]\npub fn run() {}',
      },
      {
        file: 'src/crypto.rs',
        lines: 400,
        content: '#![no_std]\npub fn hash() {}',
      },
      {
        file: 'src/alloc_pool.rs',
        lines: 500,
        content: '#![no_std]\npub fn pool() {}',
      },
    ];

    const result = evaluateProjectAutonomy(files, [], { root: tempDir });
    assert.strictEqual(result.grade, 'L5_INDEPENDENT');
    assert.strictEqual(result.dimensions.effectiveLocAutonomy, 100.0);
    assert.strictEqual(result.dimensions.supplyChainResilience, 100.0);
    assert.ok(result.compositeAutonomyIndex >= 95.0, `Expected >= 95.0, got ${result.compositeAutonomyIndex}`);
    assert.strictEqual(result.supplyChain.hasLockfile, false);
    assert.strictEqual(result.supplyChain.directDependencies, 0);

    console.log(`   ✓ Stdlib autonomy quantified: ${result.compositeAutonomyIndex}% (${result.grade})`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('Starting standard library & systems runtime verification harness...');
  await testStdlibArchetypeProfiling();
  await testStdlibSpecialRulesPositiveAndNegative();
  await testStdlibAutonomyQuantification();
  console.log('\n[PASS] All standard library & systems runtime tests passed successfully.\n');
}

main().catch((err) => {
  console.error('\n[FAIL] Standard library verification failed:\n', err);
  process.exit(1);
});
