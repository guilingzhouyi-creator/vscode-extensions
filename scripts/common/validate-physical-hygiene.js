/**
 * Module: Governance Guard — Workspace Physical Hygiene & Eight-Dimension Integrity Guard
 * File Path: scripts/common/validate-physical-hygiene.js
 * Architecture Role: Platform-level governance guard enforcing the Eight-Dimension Physical Hygiene Matrix
 *   across the entire workspace: zero empty files, zero hollow shells, strict EOL contracts (CRLF/LF),
 *   zero UTF-8 BOM, POSIX single EOF newline without trailing blank line buildup, pure space indentation,
 *   zero lingering empty directories, and zero OS/scratch clutter.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path);
 *   invoked by audit-all, pre-commit-gate, pre-push-gate, CI, and local developer tooling.
 * Responsibilities:
 *   1. Recursively audit workspace directory tree for all 8 physical hygiene dimensions.
 *   2. Compute continuous objective hygiene score adhering to the multi-dimensional weighted model.
 *   3. Provide safe, automated, in-place self-healing via `--fix` flag.
 *   4. Emit structured JSON / Agent-Native envelopes with actionable directives.
 * Exit Semantics & Design Rationale:
 *   0 = PASS (all 8 dimensions 100% compliant, zero violations detected),
 *   1 = FAIL (violations detected in check mode).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'target',
  '.godot',
  '.cargo-lock',
  '.mypy_cache',
  '.dsh-plugin-download',
  '.workbuddy',
  '.commandcode',
  '.auto-refactor',
  '.auto-refactor-cache',
  '.gemini',
  '.audit-logs',
  'archive',
  '.corpus',
  '.diff-corpus',
  '.rust-corpus',
  'tmp',
  'temp',
  '.praxis',
  '.venv',
  'venv',
]);

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.gd', '.py',
  '.rs', '.ps1', '.sh', '.bash', '.yaml', '.yml', '.toml', '.txt',
  '.html', '.css', '.svg', '.xml', '.ini', '.cfg', '.env', '.example',
]);

const LOCAL_DECL_RE =
  /(?:^|\s)(?:function|class|interface|type|const|let|var|enum|def|struct|fn)\s+[a-zA-Z0-9_$]+/;
const REEXPORT_RE =
  /^(?:export\s+\*\s+from|export\s*\{[^}]*\}\s*from|module\.exports\s*=)\s*['"](\.\/[^'"]+)['"]/;

const OS_CLUTTER_RE = /^(?:Thumbs\.db|desktop\.ini|\.DS_Store|.*\.tmp|.*\.bak|.*\.orig|.*\.swp)$/i;

function isExemptPath(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  return (
    norm.startsWith('archive/') ||
    norm.startsWith('WebGames/docs/归档库/') ||
    norm.includes('/fixtures/') ||
    norm.includes('/testdata/') ||
    norm === '.vscode/workspace-timing.json' ||
    norm.startsWith('.audit-logs/')
  );
}

function detectVacuousTrampoline(fullPath, content) {
  if (!fullPath.endsWith('.ts') && !fullPath.endsWith('.js')) return null;
  const stripped = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').trim();
  const codeLines = stripped
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (codeLines.length === 0 || codeLines.length > 3) return null;

  const hasLocalDecl = codeLines.some(
    (l) => LOCAL_DECL_RE.test(l) && !l.startsWith('export {') && !l.startsWith('export *'),
  );
  if (hasLocalDecl) return null;

  const targets = new Set();
  for (const l of codeLines) {
    const m = l.match(REEXPORT_RE);
    if (m) targets.add(m[1]);
  }

  if (targets.size !== 1) return null;
  return [...targets][0];
}

function isCommentOnlyFile(ext, content) {
  if (!['.ts', '.tsx', '.js', '.jsx', '.gd', '.py', '.rs', '.ps1', '.sh'].includes(ext)) {
    return false;
  }
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
    .replace(/#.*/g, '')
    .replace(/<#[\s\S]*?#>/g, '')
    .replace(/"""[\s\S]*?"""/g, '')
    .replace(/'''[\s\S]*?'''/g, '')
    .trim();
  return stripped.length === 0 && content.trim().length > 0;
}

