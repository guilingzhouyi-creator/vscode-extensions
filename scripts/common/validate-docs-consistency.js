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
 *   5. Fail closed when a scanned document is unreadable;
 *   6. Cover figures written without the word 规则 after them (table cells, parentheses and
 *      Latin-qualified prose) whenever the same line talks about rules or analyzers, and read the
 *      `.agents/subagents/**` JSON corpus so subagent presets cannot quote retired totals.
 *   7. Cover the three claim shapes that carry no 条 at all — a coverage ratio (`362/362`), a
 *      per-project decomposition (`autoRefactor: 362`) and a canonical/legacy split (`347 规范`) —
 *      because a figure that never sits beside 条 was invisible to every detector above.
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

const { resolveScanScope } = require('./sync-doc-metrics');

/**
 * Directories whose JSON files are scanned alongside Markdown.
 *
 * Subagent archetypes and postures restate catalog totals inside `rigidAxioms` strings. Those files
 * are not Markdown, so a Markdown-only walk left four retired figures (428 and 335) alive in the
 * files every subagent prompt is built from — the numbers reached the model without ever passing a
 * guard. Adding the tree here is what closes that gap.
 */
const JSON_SCAN_PATHS = Object.freeze(['.agents/subagents']);

/**
 * Paths whose numbers are quoted as examples of what *not* to write.
 *
 * `batch-commit` documents the forbidden-term dictionary by quoting violating commit messages:
 * 「通过146套测试」 appears there as the specimen the rule rejects. Judging those figures against
 * the live suite count would force the guide to track the number it exists to warn about, and the
 * only way to satisfy the guard would be to delete the example.
 */
const QUOTED_COUNTEREXAMPLE_PATHS = Object.freeze(['.agents/skills/batch-commit/']);

const HISTORICAL_MARKER = /<!--\s*METRICS:IGNORE-HISTORICAL\b[^>]*commit=[0-9a-f]{7,40}/;

/**
 * Roots that own an independent `scripts/` tree.
 *
 * Documents abbreviate: a skill note writes `scripts/test-parallel.js` meaning
 * `auto-refactor/scripts/test-parallel.js`, because the surrounding prose already established the
 * project. Resolving only against the repository root flagged twenty-one such references as dead —
 * all of them true statements. Accepting any project root is the loosest reading the authors can
 * plausibly have meant, and it still catches a reference that resolves nowhere at all.
 */
const PROJECT_SCRIPT_ROOTS = Object.freeze(['auto-refactor', 'workspace-timing', 'WebGames', 'fractal-git']);

/**
 * Plan marker: a figure that is a target, not a measurement.
 *
 * `.agents/dsh/plan/` specifies what the preset family should grow into ("30 条 preset" while 23
 * exist today). A forward-looking specification is not stale drift, and forcing authors to delete
 * their roadmap to satisfy a guard would be the wrong trade. The exemption is therefore explicit and
 * must state its reason, which keeps it from becoming a silent blanket like the commit-less
 * historical marker this guard already refuses.
 */
const PLAN_MARKER = /<!--\s*METRICS:IGNORE-PLAN\b[^>]*reason=/;
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
 * A figure followed by 条 that is *not* already covered by the 规则-anchored pattern.
 *
 * The original pattern demanded the word 规则 right after the number, which silently excluded the
 * three shapes rule totals actually take in this repository: a table cell (`| 338 条 |`), a
 * parenthesised gloss (`**autoRefactor (338 条)**`) and a Latin-qualified phrase
 * (`359 条 auto-refactor 规则`). All three survived while the guard reported PASS.
 *
 * The two lookaheads keep this pattern disjoint from the main one: a figure whose 条 is followed by
 * a group counter counts containers, and a figure whose 条 is followed by up to six qualifier
 * characters and then 规则 is already judged (and possibly exempted) by the main pattern.
 */
const BARE_RULE_FIGURE = /(\d{2,4})\s*条(?!\s*(?:组|个|项|类|种|套))(?![\u4e00-\u9fa5A-Za-z]{0,6}规则)/g;

/** A line that is talking about rules or analyzers, so an unqualified 条 figure is a rule total. */
const RULE_CONTEXT = /(规则|分析器|rule)/i;

