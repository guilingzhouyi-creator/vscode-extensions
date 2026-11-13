/**
 * Test Suite: Core Codemod — AST Transforms & Fix Dispatcher Integration
 * File Path: tests/unit/codemod/transforms.test.ts
 * Role: Validates AST transforms and AAS actionable patch synthesis across SSOT rule IDs.
 */

import { describe, expect, it } from 'vitest';
import {
    createSimplifyTernaryFix,
    createTernaryActionablePayload,
    RULE_SIM_TRN_001,
} from '../../../src/core/codemod/transforms/simplify-ternary';
import {
    createPassthroughActionablePayload,
    createPassthroughWrapperFix,
    RULE_HYG_WRAP_001,
} from '../../../src/core/codemod/transforms/passthrough-wrapper';
import {
    createDeadCodeActionablePayload,
    createDeadCodeCleanFix,
    RULE_HYG_DED_001,
} from '../../../src/core/codemod/transforms/dead-code-cleaner';
import {
    createJargonActionablePayload,
    createJargonCleanFix,
    RULE_HYG_STB_002,
} from '../../../src/core/codemod/transforms/jargon-cleaner';
import {
    createTransformContext,
    resolveSingleIssueFix,
} from '../../../src/core/codemod/transforms/fix-dispatcher';
import type { Issue } from '../../../src/core/types';

describe('Codemod Transforms & AAS Patches', () => {
    it('simplifies redundant if-else branches into ternary expressions (SIM-TRN-001)', () => {
        const source = [
            'function test(val: boolean) {',
            '    if (val) return 1; else return 2;',
            '}',
        ].join('\n');
        const context = createTransformContext('src/test.ts', source);
        const fix = createSimplifyTernaryFix(context, { line: 2 });

        expect(fix.ruleId).toBe(RULE_SIM_TRN_001);
        expect(fix.edits).toHaveLength(1);
        expect(fix.edits[0].newText).toBe('    return val ? 1 : 2;');

        const payload = createTernaryActionablePayload(2, 1, 2, 38, 'return val ? 1 : 2;');
        expect(payload.action).toBe('simplify_control_flow');
        expect(payload.patch?.replacementText).toBe('return val ? 1 : 2;');
    });

    it('melts trivial passthrough forwarding wrappers (HYG-WRAP-001)', () => {
        const source = [
            'const target = (x: number) => x * 2;',
            'export const wrapper = (x: number) => target(x);',
        ].join('\n');
        const context = createTransformContext('src/test.ts', source);
        const fix = createPassthroughWrapperFix(context, { line: 2 });

        expect(fix.ruleId).toBe(RULE_HYG_WRAP_001);
        expect(fix.edits).toHaveLength(1);
        expect(fix.edits[0].newText).toBe('export const wrapper = target;');

        const payload = createPassthroughActionablePayload(2, 1, 2, 49, 'const wrapper = target;');
        expect(payload.action).toBe('melt_trampoline');
        expect(payload.patch?.replacementText).toBe('const wrapper = target;');
    });

    it('prunes unreachable dead code following terminating statements (HYG-DED-001)', () => {
        const source = [
            'function test() {',
            '    return 42;',
            '    console.log("unreachable");',
            '}',
        ].join('\n');
        const context = createTransformContext('src/test.ts', source);
        const fix = createDeadCodeCleanFix(context, { line: 3 });

        expect(fix.ruleId).toBe(RULE_HYG_DED_001);
        expect(fix.edits).toHaveLength(1);
        expect(fix.edits[0].newText).toBe('');

        const payload = createDeadCodeActionablePayload(3, 1, 4, 1, '');
        expect(payload.action).toBe('simplify_control_flow');
        expect(payload.patch?.replacementText).toBe('');
    });

    it('sanitizes construction phase jargon from comments (HYG-STB-002)', () => {
        const source = [
            '// TODO: phase2 wip implementation for kernel',
            'const a = 1;',
        ].join('\n');
        const context = createTransformContext('src/test.ts', source);
        const fix = createJargonCleanFix(context, { line: 1 });

        expect(fix.ruleId).toBe(RULE_HYG_STB_002);
        expect(fix.edits).toHaveLength(1);
        expect(fix.edits[0].newText).not.toMatch(/phase2|wip/i);

        const payload = createJargonActionablePayload(1, 1, 1, 46, '// implementation for kernel');
        expect(payload.action).toBe('sanitize_prose_terminology');
        expect(payload.code).toBe('AR:HYG:002');
    });

    it('dispatches registered codemod fixes even without pre-existing actionable payload', () => {
        const source = [
            'function check(v: boolean) {',
            '    if (v) return 10; else return 20;',
            '}',
        ].join('\n');
        const context = createTransformContext('src/check.ts', source);
        const issue: Issue = {
            rule: RULE_SIM_TRN_001,
            message: 'Simplify if-else to ternary',
            severity: 'warning',
            location: {
                file: 'src/check.ts',
                start: { line: 2, column: 5 },
            },
        };

        const fix = resolveSingleIssueFix(issue, context);
        expect(fix).not.toBeNull();
        expect(fix?.ruleId).toBe(RULE_SIM_TRN_001);
        expect(fix?.edits[0].newText).toBe('    return v ? 10 : 20;');
    });
});
