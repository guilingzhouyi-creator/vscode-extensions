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
 *   5. Enforce the documented SKILL.md line window and description length window.
 *   6. Enforce the four-part layout (SKILL.md, references/, templates/) and reject orphan assets.
 *   7. Assert every error-severity catalog rule is reachable from at least one skill document.
 *   8. Prove every new detector still fires through in-memory probes.
 * Exit Semantics & Design Rationale: Exits 0 on clean pass; exits 1 on detected violations or a
 *   failed probe. Checks 5-7 close a gap where the governance skill documented a budget that nothing
 *   measured: every file stayed inside the window by habit, and an orphaned template could sit
 *   unreferenced indefinitely because no rule looked for it. The probes exist because a detector that
 *   silently matches nothing also exits 0, which is indistinguishable from a clean corpus.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** SKILL.md line window documented in skill-governance §二; the hard cap is the outer bound. */
const SKILL_LINE_WINDOW = Object.freeze({ min: 50, max: 250, hardMax: 300 });

/** Description length window documented in skill-governance §二. */
const DESCRIPTION_WINDOW = Object.freeze({ min: 50, max: 200 });

/** Directories every skill must carry; `scripts/` is optional because only three skills ship code. */
const MANDATORY_SUBDIRS = Object.freeze(['references', 'templates']);

const WHITELIST_TERMS = new Set([
  'UTF-8',
  'SHA-256',
  'RFC-7231',
  'HTTP-2',
  'IEEE-754',
]);

/** Populated when the plugin bundle is absent so the skip reason reaches the log. */
let pluginBundleSkipReason = null;

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
 * Extracts the semantic text of the `description` field from a frontmatter block.
 *
 * The field is usually a YAML folded scalar (`>-`) spanning several indented lines. A single regex
 * over the header stopped at the first line break and measured only the opening sentence — which is
 * how every skill reported 35-48 characters and none ever tripped the 200-character ceiling. Joining
 * the continuation lines with a single space reproduces the folded semantics the reader sees.
 *
 * @param {string} header - Frontmatter body, without the `---` fences.
 * @returns {string} Description text, or an empty string when the field is absent.
 */
function extractDescription(header) {
  const lines = header.split('\n');
  const start = lines.findIndex((line) => line.startsWith('description:'));
  if (start < 0) return '';
  const inline = lines[start].slice('description:'.length).trim();
  const parts = [];
  if (inline && !/^[>|][-+]?$/.test(inline)) parts.push(inline);
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[a-zA-Z_][\w-]*:/.test(lines[index])) break;
    parts.push(lines[index].trim());
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
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
  const description = extractDescription(header);

  if (!nameMatch) {
    errors.push(`${filePath}: Missing 'name' field in frontmatter`);
  } else if (nameMatch[1].trim() !== expectedName) {
    errors.push(`${filePath}: Frontmatter name '${nameMatch[1].trim()}' does not match directory '${expectedName}'`);
  }

  if (!description) {
    errors.push(`${filePath}: Missing or empty 'description' field in frontmatter`);
  } else if (description.length < DESCRIPTION_WINDOW.min || description.length > DESCRIPTION_WINDOW.max) {
    errors.push(
      `${filePath}: description is ${description.length} characters, outside the documented ` +
        `${DESCRIPTION_WINDOW.min}~${DESCRIPTION_WINDOW.max} window`,
    );
  }

  return errors;
}

/**
 * Validates the documented SKILL.md line budget.
 *
 * The window is soft below `hardMax` so a skill that legitimately needs 260 lines is not blocked, but
 * exceeding the hard cap means the file has stopped being an entry point and should push detail into
 * `references/` — that is the progressive-disclosure contract the governance skill states.
 *
 * @param {string} raw - File raw content.
 * @param {string} filePath - Absolute file path.
 * @returns {string[]} List of error messages.
 */
function validateSkillLineBudget(raw, filePath) {
  const errors = [];
  const lines = raw.split('\n').length;
  if (lines > SKILL_LINE_WINDOW.hardMax) {
    errors.push(
      `${filePath}: SKILL.md has ${lines} lines, over the hard cap of ${SKILL_LINE_WINDOW.hardMax}; ` +
        'move detail into references/',
    );
  }
  return errors;
}

/**
 * Validates that a skill carries the mandatory subdirectories.
 *
 * @param {string} skillPath - Absolute skill directory.
 * @returns {string[]} List of error messages.
 */
function validateSkillLayout(skillPath) {
  const errors = [];
  for (const subdir of MANDATORY_SUBDIRS) {
    if (!fs.existsSync(path.join(skillPath, subdir))) {
      errors.push(`${skillPath}: Missing mandatory '${subdir}/' directory`);
    }
  }
  return errors;
}

