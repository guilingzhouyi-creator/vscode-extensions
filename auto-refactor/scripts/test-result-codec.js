/* T01 round-trip gate: encode→decode must reproduce the exact object graph that
 * structured clone would deliver. Compares on real scan payloads + crafted edges. */
const path = require('path');
const { encodeResults, decodeResults } = require('../dist/core/resultCodec.js');
const { scan } = require('../dist/api.js');

function deepEqualStrict(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqualStrict(a[k], b[k])) return false;
  }
  return true;
}

function check(payload, label) {
  const buf = encodeResults(payload);
  const back = decodeResults(buf);
  const a = JSON.stringify(payload), b = JSON.stringify(back);
  if (a !== b) {
    console.log(`FAIL ${label}: JSON mismatch`);
    console.log('  orig:', a.slice(0, 300));
    console.log('  back:', b.slice(0, 300));
    process.exitCode = 1;
    return false;
  }
  if (!deepEqualStrict(payload, back)) {
    console.log(`FAIL ${label}: deep mismatch (suggestion presence/order)`);
    process.exitCode = 1;
    return false;
  }
  console.log(`PASS ${label} (${buf.length}B, ${payload.length} files)`);
  return true;
}

(async () => {
  // 1) real payload: samples scan
  const r = await scan({ root: path.join(__dirname, '..', 'samples'), configFile: path.join(__dirname, '..', 'samples', 'auto-refactor.config.json'), workers: 1, format: 'json', logLevel: 'silent', failOnIssue: false });
  const perFile = [];
  for (const m of r.fileMetrics || []) {
    const issues = r.issues.filter((i) => i.location.file === m.file);
    perFile.push({ file: m.file, issues, metric: m });
  }
  check(perFile, 'samples-real');

  // 2) edge payloads
  const edges = [
    { file: 'a.ts', issues: [], metric: null },
    { file: 'b.ts', issues: [{
      id: 'x:y:b.ts:1', analyzer: 'x', rule: 'y', severity: 'info',
      message: '中文注释 i18n 字面量 non-ASCII ✓', location: { file: 'b.ts', start: { line: 1, column: 2 }, end: { line: 1, column: 2 } },
      detail: { value: '中文', list: [1, 2, 3], neg: -5, big: 9007199254740991, fl: 1.5, obj: { a: 1, b: 'x' }, empty: {}, arr: [[1], { k: null }] },
      suggestion: 'fix it',
    }], metric: { file: 'b.ts', lines: 10, nonBlankLines: 8, functions: 2, maxNestingDepth: 3, topLevelDeclarations: 2, exportedSymbols: 1 } },
    { file: 'c.ts', issues: [{
      id: 'c:1', analyzer: 'c', rule: 'r', severity: 'error', message: '',
      location: { file: 'c.ts', start: { line: 0, column: 0 }, end: { line: 5, column: 5 } },
      detail: { s: 'a"b\\c\nd', f: -0.0, t: true, fl: false, n: null },
    }], metric: null },
    { file: 'd.ts', issues: [], metric: { file: 'd.ts', lines: 1, nonBlankLines: 0, functions: 0, maxNestingDepth: 0, topLevelDeclarations: 0, exportedSymbols: 0 } },
  ];
  check(edges, 'edge-crafted');

  // 3) suggestion presence fidelity (undefined vs present must survive)
  const sug = [{ file: 's.ts', issues: [{ id: 'i', analyzer: 'a', rule: 'r', severity: 'warning', message: 'm', location: { file: 's.ts', start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }, detail: {} }], metric: null }];
  const sugBack = decodeResults(encodeResults(sug));
  console.log((('suggestion' in sugBack[0].issues[0]) ? 'FAIL' : 'PASS') + ' suggestion-absent');
  if ('suggestion' in sugBack[0].issues[0]) process.exitCode = 1;

  if (!process.exitCode) console.log('ALL ROUND-TRIP CHECKS PASS');
})();
