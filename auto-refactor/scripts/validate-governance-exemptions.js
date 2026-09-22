#!/usr/bin/env node
/**
 * Module: Verification Harness — Governance Exemptions Ledger Guard
 * File Path: scripts/validate-governance-exemptions.js
 * Architecture Role: Validates the centralized governance exemption ledger (C-03, N-04, N-05).
 *   Enforces exact file paths (no globs), mandatory ownership, non-empty reasons, non-expired
 *   expiration timestamps, and strict prohibition of security family exemptions or inline
 *   self-exemptions.
 * Dependencies & Triggers: Run via `npm test` or `node scripts/validate-governance-exemptions.js`.
 * Responsibilities: Validate exemption ledger entries, path exactness, and absence of inline
 *   self-exemptions.
 * Exit Semantics & Design Rationale: Exits 0 on verification pass, 1 on failure.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEDGER_PATH = path.join(ROOT, 'governance-exemptions.json');

console.log('=== Validating Governance Exemptions Ledger (C-03, N-04, N-05) ===');

assert(fs.existsSync(LEDGER_PATH), `Exemption ledger must exist at ${LEDGER_PATH}`);

let exemptions;
try {
  exemptions = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
} catch (err) {
  console.error(`[FAIL] governance-exemptions.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

assert(Array.isArray(exemptions), 'governance-exemptions.json must be a JSON array');

const now = Date.now();
const GLOB_CHARS = /[*?{}\[\]]/;

for (let i = 0; i < exemptions.length; i++) {
  const item = exemptions[i];
  const idx = `Item #${i} (${item.ruleId || 'unknown'}:${item.file || 'unknown'})`;

  // 1. Mandatory fields (C-03)
  assert(item.ruleId && typeof item.ruleId === 'string', `${idx}: must have ruleId`);
  assert(item.file && typeof item.file === 'string', `${idx}: must have file`);
  assert(item.owner && typeof item.owner === 'string', `${idx}: must have owner`);
  assert(item.reason && typeof item.reason === 'string', `${idx}: must have reason`);
  assert(item.expiresAt && typeof item.expiresAt === 'string', `${idx}: must have expiresAt`);

  // 2. Exact file path only — globs strictly prohibited (C-03)
  assert(!GLOB_CHARS.test(item.file), `${idx}: globs are forbidden in file path: ${item.file}`);
  const targetFile = path.join(ROOT, item.file);
  assert(fs.existsSync(targetFile), `${idx}: exempted file does not exist on disk: ${item.file}`);

  // 3. Expiration date check (C-03)
  const expTime = Date.parse(item.expiresAt);
  assert(
    !Number.isNaN(expTime),
    `${idx}: invalid ISO date format for expiresAt: ${item.expiresAt}`,
  );
  assert(
    expTime > now,
    `${idx}: exemption expired on ${item.expiresAt} (current time: ${new Date(now).toISOString()})`,
  );

  // 4. Security family prohibition (N-05: security rules cannot be exempted or downgraded)
  const isSecurityRule = /^SEC-|^secret-|^secrets/i.test(item.ruleId);
  assert(
    !isSecurityRule,
    `${idx}: security family rules (SEC-*) are strictly prohibited from exemption`,
  );
}

console.log(
  `✓ Ledger format, expiration, and exact-path assertions passed (${exemptions.length} exemptions recorded)`,
);

// 5. Check for prohibited inline self-exemptions in source files (N-04)
const INLINE_EXEMPTION_PATTERN =
  /(?:#|\/\/|\/\*)\s*(?:allow-root|bypass-security|skip-gate|allow-unsafe|no-audit)\b/i;
const SRC_DIR = path.join(ROOT, 'src');

function inspectFileForInlineExemptions(filePath, violations) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    if (INLINE_EXEMPTION_PATTERN.test(lines[lineNum])) {
      violations.push(`${path.relative(ROOT, filePath)}:${lineNum + 1}: ${lines[lineNum].trim()}`);
    }
  }
}

function scanForInlineExemptions(dir, violations = []) {
  if (!fs.existsSync(dir)) return violations;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanForInlineExemptions(full, violations);
    } else if (/\.(ts|js|json|md)$/.test(entry.name)) {
      inspectFileForInlineExemptions(full, violations);
    }
  }
  return violations;
}

const inlineViolations = scanForInlineExemptions(SRC_DIR);
if (inlineViolations.length > 0) {
  console.error('[FAIL] Prohibited inline self-exemptions detected (N-04):');
  for (const v of inlineViolations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log('✓ Zero prohibited inline self-exemptions detected in src/ (N-04)');
console.log('[PASS] validate-governance-exemptions passed all checks.');
process.exit(0);
