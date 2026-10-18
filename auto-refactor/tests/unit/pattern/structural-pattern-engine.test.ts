/**
 * Module: Unit Test — Declarative Structural Pattern Rewrite Engine
 * File Path: tests/unit/pattern/structural-pattern-engine.test.ts
 * Architecture Role: Deterministic verification of structural AST pattern matching,
 *   metavariable capture ($VAR, $COND, $_), template rewrite synthesis, unified diffs,
 *   actionable patches, and facade governance.
 * Dependencies & Triggers: `npx vitest run tests/unit/pattern/structural-pattern-engine.test.ts`;
 *   imports StructuralPatternEngine and PatternFacade from src/core/pattern.
 * Responsibilities:
 *   1. Validate double negation and boolean double ternary simplification;
 *   2. Validate nullish coalescing simplification with multi-site metavariable equality;
 *   3. Validate guard clause condition replacement and logical assignment refactoring;
 *   4. Verify unified diff generation, actionable patches, and facade contract invariants.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passing; completely hermetic.
 */

import { describe, expect, it } from 'vitest';
import {
    PatternFacade,
    StructuralPatternEngine,
    assertValidPatternSpec,
    createPatternSuite,
    freezePatternSpec,
    matchAndRewrite,
    matchPattern,
    type PatternSpec,
} from '../../../src/core/pattern';

