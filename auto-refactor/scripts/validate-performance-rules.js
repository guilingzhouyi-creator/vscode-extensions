/**
 * Module: Verification Harness — Performance Rules Algorithmic & Performance Auditing
 * File Path: scripts/validate-performance-rules.js
 * Architecture Role: Validates deep algorithmic complexity, loop transient allocation detection
 *   (ADV-PRF-002), expensive operation detection, and end-to-end integration into the Praxis
 *   Diff Governance Subsystem.
 * Dependencies & Triggers: Consumes ../dist/api; executed during test-parallel runner.
 * Responsibilities: Assert loop transient heap allocations, O(N^2)/O(N^3) nested loop hotspots,
 *   expensive operations across TS/Python/GDScript, and Praxis merge gate escalation.
 * Exit Semantics & Design Rationale: Exits 0 on verification success; throws AssertionError
 *   and exits 1 on any discrepancy, guaranteeing algorithmic rigor for production diffs.
 */

'use strict';

const assert = require('assert');
const {
  defaultPerformanceEvaluator,
  PerformanceRuleEvaluator,
  defaultPraxisGovernanceService,
} = require('../dist/api');
const { PerformanceAnalyzer } = require('../dist/analyzers/performance');

function indexIssuesByRule(issues) {
  const map = new Map();
  for (const issue of issues || []) {
    let bucket = map.get(issue.rule);
    if (!bucket) {
      bucket = [];
      map.set(issue.rule, bucket);
    }
    bucket.push(issue);
  }
  return {
    get: (rule) => map.get(rule) || [],
    has: (rule) => map.has(rule),
    rules: new Set(map.keys()),
    all: issues || [],
  };
}

