/**
 * Module: Unit Test — 4D Elastic Compatibility Arbiter & AST Evolution Operators
 * File Path: tests/unit/elastic-compatibility-arbiter.test.ts
 * Architecture Role: Verifies elastic envelope evaluations, backward compatibility shim detection,
 *   fallback chain matching, and deprecated usage AST visitors across positive and negative cases.
 * Dependencies & Triggers: vitest (describe, it, expect); imports the 4 production modules.
 * Responsibilities:
 *   1. Test evaluateElasticEnvelope across fan-in boundaries, sunset schedules, and physical locations;
 *   2. Test auditBackwardCompatibilityShims for transparent passthroughs, deprecated tags, and perimeter cases;
 *   3. Test auditFallbackChains for multi-layer cross-generational fallbacks vs constant defaults;
 *   4. Test auditDeprecatedUsages for production usages vs test file exclusions.
 * Exit Semantics & Design Rationale: Standard vitest suite; zero transient state; executes in < 100ms.
 */

import { describe, it, expect } from 'vitest';
import { createSourceFile } from '../../src/utils/ast';
import { evaluateElasticEnvelope } from '../../src/core/scoring/elastic-compatibility-arbiter';
import { auditBackwardCompatibilityShims } from '../../src/core/rules/evolution/backward-shim-rule';
import { auditFallbackChains } from '../../src/core/ast/fallback-chain-matcher';
import { auditDeprecatedUsages } from '../../src/core/ast/deprecated-usage-visitor';

describe('4D Elastic Compatibility Arbiter', () => {
    it('enforces absolute zero elasticity for private leaf functions (fanIn <= 1)', () => {
        const res = evaluateElasticEnvelope({ fanIn: 1, isPerimeter: false });
        expect(res.severity).toBe('error');
        expect(res.penaltyMultiplier).toBe(1.0);
        expect(res.envelope).toBe('private_leaf');
    });

    it('softens penalty for private leaf located at perimeter', () => {
        const res = evaluateElasticEnvelope({ fanIn: 1, isPerimeter: true });
        expect(res.severity).toBe('warning');
        expect(res.penaltyMultiplier).toBe(0.5);
        expect(res.envelope).toBe('perimeter_relaxed');
    });

    it('grants single version grace for internal shared symbols (2 <= fanIn <= 4)', () => {
        const res = evaluateElasticEnvelope({ fanIn: 3, isPerimeter: false });
        expect(res.severity).toBe('warning');
        expect(res.penaltyMultiplier).toBe(0.6);
        expect(res.envelope).toBe('internal_shared');
    });

    it('softens internal shared symbols at architectural perimeter to info', () => {
        const res = evaluateElasticEnvelope({ fanIn: 3, isPerimeter: true });
        expect(res.severity).toBe('info');
        expect(res.penaltyMultiplier).toBe(0.3);
        expect(res.envelope).toBe('perimeter_relaxed');
    });

    it('upgrades public interface (fanIn >= 5) without sunset schedule to error (2.0x)', () => {
        const res = evaluateElasticEnvelope({ fanIn: 8, currentVersion: '1.2.0' });
        expect(res.severity).toBe('error');
        expect(res.penaltyMultiplier).toBe(2.0);
        expect(res.envelope).toBe('public_api');
    });

    it('upgrades public interface past sunset retirement deadline to error (2.0x)', () => {
        const res = evaluateElasticEnvelope({
            fanIn: 10,
            currentVersion: '2.0.0',
            sunsetVersion: '1.5.0',
        });
        expect(res.severity).toBe('error');
        expect(res.penaltyMultiplier).toBe(2.0);
        expect(res.envelope).toBe('public_api');
        expect(res.versionsUntilSunset).toBeLessThanOrEqual(0);
    });

    it('allows compliant transition window when sunset is >= 2 versions away', () => {
        const res = evaluateElasticEnvelope({
            fanIn: 10,
            currentVersion: '1.0.0',
            sunsetVersion: '3.0.0',
        });
        expect(res.severity).toBe('info');
        expect(res.penaltyMultiplier).toBe(0.3);
        expect(res.envelope).toBe('public_api');
        expect(res.versionsUntilSunset).toBe(2);
    });

    it('warns when public API sunset is approaching (1 version away)', () => {
        const res = evaluateElasticEnvelope({
            fanIn: 10,
            currentVersion: '1.0.0',
            sunsetVersion: '2.0.0',
        });
        expect(res.severity).toBe('warning');
        expect(res.penaltyMultiplier).toBe(0.5);
        expect(res.envelope).toBe('public_api');
        expect(res.versionsUntilSunset).toBe(1);
    });

    it('strictly vetoes any backward compatibility shim on hotpath as error (2.0x)', () => {
        const res = evaluateElasticEnvelope({
            fanIn: 10,
            isHotPath: true,
            currentVersion: '1.0.0',
            sunsetVersion: '4.0.0',
        });
        expect(res.severity).toBe('error');
        expect(res.penaltyMultiplier).toBe(2.0);
        expect(res.envelope).toBe('hotpath_violation');
    });
});

