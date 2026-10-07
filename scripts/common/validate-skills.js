/**
 * Module: Governance Guard — Workspace Skills Specification & Link Hygiene Guard
 * File Path: scripts/common/validate-skills.js
 * Architecture Role: Platform-level governance validator for `.agents/skills/` catalog,
 *   enforcing YAML frontmatter integrity, strict LF line endings, dead link immunity,
 *   and SSOT rule catalog registration alignment.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path);
 *   invoked by scripts/ps1/audit-all.ps1, scripts/sh/audit-all.sh, and local CI.
 * Responsibilities:
 *   1. Assert every skill directory contains a valid SKILL.md with compliant frontmatter.
 *   2. Assert all markdown files in .agents/skills/ have zero CRLF and non-zero bytes.
 *   3. Assert all non-code-fence relative links resolve to existing files on disk.
 *   4. Assert all referenced rule IDs are registered in scripts/common/rule-catalog.json.
 * Exit Semantics & Design Rationale: Exits 0 on clean pass; exits 1 on detected violations.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WHITELIST_TERMS = new Set([
  'UTF-8',
  'SHA-256',
  'RFC-7231',
  'HTTP-2',
  'IEEE-754',
]);

/**
 * Remove fenced code blocks from markdown content to avoid false-positive link/rule checks.
 *
 * @param {string} content - Raw markdown text.
 * @returns {string} Text with code fences blanked out preserving line count.
 */
function stripCodeFences(content) {
  return content.replace(/```[\s\S]*?```/g, (match) => {
    const newlineCount = (match.match(/\n/g) || []).length;
    return '\n'.repeat(newlineCount);
  });
}

/**
 * Recursively collect all markdown files under a given directory.
 *
 * @param {string} dir - Root directory.
 * @returns {string[]} Absolute paths of markdown files.
 */
function collectMarkdownFiles(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;

  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        result.push(fullPath);
      }
    }
  }
  return result;
}

/**
 * Validate YAML Frontmatter of a SKILL.md file.
 *
 * @param {string} raw - File raw content.
 * @param {string} expectedName - Expected skill directory name.
 * @param {string} filePath - Absolute file path.
 * @returns {string[]} List of error messages.
 */
function validateFrontmatter(raw, expectedName, filePath) {
  const errors = [];
  if (!raw.startsWith('---')) {
    errors.push(`${filePath}: Missing YAML frontmatter opening '---'`);
    return errors;
  }

  const endIdx = raw.indexOf('---', 3);
  if (endIdx === -1) {
    errors.push(`${filePath}: Missing YAML frontmatter closing '---'`);
    return errors;
  }

  const header = raw.substring(3, endIdx);
  const nameMatch = header.match(/^name:\s*(.+)$/m);
  const descMatch = header.match(/^description:\s*(?:>-\s*)?([\s\S]+?)(?:\n[a-z]+:|$)/m);

  if (!nameMatch) {
    errors.push(`${filePath}: Missing 'name' field in frontmatter`);
  } else if (nameMatch[1].trim() !== expectedName) {
    errors.push(`${filePath}: Frontmatter name '${nameMatch[1].trim()}' does not match directory '${expectedName}'`);
  }

  if (!descMatch || !descMatch[1].trim()) {
    errors.push(`${filePath}: Missing or empty 'description' field in frontmatter`);
  }

  return errors;
}

/**
 * Check markdown relative links for existence.
 *
 * @param {string} textWithoutFences - Markdown text without code fences.
 * @param {string} filePath - Source file path.
 * @returns {string[]} List of broken link errors.
 */
function checkMarkdownLinks(textWithoutFences, filePath) {
  const errors = [];
  const dir = path.dirname(filePath);
  const linkMatches = textWithoutFences.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);

  for (const m of linkMatches) {
    const target = m[2].trim();
    if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('mailto:')) {
      continue;
    }
    if (target.startsWith('#')) {
      continue;
    }

    if (/^[A-Za-z]:[\\/]/.test(target) || target.startsWith('file:///')) {
      errors.push(`${filePath}: Disallowed absolute path link '${target}' (LINK-ABS-FILE-URI)`);
      continue;
    }

    const cleanTarget = target.split('#')[0];
    if (!cleanTarget) continue;

    const resolved = path.resolve(dir, cleanTarget);
    if (!fs.existsSync(resolved)) {
      errors.push(`${filePath}: Dead relative link '${target}' points to non-existent path '${cleanTarget}'`);
    }
  }

  return errors;
}

