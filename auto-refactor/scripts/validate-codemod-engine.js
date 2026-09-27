/**
 * Module: Test Pipeline — Codemod Engine and Repair Transformation Validation
 * File Path: scripts/validate-codemod-engine.js
 * Architecture Role: Verifies line-ending preservation, coordinate-to-offset mapping,
 *   atomic text edit resolution, conflict filtering, and built-in AST transforms.
 * Dependencies & Triggers: Node assert; executed as test suite in scripts/test-parallel.js.
 * Responsibilities:
 *   1. Verify FormatPreserver line ending detection and block indentation.
 *   2. Verify TextEditApplier coordinate mapping, reverse application, and overlap omission.
 *   3. Verify built-in transforms: extract-constant, unused-imports,
 *      modern-construct, jsdoc-template.
 *   4. Verify PatchEngine unified diff generation, dry-run safety, and rule filtering.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on failure.
 */

'use strict';

const assert = require('assert');
const {
  FormatPreserver,
  TextEditApplier,
  PatchEngine,
  createExtractConstantFix,
  createUnusedImportFix,
  createSimplifyBooleanFix,
  createJsDocTemplateFix,
} = require('../dist/core/codemod');

function testFormatPreserver() {
  console.log('1. Testing FormatPreserver...');

  const lfText = 'line1\nline2\nline3\n';
  const crlfText = 'line1\r\nline2\r\nline3\r\n';

  assert.strictEqual(FormatPreserver.detectLineEnding(lfText), '\n');
  assert.strictEqual(FormatPreserver.detectLineEnding(crlfText), '\r\n');

  const normalized = FormatPreserver.normalizeLineEndings('a\r\nb\nc', '\n');
  assert.strictEqual(normalized, 'a\nb\nc');

  const indented = FormatPreserver.indentBlock('foo\nbar\nbaz', '    ', '\n');
  assert.strictEqual(indented, 'foo\n    bar\n    baz');

  assert.strictEqual(FormatPreserver.getLineIndentation('    const x = 1;'), '    ');
  assert.strictEqual(FormatPreserver.getLineIndentation('\t\tfunction f() {}'), '\t\t');
  assert.strictEqual(FormatPreserver.getLineIndentation('noIndent();'), '');

  console.log('  ✔ [PASS] FormatPreserver line ending & indentation verified.');
}

function testTextEditApplier() {
  console.log('2. Testing TextEditApplier Coordinate Mapping & Transactions...');

  const source = 'function test() {\n    const a = 10;\n    return a;\n}\n';
  const lineOffsets = TextEditApplier.buildLineOffsets(source);

  // Line 2: "    const a = 10;\n"
  // startCol 15 is the number '1' in '10', endCol 17 is after '0'
  const offset10Start = TextEditApplier.coordinateToOffset(lineOffsets, 2, 15, source.length);
  const offset10End = TextEditApplier.coordinateToOffset(lineOffsets, 2, 17, source.length);
  assert.strictEqual(source.slice(offset10Start, offset10End), '10');

  // Single edit: replace '10' with 'DEFAULT_MAX'
  const singleEditResult = TextEditApplier.applyEdits(source, [
    { startLine: 2, startCol: 15, endLine: 2, endCol: 17, newText: 'DEFAULT_MAX' },
  ]);
  assert.strictEqual(singleEditResult.appliedCount, 1);
  assert.strictEqual(singleEditResult.skippedCount, 0);
  assert.ok(singleEditResult.content.includes('const a = DEFAULT_MAX;'));

  // Conflict resolution: overlapping edits must drop the second edit safely
  const conflictEdits = [
    { startLine: 2, startCol: 5, endLine: 2, endCol: 17, newText: 'const b = 20;' },
    { startLine: 2, startCol: 11, endLine: 2, endCol: 13, newText: 'c' },
  ];
  const conflictResult = TextEditApplier.applyEdits(source, conflictEdits);
  assert.strictEqual(conflictResult.appliedCount, 1);
  assert.strictEqual(conflictResult.skippedCount, 1);
  assert.ok(conflictResult.content.includes('const b = 20;'));

  console.log('  ✔ [PASS] TextEditApplier coordinate offsets & conflict safety verified.');
}

