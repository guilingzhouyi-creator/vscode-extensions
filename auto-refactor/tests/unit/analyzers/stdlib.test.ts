/**
 * Module: Unit Test — Standard Library & Systems Runtime Safety Analyzer Suite
 * File Path: tests/unit/analyzers/stdlib.test.ts
 * Architecture Role: Exercises StdlibAnalyzer across panic escapes (STDLIB-PANIC-001),
 *   dynamic allocation in no_std (STDLIB-ALLOC-001), and missing safety contracts (STDLIB-UNSAFE-001).
 * Dependencies & Triggers: vitest (describe, it, expect); imports StdlibAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert STDLIB-PANIC-001, STDLIB-ALLOC-001, and STDLIB-UNSAFE-001 rules.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { StdlibAnalyzer } from '../../../src/analyzers/stdlib';
import type { AnalyzerContext } from '../../../src/core/types';

describe('StdlibAnalyzer Suite', () => {
    const analyzer = new StdlibAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {},
        };
    }

    it('permits safe standard library code with proper error handling and safety proofs', () => {
        const code = [
            'pub fn safe_parse(raw: &str) -> Result<u32, std::num::ParseIntError> {',
            '    raw.parse()',
            '}',
            '',
            'pub fn read_ptr(ptr: *const u8) -> u8 {',
            '    // SAFETY: caller guarantees pointer is non-null and aligned',
            '    unsafe { *ptr }',
            '}',
        ].join('\n');
        const ctx = createCtx('src/runtime.rs', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags bare unwrap or panic inside public Rust API (STDLIB-PANIC-001)', () => {
        const code = [
            'pub fn parse_number(raw: &str) -> u32 {',
            '    raw.parse().unwrap()',
            '}',
        ].join('\n');
        const ctx = createCtx('src/parser.rs', code);
        const issues = analyzer.analyze(undefined, ctx);
        const panicIssue = issues.find((i) => i.rule === 'STDLIB-PANIC-001');
        expect(panicIssue).toBeDefined();
        expect(panicIssue?.message).toContain('parse_number');
    });

    it('flags unsafe block lacking preceding SAFETY: comment (STDLIB-UNSAFE-001)', () => {
        const code = [
            'pub fn deref_unchecked(ptr: *const u8) -> u8 {',
            '    unsafe { *ptr }',
            '}',
        ].join('\n');
        const ctx = createCtx('src/memory.rs', code);
        const issues = analyzer.analyze(undefined, ctx);
        const unsafeIssue = issues.find((i) => i.rule === 'STDLIB-UNSAFE-001');
        expect(unsafeIssue).toBeDefined();
        expect(unsafeIssue?.message).toContain('SAFETY:');
    });

    it('flags implicit heap allocation in no_std crate (STDLIB-ALLOC-001)', () => {
        const code = [
            '#![no_std]',
            'pub fn create_buffer() {',
            '    let _ = Box::new(42);',
            '}',
        ].join('\n');
        const ctx = createCtx('src/kernel.rs', code);
        const issues = analyzer.analyze(undefined, ctx);
        const allocIssue = issues.find((i) => i.rule === 'STDLIB-ALLOC-001');
        expect(allocIssue).toBeDefined();
        expect(allocIssue?.message).toContain('no_std');
    });
});
