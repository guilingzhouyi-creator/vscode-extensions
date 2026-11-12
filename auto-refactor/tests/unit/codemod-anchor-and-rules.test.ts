/**
 * Module: Unit Test Suite — Codemod Anchor Resolution, AST Transforms, and Rule SSOT Integrity
 * File Path: tests/unit/codemod-anchor-and-rules.test.ts
 * Architecture Role: Validates insertAnchor constant hoisting, batch declaration deduplication,
 *   end-to-end TypeScript syntactic validity, and rule catalog registration.
 * Dependencies & Triggers: Consumes PatchEngine, extract-constant, registry, aliases,
 *   and TypeScript compiler APIs; executed by Vitest.
 * Responsibilities:
 *   1. Assert resolveConstantInsertionLine correctly handles shebangs, directives, and imports;
 *   2. Assert PatchEngine.issuesToFixes deduplicates shared constant declarations in batch;
 *   3. Assert that patched TypeScript output compiles cleanly with zero syntax diagnostics;
 *   4. Assert that transform dispatchers produce valid edits for boolean, unused imports, and contracts;
 *   5. Assert that magic-number and hardcoded-string are registered with proper SSOT metadata;
 *   6. Assert that CMT-* analyzer rules publish concrete remediation guidance.
 * Exit Semantics & Design Rationale: Deterministic in-memory unit tests; exits 0 on pass.
 */

import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { PatchEngine } from '../../src/core/codemod/patch-engine';
import {
    resolveConstantInsertionLine,
    resolveSafeConstantExtraction,
} from '../../src/core/codemod/transforms/extract-constant';
import { createTransformContext } from '../../src/core/codemod/transforms/fix-dispatcher';
import { getRule, RULE_REGISTRY } from '../../src/core/rules/registry';
import {
    LEGACY_RULE_ALIASES,
    canonicalRuleId,
    areAliasForms,
    auditAliasWindow,
} from '../../src/core/rules/aliases';
import { LEGACY_REASON_ID_NOT_CANONICAL } from '../../src/core/rules/types';
import { DIMENSION_RULES } from '../../src/core/scoring/dimensionRuleTable';
import type { Issue } from '../../src/core/types';
import { SEVERITY_WARNING } from '../../src/core/types';

describe('Codemod Anchor Resolution — Shebangs, Directives, and Imports', () => {
    it('locates anchor line immediately after multi-line imports', () => {
        const lines = [
            '#!/usr/bin/env node',
            "'use strict';",
            '',
            'import * as path from "path";',
            'import {',
            '    readFileSync,',
            '    writeFileSync,',
            '} from "fs";',
            '',
            'function main() {',
            '    return 1;',
            '}',
        ];

        const line = resolveConstantInsertionLine(lines);
        expect(line).toBe(9);
    });

    it('returns line 1 when file has no imports or directives', () => {
        const lines = ['function calculate() {', '    return 42;', '}'];

        const line = resolveConstantInsertionLine(lines);
        expect(line).toBe(1);
    });

    it('places anchor after use strict when no imports exist', () => {
        const lines = ["'use strict';", '', 'function run() {', '    return true;', '}'];

        const line = resolveConstantInsertionLine(lines);
        expect(line).toBe(2);
    });
});

describe('Safe Constant Extraction — Guard Assertions & Fail-Closed Behavior', () => {
    it('fails closed when target literal is inside an import declaration', () => {
        const source = 'import { something } from "./module-42";\n';
        const context = createTransformContext('test.ts', source);

        const extraction = resolveSafeConstantExtraction({
            context,
            ruleId: 'magic-number',
            targetSymbol: 'EXTRACTED_CONSTANT',
            replacementRange: { startLine: 1, startCol: 27, endLine: 1, endCol: 39 },
            literalValue: 42,
            description: 'Extract constant',
            safetyLevel: 'heuristic',
        });

        expect(extraction).toBeNull();
    });

    it('fails closed when target literal is an object property key', () => {
        const source = 'const obj = { 42: "value" };\n';
        const context = createTransformContext('test.ts', source);

        const extraction = resolveSafeConstantExtraction({
            context,
            ruleId: 'magic-number',
            targetSymbol: 'KEY_42',
            replacementRange: { startLine: 1, startCol: 15, endLine: 1, endCol: 17 },
            literalValue: 42,
            description: 'Extract constant',
            safetyLevel: 'heuristic',
        });

        expect(extraction).toBeNull();
    });
});