describe('Backward Compatibility Shim Rule (MOD-BWD-001)', () => {
    it('detects transparent 1:1 parameter forwarding wrapper', () => {
        const code = `
            export function legacyFetch(url: string, opts: any) {
                return fetchInternal(url, opts);
            }
        `;
        const sf = createSourceFile('src/client/api.ts', code);
        const issues = auditBackwardCompatibilityShims(sf, 'src/client/api.ts');
        expect(issues.length).toBe(1);
        expect(issues[0].rule).toBe('MOD-BWD-001');
        expect(issues[0].detail.targetCall).toBe('fetchInternal');
    });

    it('detects method marked with @deprecated and @sunset tag', () => {
        const code = `
            export class Client {
                /**
                 * @deprecated Use executeAsync instead. Sunset: 3.0.0
                 */
                public execute(cmd: string) {
                    return this.executeAsync(cmd);
                }
            }
        `;
        const sf = createSourceFile('src/service/client.ts', code);
        const issues = auditBackwardCompatibilityShims(sf, 'src/service/client.ts', {
            currentVersion: '1.0.0',
        });
        expect(issues.length).toBe(1);
        expect(issues[0].detail.sunsetVersion).toBe('3.0.0');
        expect(issues[0].severity).toBe('info');
    });

    it('ignores substantive functions containing business logic and multiple statements', () => {
        const code = `
            export function processOrder(orderId: string, amount: number) {
                if (amount <= 0) throw new Error('Invalid amount');
                const log = formatLog(orderId);
                notifyAudit(log);
                return submitOrder(orderId, amount);
            }
        `;
        const sf = createSourceFile('src/orders/processor.ts', code);
        const issues = auditBackwardCompatibilityShims(sf, 'src/orders/processor.ts');
        expect(issues.length).toBe(0);
    });

    it('escalates hotpath shim to error severity', () => {
        const code = `
            export function parseHotToken(stream: any) {
                return parseFastToken(stream);
            }
        `;
        const sf = createSourceFile('src/core/parser.ts', code);
        const issues = auditBackwardCompatibilityShims(sf, 'src/core/parser.ts', {
            isHotPath: true,
        });
        expect(issues.length).toBe(1);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].detail.envelope).toBe('hotpath_violation');
    });
});

describe('Fallback Chain Matcher (MOD-FLB-001)', () => {
    it('detects multi-tier transitional fallback across generational identifiers', () => {
        const code = `
            export function resolveTimeout(opts: any) {
                return opts.timeoutMs ?? opts.legacyTimeout ?? opts.timeout;
            }
        `;
        const sf = createSourceFile('src/domain/session.ts', code);
        const issues = auditFallbackChains(sf, 'src/domain/session.ts');
        expect(issues.length).toBe(1);
        expect(issues[0].rule).toBe('MOD-FLB-001');
        expect(issues[0].detail.chainDepth).toBe(2);
    });

    it('excludes safe constant default fallbacks', () => {
        const code = `
            export function getDelay(opts: any) {
                return opts.timeoutMs ?? 3000;
            }
            export function getName(opts: any) {
                return opts.userName ?? 'anonymous';
            }
        `;
        const sf = createSourceFile('src/domain/session.ts', code);
        const issues = auditFallbackChains(sf, 'src/domain/session.ts');
        expect(issues.length).toBe(0);
    });

    it('exempts perimeter adapter files from fallback chain reporting', () => {
        const code = `
            export function mapExternalConfig(ext: any) {
                return ext.newConfig ?? ext.legacyConfig ?? ext.config;
            }
        `;
        const sf = createSourceFile('src/adapters/httpAdapter.ts', code);
        const issues = auditFallbackChains(sf, 'src/adapters/httpAdapter.ts');
        expect(issues.length).toBe(0);
    });
});

describe('Deprecated Usage Visitor (MOD-DEP-001)', () => {
    it('reports direct production usage of locally deprecated symbol', () => {
        const code = `
            /**
             * @deprecated Use modernizeData instead.
             */
            export function legacyFetchData() {
                return { count: 10 };
            }

            export function runTask() {
                const data = legacyFetchData();
                return data.count;
            }
        `;
        const sf = createSourceFile('src/core/runner.ts', code);
        const issues = auditDeprecatedUsages(sf, 'src/core/runner.ts');
        expect(issues.length).toBe(1);
        expect(issues[0].rule).toBe('MOD-DEP-001');
        expect(issues[0].detail.symbol).toBe('legacyFetchData');
    });

    it('exempts test files from deprecated usage findings', () => {
        const code = `
            import { legacyFetchData } from '../core/runner';
            export function testBackwardCompat() {
                const res = legacyFetchData();
                expect(res).toBeDefined();
            }
        `;
        const sf = createSourceFile('tests/unit/compat.test.ts', code);
        const issues = auditDeprecatedUsages(sf, 'tests/unit/compat.test.ts');
        expect(issues.length).toBe(0);
    });

    it('ignores references to non-deprecated symbols', () => {
        const code = `
            export function activeWorker() {
                return 42;
            }
            export function execute() {
                return activeWorker();
            }
        `;
        const sf = createSourceFile('src/core/worker.ts', code);
        const issues = auditDeprecatedUsages(sf, 'src/core/worker.ts');
        expect(issues.length).toBe(0);
    });
});
