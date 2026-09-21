#!/usr/bin/env node
/**
 * Module: Verification Harness — Function Cohesion & Execution Skeleton Discovery
 * File Path: scripts/validate-function-cohesion-skeleton.js
 * Architecture Role: Validates detection of intra-file responsibility aggregation (ARCH-BLR-001)
 *   and execution skeleton / strategy pattern opportunities (ARCH-SKL-001).
 * Dependencies & Triggers: Consumes analyzeFunctionCohesionAndSkeleton from
 *   ../dist/core/intelligence/function-cohesion-skeleton; invoked by test runner.
 * Responsibilities: Assert Jaccard token overlap for blurred boundaries, verify shared
 *   prologue/epilogue matching for strategy extraction, check false positive resistance.
 * Exit Semantics & Design Rationale: Process exits 0 on all assertions passing, 1 on failure.
 */

'use strict';

const {
  analyzeFunctionCohesionAndSkeleton,
} = require('../dist/core/intelligence/function-cohesion-skeleton');

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
  console.log('--- 1. Testing Blurred Boundaries / Low Cohesion (ARCH-BLR-001) ---');
  {
    // Two functions in the same file with completely disparate responsibilities:
    // fnA: handles user crypto authentication
    // fnB: handles 3D particle mesh vertex rendering
    const fns = [
      {
        name: 'authenticateUserToken',
        startLine: 1,
        endLine: 25,
        cc: 12,
        lines: [
          'export function authenticateUserToken(jwt: string, secretKey: string, db: DatabaseSession) {',
          '  const decoded = crypto.verify(jwt, secretKey);',
          '  if (!decoded) throw new AuthError("invalid token");',
          '  const user = db.findUser(decoded.userId);',
          '  if (user.isSuspended) throw new AccountLocked();',
          '  return user.permissions;',
          '}',
        ],
      },
      {
        name: 'renderParticleMesh',
        startLine: 30,
        endLine: 60,
        cc: 12,
        lines: [
          'export function renderParticleMesh(vertexBuffer: Float32Array, shader: GLShader, matrix: Mat4) {',
          '  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);',
          '  gl.useProgram(shader.program);',
          '  gl.uniformMatrix4fv(shader.u_matrix, false, matrix);',
          '  gl.drawArrays(gl.TRIANGLES, 0, vertexBuffer.length / 3);',
          '}',
        ],
      },
    ];

    const result = analyzeFunctionCohesionAndSkeleton('src/mixed_god_file.ts', fns);
    const blrIssue = result.issues.find((i) => i.rule === 'ARCH-BLR-001');
    assert(blrIssue !== undefined, 'Detected blurred boundaries / low cohesion (ARCH-BLR-001)');
    assert(
      blrIssue &&
        blrIssue.message.includes('authenticateUserToken') &&
        blrIssue.message.includes('renderParticleMesh'),
      'Identifies the disjoint functions in violation message',
    );
    assert(result.disjointPairs.length === 1, 'Records exactly 1 disjoint pair');
  }

  console.log('--- 2. Testing High Cohesion Coexistence (No False Positive) ---');
  {
    // Two functions working on the same domain data structure
    const cohesiveFns = [
      {
        name: 'calculateCartSubtotal',
        startLine: 1,
        endLine: 20,
        cc: 10,
        lines: [
          'function calculateCartSubtotal(cart: Cart, discounts: DiscountMap) {',
          '  let total = 0;',
          '  for (const item of cart.items) {',
          '    const discount = discounts.get(item.id) || 0;',
          '    total += item.price * item.quantity * (1 - discount);',
          '  }',
          '  return total;',
          '}',
        ],
      },
      {
        name: 'calculateCartTaxes',
        startLine: 25,
        endLine: 45,
        cc: 10,
        lines: [
          'function calculateCartTaxes(cart: Cart, taxRate: number) {',
          '  let taxTotal = 0;',
          '  for (const item of cart.items) {',
          '    taxTotal += item.price * item.quantity * taxRate;',
          '  }',
          '  return taxTotal;',
          '}',
        ],
      },
    ];

    const result = analyzeFunctionCohesionAndSkeleton('src/domain/cart_pricing.ts', cohesiveFns);
    const blrIssue = result.issues.find((i) => i.rule === 'ARCH-BLR-001');
    assert(blrIssue === undefined, 'High cohesion functions do NOT trigger ARCH-BLR-001');
  }

  console.log('--- 3. Testing Execution Skeleton Discovery (ARCH-SKL-001) ---');
  {
    // Two pipeline processing routines with identical prologue and epilogue phases:
    // Prologue: validateRequest(); telemetry.startSpan();
    // Epilogue: telemetry.endSpan(); cache.set(); return response;
    const skeletonFns = [
      {
        name: 'handleSyncPayment',
        startLine: 1,
        endLine: 35,
        cc: 11,
        lines: [
          'async function handleSyncPayment(req: Request) {',
          '  validateRequest(req);',
          '  const span = telemetry.startSpan("payment");',
          '  // Specific body A',
          '  const gatewayRes = await stripe.charge(req.amount);',
          '  span.recordStatus("ok");',
          '  telemetry.endSpan(span);',
          '  return gatewayRes;',
          '}',
        ],
      },
      {
        name: 'handleAsyncPayment',
        startLine: 40,
        endLine: 75,
        cc: 11,
        lines: [
          'async function handleAsyncPayment(req: Request) {',
          '  validateRequest(req);',
          '  const span = telemetry.startSpan("payment");',
          '  // Specific body B',
          '  const kafkaRes = await eventBus.publish("payment_queue", req);',
          '  span.recordStatus("ok");',
          '  telemetry.endSpan(span);',
          '  return kafkaRes;',
          '}',
        ],
      },
    ];

    const result = analyzeFunctionCohesionAndSkeleton(
      'src/services/payment_orchestrator.ts',
      skeletonFns,
    );
    const sklIssue = result.issues.find((i) => i.rule === 'ARCH-SKL-001');
    assert(sklIssue !== undefined, 'Detected execution skeleton pattern candidate (ARCH-SKL-001)');
    assert(
      result.skeletonCandidates.length >= 1,
      'Identifies candidate functions sharing execution lifecycle skeleton',
    );
    assert(
      sklIssue && sklIssue.suggestion.toLowerCase().includes('template method'),
      'Suggestion recommends Template Method or Strategy Pattern',
    );
  }

  console.log('--- 4. Testing Parent-Child Helper Asymmetric Exemption (Overlap Coefficient) ---');
  {
    // Orchestrator function with many symbols
    const orchestratorLines = [
      'export function orchestrateCompilation(target: string, flags: FlagMap, ast: AstRoot, emitter: Emitter) {',
      '  const symbols = collectSymbols(ast);',
      '  const types = resolveTypes(symbols);',
      '  const ir = buildIntermediateRepresentation(types, flags);',
      '  const optimized = runOptimizationPasses(ir, flags);',
      '  const output = emitter.emitBinary(optimized, target);',
      '  return output;',
      '}',
    ];
    // Focused helper function whose symbols are a complete subset of orchestrator
    const helperLines = [
      'function runOptimizationPasses(ir: IntermediateRep, flags: FlagMap) {',
      '  if (flags.has("opt-dce")) ir.eliminateDeadCode();',
      '  if (flags.has("opt-inline")) ir.inlineFunctions();',
      '  return ir;',
      '}',
    ];

    const fns = [
      {
        name: 'orchestrateCompilation',
        startLine: 1,
        endLine: 40,
        cc: 14,
        lines: orchestratorLines,
      },
      {
        name: 'runOptimizationPasses',
        startLine: 45,
        endLine: 65,
        cc: 13,
        lines: helperLines,
      },
    ];

    const result = analyzeFunctionCohesionAndSkeleton('src/compiler.ts', fns);
    const blrIssue = result.issues.find((i) => i.rule === 'ARCH-BLR-001');
    assert(
      blrIssue === undefined,
      'Parent-child helper with high overlap coefficient is exempt from ARCH-BLR-001',
    );
  }

  console.log(`\nFunction Cohesion & Skeleton Tests: ${passedCount}/${totalCount} passed.`);
  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runTests();
