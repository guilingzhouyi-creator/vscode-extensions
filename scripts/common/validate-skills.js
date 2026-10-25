/**
 * Module: Governance Guard — Workspace Skills Specification & Link Hygiene Guard
 * File Path: scripts/common/validate-skills.js
 * Architecture Role: Platform-level governance validator for `.agents/skills/` catalog,
 *   enforcing YAML frontmatter integrity, strict LF line endings, dead link immunity,
 *   and SSOT rule catalog registration alignment.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path) plus the skill registry
 *   resolver and the metadata/catalogue renderers; invoked by scripts/ps1/audit-all.ps1,
 *   scripts/sh/audit-all.sh, and local CI.
 * Responsibilities:
 *   1. Assert every skill directory contains a valid SKILL.md with compliant frontmatter.
 *   2. Assert all markdown files in .agents/skills/ have zero CRLF and non-zero bytes.
 *   3. Assert all non-code-fence relative links resolve to existing files on disk.
 *   4. Assert all referenced rule IDs are registered in scripts/common/rule-catalog.json.
 *   5. Enforce the documented SKILL.md line window and description length window.
 *   6. Enforce the four-part layout (SKILL.md, references/, templates/) and reject orphan assets.
 *   7. Assert every error-severity catalog rule is reachable from at least one skill document.
 *   8. Assert the authored registry and the on-disk skill entry files close both ways and render identically.
 *   9. Assert domain chains, scenario links, layers and linkage blocks all resolve to registered skills.
 *  10. Assert the generated catalogue (`docs/skill-catalog.md`) is byte-identical to the registry render.
 *  11. Prove every new detector still fires through in-memory probes.
 * Exit Semantics & Design Rationale: Exits 0 on clean pass; exits 1 on detected violations or a
 *   failed probe. Checks 5-7 close a gap where the governance skill documented a budget that nothing
 *   measured: every file stayed inside the window by habit, and an orphaned template could sit
 *   unreferenced indefinitely because no rule looked for it. Checks 8-10 close the opposite gap: the
 *   description line, linkage table and manual were rendered from one registry but nothing compared the
 *   bytes, so a hand-edited entry file could survive a whole release cycle. The probes exist because a
 *   detector that silently matches nothing also exits 0, which is indistinguishable from a clean corpus.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const skillResolver = require('./skill-registry-resolver');
const skillSync = require('./sync-skill-metadata');
const skillCatalog = require('./render-skill-catalog');

/** SKILL.md line window documented in skill-governance §二; the hard cap is the outer bound. */
const SKILL_LINE_WINDOW = Object.freeze({ min: 50, max: 250, hardMax: 300 });

/** Description length window documented in skill-governance §二. */
const DESCRIPTION_WINDOW = Object.freeze({ min: 50, max: 200 });

/** Directories every skill must carry; `scripts/` is optional because only three skills ship code. */
const MANDATORY_SUBDIRS = Object.freeze(['references', 'templates']);

/**
 * Assertion names owned by the three registry guards. Deliberately two segments (no numeric tail) so
 * they read as diagnostics instead of rule identifiers: rule IDs must be registered in the SSOT
 * catalog, and an unregistered three-segment label turns the closure gate red for no governance gain.
 */
const SKILL_ASSERTIONS = Object.freeze({
    metadata: 'SKILL-METADATA',
    linkage: 'SKILL-LINKAGE',
    document: 'SKILL-CATALOG',
});

const WHITELIST_TERMS = new Set([
  'UTF-8',
  'UTF-16',
  'SHA-256',
  'SHA-512',
  'AES-256',
  'AES-128',
  'RFC-7231',
  'RFC-3339',
  'HTTP-2',
  'IEEE-754',
  'ISO-8601',
]);

const TEXT_ASSET_EXTS = new Set(['.ts', '.tsx', '.js', '.json', '.gd', '.rs', '.css', '.sh', '.ps1']);

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
      errors.push(`${filePath}: Disallowed absolute path link '${target}' (DOC-LNK-001)`);
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
  const rulePattern =
    /(?:^|[^A-Za-z0-9_])([A-Z]{2,6}-[A-Z0-9]+-[0-9]{3}|L[0-5]-[A-Z0-9-]+|LINK-[A-Z0-9-]+)(?:$|[^A-Za-z0-9_])/g;
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
 * Validate non-markdown code/config assets under `templates/` and `scripts/` for physical hygiene.
 *
 * @param {string} skillPath - Absolute skill directory.
 * @returns {string[]} List of detected violations.
 */
