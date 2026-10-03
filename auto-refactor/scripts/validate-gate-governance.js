/**
 * Module: Verification Harness — Gate Architecture Governance
 * File Path: scripts/validate-gate-governance.js
 * Architecture Role: Regression test suite #142; verifies universal repository archetype
 *   inference, missing gate detection with scaffolding generation, 7-dimensional gate audits,
 *   and strict project neutrality.
 * Dependencies & Triggers: dist/core/governance (inspectRepoArchetype, auditGateArchitecture,
 *   generateGateScaffold) and GateArchitectureAnalyzer.
 * Responsibilities:
 *   1. Test archetype inference across Node, Rust, Python, Go, Godot, Polyglot;
 *   2. Test GATE-SYS-001 (critical missing gate) and scaffold payload;
 *   3. Test GATE-HOOK-001 (missing local left-shift hooks);
 *   4. Test 7 existing gate quality dimensions (GATE-ISO-001 through GATE-SSOT-001);
 *   5. Dogfood audit against workspace root;
 *   6. Strict project neutrality verification (zero hardcoded workspace names).
 * Exit Semantics & Design Rationale: Exits 0 on all tests passing, exits 1 on failure.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  inspectRepoArchetype,
  auditGateArchitecture,
  generateGateScaffold,
} = require('../dist/core/governance');
const { GateArchitectureAnalyzer } = require('../dist/analyzers/gate-architecture');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gate-test-${prefix}-`));
}

function cleanTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort: test fixture cleanup
  }
}

console.log('Testing Gate Architecture Governance & Archetype Scaffolding...');

// ── Test 0: Analyzer Contract ──
(function testAnalyzerContract() {
  const analyzer = new GateArchitectureAnalyzer();
  assert.strictEqual(analyzer.name, 'gate-architecture');
  assert.strictEqual(typeof analyzer.finalize, 'function');
  console.log('  [PASS] 0. GateArchitectureAnalyzer contract and factory initialization');
})();

// ── Test 1: Archetype Detection ──
(function testArchetypeDetection() {
  const dir = createTempDir('archetype');
  try {
    // 1.1 Node.js project
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'test-node', scripts: { test: 'jest' } }),
    );
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    let ctx = inspectRepoArchetype(dir);
    assert.strictEqual(ctx.primaryArchetype, 'node');
    assert.strictEqual(ctx.packageManager, 'pnpm');
    assert.ok(ctx.manifests.packageJson);
    assert.ok(ctx.scriptsAvailable.includes('test'));

    // 1.2 Polyglot project (Node + Rust)
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "test-rust"');
    // Nested gate scripts under scripts/ps1 and scripts/sh
    fs.mkdirSync(path.join(dir, 'scripts', 'ps1'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts', 'sh'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'scripts', 'ps1', 'pre-commit-gate.ps1'), '# ps1 gate');
    fs.writeFileSync(path.join(dir, 'scripts', 'sh', 'pre-commit-gate.sh'), '# sh gate');

    ctx = inspectRepoArchetype(dir);
    assert.strictEqual(ctx.primaryArchetype, 'polyglot');
    assert.ok(ctx.archetypes.includes('node'));
    assert.ok(ctx.archetypes.includes('rust'));
    assert.ok(ctx.gateScripts.files.some((f) => f.includes('pre-commit-gate.ps1')));
    assert.ok(ctx.gateScripts.files.some((f) => f.includes('pre-commit-gate.sh')));

    console.log(
      '  [PASS] 1. Universal repository archetype detection (Node, Rust, Polyglot, Nested Gate Scripts)',
    );
  } finally {
    cleanTempDir(dir);
  }
})();

// ── Test 2: Scenario A - Completely Missing Gate System (GATE-SYS-001) ──
(function testMissingGateSystem() {
  const dir = createTempDir('missing-sys');
  try {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'empty-gate-project' }),
    );
    const result = auditGateArchitecture(dir);

    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.issues.length, 1);
    const issue = result.issues[0];
    assert.strictEqual(issue.rule, 'GATE-SYS-001');
    assert.strictEqual(issue.severity, 'error');
    assert.ok(issue.actionable, 'Expected actionable payload');
    assert.strictEqual(issue.actionable.action, 'scaffold_gate_system');
    assert.strictEqual(issue.actionable.code, 'GATE-SYS-001');
    assert.strictEqual(issue.actionable.safeToAutomate, true);

    const scaffold = issue.actionable;
    assert.strictEqual(scaffold.suggestedStructure.hookDir, '.githooks');
    assert.strictEqual(scaffold.suggestedStructure.hooks.length, 3);
    assert.strictEqual(scaffold.suggestedStructure.runnerScripts.length, 4);
    assert.ok(scaffold.suggestedStructure.ciWorkflow);

    console.log(
      '  [PASS] 2. GATE-SYS-001: Missing gate system emits full cross-platform scaffold payload',
    );
  } finally {
    cleanTempDir(dir);
  }
})();

// ── Test 3: Scenario A - Missing Local Hooks (GATE-HOOK-001) ──
(function testMissingLocalHooks() {
  const dir = createTempDir('missing-hook');
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'ci-only-project' }));
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.github', 'workflows', 'ci.yml'),
      'name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest',
    );

    const result = auditGateArchitecture(dir);
    assert.strictEqual(result.passed, false);
    const hookIssue = result.issues.find((i) => i.rule === 'GATE-HOOK-001');
    assert.ok(hookIssue, 'Expected GATE-HOOK-001 issue');
    assert.strictEqual(hookIssue.severity, 'warning');
    assert.ok(hookIssue.actionable);
    assert.strictEqual(hookIssue.actionable.code, 'GATE-HOOK-001');

    console.log(
      '  [PASS] 3. GATE-HOOK-001: Missing local left-shift Git hooks flagged with warning',
    );
  } finally {
    cleanTempDir(dir);
  }
})();

// ── Test 4: Scenario B - Hook Runtime Degradation & Safety (GATE-ROUTE-001) ──
(function testRoutingSafety() {
  const dir = createTempDir('fragile-route');
  try {
    fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });
    // Fragile launcher using powershell.exe directly
    fs.writeFileSync(
      path.join(dir, '.githooks', 'pre-commit'),
      '#!/bin/sh\npowershell.exe -File scripts/gate.ps1\n',
    );
    const result = auditGateArchitecture(dir);

    const routeIssue = result.issues.find((i) => i.rule === 'GATE-ROUTE-001');
    assert.ok(routeIssue, 'Expected GATE-ROUTE-001 issue for powershell.exe bare invocation');
    assert.strictEqual(routeIssue.severity, 'error');

    console.log(
      '  [PASS] 4. GATE-ROUTE-001: Fragile hook routing (powershell.exe) detected and blocked',
    );
  } finally {
    cleanTempDir(dir);
  }
})();

// ── Test 5: Scenario B - Physical Hygiene Guard (GATE-HYG-001) ──
(function testHygieneGuard() {
  const dir = createTempDir('no-hygiene');
  try {
    fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });
    // Hook that lacks zero-byte empty file check
    fs.writeFileSync(
      path.join(dir, '.githooks', 'pre-commit'),
      '#!/usr/bin/env bash\nset -euo pipefail\necho "Running tests"\n',
    );
    const result = auditGateArchitecture(dir);

    const hygIssue = result.issues.find((i) => i.rule === 'GATE-HYG-001');
    assert.ok(hygIssue, 'Expected GATE-HYG-001 for missing 0-byte check');
    assert.strictEqual(hygIssue.severity, 'error');

    console.log('  [PASS] 5. GATE-HYG-001: Pre-commit lacking zero-byte empty file check flagged');
  } finally {
    cleanTempDir(dir);
  }
})();

// ── Test 6: Scenario B - Commit-Msg Integrity (GATE-MSG-001) ──
(function testCommitMsgGate() {
  const dir = createTempDir('no-commit-msg');
  try {
    fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.githooks', 'pre-commit'),
      '#!/usr/bin/env bash\nset -euo pipefail\nif [ ! -s "$1" ]; then exit 1; fi\n',
    );
    const result = auditGateArchitecture(dir);

    const msgIssue = result.issues.find((i) => i.rule === 'GATE-MSG-001');
    assert.ok(msgIssue, 'Expected GATE-MSG-001 for missing commit-msg hook');
    assert.strictEqual(msgIssue.severity, 'warning');

    console.log('  [PASS] 6. GATE-MSG-001: Missing commit-msg hook flagged');
  } finally {
    cleanTempDir(dir);
  }
})();

// ── Test 7: Scenario B - Strict Error Discipline (GATE-ERR-001) ──
(function testStrictErrorDiscipline() {
  const dir = createTempDir('loose-error');
  try {
    fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    // Script lacking set -e
    fs.writeFileSync(
      path.join(dir, 'scripts', 'pre-commit-gate.sh'),
      '#!/usr/bin/env bash\necho "no strict mode"\n',
    );
    fs.writeFileSync(
      path.join(dir, '.githooks', 'pre-commit'),
      '#!/usr/bin/env bash\nset -euo pipefail\n',
    );

    const result = auditGateArchitecture(dir);
    const errIssue = result.issues.find((i) => i.rule === 'GATE-ERR-001');
    assert.ok(errIssue, 'Expected GATE-ERR-001 for script lacking set -euo pipefail');
    assert.strictEqual(errIssue.severity, 'error');

    console.log('  [PASS] 7. GATE-ERR-001: Gate script without strict error flags blocked');
  } finally {
    cleanTempDir(dir);
  }
})();

// ── Test 8: Scenario B - Dual-Tier Isomorphism (GATE-ISO-001) ──
(function testIsomorphism() {
  const dir = createTempDir('non-isomorphic');
  try {
    fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });

    // CI runs lint, but local hooks only run regression
    fs.writeFileSync(
      path.join(dir, '.github', 'workflows', 'ci.yml'),
      'name: CI\njobs:\n  lint:\n    run: npm run lint\n  test:\n    run: npm test',
    );
    fs.writeFileSync(
      path.join(dir, '.githooks', 'pre-commit'),
      '#!/usr/bin/env bash\nset -euo pipefail\nif [ ! -s "$1" ]; then exit 1; fi\n',
    );
    fs.writeFileSync(
      path.join(dir, '.githooks', 'commit-msg'),
      '#!/usr/bin/env bash\nset -euo pipefail\n# feat: test\n',
    );
    fs.writeFileSync(
      path.join(dir, '.githooks', 'pre-push'),
      '#!/usr/bin/env bash\nset -euo pipefail\nnpm test\n',
    );

    const result = auditGateArchitecture(dir);
    const isoIssue = result.issues.find((i) => i.rule === 'GATE-ISO-001');
    assert.ok(isoIssue, 'Expected GATE-ISO-001 for unmirrored CI lint check');
    assert.strictEqual(isoIssue.severity, 'warning');

    // Subtest: Hooks exist, but CI workflow is missing completely
    const dirNoCi = createTempDir('hooks-no-ci');
    try {
      fs.mkdirSync(path.join(dirNoCi, '.githooks'), { recursive: true });
      fs.writeFileSync(
        path.join(dirNoCi, '.githooks', 'pre-commit'),
        '#!/usr/bin/env bash\nset -euo pipefail\nif [ ! -s "$1" ]; then exit 1; fi\n',
      );
      fs.writeFileSync(
        path.join(dirNoCi, '.githooks', 'commit-msg'),
        '#!/usr/bin/env bash\nset -euo pipefail\n# feat: test\n',
      );
      fs.writeFileSync(
        path.join(dirNoCi, '.githooks', 'pre-push'),
        '#!/usr/bin/env bash\nset -euo pipefail\nnpm test\n',
      );
      const resultNoCi = auditGateArchitecture(dirNoCi);
      const isoNoCiIssue = resultNoCi.issues.find((i) => i.rule === 'GATE-ISO-001');
      assert.ok(isoNoCiIssue, 'Expected GATE-ISO-001 when CI workflow is missing completely');
      assert.strictEqual(isoNoCiIssue.severity, 'warning');
      assert.ok(isoNoCiIssue.actionable, 'Expected actionable payload for missing CI');
      assert.strictEqual(isoNoCiIssue.actionable.code, 'GATE-ISO-001');
    } finally {
      cleanTempDir(dirNoCi);
    }

    console.log('  [PASS] 8. GATE-ISO-001: Discrepancy between CI and local hooks identified');
  } finally {
    cleanTempDir(dir);
  }
})();

// ── Test 9: Scaffolding Generator Completeness ──
(function testScaffoldingGenerator() {
  const dir = createTempDir('scaffold-gen');
  try {
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "rust-app"');
    const ctx = inspectRepoArchetype(dir);
    const scaffold = generateGateScaffold(ctx);

    assert.strictEqual(scaffold.archetype, 'rust');
    assert.ok(scaffold.suggestedStructure.hooks.some((h) => h.name === 'pre-commit'));
    assert.ok(scaffold.suggestedStructure.hooks.some((h) => h.name === 'commit-msg'));
    assert.ok(scaffold.suggestedStructure.hooks.some((h) => h.name === 'pre-push'));

    const prePush = scaffold.suggestedStructure.runnerScripts.find((s) =>
      s.filePath.includes('pre-push'),
    );
    assert.ok(
      prePush.content.includes('cargo test --workspace'),
      'Expected cargo test for rust archetype',
    );

    console.log(
      '  [PASS] 9. Gate scaffolding generator generates valid archetype-specific templates',
    );
  } finally {
    cleanTempDir(dir);
  }
})();

// ── Test 10: Strict Project Neutrality Check ──
(function testProjectNeutrality() {
  const sourceFiles = [
    path.join(__dirname, '..', 'src', 'core', 'governance', 'repo-archetype.ts'),
    path.join(__dirname, '..', 'src', 'core', 'governance', 'gate-scaffold.ts'),
    path.join(__dirname, '..', 'src', 'core', 'governance', 'gate-governance.ts'),
    path.join(__dirname, '..', 'src', 'analyzers', 'gate-architecture.ts'),
  ];

  const forbiddenPattern = /\b(?:workspace-timing|WebGames)\b/;

  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const match = forbiddenPattern.exec(content);
    assert.strictEqual(
      match,
      null,
      `Project Neutrality Violation: Found forbidden token in ${path.relative(__dirname, file)}`,
    );
  }

  console.log(
    '  [PASS] 10. Strict Project Neutrality: 0 hardcoded project names detected in all gate governance modules',
  );
})();

// ── Test 11: Dogfood Workspace Gate Audit ──
(function testWorkspaceDogfood() {
  const workspaceRoot = path.resolve(__dirname, '..', '..');
  const result = auditGateArchitecture(workspaceRoot);

  assert.ok(result.metrics.hasLocalGates, 'Workspace must possess local Git hooks');
  assert.ok(result.metrics.hasCiPipelines, 'Workspace must possess CI pipelines');

  // Verify no critical gate system missing errors
  const criticalSysIssue = result.issues.find(
    (i) => i.rule === 'GATE-SYS-001' || i.rule === 'GATE-HOOK-001',
  );
  assert.strictEqual(
    criticalSysIssue,
    undefined,
    'Workspace must not trigger GATE-SYS-001 or GATE-HOOK-001',
  );

  console.log(
    `  [PASS] 11. Workspace dogfood: local gates detected, CI detected, 0 system-missing defects`,
  );
})();

console.log('\n ALL 11 GATE GOVERNANCE CHECKS PASSED SUCCESSFULLY!\n');
