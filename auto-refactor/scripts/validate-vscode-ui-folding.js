#!/usr/bin/env node
/**
 * Module: Verification Harness — VS Code Extension UI Folding & Theme Hygiene
 * File Path: scripts/validate-vscode-ui-folding.js
 * Architecture Role: Verifies VSC-UI-001 (bounded density & collection folding) and
 *   VSC-UI-002 (Webview theme CSS variables & high-contrast guard).
 * Dependencies & Triggers: Invoked by npm test / test-parallel; imports
 *   dist/analyzers/vscode-extension and dist/core/scoring/dimensionRuleTable.
 * Responsibilities:
 *   1. Verify VSC-UI-001 flags unbounded dynamic collection rendering;
 *   2. Verify VSC-UI-001 passes when bounded by .slice() or folding toggle;
 *   3. Verify VSC-UI-002 flags hardcoded monochrome colors in Webview markup;
 *   4. Verify VSC-UI-002 passes when using var(--vscode-*);
 *   5. Verify dimension deduction mappings for VSC-UI-001 and VSC-UI-002.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passed;
 *   exits 1 on assertion failure.
 */
'use strict';

const assert = require('assert');
const { VscodeExtensionAnalyzer } = require('../dist/analyzers/vscode-extension');
const { DIMENSION_RULES } = require('../dist/core/scoring/dimensionRuleTable');
const {
  DIMENSION_PERFORMANCE_EFFICIENCY,
  DIMENSION_ARCHITECTURE_CONSISTENCY,
} = require('../dist/core/scoring/dimensionLiterals');

console.log('Testing VS Code Extension UI Folding & Theme Hygiene Analyzers...');

const analyzer = new VscodeExtensionAnalyzer();

// ── Test 1: VSC-UI-001 Unbounded Collection Rendering ──
(function testUnboundedCollection() {
  const unboundedSource = `
export function renderSessionTable(sessions: any[]): string {
    return \`
        <table>
            <thead><tr><th>Session</th></tr></thead>
            <tbody>
                \${sessions.map(s => \`<tr><td>\${s.name}</td><td>\${s.duration}</td></tr>\`).join('')}
            </tbody>
        </table>
    \`;
}
`;

  const issues = analyzer.analyze(null, {
    filePath: 'src/ui/session-view.ts',
    content: unboundedSource,
  });

  const uiIssues = issues.filter((i) => i.rule === 'VSC-UI-001');
  assert.strictEqual(uiIssues.length, 1, 'Must flag unbounded collection mapping');
  assert.strictEqual(uiIssues[0].severity, 'warning');
  assert.strictEqual(
    uiIssues[0].message.includes('lacks bounded density or folding controls'),
    true,
  );
  console.log('  [PASS] 1. VSC-UI-001 flags unbounded collection mapping in Webview markup');
})();

// ── Test 2: VSC-UI-001 Bounded by .slice() or Folding Toggle ──
(function testBoundedCollectionPasses() {
  // Case A: Sliced collection
  const slicedSource = `
export function renderSessionTable(sessions: any[]): string {
    const visibleSessions = sessions.slice(0, 5);
    return \`
        <table>
            <tbody>
                \${visibleSessions.map(s => \`<tr><td>\${s.name}</td></tr>\`).join('')}
            </tbody>
        </table>
    \`;
}
`;

  const issuesA = analyzer.analyze(null, {
    filePath: 'src/ui/session-view.ts',
    content: slicedSource,
  });
  assert.strictEqual(
    issuesA.filter((i) => i.rule === 'VSC-UI-001').length,
    0,
    'Sliced collection must not trigger VSC-UI-001',
  );

  // Case B: isExpanded folding toggle
  const foldedSource = `
export function renderSessionTable(sessions: any[], isExpanded: boolean): string {
    const list = isExpanded ? sessions : sessions.slice(0, 5);
    return \`
        <div>
            \${list.map(s => \`<div class="session-item">\${s.name}</div>\`).join('')}
        </div>
    \`;
}
`;

  const issuesB = analyzer.analyze(null, {
    filePath: 'src/ui/session-view.ts',
    content: foldedSource,
  });
  assert.strictEqual(
    issuesB.filter((i) => i.rule === 'VSC-UI-001').length,
    0,
    'Fold-controlled collection must not trigger VSC-UI-001',
  );

  console.log('  [PASS] 2. VSC-UI-001 passes when bounded by .slice() or folding toggle');
})();

// ── Test 3: VSC-UI-002 Hardcoded Theme Colors ──
(function testHardcodedThemeColors() {
  const hardcodedSource = `
export function getWebviewHtml(): string {
    return \`
        <div style="color: #000000; background: #ffffff;">
            <p style="color: black;">Active Session</p>
            <svg fill="#fff" stroke="black"></svg>
        </div>
    \`;
}
`;

  const issues = analyzer.analyze(null, {
    filePath: 'src/ui/panel.ts',
    content: hardcodedSource,
  });

  const colorIssues = issues.filter((i) => i.rule === 'VSC-UI-002');
  assert.strictEqual(colorIssues.length >= 1, true, 'Must flag hardcoded monochrome colors');
  assert.strictEqual(colorIssues[0].severity, 'error');
  console.log('  [PASS] 3. VSC-UI-002 flags hardcoded monochrome colors in Webview markup');
})();

