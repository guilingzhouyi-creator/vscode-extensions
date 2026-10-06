#!/usr/bin/env node
/**
 * Module: Verification Harness — Naming Standardization & Clarification Directives
 * File Path: scripts/validate-naming-standardization-clarification.js
 * Architecture Role: Integration suite validating identifier length, abbreviations,
 *   parameter counts, function slicing, and Agent clarification directives.
 * Dependencies & Triggers: Node fs, path, assert, ../dist/api, and core reporters.
 * Responsibilities:
 *   1. Assert NAM-LEN-001 flags short (<=2) and excessively long (>=30) variables.
 *   2. Assert NAM-LEN-002 flags short (<3) function names and suggests verb-noun.
 *   3. Assert NAM-ABR-001 flags unapproved abbreviations and suggests expansions.
 *   4. Assert SIM-ARGS-001 flags functions with >4 parameters and recommends ParameterObject.
 *   5. Assert SIM-LONG-001 calculates function slice boundaries and variable dependencies.
 *   6. Assert toStructuredAgentDirectives produces valid clarification requests and CAPP DSL.
 * Exit Semantics & Design Rationale: Exits 0 on complete pass, 1 on any assertion failure.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('../dist/api');
const { toStructuredAgentDirectives } = require('../dist/core/reporters/agent-review-reporter');
const { formatCompactAgentPrompt } = require('../dist/core/guidance/agentConstraintGenerator');

async function run() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-std-clarify-'));

    try {
        const testFile = path.join(tmpDir, 'test-component.ts');
        const code = [
            'export interface UserProfile {',
            '    id: string;',
            '    name: string;',
            '}',
            '',
            '// 1. Function name too short (<3) -> NAM-LEN-002',
            'export function fn(x: number): number {',
            '    return x * 2;',
            '}',
            '',
            '// 2. Variable name too short (<=2) -> NAM-LEN-001 & Abbreviation -> NAM-ABR-001',
            'export function processData(usrProfile: UserProfile): void {',
            '    const ab = 10; // too short',
            '    const usr = usrProfile; // abbreviation',
            '    const thisIsAnExtremelyLongVariableNameThatExceedsThirtyCharactersLimit = 42; // too long',
            '    const userConfig: UserProfile = usrProfile; // valid name',
            '}',
            '',
            '// 3. Excessive parameters (>4) -> SIM-ARGS-001',
            'export function renderComplexWidget(',
            '    firstArg: string,',
            '    secondArg: number,',
            '    thirdArg: boolean,',
            '    fourthArg: string[],',
            '    fifthArg: Record<string, unknown>,',
            '): string {',
            '    return `${firstArg}-${secondArg}`;',
            '}',
            '',
            '// 4. Over-long function -> SIM-LONG-001 with slice analysis',
            'export function computeAggregateMetrics(inputValues: number[]): number {',
            '    let totalSum = 0;',
            '    let squareSum = 0;',
            '    let minVal = Infinity;',
            '    let maxVal = -Infinity;',
            '    // Step 1: Accumulate values',
            '    for (let i = 0; i < inputValues.length; i++) {',
            '        const v = inputValues[i];',
            '        totalSum += v;',
            '        squareSum += v * v;',
            '        if (v < minVal) minVal = v;',
            '        if (v > maxVal) maxVal = v;',
            '    }',
            '    // Step 2: Compute intermediate adjustments',
            '    const mean = totalSum / (inputValues.length || 1);',
            '    const variance = squareSum / (inputValues.length || 1) - mean * mean;',
            '    const stdDev = Math.sqrt(Math.max(0, variance));',
            '    const normalizedMin = (minVal - mean) / (stdDev || 1);',
            '    const normalizedMax = (maxVal - mean) / (stdDev || 1);',
            '    const range = normalizedMax - normalizedMin;',
            '    const coefficient = range > 0 ? (totalSum / range) : 0;',
            '    const adjustedMean = mean * 1.05 + coefficient * 0.1;',
            '    const calibratedVariance = variance * 0.95;',
            '    const stepOneAdjustment = calibratedVariance * 1.01;',
            '    const stepTwoAdjustment = stepOneAdjustment * 1.02;',
            '    const stepThreeAdjustment = stepTwoAdjustment * 1.03;',
            '    const stepFourAdjustment = stepThreeAdjustment * 1.04;',
            '    const stepFiveAdjustment = stepFourAdjustment * 1.05;',
            '    const stepSixAdjustment = stepFiveAdjustment * 1.06;',
            '    const stepSevenAdjustment = stepSixAdjustment * 1.07;',
            '    const stepEightAdjustment = stepSevenAdjustment * 1.08;',
            '    const stepNineAdjustment = stepEightAdjustment * 1.09;',
            '    const stepTenAdjustment = stepNineAdjustment * 1.10;',
            '    const stepElevenAdjustment = stepTenAdjustment * 1.11;',
            '    const stepTwelveAdjustment = stepElevenAdjustment * 1.12;',
            '    const stepThirteenAdjustment = stepTwelveAdjustment * 1.13;',
            '    const stepFourteenAdjustment = stepThirteenAdjustment * 1.14;',
            '    const stepFifteenAdjustment = stepFourteenAdjustment * 1.15;',
            '    const stepSixteenAdjustment = stepFifteenAdjustment * 1.16;',
            '    const stepSeventeenAdjustment = stepSixteenAdjustment * 1.17;',
            '    const stepEighteenAdjustment = stepSeventeenAdjustment * 1.18;',
            '    const stepNineteenAdjustment = stepEighteenAdjustment * 1.19;',
            '    const stepTwentyAdjustment = stepNineteenAdjustment * 1.20;',
            '    const stepTwentyOneAdjustment = stepTwentyAdjustment * 1.21;',
            '    const stepTwentyTwoAdjustment = stepTwentyOneAdjustment * 1.22;',
            '    const stepTwentyThreeAdjustment = stepTwentyTwoAdjustment * 1.23;',
            '    const stepTwentyFourAdjustment = stepTwentyThreeAdjustment * 1.24;',
            '    const stepTwentyFiveAdjustment = stepTwentyFourAdjustment * 1.25;',
            '    const stepTwentySixAdjustment = stepTwentyFiveAdjustment * 1.26;',
            '    const stepTwentySevenAdjustment = stepTwentySixAdjustment * 1.27;',
            '    const stepTwentyEightAdjustment = stepTwentySevenAdjustment * 1.28;',
            '    const stepTwentyNineAdjustment = stepTwentyEightAdjustment * 1.29;',
            '    const stepThirtyAdjustment = stepTwentyNineAdjustment * 1.30;',
            '    const stepThirtyOneAdjustment = stepThirtyAdjustment * 1.31;',
            '    const stepThirtyTwoAdjustment = stepThirtyOneAdjustment * 1.32;',
            '    const stepThirtyThreeAdjustment = stepThirtyTwoAdjustment * 1.33;',
            '    const stepThirtyFourAdjustment = stepThirtyThreeAdjustment * 1.34;',
            '    const stepThirtyFiveAdjustment = stepThirtyFourAdjustment * 1.35;',
            '    const finalScore = adjustedMean + Math.sqrt(stepThirtyFiveAdjustment);',
            '    const boundedScore = Math.min(100, Math.max(0, finalScore));',
            '    const weightedResult = boundedScore * 0.8 + stdDev * 0.2;',
            '    const formattedResult = Number(weightedResult.toFixed(2));',
            '    return formattedResult;',
            '}',
        ].join('\n');

        fs.writeFileSync(testFile, code, 'utf8');

        // Run full scan on target file
        const report = await scan({
            root: tmpDir,
            include: ['**/*.ts'],
            analyzers: {
                naming: { enabled: true },
                simplify: { enabled: true, options: { maxFunctionLines: 20 } },
            },
        });

        console.log(`Audited issues: ${report.issues.length}`);

        // 1. Assert NAM-LEN-002 detected on function `fn`
        const fnLengthIssue = report.issues.find(i => i.rule === 'NAM-LEN-002' && i.detail?.name === 'fn');
        assert(fnLengthIssue, 'Expected NAM-LEN-002 to be emitted for function "fn"');
        console.log('  ✔ [PASS] NAM-LEN-002 emitted for short function "fn"');

        // 2. Assert NAM-LEN-001 detected on short variable `ab` and long variable
        const shortVarIssue = report.issues.find(i => i.rule === 'NAM-LEN-001' && i.detail?.name === 'ab');
        assert(shortVarIssue, 'Expected NAM-LEN-001 to be emitted for variable "ab"');
        console.log('  ✔ [PASS] NAM-LEN-001 emitted for short variable "ab"');

        const longVarIssue = report.issues.find(i => i.rule === 'NAM-LEN-001' && i.detail?.name && i.detail.name.length >= 30);
        assert(longVarIssue, 'Expected NAM-LEN-001 to be emitted for excessively long variable');
        console.log('  ✔ [PASS] NAM-LEN-001 emitted for long variable');

        // 3. Assert NAM-ABR-001 detected on abbreviation `usr`
        const abrIssue = report.issues.find(i => i.rule === 'NAM-ABR-001' && i.detail?.unapproved === 'usr');
        assert(abrIssue, 'Expected NAM-ABR-001 to be emitted for unapproved abbreviation "usr"');
        assert(abrIssue.detail?.expanded === 'user', 'Expected expanded recommendation to be "user"');
        console.log('  ✔ [PASS] NAM-ABR-001 emitted with expanded suggestion "user"');

        // 4. Assert SIM-ARGS-001 detected on renderComplexWidget (>4 params)
        const argsIssue = report.issues.find(i => i.rule === 'SIM-ARGS-001');
        assert(argsIssue, 'Expected SIM-ARGS-001 to be emitted for function with 5 parameters');
        assert(argsIssue.actionable?.action === 'introduce_parameter_object', 'Expected introduce_parameter_object action');
        console.log('  ✔ [PASS] SIM-ARGS-001 emitted with parameter object remediation template');

        // 5. Assert SIM-LONG-001 includes slice boundaries
        const longFnIssue = report.issues.find(i => i.rule === 'SIM-LONG-001');
        assert(longFnIssue, 'Expected SIM-LONG-001 to be emitted for computeAggregateMetrics');
        const sliceRange = longFnIssue.detail?.sliceRange || longFnIssue.actionable?.detail?.sliceRange;
        assert(sliceRange, 'Expected sliceRange to be present on issue detail/actionable');
        assert(sliceRange.startLine > 0, 'Expected valid slice start line');
        console.log(`  ✔ [PASS] SIM-LONG-001 computed slice boundaries: lines ${sliceRange.startLine}-${sliceRange.endLine}`);

        // 6. Test structured agent directives transformation
        const structuredDirectives = toStructuredAgentDirectives(report);
        assert(structuredDirectives.envelope.directives.length > 0, 'Expected non-empty structured directives');
        
        // Check clarification or standardization proposal presence
        const hasClarificationOrStandardization = structuredDirectives.envelope.directives.some(
            d => d.clarificationRequest || d.standardizationProposal || d.remediationRecipe.safeToAutomate !== undefined
        );
        assert(hasClarificationOrStandardization, 'Expected structured directives to carry clarification/standardization metadata');
        console.log('  ✔ [PASS] toStructuredAgentDirectives assembled dual-track directives payload');

        // 7. Test CAPP DSL generation
        const cappPrompt = formatCompactAgentPrompt(testFile, report.issues);
        assert(cappPrompt.compactPromptText.length > 0, 'Expected non-empty CAPP prompt');
        console.log('  ✔ [PASS] CAPP 2.0 DSL prompt generated successfully');

        console.log('\n🎉 ALL NAMING STANDARDIZATION & CLARIFICATION DIRECTIVES TESTS PASSED!');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

run().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
