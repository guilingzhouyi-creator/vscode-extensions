/**
 * Module: Documentation Metrics Renderer & Drift Guard
 * File Path: scripts/common/sync-doc-metrics.js
 * Architecture Role: Generation side of the document-metrics pipeline. Every scale figure quoted in
 *   governance prose (rule totals, gate step counts, isomorphic pair counts, skill counts, analyzer
 *   counts, script inventory size) is derived here from its authoritative source and rendered into a
 *   marker region, so no document has to remember to update a literal by hand.
 * Dependencies & Triggers: Consumes doc-metrics.json, rule-catalog.json, gate-step-registry.json, the
 *   filesystem under `.agents/skills` and `scripts/`, and the analyzer registry in
 *   auto-refactor/src/core/router/sparseRuleRouter.ts; invoked by pre-push-gate, audit-all, CI and
 *   local `--write` runs.
 * Responsibilities:
 *   1. Resolve each declared metric from its single source of truth, failing closed on an unresolvable
 *      or undeclared metric instead of silently rendering a stale number;
 *   2. Locate every marker region across the repository Markdown corpus and compare its body against
 *      the freshly resolved value, in both block form (own line) and inline form (inside a sentence);
 *   3. Rewrite drifted bodies in place under `--write` while preserving the file's line endings;
 *   4. Prove its own detector still fires through in-memory probes, so a green run is never vacuous.
 * Exit Semantics & Design Rationale: 0 = every region matches its source, 1 = drift, unresolved
 *   metric, malformed marker or failed probe. Rendering is a pure string transformation over an
 *   injected value map, which is what makes the probes possible: the same code path that checks real
 *   documents is exercised against synthetic documents whose drift is known in advance. Block form is
 *   detected structurally (the body opens and closes with a newline), so a one-line body keeps a
 *   correction diff at exactly one line; an inline body carries no newline and therefore never
 *   reflows the sentence or table row that contains it.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CONFIG_FILE = path.join(__dirname, 'doc-metrics.json');
const CATALOG_FILE = path.join(__dirname, 'rule-catalog.json');
const REGISTRY_FILE = path.join(__dirname, 'gate-step-registry.json');
const ANALYZER_ROUTER = path.join(REPO_ROOT, 'auto-refactor/src/core/router/sparseRuleRouter.ts');
const SKILL_ROOT = path.join(REPO_ROOT, '.agents/skills');
const SCRIPT_DIRS = Object.freeze(['common', 'ps1', 'sh']);
const ISO_DOMAIN_ROOTS = Object.freeze(['', 'WebGames', 'fractal-git']);
const SCRIPT_EXTENSIONS = Object.freeze(['.js', '.json', '.ps1', '.sh']);

const REGION_PATTERN =
  /<!--\s*METRICS:BEGIN\s+([a-z0-9-]+)\s*-->([\s\S]*?)<!--\s*METRICS:END\s+([a-z0-9-]+)\s*-->/g;
const HISTORICAL_MARKER = /<!--\s*METRICS:IGNORE-HISTORICAL\b[^>]*commit=[0-9a-f]{7,40}/;
const CANONICAL_RULE_ID = /^[A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{2,10}){1,3}-\d{3}$/;
const ANALYZER_ID = /ANALYZER_[A-Z0-9_]+/g;
const NEWLINE = '\n';

/**
 * Reads a JSON document, returning null instead of throwing when it is absent.
 *
 * @param {string} file - Absolute path.
 * @returns {object|null} Parsed document, or null when missing/unparsable.
 */
function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Counts Markdown files below a directory.
 *
 * @param {string} dir - Absolute directory path.
 * @returns {number} Number of `.md` files.
 */
function countMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += countMarkdownFiles(full);
    else if (entry.name.endsWith('.md')) total += 1;
  }
  return total;
}

/**
 * Intersects `.ps1` and `.sh` basenames inside one domain's scripts tree.
 *
 * @param {string} domainRoot - Repository-relative domain root ('' for the root scripts library).
 * @returns {number} Number of basenames implemented on both platforms.
 */
