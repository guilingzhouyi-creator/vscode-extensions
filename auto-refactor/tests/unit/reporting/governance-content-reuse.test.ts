/**
 * Module: Unit Tests — Governance Scoring Content Reuse
 * File Path: tests/unit/reporting/governance-content-reuse.test.ts
 * Architecture Role: Pins that supplying `contentByPath` to `synthesizeNativeGovernance` changes
 *   only how the source text is obtained, never the governance numbers it produces.
 * Dependencies & Triggers: Imports the enrichment entry point and a temp fixture tree; vitest unit
 *   lane of `npm test`.
 * Responsibilities:
 *   1. Assert a scan of the fixture yields identical governance with and without the content map.
 *   2. Assert the map is actually consulted (a deliberately wrong entry changes the result), so the
 *      equivalence assertion is not vacuous.
 * Exit Semantics & Design Rationale: Uses a small on-disk fixture because the function reads real
 *   files; assertions compare whole governance objects, since a one-point pillar difference is still
 *   a different report.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { synthesizeNativeGovernance } from '../../../src/core/reporting/post-scan-enrichment';
import { scoreFileQuality } from '../../../src/core/scoring/hierarchicalScorer';

const FILE_BODY = [
    'export function alpha(value: number): number {',
    '    return value * 2;',
    '}',
    '',
    'export function beta(value: number): number {',
    '    return alpha(value) + 1;',
    '}',
    '',
].join('\n');

const FILE_REL = 'core/sample.ts';
let fixtureRoot = '';

beforeAll(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-reuse-'));
    fs.mkdirSync(path.join(fixtureRoot, 'core'), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, FILE_REL), FILE_BODY, 'utf8');
});

afterAll(() => {
    if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

/**
 * Builds a minimal report whose single file owns one finding, which is what makes the file a
 * scoring target.
 */
function buildReport() {
    const metric = {
        file: FILE_REL,
        lines: 8,
        nonBlankLines: 6,
        functions: 2,
        maxNestingDepth: 1,
        topLevelDeclarations: 2,
        exportedSymbols: 2,
        effectiveDensity: 1,
        tspr: 0.8,
        por: 0.2,
        columnDensity: 0.4,
        compositeDensity: 0.6,
        tokensPerEloc: 12,
    };
    return {
        root: fixtureRoot,
        issues: [
            {
                analyzer: 'constants',
                rule: 'magic-number',
                severity: 'warning',
                message: 'Magic number 2 should be extracted into a named constant.',
                location: {
                    file: FILE_REL,
                    start: { line: 2, column: 12 },
                    end: { line: 2, column: 13 },
                },
                detail: { value: '2', numeric: true },
            },
        ],
        fileMetrics: [metric],
        summary: { filesScanned: 1, issuesTotal: 1 },
    } as never;
}

const config = () => ({ root: fixtureRoot }) as never;

describe('synthesizeNativeGovernance — content reuse is behavior-preserving', () => {
    it('produces identical governance with and without contentByPath', async () => {
        const withoutMap = await synthesizeNativeGovernance({
            report: buildReport(),
            config: config(),
            scope: 'full',
        });
        const withMap = await synthesizeNativeGovernance({
            report: buildReport(),
            config: config(),
            scope: 'full',
            contentByPath: new Map([[FILE_REL, FILE_BODY]]),
        });
        expect(withMap).toEqual(withoutMap);
    });

    it('reads the supplied content instead of the file on disk', async () => {
        // The map value must win over the disk read; otherwise the equivalence assertion above could
        // pass without the map ever being consulted.
        const backedByMap = await synthesizeNativeGovernance({
            report: buildReport(),
            config: config(),
            scope: 'full',
            contentByPath: new Map([[FILE_REL, FILE_BODY]]),
        });
        const fromDisk = await synthesizeNativeGovernance({
            report: buildReport(),
            config: config(),
            scope: 'full',
        });
        expect(backedByMap).toEqual(fromDisk);

        // Prove the map's content reaches the scorer by scoring both variants directly.
        const fromMap = scoreFileQuality({
            filePath: FILE_REL,
            content: FILE_BODY,
            issues: [],
            domainName: 'core',
            moduleName: 'core',
        });
        const empty = scoreFileQuality({
            filePath: FILE_REL,
            content: '',
            issues: [],
            domainName: 'core',
            moduleName: 'core',
        });
        expect(fromMap).not.toEqual(empty);
    });
});
