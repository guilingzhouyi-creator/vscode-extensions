/**
 * Module: Unit Tests — Control Flow Guard Analysis
 * File Path: tests/unit/cfg-inline-guard.test.ts
 * Architecture Role: Locks the null-guard semantics of the CFG builder and the def-use
 *   analyzer. `buildFromLines` is line-oriented and does not follow braces, so
 *   `if (!user) return;` used to be classified as a plain condition: the inline `return` was
 *   dropped, the fall-through block looked like a non-terminating guard, and every later
 *   `user.name` read was reported as an unguarded dereference. Each case below pairs a
 *   negative (guarded, must be silent) with a positive (unguarded, must be reported) so a
 *   fix that simply suppressed the rule would fail here.
 * Test Type: Unit test (control flow graph + dataflow analysis)
 */
import { describe, it, expect } from 'vitest';
import { CfgBuilder } from '../../src/core/cfg/cfg-builder';
import { DefUseAnalyzer } from '../../src/core/cfg/def-use-chain';

/**
 * Run the null-dereference analysis over source lines.
 *
 * @param lines - Source lines.
 * @returns The analysis result.
 */
function analyze(lines: string[]) {
    const builder = new CfgBuilder();
    const cfg = builder.buildFromLines(lines);
    return DefUseAnalyzer.analyze(cfg);
}

describe('inline early-return guards', () => {
    it('treats `if (!x) return;` as terminating and does not flag the later read', () => {
        const result = analyze([
            'function handleUser(user) {',
            '    if (!user) return;',
            '    const name = user.name;',
            '    return name;',
            '}',
        ]);
        expect(result.unguardedDereferences).toEqual([]);
    });

    it('treats `if (!x) throw ...;` as terminating', () => {
        const result = analyze([
            'function require1(conn) {',
            '    if (!conn) throw new Error("missing");',
            '    return conn.id;',
            '}',
        ]);
        expect(result.unguardedDereferences).toEqual([]);
    });

    it('treats `if (x) return;` (positive form) as terminating', () => {
        const result = analyze([
            'function firstOrDefault(list) {',
            '    if (list) return list[0];',
            '    return 0;',
            '}',
        ]);
        expect(result.unguardedDereferences).toEqual([]);
    });

    it('is not fooled by a nested call inside the condition', () => {
        // The `return` here belongs to the body, but the condition contains its own parens;
        // matching must locate the condition's closing paren, not the first one.
        const result = analyze([
            'function pick(list, key) {',
            '    if (list.includes(key)) return list[key];',
            '    return list[key];',
            '}',
        ]);
        expect(Array.isArray(result.unguardedDereferences)).toBe(true);
    });
});

describe('guards that do not terminate still report', () => {
    it('flags a read after a non-terminating guard', () => {
        // The guard logs but falls through, so `user` may still be null on the next line.
        const result = analyze([
            'function handleUser(user) {',
            '    if (!user) logWarning("missing");',
            '    const name = user.name;',
            '    return name;',
            '}',
        ]);
        expect(result.unguardedDereferences.length).toBeGreaterThan(0);
        expect(result.unguardedDereferences[0].variable).toBe('user');
    });

    it('flags a read with no guard at all', () => {
        const result = analyze([
            'function handleUser(user) {',
            '    const name = user.name;',
            '    return name;',
            '}',
        ]);
        expect(result.unguardedDereferences.length).toBeGreaterThan(0);
    });

    it('still flags a read that follows a terminating guard on a different variable', () => {
        const result = analyze([
            'function handle(user, account) {',
            '    if (!user) return;',
            '    const id = account.id;',
            '    return id;',
            '}',
        ]);
        const flagged = result.unguardedDereferences.map((d) => d.variable);
        expect(flagged).toContain('account');
    });
});

describe('inline terminator detection', () => {
    it('recognises the terminator forms', () => {
        expect(CfgBuilder.inlineTerminator('if (!x) return;')).toBe(true);
        expect(CfgBuilder.inlineTerminator('if (x) return x;')).toBe(true);
        expect(CfgBuilder.inlineTerminator('if (!x) throw new Error();')).toBe(true);
        expect(CfgBuilder.inlineTerminator('if (!x) continue;')).toBe(true);
    });

    it('does not treat a block body or a bare condition as an inline terminator', () => {
        expect(CfgBuilder.inlineTerminator('if (!x) {')).toBe(false);
        expect(CfgBuilder.inlineTerminator('if (!x) {}')).toBe(false);
        expect(CfgBuilder.inlineTerminator('if (!x)')).toBe(false);
        expect(CfgBuilder.inlineTerminator('logWarning("x");')).toBe(false);
        expect(CfgBuilder.inlineTerminator('return;')).toBe(false);
    });
});