describe('StructuralPatternEngine', () => {
    describe('Boolean Double Negation Simplification', () => {
        const doubleNegationRule: PatternSpec = {
            id: 'simplify-double-negation',
            description: 'Simplify double negation to Boolean wrapper',
            pattern: '!(!$VAR)',
            rewrite: 'Boolean($VAR)',
            kind: 'expression',
        };

        it('rewrites simple double negation variable to Boolean()', () => {
            const source = 'const isActive = !(!user);';
            const result = matchAndRewrite(source, doubleNegationRule, {
                filePath: 'src/user.ts',
            });

            expect(result.hasChanged).toBe(true);
            expect(result.rewrittenSource).toBe('const isActive = Boolean(user);');
            expect(result.matches).toHaveLength(1);
            expect(result.matches[0].bindings.$VAR.value).toBe('user');
            expect(result.patch.ruleId).toBe('simplify-double-negation');
            expect(result.patch.edits).toHaveLength(1);
            expect(result.patch.edits[0].range.startLine).toBe(1);
            expect(result.patch.edits[0].newText).toBe('Boolean(user)');
            expect(result.unifiedDiff).toContain('--- a/src/user.ts');
            expect(result.unifiedDiff).toContain('+++ b/src/user.ts');
            expect(result.unifiedDiff).toContain('-const isActive = !(!user);');
            expect(result.unifiedDiff).toContain('+const isActive = Boolean(user);');
        });

        it('rewrites nested property access in double negation', () => {
            const source = 'const flag = !(!config.features.experimental);';
            const result = matchAndRewrite(source, doubleNegationRule);

            expect(result.hasChanged).toBe(true);
            expect(result.rewrittenSource).toBe(
                'const flag = Boolean(config.features.experimental);',
            );
            expect(result.matches[0].bindings.$VAR.value).toBe('config.features.experimental');
        });
    });

    describe('Boolean Double Ternary Simplification', () => {
        const ternaryToBooleanRule: PatternSpec = {
            id: 'simplify-ternary-boolean',
            description: 'Simplify conditional ternary true/false to Boolean constructor',
            pattern: '$COND ? true : false',
            rewrite: 'Boolean($COND)',
            kind: 'expression',
        };

        const ternaryInversionRule: PatternSpec = {
            id: 'simplify-ternary-inversion',
            description: 'Simplify conditional ternary false/true to logical negation',
            pattern: '$COND ? false : true',
            rewrite: '!($COND)',
            kind: 'expression',
        };

        it('simplifies condition ? true : false to Boolean(condition)', () => {
            const source = 'const isValid = count > 0 ? true : false;';
            const result = matchAndRewrite(source, ternaryToBooleanRule);

            expect(result.hasChanged).toBe(true);
            expect(result.rewrittenSource).toBe('const isValid = Boolean(count > 0);');
            expect(result.matches[0].bindings.$COND.value).toBe('count > 0');
        });

        it('simplifies condition ? false : true to !(condition)', () => {
            const source = 'const isBlocked = status === "active" ? false : true;';
            const result = matchAndRewrite(source, ternaryInversionRule);

            expect(result.hasChanged).toBe(true);
            expect(result.rewrittenSource).toBe('const isBlocked = !(status === "active");');
            expect(result.matches[0].bindings.$COND.value).toBe('status === "active"');
        });
    });

    describe('Nullish Coalescing Simplification', () => {
        const nullishRule: PatternSpec = {
            id: 'simplify-nullish-coalescing',
            description: 'Simplify null and undefined ternary check to nullish coalescing',
            pattern: '$VAR !== null && $VAR !== undefined ? $VAR : $FALLBACK',
            rewrite: '$VAR ?? $FALLBACK',
            kind: 'expression',
        };

        it('simplifies redundant null and undefined checks to nullish coalescing', () => {
            const source =
                'const name = user.name !== null && user.name !== undefined ? user.name : "Anonymous";';
            const result = matchAndRewrite(source, nullishRule);

            expect(result.hasChanged).toBe(true);
            expect(result.rewrittenSource).toBe('const name = user.name ?? "Anonymous";');
            expect(result.matches[0].bindings.$VAR.value).toBe('user.name');
            expect(result.matches[0].bindings.$FALLBACK.value).toBe('"Anonymous"');
        });

        it('handles parenthesized sub-expressions transparently', () => {
            const source = 'const res = (val !== null) && (val !== undefined) ? val : fallback;';
            const result = matchAndRewrite(source, nullishRule);

            expect(result.hasChanged).toBe(true);
            expect(result.rewrittenSource).toBe('const res = val ?? fallback;');
        });

        it('rejects match if metavariables across sites do not match', () => {
            const asymmetricSource =
                'const res = user.name !== null && user.id !== undefined ? user.name : "Default";';
            const result = matchAndRewrite(asymmetricSource, nullishRule);

            expect(result.hasChanged).toBe(false);
            expect(result.rewrittenSource).toBe(asymmetricSource);
            expect(result.matches).toHaveLength(0);
        });
    });

    describe('Guard Clause and Return Simplification', () => {
        const guardRule: PatternSpec = {
            id: 'simplify-guard-nullish',
            description: 'Simplify dual null/undefined guard to loose null equality',
            pattern: 'if ($VAR === null || $VAR === undefined) { return $RET; }',
            rewrite: 'if ($VAR == null) { return $RET; }',
            kind: 'statement',
        };

        it('simplifies guard clause checking both null and undefined', () => {
            const source = [
                'function process(param: string | null | undefined) {',
                '    if (param === null || param === undefined) { return null; }',
                '    return param.trim();',
                '}',
            ].join('\n');

            const result = matchAndRewrite(source, guardRule, {
                filePath: 'src/handler.ts',
            });

            expect(result.hasChanged).toBe(true);
            expect(result.rewrittenSource).toContain('if (param == null) { return null; }');
            expect(result.matches[0].bindings.$VAR.value).toBe('param');
            expect(result.matches[0].bindings.$RET.value).toBe('null');
        });

        it('matches unbraced guard clauses against braced patterns', () => {
            const unbracedRule: PatternSpec = {
                id: 'simplify-guard-unbraced',
                pattern: 'if (!$COND) { return; }',
                rewrite: 'if ($COND === false) { return; }',
                kind: 'statement',
            };
            const source = 'if (!isReady) return;';
            const result = matchAndRewrite(source, unbracedRule);

            expect(result.hasChanged).toBe(true);
            expect(result.rewrittenSource).toBe('if (isReady === false) { return; }');
            expect(result.matches[0].bindings.$COND.value).toBe('isReady');
        });
    });

    describe('Logical and Nullish Assignment Simplification', () => {
        const logicalOrAssignRule: PatternSpec = {
            id: 'simplify-logical-or-assignment',
            description: 'Simplify x = x || y to x ||= y',
            pattern: '$A = $A || $B',
            rewrite: '$A ||= $B',
            kind: 'expression',
        };

        const nullishAssignRule: PatternSpec = {
            id: 'simplify-nullish-assignment',
            description: 'Simplify x = x ?? y to x ??= y',
            pattern: '$A = $A ?? $B',
            rewrite: '$A ??= $B',
            kind: 'expression',
        };

        it('transforms logical or assignment to ||= operator', () => {
            const source = 'config.timeout = config.timeout || 3000;';
            const result = matchAndRewrite(source, logicalOrAssignRule);

            expect(result.hasChanged).toBe(true);
            expect(result.rewrittenSource).toBe('config.timeout ||= 3000;');
        });

        it('transforms nullish coalescing assignment to ??= operator', () => {
            const source = 'options.port = options.port ?? 8080;';
            const result = matchAndRewrite(source, nullishAssignRule);

            expect(result.hasChanged).toBe(true);
            expect(result.rewrittenSource).toBe('options.port ??= 8080;');
        });
    });

    describe('Array Methods Simplification', () => {
        const indexOfIncludesRule: PatternSpec = {
            id: 'simplify-indexof-includes',
            description: 'Simplify arr.indexOf(x) !== -1 to arr.includes(x)',
            pattern: '$ARR.indexOf($ITEM) !== -1',
            rewrite: '$ARR.includes($ITEM)',
            kind: 'expression',
        };

        it('rewrites indexOf comparison to includes() call', () => {
            const source = 'if (activeUsers.indexOf(targetUser) !== -1) { proceed(); }';
            const result = matchAndRewrite(source, indexOfIncludesRule);

            expect(result.hasChanged).toBe(true);
            expect(result.rewrittenSource).toBe(
                'if (activeUsers.includes(targetUser)) { proceed(); }',
            );
            expect(result.matches[0].bindings.$ARR.value).toBe('activeUsers');
            expect(result.matches[0].bindings.$ITEM.value).toBe('targetUser');
        });
    });

    describe('Wildcard Metavariable and Constraints', () => {
        it('supports anonymous wildcard metavariable $_ without equality constraint', () => {
            const logRule: PatternSpec = {
                id: 'remove-dev-logs',
                pattern: 'console.debug($_)',
                rewrite: '/* debug-cleared */',
                kind: 'expression',
            };
            const source = 'console.debug("a"); console.debug(calc());';
            const result = matchAndRewrite(source, logRule);

            expect(result.hasChanged).toBe(true);
            expect(result.matches).toHaveLength(2);
            expect(result.rewrittenSource).toBe('/* debug-cleared */; /* debug-cleared */;');
        });

        it('enforces where constraints on metavariables', () => {
            const constrainedRule: PatternSpec = {
                id: 'constrained-identifier-only',
                pattern: 'check($VAR)',
                rewrite: 'validated($VAR)',
                kind: 'expression',
                where: {
                    $VAR: {
                        kind: 'Identifier',
                        notEquals: 'forbidden',
                    },
                },
            };

            const matching = 'check(myParam);';
            const resMatching = matchAndRewrite(matching, constrainedRule);
            expect(resMatching.hasChanged).toBe(true);
            expect(resMatching.rewrittenSource).toBe('validated(myParam);');

            const rejectedValue = 'check(forbidden);';
            const resRejected = matchAndRewrite(rejectedValue, constrainedRule);
            expect(resRejected.hasChanged).toBe(false);

            const rejectedKind = 'check(123 + 456);';
            const resRejectedKind = matchAndRewrite(rejectedKind, constrainedRule);
            expect(resRejectedKind.hasChanged).toBe(false);
        });
    });

    describe('Multiple Non-Overlapping Matches', () => {
        it('applies multiple replacements across file without coordinate drift', () => {
            const rule: PatternSpec = {
                id: 'simplify-double-negation',
                pattern: '!(!$VAR)',
                rewrite: 'Boolean($VAR)',
                kind: 'expression',
            };

            const source = [
                'const a = !(!first);',
                'const b = "middle line unchanged";',
                'const c = !(!third.enabled);',
            ].join('\n');

            const result = matchAndRewrite(source, rule);
            expect(result.hasChanged).toBe(true);
            expect(result.matches).toHaveLength(2);
            expect(result.rewrittenSource).toBe(
                [
                    'const a = Boolean(first);',
                    'const b = "middle line unchanged";',
                    'const c = Boolean(third.enabled);',
                ].join('\n'),
            );
        });
    });

    describe('Search Query without Rewrite (matchPattern)', () => {
        it('matches patterns read-only and returns bindings without mutating source', () => {
            const rule: PatternSpec = {
                id: 'find-equality-check',
                pattern: '$A === $B',
                rewrite: '',
            };
            const source = 'if (status === 200 && code === "OK") {}';
            const matches = matchPattern(source, rule);

            expect(matches).toHaveLength(2);
            expect(matches[0].bindings.$A.value).toBe('status');
            expect(matches[0].bindings.$B.value).toBe('200');
            expect(matches[1].bindings.$A.value).toBe('code');
            expect(matches[1].bindings.$B.value).toBe('"OK"');
        });
    });

    describe('Facade Governance and Invariant Verification', () => {
        it('asserts valid PatternSpec and throws TypeError on corrupt input', () => {
            expect(() => assertValidPatternSpec(null)).toThrow(TypeError);
            expect(() => assertValidPatternSpec({})).toThrow(TypeError);
            expect(() => assertValidPatternSpec({ id: '', pattern: 'x', rewrite: 'y' })).toThrow(
                TypeError,
            );
            expect(() => assertValidPatternSpec({ id: 'x', pattern: '', rewrite: 'y' })).toThrow(
                TypeError,
            );
            expect(() =>
                assertValidPatternSpec({
                    id: 'x',
                    pattern: 'p',
                    rewrite: 'r',
                    kind: 'invalid' as any,
                }),
            ).toThrow(TypeError);

            const validSpec = { id: 'valid', pattern: '!(!$VAR)', rewrite: 'Boolean($VAR)' };
            expect(() => assertValidPatternSpec(validSpec)).not.toThrow();
        });

        it('freezes PatternSpec definitions preventing mutation', () => {
            const spec: PatternSpec = {
                id: 'frozen-rule',
                pattern: '$A + $B',
                rewrite: '$B + $A',
                where: { $A: { notEquals: '0' } },
            };
            const frozen = freezePatternSpec(spec);
            expect(Object.isFrozen(frozen)).toBe(true);
            if (frozen.where) {
                expect(Object.isFrozen(frozen.where)).toBe(true);
                expect(Object.isFrozen(frozen.where.$A)).toBe(true);
            }
        });

        it('compiles and validates entire pattern suites with createPatternSuite', () => {
            const suite = createPatternSuite([
                { id: 'r1', pattern: '!(!$VAR)', rewrite: 'Boolean($VAR)' },
                { id: 'r2', pattern: '$A = $A || $B', rewrite: '$A ||= $B' },
            ]);
            expect(suite).toHaveLength(2);
            expect(Object.isFrozen(suite)).toBe(true);
        });

        it('exposes immutable PatternFacade with all required methods', () => {
            expect(Object.isFrozen(PatternFacade)).toBe(true);
            expect(typeof PatternFacade.matchAndRewrite).toBe('function');
            expect(typeof PatternFacade.matchPattern).toBe('function');
            expect(typeof PatternFacade.compilePattern).toBe('function');
            expect(typeof PatternFacade.generateUnifiedDiff).toBe('function');
            expect(typeof PatternFacade.assertValidPatternSpec).toBe('function');
            expect(typeof PatternFacade.freezePatternSpec).toBe('function');
            expect(typeof PatternFacade.createPatternSuite).toBe('function');
            expect(Object.isFrozen(PatternFacade.engine)).toBe(true);
        });
    });
});
