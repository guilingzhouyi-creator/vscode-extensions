/**
 * Module: Governance Guard — Workspace Zero Empty Files & Trampoline Guard
 * File Path: scripts/common/validate-no-empty-files.js
 * Architecture Role: Platform-level governance guard preventing 0-byte, whitespace-only,
 *   and vacuous single-line trampoline forwarding files across the workspace.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path, assert);
 *   invoked by pre-push-gate, audit-all, and local developer tooling.
 * Responsibilities: Recursively audit workspace directory tree for empty or vacuous files.
 * Exit Semantics & Design Rationale: Exits 0 on clean check, exits 1 on detected violations.
 */
'use strict';

const fs = require('fs');
const path = require('path');

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
  '.auto-refactor-cache',
  '.gemini',
  'archive',
]);

const LOCAL_DECL_RE =
  /(?:^|\s)(?:function|class|interface|type|const|let|var|enum|def|struct|fn)\s+[a-zA-Z0-9_$]+/;
const REEXPORT_RE =
  /^(?:export\s+\*\s+from|export\s*\{[^}]*\}\s*from|module\.exports\s*=)\s*['"](\.\/[^'"]+)['"]/;

function isExemptTestPath(fullPath) {
  const norm = fullPath.replace(/\\/g, '/');
  return (
    norm.includes('/tests/') ||
    norm.includes('/test/') ||
    norm.includes('/fixtures/') ||
    norm.endsWith('.test.ts') ||
    norm.endsWith('.spec.ts')
  );
}

function detectVacuousTrampoline(fullPath, content) {
  if (!fullPath.endsWith('.ts') && !fullPath.endsWith('.js')) return null;
  if (isExemptTestPath(fullPath)) return null;

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

const MAX_SUSPECT_SIZE_BYTES = 8192;

function inspectFileForEmptiness(fullPath, findings) {
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size === 0) {
      findings.push({
        path: fullPath,
        reason: 'Physical 0-byte empty file',
        size: 0,
      });
      return;
    }

    // Fast-path: Files larger than 8KB can neither be whitespace-only nor 3-line vacuous trampolines
    if (stat.size > MAX_SUSPECT_SIZE_BYTES) {
      return;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    if (content.trim().length === 0) {
      findings.push({
        path: fullPath,
        reason: 'Whitespace-only empty file',
        size: stat.size,
      });
      return;
    }

    const trampolineTarget = detectVacuousTrampoline(fullPath, content);
    if (trampolineTarget) {
      findings.push({
        path: fullPath,
        reason: `Vacuous forwarding trampoline (ARCH-ABS-001): re-exports single target '${trampolineTarget}' without local orchestration`,
        size: stat.size,
      });
    }
  } catch (err) {
    console.error(`Error inspecting file ${fullPath}: ${err.message}`);
  }
}

function scanDirectory(dir, findings = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`Error reading directory ${dir}: ${err.message}`);
    return findings;
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(fullPath, findings);
      continue;
    }
    if (entry.isFile()) {
      inspectFileForEmptiness(fullPath, findings);
    }
  }
  return findings;
}

function run() {
  const workspaceRoot = path.resolve(__dirname, '..', '..');
  const findings = scanDirectory(workspaceRoot);

  if (findings.length > 0) {
    console.error(`\n❌ [FAIL] 在工作区发现 ${findings.length} 处物理空文件或空包跳板违规:`);
    for (const f of findings) {
      const rel = path.relative(workspaceRoot, f.path).replace(/\\/g, '/');
      console.error(`  - ${rel} (${f.reason}, size=${f.size})`);
    }
    process.exit(1);
  }

  console.log('  ✔ [PASS] 全工作区零空文件与空包跳板物理卫生检查通过');
  process.exit(0);
}

if (require.main === module) {
  run();
}

module.exports = {
  IGNORED_DIRS,
  MAX_SUSPECT_SIZE_BYTES,
  detectVacuousTrampoline,
  inspectFileForEmptiness,
  scanDirectory,
  run,
};
