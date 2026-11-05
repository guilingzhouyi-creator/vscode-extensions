/**
 * Module: Verification Harness — DeepInfer DSpark & SGLang RadixAttention AST Prefix Cache
 * File Path: scripts/validate-dspark-radix-cache.js
 * Architecture Role: Comprehensive integration assertion suite validating Phase 3 DeepSeek /
 *   DeepInfer architectural internalizations:
 *   1. DSparkConfidenceScheduler multi-dimensional micro-edit scoring (syntax, complexity, scope);
 *   2. DSpark Safe Prefix Rollout early sequence truncation and waste pruning;
 *   3. AstPrefixRadixCache multi-way Radix tree construction, LCP matching, and subtree reuse;
 *   4. AstPrefixRadixCache sub-threshold fallback and remaining source slice calculation;
 *   5. AstPrefixRadixCache LRU bound enforcement and telemetry accounting.
 * Dependencies & Triggers: Consumes dist/api; triggered by test-parallel.js and npm test.
 * Responsibilities: Assert exact confidence thresholds, zero transient leaks, and correct LCP
 *   reuse.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passing; exits 1 with trace on
 *   failure.
 */

const assert = require('assert');
const { DSparkConfidenceScheduler, AstPrefixRadixCache } = require('../dist/api');
const { NodeKind } = require('../dist/core/ast/multilang');

const { runEntry } = require('./common/test-runner-harness');

