/**
 * Module: Fractal Branch Taxonomy Parser and Segment Validator
 * File Path: scripts/common/lib/branch-taxonomy.js
 * Architecture Role: Core 5-tier workspace branch nomenclature classifier and
 *   strict kebab-case segment validator (`FGT-TOP-001` SSOT mirror).
 * Dependencies & Triggers: Pure JavaScript, zero external dependencies. Consumed
 *   by branch-inheritance, branch-policy-parity, and validate-branch-governance.
 * Responsibilities:
 *   1. Hold canonical cell whitelist, cell aliases, facade types, and trunk sets;
 *   2. Parse and classify branch refs across Tiers 0..4 and facade aliases;
 *   3. Reject scratch prefixes (`temp`/`tmp`/`wip`) and legacy D/F collisions.
 * Exit Semantics & Design Rationale: Pure functions returning structured
 *   classification objects; side-effect free for deterministic pre-commit checks.
 */

'use strict';

const CARD_CANONICAL_LEAF = 'main';
const MAX_BRANCH_SEGMENT_LEN = 63;

const RECOGNIZED_CELLS = Object.freeze([
  'auto-refactor',
  'fractal-git',
  'workspace-timing',
  'webgames',
  'infra',
  'governance',
  'core',
]);

const CELL_ALIASES = Object.freeze({
  'web-games': 'webgames',
  fractalgit: 'fractal-git',
  timing: 'workspace-timing',
});

const FACADE_TYPES = Object.freeze([
  'feat',
  'fix',
  'refactor',
  'perf',
  'docs',
  'test',
  'chore',
  'style',
  'ci',
  'build',
]);

const FORBIDDEN_BRANCH_PREFIXES = Object.freeze(['temp', 'tmp', 'wip']);
const PROTECTED_SYSTEM_TRUNKS = Object.freeze(['main', 'master']);
const PROTECTED_EXACT_BRANCHES = Object.freeze(['main', 'master', 'integration']);
const REF_HEADS_PREFIX = 'refs/heads/';
const REF_FRACTAL_PREFIX = 'refs/fractal/';
const KEBAB_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Normalizes a cell alias into its canonical workspace domain identifier.
 *
 * @param {string} rawCell - Domain cell name or alias.
 * @returns {string} Canonical cell identifier.
 */
function normalizeCellId(rawCell) {
  const trimmed = typeof rawCell === 'string' ? rawCell.trim() : '';
  return CELL_ALIASES[trimmed] || trimmed;
}

/**
 * Checks whether a branch name or coordinate segment uses a prohibited scratch prefix.
 *
 * @param {string} segment - Branch segment or full branch name.
 * @returns {boolean} True if segment matches temp/tmp/wip prefixes.
 */
