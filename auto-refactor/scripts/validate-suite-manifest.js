/**
 * Module: Validation — Test Suite Manifest Integrity
 * File Path: scripts/validate-suite-manifest.js
 * Architecture Role: Guards the test suite registry in two directions. `test-parallel.js`
 *   is the single list of what `npm test` (and therefore `npm run gate`) actually runs, and
 *   it had drifted twice: entries pointing at files that no longer exist, and real suites
 *   that were never registered at all. The second case is the dangerous one, because an
 *   unregistered suite still exists and still looks healthy while contributing nothing to the
 *   gate — the Go and shell/powershell rule families had no registered coverage whatsoever.
 * Dependencies & Triggers: reads `scripts/test-parallel.js` for the registry and the scripts
 *   directory for the on-disk set; no build output required.
 * Responsibilities: assert every registered script exists, and assert every validation
 *   script under scripts/ is either registered or explicitly exempted with a stated reason.
 * Exit Semantics & Design Rationale: Read-only assertion; exits non-zero on either direction
 *   of drift so a new suite cannot be added without being wired into the gate.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCRIPTS_DIR = path.join(ROOT, 'scripts');

/**
 * Scripts that are intentionally not part of `npm test`.
 *
 * Each entry needs a reason. A suite is only exempt when it cannot run headlessly, needs a
 * network, mutates the repository, or is a runner that the parallel engine invokes directly.
 */
const EXEMPT = new Map([
  // The parallel engine itself: registering it would recurse.
  ['test-parallel.js', 'the parallel engine itself; invoked by npm test, not by itself'],
  // Entry point for the parallel engine's helpers.
  ['test-result-codec.js', 'library consumed by test-parallel.js, not a standalone suite'],
  // Fixture builders and shared helpers, not suites.
  ['build-native.js', 'native build helper invoked by npm run build:native'],
  ['run-self-audit.js', 'helper invoked by validate-self-audit.js and validate-self-refactor.js'],
  ['test-rust.js', 'invoked by gate:rust rather than by the parallel engine'],
  // Gate entry points already wired into `npm run gate`; running them again inside
  // `npm test` would apply the severity ratchet twice.
  ['gate-comments.js', 'invoked by the gate chain as gate:comments'],
  ['gate-self.js', 'invoked by the gate chain as gate:self and gate:self:warning'],
  ['gate-self-slice.js', 'invoked as gate:self:slice; not part of the default gate chain'],
  [
    'gate-rust.js',
    'invoked by the gate chain as gate:rust; runs cargo stages, not a JS assertion suite',
  ],
  // One-off maintenance script for the core layering migration.
  ['migrate-core-m2.js', 'one-shot migration helper; not a recurring assertion'],
  ['sample-expert-weights.js', 'sample data generator for experts-weights.json'],
]);

/** Benchmark scripts: measured by `npm run benchmark`, not by correctness assertions. */
const BENCHMARKS = [
  'benchmark.js',
  'bench-asymmetric.js',
  'bench-baselines.js',
  'bench-deep-stress.js',
  'bench-diff.js',
  'bench-fastpath.js',
  'bench-hot-paths.js',
  'bench-oxc-modea.js',
  'bench-quant.js',
  'bench-warm.js',
];

/**
 * Read every script path the parallel engine runs.
 *
 * Both registration forms are scanned: `{ name, script }` singletons and
 * `{ name, composite: [...] }` groups, whose members are quoted across several lines. A
 * single whole-file scan handles both, and picks up any future form that quotes a path.
 *
 * @returns Repository-relative script paths.
 */
function registeredScripts() {
  const source = fs.readFileSync(path.join(SCRIPTS_DIR, 'test-parallel.js'), 'utf8');
  const paths = new Set();
  const pattern = /'(scripts\/[^']+\.js)'/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    paths.add(match[1]);
  }
  return paths;
}

/**
 * Assert every registered script exists on disk.
 *
 * @param registered - Repository-relative registered paths.
 * @returns Nothing; throws listing every registered path that does not exist.
 */
function checkRegisteredScriptsExist(registered) {
  const missing = [...registered].filter((rel) => !fs.existsSync(path.join(ROOT, rel))).sort();
  assert.deepStrictEqual(
    missing,
    [],
    `test-parallel.js registers ${missing.length} script(s) that do not exist:\n  ${missing.join('\n  ')}\n` +
      'Either the suite was removed or it was renamed; drop the entry or fix the path.',
  );
  console.log(`  [PASS] all ${registered.size} registered suite(s) exist on disk`);
}

/**
 * Assert every validation script is registered or explicitly exempted.
 *
 * @param registered - Repository-relative registered paths.
 * @returns Nothing; throws listing every script that never runs in the gate.
 */
function checkNoOrphanSuites(registered) {
  const onDisk = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => `scripts/${name}`);

  const orphans = onDisk
    .filter((rel) => !registered.has(rel))
    .filter((rel) => !EXEMPT.has(path.basename(rel)))
    .filter((rel) => !BENCHMARKS.includes(path.basename(rel)))
    .sort();

  assert.deepStrictEqual(
    orphans,
    [],
    `${orphans.length} validation script(s) exist but never run in the gate:\n  ${orphans.join('\n  ')}\n` +
      'Register them in test-parallel.js, or add them to EXEMPT with a reason.',
  );
  console.log(
    `  [PASS] every script under scripts/ is accounted for (${onDisk.length} total, ` +
      `${registered.size} registered, ${EXEMPT.size} exempt, ${BENCHMARKS.length} benchmarks)`,
  );
}

/**
 * Assert the exemption list has no stale entries.
 *
 * @returns Nothing; throws when an exemption names a file that no longer exists.
 */
function checkExemptionsAreCurrent() {
  const stale = [...EXEMPT.keys()]
    .filter((name) => !fs.existsSync(path.join(SCRIPTS_DIR, name)))
    .sort();
  assert.deepStrictEqual(
    stale,
    [],
    `EXEMPT lists script(s) that no longer exist: ${stale.join(', ')}`,
  );
  console.log(`  [PASS] all ${EXEMPT.size} exemption(s) refer to existing files`);
}

const registered = registeredScripts();
checkRegisteredScriptsExist(registered);
checkNoOrphanSuites(registered);
checkExemptionsAreCurrent();
console.log('\nALL SUITE MANIFEST CHECKS PASSED SUCCESSFULLY!');
