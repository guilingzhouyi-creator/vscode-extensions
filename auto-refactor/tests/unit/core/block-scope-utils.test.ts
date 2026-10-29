/**
 * Module: Unit Test — Block & Scope Lexical Traversal Utilities
 * File Path: tests/unit/core/block-scope-utils.test.ts
 * Architecture Role: Verifies zero-allocation indentation calculation, line/text brace pairing,
 *   polyglot comment/blank detection, and meaningful statement counting.
 * Dependencies & Triggers: vitest (describe, it, expect); imports ../../../src/core/ast/block-scope-utils.
 * Responsibilities: Assert accuracy of calculateIndentWidth, findMatchingBraceInLines,
 *   findMatchingBraceInText, isCommentOrBlankLine, and statement counting.
 * Exit Semantics & Design Rationale: Deterministic in-memory unit tests; all assertions must hold.
 */

import { describe, it, expect } from 'vitest';
import {
    isCommentOrBlankLine,
    calculateIndentWidth,
    findMatchingBraceInLines,
    findMatchingBraceInText,
    advancePastBlanksAndComments,
    findLastMeaningfulLine,
    countMeaningfulStatements,
} from '../../../src/core/ast/block-scope-utils';

describe('Block & Scope Utilities — isCommentOrBlankLine', () => {
    it('identifies blank and whitespace lines', () => {
        expect(isCommentOrBlankLine('')).toBe(true);
        expect(isCommentOrBlankLine('   ')).toBe(true);
    });

    it('identifies C-family single-line and block comments', () => {
        expect(isCommentOrBlankLine('// this is a comment')).toBe(true);
        expect(isCommentOrBlankLine('/* start block')).toBe(true);
        expect(isCommentOrBlankLine('* continuation')).toBe(true);
    });

    it('identifies Python, Shell, and GDScript hash comments', () => {
        expect(isCommentOrBlankLine('# python comment')).toBe(true);
    });

    it('does not flag normal code statements', () => {
        expect(isCommentOrBlankLine('const x = 42;')).toBe(false);
        expect(isCommentOrBlankLine('def solve():')).toBe(false);
    });
});

describe('Block & Scope Utilities — calculateIndentWidth', () => {
    it('computes space and tab indentation widths without heap allocations', () => {
        expect(calculateIndentWidth('')).toBe(0);
        expect(calculateIndentWidth('code()')).toBe(0);
        expect(calculateIndentWidth('    code()')).toBe(4);
        expect(calculateIndentWidth('\t\tcode()')).toBe(2);
        expect(calculateIndentWidth('  \tcode()')).toBe(3);
    });
});

describe('Block & Scope Utilities — findMatchingBraceInLines & inText', () => {
    it('finds matching closing brace in line array with nested blocks', () => {
        const lines = [
            'function test() {',
            '    if (true) {',
            '        doSomething();',
            '    }',
            '}',
            'export const x = 1;',
        ];
        expect(findMatchingBraceInLines(lines, 0)).toBe(4);
        expect(findMatchingBraceInLines(lines, 1)).toBe(3);
    });

    it('returns -1 when braces are unclosed in lines', () => {
        const lines = ['function unclosed() {', '    doSomething();'];
        expect(findMatchingBraceInLines(lines, 0)).toBe(-1);
    });

    it('finds matching closing brace in raw text', () => {
        const text = 'if (cond) { a(); { b(); } } return;';
        const openIdx = text.indexOf('{');
        const closeIdx = findMatchingBraceInText(text, openIdx);
        expect(closeIdx).toBe(26);
    });

    it('returns -1 when braces are unclosed in text', () => {
        const text = 'if (cond) { a();';
        expect(findMatchingBraceInText(text, text.indexOf('{'))).toBe(-1);
    });
});

describe('Block & Scope Utilities — statement and line scanning', () => {
    it('advances past blank and comment lines accurately', () => {
        const lines = [
            '// comment 1',
            '   ',
            '# comment 2',
            'const active = true;',
            'return active;',
        ];
        expect(advancePastBlanksAndComments(lines, 0)).toBe(3);
        expect(advancePastBlanksAndComments(lines, 3)).toBe(3);
    });

    it('finds last meaningful statement ignoring comments and standalone braces', () => {
        const lines = [
            'if (true) {',
            '    const v = 1;',
            '    // comment',
            '    return v;',
            '}',
        ];
        expect(findLastMeaningfulLine(lines, 0, 4)).toBe(3);
    });

    it('counts meaningful statements excluding comments and standalone braces', () => {
        const lines = [
            '// preamble',
            'let a = 1;',
            '/* block comment */',
            'let b = 2;',
            '// another comment',
            'return a + b;',
        ];
        expect(countMeaningfulStatements(lines, 0, lines.length)).toBe(3);
    });
});
