/**
 * Module: Verification Harness — AST Slice Visibility, Naming & Evaluation Analyzers
 * File Path: scripts/common/lib/staged-slice-analyzers.js
 * Architecture Role: Classifies function visibility and blast radius, enforces function
 *   identifier naming compliance, and evaluates per-function/file slice findings on top of
 *   AST metric primitives from lib/staged-slice-metrics.js.
 * Dependencies & Triggers: Consumes Node.js `path` and `./staged-slice-metrics`; imported by
 *   scripts/common/validate-staged-slice.js.
 * Responsibilities:
 *   1. Classify exported vs private low-blast-radius functions and flat dispatchers;
 *   2. Validate function identifier length and semantic expressiveness;
 *   3. Evaluate per-function CC/nesting findings and file-level noise dilution payloads;
 *   4. Re-export AST metric primitives (`ts`, `calculateComplexity`, `checkNesting`, etc.).
 * Exit Semantics & Design Rationale: Pure static-analysis library returning structured findings
 *   without mutating external state; compiler loading fails closed via `./staged-slice-metrics`.
 */
"use strict";

const path = require("path");
const {
  COMPLEXITY_BUDGET,
  ts,
  isFunctionNode,
  hasEnclosingFunction,
  calculateComplexity,
  hasLoopConstruct,
  checkNesting,
  calculateElocAndNoise,
  resolveComplexityCeiling,
} = require("./staged-slice-metrics");

/**
 * Whitelist of permitted short/single-letter function identifiers.
 * Includes coordinates, math operators, and canonical AST visitor accessors.
 */
const EXEMPT_FUNCTION_NAMES = new Set([
  "x", "y", "z", "w", "h", "r", "g", "b", "a",
  "dx", "dy", "dz",
  "sin", "cos", "tan", "min", "max", "abs", "gcd", "pow",
  "at", "on", "by", "up", "to", "op", "is", "as", "in", "id", "fn", "go",
]);

/**
 * Denylist of generic, unsemantic, or temporary placeholder function identifiers.
 */
const UNSEMANTIC_FUNCTION_NAMES = new Set([
  "foo", "bar", "baz", "qux", "temp", "tmp",
  "dummy", "stub", "asdf", "qwerty", "dosomething",
  "func", "func1", "func2", "fn1", "fn2", "test1", "test2",
]);

/**
 * Retrieves the modifier list of an AST node across TS compiler versions.
 *
 * @param {import("typescript").Node} node - Target node
 * @returns {readonly import("typescript").Modifier[]}
 */
function getModifiersList(node) {
  if (!node) return [];
  if (typeof ts.getModifiers === "function") {
    const mods = ts.getModifiers(node);
    if (mods && mods.length) return mods;
  }
  return node.modifiers || [];
}

/**
 * Checks if node has an explicit export modifier.
 *
 * @param {import("typescript").Node} node - Target node
 * @returns {boolean}
 */
function hasExportModifier(node) {
  const mods = getModifiersList(node);
  for (let i = 0; i < mods.length; i++) {
    if (mods[i].kind === ts.SyntaxKind.ExportKeyword) return true;
  }
  return false;
}

/**
 * Checks whether a class method is public-facing.
 *
 * @param {import("typescript").Node} node - Class member node
 * @returns {boolean}
 */
function isPublicMethod(node) {
  if (node.name && typeof ts.isPrivateIdentifier === "function" && ts.isPrivateIdentifier(node.name)) {
    return false;
  }
  const mods = getModifiersList(node);
  for (let i = 0; i < mods.length; i++) {
    const k = mods[i].kind;
    if (k === ts.SyntaxKind.PrivateKeyword || k === ts.SyntaxKind.ProtectedKeyword) return false;
  }
  return true;
}

/**
 * Checks if node is an immediate member of a class declaration or expression.
 *
 * @param {import("typescript").Node} node - Target node
 * @returns {boolean}
 */
function isClassMember(node) {
  if (!node || !node.parent) return false;
  return ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent);
}

/**
 * Walks upward to verify if enclosing variable statement is exported.
 *
 * @param {import("typescript").Node} startNode - Target variable declaration
 * @returns {boolean}
 */
function isEnclosingVariableStatementExported(startNode) {
  let curr = startNode ? startNode.parent : null;
  while (curr) {
    if (isFunctionNode(curr)) return false;
    if (ts.isVariableStatement(curr)) return hasExportModifier(curr);
    curr = curr.parent;
  }
  return false;
}

/**
 * Verifies if class method belongs to an exported class.
 *
 * @param {import("typescript").Node} node - Class method node
 * @returns {boolean}
 */
