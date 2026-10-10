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

  // 5. Test RustModernAnalyzer outputting actionable and templateSnippet
  const { RustModernAnalyzer } = require('../dist/analyzers/rust-modern');
  const rustAnalyzer = new RustModernAnalyzer();
  const rustTryCode = `
pub fn do_work() -> Result<(), String> {
    try!(inner());
    Ok(())
}
`;
  const rsmIssues = rustAnalyzer.finalize({
    filePath: 'src/sample.rs',
    content: rustTryCode,
    options: {},
  });
  const tryIssue = rsmIssues.find((i) => i.rule === 'RSM-TRY-001');
  assert.ok(tryIssue, 'Must find RSM-TRY-001 issue');
  assert.ok(tryIssue.actionable, 'RSM-TRY-001 must carry actionable payload');
  assert.strictEqual(tryIssue.actionable.action, 'replace_token');
  assert.strictEqual(tryIssue.actionable.code, 'AR:RSM:001');
  assert.strictEqual(tryIssue.actionable.templateSnippet, '$1?');
  console.log('✔ [PASS] RustModernAnalyzer emits actionable payload and templateSnippet for try! macro');

  // 6. Test PythonModernAnalyzer outputting actionable and templateSnippet
  const { PythonModernAnalyzer } = require('../dist/analyzers/python-modern');
  const pyAnalyzer = new PythonModernAnalyzer();
  const pyCode = `
import os
def get_path():
    return os.path.join("a", "b")
`;
  const pyIssues = pyAnalyzer.finalize({
    filePath: 'src/sample.py',
    content: pyCode,
    options: {},
  });
  const pathIssue = pyIssues.find((i) => i.rule === 'PYM-PATH-001');
  assert.ok(pathIssue, 'Must find PYM-PATH-001 issue');
  assert.ok(pathIssue.actionable, 'PYM-PATH-001 must carry actionable payload');
  assert.strictEqual(pathIssue.actionable.action, 'replace_token');
  assert.strictEqual(pathIssue.actionable.code, 'AR:PYM:001');
  assert.ok(pathIssue.actionable.templateSnippet, 'Must provide templateSnippet for PYM-PATH-001');
  console.log('✔ [PASS] PythonModernAnalyzer emits actionable payload and templateSnippet for os.path');

  // 7. Test ArchitectureAnalyzer outputting actionable and templateSnippet
  const { ArchitectureAnalyzer } = require('../dist/analyzers/architecture');
  const archAnalyzer = new ArchitectureAnalyzer();
  const facadeCode = `
export * from './internal-sub';
`;
  const archIssues = archAnalyzer.analyze(null, {
    filePath: 'src/facade.ts',
    content: facadeCode,
    options: {},
    config: {},
  });
  const archFacIssue = archIssues.find((i) => i.rule === 'ARCH-FAC-001' || i.rule === 'facade-without-payload');
  assert.ok(archFacIssue, 'Must find facade issue');
  assert.ok(archFacIssue.actionable, 'Architecture issue must carry actionable payload');
  assert.strictEqual(archFacIssue.actionable.code, 'AR:ARC:001');
  assert.ok(archFacIssue.actionable.templateSnippet, 'Must provide templateSnippet for ARCH-FAC-001');
  console.log('✔ [PASS] ArchitectureAnalyzer emits actionable payload and templateSnippet for facade rules');

  // 8. Test PerformanceAnalyzer outputting actionable and templateSnippet
  const { PerformanceAnalyzer } = require('../dist/analyzers/performance');
  const perfAnalyzer = new PerformanceAnalyzer();
  const perfCode = `
function processBatch(items: string[]) {
    for (const item of items) {
        const temp = new Array(100);
    }
}
`;
  const perfIssues = perfAnalyzer.analyze(null, {
    filePath: 'src/batch.ts',
    content: perfCode,
    options: {},
  });
  const loopAllocIssue = perfIssues.find((i) => i.rule === 'loop-transient-allocation' || i.rule === 'PRF-MEM-001');
  assert.ok(loopAllocIssue, 'Must find loop allocation issue');
  assert.ok(loopAllocIssue.actionable, 'Performance issue must carry actionable payload');
  assert.strictEqual(loopAllocIssue.actionable.code, 'AR:PRF:001');
  assert.ok(loopAllocIssue.actionable.templateSnippet, 'Must provide templateSnippet for loop transient allocation');
  console.log('✔ [PASS] PerformanceAnalyzer emits actionable payload and templateSnippet for loop allocation');

  // 9. Test ShellLintAnalyzer outputting actionable and templateSnippet
  const { ShellLintAnalyzer } = require('../dist/analyzers/shell-lint');
  const shellAnalyzer = new ShellLintAnalyzer();
  const shCode = `#!/bin/bash
echo $UNQUOTED_VAR
`;
  const shIssues = shellAnalyzer.finalize({
    filePath: 'scripts/run.sh',
    content: shCode,
    options: {},
  });
  const quoteIssue = shIssues.find((i) => i.rule === 'SH-QUOTE-001');
  assert.ok(quoteIssue, 'Must find SH-QUOTE-001 issue');
  assert.ok(quoteIssue.actionable, 'Shell issue must carry actionable payload');
  assert.strictEqual(quoteIssue.actionable.code, 'AR:SHL:002');
  assert.strictEqual(quoteIssue.actionable.templateSnippet, '"$VAR"');
  console.log('✔ [PASS] ShellLintAnalyzer emits actionable payload and templateSnippet for unquoted variables');

  console.log('✔ [PASS] All Agent-Actionable diagnostic contracts verified successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

