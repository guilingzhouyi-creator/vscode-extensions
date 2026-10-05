/**
 * Module: Verification Harness — Incremental AST Slice Review Gate
 * File Path: scripts/validate-staged-slice.js
 * Architecture Role: High-speed incremental static analysis hook for pre-commit.
 *   Scans staged TypeScript/JavaScript files to detect deep architectural anti-patterns:
 *   - Function cyclomatic complexity (> 15 base, elastic bonus up to 25 for flat dispatchers)
 *   - Control flow nesting depth (> 4)
 *   - Code dilution / noise index (kappa_noise > 4.0)
 * Dependencies & Triggers: Invoked by pre-commit-gate scripts (sh / ps1);
 *   uses TypeScript Compiler API and local scoring utilities.
 * Responsibilities: Enforce CC <= 15 (elastic), depth <= 4, and noise index on staged slices.
 * Exit Semantics & Design Rationale: 0 = PASS (clean AST slice), 1 = FAIL on violations.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let ts;
try {
  ts = require('typescript');
} catch {
  try {
    ts = require(path.resolve(__dirname, '../node_modules/typescript'));
  } catch {
    try {
      ts = require(path.resolve(__dirname, '../../workspace-timing/node_modules/typescript'));
    } catch {
      ts = null;
    }
  }
}

if (!ts) {
  console.log('  ℹ️ [NOTICE] 未检测到 typescript 运行环境，跳过 AST 局部切片审查');
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

/**
 * Searches upwards for project configuration files with complexity overrides.
 */
function findProjectConfig(filePath) {
  let curr = path.dirname(path.resolve(filePath));
  const root = path.parse(curr).root;
  while (curr && curr !== root) {
    const pkgPath = path.join(curr, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const gov = pkg.governance?.complexity || pkg.governance?.astSlice;
        if (gov) return gov;
      } catch {
        // ignore JSON parse errors
      }
    }
    const cfgPath = path.join(curr, 'autoRefactor.config.json');
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const thresh = cfg.thresholds;
        if (thresh) return thresh;
      } catch {
        // ignore JSON parse errors
      }
    }
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
    if (typeof projectCfg.maxFunctionComplexity === 'number') {
      cfg.maxFunctionComplexity = projectCfg.maxFunctionComplexity;
    }
    if (typeof projectCfg.maxNestingDepth === 'number') {
      cfg.maxNestingDepth = projectCfg.maxNestingDepth;
    }
    if (typeof projectCfg.maxNoiseRatio === 'number') {
      cfg.maxNoiseRatio = projectCfg.maxNoiseRatio;
    }
    if (typeof projectCfg.flatDispatcherMaxComplexity === 'number') {
      cfg.flatDispatcherMaxComplexity = projectCfg.flatDispatcherMaxComplexity;
    }
    if (typeof projectCfg.flatDispatcherBonus === 'boolean') {
      cfg.flatDispatcherBonus = projectCfg.flatDispatcherBonus;
    }
  }

  const isProbe = /(?:archetype|parser|scanner|detector|lexer|tokenizer)/i.test(filePath);
  const isTest = /(?:\.test\.|\.spec\.|scripts\/validate-|tests\/)/i.test(filePath);
  if (isProbe) {
    cfg.maxFunctionComplexity = Math.max(cfg.maxFunctionComplexity, cfg.probeMaxComplexity);
  } else if (isTest) {
    cfg.maxFunctionComplexity = Math.max(cfg.maxFunctionComplexity, cfg.testMaxComplexity);
  }

  if (typeof overrides.maxFunctionComplexity === 'number') {
    cfg.maxFunctionComplexity = overrides.maxFunctionComplexity;
  }
  if (typeof overrides.maxNestingDepth === 'number') {
    cfg.maxNestingDepth = overrides.maxNestingDepth;
  }
  if (typeof overrides.maxNoiseRatio === 'number') {
    cfg.maxNoiseRatio = overrides.maxNoiseRatio;
  }
  if (typeof overrides.flatDispatcherBonus === 'boolean') {
    cfg.flatDispatcherBonus = overrides.flatDispatcherBonus;
  }
  if (typeof overrides.flatDispatcherMaxComplexity === 'number') {
    cfg.flatDispatcherMaxComplexity = overrides.flatDispatcherMaxComplexity;
  }

  return cfg;
}