function countIsomorphicPairs(domainRoot) {
  const base = path.join(REPO_ROOT, domainRoot, 'scripts');
  const ps1Dir = path.join(base, 'ps1');
  const shDir = path.join(base, 'sh');
  if (!fs.existsSync(ps1Dir) || !fs.existsSync(shDir)) return 0;
  const shellNames = new Set(
    fs
      .readdirSync(shDir)
      .filter((name) => name.endsWith('.sh'))
      .map((name) => name.slice(0, -'.sh'.length)),
  );
  return fs
    .readdirSync(ps1Dir)
    .filter((name) => name.endsWith('.ps1'))
    .filter((name) => shellNames.has(name.slice(0, -'.ps1'.length))).length;
}

/**
 * Counts the controlled script files in the root scripts library.
 *
 * Only the top level of `common/`, `ps1/` and `sh/` is inventoried, matching the README matrix;
 * `common/rule-sources/` holds rule dictionaries and is described separately.
 *
 * @returns {number} File count.
 */
function countScriptInventory() {
  let total = 0;
  for (const dir of SCRIPT_DIRS) {
    const abs = path.join(REPO_ROOT, 'scripts', dir);
    if (!fs.existsSync(abs)) continue;
    total += fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .filter((entry) => SCRIPT_EXTENSIONS.includes(path.extname(entry.name))).length;
  }
  return total;
}

/**
 * Extracts the built-in analyzer ids from the router's canonical array.
 *
 * Reading the declaration rather than importing the compiled bundle keeps this guard dependency-free
 * and correct even before a build; the array itself is the single source of analyzer identity.
 *
 * @returns {number} Analyzer count, or -1 when the declaration cannot be located.
 */
function countBuiltinAnalyzers() {
  if (!fs.existsSync(ANALYZER_ROUTER)) return -1;
  const source = fs.readFileSync(ANALYZER_ROUTER, 'utf8');
  const start = source.indexOf('export const ALL_BUILTIN_ANALYZERS = [');
  if (start < 0) return -1;
  const end = source.indexOf('];', start);
  if (end < 0) return -1;
  return new Set(source.slice(start, end).match(ANALYZER_ID) || []).size;
}

/**
 * Splits the auto-refactor rules into canonical and legacy id families.
 *
 * @param {Array<object>} rules - Catalog rule entries.
 * @returns {{canonical: number, legacy: number}} Counts by id shape.
 */
function splitCanonicalRules(rules) {
  const autoRefactor = rules.filter((rule) => rule.project === 'auto-refactor');
  const canonical = autoRefactor.filter((rule) => CANONICAL_RULE_ID.test(rule.id)).length;
  return { canonical, legacy: autoRefactor.length - canonical };
}

/**
 * Builds the metric resolver table.
 *
 * Each entry is an explicit resolver rather than a generic path interpreter: an undeclared metric id
 * is a hard failure, which is what keeps `doc-metrics.json` from documenting numbers no code computes.
 *
 * @returns {Record<string, Function>} Resolvers keyed by metric id.
 */
function buildResolvers() {
  const catalog = readJson(CATALOG_FILE);
  const registry = readJson(REGISTRY_FILE);
  const counts = (catalog && catalog.counts) || {};
  const entries = (registry && registry.entries) || {};
  const stepCount = (name) => {
    const entry = entries[name];
    return entry && Array.isArray(entry.steps) ? entry.steps.length : -1;
  };
  const split = catalog ? splitCanonicalRules(catalog.rules || []) : { canonical: -1, legacy: -1 };

  return {
    'rule-total': () => (catalog ? catalog.totalRules : -1),
    'rule-auto-refactor': () => counts.autoRefactor,
    'rule-auto-refactor-canonical': () => split.canonical,
    'rule-auto-refactor-legacy': () => split.legacy,
    'rule-webgames': () => counts.webGames,
    'rule-workspace-timing': () => counts.workspaceTiming,
    'rule-fractal-git': () => counts.fractalGit,
    'rule-global-tooling': () => counts.globalTooling,
    'step-pre-commit': () => stepCount('pre-commit'),
    'step-pre-push': () => stepCount('pre-push'),
    'step-commit-msg': () => stepCount('commit-msg'),
    'step-audit-all': () => stepCount('audit-all'),
    'step-audit-taxis': () => stepCount('audit-taxis'),
    'step-total': () => Object.keys(entries).reduce((sum, name) => sum + stepCount(name), 0),
    'iso-pairs': () =>
      ISO_DOMAIN_ROOTS.reduce((sum, root) => sum + countIsomorphicPairs(root), 0),
    'iso-pairs-root': () => countIsomorphicPairs(''),
    'wg-docs-md-all': () => countMarkdownFiles(path.join(REPO_ROOT, 'WebGames/docs')),
    'wg-docs-md-active': () =>
      countMarkdownFiles(path.join(REPO_ROOT, 'WebGames/docs')) -
      countMarkdownFiles(path.join(REPO_ROOT, 'WebGames/docs/归档库')),
    'skill-count': () =>
      fs.existsSync(SKILL_ROOT)
        ? fs.readdirSync(SKILL_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).length
        : -1,
    'skill-doc-count': () => countMarkdownFiles(SKILL_ROOT),
    'analyzer-count': () => countBuiltinAnalyzers(),
    'script-inventory': () => countScriptInventory(),
  };
}

