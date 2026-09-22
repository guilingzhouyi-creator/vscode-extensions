/**
 * Module: Verification Harness — Phase 12 Multi-Agent Governance Mode
 * File Path: scripts/validate-multi-agent.js
 * Architecture Role: Comprehensive verification harness validating multi-agent change
 *   attribution, cross-agent architectural collision detection (GOV-AGENT-COLLISION),
 *   intent conflict & regression auditing, duplicate work blast radius calculations,
 *   patch arbitration, and Praxis IPraxisMultiAgentGovernanceService integration.
 * Dependencies & Triggers: Run via `node scripts/validate-multi-agent.js`; integrated into
 *   test-parallel runner suite.
 * Responsibilities: Assert all 6 core pillars of multi-agent governance with strict invariants.
 * Exit Semantics & Design Rationale: Exits 0 on total pass, 1 on any assertion failure.
 */
'use strict';

const assert = require('assert');

const {
  AgentAttributionTracker,
  AgentCollisionDetector,
  IntentConflictDetector,
  DuplicateWorkAuditor,
  PatchArbiter,
  MultiAgentCoordinator,
  defaultMultiAgentCoordinator,
} = require('../dist/core/trajectory');

const {
  createPraxisMultiAgentGovernanceService,
  defaultPraxisMultiAgentGovernanceService,
} = require('../dist/core/praxis');

const { classifyRuleLayer } = require('../dist/core/rules/pyramid/layer1Evaluator');
const { getRule } = require('../dist/core/rules/registry');

function testAgentAttribution() {
  console.log('── Step 1: Multi-Agent Change Attribution & Velocity ──');

  const tracker = new AgentAttributionTracker();
  const mockRevisions = [
    {
      revisionId: 'rev-0',
      timestamp: 1000,
      agentUid: 'agent-alpha',
      fileHash: 'h0',
      astDigest: 'd0',
      qualityScore: {
        compositeScore: 92,
        indices: {
          standardization: 90,
          maintainability: 90,
          defectRisk: 95,
          architecture: 95,
          commentQuality: 90,
        },
      },
      ruleHitIds: ['high-complexity:func1', 'magic-number:line10'],
      diffSummary: { addedLines: 50, deletedLines: 10, modifiedDomains: [] },
    },
    {
      revisionId: 'rev-1',
      timestamp: 2000,
      agentUid: 'agent-beta',
      fileHash: 'h1',
      astDigest: 'd1',
      qualityScore: {
        compositeScore: 96,
        indices: {
          standardization: 95,
          maintainability: 95,
          defectRisk: 95,
          architecture: 95,
          commentQuality: 95,
        },
      },
      ruleHitIds: ['magic-number:line10'], // resolved high-complexity:func1
      diffSummary: { addedLines: 20, deletedLines: 30, modifiedDomains: [] },
    },
    {
      revisionId: 'rev-2',
      timestamp: 3000,
      agentUid: 'agent-alpha',
      fileHash: 'h2',
      astDigest: 'd2',
      qualityScore: {
        compositeScore: 98,
        indices: {
          standardization: 98,
          maintainability: 98,
          defectRisk: 98,
          architecture: 98,
          commentQuality: 98,
        },
      },
      ruleHitIds: [], // resolved magic-number:line10
      diffSummary: { addedLines: 15, deletedLines: 5, modifiedDomains: [] },
    },
  ];

  const attributions = tracker.computeFromRevisions('src/core/model.ts', mockRevisions);

  assert.ok(attributions['agent-alpha'], 'agent-alpha must have attribution');
  assert.ok(attributions['agent-beta'], 'agent-beta must have attribution');

  const alpha = attributions['agent-alpha'];
  assert.strictEqual(alpha.totalPatches, 2);
  assert.strictEqual(alpha.linesAdded, 65);
  assert.strictEqual(alpha.linesDeleted, 15);
  assert.strictEqual(alpha.filesModified.length, 1);

  const beta = attributions['agent-beta'];
  assert.strictEqual(beta.totalPatches, 1);
  assert.strictEqual(beta.linesAdded, 20);
  assert.strictEqual(beta.linesDeleted, 30);
  assert.ok(beta.resolvedIssues.includes('high-complexity:func1'));

  console.log('  ✔ Agent attribution accurately calculated across revision history');
}

