/**
 * Module: Verification Harness — AST Complexity, Nesting & Noise Metrics
 * File Path: scripts/common/lib/staged-slice-metrics.js
 * Architecture Role: Resolves the workspace TypeScript compiler runtime and computes per-function
 *   McCabe cyclomatic complexity, control-flow nesting depth, loop/closure isolation, complexity
 *   ceilings, and line-level ELOC/noise dilution metrics.
 * Dependencies & Triggers: Requires TypeScript compiler package (`typescript`) and
 *   `./eloc-line-classifier`; imported by scripts/common/lib/staged-slice-analyzers.js.
 * Responsibilities:
 *   1. Resolve TypeScript compiler runtime with fail-closed exit on absence;
 *   2. Define branching, logical-operator, loop, and nesting syntax-kind sets;
 *   3. Compute McCabe cyclomatic complexity, nesting depth, loop presence, and closure isolation;
 *   4. Compute ELOC/noise dilution metrics and resolve elastic complexity ceilings.
 * Exit Semantics & Design Rationale: Exits 1 immediately when TypeScript compiler cannot be
 *   resolved (fail-closed gate invariant). Exported metric primitives are pure functions.
 */
"use strict";

const path = require("path");
const { QUALITY_BUDGET, summarizeSourceLines } = require("./eloc-line-classifier");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const COMPLEXITY_BUDGET = QUALITY_BUDGET.complexity;

/**
 * Resolves the workspace TypeScript compiler package, failing closed if unavailable.
 *
 * @returns {typeof import("typescript")} Loaded TypeScript compiler module.
 */
function loadTypeScriptRuntime() {
  const candidatePaths = [
    "typescript",
    path.resolve(REPO_ROOT, "auto-refactor/node_modules/typescript"),
    path.resolve(REPO_ROOT, "workspace-timing/node_modules/typescript"),
    path.resolve(REPO_ROOT, "node_modules/typescript"),
  ];

  for (const candidate of candidatePaths) {
    try {
      const loaded = require(candidate);
      if (loaded) return loaded;
    } catch (requireErr) {
      // Best-effort candidate discovery: ignore probe failures and try next candidate
      void requireErr;
    }
  }

  console.error(
    "✖ BLOCK  TypeScript runtime is required for AST slice review but was not resolvable.\n" +
      "   Remediation: npm ci --prefix auto-refactor (or npm install --prefix workspace-timing).\n" +
      "   Fail-closed policy: a skipped complexity gate is treated as a failed complexity gate.",
  );
  process.exit(1);
}

const ts = loadTypeScriptRuntime();

const BRANCHING_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
]);

const LOGICAL_BINARY_OPS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

const LOOP_KINDS = new Set([
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
]);

const NESTING_BLOCK_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.SwitchStatement,
]);

/**
 * Identifies whether an AST node defines a callable function scope.
 *
 * @param {import("typescript").Node} node - AST node
 * @returns {boolean}
 */
function isFunctionNode(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  );
}

/**
 * Determines whether a node is nested inside an enclosing function closure.
 *
 * @param {import("typescript").Node} node - Target node
 * @returns {boolean}
 */
function hasEnclosingFunction(node) {
  let curr = node ? node.parent : null;
  while (curr) {
    if (isFunctionNode(curr)) return true;
    curr = curr.parent;
  }
  return false;
}

/**
 * Calculates McCabe Cyclomatic Complexity for a single function scope.
 * Nested child functions are ignored to isolate complexity to the target function boundary.
 *
 * @param {import("typescript").Node} node - Function AST node
 * @returns {number} Computed cyclomatic complexity
 */
function calculateComplexity(node) {
  let complexity = 1;
  function walk(n) {
    if (n !== node && isFunctionNode(n)) return;
    if (BRANCHING_KINDS.has(n.kind)) {
      complexity++;
    } else if (ts.isBinaryExpression(n) && LOGICAL_BINARY_OPS.has(n.operatorToken.kind)) {
      complexity++;
    }
    ts.forEachChild(n, walk);
  }
  ts.forEachChild(node, walk);
  return complexity;
}