function parseSingleFlag(arg, flags, explicitFiles) {
  if (arg.startsWith('--max-cc=')) {
    flags.maxFunctionComplexity = parseInt(arg.slice(9), 10);
    return;
  }
  if (arg.startsWith('--max-depth=')) {
    flags.maxNestingDepth = parseInt(arg.slice(12), 10);
    return;
  }
  if (arg.startsWith('--max-noise=')) {
    flags.maxNoiseRatio = parseFloat(arg.slice(12));
    return;
  }
  if (arg === '--no-flat-bonus') {
    flags.flatDispatcherBonus = false;
    return;
  }
  if (!arg.startsWith('--')) {
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

function getStagedFiles(explicitFiles) {
  if (explicitFiles && explicitFiles.length > 0) {
    return explicitFiles.filter(
      (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts') && fs.existsSync(f),
    );
  }
  try {
    const raw = execSync('git diff --cached --name-only --diff-filter=ACM', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter(
        (f) =>
          f.length > 0 &&
          (f.endsWith('.ts') || f.endsWith('.js')) &&
          !f.endsWith('.d.ts') &&
          !f.includes('dist/') &&
          !f.includes('out/') &&
          !f.includes('fixtures/') &&
          fs.existsSync(f),
      );
  } catch {
    return [];
  }
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
    } else if (ts.isBinaryExpression(n) && LOGICAL_BINARY_OPS.has(n.operatorToken.kind)) {
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
    if (
      n.kind === ts.SyntaxKind.ForStatement ||
      n.kind === ts.SyntaxKind.ForInStatement ||
      n.kind === ts.SyntaxKind.ForOfStatement ||
      n.kind === ts.SyntaxKind.WhileStatement ||
      n.kind === ts.SyntaxKind.DoStatement
    ) {
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
  const isBlock =
    node.kind === ts.SyntaxKind.IfStatement ||
    node.kind === ts.SyntaxKind.ForStatement ||
    node.kind === ts.SyntaxKind.ForInStatement ||
    node.kind === ts.SyntaxKind.ForOfStatement ||
    node.kind === ts.SyntaxKind.WhileStatement ||
    node.kind === ts.SyntaxKind.DoStatement ||
    node.kind === ts.SyntaxKind.TryStatement ||
    node.kind === ts.SyntaxKind.SwitchStatement;

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
  const lines = content.split('\n');
  const totalLines = lines.length;
  let eloc = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.length > 0 &&
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('/*') &&
      !trimmed.startsWith('*')
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
  const funcName = node.name ? node.name.getText(sourceFile) : '<anonymous>';
  const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const lineNum = pos.line + 1;

  const maxNesting = { val: 0 };
  checkNesting(node, 0, maxNesting);

  const hasLoops = hasLoopConstruct(node);
  const isFlatDispatcher =
    cfg.flatDispatcherBonus && maxNesting.val <= cfg.flatDispatcherMaxDepth && !hasLoops;
  const effectiveMaxCC = isFlatDispatcher
    ? cfg.flatDispatcherMaxComplexity
    : cfg.maxFunctionComplexity;

  if (complexity > effectiveMaxCC) {
    const tag = isFlatDispatcher ? '平铺分发器上限' : '标准基线上限';
    findings.push({
      rule: 'CPX-BUD-001',
      severity: 'error',
      message: `函数 '${funcName}' 圈复杂度超标 (CC = ${complexity} > ${effectiveMaxCC}, ${tag})`,
      line: lineNum,
      suggestedFix: '拆分多分支判定为策略表或提取独立辅助纯函数',
    });
  }

  if (maxNesting.val > cfg.maxNestingDepth) {
    findings.push({
      rule: 'CPX-NEST-001',
      severity: 'error',
      message: `函数 '${funcName}' 控制流嵌套过深 (Depth = ${maxNesting.val} > ${cfg.maxNestingDepth})`,
      line: lineNum,
      suggestedFix: '采用卫语句 (Guard Clause) 提前返回以平铺嵌套分支',
    });
  }

  return findings;
}

function analyzeSourceText(content, filePath = 'anonymous.ts', overrides = {}) {
  const cfg = resolveConfig(filePath, overrides);
  const isJs = filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs');
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    isJs ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );

  const { totalLines, eloc, noiseRatio } = calculateElocAndNoise(content);
  const findings = [];

  if (noiseRatio > cfg.maxNoiseRatio && totalLines > 60) {
    findings.push({
      rule: 'GATE-AST-001',
      severity: 'error',
      message: `代码稀释/注水指数超标 (kappa_noise = ${noiseRatio.toFixed(2)} > ${cfg.maxNoiseRatio})，有效代码行过低 (${eloc}/${totalLines})`,
      line: 1,
    });
  }

  function visit(node) {
    if (isFunctionNode(node)) {
      const fnFindings = analyzeFunction(node, sourceFile, cfg);
      findings.push(...fnFindings);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function analyzeFile(filePath, overrides = {}) {
  const content = fs.readFileSync(filePath, 'utf8');
  return analyzeSourceText(content, filePath, overrides);
}

function run() {
  const { flags, explicitFiles } = parseCliFlags(process.argv.slice(2));
  const targetFiles = getStagedFiles(explicitFiles);

  if (targetFiles.length === 0) {
    console.log('  ✔ [PASS] 暂存区无 TS/JS 源码需执行 AST 切片审查');
    process.exit(0);
  }

  console.log(`  ▶ 扫描暂存区 ${targetFiles.length} 个文件的 AST 切片 (支持分发器弹性包络)...`);
  let totalErrors = 0;

  for (const file of targetFiles) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    const findings = analyzeFile(file, flags);
    if (findings.length > 0) {
      console.error(`  ❌ [FAIL] ${rel}:`);
      for (const f of findings) {
        console.error(
          `     - L${f.line} [${f.rule}] ${f.message}${f.suggestedFix ? ' → 建议: ' + f.suggestedFix : ''}`,
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
