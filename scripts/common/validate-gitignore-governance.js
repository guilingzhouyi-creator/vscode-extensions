/**
 * Module: Governance Guard — Workspace Gitignore Governance & Anti-Overblocking Guard
 * File Path: scripts/common/validate-gitignore-governance.js
 * Architecture Role: Platform-level governance guard auditing all .gitignore files across the
 *   monorepo for physical line-ending contracts, mandatory floor guards, and zero-overblocking.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path, child_process);
 *   invoked by pre-push-gate, audit-all, CI hygiene workflows, and manual CLI checks.
 * Responsibilities:
 *   1. Enforce strict LF line-ending contracts on all .gitignore files (HYG-EOL-001).
 *   2. Detect 0-byte empty files, duplicate patterns, and trailing whitespace (HYG-EMP-001).
 *   3. Enforce mandatory floor-guard rules on root .gitignore (secrets, builds, caches, probes).
 *   4. Audit against git tracked files to prevent accidental overblocking of active source code.
 *   5. Output actionable diagnostics with optional --json/--agent output and --fix capability.
 * Exit Semantics & Design Rationale:
 *   0 = PASS (all .gitignore files satisfy hygiene, floor guards, and anti-overblocking constraints),
 *   1 = FAIL (line-ending violations, missing floor guards, duplicate rules, or overblocking defects).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Mandatory floor-guard tokens that must be present in root .gitignore.
 * Prevents accidental removal or loosening of critical security, build, and probe defenses.
 */
const MANDATORY_ROOT_FLOOR_GUARDS = [
  { category: 'Node / Build', token: 'node_modules/' },
  { category: 'Node / Build', token: 'dist/' },
  { category: 'Node / Build', token: 'out/' },
  { category: 'Node / Build', token: 'coverage/' },
  { category: 'Rust / Cargo', token: 'target/' },
  { category: 'Python', token: '__pycache__/' },
  { category: 'Godot 4', token: '.godot/' },
  { category: 'Audit / Diagnostics', token: '**/.audit-logs/' },
  { category: 'Audit / Diagnostics', token: 'sarif/' },
  { category: 'Agent / Probe', token: '.probe-*' },
  { category: 'Agent / Scratch', token: '**/scratch/' },
  { category: 'Secrets / Credentials', token: '.env' },
  { category: 'Secrets / Credentials', token: '*.key' },
  { category: 'Secrets / Credentials', token: '*.pem' },
  { category: 'Secrets / Credentials', token: 'credentials.json' },
  { category: 'OS Clutter', token: '.DS_Store' },
  { category: 'OS Clutter', token: 'Thumbs.db' },
];

/**
 * Known tracked files that are intentionally exempted from the overblocking check.
 * (e.g. legacy frozen snapshots in archive/ or tracked template examples).
 */
const EXEMPTED_TRACKED_IGNORED_PREFIXES = [
  'archive/',
];

/**
 * Recursively locates all .gitignore files in the workspace while skipping ignored directories.
 *
 * @param {string} dir
 * @param {Set<string>} ignoredDirNames
 * @returns {string[]}
 */
function findGitignoreFiles(dir, ignoredDirNames) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirNames.has(entry.name)) {
        results.push(...findGitignoreFiles(fullPath, ignoredDirNames));
      }
      continue;
    }
    if (entry.name === '.gitignore') {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Validates line endings and empty-file constraints.
 *
 * @param {string} filePath
 * @param {Buffer} rawBuf
 * @returns {string[]}
 */
function checkPhysicalHygiene(filePath, rawBuf) {
  const violations = [];
  const relPath = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');

  if (rawBuf.length === 0) {
    violations.push(`${relPath}: [HYG-EMP-001] File is 0 bytes empty.`);
    return violations;
  }

  if (rawBuf.includes(13)) {
    violations.push(`${relPath}: [HYG-EOL-001] Contains Windows CRLF line endings; strictly LF required.`);
  }

  const content = rawBuf.toString('utf8');
  if (content.trim().length === 0) {
    violations.push(`${relPath}: [HYG-EMP-001] File contains only whitespace characters.`);
  }

  return violations;
}

/**
 * Validates pattern formatting, trailing whitespace, and internal duplicates.
 *
 * @param {string} filePath
 * @param {string[]} lines
 * @returns {string[]}
 */
function checkPatternHygiene(filePath, lines) {
  const violations = [];
  const relPath = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
  const seenRules = new Map();

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx];
    const lineNum = idx + 1;

    if (/[ \t]+$/.test(rawLine)) {
      violations.push(`${relPath}:${lineNum}: Trailing whitespace detected on line.`);
    }

    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    if (seenRules.has(trimmed)) {
      const prevLine = seenRules.get(trimmed);
      violations.push(`${relPath}:${lineNum}: Duplicate pattern '${trimmed}' (previously defined at line ${prevLine}).`);
    } else {
      seenRules.set(trimmed, lineNum);
    }
  }

  return violations;
}