/**
 * A coverage ratio such as `362/362` or `**363 / 363 (100%)**`.
 *
 * The ratio is the shape that survived longest: a rule total restated as "how many rules have a
 * definition line" never puts 条 beside the number, so every detector above skipped it. Two retired
 * totals (`362/362` in four documents) lived through several audit rounds for exactly that reason.
 *
 * Only an equal pair is judged. `362/363` is a status claim about a known gap ("one rule still has
 * no definition line"), which is a correct sentence that no catalog total can confirm or refute;
 * demanding it equal a live figure would force the author to delete the very defect they reported.
 */
const RULE_RATIO = /(?<![0-9])(\d{2,4})\s*\/\s*(\d{2,4})(?![0-9])/g;

/**
 * A per-project decomposition such as `autoRefactor: 362, webGames: 50`.
 *
 * Also invisible to the 条 detectors: the figure is separated from its project name by a colon and
 * the sentence as a whole talks about the catalog, so no local anchor marks it as a rule count. The
 * expected value is that project's own catalog count, not the workspace total.
 */
const PROJECT_DECOMPOSITION = /"?(autoRefactor|workspaceTiming|webGames|globalTooling|fractalGit)"?\s*[:：]\s*(\d{2,4})/g;

/**
 * A canonical/legacy split such as `347 规范 + 15 历史别名`.
 *
 * The word after the figure is 规范 or 别名, not 条, so the 条 detectors never see it. The left
 * boundary refuses a figure that ends a rule id or an edition tag (`ADV-RNG-001 规范`, `P71 规范`),
 * which would otherwise be read as a rule total; the lookahead refuses 规范化 for the same reason.
 */
const RULE_SPLIT = /(?<![0-9A-Za-z\-条])(\d{2,4})\s*(?:规范(?!化)|(?:历史)?别名)/g;

/**
 * Figures after which a group counter turns the claim into a count of containers.
 *
 * `163/163 套测试` and `30 个分析器` both contain a rule figure by pattern and neither is one.
 */
const GROUP_COUNTER_FOLLOWS = /^\s*(?:组|个|项|类|种|套)/;

/** A rule-family prefix such as `ARCH-` or `FAMILY-TOPIC-NNN`, which only appears in rule prose. */
const RULE_PREFIX = /\b[A-Z]{2,7}-/;

/** A project name; combined with a rule prefix it makes a bare figure a per-project rule total. */
const PROJECT_NAME = /auto-?refactor|web-?games|workspace-?timing|global-?tooling|全局工具链|fractal-?git/i;

/**
 * Pyramid layers as a complete partition of the auto-refactor catalog.
 *
 * The layer table in `01-builtin-rules.md` quoted 51 / 102 / 144 / 41 — four figures that summed to
 * the retired total 338 and left 24 rules unassigned. Owning the partition here rather than in prose
 * makes the four layer totals derivable, and `assertLayerPartition` fails closed if a new family is
 * ever added without being placed, so the table cannot silently fall out of step again.
 */
const LAYER_FAMILIES = Object.freeze({
  'layer-1': Object.freeze(['SEC', 'HYG', 'ERR', 'CMT', 'DOC', 'SIM']),
  'layer-2': Object.freeze(['TSM', 'MOD', 'PYM', 'RSM', 'GOM', 'GDM', 'SH', 'PS', 'STDLIB', 'UI', 'PROD']),
  'layer-3': Object.freeze([
    'ARCH',
    'GOV',
    'DAT',
    'PRF',
    'DEP',
    'NAM',
    'CONST',
    'CPX',
    'CMP',
    'NUM',
    'GUARD',
    'ENG',
    'EXT',
    'BIG',
  ]),
  'layer-4': Object.freeze(['VSC', 'TST']),
});

/** Structural shapes that make an unqualified 条 figure a rule total even without the word 规则. */
const RULE_STRUCTURE =
  /\|\s*\d{2,4}\s*条\s*\||[（(]\s*\d{2,4}\s*条\s*[）)]|\d{2,4}\s*条\s*[A-Za-z][A-Za-z0-9_-]*\s*(?:规则|自测)/;