function hasForbiddenBranchPrefix(segment) {
  const lower = String(segment || '').toLowerCase();
  for (const prefix of FORBIDDEN_BRANCH_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}-`) || lower.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Strips `refs/heads/` or `refs/fractal/` prefix if present.
 *
 * @param {string} rawRef - Full or short reference name.
 * @returns {string} Stripped branch name.
 */
function normalizeBranchName(rawRef) {
  if (typeof rawRef !== 'string') return '';
  const trimmed = rawRef.trim();
  if (trimmed.startsWith(REF_HEADS_PREFIX)) return trimmed.slice(REF_HEADS_PREFIX.length);
  if (trimmed.startsWith(REF_FRACTAL_PREFIX)) return trimmed.slice(REF_FRACTAL_PREFIX.length);
  return trimmed;
}

/**
 * Checks whether a branch is a protected system or domain integration branch.
 *
 * @param {string} rawRef - Branch name or full reference.
 * @returns {boolean} True if protected from deletion or non-fast-forward updates.
 */
function isProtectedBranch(rawRef) {
  const name = normalizeBranchName(rawRef);
  if (PROTECTED_EXACT_BRANCHES.includes(name)) return true;
  const cellMainMatch = /^cell\/([^/]+)\/main$/.exec(name);
  return Boolean(cellMainMatch && RECOGNIZED_CELLS.includes(cellMainMatch[1]));
}

function validateStrictSegment(role, segment) {
  if (typeof segment !== 'string' || segment.length === 0 || segment.length > MAX_BRANCH_SEGMENT_LEN) {
    return `Invalid ${role} '${segment}'; must be 1..=${MAX_BRANCH_SEGMENT_LEN} bytes`;
  }
  if (!KEBAB_REGEX.test(segment)) {
    return `Invalid ${role} ID '${segment}'; must be lowercase kebab-case`;
  }
  if (hasForbiddenBranchPrefix(segment)) {
    return `Forbidden scratch prefix in ${role} '${segment}'`;
  }
  return null;
}

function validateStrictCell(rawCell, contextLabel) {
  const segErr = validateStrictSegment('cell', rawCell);
  if (segErr) return segErr;
  if (RECOGNIZED_CELLS.includes(rawCell)) return null;
  const aliased = normalizeCellId(rawCell);
  if (aliased !== rawCell && RECOGNIZED_CELLS.includes(aliased)) {
    return `Use canonical domain cell '${aliased}' instead of alias '${rawCell}'${contextLabel ? ` (${contextLabel})` : ''}`;
  }
  return `Unrecognized domain cell '${rawCell}'${contextLabel ? ` in ${contextLabel}` : ''}. Allowed: ${RECOGNIZED_CELLS.join(', ')}`;
}

function parseCellSegments(name, segments, allowLegacyCard) {
  const cellId = segments[1];
  if (segments.length === 3 && segments[2] === 'main') {
    const cellErr = validateStrictCell(cellId, name);
    return cellErr ? { valid: false, tier: 2, normalizedRef: name, error: cellErr } : { valid: true, tier: 2, normalizedRef: name, cellId, isLegacyCardFormat: false };
  }
  if (segments.length === 5 && segments[2] === 'card' && segments[4] === CARD_CANONICAL_LEAF) {
    const cardId = segments[3];
    const err = validateStrictCell(cellId, name) || validateStrictSegment('card', cardId);
    return err ? { valid: false, tier: 3, normalizedRef: name, error: err } : { valid: true, tier: 3, normalizedRef: name, cellId, cardId, isLegacyCardFormat: false };
  }
  if (segments.length === 4 && segments[2] === 'card') {
    const cardId = segments[3];
    const err = validateStrictCell(cellId, name) || validateStrictSegment('card', cardId);
    if (err) return { valid: false, tier: 3, normalizedRef: name, error: err };
    const canonicalRef = `cell/${cellId}/card/${cardId}/${CARD_CANONICAL_LEAF}`;
    if (!allowLegacyCard) {
      return { valid: false, tier: 3, normalizedRef: canonicalRef, cellId, cardId, isLegacyCardFormat: true, error: `Legacy 4-segment card branch '${name}' causes D/F ref collisions; use '${canonicalRef}'` };
    }
    return { valid: true, tier: 3, normalizedRef: canonicalRef, cellId, cardId, isLegacyCardFormat: true };
  }
  if (segments.length === 6 && segments[2] === 'card' && segments[4] === 'sub') {
    const cardId = segments[3];
    const subId = segments[5];
    const err = validateStrictCell(cellId, name) || validateStrictSegment('card', cardId) || validateStrictSegment('subagent', subId);
    return err ? { valid: false, tier: 4, normalizedRef: name, error: err } : { valid: true, tier: 4, normalizedRef: name, cellId, cardId, subId, isLegacyCardFormat: false };
  }
  return null;
}

/**
 * Parses and validates a branch name against the 5-tier taxonomy.
 *
 * @param {string} rawRef - Branch name to evaluate.
 * @param {{allowLegacyCard?: boolean}} [options] - Optional parsing controls.
 * @returns {{valid: boolean, tier: number, normalizedRef: string, cellId?: string, cardId?: string, subId?: string, facadeType?: string, isLegacyCardFormat?: boolean, error?: string}} Verdict.
 */
function parseBranchTaxonomy(rawRef, options = {}) {
  const allowLegacyCard = options.allowLegacyCard !== false;
  const name = normalizeBranchName(rawRef);
  if (!name) return { valid: false, tier: -1, normalizedRef: '', error: 'Branch name is empty' };
  if (name.includes('//') || name.startsWith('/') || name.endsWith('/')) {
    return { valid: false, tier: -1, normalizedRef: name, error: 'Branch name contains leading, trailing, or double slashes' };
  }
  if (hasForbiddenBranchPrefix(name)) {
    return { valid: false, tier: -1, normalizedRef: name, error: `Forbidden ad-hoc temporary branch prefix: '${name}'` };
  }
  if (PROTECTED_SYSTEM_TRUNKS.includes(name)) return { valid: true, tier: 0, normalizedRef: name, isLegacyCardFormat: false };
  if (name === 'integration') return { valid: true, tier: 1, normalizedRef: name, isLegacyCardFormat: false };

  const segments = name.split('/');
  if (segments[0] === 'cell') {
    const cellResult = parseCellSegments(name, segments, allowLegacyCard);
    if (cellResult) return cellResult;
  }
  if (segments.length === 3 && FACADE_TYPES.includes(segments[0])) {
    const facadeType = segments[0];
    const cellId = segments[1];
    const desc = segments[2];
    const err = validateStrictCell(cellId, `facade '${name}'`) || validateStrictSegment('description', desc);
    if (err) return { valid: false, tier: 3, normalizedRef: name, error: err };
    const mappedCardId = `${facadeType}-${desc}`;
    return { valid: true, tier: 3, normalizedRef: `cell/${cellId}/card/${mappedCardId}/${CARD_CANONICAL_LEAF}`, cellId, cardId: mappedCardId, facadeType, isLegacyCardFormat: false };
  }
  return { valid: false, tier: -1, normalizedRef: name, error: `Branch '${name}' does not match any valid tier in the workspace taxonomy. Expected 'cell/<domain>/card/<id>/${CARD_CANONICAL_LEAF}', 'cell/<domain>/main', or '<type>/<domain>/<id>'` };
}

/**
 * Validates a single branch name and returns a compact structured verdict.
 *
 * @param {string} rawRef - Branch name.
 * @param {{allowLegacyCard?: boolean}} [options] - Optional parsing controls.
 * @returns {{valid: boolean, error?: string, tier?: number, normalizedRef?: string, isLegacyCardFormat?: boolean}}
 */
function validateBranchName(rawRef, options = {}) {
  const result = parseBranchTaxonomy(rawRef, options);
  return {
    valid: result.valid,
    ...(result.error ? { error: result.error } : {}),
    tier: result.tier,
    normalizedRef: result.normalizedRef,
    isLegacyCardFormat: Boolean(result.isLegacyCardFormat),
  };
}

module.exports = {
  CARD_CANONICAL_LEAF,
  MAX_BRANCH_SEGMENT_LEN,
  RECOGNIZED_CELLS,
  CELL_ALIASES,
  FACADE_TYPES,
  FORBIDDEN_BRANCH_PREFIXES,
  PROTECTED_SYSTEM_TRUNKS,
  normalizeCellId,
  hasForbiddenBranchPrefix,
  normalizeBranchName,
  isProtectedBranch,
  validateStrictSegment,
  validateStrictCell,
  parseBranchTaxonomy,
  validateBranchName,
};
