/**
 * Module: Test Pipeline — Agent-Actionable Diagnostic Contract Verification
 * File Path: scripts/validate-agent-actionable.js
 * Architecture Role: Regression gate ensuring all primary analyzers output
 *     well-structured AgentActionablePayload metadata to eliminate prose guesswork
 *     for LLM Agents and automated tools.
 * Dependencies & Triggers: Consumes compiled ConstantsAnalyzer and StdlibAnalyzer from dist/;
 *     invoked during npm test.
 * Responsibilities: Verify that Issue findings carry valid actionable fields (action, code,
 *     targetSymbol, safeToAutomate) matching expected schemas.
 * Exit Semantics & Design Rationale: Process exits 0 if all assertions pass, 1 on failure.
 */

const assert = require('assert');
const { scan } = require('../dist/api');
const { StdlibAnalyzer } = require('../dist/analyzers/stdlib');

async function main() {
  console.log('--- Checking Agent-Actionable Diagnostic Contracts ---');

  // 1. Test scan emitting actionable for constants in real code

  const report = await scan({
    files: ['src/core/types.ts'],
    config: {
      analyzers: {
        constants: true,
        complexity: false,
        simplify: false,
        comments: false,
        docs: false,
        stdlib: false,
        rules: false,
        'large-file': false,
        'dependency-graph': false,
      },
    },
  });

  const magicIssue = report.issues.find((i) => i.rule === 'magic-number' && i.actionable);
  assert.ok(magicIssue, 'Must find magic-number issue with actionable payload');
  assert.strictEqual(magicIssue.actionable.action, 'extract_constant');
  assert.strictEqual(magicIssue.actionable.code, 'AR:CONST:002');
  assert.strictEqual(magicIssue.actionable.targetScope, 'module_top_level');
  assert.strictEqual(typeof magicIssue.actionable.targetSymbol, 'string');
  assert.strictEqual(magicIssue.actionable.safeToAutomate, true);
  assert.ok(magicIssue.actionable.patch, 'Must provide patch range');
  console.log('✔ [PASS] ConstantsAnalyzer emits actionable payload for magic numbers');

  const stringIssue = report.issues.find((i) => i.rule === 'hardcoded-string' && i.actionable);
  assert.ok(stringIssue, 'Must find hardcoded-string issue with actionable payload');
  assert.strictEqual(stringIssue.actionable.action, 'extract_constant');
  assert.strictEqual(stringIssue.actionable.code, 'AR:CONST:001');
  assert.strictEqual(stringIssue.actionable.targetScope, 'module_top_level');
  assert.strictEqual(stringIssue.actionable.safeToAutomate, true);
  console.log('✔ [PASS] ConstantsAnalyzer emits actionable payload for hardcoded strings');

  // 2. Test StdlibAnalyzer outputting actionable for panic and unsafe
  const stdlibAnalyzer = new StdlibAnalyzer();
  const rustCode = `
pub fn dangerous_call() {
    panic!("fatal escape");
}
`;

  const stdlibIssues = stdlibAnalyzer.finalize({
    filePath: 'src/lib.rs',
    content: rustCode,
    options: {},
  });

  const panicIssue = stdlibIssues.find((i) => i.rule === 'STDLIB-PANIC-001');
  assert.ok(panicIssue, 'Must find STDLIB-PANIC-001 issue');
  assert.ok(panicIssue.actionable, 'STDLIB panic issue must carry actionable payload');
  assert.strictEqual(panicIssue.actionable.action, 'replace_token');
  assert.strictEqual(panicIssue.actionable.code, 'AR:STB:001');
  assert.strictEqual(panicIssue.actionable.safeToAutomate, false);
  console.log('✔ [PASS] StdlibAnalyzer emits actionable payload for panic escaping');

  // 3. Test TsModernAnalyzer outputting actionable
  const { TsModernAnalyzer } = require('../dist/analyzers/ts-modern');
  const tsModernAnalyzer = new TsModernAnalyzer();
  const tsCode = `
var legacyBinding = 42;
`;
  const tsmIssues = tsModernAnalyzer.finalize({
    filePath: 'src/sample.ts',
    content: tsCode,
    options: {},
  });
  const varIssue = tsmIssues.find((i) => i.rule === 'TSM-VAR-001');
  assert.ok(varIssue, 'Must find TSM-VAR-001 issue');
  assert.ok(varIssue.actionable, 'TSM-VAR-001 must carry actionable payload');
  assert.strictEqual(varIssue.actionable.action, 'replace_token');
  assert.strictEqual(varIssue.actionable.code, 'AR:TSM:001');
  console.log('✔ [PASS] TsModernAnalyzer emits actionable payload for var statements');

  // 4. Test SimplifyAnalyzer outputting actionable
  const { SimplifyAnalyzer } = require('../dist/analyzers/simplify');
  const simplifyAnalyzer = new SimplifyAnalyzer();
  const commentedCode = `
// function oldUnusedCode() {
//     const a = 1;
//     return a + 2;
// }
`;
  const simIssues = simplifyAnalyzer.analyze(null, {
    filePath: 'src/sample.ts',
    content: commentedCode,
    options: {},
  });
  const comcIssue = simIssues.find((i) => i.rule === 'SIM-COMC-001');
  assert.ok(comcIssue, 'Must find SIM-COMC-001 issue');
  assert.ok(comcIssue.actionable, 'SIM-COMC-001 must carry actionable payload');
  assert.strictEqual(comcIssue.actionable.action, 'replace_token');
  assert.strictEqual(comcIssue.actionable.code, 'AR:SIM:003');
  console.log('✔ [PASS] SimplifyAnalyzer emits actionable payload for commented code');

  console.log('✔ [PASS] All Agent-Actionable diagnostic contracts verified successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