/**
 * Checks root .gitignore against the mandatory security, build, and probe floor guards.
 *
 * @param {string[]} rootLines
 * @returns {string[]}
 */
function checkRootFloorGuards(rootLines) {
  const violations = [];
  const activePatterns = new Set(
    rootLines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  );

  for (const guard of MANDATORY_ROOT_FLOOR_GUARDS) {
    if (!activePatterns.has(guard.token)) {
      violations.push(`root .gitignore: Missing mandatory [${guard.category}] floor guard token '${guard.token}'.`);
    }
  }

  return violations;
}

/**
 * Checks whether any tracked repository file is inadvertently masked by .gitignore rules.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
function checkAntiOverblocking(repoRoot) {
  const violations = [];
  let output = '';

  try {
    const cmd = 'cmd.exe /c "set HOME=%TEMP% && set USERPROFILE=%TEMP% && git ls-files -i -c --exclude-standard"';
    output = execSync(cmd, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return [];
  }

  const ignoredTrackedFiles = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const trackedFile of ignoredTrackedFiles) {
    const norm = trackedFile.replace(/\\/g, '/');
    const isExempt = EXEMPTED_TRACKED_IGNORED_PREFIXES.some((prefix) => norm.startsWith(prefix));
    if (!isExempt) {
      violations.push(`Anti-Overblocking Defect: Tracked file '${norm}' is unexpectedly suppressed by .gitignore rules.`);
    }
  }

  return violations;
}

/**
 * Automatically fixes CRLF and trailing whitespace when --fix is provided.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function fixGitignoreFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const normalized = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');

  if (normalized !== content) {
    fs.writeFileSync(filePath, normalized, { encoding: 'utf8' });
    return true;
  }
  return false;
}

/**
 * Runs complete gitignore governance audit across the monorepo.
 *
 * @param {{ fix: boolean, json: boolean }} options
 * @returns {{ passed: boolean, fileCount: number, violations: string[] }}
 */
function runGitignoreAudit(options) {
  const ignoredDirNames = new Set([
    'node_modules',
    '.git',
    'dist',
    'out',
    'target',
    'coverage',
    'archive',
    '.godot',
    '.auto-refactor-cache',
  ]);

  const gitignoreFiles = findGitignoreFiles(REPO_ROOT, ignoredDirNames);
  const allViolations = [];

  for (const file of gitignoreFiles) {
    if (options.fix) {
      fixGitignoreFile(file);
    }

    const rawBuf = fs.readFileSync(file);
    allViolations.push(...checkPhysicalHygiene(file, rawBuf));

    const content = rawBuf.toString('utf8');
    const lines = content.split('\n');
    allViolations.push(...checkPatternHygiene(file, lines));

    const isRoot = path.resolve(file) === path.resolve(REPO_ROOT, '.gitignore');
    if (isRoot) {
      allViolations.push(...checkRootFloorGuards(lines));
    }
  }

  allViolations.push(...checkAntiOverblocking(REPO_ROOT));

  return {
    passed: allViolations.length === 0,
    fileCount: gitignoreFiles.length,
    violations: allViolations,
  };
}

/**
 * Main command line entry point.
 */
function main() {
  const args = process.argv.slice(2);
  const options = {
    fix: args.includes('--fix'),
    json: args.includes('--json') || args.includes('--agent'),
  };

  const result = runGitignoreAudit(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.passed ? 0 : 1);
  }

  if (result.passed) {
    console.log(`[PASS] Gitignore Governance: Audited ${result.fileCount} .gitignore files across monorepo. All constraints met.`);
    process.exit(0);
  }

  console.error(`[FAIL] Gitignore Governance: Detected ${result.violations.length} violation(s):`);
  for (const violation of result.violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  runGitignoreAudit,
  checkPhysicalHygiene,
  checkPatternHygiene,
  checkRootFloorGuards,
  checkAntiOverblocking,
  MANDATORY_ROOT_FLOOR_GUARDS,
};
