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
import type { ProjectManifestInventory } from '../../../src/core/intelligence/dependency-provenance';

function createMockContext(
    content: string,
    filePath: string,
    manifestDeps?: Set<string>,
    manifestInventory?: ProjectManifestInventory,
): AnalyzerContext {
    const config: Partial<ScanConfig> = {
        root: '/fake-project',
        analyzers: {
            'dependency-layout': {
                enabled: true,
                options: {
                    manifestDependencies: manifestDeps,
                    manifestInventory,
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

    it('emits DEP-DEV-001 when devDependency is imported in production code without import type', () => {
        const code = `import { describe } from 'vitest';\nexport function testRun() { describe('demo', () => {}); }`;
        const sf = ts.createSourceFile('src/core/runner.ts', code, ts.ScriptTarget.Latest, true);
        const inventory: ProjectManifestInventory = {
            allDependencies: new Set(['vitest']),
            prodDependencies: new Set(),
            devDependencies: new Set(['vitest']),
            peerDependencies: new Set(),
            pathAliases: new Map(),
        };
        const ctx = createMockContext(code, 'src/core/runner.ts', inventory.allDependencies, inventory);

        const issues = analyzer.analyze(sf, ctx);
        const devLeak = issues.find((i) => i.rule === 'DEP-DEV-001');
        expect(devLeak).toBeDefined();
        expect(devLeak?.severity).toBe('warning');
        expect(devLeak?.message).toContain('vitest');
        expect(devLeak?.suggestion).toContain('dependencies');
    });

    it('does NOT emit DEP-DEV-001 when devDependency is imported via import type in production code', () => {
        const code = `import type { Suite } from 'vitest';\nexport type MySuite = Suite;`;
        const sf = ts.createSourceFile('src/core/types.ts', code, ts.ScriptTarget.Latest, true);
        const inventory: ProjectManifestInventory = {
            allDependencies: new Set(['vitest']),
            prodDependencies: new Set(),
            devDependencies: new Set(['vitest']),
            peerDependencies: new Set(),
            pathAliases: new Map(),
        };
        const ctx = createMockContext(code, 'src/core/types.ts', inventory.allDependencies, inventory);

        const issues = analyzer.analyze(sf, ctx);
        const devLeak = issues.find((i) => i.rule === 'DEP-DEV-001');
        expect(devLeak).toBeUndefined();
    });

    it('does NOT emit DEP-DEV-001 when devDependency is imported in test or script files', () => {
        const code = `import { describe } from 'vitest';\ndescribe('test', () => {});`;
        const sf = ts.createSourceFile('tests/unit/runner.test.ts', code, ts.ScriptTarget.Latest, true);
        const inventory: ProjectManifestInventory = {
            allDependencies: new Set(['vitest']),
            prodDependencies: new Set(),
            devDependencies: new Set(['vitest']),
            peerDependencies: new Set(),
            pathAliases: new Map(),
        };
        const ctx = createMockContext(code, 'tests/unit/runner.test.ts', inventory.allDependencies, inventory);

        const issues = analyzer.analyze(sf, ctx);
        const devLeak = issues.find((i) => i.rule === 'DEP-DEV-001');
        expect(devLeak).toBeUndefined();
    });

    it('emits DEP-OBS-001 when importing a deprecated library with migration suggestion', () => {
        const code = `import request from 'request';\nexport function fetchUrl(url: string) { return request(url); }`;
        const sf = ts.createSourceFile('src/net/fetcher.ts', code, ts.ScriptTarget.Latest, true);
        const inventory: ProjectManifestInventory = {
            allDependencies: new Set(['request']),
            prodDependencies: new Set(['request']),
            devDependencies: new Set(),
            peerDependencies: new Set(),
            pathAliases: new Map(),
        };
        const ctx = createMockContext(code, 'src/net/fetcher.ts', inventory.allDependencies, inventory);

        const issues = analyzer.analyze(sf, ctx);
        const obs = issues.find((i) => i.rule === 'DEP-OBS-001');
        expect(obs).toBeDefined();
        expect(obs?.severity).toBe('warning');
        expect(obs?.message).toContain('request');
        expect(obs?.suggestion).toContain('fetch');
    });

    it('emits DEP-OBS-001 when importing deprecated moment or querystring in line-based mode', () => {
        const pyCode = `import distutils.core\nfrom imp import load_source`;
        const pyCtx = createMockContext(pyCode, 'src/legacy.py');

        const pyIssues = analyzer.analyze(null as any, pyCtx);
        const distutilsIssue = pyIssues.find((i) => i.rule === 'DEP-OBS-001' && i.message.includes('distutils'));
        const impIssue = pyIssues.find((i) => i.rule === 'DEP-OBS-001' && i.message.includes('imp'));
        expect(distutilsIssue).toBeDefined();
        expect(impIssue).toBeDefined();
    });
});