function validateSkillCodeAssets(skillPath) {
  const errors = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_ASSET_EXTS.has(ext)) continue;
      const raw = fs.readFileSync(full, 'utf8');
      if (raw.trim().length === 0) {
        errors.push(`${full}: Empty code/template asset file (HYG-EMP-001)`);
        continue;
      }
      if (ext === '.ps1' && !raw.includes('\r\n')) {
        errors.push(`${full}: PowerShell asset must use CRLF line endings (GUARD-HYG-001)`);
      } else if (ext !== '.ps1' && raw.includes('\r\n')) {
        errors.push(`${full}: Asset must use strict LF line endings (GUARD-HYG-001)`);
      }
      if (/^\t+/m.test(raw)) {
        errors.push(`${full}: Disallowed tab indentation in skill asset (HYG-IND-001)`);
      }
    }
  };
  for (const subdir of ['templates', 'scripts']) {
    walk(path.join(skillPath, subdir));
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
  const rootAgentsMd = path.join(repoRoot, 'AGENTS.md');
  if (!fs.existsSync(rulesAgentsMd)) {
    errors.push(`${pluginDir}: Missing plugin rules/AGENTS.md mirror`);
  } else if (fs.existsSync(rootAgentsMd)) {
    // Existence alone was fail-open: a commit that only touched the root rulebook left the
    // bundle serving the previous contract while this guard still reported PASS. Comparing the
    // bytes is what makes the mirror a claim rather than a file listing.
    if (!fs.readFileSync(rulesAgentsMd).equals(fs.readFileSync(rootAgentsMd))) {
      errors.push(
        'MIRROR_DRIFT: plugin rules/AGENTS.md differs from root AGENTS.md ' +
          '(run `node scripts/common/sync-agents-mirror.js`)',
      );
    }
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

  // Agent definitions and their figure contract live behind the same derived bundle, so the same
  // byte-parity obligation applies. Delegated to the mirror module to keep one implementation.
  const agentMirror = require('./sync-agents-mirror');
  errors.push(...agentMirror.checkTrackedTemplates());
  const agentDrift = agentMirror.detectMirrorDrift();
  if (!agentDrift.missingBundle && agentDrift.drift.length > 0) {
    errors.push(
      `Agent definition mirror drift (${agentDrift.drift.length} items): ${agentDrift.drift.join('; ')} ` +
        "— run 'node scripts/common/sync-agents-mirror.js' to heal.",
    );
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
 * Compares the registry skill set with the on-disk skill directories.
 *
 * Both directions matter: a registry row without a directory renders nothing, and a directory without
 * a registry row escapes every trigger, linkage and description check because the guard iterates the
 * registry rather than the filesystem.
 *
 * @param {string[]} registryNames - Skill names declared in the registry.
 * @param {string[]} diskSkillNames - Skill directory names present under `.agents/skills`.
 * @returns {string[]} List of closure violations.
 */
function checkRegistryClosure(registryNames, diskSkillNames) {
    const registrySet = new Set(registryNames);
    const diskSet = new Set(diskSkillNames);
    const errors = [];
    for (const name of registryNames) {
        if (!diskSet.has(name)) {
            errors.push(`${SKILL_ASSERTIONS.metadata}: registry declares '${name}' but .agents/skills/${name}/SKILL.md is missing`);
        }
    }
    for (const name of diskSkillNames) {
        if (!registrySet.has(name)) {
            errors.push(`${SKILL_ASSERTIONS.metadata}: .agents/skills/${name} has no record in scripts/common/skill-registry.json`);
        }
    }
    return errors;
}

/**
 * Enforces the activation contract on every authored trigger vector.
 *
 * A description-window check alone cannot stop a skill from stuffing ten technical nouns, so the
 * count, token width, cross-skill reuse ceiling and semantic classes are measured on the registry
 * before any description is rendered into a SKILL.md.
 *
 * @param {object} registry - Loaded registry carrying activation and skills.
 * @returns {string[]} List of trigger contract violations.
 */
function checkTriggerContract(registry) {
    const activation = registry.activation || {};
    const window = activation.triggerWindow || { min: 6, max: 9 };
    const maxReuse = Number.isInteger(activation.maxTriggerReuse) ? activation.maxTriggerReuse : 3;
    const skills = registry.skills || {};
    const reuse = new Map();
    const errors = [];
    for (const [skillName, skill] of Object.entries(skills)) {
        const triggers = Array.isArray(skill.triggers) ? skill.triggers : [];
        if (triggers.length < window.min || triggers.length > window.max) {
            errors.push(`${SKILL_ASSERTIONS.metadata}: '${skillName}' declares ${triggers.length} triggers, outside the ${window.min}~${window.max} window`);
        }
        const seen = new Set();
        for (const token of triggers) {
            const label = `'${skillName}' trigger '${token}'`;
            const width = Array.from(String(token)).length;
            if (width < 2 || width > 8) {
                errors.push(`${SKILL_ASSERTIONS.metadata}: ${label} is ${width} characters; the token window is 2~8`);
            }
            if (seen.has(token)) {
                errors.push(`${SKILL_ASSERTIONS.metadata}: ${label} is duplicated inside the skill`);
            }
            seen.add(token);
            if (!reuse.has(token)) reuse.set(token, new Set());
            reuse.get(token).add(skillName);
        }
        const classes = new Set(triggers.map((token) => skillResolver.classifyTrigger(String(token), activation)));
        const semanticHits = ['intent', 'symptom', 'technical'].filter((name) => classes.has(name)).length;
        if (classes.size < 3 || semanticHits < 2) {
            errors.push(`${SKILL_ASSERTIONS.metadata}: '${skillName}' covers ${classes.size} trigger classes (${[...classes].join(', ') || 'none'}); need at least 3 classes and 2 of intent/symptom/technical`);
        }
    }
    for (const [token, users] of reuse.entries()) {
        if (users.size > maxReuse) {
            errors.push(`${SKILL_ASSERTIONS.metadata}: trigger '${token}' is shared by ${users.size} skills (${[...users].join(', ')}), over the ${maxReuse} ceiling`);
        }
    }
    return errors;
}

/**
 * Reads the associatedSkills list of one subagent archetype file.
 *
 * @param {string} repoRoot - Absolute repository root.
 * @param {object} domain - Domain record carrying the archetype id.
 * @returns {string[]|null} Listed skills, or null when the file is absent or malformed.
 */
function loadArchetypeSkills(repoRoot, domain) {
    const filePath = path.join(repoRoot, '.agents/subagents/archetypes', `${domain.archetype}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed.associatedSkills) ? parsed.associatedSkills : null;
    } catch (e) {
        return null;
    }
}

/**
 * Validates one domain chain and support list against the registry and its archetype.
 *
 * @param {object} domain - Domain record.
 * @param {object} skills - Registry skill map.
 * @param {function(object): (string[]|null)} loadArchetype - Archetype lookup.
 * @returns {{ errors: string[], members: Set<string> }} Violations and declared domain membership.
 */
function checkDomainChain(domain, skills, loadArchetype) {
    const errors = [];
    const chain = Array.isArray(domain.chain) ? domain.chain : [];
    const supports = Array.isArray(domain.supports) ? domain.supports : [];
    const where = `${SKILL_ASSERTIONS.linkage}: domain '${domain.id}'`;
    if (chain.length < 2) {
        errors.push(`${where} declares a ${chain.length}-skill chain; a domain chain needs at least 2`);
    }
    if (new Set(chain).size !== chain.length) {
        errors.push(`${where} chain repeats a skill: ${chain.join(', ')}`);
    }
    if (new Set(supports).size !== supports.length) {
        errors.push(`${where} supports repeats a skill: ${supports.join(', ')}`);
    }
    const archetypeSkills = loadArchetype(domain);
    if (archetypeSkills === null) {
        errors.push(`${where} points at missing archetype '.agents/subagents/archetypes/${domain.archetype}.json' or it declares no associatedSkills`);
    } else if (chain.length > 0 && !archetypeSkills.includes(chain[0])) {
        errors.push(`${where} chain head '${chain[0]}' is absent from archetype '${domain.archetype}' associatedSkills`);
    }
    const members = new Set([...chain, ...supports]);
    for (const name of members) {
        if (!Object.prototype.hasOwnProperty.call(skills, name)) {
            errors.push(`${where} references unknown skill '${name}' in chain/supports`);
        }
    }
    return { errors, members };
}

/**
 * Validates the scenario rows of one domain.
 *
 * @param {object} domain - Domain record.
 * @param {object} skills - Registry skill map.
 * @param {Set<string>} members - Skills declared in the domain chain and supports.
 * @returns {string[]} List of scenario violations.
 */
function checkDomainScenarios(domain, skills, members) {
    const errors = [];
    const where = `${SKILL_ASSERTIONS.linkage}: domain '${domain.id}'`;
    for (const scenario of domain.scenarios || []) {
        const scenarioSkills = Array.isArray(scenario.skills) ? scenario.skills : [];
        const label = `${where} scenario '${scenario.intent}'`;
        if (scenarioSkills.length < 2) {
            errors.push(`${label} lists ${scenarioSkills.length} skill(s); at least 2 are required`);
        }
        for (const name of scenarioSkills) {
            if (!Object.prototype.hasOwnProperty.call(skills, name)) {
                errors.push(`${label} references unknown skill '${name}'`);
            } else if (!members.has(name)) {
                errors.push(`${label} references '${name}' outside chain∪supports`);
            }
        }
    }
    return errors;
}

/**
 * Validates that every skill belongs to a domain, sits in a registered layer and has non-empty linkage.
 *
 * @param {object} registry - Loaded registry.
 * @param {Set<string>} domainMembers - Every skill named in a chain or support list.
 * @returns {string[]} List of placement violations.
 */
function checkSkillPlacement(registry, domainMembers) {
    const errors = [];
    const skills = registry.skills || {};
    const layerIds = new Set((registry.layers || []).map((layer) => layer.id));
    for (const [skillName, skill] of Object.entries(skills)) {
        if (!domainMembers.has(skillName)) {
            errors.push(`${SKILL_ASSERTIONS.linkage}: skill '${skillName}' belongs to no domain chain or support list`);
        }
        if (!layerIds.has(skill.layer)) {
            errors.push(`${SKILL_ASSERTIONS.linkage}: skill '${skillName}' declares layer '${skill.layer}' which is absent from registry.layers`);
        }
        const linkage = skillResolver.buildLinkage(registry, skillName);
        if (linkage.predecessors.length === 0 && linkage.successors.length === 0 && linkage.parallel.length === 0) {
            errors.push(`${SKILL_ASSERTIONS.linkage}: skill '${skillName}' has no predecessor, successor or parallel support; its linkage block would be empty`);
        }
    }
    return errors;
}

/**
 * Validates that every registered layer owns at least one skill.
 *
 * @param {object} registry - Loaded registry.
 * @returns {string[]} List of empty-layer violations.
 */
function checkLayerOccupancy(registry) {
    const errors = [];
    const skills = Object.values(registry.skills || {});
    for (const layer of registry.layers || []) {
        if (!skills.some((skill) => skill.layer === layer.id)) {
            errors.push(`${SKILL_ASSERTIONS.linkage}: layer '${layer.id}' has no member skill`);
        }
    }
    return errors;
}

/**
 * Module: Governance Guard — Registry Metadata Supervisor
 * File Path: scripts/common/validate-skills.js
 * Architecture Role: Boundary between the authored skill registry and the on-disk entry files, owning
 *   closure, render parity and the activation trigger contract for every skill.
 * Dependencies & Triggers: scripts/common/skill-registry.json, skill-registry-resolver.js and
 *   sync-skill-metadata.js; runs inside validate-skills.js main() and in runSelfProbes() with hooks.
 * Responsibilities:
 *   1. Assert the registry skill set and the `.agents/skills/` directories close in both directions.
 *   2. Assert every SKILL.md is byte-identical to sync-skill-metadata.renderSkillDocument(registry, name, raw).
 *   3. Assert trigger count, token width, per-skill uniqueness, cross-skill reuse and class coverage.
 * Exit Semantics & Design Rationale: Returns violations; the caller owns the exit code. The expected
 *   document is rendered as a whole rather than compared field by field, because a field-level check
 *   let a hand-edited linkage table survive: only the exact bytes the writer would produce are accepted.
 *
 * @param {string} repoRoot - Absolute repository root, used to shorten message paths.
 * @param {object} registry - Loaded skill registry.
 * @param {string} skillsDir - Absolute `.agents/skills` directory.
 * @param {string[]} diskSkillNames - Skill directory names present on disk.
 * @param {object} [hooks] - Optional readSkillDocument/expectedDocument overrides used by the self probes.
 * @returns {string[]} List of metadata violations.
 */
function validateRegistryMetadata(repoRoot, registry, skillsDir, diskSkillNames, hooks) {
    const overrides = hooks || {};
    const readSkillDocument = overrides.readSkillDocument || ((skillName) => {
        const filePath = path.join(skillsDir, skillName, 'SKILL.md');
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    });
    const expectedDocument = overrides.expectedDocument || ((skillName, raw) => skillSync.renderSkillDocument(registry, skillName, raw));
    const registryNames = Object.keys(registry.skills || {});
    const errors = [...checkRegistryClosure(registryNames, diskSkillNames)];
    const diskSet = new Set(diskSkillNames);
    for (const skillName of registryNames) {
        if (!diskSet.has(skillName)) continue;
        const filePath = path.join(skillsDir, skillName, 'SKILL.md');
        const label = path.relative(repoRoot, filePath) || filePath;
        const raw = readSkillDocument(skillName);
        if (raw === null) continue;
        try {
            const expected = expectedDocument(skillName, raw);
            if (expected !== raw) {
                errors.push(`${label}: SKILL.md differs from the registry render (${SKILL_ASSERTIONS.metadata}); run 'node scripts/common/sync-skill-metadata.js' to heal`);
            }
        } catch (e) {
            errors.push(`${label}: cannot render expected metadata (${SKILL_ASSERTIONS.metadata}): ${e.message}`);
        }
    }
    errors.push(...checkTriggerContract(registry));
    return errors;
}

/**
 * Module: Governance Guard — Domain Linkage Supervisor
 * File Path: scripts/common/validate-skills.js
 * Architecture Role: Topology guard over `skill-registry.json` domains, layers and derived linkage.
 * Dependencies & Triggers: skill-registry-resolver.js buildLinkage and `.agents/subagents/archetypes/*.json`;
 *   runs inside validate-skills.js main() and in runSelfProbes() with an injected archetype loader.
 * Responsibilities:
 *   1. Assert every domain chain has at least two skills and no repeated member.
 *   2. Assert the chain head is listed in the matching archetype associatedSkills.
 *   3. Assert scenario skills exist and stay inside chain∪supports.
 *   4. Assert every skill has a valid layer, a domain and a non-empty derived linkage.
 * Exit Semantics & Design Rationale: Returns violations; the caller owns the exit code. Linkage is
 *   rebuilt through the resolver rather than re-walked here, so the guard cannot disagree with the
 *   renderer about what a predecessor or a parallel support means.
 *
 * @param {string} repoRoot - Absolute repository root.
 * @param {object} registry - Loaded skill registry.
 * @param {function(object): (string[]|null)} [archetypeLoader] - Optional archetype lookup override.
 * @returns {string[]} List of linkage violations.
 */
function validateRegistryLinkage(repoRoot, registry, archetypeLoader) {
    const loadArchetype = archetypeLoader || ((domain) => loadArchetypeSkills(repoRoot, domain));
    const skills = registry.skills || {};
    const errors = [];
    const domainMembers = new Set();
    for (const domain of registry.domains || []) {
        const result = checkDomainChain(domain, skills, loadArchetype);
        errors.push(...result.errors);
        errors.push(...checkDomainScenarios(domain, skills, result.members));
        for (const name of result.members) domainMembers.add(name);
    }
    errors.push(...checkSkillPlacement(registry, domainMembers));
    errors.push(...checkLayerOccupancy(registry));
    return errors;
}

/**
 * Module: Governance Guard — Skill Catalogue Parity Supervisor
 * File Path: scripts/common/validate-skills.js
 * Architecture Role: Byte-parity guard between the generated invocation manual and its registry render.
 * Dependencies & Triggers: render-skill-catalog.js renderCatalog and docs/skill-catalog.md; runs inside
 *   validate-skills.js main() and in runSelfProbes() with injected text.
 * Responsibilities:
 *   1. Assert `docs/skill-catalog.md` exists.
 *   2. Assert its exact bytes equal render-skill-catalog.renderCatalog(registry).
 * Exit Semantics & Design Rationale: Returns violations; the caller owns the exit code. Comparing the
 *   rendered text, not a hand-maintained subset of headings, is what makes the manual a derived
 *   artefact rather than a second source of truth.
 *
 * @param {string} repoRoot - Absolute repository root.
 * @param {object} registry - Loaded skill registry.
 * @param {{ expectedText?: string, actualText?: (string|null) }} [options] - Overrides for the self probes.
 * @returns {string[]} List of catalogue violations.
 */
function validateSkillCatalogDocument(repoRoot, registry, options) {
    const settings = options || {};
    const catalogPath = path.join(repoRoot, skillCatalog.CATALOG_RELATIVE_PATH);
    const label = path.relative(repoRoot, catalogPath) || skillCatalog.CATALOG_RELATIVE_PATH;
    const expected = settings.expectedText !== undefined ? settings.expectedText : skillCatalog.renderCatalog(registry);
    const actual = settings.actualText !== undefined
        ? settings.actualText
        : (fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, 'utf8') : null);
    if (actual === null) {
        return [`${label}: generated catalogue is missing (${SKILL_ASSERTIONS.document}); run 'node scripts/common/render-skill-catalog.js'`];
    }
    if (expected !== actual) {
        return [`${label}: content differs from the registry render (${SKILL_ASSERTIONS.document}); run 'node scripts/common/render-skill-catalog.js' to heal`];
    }
    return [];
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
  const fakeLayerRule = ['L1', 'PROBE', 'CRASH'].join('-');
  const fakeStdlibRule = ['STDLIB', 'PROBE', '999'].join('-');
  probe(
    'rule citation checker flags an unregistered L0-L5 or 6-letter id',
    checkRuleCitations(`\`${fakeLayerRule}\` and \`${fakeStdlibRule}\``, '<probe>', new Set()).length === 2,
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

  const probeActivation = {
    template: '【触发：{triggers}】{pitch}',
    separator: '/',
    triggerWindow: { min: 6, max: 9 },
    maxTriggerReuse: 3,
    classes: { intent: ['写', '重构'], symptom: ['崩溃', '卡顿'], technical: ['CAS', 'ELABORATE'] },
  };
  const probeSkill = (triggers) => ({ layer: 'probe-layer', triggers, pitch: 'probe', purpose: 'probe', situations: [], verification: [] });
  const metadataRegistry = {
    activation: probeActivation,
    layers: [{ id: 'probe-layer', order: 1, title: 'probe', positioning: 'probe' }],
    domains: [{ id: 'probe-domain', archetype: 'probe-archetype', chain: ['probe-a', 'probe-b'], supports: [], scenarios: [] }],
    skills: {
      'probe-a': probeSkill(['写代码', '崩溃', 'CAS', '重构', '崩溃', 'ELABORATE']),
      'probe-b': probeSkill(['排错', '卡顿', '写代码', '重构', '崩溃', 'CAS']),
      'probe-missing': probeSkill(['排错', '卡顿', 'CAS', '重构', '崩溃', '写代码']),
    },
  };
  const metadataProbe = validateRegistryMetadata('<probe>', metadataRegistry, '<probe>/.agents/skills', ['probe-a', 'stray-dir'], {
    readSkillDocument: () => 'raw-bytes',
    expectedDocument: () => 'DRIFTED',
  });
  probe(
    'SKILL-METADATA flags closure gaps, render drift and trigger violations',
    ['probe-missing', 'stray-dir', 'differs from the registry render', "'ELABORATE'", 'duplicated inside the skill']
      .every((needle) => metadataProbe.some((message) => message.includes(needle))),
  );

  const linkageRegistry = {
    activation: probeActivation,
    layers: [{ id: 'probe-layer', order: 1, title: 'probe', positioning: 'probe' }],
    domains: [{
      id: 'probe-domain',
      archetype: 'probe-archetype',
      chain: ['probe-a'],
      supports: ['probe-x'],
      scenarios: [{ intent: 'probe scenario', skills: ['probe-a', 'ghost-skill'] }],
    }],
    skills: {
      'probe-a': probeSkill(['写代码', '崩溃', 'CAS', '重构', '排错', '卡顿']),
      'probe-x': { layer: 'unknown-layer', triggers: [], pitch: 'probe', purpose: 'probe', situations: [], verification: [] },
      'probe-orphan': probeSkill(['写代码', '崩溃', 'CAS', '重构', '排错', '卡顿']),
    },
  };
  const linkageProbe = validateRegistryLinkage('<probe>', linkageRegistry, () => ['other-skill']);
  probe(
    'SKILL-LINKAGE flags chain, archetype, scenario, layer and linkage violations',
    ['chain needs at least 2', 'absent from archetype', 'unknown skill', "layer 'unknown-layer'", 'belongs to no domain', 'no predecessor, successor or parallel support']
      .every((needle) => linkageProbe.some((message) => message.includes(needle))),
  );

  const cleanMetadataRegistry = {
    activation: probeActivation,
    layers: [{ id: 'probe-layer', order: 1, title: 'probe', positioning: 'probe' }],
    domains: [],
    skills: {
      'probe-a': probeSkill(['写代码', '崩溃', 'CAS', '重构', '排错', '卡顿']),
      'probe-b': probeSkill(['写代码', '崩溃', 'CAS', '重构', '排错', '卡顿']),
    },
  };
  probe(
    'SKILL-METADATA accepts a clean registry and matching entry files',
    validateRegistryMetadata('<probe>', cleanMetadataRegistry, '<probe>/.agents/skills', ['probe-a', 'probe-b'], {
      readSkillDocument: () => 'rendered',
      expectedDocument: () => 'rendered',
    }).length === 0,
  );

  const cleanLinkageRegistry = {
    activation: probeActivation,
    layers: [{ id: 'probe-layer', order: 1, title: 'probe', positioning: 'probe' }],
    domains: [{
      id: 'probe-domain',
      archetype: 'probe-archetype',
      chain: ['probe-a', 'probe-b'],
      supports: [],
      scenarios: [{ intent: 'probe scenario', skills: ['probe-a', 'probe-b'] }],
    }],
    skills: {
      'probe-a': probeSkill([]),
      'probe-b': probeSkill([]),
    },
  };
  probe(
    'SKILL-LINKAGE accepts a clean chain with a matching archetype',
    validateRegistryLinkage('<probe>', cleanLinkageRegistry, () => ['probe-a']).length === 0,
  );

  probe(
    'SKILL-CATALOG accepts a matching catalogue',
    validateSkillCatalogDocument('<probe>', metadataRegistry, { expectedText: 'same', actualText: 'same' }).length === 0,
  );

  probe(
    'SKILL-CATALOG flags catalogue drift',
    validateSkillCatalogDocument('<probe>', metadataRegistry, { expectedText: 'expected', actualText: 'drifted' })
      .some((message) => message.includes('SKILL-CATALOG') && message.includes('differs from the registry render')),
  );
  probe(
    'SKILL-CATALOG flags a missing catalogue',
    validateSkillCatalogDocument('<probe>', metadataRegistry, { expectedText: 'expected', actualText: null })
      .some((message) => message.includes('SKILL-CATALOG') && message.includes('is missing')),
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
    allErrors.push(...validateSkillCodeAssets(skillPath));
    for (const orphan of findOrphanAssets(skillPath)) {
      allErrors.push(`${orphan}: orphan asset, not referenced by any Markdown file in its skill`);
    }
  }

  const allMdFiles = collectMarkdownFiles(skillsDir);
  for (const mdFile of allMdFiles) {
    allErrors.push(...validateMarkdownFile(mdFile, registeredRules));
  }

  allErrors.push(...validatePluginBundle(repoRoot));

  let skillRegistry = null;
  try {
    skillRegistry = skillResolver.loadRegistry(repoRoot).registry;
  } catch (e) {
    allErrors.push(`${SKILL_ASSERTIONS.metadata}: cannot load scripts/common/skill-registry.json: ${e.message}`);
  }
  if (skillRegistry) {
    allErrors.push(...validateRegistryMetadata(repoRoot, skillRegistry, skillsDir, skillFolders));
    allErrors.push(...validateRegistryLinkage(repoRoot, skillRegistry));
    allErrors.push(...validateSkillCatalogDocument(repoRoot, skillRegistry));
  }

  allErrors.push(...checkErrorRuleCoverage(skillsDir, catalog.rules || []));
  allErrors.push(...runSelfProbes());

  if (allErrors.length > 0) {
    process.stderr.write(`\n✖ BLOCK  Skills validation detected ${allErrors.length} violation(s):\n`);
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
  process.stdout.write(`\n✔ All ${skillFolders.length} skills (${allMdFiles.length} markdown documents) verified successfully ${parityNote}.\n`);
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
  validateRegistryMetadata,
  validateRegistryLinkage,
  validateSkillCatalogDocument,
};