function isExportedClassMethod(node) {
  if (!isPublicMethod(node)) return false;
  const parentClass = node.parent;
  if (ts.isClassDeclaration(parentClass) && hasExportModifier(parentClass)) return true;
  return ts.isClassExpression(parentClass) && isEnclosingVariableStatementExported(parentClass);
}

/**
 * Determines whether a function node is exported or public-facing.
 * Public functions adhere strictly to base CC <= 15 without blast radius relaxation.
 *
 * @param {import("typescript").Node} node - Target function node
 * @returns {boolean}
 */
function isExportedFunction(node) {
  if (!node || hasEnclosingFunction(node)) return false;
  if (hasExportModifier(node)) return true;
  if (node.parent && ts.isExportAssignment(node.parent)) return true;
  if (isEnclosingVariableStatementExported(node)) return true;
  return isClassMember(node) && isExportedClassMethod(node);
}

/**
 * Extract clean identifier string from function AST node.
 *
 * @param {import("typescript").Node} node - Target function AST node
 * @param {import("typescript").SourceFile} sourceFile - TypeScript source file
 * @returns {string|null} Cleaned identifier or null
 */
function extractCleanIdentifier(node, sourceFile) {
  if (!node.name) return null;
  const rawName = node.name.getText(sourceFile);
  const name = rawName.startsWith("#") ? rawName.slice(1) : rawName;
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : null;
}

/**
 * Validate identifier length against minimum and maximum boundaries.
 *
 * @param {string} name - Cleaned function name
 * @param {string} lower - Lowercased function name
 * @param {Record<string, any>} cfg - Configuration options
 * @param {number} lineNum - 1-based source line number
 * @returns {object|null} Violation descriptor or null
 */
function checkIdentifierLengthBounds(name, lower, cfg, lineNum) {
  const minLen = cfg.minFunctionNameLength || 3;
  const maxLen = cfg.maxFunctionNameLength || 50;

  if (name.length < minLen && !EXEMPT_FUNCTION_NAMES.has(lower)) {
    return {
      rule: "NAM-LEN-002",
      severity: "error",
      message: `函数/方法 '${name}' 命名过短 (${name.length} < ${minLen} 字符，缺乏语义描述)`,
      line: lineNum,
      suggestedFix: "采用表意清晰的动宾结构短语命名函数/方法",
    };
  }
  if (name.length > maxLen) {
    return {
      rule: "NAM-LEN-002",
      severity: "error",
      message: `函数/方法 '${name}' 命名过长 (${name.length} > ${maxLen} 字符，建议精简)`,
      line: lineNum,
      suggestedFix: "精简冗余限定词或通过所属类/模块上下文消除命名膨胀",
    };
  }
  return null;
}

/**
 * Evaluates function/method identifier length and semantic expressiveness.
 *
 * @param {import("typescript").Node} node - Target function AST node
 * @param {import("typescript").SourceFile} sourceFile - TypeScript source file
 * @param {Record<string, any>} cfg - Complexity & naming thresholds
 * @param {number} lineNum - 1-based source line number
 * @returns {{ rule: string, severity: string, message: string, line: number, suggestedFix: string } | null}
 */
function validateFunctionName(node, sourceFile, cfg, lineNum) {
  const name = extractCleanIdentifier(node, sourceFile);
  if (!name) return null;
  const lower = name.toLowerCase();
  if (UNSEMANTIC_FUNCTION_NAMES.has(lower)) {
    return {
      rule: "NAM-VAG-001",
      severity: "error",
      message: `函数/方法 '${name}' 为无语义或临时占位命名`,
      line: lineNum,
      suggestedFix: "替换为具有明确领域语义与操作意图的命名",
    };
  }
  return checkIdentifierLengthBounds(name, lower, cfg, lineNum);
}

/**
 * Evaluates an individual function AST node for CC, naming, and nesting depth violations.
 *
 * @param {import("typescript").Node} node - Target function AST node
 * @param {import("typescript").SourceFile} sourceFile - TypeScript source file container
 * @param {Record<string, any>} cfg - Effective complexity threshold configuration
 * @returns {Array<{ rule: string, severity: string, message: string, line: number, suggestedFix: string }>}
 */
