/**
 * Module: Cross-Language Branch Policy SSOT Parity Verifier
 * File Path: scripts/common/lib/branch-policy-parity.js
 * Architecture Role: Ensures JS gate constants, Rust `fg-core/src/constants/branch.rs`,
 *   and TypeScript `fractal-git/ts/constants.ts` remain locked in 100% agreement.
 * Dependencies & Triggers: Node.js `fs`/`path` and `./branch-taxonomy`. Invoked via
 *   `validate-branch-governance.js --check-policy-parity`.
 * Responsibilities:
 *   1. Extract constant blocks from Rust and TS source files without external parsers;
 *   2. Compare recognized cells, aliases, facade types, scratch prefixes, and vault names;
 *   3. Enforce singular `refs/fractal/cell/` prefix migration on the TS facade.
 * Exit Semantics & Design Rationale: Returns `{valid, diffs}` so callers or CLI
 *   can inspect exact mismatched symbols before failing closed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  CARD_CANONICAL_LEAF,
  MAX_BRANCH_SEGMENT_LEN,
  RECOGNIZED_CELLS,
  CELL_ALIASES,
  FACADE_TYPES,
  FORBIDDEN_BRANCH_PREFIXES,
  PROTECTED_SYSTEM_TRUNKS,
} = require('./branch-taxonomy');

function extractConstBlock(source, startPattern, endChar) {
  const match = startPattern.exec(source);
  if (!match) return null;
  const startIdx = match.index + match[0].length;
  const endIdx = source.indexOf(endChar, startIdx);
  return endIdx === -1 ? null : source.slice(startIdx, endIdx);
}

function extractStringList(block) {
  const items = [];
  const re = /['"]([^'"]+)['"]/g;
  let match = re.exec(block);
  while (match) {
    items.push(match[1]);
    match = re.exec(block);
  }
  return items;
}

function extractAliasPairs(block) {
  const map = {};
  const re = /['"]?([a-z0-9-]+)['"]?\s*(?:,|=>|:)\s*['"]([a-z0-9-]+)['"]/g;
  let match = re.exec(block);
  while (match) {
    map[match[1]] = match[2];
    match = re.exec(block);
  }
  return map;
}

function listsEqual(left, right) {
  return left.length === right.length && left.every((val, idx) => val === right[idx]);
}

function compareConstantLists(label, src, isRust, diffs) {
  const specs = [
    { name: 'RECOGNIZED_CELLS', expected: RECOGNIZED_CELLS, rsRe: /pub const RECOGNIZED_CELLS[^=]+=\s*\[/, tsRe: /export const RECOGNIZED_CELLS[^=]+=\s*Object\.freeze\(\[/, end: ']' },
    { name: 'FACADE_TYPES', expected: FACADE_TYPES, rsRe: /pub const FACADE_TYPES[^=]+=\s*\[/, tsRe: /export const FACADE_TYPES[^=]+=\s*Object\.freeze\(\[/, end: ']' },
    { name: 'FORBIDDEN_BRANCH_PREFIXES', expected: FORBIDDEN_BRANCH_PREFIXES, rsRe: /pub const FORBIDDEN_BRANCH_PREFIXES[^=]+=\s*\[/, tsRe: /export const FORBIDDEN_BRANCH_PREFIXES[^=]+=\s*Object\.freeze\(\[/, end: ']' },
    { name: 'PROTECTED_SYSTEM_TRUNKS', expected: PROTECTED_SYSTEM_TRUNKS, rsRe: /pub const PROTECTED_SYSTEM_TRUNKS[^=]+=\s*\[/, tsRe: /export const PROTECTED_SYSTEM_TRUNKS[^=]+=\s*Object\.freeze\(\[/, end: ']' },
  ];
  for (const spec of specs) {
    const block = extractConstBlock(src, isRust ? spec.rsRe : spec.tsRe, spec.end);
    if (!block) {
      diffs.push(`${label}: missing ${spec.name}`);
      continue;
    }
    const found = extractStringList(block);
    if (!listsEqual(found, spec.expected)) {
      diffs.push(`${label}: ${spec.name} drift (${found.join(',')} vs ${spec.expected.join(',')})`);
    }
  }
}

function compareAliasMap(label, src, isRust, diffs) {
  const aliasBlock = extractConstBlock(
    src,
    isRust ? /pub const CELL_ALIASES[^=]+=\s*\[/ : /export const CELL_ALIASES[^=]+=\s*Object\.freeze\(\{/,
    isRust ? ']' : '}',
  );
  if (!aliasBlock) {
    diffs.push(`${label}: missing CELL_ALIASES`);
    return;
  }
  const parsedAliases = extractAliasPairs(aliasBlock);
  for (const [k, v] of Object.entries(CELL_ALIASES)) {
    if (parsedAliases[k] !== v) diffs.push(`${label}: CELL_ALIASES['${k}'] mismatch`);
  }
  if (Object.keys(parsedAliases).length !== Object.keys(CELL_ALIASES).length) {
    diffs.push(`${label}: CELL_ALIASES key count mismatch`);
  }
}

function compareScalarConstants(label, src, isRust, diffs) {
  const leafRe = isRust ? /pub const CARD_CANONICAL_LEAF[^=]+=\s*["']([^"']+)["']/ : /CARD_CANONICAL_LEAF:\s*['"]([^'"]+)['"]/;
  const lenRe = isRust ? /pub const MAX_BRANCH_SEGMENT_LEN:\s*usize\s*=\s*(\d+)/ : /export const MAX_BRANCH_SEGMENT_LEN\s*=\s*(\d+)/;
  const leafMatch = leafRe.exec(src);
  if (!leafMatch || leafMatch[1] !== CARD_CANONICAL_LEAF) diffs.push(`${label}: CARD_CANONICAL_LEAF mismatch`);
  const lenMatch = lenRe.exec(src);
  if (!lenMatch || Number(lenMatch[1]) !== MAX_BRANCH_SEGMENT_LEN) diffs.push(`${label}: MAX_BRANCH_SEGMENT_LEN mismatch`);
}

function compareConstantSource(label, src, isRust, diffs) {
  compareConstantLists(label, src, isRust, diffs);
  compareAliasMap(label, src, isRust, diffs);
  compareScalarConstants(label, src, isRust, diffs);
}

/**
 * Verifies cross-language SSOT parity across JS gate, Rust `fg-core`, and TypeScript `ts/constants.ts`.
 *
 * @param {string} [repoRoot] - Repository root path.
 * @returns {{valid: boolean, diffs: string[]}} Parity verdict.
 */
