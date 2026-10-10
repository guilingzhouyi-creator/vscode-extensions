/**
 * Module: Governance Guard — Script Isomorphism & Cross-Platform Contract Guard
 * File Path: scripts/common/validate-script-isomorphism.js
 * Architecture Role: Platform-level governance guard auditing dual-implementation scripts (ps1/sh)
 *   for structural parity, strict line-ending contracts, and defensive directives.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path, assert);
 *   invoked by audit-all, pre-push-gate, and CI hygiene workflows.
 * Responsibilities:
 *   1. Verify that all scripts in scripts/ps1/ have counterpart scripts in scripts/sh/.
 *   2. Enforce strict line ending contracts: CRLF for .ps1, LF for .sh.
 *   3. Enforce defensive shell directives: Set-StrictMode/ErrorActionPreference for ps1, pipefail for sh.
 *   4. Validate isomorphic metadata and parameter parity for primary dual-implementations.
 * Exit Semantics & Design Rationale: Exits 0 on clean check, exits 1 on detected violations.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PS1_DIR = path.join(REPO_ROOT, 'scripts', 'ps1');
const SH_DIR = path.join(REPO_ROOT, 'scripts', 'sh');

/**
 * Known script pairings that must maintain strict isomorphic behavior.
 */
const REQUIRED_ISOMORPHIC_PAIRS = [
  'audit-all',
  'check-display-assets',
  'commit-msg-gate',
  'install-hooks',
  'package',
  'pre-commit-gate',
  'pre-push-gate',
  'release-tag',
  'version-bump',
];

/**
 * Key parameter flags that must be supported identically across dual implementations.
 */
const REQUIRED_FLAG_ALIGNMENTS = {
  'audit-all': ['Fast', 'Json'],
  package: ['HotSync'],
  'release-tag': ['DryRun', 'NoPush'],
  'version-bump': ['DryRun'],
};

/**
 * Audit line-ending contract for a given file.
 *
 * @param {string} filePath - Absolute path to script.
 * @param {string} expectedEnding - 'CRLF' or 'LF'.
 * @returns {string|null} Error reason or null if clean.
 */
function auditLineEnding(filePath, expectedEnding) {
  const buf = fs.readFileSync(filePath);
  const content = buf.toString('utf8');
  const hasCRLF = content.includes('\r\n');

  if (expectedEnding === 'CRLF' && !hasCRLF) {
    return 'Expected CRLF line endings on disk, found LF';
  }
  if (expectedEnding === 'LF' && hasCRLF) {
    return 'Expected LF line endings on disk, found CRLF';
  }
  return null;
}

/**
 * Audit PowerShell defensive execution directives.
 *
 * @param {string} content - Script text.
 * @returns {string[]} Missing directive list.
 */
function auditPs1Directives(content) {
  const missing = [];
  if (!content.includes('Set-StrictMode')) {
    missing.push("Missing 'Set-StrictMode -Version Latest'");
  }
  if (!content.includes('ErrorActionPreference')) {
    missing.push("Missing '$ErrorActionPreference = Stop'");
  }
  return missing;
}

/**
 * Audit Bash defensive execution directives.
 *
 * @param {string} content - Script text.
 * @returns {string[]} Missing directive list.
 */
function auditShDirectives(content) {
  const missing = [];
  if (!content.startsWith('#!/usr/bin/env bash') && !content.startsWith('#!/bin/bash')) {
    missing.push('Missing Bash shebang');
  }
  if (!content.includes('pipefail')) {
    missing.push("Missing 'pipefail' in defensive options");
  }
  return missing;
}

/**
 * Audit parameter flag parity between dual implementations.
 *
 * @param {string} baseName - Base name of script pair.
 * @param {string} ps1Content - PowerShell script content.
 * @param {string} shContent - Bash script content.
 * @returns {string[]} Misaligned flag warnings.
 */
function auditFlagAlignment(baseName, ps1Content, shContent) {
  const requiredFlags = REQUIRED_FLAG_ALIGNMENTS[baseName] || [];
  const errors = [];

  for (const flag of requiredFlags) {
    const ps1Has = ps1Content.includes(flag);
    const kebab = flag.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const shHas =
      shContent.includes(`-${flag}`) ||
      shContent.includes(`--${flag.toLowerCase()}`) ||
      shContent.includes(`--${kebab}`);
    if (!ps1Has || !shHas) {
      errors.push(`Flag '${flag}' alignment missing (ps1: ${ps1Has}, sh: ${shHas})`);
    }
  }
  return errors;
}

/**
 * Run comprehensive script isomorphism validation.
 *
 * @returns {Array<{ pair: string, reason: string }>} Finding items.
 */
function validateIsomorphism() {
  const findings = [];

  if (!fs.existsSync(PS1_DIR) || !fs.existsSync(SH_DIR)) {
    findings.push({ pair: 'scripts', reason: 'PS1 or SH scripts directory missing' });
    return findings;
  }

  for (const name of REQUIRED_ISOMORPHIC_PAIRS) {
    const ps1File = path.join(PS1_DIR, `${name}.ps1`);
    const shFile = path.join(SH_DIR, `${name}.sh`);

    if (!fs.existsSync(ps1File)) {
      findings.push({ pair: name, reason: `Missing PowerShell dual counterpart: ${name}.ps1` });
      continue;
    }
    if (!fs.existsSync(shFile)) {
      findings.push({ pair: name, reason: `Missing Bash dual counterpart: ${name}.sh` });
      continue;
    }

    const ps1EndingErr = auditLineEnding(ps1File, 'CRLF');
    if (ps1EndingErr) {
      findings.push({ pair: `${name}.ps1`, reason: ps1EndingErr });
    }

    const shEndingErr = auditLineEnding(shFile, 'LF');
    if (shEndingErr) {
      findings.push({ pair: `${name}.sh`, reason: shEndingErr });
    }

    const ps1Content = fs.readFileSync(ps1File, 'utf8');
    const shContent = fs.readFileSync(shFile, 'utf8');

    for (const dirErr of auditPs1Directives(ps1Content)) {
      findings.push({ pair: `${name}.ps1`, reason: dirErr });
    }
    for (const dirErr of auditShDirectives(shContent)) {
      findings.push({ pair: `${name}.sh`, reason: dirErr });
    }
    for (const flagErr of auditFlagAlignment(name, ps1Content, shContent)) {
      findings.push({ pair: name, reason: flagErr });
    }
  }

  return findings;
}

/**
 * CLI execution entrypoint.
 */
function run() {
  const findings = validateIsomorphism();

  if (findings.length > 0) {
    console.error(`\n❌ [FAIL] 发现 ${findings.length} 处跨平台同构脚本或防御契约违规:`);
    for (const f of findings) {
      console.error(`  - [${f.pair}] ${f.reason}`);
    }
    process.exit(1);
  }

  console.log(`  ✔ [PASS] 跨平台同构脚本与防御契约校验通过 (${REQUIRED_ISOMORPHIC_PAIRS.length} 对同构脚本全部合规)`);
  process.exit(0);
}

if (require.main === module) {
  run();
}

module.exports = {
  REQUIRED_ISOMORPHIC_PAIRS,
  REQUIRED_FLAG_ALIGNMENTS,
  auditLineEnding,
  auditPs1Directives,
  auditShDirectives,
  auditFlagAlignment,
  validateIsomorphism,
  run,
};
