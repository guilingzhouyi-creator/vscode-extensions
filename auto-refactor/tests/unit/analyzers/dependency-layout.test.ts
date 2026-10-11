/**
 * Module: Unit Tests — Dependency Layout Analyzer
 * File Path: tests/unit/analyzers/dependency-layout.test.ts
 * Architecture Role: Unit test suite validating dependency layout, phantom dependencies,
 *   compromised supply chain packages, and license compliance rules.
 * Test Type: Unit test suite
 */
import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import { DependencyLayoutAnalyzer } from '../../../src/analyzers/dependency-layout';
import type { AnalyzerContext, ScanConfig } from '../../../src/core/types';

function createMockContext(content: string, filePath: string, manifestDeps?: Set<string>): AnalyzerContext {
    const config: Partial<ScanConfig> = {
        root: '/fake-project',
        analyzers: {
            'dependency-layout': {
                enabled: true,
                options: {
                    manifestDependencies: manifestDeps,
                },
            },
        } as any,
    };
    return {
        filePath,
        content,
        root: undefined as any,
        adapter: undefined as any,
        config: config as ScanConfig,
        options: {},
    };
}

describe('DependencyLayoutAnalyzer — Supply Chain & Layout Rules', () => {
    const analyzer = new DependencyLayoutAnalyzer();

    it('emits DEP-VULN-001 when importing a known malicious package', () => {
        const code = `import backdoor from 'flatmap-stream';\nconsole.log(backdoor);`;
        const sf = ts.createSourceFile('src/service.ts', code, ts.ScriptTarget.Latest, true);
        const ctx = createMockContext(code, 'src/service.ts');

        const issues = analyzer.analyze(sf, ctx);
        const vuln = issues.find((i) => i.rule === 'DEP-VULN-001');

        expect(vuln).toBeDefined();
        expect(vuln?.severity).toBe('error');
        expect(vuln?.message).toContain('flatmap-stream');
        expect(vuln?.suggestion).toContain('Immediately remove flatmap-stream');
    });

    it('emits DEP-PHANTOM-001 when importing undeclared package with manifest dependencies provided', () => {
        const code = `import express from 'express';\nimport { map } from 'lodash';\nexport { express, map };`;
        const sf = ts.createSourceFile('src/api.ts', code, ts.ScriptTarget.Latest, true);
        const manifestDeps = new Set(['lodash', 'typescript']);
        const ctx = createMockContext(code, 'src/api.ts', manifestDeps);

        const issues = analyzer.analyze(sf, ctx);
        const phantom = issues.find((i) => i.rule === 'DEP-PHANTOM-001');

        expect(phantom).toBeDefined();
        expect(phantom?.severity).toBe('warning');
        expect(phantom?.message).toContain('express');
        expect(phantom?.suggestion).toContain('package.json');
    });

    it('does not emit DEP-PHANTOM-001 for declared packages or local/stdlib imports', () => {
        const code = `import * as fs from 'fs';\nimport { map } from 'lodash';\nimport { helper } from './local';\nexport { fs, map, helper };`;
        const sf = ts.createSourceFile('src/worker.ts', code, ts.ScriptTarget.Latest, true);
        const manifestDeps = new Set(['lodash']);
        const ctx = createMockContext(code, 'src/worker.ts', manifestDeps);

        const issues = analyzer.analyze(sf, ctx);
        const phantoms = issues.filter((i) => i.rule === 'DEP-PHANTOM-001');
        expect(phantoms).toHaveLength(0);
    });

    it('does not emit DEP-PHANTOM-001 for Node subpath stdlib (fs/promises, timers/promises) or ambient vscode', () => {
        const code = `import { readFile } from 'fs/promises';\nimport * as vscode from 'vscode';\nimport { setTimeout } from 'timers/promises';\nexport { readFile, vscode, setTimeout };`;
        const sf = ts.createSourceFile('src/ext.ts', code, ts.ScriptTarget.Latest, true);
        const manifestDeps = new Set(['lodash']); // vscode and fs/promises NOT in manifest
        const ctx = createMockContext(code, 'src/ext.ts', manifestDeps);

        const issues = analyzer.analyze(sf, ctx);
        const phantoms = issues.filter((i) => i.rule === 'DEP-PHANTOM-001');
        expect(phantoms).toHaveLength(0);
    });

    it('does not emit DEP-PHANTOM-001 for polyglot stdlib (Python dataclasses, Rust alloc)', () => {
        const pyCode = `import dataclasses\nimport unittest\nfrom functools import wraps`;
        const pyCtx = createMockContext(pyCode, 'src/model.py', new Set(['numpy']));
        const pyIssues = analyzer.analyze(null as any, pyCtx);
        const pyPhantoms = pyIssues.filter((i) => i.rule === 'DEP-PHANTOM-001');
        expect(pyPhantoms).toHaveLength(0);

        const rsCode = `use alloc::string::String;\nuse std::collections::HashMap;`;
        const rsCtx = createMockContext(rsCode, 'src/lib.rs', new Set(['serde']));
        const rsIssues = analyzer.analyze(null as any, rsCtx);
        const rsPhantoms = rsIssues.filter((i) => i.rule === 'DEP-PHANTOM-001');
        expect(rsPhantoms).toHaveLength(0);
    });

    it('emits DEP-WLD-001 on wildcard imports', () => {
        const code = `import * as utils from 'my-utils';\nexport { utils };`;
        const sf = ts.createSourceFile('src/index.ts', code, ts.ScriptTarget.Latest, true);
        const ctx = createMockContext(code, 'src/index.ts', new Set(['my-utils']));

        const issues = analyzer.analyze(sf, ctx);
        const wildcard = issues.find((i) => i.rule === 'DEP-WLD-001');
        expect(wildcard).toBeDefined();
    });
});
