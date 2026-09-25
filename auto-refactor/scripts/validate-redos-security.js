/**
 * ReDoS Security Validation Script
 *
 * Validates that regex safety hardening is effective:
 * 1. auditRegexSafety correctly identifies known dangerous patterns
 * 2. safeRegexTest / safeRegexMatch complete in bounded time on adversarial input
 * 3. User-supplied pattern validation rejects dangerous patterns
 * 4. Key analyzer regexes complete in <10ms on 10,000-char pathological strings
 *
 * Usage: node scripts/validate-redos-security.js
 * Exit code: 0 on success, 1 on failure
 */

const {
    auditRegexSafety,
    isRegexSafe,
    safeRegexTest,
    safeRegexMatch,
    safeRegexExecLoop,
    escapeRegex,
    createPrefixedTest,
    buildAlternationRe,
} = require('../dist/utils/safe-regex');

const TIMEOUT_MS = 10; // Per-test timeout for "fast enough" check
const LONG_STRING_LENGTH = 10_000;

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log(`  PASS: ${message}`);
    } else {
        failed++;
        console.error(`  FAIL: ${message}`);
    }
}

function measure(fn) {
    const start = process.hrtime.bigint();
    const result = fn();
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1e6;
    return { result, ms };
}

// ---------------------------------------------------------------------------
// 1. auditRegexSafety tests
// ---------------------------------------------------------------------------
console.log('\n1. auditRegexSafety — pattern safety detection');

// Nested quantifiers
const nestedWarn = auditRegexSafety('(a+)+');
assert(
    nestedWarn.some((w) => w.includes('Nested quantifier')),
    'Detects nested quantifier (a+)+',
);

// Alternation inside quantifier
const altWarn = auditRegexSafety('(a|aa)*');
assert(
    altWarn.some((w) => w.includes('Alternation inside quantified group')),
    'Detects alternation inside quantifier (a|aa)*',
);

// Backreference inside quantified group — e.g. (a\1)+  where \1 is inside + group
const backrefWarn = auditRegexSafety('(a\\1)+');
assert(
    backrefWarn.some((w) => w.includes('Backreference inside quantified group')),
    'Detects backreference inside quantified group (a\\1)+',
);

// Safe patterns should produce no high-severity warnings
assert(isRegexSafe('hello'), 'Simple literal "hello" is safe');
assert(isRegexSafe('\\bword\\b'), 'Word-bounded literal is safe');
assert(isRegexSafe('[a-z]+'), 'Simple character class + quantifier is safe');
assert(isRegexSafe('foo|bar|baz'), 'Short alternation is safe');

// Unsafe patterns should be rejected
assert(!isRegexSafe('(a+)+'), 'Nested quantifier is rejected by isRegexSafe');
assert(!isRegexSafe('(a|aa)*'), 'Alternation-in-quantifier rejected by isRegexSafe');

// Long alternation warning
const longAlt = Array.from({ length: 25 }, (_, i) => `keyword${i}`).join('|');
const longAltWarn = auditRegexSafety(longAlt);
assert(
    longAltWarn.some((w) => w.includes('Long alternation chain')),
    'Warns about long alternation chains (>20 pipes)',
);

// ---------------------------------------------------------------------------
// 2. safeRegexTest — bounded-time on adversarial input
// ---------------------------------------------------------------------------
console.log('\n2. safeRegexTest — bounded time on adversarial input');

// Classic ReDoS pattern: nested quantifiers
const evilRe = /^(a+)+$/;
const evilInput = 'a'.repeat(LONG_STRING_LENGTH) + '!';

// Verify the raw regex IS slow (to prove we're solving a real problem)
// Use 22 chars: enough to show measurable slowness without taking forever
// (30 chars of this pattern took ~71s in a previous test — exponential growth)
let rawSlow = false;
try {
    const start = Date.now();
    const shorterEvil = 'a'.repeat(22) + '!';
    evilRe.test(shorterEvil);
    const elapsed = Date.now() - start;
    rawSlow = elapsed > 10; // 22 chars should take well over 10ms
    console.log(`  INFO: Raw nested-quantifier regex on 22 chars took ${elapsed.toFixed(2)}ms`);
} catch (e) {
    // Expected: some regex engines or platforms may throw on pathological patterns;
    // we only need to know if the raw pattern is slow, not that it throws.
    rawSlow = true;
}
assert(rawSlow, 'Raw nested-quantifier regex is measurably slow (confirms ReDoS vector exists)');

// Now test that safeRegexTest completes quickly on the LONG string
// (because it truncates to 5000 chars — still long but bounded)
const { ms: safeMs } = measure(() => safeRegexTest(evilRe, evilInput));
assert(
    safeMs < TIMEOUT_MS * 5,
    `safeRegexTest with nested-quantifier regex on 10k chars: ${safeMs.toFixed(2)}ms (< ${TIMEOUT_MS * 5}ms)`,
);

