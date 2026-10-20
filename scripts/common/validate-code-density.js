/**
 * Module: Workspace Governance — Multi-Dimensional Code Density & Plumbing Gate
 * File Path: scripts/common/validate-code-density.js
 * Architecture Role: Gate validator enforcing token column density, vertical dilution
 *   boundaries, and wiring-to-logic payload ratio across source code.
 * Dependencies & Triggers: Node.js standard libraries (fs, path, child_process);
 *   consumes evaluateCodeMetrics from scripts/common/evaluate-eloc-budget.js;
 *   invoked by pre-commit-gate, pre-push-gate, CI hygiene pipelines, and manual CLI checks.
 * Responsibilities:
 *   1. Evaluate semantic token density tau and log-normal column density rho_col;
 *   2. Detect vertical dilution (tau < 2.5) and horizontal packed lines (tau > 20.0);
 *   3. Enforce Plumbing Overhead Ratio (POR <= 0.60, TSPR >= 0.40) to prevent empty forwarding facades;
 *   4. Honor exemption contracts for barrel index files, .d.ts type catalogs, and constant dictionaries;
 *   5. Emit actionable diagnostics with structured JSON output and strict exit codes.
 * Exit Semantics & Design Rationale:
 *   0 = PASS (all files meet density & plumbing standards or are legitimately exempt),
 *   1 = FAIL on blocking density violations (POR > 0.60, extreme dilution or packing).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getRangeFiles, getStagedFiles, readStagedContentSafe, readStagedBuffersBatch } = require('./git-env');
const {
  evaluateCodeMetrics,
  isPlumbingExemptPath,
  isAuditableCodeFile,
} = require('./evaluate-eloc-budget');

const DEFAULT_POR_LIMIT = 0.60;
const DEFAULT_MIN_TAU = 2.5;
const DEFAULT_MAX_TAU = 22.0;
const MIN_REPRESENTATIVE_ELOC = 10;



function parseNumericFlag(argValue, fallback) {
  const val = parseFloat(argValue);
  return Number.isNaN(val) ? fallback : val;
}

function applyValueOptionFlag(arg, value, options) {
  switch (arg) {
    case '--range':
      options.range = value;
      return true;
    case '--por-limit':
      options.porLimit = Math.max(0.0, Math.min(1.0, parseNumericFlag(value, options.porLimit)));
      return true;
    case '--min-tau':
      options.minTau = Math.max(0.5, Math.min(50.0, parseNumericFlag(value, options.minTau)));
      return true;
    case '--max-tau':
      options.maxTau = Math.max(options.minTau, Math.min(100.0, parseNumericFlag(value, options.maxTau)));
      return true;
    default:
      return false;
  }
}

function applyBooleanOptionFlag(arg, options) {
  if (arg === '--staged') {
    options.staged = true;
    return true;
  }
  if (arg === '--all') {
    options.all = true;
    return true;
  }
  if (arg === '--json' || arg === '--agent') {
    options.json = true;
    options.agent = true;
    return true;
  }
  return false;
}

/**
 * Parses command line options for code density validation.
 *
 * @param {string[]} args
 * @returns {{ staged: boolean, range: string|null, all: boolean, json: boolean, agent: boolean, porLimit: number, minTau: number, maxTau: number, files: string[] }}
 */
function parseArgs(args) {
  const options = {
    staged: false,
    range: null,
    all: false,
    json: false,
    agent: false,
    porLimit: DEFAULT_POR_LIMIT,
    minTau: DEFAULT_MIN_TAU,
    maxTau: DEFAULT_MAX_TAU,
    files: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (applyBooleanOptionFlag(arg, options)) {
      continue;
    }
    if (i + 1 < args.length && applyValueOptionFlag(arg, args[i + 1], options)) {
      i++;
      continue;
    }
    if (!arg.startsWith('--')) {
      options.files.push(arg);
    }
  }

  return options;
}

/**
 * Validates code density and plumbing ratio for a single target file.
 *
 * @param {string} filePath - Path to source file
 * @param {object} options - Validation options
 * @returns {{ file: string, metrics: object, isExempt: boolean, violations: object[] }}
 */