class PhysicalHygieneAuditor {
  constructor(root = REPO_ROOT, options = {}) {
    this.root = root;
    this.options = {
      fix: Boolean(options.fix),
      json: Boolean(options.json),
      agent: Boolean(options.agent),
    };
    this.totalScannedFiles = 0;
    this.totalScannedDirs = 0;
    this.violations = {
      emptyFiles: [],
      hollowShells: [],
      eolContract: [],
      utf8Bom: [],
      posixEof: [],
      pureSpacesIndent: [],
      emptyDirs: [],
      osClutter: [],
    };
    this.fixedCount = 0;
  }

  checkClutterOrEmpty(stat, baseName, relPath, fullPath) {
    if (stat.size === 0) {
      this.violations.emptyFiles.push({
        path: relPath,
        ruleId: 'HYG-EMP-001',
        issue: 'Physical 0-byte empty file',
      });
      return true;
    }

    if (OS_CLUTTER_RE.test(baseName)) {
      this.violations.osClutter.push({
        path: relPath,
        ruleId: 'HYG-CLT-001',
        issue: 'OS clutter or transient scratch file detected',
      });
      if (this.options.fix) {
        try {
          fs.unlinkSync(fullPath);
          this.fixedCount++;
        } catch (unlinkErr) {
          // Best-effort auto-fix cleanup: ignore file permission removal errors
          void unlinkErr;
        }
      }
      return true;
    }
    return false;
  }