function analyzeFunction(node, sourceFile, cfg) {
  const findings = [];
  const lineNum = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const funcName = node.name ? node.name.getText(sourceFile) : "<anonymous>";

  const nameFinding = validateFunctionName(node, sourceFile, cfg, lineNum);
  if (nameFinding) findings.push(nameFinding);

  const complexity = calculateComplexity(node);
  const maxNesting = { val: 0 };
  checkNesting(node, 0, maxNesting);

  const isExported = isExportedFunction(node);
  const hasLoops = hasLoopConstruct(node);
  const isFlatDispatcher = cfg.flatDispatcherBonus && maxNesting.val <= cfg.flatDispatcherMaxDepth && !hasLoops;
  const isLowBlast =
    !isExported && cfg.lowBlastRadiusBonus && !hasLoops &&
    cfg.flatDispatcherBonus !== false && maxNesting.val <= cfg.lowBlastRadiusMaxDepth;
  const { effectiveMaxCC, tag } = resolveComplexityCeiling(cfg, isFlatDispatcher, isLowBlast);

  if (complexity > effectiveMaxCC) {
    findings.push({
      rule: "CPX-BUD-001",
      severity: "error",
      message: `函数 '${funcName}' 圈复杂度超标 (CC = ${complexity} > ${effectiveMaxCC}, ${tag})`,
      line: lineNum,
      actual: `CC = ${complexity}`,
      expected: `CC <= ${effectiveMaxCC}`,
      suggestedFix: "拆分多分支判定为策略表或提取独立辅助纯函数",
    });
  }

  const maxDepth = cfg?.maxNestingDepth ?? COMPLEXITY_BUDGET.maxNestingDepth;
  if (maxNesting.val > maxDepth) {
    findings.push({
      rule: "CPX-NEST-001",
      severity: "error",
      message: `函数 '${funcName}' 控制流嵌套过深 (Depth = ${maxNesting.val} > ${maxDepth})`,
      line: lineNum,
      actual: `Depth = ${maxNesting.val}`,
      expected: `Depth <= ${maxDepth}`,
      suggestedFix: "采用卫语句 (Guard Clause) 提前返回以平铺嵌套分支",
    });
  }
  return findings;
}

/**
 * Checks whether an AST node overlaps any changed line in the current hunk set.
 *
 * @param {import("typescript").Node} node - Target AST node
 * @param {import("typescript").SourceFile} sourceFile - Source file container
 * @param {Set<number>|null} changedLines - Changed 1-based line numbers, or null for whole file
 * @returns {boolean}
 */
function isFunctionInChangedLines(node, sourceFile, changedLines) {
  if (!changedLines || changedLines.size === 0) return true;
  const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  for (let l = startLine + 1; l <= endLine + 1; l++) {
    if (changedLines.has(l)) return true;
  }
  return false;
}

/**
 * Parses source text into a TypeScript AST and collects noise and function-level findings.
 *
 * @param {string} content - Source text
 * @param {string} filePath - Target path for dialect selection
 * @param {Record<string, any>} cfg - Resolved complexity configuration
 * @param {Set<number>|null} changedLines - Optional changed lines filter
 * @returns {Array<object>} Detected findings
 */
function collectSourceSliceFindings(content, filePath, cfg, changedLines) {
  const isJs = filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs");
  const sourceFile = ts.createSourceFile(
    filePath, content, ts.ScriptTarget.Latest, true, isJs ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  const ext = path.extname(filePath).toLowerCase() || ".ts";
  const { totalLines, eloc, noiseRatio } = calculateElocAndNoise(content, ext);
  const findings = [];
  const maxNoiseRatio = cfg?.maxNoiseRatio ?? COMPLEXITY_BUDGET.maxNoiseRatio;
  const checkNoise = !changedLines || changedLines.size === 0 || changedLines.size > 20;
  if (noiseRatio > maxNoiseRatio && totalLines > 60 && checkNoise) {
    findings.push({
      rule: "GUARD-AST-001",
      severity: "error",
      message: `代码稀释/注水指数超标 (kappa_noise = ${noiseRatio.toFixed(2)} > ${maxNoiseRatio})，有效代码行过低 (${eloc}/${totalLines})`,
      line: 1,
      actual: `kappa_noise = ${noiseRatio.toFixed(2)}`,
      expected: `kappa_noise <= ${maxNoiseRatio}`,
      suggestedFix: "精简多余空行与无意义注释堆叠，提高代码紧凑度与语义密度",
    });
  }

  function visit(node) {
    if (isFunctionNode(node) && isFunctionInChangedLines(node, sourceFile, changedLines)) {
      findings.push(...analyzeFunction(node, sourceFile, cfg));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}

module.exports = Object.freeze({
  ts,
  isFunctionNode,
  isExportedFunction,
  calculateComplexity,
  hasLoopConstruct,
  checkNesting,
  calculateElocAndNoise,
  resolveComplexityCeiling,
  validateFunctionName,
  analyzeFunction,
  isFunctionInChangedLines,
  collectSourceSliceFindings,
});
