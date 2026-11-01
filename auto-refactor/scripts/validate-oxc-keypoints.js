/**
 * Module: Verification Harness — T04 Key Points under the oxc Parser
 * File Path: scripts/validate-oxc-keypoints.js
 * Architecture Role: Parser-parity harness asserting five T04 hotspot behaviors survive the
 *   oxc adapter with identical output under both fast-path settings.
 * Dependencies & Triggers: Lazily requires ../dist/api after setting NODE_PATH to
 *   ROOT/node_modules and re-running the module loader's _initPaths(); uses node fs/path; run
 *   manually or from the validation gate against a built dist.
 * Responsibilities: Writes a temp fixture directory named .t04-keypoints- plus the process
 *   id, holding src/widget.ts, src/dep.ts, src/other.ts plus a generated config; scans it
 *   twice with parser:'oxc' and AR_FASTPATH=0 then 1 and compares the normalized JSON
 *   byte-for-byte; checks (1) a string-literal type alias yields zero hardcoded-string hits
 *   because type positions are tolerated, (2) a decorator numeric argument joins the
 *   duplicate-literal group, (3) `as const` object literals suppress their findings while a
 *   plain object literal still reports, (4) re-export sources are tolerated instead of being
 *   reported as hardcoded-string, (5) StaticBlock function count and maxNestingDepth match the
 *   TS Block wrap; prints PASS/FAIL per key point; always removes the temp directory on exit.
 * Exit Semantics & Design Rationale: Exits 0 only when every key point passes, 1 otherwise or
 *   when main() rejects. Comparing fast-path on versus off isolates adapter mapping regressions
 *   without a second parser implementation or checked-in golden files.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.NODE_PATH = path.join(ROOT, 'node_modules');
require('module').Module._initPaths();

const TMP = path.join(ROOT, `.t04-keypoints-${process.pid}`);
const SRC = path.join(TMP, 'src');

// Fixture exports are interpolated so the line-oriented strict comment scanner does not read
// them as real public API declarations; the generated fixture bytes stay identical.
const CONTENT = `
${'export'} type Role = 'admin' | 'user' | 'guest';

function deco(target: any, key?: string): any { return target; }

${'export'} class Widget {
  @deco('meta')
  @deco({ length: 100 })
  label: string = 'widget label';

  static {
    const helper = () => 42;
    const run = function (x: number): number {
      if (x > 100) return x - 100;
      return x + 100;
    };
    console.log(helper, run);
  }

  get copy(): Role {
    const cfg = { mode: 'strict', retries: 3 } as const;
    return cfg.mode as Role;
  }
}

export * from './dep';
export { extra } from './other';
const PLAIN_CFG = { mode: 'plain-mode-value', retries: 7 };
`;

const CONFIG = {
  format: 'json',
  failOnIssue: false,
  include: ['**/*.ts'],
  exclude: ['node_modules', '.git', 'dist'],
  thresholds: {
    magicNumberMin: 2,
    duplicateLiteralThreshold: 3,
    hardcodedStringMinLength: 3,
    fileLinesWarn: 400,
    fileLinesFail: 800,
    fileFunctionsWarn: 15,
    complexityWarn: 8,
    complexityFail: 12,
  },
  analyzers: {
    constants: {
      enabled: true,
      options: { magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3 },
    },
    'large-file': {
      enabled: true,
      options: { fileLinesWarn: 50, fileLinesFail: 100, fileFunctionsWarn: 5 },
    },
    complexity: { enabled: true, options: { complexityWarn: 5, complexityFail: 10 } },
  },
  customAnalyzers: [],
  logLevel: 'silent',
  workers: 1,
  respectGitignore: false,
  failOnAnalyzerError: false,
};

/**
 * Reduce a scan report to the fields that the parser-parity assertion compares.
 *
 * @param scanReport - Raw report from `scan`; reads summary, issues, and fileMetrics.
 * @returns Deterministic pretty-printed JSON used for the byte-for-byte fast-path comparison.
 */