function checkPolicyParity(repoRoot = path.resolve(__dirname, '..', '..', '..')) {
  const rustPath = path.join(repoRoot, 'fractal-git', 'crates', 'fg-core', 'src', 'constants', 'branch.rs');
  const tsPath = path.join(repoRoot, 'fractal-git', 'ts', 'constants.ts');
  const diffs = [];
  if (!fs.existsSync(rustPath)) return { valid: false, diffs: [`Missing Rust SSOT file: ${rustPath}`] };
  if (!fs.existsSync(tsPath)) return { valid: false, diffs: [`Missing TS mirror file: ${tsPath}`] };
  const rustSrc = fs.readFileSync(rustPath, 'utf8');
  const tsSrc = fs.readFileSync(tsPath, 'utf8');
  compareConstantSource('Rust(fg-core)', rustSrc, true, diffs);
  compareConstantSource('TS(ts/constants.ts)', tsSrc, false, diffs);
  if (!/CELL_PREFIX:\s*['"]refs\/fractal\/cell\/['"]/.test(tsSrc) || tsSrc.includes('CELLS_PREFIX')) {
    diffs.push("TS(ts/constants.ts): CELL_PREFIX must be singular 'refs/fractal/cell/' without CELLS_PREFIX");
  }
  if (!rustSrc.includes('".taxis-policy.txp"') || !rustSrc.includes('".taxis-policy.seal"')) {
    diffs.push('Rust(fg-core): missing hidden binary vault filenames (.taxis-policy.txp / .taxis-policy.seal)');
  }
  return { valid: diffs.length === 0, diffs };
}

module.exports = { checkPolicyParity };