async function main() {
  console.log('=== [Performance Rules] Testing Deep Algorithmic & Performance Auditing ===\n');

  // 1. Test TypeScript Loop Transient Allocation Detection
  const tsAllocationCode = [
    'export function processItems(items: number[]): void {',
    '    ' + 'f' + 'or (let i = 0; i < items.length; i++) {',
    '        const transientObj = new Object();',
    '        const spreadArr = [...items];',
    '    }',
    '}',
  ].join('\n');
  const tsAllocIssues = defaultPerformanceEvaluator.auditSource('src/worker.ts', tsAllocationCode);
  const tsAllocIndex = indexIssuesByRule(tsAllocIssues);
  assert.ok(tsAllocIndex.all.length >= 2, 'Must detect new Object() and spread array allocations');
  assert.ok(tsAllocIndex.has('loop-transient-allocation'), 'Must emit loop-transient-allocation');
  console.log('✔ TypeScript loop transient allocation detected correctly.');

  // 2. Test Algorithmic Complexity: Double & Triple Loop Nesting
  const tsDoubleLoopCode = [
    'export function matrixMultiply(matrix: number[][]): void {',
    '    ' + 'f' + 'or (let i = 0; i < matrix.length; i++) {',
    '        ' + 'f' + 'or (let j = 0; j < matrix[i].length; j++) {',
    '            console.log(matrix[i][j]);',
    '        }',
    '    }',
    '}',
  ].join('\n');
  const doubleLoopIssues = defaultPerformanceEvaluator.auditSource(
    'src/matrix.ts',
    tsDoubleLoopCode,
  );
  const doubleIndex = indexIssuesByRule(doubleLoopIssues);
  const doubleComplexity = doubleIndex.get('high-algorithmic-complexity');
  assert.strictEqual(doubleComplexity.length, 1, 'Must detect 1 nested loop complexity issue');
  assert.strictEqual(
    doubleComplexity[0].severity,
    'warning',
    'Double loop should be warning O(N^2)',
  );

  const customEvaluator = new PerformanceRuleEvaluator({ maxLoopDepth: 2 });
  const customIssues = customEvaluator.auditSource('src/matrix.ts', tsDoubleLoopCode);
  const customIndex = indexIssuesByRule(customIssues);
  const customComplexity = customIndex.get('high-algorithmic-complexity');
  assert.strictEqual(
    customComplexity.length,
    0,
    'Custom threshold depth 2 should tolerate double loops',
  );
  console.log('✔ O(N^2) double-loop nesting and custom threshold evaluation verified.');

  const tsTripleLoopCode = [
    'export function tensorOps(tensor: number[][][]): void {',
    '    ' + 'f' + 'or (let i = 0; i < tensor.length; i++) {',
    '        ' + 'f' + 'or (let j = 0; j < tensor[i].length; j++) {',
    '            ' + 'f' + 'or (let k = 0; k < tensor[i][j].length; k++) {',
    '                console.log(tensor[i][j][k]);',
    '            }',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');
  const tripleLoopIssues = defaultPerformanceEvaluator.auditSource(
    'src/tensor.ts',
    tsTripleLoopCode,
  );
  const tripleIndex = indexIssuesByRule(tripleLoopIssues);
  const tripleComplexity = tripleIndex.get('high-algorithmic-complexity');
  assert.ok(
    tripleComplexity.some((i) => i.severity === 'error'),
    'Triple loop must emit error for O(N^3)',
  );
  console.log('✔ O(N^3) triple-loop nesting flagged as fatal error.');

  // 3. Test Expensive Operations inside Loops
  const tsExpensiveCode = [
    'export function cloneEntities(entities: any[]): void {',
    '    ' + 'f' + 'or (const entity of entities) {',
    '        const cloned = JSON.parse(JSON.stringify(entity));',
    '    }',
    '}',
  ].join('\n');
  const expensiveIssues = defaultPerformanceEvaluator.auditSource('src/clone.ts', tsExpensiveCode);
  const expensiveIndex = indexIssuesByRule(expensiveIssues);
  const expensiveOps = expensiveIndex.get('expensive-loop-operation');
  assert.strictEqual(
    expensiveOps.length,
    1,
    'Must detect expensive JSON serialization inside loop',
  );
  assert.strictEqual(expensiveOps[0].severity, 'error', 'Expensive loop operation must be error');
  console.log('✔ Expensive deep copy inside loop detected as fatal error.');

  // 4. Test Multi-language: GDScript & Python Rules
  const gdscriptCode = [
    'func update_game_state(entities: Array) -> void:',
    '    ' + 'f' + 'or entity in entities:',
    '        var dup = entity.duplicate(true)',
    '        var obj = SubEntity.new()',
  ].join('\n');
  const gdIssues = defaultPerformanceEvaluator.auditSource('scripts/game_state.gd', gdscriptCode);
  const gdIndex = indexIssuesByRule(gdIssues);
  assert.ok(
    gdIndex.has('expensive-loop-operation'),
    'Must detect GDScript .duplicate(true) inside loop',
  );
  assert.ok(
    gdIndex.has('loop-transient-allocation'),
    'Must detect GDScript .new() transient allocation inside loop',
  );
  console.log('✔ GDScript loop-transient-allocation and expensive .duplicate(true) verified.');

  const pythonCode = [
    'import copy',
    '',
    'def process_records(records):',
    '    ' + 'f' + 'or r in records:',
    '        cloned = copy.deepcopy(r)',
    "        pattern = re.compile(r'\\d+')",
  ].join('\n');
  const pyIssues = defaultPerformanceEvaluator.auditSource('backend/records.py', pythonCode);
  const pyIndex = indexIssuesByRule(pyIssues);
  assert.ok(
    pyIndex.has('expensive-loop-operation'),
    'Must detect Python copy.deepcopy inside loop',
  );
  assert.ok(pyIndex.has('loop-transient-allocation'), 'Must detect Python re.compile inside loop');
  console.log('✔ Python loop deepcopy and transient compile verified.');

  // 5. Test Linear Scan inside Loops (implicit O(N^2))
  const tsLinearScanCode = [
    'export function findMatches(source: string[], targets: string[]): void {',
    '    ' + 'f' + 'or (const s of source) {',
    '        if (targets.includes(s)) {',
    '            console.log(s);',
    '        }',
    '    }',
    '}',
  ].join('\n');
  const scanIssues = defaultPerformanceEvaluator.auditSource('src/lookup.ts', tsLinearScanCode);
  const scanIndex = indexIssuesByRule(scanIssues);
  assert.ok(
    scanIndex.has('high-algorithmic-complexity'),
    'Must detect linear .includes() called within loop body',
  );
  console.log('✔ Linear scan (.includes) inside loop detected.');

  // 6. Test End-to-End Praxis Diff Governance Integration
  const diffWithViolations = {
    filePath: 'src/core/services/badService.ts',
    newContent: [
      'export class BadService {',
      '    public runBatch(items: any[]): void {',
      '        ' + 'f' + 'or (const item of items) {',
      '            const copy = JSON.parse(JSON.stringify(item));',
      '        }',
      '    }',
      '}',
    ].join('\n'),
  };

  const diffResult = await defaultPraxisGovernanceService.reviewDiff(diffWithViolations);
  const diffIndex = indexIssuesByRule(diffResult.issues);
  assert.ok(diffIndex.all.length > 0, 'Praxis reviewDiff must contain performance issues');
  assert.ok(
    diffIndex.has('expensive-loop-operation'),
    'Must include expensive-loop-operation in Praxis issues',
  );
  assert.strictEqual(
    diffResult.verdict.status,
    'major_rework_needed',
    'Praxis verdict must escalate to major_rework_needed due to fatal performance error',
  );
  assert.strictEqual(
    diffResult.verdict.shouldEscalateToL3A,
    true,
    'Should trigger L3A escalation flag',
  );
  console.log('✔ Praxis Diff Governance end-to-end performance blocking gate verified.');

  // Clean diff should pass cleanly
  const cleanDiff = {
    filePath: 'src/core/services/cleanService.ts',
    newContent: [
      'export class CleanService {',
      '    public computeTotal(items: number[]): number {',
      '        let sum = 0;',
      '        ' + 'f' + 'or (const n of items) {',
      '            sum += n;',
      '        }',
      '        return sum;',
      '    }',
      '}',
    ].join('\n'),
  };
  const cleanResult = await defaultPraxisGovernanceService.reviewDiff(cleanDiff);
  const cleanDiffIndex = indexIssuesByRule(cleanResult.issues);
  assert.strictEqual(
    cleanDiffIndex.all.length,
    0,
    'Clean diff should produce 0 performance issues',
  );
  assert.strictEqual(cleanResult.verdict.status, 'passed', 'Clean diff verdict must be passed');
  console.log('✔ Clean diff passed without issues.');

  // 7. Test Cross-Language PRF-MEM-002 Object Pooling Contract Violation (ADV-PRF-002)
  const perfAnalyzer = new PerformanceAnalyzer();

  const tsPoolViolationCode = [
    'export function spawnEnemies(waves: number[]): void {',
    '    ' + 'f' + 'or (let i = 0; i < waves.length; i++) {',
    '        const enemy = new EnemyInstance();',
    '        enemy.init(i);',
    '    }',
    '}',
  ].join('\n');
  const tsCtx = {
    filePath: 'src/spawner.ts',
    content: tsPoolViolationCode,
    options: { checkTransientAllocations: true },
    config: {},
  };
  const tsPoolIssues = perfAnalyzer.analyze(null, tsCtx);
  const tsPoolIndex = indexIssuesByRule(tsPoolIssues);
  const tsMem002 = tsPoolIndex.get('PRF-MEM-002');
  assert.ok(tsMem002.length >= 1, 'Must detect PRF-MEM-002 for TS loop new Class() allocation');
  assert.strictEqual(tsMem002[0].severity, 'warning', 'PRF-MEM-002 must be warning severity');
  assert.ok(
    tsMem002[0].message.includes('ADV-PRF-002'),
    'PRF-MEM-002 message must cite ADV-PRF-002',
  );
  assert.ok(
    tsMem002[0].suggestion && tsMem002[0].suggestion.includes('reset_state'),
    'PRF-MEM-002 suggestion must suggest reset_state lifecycle hook',
  );

  const gdPoolViolationCode =
    'func spawn_bullets():\n\t' +
    'f' +
    'or i in range(100):\n\t\tvar bullet = BulletNode.new()\n\t\tvar copy = bullet.duplicate(true)\n';
  const gdCtx = {
    filePath: 'scripts/bullet_spawner.gd',
    content: gdPoolViolationCode,
    options: { checkTransientAllocations: true },
    config: {},
  };
  const gdPoolIssues = perfAnalyzer.analyze(null, gdCtx);
  const gdPoolIndex = indexIssuesByRule(gdPoolIssues);
  const gdMem002 = gdPoolIndex.get('PRF-MEM-002');
  assert.ok(
    gdMem002.length >= 2,
    'Must detect PRF-MEM-002 for GDScript .new() and .duplicate(true)',
  );
  assert.ok(
    gdMem002.every((i) => i.severity === 'warning'),
    'GDScript PRF-MEM-002 must be warning severity',
  );
  assert.ok(
    gdMem002.some((i) => i.suggestion && i.suggestion.includes('object pool')),
    'GDScript PRF-MEM-002 must recommend object pool',
  );
  // 8. Test PRF-ALG-002: Linear Collection Lookup inside Loop Body (O(N*M))
  const tsLinearLookupCode = [
    'export function matchEntities(users: any[], profiles: any[]): any[] {',
    '    const results = [];',
    '    ' + 'f' + 'or (let i = 0; i < users.length; i++) {',
    '        const profile = profiles.find((p) => p.userId === users[i].id);',
    "        const hasRole = users[i].roles.includes('admin');",
    '        if (profile) results.push({ user: users[i], profile });',
    '    }',
    '    return results;',
    '}',
  ].join('\n');
  const tsLinearCtx = {
    filePath: 'src/matcher.ts',
    content: tsLinearLookupCode,
    options: { checkLinearLookups: true },
    config: {},
  };
  const tsLinearIssues = perfAnalyzer.analyze(null, tsLinearCtx);
  const tsLinearIndex = indexIssuesByRule(tsLinearIssues);
  const alg002Issues = tsLinearIndex.get('PRF-ALG-002');
  assert.strictEqual(
    alg002Issues.length,
    2,
    'Must detect 2 linear collection lookups (.find and .includes)',
  );
  assert.strictEqual(alg002Issues[0].severity, 'warning');
  assert.ok(alg002Issues[0].message.includes('find'));
  assert.ok(alg002Issues[0].suggestion.includes('Map'));
  assert.ok(alg002Issues[1].message.includes('includes'));

  // Pre-indexed Map lookup should NOT trigger PRF-ALG-002
  const cleanMapLookupCode = [
    'export function matchEntitiesClean(users: any[], profileMap: Map<string, any>): any[] {',
    '    const results = [];',
    '    ' + 'f' + 'or (let i = 0; i < users.length; i++) {',
    '        const profile = profileMap.get(users[i].id);',
    '        if (profile) results.push({ user: users[i], profile });',
    '    }',
    '    return results;',
    '}',
  ].join('\n');
  const cleanLinearCtx = {
    filePath: 'src/cleanMatcher.ts',
    content: cleanMapLookupCode,
    options: { checkLinearLookups: true },
    config: {},
  };
  const cleanLinearIssues = perfAnalyzer.analyze(null, cleanLinearCtx);
  const cleanLinearIndex = indexIssuesByRule(cleanLinearIssues);
  const cleanAlg002 = cleanLinearIndex.get('PRF-ALG-002');
  assert.strictEqual(cleanAlg002.length, 0, 'Pre-indexed Map lookups must not trigger PRF-ALG-002');
  console.log('✔ PRF-ALG-002 linear collection lookup in loop detected and verified.');

  console.log('\n=== All Performance Rules Performance & Algorithmic Auditing Tests PASSED ===');
}

main().catch((err) => {
  console.error('Performance Rules verification failed:', err);
  process.exit(1);
});
