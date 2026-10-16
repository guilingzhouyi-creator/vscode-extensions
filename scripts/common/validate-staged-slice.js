/**
 * Module: Verification Harness — Platform Incremental AST Slice Review Gate
 * File Path: scripts/common/validate-staged-slice.js
 * Architecture Role: High-speed platform-level incremental static analysis gate for pre-commit.
 *   Scans staged TypeScript/JavaScript files to detect architectural complexity anti-patterns:
 *   - Function cyclomatic complexity (> 15 base, elastic bonus up to 18 for low blast radius, up to 25 for flat dispatchers)
 *   - Control flow nesting depth (> 4)
 *   - Code dilution / noise index (kappa_noise > 4.0)
 * Dependencies & Triggers: Invoked by pre-commit-gate scripts (sh / ps1) and CI hygiene jobs.
 * Responsibilities: Enforce CC <= 15 (elastic), depth <= 4, and noise ratio on staged slices.
 * Exit Semantics & Design Rationale: 0 = PASS (clean AST slice), 1 = FAIL on violations.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { getSafeGitEnv } = require("./git-env");

let ts;
const REPO_ROOT = path.resolve(__dirname, "../..");

const candidatePaths = [
  "typescript",
  path.resolve(REPO_ROOT, "auto-refactor/node_modules/typescript"),
  path.resolve(REPO_ROOT, "workspace-timing/node_modules/typescript"),
  path.resolve(REPO_ROOT, "node_modules/typescript"),
];

for (const p of candidatePaths) {
  try {
    ts = require(p);
    if (ts) break;
  } catch {
    // try next candidate
  }
}

if (!ts) {
  console.log(
    "  ℹ️ [NOTICE] 未检测到 typescript 运行环境，跳过 AST 局部切片审查",
  );
  process.exit(0);
}

/** Default baseline configuration contract. */
const DEFAULT_CONFIG = Object.freeze({
  maxFunctionComplexity: 15,
  maxNestingDepth: 4,
  maxNoiseRatio: 4.0,
  minFunctionNameLength: 3,
  maxFunctionNameLength: 50,
  flatDispatcherBonus: true,
  flatDispatcherMaxComplexity: 25,
  flatDispatcherMaxDepth: 2,
  lowBlastRadiusBonus: true,
  lowBlastRadiusMaxComplexity: 18,
  lowBlastRadiusMaxDepth: 3,
  probeMaxComplexity: 20,
  testMaxComplexity: 20,
});

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Searches upwards for project configuration files with complexity overrides.
 */
function findProjectConfig(filePath) {
  let curr = path.dirname(path.resolve(filePath));
  const root = path.parse(curr).root;
  while (curr && curr !== root) {
    const pkg = readJsonSafe(path.join(curr, "package.json"));
    const gov = pkg?.governance?.complexity || pkg?.governance?.astSlice;
    if (gov) return gov;

    const cfg =
      readJsonSafe(path.join(curr, "auto-refactor.config.json")) ||
      readJsonSafe(path.join(curr, "autoRefactor.config.json"));
    if (cfg?.thresholds) return cfg.thresholds;

    curr = path.dirname(curr);
  }
  return null;
}

/**
 * Applies complexity configuration overrides from a given config source.
 */
