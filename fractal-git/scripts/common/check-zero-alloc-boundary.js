/**
 * Module: Fractal Git — Zero-Allocation & Rust Concurrency Safety Scanner
 * File Path: fractal-git/scripts/common/check-zero-alloc-boundary.js
 * Architecture Role: Statically inspects Rust micro-crate sources to enforce zero transient heap
 *   allocations in hot loops (ADV-PRF-002), zero naked unwraps (FGT-ERR-001),
 *   and documented unsafe proofs (FGT-SAF-001).
 * Dependencies & Triggers: Scans every .rs file under crates/ (skipping target/ and tests/);
 *   invoked by CI, audit-all.ps1, and the fractal-git gate.
 * Responsibilities:
 *   1. Traverse Rust source files in production micro-crates, skipping both tests/ trees and
 *      in-file #[cfg(test)] modules, where panic! is the idiomatic assertion failure channel;
 *   2. Detect transient heap allocation patterns inside loop blocks (FGT-PRF-001);
 *   3. Enforce strong-typed error propagation by flagging unwrap/expect/panic (FGT-ERR-001);
 *   4. Require safety documentation comments for all unsafe blocks (FGT-SAF-001);
 *   5. Enforce Rustdoc coverage on public items (CMT-DOC-001);
 *   6. Guard against vague identifiers (NAM-VAG-001) and forbidden jargon (CMT-JRG-001).
 * Exit Semantics & Design Rationale: Exits 0 on clean code, 1 on critical violation;
 *   adheres to CC <= 15, Depth <= 4, and zero false claims.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CRATES_DIR = path.join(PROJECT_ROOT, 'crates');

const RE_LOOP_START = /^\s*(?:for\b|while\b|loop\b)/;
const RE_TRANSIENT_ALLOC =
  /\b(?:Vec::new|\.to_string\(\)|\.to_owned\(\)|format!|String::from|Box::new)\b/;
const RE_UNWRAP_EXPECT = /\.(?:unwrap|expect)\s*\(/;
const RE_PANIC_MACRO = /\b(?:panic!|todo!|unimplemented!)\s*\(/;
const RE_TEST_ATTR = /^\s*#\[cfg\(test\)\]/;
const RE_MOD_OPEN = /\bmod\s+[A-Za-z0-9_]+\s*\{/;

/**
 * Counts net brace openings on a single line.
 *
 * @param {string} line - Source line.
 * @returns {number} Open minus close brace count.
 */
function braceDelta(line) {
  const opens = (line.match(/\{/g) || []).length;
  const closes = (line.match(/\}/g) || []).length;
  return opens - closes;
}

/**
 * Advances the #[cfg(test)] module tracker by one line.
 *
 * @param {{ pendingTestAttr: boolean, inTestModule: boolean, testDepth: number }} state - State.
 * @param {string} trimmed - Trimmed source line.
 */
function advanceTestModuleState(state, trimmed) {
  if (state.inTestModule) {
    state.testDepth += braceDelta(trimmed);
    if (state.testDepth <= 0) {
      state.inTestModule = false;
      state.testDepth = 0;
    }
    return;
  }
  if (RE_TEST_ATTR.test(trimmed)) {
    state.pendingTestAttr = true;
    return;
  }
  if (!state.pendingTestAttr) return;
  if (trimmed.startsWith('#[')) return;
  state.pendingTestAttr = false;
  if (!RE_MOD_OPEN.test(trimmed) && !/\bfn\s+[A-Za-z0-9_]+/.test(trimmed)) return;
  state.inTestModule = true;
  state.testDepth = braceDelta(trimmed);
}

/**
 * Appends production error-propagation violations for one line (FGT-ERR-001).
 *
 * @param {string} line - Raw source line.
 * @param {{ relPath: string, lineNum: number, isProduction: boolean }} ctx - Per-line context.
 * @param {string[]} violations - Mutable collector.
 */
function checkErrorPropagation(line, ctx, violations) {
  if (!ctx.isProduction) return;
  if (RE_PANIC_MACRO.test(line)) {
    violations.push(
      `FGT-ERR-001: Explicit panic/placeholder macro at ${ctx.relPath}:${ctx.lineNum}`,
    );
  }
  if (RE_UNWRAP_EXPECT.test(line)) {
    violations.push(
      `FGT-ERR-001: Naked unwrap/expect in production code at ${ctx.relPath}:${ctx.lineNum}`,
    );
  }
}

/**
 * Tracks loop nesting and flags transient heap allocations inside loops (FGT-PRF-001).
 *
 * @param {string} line - Raw source line.
 * @param {string} trimmed - Trimmed source line.
 * @param {{ relPath: string, lineNum: number, isComment: boolean }} ctx - Per-line context.
 * @param {{ inLoopBlock: boolean, loopBraceDepth: number }} state - Mutable loop tracker.
 * @param {string[]} violations - Mutable collector.
 */
function checkLoopAllocation(line, trimmed, ctx, state, violations) {
  if (RE_LOOP_START.test(trimmed)) state.inLoopBlock = true;
  if (!state.inLoopBlock) return;
  state.loopBraceDepth += braceDelta(line);
  if (!ctx.isComment && RE_TRANSIENT_ALLOC.test(line)) {
    violations.push(
      `FGT-PRF-001: Transient heap allocation inside loop at ${ctx.relPath}:${ctx.lineNum}`,
    );
  }
  if (state.loopBraceDepth > 0) return;
  state.inLoopBlock = false;
  state.loopBraceDepth = 0;
}

/**
 * Requires a preceding proof comment on every unsafe block (FGT-SAF-001).
 *
 * @param {string} trimmed - Trimmed source line.
 * @param {{ relPath: string, lineNum: number }} ctx - Per-line context.
 * @param {boolean} prevLineCommented - Whether the previous line was a comment.
 * @param {string[]} violations - Mutable collector.
 */
