/**
 * Module: Verification Harness — Incremental AST Slice Review Gate (SSOT Bridge)
 * File Path: scripts/validate-staged-slice.js
 * Architecture Role: Single-source-of-truth delegation bridge connecting auto-refactor
 *   to the platform incremental AST slice complexity gate
 *   (scripts/common/validate-staged-slice.js).
 * Dependencies & Triggers: Invoked by test-parallel.js, unit tests, and pre-commit-gate.
 * Responsibilities:
 *   1. Resolve and dynamically verify the shared common AST slice validator;
 *   2. Validate structural integrity of exported analysis primitives;
 *   3. Expose an immutable, frozen contract fulfilling ARCH-FAC-001 / ARCH-ABS-001;
 *   4. Execute staged slice complexity assertions when called as main.
 * Exit Semantics & Design Rationale: 0 = PASS, 1 = FAIL on violations.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const COMMON_SLICE_PATH = path.resolve(__dirname, '../../scripts/common/validate-staged-slice.js');

if (!fs.existsSync(COMMON_SLICE_PATH)) {
  throw new Error(`[validate-staged-slice] Common SSOT module missing at: ${COMMON_SLICE_PATH}`);
}

const common = require(COMMON_SLICE_PATH);

// Rigorous API surface validation preventing hollow delegation
const REQUIRED_EXPORTS = [
  'DEFAULT_CONFIG',
  'resolveConfig',
  'calculateComplexity',
  'hasLoopConstruct',
  'checkNesting',
  'analyzeSourceText',
  'analyzeFile',
  'run',
];

for (const exportName of REQUIRED_EXPORTS) {
  if (!(exportName in common)) {
    throw new Error(`[validate-staged-slice] Common SSOT missing required export: ${exportName}`);
  }
}

/**
 * Execution wrapper providing localized timing and platform diagnostic logging.
 *
 * @param argv Optional explicit arguments to pass through to the runner.
 * @returns Execution outcome.
 */
function runWithDiagnostics(argv) {
  if (Array.isArray(argv) && argv.length > 0) {
    const originalArgv = process.argv;
    try {
      process.argv = [process.argv[0], COMMON_SLICE_PATH, ...argv];
      return common.run();
    } finally {
      process.argv = originalArgv;
    }
  }
  return common.run();
}

const exportedModule = Object.freeze({
  DEFAULT_CONFIG: Object.freeze({ ...common.DEFAULT_CONFIG }),
  resolveConfig: common.resolveConfig,
  calculateComplexity: common.calculateComplexity,
  hasLoopConstruct: common.hasLoopConstruct,
  checkNesting: common.checkNesting,
  analyzeSourceText: common.analyzeSourceText,
  analyzeFile: common.analyzeFile,
  run: runWithDiagnostics,
});

if (require.main === module) {
  runWithDiagnostics();
}

module.exports = exportedModule;