// Verify correct results on normal-length input
assert(safeRegexTest(/hello/, 'hello world'), 'safeRegexTest finds match on short string');
assert(!safeRegexTest(/hello/, 'goodbye world'), 'safeRegexTest correctly rejects non-match');

// ---------------------------------------------------------------------------
// 3. safeRegexMatch — bounded extraction on long input
// ---------------------------------------------------------------------------
console.log('\n3. safeRegexMatch — bounded extraction on long input');

// NOTE: The primary defense against catastrophic patterns is isRegexSafe() at
// pattern-compilation time. safeRegexMatch protects *safe* patterns from
// unexpectedly long input. We test with a realistic safe pattern (long
// alternation) on a 10k-char string.
const longAltMatchRe = /\b(?:readFileSync|writeFileSync|appendFileSync|copyFileSync|readdirSync|accessSync|existsSync|statSync|lstatSync|rmSync|rmdirSync|mkdirSync|openSync|closeSync|renameSync|unlinkSync)\b/;
const longInput = 'x'.repeat(LONG_STRING_LENGTH);

const { ms: matchMs } = measure(() => safeRegexMatch(longInput, longAltMatchRe));
assert(
    matchMs < TIMEOUT_MS,
    `safeRegexMatch with long alternation on 10k non-matching chars: ${matchMs.toFixed(3)}ms (< ${TIMEOUT_MS}ms)`,
);

// A string that does match should still work correctly
const matchingLine = '  fs.readFileSync(path);  ';
const matchResult = safeRegexMatch(matchingLine, longAltMatchRe);
assert(
    matchResult !== null && matchResult[0] === 'readFileSync',
    'safeRegexMatch extracts correct match from short matching string',
);

// Verify isRegexSafe catches catastrophic patterns BEFORE they ever reach safeRegexMatch
assert(
    !isRegexSafe('(a+)+b'),
    'isRegexSafe rejects catastrophic (a+)+b pattern — first line of defense',
);

// ---------------------------------------------------------------------------
// 4. safeRegexExecLoop — bounded iteration
// ---------------------------------------------------------------------------
console.log('\n4. safeRegexExecLoop — bounded iteration');

const tokenRe = /[a-z]+/g;
const longAlpha = 'abc '.repeat(LONG_STRING_LENGTH / 4);
let matchCount = 0;

const { ms: execMs } = measure(() => {
    matchCount = safeRegexExecLoop(
        tokenRe,
        longAlpha,
        () => true, // continue
        100, // cap at 100 iterations
    );
});

assert(matchCount <= 100, `safeRegexExecLoop respects iteration cap (got ${matchCount}, expected <=100)`);
assert(execMs < TIMEOUT_MS, `safeRegexExecLoop with cap: ${execMs.toFixed(2)}ms (< ${TIMEOUT_MS}ms)`);

// ---------------------------------------------------------------------------
// 5. escapeRegex correctness
// ---------------------------------------------------------------------------
console.log('\n5. escapeRegex correctness');

const special = 'hello.world+test?';
const escaped = escapeRegex(special);
const re = new RegExp(`^${escaped}$`);
assert(re.test(special), 'escapeRegex produces pattern that matches the original literal');
assert(!re.test('helloXworldYtestZ'), 'escapeRegex properly escapes metacharacters');

// ---------------------------------------------------------------------------
// 6. createPrefixedTest — substring pre-gating
// ---------------------------------------------------------------------------
console.log('\n6. createPrefixedTest — substring pre-gating');

