/**
 * Module: Unit Tests — ReDoS Security (Safe Regex Helpers)
 * File Path: tests/unit/redos-security.test.ts
 * Architecture Role: Security test suite for the safe-regex utility module,
 *     validating that regex safety hardening is effective:
 *     1. auditRegexSafety correctly identifies known dangerous patterns
 *     2. safeRegexTest / safeRegexMatch complete in bounded time on adversarial input
 *     3. isRegexSafe rejects dangerous patterns
 *     4. escapeRegex, createPrefixedTest, buildAlternationRe work correctly
 * Migrated from: scripts/validate-redos-security.js
 * Test Type: Security / performance test
 */
import { describe, it, expect } from 'vitest';
import {
    auditRegexSafety,
    isRegexSafe,
    safeRegexTest,
    safeRegexMatch,
    safeRegexExecLoop,
    escapeRegex,
    createPrefixedTest,
    buildAlternationRe,
} from '../../src/utils/safe-regex';

const TIMEOUT_MS = 10; // Per-test timeout for "fast enough" check
const LONG_STRING_LENGTH = 10_000;

function measure<T>(fn: () => T): { result: T; ms: number } {
    const start = process.hrtime.bigint();
    const result = fn();
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1e6;
    return { result, ms };
}

describe('auditRegexSafety — pattern safety detection', () => {
    it('detects nested quantifier (a+)+', () => {
        const warnings = auditRegexSafety('(a+)+');
        expect(warnings.some((w) => w.includes('Nested quantifier'))).toBe(true);
    });

    it('detects alternation inside quantifier (a|aa)*', () => {
        const warnings = auditRegexSafety('(a|aa)*');
        expect(
            warnings.some((w) => w.includes('Alternation inside quantified group')),
        ).toBe(true);
    });

    it('detects backreference inside quantified group (a\\1)+', () => {
        const warnings = auditRegexSafety('(a\\1)+');
        expect(
            warnings.some((w) => w.includes('Backreference inside quantified group')),
        ).toBe(true);
    });

    it('warns about long alternation chains (>20 pipes)', () => {
        const longAlt = Array.from({ length: 25 }, (_, i) => `keyword${i}`).join('|');
        const warnings = auditRegexSafety(longAlt);
        expect(warnings.some((w) => w.includes('Long alternation chain'))).toBe(true);
    });
});

describe('isRegexSafe — pattern classification', () => {
    it('accepts simple literal "hello"', () => {
        expect(isRegexSafe('hello')).toBe(true);
    });

    it('accepts word-bounded literal', () => {
        expect(isRegexSafe('\\bword\\b')).toBe(true);
    });

    it('accepts simple character class + quantifier', () => {
        expect(isRegexSafe('[a-z]+')).toBe(true);
    });

    it('accepts short alternation', () => {
        expect(isRegexSafe('foo|bar|baz')).toBe(true);
    });

    it('rejects nested quantifier', () => {
        expect(isRegexSafe('(a+)+')).toBe(false);
    });

    it('rejects alternation-in-quantifier', () => {
        expect(isRegexSafe('(a|aa)*')).toBe(false);
    });

    it('rejects catastrophic (a+)+b pattern', () => {
        expect(isRegexSafe('(a+)+b')).toBe(false);
    });
});

describe('safeRegexTest — bounded time on adversarial input', () => {
    it('completes quickly on nested-quantifier regex with 10k chars', () => {
        const evilRe = /^(a+)+$/;
        const evilInput = 'a'.repeat(LONG_STRING_LENGTH) + '!';

        const { ms } = measure(() => safeRegexTest(evilRe, evilInput));
        expect(ms).toBeLessThan(TIMEOUT_MS * 5);
    });

    it('finds match on short string', () => {
        expect(safeRegexTest(/hello/, 'hello world')).toBe(true);
    });

    it('correctly rejects non-match', () => {
        expect(safeRegexTest(/hello/, 'goodbye world')).toBe(false);
    });
});

describe('safeRegexMatch — bounded extraction on long input', () => {
    it('completes quickly with long alternation on 10k non-matching chars', () => {
        const longAltMatchRe =
            /\b(?:readFileSync|writeFileSync|appendFileSync|copyFileSync|readdirSync|accessSync|existsSync|statSync|lstatSync|rmSync|rmdirSync|mkdirSync|openSync|closeSync|renameSync|unlinkSync)\b/;
        const longInput = 'x'.repeat(LONG_STRING_LENGTH);

        const { ms } = measure(() => safeRegexMatch(longInput, longAltMatchRe));
        expect(ms).toBeLessThan(TIMEOUT_MS);
    });

    it('extracts correct match from short matching string', () => {
        const longAltMatchRe =
            /\b(?:readFileSync|writeFileSync|appendFileSync|copyFileSync|readdirSync|accessSync|existsSync|statSync|lstatSync|rmSync|rmdirSync|mkdirSync|openSync|closeSync|renameSync|unlinkSync)\b/;
        const matchingLine = '  fs.readFileSync(path);  ';
        const result = safeRegexMatch(matchingLine, longAltMatchRe);
        expect(result).not.toBeNull();
        expect(result![0]).toBe('readFileSync');
    });
});

describe('safeRegexExecLoop — bounded iteration', () => {
    it('respects iteration cap', () => {
        const tokenRe = /[a-z]+/g;
        const longAlpha = 'abc '.repeat(LONG_STRING_LENGTH / 4);
        let matchCount = 0;

        const { ms } = measure(() => {
            matchCount = safeRegexExecLoop(
                tokenRe,
                longAlpha,
                () => true, // continue
                100, // cap at 100 iterations
            );
        });

        expect(matchCount).toBeLessThanOrEqual(100);
        expect(ms).toBeLessThan(TIMEOUT_MS);
    });
});