function applyConfigOverrides(cfg, source) {
  if (!source) return;
  if (typeof source.maxFunctionComplexity === "number") {
    cfg.maxFunctionComplexity = source.maxFunctionComplexity;
  }
  if (typeof source.maxNestingDepth === "number") {
    cfg.maxNestingDepth = source.maxNestingDepth;
  }
  if (typeof source.maxNoiseRatio === "number") {
    cfg.maxNoiseRatio = source.maxNoiseRatio;
  }
  if (typeof source.minFunctionNameLength === "number") {
    cfg.minFunctionNameLength = source.minFunctionNameLength;
  }
  if (typeof source.maxFunctionNameLength === "number") {
    cfg.maxFunctionNameLength = source.maxFunctionNameLength;
  }
  if (typeof source.flatDispatcherBonus === "boolean") {
    cfg.flatDispatcherBonus = source.flatDispatcherBonus;
  }
  if (typeof source.flatDispatcherMaxComplexity === "number") {
    cfg.flatDispatcherMaxComplexity = source.flatDispatcherMaxComplexity;
  }
  if (typeof source.lowBlastRadiusBonus === "boolean") {
    cfg.lowBlastRadiusBonus = source.lowBlastRadiusBonus;
  }
  if (typeof source.lowBlastRadiusMaxComplexity === "number") {
    cfg.lowBlastRadiusMaxComplexity = source.lowBlastRadiusMaxComplexity;
  }
  if (typeof source.lowBlastRadiusMaxDepth === "number") {
    cfg.lowBlastRadiusMaxDepth = source.lowBlastRadiusMaxDepth;
  }
}

/**
 * Resolves effective complexity configuration for a specific target file.
 */
function resolveConfig(filePath, overrides = {}) {
  const cfg = { ...DEFAULT_CONFIG };
  applyConfigOverrides(cfg, findProjectConfig(filePath));

  const normalized = filePath.replace(/\\/g, "/");
  const isProbe = /(?:archetype|parser|scanner|detector|lexer|tokenizer)/i.test(
    normalized,
  );
  const isTest =
    /(?:\.test\.|\.spec\.|scripts\/(?:common\/)?validate-|tests\/)/i.test(
      normalized,
    );
  if (isProbe) {
    cfg.maxFunctionComplexity = Math.max(
      cfg.maxFunctionComplexity,
      cfg.probeMaxComplexity,
    );
  } else if (isTest) {
    cfg.maxFunctionComplexity = Math.max(
      cfg.maxFunctionComplexity,
      cfg.testMaxComplexity,
    );
  }

  applyConfigOverrides(cfg, overrides);
  return cfg;
}

/**
 * Parses a single CLI argument token into flags or explicit target files.
 *
 * @param {string} arg - CLI token
 * @param {Record<string, any>} flags - Parsed flag collection
 * @param {string[]} explicitFiles - Target file list accumulator
 */
function parseSingleFlag(arg, flags, explicitFiles) {
  if (arg.startsWith("--max-cc=")) {
    flags.maxFunctionComplexity = parseInt(arg.slice(9), 10);
    return;
  }
  if (arg.startsWith("--max-depth=")) {
    flags.maxNestingDepth = parseInt(arg.slice(12), 10);
    return;
  }
  if (arg.startsWith("--max-noise=")) {
    flags.maxNoiseRatio = parseFloat(arg.slice(12));
    return;
  }
  if (arg === "--no-flat-bonus") {
    flags.flatDispatcherBonus = false;
    return;
  }
  if (arg === "--no-blast-bonus") {
    flags.lowBlastRadiusBonus = false;
    return;
  }
  if (arg === "--agent" || arg === "-a" || arg === "--json") {
    flags.agentMode = true;
    return;
  }
  if (!arg.startsWith("-")) {
    explicitFiles.push(arg);
  }
}

/**
 * Parses raw CLI arguments array into structured option flags and explicit targets.
 *
 * @param {string[]} args - CLI arguments array
 * @returns {{ flags: Record<string, any>, explicitFiles: string[] }}
 */
function parseCliFlags(args) {
  const flags = {};
  const explicitFiles = [];
  for (const arg of args) {
    parseSingleFlag(arg, flags, explicitFiles);
  }
  return { flags, explicitFiles };
}

/**
 * Constructs an isolated Git environment preventing global config permissions errors.
 *
 * @returns {Record<string, string>}
 */
function getGitEnv() {
  return getSafeGitEnv(REPO_ROOT);
}

/**
 * State Machine Helper: Parses a unified diff hunk header and populates changed line index.
 * Matches syntax: @@ -from,len +to,len @@
 *
 * @param {string} line - Unified diff hunk header line
 * @param {string} currentFile - Absolute path of the file currently parsed
 * @param {Map<string, { changedLines: Set<number>, isNew: boolean }>} map - Result accumulator map
 */