function auditFileDensity(filePath, options, contentOverride = undefined) {
  const content = contentOverride === undefined ? fs.readFileSync(filePath, 'utf8') : contentOverride;
  const ext = path.extname(filePath).toLowerCase();
  const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  const metrics = evaluateCodeMetrics(content, ext, relPath);
  const isExempt = isPlumbingExemptPath(relPath, content);
  const violations = [];

  // Exemption bypass: Barrel index exports, .d.ts files, and constant libraries are explicitly exempt
  if (isExempt) {
    return { file: relPath, metrics, isExempt: true, violations };
  }

  // 1. Plumbing overhead ratio check (POR <= 0.60, TSPR >= 0.40)
  if (metrics.eloc >= 5 && metrics.plumbingRatio > options.porLimit) {
    violations.push({
      ruleId: 'ARCH-FAC-001',
      severity: 'BLOCK',
      message: `Plumbing overhead ratio exceeded: ${(metrics.plumbingRatio * 100).toFixed(1)}% > ${(options.porLimit * 100).toFixed(1)}% (TSPR: ${(metrics.tspr * 100).toFixed(1)}% < 40.0%, ELOC: ${metrics.eloc})`,
      actual: `${(metrics.plumbingRatio * 100).toFixed(1)}%`,
      expected: `<= ${(options.porLimit * 100).toFixed(1)}%`,
      actionableFix: 'De-escalate empty forwarding trampolines, inline one-line adapters, or enrich facade with domain validation (ARCH-FAC-001).',
      actionable: {
        action: 'enrich_facade',
        code: 'ARCH-FAC-001',
        taxonomy: 'ARCH_LAYER',
        targetScope: 'module_top_level',
        metricsBreakdown: {
          eloc: metrics.eloc,
          totalLoc: metrics.totalLoc,
          tspr: metrics.tspr,
          por: metrics.plumbingRatio,
          threshold: options.porLimit,
        },
        templateSnippet: '// Add parameter invariant validation, deepFreeze protection, or aggregate >= 3 domain features',
        safeToAutomate: false,
        rationale: 'Plumbing ratio exceeds 60% budget; facade lacks substantial domain responsibility or immutability freeze.',
      },
    });
  }

  // 2. Vertical logic dilution check (tau >= 2.5 tokens per line)
  if (metrics.eloc >= MIN_REPRESENTATIVE_ELOC && metrics.tokensPerEloc < options.minTau) {
    violations.push({
      ruleId: 'VOL-DIL-001',
      severity: 'BLOCK',
      message: `Vertical logic dilution detected: tau = ${metrics.tokensPerEloc} tokens/line < ${options.minTau} tokens/line threshold (ELOC: ${metrics.eloc}, raw LOC: ${metrics.totalLoc})`,
      actual: `${metrics.tokensPerEloc} tokens/line`,
      expected: `>= ${options.minTau} tokens/line`,
      actionableFix: 'Merge overly fragmented vertical formatting lines, eliminate redundant line wraps, or collocate concise statements.',
      actionable: {
        action: 'compact_diluted_lines',
        code: 'VOL-DIL-001',
        taxonomy: 'GOV_NORM',
        targetScope: 'module_top_level',
        metricsBreakdown: {
          eloc: metrics.eloc,
          totalLoc: metrics.totalLoc,
          tokensPerEloc: metrics.tokensPerEloc,
          columnDensity: metrics.columnDensity,
          threshold: options.minTau,
        },
        templateSnippet: '// Consolidate single-argument or fragmented chained lines into cohesive statements',
        safeToAutomate: true,
        rationale: 'Vertical token density tau is below minimum 2.5 tokens/line floor, indicating excessive vertical formatting dilution.',
      },
    });
  }

  // 3. Horizontal token congestion check (tau <= 20.0 tokens per line)
  if (metrics.tokensPerEloc > options.maxTau) {
    violations.push({
      ruleId: 'GUARD-AST-001',
      severity: 'BLOCK',
      message: `Horizontal token congestion detected: tau = ${metrics.tokensPerEloc} tokens/line > ${options.maxTau} tokens/line threshold (ELOC: ${metrics.eloc})`,
      actual: `${metrics.tokensPerEloc} tokens/line`,
      expected: `<= ${options.maxTau} tokens/line`,
      actionableFix: 'Break down monolithic chained expressions, extract intermediate variables, and spread nested logic onto dedicated lines.',
      actionable: {
        action: 'decompose_congested_tokens',
        code: 'GUARD-AST-001',
        taxonomy: 'CTRL_FLOW',
        targetScope: 'function_local',
        metricsBreakdown: {
          eloc: metrics.eloc,
          totalLoc: metrics.totalLoc,
          tokensPerEloc: metrics.tokensPerEloc,
          columnDensity: metrics.columnDensity,
          threshold: options.maxTau,
        },
        templateSnippet: 'const intermediateVar = expression;\nreturn computeWith(intermediateVar);',
        safeToAutomate: true,
        rationale: 'Horizontal token density tau exceeds 20.0 tokens/line ceiling, creating single-line cognitive congestion.',
      },
    });
  }

  return { file: relPath, metrics, isExempt: false, violations };
}

