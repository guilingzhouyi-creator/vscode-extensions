/**
 * Module: Documentation Consistency Guard — Counts and Script References
 * File Path: scripts/common/validate-docs-consistency.js
 * Architecture Role: Prevents governance documents from drifting away from the SSOT by rejecting
 *   scale counts that no live source produces, and dead references to script entry points.
 * Dependencies & Triggers: Consumes Node.js standard libraries (fs, path), rule-catalog.json,
 *   gate-step-registry.json and doc-metrics.json; invoked by pre-push gate, audit-all, and CI.
 * Responsibilities:
 *   1. Scan the whole repository Markdown corpus (minus vendored, archived and game-design trees)
 *      for scale figures, and reject any figure that is not a value a live source actually produces;
 *   2. Honour `METRICS:IGNORE-HISTORICAL commit=<hash>` exemptions for dated historical snapshots;
 *   3. Verify every backticked scripts/** path in core documents exists on disk;
 *   4. Emit line-accurate diagnostics with human and JSON output;
 *   5. Fail closed when a scanned document is unreadable.
 * Exit Semantics & Design Rationale: 0 = documents quote only live figures and reference only
 *   existing scripts, 1 = drift detected. The previous implementation matched a fixed blacklist of
 *   historical numbers (428/464/468/470), which is exactly the failure mode it was meant to prevent:
 *   473, 385, 353, 338, 335, 325 and 323 drifted for months because nobody remembered to add them.
 *   The guard therefore derives the legal value set from the catalogs on every run, so a rule
 *   addition legalises the new figure automatically and an obsolete one becomes illegal automatically.
 *   Scope is a blacklist rather than a whitelist for the same reason: a new document is covered the
 *   moment it is created, instead of waiting for someone to remember to list it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CATALOG_FILE = path.join(REPO_ROOT, 'scripts/common/rule-catalog.json');
const REGISTRY_FILE = path.join(REPO_ROOT, 'scripts/common/gate-step-registry.json');
const METRICS_FILE = path.join(REPO_ROOT, 'scripts/common/doc-metrics.json');

const PATH_SCAN_FILES = Object.freeze([
  'AGENTS.md',
  'scripts/README.md',
  'docs/system-spec/script-governance-architecture.md',
]);

const SKIP_DIRECTORIES = Object.freeze([
  'node_modules',
  '.git',
  'out',
  'dist',
  'bin',
  'obj',
  'target',
  '.venv',
  '.audit-logs',
  'archive',
]);

const SKIP_PATHS = Object.freeze(['WebGames/docs', '.agents/plugins']);

const HISTORICAL_MARKER = /<!--\s*METRICS:IGNORE-HISTORICAL\b[^>]*commit=[0-9a-f]{7,40}/;
const CANONICAL_RULE_ID = /^[A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{2,10}){1,3}-\d{3}$/;
const SCRIPT_REFERENCE_PATTERN = /`(scripts\/[A-Za-z0-9_./-]+\.(?:js|ps1|sh|json|md))`/g;
const METRICS_REGION = /<!--\s*METRICS:BEGIN\s+[a-z0-9-]+\s*-->[\s\S]*?<!--\s*METRICS:END\s+[a-z0-9-]+\s*-->/g;

/**
 * Qualifiers that turn a figure into a claim about one category rather than the whole catalog.
 *
 * "102 条现代化规则" counts one rule family; flagging it as a stale total would train readers to
 * ignore the guard. Every other qualifier (内置 / 注册 / 规范命名 / 全量 …) still describes the
 * catalog as a whole and must therefore equal a live figure.
 */
const CATEGORY_QUALIFIERS = Object.freeze([
  '现代化',
  '领域',
  '专精',
  '子集',
  '类别',
  '前端',
  '后端',
]);

/**
 * Counter words that make a figure a count of groups rather than a count of rules.
 *
 * "11 组重叠规则族" and "30 个标准规则族系" both end in 规则 but count containers, not rules;
 * matching them would flag correct prose and bury the real drift. The rule-count pattern therefore
 * refuses to start a match when one of these counters follows the number.
 */
const GROUP_COUNTERS = '组|个|项|类|种|套';

/**
 * Builds the claim patterns together with the set of figures each pattern may legitimately quote.
 *
 * A pattern is only meaningful when its legal set is non-empty; an unreadable catalog therefore
 * disables that claim class instead of flagging every number in the repository.
 *
 * @returns {Array<{id: string, pattern: RegExp, legal: Set<number>}>} Claim detectors.
 */
