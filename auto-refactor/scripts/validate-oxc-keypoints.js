// t04-key-points.js — verify the 5 key T04 validation points under parser='oxc':
//   ① type Role='admin'|'user' string type literal → hardcoded-string (tolerated=false)
//   ② @deco({length:100}) decorator arg → 100 literal descended (duplicate-literal group)
//   ③ `as const` whole-tree literals not lost ('strict' + 3 both reported)
//   ④ export * from './mod' → hardcoded-string (source materialized)
//   ⑤ StaticBlock inner function counted + maxNestingDepth matches TS Block wrap
// Runs the SAME file with AR_FASTPATH=0 vs 1 and asserts byte-identical normalized output.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.NODE_PATH = path.join(ROOT, 'node_modules');
require('module').Module._initPaths();

const TMP = path.join(ROOT, `.t04-keypoints-${process.pid}`);
const SRC = path.join(TMP, 'src');

const CONTENT = `
export type Role = 'admin' | 'user' | 'guest';

function deco(target: any, key?: string): any { return target; }

export class Widget {
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
    magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3,
    fileLinesWarn: 400, fileLinesFail: 800, fileFunctionsWarn: 15,
    complexityWarn: 8, complexityFail: 12,
  },
  analyzers: {
    constants: { enabled: true, options: { magicNumberMin: 2, duplicateLiteralThreshold: 3, hardcodedStringMinLength: 3 } },
    'large-file': { enabled: true, options: { fileLinesWarn: 50, fileLinesFail: 100, fileFunctionsWarn: 5 } },
    complexity: { enabled: true, options: { complexityWarn: 5, complexityFail: 10 } },
  },
  customAnalyzers: [],
  logLevel: 'silent',
  workers: 1,
  respectGitignore: false,
  failOnAnalyzerError: false,
};

function normalize(r) {
  const issues = r.issues
    .map((x) => ({ id: x.id, analyzer: x.analyzer, rule: x.rule, severity: x.severity, message: x.message, location: x.location, detail: x.detail }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const fileMetrics = r.fileMetrics.map((m) => ({ ...m })).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return JSON.stringify(
    { filesScanned: r.summary.filesScanned, issuesTotal: r.summary.issuesTotal, byAnalyzer: r.summary.byAnalyzer, bySeverity: r.summary.bySeverity, issues, fileMetrics },
    null,
    2,
  );
}

async function main() {
  fs.mkdirSync(SRC, { recursive: true });
  fs.writeFileSync(path.join(SRC, 'widget.ts'), CONTENT);
  fs.writeFileSync(path.join(SRC, 'dep.ts'), "export const DEP = 'dep token';\n");
  fs.writeFileSync(path.join(SRC, 'other.ts'), "export const extra = 'other token';\n");
  fs.writeFileSync(path.join(TMP, 'auto-refactor.config.json'), JSON.stringify(CONFIG, null, 2));

  const { scan } = require(path.join(ROOT, 'dist', 'api'));
  process.env.AR_FASTPATH = '0';
  const r0 = await scan({ root: TMP, configFile: path.join(TMP, 'auto-refactor.config.json'), workers: 1, format: 'json', logLevel: 'silent', parser: 'oxc' });
  const out0 = normalize(r0);
  process.env.AR_FASTPATH = '1';
  const r1 = await scan({ root: TMP, configFile: path.join(TMP, 'auto-refactor.config.json'), workers: 1, format: 'json', logLevel: 'silent', parser: 'oxc' });
  const out1 = normalize(r1);

  let failed = 0;
  const fail = (msg) => { failed++; console.log('FAIL', msg); };
  const pass = (msg) => console.log('PASS', msg);

  const ok = out0 === out1;
  ok ? pass('byte-identical (fast=0 vs fast=1)') : fail('byte-identical (fast=0 vs fast=1)');

  const issues = JSON.parse(out1).issues;
  const hsAt = (line, val) => issues.filter((i) => i.rule === 'hardcoded-string' && i.location.start.line === line && i.detail && i.detail.value === val).length;
  const mnAt = (line, val) => issues.filter((i) => i.rule === 'magic-number' && i.location.start.line === line && i.detail && i.detail.value === String(val)).length;
  const dupVal = (val) => issues.filter((i) => i.rule === 'duplicate-literal' && i.detail && i.detail.value === String(val)).length;
  const widget = r1.fileMetrics.find((m) => m.file.endsWith('widget.ts'));

  // ① type Role string type literals → hardcoded-string (line 2, tolerated=false)
  const n1 = ["'admin'", "'user'", "'guest'"].map((v) => hsAt(2, v)).filter(Boolean).length;
  n1 === 3 ? pass(`① type Role string literals → 3 hardcoded-string (line 2)`) : fail(`① type Role hardcoded-string count=${n1}`);

  // ② @deco({length:100}) → 100 literal descended (duplicate-literal group; 4 occurrences across decorator + run fn)
  dupVal(100) === 1 ? pass(`② @deco({length:100}) → 100 in duplicate-literal group (decorator arg descended)`) : fail(`② 100 duplicate-literal=${dupVal(100)}`);

  // ③ as const literals not lost
  hsAt(21, "'strict'") === 1 && mnAt(21, 3) === 1 ? pass(`③ as const → 'strict' hardcoded-string + 3 magic-number (line 21)`) : fail(`③ as const literals missing (strict=${hsAt(21, "'strict'")}, 3=${mnAt(21, 3)})`);

  // ④ export * from / export {x} from → hardcoded-string (source materialized, not tolerated)
  hsAt(26, "'./dep'") === 1 && hsAt(27, "'./other'") === 1 ? pass(`④ export * / export {x} from → hardcoded-string (lines 26,27)`) : fail(`④ export sources (dep=${hsAt(26, "'./dep'")}, other=${hsAt(27, "'./other'")})`);

  // ⑤ StaticBlock: inner functions counted + maxNestingDepth (Block-wrap parity)
  if (!widget) { fail('⑤ widget.ts metric missing'); } else {
    const expFn = 4; // deco + helper + run + copy getter
    const expDepth = 3; // static block statements +1 via StaticBlock increasesNesting; run body Block +1; if +1
    widget.functions === expFn && widget.maxNestingDepth === expDepth
      ? pass(`⑤ StaticBlock: functions=${widget.functions}, maxNestingDepth=${widget.maxNestingDepth} (expect ${expFn}/${expDepth})`)
      : fail(`⑤ StaticBlock metrics (functions=${widget.functions}/${expFn}, maxNestingDepth=${widget.maxNestingDepth}/${expDepth})`);
  }

  console.log(failed === 0 ? '\nT04 KEY POINTS: ALL PASS' : `\nT04 KEY POINTS: ${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