function parseHunkLine(line, currentFile, map) {
  const match = line.match(
    /@@\s+-[0-9]+(?:,[0-9]+)?\s+\+([0-9]+)(?:,([0-9]+))?\s+@@/,
  );
  if (!match) return;
  const start = parseInt(match[1], 10);
  const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;
  const entry = map.get(currentFile);
  if (!entry || !entry.changedLines) return;
  if (count === 0) {
    entry.changedLines.add(start);
  } else {
    for (let i = 0; i < count; i++) {
      entry.changedLines.add(start + i);
    }
  }
}

function isEligibleSourcePath(rel) {
  if (!rel.endsWith(".ts") && !rel.endsWith(".js")) return false;
  if (rel.endsWith(".d.ts")) return false;
  if (
    rel.includes("dist/") ||
    rel.includes("out/") ||
    rel.includes("fixtures/")
  ) {
    return false;
  }
  return true;
}

/**
 * Creates hunk map from explicitly passed target file paths.
 *
 * @param {string[]} explicitFiles - Target file list
 * @returns {Map<string, { changedLines: Set<number>|null, isNew: boolean }>}
 */
function mapFromExplicitFiles(explicitFiles) {
  const map = new Map();
  for (const f of explicitFiles) {
    if (
      (f.endsWith(".ts") || f.endsWith(".js")) &&
      !f.endsWith(".d.ts") &&
      fs.existsSync(f)
    ) {
      map.set(path.resolve(f), { changedLines: null, isNew: false });
    }
  }
  return map;
}

/**
 * Ensure entry exists in hunk map for target file.
 *
 * @param {Map<string, { changedLines: Set<number>, isNew: boolean }>} map - Diff hunk map
 * @param {string} filePath - Absolute file path
 * @param {boolean} isNew - Indicates whether file is newly created
 */
function registerDiffFileEntry(map, filePath, isNew) {
  if (!map.has(filePath)) {
    map.set(filePath, {
      changedLines: new Set(),
      isNew,
    });
  }
}

/**
 * State Machine: Parses raw git diff text into per-file changed line intervals.
 *
 * @param {string} raw - Raw unified diff output
 * @param {Map<string, { changedLines: Set<number>, isNew: boolean }>} map - Map populated with changed lines
 */
function parseGitDiffHunks(raw, map) {
  let currentFile = null;
  let isCurrentNew = false;
  const diffLines = raw.split("\n");
  for (const line of diffLines) {
    if (line.startsWith("+++ b/")) {
      const rel = line.slice(6).trim();
      if (isEligibleSourcePath(rel)) {
        currentFile = path.resolve(REPO_ROOT, rel);
        registerDiffFileEntry(map, currentFile, isCurrentNew);
      } else {
        currentFile = null;
      }
      isCurrentNew = false;
    } else if (line.startsWith("new file mode")) {
      isCurrentNew = true;
    } else if (currentFile && line.startsWith("@@ ")) {
      parseHunkLine(line, currentFile, map);
    }
  }
}

/**
 * Obtains mapped staged hunks and changed line intervals from git index.
 *
 * @param {string[]} explicitFiles - Explicit CLI target files
 * @returns {Map<string, { changedLines: Set<number>|null, isNew: boolean }>}
 */
function getStagedHunkMap(explicitFiles) {
  if (explicitFiles && explicitFiles.length > 0) {
    return mapFromExplicitFiles(explicitFiles);
  }

  const map = new Map();
  try {
    const raw = execSync("git diff --cached -U0 --diff-filter=ACM", {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      env: getGitEnv(),
    });
    parseGitDiffHunks(raw, map);
  } catch {
    // git failed fallback
  }

  if (map.size === 0) {
    for (const file of getStagedFilesFallback()) {
      map.set(path.resolve(REPO_ROOT, file), { changedLines: null, isNew: false });
    }
  }

  return map;
}

/**
 * Fallback: Reads staged filenames without fine-grained hunk diff line mapping.
 *
 * @returns {string[]}
 */