function buildClaimDetectors() {
  const legalRules = new Set();
  const legalSteps = new Set();
  const legalSkills = new Set();
  const legalAnalyzers = new Set();
  const legalPairs = new Set();

  if (fs.existsSync(CATALOG_FILE)) {
    const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    legalRules.add(catalog.totalRules);
    for (const value of Object.values(catalog.counts || {})) legalRules.add(value);
    // A canonical/legacy split is a legitimate narrower claim about the same catalog, so both
    // halves are legal figures on their own while the sum stays the project total.
    const autoRefactor = (catalog.rules || []).filter((rule) => rule.project === 'auto-refactor');
    const canonical = autoRefactor.filter((rule) => CANONICAL_RULE_ID.test(rule.id)).length;
    legalRules.add(canonical);
    legalRules.add(autoRefactor.length - canonical);
  }
  if (fs.existsSync(REGISTRY_FILE)) {
    const registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    let total = 0;
    for (const entry of Object.values(registry.entries || {})) {
      const count = Array.isArray(entry.steps) ? entry.steps.length : 0;
      legalSteps.add(count);
      total += count;
    }
    legalSteps.add(total);
  }
  if (fs.existsSync(METRICS_FILE)) {
    const metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
    const { resolveMetrics, countIsomorphicPairs } = require('./sync-doc-metrics');
    for (const [id, value] of resolveMetrics(metrics).values) {
      if (id === 'skill-count') legalSkills.add(value);
      if (id === 'analyzer-count') legalAnalyzers.add(value);
      if (id === 'iso-pairs') legalPairs.add(value);
    }
    // A per-domain sentence ("根脚本库 9 对同构脚本") is a legitimate narrower claim; each domain
    // count is therefore legal on its own, while the workspace total stays the sum.
    for (const root of ['', 'WebGames', 'fractal-git']) {
      const domainPairs = countIsomorphicPairs(root);
      if (domainPairs > 0) legalPairs.add(domainPairs);
    }
  }

  return [
    {
      id: 'rule-count',
      pattern: /(\d{2,4})\s*([组个项类种套])?\s*(?:条)?\s*([\u4e00-\u9fa5A-Za-z]{0,6}?)规则/g,
      legal: legalRules,
      counterGroup: 2,
      qualifierGroup: 3,
    },
    { id: 'skill-count', pattern: /(\d{1,3})\s*项(?:研发)?技能/g, legal: legalSkills },
    { id: 'step-count', pattern: /(\d{1,3})\s*个语义步骤/g, legal: legalSteps },
    { id: 'iso-pairs', pattern: /(\d{1,3})\s*对(?:跨平台)?同构脚本/g, legal: legalPairs },
    { id: 'analyzer-count', pattern: /(\d{1,3})\s*个内置分析器/g, legal: legalAnalyzers },
  ].filter((detector) => detector.legal.size > 0);
}

/**
 * Recursively collects Markdown files in scope.
 *
 * @returns {string[]} Absolute file paths.
 */
function collectDocuments() {
  const skipDirs = new Set(SKIP_DIRECTORIES);
  const skipPaths = new Set(SKIP_PATHS);
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipPaths.has(path.relative(REPO_ROOT, full).replace(/\\/g, '/'))) continue;
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        files.push(full);
      }
    }
  };
  walk(REPO_ROOT);
  return files;
}

/**
 * Blanks out rendered metric regions so a machine-maintained figure is never re-judged as prose.
 *
 * @param {string} text - Document body.
 * @returns {string} Body with metric regions replaced by same-length whitespace.
 */
function blankMetricRegions(text) {
  return text.replace(METRICS_REGION, (region) => region.replace(/[^\n]/g, ' '));
}

/**
 * Reports whether a line sits in an explicitly exempted historical paragraph.
 *
 * The exemption is paragraph-scoped, not line-scoped: a dated review conclusion often spans a dozen
 * wrapped lines, so a fixed lookback window would exempt the first sentence and flag the rest. The
 * marker must also name the commit it describes, which keeps a bare "ignore" from becoming a blanket
 * escape hatch for live prose.
 *
 * @param {string[]} lines - Document lines.
 * @param {number} index - Zero-based line index.
 * @returns {boolean} True when a valid exemption marker governs the enclosing paragraph.
 */
function isHistoricallyExempt(lines, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (HISTORICAL_MARKER.test(lines[cursor])) return true;
    if (lines[cursor].trim() === '') return false;
  }
  return false;
}

/**
 * Reports whether a qualifier narrows a rule figure to one category.
 *
 * @param {string} qualifier - Text between the number and 规则.
 * @returns {boolean} True when the figure describes a category, not the catalog.
 */
function isCategoryClaim(qualifier) {
  return CATEGORY_QUALIFIERS.some((word) => qualifier.includes(word));
}