/**
 * Families counted by the nine modernization analyzers.
 *
 * `06-modernization-program.md` states a per-analyzer figure and a total. Both are derived from the
 * catalog, so adding a rule to a pack cannot leave the table quoting the previous total.
 */
const MODERNIZATION_PACKS = Object.freeze(['TSM', 'PYM', 'RSM', 'GDM', 'GOM', 'UI', 'STDLIB', 'SIM', 'CPX']);

/**
 * Spellings a project row may use in prose, mapped to the catalog's `project` value.
 *
 * The rule-catalog uses one spelling per project while documents freely mix casing and hyphenation;
 * without this map a correct row such as `` | **`autoRefactor`** | 362 条 | `` would be treated as
 * naming an unknown project and skipped, hiding real drift.
 */
const PROJECT_ALIASES = Object.freeze({
  autoRefactor: 'auto-refactor',
  autoRefactorDev: 'auto-refactor',
  webGames: 'WebGames',
  workspaceTiming: 'workspace-timing',
  globalTooling: 'global-tooling',
  fractalGit: 'fractal-git',
});

/**
 * Decides whether an unqualified 条 figure on this line is a claim about the catalog.
 *
 * Requiring the word 规则 was too narrow; requiring only 条 would flag session-capacity prose such
 * as "单日 20 条配额" and train readers to ignore the guard. A line therefore qualifies when it
 * either names rules/analyzers outright, places the figure in one of the three structural slots a
 * rule total occupies, or pairs a project name with a rule-family prefix.
 *
 * @param {string} line - Document line.
 * @returns {boolean} True when an unqualified figure here is a rule-count claim.
 */
function isRuleCountContext(line) {
  return RULE_CONTEXT.test(line) || RULE_STRUCTURE.test(line) || (PROJECT_NAME.test(line) && RULE_PREFIX.test(line));
}

/**
 * Groups auto-refactor rules by family.
 *
 * Family is the key, not the ID prefix: one CPX rule carries the legacy kebab-case id
 * `high-complexity` and therefore no prefix at all, so a prefix tally would report 12 for an
 * analyzer that actually emits 13. The family field is what the analyzer owns.
 *
 * @param {Array<object>} autoRefactorRules - Catalog entries belonging to auto-refactor.
 * @returns {Map<string, number>} Rule count per family.
 */
function groupRuleCounts(autoRefactorRules) {
  const byFamily = new Map();
  for (const rule of autoRefactorRules) {
    byFamily.set(rule.family, (byFamily.get(rule.family) || 0) + 1);
  }
  return byFamily;
}

/**
 * Resolves the four pyramid layer totals and the modernization pack total from family counts.
 *
 * Layer totals use `family` because the layer table's own family list is the claim being checked. The
 * pack total also sums families, which is what an analyzer actually emits: one CPX rule carries a
 * legacy kebab-case id with no `CPX-` prefix, and dropping it would make the analyzer's own row
 * understate its rule count.
 *
 * @param {Map<string, number>} byFamily - Rule count per family.
 * @returns {{layers: Map<string, number>, familyLayer: Map<string, string>, packTotal: number,
 *   unplaced: string[]}} Layer totals, family-to-layer index, pack sum and any unplaced family.
 */
function resolveLayerTotals(byFamily) {
  const layers = new Map();
  const familyLayer = new Map();
  for (const [layer, families] of Object.entries(LAYER_FAMILIES)) {
    let total = 0;
    for (const family of families) {
      total += byFamily.get(family) || 0;
      familyLayer.set(family, layer);
    }
    layers.set(layer, total);
  }
  const unplaced = [...byFamily.keys()].filter((family) => !familyLayer.has(family));
  const packTotal = MODERNIZATION_PACKS.reduce((sum, family) => sum + (byFamily.get(family) || 0), 0);
  return { layers, familyLayer, packTotal, unplaced };
}

/**
 * Fills the legal-figure sets that come from `doc-metrics.json` and the metrics resolvers.
 *
 * Extracted from `buildClaimDetectors` to keep that function inside the cyclomatic budget: the four
 * independent lookups plus the two narrower-claim expansions pushed it past the limit without adding
 * any decision the caller needs to see.
 *
 * @param {Set<number>} legalSkills - Skill-count set to fill.
 * @param {Set<number>} legalAnalyzers - Analyzer-count set to fill.
 * @param {Set<number>} legalPairs - Isomorphic-pair set to fill.
 * @param {Set<number>} legalSuites - Test-suite set to fill.
 * @returns {void}
 */
