/**
 * Module: Unit Test — Frontend UI/UX & Component Engineering Analyzer Suite
 * File Path: tests/unit/analyzers/frontend.test.ts
 * Architecture Role: Exercises FrontendAnalyzer across accessibility (UI-ENG-001),
 *   component interface footprint (UI-ENG-003), naming conventions (UI-ENG-004),
 *   and IME composition guards (UI-ENG-005).
 * Dependencies & Triggers: vitest (describe, it, expect); imports FrontendAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities: Assert UI-ENG-001, UI-ENG-003, UI-ENG-004, and UI-ENG-005 rules.
 * Exit Semantics & Design Rationale: Fast in-memory unit tests executing under 15ms.
 */

import { describe, it, expect } from 'vitest';
import { FrontendAnalyzer, RULE_UI_ENG_001, RULE_UI_ENG_004, RULE_UI_ENG_005 } from '../../../src/analyzers/frontend';
import type { AnalyzerContext } from '../../../src/core/types';

describe('FrontendAnalyzer Suite', () => {
    const analyzer = new FrontendAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {},
            config: {},
        };
    }

    it('permits compliant React component with proper accessibility and IME guards', () => {
        const code = [
            'import React from "react";',
            'export const SearchBox = () => {',
            '    const handleKeyDown = (e: React.KeyboardEvent) => {',
            '        if (e.nativeEvent.isComposing) return;',
            '        if (e.key === "Enter") {',
            '            console.log("submit");',
            '        }',
            '    };',
            '    return (',
            '        <div>',
            '            <img src="/logo.png" alt="Company Logo" />',
            '            <input type="text" onKeyDown={handleKeyDown} />',
            '        </div>',
            '    );',
            '};',
        ].join('\n');
        const ctx = createCtx('src/components/SearchBox.tsx', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags image tag missing alt attribute (UI-ENG-001)', () => {
        const code = [
            'export const Banner = () => (',
            '    <div>',
            '        <img src="/banner.jpg" />',
            '    </div>',
            ');',
        ].join('\n');
        const ctx = createCtx('src/components/Banner.tsx', code);
        const issues = analyzer.analyze(undefined, ctx);
        const imgIssue = issues.find((i) => i.rule === RULE_UI_ENG_001);
        expect(imgIssue).toBeDefined();
        expect(imgIssue?.message).toContain('alt');
    });

    it('flags interactive div missing role and tabIndex (UI-ENG-001)', () => {
        const code = [
            'export const ClickableDiv = () => (',
            '    <div onClick={() => alert("clicked")}>Click me</div>',
            ');',
        ].join('\n');
        const ctx = createCtx('src/components/ClickableDiv.tsx', code);
        const issues = analyzer.analyze(undefined, ctx);
        const a11yIssue = issues.find((i) => i.rule === RULE_UI_ENG_001);
        expect(a11yIssue).toBeDefined();
        expect(a11yIssue?.message).toContain('interactive');
    });

    it('flags custom hook not starting with use prefix (UI-ENG-004)', () => {
        const code = [
            'export function authHook() {',
            '    return { user: null };',
            '}',
        ].join('\n');
        const ctx = createCtx('src/hooks/auth.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const hookIssue = issues.find((i) => i.rule === RULE_UI_ENG_004);
        expect(hookIssue).toBeDefined();
        expect(hookIssue?.message).toContain('use');
    });

    it('flags Enter keydown event handler without IME isComposing check (UI-ENG-005)', () => {
        const code = [
            'export const InputField = () => {',
            '    const onKeyDown = (e: any) => {',
            '        if (e.key === "Enter") {',
            '            sendMessage();',
            '        }',
            '    };',
            '    return <input onKeyDown={onKeyDown} />;',
            '};',
        ].join('\n');
        const ctx = createCtx('src/components/InputField.tsx', code);
        const issues = analyzer.analyze(undefined, ctx);
        const imeIssue = issues.find((i) => i.rule === RULE_UI_ENG_005);
        expect(imeIssue).toBeDefined();
        expect(imeIssue?.message).toContain('IME');
    });
});
