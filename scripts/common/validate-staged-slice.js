/**
 * Module: Verification Harness — Platform Incremental AST Slice Review Gate
 * File Path: scripts/common/validate-staged-slice.js
 * Architecture Role: High-speed platform-level incremental static analysis gate for pre-commit.
 *   Scans staged TypeScript/JavaScript files to detect architectural complexity anti-patterns:
 *   - Function cyclomatic complexity (> 15 base, elastic bonus up to 25 for flat dispatchers)
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

let ts;
const candidatePaths = [
  "typescript",
  path.resolve(__dirname, "../../auto-refactor/node_modules/typescript"),
  path.resolve(__dirname, "../../workspace-timing/node_modules/typescript"),
  path.resolve(__dirname, "../../node_modules/typescript"),
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
  flatDispatcherBonus: true,
  flatDispatcherMaxComplexity: 25,
  flatDispatcherMaxDepth: 2,
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

    const cfg = readJsonSafe(path.join(curr, "autoRefactor.config.json"));
    if (cfg?.thresholds) return cfg.thresholds;

    curr = path.dirname(curr);
  }
  return null;
}

/**
 * Resolves effective complexity configuration for a specific target file.
 */
function resolveConfig(filePath, overrides = {}) {
  const cfg = { ...DEFAULT_CONFIG };
  const projectCfg = findProjectConfig(filePath);
  if (projectCfg) {
    if (typeof projectCfg.maxFunctionComplexity === "number") {
      cfg.maxFunctionComplexity = projectCfg.maxFunctionComplexity;
    }
    if (typeof projectCfg.maxNestingDepth === "number") {
      cfg.maxNestingDepth = projectCfg.maxNestingDepth;
    }
    if (typeof projectCfg.maxNoiseRatio === "number") {
      cfg.maxNoiseRatio = projectCfg.maxNoiseRatio;
    }
    if (typeof projectCfg.flatDispatcherMaxComplexity === "number") {
      cfg.flatDispatcherMaxComplexity = projectCfg.flatDispatcherMaxComplexity;
    }
    if (typeof projectCfg.flatDispatcherBonus === "boolean") {
      cfg.flatDispatcherBonus = projectCfg.flatDispatcherBonus;
    }
  }

  const isProbe = /(?:archetype|parser|scanner|detector|lexer|tokenizer)/i.test(
    filePath,
  );
  const isTest = /(?:\.test\.|\.spec\.|scripts\/validate-|tests\/)/i.test(
    filePath,
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

  if (typeof overrides.maxFunctionComplexity === "number") {
    cfg.maxFunctionComplexity = overrides.maxFunctionComplexity;
  }
  if (typeof overrides.maxNestingDepth === "number") {
    cfg.maxNestingDepth = overrides.maxNestingDepth;
  }
  if (typeof overrides.maxNoiseRatio === "number") {
    cfg.maxNoiseRatio = overrides.maxNoiseRatio;
  }
  if (typeof overrides.flatDispatcherBonus === "boolean") {
    cfg.flatDispatcherBonus = overrides.flatDispatcherBonus;
  }
  if (typeof overrides.flatDispatcherMaxComplexity === "number") {
    cfg.flatDispatcherMaxComplexity = overrides.flatDispatcherMaxComplexity;
  }

  return cfg;
}

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
  if (!arg.startsWith("--")) {
    explicitFiles.push(arg);
  }
}

function parseCliFlags(args) {
  const flags = {};
  const explicitFiles = [];
  for (const arg of args) {
    parseSingleFlag(arg, flags, explicitFiles);
  }
  return { flags, explicitFiles };
}

