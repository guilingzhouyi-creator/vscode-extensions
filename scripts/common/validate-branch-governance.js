/**
 * Module: Branch Governance & Taxonomy Validator
 * File Path: scripts/common/validate-branch-governance.js
 * Architecture Role: CLI entrypoint and unified public API facade for workspace
 *   branch nomenclature, coordinate inheritance, and cross-language SSOT parity.
 * Dependencies & Triggers: Node.js built-ins + `./lib/branch-*` modules. Triggered
 *   by pre-commit-gate, pre-push-gate (via gate-receipts verify-refs), and CI.
 * Responsibilities:
 *   1. Route CLI subcommands (--selftest, --check-policy-parity, --check-current,
 *      --check-fork, --derive-child, --branch);
 *   2. Emit standardized `FGT-TOP-001` diagnostics and documented exit codes;
 *   3. Expose programmatic API across taxonomy, inheritance, parity, and selftest.
 * Exit Semantics & Design Rationale:
 *   - 0 = branch conforms strictly to taxonomy or selftest succeeds;
 *   - 1 = branch violates taxonomy, inheritance rule, or parity check;
 *   - 2 = usage error or missing required CLI flags.
 */

'use strict';

const taxonomy = require('./lib/branch-taxonomy');
const inheritance = require('./lib/branch-inheritance');
const { checkPolicyParity } = require('./lib/branch-policy-parity');
const { runSelftest } = require('./lib/branch-governance-selftest');

const EXIT_OK = 0;
const EXIT_BLOCK = 1;
const EXIT_USAGE = 2;

const USAGE_TEXT = 'Usage: node scripts/common/validate-branch-governance.js [--selftest | --check-current | --branch <name> | --check-fork --parent <p> --child <c> | --derive-child --parent <p> --slug <s> [--facade <t>] | --check-policy-parity]';

function parseFlagPair(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

function runCheckCurrent() {
  const current = inheritance.getCurrentBranch(process.cwd());
  if (!current) {
    console.log('INFO: Detached HEAD state detected; skipping branch taxonomy check.');
    return EXIT_OK;
  }
  const verdict = taxonomy.validateBranchName(current);
  if (!verdict.valid) {
    console.error(`BLOCK (FGT-TOP-001): 当前分支 '${current}' 不符合工作区分支分类法规范！\n原因: ${verdict.error}`);
    return EXIT_BLOCK;
  }
  console.log(`PASS (FGT-TOP-001): 当前分支 '${current}' 符合 Tier ${verdict.tier} 分形坐标规范。`);
  return EXIT_OK;
}

function runCheckFork(args) {
  const parentRef = parseFlagPair(args, '--parent');
  const childRef = parseFlagPair(args, '--child');
  if (!parentRef || !childRef) {
    console.error('Usage: --check-fork --parent <parent-branch> --child <child-branch>');
    return EXIT_USAGE;
  }
  const forkVerdict = inheritance.assertLegalFork(parentRef, childRef);
  if (!forkVerdict.valid) {
    console.error(`BLOCK (FGT-TOP-001): ${forkVerdict.error}`);
    return EXIT_BLOCK;
  }
  console.log(`PASS (FGT-TOP-001): ${parentRef} -> ${forkVerdict.canonicalChild} (Tier ${forkVerdict.parentTier} -> Tier ${forkVerdict.childTier})`);
  return EXIT_OK;
}

function runDeriveChild(args) {
  const parentRef = parseFlagPair(args, '--parent');
  const slug = parseFlagPair(args, '--slug');
  const facade = parseFlagPair(args, '--facade');
  if (!parentRef || !slug) {
    console.error('Usage: --derive-child --parent <parent-branch> --slug <child-slug> [--facade <type>]');
    return EXIT_USAGE;
  }
  try {
    console.log(inheritance.deriveChildBranch(parentRef, slug, facade || undefined));
    return EXIT_OK;
  } catch (err) {
    console.error(`BLOCK (FGT-TOP-001): ${err.message}`);
    return EXIT_BLOCK;
  }
}

function dispatchCli(args) {
  if (args.includes('--selftest')) return runSelftest() ? EXIT_OK : EXIT_BLOCK;
  if (args.includes('--check-policy-parity')) {
    const parity = checkPolicyParity();
    if (!parity.valid) {
      console.error(`BLOCK (FGT-TOP-001): 跨语言策略常量不一致:\n- ${parity.diffs.join('\n- ')}`);
      return EXIT_BLOCK;
    }
    console.log('PASS (FGT-TOP-001): JS/Rust/TS 分支治理常量与二进制策略文件名 100% 一致。');
    return EXIT_OK;
  }
  if (args.includes('--check-current')) return runCheckCurrent();
  if (args.includes('--check-fork')) return runCheckFork(args);
  if (args.includes('--derive-child')) return runDeriveChild(args);
  const target = parseFlagPair(args, '--branch');
  if (target) {
    const verdict = taxonomy.validateBranchName(target);
    if (!verdict.valid) {
      console.error(`BLOCK (FGT-TOP-001): 分支 '${target}' 校验失败: ${verdict.error}`);
      return EXIT_BLOCK;
    }
    console.log(`PASS (FGT-TOP-001): 分支 '${target}' 符合 Tier ${verdict.tier} 规范 (映射: ${verdict.normalizedRef})`);
    return EXIT_OK;
  }
  console.error(USAGE_TEXT);
  return EXIT_USAGE;
}

if (require.main === module) {
  process.exit(dispatchCli(process.argv.slice(2)));
}

module.exports = {
  CARD_CANONICAL_LEAF: taxonomy.CARD_CANONICAL_LEAF,
  MAX_BRANCH_SEGMENT_LEN: taxonomy.MAX_BRANCH_SEGMENT_LEN,
  RECOGNIZED_CELLS: taxonomy.RECOGNIZED_CELLS,
  CELL_ALIASES: taxonomy.CELL_ALIASES,
  FACADE_TYPES: taxonomy.FACADE_TYPES,
  FORBIDDEN_BRANCH_PREFIXES: taxonomy.FORBIDDEN_BRANCH_PREFIXES,
  PROTECTED_SYSTEM_TRUNKS: taxonomy.PROTECTED_SYSTEM_TRUNKS,
  normalizeCellId: taxonomy.normalizeCellId,
  hasForbiddenBranchPrefix: taxonomy.hasForbiddenBranchPrefix,
  normalizeBranchName: taxonomy.normalizeBranchName,
  isProtectedBranch: taxonomy.isProtectedBranch,
  parseBranchTaxonomy: taxonomy.parseBranchTaxonomy,
  validateBranchName: taxonomy.validateBranchName,
  assertLegalFork: inheritance.assertLegalFork,
  deriveChildBranch: inheritance.deriveChildBranch,
  checkPolicyParity,
  getCurrentBranch: inheritance.getCurrentBranch,
  collectCurrentBranchViolation: inheritance.collectCurrentBranchViolation,
  runSelftest,
};
