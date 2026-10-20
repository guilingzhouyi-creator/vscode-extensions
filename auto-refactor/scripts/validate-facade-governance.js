/**
 * Module: Validation — Facade & Trampoline Governance Verification
 * File Path: scripts/validate-facade-governance.js
 * Architecture Role: Verifies the integrity of vacuous trampoline blocking (ARCH-ABS-001),
 *   substantive facade payload enforcement (ARCH-FAC-001), cognitive cost hop penalties,
 *   and single-source-of-truth metadata registration across dictionaries and rule catalogs.
 * Dependencies & Triggers: Consumes built dist/ modules from core architecture, scoring, and rules.
 * Responsibilities: Run 8 strict assertion gates to prevent regression
 *   of facade governance invariants.
 * Exit Semantics & Design Rationale: Exits 0 on all gates passing, non-zero on assertion failure.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { auditFacadeGovernance, DEFAULT_MIN_FACADE_ELOC } = require(
  path.join(__dirname, '..', 'dist', 'core', 'architecture', 'facade-governance-evaluator.js'),
);

const { evaluateNetCognitiveCost } = require(
  path.join(__dirname, '..', 'dist', 'core', 'scoring', 'cognitive-cost-model.js'),
);

const { ArchitectureMessages } = require(
  path.join(__dirname, '..', 'dist', 'core', 'messages', 'architecture.js'),
);

console.log('=== Running Facade & Trampoline Governance Validation Pipeline (8 cases) ===');

// CASE-01: Vacuous trampoline file interception (ARCH-ABS-001)
{
  const trampolineCode = `/** Jump trampoline */\nexport * from './zh-cn/index';\n`;
  const result = auditFacadeGovernance('src/dictionaries/zh-cn.ts', trampolineCode);
  assert.strictEqual(
    result.trampolineCount,
    1,
    'CASE-01 Failed: Vacuous trampoline must be counted',
  );
  assert.strictEqual(result.issues.length, 1, 'CASE-01 Failed: Must emit exactly 1 issue');
  assert.strictEqual(
    result.issues[0].rule,
    'ARCH-ABS-001',
    'CASE-01 Failed: Rule must be ARCH-ABS-001',
  );
  assert.strictEqual(
    result.issues[0].severity,
    'error',
    'CASE-01 Failed: Trampoline severity must be error',
  );
  assert.ok(
    result.issues[0].message.toLowerCase().includes('vacuous forwarding trampoline') ||
      result.issues[0].message.includes('空包跳板'),
    'CASE-01 Failed: Message must identify vacuous trampoline',
  );
  console.log('  ✔ CASE-01: Vacuous trampoline file intercepted with ARCH-ABS-001');
}

// CASE-02: Substantive facade / aggregator passes cleanly
{
  const substantiveCode = `/**
 * Module: Substantive Chinese Dictionary Barrel
 */
import { ZH_CN_ARCHITECTURE_RULES } from './zh-cn/rules-architecture';
import { ZH_CN_GOVERNANCE_RULES } from './zh-cn/rules-governance';
import { ZH_CN_LANGUAGE_RULES } from './zh-cn/rules-languages';
import { ZH_CN_SECURITY_RULES } from './zh-cn/rules-security';

export { ZH_CN_COMMON } from './zh-cn/common';

export const ZH_CN_RULES = Object.freeze({
    ...ZH_CN_ARCHITECTURE_RULES,
    ...ZH_CN_LANGUAGE_RULES,
    ...ZH_CN_GOVERNANCE_RULES,
    ...ZH_CN_SECURITY_RULES,
});
`;
  const result = auditFacadeGovernance('src/dictionaries/zh-cn.ts', substantiveCode);
  assert.strictEqual(
    result.trampolineCount,
    0,
    'CASE-02 Failed: Substantive barrel must not be trampoline',
  );
  assert.strictEqual(
    result.hollowFacadeCount,
    0,
    'CASE-02 Failed: Substantive barrel must not be hollow facade',
  );
  assert.strictEqual(
    result.issues.length,
    0,
    'CASE-02 Failed: Substantive barrel must emit 0 issues',
  );
  console.log('  ✔ CASE-02: Substantive facade / barrel passes with 0 issues');
}

// CASE-03: Hollow facade detection (ARCH-FAC-001)
{
  const hollowFacadeCode = `
export class UserFacade {
    forward() { return true; }
}
`;
  const result = auditFacadeGovernance('src/facades/user-facade.ts', hollowFacadeCode, {
    minFacadeEloc: DEFAULT_MIN_FACADE_ELOC,
  });
  assert.strictEqual(result.hollowFacadeCount, 1, 'CASE-03 Failed: Hollow facade must be detected');
  assert.strictEqual(result.issues.length, 1, 'CASE-03 Failed: Must emit 1 hollow facade issue');
  assert.strictEqual(
    result.issues[0].rule,
    'ARCH-FAC-001',
    'CASE-03 Failed: Rule must be ARCH-FAC-001',
  );
  assert.strictEqual(
    result.issues[0].severity,
    'warning',
    'CASE-03 Failed: Hollow facade must be warning',
  );
  console.log('  ✔ CASE-03: Hollow facade detected with ARCH-FAC-001');
}

// CASE-04: Substantive facade with Object.freeze passes ELOC threshold exemption
{
  const frozenFacadeCode = `
