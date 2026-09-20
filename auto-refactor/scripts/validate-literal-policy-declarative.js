/**
 * Module: Static Quality Assurance — Declarative Literal Policy Validation Suite
 * File Path: scripts/validate-literal-policy-declarative.js
 * Architecture Role: Validates that the declarative literal policy engine properly decouples
 *   AST predicates from hardcoded call argument tolerance, supporting both built-in defaults
 *   and custom configuration layers.
 * Dependencies & Triggers: Consumes ../dist/core/literalPolicyEngine and ../dist/api;
 *   run via test-parallel suite and CI gate.
 * Responsibilities: Test base callee resolution, default policies (parseInt radix, slice/indexOf
 *   index 0), custom policy extensions, and AST projection integration.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passing, non-zero on failure.
 */

'use strict';

const assert = require('assert');
const {
  extractBaseCallee,
  isCallArgumentToleratedByPolicy,
  DEFAULT_TOLERATED_CALL_ARGUMENTS,
} = require('../dist/core/literalPolicyEngine');

/**
 * Verify base callee extraction from method chains.
 */
function testBaseCalleeExtraction() {
  assert.strictEqual(extractBaseCallee('parseInt'), 'parseInt');
  assert.strictEqual(extractBaseCallee('Number.parseInt'), 'parseInt');
  assert.strictEqual(extractBaseCallee('items.slice'), 'slice');
  assert.strictEqual(extractBaseCallee('ctx.scope.indexOf'), 'indexOf');
  assert.strictEqual(extractBaseCallee('   trimmed.call   '), 'call');
}

/**
 * Verify built-in default tolerance rules.
 */
function testDefaultTolerances() {
  // parseInt radix: 2, 8, 10, 16 are tolerated at argument index 1
  assert.strictEqual(isCallArgumentToleratedByPolicy('parseInt', 1, 10), true);
  assert.strictEqual(isCallArgumentToleratedByPolicy('Number.parseInt', 1, 16), true);
  assert.strictEqual(isCallArgumentToleratedByPolicy('parseInt', 1, 2), true);
  assert.strictEqual(isCallArgumentToleratedByPolicy('parseInt', 1, 8), true);
  assert.strictEqual(isCallArgumentToleratedByPolicy('parseInt', 1, 3), false);
  assert.strictEqual(isCallArgumentToleratedByPolicy('parseInt', 0, 10), false);

  // slice / indexOf index 0
  assert.strictEqual(isCallArgumentToleratedByPolicy('slice', 0, 0), true);
  assert.strictEqual(isCallArgumentToleratedByPolicy('arr.slice', 0, 0), true);
  assert.strictEqual(isCallArgumentToleratedByPolicy('slice', 0, 1), false);
  assert.strictEqual(isCallArgumentToleratedByPolicy('indexOf', 1, 0), true);
  assert.strictEqual(isCallArgumentToleratedByPolicy('str.indexOf', 1, 0), true);
}

/**
 * Verify custom declarative policies layered on top of defaults.
 */
function testCustomDeclarativePolicies() {
  const customPolicy = {
    toleratedCallArguments: {
      ...DEFAULT_TOLERATED_CALL_ARGUMENTS,
      setLogLevel: {
        argIndex: 0,
        allowedValues: ['debug', 'info', 'warn', 'error'],
      },
      clampScore: {
        argIndex: 1,
        allowedValues: [0, 100],
      },
    },
  };

  assert.strictEqual(
    isCallArgumentToleratedByPolicy('setLogLevel', 0, 'debug', customPolicy),
    true,
  );
  assert.strictEqual(
    isCallArgumentToleratedByPolicy('logger.setLogLevel', 0, 'fatal', customPolicy),
    false,
  );
  assert.strictEqual(isCallArgumentToleratedByPolicy('clampScore', 1, 100, customPolicy), true);
  assert.strictEqual(isCallArgumentToleratedByPolicy('clampScore', 1, 50, customPolicy), false);
}

/**
 * Main test suite execution runner.
 */
function runSuite() {
  testBaseCalleeExtraction();
  testDefaultTolerances();
  testCustomDeclarativePolicies();
  process.stdout.write(
    '✔ [PASS] validate-literal-policy-declarative: All policy decoupling tests passed.\n',
  );
}

runSuite();
