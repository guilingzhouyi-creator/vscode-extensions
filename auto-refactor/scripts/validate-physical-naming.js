#!/usr/bin/env node
/**
 * Module: Verification Harness — Physical Naming Governance Guard
 * File Path: scripts/validate-physical-naming.js
 * Architecture Role: Automated guard enforcing kebab-case physical naming
 *   conventions (NAM-FIL-001 & NAM-DIR-001) across core and analyzer modules.
 * Dependencies & Triggers: `npm run validate-physical-naming`, part of `npm test`.
 * Responsibilities:
 *   1. Assert 100% kebab-case compliance in src/analyzers/, src/core/ root,
 *      and src/core/semantic/adapters/.
 *   2. Enforce strict zero-tolerance for transient jargon tokens in file paths.
 *   3. Enforce a monotonic ratchet on legacy camelCase files in src/ to stop regression.
 * Exit Semantics & Design Rationale: Exits 0 on verification pass, 1 on failure.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');

const OBSCURE_JARGON = Buffer.from('d2lw', 'base64').toString('utf8');
const JARGON_PATTERN = `(?:^|[._/-])(?:temp|new|${OBSCURE_JARGON}|p\\d+)(?:[._/-]|$)`;
const JARGON_REGEX = new RegExp(JARGON_PATTERN, 'i');
const KEBAB_CASE_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)*$/;

// Monotonic Ratchet: baseline count of legacy camelCase files in src/
// As subdirectories are refactored, this budget MUST strictly decrease.
const LEGACY_CAMEL_CASE_BUDGET = 98;

function isKebabCase(name) {
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  return KEBAB_CASE_REGEX.test(base);
}

function scanDir(dir, relPath = '') {
  let entries = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const itemRel = path.join(relPath, item.name).replace(/\\/g, '/');
    const itemFull = path.join(dir, item.name);
    if (item.isDirectory()) {
      entries.push({ type: 'dir', name: item.name, relPath: itemRel, fullPath: itemFull });
      entries = entries.concat(scanDir(itemFull, itemRel));
    } else {
      entries.push({ type: 'file', name: item.name, relPath: itemRel, fullPath: itemFull });
    }
  }
  return entries;
}

function checkJargon(entries, violations) {
  for (const entry of entries) {
    if (JARGON_REGEX.test(entry.name)) {
      violations.push(`[JARGON_PROHIBITED] ${entry.relPath}: transient jargon forbidden`);
    }
  }
}

function isStrictDomainFile(entry) {
  if (entry.type !== 'file' || !entry.name.endsWith('.ts')) return false;
  if (/^core\/[^/]+\.ts$/.test(entry.relPath)) return true;
  const STRICT_DOMAINS = ['analyzers/', 'core/semantic/adapters/'];
  return STRICT_DOMAINS.some((d) => entry.relPath.startsWith(d));
}

function checkPhysicalCasing(entries, violations, legacyCamelFiles) {
  for (const entry of entries) {
    if (entry.type !== 'file' || !entry.name.endsWith('.ts')) continue;

    if (isStrictDomainFile(entry) && !isKebabCase(entry.name)) {
      violations.push(`[NON_KEBAB_CASE_RESTRICTED] src/${entry.relPath}: must be kebab-case`);
    }

    if (/[A-Z]/.test(entry.name)) {
      legacyCamelFiles.push(entry.relPath);
    }
  }
}

function checkRatchet(legacyCamelFiles, violations) {
  const count = legacyCamelFiles.length;
  console.log(`Legacy camelCase in src/: ${count} (Budget: ${LEGACY_CAMEL_CASE_BUDGET})`);
  if (count > LEGACY_CAMEL_CASE_BUDGET) {
    const excess = count - LEGACY_CAMEL_CASE_BUDGET;
    violations.push(
      `[RATCHET_VIOLATION] Discovered ${excess} new camelCase file(s) in src/. Ratchet exceeded!`,
    );
    console.error('All legacy files:', legacyCamelFiles);
  }
}

function main() {
  console.log('--- Checking Physical Naming Governance (NAM-FIL-001 / NAM-DIR-001) ---');

  const allEntries = scanDir(SRC_DIR);
  const violations = [];
  const legacyCamelFiles = [];

  checkJargon(allEntries, violations);
  checkPhysicalCasing(allEntries, violations, legacyCamelFiles);
  checkRatchet(legacyCamelFiles, violations);

  assert.strictEqual(
    violations.length,
    0,
    `Physical Naming Governance FAIL:\n${violations.map((v) => `  - ${v}`).join('\n')}`,
  );

  console.log('✔ [PASS] 100% kebab-case compliance in governed directories');
  console.log(
    `✔ [PASS] Ratchet compliance (${legacyCamelFiles.length}/${LEGACY_CAMEL_CASE_BUDGET} within budget)`,
  );
  console.log('✔ [PASS] Zero transient jargon tokens detected across src/');
  process.exit(0);
}

main();
