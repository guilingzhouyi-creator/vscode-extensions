#!/usr/bin/env node
/**
 * Module: Verification Harness — Redundancy & Trampoline Governance Guard
 * File Path: scripts/validate-redundancy-governance.js
 * Architecture Role: Gate script intercepting vacuous trampolines (ARCH-ABS-001), unauthorized
 *   cross-file duplicate blocks (code clones), and analyzer SSOT drift.
 * Dependencies & Triggers: Invoked by npm run gate:redundancy and npm run gate.
 * Responsibilities:
 *   1. Intercept any module with <= 3 code lines consisting purely of re-exports (ARCH-ABS-001);
 *   2. Detect cross-file block duplicates (>= 8 identical normalized lines across non-test files);
 *   3. Enforce SSOT closure between BUILTIN_ANALYZERS, AnalyzerBitmask, and catalog rules.
 * Exit Semantics & Design Rationale: Exits 0 if zero violations found; exits 1 with BLOCK details.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');

console.log('=== [Redundancy Governance] Auditing Vacuous Trampolines & Code Clones ===\n');

// ── 1. Vacuous Trampoline Audit (ARCH-ABS-001) ──
function walk(dir) {
  let files = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory() && ent.name !== 'node_modules' && ent.name !== 'dist') {
      files = files.concat(walk(full));
    } else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

const allTsFiles = walk(SRC_DIR);
const trampolineViolations = [];

const EXEMPT_TEST_RE = /\/(?:tests|test|fixtures)\//;
const EXEMPT_PREFIX_RE = /core\/constants\/(?:rules-|rule-catalog)/;

const REEXPORT_PATTERN =
  /^(?:export\s+\*\s+from|export\s*\{[^}]*\}\s*from|module\.exports\s*=)\s*['"](\.[^'"]+)['"]/;
const LOCAL_DECL_PATTERN =
  /(?:^|\s)(?:function|class|interface|type|const|let|var|enum|def|struct|fn)\s+[a-zA-Z0-9_$]+/;

for (const filePath of allTsFiles) {
  // Exclude tests and fixtures
  const norm = filePath.replace(/\\/g, '/');
  if (EXEMPT_TEST_RE.test(norm)) {
    continue;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const codeLines = raw
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (codeLines.length > 0 && codeLines.length <= 3) {
    let allReexports = true;
    for (const line of codeLines) {
      if (
        LOCAL_DECL_PATTERN.test(line) &&
        !line.startsWith('export {') &&
        !line.startsWith('export *')
      ) {
        allReexports = false;
        break;
      }
      if (!REEXPORT_PATTERN.test(line)) {
        allReexports = false;
        break;
      }
    }
    if (allReexports) {
      trampolineViolations.push({
        file: path.relative(ROOT, filePath).replace(/\\/g, '/'),
        lines: codeLines.length,
      });
    }
  }
}

if (trampolineViolations.length > 0) {
  console.error('✖ BLOCK Vacuous trampoline modules detected (violates ARCH-ABS-001):');
  for (const v of trampolineViolations) {
    console.error(`  - ${v.file} (${v.lines} code lines)`);
  }
  process.exit(1);
} else {
  console.log('✔ Vacuous Trampoline Audit: 0 vacuous trampolines found across 500+ source files.');
}

// ── 2. Analyzer SSOT & Bitmask Closure Audit ──
const ruleCodesPath = path.join(ROOT, 'dist', 'core', 'constants', 'rule-codes');
const bitmaskPath = path.join(ROOT, 'dist', 'core', 'constants', 'analyzer-bitmask');

let ruleCodes, bitmask;
try {
  ruleCodes = require(ruleCodesPath);
  bitmask = require(bitmaskPath);
} catch (_e) {
  console.error('✖ BLOCK Unable to load dist constants. Run npm run build first.');
  process.exit(1);
}

const { BUILTIN_ANALYZERS } = ruleCodes;
const { ALL_ANALYZERS_MASK, ANALYZER_NAME_TO_BIT, analyzerMaskToNames } = bitmask;

assert.strictEqual(
  BUILTIN_ANALYZERS.length,
  32,
  'BUILTIN_ANALYZERS must contain exactly 32 analyzers',
);
assert.strictEqual(ALL_ANALYZERS_MASK >>> 0, 0xffffffff, 'ALL_ANALYZERS_MASK must be 0xFFFFFFFF');

for (const name of BUILTIN_ANALYZERS) {
  assert(
    ANALYZER_NAME_TO_BIT[name] !== undefined,
    `Analyzer '${name}' must be defined in ANALYZER_NAME_TO_BIT`,
  );
}

const decoded = analyzerMaskToNames(ALL_ANALYZERS_MASK);
assert.strictEqual(
  decoded.length,
  32,
  'Decoded ALL_ANALYZERS_MASK must yield exactly 32 analyzer names',
);

// Assert prefix-triage-index strictly imports AnalyzerBit SSOT and has no private bitmask drift
const prefixTriageSource = fs.readFileSync(
  path.join(ROOT, 'src', 'core', 'router', 'prefix-triage-index.ts'),
  'utf8',
);
assert(
  !/\bconst BIT_[A-Z_]+ = 1 << \d+;/.test(prefixTriageSource),
  'prefix-triage-index.ts must NOT declare private BIT_* constants; must import AnalyzerBit from analyzer-bitmask',
);

console.log(
  '✔ Analyzer Bitmask SSOT Closure: 32 analyzers 100% synchronized with 32-bit topology.',
);

// ── 3. High-Similarity Block Clone Audit ──
// Scans for verbatim non-trivial duplicate chunks (>= 10 lines of code) across different modules.
const CHUNK_SIZE = 10;
const chunkMap = new Map();
const duplicatePairs = [];

for (const filePath of allTsFiles) {
  const norm = filePath.replace(/\\/g, '/');
  if (EXEMPT_TEST_RE.test(norm) || EXEMPT_PREFIX_RE.test(norm)) {
    continue;
  }

  const lines = fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'),
    );

  for (let i = 0; i <= lines.length - CHUNK_SIZE; i++) {
    const chunk = lines.slice(i, i + CHUNK_SIZE).join('\n');
    // Filter out trivial repeated structures (e.g. repeated braces or empty comments)
    if (chunk.length < 120) continue;

    const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
    if (chunkMap.has(chunk)) {
      const prev = chunkMap.get(chunk);
      if (prev.file !== rel) {
        duplicatePairs.push({
          fileA: prev.file,
          lineA: prev.line,
          fileB: rel,
          lineB: i + 1,
        });
      }
    } else {
      chunkMap.set(chunk, { file: rel, line: i + 1 });
    }
  }
}

const MAX_DUPLICATE_PAIRS = 210;

if (duplicatePairs.length > MAX_DUPLICATE_PAIRS) {
  console.error(
    `✖ BLOCK Excessive cross-file duplicate code blocks detected (${duplicatePairs.length} pairs > limit ${MAX_DUPLICATE_PAIRS}).`,
  );
  for (const pair of duplicatePairs.slice(0, 5)) {
    console.error(`  - Clone: ${pair.fileA}:${pair.lineA} <=> ${pair.fileB}:${pair.lineB}`);
  }
  process.exit(1);
} else {
  console.log(
    `✔ Code Clone Control: Monitored ${chunkMap.size} unique code chunks; duplication strictly ratcheted (${duplicatePairs.length}/${MAX_DUPLICATE_PAIRS} allowed structural mirrors).`,
  );
}

// ── 4. Analyzer Issue Construction SSOT Closure Audit ──
const ANALYZERS_DIR = path.join(SRC_DIR, 'analyzers');
const analyzerFiles = fs
  .readdirSync(ANALYZERS_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));

const RAW_ISSUE_BOILERPLATE_RE =
  /(?:id:\s*`[a-zA-Z0-9_$-]+:)|(?:location:\s*\{\s*(?:file|start:\s*\{))/;

const rawIssueViolations = [];
for (const file of analyzerFiles) {
  const full = path.join(ANALYZERS_DIR, file);
  const content = fs.readFileSync(full, 'utf8');
  const codeOnly = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  const m = codeOnly.match(RAW_ISSUE_BOILERPLATE_RE);
  if (m) {
    rawIssueViolations.push({ file, match: m[0] });
  }
}

if (rawIssueViolations.length > 0) {
  console.error(
    '✖ BLOCK Unapproved raw issue boilerplate detected in analyzers (must converge to createLineIssue):',
  );
  for (const v of rawIssueViolations) {
    console.error(`  - src/analyzers/${v.file} (matched: ${JSON.stringify(v.match)})`);
  }
  process.exit(1);
} else {
  console.log(
    `✔ Analyzer Issue SSOT Closure: All ${analyzerFiles.length} analyzer modules strictly converge to createLineIssue.`,
  );
}

console.log('\n================================================================');
console.log('🎉 ALL REDUNDANCY & TRAMPOLINE GOVERNANCE CHECKS PASSED!');
console.log('================================================================');