function testCrossAgentCollision() {
  console.log('── Step 2: Cross-Agent Architectural Collision (GOV-AGENT-COLLISION) ──');

  const detector = new AgentCollisionDetector();

  // Agent Alpha modifies user.ts and imports order.ts
  // Agent Beta modifies order.ts and imports user.ts
  const patches = [
    {
      agentUid: 'agent-alpha',
      patchId: 'patch-alpha-1',
      filePath: 'src/domain/user.ts',
      timestamp: 1000,
      addedLines: 25,
      deletedLines: 0,
      dependenciesAdded: ['src/domain/order.ts'],
    },
    {
      agentUid: 'agent-beta',
      patchId: 'patch-beta-1',
      filePath: 'src/domain/order.ts',
      timestamp: 1001,
      addedLines: 30,
      deletedLines: 0,
      dependenciesAdded: ['src/domain/user.ts'],
    },
  ];

  const collisions = detector.detectCollisions(patches);
  assert.strictEqual(collisions.length, 1, 'Should detect exactly 1 circular dependency collision');

  const collision = collisions[0];
  assert.strictEqual(collision.kind, 'circular_dependency');
  assert.ok(collision.agents.includes('agent-alpha'));
  assert.ok(collision.agents.includes('agent-beta'));
  assert.strictEqual(collision.issue.rule, 'GOV-AGN-001');
  assert.strictEqual(collision.issue.severity, 'error');
  assert.strictEqual(collision.issue.analyzer, 'governance');

  // Verify rule definition in registry
  const ruleDef = getRule('GOV-AGN-001');
  assert.ok(ruleDef, 'GOV-AGN-001 must be registered in rule registry');
  assert.strictEqual(ruleDef.defaultSeverity, 'error');
  assert.strictEqual(classifyRuleLayer('GOV-AGN-001'), 'layer1_universal');

  console.log('  ✔ Concurrent circular dependency detected with GOV-AGN-001 issue');
}

function testIntentConflictDetection() {
  console.log('── Step 3: Intent Conflict & Reintroduced Defect Detection ──');

  const detector = new IntentConflictDetector();

  // Scenario: Agent Alpha resolves SEC-001 in rev-1, Agent Beta reintroduces SEC-001 in rev-2
  const revisions = [
    {
      revisionId: 'rev-0',
      timestamp: 100,
      agentUid: 'agent-base',
      fileHash: 'h0',
      astDigest: 'd0',
      qualityScore: { compositeScore: 85, indices: {} },
      ruleHitIds: ['SEC-001'],
    },
    {
      revisionId: 'rev-1',
      timestamp: 200,
      agentUid: 'agent-alpha',
      fileHash: 'h1',
      astDigest: 'd1',
      qualityScore: { compositeScore: 95, indices: {} },
      ruleHitIds: [], // resolved SEC-001
    },
    {
      revisionId: 'rev-2',
      timestamp: 300,
      agentUid: 'agent-beta',
      fileHash: 'h2',
      astDigest: 'd2',
      qualityScore: { compositeScore: 88, indices: {} },
      ruleHitIds: ['SEC-001'], // reintroduced!
    },
  ];

  const conflicts = detector.detectReintroducedDefects('src/service/auth.ts', revisions);
  assert.strictEqual(conflicts.length, 1, 'Should detect 1 reintroduced defect conflict');
  assert.strictEqual(conflicts[0].kind, 'reintroduced_defect');
  assert.deepStrictEqual(conflicts[0].agents, ['agent-alpha', 'agent-beta']);

  // Scenario: Eroded defensive guard
  const patches = [
    {
      agentUid: 'agent-alpha',
      patchId: 'p-alpha',
      filePath: 'src/core/security.ts',
      timestamp: 500,
      oldContent: 'if (!token) return null;\nreturn token.valid;',
      newContent: 'if (!token) return null;\nreturn token.valid && token.fresh;',
      addedLines: 5,
      deletedLines: 1,
    },
    {
      agentUid: 'agent-beta',
      patchId: 'p-beta',
      filePath: 'src/core/security.ts',
      timestamp: 501,
      oldContent: 'if (!token) return null;\nreturn token.valid;',
      newContent: 'return token.valid;', // stripped if (!token) guard!
      addedLines: 1,
      deletedLines: 2,
    },
  ];

  const patchConflicts = detector.detectPatchConflicts(patches);
  assert.ok(
    patchConflicts.some((c) => c.kind === 'eroded_guard'),
    'Should detect eroded_guard conflict when defensive check is stripped',
  );

  console.log('  ✔ Reintroduced defects and guard erosions detected accurately');
}

