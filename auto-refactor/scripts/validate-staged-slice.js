/**
 * Module: Verification Harness — Incremental AST Slice Review Gate
 * File Path: scripts/validate-staged-slice.js
 * Architecture Role: High-speed incremental static analysis hook for pre-commit.
 *   Scans staged TypeScript/JavaScript files to detect deep architectural anti-patterns:
 *   - Function cyclomatic complexity (> 15)
 *   - Control flow nesting depth (> 4)
 *   - Code dilution / noise index (kappa_noise > 4.0)
 * Dependencies & Triggers: Invoked by pre-commit-gate scripts (sh / ps1);
 *   uses TypeScript Compiler API and local scoring utilities.
 * Responsibilities: Enforce CC <= 15, depth <= 4, and noise index on staged slices.
 * Exit Semantics & Design Rationale: 0 = PASS (clean AST slice), 1 = FAIL on violations.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { execSync } = require('child_process');

const MAX_FUNCTION_COMPLEXITY = 15;
const MAX_NESTING_DEPTH = 4;
const MAX_NOISE_RATIO = 4.0;

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

function calculateComplexity(node) {
  let complexity = 1;
  function walk(n) {
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

  if (isBlock) {
    depth++;
    if (depth > maxObserved.val) {
      maxObserved.val = depth;
    }
  }

  ts.forEachChild(node, (child) => checkNesting(child, depth, maxObserved));
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
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

  const findings = [];

  if (noiseRatio > MAX_NOISE_RATIO && totalLines > 60) {
    findings.push({
      rule: 'HYG-DIL-001',
      severity: 'error',
      message: `代码稀释/注水指数超标 (kappa_noise = ${noiseRatio.toFixed(2)} > ${MAX_NOISE_RATIO})，有效代码行过低 (${eloc}/${totalLines})`,
      line: 1,
    });
  }

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      const complexity = calculateComplexity(node);
      const funcName = node.name ? node.name.getText(sourceFile) : '<anonymous>';
      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const lineNum = pos.line + 1;

      if (complexity > MAX_FUNCTION_COMPLEXITY) {
        findings.push({
          rule: 'ADV-CMP-001',
          severity: 'error',
          message: `函数 '${funcName}' 圈复杂度过高 (CC = ${complexity} > ${MAX_FUNCTION_COMPLEXITY})`,
          line: lineNum,
          suggestedFix: '拆分多分支判定为策略表或提取独立辅助纯函数',
        });
      }

      const maxNesting = { val: 0 };
      checkNesting(node, 0, maxNesting);
      if (maxNesting.val > MAX_NESTING_DEPTH) {
        findings.push({
          rule: 'ADV-NST-001',
          severity: 'error',
          message: `函数 '${funcName}' 控制流嵌套过深 (Depth = ${maxNesting.val} > ${MAX_NESTING_DEPTH})`,
          line: lineNum,
          suggestedFix: '采用卫语句 (Guard Clause) 提前返回以平铺嵌套分支',
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function run() {
  const explicitFiles = process.argv.slice(2);
  const targetFiles = getStagedFiles(explicitFiles);

  if (targetFiles.length === 0) {
    console.log('  ✔ [PASS] 暂存区无 TS/JS 源码需执行 AST 切片审查');
    process.exit(0);
  }

  console.log(`  ▶ 扫描暂存区 ${targetFiles.length} 个文件的 AST 切片...`);
  let totalErrors = 0;

  for (const file of targetFiles) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    const findings = analyzeFile(file);
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
    console.log(`  ✔ [PASS] 暂存区 AST 切片审查通过（圈复杂度 <= 15, 嵌套 <= 4, 噪声比 <= 4.0）`);
    process.exit(0);
  }
}

run();