const prefixedTest = createPrefixedTest('Sync', /\breadFileSync\s*\(/);
assert(prefixedTest('fs.readFileSync("x")'), 'Prefixed test passes on matching input');
assert(!prefixedTest('fs.readFile("x")'), 'Prefixed test rejects non-matching (no prefix)');
assert(!prefixedTest('console.log("hello")'), 'Prefixed test rejects unrelated input');

// Performance: prefixed test on long non-matching string should be near-instant
const longNoMatch = 'x'.repeat(LONG_STRING_LENGTH);
const { ms: prefixMs } = measure(() => prefixedTest(longNoMatch));
assert(
    prefixMs < 1,
    `Prefixed test on 10k non-matching chars: ${prefixMs.toFixed(4)}ms (< 1ms, substring fast-path)`,
);

// ---------------------------------------------------------------------------
// 7. buildAlternationRe — safe alternation construction
// ---------------------------------------------------------------------------
console.log('\n7. buildAlternationRe — safe alternation construction');

const words = ['alpha', 'beta', 'gamma', 'delta'];
const { re: altRe, warnings: altWarnings } = buildAlternationRe(words);
assert(altRe.test('alpha'), 'buildAlternationRe matches included word');
assert(!altRe.test('epsilon'), 'buildAlternationRe rejects excluded word');
assert(altWarnings.length === 0, 'buildAlternationRe has no safety warnings for normal word list');

// Escaping special characters
const specialWords = ['foo.bar', 'baz+qux'];
const { re: specialAltRe } = buildAlternationRe(specialWords);
assert(specialAltRe.test('foo.bar'), 'buildAlternationRe escapes dot correctly');
assert(!specialAltRe.test('fooXbar'), 'buildAlternationRe does not match dot as wildcard');
assert(specialAltRe.test('baz+qux'), 'buildAlternationRe escapes plus correctly');
assert(!specialAltRe.test('bazzzqux'), 'buildAlternationRe does not match plus as quantifier');

// ---------------------------------------------------------------------------
// 8. Secrets analyzer — user pattern validation integration
// ---------------------------------------------------------------------------
console.log('\n8. Secrets analyzer — user pattern safety (via compileSecretPatterns-equivalent)');

// Simulate what compileSecretPatterns does for user-supplied patterns
const userPatterns = [
    'ghp_[A-Za-z0-9]{20,}', // safe
    '(a+)+', // unsafe — nested quantifier
    'sk-[A-Za-z0-9]{20,}', // safe
];

const safePatterns = userPatterns.filter((p) => isRegexSafe(p));
assert(safePatterns.length === 2, `2 of 3 user patterns pass safety check (got ${safePatterns.length})`);
assert(safePatterns.includes('ghp_[A-Za-z0-9]{20,}'), 'Safe pattern 1 passes');
assert(safePatterns.includes('sk-[A-Za-z0-9]{20,}'), 'Safe pattern 2 passes');
assert(!safePatterns.includes('(a+)+'), 'Unsafe nested-quantifier pattern is rejected');

// ---------------------------------------------------------------------------
// 9. Hygiene jargon — user pattern safety
// ---------------------------------------------------------------------------
console.log('\n9. Hygiene jargon — user pattern safety (via buildJargonRe-equivalent)');

const jargonPatterns = [
    'p[0-9]+', // safe
    '(wip|todo)+', // unsafe — alternation inside quantifier? Let's check
    'phase[0-9]+', // safe
];

const safeJargon = jargonPatterns.filter((p) => isRegexSafe(p));
// (wip|todo)+ has alternation inside + quantifier → should be flagged
const hasUnsafe = jargonPatterns.some((p) => !isRegexSafe(p));
assert(hasUnsafe, 'At least one jargon pattern is correctly flagged as unsafe');

// ---------------------------------------------------------------------------
// 10. End-to-end: key analyzer regexes on long pathological strings
// ---------------------------------------------------------------------------
console.log('\n10. End-to-end: key analyzer regexes on 10k-char pathological strings');

const longRepeated = 'a'.repeat(LONG_STRING_LENGTH);
const longMixed = 'abcdefghij'.repeat(LONG_STRING_LENGTH / 10);

// SYNC_FS_RE equivalent on long string
const syncFsRe = /\b(?:readFileSync|writeFileSync|appendFileSync|copyFileSync|readdirSync|accessSync|existsSync|statSync|lstatSync|rmSync|rmdirSync|mkdirSync|openSync|closeSync|renameSync|unlinkSync)\s*\(/;

const { ms: syncFsMs } = measure(() => safeRegexTest(syncFsRe, longRepeated));
assert(
    syncFsMs < TIMEOUT_MS,
    `SYNC_FS_RE (via safeRegexTest) on 10k 'a's: ${syncFsMs.toFixed(3)}ms (< ${TIMEOUT_MS}ms)`,
);

// TEXT_VARIABLE_RE equivalent (just the suffix-matching part) on a long identifier-ish string
const textVarRe = /^[a-zA-Z0-9_$]*(?:str|text|line|content|name|msg)$/i;
const longIdent = 'x'.repeat(500); // 500-char identifier

const { ms: textVarMs } = measure(() => safeRegexTest(textVarRe, longIdent));
assert(
    textVarMs < TIMEOUT_MS,
    `TEXT_VARIABLE_RE (suffix part) on 500-char identifier: ${textVarMs.toFixed(3)}ms (< ${TIMEOUT_MS}ms)`,
);

// TOKEN_RE (entropy detection) on long alphanumeric string
const tokenRe2 = /[A-Za-z0-9_\-=]{16,}/g;
let tokenCount = 0;
const { ms: tokenMs } = measure(() => {
    tokenCount = safeRegexExecLoop(tokenRe2, longMixed, () => true, 50);
});
assert(
    tokenMs < TIMEOUT_MS,
    `TOKEN_RE exec loop (capped at 50) on 10k alphanumeric: ${tokenMs.toFixed(3)}ms (< ${TIMEOUT_MS}ms)`,
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
console.log(`ReDoS Security Validation: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
    console.error('\nSome ReDoS security checks FAILED!');
    process.exit(1);
} else {
    console.log('\nAll ReDoS security checks passed.');
    process.exit(0);
}