function collectMetricLegalSets(legalSkills, legalAnalyzers, legalPairs, legalSuites) {
  const metrics = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
  const { resolveMetrics, countIsomorphicPairs, countTestSuiteLanes } = require('./sync-doc-metrics');
  for (const [id, value] of resolveMetrics(metrics).values) {
    if (id === 'skill-count') legalSkills.add(value);
    if (id === 'analyzer-count') legalAnalyzers.add(value);
    if (id === 'iso-pairs') legalPairs.add(value);
    if (id === 'test-suite-count') legalSuites.add(value);
  }
  // Every lane count and the lane sum are correct figures on their own: a sentence that names one
  // lane is making a narrower claim, not a wrong one. Judging those against the total alone would
  // reject correct prose and, worse, teach the author to delete the breakdown.
  const lanes = countTestSuiteLanes();
  for (const value of [lanes.parallel, lanes.daemon, lanes.selfAudit, lanes.laneSum, lanes.serialSum]) {
    if (value > 0) legalSuites.add(value);
  }
  // A per-domain sentence ("根脚本库 9 对同构脚本") is a legitimate narrower claim; each domain
  // count is therefore legal on its own, while the workspace total stays the sum.
  for (const root of ['', 'WebGames', 'fractal-git']) {
    const domainPairs = countIsomorphicPairs(root);
    if (domainPairs > 0) legalPairs.add(domainPairs);
  }
}

/**
 * Builds the claim patterns together with the set of figures each pattern may legitimately quote.
 *
 * A pattern is only meaningful when its legal set is non-empty; an unreadable catalog therefore
 * disables that claim class instead of flagging every number in the repository.
 *
 * @returns {Array<object>} Claim detectors.
 */
function buildClaimDetectors() {
  const figures = buildLegalFigures();
  return detectorTable(figures).filter(
    (detector) => detector.legalFor || (detector.legal && detector.legal.size > 0),
  );
}

/**
 * Collects every figure the workspace can currently vouch for.
 *
 * Each set is derived from a live source rather than a literal, so adding a rule or a suite cannot
 * leave a stale allowance behind. An unreadable source leaves its set empty, which disables that
 * claim class instead of flagging every number in the repository.
 *
 * @returns {object} Legal-figure sets plus the per-row lookup maps.
 */
