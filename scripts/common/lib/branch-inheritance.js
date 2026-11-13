/**
 * Module: Fractal Branch Inheritance & Git HEAD Probe
 * File Path: scripts/common/lib/branch-inheritance.js
 * Architecture Role: Enforces tier-to-tier downward fork constraints (`FGT-TOP-001`),
 *   deterministic child ref synthesis, and active HEAD validation against git.
 * Dependencies & Triggers: Node.js `child_process` and `./branch-taxonomy`.
 * Responsibilities:
 *   1. Assert strict parent -> child downward fork legality across Tiers 0..4;
 *   2. Synthesize canonical child branch names under a validated parent coordinate;
 *   3. Probe active branch via `git symbolic-ref` and emit violation records.
 * Exit Semantics & Design Rationale: Fork assertions fail closed on tier jumps,
 *   cross-cell derivations, and D/F-colliding 4-segment legacy card branches.
 */

'use strict';

const { spawnSync } = require('child_process');
const {
  CARD_CANONICAL_LEAF,
  FACADE_TYPES,
  normalizeCellId,
  normalizeBranchName,
  validateStrictSegment,
  validateStrictCell,
  parseBranchTaxonomy,
  validateBranchName,
} = require('./branch-taxonomy');

/**
 * Asserts strict 5-tier downward fork inheritance from `parentRef` to `childRef` (`FGT-TOP-001`).
 *
 * @param {string} parentRef - Active source branch name.
 * @param {string} childRef - Target child branch name being created.
 * @returns {{valid: boolean, error?: string, parentTier?: number, childTier?: number, canonicalChild?: string}}
 */
function assertLegalFork(parentRef, childRef) {
  const parent = parseBranchTaxonomy(parentRef, { allowLegacyCard: true });
  if (!parent.valid) {
    return { valid: false, error: `Invalid parent branch '${parentRef}': ${parent.error}` };
  }
  const child = parseBranchTaxonomy(childRef, { allowLegacyCard: false });
  if (!child.valid) {
    return { valid: false, error: `Invalid target child branch '${childRef}': ${child.error}` };
  }
  if (child.tier === 0) {
    return { valid: false, error: `Cannot fork into Tier 0 system trunk '${child.normalizedRef}'` };
  }
  if (child.tier === 1 && parent.tier === 0) {
    return { valid: true, parentTier: 0, childTier: 1, canonicalChild: 'integration' };
  }
  if (child.tier === 2 && parent.tier === 1) {
    return { valid: true, parentTier: 1, childTier: 2, canonicalChild: child.normalizedRef };
  }
  if (child.tier === 3 && parent.tier === 2 && parent.cellId === child.cellId) {
    return { valid: true, parentTier: 2, childTier: 3, canonicalChild: child.normalizedRef };
  }
  if (child.tier === 4 && parent.tier === 3 && parent.cellId === child.cellId && parent.cardId === child.cardId) {
    if (parent.isLegacyCardFormat) {
      return { valid: false, error: `Cannot fork Tier 4 subagent from D/F-colliding 4-segment card '${parentRef}'; migrate card branch to '${parent.normalizedRef}'` };
    }
    return { valid: true, parentTier: 3, childTier: 4, canonicalChild: child.normalizedRef };
  }
  return {
    valid: false,
    error: `Illegal tier jump or cross-coordinate fork (FGT-TOP-001): cannot derive '${childRef}' (Tier ${child.tier}) from '${parentRef}' (Tier ${parent.tier})`,
  };
}

/**
 * Deterministically synthesizes the next-tier child branch name under `parentRef`.
 *
 * @param {string} parentRef - Active parent branch name.
 * @param {string} childSlug - Child slug (normalized via `CELL_ALIASES` when tier 2).
 * @param {string} [facadeType] - Optional Tier 3 human facade prefix.
 * @returns {string} Canonical child branch name.
 */
function deriveChildBranch(parentRef, childSlug, facadeType) {
  const parent = parseBranchTaxonomy(parentRef, { allowLegacyCard: true });
  if (!parent.valid) {
    throw new Error(`Parent branch '${parentRef}' is not a valid fractal coordinate: ${parent.error}`);
  }
  const slug = String(childSlug || '').trim();
  if (parent.tier === 0) {
    if (facadeType) throw new Error('--facade can only be used under cell/<cell>/main');
    if (slug !== 'integration') throw new Error("System trunk ('main'/'master') can only derive 'integration'");
    return 'integration';
  }
  if (parent.tier === 1) {
    if (facadeType) throw new Error('--facade can only be used under cell/<cell>/main');
    const canonicalCell = normalizeCellId(slug);
    const cellErr = validateStrictCell(canonicalCell, parentRef);
    if (cellErr) throw new Error(cellErr);
    return `cell/${canonicalCell}/main`;
  }
  if (parent.tier === 2) {
    const segErr = validateStrictSegment('card', slug);
    if (segErr) throw new Error(segErr);
    if (!facadeType) return `cell/${parent.cellId}/card/${slug}/${CARD_CANONICAL_LEAF}`;
    if (!FACADE_TYPES.includes(facadeType)) {
      throw new Error(`Unsupported facade '${facadeType}'; allowed: ${FACADE_TYPES.join(', ')}`);
    }
    return `${facadeType}/${parent.cellId}/${slug}`;
  }
  if (parent.tier === 3) {
    if (facadeType) throw new Error('--facade cannot be used when deriving a Tier 4 subagent branch');
    if (parent.isLegacyCardFormat) {
      throw new Error(`Cannot derive subagent under D/F-colliding 4-segment card branch '${parentRef}'; migrate to '${parent.normalizedRef}'`);
    }
    const segErr = validateStrictSegment('subagent', slug);
    if (segErr) throw new Error(segErr);
    return `cell/${parent.cellId}/card/${parent.cardId}/sub/${slug}`;
  }
  throw new Error(`Branch '${parentRef}' (Tier ${parent.tier}) is terminal and cannot derive children`);
}

/**
 * Queries Git for the currently checked-out branch in a repository directory.
 *
 * @param {string} cwd - Repository working directory.
 * @returns {string|null} Current branch name, or null if detached.
 */
function getCurrentBranch(cwd) {
  const proc = spawnSync('git', ['symbolic-ref', '--quiet', 'HEAD'], {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (proc.status !== 0 || !proc.stdout) return null;
  return normalizeBranchName(proc.stdout.trim());
}

/**
 * Validates the currently active Git branch and emits `FGT-TOP-001` violation records if invalid.
 *
 * @param {string} repoRoot - Repository root path.
 * @param {string} [severity='BLOCK'] - Violation severity tag.
 * @returns {Array<{ruleId: string, severity: string, file: string, message: string}>} Violations list.
 */
function collectCurrentBranchViolation(repoRoot, severity = 'BLOCK') {
  const branch = getCurrentBranch(repoRoot);
  if (!branch) return [];
  const res = validateBranchName(branch);
  if (res.valid) return [];
  return [{
    ruleId: 'FGT-TOP-001',
    severity,
    file: '.git/HEAD',
    message: `当前活动分支 '${branch}' 违背工作区分支分类法规范！原因: ${res.error}`,
  }];
}

module.exports = {
  assertLegalFork,
  deriveChildBranch,
  getCurrentBranch,
  collectCurrentBranchViolation,
};