function testDuplicateWorkAuditing() {
  console.log('── Step 4: Duplicate Work & Blast Radius Overlap Matrix ──');

  const auditor = new DuplicateWorkAuditor();

  const patches = [
    {
      agentUid: 'agent-alpha',
      patchId: 'p1',
      filePath: 'src/utils/parser.ts',
      timestamp: 1000,
      addedLines: 20,
      deletedLines: 5,
      importedSymbols: ['TokenStream', 'Lexer'],
      exportedSymbols: ['parseAst'],
    },
    {
      agentUid: 'agent-beta',
      patchId: 'p2',
      filePath: 'src/utils/parser.ts',
      timestamp: 1002,
      addedLines: 25,
      deletedLines: 10,
      importedSymbols: ['TokenStream', 'Lexer'],
      exportedSymbols: ['parseAst'],
    },
    {
      agentUid: 'agent-gamma',
      patchId: 'p3',
      filePath: 'src/ui/dashboard.ts',
      timestamp: 1005,
      addedLines: 40,
      deletedLines: 0,
      importedSymbols: ['Widget'],
      exportedSymbols: ['renderView'],
    },
  ];

  const metrics = auditor.auditDuplicateWork(patches, 0.5);
  assert.strictEqual(metrics.length, 1, 'Only Alpha and Beta should have high overlap');

  const pair = metrics[0];
  assert.strictEqual(pair.agentA, 'agent-alpha');
  assert.strictEqual(pair.agentB, 'agent-beta');
  assert.ok(pair.overlapRatio >= 0.8, 'Overlap ratio should be high');
  assert.ok(pair.commonFiles.includes('src/utils/parser.ts'));
  assert.ok(pair.commonSymbols.includes('parseAst'));

  console.log('  ✔ Duplicate work identified with Jaccard overlap ratio >= 0.8');
}

function testPatchArbiter() {
  console.log('── Step 5: Multi-Agent Patch Arbiter & Quality Ranking ──');

  const arbiter = new PatchArbiter();

  const patches = [
    {
      agentUid: 'agent-winner',
      patchId: 'patch-good',
      filePath: 'src/domain/calc.ts',
      timestamp: 1000,
      oldContent: 'export function calc(a: number, b: number): number {\n    return a + b;\n}',
      newContent:
        'export function calc(a: number, b: number): number {\n' +
        '    if (Number.isNaN(a) || Number.isNaN(b)) return 0;\n' +
        '    return a + b;\n' +
        '}',
      addedLines: 3,
      deletedLines: 1,
      compositeScore: 98,
      ruleHitIds: [],
    },
    {
      agentUid: 'agent-mediocre',
      patchId: 'patch-so-so',
      filePath: 'src/domain/calc.ts',
      timestamp: 1001,
      oldContent: 'export function calc(a: number, b: number): number {\n    return a + b;\n}',
      newContent: 'export function calc(a: any, b: any): any {\n' + '    return a + b;\n' + '}',
      addedLines: 2,
      deletedLines: 2,
      compositeScore: 75,
      ruleHitIds: ['GOV-TYP-003:a', 'GOV-TYP-003:b'],
    },
  ];

  const candidates = arbiter.arbitratePatches(patches);
  assert.strictEqual(candidates.length, 2);
  assert.strictEqual(candidates[0].agentUid, 'agent-winner');
  assert.strictEqual(candidates[0].rank, 1);
  assert.strictEqual(candidates[0].isRecommended, true);

  assert.strictEqual(candidates[1].agentUid, 'agent-mediocre');
  assert.strictEqual(candidates[1].rank, 2);
  assert.strictEqual(candidates[1].isRecommended, false);

  console.log('  ✔ Candidate patches ranked with best patch selected (isRecommended=true)');
}

