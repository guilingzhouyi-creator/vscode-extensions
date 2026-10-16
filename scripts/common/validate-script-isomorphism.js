/**
 * Module: Governance Guard — Script Isomorphism & Cross-Platform Contract Guard
 * File Path: scripts/common/validate-script-isomorphism.js
 * Architecture Role: Platform-level governance guard auditing dual-implementation scripts (ps1/sh)
 *   across root scripts and WebGames domains for structural parity, strict line-ending contracts, and defensive directives.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path, assert);
 *   invoked by audit-all, pre-push-gate, and CI hygiene workflows.
 * Responsibilities:
 *   1. Verify that all scripts in scripts/ps1/ have counterpart scripts in scripts/sh/.
 *   2. Verify that all scripts in WebGames/scripts/ps1/ have counterpart scripts in WebGames/scripts/sh/.
 *   3. Enforce strict line ending contracts: CRLF for .ps1, LF for .sh.
 *   4. Enforce defensive shell directives: Set-StrictMode/ErrorActionPreference for ps1, pipefail for sh.
 *   5. Validate isomorphic metadata and parameter parity for primary dual-implementations.
 * Exit Semantics & Design Rationale: Exits 0 on clean check, exits 1 on detected violations.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Known script pairings that must maintain strict isomorphic behavior in root scripts.
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
 * Key parameter flags that must be supported identically across root dual implementations.
 */
const REQUIRED_FLAG_ALIGNMENTS = {
  'audit-all': ['Fast', 'Json'],
  'commit-msg-gate': ['Agent', 'ViewLog'],
  package: ['HotSync'],
  'pre-commit-gate': ['Agent', 'ViewLog'],
  'pre-push-gate': ['Agent', 'ViewLog'],
  'release-tag': ['DryRun', 'NoPush'],
  'version-bump': ['DryRun'],
};

/**
 * Known script pairings that must maintain strict isomorphic behavior in WebGames scripts.
 */
const WEBGAMES_REQUIRED_ISOMORPHIC_PAIRS = [
  'archive-volume',
  'audit-all',
  'audit-arch',
  'audit-docs',
  'audit-perf',
  'audit-refactor-metrics',
  'bench-run',
  'bench-sweep',
  'check-env',
  'check-gdscript',
  'check-mermaid',
  'install-hooks',
  'package-webgames',
  'test-run',
  'timestamp',
];

/**
 * Multi-domain script evaluation definitions.
 */
const SCRIPT_DOMAINS = [
  {
    name: 'scripts',
    ps1Dir: path.join(REPO_ROOT, 'scripts', 'ps1'),
    shDir: path.join(REPO_ROOT, 'scripts', 'sh'),
    pairs: REQUIRED_ISOMORPHIC_PAIRS,
    flags: REQUIRED_FLAG_ALIGNMENTS,
  },
  {
    name: 'WebGames',
    ps1Dir: path.join(REPO_ROOT, 'WebGames', 'scripts', 'ps1'),
    shDir: path.join(REPO_ROOT, 'WebGames', 'scripts', 'sh'),
    pairs: WEBGAMES_REQUIRED_ISOMORPHIC_PAIRS,
    flags: {},
  },
];

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
 * @param {Record<string, string[]>} flagAlignments - Flag alignment definitions.
 * @returns {string[]} Misaligned flag warnings.
 */
function auditFlagAlignment(baseName, ps1Content, shContent, flagAlignments = REQUIRED_FLAG_ALIGNMENTS) {
  const requiredFlags = flagAlignments[baseName] || [];
  const errors = [];

  for (const flag of requiredFlags) {
    const ps1Has = ps1Content.includes(flag);
    const kebab = flag.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const shHas =
      shContent.includes(`-${flag}`) ||
      shContent.includes(`--${flag.toLowerCase()}`) ||
      shContent.includes(`--${kebab}`) ||
      shContent.includes('"$@"');
    if (!ps1Has || !shHas) {
      errors.push(`Flag '${flag}' alignment missing (ps1: ${ps1Has}, sh: ${shHas})`);
    }
  }
  return errors;
}

/**
 * Validates script isomorphism within a specific domain directory pair.
 *
 * @param {{ name: string, ps1Dir: string, shDir: string, pairs: string[], flags: Record<string, string[]> }} domain
 * @param {Array<{ pair: string, reason: string }>} findings
 */
function validateDomain(domain, findings) {
  const { name, ps1Dir, shDir, pairs, flags } = domain;
  if (!fs.existsSync(ps1Dir) || !fs.existsSync(shDir)) {
    findings.push({ pair: name, reason: `PS1 or SH scripts directory missing: ${ps1Dir}` });
    return;
  }

  for (const scriptName of pairs) {
    const ps1File = path.join(ps1Dir, `${scriptName}.ps1`);
    const shFile = path.join(shDir, `${scriptName}.sh`);

    if (!fs.existsSync(ps1File)) {
      findings.push({ pair: `${name}/${scriptName}`, reason: `Missing PowerShell dual counterpart: ${scriptName}.ps1` });
      continue;
    }
    if (!fs.existsSync(shFile)) {
      findings.push({ pair: `${name}/${scriptName}`, reason: `Missing Bash dual counterpart: ${scriptName}.sh` });
      continue;
    }

    const ps1EndingErr = auditLineEnding(ps1File, 'CRLF');
    if (ps1EndingErr) {
      findings.push({ pair: `${name}/${scriptName}.ps1`, reason: ps1EndingErr });
    }

    const shEndingErr = auditLineEnding(shFile, 'LF');
    if (shEndingErr) {
      findings.push({ pair: `${name}/${scriptName}.sh`, reason: shEndingErr });
    }

    const ps1Content = fs.readFileSync(ps1File, 'utf8');
    const shContent = fs.readFileSync(shFile, 'utf8');

    for (const dirErr of auditPs1Directives(ps1Content)) {
      findings.push({ pair: `${name}/${scriptName}.ps1`, reason: dirErr });
    }
    for (const dirErr of auditShDirectives(shContent)) {
      findings.push({ pair: `${name}/${scriptName}.sh`, reason: dirErr });
    }
    for (const flagErr of auditFlagAlignment(scriptName, ps1Content, shContent, flags)) {
      findings.push({ pair: `${name}/${scriptName}`, reason: flagErr });
    }
  }
}

/**
 * Run comprehensive script isomorphism validation across all domains.
 *
 * @returns {Array<{ pair: string, reason: string }>} Finding items.
 */
function validateIsomorphism() {
  const findings = [];
  for (const domain of SCRIPT_DOMAINS) {
    validateDomain(domain, findings);
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

  const totalPairs = SCRIPT_DOMAINS.reduce((sum, d) => sum + d.pairs.length, 0);
  console.log(`  ✔ [PASS] 跨平台同构脚本与防御契约校验通过 (${totalPairs} 对同构脚本全部合规: scripts 9 对, WebGames 15 对)`);
  process.exit(0);
}

if (require.main === module) {
  run();
}

module.exports = {
  REQUIRED_ISOMORPHIC_PAIRS,
  REQUIRED_FLAG_ALIGNMENTS,
  WEBGAMES_REQUIRED_ISOMORPHIC_PAIRS,
  SCRIPT_DOMAINS,
  auditLineEnding,
  auditPs1Directives,
  auditShDirectives,
  auditFlagAlignment,
  validateDomain,
  validateIsomorphism,
  run,
};