/**
 * Finds assets inside a skill that no Markdown file in the same skill references.
 *
 * Orphans are how a template rots: it stays on disk, nobody links to it, and the next reader cannot
 * tell whether it is authoritative or abandoned. Only files under `references/`, `templates/` and
 * `scripts/` are candidates, because SKILL.md is the entry point and is never "referenced".
 *
 * @param {string} skillPath - Absolute skill directory.
 * @returns {string[]} Repository-relative paths of unreferenced assets.
 */
function findOrphanAssets(skillPath) {
  const markdown = collectMarkdownFiles(skillPath).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const orphans = [];
  const walkAssets = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkAssets(full);
      else if (!markdown.includes(entry.name)) orphans.push(full);
    }
  };
  for (const subdir of [...MANDATORY_SUBDIRS, 'scripts']) {
    walkAssets(path.join(skillPath, subdir));
  }
  return orphans;
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
    errors.push(`${filePath}: Disallowed CRLF line ending, must be strict LF (GUARD-HYG-001)`);
  }

  const textWithoutFences = stripCodeFences(raw);
  errors.push(...checkMarkdownLinks(textWithoutFences, filePath));
  errors.push(...checkRuleCitations(textWithoutFences, filePath, registeredRules));

  return errors;
}

/**
 * Validate workspace-governance plugin bundle integrity and byte parity.
 *
 * @param {string} repoRoot - Workspace repository root.
 * @returns {string[]} List of detected plugin errors.
 */
function validatePluginBundle(repoRoot) {
  const pluginDir = path.join(repoRoot, '.agents/plugins/workspace-governance');
  const errors = [];
  if (!fs.existsSync(pluginDir)) {
    // The bundle is a derived artefact produced by sync-skills.js and is
    // gitignored, so it legitimately does not exist in a fresh clone. Record a
    // visible SKIP instead of silently returning so the parity contract cannot
    // be mistaken for "verified" when it was never evaluated.
    pluginBundleSkipReason =
      'plugin bundle not materialised (derived artefact, gitignored); byte-parity check skipped';
    return errors;
  }

  const pluginJsonPath = path.join(pluginDir, 'plugin.json');
  if (!fs.existsSync(pluginJsonPath)) {
    errors.push(`${pluginDir}: Missing plugin.json`);
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
      if (!manifest.name || !manifest.version || !manifest.description) {
        errors.push(`${pluginJsonPath}: plugin.json must declare 'name', 'version', and 'description'`);
      }
    } catch (e) {
      errors.push(`${pluginJsonPath}: Invalid JSON syntax (${e.message})`);
    }
  }

  const rulesAgentsMd = path.join(pluginDir, 'rules/AGENTS.md');
  if (!fs.existsSync(rulesAgentsMd)) {
    errors.push(`${pluginDir}: Missing plugin rules/AGENTS.md mirror`);
  }

  const pluginSkillsDir = path.join(pluginDir, 'skills');
  const rootSkillsDir = path.join(repoRoot, '.agents/skills');
  if (fs.existsSync(pluginSkillsDir) && fs.existsSync(rootSkillsDir)) {
    const syncUtil = require('./sync-skills');
    const diff = syncUtil.compareDirectories(rootSkillsDir, pluginSkillsDir);
    const totalDrift = diff.missing.length + diff.modified.length + diff.extra.length;
    if (totalDrift > 0) {
      errors.push(`Plugin skills drift detected (${totalDrift} items out of sync). Run 'node scripts/common/sync-skills.js' to heal.`);
    }
  }

  return errors;
}

/**
 * Asserts every error-severity rule in the catalog is reachable from the skill corpus.
 *
 * The catalog and the skills drifted apart in opposite directions: rules were added to the SSOT
 * with full implementations and zero prose pointing at them, so a reader asking "what should this
 * code obey" had no entry point for 147 blocking rules. A pointer is the cheapest possible link —
 * one mention of the id is enough — which is why the bar is coverage rather than explanation.
 *
 * @param {string} skillsDir - Absolute `.agents/skills` directory.
 * @param {Array<object>} rules - Catalog rule entries.
 * @returns {string[]} List of uncovered error rules, formatted for the report.
 */
function checkErrorRuleCoverage(skillsDir, rules) {
  const corpus = collectMarkdownFiles(skillsDir)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  return findUncoveredErrorRules(corpus, rules);
}

/**
 * Finds the error-severity rules a corpus never mentions.
 *
 * Pure over the corpus text so the probe can exercise it without a synthetic skills tree.
 *
 * @param {string} corpus - Concatenated Markdown text of every skill document.
 * @param {Array<object>} rules - Catalog rule entries.
 * @returns {string[]} List of uncovered error rules, formatted for the report.
 */