async function testPraxisFacadeService() {
  console.log('── Step 6: Praxis Multi-Agent Governance Facade Integration ──');

  const service = createPraxisMultiAgentGovernanceService();
  assert.ok(service, 'Service factory must instantiate');
  assert.ok(defaultPraxisMultiAgentGovernanceService, 'Default service singleton must exist');
  assert.ok(new MultiAgentCoordinator(), 'MultiAgentCoordinator constructor must instantiate');

  // Test collision rejection
  const collidingPatches = [
    {
      agentUid: 'agent-1',
      patchId: 'p-1',
      filePath: 'src/moduleA.ts',
      timestamp: 100,
      addedLines: 10,
      deletedLines: 0,
      dependenciesAdded: ['src/moduleB.ts'],
    },
    {
      agentUid: 'agent-2',
      patchId: 'p-2',
      filePath: 'src/moduleB.ts',
      timestamp: 101,
      addedLines: 10,
      deletedLines: 0,
      dependenciesAdded: ['src/moduleA.ts'],
    },
  ];

  const resCollision = await service.reviewMultiAgentPatches(collidingPatches);
  assert.strictEqual(resCollision.verdict, 'rejected');
  assert.strictEqual(resCollision.blockingIssues.length, 1);
  assert.strictEqual(resCollision.blockingIssues[0].rule, 'GOV-AGN-001');

  // Test clean pass
  const cleanPatches = [
    {
      agentUid: 'agent-1',
      patchId: 'p-clean-1',
      filePath: 'src/utils/string.ts',
      timestamp: 100,
      addedLines: 5,
      deletedLines: 1,
      dependenciesAdded: [],
    },
    {
      agentUid: 'agent-2',
      patchId: 'p-clean-2',
      filePath: 'src/utils/number.ts',
      timestamp: 101,
      addedLines: 5,
      deletedLines: 1,
      dependenciesAdded: [],
    },
  ];

  const resClean = await service.reviewMultiAgentPatches(cleanPatches);
  assert.strictEqual(resClean.verdict, 'approved');
  assert.strictEqual(resClean.blockingIssues.length, 0);

  // Test coordinator singleton integration
  const coordRes = defaultMultiAgentCoordinator.coordinate(cleanPatches);
  assert.strictEqual(coordRes.verdict, 'clean');

  console.log('  ✔ Praxis multi-agent facade and SPI contracts fully verified');
}

async function main() {
  console.log('================================================================');
  console.log('Phase 12: Multi-Agent Governance Mode Verification Harness');
  console.log('================================================================');

  testAgentAttribution();
  testCrossAgentCollision();
  testIntentConflictDetection();
  testDuplicateWorkAuditing();
  testPatchArbiter();
  await testPraxisFacadeService();

  console.log('================================================================');
  console.log('🎉 PHASE 12: ALL 6 MULTI-AGENT GOVERNANCE GATES PASSED (100%)');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('\n❌ Phase 12 validation failed:', err);
  process.exit(1);
});
