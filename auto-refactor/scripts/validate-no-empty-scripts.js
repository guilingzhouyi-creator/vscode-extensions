/**
 * Module: Governance Guard — Zero Empty Files Guard
 * File Path: scripts/validate-no-empty-scripts.js
 * Architecture Role: Workspace guard preventing zero-byte and zero-ELOC files.
 * Dependencies & Triggers: Consumes Node.js fs/path; executed in test suite.
 * Responsibilities: Audit workspace trees for zero-byte or empty semantic files.
 * Exit Semantics & Design Rationale: Exits 0 on clean check, 1 on empty file detection.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log('=== Running Full-Workspace Zero-Empty-Files Governance Guard ===');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'target',
  '.godot',
  '.cargo-lock',
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

function inspectFileForEmptiness(fullPath, findings) {
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size === 0) {
      findings.push({
        path: fullPath,
        reason: 'Physical 0-byte file',
        size: 0,
      });
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
        reason: `Vacuous forwarding trampoline (ARCH-ABS-001): file only re-exports single target '${trampolineTarget}' without local orchestration or substance`,
        size: stat.size,
      });
    }
  } catch (err) {
    console.error(`Error reading file ${fullPath}: ${err.message}`);
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

const workspaceRoot = path.resolve(__dirname, '..', '..');
const findings = scanDirectory(workspaceRoot);

if (findings.length > 0) {
  console.error(`\n[FAIL] Found ${findings.length} empty or 0-byte files in workspace:`);
  for (const f of findings) {
    console.error(`  - ${f.path} (${f.reason}, size=${f.size})`);
  }
}

assert.strictEqual(
  findings.length,
  0,
  `Zero empty files invariant violated: Found ${findings.length} empty or 0-byte files!`,
);

console.log('  [PASS] Gate: Zero physical 0-byte or whitespace-only empty files across workspace');
console.log('=== ALL EMPTY FILE GOVERNANCE CHECKS PASSED SUCCESSFULLY! ===\n');