function getStagedFilesFallback() {
  try {
    const raw = execSync("git diff --cached --name-only --diff-filter=ACM", {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      env: getGitEnv(),
    });
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter(
        (f) =>
          f.length > 0 &&
          (f.endsWith(".ts") || f.endsWith(".js")) &&
          !f.endsWith(".d.ts") &&
          !f.includes("dist/") &&
          !f.includes("out/") &&
          !f.includes("fixtures/") &&
          fs.existsSync(f),
      );
  } catch {
    return [];
  }
}

/**
 * Retrieves list of staged source file paths.
 *
 * @param {string[]} explicitFiles - Explicit CLI targets
 * @returns {string[]}
 */
function getStagedFiles(explicitFiles) {
  const map = getStagedHunkMap(explicitFiles);
  return Array.from(map.keys());
}

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
 * @param {ts.Node} n - AST node
 * @returns {boolean}
 */
function isFunctionNode(n) {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n)
  );
}

/**
 * Retrieves the modifier list of an AST node across TS compiler versions.
 *
 * @param {ts.Node} node - Target node
 * @returns {readonly ts.Modifier[]}
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
 * @param {ts.Node} node - Target node
 * @returns {boolean}
 */
function hasExportModifier(node) {
  const mods = getModifiersList(node);
  for (let i = 0; i < mods.length; i++) {
    if (mods[i].kind === ts.SyntaxKind.ExportKeyword) {
      return true;
    }
  }
  return false;
}

/**
 * Determines whether a node is nested inside an enclosing function closure.
 *
 * @param {ts.Node} node - Target node
 * @returns {boolean}
 */
function hasEnclosingFunction(node) {
  let curr = node ? node.parent : null;
  while (curr) {
    if (isFunctionNode(curr)) {
      return true;
    }
    curr = curr.parent;
  }
  return false;
}

/**
 * Checks whether a class method is public-facing.
 *
 * @param {ts.Node} node - Class member node
 * @returns {boolean}
 */