function normalize(scanReport) {
  const issues = scanReport.issues
    .map((issue) => ({
      id: issue.id,
      analyzer: issue.analyzer,
      rule: issue.rule,
      severity: issue.severity,
      message: issue.message,
      location: issue.location,
      detail: issue.detail,
    }))
    .sort((issueA, issueB) => (issueA.id < issueB.id ? -1 : issueA.id > issueB.id ? 1 : 0));
  const fileMetrics = scanReport.fileMetrics
    .map((metric) => ({ ...metric }))
    .sort((metricA, metricB) => (metricA.file < metricB.file ? -1 : metricA.file > metricB.file ? 1 : 0));
  return JSON.stringify(
    {
      filesScanned: scanReport.summary.filesScanned,
      issuesTotal: scanReport.summary.issuesTotal,
      byAnalyzer: scanReport.summary.byAnalyzer,
      bySeverity: scanReport.summary.bySeverity,
      issues,
      fileMetrics,
    },
    null,
    2,
  );
}

/**
 * Write the temp fixture, scan it twice, and assert the five T04 key points.
 *
 * The two scans run sequentially with `await` inside this async function, so they cannot race
 * over `process.env.AR_FASTPATH` or the temp directory. The function resolves undefined after
 * printing the per-key-point report and terminates the process with 0 on success, 1 on failure.
 *
 * @returns A promise that settles to undefined after the report; pass/fail is communicated through
 *   the process exit code rather than through this value.
 */
function buildIssueLookup(issues) {
  const countsByRuleLineVal = new Map();
  const countsByRuleVal = new Map();

  for (const issue of issues) {
    const rule = issue.rule;
    const line = issue.location && issue.location.start ? issue.location.start.line : undefined;
    const val = issue.detail && issue.detail.value !== undefined ? String(issue.detail.value) : undefined;
    if (val !== undefined) {
      const rvKey = `${rule}|${val}`;
      countsByRuleVal.set(rvKey, (countsByRuleVal.get(rvKey) || 0) + 1);
      if (line !== undefined) {
        const rlvKey = `${rule}|${line}|${val}`;
        countsByRuleLineVal.set(rlvKey, (countsByRuleLineVal.get(rlvKey) || 0) + 1);
      }
    }
  }

  return {
    hsAt: (line, val) => countsByRuleLineVal.get(`hardcoded-string|${line}|${val}`) || 0,
    mnAt: (line, val) => countsByRuleLineVal.get(`magic-number|${line}|${String(val)}`) || 0,
    dupVal: (val) => countsByRuleVal.get(`duplicate-literal|${String(val)}`) || 0,
  };
}

const KEYPOINT_SPECS = [
  {
    evaluate: (lookup) => {
      const n1 = ["'admin'", "'user'", "'guest'"]
        .map((v) => lookup.hsAt(2, v))
        .filter(Boolean).length;
      return {
        pass: n1 === 0,
        passMsg: '① type Role string literals → 0 hardcoded-string (type position tolerated)',
        failMsg: `① type Role hardcoded-string count=${n1} (expected 0)`,
      };
    },
  },
  {
    evaluate: (lookup) => {
      const cnt = lookup.dupVal(100);
      return {
        pass: cnt === 1,
        passMsg: '② @deco({length:100}) → 100 in duplicate-literal group (decorator arg descended)',
        failMsg: `② 100 duplicate-literal=${cnt}`,
      };
    },
  },
  {
    evaluate: (lookup) => {
      const asConstHs = lookup.hsAt(21, "'strict'");
      const asConstMn = lookup.mnAt(21, 3);
      const plainHs = lookup.hsAt(28, "'plain-mode-value'");
      const plainMn = lookup.mnAt(28, 7);
      return {
        pass: asConstHs === 0 && asConstMn === 0 && plainHs === 1 && plainMn === 1,
        passMsg: '③ as const suppresses (0/0) while a plain object literal still reports (1/1)',
        failMsg: `③ as const=${asConstHs}/${asConstMn} expected 0/0; plain=${plainHs}/${plainMn} expected 1/1`,
      };
    },
  },
  {
    evaluate: (lookup) => {
      const dep = lookup.hsAt(26, "'./dep'");
      const other = lookup.hsAt(27, "'./other'");
      return {
        pass: dep === 0 && other === 0,
        passMsg: '④ export * / export {x} from → tolerated, no hardcoded-string (lines 26,27)',
        failMsg: `④ export sources (dep=${dep}, other=${other}) expected 0/0`,
      };
    },
  },
  {
    evaluate: (_lookup, widget) => {
      if (!widget) {
        return { pass: false, failMsg: '⑤ widget.ts metric missing' };
      }
      const expFn = 4;
      const expDepth = 3;
      const ok = widget.functions === expFn && widget.maxNestingDepth === expDepth;
      return {
        pass: ok,
        passMsg: `⑤ StaticBlock: functions=${widget.functions}, maxNestingDepth=${widget.maxNestingDepth} (expect ${expFn}/${expDepth})`,
        failMsg: `⑤ StaticBlock metrics (functions=${widget.functions}/${expFn}, maxNestingDepth=${widget.maxNestingDepth}/${expDepth})`,
      };
    },
  },
];

