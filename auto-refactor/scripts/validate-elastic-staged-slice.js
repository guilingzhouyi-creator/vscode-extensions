#!/usr/bin/env node
/**
 * Module: Verification Harness — Elastic Staged Slice Validator Test Suite
 * File Path: scripts/validate-elastic-staged-slice.js
 * Architecture Role: Comprehensive unit test suite for validate-staged-slice.js.
 *   Validates configuration cascades, flat dispatcher recognition, loop isolation,
 *   nested function closure decoupling, and elastic budget enforcement.
 * Dependencies & Triggers: Consumes analyzeSourceText, calculateComplexity, checkNesting
 *   from scripts/validate-staged-slice.js; invoked by test-parallel.js and gate scripts.
 * Responsibilities: Assert standard CC limits, flat dispatcher CC bonuses (up to 25),
 *   loop containment penalties, depth boundaries, role heuristics, and CLI flag overrides.
 * Exit Semantics & Design Rationale: Process exits 0 on all tests passing, 1 on failure.
 */
'use strict';

const {
  analyzeSourceText,
  calculateComplexity,
  checkNesting,
  resolveConfig,
  DEFAULT_CONFIG,
} = require('./validate-staged-slice');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✔ [PASS] ${message}`);
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

console.log('================================================================');
console.log('🧪 Starting Elastic Staged Slice Validator Self-Test Harness');
console.log('================================================================');

// --- Test 1: Standard function within default budget ---
console.log('\n--- 1. Testing Standard Function within Base Budget ---');
{
  const code = `
function processItems(items: string[]): number {
    let count = 0;
    for (const item of items) {
        if (item.length > 5) {
            count += item.startsWith('A') ? 2 : 1;
        }
    }
    return count;
}
`;
  const findings = analyzeSourceText(code, 'src/service/worker.ts');
  assert(findings.length === 0, 'Standard function (CC=5, Depth=3) passes with zero findings');
}

// --- Test 2: Flat dispatcher receives elastic complexity bonus ---
console.log('\n--- 2. Testing Flat Dispatcher Elastic Complexity Bonus ---');
{
  // 17 flat early return statements: CC = 18, Depth = 2, hasLoops = false
  const flatCode = `
function detectExtensionKind(ext: string): string {
    if (ext === '.ts') return 'typescript';
    if (ext === '.js') return 'javascript';
    if (ext === '.json') return 'json';
    if (ext === '.md') return 'markdown';
    if (ext === '.rs') return 'rust';
    if (ext === '.gd') return 'gdscript';
    if (ext === '.py') return 'python';
    if (ext === '.go') return 'go';
    if (ext === '.html') return 'html';
    if (ext === '.css') return 'css';
    if (ext === '.yaml') return 'yaml';
    if (ext === '.yml') return 'yaml';
    if (ext === '.toml') return 'toml';
    if (ext === '.sh') return 'shell';
    if (ext === '.ps1') return 'powershell';
    if (ext === '.c') return 'c';
    if (ext === '.cpp') return 'cpp';
    return 'unknown';
}
`;
  const findings = analyzeSourceText(flatCode, 'src/core/detect.ts');
  assert(
    findings.length === 0,
    'Flat dispatcher (CC=18, Depth=2, no loops) receives elastic bonus (<= 25) and passes',
  );

  // If flatDispatcherBonus is explicitly disabled, it should fail
  const strictFindings = analyzeSourceText(flatCode, 'src/core/detect.ts', {
    flatDispatcherBonus: false,
  });
  assert(
    strictFindings.length === 1 && strictFindings[0].rule === 'CPX-BUD-001',
    'Disabling flat dispatcher bonus triggers CPX-BUD-001 (18 > 15)',
  );
}

// --- Test 3: Complex loop function does NOT receive flat bonus ---
console.log('\n--- 3. Testing Loop Function Rigorous Budget Enforcement ---');
{
  // High CC with loop: CC = 16, Depth = 3, hasLoops = true
  const loopCode = `
