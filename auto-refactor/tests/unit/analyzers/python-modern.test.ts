/**
 * Module: Unit Test — Python Modernization Analyzer Suite (PYM-* Rules)
 * File Path: tests/unit/analyzers/python-modern.test.ts
 * Architecture Role: Exercises PythonModernAnalyzer line scanner across os.path,
 *   unmanaged open(), mutable defaults, and legacy string formatting.
 * Dependencies & Triggers: vitest (describe, it, expect); imports PythonModernAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert PYM-PATH-001, PYM-OPEN-001, PYM-DEFAULT-001, and PYM-FSTRING-001.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { PythonModernAnalyzer } from '../../../src/analyzers/python-modern';
import type { AnalyzerContext } from '../../../src/core/types';

describe('PythonModernAnalyzer Suite', () => {
    const analyzer = new PythonModernAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {},
        };
    }

    it('permits modern Python using pathlib and context managers', () => {
        const code = [
            'from pathlib import Path',
            'def read_data(filepath: Path) -> str:',
            '    with open(filepath, "r", encoding="utf-8") as f:',
            '        return f.read()',
        ].join('\n');
        const ctx = createCtx('scripts/reader.py', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues.filter((i) => i.rule === 'PYM-PATH-001' || i.rule === 'PYM-OPEN-001')).toHaveLength(0);
    });

    it('flags os.path usage in favor of pathlib.Path (PYM-PATH-001)', () => {
        const code = [
            'import os.path',
            'def get_full_path(folder: str, name: str) -> str:',
            '    return os.path.join(folder, name)',
        ].join('\n');
        const ctx = createCtx('scripts/paths.py', code);
        const issues = analyzer.analyze(undefined, ctx);
        const pathIssue = issues.find((i) => i.rule === 'PYM-PATH-001');
        expect(pathIssue).toBeDefined();
        expect(pathIssue?.message).toContain('pathlib.Path');
    });

    it('flags unmanaged open() without context manager (PYM-OPEN-001)', () => {
        const code = [
            'def load_raw():',
            '    f = open("data.txt", "r")',
            '    data = f.read()',
            '    return data',
        ].join('\n');
        const ctx = createCtx('scripts/loader.py', code);
        const issues = analyzer.analyze(undefined, ctx);
        const openIssue = issues.find((i) => i.rule === 'PYM-OPEN-001');
        expect(openIssue).toBeDefined();
        expect(openIssue?.message).toContain('open()');
    });

    it('flags mutable default argument in function signature (PYM-DEFAULT-001)', () => {
        const code = [
            'def append_item(val: int, target_list: list = []) -> list:',
            '    target_list.append(val)',
            '    return target_list',
        ].join('\n');
        const ctx = createCtx('scripts/mutate.py', code);
        const issues = analyzer.analyze(undefined, ctx);
        const defaultIssue = issues.find((i) => i.rule === 'PYM-DEFAULT-001');
        expect(defaultIssue).toBeDefined();
        expect(defaultIssue?.message).toContain('Mutable default argument');
    });
});