function getGitEnv() {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: "NUL",
    GIT_CONFIG_SYSTEM: "NUL",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

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

function parseGitDiffHunks(raw, map) {
  let currentFile = null;
  let isCurrentNew = false;
  for (const line of raw.split("\n")) {
    if (line.startsWith("+++ b/")) {
      const rel = line.slice(6).trim();
      if (isEligibleSourcePath(rel)) {
        currentFile = path.resolve(rel);
        if (!map.has(currentFile)) {
          map.set(currentFile, {
            changedLines: new Set(),
            isNew: isCurrentNew,
          });
        }
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

function getStagedHunkMap(explicitFiles) {
  if (explicitFiles && explicitFiles.length > 0) {
    return mapFromExplicitFiles(explicitFiles);
  }

  const map = new Map();
  try {
    const raw = execSync("git diff --cached -U0 --diff-filter=ACM", {
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
      map.set(path.resolve(file), { changedLines: null, isNew: false });
    }
  }

  return map;
}

function getStagedFilesFallback() {
  try {
    const raw = execSync("git diff --cached --name-only --diff-filter=ACM", {
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

function isFunctionNode(n) {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n)
  );
}

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

function analyzeFunction(node, sourceFile, cfg) {
  const findings = [];
  const complexity = calculateComplexity(node);
  const funcName = node.name ? node.name.getText(sourceFile) : "<anonymous>";
  const pos = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  const lineNum = pos.line + 1;

  const maxNesting = { val: 0 };
  checkNesting(node, 0, maxNesting);

  const hasLoops = hasLoopConstruct(node);
  const isFlatDispatcher =
    cfg.flatDispatcherBonus &&
    maxNesting.val <= cfg.flatDispatcherMaxDepth &&
    !hasLoops;
  const effectiveMaxCC = isFlatDispatcher
    ? cfg.flatDispatcherMaxComplexity
    : cfg.maxFunctionComplexity;

  if (complexity > effectiveMaxCC) {
    const tag = isFlatDispatcher ? "平铺分发器上限" : "标准基线上限";
    findings.push({
      rule: "CPX-BUD-001",
      severity: "error",
      message: `函数 '${funcName}' 圈复杂度超标 (CC = ${complexity} > ${effectiveMaxCC}, ${tag})`,
      line: lineNum,
      suggestedFix: "拆分多分支判定为策略表或提取独立辅助纯函数",
    });
  }

  if (maxNesting.val > cfg.maxNestingDepth) {
    findings.push({
      rule: "CPX-NEST-001",
      severity: "error",
      message: `函数 '${funcName}' 控制流嵌套过深 (Depth = ${maxNesting.val} > ${cfg.maxNestingDepth})`,
      line: lineNum,
      suggestedFix: "采用卫语句 (Guard Clause) 提前返回以平铺嵌套分支",
    });
  }

  return findings;
}

function readStagedContentSafe(filePath) {
  const rel = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  try {
    return execSync(`git show :${rel}`, {
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

function run() {
  const { flags, explicitFiles } = parseCliFlags(process.argv.slice(2));
  const hunkMap = getStagedHunkMap(explicitFiles);

  if (hunkMap.size === 0) {
    console.log("  ✔ [PASS] 暂存区无 TS/JS 源码需执行 AST 切片审查");
    process.exit(0);
  }

  console.log(
    `  ▶ 扫描暂存区 ${hunkMap.size} 个文件的 AST 局部切片 (支持 Hunk 精准切片与分发器弹性包络)...`,
  );
  let totalErrors = 0;

  for (const [file, info] of hunkMap.entries()) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    const findings = analyzeFile(file, flags, info.changedLines);
    if (findings.length > 0) {
      console.error(`  ❌ [FAIL] ${rel}:`);
      for (const f of findings) {
        console.error(
          `     - L${f.line} [${f.rule}] ${f.message}${f.suggestedFix ? " → 建议: " + f.suggestedFix : ""}`,
        );
      }
      totalErrors += findings.length;
    }
  }

  if (totalErrors > 0) {
    console.error(
      `\n❌ [AST 切片审查阻断] 共发现 ${totalErrors} 处关键架构/复杂度违规！请重构后重新提交。`,
    );
    process.exit(1);
  } else {
    console.log(
      `  ✔ [PASS] 暂存区 AST 切片审查通过（圈复杂度 <= 15 [分发器 <= 25], 嵌套 <= 4, 噪声比 <= 4.0）`,
    );
    process.exit(0);
  }
}

if (require.main === module) {
  run();
}

module.exports = {
  DEFAULT_CONFIG,
  resolveConfig,
  calculateComplexity,
  hasLoopConstruct,
  checkNesting,
  analyzeSourceText,
  analyzeFile,
  run,
};
