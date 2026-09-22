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

async function main() {
  console.log('=== [Performance Rules] Testing Deep Algorithmic & Performance Auditing ===\n');

  // 1. Test TypeScript Loop Transient Allocation Detection
  const tsAllocationCode = `
export function processItems(items: number[]): void {
    for (let i = 0; i < items.length; i++) {
        const transientObj = new Object();
        const spreadArr = [...items];
    }
}
`;
  const tsAllocIssues = defaultPerformanceEvaluator.auditSource('src/worker.ts', tsAllocationCode);
  assert.ok(tsAllocIssues.length >= 2, 'Must detect new Object() and spread array allocations');
  const allocRules = tsAllocIssues.map((i) => i.rule);
  assert.ok(
    allocRules.includes('loop-transient-allocation'),
    'Must emit loop-transient-allocation',
  );
  console.log('✔ TypeScript loop transient allocation detected correctly.');

  // 2. Test Algorithmic Complexity: Double & Triple Loop Nesting
  const tsDoubleLoopCode = `
export function matrixMultiply(matrix: number[][]): void {
    for (let i = 0; i < matrix.length; i++) {
        for (let j = 0; j < matrix[i].length; j++) {
            console.log(matrix[i][j]);
        }
    }
}
`;
  const doubleLoopIssues = defaultPerformanceEvaluator.auditSource(
    'src/matrix.ts',
    tsDoubleLoopCode,
  );
  const doubleComplexity = doubleLoopIssues.filter((i) => i.rule === 'high-algorithmic-complexity');
  assert.strictEqual(doubleComplexity.length, 1, 'Must detect 1 nested loop complexity issue');
  assert.strictEqual(
    doubleComplexity[0].severity,
    'warning',
    'Double loop should be warning O(N^2)',
  );

  const customEvaluator = new PerformanceRuleEvaluator({ maxLoopDepth: 2 });
  const customIssues = customEvaluator.auditSource('src/matrix.ts', tsDoubleLoopCode);
  const customComplexity = customIssues.filter((i) => i.rule === 'high-algorithmic-complexity');
  assert.strictEqual(
    customComplexity.length,
    0,
    'Custom threshold depth 2 should tolerate double loops',
  );
  console.log('✔ O(N^2) double-loop nesting and custom threshold evaluation verified.');

  const tsTripleLoopCode = `
export function tensorOps(tensor: number[][][]): void {
    for (let i = 0; i < tensor.length; i++) {
        for (let j = 0; j < tensor[i].length; j++) {
            for (let k = 0; k < tensor[i][j].length; k++) {
                console.log(tensor[i][j][k]);
            }
        }
    }
}
`;
  const tripleLoopIssues = defaultPerformanceEvaluator.auditSource(
    'src/tensor.ts',
    tsTripleLoopCode,
  );
  const tripleComplexity = tripleLoopIssues.filter((i) => i.rule === 'high-algorithmic-complexity');
  assert.ok(
    tripleComplexity.some((i) => i.severity === 'error'),
    'Triple loop must emit error for O(N^3)',
  );
  console.log('✔ O(N^3) triple-loop nesting flagged as fatal error.');

  // 3. Test Expensive Operations inside Loops
  const tsExpensiveCode = `
export function cloneEntities(entities: any[]): void {
    for (const entity of entities) {
        const cloned = JSON.parse(JSON.stringify(entity));
    }
}
`;
  const expensiveIssues = defaultPerformanceEvaluator.auditSource('src/clone.ts', tsExpensiveCode);
  const expensiveOps = expensiveIssues.filter((i) => i.rule === 'expensive-loop-operation');
  assert.strictEqual(
    expensiveOps.length,
    1,
    'Must detect expensive JSON serialization inside loop',
  );
  assert.strictEqual(expensiveOps[0].severity, 'error', 'Expensive loop operation must be error');
  console.log('✔ Expensive deep copy inside loop detected as fatal error.');

  // 4. Test Multi-language: GDScript & Python Rules
  const gdscriptCode = `
func update_game_state(entities: Array) -> void:
    for entity in entities:
        var dup = entity.duplicate(true)
        var obj = SubEntity.new()
`;
  const gdIssues = defaultPerformanceEvaluator.auditSource('scripts/game_state.gd', gdscriptCode);
  assert.ok(
    gdIssues.some((i) => i.rule === 'expensive-loop-operation'),
    'Must detect GDScript .duplicate(true) inside loop',
  );
  assert.ok(
    gdIssues.some((i) => i.rule === 'loop-transient-allocation'),
    'Must detect GDScript .new() transient allocation inside loop',
  );
  console.log('✔ GDScript loop-transient-allocation and expensive .duplicate(true) verified.');

  const pythonCode = `
import copy

def process_records(records):
    for r in records:
        cloned = copy.deepcopy(r)
        pattern = re.compile(r'\\d+')
`;
  const pyIssues = defaultPerformanceEvaluator.auditSource('backend/records.py', pythonCode);
  assert.ok(
    pyIssues.some((i) => i.rule === 'expensive-loop-operation'),
    'Must detect Python copy.deepcopy inside loop',
  );
  assert.ok(
    pyIssues.some((i) => i.rule === 'loop-transient-allocation'),
    'Must detect Python re.compile inside loop',
  );
  console.log('✔ Python loop deepcopy and transient compile verified.');

  // 5. Test Linear Scan inside Loops (implicit O(N^2))
  const tsLinearScanCode = `
export function findMatches(source: string[], targets: string[]): void {
    for (const s of source) {
        if (targets.includes(s)) {
            console.log(s);
        }
    }
}
`;
  const scanIssues = defaultPerformanceEvaluator.auditSource('src/lookup.ts', tsLinearScanCode);
  assert.ok(
    scanIssues.some((i) => i.rule === 'high-algorithmic-complexity'),
    'Must detect linear .includes() called within loop body',
  );
  console.log('✔ Linear scan (.includes) inside loop detected.');

  // 6. Test End-to-End Praxis Diff Governance Integration
  const diffWithViolations = {
    filePath: 'src/core/services/badService.ts',
    newContent: `
export class BadService {
    public runBatch(items: any[]): void {
        for (const item of items) {
            const copy = JSON.parse(JSON.stringify(item));
        }
    }
}
`,
  };

  const diffResult = await defaultPraxisGovernanceService.reviewDiff(diffWithViolations);
  assert.ok(diffResult.issues.length > 0, 'Praxis reviewDiff must contain performance issues');
  assert.ok(
    diffResult.issues.some((i) => i.rule === 'expensive-loop-operation'),
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
    newContent: `
export class CleanService {
    public computeTotal(items: number[]): number {
        let sum = 0;
        for (const n of items) {
            sum += n;
        }
        return sum;
    }
}
`,
  };
  const cleanResult = await defaultPraxisGovernanceService.reviewDiff(cleanDiff);
  assert.strictEqual(
    cleanResult.issues.length,
    0,
    'Clean diff should produce 0 performance issues',
  );
  assert.strictEqual(cleanResult.verdict.status, 'passed', 'Clean diff verdict must be passed');
  console.log('✔ Clean diff passed without issues.');

  console.log('\n=== All Performance Rules Performance & Algorithmic Auditing Tests PASSED ===');
}

main().catch((err) => {
  console.error('Performance Rules verification failed:', err);
  process.exit(1);
});
