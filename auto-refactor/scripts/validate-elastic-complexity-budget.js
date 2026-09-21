#!/usr/bin/env node
/**
 * Module: Verification Harness — Context-Aware Elastic Complexity Budget
 * File Path: scripts/validate-elastic-complexity-budget.js
 * Architecture Role: Validates Elastic Complexity Budget (ECB), context-aware multipliers,
 *   algorithmic proof exemptions, CPX-BUD-001 and CPX-JST-001 emission.
 * Dependencies & Triggers: Consumes evaluateElasticComplexityBudget and
 *   evaluateFileCumulativeBudget from ../dist/core/intelligence/elastic-complexity-budget;
 *   invoked by test runner.
 * Responsibilities: Assert language-specific tolerances (Rust/GDScript vs TS/Python),
 *   role multipliers (tool vs infra vs controller), flat vs deep nesting, cumulative file budget.
 * Exit Semantics & Design Rationale: Process exits 0 on all assertions passing, 1 on failure.
 */

'use strict';

const {
  evaluateElasticComplexityBudget,
  evaluateFileCumulativeBudget,
} = require('../dist/core/intelligence/elastic-complexity-budget');

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount++;
  if (condition) {
    passedCount++;
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

function runTests() {
  console.log('--- 1. Testing Language Base Multipliers ---');
  {
    // Rust gets relaxed base (warn: 16) due to pattern matching
    const rustFn = {
      name: 'match_tokens',
      filePath: 'src/parser.rs',
      language: 'rust',
      cc: 14,
      loc: 40,
      maxDepth: 2,
      startLine: 1,
      startColumn: 1,
    };
    const rustResult = evaluateElasticComplexityBudget(rustFn, 10, 20);
    assert(!rustResult.isExceeded, 'Rust function with CC=14 is within relaxed budget');
    assert(rustResult.multipliers.language > 1.0, 'Rust has language multiplier > 1.0');

    // TypeScript with same CC=14 and standard settings
    const tsFn = {
      name: 'handleRequest',
      filePath: 'src/api/handler.ts',
      language: 'typescript',
      cc: 14,
      loc: 40,
      maxDepth: 4,
      startLine: 1,
      startColumn: 1,
    };
    const tsResult = evaluateElasticComplexityBudget(tsFn, 10, 20);
    assert(tsResult.isExceeded, 'TypeScript controller with CC=14 and depth 4 exceeds budget');
  }

  console.log('--- 2. Testing Role Multipliers (Tool Script vs Application CLI) ---');
  {
    const toolFn = {
      name: 'migrate_legacy_data',
      filePath: 'scripts/migrate.ts',
      language: 'ts',
      cc: 13,
      loc: 50,
      maxDepth: 2,
      startLine: 1,
      startColumn: 1,
      role: 'tool_script',
    };
    const toolResult = evaluateElasticComplexityBudget(toolFn, 10, 20);
    assert(toolResult.multipliers.role === 1.4, 'Tool script receives 1.4x role multiplier');
    assert(!toolResult.isExceeded, 'Tool script with CC=13 stays within expanded budget');

    const cliFn = {
      name: 'dispatchCommand',
      filePath: 'src/cli/dispatcher.ts',
      language: 'ts',
      cc: 15,
      loc: 50,
      maxDepth: 3,
      startLine: 1,
      startColumn: 1,
      role: 'application_cli',
    };
    const cliResult = evaluateElasticComplexityBudget(cliFn, 10, 20);
    assert(
      cliResult.multipliers.role === 0.8,
      'CLI dispatcher receives strict 0.8x role multiplier',
    );
    assert(cliResult.isExceeded, 'CLI dispatcher with CC=15 exceeds strict budget');
  }

  console.log('--- 3. Testing Domain Algorithmic Exemption ---');
  {
    const algoFn = {
      name: 'traverse_ast_nodes',
      filePath: 'src/core/ast/traverse.ts',
      language: 'ts',
      cc: 18,
      loc: 60,
      maxDepth: 2, // Shallow, table/visitor pattern
      startLine: 1,
      startColumn: 1,
      role: 'headless_domain_core',
      hasDocContract: true,
    };
    const algoResult = evaluateElasticComplexityBudget(algoFn, 10, 20);
    assert(
      algoResult.hasAlgorithmicProof,
      'Identified shallow algorithm as having algorithmic proof',
    );
    assert(
      algoResult.multipliers.domain === 1.35,
      'Algorithm function receives 1.35x domain multiplier',
    );
    assert(
      !algoResult.isUnjustified,
      'Complex visitor with shallow depth is not flagged as unjustified',
    );
  }

  console.log('--- 4. Testing Unjustified Runaway Nesting (CPX-JST-001) ---');
  {
    const deeplyNestedFn = {
      name: 'processOrder',
      filePath: 'src/services/order.ts',
      language: 'ts',
      cc: 16,
      loc: 80,
      maxDepth: 5, // Deep nesting without algorithmic proof
      startLine: 10,
      startColumn: 1,
    };
    const result = evaluateElasticComplexityBudget(deeplyNestedFn, 10, 20);
    assert(
      result.isUnjustified,
      'Deeply nested function flagged as unjustified (maxDepth=5, cc=16)',
    );
    const jstIssue = result.issues.find((i) => i.rule === 'CPX-JST-001');
    assert(jstIssue !== undefined, 'Emits CPX-JST-001 for unjustified runaway nesting');
    assert(
      jstIssue && jstIssue.message.includes('depth 5'),
      'CPX-JST-001 message mentions nesting depth',
    );
  }

  console.log('--- 5. Testing Budget Exceeded Emission (CPX-BUD-001) ---');
  {
    const overBudgetFn = {
      name: 'monolithicHandler',
      filePath: 'src/handlers/huge.ts',
      language: 'ts',
      cc: 25,
      loc: 120,
      maxDepth: 4,
      startLine: 1,
      startColumn: 1,
    };
    const result = evaluateElasticComplexityBudget(overBudgetFn, 10, 20);
    const budIssue = result.issues.find((i) => i.rule === 'CPX-BUD-001');
    assert(budIssue !== undefined, 'Emits CPX-BUD-001 when elastic budget is exceeded');
    assert(
      budIssue && budIssue.severity === 'error',
      'High CC (25) triggers error severity on CPX-BUD-001',
    );
  }

  console.log('--- 6. Testing File-Level Cumulative Budget ---');
  {
    const normalFile = evaluateFileCumulativeBudget('src/small.ts', 80, [3, 4, 2]);
    assert(normalFile === null, 'Normal file within cumulative budget returns null');

    const heavyFile = evaluateFileCumulativeBudget(
      'src/accumulated.ts',
      250,
      [12, 11, 10, 9, 8, 7, 6], // Sum = 63 > 50 budget
    );
    assert(heavyFile !== null, 'File exceeding cumulative complexity budget produces issue');
    assert(
      heavyFile && heavyFile.rule === 'CPX-BUD-001',
      'Cumulative file issue uses CPX-BUD-001 rule identifier',
    );
  }

  console.log('--- 7. Testing Language Extension Normalization (rs, gd, py, ts) ---');
  {
    const rsFn = {
      name: 'parse_stream',
      filePath: 'src/lib.rs',
      language: 'rs',
      cc: 15,
      loc: 30,
      maxDepth: 2,
      startLine: 1,
      startColumn: 1,
    };
    const gdFn = {
      name: '_on_event',
      filePath: 'scripts/hero.gd',
      language: 'gd',
      cc: 13,
      loc: 30,
      maxDepth: 2,
      startLine: 1,
      startColumn: 1,
    };

    const rsResult = evaluateElasticComplexityBudget(rsFn, 10, 20);
    const gdResult = evaluateElasticComplexityBudget(gdFn, 10, 20);

    assert(rsResult.multipliers.language > 1.2, 'Extension "rs" maps to rust multiplier');
    assert(gdResult.multipliers.language > 1.1, 'Extension "gd" maps to gdscript multiplier');
    assert(!rsResult.isExceeded, 'Rust CC=15 is within relaxed budget when specified as "rs"');
    assert(!gdResult.isExceeded, 'GDScript CC=13 is within relaxed budget when specified as "gd"');
  }

  console.log(`\nElastic Complexity Budget Tests: ${passedCount}/${totalCount} passed.`);
  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runTests();