function findUncoveredErrorRules(corpus, rules) {
  return rules
    .filter((rule) => String(rule.severity).toLowerCase() === 'error')
    .filter((rule) => !corpus.includes(rule.id))
    .map((rule) => `error rule '${rule.id}' (${rule.family}) has no pointer in any skill document`);
}

/**
 * Proves each detector fires on a synthetic input whose verdict is known in advance.
 *
 * A guard that matches nothing also exits 0, which looks exactly like a clean corpus. These probes
 * drive the real detectors — not copies — so a regression in a pattern is reported as a failed probe
 * instead of a silent pass.
 *
 * @returns {string[]} List of probe failures.
 */
function runSelfProbes() {
  const failures = [];
  const probe = (name, ok) => {
    if (!ok) failures.push(`self-probe failed: ${name}`);
  };

  const longBody = ['---', 'name: probe', 'description: ' + 'x'.repeat(60), '---', ...Array(400).fill('line')].join('\n');
  probe('line budget flags an over-long SKILL.md', validateSkillLineBudget(longBody, '<probe>').length === 1);
  probe('line budget accepts a normal SKILL.md', validateSkillLineBudget('a\n'.repeat(120), '<probe>').length === 0);

  const shortDesc = '---\nname: probe\ndescription: too short\n---\n';
  probe('description window flags a short description', validateFrontmatter(shortDesc, 'probe', '<probe>').length === 1);
  const longDesc = `---\nname: probe\ndescription: ${'x'.repeat(240)}\n---\n`;
  probe('description window flags a long description', validateFrontmatter(longDesc, 'probe', '<probe>').length === 1);

  probe(
    'link checker flags a dead relative link',
    checkMarkdownLinks('[x](./missing.md)', path.join(__dirname, 'probe.md')).length === 1,
  );
  probe(
    'rule citation checker flags an unregistered id',
    checkRuleCitations('`FAKE-XYZ-999`', '<probe>', new Set()).length === 1,
  );

  const probeRules = [
    { id: 'PROBE-AAA-001', family: 'PROBE', severity: 'error' },
    { id: 'PROBE-BBB-001', family: 'PROBE', severity: 'warning' },
  ];
  probe(
    'error coverage flags an unmentioned error rule',
    findUncoveredErrorRules('`PROBE-BBB-001`', probeRules).length === 1,
  );
  probe(
    'error coverage ignores warning rules',
    findUncoveredErrorRules('`PROBE-AAA-001`', probeRules).length === 0,
  );

  return failures;
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
    allErrors.push(...validateSkillLineBudget(rawSkillMd, skillMd));
    allErrors.push(...validateSkillLayout(skillPath));
    for (const orphan of findOrphanAssets(skillPath)) {
      allErrors.push(`${orphan}: orphan asset, not referenced by any Markdown file in its skill`);
    }
  }

  const allMdFiles = collectMarkdownFiles(skillsDir);
  for (const mdFile of allMdFiles) {
    allErrors.push(...validateMarkdownFile(mdFile, registeredRules));
  }

  allErrors.push(...validatePluginBundle(repoRoot));
  allErrors.push(...checkErrorRuleCoverage(skillsDir, catalog.rules || []));
  allErrors.push(...runSelfProbes());

  if (allErrors.length > 0) {
    process.stderr.write(`\n❌ [REJECT] Skills validation detected ${allErrors.length} violation(s):\n`);
    for (const err of allErrors) {
      process.stderr.write(`  - ${err}\n`);
    }
    return 1;
  }

  const pluginBundlePresent = fs.existsSync(path.join(repoRoot, '.agents/plugins/workspace-governance'));
  const parityNote = pluginBundlePresent
    ? 'with plugin parity'
    : `plugin parity skipped (${pluginBundleSkipReason ?? 'bundle absent'})`;
  if (!pluginBundlePresent) {
    process.stdout.write(
      `\n⚠️  [SKIP] Plugin byte-parity not evaluated: ${pluginBundleSkipReason ?? 'bundle absent'}\n` +
        '     Run \'node scripts/common/sync-skills.js\' to materialise the bundle before publishing.\n',
    );
  }
  process.stdout.write(`\n✔ [PASS] All ${skillFolders.length} skills (${allMdFiles.length} markdown documents) verified successfully ${parityNote}.\n`);
  return 0;
}


if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main,
  stripCodeFences,
  validateFrontmatter,
  validateSkillLineBudget,
  validateSkillLayout,
  findOrphanAssets,
  findUncoveredErrorRules,
  runSelfProbes,
};
