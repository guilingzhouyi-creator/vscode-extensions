/**
 * Module: Unit Test — Client Exposure Risk Analyzer Suite (SEC-EXP-* Rules)
 * File Path: tests/unit/analyzers/client-exposure.test.ts
 * Architecture Role: Validates client exposure risk detections including internal endpoints,
 *   CSS auth bypass, dead feature flag leakage, unreleased debug routes, and unguarded iframe events.
 * Dependencies & Triggers: vitest (describe, it, expect); imports ClientExposureAnalyzer;
 *   triggered by `npm run test:unit`.
 * Responsibilities:
 *   1. Assert SEC-EXP-001 (internal API endpoints exposed in client).
 *   2. Assert SEC-EXP-002 (CSS visual hiding used as authorization mechanism).
 *   3. Assert SEC-EXP-003 (inactive feature flag payload leakage).
 *   4. Assert SEC-EXP-004 (unreleased or debug routes in router config).
 *   5. Assert SEC-EXP-005 (iframe message listener missing origin or user activation guard).
 * Exit Semantics & Design Rationale: Fast pure in-memory tests executing under 10ms.
 */

import { describe, it, expect } from 'vitest';
import { ClientExposureAnalyzer } from '../../../src/analyzers/client-exposure';
import type { AnalyzerContext } from '../../../src/core/types';

describe('ClientExposureAnalyzer Suite', () => {
    const analyzer = new ClientExposureAnalyzer();

    function createCtx(filePath: string, content: string): AnalyzerContext {
        return {
            filePath,
            content,
            options: {
                level: 'full',
            },
            config: {},
        };
    }

    it('permits safe public client endpoints and guarded postMessage', () => {
        const code = [
            'export async function fetchProfile(id: string) {',
            '    return fetch(`/api/v1/users/${id}`);',
            '}',
            'window.addEventListener("message", (event) => {',
            '    if (event.origin !== "https://trusted.example.com") return;',
            '    if (!event.userActivation?.isActive) return;',
            '    window.open(event.data.url);',
            '});',
        ].join('\n');
        const ctx = createCtx('src/client/api-service.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        expect(issues).toHaveLength(0);
    });

    it('flags internal API endpoint invocation (SEC-EXP-001)', () => {
        const code = [
            'export async function dumpMetrics() {',
            '    return fetch("/internal/cluster-metrics");',
            '}',
        ].join('\n');
        const ctx = createCtx('src/client/metrics.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const issue = issues.find((i) => i.rule === 'SEC-EXP-001');
        expect(issue).toBeDefined();
        expect(issue?.severity).toBe('error');
    });

    it('flags CSS visual hiding for privileged admin controls (SEC-EXP-002)', () => {
        const code = [
            'export function renderPanel() {',
            '    return `<button style="display: none" class="admin-action">Delete</button>`;',
            '}',
        ].join('\n');
        const ctx = createCtx('src/client/views.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const issue = issues.find((i) => i.rule === 'SEC-EXP-002');
        expect(issue).toBeDefined();
        expect(issue?.severity).toBe('error');
    });

    it('flags dead feature flag delivering client-side payload (SEC-EXP-003)', () => {
        const code = [
            'if (!FEATURE_FLAGS.ENABLE_EXPERIMENTAL) {',
            '    renderLegacyDashboard();',
            '}',
        ].join('\n');
        const ctx = createCtx('src/client/feature.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const issue = issues.find((i) => i.rule === 'SEC-EXP-003');
        expect(issue).toBeDefined();
        expect(issue?.severity).toBe('warning');
    });

    it('flags debug or test routes in client router (SEC-EXP-004)', () => {
        const code = [
            'export const routes = [',
            '    { path: "/dashboard", component: Dashboard },',
            '    { path: "/debug/inspector", component: Inspector },',
            '];',
        ].join('\n');
        const ctx = createCtx('src/client/router.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const issue = issues.find((i) => i.rule === 'SEC-EXP-004');
        expect(issue).toBeDefined();
        expect(issue?.severity).toBe('error');
    });

    it('flags iframe message listener triggering sensitive actions without origin check (SEC-EXP-005)', () => {
        const code = [
            'window.addEventListener("message", (e) => {',
            '    localStorage.setItem("session_token", e.data.token);',
            '});',
        ].join('\n');
        const ctx = createCtx('src/client/bridge.ts', code);
        const issues = analyzer.analyze(undefined, ctx);
        const issue = issues.find((i) => i.rule === 'SEC-EXP-005');
        expect(issue).toBeDefined();
        expect(issue?.severity).toBe('error');
    });
});
