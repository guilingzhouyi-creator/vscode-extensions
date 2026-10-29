/**
 * Module: Test Pipeline — Standardized Regex Catalog (SSOT) & ReDoS Immunity Guard
 * File Path: scripts/validate-regex-ssot.js
 * Architecture Role: Architecture gate enforcing Single Source of Truth (SSOT),
 *     100% static ReDoS immunity, and zero-mutable-state discipline for regular expressions.
 * Dependencies & Triggers: Consumes dist/core/constants and dist/utils/safe-regex;
 *     executed in test-parallel runner.
 * Responsibilities:
 *   1. Assert 100% static ReDoS safety (auditRegexSafety / isRegexSafe) on all catalog patterns.
 *   2. Assert zero mutable state (/g or /y flags) on directly exported constant singletons.
 *   3. Assert deep immutability (Object.isFrozen) across all 6 semantic regex domains.
 *   4. Assert presence and naming consistency of scanner factory functions.
 * Exit Semantics & Design Rationale: Process exits 0 on complete compliance, 1 on any violation.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { REGEX } = require(path.join(ROOT, 'dist', 'core', 'constants'));
const { isRegexSafe, auditRegexSafety } = require(path.join(ROOT, 'dist', 'utils', 'safe-regex'));

function checkDomainImmutability() {
  console.log('1. Checking Domain Immutability and Structural Integrity...');

  assert.ok(REGEX, 'REGEX catalog facade must be exported from core/constants');
  assert.strictEqual(Object.isFrozen(REGEX), true, 'Master REGEX catalog facade must be deeply frozen');

  const requiredDomains = ['NAMING', 'SYNTAX', 'COMMENT', 'LITERAL', 'SHELL', 'SECURITY'];
  for (const domain of requiredDomains) {
    const domainObj = REGEX[domain];
    assert.ok(domainObj, `Domain REGEX.${domain} must be defined`);
    assert.strictEqual(
      Object.isFrozen(domainObj),
      true,
      `Domain REGEX.${domain} must be Object.freeze sealed`,
    );
  }

  console.log(`  ✔  All ${requiredDomains.length} domains present and tamper-proof sealed.`);
}

function validatePatternEntry(domainName, key, val) {
  if (typeof val === 'function') {
    if (!key.startsWith('create')) {
      return 'helper';
    }
    // Scanner factory function
    assert.ok(
      key.endsWith('Scanner'),
      `Scanner factory in ${domainName}.${key} must be named create*Scanner`,
    );
    const scannerInstance = val();
    assert.ok(
      scannerInstance instanceof RegExp,
      `Factory ${domainName}.${key}() must return a RegExp instance`,
    );

    // Factory instances are allowed to have /g, but must be fresh (lastIndex === 0)
    assert.strictEqual(
      scannerInstance.lastIndex,
      0,
      `Scanner instance from ${domainName}.${key}() must have pristine lastIndex = 0`,
    );

    // Assert ReDoS safety on factory pattern
    const safe = isRegexSafe(scannerInstance.source);
    const warnings = auditRegexSafety(scannerInstance.source);
    assert.ok(
      safe && warnings.length === 0,
      `Scanner pattern ${domainName}.${key} failed ReDoS safety check: ${warnings.join(', ')}`,
    );
    return 'scanner';
  }

  if (val instanceof RegExp) {
    // Direct constant pattern
    // CRITICAL CONTRACT: Direct constant patterns MUST be stateless (NO /g or /y)
    assert.strictEqual(
      val.global,
      false,
      `DIRECT EXPORT VIOLATION: Pattern ${domainName}.${key} has /g flag! Use create*Scanner() instead.`,
    );
    assert.strictEqual(
      val.sticky,
      false,
      `DIRECT EXPORT VIOLATION: Pattern ${domainName}.${key} has /y sticky flag!`,
    );

    // Assert ReDoS safety
    const safe = isRegexSafe(val.source);
    const warnings = auditRegexSafety(val.source);
    assert.ok(
      safe && warnings.length === 0,
      `Constant pattern ${domainName}.${key} failed ReDoS safety check: ${warnings.join(', ')}`,
    );
    return 'pattern';
  }

  if (typeof val === 'string') {
    return 'string';
  }

  assert.fail(`Unexpected export type in REGEX.${domainName}.${key}: ${typeof val}`);
}

function scanDomainEntries(domainName, domainObj) {
  let scanners = 0;
  let patterns = 0;
  for (const [key, val] of Object.entries(domainObj)) {
    const entryType = validatePatternEntry(domainName, key, val);
    scanners += entryType === 'scanner' ? 1 : 0;
    patterns += entryType === 'pattern' ? 1 : 0;
  }
  return { scanners, patterns };
}

function checkPatternSafetyAndStateDiscipline() {
  console.log('2. Checking ReDoS Immunity and Zero Mutable State Discipline...');

  let testedPatternsCount = 0;
  let testedScannersCount = 0;

  for (const [domainName, domainObj] of Object.entries(REGEX)) {
    const counts = scanDomainEntries(domainName, domainObj);
    testedScannersCount += counts.scanners;
    testedPatternsCount += counts.patterns;
  }

  assert.ok(
    testedPatternsCount >= 30,
    `Must audit at least 30 constant patterns (audited ${testedPatternsCount})`,
  );
  assert.ok(
    testedScannersCount >= 6,
    `Must audit at least 6 scanner factories (audited ${testedScannersCount})`,
  );

  console.log(`  ✔  Audited ${testedPatternsCount} stateless patterns: 100% ReDoS immune & state-leakage free.`);
  console.log(`  ✔  Audited ${testedScannersCount} scanner factories: verified deterministic pristine creation.`);
}

function runAudit() {
  console.log('=== Standardized Regex Catalog (SSOT) & ReDoS Immunity Audit ===');
  checkDomainImmutability();
  checkPatternSafetyAndStateDiscipline();
  console.log('✔  Standardized Regex Catalog gate passed completely.\n');
}

try {
  runAudit();
} catch (err) {
  console.error(`✖ BLOCK  ${err.message}`);
  process.exit(1);
}