function complexLoopScanner(items: number[]): number {
    let result = 0;
    for (let i = 0; i < items.length; i++) {
        if (items[i] > 1) result += 1;
        if (items[i] > 2) result += 2;
        if (items[i] > 3) result += 3;
        if (items[i] > 4) result += 4;
        if (items[i] > 5) result += 5;
        if (items[i] > 6) result += 6;
        if (items[i] > 7) result += 7;
        if (items[i] > 8) result += 8;
        if (items[i] > 9) result += 9;
        if (items[i] > 10) result += 10;
        if (items[i] > 11) result += 11;
        if (items[i] > 12) result += 12;
        if (items[i] > 13) result += 13;
        if (items[i] > 14) result += 14;
    }
    return result;
}
`;
  const findings = analyzeSourceText(loopCode, 'src/calc/loop.ts');
  assert(
    findings.length === 1 && findings[0].rule === 'CPX-BUD-001',
    'Function with loop and CC=16 is blocked by standard base limit (CC > 15)',
  );
}

// --- Test 4: Deep nesting exceeds Depth <= 4 ---
console.log('\n--- 4. Testing Control Flow Deep Nesting Boundary ---');
{
  const deepCode = `
function deepNestingFunction(a: boolean, b: boolean, c: boolean, d: boolean, e: boolean): void {
    if (a) {
        if (b) {
            if (c) {
                if (d) {
                    if (e) {
                        console.log('Depth 5 violation');
                    }
                }
            }
        }
    }
}
`;
  const findings = analyzeSourceText(deepCode, 'src/deep/nest.ts');
  assert(
    findings.some((f) => f.rule === 'CPX-NEST-001'),
    '5 levels of nested if statements triggers CPX-NEST-001 (Depth 5 > 4)',
  );
}

// --- Test 5: Probe & Parser archetype heuristic budget ---
console.log('\n--- 5. Testing Probe and Parser Archetype Heuristic ---');
{
  const probeCode = `
function sniffArchetypeFeature(content: string): string | null {
    if (content.includes('feat1')) return 'f1';
    if (content.includes('feat2')) return 'f2';
    if (content.includes('feat3')) return 'f3';
    if (content.includes('feat4')) return 'f4';
    if (content.includes('feat5')) return 'f5';
    if (content.includes('feat6')) return 'f6';
    if (content.includes('feat7')) return 'f7';
    if (content.includes('feat8')) return 'f8';
    if (content.includes('feat9')) return 'f9';
    if (content.includes('feat10')) return 'f10';
    if (content.includes('feat11')) return 'f11';
    if (content.includes('feat12')) return 'f12';
    if (content.includes('feat13')) return 'f13';
    if (content.includes('feat14')) return 'f14';
    if (content.includes('feat15')) return 'f15';
    if (content.includes('feat16')) return 'f16';
    if (content.includes('feat17')) return 'f17';
    return null;
}
`;
  const probeFindings = analyzeSourceText(probeCode, 'src/core/governance/repo-archetype.ts');
  assert(
    probeFindings.length === 0,
    'Probe file path automatically receives elastic archetype budget and passes',
  );
}

// --- Test 6: Nested closure separation (closure CC not inflating outer) ---
console.log('\n--- 6. Testing Nested Closure Isolation ---');
{
  const outerWithInner = `
function outerHandler(list: number[]): number[] {
    if (list.length === 0) return [];
    return list.map((x) => {
        if (x > 10) return x * 2;
        if (x > 5) return x + 1;
        return x;
    });
}
`;
  const findings = analyzeSourceText(outerWithInner, 'src/mapping/list.ts');
  assert(
    findings.length === 0,
    'Inner closure branching does not artificially inflate outer function CC',
  );
}

// --- Summary ---
console.log('================================================================');
console.log(`Results: ${passedTests} passed, ${totalTests - passedTests} failed`);
if (passedTests === totalTests) {
  console.log('🎉 ALL ELASTIC STAGED SLICE TESTS PASSED!');
  process.exit(0);
} else {
  console.error('❌ SOME TESTS FAILED!');
  process.exit(1);
}
