#!/usr/bin/env node
/**
 * Module: Verification Harness — Net Cognitive Cost & Anti-Gaming Governance
 * File Path: scripts/validate-cognitive-cost-anti-gaming.js
 * Architecture Role: Validates Net Cognitive Cost modeling, anti-mechanical splitting gaming
 *   safeguards (CPX-HOP-001), and integration with antiGaming scoring pipeline.
 * Dependencies & Triggers: Consumes evaluateNetCognitiveCost and isTrivialForwardingWrapper
 *   from ../dist/core/scoring/cognitive-cost-model, and detectScoreGaming;
 *   invoked by test runner.
 * Responsibilities: Assert trivial forwarding detection, net cognitive gain formula
 *   (DeltaCC - IndirectionPenalty), hop inflation penalty, and score gaming detection.
 * Exit Semantics & Design Rationale: Process exits 0 on all assertions passing, 1 on failure.
 */

'use strict';

const {
  evaluateNetCognitiveCost,
  isTrivialForwardingWrapper,
} = require('../dist/core/scoring/cognitive-cost-model');
const { detectScoreGaming } = require('../dist/core/scoring/antiGaming');

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
  console.log('--- 1. Testing Trivial Forwarding Wrapper Recognition ---');
  {
    const trivial1 = 'return this.service.fetchData(id);';
    const trivial2 = 'return calculate(a, b);';
    const trivial3 = 'this.logger.log(msg);';
    const nonTrivial = `
      if (a > 10) {
        return a * 2;
      }
      return a + b;
    `;

    assert(
      isTrivialForwardingWrapper(trivial1),
      'Identifies single-line delegate return as trivial forwarder',
    );
    assert(
      isTrivialForwardingWrapper(trivial2),
      'Identifies helper call return as trivial forwarder',
    );
    assert(isTrivialForwardingWrapper(trivial3), 'Identifies void forwarder as trivial');
    assert(
      !isTrivialForwardingWrapper(nonTrivial),
      'Identifies branch logic as non-trivial function',
    );
  }

  console.log('--- 2. Testing Authentic Refactoring (Positive Net Cognitive Gain) ---');
  {
    // A refactoring that genuinely simplified a monster function (CC 25 -> 8)
    // without creating useless forwarding wrappers
    const functions = [
      { name: 'parseHeader', loc: 15, cc: 4, callDepth: 1, isForwardingWrapper: false },
      { name: 'parseBody', loc: 20, cc: 6, callDepth: 1, isForwardingWrapper: false },
      { name: 'parseTrailer', loc: 10, cc: 3, callDepth: 1, isForwardingWrapper: false },
      { name: 'orchestrate', loc: 12, cc: 4, callDepth: 0, isForwardingWrapper: false },
    ];

    const result = evaluateNetCognitiveCost('src/parser.ts', functions, 25);
    assert(!result.isGaming, 'Authentic refactoring is not classified as gaming');
    assert(
      result.netCognitiveGain > 10,
      `Authentic refactoring achieves positive net cognitive gain: ${result.netCognitiveGain}`,
    );
    assert(result.issues.length === 0, 'No CPX-HOP-001 issues for authentic refactoring');
  }

  console.log('--- 3. Testing Mechanical Decomposition Gaming (CPX-HOP-001) ---');
  {
    // A file chopped up mechanically into trivial forwarding wrappers
    // to "game" complexity metrics, inflating call hops
    const functions = [
      { name: 'forwardA', loc: 2, cc: 1, callDepth: 1, isForwardingWrapper: true },
      { name: 'forwardB', loc: 2, cc: 1, callDepth: 2, isForwardingWrapper: true },
      { name: 'forwardC', loc: 2, cc: 1, callDepth: 3, isForwardingWrapper: true },
      { name: 'forwardD', loc: 2, cc: 1, callDepth: 4, isForwardingWrapper: true },
      { name: 'actualWork', loc: 30, cc: 15, callDepth: 5, isForwardingWrapper: false },
    ];

    const result = evaluateNetCognitiveCost('src/gaming_controller.ts', functions, 16);
    assert(result.isGaming, 'Classifies mechanical wrapper explosion as gaming');
    assert(result.hopPenalty >= 6, `Accumulates hop depth penalty: ${result.hopPenalty}`);
    const hopIssue = result.issues.find((i) => i.rule === 'CPX-HOP-001');
    assert(hopIssue !== undefined, 'Emits CPX-HOP-001 for mechanical call hop inflation');
    assert(
      hopIssue && hopIssue.message.includes('trivial forwarding wrappers'),
      'CPX-HOP-001 explains forwarding wrapper inflation in message',
    );
  }

  console.log('--- 4. Testing Integrated Score Gaming Detection ---');
  {
    const gamingSource = `
      export class FacadeService {
        methodA(x) { return this.worker.methodA(x); }
        methodB(x) { return this.worker.methodB(x); }
        methodC(x) { return this.worker.methodC(x); }
        methodD(x) { return this.worker.methodD(x); }
        methodE(x) { return this.worker.methodE(x); }
      }
    `;

    const result = detectScoreGaming('src/facade.ts', gamingSource);
    assert(result.hasGaming, 'detectScoreGaming flags excessive trivial forwarders');
    const hopIssue = result.issues.find((i) => i.rule === 'CPX-HOP-001');
    assert(hopIssue !== undefined, 'Integrated antiGaming emits CPX-HOP-001');
  }

  console.log('--- 5. Testing Small Pure Utilities Exemption (loc <= 3, not forwarding) ---');
  {
    // Small pure helpers that do not delegate to other methods
    const pureHelpers = [
      { name: 'clamp', loc: 3, cc: 2, callDepth: 1, isForwardingWrapper: false },
      { name: 'min', loc: 2, cc: 1, callDepth: 1, isForwardingWrapper: false },
      { name: 'max', loc: 2, cc: 1, callDepth: 1, isForwardingWrapper: false },
      { name: 'computeSum', loc: 8, cc: 3, callDepth: 1, isForwardingWrapper: false },
    ];

    const result = evaluateNetCognitiveCost('src/math_utils.ts', pureHelpers, 10);
    assert(!result.isGaming, 'Small pure utility helpers are NOT marked as gaming');
    assert(result.wrapperCount === 0, 'Small pure utilities have 0 forwarding wrappers');
    assert(result.issues.length === 0, 'No CPX-HOP-001 emitted for pure utilities');
  }

  console.log(`\nNet Cognitive Cost & Anti-Gaming Tests: ${passedCount}/${totalCount} passed.`);
  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runTests();