describe('Batch Constant Extraction & TypeScript Parser Integrity', () => {
    it('deduplicates shared constant declarations across multiple findings in the same file', () => {
        const source = [
            'import { config } from "./config";',
            '',
            'export function compute() {',
            '    const first = 42;',
            '    const second = 42;',
            '    return first + second;',
            '}',
        ].join('\n');

        const issues: Issue[] = [
            {
                id: 'constants:magic-number:src/compute.ts:4',
                analyzer: 'constants',
                rule: 'magic-number',
                severity: SEVERITY_WARNING,
                message: 'Avoid inline magic number',
                location: {
                    file: 'src/compute.ts',
                    start: { line: 4, column: 19 },
                    end: { line: 4, column: 21 },
                },
                detail: { value: 42 },
                actionable: {
                    action: 'extract_constant',
                    targetSymbol: 'MAX_RETRY_COUNT',
                    insertAnchor: { position: 'after_imports' },
                    patch: {
                        range: { startLine: 4, startCol: 19, endLine: 4, endCol: 21 },
                        replacementText: 'MAX_RETRY_COUNT',
                    },
                    safeToAutomate: true,
                },
            },
            {
                id: 'constants:magic-number:src/compute.ts:5',
                analyzer: 'constants',
                rule: 'magic-number',
                severity: SEVERITY_WARNING,
                message: 'Avoid inline magic number',
                location: {
                    file: 'src/compute.ts',
                    start: { line: 5, column: 20 },
                    end: { line: 5, column: 22 },
                },
                detail: { value: 42 },
                actionable: {
                    action: 'extract_constant',
                    targetSymbol: 'MAX_RETRY_COUNT',
                    insertAnchor: { position: 'after_imports' },
                    patch: {
                        range: { startLine: 5, startCol: 20, endLine: 5, endCol: 22 },
                        replacementText: 'MAX_RETRY_COUNT',
                    },
                    safeToAutomate: true,
                },
            },
        ];

        const fixes = PatchEngine.issuesToFixes(issues, source, 'src/compute.ts');
        expect(fixes).toHaveLength(2);

        const engine = new PatchEngine();
        const applied = engine.applyFixes('src/compute.ts', source, fixes, {
            dryRun: true,
            safetyThreshold: 'heuristic',
        });

        expect(applied.appliedFixCount).toBeGreaterThanOrEqual(2);
        expect(applied.patchedContent).toContain('const MAX_RETRY_COUNT = 42;');

        const declarationMatches = applied.patchedContent.match(/const MAX_RETRY_COUNT = 42;/g);
        expect(declarationMatches).toHaveLength(1);

        expect(applied.patchedContent).toContain('const first = MAX_RETRY_COUNT;');
        expect(applied.patchedContent).toContain('const second = MAX_RETRY_COUNT;');

        const parsedSource = ts.createSourceFile(
            'src/compute.ts',
            applied.patchedContent,
            ts.ScriptTarget.Latest,
            true,
        );
        expect(parsedSource.parseDiagnostics).toHaveLength(0);
    });

    it('fails closed when source text is missing for insertAnchor issue', () => {
        const issue: Issue = {
            id: 'constants:magic-number:src/fail.ts:1',
            analyzer: 'constants',
            rule: 'magic-number',
            severity: SEVERITY_WARNING,
            message: 'Extract constant',
            location: {
                file: 'src/fail.ts',
                start: { line: 1, column: 1 },
                end: { line: 1, column: 5 },
            },
            detail: { value: 100 },
            actionable: {
                action: 'extract_constant',
                targetSymbol: 'MAX_LIMIT',
                insertAnchor: { position: 'after_imports' },
                patch: {
                    range: { startLine: 1, startCol: 1, endLine: 1, endCol: 5 },
                    replacementText: 'MAX_LIMIT',
                },
            },
        };

        const fix = PatchEngine.issueToFix(issue);
        expect(fix).toBeNull();
    });
});

