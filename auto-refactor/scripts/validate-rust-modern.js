/**
 * Module: Verification Harness — Rust Modernization Rules
 * File Path: scripts/validate-rust-modern.js
 * Architecture Role: Regression and behavioral verification suite for Rust modernization
 *     analyzer
 * Dependencies & Triggers: `node scripts/validate-rust-modern.js`;
 *     imports ../dist/analyzers/rust-modern
 * Responsibilities: Assert positive and negative firing for all 11 RSM rules,
 *     multiline format/signature scans, struct/body boundary defenses, and raw string
 *     false positive immunity
 * Exit Semantics & Design Rationale: Deterministic in-memory assertion harness; exits 0
 *     on full pass, fails loudly with non-zero code on any semantic mismatch.
 */
'use strict';

const assert = require('assert');
const { RustModernAnalyzer } = require('../dist/analyzers/rust-modern');

const analyzer = new RustModernAnalyzer();

/**
 * Helper to analyze a Rust source snippet and return rule IDs found.
 *
 * @param content - Rust source content.
 * @returns Rule IDs emitted.
 */
function analyzeSnippet(content) {
  const issues = analyzer.analyze(null, {
    filePath: 'test_fixture.rs',
    content,
  });
  return issues.map((i) => i.rule);
}

/**
 * Helper to analyze a Rust snippet and return full issue objects.
 *
 * @param content - Rust source content.
 * @returns Full issue objects.
 */
function analyzeIssues(content) {
  return analyzer.analyze(null, {
    filePath: 'test_fixture.rs',
    content,
  });
}

function testOriginalSevenRules() {
  const source = [
    'extern crate serde;',
    '#[macro_use]',
    'mod macros;',
    'fn parse(input: &String) -> Result<u32, Error> {',
    '    let value = try!(input.trim().parse::<u32>());',
    '    let cached = cache.get(key).unwrap();',
    '    if a.clone() == b {',
    '        println!("{}", value);',
    '    }',
    '    Ok(value)',
    '}',
  ].join('\n');

  const rules = analyzeSnippet(source);
  const expected = [
    'RSM-EXTERN-001',
    'RSM-MACRO-001',
    'RSM-STR-001',
    'RSM-TRY-001',
    'RSM-UNWRAP-001',
    'RSM-CLONE-001',
    'RSM-FORMAT-001',
  ];

  const ruleSet = new Set(rules);
  for (const exp of expected) {
    assert.ok(
      ruleSet.has(exp),
      `Expected rule ${exp} to be emitted, got: ${JSON.stringify(rules)}`,
    );
  }
  assert.strictEqual(
    rules.length,
    expected.length,
    `Expected exactly 7 rules, got ${rules.length}`,
  );
  console.log('  [PASS] 1. Original 7 rules detected precisely on canonical snippet');
}

function testMultilineFormatMacro() {
  const multilinePos = [
    'fn log_message(val: i32) {',
    '    println!(',
    '        "hello {}",',
    '        val',
    '    );',
    '    format!(',
    '        "val = {}",',
    '        val',
    '    );',
    '}',
  ].join('\n');

  const issues = analyzeIssues(multilinePos);
  const formatIssues = issues.filter((i) => i.rule === 'RSM-FORMAT-001');
  assert.strictEqual(
    formatIssues.length,
    2,
    `Expected 2 multiline RSM-FORMAT-001 issues, got ${formatIssues.length}`,
  );
  assert.strictEqual(
    formatIssues[0].location.start.line,
    2,
    'First format issue should anchor on line 2 (println!)',
  );
  assert.strictEqual(
    formatIssues[1].location.start.line,
    6,
    'Second format issue should anchor on line 6 (format!)',
  );

  const multilineModern = [
    'fn log_modern(val: i32) {',
    '    println!(',
    '        "hello {val}",',
    '    );',
    '}',
  ].join('\n');

  const modernRules = analyzeSnippet(multilineModern);
  assert.ok(
    !modernRules.includes('RSM-FORMAT-001'),
    'Modern inline format should not trigger RSM-FORMAT-001',
  );
  console.log(
    '  [PASS] 2. Multiline formatting macros correctly identified and inline captures stay silent',
  );
}

function testMultilineSignatureAndBoundaryDefense() {
  const multilineFn = [
    'fn calculate_checksum(',
    '    prefix: u32,',
    '    data: &String,',
    ') -> u64 {',
    '    42',
    '}',
  ].join('\n');

  const fnIssues = analyzeIssues(multilineFn);
  const strIssues = fnIssues.filter((i) => i.rule === 'RSM-STR-001');
  assert.strictEqual(
    strIssues.length,
    1,
    `Expected 1 RSM-STR-001 issue in multiline fn, got ${strIssues.length}`,
  );
  assert.strictEqual(
    strIssues[0].location.start.line,
    3,
    'Issue should anchor on line 3 where &String is declared',
  );

  const boundaryDefenses = [
    "struct UserRecord<'a> {",
    "    name: &'a String,",
    '    tag: &String,',
    '}',
    'fn compute() -> &String {',
    '    let local: &String = &DATA;',
    '    local',
    '}',
  ].join('\n');

  const boundaryRules = analyzeSnippet(boundaryDefenses);
  assert.ok(
    !boundaryRules.includes('RSM-STR-001'),
    `Struct fields and local let bindings must not trigger RSM-STR-001, got: ${JSON.stringify(boundaryRules)}`,
  );
  console.log(
    '  [PASS] 3. Multiline fn signatures trigger RSM-STR-001 while struct fields & locals stay silent',
  );
}

