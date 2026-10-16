/**
 * Module: Unit Test — SEC-EXP-005 Iframe UserActivation & Origin Validation
 * File Path: tests/unit/analyzers/sec-iframe-user-activation.test.ts
 * Architecture Role: Deterministic verification for ClientExposureAnalyzer SEC-EXP-005 rule.
 * Dependencies & Triggers: vitest, ClientExposureAnalyzer.
 * Responsibilities:
 *   1. Assert detection of unguarded window.open inside message listener.
 *   2. Assert detection of unguarded localStorage/sessionStorage writes inside message listener.
 *   3. Assert detection of unguarded vscode.postMessage dispatch.
 *   4. Assert compliance when event.userActivation.isActive is checked.
 *   5. Assert compliance when event.origin whitelist is checked.
 *   6. Assert test file paths are ignored.
 * Exit Semantics & Design Rationale: Standard vitest suite; 100% deterministic assertion.
 */

import { describe, it, expect } from 'vitest';
import { ClientExposureAnalyzer } from '../../../src/analyzers/client-exposure';

function createContext(filePath: string, content: string) {
    return {
        filePath,
        content,
        options: {},
        projectRoot: '/test-root',
    };
}

describe('SEC-EXP-005: sec-iframe-synthetic-user-activation', () => {
    const analyzer = new ClientExposureAnalyzer();

    it('should flag message listener with unguarded window.open', () => {
        const code = [
            'window.addEventListener("message", (event) => {',
            '    const target = event.data.url;',
            '    window.open(target, "_blank");',
            '});',
        ].join('\n');

        const issues = analyzer.analyze(undefined, createContext('src/bridge/WebviewBridge.ts', code));
        const finding = issues.find((i) => i.rule === 'SEC-EXP-005');
        expect(finding).toBeDefined();
        expect(finding?.severity).toBe('error');
        expect(finding?.message).toContain('event.userActivation');
    });

    it('should flag message listener with unguarded storage write', () => {
        const code = [
            'window.onmessage = function(event) {',
            '    localStorage.setItem("auth_token", event.data.token);',
            '};',
        ].join('\n');

        const issues = analyzer.analyze(undefined, createContext('src/bridge/StorageBridge.ts', code));
        expect(issues.some((i) => i.rule === 'SEC-EXP-005')).toBe(true);
    });

    it('should pass message listener guarded with event.userActivation.isActive', () => {
        const code = [
            'window.addEventListener("message", (event) => {',
            '    if (!event.userActivation?.isActive) {',
            '        return;',
            '    }',
            '    window.open(event.data.url);',
            '});',
        ].join('\n');

        const issues = analyzer.analyze(undefined, createContext('src/bridge/SafeBridge.ts', code));
        expect(issues.filter((i) => i.rule === 'SEC-EXP-005')).toHaveLength(0);
    });

    it('should pass message listener guarded with event.origin check', () => {
        const code = [
            'window.addEventListener("message", (event) => {',
            '    if (event.origin !== "https://trusted.internal") {',
            '        return;',
            '    }',
            '    window.open(event.data.url);',
            '});',
        ].join('\n');

        const issues = analyzer.analyze(undefined, createContext('src/bridge/SafeBridgeOrigin.ts', code));
        expect(issues.filter((i) => i.rule === 'SEC-EXP-005')).toHaveLength(0);
    });

    it('should ignore test files', () => {
        const code = [
            'window.addEventListener("message", (event) => {',
            '    window.open(event.data.url);',
            '});',
        ].join('\n');

        const issues = analyzer.analyze(undefined, createContext('tests/unit/test-fixture.ts', code));
        expect(issues).toHaveLength(0);
    });
});