function checkUnsafeProof(trimmed, ctx, prevLineCommented, violations) {
  const isUnsafeBlock = trimmed.startsWith('unsafe ') || trimmed === 'unsafe {';
  if (!isUnsafeBlock || prevLineCommented) return;
  violations.push(
    `FGT-SAF-001: Undocumented unsafe block missing safety proof at ${ctx.relPath}:${ctx.lineNum}`,
  );
}

/**
 * Checks for missing Rustdoc comments on public items (CMT-DOC-001).
 *
 * @param {string} trimmed - Trimmed source line.
 * @param {{ relPath: string, lineNum: number, isProduction: boolean }} ctx - Per-line context.
 * @param {{ hasPendingDoc: boolean }} docState - Mutable doc state tracker.
 * @param {string[]} violations - Mutable collector.
 */
function checkPublicRustdoc(trimmed, ctx, docState, violations) {
  if (trimmed.startsWith('///') || trimmed.startsWith('//!')) {
    docState.hasPendingDoc = true;
    return;
  }
  if (trimmed.startsWith('#[')) {
    return;
  }
  if (ctx.isProduction && /^pub\s+(?:struct|enum|fn|trait|const|type)\b/.test(trimmed)) {
    if (!docState.hasPendingDoc) {
      violations.push(
        `CMT-DOC-001: Missing Rustdoc (///) at ${ctx.relPath}:${ctx.lineNum}: ${trimmed}`,
      );
    }
  }
  if (trimmed.length > 0 && !trimmed.startsWith('//')) {
    docState.hasPendingDoc = false;
  }
}

/**
 * Checks for vague variable identifiers in production code (NAM-VAG-001).
 *
 * @param {string} line - Raw source line.
 * @param {{ relPath: string, lineNum: number, isProduction: boolean }} ctx - Per-line context.
 * @param {string[]} violations - Mutable collector.
 */
function checkVagueIdentifier(line, ctx, violations) {
  if (!ctx.isProduction) return;
  const vagueMatch = line.match(/\blet\s+(?:mut\s+)?(data|item|res|tmp|ret|obj)\s*[:=]/);
  if (vagueMatch) {
    violations.push(
      `NAM-VAG-001: Vague identifier '${vagueMatch[1]}' at ${ctx.relPath}:${ctx.lineNum}`,
    );
  }
}

/**
 * Checks for forbidden jargon/sprint terms in comments (CMT-JRG-001).
 *
 * @param {string} trimmed - Trimmed comment line.
 * @param {{ relPath: string, lineNum: number, isComment: boolean }} ctx - Per-line context.
 * @param {string[]} violations - Mutable collector.
 */
function checkForbiddenJargon(trimmed, ctx, violations) {
  if (!ctx.isComment) return;
  if (/\b(?:TODO|FIXME|HACK|XXX|sprint\d*|temp|legacy)\b/i.test(trimmed)) {
    violations.push(
      `CMT-JRG-001: Forbidden comment term at ${ctx.relPath}:${ctx.lineNum}: ${trimmed}`,
    );
  }
}

/**
 * Scans a single Rust file for safety, allocation, and error propagation violations.
 *
 * @param {string} filePath - Path to the Rust file.
 * @param {string[]} violations - Mutable array of violation strings.
 */
function scanRustFile(filePath, violations) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const relPath = path.relative(PROJECT_ROOT, filePath).replace(/\\/g, '/');
  const loopState = { inLoopBlock: false, loopBraceDepth: 0 };
  const testState = { pendingTestAttr: false, inTestModule: false, testDepth: 0 };
  const docState = { hasPendingDoc: false };
  let prevLineCommented = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const isComment =
      trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
    advanceTestModuleState(testState, trimmed);
    const ctx = {
      relPath,
      lineNum: index + 1,
      isComment,
      isProduction: !isComment && !testState.inTestModule,
    };

    checkErrorPropagation(line, ctx, violations);
    checkLoopAllocation(line, trimmed, ctx, loopState, violations);
    checkUnsafeProof(trimmed, ctx, prevLineCommented, violations);
    checkPublicRustdoc(trimmed, ctx, docState, violations);
    checkVagueIdentifier(line, ctx, violations);
    checkForbiddenJargon(trimmed, ctx, violations);

    prevLineCommented = isComment;
  });
}

/**
 * Recursively locates all .rs files under a directory excluding target and test trees.
 *
 * @param {string} dir - Directory to search.
 * @param {string[]} results - Output array of file paths.
 */
function collectRustSources(dir, results) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'target' && entry.name !== 'tests') {
        collectRustSources(fullPath, results);
      }
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      results.push(fullPath);
    }
  }
}

/**
 * Main execution routine.
 */
function runZeroAllocBoundaryCheck() {
  console.log('=== [FGT-PRF-001 & FGT-SAF-001] Rust Safety & Boundary Scanner ===');
  const violations = [];
  const rustFiles = [];

  collectRustSources(CRATES_DIR, rustFiles);
  console.log(`Auditing ${rustFiles.length} production Rust source files across micro-crates...`);

  for (const file of rustFiles) {
    scanRustFile(file, violations);
  }

  if (violations.length > 0) {
    console.error(`\n✖ BLOCK Found ${violations.length} boundary violation(s):`);
    for (const v of violations) {
      console.error(`  - ${v}`);
    }
    process.exit(1);
  }

  console.log('✔ PASS All micro-crates satisfy zero-alloc, safety, doc, and naming contracts.');
  process.exit(0);
}

runZeroAllocBoundaryCheck();