/**
 * Resolves every declared metric into a numeric value.
 *
 * @param {object} config - Parsed doc-metrics.json.
 * @returns {{values: Map<string, number>, errors: string[]}} Resolved values and failure reasons.
 */
function resolveMetrics(config) {
  const errors = [];
  const values = new Map();
  const resolvers = buildResolvers();
  if (!readJson(CATALOG_FILE)) errors.push('rule-catalog.json is missing or unparsable');
  if (!readJson(REGISTRY_FILE)) errors.push('gate-step-registry.json is missing or unparsable');

  for (const metric of config.metrics || []) {
    const resolver = resolvers[metric.id];
    if (!resolver) {
      errors.push(`metric "${metric.id}" has no resolver; declare it in sync-doc-metrics.js`);
      continue;
    }
    const value = resolver();
    if (!Number.isInteger(value) || value < 0) {
      errors.push(`metric "${metric.id}" resolved to ${value}; its source is unreadable`);
      continue;
    }
    values.set(metric.id, value);
  }
  return { values, errors };
}

/**
 * Renders one metric's body from its declared template.
 *
 * @param {object} config - Parsed doc-metrics.json.
 * @param {string} id - Metric id.
 * @param {Map<string, number>} values - Resolved metric values.
 * @param {boolean} inline - Whether to use the short inline form.
 * @returns {string|null} Rendered text, or null when the id is unknown.
 */
function renderMetric(config, id, values, inline) {
  if (!values.has(id)) return null;
  const metric = (config.metrics || []).find((entry) => entry.id === id);
  if (!metric) return null;
  const template = (inline && metric.inline) || metric.template;
  return String(template).replace('{value}', String(values.get(id)));
}

/**
 * Classifies a region body as block form or inline form.
 *
 * Block form is structural, not positional: a body that opens and closes with a newline sits on its
 * own lines, which is the only shape whose correction can stay a single-line diff.
 *
 * @param {string} body - Captured region body.
 * @returns {boolean} True for block form.
 */
function isBlockBody(body) {
  return body.startsWith(NEWLINE) && body.endsWith(NEWLINE);
}

/**
 * Computes the exact body text a region must contain.
 *
 * @param {string} rendered - Rendered value text.
 * @param {boolean} blockForm - Whether the region is block form.
 * @returns {string} Expected body.
 */
function expectedBody(rendered, blockForm) {
  return blockForm ? `${NEWLINE}${rendered}${NEWLINE}` : rendered;
}

/**
 * Collects the character ranges that hold literal code rather than live prose.
 *
 * Governance documents must be able to *show* the marker syntax — a skill that teaches the
 * `METRICS:BEGIN/END` contract has to quote it. Those quotations live inside fenced blocks or
 * inline code spans, and a renderer that treated them as live regions would rewrite the example
 * into the value it was meant to illustrate, destroying the documentation it was written for.
 *
 * @param {string} text - Document body.
 * @returns {Array<[number, number]>} Half-open character ranges to ignore.
 */
