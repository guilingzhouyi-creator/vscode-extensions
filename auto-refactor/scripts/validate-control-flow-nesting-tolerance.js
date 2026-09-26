/**
 * Module: Verification Harness — Context-Aware Control Flow Nesting & CFNI
 * File Path: scripts/validate-control-flow-nesting-tolerance.js
 * Architecture Role: Validates context-aware elastic depth budgets (parsers, state machines,
 *   short guards), rule emissions (CPX-NEST-001, CPX-NEST-002, CPX-STM-001), and CFNI scoring.
 * Dependencies & Triggers: Consumes ../dist/analyzers/complexity, ../dist/core/scoring/cognitive-cost-model;
 *   triggered by test-parallel.
 * Responsibilities: Exercise positive tolerance for legitimate nesting and strict detection
 *   for unbudgeted business nesting escapes.
 * Exit Semantics & Design Rationale: Process exits 0 on full success, 1 on assertion failure.
 */

'use strict';

const assert = require('assert');
const ts = require('typescript');
const { ComplexityAnalyzer } = require('../dist/analyzers/complexity');
const {
    calculateControlFlowNestingIndex,
    evaluateNetCognitiveCost,
} = require('../dist/core/scoring/cognitive-cost-model');

function createMockContext(filePath, content) {
    return {
        filePath,
        content,
        options: {
            complexityWarn: 12,
            complexityFail: 24,
        },
        config: {},
    };
}

function testStateMachineNestingTolerance() {
    console.log('--- 1. Testing State Machine Elastic Nesting Tolerance ---');
    const analyzer = new ComplexityAnalyzer();

    // Legitimate state machine with depth 4 inside switch cases (lines < 30 per case)
    const stateMachineCode = `
export function processPacketState(state: number, event: number, payload: any): number {
    switch (state) {
        case 1:
            if (event === 10) {
                while (payload.hasNext()) {
                    if (payload.readTag() === 0x42) {
                        return 2;
                    }
                }
            }
            break;
        case 2:
            if (event === 20) {
                for (const item of payload.items) {
                    if (item.valid) {
                        return 3;
                    }
                }
            }
            break;
        default:
            return 0;
    }
    return state;
}
`;

    const sourceFile = ts.createSourceFile('fsm.ts', stateMachineCode, ts.ScriptTarget.Latest, true);
    const issues = analyzer.analyze(sourceFile, createMockContext('src/protocol/fsm.ts', stateMachineCode));

    const nestIssue = issues.find((i) => i.rule === 'CPX-NEST-001');
    const escapeIssue = issues.find((i) => i.rule === 'CPX-NEST-002');
    assert(!nestIssue, 'State machine with depth 4 should be tolerated by elastic budget (up to 5)');
    assert(!escapeIssue, 'State machine local exit should not be flagged as deep long-span escape');
    console.log('  ✔ [PASS] State machine nesting within elastic budget tolerated.');
}

function testParserDescentNestingTolerance() {
    console.log('--- 2. Testing AST Parser Descent Nesting Tolerance ---');
    const analyzer = new ComplexityAnalyzer();

    // AST parser descending through expressions (depth 5)
    const parserCode = `
export function parseExpressionNode(cursor: any, stream: any): any {
    if (cursor.hasToken()) {
        const token = cursor.peek();
        if (token.isBinaryOperator()) {
            while (!stream.isEof()) {
                const sub = stream.nextToken();
                if (sub.isLiteral()) {
                    for (const modifier of sub.modifiers) {
                        return modifier;
                    }
                }
            }
        }
    }
    return null;
}
`;

    const sourceFile = ts.createSourceFile('expr_parser.ts', parserCode, ts.ScriptTarget.Latest, true);
    const issues = analyzer.analyze(sourceFile, createMockContext('src/parser/expr_parser.ts', parserCode));

    const nestIssue = issues.find((i) => i.rule === 'CPX-NEST-001');
    assert(!nestIssue, 'AST Parser with depth 5 should be tolerated by parser elastic budget');
    console.log('  ✔ [PASS] AST parser descent nesting within elastic budget tolerated.');
}

function testShortSpanGuardTolerance() {
    console.log('--- 3. Testing Short-Span Guard Tolerance (loc <= 25) ---');
    const analyzer = new ComplexityAnalyzer();

    const shortGuardCode = `
export function quickLockAcquire(mutex: any, timeout: number): boolean {
    if (mutex.isValid()) {
        if (!mutex.isLocked()) {
            if (mutex.acquire(timeout)) {
                if (mutex.verifyOwnership()) {
                    return true;
                }
            }
        }
    }
    return false;
}
`;

    const sourceFile = ts.createSourceFile('lock.ts', shortGuardCode, ts.ScriptTarget.Latest, true);
    const issues = analyzer.analyze(sourceFile, createMockContext('src/utils/lock.ts', shortGuardCode));

    const nestIssue = issues.find((i) => i.rule === 'CPX-NEST-001');
    assert(!nestIssue, 'Short-span guard routine (loc <= 25) with depth 4 should be exempt');
    console.log('  ✔ [PASS] Short-span guard tolerance verified.');
}