/**
 * Reports whether a claimed figure is one endpoint of a numeric range in the same clause.
 *
 * Prose such as "3~5 项技能" or "9-12 条规则" bounds a working set rather than asserting a catalog
 * total; treating those endpoints as totals would flag correct text and train readers to ignore the
 * guard. Only an unqualified figure is a claim about the whole workspace.
 *
 * @param {string} line - Document line.
 * @param {number} index - Offset of the matched number.
 * @returns {boolean} True when the number is a range endpoint.
 */
function isRangeMember(line, index) {
  const before = line.slice(Math.max(0, index - 2), index);
  const after = line.slice(index, index + 6);
  return /[~～\-—至到]$/.test(before) || /^\d*[~～\-—至到]/.test(after.replace(/^\d+/, ''));
}

/**
 * Scans a document body for scale figures that no live source produces.
 *
 * Extracted from `scanCounts` so the guard's own negative probes can drive the exact same matcher
 * with a synthetic document instead of a file on disk.
 *
 * @param {string} text - Document body.
 * @param {Array<object>} detectors - Claim detectors from `buildClaimDetectors`.
 * @returns {Array<{line: number, claim: string, claimed: number}>} Detected claims.
 */
function scanTextForClaims(text, detectors) {
  const lines = blankMetricRegions(text).split('\n');
  const found = [];
  lines.forEach((line, index) => {
    if (isHistoricallyExempt(lines, index)) return;
    for (const detector of detectors) {
      detector.pattern.lastIndex = 0;
      let match;
      while ((match = detector.pattern.exec(line)) !== null) {
        const claimed = Number(match[1]);
        if (detector.legal.has(claimed)) continue;
        if (detector.counterGroup && match[detector.counterGroup]) continue;
        if (detector.qualifierGroup && isCategoryClaim(match[detector.qualifierGroup])) continue;
        if (isRangeMember(line, match.index)) continue;
        found.push({ line: index + 1, claim: detector.id, claimed });
      }
    }
  });
  return found;
}

/**
 * Scans one document for scale figures that no live source produces.
 *
 * @param {string} file - Absolute file path.
 * @param {Array<object>} violations - Collector array.
 * @param {Array<object>} detectors - Claim detectors from `buildClaimDetectors`.
 * @returns {void}
 */
function scanCounts(file, violations, detectors) {
  const relative = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  for (const claim of scanTextForClaims(fs.readFileSync(file, 'utf8'), detectors)) {
    violations.push({
      type: 'RULE_COUNT_DRIFT',
      claim: claim.claim,
      file: relative,
      line: claim.line,
      detail: `Claims ${claim.claimed} for ${claim.claim}; live sources produce ${[...detectors.find((d) => d.id === claim.claim).legal].sort((a, b) => a - b).join('/')}.`,
    });
  }
}

/**
 * Scans a file for backticked script references that do not exist.
 *
 * @param {string} file - Absolute file path.
 * @param {Array<object>} violations - Collector array.
 * @returns {void}
 */
function scanScriptReferences(file, violations) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    let match;
    SCRIPT_REFERENCE_PATTERN.lastIndex = 0;
    while ((match = SCRIPT_REFERENCE_PATTERN.exec(line)) !== null) {
      const rel = match[1];
      if (!fs.existsSync(path.join(REPO_ROOT, rel))) {
        violations.push({
          type: 'DEAD_SCRIPT_REFERENCE',
          file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
          line: index + 1,
          detail: rel,
        });
      }
    }
  });
}

/**
 * Runs the documentation consistency audit.
 *
 * @returns {Array<object>} Detected violations.
 */
function runAudit() {
  const violations = [];
  const detectors = buildClaimDetectors();
  for (const file of collectDocuments()) scanCounts(file, violations, detectors);
  for (const rel of PATH_SCAN_FILES) {
    const file = path.join(REPO_ROOT, rel);
    if (fs.existsSync(file)) scanScriptReferences(file, violations);
  }
  return violations;
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const isAgent = process.argv.includes('--agent') || process.argv.includes('--json');
  const violations = runAudit();
  const passed = violations.length === 0;

  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'docs-consistency',
          violations,
          summary: passed
            ? 'Governance documents quote only live figures and reference only existing scripts.'
            : `${violations.length} documentation drift item(s) detected.`,
        },
        null,
        2,
      ),
    );
    process.exit(passed ? 0 : 1);
  }

  if (passed) {
    console.log('  PASS Documentation consistency: counts and script references are aligned.');
    process.exit(0);
  }

  console.error(`✖ BLOCK Documentation consistency: ${violations.length} drift item(s):`);
  for (const item of violations) {
    console.error(`  - ${item.file}:${item.line} [${item.type}] ${item.detail}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({ runAudit, buildClaimDetectors, scanTextForClaims });