function testBuiltinTransforms() {
  console.log('3. Testing Built-in Codemod Transforms...');

  const sampleSource =
    "import { used, unused } from './dep';\n\nfunction calculate() {\n    return 42;\n}\n";
  const context = PatchEngine.createContext('sample.ts', sampleSource);

  // 1. Unused import transform
  const unusedImportFix = createUnusedImportFix(context, {
    line: 1,
    unusedSymbol: 'unused',
  });
  assert.strictEqual(unusedImportFix.ruleId, 'HYG-DED-001');
  assert.strictEqual(unusedImportFix.safetyLevel, 'guaranteed');

  // 2. Extract constant transform
  const extractConstFix = createExtractConstantFix(context, {
    line: 4,
    startCol: 12,
    endCol: 14,
    literalValue: '42',
    suggestedName: 'MAGIC_ANSWER',
  });
  assert.strictEqual(extractConstFix.ruleId, 'magic-number');
  assert.strictEqual(extractConstFix.edits.length, 2);

  // 3. Simplify boolean transform
  const boolFix = createSimplifyBooleanFix(context, {
    line: 4,
    startCol: 12,
    endCol: 24,
    replacementText: 'isReady',
  });
  assert.strictEqual(boolFix.ruleId, 'SIM-BOOL-001');
  assert.strictEqual(boolFix.edits[0].newText, 'isReady');

  // 4. JSDoc template transform
  const jsdocFix = createJsDocTemplateFix(context, {
    line: 3,
    summary: 'Calculates the primary domain metric.',
    params: [],
    returns: 'Computed metric integer.',
    concurrency: 'Single-thread async cooperative execution',
  });
  assert.strictEqual(jsdocFix.ruleId, 'CMT-DOC-001');
  assert.ok(jsdocFix.edits[0].newText.includes('/**'));
  assert.ok(jsdocFix.edits[0].newText.includes('Calculates the primary domain metric.'));
  assert.ok(
    jsdocFix.edits[0].newText.includes('Concurrency: Single-thread async cooperative execution.'),
  );

  console.log('  ✔ [PASS] Built-in AST transforms output compliant descriptors.');
}

function testPatchEngine() {
  console.log('4. Testing PatchEngine Diff Generation & Dry-Run...');

  const engine = new PatchEngine();
  const source = 'line 1\nline 2\nline 3\n';
  const diff = engine.generateUnifiedDiff('test.ts', source, 'line 1\nline modified\nline 3\n');

  assert.ok(diff.includes('--- a/test.ts'));
  assert.ok(diff.includes('+++ b/test.ts'));
  assert.ok(diff.includes('-line 2'));
  assert.ok(diff.includes('+line modified'));

  const context = PatchEngine.createContext('test.ts', source);
  const fix = createExtractConstantFix(context, {
    line: 2,
    startCol: 6,
    endCol: 7,
    literalValue: '2',
    suggestedName: 'TWO',
  });

  // Dry run must produce patch diff without disk mutation
  const result = engine.applyFixes('test.ts', source, [fix], { dryRun: true });
  assert.strictEqual(result.appliedFixCount, 2);
  assert.strictEqual(result.skippedConflictCount, 0);
  assert.ok(result.unifiedDiff.length > 0);
  assert.ok(result.patchedContent.includes('const TWO = 2;'));

  // Filtering by rule whitelist
  const filteredResult = engine.applyFixes('test.ts', source, [fix], {
    dryRun: true,
    rules: ['OTHER-RULE'],
  });
  assert.strictEqual(filteredResult.appliedFixCount, 0);
  assert.strictEqual(filteredResult.unifiedDiff, '');

  console.log('  ✔ [PASS] PatchEngine diff formatting, dry-run, and whitelist filtering verified.');
}

function runAll() {
  console.log('--- Running Codemod Engine Validation Suite ---');
  testFormatPreserver();
  testTextEditApplier();
  testBuiltinTransforms();
  testPatchEngine();
  console.log('✔ All Codemod engine tests passed successfully.');
}

runAll();