  auditBom(buf, relPath) {
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      this.violations.utf8Bom.push({
        path: relPath,
        ruleId: 'HYG-BOM-001',
        issue: 'UTF-8 with BOM detected, must be NO-BOM',
      });
      if (this.options.fix) {
        return { buf: buf.subarray(3), modified: true };
      }
    }
    return { buf, modified: false };
  }

  auditEol(ext, content, relPath) {
    const hasCR = content.includes('\r');
    if (ext === '.ps1') {
      if (!hasCR) {
        this.violations.eolContract.push({
          path: relPath,
          ruleId: 'HYG-EOL-001',
          issue: 'PowerShell script must use CRLF line endings, found LF',
        });
        if (this.options.fix) {
          return { content: content.replace(/\r?\n/g, '\r\n'), modified: true };
        }
      }
    } else {
      if (hasCR) {
        this.violations.eolContract.push({
          path: relPath,
          ruleId: 'HYG-EOL-001',
          issue: 'Source/document file must use LF line endings, found CRLF',
        });
        if (this.options.fix) {
          return { content: content.replace(/\r\n/g, '\n'), modified: true };
        }
      }
    }
    return { content, modified: false };
  }

  auditIndent(ext, content, relPath) {
    if (ext !== '.gd' && !relPath.endsWith('Makefile') && !isExemptPath(relPath) && content.includes('\t')) {
      this.violations.pureSpacesIndent.push({
        path: relPath,
        ruleId: 'HYG-IND-001',
        issue: 'Unapproved tab characters detected in non-GDScript file',
      });
      if (this.options.fix) {
        const indentSpaces = ext === '.ts' || ext === '.tsx' ? '    ' : '  ';
        return { content: content.replace(/\t/g, indentSpaces), modified: true };
      }
    }
    return { content, modified: false };
  }

  auditPosixEof(content, relPath) {
    const isMissingEof = !content.endsWith('\n') && !content.endsWith('\r');
    const isMultiBlankEof = /\n\s*\n\s*$/.test(content);
    if (isMissingEof || isMultiBlankEof) {
      this.violations.posixEof.push({
        path: relPath,
        ruleId: 'HYG-TRL-001',
        issue: isMissingEof ? 'Missing terminal POSIX newline' : 'Multiple trailing blank lines at EOF',
      });
      if (this.options.fix) {
        const trimmedTail = content.replace(/\s+$/, '');
        const targetEnding = relPath.endsWith('.ps1') ? '\r\n' : '\n';
        const newContent = trimmedTail.length > 0 ? trimmedTail + targetEnding : '';
        return { content: newContent, modified: true };
      }
    }
    return { content, modified: false };
  }

  auditFile(fullPath, relPath) {
    if (isExemptPath(relPath)) {
      return;
    }
    this.totalScannedFiles++;
    const stat = fs.statSync(fullPath);
    const baseName = path.basename(fullPath);
    const ext = path.extname(baseName).toLowerCase();

    if (this.checkClutterOrEmpty(stat, baseName, relPath, fullPath)) {
      return;
    }

    if (!TEXT_EXTENSIONS.has(ext)) {
      return;
    }

    let buf = fs.readFileSync(fullPath);
    let modified = false;

    const bomResult = this.auditBom(buf, relPath);
    buf = bomResult.buf;
    if (bomResult.modified) modified = true;

    let content = buf.toString('utf8');
    if (content.trim().length === 0) {
      this.violations.emptyFiles.push({
        path: relPath,
        ruleId: 'HYG-EMP-001',
        issue: 'Whitespace-only empty file lacking semantic payload',
      });
      return;
    }

    if (isCommentOnlyFile(ext, content)) {
      this.violations.hollowShells.push({
        path: relPath,
        ruleId: 'HYG-EMP-002',
        issue: 'Comment-only hollow file lacking executable or type declarations',
      });
    }

    const trampolineTarget = detectVacuousTrampoline(fullPath, content);
    if (trampolineTarget) {
      this.violations.hollowShells.push({
        path: relPath,
        ruleId: 'ARCH-ABS-001',
        issue: `Vacuous forwarding trampoline re-exporting '${trampolineTarget}' without orchestration`,
      });
    }

    const eolResult = this.auditEol(ext, content, relPath);
    content = eolResult.content;
    if (eolResult.modified) modified = true;

    const indentResult = this.auditIndent(ext, content, relPath);
    content = indentResult.content;
    if (indentResult.modified) modified = true;

    const eofResult = this.auditPosixEof(content, relPath);
    content = eofResult.content;
    if (eofResult.modified) modified = true;

    if (this.options.fix && modified) {
      fs.writeFileSync(fullPath, content, 'utf8');
      this.fixedCount++;
    }
  }

  scanDir(dir) {
    this.totalScannedDirs++;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const validEntries = entries.filter((e) => !IGNORED_DIRS.has(e.name));
    const relDir = path.relative(this.root, dir).replace(/\\/g, '/');

    if (validEntries.length === 0 && relDir !== '') {
      if (!isExemptPath(relDir)) {
        this.violations.emptyDirs.push({
          path: relDir,
          ruleId: 'HYG-DIR-001',
          issue: 'Lingering empty directory in active source or tooling tree',
        });
        if (this.options.fix) {
          try {
            fs.rmdirSync(dir);
            this.fixedCount++;
          } catch (rmdirErr) {
            // Best-effort auto-fix cleanup: ignore empty directory removal errors
            void rmdirErr;
          }
        }
      }
      return;
    }

    for (const ent of validEntries) {
      const fullPath = path.join(dir, ent.name);
      const relPath = path.relative(this.root, fullPath).replace(/\\/g, '/');

      if (ent.isDirectory()) {
        this.scanDir(fullPath);
      } else if (ent.isFile()) {
        this.auditFile(fullPath, relPath);
      }
    }
  }

  computeScore() {
    const N = Math.max(1, this.totalScannedFiles);
    const weights = {
      emptyFiles: 0.20,
      hollowShells: 0.15,
      eolContract: 0.20,
      utf8Bom: 0.10,
      posixEof: 0.10,
      pureSpacesIndent: 0.10,
      emptyDirs: 0.05,
      osClutter: 0.10,
    };

    const scales = {
      emptyFiles: 1,
      hollowShells: 1,
      eolContract: Math.max(1, Math.floor(0.01 * N)),
      utf8Bom: 1,
      posixEof: Math.max(10, Math.floor(0.05 * N)),
      pureSpacesIndent: Math.max(5, Math.floor(0.02 * N)),
      emptyDirs: 5,
      osClutter: 1,
    };

    let totalWeightedScore = 0.0;
    const dimensionDetails = {};

    for (const [dim, weight] of Object.entries(weights)) {
      const vCount = this.violations[dim].length;
      let compliance = 1.0;
      if (dim === 'emptyFiles' || dim === 'hollowShells') {
        compliance = vCount === 0 ? 1.0 : 0.0;
      } else {
        const scale = scales[dim];
        compliance = Math.max(0.0, 1.0 - vCount / scale);
      }
      const dimScore = Math.round(compliance * 1000) / 10;
      dimensionDetails[dim] = {
        weight,
        violationsCount: vCount,
        compliance: Math.round(compliance * 1000) / 1000,
        score: dimScore,
      };
      totalWeightedScore += weight * (compliance * 100.0);
    }

    const finalScore = Math.round(Math.max(15.0, totalWeightedScore) * 10) / 10;

    let totalViolations = 0;
    for (const dim of Object.keys(weights)) {
      totalViolations += this.violations[dim].length;
    }

    return {
      score: finalScore,
      totalViolations,
      dimensions: dimensionDetails,
    };
  }

  run() {
    this.scanDir(this.root);
    const evaluation = this.computeScore();

    if (this.options.json) {
      const output = {
        protocolVersion: '1.0.0',
        timestamp: new Date().toISOString(),
        score: evaluation.score,
        totalViolations: evaluation.totalViolations,
        scannedFiles: this.totalScannedFiles,
        scannedDirs: this.totalScannedDirs,
        fixedCount: this.fixedCount,
        dimensions: evaluation.dimensions,
        violations: this.violations,
      };
      console.log(JSON.stringify(output, null, 2));
      process.exit(evaluation.totalViolations === 0 ? 0 : 1);
    }

    if (this.options.agent) {
      const envelope = {
        header: {
          standard: 'Antigravity-Agent-Native-v1',
          type: 'physical_hygiene_envelope',
        },
        payload: {
          overallScore: evaluation.score,
          totalViolations: evaluation.totalViolations,
          dimensions: evaluation.dimensions,
          actionRequired: evaluation.totalViolations > 0,
          directives: evaluation.totalViolations > 0 ? ['run --fix to self-heal physical hygiene issues'] : [],
        },
      };
      console.log(JSON.stringify(envelope, null, 2));
      process.exit(evaluation.totalViolations === 0 ? 0 : 1);
    }

    console.log('=== 全工作区物理卫生八维全域巡检看板 (Physical Hygiene Matrix) ===');
    console.log(`受检物理文件: ${this.totalScannedFiles} | 受检目录: ${this.totalScannedDirs} | 综合得分: ${evaluation.score} / 100.0`);

    const dimLabels = {
      emptyFiles: '[HYG-EMP-001] D1 零物理0字节与纯空白',
      hollowShells: '[HYG-EMP-002] D2 零纯注释空壳与跳板',
      eolContract: '[HYG-EOL-001] D3 全仓换行契约CRLF/LF',
      utf8Bom: '[HYG-BOM-001] D4 UTF-8无BOM格式洁净',
      posixEof: '[HYG-TRL-001] D5 POSIX单EOF换行契约',
      pureSpacesIndent: '[HYG-IND-001] D6 纯空格无制表符缩进',
      emptyDirs: '[HYG-DIR-001] D7 零残留物理空目录',
      osClutter: '[HYG-CLT-001] D8 零系统/临时脏文件',
    };

    for (const [dim, info] of Object.entries(evaluation.dimensions)) {
      const label = (dimLabels[dim] || dim).padEnd(35, ' ');
      const status = info.violationsCount === 0 ? '✔ PASS' : `✖ ${info.violationsCount} issues`;
      console.log(`  ${label} : ${status.padStart(14, ' ')} | 得分: ${info.score.toFixed(1)}`);
    }

    if (this.options.fix && this.fixedCount > 0) {
      console.log(`\n🛠 [SELF-HEALED] 成功自动自愈 ${this.fixedCount} 处物理卫生瑕疵`);
    }

    if (evaluation.totalViolations === 0) {
      console.log('\n✔ [PASS] 全工作区物理卫生八维刚性公理 100% 全部合规\n');
      process.exit(0);
    } else {
      console.log(`\n❌ [FAIL] 检测到 ${evaluation.totalViolations} 处物理卫生违规，可运行 node scripts/common/validate-physical-hygiene.js --fix 进行自动自愈\n`);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const auditor = new PhysicalHygieneAuditor(REPO_ROOT, {
    fix: args.includes('--fix'),
    json: args.includes('--json'),
    agent: args.includes('--agent'),
  });
  auditor.run();
}

module.exports = {
  PhysicalHygieneAuditor,
  detectVacuousTrampoline,
  isCommentOnlyFile,
  REPO_ROOT,
  IGNORED_DIRS,
};