function buildLegalFigures() {
  const legalRules = new Set();
  const legalSteps = new Set();
  const legalSkills = new Set();
  const legalAnalyzers = new Set();
  const legalPairs = new Set();
  const legalSuites = new Set();
  const figures = { legalRules, legalSteps, legalSkills, legalAnalyzers, legalPairs, legalSuites };
  if (fs.existsSync(CATALOG_FILE)) {
    collectCatalogFigures(figures, JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8')));
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
    collectMetricLegalSets(legalSkills, legalAnalyzers, legalPairs, legalSuites);
  }
  return figures;
}

/**
 * Fills the rule-family, project and layer lookup maps from the rule catalog.
 *
 * @param {object} figures - Mutable legal-figure bundle from `buildLegalFigures`.
 * @param {object} catalog - Parsed `rule-catalog.json`.
 * @returns {void}
 */
function collectCatalogFigures(figures, catalog) {
  figures.legalRules.add(catalog.totalRules);
  for (const value of Object.values(catalog.counts || {})) figures.legalRules.add(value);
  // A canonical/legacy split is a legitimate narrower claim about the same catalog, so both halves
  // are legal figures on their own while the sum stays the project total.
  const autoRefactor = (catalog.rules || []).filter((rule) => rule.project === 'auto-refactor');
  const canonical = autoRefactor.filter((rule) => CANONICAL_RULE_ID.test(rule.id)).length;
  figures.legalRules.add(canonical);
  figures.legalRules.add(autoRefactor.length - canonical);

  figures.byFamily = groupRuleCounts(autoRefactor);
  figures.byProject = new Map();
  for (const rule of catalog.rules || []) {
    figures.byProject.set(rule.project, (figures.byProject.get(rule.project) || 0) + 1);
  }
  const resolved = resolveLayerTotals(figures.byFamily);
  figures.layers = resolved.layers;
  figures.familyLayer = resolved.familyLayer;
  figures.packTotal = resolved.packTotal;
  for (const value of figures.layers.values()) figures.legalRules.add(value);
  figures.legalRules.add(figures.packTotal);
}

/**
 * Declares every claim pattern together with the set each may legitimately quote.
 *
 * Kept as one declarative table so adding a claim class is a data edit rather than another branch:
 * the previous shape interleaved four source reads with the table and outgrew the cyclomatic budget.
 *
 * @param {object} figures - Legal-figure bundle from `buildLegalFigures`.
 * @returns {Array<object>} Claim detectors.
 */
function detectorTable(figures) {
  const { legalRules, legalSteps, legalSkills, legalAnalyzers, legalPairs, legalSuites } = figures;
  const { byFamily, byProject, layers, packTotal } = figures;
  return [
    {
      id: 'rule-count',
      pattern: /(\d{2,4})\s*([组个项类种套])?\s*(?:条)?\s*([\u4e00-\u9fa5A-Za-z]{0,6}?)规则/g,
      legal: legalRules,
      counterGroup: 2,
      qualifierGroup: 3,
    },
    {
      id: 'project-row',
      pattern: /\|\s*\*\*`([a-zA-Z][a-zA-Z-]*)`\*\*\s*\|\s*(\d{1,4})\s*条/g,
      numberGroup: 2,
      legalFor: (match) => singleValue(byProject.get(match[1]) ?? byProject.get(PROJECT_ALIASES[match[1]] ?? '')),
    },
    {
      id: 'family-row',
      pattern: /`([A-Z]{2,7})-\*`\s*\|\s*(\d{1,4})\s*条/g,
      numberGroup: 2,
      legalFor: (match) => singleValue(byFamily.get(match[1])),
    },
    {
      id: 'family-count-after',
      pattern: /`([A-Z]{2,7})`\s*族?\s*(\d{1,4})\s*条/g,
      numberGroup: 2,
      legalFor: (match) => singleValue(byFamily.get(match[1])),
    },
    {
      id: 'family-count-before',
      pattern: /(\d{1,4})\s*条\s*`([A-Z]{2,7})`/g,
      numberGroup: 1,
      legalFor: (match) => singleValue(byFamily.get(match[2])),
    },
    {
      id: 'layer-row',
      pattern: /\|\s*\*\*Layer\s*(\d)[^*]*\*\*\s*\|\s*(\d{1,4})\s*条/g,
      numberGroup: 2,
      legalFor: (match) => singleValue(layers.get(`layer-${match[1]}`)),
    },
    {
      id: 'pack-total',
      pattern: /(\d{1,4})\s*条受控现代化规则/g,
      legalFor: () => singleValue(packTotal),
    },
    {
      id: 'rule-count-bare',
      pattern: BARE_RULE_FIGURE,
      legal: legalRules,
      contextTest: isRuleCountContext,
    },
    {
      id: 'rule-ratio',
      pattern: RULE_RATIO,
      numberGroups: [1, 2],
      legal: legalRules,
      contextTest: isRuleCountContext,
      pairJudge: judgeRatioPair,
    },
    {
      id: 'project-decomposition',
      pattern: PROJECT_DECOMPOSITION,
      numberGroup: 2,
      legalFor: (match) => singleValue(byProject.get(PROJECT_ALIASES[match[1]] ?? match[1])),
    },
    {
      id: 'rule-split',
      pattern: RULE_SPLIT,
      legal: legalRules,
      contextTest: isRuleCountContext,
    },
    { id: 'skill-count', pattern: /(\d{1,3})\s*项(?:研发)?技能/g, legal: legalSkills },
    { id: 'step-count', pattern: /(\d{1,3})\s*个语义步骤/g, legal: legalSteps },
    { id: 'iso-pairs', pattern: /(\d{1,3})\s*对(?:跨平台)?同构脚本/g, legal: legalPairs },
    { id: 'analyzer-count', pattern: /(?<![A-Za-z0-9])(\d{1,3})\s*(?:个)?(?:内置)?分析器/g, legal: legalAnalyzers },
    {
      id: 'test-suite',
      // The suite count is stated three legitimate ways: the executable total, one lane on its own,
      // and the additive decomposition of the lanes. All three figures are legal; a fourth value is
      // a stale claim. The lookahead keeps the quantifier out of unrelated uses such as 「一套方案」.
      pattern: /(\d{1,3})\s*(?:套(?=测试|并行|串行|vitest|套件)|个(?:并行|串行)\s*套件)/g,
      legal: legalSuites,
    },
  ];
}

/**
 * Wraps one derived figure as a legal set, or an empty set when the lookup missed.
 *
 * An empty set means the claim cannot be judged (the row names something the catalog does not
 * know), so the caller skips it rather than flagging every figure on the line.
 *
 * @param {number|undefined} value - Derived figure.
 * @returns {Set<number>} Single-element set, or empty.
 */
function singleValue(value) {
  return Number.isInteger(value) ? new Set([value]) : new Set();
}

/**
 * Recursively collects Markdown files in scope, plus the JSON corpus under `JSON_SCAN_PATHS`.
 *
 * The scan scope comes from `doc-metrics.json` rather than a local copy: four guards walk this same
 * corpus, and the copies had already diverged once.
 *
 * @returns {string[]} Absolute file paths.
 */
function collectDocuments() {
  const scope = resolveScanScope(JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8')));
  const skipDirs = new Set(scope.skipDirectories);
  const skipPaths = new Set(scope.skipPaths);
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
  for (const rel of JSON_SCAN_PATHS) {
    const abs = path.join(REPO_ROOT, rel);
    if (fs.existsSync(abs)) walkJson(abs, files);
  }
  return files;
}

/**
 * Collects JSON files below a subagent tree.
 *
 * The tree is two levels deep (archetypes/, postures/, schemas/), so a shallow read would miss every
 * file that actually carries a catalog total.
 *
 * @param {string} dir - Absolute directory.
 * @param {string[]} files - Collector array.
 * @returns {void}
 */
function walkJson(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJson(full, files);
    else if (entry.name.endsWith('.json')) files.push(full);
  }
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
    if (HISTORICAL_MARKER.test(lines[cursor]) || PLAN_MARKER.test(lines[cursor])) return true;
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
 * Returns the legal figure set a detector applies to one match.
 *
 * A detector either carries a fixed set (the workspace-wide claims) or derives a set per row (a
 * project row, a family row, a layer row), because those rows assert a narrower figure that only the
 * catalog knows. A derived empty set means the row names something the catalog does not contain, so
 * the claim is unjudgeable and skipped instead of being reported.
 *
 * @param {object} detector - Claim detector.
 * @param {RegExpExecArray} match - Current match.
 * @returns {Set<number>} Legal figures for this match.
 */
function legalSetFor(detector, match) {
  return detector.legalFor ? detector.legalFor(match) : detector.legal;
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
  const rowDetectors = detectors.filter((detector) => detector.legalFor);
  const genericDetectors = detectors.filter((detector) => !detector.legalFor);
  lines.forEach((line, index) => {
    if (isHistoricallyExempt(lines, index)) return;
    // Row-shaped claims (project row, family row, layer row, pack total) assert a narrower figure
    // than the workspace total, so they own every number they recognise — including the correct
    // ones. Without that ownership a valid row ("`TSM-*` | 11 条" where 11 really is the family
    // count) would be judged a second time against the workspace set and reported as drift.
    const rowOwned = new Set();
    for (const detector of rowDetectors) {
      for (const claim of matchClaims(detector, line, index)) {
        rowOwned.add(claim.claimed);
        if (!claim.legal.includes(claim.claimed)) found.push(claim);
      }
    }
    for (const detector of genericDetectors) {
      if (detector.contextTest && !detector.contextTest(line)) continue;
      for (const claim of matchClaims(detector, line, index)) {
        if (rowOwned.has(claim.claimed)) continue;
        if (!claim.legal.includes(claim.claimed)) found.push(claim);
      }
    }
  });
  return found;
}

/**
 * Extracts the figure one match asserts.
 *
 * Most detectors assert a single number. A coverage ratio asserts a pair, and reporting both
 * endpoints of `362/362` would file the same sentence twice; the ratio therefore reports one
 * representative figure — the first endpoint the catalog does not produce, or the first endpoint
 * when both are live, which the caller then accepts.
 *
 * @param {object} detector - Claim detector.
 * @param {RegExpExecArray} match - Current match.
 * @param {Set<number>} legal - Legal figures for this match.
 * @returns {number} Figure to judge.
 */
function claimedFigure(detector, match, legal) {
  if (!detector.numberGroups) return Number(detector.numberGroup ? match[detector.numberGroup] : match[1]);
  const figures = detector.numberGroups.map((group) => Number(match[group]));
  return figures.find((value) => !legal.has(value)) ?? figures[0];
}

/**
 * Extracts the figures one match asserts.
 *
 * Most detectors assert a single number. A coverage ratio asserts a pair, and both endpoints are
 * returned so the caller can decide which of them to report.
 *
 * @param {object} detector - Claim detector.
 * @param {RegExpExecArray} match - Current match.
 * @returns {number[]} Asserted figures.
 */
function assertedFigures(detector, match) {
  if (detector.numberGroups) return detector.numberGroups.map((group) => Number(match[group]));
  return [Number(detector.numberGroup ? match[detector.numberGroup] : match[1])];
}

/**
 * Judges a coverage ratio, returning the figure to report or null to accept the pair.
 *
 * An unequal pair is a status claim about a known gap ("one rule still has no definition line"),
 * which no catalog total can confirm or refute; demanding it equal a live figure would force the
 * author to delete the very defect they reported. A pair followed by a group counter counts
 * containers (`163/163 套测试`), not rules. Otherwise the pair must equal a live figure, and the
 * first endpoint that does not is reported — reporting both would file one sentence twice.
 *
 * @param {object} detector - Claim detector (unused; kept for a uniform signature).
 * @param {RegExpExecArray} match - Current match.
 * @param {Set<number>} legal - Legal figures for this match.
 * @param {string} line - Document line, for the trailing-counter test.
 * @returns {number|null} Figure to report, or null when the pair is acceptable.
 */
function judgeRatioPair(detector, match, legal, line) {
  const figures = assertedFigures(detector, match);
  if (figures[0] !== figures[1]) return null;
  if (GROUP_COUNTER_FOLLOWS.test(line.slice(match.index + match[0].length))) return null;
  return figures.find((value) => !legal.has(value)) ?? null;
}

/**
 * Collects every figure one detector recognises on one line, with the set it was judged against.
 *
 * Returning the legal set alongside the figure — rather than filtering here — is what lets the
 * caller decide whether a row already owns the number before the generic detectors see it.
 *
 * @param {object} detector - Claim detector.
 * @param {string} line - Document line.
 * @param {number} index - Zero-based line index.
 * @returns {Array<{line: number, claim: string, claimed: number, legal: number[]}>} Judged figures.
 */
function matchClaims(detector, line, index) {
  const claims = [];
  detector.pattern.lastIndex = 0;
  let match;
  while ((match = detector.pattern.exec(line)) !== null) {
    const legal = legalSetFor(detector, match);
    if (legal.size === 0) continue;
    if (detector.counterGroup && match[detector.counterGroup]) continue;
    if (detector.qualifierGroup && isCategoryClaim(match[detector.qualifierGroup])) continue;
    if (isRangeMember(line, match.index)) continue;
    if (detector.skipMatch && detector.skipMatch(line, match)) continue;
    const claimed = detector.pairJudge
      ? detector.pairJudge(detector, match, legal, line)
      : claimedFigure(detector, match, legal);
    if (claimed === null) continue;
    claims.push({ line: index + 1, claim: detector.id, claimed, legal: [...legal].sort((a, b) => a - b) });
  }
  return claims;
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
  if (QUOTED_COUNTEREXAMPLE_PATHS.some((prefix) => relative.startsWith(prefix))) return;
  for (const claim of scanTextForClaims(fs.readFileSync(file, 'utf8'), detectors)) {
    violations.push({
      type: 'RULE_COUNT_DRIFT',
      claim: claim.claim,
      file: relative,
      line: claim.line,
      detail: `Claims ${claim.claimed} for ${claim.claim}; live sources produce ${claim.legal.join('/')}.`,
    });
  }
}

/**
 * Reports whether a backticked script reference points at a real file under any accepted reading.
 *
 * @param {string} ref - Reference text without the backticks.
 * @returns {boolean} True when the root or one project supplies the file.
 */
function resolvesScriptReference(ref) {
  if (fs.existsSync(path.join(REPO_ROOT, ref))) return true;
  if (PROJECT_SCRIPT_ROOTS.some((owner) => fs.existsSync(path.join(REPO_ROOT, owner, ref)))) {
    return true;
  }
  // Source fallback for compiled scripts (e.g., scripts/dist/review/run-review.js -> scripts/review/run-review.ts)
  if (ref.includes('dist/')) {
    const srcRef = ref.replace(/([/\\])dist[/\\]/, '$1').replace(/\.js$/, '.ts');
    if (fs.existsSync(path.join(REPO_ROOT, srcRef))) return true;
    if (PROJECT_SCRIPT_ROOTS.some((owner) => fs.existsSync(path.join(REPO_ROOT, owner, srcRef)))) {
      return true;
    }
  }
  return false;
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
      if (resolvesScriptReference(rel)) continue;
      violations.push({
        type: 'DEAD_SCRIPT_REFERENCE',
        file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
        line: index + 1,
        detail: rel,
      });
    }
  });
}

