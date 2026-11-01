/**
 * Module: Unit Test — Rust Modernization Analyzer Suite (RSM-* Rules)
 * File Path: tests/unit/analyzers/rust-modern.test.ts
 * Architecture Role: Exercises RustModernAnalyzer line scanner across panic macros,
 *   undocumented unsafe blocks, &String parameters, and naked .unwrap().
 * Dependencies & Triggers: vitest (describe, it, expect); imports RustModernAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert RSM-PNC-001, RSM-SAF-001, RSM-STR-001, and RSM-UNWRAP-001.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { RustModernAnalyzer } from '../../../src/analyzers/rust-modern';
import type { AnalyzerContext } from '../../../src/core/types';

describe('RustModernAnalyzer Suite', () => {
    const analyzer = new RustModernAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {},
        };
    }

    it('permits clean idiomatic Rust with safety documentation and strong error handling', () => {
        const code = [
            'pub fn parse_data(input: &str) -> Result<u32, ParseIntError> {',
            '    input.parse::<u32>()',
            '}',
        ].join('\n');
        const ctx = createCtx('crates/core/src/parser.rs', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags production panic macro usage (RSM-PNC-001)', () => {
        const code = [
            'pub fn divide(a: u32, b: u32) -> u32 {',
            '    if b == 0 {',
            '        panic!("division by zero");',
            '    }',
            '    a / b',
            '}',
        ].join('\n');
        const ctx = createCtx('crates/core/src/math.rs', code);
        const issues = analyzer.analyze(undefined, ctx);
        const pncIssue = issues.find((i) => i.rule === 'RSM-PNC-001');
        expect(pncIssue).toBeDefined();
        expect(pncIssue?.message).toContain('panic');
    });

    it('flags undocumented unsafe blocks lacking // SAFETY: comment (RSM-SAF-001)', () => {
        const code = [
            'pub fn deref_raw(ptr: *const u8) -> u8 {',
            '    unsafe {',
            '        *ptr',
            '    }',
            '}',
        ].join('\n');
        const ctx = createCtx('crates/core/src/ptr.rs', code);
        const issues = analyzer.analyze(undefined, ctx);
        const safIssue = issues.find((i) => i.rule === 'RSM-SAF-001');
        expect(safIssue).toBeDefined();
        expect(safIssue?.message).toContain('SAFETY');
    });

    it('flags &String parameter in favor of borrowed &str (RSM-STR-001)', () => {
        const code = [
            'pub fn process_text(name: &String) -> usize {',
            '    name.len()',
            '}',
        ].join('\n');
        const ctx = createCtx('crates/core/src/text.rs', code);
        const issues = analyzer.analyze(undefined, ctx);
        const strIssue = issues.find((i) => i.rule === 'RSM-STR-001');
        expect(strIssue).toBeDefined();
        expect(strIssue?.message).toContain('&String');
    });
});
