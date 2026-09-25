/**
 * Module: Unit Tests — Simplification Analyzer Rules
 * File Path: tests/unit/simplify-rules.test.ts
 * Architecture Role: Integration test suite for three representative simplify
 *     analyzer rules (SIM-ELSE-001, SIM-BOOL-001, SIM-GUARD-001).
 * Migrated from: scripts/validate-simplify.js (selected rules)
 * Test Type: Analyzer rule test (integration-style, runs full scan on fixture files)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Integration test uses compiled dist/ to match the production code path.
// The full scan pipeline relies on dynamic require() for adapter loading,
// which works correctly with the CJS-compiled dist output.
const { scan } = require('../../dist/api') as typeof import('../../src/api');
import type { Issue } from '../../src/core/types';

interface FixtureMap {
    [filename: string]: string;
}

const FIXTURES: FixtureMap = {
    // SIM-ELSE-001 fixtures
    'redundant_else_return.ts': [
        'export function check(val: number): string {',
        '    if (val > 0) {',
        '        return "positive";',
        '    } else {',
        '        return "non-positive";',
        '    }',
        '}',
    ].join('\n'),
    'redundant_else_throw.ts': [
        'export function check(val: number): void {',
        '    if (val < 0) {',
        '        throw new Error("negative");',
        '    } else {',
        '        processValue(val);',
        '    }',
        '}',
    ].join('\n'),
    'redundant_else_break.ts': [
        'export function find(arr: number[], target: number): number {',
        '    let result = -1;',
        '    for (let i = 0; i < arr.length; i++) {',
        '        if (arr[i] === target) {',
        '            result = i;',
        '            break;',
        '        } else {',
        '            continue;',
        '        }',
        '    }',
        '    return result;',
        '}',
    ].join('\n'),
    'redundant_else_continue.ts': [
        'export function process(arr: number[]): void {',
        '    for (const x of arr) {',
        '        if (x < 0) {',
        '            continue;',
        '        } else {',
        '            handleValue(x);',
        '        }',
        '    }',
        '}',
    ].join('\n'),
    'no_else_if.ts': [
        'export function check(val: number): string {',
        '    if (val > 0) {',
        '        return "positive";',
        '    }',
        '    return "non-positive";',
        '}',
    ].join('\n'),

    // SIM-BOOL-001 fixtures
    'bool_return_ifelse.ts': [
        'export function isPositive(val: number): boolean {',
        '    if (val > 0) {',
        '        return true;',
        '    } else {',
        '        return false;',
        '    }',
        '}',
    ].join('\n'),
    'bool_return_ternary.ts': [
        'export function isPositive(val: number): boolean {',
        '    return val > 0 ? true : false;',
        '}',
    ].join('\n'),
    'bool_return_noelse.ts': [
        'export function isPositive(val: number): boolean {',
        '    if (val > 0) return true;',
        '    return false;',
        '}',
    ].join('\n'),
    'bool_return_normal.ts': [
        'export function getFlag(flag: boolean): boolean {',
        '    return flag;',
        '}',
    ].join('\n'),
    'bool_return_complex.ts': [
        'export function check(val: number): boolean {',
        '    if (val > 0) {',
        '        trackPositive(val);',
        '        return true;',
        '    } else {',
        '        trackNonPositive(val);',
        '        return false;',
        '    }',
        '}',
    ].join('\n'),

    // SIM-GUARD-001 fixtures
    'guard_clauses_3.ts': [
        'export function process(a: number, b: number, c: number): number {',
        '    if (a <= 0) {',
        '        return -1;',
        '    }',
        '    if (b <= 0) {',
        '        return -2;',
        '    }',
        '    if (c <= 0) {',
        '        return -3;',
        '    }',
        '    return a + b + c;',
        '}',
    ].join('\n'),
    'guard_clauses_2.ts': [
        'export function process(a: number, b: number): number {',
        '    if (a <= 0) {',
        '        return -1;',
        '    }',
        '    if (b <= 0) {',
        '        return -2;',
        '    }',
        '    return a + b;',
        '}',
    ].join('\n'),
    'guard_clauses_middle.ts': [
        'export function process(arr: number[]): number {',
        '    let sum = 0;',
        '    for (const x of arr) {',
        '        if (x < 0) return -1;',
        '        if (x === 0) return 0;',
        '        if (x > 100) return 100;',
        '        sum += x;',
        '    }',
        '    return sum;',
        '}',
    ].join('\n'),
    'guard_clauses_throw.ts': [
        'export function process(a: number, b: number, c: number): number {',
        '    if (a <= 0) throw new Error("a");',
        '    if (b <= 0) throw new Error("b");',
        '    if (c <= 0) throw new Error("c");',
        '    return a + b + c;',
        '}',
    ].join('\n'),
    'guard_clauses_mixed.ts': [
        'export function process(a: number, b: number): number {',
        '    if (a <= 0) { return -1; }',
        '    let result = a * 2;',
        '    if (b <= 0) return -2;',
        '    return result + b;',
        '}',
    ].join('\n'),
};

let testRoot: string;
let issues: Issue[];

function byRule(rule: string, issueList: Issue[] = issues): Issue[] {
    return issueList.filter((i) => i.rule === rule);
}

function filesForRule(rule: string): string[] {
    return byRule(rule).map((i) => i.location.file).sort();
}

describe('Simplify Analyzer Rules', () => {
    beforeAll(async () => {
        testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-simplify-vitest-'));

        // Write all fixture files
        for (const [name, content] of Object.entries(FIXTURES)) {
            const abs = path.join(testRoot, name);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content);
        }

        // Write config with guard clause options enabled
        const configPath = path.join(testRoot, 'ar.config.json');
        fs.writeFileSync(
            configPath,
            JSON.stringify({
                analyzers: {
                    simplify: {
                        options: { checkGuardClauses: true, maxGuardClauseNesting: 3 },
                    },
                },
            }),
        );

        // Run scan
        const report = await scan({
            root: testRoot,
            configFile: configPath,
            include: ['**/*.ts'],
            analyzers: ['simplify'],
            cache: false,
            daemon: 'off',
            logLevel: 'silent',
            respectGitignore: false,
            workers: 1,
        });

        issues = report.issues;
    });

    afterAll(() => {
        if (testRoot && fs.existsSync(testRoot)) {
            fs.rmSync(testRoot, { recursive: true, force: true });
        }
    });

    describe('SIM-ELSE-001 (redundant-else)', () => {
        it('flags if-return-else pattern', () => {
            expect(filesForRule('SIM-ELSE-001')).toContain('redundant_else_return.ts');
        });

        it('flags if-throw-else pattern', () => {
            expect(filesForRule('SIM-ELSE-001')).toContain('redundant_else_throw.ts');
        });

        it('flags if-break-else pattern', () => {
            expect(filesForRule('SIM-ELSE-001')).toContain('redundant_else_break.ts');
        });

        it('flags if-continue-else pattern', () => {
            expect(filesForRule('SIM-ELSE-001')).toContain('redundant_else_continue.ts');
        });

        it('does NOT flag if without else', () => {
            expect(filesForRule('SIM-ELSE-001')).not.toContain('no_else_if.ts');
        });

        it('has info severity', () => {
            const ruleIssues = byRule('SIM-ELSE-001');
            expect(ruleIssues.length).toBeGreaterThan(0);
            expect(ruleIssues.every((i) => i.severity === 'info')).toBe(true);
        });
    });

    describe('SIM-BOOL-001 (simplify-boolean-return)', () => {
        it('flags if/else true/false pattern', () => {
            expect(filesForRule('SIM-BOOL-001')).toContain('bool_return_ifelse.ts');
        });

        it('flags ternary true/false pattern', () => {
            expect(filesForRule('SIM-BOOL-001')).toContain('bool_return_ternary.ts');
        });

        it('flags if-return without else pattern', () => {
            expect(filesForRule('SIM-BOOL-001')).toContain('bool_return_noelse.ts');
        });

        it('does NOT flag normal boolean return', () => {
            expect(filesForRule('SIM-BOOL-001')).not.toContain('bool_return_normal.ts');
        });

        it('does NOT flag if/else with side effects', () => {
            expect(filesForRule('SIM-BOOL-001')).not.toContain('bool_return_complex.ts');
        });

        it('has info severity', () => {
            const ruleIssues = byRule('SIM-BOOL-001');
            expect(ruleIssues.length).toBeGreaterThan(0);
            expect(ruleIssues.every((i) => i.severity === 'info')).toBe(true);
        });
    });

    describe('SIM-GUARD-001 (use-guard-clause)', () => {
        it('flags 3 consecutive if-return at function start', () => {
            expect(filesForRule('SIM-GUARD-001')).toContain('guard_clauses_3.ts');
        });

        it('flags 3 consecutive if-throw at function start', () => {
            expect(filesForRule('SIM-GUARD-001')).toContain('guard_clauses_throw.ts');
        });

        it('does NOT flag only 2 consecutive guard clauses (below threshold)', () => {
            expect(filesForRule('SIM-GUARD-001')).not.toContain('guard_clauses_2.ts');
        });

        it('does NOT flag nested ifs inside loops (not at function start)', () => {
            expect(filesForRule('SIM-GUARD-001')).not.toContain('guard_clauses_middle.ts');
        });

        it('does NOT flag when non-if statement breaks the sequence', () => {
            expect(filesForRule('SIM-GUARD-001')).not.toContain('guard_clauses_mixed.ts');
        });

        it('has info severity', () => {
            const ruleIssues = byRule('SIM-GUARD-001');
            expect(ruleIssues.length).toBeGreaterThan(0);
            expect(ruleIssues.every((i) => i.severity === 'info')).toBe(true);
        });
    });
});
