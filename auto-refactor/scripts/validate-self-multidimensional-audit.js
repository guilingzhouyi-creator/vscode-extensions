/**
 * Module: Verification Harness — Multidimensional Self-Audit Guard
 * File Path: scripts/validate-self-multidimensional-audit.js
 * Architecture Role: Single-source-of-truth verification guard for auto-refactor's self-contained
 *   codebase health: LOC budgets, Shannon entropy, AST syntax density, boundary interoperability,
 *   and multi-profile scoring precision.
 * Dependencies & Triggers: `npm run audit:self` or `npm test`; imports dist scoring modules,
 *   TypeScript compiler API, and scans src/**\/*.ts.
 * Responsibilities:
 *   1. Gate 1 (LOC Budget Guard): Strict assertion that 0 files in src/ exceed 900 LOC.
 *   2. Gate 2 (Shannon Entropy Guard): Information entropy verification across all source files
 *      (>= 3.0 bits/char, mean in [3.5, 6.5]) to guard against degeneration and obfuscation.
 *   3. Gate 3 (AST / LOC Density Guard): Validates AST node-to-LOC syntax density within [0.5, 40.0].
 *   4. Gate 4 (Boundary Interoperability Guard): Unidirectional layer decoupling; ensures zero
 *      reverse imports from src/core/ to cli/ or api (BIF = 100.0%).
 *   5. Gate 5 (Profile Scoring Precision Guard): Validates mass preservation, finite reproducibility,
 *      and domain-specific bias asymmetry for frontend, backend, and composite review profiles.
 * Exit Semantics & Design Rationale: Modular function decomposition (< 10 cyclomatic complexity per
 *   function); process exits 0 if all 5 gates pass, 1 on regression.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const MAX_LOC_BUDGET = 900;

function getAllTsFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function calculateShannonEntropy(str) {
  if (!str || str.length === 0) return 0;
  const freq = {};
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    freq[ch] = (freq[ch] || 0) + 1;
  }
  let entropy = 0;
  const len = str.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function auditLocBudget(allFiles) {
  console.log('[Gate 1] LOC Budget Guard (Max <= 900 LOC)');
  const fileLocs = [];
  const overBudgetFiles = [];

  for (const filePath of allFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const loc = content.split('\n').length;
    const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
    fileLocs.push({ relPath, loc });
    if (loc >= MAX_LOC_BUDGET) {
      overBudgetFiles.push({ relPath, loc });
    }
  }

  fileLocs.sort((a, b) => b.loc - a.loc);
  console.log('  Top 5 largest files:');
  for (let i = 0; i < Math.min(5, fileLocs.length); i++) {
    console.log(`    ${i + 1}. ${fileLocs[i].relPath} (${fileLocs[i].loc} LOC)`);
  }

  if (overBudgetFiles.length > 0) {
    console.error(`  ❌ [FAIL] ${overBudgetFiles.length} file(s) exceeded ${MAX_LOC_BUDGET} LOC:`);
    for (const f of overBudgetFiles) {
      console.error(`     - ${f.relPath}: ${f.loc} LOC`);
    }
    return false;
  }
  console.log(
    `  ✔ [PASS] 100% files conform to LOC budget (Max observed: ${fileLocs[0].loc} LOC < ${MAX_LOC_BUDGET})\n`,
  );
  return true;
}

function auditShannonEntropy(allFiles) {
  console.log('[Gate 2] Shannon Information Entropy Guard');
  let totalEntropy = 0;
  let auditedCount = 0;
  const lowEntropyFiles = [];

  for (const filePath of allFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.length < 50) continue;
    const entropy = calculateShannonEntropy(content);
    totalEntropy += entropy;
    auditedCount++;
    const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
    if (entropy < 3.0) {
      lowEntropyFiles.push({ relPath, entropy });
    }
  }

  const meanEntropy = auditedCount > 0 ? totalEntropy / auditedCount : 0;
  console.log(
    `  Mean Shannon entropy: ${meanEntropy.toFixed(3)} bits/char across ${auditedCount} files`,
  );

  if (lowEntropyFiles.length > 0 || meanEntropy < 3.5 || meanEntropy > 6.5) {
    console.error(
      `  ❌ [FAIL] Entropy bounds violated: low count: ${lowEntropyFiles.length}, mean: ${meanEntropy}`,
    );
    return false;
  }
  console.log(
    `  ✔ [PASS] Shannon entropy healthy (mean ${meanEntropy.toFixed(2)} in [3.5, 6.5], 0 files < 3.0)\n`,
  );
  return true;
}

function countEffectiveLoc(content) {
  const lines = content.split('\n');
  let effectiveLoc = 0;
  let inBlockComment = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('*')) continue;
    effectiveLoc++;
  }
  return effectiveLoc;
}

function auditAstDensity(allFiles) {
  console.log('[Gate 3] AST / LOC Syntax Density Guard');
  let totalDensity = 0;
  let densityAudited = 0;
  const outlierDensityFiles = [];

  for (const filePath of allFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const effectiveLoc = countEffectiveLoc(content);
    if (effectiveLoc < 3) continue;

    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    let nodeCount = 0;
    function visit(node) {
      nodeCount++;
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    const density = nodeCount / effectiveLoc;
    totalDensity += density;
    densityAudited++;
    const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');

    if (density < 0.5 || density > 40.0) {
      outlierDensityFiles.push({ relPath, density, effectiveLoc, nodeCount });
    }
  }

  const meanDensity = densityAudited > 0 ? totalDensity / densityAudited : 0;
  console.log(
    `  Mean AST syntax density: ${meanDensity.toFixed(2)} nodes/effective LOC across ${densityAudited} files`,
  );

  if (outlierDensityFiles.length > 0 || meanDensity < 1.0 || meanDensity > 20.0) {
    console.error(
      `  ❌ [FAIL] AST density outliers detected: ${outlierDensityFiles.length}, mean: ${meanDensity}`,
    );
    for (const item of outlierDensityFiles) {
      console.error(
        `     - ${item.relPath}: ${item.density.toFixed(2)} nodes/LOC (${item.nodeCount} nodes, ${item.effectiveLoc} LOC)`,
      );
    }
    return false;
  }
  console.log(
    `  ✔ [PASS] AST syntax density verified (mean ${meanDensity.toFixed(2)} nodes/LOC in [1.0, 20.0])\n`,
  );
  return true;
}

function auditBoundaryInteroperability(allFiles) {
  console.log('[Gate 4] Boundary Interoperability Guard (BIF)');
  const coreFiles = allFiles.filter((f) => f.includes(path.sep + 'core' + path.sep));
  const boundaryViolations = [];

  for (const filePath of coreFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
    const importRegex = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const target = match[1];
      if (
        target.includes('/cli/') ||
        target.endsWith('/cli') ||
        target === '../cli' ||
        target === '../../cli' ||
        target === '../../api' ||
        target === '../api' ||
        target === './api'
      ) {
        boundaryViolations.push({ relPath, target });
      }
    }
  }

  const bif =
    coreFiles.length > 0
      ? ((coreFiles.length - boundaryViolations.length) / coreFiles.length) * 100
      : 100;
  console.log(
    `  Boundary Interoperability Factor (BIF): ${bif.toFixed(1)}% (${coreFiles.length} core files audited)`,
  );

  if (boundaryViolations.length > 0) {
    console.error(`  ❌ [FAIL] Reverse layer coupling detected from core:`);
    for (const v of boundaryViolations) {
      console.error(`     - ${v.relPath} imports '${v.target}'`);
    }
    return false;
  }
  console.log(
    `  ✔ [PASS] Boundary Interoperability clean (BIF = 100.0%, 0 reverse dependencies)\n`,
  );
  return true;
}

function auditProfileScoringPrecision() {
  console.log('[Gate 5] Profile Scoring Precision & Bias Asymmetry Guard');
  const { ArchetypeWeightTuner } = require('../dist/core/scoring/archetype-weight-tuner');
  const { QualityScorer } = require('../dist/core/scoring/qualityScorer');
  const {
    DEFAULT_QUALITY_WEIGHTS,
    ALL_QUALITY_DIMENSIONS,
  } = require('../dist/core/scoring/scoringTypes');

  const tuner = new ArchetypeWeightTuner();
  const profiles = ['frontend', 'backend', 'composite'];
  let baseMass = 0;
  for (const dim of ALL_QUALITY_DIMENSIONS) {
    baseMass += DEFAULT_QUALITY_WEIGHTS[dim] || 1.0;
  }

  for (const profile of profiles) {
    const tunedWeights = tuner.tuneWeights(profile);
    let tunedMass = 0;
    for (const dim of ALL_QUALITY_DIMENSIONS) {
      tunedMass += tunedWeights[dim] || 1.0;
    }

    if (Math.abs(tunedMass - baseMass) > 0.001) {
      console.error(
        `  ❌ [FAIL] Profile '${profile}' violated mass preservation: base=${baseMass}, tuned=${tunedMass}`,
      );
      return false;
    }

    const scorer = new QualityScorer(undefined, profile);
    const cleanEval = scorer.evaluateFile('dummy.ts', [], null);
    if (Number.isNaN(cleanEval.compositeScore) || cleanEval.compositeScore !== 100.0) {
      console.error(
        `  ❌ [FAIL] Profile '${profile}' clean score was not 100.0: ${cleanEval.compositeScore}`,
      );
      return false;
    }
  }

  const feWeights = tuner.tuneWeights('frontend');
  const beWeights = tuner.tuneWeights('backend');

  if (feWeights.standardization <= beWeights.standardization) {
    console.error('  ❌ [FAIL] Frontend standardization bias not greater than backend');
    return false;
  }
  if (beWeights.performanceEfficiency <= feWeights.performanceEfficiency) {
    console.error('  ❌ [FAIL] Backend performanceEfficiency bias not greater than frontend');
    return false;
  }

  console.log(
    `  ✔ [PASS] Profile weight mass invariant preserved (Δ < 0.001) and domain bias asymmetry confirmed\n`,
  );
  return true;
}

function runAudit() {
  console.log('=== auto-refactor Multidimensional Self-Audit Guard ===\n');
  const allFiles = getAllTsFiles(SRC_DIR);
  console.log(`Auditing ${allFiles.length} TypeScript source files in src/...\n`);

  const results = [
    auditLocBudget(allFiles),
    auditShannonEntropy(allFiles),
    auditAstDensity(allFiles),
    auditBoundaryInteroperability(allFiles),
    auditProfileScoringPrecision(),
  ];

  const failedCount = results.filter((r) => !r).length;
  if (failedCount > 0) {
    console.error(`❌ Multidimensional self-audit FAILED with ${failedCount} failed gate(s).`);
    process.exit(1);
  }

  console.log('=======================================================');
  console.log(' ALL 5 MULTIDIMENSIONAL SELF-AUDIT GATES PASSED (100%)');
  console.log('=======================================================');
}

runAudit();