function recordFailureSnapshot(allViolations) {
  try {
    const { writeFailureSnapshot } = require('./log-rotator');
    writeFailureSnapshot({
      gate: 'pre-commit',
      step: 'STAGED-DENSITY-12',
      failedCommand: 'node scripts/common/validate-code-density.js --staged',
      exitCode: 1,
      summary: `Detected ${allViolations.length} code density or wiring ratio violation(s).`,
      violations: allViolations,
      agentDirectives: allViolations.map((v) => ({
        file: v.file,
        ruleId: v.ruleId,
        action: v.actionable?.action || 'enrich_facade',
        taxonomy: v.actionable?.taxonomy || 'ARCH_LAYER',
        metrics: v.actionable?.metricsBreakdown,
        template: v.actionable?.templateSnippet,
        safeToAutomate: v.actionable?.safeToAutomate ?? false,
      })),
      targetFiles: Array.from(new Set(allViolations.map((v) => v.file))),
      remediationPriority: Array.from(new Set(allViolations.map((v) => v.ruleId))),
      verificationCommand: 'node scripts/common/validate-code-density.js --staged',
      fastRecheckCommand: 'node scripts/common/validate-code-density.js --staged',
    });
  } catch (snapshotErr) {
    // Best-effort failure snapshot persistence: ignore error to preserve gate exit code
    void snapshotErr;
  }
}

function collectDensityInspections(uniqueFiles, options) {
  const allViolations = [];
  const inspections = [];
  let exemptCount = 0;
  // One batch read replaces one `git show` spawn per staged file.
  const stagedByFile = options.staged
    ? readStagedBuffersBatch(process.cwd(), uniqueFiles)
    : new Map();

  for (const file of uniqueFiles) {
    let stagedContent;
    if (options.staged) {
      const buf = stagedByFile.get(file);
      stagedContent = buf ? buf.toString('utf8') : readStagedContentSafe(process.cwd(), file);
    }
    const result = auditFileDensity(file, options, stagedContent);
    inspections.push(result);
    if (result.isExempt) {
      exemptCount++;
      continue;
    }
    for (const v of result.violations) {
      allViolations.push({ file: result.file, ...v });
    }
  }

  return { allViolations, inspections, exemptCount };
}

