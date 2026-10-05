#!/usr/bin/env node
/**
 * Module: Verification Harness — Gate Project Scope & Topology Adaptive Rules
 * File Path: scripts/validate-gate-project-scope.js
 * Architecture Role: Verifies workspace topology detection, single-project auto-muting
 *   for GATE-MSG-003, monorepo enforcement, dual-platform gate pairing (GATE-PAIR-001),
 *   and Bash condition syntax validation (SH-COND-001).
 * Dependencies & Triggers: Invoked by npm test / test-parallel; imports dist/core/governance
 *   and dist/analyzers.
 * Responsibilities:
 *   1. Verify detectRepoTopology on Single-Project, Directory Cluster, and Workspaces;
 *   2. Verify GATE-MSG-003 auto-mutes in Single-Project (zero false-positive findings);
 *   3. Verify GATE-MSG-003 strictly triggers in Monorepo without [Project] gate;
 *   4. Verify GATE-MSG-003 passes in Monorepo with compliant [Project] gate;
 *   5. Verify GATE-PAIR-001 detects missing .sh or .ps1 counterparts;
 *   6. Verify SH-COND-001 detects invalid condition syntax in single brackets.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passed;
 *   exits 1 on assertion failure.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectRepoTopology } = require('../dist/core/governance/repo-archetype');
const { auditGateArchitecture } = require('../dist/core/governance/gate-governance');
const { ShellLintAnalyzer } = require('../dist/analyzers/shell-lint');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gate-scope-${prefix}-`));
}

function cleanTempDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

console.log('Testing Workspace Topology Sniffer & Adaptive Gate Governance...');

// ── Test 1: Topology Sniffer on Single-Root Project ──
(function testSingleProjectTopology() {
  const tempDir = createTempDir('single-proj');
  try {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'my-standalone-app', version: '1.0.0' }, null, 2),
    );

    const topology = detectRepoTopology(tempDir);
    assert.strictEqual(topology.isMonorepo, false, 'Single root must not be monorepo');
    assert.strictEqual(topology.monorepoType, 'none');
    assert.strictEqual(topology.projectCount, 1);
    assert.strictEqual(topology.primaryProjectName, path.basename(tempDir));
    console.log('  [PASS] 1. Topology sniffer correctly classifies Single-Project');
  } finally {
    cleanTempDir(tempDir);
  }
})();

// ── Test 2: Topology Sniffer on Directory Cluster Monorepo ──
(function testClusterMonorepoTopology() {
  const tempDir = createTempDir('cluster-monorepo');
  try {
    const sub1 = path.join(tempDir, 'backend-service');
    const sub2 = path.join(tempDir, 'frontend-app');
    fs.mkdirSync(sub1, { recursive: true });
    fs.mkdirSync(sub2, { recursive: true });

    fs.writeFileSync(
      path.join(sub1, 'package.json'),
      JSON.stringify({ name: 'backend', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(sub2, 'Cargo.toml'),
      '[package]\nname = "frontend"\nversion = "0.1.0"\n',
    );

    const topology = detectRepoTopology(tempDir);
    assert.strictEqual(topology.isMonorepo, true, 'Directory cluster must be monorepo');
    assert.strictEqual(topology.monorepoType, 'directory-cluster');
    assert.strictEqual(topology.projectCount, 2);
    assert.strictEqual(topology.subprojects.length, 2);
    console.log('  [PASS] 2. Topology sniffer correctly classifies Directory Cluster Monorepo');
  } finally {
    cleanTempDir(tempDir);
  }
})();

// ── Test 3: Topology Sniffer on Explicit Workspace Manifest ──
(function testExplicitWorkspaceTopology() {
  const tempDir = createTempDir('explicit-workspace');
  try {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify(
        {
          name: 'mono-root',
          workspaces: ['packages/*'],
        },
        null,
        2,
      ),
    );

    const pkgDir = path.join(tempDir, 'packages', 'core');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@mono/core', version: '1.0.0' }),
    );

    const topology = detectRepoTopology(tempDir);
    assert.strictEqual(topology.isMonorepo, true);
    assert.strictEqual(topology.monorepoType, 'npm-workspaces');
    assert.strictEqual(topology.detectionSource, 'explicit-manifest');
    console.log('  [PASS] 3. Topology sniffer correctly classifies Explicit Manifest Workspace');
  } finally {
    cleanTempDir(tempDir);
  }
})();

// ── Test 4: GATE-MSG-003 Auto-Mutes on Single Project ──
(function testGateMsg003AutoMutesOnSingleProject() {
  const tempDir = createTempDir('single-mute');
  try {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'solo-app', version: '1.0.0' }),
    );

    // Setup gate hooks and scripts without [Project] check
    const hooksDir = path.join(tempDir, '.githooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, 'commit-msg'),
      '#!/bin/bash\n# Standard commit-msg\nfeat|fix|refactor\n',
    );
    fs.writeFileSync(
      path.join(hooksDir, 'pre-commit'),
      '#!/bin/bash\nset -euo pipefail\n# zero-byte check\n0-byte\nvalidate-staged-slice\n',
    );
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), '#!/bin/bash\nset -euo pipefail\nnpm test\n');

    const ciDir = path.join(tempDir, '.github', 'workflows');
    fs.mkdirSync(ciDir, { recursive: true });
    fs.writeFileSync(
      path.join(ciDir, 'ci.yml'),
      'name: CI\non: push\njobs:\n  test:\n    steps:\n',
    );

    const result = auditGateArchitecture(tempDir);
    const msg003Issue = result.issues.find((i) => i.rule === 'GATE-MSG-003');
    assert.strictEqual(
      msg003Issue,
      undefined,
      'GATE-MSG-003 must be auto-muted in single-project repository',
    );
    console.log('  [PASS] 4. GATE-MSG-003 correctly auto-mutes in Single-Project repository');
  } finally {
    cleanTempDir(tempDir);
  }
})();

// ── Test 5: GATE-MSG-003 Strictly Triggers on Monorepo Lacking [Project] ──
(function testGateMsg003TriggersOnMonorepo() {
  const tempDir = createTempDir('monorepo-violation');
  try {
    // Monorepo with two subprojects
    const sub1 = path.join(tempDir, 'app1');
    const sub2 = path.join(tempDir, 'app2');
    fs.mkdirSync(sub1, { recursive: true });
    fs.mkdirSync(sub2, { recursive: true });
    fs.writeFileSync(path.join(sub1, 'package.json'), JSON.stringify({ name: 'app1' }));
    fs.writeFileSync(path.join(sub2, 'package.json'), JSON.stringify({ name: 'app2' }));

    const hooksDir = path.join(tempDir, '.githooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, 'commit-msg'),
      '#!/bin/bash\n# Conventional commit only, no project header check\nfeat|fix|refactor\n',
    );
    fs.writeFileSync(
      path.join(hooksDir, 'pre-commit'),
      '#!/bin/bash\nset -euo pipefail\n0-byte\nvalidate-staged-slice\n',
    );
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), '#!/bin/bash\nset -euo pipefail\nnpm test\n');

    const ciDir = path.join(tempDir, '.github', 'workflows');
    fs.mkdirSync(ciDir, { recursive: true });
    fs.writeFileSync(
      path.join(ciDir, 'ci.yml'),
      'name: CI\non: push\njobs:\n  test:\n    steps:\n',
    );

    const result = auditGateArchitecture(tempDir);
    const msg003Issue = result.issues.find((i) => i.rule === 'GATE-MSG-003');
    assert.notStrictEqual(
      msg003Issue,
      undefined,
      'GATE-MSG-003 must trigger when Monorepo commit-msg lacks [Project] section check',
    );
    assert.strictEqual(msg003Issue.severity, 'error');
    assert.strictEqual(msg003Issue.detail.action, 'add_project_scope_gate');
    assert.deepStrictEqual(msg003Issue.detail.detectedSubprojects, ['app1', 'app2']);
    console.log('  [PASS] 5. GATE-MSG-003 strictly triggers on Monorepo with actionable payload');
  } finally {
    cleanTempDir(tempDir);
  }
})();

// ── Test 6: GATE-MSG-003 Passes on Monorepo with [Project] Check ──
(function testGateMsg003PassesWithProjectCheck() {
  const tempDir = createTempDir('monorepo-pass');
  try {
    const sub1 = path.join(tempDir, 'service-a');
    const sub2 = path.join(tempDir, 'service-b');
    fs.mkdirSync(sub1, { recursive: true });
    fs.mkdirSync(sub2, { recursive: true });
    fs.writeFileSync(path.join(sub1, 'package.json'), JSON.stringify({ name: 'service-a' }));
    fs.writeFileSync(path.join(sub2, 'package.json'), JSON.stringify({ name: 'service-b' }));

    const hooksDir = path.join(tempDir, '.githooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, 'commit-msg'),
      '#!/bin/bash\nfeat|fix|refactor\n# Verify [Project / 项目归属]\nFOUND_PROJECT_HEADER=true\n',
    );
    fs.writeFileSync(
      path.join(hooksDir, 'pre-commit'),
      '#!/bin/bash\nset -euo pipefail\n0-byte\nvalidate-staged-slice\n',
    );
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), '#!/bin/bash\nset -euo pipefail\nnpm test\n');

    const ciDir = path.join(tempDir, '.github', 'workflows');
    fs.mkdirSync(ciDir, { recursive: true });
    fs.writeFileSync(
      path.join(ciDir, 'ci.yml'),
      'name: CI\non: push\njobs:\n  test:\n    steps:\n',
    );

    const result = auditGateArchitecture(tempDir);
    const msg003Issue = result.issues.find((i) => i.rule === 'GATE-MSG-003');
    assert.strictEqual(msg003Issue, undefined, 'GATE-MSG-003 must pass with [Project] check');
    console.log('  [PASS] 6. GATE-MSG-003 passes on compliant Monorepo gate infrastructure');
  } finally {
    cleanTempDir(tempDir);
  }
})();

// ── Test 7: GATE-PAIR-001 Dual-Platform Pairing Guard ──
(function testGatePair001() {
  const tempDir = createTempDir('dual-pair');
  try {
    const shDir = path.join(tempDir, 'scripts', 'sh');
    const ps1Dir = path.join(tempDir, 'scripts', 'ps1');
    fs.mkdirSync(shDir, { recursive: true });
    fs.mkdirSync(ps1Dir, { recursive: true });

    // sh has pre-commit-gate.sh, ps1 missing pre-commit-gate.ps1
    fs.writeFileSync(path.join(shDir, 'pre-commit-gate.sh'), '#!/bin/bash\nset -euo pipefail\n');
    fs.writeFileSync(path.join(ps1Dir, 'commit-msg-gate.ps1'), '# PowerShell\n');
    fs.writeFileSync(path.join(shDir, 'commit-msg-gate.sh'), '#!/bin/bash\n');

    // Create hooks & CI so auditGateArchitecture proceeds
    const hooksDir = path.join(tempDir, '.githooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/bash\n0-byte\n');
    const ciDir = path.join(tempDir, '.github', 'workflows');
    fs.mkdirSync(ciDir, { recursive: true });
    fs.writeFileSync(path.join(ciDir, 'ci.yml'), 'name: CI\n');

    const result = auditGateArchitecture(tempDir);
    const pairIssues = result.issues.filter((i) => i.rule === 'GATE-PAIR-001');
    assert.strictEqual(pairIssues.length >= 1, true, 'GATE-PAIR-001 must flag missing pair');
    assert.strictEqual(
      pairIssues.some((i) => i.location.file.includes('pre-commit-gate')),
      true,
    );
    console.log('  [PASS] 7. GATE-PAIR-001 flags missing dual-platform gate script pairing');
  } finally {
    cleanTempDir(tempDir);
  }
})();

// ── Test 8: SH-COND-001 Bash Condition Syntax Guard ──
(function testShCond001() {
  const analyzer = new ShellLintAnalyzer();

  const invalidScript = `#!/bin/bash
set -euo pipefail

# Regex in single bracket (invalid)
if [ "$name" =~ ^[a-z]+$ ]; then
    echo "regex"
fi

# Logical AND in single bracket (invalid)
if [ "$a" = "1" && "$b" = "2" ]; then
    echo "and"
fi

# Double equals in single bracket (non-portable)
if [ "$mode" == "production" ]; then
    echo "prod"
fi
`;

  const issues = analyzer.analyze(null, {
    filePath: 'scripts/sh/test-conditions.sh',
    content: invalidScript,
  });

  const condIssues = issues.filter((i) => i.rule === 'SH-COND-001');
  assert.strictEqual(condIssues.length, 3, 'Must flag 3 condition syntax violations');

  const regexIssue = condIssues.find((i) => i.message.includes('Regex'));
  assert.notStrictEqual(regexIssue, undefined);
  assert.strictEqual(regexIssue.severity, 'error');

  const logicIssue = condIssues.find((i) => i.message.includes('Logical'));
  assert.notStrictEqual(logicIssue, undefined);
  assert.strictEqual(logicIssue.severity, 'error');

  const eqIssue = condIssues.find((i) => i.message.includes('Equality'));
  assert.notStrictEqual(eqIssue, undefined);
  assert.strictEqual(eqIssue.severity, 'warning');

  console.log(
    '  [PASS] 8. SH-COND-001 catches regex, logical operators, and non-portable equality',
  );
})();

console.log('\nAll Gate Project Scope & Topology Adaptive Tests Passed successfully.');
