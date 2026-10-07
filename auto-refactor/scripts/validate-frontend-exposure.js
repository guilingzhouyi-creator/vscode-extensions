#!/usr/bin/env node
/**
 * Module: Verification Harness — Frontend, Production Hygiene & Client Exposure Key Points
 * File Path: scripts/validate-frontend-exposure.js
 * Architecture Role: Integration & deterministic unit test suite for FrontendAnalyzer,
 *   ProductionHygieneAnalyzer, and ClientExposureAnalyzer rules (UI-ENG-001..004,
 *   PROD-HYG-001..003, SEC-EXP-001..004), validating Dev/Prod dual-state behavior,
 *   MoE routing and scoring dimension integration.
 * Dependencies & Triggers: `npm run validate-frontend-exposure` (part of `npm test`); imports
 *   compiled dist analyzers and registry.
 * Responsibilities:
 *   1. Assert UI-ENG-001..004 positive and negative fixtures.
 *   2. Assert PROD-HYG-001..003 production artifact vs dev source behavior.
 *   3. Assert SEC-EXP-001..004 client exposure risk detection and evidence.
 *   4. Assert scoring dimension mapping and expert manifest validation.
 * Exit Semantics & Design Rationale: Exits 0 on success, 1 on any assertion failure.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const { FrontendAnalyzer } = require('../dist/analyzers/frontend');
const { ProductionHygieneAnalyzer } = require('../dist/analyzers/production-hygiene');
const { ClientExposureAnalyzer } = require('../dist/analyzers/client-exposure');
const { EXPERT_MANIFEST, validateExpertManifest } = require('../dist/core/router/expert-manifest');
const { getDimensionRulesForAnalyzer } = require('../dist/core/scoring/dimensionRuleTable');

function mockContext(filePath, content) {
    return {
        filePath,
        content,
        options: {},
        projectRoot: path.resolve(__dirname, '..'),
    };
}

function testFrontendAnalyzer() {
    console.log('Testing FrontendAnalyzer (UI-ENG-001..004)...');
    const analyzer = new FrontendAnalyzer();

    // UI-ENG-001: img without alt and interactive div without role
    const badHtml = [
        '<div className="container">',
        '  <img src="/logo.png" />',
        '  <div onClick={handleClick}>Click me</div>',
        '</div>',
    ].join('\n');
    const badHtmlIssues = analyzer.analyze(undefined, mockContext('src/components/Bad.tsx', badHtml));
    const badA11y = badHtmlIssues.filter((i) => i.rule === 'UI-ENG-001');
    assert.strictEqual(badA11y.length, 2, 'Should detect missing alt and missing role on div');

    const goodHtml = [
        '<div className="container">',
        '  <img src="/logo.png" alt="Company Logo" />',
        '  <div role="button" tabIndex={0} onClick={handleClick}>Click me</div>',
        '</div>',
    ].join('\n');
    const goodHtmlIssues = analyzer.analyze(undefined, mockContext('src/components/Good.tsx', goodHtml));
    assert.strictEqual(
        goodHtmlIssues.filter((i) => i.rule === 'UI-ENG-001').length,
        0,
        'Compliant markup should not trigger UI-ENG-001',
    );

    // UI-ENG-002: Reflow animation and deep DOM
    const reflowCss = '.bar { transition: height 300ms ease; }';
    const reflowIssues = analyzer.analyze(undefined, mockContext('src/styles/bad.css', reflowCss));
    assert.ok(
        reflowIssues.some((i) => i.rule === 'UI-ENG-002'),
        'Should flag transition on geometry height property',
    );

    let deepDom = '<div>';
    for (let d = 0; d < 14; d++) deepDom += '<div>';
    for (let d = 0; d < 14; d++) deepDom += '</div>';
    deepDom += '</div>';
    const deepIssues = analyzer.analyze(undefined, mockContext('src/components/Deep.tsx', deepDom));
    assert.ok(
        deepIssues.some((i) => i.rule === 'UI-ENG-002' && i.message.includes('exceeds budget 12')),
        'Should flag DOM depth exceeding budget 12',
    );

    // UI-ENG-003: Component props footprint > 10
    const bloatedProps = [
        'interface UserCardProps {',
        '  id: string;',
        '  name: string;',
        '  email: string;',
        '  phone: string;',
        '  address: string;',
        '  role: string;',
        '  avatar: string;',
        '  bio: string;',
        '  department: string;',
        '  location: string;',
        '  status: string;',
        '}',
    ].join('\n');
    const bloatIssues = analyzer.analyze(undefined, mockContext('src/components/Bloat.tsx', bloatedProps));
    assert.ok(
        bloatIssues.some((i) => i.rule === 'UI-ENG-003'),
        'Should flag component interface exceeding 10 props',
    );

    // UI-ENG-004: Hook and handler naming conventions
    const namingCode = [
        'function customSettingsHook() { return {}; }',
        'const submitHandler = () => {};',
    ].join('\n');
    const namingIssues = analyzer.analyze(undefined, mockContext('src/hooks/settings.ts', namingCode));
    assert.strictEqual(
        namingIssues.filter((i) => i.rule === 'UI-ENG-004').length,
        2,
        'Should flag hook missing use- prefix and handler missing on/handle prefix',
    );

    console.log('  [PASS] FrontendAnalyzer passed all assertions.');
}

function testProductionHygieneAnalyzer() {
    console.log('Testing ProductionHygieneAnalyzer (PROD-HYG-001..003)...');
    const analyzer = new ProductionHygieneAnalyzer();

    // PROD-HYG-001: Debug logs and TODOs in production output
    const prodArtifact = [
        'function render() {',
        '  console.debug("trace-render");',
        '  // TODO: remove before launch',
        '  const localPath = "' + ['C:', 'Users', 'developer', 'secret-repo'].join('/') + '";',
        '}',
    ].join('\n');

    // In dist/ output (production) -> Must trigger PROD-HYG-001
    const prodIssues = analyzer.analyze(
        undefined,
        mockContext('dist/bundle.min.js', prodArtifact),
    );
    assert.ok(
        prodIssues.some((i) => i.rule === 'PROD-HYG-001' && i.detail.violation === 'debug-console-call'),
        'Should flag console.debug in production artifact',
    );
    assert.ok(
        prodIssues.some((i) => i.rule === 'PROD-HYG-001' && i.detail.violation === 'todo-marker-in-prod'),
        'Should flag pending TODO in production artifact',
    );
    assert.ok(
        prodIssues.some((i) => i.rule === 'PROD-HYG-001' && i.detail.violation === 'absolute-path-leak'),
        'Should flag local absolute workstation path in production artifact',
    );

    // In src/ (dev source) -> Should NOT trigger PROD-HYG-001
    const devIssues = analyzer.analyze(
        undefined,
        mockContext('src/components/MyComp.tsx', prodArtifact),
    );
    assert.strictEqual(
        devIssues.filter((i) => i.rule === 'PROD-HYG-001').length,
        0,
        'Dev source files are permitted to carry debug logs and TODOs',
    );

    // PROD-HYG-002: Source Map leakage in production build
    const sourceMapLeak = 'var x = 1;\n//# sourceMappingURL=app.js.map';
    const smIssues = analyzer.analyze(
        undefined,
        mockContext('dist/app.js', sourceMapLeak),
    );
    assert.ok(
        smIssues.some((i) => i.rule === 'PROD-HYG-002'),
        'Should flag public sourceMappingURL in production build',
    );

    // PROD-HYG-003: Backend environment secrets leaked to client code
    const clientSecretLeak = [
        'export function ClientConfig() {',
        '  const db = process.env.DATABASE_URL;',
        '  const key = process.env.AWS_SECRET_ACCESS_KEY;',
        '}',
    ].join('\n');
    const secIssues = analyzer.analyze(
        undefined,
        mockContext('src/client/Config.tsx', clientSecretLeak),
    );
    assert.strictEqual(
        secIssues.filter((i) => i.rule === 'PROD-HYG-003').length,
        2,
        'Should flag sensitive backend environment variables in client code',
    );

    console.log('  [PASS] ProductionHygieneAnalyzer passed all assertions.');
}

function testClientExposureAnalyzer() {
    console.log('Testing ClientExposureAnalyzer (SEC-EXP-001..004)...');
    const analyzer = new ClientExposureAnalyzer();

    // SEC-EXP-001: Internal endpoint exposed in client
    const apiCode = [
        'async function fetchPrivilegedData() {',
        '  return fetch("/api/internal/users/audit");',
        '}',
    ].join('\n');
    const apiIssues = analyzer.analyze(undefined, mockContext('src/client/api.ts', apiCode));
    assert.ok(
        apiIssues.some((i) => i.rule === 'SEC-EXP-001'),
        'Should detect internal API endpoint exposed in client code',
    );

    // SEC-EXP-002: CSS-only visual auth bypass
    const cssAuthBypass = [
        'function AdminActions() {',
        '  return <button style="display:none" className="admin-delete">Delete Database</button>;',
        '}',
    ].join('\n');
    const cssIssues = analyzer.analyze(undefined, mockContext('src/client/Admin.tsx', cssAuthBypass));
    assert.ok(
        cssIssues.some((i) => i.rule === 'SEC-EXP-002'),
        'Should detect privileged elements concealed with CSS display:none',
    );

    // SEC-EXP-003: Inactive feature flag delivering full implementation
    const featureFlagLeak = [
        'function renderContent() {',
        '  if (!FEATURE_FLAGS.PREVIEW_MODE) {',
        '    doFullPrivilegedExecution();',
        '  }',
        '}',
    ].join('\n');
    const flagIssues = analyzer.analyze(undefined, mockContext('src/client/Feature.ts', featureFlagLeak));
    assert.ok(
        flagIssues.some((i) => i.rule === 'SEC-EXP-003'),
        'Should flag inactive feature flag bundling full implementation logic',
    );

    // SEC-EXP-004: Unreleased/test route in router
    const routerConfig = [
        'export const routes = [',
        '  { path: "/home", component: Home },',
        '  { path: "/test-preview-page", component: TestPreview },',
        '];',
    ].join('\n');
    const routeIssues = analyzer.analyze(undefined, mockContext('src/client/routes.ts', routerConfig));
    assert.ok(
        routeIssues.some((i) => i.rule === 'SEC-EXP-004'),
        'Should flag unreleased/test route statically configured in client routes',
    );

    console.log('  [PASS] ClientExposureAnalyzer passed all assertions.');
}

function testScoringAndRoutingIntegration() {
    console.log('Testing Scoring and Router Integration...');

    // 1. Validate Expert Manifest
    validateExpertManifest(EXPERT_MANIFEST);
    const frontendExp = EXPERT_MANIFEST.find((e) => e.id === 'frontend');
    const prodExp = EXPERT_MANIFEST.find((e) => e.id === 'production-hygiene');
    const clientExp = EXPERT_MANIFEST.find((e) => e.id === 'client-exposure');

    assert.ok(frontendExp, 'Frontend expert manifest must be registered');
    assert.ok(prodExp, 'Production hygiene expert manifest must be registered');
    assert.ok(clientExp, 'Client exposure expert manifest must be registered');
    assert.strictEqual(clientExp.isSecurityFamily, true, 'Client exposure must be in security family');
    assert.strictEqual(clientExp.fallback, 'block', 'Security family expert must block on fallback');

    // 2. Validate Dimension Rules Table Partitioning
    const frontendRules = getDimensionRulesForAnalyzer('frontend');
    const prodRules = getDimensionRulesForAnalyzer('production-hygiene');
    const clientRules = getDimensionRulesForAnalyzer('client-exposure');

    assert.ok(frontendRules.length >= 4, 'Frontend analyzer must have dimension rules mapped');
    assert.ok(prodRules.length >= 3, 'Production hygiene analyzer must have dimension rules mapped');
    assert.ok(clientRules.length >= 4, 'Client exposure analyzer must have dimension rules mapped');

    console.log('  [PASS] Scoring and router integration passed all assertions.');
}

function main() {
    console.log('=== Running Frontend & Client Exposure Validation Suite ===\n');
    testFrontendAnalyzer();
    testProductionHygieneAnalyzer();
    testClientExposureAnalyzer();
    testScoringAndRoutingIntegration();
    console.log('\n[ALL PASS] All frontend engineering and exposure risk checks passed successfully!');
}

main();