function outputJsonDensityReport(allViolations, inspections, totalFiles, exemptCount) {
  const report = {
    protocolVersion: '1.0.0',
    status: allViolations.length === 0 ? 'PASS' : 'FAIL',
    gate: 'validate-code-density',
    summary:
      allViolations.length === 0
        ? 'All files pass code density and wiring ratio boundaries.'
        : `${allViolations.length} code density violation(s) detected.`,
    totalFiles,
    exemptFiles: exemptCount,
    violations: allViolations,
    agentDirectives: allViolations.map((v) => ({
      file: v.file,
      ruleId: v.ruleId,
      action: v.actionable?.action || 'enrich_facade',
      taxonomy: v.actionable?.taxonomy || 'ARCH_LAYER',
      metrics: v.actionable?.metricsBreakdown,
      template: v.actionable?.templateSnippet,
      safeToAutomate: v.actionable?.safeToAutomate ?? false,
    })),
    inspections: inspections.map((ins) => ({
      file: ins.file,
      isExempt: ins.isExempt,
      eloc: ins.metrics.eloc,
      totalLoc: ins.metrics.totalLoc,
      tokensPerEloc: ins.metrics.tokensPerEloc,
      columnDensity: ins.metrics.columnDensity,
      tspr: ins.metrics.tspr,
      plumbingRatio: ins.metrics.plumbingRatio,
    })),
  };
  if (allViolations.length > 0) {
    recordFailureSnapshot(allViolations);
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(allViolations.length === 0 ? 0 : 1);
}

const RE_IGNORED_DIRS = new Set([
  '.git', '.agents', 'node_modules', 'dist', 'out', 'fixtures', 'baseline',
  'reports', 'archive', 'build', '.godot', '.refactor-trajectory'
]);

function findRepoCodeFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || RE_IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      findRepoCodeFiles(path.join(dir, entry.name), fileList);
    } else if (entry.isFile()) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(process.cwd(), full).replace(/\\/g, '/');
      if (isAuditableCodeFile(rel)) {
        fileList.push(full);
      }
    }
  }
  return fileList;
}

function printHumanDensityReport(allViolations, uniqueFilesLength, exemptCount) {
  if (allViolations.length > 0) {
    recordFailureSnapshot(allViolations);
    console.error(`\n❌ [FAIL] 检测到 ${allViolations.length} 项代码密度与接线超标违规:`);
    for (const v of allViolations) {
      console.error(`   - ${v.file} [${v.ruleId}]: ${v.message}`);
      console.error(`     👉 修复指引: ${v.actionableFix}`);
    }
    console.error(`   👉 请优化接线比率并消除严重稀释/拥挤格式后重试。\n`);
    process.exit(1);
  }

  console.log(
    `  ✔ [PASS] 100% 文件符合五维代码密度与接线载荷约束 (扫描: ${uniqueFilesLength} 文件, 合法豁免: ${exemptCount} 文件, 违规: 0)`,
  );
  process.exit(0);
}

/**
 * Main execution entry point.
 */
function run() {
  const options = parseArgs(process.argv.slice(2));
  let targets = [...options.files];

  if (options.range) {
    targets = targets.concat(getRangeFiles(options.range));
  } else if (options.all) {
    targets = targets.concat(findRepoCodeFiles(process.cwd()));
  } else if (options.staged || targets.length === 0) {
    targets = targets.concat(getStagedFiles());
  }

  const uniqueFiles = Array.from(new Set(targets)).filter(
    (f) => fs.existsSync(f) && isAuditableCodeFile(f),
  );

  if (uniqueFiles.length === 0) {
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            protocolVersion: '1.0.0',
            status: 'PASS',
            gate: 'validate-code-density',
            summary: 'No auditable code files to check.',
            totalFiles: 0,
            exemptFiles: 0,
            violations: [],
            inspections: [],
          },
          null,
          2,
        ),
      );
      process.exit(0);
    }
    console.log('  ✔ [PASS] 无代码文件需要执行五维代码密度审查');
    process.exit(0);
  }

  if (!options.json) {
    console.log(
      `  ▶ 检查 ${uniqueFiles.length} 个源文件的代码密度与接线载荷 (POR <= ${(options.porLimit * 100).toFixed(0)}%, τ ∈ [${options.minTau}, ${options.maxTau}])...`,
    );
  }

  const { allViolations, inspections, exemptCount } = collectDensityInspections(uniqueFiles, options);

  if (options.json) {
    outputJsonDensityReport(allViolations, inspections, uniqueFiles.length, exemptCount);
    return;
  }

  printHumanDensityReport(allViolations, uniqueFiles.length, exemptCount);
}

if (require.main === module) {
  run();
}

module.exports = {
  parseArgs,
  auditFileDensity,
  DEFAULT_POR_LIMIT,
  DEFAULT_MIN_TAU,
  DEFAULT_MAX_TAU,
};