/**
 * Scans a function AST node to check for presence of loop constructs (for, while, do).
 * Functions containing loops are ineligible for flat dispatcher or low blast radius bonuses.
 *
 * @param {import("typescript").Node} node - Function AST node
 * @returns {boolean}
 */
function hasLoopConstruct(node) {
  let found = false;
  function walk(n) {
    if (found || (n !== node && isFunctionNode(n))) return;
    if (LOOP_KINDS.has(n.kind)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  }
  ts.forEachChild(node, walk);
  return found;
}

/**
 * Recursively traverses AST control flow blocks to calculate maximum nesting depth.
 * Guard clause awareness: Chained else-if statements do not increment nesting depth.
 *
 * @param {import("typescript").Node} node - AST node
 * @param {number} currentDepth - Current block nesting level
 * @param {{ val: number }} maxObserved - Container tracking peak nesting depth
 */
function checkNesting(node, currentDepth, maxObserved) {
  let depth = currentDepth;
  const isBlock = NESTING_BLOCK_KINDS.has(node.kind);
  const isElseIf =
    node.kind === ts.SyntaxKind.IfStatement &&
    node.parent &&
    node.parent.kind === ts.SyntaxKind.IfStatement &&
    node.parent.elseStatement === node;

  if (isBlock && !isElseIf) {
    depth++;
    if (depth > maxObserved.val) maxObserved.val = depth;
  }

  ts.forEachChild(node, (child) => {
    if (!isFunctionNode(child)) checkNesting(child, depth, maxObserved);
  });
}

/**
 * Computes Effective Lines of Code (ELOC) and noise ratio (kappa_noise) via SSOT classifier.
 *
 * @param {string} content - Raw source file content
 * @param {string} [ext='.ts'] - Lowercase file extension for language-accurate comment tracking
 * @returns {{ totalLines: number, eloc: number, noiseRatio: number }}
 */
function calculateElocAndNoise(content, ext = ".ts") {
  const { totalLines, eloc, noiseRatio } = summarizeSourceLines(content, ext);
  return { totalLines, eloc, noiseRatio };
}

/**
 * Resolves effective cyclomatic complexity ceiling based on function blast radius and role.
 *
 * @param {Record<string, any>} cfg - Configuration rules
 * @param {boolean} isFlatDispatcher - True if function qualifies as flat dispatcher
 * @param {boolean} isLowBlast - True if function qualifies for low blast radius envelope
 * @returns {{ effectiveMaxCC: number, tag: string }}
 */
function resolveComplexityCeiling(cfg, isFlatDispatcher, isLowBlast) {
  let effectiveMaxCC = cfg?.maxFunctionComplexity ?? COMPLEXITY_BUDGET.maxCc;
  let tag = "标准基线上限";
  const privateCeiling = cfg?.lowBlastRadiusMaxComplexity ?? COMPLEXITY_BUDGET.maxPrivateCc;
  const dispatcherCeiling = cfg?.flatDispatcherMaxComplexity ?? COMPLEXITY_BUDGET.maxDispatcherCc;

  if (isLowBlast && privateCeiling > effectiveMaxCC) {
    effectiveMaxCC = privateCeiling;
    tag = "私有低爆炸半径上限";
  }
  if (isFlatDispatcher && dispatcherCeiling > effectiveMaxCC) {
    effectiveMaxCC = dispatcherCeiling;
    tag = "平铺分发器上限";
  }
  return { effectiveMaxCC, tag };
}

module.exports = Object.freeze({
  COMPLEXITY_BUDGET,
  loadTypeScriptRuntime,
  ts,
  isFunctionNode,
  hasEnclosingFunction,
  calculateComplexity,
  hasLoopConstruct,
  checkNesting,
  calculateElocAndNoise,
  resolveComplexityCeiling,
});
