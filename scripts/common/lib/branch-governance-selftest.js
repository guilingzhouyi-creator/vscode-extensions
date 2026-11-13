/**
 * Module: Branch Governance Self-Test Suite
 * File Path: scripts/common/lib/branch-governance-selftest.js
 * Architecture Role: In-process regression verifier for the 5-tier fractal branch
 *   taxonomy, legacy D/F guardrails, fork inheritance rules, and trunk locks.
 * Dependencies & Triggers: Consumes `./branch-taxonomy` and `./branch-inheritance`.
 *   Triggered by `node scripts/common/validate-branch-governance.js --selftest`.
 * Responsibilities:
 *   1. Assert classification outcomes across all 5 tiers and facade aliases;
 *   2. Verify strict creation mode blocks legacy 4-segment card branches;
 *   3. Exercise fork inheritance, alias normalization, and trunk protection checks.
 * Exit Semantics & Design Rationale: Pure boolean return (`true` = all cases pass).
 */

'use strict';

const { isProtectedBranch, validateBranchName } = require('./branch-taxonomy');
const { assertLegalFork, deriveChildBranch } = require('./branch-inheritance');

const TAXONOMY_CASES = Object.freeze([
  { name: 'main', valid: true, tier: 0 },
  { name: 'master', valid: true, tier: 0 },
  { name: 'integration', valid: true, tier: 1 },
  { name: 'cell/fractal-git/main', valid: true, tier: 2 },
  { name: 'cell/auto-refactor/main', valid: true, tier: 2 },
  { name: 'cell/web-games/main', valid: false },
  { name: 'cell/unknown-cell/main', valid: false },
  { name: 'cell/fractal-git/card/fgt-branch-gate/main', valid: true, tier: 3, legacy: false },
  { name: 'cell/fractal-git/card/fgt-branch-gate', valid: true, tier: 3, legacy: true },
  { name: 'cell/workspace-timing/card/fix-crash-recovery/main', valid: true, tier: 3, legacy: false },
  { name: 'cell/fractal-git/card/wip-hack/main', valid: false },
  { name: 'cell/fractal-git/card/Bad_Camel_Case', valid: false },
  { name: 'cell/fractal-git/card/fgt-gate/sub/agent-01', valid: true, tier: 4 },
  { name: 'cell/webgames/card/combat-fsm/sub/explore-fsm', valid: true, tier: 4 },
  { name: 'feat/fractal-git/lockless-tree', valid: true, tier: 3, normalizedRef: 'cell/fractal-git/card/feat-lockless-tree/main' },
  { name: 'fix/workspace-timing/journal-replay', valid: true, tier: 3, normalizedRef: 'cell/workspace-timing/card/fix-journal-replay/main' },
  { name: 'refactor/auto-refactor/moe-router', valid: true, tier: 3, normalizedRef: 'cell/auto-refactor/card/refactor-moe-router/main' },
  { name: 'feat/unknown-cell/test-feat', valid: false },
  { name: 'feat/my-feature', valid: false },
  { name: 'temp-work', valid: false },
  { name: 'wip/something', valid: false },
  { name: 'tmp-branch', valid: false },
  { name: 'swarm-p2-fg-hash', valid: false },
  { name: 'test/taxis-hardening', valid: false },
]);

function verifyCase(c) {
  const res = validateBranchName(c.name);
  if (res.valid !== c.valid) {
    console.error(`FAIL: '${c.name}' expected valid=${c.valid}, got ${res.valid} (${res.error || 'ok'})`);
    return false;
  }
  if (c.valid && c.tier !== undefined && res.tier !== c.tier) {
    console.error(`FAIL: '${c.name}' expected tier=${c.tier}, got ${res.tier}`);
    return false;
  }
  if (c.legacy !== undefined && res.isLegacyCardFormat !== c.legacy) {
    console.error(`FAIL: '${c.name}' expected legacy=${c.legacy}, got ${res.isLegacyCardFormat}`);
    return false;
  }
  if (c.normalizedRef && res.normalizedRef !== c.normalizedRef) {
    console.error(`FAIL: '${c.name}' expected normalizedRef=${c.normalizedRef}, got ${res.normalizedRef}`);
    return false;
  }
  return true;
}

/**
 * Self-test suite verifying the taxonomy matrix, fork inheritance, and parity checks.
 *
 * @returns {boolean} True if all assertions hold.
 */
function runSelftest() {
  for (const c of TAXONOMY_CASES) {
    if (!verifyCase(c)) return false;
  }
  const checks = [
    [!validateBranchName('cell/fractal-git/card/fgt-branch-gate', { allowLegacyCard: false }).valid, 'strict creation mode must reject 4-segment legacy card branch'],
    [assertLegalFork('cell/fractal-git/main', 'cell/fractal-git/card/c1/main').valid, 'expected legal fork from cell main to 5-segment card main'],
    [!assertLegalFork('cell/fractal-git/card/c1', 'cell/fractal-git/card/c1/sub/s1').valid, 'must reject subagent fork under 4-segment legacy card'],
    [!assertLegalFork('main', 'cell/fractal-git/card/c1/main').valid, 'must reject tier-jumping fork from main to card'],
    [deriveChildBranch('integration', 'web-games') === 'cell/webgames/main', 'alias normalization web-games -> cell/webgames/main'],
    [deriveChildBranch('cell/fractal-git/main', 'kernel-std') === 'cell/fractal-git/card/kernel-std/main', 'deriveChildBranch card must emit 5-segment /main'],
    [isProtectedBranch('main') && isProtectedBranch('refs/heads/main') && isProtectedBranch('cell/fractal-git/main'), 'protected trunk checks failed'],
    [!isProtectedBranch('cell/fractal-git/card/card-1/main'), 'card worktree must not be protected'],
  ];
  for (const [ok, message] of checks) {
    if (!ok) {
      console.error(`FAIL: ${message}`);
      return false;
    }
  }
  console.log(`PASS: validate-branch-governance selftest passed (${TAXONOMY_CASES.length}/${TAXONOMY_CASES.length} branch cases + inheritance checks)`);
  return true;
}

module.exports = { runSelftest };