describe('Codemod Transforms Dispatcher Wiring', () => {
    it('dispatches boolean simplification for SIM-BOOL-001', () => {
        const source = 'const flag = a ? true : false;\n';
        const issue: Issue = {
            id: 'simplify:SIM-BOOL-001:test.ts:1',
            analyzer: 'simplify',
            rule: 'SIM-BOOL-001',
            severity: SEVERITY_WARNING,
            message: 'Simplify boolean ternary',
            location: {
                file: 'test.ts',
                start: { line: 1, column: 14 },
                end: { line: 1, column: 30 },
            },
            detail: {},
            actionable: {
                action: 'simplify_control_flow',
                patch: {
                    range: { startLine: 1, startCol: 14, endLine: 1, endCol: 30 },
                    replacementText: 'Boolean(a)',
                },
            },
        };

        const fix = PatchEngine.issueToFix(issue, source);
        expect(fix).not.toBeNull();
        expect(fix?.ruleId).toBe('SIM-BOOL-001');
    });

    it('dispatches unused import removal for HYG-DED-001', () => {
        const source = 'import { used, unused } from "./module";\n';
        const issue: Issue = {
            id: 'hygiene:HYG-DED-001:test.ts:1',
            analyzer: 'hygiene',
            rule: 'HYG-DED-001',
            severity: SEVERITY_WARNING,
            message: 'Unused import identifier',
            location: {
                file: 'test.ts',
                start: { line: 1, column: 16 },
                end: { line: 1, column: 22 },
            },
            detail: { unusedSymbol: 'unused' },
            actionable: {
                action: 'remove_unused_import',
            },
        };

        const fix = PatchEngine.issueToFix(issue, source);
        expect(fix).not.toBeNull();
        expect(fix?.ruleId).toBe('HYG-DED-001');
    });
});

describe('Rule SSOT, Legacy Aliases & Dimension Consistency', () => {
    it('registers magic-number and hardcoded-string with legacy non-canonical metadata', () => {
        const magicRule = getRule('magic-number');
        const stringRule = getRule('hardcoded-string');

        expect(magicRule).toBeDefined();
        expect(magicRule?.canonical).toBe(false);
        expect(magicRule?.legacyReason).toBe(LEGACY_REASON_ID_NOT_CANONICAL);
        expect(magicRule?.family).toBe('CONST');

        expect(stringRule).toBeDefined();
        expect(stringRule?.canonical).toBe(false);
        expect(stringRule?.legacyReason).toBe(LEGACY_REASON_ID_NOT_CANONICAL);
        expect(stringRule?.family).toBe('CONST');
    });

    it('maps legacy alias identifiers to 3-3-3 canonical equivalents', () => {
        expect(LEGACY_RULE_ALIASES['magic-number']).toBe('CST-NUM-001');
        expect(LEGACY_RULE_ALIASES['hardcoded-string']).toBe('CST-STR-001');

        expect(canonicalRuleId('magic-number')).toBe('CST-NUM-001');
        expect(canonicalRuleId('hardcoded-string')).toBe('CST-STR-001');

        expect(areAliasForms('magic-number', 'CST-NUM-001')).toBe(true);
        expect(areAliasForms('hardcoded-string', 'CST-STR-001')).toBe(true);

        const audit = auditAliasWindow();
        expect(audit.missingAlias).toHaveLength(0);
        expect(audit.unknownAlias).toHaveLength(0);
        expect(audit.malformedTarget).toHaveLength(0);
        expect(audit.duplicateTargets).toHaveLength(0);
    });

    it('resolves hardcoded-string and constants rules to duplication dimension', () => {
        const constantsRows = DIMENSION_RULES.filter((row) => row.analyzer === 'constants');
        expect(constantsRows.length).toBeGreaterThan(0);

        const dummyIssue: Issue = {
            id: 'mock:hardcoded-string:src/test.ts:1',
            analyzer: 'constants',
            rule: 'hardcoded-string',
            severity: SEVERITY_WARNING,
            message: 'hardcoded string literal',
            location: {
                file: 'src/test.ts',
                start: { line: 1, column: 1 },
                end: { line: 1, column: 10 },
            },
            detail: {},
        };

        const matchingRow = constantsRows.find((row) => row.covers(dummyIssue));
        expect(matchingRow).toBeDefined();
        expect(matchingRow?.dimension).toBe('duplication');
    });

    it('provides substantive remediation guidance for all CMT-* rules', () => {
        const cmtRules = RULE_REGISTRY.filter((rule) => rule.id.startsWith('CMT-'));
        expect(cmtRules.length).toBeGreaterThanOrEqual(10);

        for (const rule of cmtRules) {
            expect(typeof rule.remediation).toBe('string');
            expect(rule.remediation).not.toBe('strict');
            expect(rule.remediation).not.toBe('basic');
            expect(rule.remediation).not.toContain('and above');
            expect((rule.remediation ?? '').length).toBeGreaterThanOrEqual(15);
        }
    });
});
