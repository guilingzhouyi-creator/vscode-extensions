/**
 * Module: Verification Harness — Meta-Architecture Semantic Architecture & Meta Architecture Rules
 * File Path: scripts/validate-meta-architecture.js
 * Architecture Role: Validates the Semantic Architecture Graph, multi-signal system topology
 *   role inference, 6 meta-architecture rules, and Praxis Diff governance integration.
 * Dependencies & Triggers: Consumes ../dist/api; executed during test-parallel runner.
 * Responsibilities: Assert topology role inference, headless purity, clean layering,
 *   boundary encapsulation, configuration leakage, generalization leaks, self-repo protection,
 *   and Praxis merge gate.
 * Exit Semantics & Design Rationale: Exits 0 on full verification pass; throws AssertionError
 *   and exits 1 on any discrepancy, guaranteeing contract stability for the Praxis team.
 */

'use strict';

const assert = require('assert');
const {
  inferSystemTopologyRole,
  SemanticArchitectureGraph,
  defaultMetaArchitectureEvaluator,
  META_ARCH_RULES,
  defaultPraxisGovernanceService,
} = require('../dist/api');

async function main() {
  console.log('=== [Meta-Architecture] Testing Semantic Architecture Graph & Meta-Rules ===\n');

  // 1. Multi-signal System Topology Role Inference
  console.log('1. Testing Multi-signal Topology Role Inference...');
  const roles = [
    {
      file: 'src/domain/user.ts',
      imports: [],
      content: '// Pure domain model',
      expectedRole: 'headless_domain_core',
      expectedHeadless: true,
    },
    {
      file: 'src/custom/payment.ts',
      imports: [],
      content: '/**\n * @role headless_domain_core\n */\nexport class Payment {}',
      expectedRole: 'headless_domain_core',
      expectedHeadless: true,
    },
    {
      file: 'src/database/userRepo.ts',
      imports: ['@prisma/client'],
      content: '',
      expectedRole: 'data_layer',
      expectedHeadless: true,
    },
    {
      file: 'src/network/socketDriver.ts',
      imports: ['net'],
      content: '',
      expectedRole: 'infrastructure',
      expectedHeadless: true,
    },
    {
      file: 'src/parsers/oxcAdapter.ts',
      imports: ['@oxc-parser/core'],
      content: '',
      expectedRole: 'adapter',
      expectedHeadless: true,
    },
    {
      file: 'src/cli/runCmd.ts',
      imports: ['commander'],
      content: '',
      expectedRole: 'application_cli',
      expectedHeadless: false,
    },
    {
      file: 'src/utils/mathUtils.ts',
      imports: [],
      content: '',
      expectedRole: 'shared',
      expectedHeadless: true,
    },
    {
      file: 'src/config/thresholds.ts',
      imports: [],
      content: '',
      expectedRole: 'configuration',
      expectedHeadless: true,
    },
  ];

  for (const tc of roles) {
    const res = inferSystemTopologyRole(tc.file, tc.imports, [], tc.content);
    assert.strictEqual(
      res.role,
      tc.expectedRole,
      `Role for ${tc.file} must be ${tc.expectedRole}, got ${res.role}`,
    );
    assert.strictEqual(
      res.isHeadless,
      tc.expectedHeadless,
      `Headless for ${tc.file} must be ${tc.expectedHeadless}, got ${res.isHeadless}`,
    );
  }
  console.log('✔ All 8 topology roles correctly inferred without path-only hardcoding.');

  // 2. RULE-ARCH-HEADLESS (ARCH-HDL-001)
  console.log('\n2. Testing RULE-ARCH-HEADLESS (ARCH-HDL-001)...');
  const filesWithHeadlessViolation = [
    {
      filePath: 'src/billing/domain/taxCalculator.ts',
      imports: ['vscode', 'react'],
      exports: ['calculateTax'],
      content: '/** @role headless_domain_core */\nimport * as vscode from "vscode";',
    },
    {
      filePath: 'src/billing/domain/rates.ts',
      imports: [],
      exports: ['TAX_RATES'],
      content: '/** @role headless_domain_core */',
    },
  ];
  const headlessGraph = SemanticArchitectureGraph.fromFiles(filesWithHeadlessViolation);
  const headlessResult = defaultMetaArchitectureEvaluator.evaluate(headlessGraph);
  assert.strictEqual(headlessResult.passed, false, 'Must fail due to headless violations');
  const hdlIssues = headlessResult.issues.filter((i) => i.rule === META_ARCH_RULES.HEADLESS);
  assert.strictEqual(hdlIssues.length, 2, 'Must flag both vscode and react headless breaches');
  assert(
    hdlIssues[0].message.includes('Headless architecture violation'),
    'Message must state headless violation',
  );
  console.log('✔ Headless purity violation (ARCH-HDL-001) correctly identified.');

  // 3. RULE-ARCH-LAYER (clean-layer-violation / ARCH-DIR-001)
  console.log('\n3. Testing RULE-ARCH-LAYER Unidirectional Layering (clean-layer-violation)...');
  const layeringFiles = [
    {
      filePath: 'src/order/domain/orderEntity.ts',
      imports: ['src/order/infrastructure/orderDbDriver.ts'],
      exports: ['OrderEntity'],
    },
    {
      filePath: 'src/order/infrastructure/orderDbDriver.ts',
      imports: [],
      exports: ['OrderDbDriver'],
    },
  ];
  const layerGraph = SemanticArchitectureGraph.fromFiles(layeringFiles);
  const layerResult = defaultMetaArchitectureEvaluator.evaluate(layerGraph);
  assert.strictEqual(layerResult.passed, false, 'Must fail on layer inversion');
  const layerIssues = layerResult.issues.filter(
    (i) => i.rule === META_ARCH_RULES.LAYER_VIOLATION || i.rule === META_ARCH_RULES.LAYER_INVERSION,
  );
  assert.strictEqual(layerIssues.length, 1, 'Must report 1 layer inversion');
  assert(layerIssues[0].message.includes('boundary breach'), 'Message must note boundary breach');
  console.log('✔ Unidirectional layering inversion correctly caught.');

  // 4. RULE-ARCH-BOUNDARY (ARCH-BND-001)
  console.log('\n4. Testing RULE-ARCH-BOUNDARY Cross-Domain Private Bypass (ARCH-BND-001)...');
  const bypassFiles = [
    {
      filePath: 'src/auth/service/loginService.ts',
      imports: ['src/crypto/internal/privateKeyring.ts'],
      exports: ['LoginService'],
    },
    {
      filePath: 'src/crypto/internal/privateKeyring.ts',
      imports: [],
      exports: ['PrivateKeyring'],
    },
  ];
  const bypassGraph = SemanticArchitectureGraph.fromFiles(bypassFiles);
  const bypassResult = defaultMetaArchitectureEvaluator.evaluate(bypassGraph);
  const bndIssues = bypassResult.issues.filter((i) => i.rule === META_ARCH_RULES.BOUNDARY_BYPASS);
  assert.strictEqual(bndIssues.length, 1, 'Must catch internal private bypass');
  assert(
    bndIssues[0].message.includes('Cross-domain internal bypass'),
    'Message must indicate private bypass',
  );
  console.log('✔ Cross-domain private internal bypass (ARCH-BND-001) detected.');

  // 5. RULE-ARCH-CONFIG & RULE-ARCH-GENERALIZATION
  console.log('\n5. Testing RULE-ARCH-CONFIG (ARCH-CFG-001) & GENERALIZATION (ARCH-LEAK-001)...');
  const leakFiles = [
    {
      filePath: 'src/inventory/domain/stockModel.ts',
      imports: ['express', 'godot'],
      exports: ['StockModel'],
      hasDirectConfigAccess: true,
      hasGlobalMutableState: true,
    },
  ];
  const leakGraph = SemanticArchitectureGraph.fromFiles(leakFiles);
  const leakResult = defaultMetaArchitectureEvaluator.evaluate(leakGraph);
  const cfgIssues = leakResult.issues.filter((i) => i.rule === META_ARCH_RULES.CONFIG_LEAKAGE);
  const genIssues = leakResult.issues.filter((i) => i.rule === META_ARCH_RULES.GENERALIZATION_LEAK);
  const glbIssues = leakResult.issues.filter((i) => i.rule === META_ARCH_RULES.GLOBAL_STATE);
  assert.strictEqual(cfgIssues.length, 1, 'Must detect config leakage');
  assert.strictEqual(genIssues.length, 2, 'Must detect 2 framework leaks');
  assert.strictEqual(glbIssues.length, 1, 'Must detect shared mutable state');
  console.log('✔ Config access, framework generalization leaks, and global state verified.');

  // 6. RULE-META-SELF-VIOLATION
  console.log('\n6. Testing RULE-META-SELF-VIOLATION (Self-Repo Core Protection)...');
  const selfRepoFiles = [
    {
      filePath: 'src/core/analysis/myCoreEngine.ts',
      imports: ['vscode'],
      exports: ['MyCoreEngine'],
    },
  ];
  const selfGraph = SemanticArchitectureGraph.fromFiles(selfRepoFiles);
  const selfResult = defaultMetaArchitectureEvaluator.evaluate(selfGraph, { isSelfRepo: true });
  const selfIssues = selfResult.issues.filter((i) => i.detail?.isSelfViolation === true);
  assert.strictEqual(selfIssues.length, 1, 'Must flag RULE-META-SELF-VIOLATION');
  assert(
    selfIssues[0].message.includes('RULE-META-SELF-VIOLATION'),
    'Must include self-violation marker in message',
  );
  console.log('✔ RULE-META-SELF-VIOLATION self-repo core breach gate passed.');

  // 7. Praxis Diff Subsystem End-to-End Gate Integration
  console.log('\n7. Testing Praxis Diff Subsystem Architecture Merge Gate...');
  const diffInput = {
    filePath: 'src/core/domain/tradingEngine.ts',
    newContent: `
import * as vscode from 'vscode';

export class TradingEngine {
    public executeTrade(): void {
        vscode.window.showInformationMessage("Trade executed");
    }
}
`,
  };

  const praxisResult = await defaultPraxisGovernanceService.reviewDiff(diffInput, {
    enableArchitectureAudit: true,
    isSelfRepo: true,
  });

  assert.strictEqual(
    praxisResult.verdict.status,
    'major_rework_needed',
    'Praxis must block PR that introduces headless violation in domain',
  );
  assert.strictEqual(
    praxisResult.verdict.shouldEscalateToL3A,
    true,
    'Must escalate to L3A on architectural breach',
  );
  console.log(
    '✔ Praxis Diff Governance properly blocks architectural breaches and escalates to L3A.',
  );

  console.log('\n================================================================');
  console.log('🎉 ALL Meta-Architecture SEMANTIC ARCHITECTURE TESTS PASSED (7/7)!');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Meta-Architecture verification failed:', err);
  process.exit(1);
});
