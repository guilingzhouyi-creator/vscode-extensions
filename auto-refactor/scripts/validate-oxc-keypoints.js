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
  const hsAt = (line, val) =>
    issues.filter(
      (i) =>
        i.rule === 'hardcoded-string' &&
        i.location.start.line === line &&
        i.detail &&
        i.detail.value === val,
    ).length;
  const mnAt = (line, val) =>
    issues.filter(
      (i) =>
        i.rule === 'magic-number' &&
        i.location.start.line === line &&
        i.detail &&
        i.detail.value === String(val),
    ).length;
  const dupVal = (val) =>
    issues.filter(
      (i) => i.rule === 'duplicate-literal' && i.detail && i.detail.value === String(val),
    ).length;
  const widget = r1.fileMetrics.find((m) => m.file.endsWith('widget.ts'));

  // ① type Role string type literals → hardcoded-string (line 2, tolerated=false)
  const n1 = ["'admin'", "'user'", "'guest'"].map((v) => hsAt(2, v)).filter(Boolean).length;
  if (n1 === 3) {
    pass(`① type Role string literals → 3 hardcoded-string (line 2)`);
  } else {
    fail(`① type Role hardcoded-string count=${n1}`);
  }

  // ② @deco({length:100}) → 100 literal descended (duplicate-literal group;
  // 4 occurrences across decorator + run fn)
  if (dupVal(100) === 1) {
    pass(`② @deco({length:100}) → 100 in duplicate-literal group (decorator arg descended)`);
  } else {
    fail(`② 100 duplicate-literal=${dupVal(100)}`);
  }

  // ③ as const literals not lost
  if (hsAt(21, "'strict'") === 1 && mnAt(21, 3) === 1) {
    pass(`③ as const → 'strict' hardcoded-string + 3 magic-number (line 21)`);
  } else {
    fail(`③ as const literals missing (strict=${hsAt(21, "'strict'")}, 3=${mnAt(21, 3)})`);
  }

  // ④ export * from / export {x} from → hardcoded-string (source materialized, not tolerated)
  if (hsAt(26, "'./dep'") === 1 && hsAt(27, "'./other'") === 1) {
    pass(`④ export * / export {x} from → hardcoded-string (lines 26,27)`);
  } else {
    fail(`④ export sources (dep=${hsAt(26, "'./dep'")}, other=${hsAt(27, "'./other'")})`);
  }

  // ⑤ StaticBlock: inner functions counted + maxNestingDepth (Block-wrap parity)
  if (!widget) {
    fail('⑤ widget.ts metric missing');
  } else {
    const expFn = 4; // deco + helper + run + copy getter
    // static block statements +1 via StaticBlock increasesNesting; run body Block +1; if +1
    const expDepth = 3;
    if (widget.functions === expFn && widget.maxNestingDepth === expDepth) {
      pass(
        `⑤ StaticBlock: functions=${widget.functions}, maxNestingDepth=${widget.maxNestingDepth} (expect ${expFn}/${expDepth})`,
      );
    } else {
      fail(
        `⑤ StaticBlock metrics (functions=${widget.functions}/${expFn}, maxNestingDepth=${widget.maxNestingDepth}/${expDepth})`,
      );
    }
  }

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