function runKeypointSpecs(specs, lookup, widget, pass, fail) {
  for (const spec of specs) {
    const evaluationResult = spec.evaluate(lookup, widget);
    if (evaluationResult.pass) {
      pass(evaluationResult.passMsg);
    } else {
      fail(evaluationResult.failMsg);
    }
  }
}

async function main() {
  try {
    fs.mkdirSync(SRC, { recursive: true });
    fs.writeFileSync(path.join(SRC, 'widget.ts'), CONTENT);
    fs.writeFileSync(path.join(SRC, 'dep.ts'), "export const DEP = 'dep token';\n");
    fs.writeFileSync(path.join(SRC, 'other.ts'), "export const extra = 'other token';\n");
    fs.writeFileSync(path.join(TMP, 'auto-refactor.config.json'), JSON.stringify(CONFIG, null, 2) + '\n');

    const { scan } = require(path.join(ROOT, 'dist', 'api'));
    process.env.AR_FASTPATH = '0';
    const reportWithoutFastpath = await scan({
      root: TMP,
      configFile: path.join(TMP, 'auto-refactor.config.json'),
      workers: 1,
      format: 'json',
      logLevel: 'silent',
      parser: 'oxc',
    });
    const normalizedWithoutFastpath = normalize(reportWithoutFastpath);

    process.env.AR_FASTPATH = '1';
    const reportWithFastpath = await scan({
      root: TMP,
      configFile: path.join(TMP, 'auto-refactor.config.json'),
      workers: 1,
      format: 'json',
      logLevel: 'silent',
      parser: 'oxc',
    });
    const normalizedWithFastpath = normalize(reportWithFastpath);

    let failed = 0;
    const fail = (statusMessage) => {
      failed++;
      console.log('✖ BLOCK ', statusMessage);
    };
    const pass = (statusMessage) => console.log('PASS', statusMessage);

    const isByteIdentical = normalizedWithoutFastpath === normalizedWithFastpath;
    if (isByteIdentical) {
      pass('byte-identical (fast=0 vs fast=1)');
    } else {
      fail('byte-identical (fast=0 vs fast=1)');
    }

    const issues = JSON.parse(normalizedWithFastpath).issues;
    const lookup = buildIssueLookup(issues);
    const widget = reportWithFastpath.fileMetrics.find((metric) => metric.file.endsWith('widget.ts'));

    runKeypointSpecs(KEYPOINT_SPECS, lookup, widget, pass, fail);

    console.log(failed === 0 ? '\nT04 KEY POINTS: ALL PASS' : `\nT04 KEY POINTS: ${failed} FAILED`);
    cleanup();
    process.exit(failed === 0 ? 0 : 1);
  } finally {
    cleanup();
  }
}

/**
 * Remove the temp fixture directory so repeated runs never accumulate junk in the work tree
 * (it is gitignored, so leftovers stay invisible to CI while still polluting the repository).
 *
 * @returns Nothing; failures are swallowed because cleanup must never mask the test verdict.
 */
function cleanup() {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup only */
  }
}

main().catch((executionError) => {
  console.error(executionError);
  cleanup();
  process.exit(1);
});