function collectCodeRanges(text) {
  const ranges = [];
  const fence = /^[ \t]*(`{3,}|~{3,})[^\n]*$/gm;
  let open = null;
  let match;
  while ((match = fence.exec(text)) !== null) {
    if (open === null) {
      open = { marker: match[1][0], start: match.index };
      continue;
    }
    if (match[1][0] !== open.marker) continue;
    ranges.push([open.start, match.index + match[0].length]);
    open = null;
  }
  if (open !== null) ranges.push([open.start, text.length]);

  for (const line of text.matchAll(/^.*$/gm)) {
    const start = line.index;
    const spans = line[0].matchAll(/(`+)[^\n]*?\1/g);
    for (const span of spans) {
      const from = start + span.index;
      if (ranges.some(([a, b]) => from >= a && from < b)) continue;
      ranges.push([from, from + span[0].length]);
    }
  }
  return ranges;
}

/**
 * Reports whether a position falls inside a literal-code range.
 *
 * @param {Array<[number, number]>} ranges - Ranges from `collectCodeRanges`.
 * @param {number} offset - Character offset.
 * @returns {boolean} True when the offset is inside literal code.
 */
function insideCode(ranges, offset) {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

/**
 * Verifies or rewrites every marker region in one document body.
 *
 * Pure over its inputs so the probes can drive it with synthetic documents.
 *
 * @param {string} text - Document body.
 * @param {Function} render - `(id, inline) => string|null` renderer.
 * @returns {{text: string, drifts: Array<object>}} Rewritten body and detected defects.
 */
function applyRegions(text, render) {
  const codeRanges = collectCodeRanges(text);
  const regions = [];
  let match;
  REGION_PATTERN.lastIndex = 0;
  while ((match = REGION_PATTERN.exec(text)) !== null) {
    if (insideCode(codeRanges, match.index)) continue;
    regions.push({ start: match.index, end: match.index + match[0].length, match });
  }

  const drifts = [];
  let output = '';
  let cursor = 0;
  for (const region of regions) {
    const found = region.match;
    const id = found[1];
    const body = found[2];
    const blockForm = isBlockBody(body);
    const rendered = render(id, !blockForm);
    output += text.slice(cursor, region.start);
    if (found[3] !== id) {
      drifts.push({ type: 'REGION_ID_MISMATCH', offset: region.start, id, detail: found[3] });
    }
    if (rendered === null) {
      drifts.push({ type: 'UNKNOWN_METRIC', offset: region.start, id });
      output += found[0];
    } else {
      const wanted = expectedBody(rendered, blockForm);
      if (body !== wanted) {
        drifts.push({
          type: 'METRIC_DRIFT',
          offset: region.start,
          id,
          expected: rendered,
          actual: body.trim(),
        });
      }
      output += found[0].replace(body, wanted);
    }
    cursor = region.end;
  }
  output += text.slice(cursor);
  return { text: output, drifts: [...drifts, ...findStrayMarkers(text, regions, codeRanges)] };
}

/**
 * Detects markers that never pair up, which would otherwise silently disable a whole region.
 *
 * @param {string} text - Document body.
 * @param {Array<object>} regions - Matched regions.
 * @param {Array<[number, number]>} codeRanges - Literal-code ranges from `collectCodeRanges`.
 * @returns {Array<object>} Defect records.
 */
function findStrayMarkers(text, regions, codeRanges) {
  const covered = regions.map((region) => [region.start, region.end]);
  const defects = [];
  const scan = (pattern, type) => {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (insideCode(codeRanges, match.index)) continue;
      const inside = covered.some(([start, end]) => match.index >= start && match.index < end);
      if (!inside) defects.push({ type, offset: match.index, id: match[1] });
    }
  };
  scan(/<!--\s*METRICS:BEGIN\s+([a-z0-9-]+)\s*-->/g, 'UNCLOSED_REGION');
  scan(/<!--\s*METRICS:END\s+([a-z0-9-]+)\s*-->/g, 'ORPHAN_END');
  return defects;
}

/**
 * Reports whether a position sits inside an explicitly exempted historical passage.
 *
 * The exemption is deliberately narrow: it must name the commit it describes, and it only covers the
 * paragraph it precedes, so a historical figure can never be smuggled into live prose.
 *
 * @param {string} text - Document body.
 * @param {number} offset - Character offset to test.
 * @returns {boolean} True when a valid exemption marker governs the offset.
 */