export class DataFacade {
    static config = Object.freeze({ active: true });
}
`;
  const result = auditFacadeGovernance('src/facades/data-facade.ts', frozenFacadeCode, {
    minFacadeEloc: DEFAULT_MIN_FACADE_ELOC,
  });
  assert.strictEqual(
    result.hollowFacadeCount,
    0,
    'CASE-04 Failed: Frozen facade must be exempted from hollow check',
  );
  assert.strictEqual(result.issues.length, 0, 'CASE-04 Failed: Frozen facade must produce 0 issues');
  console.log('  ✔ CASE-04: Facade with immutability contracts exempted from hollow check');
}

// CASE-05: Test and fixture paths are strictly exempt
{
  const testTrampoline = `export * from './mock';\n`;
  const resultTest = auditFacadeGovernance('tests/fixtures/test-facade.ts', testTrampoline);
  assert.strictEqual(resultTest.issues.length, 0, 'CASE-05 Failed: Test files must be exempt');
  const resultSpec = auditFacadeGovernance('src/sub/facade.spec.ts', testTrampoline);
  assert.strictEqual(resultSpec.issues.length, 0, 'CASE-05 Failed: Spec files must be exempt');
  console.log('  ✔ CASE-05: Test and spec files exempt from facade governance');
}

// CASE-06: Cognitive cost model integration with file trampoline hop penalties
{
  const evalZero = evaluateNetCognitiveCost('src/sample.ts', [], 0, 0);
  assert.strictEqual(evalZero.hopPenalty, 0, 'CASE-06 Failed: Zero hops must yield 0 hopPenalty');

  const evalOneHop = evaluateNetCognitiveCost('src/sample.ts', [], 0, 1);
  assert.strictEqual(
    evalOneHop.hopPenalty,
    3.0,
    'CASE-06 Failed: 1 file trampoline hop must add 3.0 penalty',
  );

  const evalTwoHops = evaluateNetCognitiveCost('src/sample.ts', [], 0, 2);
  assert.strictEqual(
    evalTwoHops.hopPenalty,
    6.0,
    'CASE-06 Failed: 2 file trampoline hops must add 6.0 penalty',
  );
  console.log(
    '  ✔ CASE-06: Cognitive cost model integrates file trampoline hop penalty (3.0 units/hop)',
  );
}

// CASE-07: Message catalog descriptor completeness
{
  const trampolineMsg = ArchitectureMessages.VACUOUS_TRAMPOLINE_MODULE('test/a.ts', './b');
  assert.ok(
    trampolineMsg.message.toLowerCase().includes('vacuous forwarding trampoline'),
    'CASE-07 Failed: Message must identify vacuous forwarding trampoline',
  );
  assert.ok(trampolineMsg.suggestion.length > 0, 'CASE-07 Failed: Suggestion must not be empty');
  assert.ok(trampolineMsg.rationale.length > 0, 'CASE-07 Failed: Rationale must not be empty');

  const hollowMsg = ArchitectureMessages.HOLLOW_FACADE_PAYLOAD('test/facade.ts', 5, 15);
  assert.ok(
    hollowMsg.message.toLowerCase().includes('hollow facade module'),
    'CASE-07 Failed: Message must identify hollow facade module',
  );
  assert.ok(hollowMsg.suggestion.length > 0, 'CASE-07 Failed: Suggestion must not be empty');
  console.log('  ✔ CASE-07: ArchitectureMessages descriptors complete with actionable guidance');
}

// CASE-08: SSOT Rule Catalog and Built-in Rules metadata alignment
{
  const catalogPath = path.join(__dirname, '..', '..', 'scripts', 'common', 'rule-catalog.json');
  assert.ok(fs.existsSync(catalogPath), 'CASE-08 Failed: rule-catalog.json must exist');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const rules = Array.isArray(catalog.rules) ? catalog.rules : Object.values(catalog.rules || {});

  const hasAbs = rules.some((r) => r.id === 'ARCH-ABS-001');
  const hasFac = rules.some((r) => r.id === 'ARCH-FAC-001');

  assert.ok(hasAbs, 'CASE-08 Failed: ARCH-ABS-001 must be registered in rule-catalog.json');
  assert.ok(hasFac, 'CASE-08 Failed: ARCH-FAC-001 must be registered in rule-catalog.json');
  console.log('  ✔ CASE-08: SSOT rule-catalog.json registers ARCH-ABS-001 and ARCH-FAC-001');
}

console.log('\nAll 8 Facade & Trampoline Governance validation gates passed successfully.\n');
