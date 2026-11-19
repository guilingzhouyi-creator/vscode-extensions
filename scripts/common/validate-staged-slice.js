/**
 * Module: Verification Harness — Platform Incremental AST Slice Review Gate
 * File Path: scripts/common/validate-staged-slice.js
 * Architecture Role: High-speed platform-level incremental static analysis gate for pre-commit.
 *   Scans staged TypeScript/JavaScript files to detect architectural complexity anti-patterns:
 *   - Function cyclomatic complexity (> 15 base, elastic bonus up to 18 for low blast radius, up to 25 for flat dispatchers)
 *   - Control flow nesting depth (> 4)
 *   - Code dilution / noise index (kappa_noise > 4.0)
 * Dependencies & Triggers: Invoked by pre-commit-gate scripts (sh / ps1) and CI hygiene jobs;
 *   delegates AST traversal and complexity computation to lib/staged-slice-analyzers.js.
 * Responsibilities: Enforce CC <= 15 (elastic), depth <= 4, and noise ratio on staged slices.
 * Exit Semantics & Design Rationale: 0 = PASS (clean AST slice), 1 = FAIL on violations.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");
const {
  getSafeGitEnv,
  readStagedBuffersBatch,
  getStagedFiles: queryStagedFiles,
} = require("./git-env");
const analyzers = require("./lib/staged-slice-analyzers");

const REPO_ROOT = path.resolve(__dirname, "../..");

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

const CONFIG_OVERRIDE_FIELDS = [
  ["maxFunctionComplexity", "number"],
  ["maxNestingDepth", "number"],
  ["maxNoiseRatio", "number"],
  ["minFunctionNameLength", "number"],
  ["maxFunctionNameLength", "number"],
  ["flatDispatcherBonus", "boolean"],
  ["flatDispatcherMaxComplexity", "number"],
  ["lowBlastRadiusBonus", "boolean"],
  ["lowBlastRadiusMaxComplexity", "number"],
  ["lowBlastRadiusMaxDepth", "number"],
];

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
 *
 * @param {string} filePath - Target source file path
 * @returns {Record<string, any>|null} Discovered threshold overrides or null
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
 *
 * @param {Record<string, any>} cfg - Mutable configuration object
 * @param {Record<string, any>|null} source - Override source object
 */
function applyConfigOverrides(cfg, source) {
  if (!source) return;
  for (const [field, expectedType] of CONFIG_OVERRIDE_FIELDS) {
    if (typeof source[field] === expectedType) {
      cfg[field] = source[field];
    }
  }
}

/**
 * Resolves effective complexity configuration for a specific target file.
 *
 * @param {string} filePath - Target source file path
 * @param {Record<string, any>} [overrides] - Explicit override flags
 * @returns {Record<string, any>} Effective configuration
 */