/**
 * Check rule ID citations against SSOT rule catalog.
 *
 * @param {string} textWithoutFences - Markdown text without code fences.
 * @param {string} filePath - Source file path.
 * @param {Set<string>} registeredRules - Registered SSOT rule IDs.
 * @returns {string[]} List of unregistered rule ID errors.
 */
function checkRuleCitations(textWithoutFences, filePath, registeredRules) {
  const errors = [];
  const rulePattern = /(?:^|[^A-Za-z0-9_])([A-Z]{2,4}-[A-Z0-9]+-[0-9]{3})(?:$|[^A-Za-z0-9_])/g;
  const matches = textWithoutFences.matchAll(rulePattern);
  const seen = new Set();

  for (const m of matches) {
    const ruleId = m[1];
    if (seen.has(ruleId) || WHITELIST_TERMS.has(ruleId)) continue;
    seen.add(ruleId);

    // Skip test case IDs (e.g. TC-DOM-001)
    if (ruleId.startsWith('TC-')) continue;

    // Skip archive numbers (e.g. KALAR-DEV-ARCH-001)
    const lineWithMatch = textWithoutFences.substring(Math.max(0, m.index - 10), m.index + ruleId.length + 10);
    if (lineWithMatch.includes('KALAR-')) continue;

    if (!registeredRules.has(ruleId)) {
      errors.push(`${filePath}: Unregistered rule ID '${ruleId}' (RCFG-RULE-DRIFT)`);
    }
  }

  return errors;
}

/**
 * Validate a single markdown file for hygiene, links, and rule citations.
 *
 * @param {string} filePath - Absolute file path.
 * @param {Set<string>} registeredRules - Set of registered rule IDs.
 * @returns {string[]} List of detected violations.
 */
function validateMarkdownFile(filePath, registeredRules) {
  const errors = [];
  const raw = fs.readFileSync(filePath, 'utf8');

  if (raw.length === 0 || raw.trim().length === 0) {
    errors.push(`${filePath}: Empty or whitespace-only file (HYG-EMP-001)`);
    return errors;
  }

  if (raw.includes('\r\n')) {
    errors.push(`${filePath}: Disallowed CRLF line ending, must be strict LF (GATE-HYG-001)`);
  }

  const textWithoutFences = stripCodeFences(raw);
  errors.push(...checkMarkdownLinks(textWithoutFences, filePath));
  errors.push(...checkRuleCitations(textWithoutFences, filePath, registeredRules));

  return errors;
}

/**
 * Main validator entrypoint.
 *
 * @returns {number} Exit code (0 for success, 1 for failure).
 */
function main() {
  const repoRoot = path.resolve(__dirname, '../..');
  const skillsDir = path.join(repoRoot, '.agents/skills');
  const catalogPath = path.join(repoRoot, 'scripts/common/rule-catalog.json');

  if (!fs.existsSync(skillsDir)) {
    process.stderr.write(`[validate-skills] Skills directory not found: ${skillsDir}\n`);
    return 1;
  }

  if (!fs.existsSync(catalogPath)) {
    process.stderr.write(`[validate-skills] Rule catalog not found: ${catalogPath}\n`);
    return 1;
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const registeredRules = new Set((catalog.rules || []).map((r) => r.id));

  const allErrors = [];
  const skillFolders = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const folder of skillFolders) {
    const skillPath = path.join(skillsDir, folder);
    const skillMd = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(skillMd)) {
      allErrors.push(`${skillPath}: Missing mandatory entrypoint SKILL.md`);
      continue;
    }

    const rawSkillMd = fs.readFileSync(skillMd, 'utf8');
    allErrors.push(...validateFrontmatter(rawSkillMd, folder, skillMd));
  }

  const allMdFiles = collectMarkdownFiles(skillsDir);
  for (const mdFile of allMdFiles) {
    allErrors.push(...validateMarkdownFile(mdFile, registeredRules));
  }

  if (allErrors.length > 0) {
    process.stderr.write(`\n❌ [REJECT] Skills validation detected ${allErrors.length} violation(s):\n`);
    for (const err of allErrors) {
      process.stderr.write(`  - ${err}\n`);
    }
    return 1;
  }

  process.stdout.write(`\n✔ [PASS] All ${skillFolders.length} skills (${allMdFiles.length} markdown documents) verified successfully.\n`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, stripCodeFences, validateFrontmatter };
