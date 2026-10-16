import { describe, it, expect } from 'vitest';
import { FrontendAnalyzer } from '../../../src/analyzers/frontend';
import { getRule } from '../../../src/core/rules/registry';
import type { AnalyzerContext } from '../../../src/core/types';

function createMockContext(filePath: string, content: string): AnalyzerContext {
    return {
        filePath,
        content,
        options: {},
        projectRoot: process.cwd(),
    };
}

describe('UI-ENG-008: Container Query & Anti-Squash Discipline Analyzer', () => {
    const analyzer = new FrontendAnalyzer();

    describe('Rule Registry Metadata', () => {
        it('registers UI-ENG-008 in the rule registry with correct attributes', () => {
            const rule = getRule('UI-ENG-008');
            expect(rule).toBeDefined();
            expect(rule?.id).toBe('UI-ENG-008');
            expect(rule?.family).toBe('UI');
            expect(rule?.analyzer).toBe('frontend');
            expect(rule?.canonical).toBe(true);
            expect(rule?.defaultSeverity).toBe('warning');
            expect(rule?.summary).toContain('@container');
        });
    });

    describe('@media misuse in local components', () => {
        it('flags @media queries nested inside local component selectors', () => {
            const css = `
.card {
    padding: 16px;
    @media (max-width: 600px) {
        padding: 8px;
    }
}
`;
            const issues = analyzer.analyze(undefined, createMockContext('src/components/card.css', css));
            const uiIssues = issues.filter((i) => i.rule === 'UI-ENG-008');
            expect(uiIssues.length).toBeGreaterThan(0);
            expect(uiIssues[0].message).toContain('Local component uses global viewport @media instead of @container');
        });

        it('flags @media queries directly targeting local component classes without @container', () => {
            const css = `
@media (max-width: 768px) {
    .webview-container {
        flex-direction: column;
    }
}
`;
            const issues = analyzer.analyze(undefined, createMockContext('src/webview/panel.css', css));
            const uiIssues = issues.filter((i) => i.rule === 'UI-ENG-008');
            expect(uiIssues.length).toBeGreaterThan(0);
        });

        it('passes when @container query is used for local components', () => {
            const css = `
.card-container {
    container-type: inline-size;
}

@container (max-width: 400px) {
    .card {
        padding: 8px;
    }
}
`;
            const issues = analyzer.analyze(undefined, createMockContext('src/components/card.css', css));
            const uiIssues = issues.filter((i) => i.rule === 'UI-ENG-008');
            expect(uiIssues.length).toBe(0);
        });

        it('passes on page-level root @media layout', () => {
            const css = `
@media (min-width: 1200px) {
    body {
        margin: 0 auto;
    }
}
`;
            const issues = analyzer.analyze(undefined, createMockContext('src/styles/global.css', css));
            const uiIssues = issues.filter((i) => i.rule === 'UI-ENG-008');
            expect(uiIssues.length).toBe(0);
        });
    });

    describe('CJK Character Anti-Squash Protection', () => {
        it('flags CJK text containers lacking text-wrap: balance or overflow-wrap: break-word', () => {
            const tsx = `
export function TitleCard() {
    return (
        <div className="card">
            <h1 className="title">这是一个重要的中文标题</h1>
            <p className="desc">这是一段没有防挤压保护的中文详细描述内容。</p>
        </div>
    );
}
`;
            const issues = analyzer.analyze(undefined, createMockContext('src/components/TitleCard.tsx', tsx));
            const uiIssues = issues.filter((i) => i.rule === 'UI-ENG-008');
            expect(uiIssues.length).toBeGreaterThan(0);
            expect(uiIssues[0].message).toContain('text-wrap: balance or overflow-wrap: break-word');
        });

        it('passes when CJK text container has text-wrap: balance or text-balance utility', () => {
            const tsx = `
export function TitleCard() {
    return (
        <div className="card">
            <h1 className="title text-balance">这是一个配置了平衡换行的中文标题</h1>
            <p className="desc break-words">这是一段配置了自动换行防挤压折叠的中文详细描述。</p>
        </div>
    );
}
`;
            const issues = analyzer.analyze(undefined, createMockContext('src/components/TitleCard.tsx', tsx));
            const uiIssues = issues.filter((i) => i.rule === 'UI-ENG-008');
            expect(uiIssues.length).toBe(0);
        });

        it('passes when CJK text container specifies inline style anti-squash', () => {
            const tsx = `
export function StyledCard() {
    return (
        <div className="card" style={{ textWrap: 'balance' }}>
            <h2>标题文本</h2>
        </div>
    );
}
`;
            const issues = analyzer.analyze(undefined, createMockContext('src/components/StyledCard.tsx', tsx));
            const uiIssues = issues.filter((i) => i.rule === 'UI-ENG-008');
            expect(uiIssues.length).toBe(0);
        });

        it('ignores pure ASCII English text without CJK characters', () => {
            const tsx = `
export function EnglishCard() {
    return (
        <div className="card">
            <h1>Standard English Title Heading</h1>
            <p>Regular English sentence description.</p>
        </div>
    );
}
`;
            const issues = analyzer.analyze(undefined, createMockContext('src/components/EnglishCard.tsx', tsx));
            const uiIssues = issues.filter((i) => i.rule === 'UI-ENG-008');
            expect(uiIssues.length).toBe(0);
        });
    });
});