function isHistoricallyExempt(text, offset) {
  const window = text.slice(Math.max(0, offset - 600), offset);
  const markers = window.match(/<!--\s*METRICS:IGNORE-HISTORICAL[^>]*-->/g) || [];
  if (markers.length === 0) return false;
  const tail = markers[markers.length - 1];
  if (!HISTORICAL_MARKER.test(tail)) return false;
  return window.slice(window.lastIndexOf(tail) + tail.length).split(NEWLINE).length <= 4;
}

/**
 * Collects every Markdown file in scope, skipping vendored, archived and game-design trees.
 *
 * @param {object} config - Parsed doc-metrics.json.
 * @returns {string[]} Absolute file paths.
 */
function collectDocuments(config) {
  const scan = config.scan || {};
  const skipDirs = new Set(scan.skipDirectories || []);
  const skipPaths = new Set(scan.skipPaths || []);
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
 * Converts a character offset into a 1-based line number.
 *
 * @param {string} text - Document body.
 * @param {number} offset - Character offset.
 * @returns {number} Line number.
 */
function lineOf(text, offset) {
  return text.slice(0, offset).split(NEWLINE).length;
}

/**
 * Verifies or rewrites every marker region across the corpus.
 *
 * @param {object} config - Parsed doc-metrics.json.
 * @param {Map<string, number>} values - Resolved metric values.
 * @param {boolean} write - Whether to persist corrections.
 * @returns {Array<object>} Drift records with repository-relative paths.
 */
function syncDocuments(config, values, write) {
  const render = (id, inline) => renderMetric(config, id, values, inline);
  const drifts = [];
  for (const file of collectDocuments(config)) {
    const relative = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    const raw = fs.readFileSync(file, 'utf8');
    const result = applyRegions(raw, render);
    for (const drift of result.drifts) {
      drifts.push({ ...drift, line: lineOf(raw, drift.offset), file: relative });
    }
    if (write && result.text !== raw) fs.writeFileSync(file, result.text, 'utf8');
  }
  return drifts;
}

/**
 * Proves the detector still fires before trusting a green result.
 *
 * Each probe is a document whose expected outcome is known in advance; if the renderer or the region
 * parser regresses into "always passes", one of these returns the wrong count and the run fails.
 *
 * @param {object} config - Parsed doc-metrics.json.
 * @returns {string[]} Probe failures.
 */
function runSelfProbes(config) {
  const failures = [];
  const values = new Map([['rule-total', 500]]);
  const render = (id, inline) => renderMetric(config, id, values, inline);
  const expect = (label, actual, wanted) => {
    if (actual !== wanted) {
      failures.push(`probe "${label}": expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
    }
  };
  const block = (body) => `<!-- METRICS:BEGIN rule-total -->\n${body}\n<!-- METRICS:END rule-total -->`;
  const clean = render('rule-total', false);

  expect('render-substitutes-value', clean.includes('500'), true);
  expect('render-rejects-unknown-id', render('not-a-metric', false), null);
  expect('clean-block-no-drift', applyRegions(block(clean), render).drifts.length, 0);
  expect('clean-block-idempotent', applyRegions(block(clean), render).text, block(clean));

  const stale = applyRegions(block('全工作区 SSOT 单源收录 **428 条规则**'), render);
  expect('stale-block-detected', stale.drifts.length, 1);
  expect('stale-block-type', stale.drifts[0] && stale.drifts[0].type, 'METRIC_DRIFT');
  expect('stale-block-rewritten', stale.text, block(clean));

  const inlineClean = applyRegions(
    `| 收录 <!-- METRICS:BEGIN rule-total -->${render('rule-total', true)}<!-- METRICS:END rule-total --> |`,
    render,
  );
  expect('inline-clean-no-drift', inlineClean.drifts.length, 0);
  const inlineStale = applyRegions(
    '| 收录 <!-- METRICS:BEGIN rule-total -->428 条<!-- METRICS:END rule-total --> |',
    render,
  );
  expect('inline-stale-detected', inlineStale.drifts.length, 1);
  expect('inline-stale-rewritten', inlineStale.text.includes(render('rule-total', true)), true);
  expect('inline-stale-single-line', inlineStale.text.split(NEWLINE).length, 1);

  expect('unknown-metric-detected',
    applyRegions('<!-- METRICS:BEGIN ghost -->\nx\n<!-- METRICS:END ghost -->', render).drifts
      .some((d) => d.type === 'UNKNOWN_METRIC'), true);
  expect('unclosed-region-detected',
    applyRegions('<!-- METRICS:BEGIN rule-total -->\nx', render).drifts
      .some((d) => d.type === 'UNCLOSED_REGION'), true);
  expect('orphan-end-detected',
    applyRegions('x\n<!-- METRICS:END rule-total -->', render).drifts
      .some((d) => d.type === 'ORPHAN_END'), true);
  expect('id-mismatch-detected',
    applyRegions('<!-- METRICS:BEGIN rule-total -->\nx\n<!-- METRICS:END rule-webgames -->', render).drifts
      .some((d) => d.type === 'REGION_ID_MISMATCH'), true);

  const exempt = '<!-- METRICS:IGNORE-HISTORICAL commit=c711798 -->\n历史结论 468 条规则';
  expect('historical-exempt-near', isHistoricallyExempt(exempt, exempt.length), true);
  expect('historical-exempt-without-commit',
    isHistoricallyExempt('<!-- METRICS:IGNORE-HISTORICAL -->\n文本', 40), false);
  expect('historical-exempt-far',
    isHistoricallyExempt(`${exempt}\n\n\n\n\n远处文本`, exempt.length + 40), false);

  const fencedExample = '```markdown\n<!-- METRICS:BEGIN rule-total -->\n示例正文\n<!-- METRICS:END rule-total -->\n```\n';
  expect('fenced-example-untouched', applyRegions(fencedExample, render).drifts.length, 0);
  expect('fenced-example-verbatim', applyRegions(fencedExample, render).text, fencedExample);
  const inlineExample = '写法为 `<!-- METRICS:BEGIN rule-total -->` 与 `<!-- METRICS:END rule-total -->`。';
  expect('inline-example-untouched', applyRegions(inlineExample, render).drifts.length, 0);

  return failures;
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const isAgent = argv.includes('--agent') || argv.includes('--json');
  const config = readJson(CONFIG_FILE);
  if (!config) {
    console.error(`✖ BLOCK doc-metrics: ${path.relative(REPO_ROOT, CONFIG_FILE)} is missing or unparsable.`);
    process.exit(1);
  }

  const probeFailures = runSelfProbes(config);
  const { values, errors } = resolveMetrics(config);
  // Under `--write` the first pass performs the correction; the second pass reports what, if
  // anything, still disagrees. Reporting the pre-write state would claim a failure that the same
  // run just fixed, which makes the exit code useless to a caller that asked for repair.
  let drifts = errors.length === 0 ? syncDocuments(config, values, write) : [];
  if (write && drifts.length > 0) drifts = syncDocuments(config, values, false);
  const problems = [
    ...probeFailures.map((detail) => ({ type: 'PROBE_FAILURE', detail })),
    ...errors.map((detail) => ({ type: 'UNRESOLVED_METRIC', detail })),
    ...drifts,
  ];
  const passed = problems.length === 0;

  if (isAgent) {
    console.log(
      JSON.stringify(
        {
          protocolVersion: '1.0.0',
          status: passed ? 'PASS' : 'BLOCK',
          gate: 'doc-metrics',
          metrics: Object.fromEntries(values),
          violations: problems,
          summary: passed
            ? `${values.size} metric(s) match their source of truth.`
            : `${problems.length} documentation metric problem(s) detected.`,
        },
        null,
        2,
      ),
    );
    process.exit(passed ? 0 : 1);
  }

  if (passed) {
    console.log(`  PASS Documentation metrics: ${values.size} metric(s) match their source of truth.`);
    process.exit(0);
  }

  const suffix = write ? ' remain after rewrite' : '';
  console.error(`✖ BLOCK Documentation metrics: ${problems.length} problem(s)${suffix}:`);
  for (const item of problems) {
    if (item.file) {
      console.error(`  - ${item.file}:${item.line} [${item.type}] ${item.id} expected "${item.expected || ''}"`);
      continue;
    }
    console.error(`  - [${item.type}] ${item.detail}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({
  resolveMetrics,
  renderMetric,
  applyRegions,
  isHistoricallyExempt,
  runSelfProbes,
  countIsomorphicPairs,
  countScriptInventory,
  countBuiltinAnalyzers,
});