function isPublicMethod(node) {
  if (
    node.name &&
    typeof ts.isPrivateIdentifier === "function" &&
    ts.isPrivateIdentifier(node.name)
  ) {
    return false;
  }
  const mods = getModifiersList(node);
  for (let i = 0; i < mods.length; i++) {
    const k = mods[i].kind;
    if (
      k === ts.SyntaxKind.PrivateKeyword ||
      k === ts.SyntaxKind.ProtectedKeyword
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Checks if node is an immediate member of a class declaration or expression.
 *
 * @param {ts.Node} node - Target node
 * @returns {boolean}
 */
function isClassMember(node) {
  if (!node || !node.parent) return false;
  return (
    ts.isClassDeclaration(node.parent) ||
    ts.isClassExpression(node.parent)
  );
}

/**
 * Walks upward to verify if enclosing variable statement is exported.
 *
 * @param {ts.Node} startNode - Target variable declaration
 * @returns {boolean}
 */
function isEnclosingVariableStatementExported(startNode) {
  let curr = startNode ? startNode.parent : null;
  while (curr) {
    if (isFunctionNode(curr)) {
      return false;
    }
    if (ts.isVariableStatement(curr)) {
      return hasExportModifier(curr);
    }
    curr = curr.parent;
  }
  return false;
}

/**
 * Verifies if class method belongs to an exported class.
 *
 * @param {ts.Node} node - Class method node
 * @returns {boolean}
 */
function isExportedClassMethod(node) {
  if (!isPublicMethod(node)) {
    return false;
  }
  const parentClass = node.parent;
  if (ts.isClassDeclaration(parentClass) && hasExportModifier(parentClass)) {
    return true;
  }
  if (
    ts.isClassExpression(parentClass) &&
    isEnclosingVariableStatementExported(parentClass)
  ) {
    return true;
  }
  return false;
}

/**
 * Determines whether a function node is exported or public-facing.
 * Public functions adhere strictly to base CC <= 15 without blast radius relaxation.
 *
 * @param {ts.Node} node - Target function node
 * @returns {boolean}
 */
function isExportedFunction(node) {
  if (!node || hasEnclosingFunction(node)) {
    return false;
  }
  if (hasExportModifier(node)) {
    return true;
  }
  if (node.parent && ts.isExportAssignment(node.parent)) {
    return true;
  }
  if (isEnclosingVariableStatementExported(node)) {
    return true;
  }
  if (isClassMember(node)) {
    return isExportedClassMethod(node);
  }
  return false;
}

/**
 * State Machine Invariant: Calculates McCabe Cyclomatic Complexity for a single function scope.
 * Complexity starts at 1, incrementing on each decision branch (if, loop, case, catch, logical operators).
 * Nested child functions are ignored to isolate complexity to the target function boundary.
 *
 * @param {ts.Node} node - Function AST node
 * @returns {number} Computed cyclomatic complexity
 */
function calculateComplexity(node) {
  let complexity = 1;
  function walk(n) {
    if (n !== node && isFunctionNode(n)) {
      return;
    }
    if (BRANCHING_KINDS.has(n.kind)) {
      complexity++;
    } else if (
      ts.isBinaryExpression(n) &&
      LOGICAL_BINARY_OPS.has(n.operatorToken.kind)
    ) {
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
 * @param {ts.Node} node - Function AST node
 * @returns {boolean}
 */
function hasLoopConstruct(node) {
  let found = false;
  function walk(n) {
    if (found) return;
    if (n !== node && isFunctionNode(n)) {
      return;
    }
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
 * State Machine Invariant: Recursively traverses AST control flow blocks to calculate maximum nesting depth.
 * Guard clause awareness: Chained else-if statements do not increment nesting depth.
 *
 * @param {ts.Node} node - AST node
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
    if (depth > maxObserved.val) {
      maxObserved.val = depth;
    }
  }

  ts.forEachChild(node, (child) => {
    if (!isFunctionNode(child)) {
      checkNesting(child, depth, maxObserved);
    }
  });
}

/**
 * Computes Effective Lines of Code (ELOC) and noise ratio (kappa_noise).
 *
 * @param {string} content - Raw source file content
 * @returns {{ totalLines: number, eloc: number, noiseRatio: number }}
 */
function calculateElocAndNoise(content) {
  const lines = content.split("\n");
  const totalLines = lines.length;
  let eloc = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("/*") &&
      !trimmed.startsWith("*")
    ) {
      eloc++;
    }
  }
  const nonEloc = Math.max(0, totalLines - eloc);
  const noiseRatio = nonEloc / Math.max(1, eloc);
  return { totalLines, eloc, noiseRatio };
}

/**
 * Resolves effective cyclomatic complexity ceiling based on function blast radius and role.
 * Elastic envelopes:
 * - Public API: strictly CC <= 15
 * - Low Blast Radius (private, unexported, no loops, depth <= 3): CC <= 18
 * - Flat Dispatcher (no loops, depth <= 2): CC <= 25
 *
 * @param {Record<string, any>} cfg - Configuration rules
 * @param {boolean} isFlatDispatcher - True if function qualifies as flat dispatcher
 * @param {boolean} isLowBlast - True if function qualifies for low blast radius envelope
 * @returns {{ effectiveMaxCC: number, tag: string }}
 */
function resolveComplexityCeiling(cfg, isFlatDispatcher, isLowBlast) {
  let effectiveMaxCC = cfg.maxFunctionComplexity;
  let tag = "标准基线上限";

  if (isLowBlast && cfg.lowBlastRadiusMaxComplexity > effectiveMaxCC) {
    effectiveMaxCC = cfg.lowBlastRadiusMaxComplexity;
    tag = "私有低爆炸半径上限";
  }

  if (isFlatDispatcher && cfg.flatDispatcherMaxComplexity > effectiveMaxCC) {
    effectiveMaxCC = cfg.flatDispatcherMaxComplexity;
    tag = "平铺分发器上限";
  }

  return { effectiveMaxCC, tag };
}

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
 * Evaluates function/method identifier length and semantic expressiveness.
 * Enforces length in [3, 50], blocking single-letter or placeholder identifiers.
 *
 * @param {ts.Node} node - Target function AST node
 * @param {ts.SourceFile} sourceFile - TypeScript source file
 * @param {Record<string, any>} cfg - Complexity & naming thresholds
 * @param {number} lineNum - 1-based source line number
 * @returns {{ rule: string, severity: string, message: string, line: number, suggestedFix: string } | null}
 */
/**
 * Extract clean identifier string from function AST node.
 *
 * @param {ts.Node} node - Target function AST node
 * @param {ts.SourceFile} sourceFile - TypeScript source file
 * @returns {string|null} Cleaned identifier or null
 */
function extractCleanIdentifier(node, sourceFile) {
  if (!node.name) return null;
  const rawName = node.name.getText(sourceFile);
  const name = rawName.startsWith("#") ? rawName.slice(1) : rawName;
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) return null;
  return name;
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
 * Enforces length in [3, 50], blocking single-letter or placeholder identifiers.
 *
 * @param {ts.Node} node - Target function AST node
 * @param {ts.SourceFile} sourceFile - TypeScript source file
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
 * Evaluates an individual function AST node for CC and nesting depth violations.
 *
 * @param {ts.Node} node - Target function AST node
 * @param {ts.SourceFile} sourceFile - TypeScript source file container
 * @param {Record<string, any>} cfg - Effective complexity threshold configuration
 * @returns {Array<{ rule: string, severity: string, message: string, line: number, suggestedFix: string }>}
 */
function analyzeFunction(node, sourceFile, cfg) {
  const findings = [];
  const pos = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  const lineNum = pos.line + 1;
  const funcName = node.name ? node.name.getText(sourceFile) : "<anonymous>";

  const nameFinding = validateFunctionName(node, sourceFile, cfg, lineNum);
  if (nameFinding) {
    findings.push(nameFinding);
  }

  const complexity = calculateComplexity(node);

  const maxNesting = { val: 0 };
  checkNesting(node, 0, maxNesting);

  const isExported = isExportedFunction(node);
  const hasLoops = hasLoopConstruct(node);
  const isFlatDispatcher =
    cfg.flatDispatcherBonus &&
    maxNesting.val <= cfg.flatDispatcherMaxDepth &&
    !hasLoops;
  const isLowBlast =
    !isExported &&
    cfg.lowBlastRadiusBonus &&
    !hasLoops &&
    cfg.flatDispatcherBonus !== false &&
    maxNesting.val <= cfg.lowBlastRadiusMaxDepth;

  const { effectiveMaxCC, tag } = resolveComplexityCeiling(
    cfg,
    isFlatDispatcher,
    isLowBlast,
  );

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

  if (maxNesting.val > cfg.maxNestingDepth) {
    findings.push({
      rule: "CPX-NEST-001",
      severity: "error",
      message: `函数 '${funcName}' 控制流嵌套过深 (Depth = ${maxNesting.val} > ${cfg.maxNestingDepth})`,
      line: lineNum,
      actual: `Depth = ${maxNesting.val}`,
      expected: `Depth <= ${cfg.maxNestingDepth}`,
      suggestedFix: "采用卫语句 (Guard Clause) 提前返回以平铺嵌套分支",
    });
  }

  return findings;
}

function readStagedContentSafe(filePath) {
  const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
  try {
    return execSync(`git show :${rel}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      env: getGitEnv(),
    });
  } catch {
    return fs.readFileSync(filePath, "utf8");
  }
}

function isFunctionInChangedLines(node, sourceFile, changedLines) {
  if (!changedLines || changedLines.size === 0) return true;
  const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(
    node.getEnd(),
  );
  for (let l = startLine + 1; l <= endLine + 1; l++) {
    if (changedLines.has(l)) return true;
  }
  return false;
}

function analyzeSourceText(
  content,
  filePath = "anonymous.ts",
  overrides = {},
  changedLines = null,
) {
  const cfg = resolveConfig(filePath, overrides);
  const isJs =
    filePath.endsWith(".js") ||
    filePath.endsWith(".mjs") ||
    filePath.endsWith(".cjs");
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    isJs ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );

  const { totalLines, eloc, noiseRatio } = calculateElocAndNoise(content);
  const findings = [];

  const checkNoise =
    !changedLines || changedLines.size === 0 || changedLines.size > 20;
  if (noiseRatio > cfg.maxNoiseRatio && totalLines > 60 && checkNoise) {
    findings.push({
      rule: "GATE-AST-001",
      severity: "error",
      message: `代码稀释/注水指数超标 (kappa_noise = ${noiseRatio.toFixed(2)} > ${cfg.maxNoiseRatio})，有效代码行过低 (${eloc}/${totalLines})`,
      line: 1,
      actual: `kappa_noise = ${noiseRatio.toFixed(2)}`,
      expected: `kappa_noise <= ${cfg.maxNoiseRatio}`,
      suggestedFix: "精简多余空行与无意义注释堆叠，提高代码紧凑度与语义密度",
    });
  }

  function visit(node) {
    if (isFunctionNode(node)) {
      if (isFunctionInChangedLines(node, sourceFile, changedLines)) {
        const fnFindings = analyzeFunction(node, sourceFile, cfg);
        findings.push(...fnFindings);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function analyzeFile(filePath, overrides = {}, changedLines = null) {
  const content = readStagedContentSafe(filePath);
  return analyzeSourceText(content, filePath, overrides, changedLines);
}

/**
 * Handle early exit when no staged TS/JS files require review.
 *
 * @param {boolean} isAgentMode - Autonomous Agent format flag.
 */
function handleEmptyHunkMap(isAgentMode) {
  if (isAgentMode) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: "1.0.0",
          status: "PASS",
          gate: "pre-commit:ast-slice",
          summary: "No staged TS/JS files require AST slice review.",
        },
        null,
        2,
      ),
    );
  } else {
    console.log("  ✔ [PASS] 暂存区无 TS/JS 源码需执行 AST 切片审查");
  }
  process.exit(0);
}

/**
 * Scan hunk-mapped files and aggregate AST slice violations.
 *
 * @param {Map<string, { changedLines: Set<number>, isNew: boolean }>} hunkMap - Mapped staged files.
 * @param {Record<string, any>} flags - Configuration override flags.
 * @returns {Array<object>} Accumulated violation descriptors.
 */
function collectHunkSliceViolations(hunkMap, flags) {
  const allViolations = [];
  for (const [file, info] of hunkMap.entries()) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    const findings = analyzeFile(file, flags, info.changedLines);
    if (findings.length === 0) {
      continue;
    }
    for (const f of findings) {
      allViolations.push({
        ruleId: f.rule,
        severity: "BLOCK",
        file: rel,
        line: f.line,
        actual: f.actual || f.message,
        expected:
          f.expected ||
          (f.rule === "CPX-BUD-001"
            ? "CC <= 15"
            : f.rule === "CPX-NEST-001"
              ? "Depth <= 4"
              : "Noise <= 4.0"),
        message: f.message,
        actionableFix: f.suggestedFix || "平铺控制流或拆分复杂函数",
        verificationCommand: `node scripts/common/validate-staged-slice.js ${rel}`,
      });
    }
  }
  return allViolations;
}

/**
 * Persist failure snapshot envelope for downstream diagnostic and auto-repair triage.
 *
 * @param {Array<object>} allViolations - Detected violation records.
 */
function recordSliceFailureSnapshot(allViolations) {
  try {
    const { writeFailureSnapshot } = require("./log-rotator");
    writeFailureSnapshot({
      gate: "pre-commit:ast-slice",
      step: "Gate 9: AST Staged Slice Review",
      failedCommand: "node scripts/common/validate-staged-slice.js",
      exitCode: 1,
      summary: `AST slice review blocked commit due to ${allViolations.length} complexity or nesting violations.`,
      violations: allViolations,
      targetFiles: Array.from(
        new Set(allViolations.map((v) => v.file).filter(Boolean)),
      ),
      verificationCommand: "node scripts/common/validate-staged-slice.js",
    });
  } catch {
    // Best-effort snapshot recording
  }
}

/**
 * Render failure details and terminate process with exit code 1.
 *
 * @param {Array<object>} allViolations - Detected violation records.
 * @param {boolean} isAgentMode - Autonomous Agent format flag.
 */
function renderSliceViolations(allViolations, isAgentMode) {
  if (isAgentMode) {
    const envelope = {
      protocolVersion: "1.0.0",
      status: "BLOCK",
      gate: "pre-commit:ast-slice",
      step: "Gate 9: AST Staged Slice Review",
      failedCommand: "node scripts/common/validate-staged-slice.js",
      exitCode: 1,
      summary: `AST slice review blocked commit due to ${allViolations.length} complexity or nesting violations.`,
      violations: allViolations,
      agentDirectives: {
        targetFiles: Array.from(
          new Set(allViolations.map((v) => v.file).filter(Boolean)),
        ),
        remediationPriority: Array.from(
          new Set(allViolations.map((v) => v.ruleId)),
        ),
        verificationCommand: "node scripts/common/validate-staged-slice.js",
        fastRecheckCommand: "node scripts/common/validate-staged-slice.js",
      },
    };
    console.log(JSON.stringify(envelope, null, 2));
    process.exit(1);
  }

  const fileGroups = new Map();
  for (const v of allViolations) {
    if (!fileGroups.has(v.file)) fileGroups.set(v.file, []);
    fileGroups.get(v.file).push(v);
  }

  for (const [rel, violations] of fileGroups) {
    console.error(`  ❌ [FAIL] ${rel}:`);
    for (const v of violations) {
      console.error(
        `     - L${v.line} [${v.ruleId}] ${v.message}${v.actionableFix ? " → 建议: " + v.actionableFix : ""}`,
      );
    }
  }

  console.error(
    `\n❌ [AST 切片审查阻断] 共发现 ${allViolations.length} 处关键架构/复杂度违规！请重构后重新提交。`,
  );
  process.exit(1);
}

/**
 * Render success message and exit cleanly.
 *
 * @param {boolean} isAgentMode - Autonomous Agent format flag.
 */
function renderSliceSuccess(isAgentMode) {
  if (isAgentMode) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: "1.0.0",
          status: "PASS",
          gate: "pre-commit:ast-slice",
          summary: "AST staged slice complexity review passed cleanly.",
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `  ✔ [PASS] 暂存区 AST 切片审查通过（圈复杂度 <= 15 [私有 <= 18, 分发器 <= 25], 嵌套 <= 4, 噪声比 <= 4.0）`,
    );
  }
  process.exit(0);
}

function run() {
  const { flags, explicitFiles } = parseCliFlags(process.argv.slice(2));
  const isAgentMode = Boolean(flags.agentMode);
  const hunkMap = getStagedHunkMap(explicitFiles);

  if (hunkMap.size === 0) {
    handleEmptyHunkMap(isAgentMode);
    return;
  }

  if (!isAgentMode) {
    console.log(
      `  ▶ 扫描暂存区 ${hunkMap.size} 个文件的 AST 局部切片 (支持 Hunk 精准切片与分发器/低爆炸半径弹性包络)...`,
    );
  }

  const allViolations = collectHunkSliceViolations(hunkMap, flags);
  if (allViolations.length > 0) {
    recordSliceFailureSnapshot(allViolations);
    renderSliceViolations(allViolations, isAgentMode);
    return;
  }

  renderSliceSuccess(isAgentMode);
}

if (require.main === module) {
  run();
}

module.exports = {
  DEFAULT_CONFIG,
  resolveConfig,
  isExportedFunction,
  calculateComplexity,
  hasLoopConstruct,
  checkNesting,
  validateFunctionName,
  analyzeFunction,
  analyzeSourceText,
  analyzeFile,
  run,
};