function testUnboundedBusinessNestingDetection() {
    console.log('--- 4. Testing Unbounded Business Logic Nesting Detection ---');
    const analyzer = new ComplexityAnalyzer();

    // Regular business service with unbudgeted depth (depth 4 > business budget 3)
    const badBusinessCode = `
export class OrderService {
    public processOrder(order: any, customer: any, inventory: any): boolean {
        if (order != null) {
            if (customer.isActive()) {
                if (inventory.hasStock(order.itemId)) {
                    if (order.amount > 0) {
                        for (let step = 0; step < 50; step++) {
                            console.log('padding step ' + step);
                        }
                        if (order.requiresAudit) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }
}
`;

    const sourceFile = ts.createSourceFile('order_service.ts', badBusinessCode, ts.ScriptTarget.Latest, true);
    const issues = analyzer.analyze(sourceFile, createMockContext('src/services/order_service.ts', badBusinessCode));

    const nestIssue = issues.find((i) => i.rule === 'CPX-NEST-001');
    assert(nestIssue !== undefined, 'Business logic with depth >= 4 must be flagged by CPX-NEST-001');
    assert(nestIssue.message.includes('exceeding elastic budget 3'), 'Issue message cites budget 3');
    console.log('  ✔ [PASS] CPX-NEST-001 unbudgeted business nesting flagged.');
}

function testStateMachineBranchDiscipline() {
    console.log('--- 5. Testing State Machine Branch Discipline (CPX-STM-001) ---');
    const analyzer = new ComplexityAnalyzer();

    let fatCaseBody = '';
    for (let i = 0; i < 40; i++) {
        fatCaseBody += `            const val_${i} = payload.compute_${i}();\n`;
    }

    const fatStateMachineCode = `
export function dispatchController(state: number, payload: any): void {
    switch (state) {
        case 1:
${fatCaseBody}
            break;
        default:
            break;
    }
}
`;

    const sourceFile = ts.createSourceFile('controller.ts', fatStateMachineCode, ts.ScriptTarget.Latest, true);
    const issues = analyzer.analyze(sourceFile, createMockContext('src/fsm/controller.ts', fatStateMachineCode));

    const stmIssue = issues.find((i) => i.rule === 'CPX-STM-001');
    assert(stmIssue !== undefined, 'Oversized state machine branch (>35 LOC) must trigger CPX-STM-001');
    assert.strictEqual(stmIssue.severity, 'info', 'CPX-STM-001 is reported with severity INFO');
    console.log('  ✔ [PASS] CPX-STM-001 state machine branch discipline verified.');
}

function testQuantitativeCFNIScoring() {
    console.log('--- 6. Testing Control Flow Nesting Index (CFNI) Quantitative Model ---');

    // 1. Perfectly budgeted parser routines (depth 5, role parser) -> CFNI should be 100
    const parserMetrics = [
        { name: 'parseNode', loc: 40, cc: 6, callDepth: 1, isForwardingWrapper: false, maxDepth: 5, nestingSpan: 20 },
        { name: 'parseToken', loc: 25, cc: 4, callDepth: 2, isForwardingWrapper: false, maxDepth: 4, nestingSpan: 10 },
    ];
    const parserResult = calculateControlFlowNestingIndex(parserMetrics, 'parser');
    assert.strictEqual(parserResult.cfni, 100, 'Parser routines within budget 5 should have CFNI 100');
    assert.strictEqual(parserResult.nestingPenalty, 0, 'No nesting penalty for budgeted parser');

    // 2. Business routine with unbudgeted depth (depth 5 > budget 3, role business)
    const businessMetrics = [
        { name: 'processBusiness', loc: 60, cc: 10, callDepth: 1, isForwardingWrapper: false, maxDepth: 5, nestingSpan: 50 },
    ];
    const businessResult = calculateControlFlowNestingIndex(businessMetrics, 'business');
    assert(businessResult.nestingPenalty > 0, 'Business routine exceeding budget 3 receives nesting penalty');
    assert(businessResult.cfni < 100, `CFNI is damped proportionally: ${businessResult.cfni} < 100`);

    // 3. Integration with evaluateNetCognitiveCost
    const cognitiveResult = evaluateNetCognitiveCost('src/services/order.ts', businessMetrics, 15);
    assert(typeof cognitiveResult.cfni === 'number', 'evaluateNetCognitiveCost returns numeric cfni');
    assert(typeof cognitiveResult.nestingPenalty === 'number', 'evaluateNetCognitiveCost returns numeric nestingPenalty');
    console.log('  ✔ [PASS] CFNI quantitative model and scoring integration verified.');
}

function runAll() {
    testStateMachineNestingTolerance();
    testParserDescentNestingTolerance();
    testShortSpanGuardTolerance();
    testUnboundedBusinessNestingDetection();
    testStateMachineBranchDiscipline();
    testQuantitativeCFNIScoring();
    console.log('\n========================================================');
    console.log('🎉 ALL CONTROL FLOW NESTING TOLERANCE CHECKS PASSED!');
    console.log('========================================================\n');
}

runAll();
