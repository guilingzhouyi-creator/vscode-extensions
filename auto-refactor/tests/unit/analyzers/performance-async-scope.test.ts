/**
 * Module: Performance async scope regression tests
 * File Path: tests/unit/analyzers/performance-async-scope.test.ts
 * Architecture Role: Public analyzer behavior tests for blocking I/O severity.
 * Dependencies & Triggers: Vitest and PerformanceAnalyzer; discovered by the unit suite.
 * Responsibilities: Keep lexical async scopes bounded without losing real blocking calls.
 * Exit Semantics & Design Rationale: Deterministic source fixtures assert rule locations and severity.
 */
import { describe, expect, it } from 'vitest';
import { PerformanceAnalyzer } from '../../../src/analyzers/performance';

function blockingIssues(content: string, filePath = 'scope.ts') {
    return new PerformanceAnalyzer().analyze(undefined, {
        filePath,
        content,
        config: {},
        options: {},
    }).filter((issue) => issue.rule === 'PRF-IO-001');
}

describe('PerformanceAnalyzer async blocking scope', () => {
    it('ends async scope before a following synchronous method', () => {
        const content = [
            'class Journal {',
            '    async repair() {',
            '        fs.readFileSync(path);',
            '    }',
            '    appendSync() {',
            '        fs.appendFileSync(path, data);',
            '    }',
            '}',
        ].join('\n');
        expect(blockingIssues(content).map(({ location, severity }) => [location?.start.line, severity])).toEqual([
            [3, 'error'], [6, 'warning'],
        ]);
    });

    it.each([
        ['string', '    const closer = "}";'],
        ['template', '    const closer = `}`;'],
        ['inline comment', '    const value = 1; // }'],
        ['block comment', '    const value = 1; /* } */'],
        ['regex', '    const closer = /}/;'],
    ])('ignores a closing brace in a %s', (_, literal) => {
        const content = ['async function repair() {', literal, '    fs.readFileSync(path);', '}'].join('\n');
        expect(blockingIssues(content).map(({ severity }) => severity)).toEqual(['error']);
    });

    it('restores the outer async scope after an inner async routine closes', () => {
        const content = [
            'async function outer() {',
            '    async function inner() {',
            '        fs.readFileSync(path);',
            '    }',
            '    fs.writeFileSync(path, data);',
            '}',
            'fs.appendFileSync(path, data);',
        ].join('\n');
        expect(blockingIssues(content).map(({ severity }) => severity)).toEqual(['error', 'error', 'warning']);
    });

    it('keeps an async declaration pending until its multiline body opens', () => {
        const content = [
            'async function repair(',
            '    path: string,',
            ')',
            '{',
            '    fs.readFileSync(path);',
            '}',
            'fs.writeFileSync(path, data);',
        ].join('\n');
        expect(blockingIssues(content).map(({ severity }) => severity)).toEqual(['error', 'warning']);
    });

    it('classifies a call before a same-line async body closes', () => {
        expect(blockingIssues('async function repair() { fs.readFileSync(path); }')
            .map(({ severity }) => severity)).toEqual(['error']);
    });

    it('does not find blocking calls or async declarations inside literals', () => {
        const content = [
            'const example = "async function repair() { fs.readFileSync(path);";',
            'fs.writeFileSync(path, data);',
        ].join('\n');
        expect(blockingIssues(content).map(({ location, severity }) => [location?.start.line, severity])).toEqual([[2, 'warning']]);
    });

    it.each([
        ['ts', 'async function load() {', '    const value = `result: ${fs.readFileSync(path)}`;', '}'],
        ['py', 'async def load():', '    value = f"result: {time.sleep(1)}"', ''],
    ])('retains executable interpolation checks in %s', (extension, declaration, body, end) => {
        const content = [declaration, body, end].join('\n');
        expect(blockingIssues(content, `scope.${extension}`).map(({ severity }) => severity))
            .toEqual(['error']);
    });

    it.each(['py', 'gd'])('uses indentation scopes in %s', (extension) => {
        const declaration = extension === 'py' ? 'async def repair():' : 'async func repair():';
        const content = [declaration, '    if ready:', '        time.sleep(1)', '', '# comment', 'time.sleep(1)']
            .join('\n');
        expect(blockingIssues(content, `scope.${extension}`).map(({ severity }) => severity))
            .toEqual(['error', 'warning']);
    });
});
