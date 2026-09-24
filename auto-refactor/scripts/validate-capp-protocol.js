/**
 * Module: Verification Harness — Compact Agent Prompt Protocol (CAPP) & Slice Audit
 * File Path: scripts/validate-capp-protocol.js
 * Architecture Role: Verifies the Compact Agent Prompt Protocol contract and the
 *   auditAgentSlice localized governance pipeline.
 * Dependencies & Triggers: Consumes ../dist/api; executed in CI / test-parallel.
 * Responsibilities:
 *   1. Assert formatCompactGuardDirective conforms to [GUARD|<SEV>|<RULE>] <FILE>:<LINE>;
 *   2. Assert formatCompactAgentPrompt token compression ratio exceeds 70%;
 *   3. Assert defaultPraxisSliceAuditService.auditAgentSlice returns a valid CompactAgentPrompt.
 * Exit Semantics & Design Rationale: Exits 0 on success, throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const {
  formatCompactGuardDirective,
  formatCompactAgentPrompt,
  defaultPraxisSliceAuditService,
} = require('../dist/api');

async function testDirectiveFormatting() {
  console.log('1. Testing formatCompactGuardDirective...');
  const mockIssue = {
    id: 'perf:PRF-IO-001:src/core/cache.ts:243',
    analyzer: 'performance',
    rule: 'PRF-IO-001',
    severity: 'error',
    message: "Synchronous 'fs.readFileSync' blocks event loop.",
    location: {
      file: 'src/core/cache.ts',
      start: { line: 243, column: 15 },
      end: { line: 243, column: 35 },
    },
    suggestion: "await fs.promises.readFile(path, 'utf8')",
  };

  const directive = formatCompactGuardDirective(mockIssue);
  assert.strictEqual(directive.severity, 'BLOCK');
  assert.strictEqual(directive.ruleId, 'PRF-IO-001');
  assert.strictEqual(directive.file, 'cache.ts');
  assert.strictEqual(directive.line, 243);
  assert.strictEqual(
    directive.renderedDirective,
    "[GUARD|BLOCK|PRF-IO-001] cache.ts:243 -> Synchronous 'fs.readFileSync' blocks event loop.. Fix: await fs.promises.readFile(path, 'utf8')",
  );
  console.log('  ✔ formatCompactGuardDirective correctly formats actionable single-line directive');
}

async function testPromptSynthesis() {
  console.log('\n2. Testing formatCompactAgentPrompt...');
  const issues = [
    {
      id: 'i1',
      analyzer: 'performance',
      rule: 'PRF-IO-001',
      severity: 'error',
      message: 'Sync IO in async method',
      location: { file: 'src/core/cache.ts', start: { line: 243, column: 1 } },
      suggestion: 'Use await readFile',
    },
    {
      id: 'i2',
      analyzer: 'governance',
      rule: 'GOV-TYP-006',
      severity: 'warning',
      message: 'Missing return type on exported function',
      location: { file: 'src/core/cache.ts', start: { line: 240, column: 1 } },
      suggestion: 'Add : Promise<void>',
    },
  ];

  const prompt = formatCompactAgentPrompt('src/core/cache.ts#L240-245', issues);
  assert.strictEqual(prompt.protocolVersion, '1.0');
  assert.strictEqual(prompt.verdict, 'BLOCK');
  assert.strictEqual(prompt.directives.length, 2);
  assert.ok(
    prompt.tokenSavingsRatio >= 0.7,
    `Expected token savings >= 0.70, got ${prompt.tokenSavingsRatio}`,
  );
  assert.ok(prompt.compactPromptText.includes('[CAPP:v1.0] src/core/cache.ts#L240-245 -> BLOCK'));
  console.log(
    `  ✔ formatCompactAgentPrompt achieved ${Math.round(prompt.tokenSavingsRatio * 100)}% token savings`,
  );

  // Test empty issues
  const clearPrompt = formatCompactAgentPrompt('src/core/cache.ts#L240-245', []);
  assert.strictEqual(clearPrompt.verdict, 'PASS');
  assert.strictEqual(clearPrompt.directives.length, 0);
  assert.ok(clearPrompt.compactPromptText.includes('(all clear)'));
  console.log('  ✔ formatCompactAgentPrompt correctly emits PASS on clear slice');
}

async function testSliceAuditIntegration() {
  console.log('\n3. Testing PraxisSliceAuditService.auditAgentSlice...');
  const oldCode = `export function compute(): number {
  return 42;
}`;
  const newCode = `export function compute(): number {
  const x = 42;
  return x;
}`;

  const verdict = await defaultPraxisSliceAuditService.auditAgentSlice({
    filePath: 'src/example.ts',
    oldContent: oldCode,
    newContent: newCode,
    changedLines: [2],
  });

  assert.strictEqual(verdict.protocolVersion, '1.0');
  assert.ok(verdict.verdict === 'PASS' || verdict.verdict === 'WARN');
  console.log(`  ✔ auditAgentSlice returned valid CAPP payload (verdict=${verdict.verdict})`);
}

async function main() {
  console.log('=== [CAPP] Validating Compact Agent Prompt Protocol ===\n');
  await testDirectiveFormatting();
  await testPromptSynthesis();
  await testSliceAuditIntegration();
  console.log('\n================================================================');
  console.log('🎉 ALL CAPP PROTOCOL VERIFICATION TESTS PASSED!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