/**
 * Command invocations inside fenced blocks that name a `scripts/...` path.
 *
 * Backticks are not where runnable instructions live — commands live in fences, written as
 * `node scripts/common/x.js`. Those lines were never verified, so a renamed script could leave a
 * copy-pasteable command pointing at nothing while every guard stayed green. Matching only inside
 * fenced ranges keeps prose mentions and illustrative pseudo-commands out of scope.
 */
const FENCED_COMMAND_REFERENCE = /(?:^|\s)(?:node|bash|sh|pwsh|\.\/)?\s*(scripts\/[A-Za-z0-9_./-]+\.(?:js|ps1|sh))/g;

/**
 * Collects the character ranges occupied by fenced code blocks.
 *
 * @param {string} text - Document body.
 * @returns {Array<[number, number]>} Half-open ranges between an opening and closing fence.
 */
function collectFenceRanges(text) {
  const ranges = [];
  const fence = /^[ \t]*(`{3,}|~{3,})[^\n]*$/gm;
  let open = null;
  let match;
  while ((match = fence.exec(text)) !== null) {
    if (open === null) {
      open = { marker: match[1][0], start: match.index + match[0].length };
      continue;
    }
    if (match[1][0] !== open.marker) continue;
    ranges.push([open.start, match.index]);
    open = null;
  }
  if (open !== null) ranges.push([open.start, text.length]);
  return ranges;
}

/**
 * Scans the fenced blocks of one document for commands naming a missing script.
 *
 * @param {string} file - Absolute file path.
 * @param {Array<object>} violations - Collector array.
 * @returns {void}
 */
function scanFencedCommands(file, violations) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  for (const [start, end] of collectFenceRanges(text)) {
    const body = text.slice(start, end);
    for (const hit of body.matchAll(FENCED_COMMAND_REFERENCE)) {
      const ref = hit[1];
      if (resolvesScriptReference(ref)) continue;
      violations.push({
        type: 'DEAD_FENCED_COMMAND',
        file: rel,
        line: text.slice(0, start + hit.index).split('\n').length,
        detail: ref,
      });
    }
  }
}

/**
 * Runs the documentation consistency audit.
 *
 * @returns {Array<object>} Detected violations.
 */
function runAudit() {
  const violations = [];
  const detectors = buildClaimDetectors();
  const documents = collectDocuments();
  for (const file of documents) scanCounts(file, violations, detectors);
  for (const file of documents) {
    if (!file.endsWith('.md')) continue;
    scanScriptReferences(file, violations);
    scanFencedCommands(file, violations);
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
    console.log('  ✔  Documentation consistency: counts and script references are aligned.');
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

module.exports = Object.freeze({ runAudit, buildClaimDetectors, scanTextForClaims, resolvesScriptReference });
