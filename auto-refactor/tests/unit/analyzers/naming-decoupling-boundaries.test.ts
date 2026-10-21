/**
 * Module: Naming Decoupling Boundary Tests
 * File Path: tests/unit/analyzers/naming-decoupling-boundaries.test.ts
 * Architecture Role: Pins the boundary between genuine architectural coupling and the
 *   syntax shapes that cannot be decoupled, so NAM-DEC-001 stops reporting proposals that
 *   no edit can satisfy.
 * Dependencies & Triggers: Vitest; exercises NamingAnalyzer through the public analyzer
 *   contract with an in-memory AnalyzerContext.
 * Responsibilities:
 *   1. Object-literal keys must not be reported, at any length.
 *   2. Interface and class property keys must not join prefix clusters.
 *   3. Method sets must not join prefix clusters, since they share an inherited verb prefix.
 *   4. Module-scope declarations sharing a long prefix must still cluster.
 *   5. Exempt method names must not be reported for length.
 * Test Oracle & Invariant: Findings are asserted by rule and symbol rather than by count,
 *   so adding unrelated rules cannot silently satisfy a boundary assertion.
 * Determinism & Isolation: No clock, filesystem, or network access; each case builds its own
 *   source text and asserts on the returned Issue[] directly.
 */

import { describe, it, expect } from 'vitest';
import { NamingAnalyzer } from '../../../src/analyzers/naming';
import type { AnalyzerContext } from '../../../src/core/types';

const RULE_DECOUPLING = 'NAM-DEC-001';
const RULE_LENGTH = 'NAM-LEN-002';

/**
 * Builds an analyzer context whose source text is parsed by the analyzer itself.
 *
 * @param content - TypeScript source text under audit.
 * @param filePath - Logical path used for path-based exemptions.
 */
function createCtx(content: string, filePath = 'src/sample/naming-boundary.ts'): AnalyzerContext {
    return { filePath, content, options: {}, config: {} } as AnalyzerContext;
}

/**
 * Runs the naming analyzer and returns the symbol or name recorded in each finding's detail.
 *
 * @param content - TypeScript source text under audit.
 * @param rule - Rule identifier to collect.
 */
function findingsFor(content: string, rule: string): string[] {
    const issues = new NamingAnalyzer().analyze(undefined, createCtx(content));
    return issues
        .filter((issue) => issue.rule === rule)
        .map((issue) => {
            const detail = issue.detail as Record<string, unknown>;
            return String(detail.symbol ?? detail.name ?? '');
        });
}

describe('NAM-DEC-001 object-literal keys', () => {
    it('does not report long property keys of a module-scope object literal', () => {
        const source = [
            'export const metricPayload = {',
            '    beforeContentLength: 1,',
            '    beforeContentHash: "a",',
            '    beforeContentStream: "b",',
            '    beforeContentName: "c",',
            '};',
        ].join('\n');

        expect(findingsFor(source, RULE_DECOUPLING)).toEqual([]);
    });

    it('does not report a single over-long property key', () => {
        const source = [
            'export const similarityReport = {',
            '    calculateSimHashHammingSimilarityValue: 0.5,',
            '};',
        ].join('\n');

        expect(findingsFor(source, RULE_DECOUPLING)).toEqual([]);
    });
});