// ── Test 4: VSC-UI-002 Passes with VS Code Theme CSS Variables ──
(function testThemeVariablesPasses() {
  const themeSource = `
export function getWebviewHtml(): string {
    return \`
        <div style="color: var(--vscode-editor-foreground); background: var(--vscode-editor-background);">
            <p style="color: var(--vscode-descriptionForeground);">Active Session</p>
        </div>
    \`;
}
`;

  const issues = analyzer.analyze(null, {
    filePath: 'src/ui/panel.ts',
    content: themeSource,
  });

  const colorIssues = issues.filter((i) => i.rule === 'VSC-UI-002');
  assert.strictEqual(colorIssues.length, 0, 'CSS variables must not trigger VSC-UI-002');
  console.log('  [PASS] 4. VSC-UI-002 passes with proper VS Code theme CSS variables');
})();

// ── Test 5: VSC-UI-004 Dynamic Border Jitter Guard ──
(function testDynamicBorderJitter() {
  const jitterSource = `
export function getStyles(): string {
    return \`
        <style>
            .button:hover { border: 1px solid var(--vscode-focusBorder); }
            .input:focus { border-width: 2px; }
        </style>
    \`;
}
`;
  const jitterIssues = analyzer.analyze(null, {
    filePath: 'src/ui/button.ts',
    content: jitterSource,
  });
  const vscUi004Violations = jitterIssues.filter((i) => i.rule === 'VSC-UI-004');
  assert.strictEqual(
    vscUi004Violations.length,
    2,
    'Must detect dynamic border mutation on hover/focus',
  );
  assert.strictEqual(vscUi004Violations[0].severity, 'warning');
  assert.ok(vscUi004Violations[0].message.includes('border width triggering layout jitter'));

  // Compliant version using box-shadow inset or border-color transition
  const nonJitterSource = `
export function getStyles(): string {
    return \`
        <style>
            .button:hover { box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }
            .input:focus { border-color: var(--vscode-focusBorder); }
        </style>
    \`;
}
`;
  const nonJitterIssues = analyzer.analyze(null, {
    filePath: 'src/ui/button.ts',
    content: nonJitterSource,
  });
  assert.strictEqual(
    nonJitterIssues.filter((i) => i.rule === 'VSC-UI-004').length,
    0,
    'box-shadow inset and border-color transitions must not trigger VSC-UI-004',
  );
  console.log(
    '  [PASS] 5. VSC-UI-004 flags dynamic border jitter and passes with box-shadow inset',
  );
})();

// ── Test 6: Scoring Dimension Deduction Integration ──
(function testDimensionScoringIntegration() {
  const vscUi001Issue = {
    id: 'vscode-extension:VSC-UI-001:file.ts:1',
    analyzer: 'vscode-extension',
    rule: 'VSC-UI-001',
    severity: 'warning',
    message: 'Webview collection list rendering lacks bounded density or folding controls.',
  };

  const vscUi002Issue = {
    id: 'vscode-extension:VSC-UI-002:file.ts:1',
    analyzer: 'vscode-extension',
    rule: 'VSC-UI-002',
    severity: 'error',
    message: 'Webview UI contains hardcoded color #000000 instead of theme CSS variables.',
  };

  const vscUi004Issue = {
    id: 'vscode-extension:VSC-UI-004:file.ts:1',
    analyzer: 'vscode-extension',
    rule: 'VSC-UI-004',
    severity: 'warning',
    message:
      'Webview interactive state style changes must not dynamically modify border width triggering layout jitter.',
  };

  const rule001 = DIMENSION_RULES.find(
    (r) => r.analyzer === vscUi001Issue.analyzer && r.covers(vscUi001Issue),
  );
  assert.notStrictEqual(rule001, undefined, 'VSC-UI-001 must be mapped in DIMENSION_RULES');
  assert.strictEqual(rule001.dimension, DIMENSION_PERFORMANCE_EFFICIENCY);

  const rule002 = DIMENSION_RULES.find(
    (r) => r.analyzer === vscUi002Issue.analyzer && r.covers(vscUi002Issue),
  );
  assert.notStrictEqual(rule002, undefined, 'VSC-UI-002 must be mapped in DIMENSION_RULES');
  assert.strictEqual(rule002.dimension, DIMENSION_ARCHITECTURE_CONSISTENCY);

  const rule004 = DIMENSION_RULES.find(
    (r) => r.analyzer === vscUi004Issue.analyzer && r.covers(vscUi004Issue),
  );
  assert.notStrictEqual(rule004, undefined, 'VSC-UI-004 must be mapped in DIMENSION_RULES');
  assert.strictEqual(rule004.dimension, DIMENSION_PERFORMANCE_EFFICIENCY);

  console.log(
    '  [PASS] 6. VSC-UI-001, VSC-UI-002, and VSC-UI-004 map to correct scoring quality dimensions',
  );
})();

console.log('\nAll VS Code Extension UI Folding & Theme Hygiene Tests Passed successfully.');