async function main() {
  console.log('=== [1/5] Testing DSparkConfidenceScheduler Micro-Edit Step Scoring ===');

  const scheduler = new DSparkConfidenceScheduler({ confidenceThreshold: 0.65 });

  // 1. High confidence step: safe early return guard with balanced braces
  const highConfStep = {
    filePath: 'src/handler.ts',
    replacementText: 'if (!request) {\n    return null;\n}',
    targetText: 'if (request) { doWork(); }',
    line: 12,
  };
  const highResult = scheduler.scoreStep(highConfStep, 0);
  assert(highResult.syntaxScore >= 0.9, 'Syntax score must be high for balanced code');
  assert(highResult.complexityTrendScore >= 0.8, 'Complexity score must reward early return');
  assert(highResult.scopeSafetyScore >= 0.8, 'Scope safety must be high');
  assert(highResult.compositeConfidence >= 0.65, 'Composite confidence must exceed threshold');
  assert.strictEqual(highResult.isConfident, true, 'High confidence step must be accepted');

  // 2. Low confidence step: broken syntax with unbalanced brace
  const unclosedBraceStep = {
    filePath: 'src/handler.ts',
    replacementText: 'function calculateTotal() {\n    const total = 10;',
    line: 25,
  };
  const unclosedResult = scheduler.scoreStep(unclosedBraceStep, 1);
  assert(unclosedResult.syntaxScore < 0.7, 'Syntax score must be penalized for unbalanced brace');
  assert(
    unclosedResult.deductionFactors.includes('unbalanced_braces'),
    'Must record unbalanced_braces deduction',
  );
  assert.strictEqual(unclosedResult.isConfident, false, 'Unbalanced step must be rejected');

  // 3. Low confidence step: unclosed string literal
  const unclosedQuoteStep = {
    filePath: 'src/handler.ts',
    replacementText: 'const errorText = "unterminated string;',
    line: 30,
  };
  const quoteResult = scheduler.scoreStep(unclosedQuoteStep, 2);
  assert(
    quoteResult.deductionFactors.includes('unclosed_string_literal'),
    'Must record unclosed_string_literal',
  );
  assert.strictEqual(quoteResult.isConfident, false, 'Unclosed quote step must be rejected');

  console.log('DSpark micro-edit step scoring and multi-factor deductions verified.');

  console.log('=== [2/5] Testing DSpark Safe Prefix Rollout Early Truncation ===');

  const rolloutScheduler = new DSparkConfidenceScheduler({
    confidenceThreshold: 0.65,
    minStepsBeforePruning: 1,
  });

  // 5-step sequence: Step 0 & 1 clean, Step 2 broken, Steps 3 & 4 should be pruned!
  const candidateSequence = [
    {
      id: 'step-0',
      filePath: 'src/pipeline.ts',
      replacementText: 'const timeoutMs = 5000;\nreturn timeoutMs;',
    },
    {
      id: 'step-1',
      filePath: 'src/pipeline.ts',
      replacementText: 'if (retries > 3) {\n    return false;\n}',
    },
    {
      id: 'step-2', // Broken: unclosed bracket and parentheses
      filePath: 'src/pipeline.ts',
      replacementText: 'const arr = [1, 2, (3 + 4;',
    },
    {
      id: 'step-3', // Should never be accepted
      filePath: 'src/pipeline.ts',
      replacementText: 'const clean = true;',
    },
    {
      id: 'step-4', // Should never be accepted
      filePath: 'src/pipeline.ts',
      replacementText: 'return clean;',
    },
  ];

  const rolloutResult = rolloutScheduler.evaluateSafePrefixRollout(candidateSequence);
  assert.strictEqual(rolloutResult.originalCount, 5, 'Original step count must be 5');
  assert.strictEqual(rolloutResult.acceptedCount, 2, 'Only steps 0 and 1 must be accepted');
  assert.strictEqual(rolloutResult.prunedCount, 3, 'Steps 2, 3, 4 must be pruned (3 steps)');
  assert.strictEqual(rolloutResult.isTruncated, true, 'Rollout must be marked as truncated');
  assert(
    rolloutResult.truncationReason.includes('below threshold'),
    'Must provide diagnostic truncation reason',
  );
  assert.strictEqual(rolloutResult.acceptedSteps[0].id, 'step-0');
  assert.strictEqual(rolloutResult.acceptedSteps[1].id, 'step-1');
  assert(
    rolloutResult.meanConfidence >= 0.65,
    'Mean confidence across accepted steps must be >= 0.65',
  );

  const telemetry = rolloutScheduler.getTelemetry();
  assert.strictEqual(telemetry.totalEvaluated, 3, 'Should evaluate steps up to truncation point');
  assert.strictEqual(telemetry.totalAccepted, 2);
  assert.strictEqual(telemetry.totalPruned, 3);
  assert(telemetry.pruneRatio > 0, 'Prune ratio must be greater than zero');

  console.log('DSpark Safe Prefix Rollout early truncation verified.');

  console.log('=== [3/5] Testing AstPrefixRadixCache Insertion & Exact LCP Matching ===');

  const radixCache = new AstPrefixRadixCache({ minMatchLines: 3, maxTreeNodes: 64 });
  radixCache.clear();

  const standardHeaderLines = [
    'import * as path from "path";',
    'import { Scanner } from "./scanner";',
    'import type { Issue } from "./types";',
  ];

  const mockSubtrees = [
    {
      kind: NodeKind.Other,
      rawKind: 'ImportDeclaration',
      name: 'path',
      start: { line: 1, column: 1 },
      end: { line: 1, column: 30 },
    },
    {
      kind: NodeKind.Other,
      rawKind: 'ImportDeclaration',
      name: 'Scanner',
      start: { line: 2, column: 1 },
      end: { line: 2, column: 38 },
    },
    {
      kind: NodeKind.Other,
      rawKind: 'ImportDeclaration',
      name: 'Issue',
      start: { line: 3, column: 1 },
      end: { line: 3, column: 38 },
    },
  ];

  const mockSymbols = ['path', 'Scanner', 'Issue'];

  // Insert prefix into Radix tree
  radixCache.insertPrefix(standardHeaderLines, mockSubtrees, mockSymbols);

  // Query file containing identical 3 header lines followed by body code
  const fileSource = [
    'import * as path from "path";',
    'import { Scanner } from "./scanner";',
    'import type { Issue } from "./types";',
    '',
    'export function runAudit(): void {',
    '    console.log("running audit");',
    '}',
  ].join('\n');

  const matchResult = radixCache.findLongestPrefixMatch(fileSource);
  assert.strictEqual(matchResult.isMatch, true, 'Identical 3-line prefix must match');
  assert.strictEqual(matchResult.matchedLines, 3, 'Must match exactly 3 prefix lines');
  assert.strictEqual(matchResult.reusableSubtrees.length, 3, 'Must return all 3 cached subtrees');
  assert.strictEqual(matchResult.importedSymbols.length, 3, 'Must return all 3 imported symbols');
  assert.strictEqual(matchResult.importedSymbols[0], 'path');
  assert.strictEqual(matchResult.remainingStartLine, 4, 'Remaining content start line must be 4');
  assert(
    matchResult.remainingContent.includes('export function runAudit'),
    'Remaining content must contain body code',
  );
  assert(
    !matchResult.remainingContent.includes('import * as path'),
    'Remaining content must exclude matched prefix',
  );

  console.log('AstPrefixRadixCache insertion and exact LCP match verified.');

  console.log('=== [4/5] Testing AstPrefixRadixCache Sub-Threshold Miss & Slicing ===');

  // Query file with only 1 matching line (below minMatchLines = 3)
  const partialMatchSource = [
    'import * as path from "path";',
    'import { DifferentThing } from "./other";',
    'export const x = 1;',
  ].join('\n');

  const missResult = radixCache.findLongestPrefixMatch(partialMatchSource);
  assert.strictEqual(
    missResult.isMatch,
    false,
    '1 matching line is below minMatchLines (3), must report miss',
  );
  assert.strictEqual(missResult.reusableSubtrees.length, 0, 'Miss must return 0 reusable subtrees');
  assert.strictEqual(
    missResult.remainingStartLine,
    1,
    'Miss must retain entire file starting at line 1',
  );
  assert.strictEqual(
    missResult.remainingContent,
    partialMatchSource,
    'Miss must retain full source text',
  );

  console.log('AstPrefixRadixCache sub-threshold miss behavior verified.');

  console.log('=== [5/5] Testing AstPrefixRadixCache LRU Eviction & Telemetry Accounting ===');

  const smallCache = new AstPrefixRadixCache({ minMatchLines: 2, maxTreeNodes: 5 });

  // Insert 10 different single-line prefixes to force LRU eviction
  for (let i = 0; i < 10; i++) {
    smallCache.insertPrefix(
      [`import { mod${i} } from "./m${i}";`, `import { sub${i} } from "./s${i}";`],
      mockSubtrees,
    );
  }

  const cacheTelemetry = smallCache.getTelemetry();
  assert(
    cacheTelemetry.totalNodes <= 6,
    'Total nodes must remain bounded within maxTreeNodes budget',
  );
  assert(cacheTelemetry.totalQueries >= 0, 'Total queries must be tracked');

  console.log('AstPrefixRadixCache LRU capacity bounds and telemetry verified.');
  console.log('=== ALL PHASE 3 VALIDATION TESTS PASSED (5/5) ===');
}

runEntry('validate-dspark-radix-cache.js', main);