function resolveConfig(filePath, overrides = {}) {
  const cfg = { ...DEFAULT_CONFIG };
  applyConfigOverrides(cfg, findProjectConfig(filePath));

  const normalized = filePath.replace(/\\/g, "/");
  const isProbe = /(?:archetype|parser|scanner|detector|lexer|tokenizer)/i.test(normalized);
  const isTest = /(?:\.test\.|\.spec\.|scripts\/(?:common\/)?validate-|tests\/)/i.test(normalized);
  if (isProbe) {
    cfg.maxFunctionComplexity = Math.max(cfg.maxFunctionComplexity, cfg.probeMaxComplexity);
  } else if (isTest) {
    cfg.maxFunctionComplexity = Math.max(cfg.maxFunctionComplexity, cfg.testMaxComplexity);
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
  } else if (arg.startsWith("--max-depth=")) {
    flags.maxNestingDepth = parseInt(arg.slice(12), 10);
  } else if (arg.startsWith("--max-noise=")) {
    flags.maxNoiseRatio = parseFloat(arg.slice(12));
  } else if (arg === "--no-flat-bonus") {
    flags.flatDispatcherBonus = false;
  } else if (arg === "--no-blast-bonus") {
    flags.lowBlastRadiusBonus = false;
  } else if (arg === "--agent" || arg === "-a" || arg === "--json") {
    flags.agentMode = true;
  } else if (!arg.startsWith("-")) {
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
 * Parses a unified diff hunk header and populates changed line index.
 *
 * @param {string} line - Unified diff hunk header line
 * @param {string} currentFile - Absolute path of the file currently parsed
 * @param {Map<string, { changedLines: Set<number>, isNew: boolean }>} map - Result accumulator map
 */
function parseHunkLine(line, currentFile, map) {
  const match = line.match(/@@\s+-[0-9]+(?:,[0-9]+)?\s+\+([0-9]+)(?:,([0-9]+))?\s+@@/);
  if (!match) return;
  const start = parseInt(match[1], 10);
  const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;
  const entry = map.get(currentFile);
  if (!entry || !entry.changedLines) return;
  if (count === 0) {
    entry.changedLines.add(start);
    return;
  }
  for (let i = 0; i < count; i++) {
    entry.changedLines.add(start + i);
  }
}

/**
 * Checks whether a repo-relative path is eligible for TS/JS AST slice review.
 *
 * @param {string} rel - Repo-relative POSIX path
 * @returns {boolean}
 */
function isEligibleSourcePath(rel) {
  if (!rel.endsWith(".ts") && !rel.endsWith(".js")) return false;
  if (rel.endsWith(".d.ts")) return false;
  if (rel.includes("dist/") || rel.includes("out/") || rel.includes("fixtures/")) {
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
    if ((f.endsWith(".ts") || f.endsWith(".js")) && !f.endsWith(".d.ts") && fs.existsSync(f)) {
      map.set(path.resolve(f), { changedLines: null, isNew: false });
    }
  }
  return map;
}

/**
 * Parses raw git diff text into per-file changed line intervals.
 *
 * @param {string} raw - Raw unified diff output
 * @param {Map<string, { changedLines: Set<number>, isNew: boolean }>} map - Map populated with changed lines
 */
function parseGitDiffHunks(raw, map) {
  let currentFile = null;
  let isCurrentNew = false;
  for (const line of raw.split("\n")) {
    if (line.startsWith("+++ b/")) {
      const rel = line.slice(6).trim();
      if (isEligibleSourcePath(rel)) {
        currentFile = path.resolve(REPO_ROOT, rel);
        if (!map.has(currentFile)) {
          map.set(currentFile, { changedLines: new Set(), isNew: isCurrentNew });
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

/**
 * Lists staged TS/JS sources through the shared Git provider.
 *
 * @returns {string[]} Repo-relative staged source paths.
 */
function getStagedFilesSafe() {
  return queryStagedFiles(REPO_ROOT, undefined, { strict: true }).filter(
    (f) =>
      isEligibleSourcePath(f) && fs.existsSync(path.resolve(REPO_ROOT, f)),
  );
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
      env: getSafeGitEnv(REPO_ROOT),
    });
    parseGitDiffHunks(raw, map);
  } catch (gitErr) {
    // Hunk diff is an optimisation; the filename fallback below still covers the index.
    void gitErr;
  }

  if (map.size === 0) {
    for (const file of getStagedFilesSafe()) {
      map.set(path.resolve(REPO_ROOT, file), { changedLines: null, isNew: false });
    }
  }

  return map;
}

const { ts, isFunctionNode, isExportedFunction, calculateComplexity, hasLoopConstruct, checkNesting, calculateElocAndNoise, resolveComplexityCeiling, validateFunctionName, analyzeFunction } = analyzers;

function readStagedContentSafe(filePath) {
  const rel = path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
  try {
    // Argument array: a staged filename containing shell metacharacters stays a single path.
    return execFileSync("git", ["show", `:${rel}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      env: getGitEnv(),
    });
  } catch {
    return fs.readFileSync(filePath, "utf8");
  }
}

/**
 * Reads every staged blob under review in a single Git process.
 *
 * Without this, each reviewed file costs its own `git show` spawn, which
 * dominates wall time once a commit touches more than a handful of modules.
 *
 * @param {string[]} filePaths - Absolute or repo-relative paths.
 * @returns {Map<string, string>} Absolute path -> staged text content.
 */
function prefetchStagedContents(filePaths) {
  const result = new Map();
  if (!Array.isArray(filePaths) || filePaths.length === 0) return result;

  const relByPath = new Map();
  for (const p of filePaths) {
    relByPath.set(p, path.relative(REPO_ROOT, p).replace(/\\/g, "/"));
  }

  let buffers;
  try {
    buffers = readStagedBuffersBatch(REPO_ROOT, [...relByPath.values()]);
  } catch {
    return result;
  }

  for (const [absPath, rel] of relByPath.entries()) {
    const buf = buffers.get(rel);
    if (buf) result.set(absPath, buf.toString("utf8"));
  }
  return result;
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
      rule: "GUARD-AST-001",
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

function analyzeFile(filePath, overrides = {}, changedLines = null, prefetched = null) {
  const cached = prefetched && prefetched.get(filePath);
  const content = cached !== undefined ? cached : readStagedContentSafe(filePath);
  return analyzeSourceText(content, filePath, overrides, changedLines);
}

/**
 * Handle early exit when no staged TS/JS files require review.
 *
 * @param {boolean} isAgentMode - Autonomous Agent format flag.
 */
/**
 * Reads the staged hunk map, blocking when the repository cannot be enumerated.
 *
 * An unreadable index and an empty index both yield no files, but only the second is a legitimate
 * pass. Treating the first as empty would report a clean review that never happened.
 *
 * @param {string[]} explicitFiles - Explicit CLI targets.
 * @param {boolean} isAgentMode - Autonomous Agent format flag.
 * @returns {Map<string, { changedLines: Set<number>|null, isNew: boolean }>} Mapped staged files.
 */
function readStagedHunkMapOrBlock(explicitFiles, isAgentMode) {
  try {
    return getStagedHunkMap(explicitFiles);
  } catch (err) {
    if (isAgentMode) {
      console.log(JSON.stringify({ protocolVersion: "1.0.0", status: "BLOCK", gate: "pre-commit:ast-slice", summary: err.message }, null, 2));
    } else {
      console.error(`  ✖ BLOCK  ${err.message}`);
      console.error("  👉 修复指引: 确认当前目录是完整 Git 仓库（git status 可用），或显式传入文件路径跳过索引枚举。");
    }
    process.exit(1);
  }
}

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
    console.log("  ✔ 暂存区无 TS/JS 源码需执行 AST 切片审查");
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
  const prefetched = prefetchStagedContents([...hunkMap.keys()]);
  for (const [file, info] of hunkMap.entries()) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
    const findings = analyzeFile(file, flags, info.changedLines, prefetched);
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
      step: "STAGED-SLICE-11",
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
      step: "STAGED-SLICE-11",
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
    console.error(`  ✖ BLOCK ${rel}:`);
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
      `  ✔ 暂存区 AST 切片审查通过（圈复杂度 <= 15 [私有 <= 18, 分发器 <= 25], 嵌套 <= 4, 噪声比 <= 4.0）`,
    );
  }
  process.exit(0);
}

function run() {
  const { flags, explicitFiles } = parseCliFlags(process.argv.slice(2));
  const isAgentMode = Boolean(flags.agentMode);
  const hunkMap = readStagedHunkMapOrBlock(explicitFiles, isAgentMode);

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
  isEligibleSourcePath,
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
