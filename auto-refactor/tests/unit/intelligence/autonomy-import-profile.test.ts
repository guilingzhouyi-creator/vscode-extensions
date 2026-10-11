/**
 * Module: Unit Tests — Autonomy Import Profile & Deprecated Dependencies
 * File Path: tests/unit/intelligence/autonomy-import-profile.test.ts
 * Architecture Role: Unit test suite validating multi-language import profile extraction,
 *   dependency provenance classification with path aliases, and deprecated package auditing.
 * Test Type: Unit test suite
 */

import { describe, it, expect } from 'vitest';
import {
    classifyImportProvenance,
    isDevOnlyDependency,
} from '../../../src/core/intelligence/dependency-provenance';
import { checkDeprecatedPackage } from '../../../src/core/intelligence/deprecated-dependencies';
import {
    evaluateProjectAutonomy,
} from '../../../src/core/scoring/autonomy-scorer';
import type { FileMetric, Issue, ScanConfig } from '../../../src/core/types';

describe('Dependency Provenance & Path Aliases', () => {
    it('classifies path alias as internal instead of external_sdk', () => {
        const pathAliases = new Set<string>(['@core', '@utils']);

        const provCore = classifyImportProvenance('@core/services/auth', 'src/app.ts', undefined, pathAliases);
        expect(provCore).toBe('internal');

        const provUtils = classifyImportProvenance('@utils', 'src/app.ts', undefined, pathAliases);
        expect(provUtils).toBe('internal');

        const provExternal = classifyImportProvenance('lodash/map', 'src/app.ts', undefined, pathAliases);
        expect(provExternal).toBe('external_sdk');

        const provStd = classifyImportProvenance('path', 'src/app.ts', undefined, pathAliases);
        expect(provStd).toBe('stdlib');
    });

    it('identifies dev-only dependencies accurately in production code', () => {
        const inventory = {
            allDependencies: new Set(['mocha', 'express']),
            prodDependencies: new Set(['express']),
            devDependencies: new Set(['mocha']),
            peerDependencies: new Set<string>(),
            pathAliases: new Set<string>(),
        };

        expect(isDevOnlyDependency('mocha', inventory)).toBe(true);
        expect(isDevOnlyDependency('express', inventory)).toBe(false);
    });
});

describe('Deprecated Package Intelligence', () => {
    it('detects deprecated Node.js packages with modern replacements', () => {
        const reqCheck = checkDeprecatedPackage('request');
        expect(reqCheck).not.toBeNull();
        expect(reqCheck?.replacement).toContain('fetch');

        const momentCheck = checkDeprecatedPackage('moment');
        expect(momentCheck).not.toBeNull();
        expect(momentCheck?.replacement).toContain('dayjs');

        const qsCheck = checkDeprecatedPackage('querystring');
        expect(qsCheck).not.toBeNull();
        expect(qsCheck?.replacement).toContain('URLSearchParams');
    });

    it('detects deprecated Python libraries', () => {
        const distutilsCheck = checkDeprecatedPackage('distutils');
        expect(distutilsCheck).not.toBeNull();
        expect(distutilsCheck?.replacement).toContain('setuptools');

        const impCheck = checkDeprecatedPackage('imp');
        expect(impCheck).not.toBeNull();
        expect(impCheck?.replacement).toContain('importlib');
    });

    it('returns null for modern active packages', () => {
        expect(checkDeprecatedPackage('vitest')).toBeNull();
        expect(checkDeprecatedPackage('zod')).toBeNull();
        expect(checkDeprecatedPackage('requests')).toBeNull();
    });
});

describe('Autonomy Scorer — Mathematical Evaluation & Provenance', () => {
    const mockConfig: ScanConfig = {
        root: '/mock-root',
        analyzers: {},
        thresholds: {},
    };

    it('computes autonomy metrics cleanly for first-party modules', () => {
        const metrics: FileMetric[] = [
            { file: 'src/index.ts', totalLines: 20, effectiveLoc: 15, blankLines: 2, commentLines: 3 },
            { file: 'src/service.ts', totalLines: 30, effectiveLoc: 25, blankLines: 2, commentLines: 3 },
        ];
        const issues: Issue[] = [];
        const fileContents = new Map<string, string>([
            ['src/index.ts', 'import { helper } from "./service";\nexport function run() { return helper(); }'],
            ['src/service.ts', 'export function helper() { return 42; }'],
        ]);

        const evaluation = evaluateProjectAutonomy(metrics, issues, mockConfig, fileContents);
        expect(evaluation.compositeAutonomyIndex).toBeGreaterThan(90);
        expect(evaluation.grade).toBe('L5_INDEPENDENT');
        expect(evaluation.externalSdkInventory).toHaveLength(0);
        expect(evaluation.stats.proprietaryFiles).toBe(2);
    });

    it('accurately identifies external packages without first-package truncation bias', () => {
        const metrics: FileMetric[] = [
            { file: 'src/worker.ts', totalLines: 50, effectiveLoc: 40, blankLines: 5, commentLines: 5 },
        ];
        const issues: Issue[] = [];
        const code = `
import { get } from 'axios';
import { cloneDeep } from 'lodash';
import { z } from 'zod';

export async function processData(url: string) {
    const res = await get(url);
    const schema = z.object({ id: z.number() });
    return cloneDeep(res.data);
}
`;
        const fileContents = new Map<string, string>([['src/worker.ts', code]]);
        const evaluation = evaluateProjectAutonomy(metrics, issues, mockConfig, fileContents);

        const sdkNames = evaluation.externalSdkInventory.map((sdk) => sdk.name);
        expect(sdkNames).toContain('axios');
        expect(sdkNames).toContain('lodash');
        expect(sdkNames).toContain('zod');
        expect(evaluation.compositeAutonomyIndex).toBeLessThan(100);
    });
});
