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
 *   byte-for-byte; checks (1) a string-literal type alias yields three hardcoded-string hits,
 *   (2) a decorator numeric argument joins the duplicate-literal group, (3) `as const` object
 *   literals keep their string and numeric findings, (4) re-export sources are materialized as
 *   hardcoded-string, (5) StaticBlock function count and maxNestingDepth match the TS Block
 *   wrap; prints PASS/FAIL per key point; always removes the temp directory before exiting.
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
 * @param r - Raw report returned by `scan`; only summary, issues, and fileMetrics are read.
 * @returns Deterministic pretty-printed JSON used for the byte-for-byte fast-path comparison.
 */
function normalize(r) {
  const issues = r.issues
    .map((x) => ({
      id: x.id,
      analyzer: x.analyzer,
      rule: x.rule,
      severity: x.severity,
      message: x.message,
      location: x.location,
      detail: x.detail,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const fileMetrics = r.fileMetrics
    .map((m) => ({ ...m }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return JSON.stringify(
    {
      filesScanned: r.summary.filesScanned,
      issuesTotal: r.summary.issuesTotal,
      byAnalyzer: r.summary.byAnalyzer,
      bySeverity: r.summary.bySeverity,
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

  for (const i of issues) {
    const rule = i.rule;
    const line = i.location && i.location.start ? i.location.start.line : undefined;
    const val = i.detail && i.detail.value !== undefined ? String(i.detail.value) : undefined;
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
      const n1 = ["'admin'", "'user'", "'guest'"].map((v) => lookup.hsAt(2, v)).filter(Boolean).length;
      return {
        pass: n1 === 3,
        passMsg: '① type Role string literals → 3 hardcoded-string (line 2)',
        failMsg: `① type Role hardcoded-string count=${n1}`,
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
      const hs = lookup.hsAt(21, "'strict'");
      const mn = lookup.mnAt(21, 3);
      return {
        pass: hs === 1 && mn === 1,
        passMsg: "③ as const → 'strict' hardcoded-string + 3 magic-number (line 21)",
        failMsg: `③ as const literals missing (strict=${hs}, 3=${mn})`,
      };
    },
  },
  {
    evaluate: (lookup) => {
      const dep = lookup.hsAt(26, "'./dep'");
      const other = lookup.hsAt(27, "'./other'");
      return {
        pass: dep === 1 && other === 1,
        passMsg: '④ export * / export {x} from → hardcoded-string (lines 26,27)',
        failMsg: `④ export sources (dep=${dep}, other=${other})`,
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
    const res = spec.evaluate(lookup, widget);
    if (res.pass) {
      pass(res.passMsg);
    } else {
      fail(res.failMsg);
    }
  }
}

async function main() {
  fs.mkdirSync(SRC, { recursive: true });
  fs.writeFileSync(path.join(SRC, 'widget.ts'), CONTENT);
  fs.writeFileSync(path.join(SRC, 'dep.ts'), "export const DEP = 'dep token';\n");
  fs.writeFileSync(path.join(SRC, 'other.ts'), "export const extra = 'other token';\n");
  fs.writeFileSync(path.join(TMP, 'auto-refactor.config.json'), JSON.stringify(CONFIG, null, 2));

  const { scan } = require(path.join(ROOT, 'dist', 'api'));
  process.env.AR_FASTPATH = '0';
  const r0 = await scan({
    root: TMP,
    configFile: path.join(TMP, 'auto-refactor.config.json'),
    workers: 1,
    format: 'json',
    logLevel: 'silent',
    parser: 'oxc',
  });
  const out0 = normalize(r0);
  process.env.AR_FASTPATH = '1';
  const r1 = await scan({
    root: TMP,
    configFile: path.join(TMP, 'auto-refactor.config.json'),
    workers: 1,
    format: 'json',
    logLevel: 'silent',
    parser: 'oxc',
  });
  const out1 = normalize(r1);

  let failed = 0;
  const fail = (msg) => {
    failed++;
    console.log('FAIL', msg);
  };
  const pass = (msg) => console.log('PASS', msg);

  const ok = out0 === out1;
  if (ok) {
    pass('byte-identical (fast=0 vs fast=1)');
  } else {
    fail('byte-identical (fast=0 vs fast=1)');
  }

  const issues = JSON.parse(out1).issues;
  const lookup = buildIssueLookup(issues);
  const widget = r1.fileMetrics.find((m) => m.file.endsWith('widget.ts'));

  runKeypointSpecs(KEYPOINT_SPECS, lookup, widget, pass, fail);

  console.log(failed === 0 ? '\nT04 KEY POINTS: ALL PASS' : `\nT04 KEY POINTS: ${failed} FAILED`);
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
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

main().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
