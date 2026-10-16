/**
 * Module: Unit Tests — File Domain Layout and Parameter Bounds Analyzer Suite
 * File Path: tests/unit/analyzers/file-domain-layout-and-parameters.test.ts
 * Architecture Role: Comprehensive verification suite for advanced file domain layout monotonicity
 *   (CMT-HDR-004, DEP-ORD-002, CONST-LAY-002) and polyglot parameter count bounds (SIM-ARGS-001, SIM-ARGS-002).
 * Dependencies & Triggers: Consumes CommentsAnalyzer, DependencyLayoutAnalyzer, SimplifyAnalyzer,
 *   checkConstantLayoutAndScope, and multi-language adapters (TS, Python, GDScript, Go).
 * Responsibilities: Verify strict layout order invariants and parameter count checks across languages.
 * Exit Semantics & Design Rationale: Deterministic test suite; runs under Vitest in both CI and local test suites.
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { CommentAnalyzer } from '../../../src/analyzers/comments';
import { DependencyLayoutAnalyzer } from '../../../src/analyzers/dependency-layout';
import { SimplifyAnalyzer } from '../../../src/analyzers/simplify';
import { checkConstantLayoutAndScope } from '../../../src/core/governance/constant-layout-guard';
import { PythonAdapter } from '../../../src/core/ast/python-adapter';
import { GDScriptAdapter } from '../../../src/core/ast/gdscript-adapter';
import { GoAdapter } from '../../../src/core/ast/go-adapter';
import type { AnalyzerContext, ScanConfig, LanguageAdapter } from '../../../src/core/types';

function createContext(
    filePath: string,
    content: string,
    adapter?: LanguageAdapter,
): AnalyzerContext {
    return {
        filePath,
        content,
        root: undefined as any,
        adapter: adapter as any,
        config: {
            root: '/fake-root',
            analyzers: {
                comments: {
                    enabled: true,
                    options: { level: 'strict', requireHeader: true },
                },
                simplify: {
                    enabled: true,
                    options: { maxFunctionParameters: 4 },
                },
                'dependency-layout': { enabled: true },
                constants: { enabled: true },
            },
        } as unknown as ScanConfig,
        options: {},
    };
}

describe('File Domain Layout Monotonicity & Parameter Count Bounds', () => {
    describe('CMT-HDR-004: File Header Placement & Horizon', () => {
        const commentsAnalyzer = new CommentAnalyzer();

        it('emits CMT-HDR-004 when executable code precedes the module header JSDoc', () => {
            const code = [
                'const EARLY_INIT = 42;',
                '/**',
                ' * Module: Test Module Header Inversion',
                ' * File Path: src/modules/sample.ts',
                ' * Architecture Role: Testing domain layout order',
                ' * Dependencies & Triggers: None',
                ' * Responsibilities: Verify inverted header smell',
                ' * Exit Semantics & Design Rationale: Deterministic',
                ' */',
                'export function run(): void {}',
            ].join('\n');

            const sf = ts.createSourceFile('src/modules/sample.ts', code, ts.ScriptTarget.Latest, true);
            const ctx = createContext('src/modules/sample.ts', code);
            const issues = commentsAnalyzer.analyze(sf, ctx);

            const invertedIssue = issues.find((i) => i.rule === 'CMT-HDR-004');
            expect(invertedIssue).toBeDefined();
            expect(invertedIssue?.rule).toBe('CMT-HDR-004');
            expect(invertedIssue?.message).toContain('inverted');
        });

        it('does not emit CMT-HDR-004 when module header JSDoc starts at the top', () => {
            const code = [
                '/**',
                ' * Module: Test Module Header Standard',
                ' * File Path: src/modules/sample.ts',
                ' * Architecture Role: Testing domain layout order',
                ' * Dependencies & Triggers: None',
                ' * Responsibilities: Verify standard header sequence',
                ' * Exit Semantics & Design Rationale: Deterministic',
                ' */',
                'const STANDARD_INIT = 42;',
                'export function run(): void {}',
            ].join('\n');

            const sf = ts.createSourceFile('src/modules/sample.ts', code, ts.ScriptTarget.Latest, true);
            const ctx = createContext('src/modules/sample.ts', code);
            const issues = commentsAnalyzer.analyze(sf, ctx);

            const invertedIssue = issues.find((i) => i.rule === 'CMT-HDR-004');
            expect(invertedIssue).toBeUndefined();
        });
    });

    describe('DEP-ORD-002: Dependency Import Horizon Inversion', () => {
        const depAnalyzer = new DependencyLayoutAnalyzer();

        it('emits DEP-ORD-002 when import occurs after business declarations', () => {
            const code = [
                '/**',
                ' * Module: Valid Header',
                ' * File Path: src/domain/service.ts',
                ' * Architecture Role: Service layer',
                ' * Dependencies & Triggers: None',
                ' * Responsibilities: Testing misplaced imports',
                ' * Exit Semantics & Design Rationale: Pure',
                ' */',
                'export function calculate(): number { return 1; }',
                'import { helper } from "./helper";',
            ].join('\n');

            const sf = ts.createSourceFile('src/domain/service.ts', code, ts.ScriptTarget.Latest, true);
            const ctx = createContext('src/domain/service.ts', code);
            const issues = depAnalyzer.analyze(sf, ctx);

            const horizonIssue = issues.find((i) => i.rule === 'DEP-ORD-002');
            expect(horizonIssue).toBeDefined();
            expect(horizonIssue?.rule).toBe('DEP-ORD-002');
            expect(horizonIssue?.message).toContain('horizon breach');
        });

        it('does not emit DEP-ORD-002 when imports strictly precede business logic', () => {
            const code = [
                '/**',
                ' * Module: Valid Header',
                ' * File Path: src/domain/service.ts',
                ' * Architecture Role: Service layer',
                ' * Dependencies & Triggers: None',
                ' * Responsibilities: Testing well-placed imports',
                ' * Exit Semantics & Design Rationale: Pure',
                ' */',
                'import { helper } from "./helper";',
                'export function calculate(): number { return helper(); }',
            ].join('\n');

            const sf = ts.createSourceFile('src/domain/service.ts', code, ts.ScriptTarget.Latest, true);
            const ctx = createContext('src/domain/service.ts', code);
            const issues = depAnalyzer.analyze(sf, ctx);

            const horizonIssue = issues.find((i) => i.rule === 'DEP-ORD-002');
            expect(horizonIssue).toBeUndefined();
        });
    });

    describe('CONST-LAY-002: Type Definition Order Inversion', () => {
        it('emits CONST-LAY-002 when type/interface appears after function or class declaration', () => {
            const code = [
                'import { Base } from "./base";',
                'export function executePlan(): void {}',
                'export interface LatePlanPayload {',
                '    id: string;',
                '}',
            ].join('\n');

            const issues = checkConstantLayoutAndScope(code, 'src/engine/planner.ts');
            const typeBreach = issues.find((i) => i.rule === 'CONST-LAY-002');

            expect(typeBreach).toBeDefined();
            expect(typeBreach?.rule).toBe('CONST-LAY-002');
            expect(typeBreach?.message).toContain('order violation');
        });

        it('does not emit CONST-LAY-002 when type/interface appears before functions and classes', () => {
            const code = [
                'import { Base } from "./base";',
                'export interface EarlyPlanPayload {',
                '    id: string;',
                '}',
                'export function executePlan(): void {}',
            ].join('\n');

            const issues = checkConstantLayoutAndScope(code, 'src/engine/planner.ts');
            const typeBreach = issues.find((i) => i.rule === 'CONST-LAY-002');

            expect(typeBreach).toBeUndefined();
        });
    });

    describe('SIM-ARGS-001: Multi-language Excessive Parameter Count', () => {
        const simplifyAnalyzer = new SimplifyAnalyzer();

        it('emits SIM-ARGS-001 on Python function with > 4 parameters', () => {
            const pyAdapter = new PythonAdapter();
            const pyCode = [
                'def dispatch_task(a, b, c, d, e):',
                '    return a + b + c + d + e',
            ].join('\n');

            const parsed = pyAdapter.parse(pyCode, 'src/tasks.py');
            const root = pyAdapter.root(parsed);
            const ctx = createContext('src/tasks.py', pyCode, pyAdapter);

            const issues = simplifyAnalyzer.analyze(root, ctx);
            const argsIssue = issues.find((i) => i.rule === 'SIM-ARGS-001');

            expect(argsIssue).toBeDefined();
            expect(argsIssue?.message).toContain('5 parameters');
        });

        it('emits SIM-ARGS-001 on GDScript function with > 4 parameters', () => {
            const gdAdapter = new GDScriptAdapter();
            const gdCode = [
                'func spawn_entity(x, y, z, rotation, velocity):',
                '    pass',
            ].join('\n');

            const parsed = gdAdapter.parse(gdCode, 'scripts/game/spawner.gd');
            const root = gdAdapter.root(parsed);
            const ctx = createContext('scripts/game/spawner.gd', gdCode, gdAdapter);

            const issues = simplifyAnalyzer.analyze(root, ctx);
            const argsIssue = issues.find((i) => i.rule === 'SIM-ARGS-001');

            expect(argsIssue).toBeDefined();
            expect(argsIssue?.message).toContain('5 parameters');
        });

        it('emits SIM-ARGS-001 on Go function with > 4 parameters', () => {
            const goAdapter = new GoAdapter();
            const goCode = [
                'package worker',
                'func ExecuteJob(a int, b int, c int, d int, e int) {',
                '}',
            ].join('\n');

            const parsed = goAdapter.parse(goCode, 'pkg/worker/job.go');
            const root = goAdapter.root(parsed);
            const ctx = createContext('pkg/worker/job.go', goCode, goAdapter);

            const issues = simplifyAnalyzer.analyze(root, ctx);
            const argsIssue = issues.find((i) => i.rule === 'SIM-ARGS-001');

            expect(argsIssue).toBeDefined();
            expect(argsIssue?.message).toContain('5 parameters');
        });
    });

    describe('SIM-ARGS-002: Semantic Handler/Solver Zero-Parameter Smell', () => {
        const simplifyAnalyzer = new SimplifyAnalyzer();

        it('emits SIM-ARGS-002 on TypeScript event handler with 0 parameters', () => {
            const code = [
                'export function handleMessage(): void {',
                '    console.log("no payload");',
                '}',
            ].join('\n');

            const sf = ts.createSourceFile('src/handler.ts', code, ts.ScriptTarget.Latest, true);
            const ctx = createContext('src/handler.ts', code);

            const issues = simplifyAnalyzer.analyze(sf, ctx);
            const zeroParamIssue = issues.find((i) => i.rule === 'SIM-ARGS-002');

            expect(zeroParamIssue).toBeDefined();
            expect(zeroParamIssue?.rule).toBe('SIM-ARGS-002');
            expect(zeroParamIssue?.message).toContain('handleMessage');
        });

        it('does not emit SIM-ARGS-002 when event handler has parameters', () => {
            const code = [
                'export function handleMessage(event: unknown): void {',
                '    console.log(event);',
                '}',
            ].join('\n');

            const sf = ts.createSourceFile('src/handler.ts', code, ts.ScriptTarget.Latest, true);
            const ctx = createContext('src/handler.ts', code);

            const issues = simplifyAnalyzer.analyze(sf, ctx);
            const zeroParamIssue = issues.find((i) => i.rule === 'SIM-ARGS-002');

            expect(zeroParamIssue).toBeUndefined();
        });

        it('does not emit SIM-ARGS-002 on exempt lifecycle hooks', () => {
            const code = [
                'export function onInit(): void {',
                '    setup();',
                '}',
            ].join('\n');

            const sf = ts.createSourceFile('src/lifecycle.ts', code, ts.ScriptTarget.Latest, true);
            const ctx = createContext('src/lifecycle.ts', code);

            const issues = simplifyAnalyzer.analyze(sf, ctx);
            const zeroParamIssue = issues.find((i) => i.rule === 'SIM-ARGS-002');

            expect(zeroParamIssue).toBeUndefined();
        });

        it('does not emit SIM-ARGS-002 on regular non-handler zero-parameter functions', () => {
            const code = [
                'export function calculateDefaultRatio(): number {',
                '    return 1.618;',
                '}',
            ].join('\n');

            const sf = ts.createSourceFile('src/math.ts', code, ts.ScriptTarget.Latest, true);
            const ctx = createContext('src/math.ts', code);

            const issues = simplifyAnalyzer.analyze(sf, ctx);
            const zeroParamIssue = issues.find((i) => i.rule === 'SIM-ARGS-002');

            expect(zeroParamIssue).toBeUndefined();
        });
    });
});