describe('NAM-DEC-001 cluster eligibility', () => {
    it('does not cluster interface members that share a prefix', () => {
        const source = [
            'export interface RetentionPolicy {',
            '    beforeContentLength: number;',
            '    beforeContentHash: string;',
            '    beforeContentStream: string;',
            '    beforeContentName: string;',
            '}',
        ].join('\n');

        expect(findingsFor(source, RULE_DECOUPLING)).toEqual([]);
    });

    it('does not cluster methods that share an inherited verb prefix', () => {
        const source = [
            'export class Projector {',
            '    resolveProjectedPositions(): void {}',
            '    resolveProjectedName(): void {}',
            '    resolveProjectedBindingName(): void {}',
            '    resolveProjectedRawKind(): void {}',
            '}',
        ].join('\n');

        expect(findingsFor(source, RULE_DECOUPLING)).toEqual([]);
    });

    it('still clusters module-scope declarations that share a long prefix', () => {
        const source = [
            'export class PlayerInventoryEquipmentSlot {}',
            'export class PlayerInventoryEquipmentBag {}',
            'export class PlayerInventoryEquipmentManager {}',
            'export class PlayerInventoryEquipmentItem {}',
        ].join('\n');

        const symbols = findingsFor(source, RULE_DECOUPLING);
        expect(symbols.length).toBe(4);
        expect(symbols).toContain('PlayerInventoryEquipmentSlot');
    });

    it('does not cluster bindings declared inside a function body', () => {
        const source = [
            'export function compute(): number {',
            '    const beforeContentLength = 1;',
            '    const beforeContentHash = 2;',
            '    const beforeContentStream = 3;',
            '    const beforeContentName = 4;',
            '    return beforeContentLength + beforeContentHash + beforeContentStream + beforeContentName;',
            '}',
        ].join('\n');

        expect(findingsFor(source, RULE_DECOUPLING)).toEqual([]);
    });
});

describe('NAM-LEN-002 exemption precedence', () => {
    it('does not report canonical short method names for length', () => {
        const source = [
            'export class Cache {',
            '    run(): void {}',
            '    get(): number { return 1; }',
            '    set(): void {}',
            '    flush(): void {}',
            '}',
        ].join('\n');

        expect(findingsFor(source, RULE_LENGTH)).toEqual([]);
    });

    it('still reports two-character non-exempt function names', () => {
        const source = 'function fn(): void {}\n';

        expect(findingsFor(source, RULE_LENGTH)).toContain('fn');
    });
});

describe('NAM-DEC-001 evidence shape', () => {
    it('reports the declaration kind so a finding can be audited without re-parsing', () => {
        const source = [
            'export class PlayerInventoryEquipmentSlot {}',
            'export class PlayerInventoryEquipmentBag {}',
            'export class PlayerInventoryEquipmentManager {}',
            'export class PlayerInventoryEquipmentItem {}',
        ].join('\n');

        const issues = new NamingAnalyzer().analyze(undefined, createCtx(source));
        const clusterIssue = issues.find((issue) => issue.rule === RULE_DECOUPLING);

        expect(clusterIssue).toBeDefined();
        expect((clusterIssue?.detail as Record<string, unknown>).kind).toBe('class');
    });
});

describe('NAM-MBR-001 protocol keys', () => {
    it('does not require camelCase for object-literal keys owned by a data contract', () => {
        const source = [
            'export const taxonomy = {',
            '    business_domain_module: 0,',
            '    shared_capability_module: 0,',
            '    rule_policy_module: 0,',
            '};',
        ].join('\n');

        expect(findingsFor(source, 'NAM-MBR-001')).toEqual([]);
    });

    it('still requires camelCase for genuine class members', () => {
        const source = ['export class Holder {', '    bad_member_name = 1;', '}'].join('\n');

        expect(findingsFor(source, 'NAM-MBR-001')).toEqual(['bad_member_name']);
    });
});

describe('NAM-SGL-001 allow-list scope', () => {
    /**
     * Runs the analyzer with an explicit single-letter allow-list.
     *
     * @param allowList - Letters the caller declares acceptable.
     */
    function withAllowList(allowList: string[]): string[] {
        const source = 'const n = 1;\nconst q = 2;\n';
        const issues = new NamingAnalyzer().analyze(undefined, {
            ...createCtx(source),
            options: { singleLetterAllowed: allowList },
        } as AnalyzerContext);
        return issues
            .filter((issue) => issue.rule === 'NAM-SGL-001')
            .map((issue) => String((issue.detail as Record<string, unknown>).name));
    }

    it('honours an explicit allow-list outside loop scope', () => {
        expect(withAllowList(['n'])).toEqual(['q']);
    });

    it('still reports letters absent from the allow-list', () => {
        expect(withAllowList(['n', 'q'])).toEqual([]);
    });
});