describe('escapeRegex correctness', () => {
    it('produces pattern that matches the original literal', () => {
        const special = 'hello.world+test?';
        const escaped = escapeRegex(special);
        const re = new RegExp(`^${escaped}$`);
        expect(re.test(special)).toBe(true);
    });

    it('properly escapes metacharacters', () => {
        const special = 'hello.world+test?';
        const escaped = escapeRegex(special);
        const re = new RegExp(`^${escaped}$`);
        expect(re.test('helloXworldYtestZ')).toBe(false);
    });
});

describe('createPrefixedTest — substring pre-gating', () => {
    it('passes on matching input', () => {
        const prefixedTest = createPrefixedTest('Sync', /\breadFileSync\s*\(/);
        expect(prefixedTest('fs.readFileSync("x")')).toBe(true);
    });

    it('rejects non-matching (no prefix)', () => {
        const prefixedTest = createPrefixedTest('Sync', /\breadFileSync\s*\(/);
        expect(prefixedTest('fs.readFile("x")')).toBe(false);
    });

    it('rejects unrelated input', () => {
        const prefixedTest = createPrefixedTest('Sync', /\breadFileSync\s*\(/);
        expect(prefixedTest('console.log("hello")')).toBe(false);
    });

    it('is near-instant on long non-matching string (substring fast-path)', () => {
        const prefixedTest = createPrefixedTest('Sync', /\breadFileSync\s*\(/);
        const longNoMatch = 'x'.repeat(LONG_STRING_LENGTH);

        const { ms } = measure(() => prefixedTest(longNoMatch));
        expect(ms).toBeLessThan(1);
    });
});

describe('buildAlternationRe — safe alternation construction', () => {
    it('matches included word', () => {
        const words = ['alpha', 'beta', 'gamma', 'delta'];
        const { re } = buildAlternationRe(words);
        expect(re.test('alpha')).toBe(true);
    });

    it('rejects excluded word', () => {
        const words = ['alpha', 'beta', 'gamma', 'delta'];
        const { re } = buildAlternationRe(words);
        expect(re.test('epsilon')).toBe(false);
    });

    it('has no safety warnings for normal word list', () => {
        const words = ['alpha', 'beta', 'gamma', 'delta'];
        const { warnings } = buildAlternationRe(words);
        expect(warnings.length).toBe(0);
    });

    it('escapes dot correctly', () => {
        const specialWords = ['foo.bar', 'baz+qux'];
        const { re } = buildAlternationRe(specialWords);
        expect(re.test('foo.bar')).toBe(true);
        expect(re.test('fooXbar')).toBe(false);
    });

    it('escapes plus correctly', () => {
        const specialWords = ['foo.bar', 'baz+qux'];
        const { re } = buildAlternationRe(specialWords);
        expect(re.test('baz+qux')).toBe(true);
        expect(re.test('bazzzqux')).toBe(false);
    });
});

describe('User pattern validation integration', () => {
    it('filters unsafe patterns from user-supplied list', () => {
        const userPatterns = [
            'ghp_[A-Za-z0-9]{20,}', // safe
            '(a+)+', // unsafe — nested quantifier
            'sk-[A-Za-z0-9]{20,}', // safe
        ];

        const safePatterns = userPatterns.filter((p) => isRegexSafe(p));
        expect(safePatterns.length).toBe(2);
        expect(safePatterns).toContain('ghp_[A-Za-z0-9]{20,}');
        expect(safePatterns).toContain('sk-[A-Za-z0-9]{20,}');
        expect(safePatterns).not.toContain('(a+)+');
    });

    it('flags at least one unsafe pattern in jargon-style list', () => {
        const jargonPatterns = [
            'p[0-9]+', // safe
            '(wip|todo)+', // alternation inside quantifier
            'phase[0-9]+', // safe
        ];

        const hasUnsafe = jargonPatterns.some((p) => !isRegexSafe(p));
        expect(hasUnsafe).toBe(true);
    });
});

describe('End-to-end: key analyzer regexes on long pathological strings', () => {
    it('SYNC_FS_RE equivalent completes in < 10ms on 10k chars', () => {
        const syncFsRe =
            /\b(?:readFileSync|writeFileSync|appendFileSync|copyFileSync|readdirSync|accessSync|existsSync|statSync|lstatSync|rmSync|rmdirSync|mkdirSync|openSync|closeSync|renameSync|unlinkSync)\s*\(/;
        const longRepeated = 'a'.repeat(LONG_STRING_LENGTH);

        const { ms } = measure(() => safeRegexTest(syncFsRe, longRepeated));
        expect(ms).toBeLessThan(TIMEOUT_MS);
    });

    it('TEXT_VARIABLE_RE equivalent completes in < 10ms on 500-char identifier', () => {
        const textVarRe = /^[a-zA-Z0-9_$]*(?:str|text|line|content|name|msg)$/i;
        const longIdent = 'x'.repeat(500);

        const { ms } = measure(() => safeRegexTest(textVarRe, longIdent));
        expect(ms).toBeLessThan(TIMEOUT_MS);
    });

    it('TOKEN_RE exec loop (capped at 50) completes in < 10ms on 10k alphanumeric', () => {
        const tokenRe = /[A-Za-z0-9_\-=]{16,}/g;
        const longMixed = 'abcdefghij'.repeat(LONG_STRING_LENGTH / 10);
        let tokenCount = 0;

        const { ms } = measure(() => {
            tokenCount = safeRegexExecLoop(tokenRe, longMixed, () => true, 50);
        });

        expect(ms).toBeLessThan(TIMEOUT_MS);
        expect(tokenCount).toBeGreaterThanOrEqual(0);
    });
});