function testNewRules() {
  // ① RSM-CAST-001
  const castPos = [
    'fn convert(n: u64) {',
    '    let a = n as u8;',
    '    let b = n as usize;',
    '    let c = n as i32;',
    '}',
  ].join('\n');
  const castRules = analyzeSnippet(castPos);
  const castCount = castRules.filter((r) => r === 'RSM-CAST-001').length;
  assert.strictEqual(castCount, 3, `Expected 3 RSM-CAST-001 findings, got ${castCount}`);

  // ② RSM-ELSE-001
  const elsePos = [
    'fn test_let_else(opt: Option<u32>) -> u32 {',
    '    if let Some(x) = opt {',
    '        x + 1',
    '    } else {',
    '        return 0;',
    '    }',
    '}',
    'fn loop_break(opt: Option<u32>) {',
    '    loop {',
    '        if let Some(x) = opt {',
    '            println!("{x}");',
    '        } else {',
    '            break;',
    '        }',
    '    }',
    '}',
  ].join('\n');
  const elseRules = analyzeSnippet(elsePos);
  const elseCount = elseRules.filter((r) => r === 'RSM-ELSE-001').length;
  assert.strictEqual(elseCount, 2, `Expected 2 RSM-ELSE-001 findings, got ${elseCount}`);

  const elseNeg = [
    'fn normal_fallback(opt: Option<u32>) -> u32 {',
    '    if let Some(x) = opt {',
    '        x',
    '    } else {',
    '        calculate_default()',
    '    }',
    '}',
  ].join('\n');
  assert.ok(
    !analyzeSnippet(elseNeg).includes('RSM-ELSE-001'),
    'Non-early-exit else must not trigger RSM-ELSE-001',
  );

  // ③ RSM-FIND-001
  const findPos = [
    'fn search(items: &[Item], target: u32) -> Option<&Item> {',
    '    for item in items {',
    '        if item.id == target {',
    '            return Some(item);',
    '        }',
    '    }',
    '    None',
    '}',
  ].join('\n');
  const findRules = analyzeSnippet(findPos);
  assert.ok(
    findRules.includes('RSM-FIND-001'),
    'Manual loop search with immediate return must trigger RSM-FIND-001',
  );

  const findNeg = [
    'fn sum_all(items: &[u32]) -> u32 {',
    '    let mut total = 0;',
    '    for item in items {',
    '        total += item;',
    '    }',
    '    total',
    '}',
  ].join('\n');
  assert.ok(
    !analyzeSnippet(findNeg).includes('RSM-FIND-001'),
    'General for loop without if-return must stay silent',
  );

  // ④ RSM-LOCK-001
  const lockPos = [
    'async fn handle_request(state: Arc<Mutex<State>>) {',
    '    let guard = state.lock().unwrap();',
    '    remote_fetch().await;',
    '}',
  ].join('\n');
  const lockRules = analyzeSnippet(lockPos);
  assert.ok(
    lockRules.includes('RSM-LOCK-001'),
    'std lock held across await must trigger RSM-LOCK-001',
  );

  const lockNegSync = [
    'fn sync_handle(state: Arc<Mutex<State>>) {',
    '    let guard = state.lock().unwrap();',
    '}',
  ].join('\n');
  assert.ok(
    !analyzeSnippet(lockNegSync).includes('RSM-LOCK-001'),
    'Synchronous fn must not trigger RSM-LOCK-001',
  );

  const lockNegTokio = [
    'async fn tokio_handle(state: Arc<tokio::sync::Mutex<State>>) {',
    '    let guard = state.lock().await;',
    '    remote_fetch().await;',
    '}',
  ].join('\n');
  assert.ok(
    !analyzeSnippet(lockNegTokio).includes('RSM-LOCK-001'),
    'Tokio async mutex must not trigger RSM-LOCK-001',
  );

  console.log(
    '  [PASS] 4. All 4 new rules (RSM-CAST-001, RSM-ELSE-001, RSM-FIND-001, RSM-LOCK-001) verified',
  );
}

function testRawStringFalsePositiveImmunity() {
  const rawStringFixture = [
    'fn compile_docs() {',
    '    let rust_code = r#"',
    '        extern crate bad;',
    '        #[macro_use]',
    '        fn bad_sig(s: &String) {}',
    '        println!("{}", 123);',
    '        if let Some(x) = opt { return; }',
    '        let x = y as u8;',
    '        for item in iter { if item == 1 { return true; } }',
    '        let g = lock.lock().unwrap();',
    '        await;',
    '    "#;',
    '}',
  ].join('\n');

  const rules = analyzeSnippet(rawStringFixture);
  assert.deepStrictEqual(
    rules,
    [],
    `Code patterns inside raw string literals must not emit findings, got: ${JSON.stringify(rules)}`,
  );
  console.log('  [PASS] 5. Raw string false positive immunity verified (0 false positives)');
}

function runAll() {
  testOriginalSevenRules();
  testMultilineFormatMacro();
  testMultilineSignatureAndBoundaryDefense();
  testNewRules();
  testRawStringFalsePositiveImmunity();
  console.log('\n ALL RUST MODERN ANALYZER CHECKS PASSED SUCCESSFULLY!');
}

try {
  runAll();
} catch (err) {
  console.error('\n[FAIL]', err);
  process.exit(1);
}
