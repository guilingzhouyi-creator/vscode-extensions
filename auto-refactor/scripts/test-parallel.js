#!/usr/bin/env node
/**
 * Module: Verification Harness — Parallel & Asynchronous Test Runner
 * File Path: scripts/test-parallel.js
 * Architecture Role: High-throughput concurrent test runner for the auto-refactor test suite;
 *   replaces slow sequential execution with asynchronous worker-pool dispatch across CPU cores.
 * Dependencies & Triggers: `npm run test:parallel` or `npm test`; imports child_process.spawn,
 *   fs, os, and path. Runs across Node 18+.
 * Responsibilities: Offload temporary caches to high-speed non-system drive (e.g. D:/temp) when
 *   available, preventing C: disk thrashing; execute isolated test suites concurrently with bounded
 *   concurrency; execute daemon/corpus stateful suites sequentially; buffer outputs and print
 *   concise real-time progress and summary metrics.
 * Exit Semantics & Design Rationale: Exits 0 if all test suites pass, 1 if any suite fails.
 *   Concurrency is bounded to prevent CPU/IO starvation while maximizing multi-core utilization.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── Offload temporary drive cache if D: drive exists to prevent C: I/O thrashing ──
if (!process.env.AUTO_REFACTOR_TMPDIR && fs.existsSync('D:/')) {
  const dTemp = 'D:/temp';
  try {
    fs.mkdirSync(dTemp, { recursive: true });
    process.env.AUTO_REFACTOR_TMPDIR = dTemp;
  } catch {
    // ignore
  }
}

// ── CLI Arguments ──
const rawArgs = process.argv.slice(2);
let concurrency = Math.min(8, Math.max(2, os.cpus().length || 4));
let bail = false;
let filter = '';

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === '--bail' || arg === '-b') {
    bail = true;
  } else if ((arg === '--concurrency' || arg === '-j') && i + 1 < rawArgs.length) {
    concurrency = Math.max(1, parseInt(rawArgs[++i], 10) || concurrency);
  } else if (!arg.startsWith('-')) {
    filter = arg.toLowerCase();
  }
}

// ── Test Suites Declaration ──
// Stage 1: Isolated parallel test suites (no shared daemon or corpus disk state)
const PARALLEL_SUITES = [
  { name: 'validate-native-operator', script: 'scripts/validate-native-operator.js' },
  { name: 'validate-oxc', script: 'scripts/validate-oxc-keypoints.js' },
  { name: 'validate-praxis', script: 'scripts/validate-praxis-foundation.js' },
  { name: 'validate-governance', script: 'scripts/validate-governance.js' },
  { name: 'validate-generalized', script: 'scripts/validate-generalized.js' },
  { name: 'validate-review-memory', script: 'scripts/validate-review-memory.js' },
  { name: 'validate-asymmetric', script: 'scripts/validate-asymmetric-routing.js' },
  { name: 'validate-security', script: 'scripts/validate-security-levels.js' },
  { name: 'validate-capabilities', script: 'scripts/validate-capabilities.js' },
  { name: 'validate-language-support', script: 'scripts/validate-language-support.js' },
  { name: 'validate-language-matrix', script: 'scripts/validate-language-matrix.js' },
  { name: 'validate-python', script: 'scripts/validate-python.js' },
  { name: 'validate-comment-hygiene', script: 'scripts/validate-comment-hygiene.js' },
  { name: 'validate-simplify', script: 'scripts/validate-simplify.js' },
  { name: 'validate-python-modern', script: 'scripts/validate-python-modern.js' },
  { name: 'validate-ts-modern', script: 'scripts/validate-ts-modern.js' },
  { name: 'validate-modern-packs', script: 'scripts/validate-modern-packs.js' },
  { name: 'validate-naming-suite', script: 'scripts/validate-naming-suite.js' },
  { name: 'validate-physical-naming', script: 'scripts/validate-physical-naming.js' },
  { name: 'validate-python-imports', script: 'scripts/validate-python-imports.js' },
  { name: 'validate-postscan-parity', script: 'scripts/validate-postscan-parity.js' },
  { name: 'validate-capp-protocol', script: 'scripts/validate-capp-protocol.js' },
  { name: 'validate-praxis-presentation', script: 'scripts/validate-praxis-presentation.js' },
  { name: 'validate-code-density', script: 'scripts/validate-code-density.js' },
  { name: 'validate-effective-loc', script: 'scripts/validate-effective-loc.js' },
  { name: 'validate-sparse-scheduler', script: 'scripts/validate-sparse-scheduler.js' },
  { name: 'validate-scheduler-pools', script: 'scripts/validate-scheduler-pools.js' },
  { name: 'validate-ring-buffer-bus', script: 'scripts/validate-ring-buffer-bus.js' },
  { name: 'validate-topology-cache', script: 'scripts/validate-topology-cache.js' },
  { name: 'validate-native-bridge', script: 'scripts/validate-native-bridge.js' },
  { name: 'validate-tensor-partitions', script: 'scripts/validate-tensor-partitions.js' },
  { name: 'validate-agent-quota-gateway', script: 'scripts/validate-agent-quota-gateway.js' },
  { name: 'validate-scalable-e2e', script: 'scripts/validate-scalable-e2e.js' },
  { name: 'validate-comment-governance', script: 'scripts/validate-comment-governance.js' },
  { name: 'validate-literal-policy', script: 'scripts/validate-literal-policy.js' },
  {
    name: 'validate-literal-policy-declarative',
    script: 'scripts/validate-literal-policy-declarative.js',
  },
  { name: 'validate-self-slice-audit', script: 'scripts/validate-self-slice-audit.js' },
  { name: 'validate-diff-interface', script: 'scripts/validate-diff-interface.js' },
  { name: 'validate-baseline-ratchet', script: 'scripts/validate-baseline-ratchet.js' },
  { name: 'validate-suppression-gate', script: 'scripts/validate-suppression-gate.js' },
  { name: 'validate-five-core-capabilities', script: 'scripts/validate-five-core-capabilities.js' },
  { name: 'validate-rules-registry', script: 'scripts/validate-rules-registry.js' },
  { name: 'validate-constant-governance', script: 'scripts/validate-constant-governance.js' },
  { name: 'validate-rule-aliases', script: 'scripts/validate-rule-aliases.js' },
  { name: 'validate-expert-manifest', script: 'scripts/validate-expert-manifest.js' },
  { name: 'validate-governance-exemptions', script: 'scripts/validate-governance-exemptions.js' },
  { name: 'validate-fail-closed', script: 'scripts/validate-fail-closed.js' },
  { name: 'validate-latency-metrics', script: 'scripts/validate-latency-metrics.js' },
  { name: 'validate-docs', script: 'scripts/validate-docs.js' },
  { name: 'validate-project-neutrality', script: 'scripts/validate-project-neutrality.js' },
  { name: 'validate-consumer-runner', script: 'scripts/validate-consumer-runner.js' },
  { name: 'test-codec', script: 'scripts/test-result-codec.js' },
  { name: 'validate-compression', script: 'scripts/validate-compression-bounds.js' },
  { name: 'validate-marker-scope', script: 'scripts/validate-marker-scope.js' },
  { name: 'validate-baseline-freeze', script: 'scripts/validate-baseline-freeze.js' },
  { name: 'validate-semantic-ir', script: 'scripts/validate-semantic-ir.js' },
  { name: 'validate-language-adapters', script: 'scripts/validate-language-adapters.js' },
  { name: 'validate-universal-rules', script: 'scripts/validate-universal-rules.js' },
  { name: 'validate-performance-rules', script: 'scripts/validate-performance-rules.js' },
  { name: 'validate-data-architecture', script: 'scripts/validate-data-architecture.js' },
  { name: 'validate-test-modernity', script: 'scripts/validate-test-modernity.js' },
  { name: 'validate-meta-architecture', script: 'scripts/validate-meta-architecture.js' },
  { name: 'validate-quality-quantification', script: 'scripts/validate-quality-quantification.js' },
  { name: 'validate-static-quality-model', script: 'scripts/validate-static-quality-model.js' },
  { name: 'validate-dynamic-quality-model', script: 'scripts/validate-dynamic-quality-model.js' },
  { name: 'validate-risk-fusion-engine', script: 'scripts/validate-risk-fusion-engine.js' },
  { name: 'validate-change-quality-arbiter', script: 'scripts/validate-change-quality-arbiter.js' },
  { name: 'validate-feedback-adaptive-supervisor', script: 'scripts/validate-feedback-adaptive-supervisor.js' },
  { name: 'validate-triplane-cross-project', script: 'scripts/validate-triplane-cross-project.js' },
  { name: 'validate-autonomy-scorer', script: 'scripts/validate-autonomy-scorer.js' },
  { name: 'validate-stdlib-profile', script: 'scripts/validate-stdlib-profile.js' },
  { name: 'validate-rule-generalization', script: 'scripts/validate-rule-generalization.js' },
  { name: 'validate-multi-agent', script: 'scripts/validate-multi-agent.js' },
  { name: 'validate-slice-audit', script: 'scripts/validate-slice-audit.js' },
  { name: 'validate-trajectory-learning', script: 'scripts/validate-trajectory-learning.js' },
  { name: 'validate-e2e-stress', script: 'scripts/validate-e2e-stress.js' },
  {
    name: 'validate-symbol-index-pack',
    composite: [
      'scripts/validate-symbol-index.js',
      'scripts/validate-literal-index.js',
      'scripts/validate-call-graph.js',
      'scripts/validate-error-flow.js',
    ],
  },
  {
    name: 'validate-data-flow-pack',
    composite: ['scripts/validate-data-flow.js', 'scripts/validate-context-slice.js'],
  },
  {
    name: 'validate-self-norms-pack',
    composite: [
      'scripts/validate-self-norms.js',
      'scripts/validate-scoring-coverage.js',
      'scripts/validate-diff-score.js',
    ],
  },
  { name: 'validate-role-inference', script: 'scripts/validate-role-inference.js' },
  { name: 'validate-role-aware-deduplication', script: 'scripts/validate-role-aware-deduplication.js' },
  { name: 'validate-gdscript-adapter-tolerance', script: 'scripts/validate-gdscript-adapter-tolerance.js' },
  { name: 'validate-framework-lifecycle-guards', script: 'scripts/validate-framework-lifecycle-guards.js' },
  {
    name: 'validate-config-driven-architecture',
    script: 'scripts/validate-config-driven-architecture.js',
  },
  {
    name: 'validate-elastic-complexity-budget',
    script: 'scripts/validate-elastic-complexity-budget.js',
  },
  {
    name: 'validate-function-cohesion-skeleton',
    script: 'scripts/validate-function-cohesion-skeleton.js',
  },
  {
    name: 'validate-cognitive-cost-anti-gaming',
    script: 'scripts/validate-cognitive-cost-anti-gaming.js',
  },
  {
    name: 'validate-semantic-domain-detector',
    script: 'scripts/validate-semantic-domain-detector.js',
  },
  { name: 'validate-file-taxonomy-ontology', script: 'scripts/validate-file-taxonomy-ontology.js' },
  {
    name: 'validate-resource-pooling-auditor',
    script: 'scripts/validate-resource-pooling-auditor.js',
  },
  {
    name: 'validate-boundary-discipline-engine',
    script: 'scripts/validate-boundary-discipline-engine.js',
  },
  {
    name: 'validate-project-governance-evaluator',
    script: 'scripts/validate-project-governance-evaluator.js',
  },
];

// Stage 2: Stateful / daemon-spawning suites (run sequentially to prevent port/cache races)
const SEQUENTIAL_SUITES = [
  { name: 'validate-equivalence', script: 'scripts/validate-equivalence.js' },
  { name: 'validate-warm', script: 'scripts/validate-warm.js' },
  { name: 'validate-diff', script: 'scripts/validate-diff.js' },
  { name: 'validate-self-audit', script: 'scripts/validate-self-audit.js' },
  { name: 'validate-self-refactor', script: 'scripts/validate-self-refactor.js' },
];

/**
 * Execute a single script asynchronously and capture its result.
 *
 * @param scriptRel - Script path relative to ROOT.
 * @returns Object indicating success, exit code, stdout, stderr, and duration.
 */
function runScriptAsync(scriptRel) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [path.join(ROOT, scriptRel)], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));

    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    });

    child.on('error', (err) => {
      resolve({
        ok: false,
        code: 1,
        stdout,
        stderr: stderr + '\n' + err.message,
        durationMs: Date.now() - start,
      });
    });
  });
}

/**
 * Execute a test target (single script or composite scripts).
 *
 * @param suite - Suite descriptor to run.
 * @returns Result object with status and captured outputs.
 */
async function executeSuite(suite) {
  const start = Date.now();
  if (suite.script) {
    const res = await runScriptAsync(suite.script);
    return { name: suite.name, ...res };
  }

  let combinedStdout = '';
  let combinedStderr = '';
  let ok = true;
  let code = 0;
  for (const script of suite.composite) {
    const res = await runScriptAsync(script);
    combinedStdout += res.stdout;
    combinedStderr += res.stderr;
    if (!res.ok) {
      ok = false;
      code = res.code;
      break;
    }
  }

  return {
    name: suite.name,
    ok,
    code,
    stdout: combinedStdout,
    stderr: combinedStderr,
    durationMs: Date.now() - start,
  };
}

/**
 * Run a pool of tasks with bounded concurrency.
 *
 * @param items - Task items to process.
 * @param maxConcurrency - Maximum concurrent workers.
 * @param workerFn - Worker function to execute on each item.
 * @returns Aggregated task results.
 */
async function runAsyncPool(items, maxConcurrency, workerFn) {
  const results = [];
  let index = 0;
  let aborted = false;

  async function worker() {
    while (index < items.length && !aborted) {
      const currentIndex = index++;
      const item = items[currentIndex];
      const res = await workerFn(item);
      results[currentIndex] = res;
      if (bail && !res.ok) {
        aborted = true;
      }
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results.filter(Boolean);
}

/**
 * Record and log suite completion result.
 *
 * @param suite - Suite configuration.
 * @param res - Execution result.
 * @param passed - Array of passed results.
 * @param failed - Array of failed results.
 */
function recordResult(suite, res, passed, failed) {
  const sec = (res.durationMs / 1000).toFixed(2);
  if (res.ok) {
    passed.push(res);
    console.log(`  ✔ [PASS] ${suite.name} (${sec}s)`);
  } else {
    failed.push(res);
    console.log(`  ❌ [FAIL] ${suite.name} (${sec}s)`);
    console.log(res.stdout);
    if (res.stderr) console.error(res.stderr);
  }
}

async function runSequentialSuites(suites, bail, passed, failed) {
  for (const suite of suites) {
    const res = await executeSuite(suite);
    recordResult(suite, res, passed, failed);
    if (!res.ok && bail) break;
  }
}

// ── Main Runner ──
async function main() {
  const overallStart = Date.now();
  console.log(`\n================================================================`);
  console.log(`🚀 Auto-Refactor Parallel & Asynchronous Test Engine`);
  console.log(`   CPUs: ${os.cpus().length} | Concurrency: ${concurrency} workers`);
  console.log(`   Temp Directory: ${process.env.AUTO_REFACTOR_TMPDIR || 'default system temp'}`);
  console.log(`================================================================\n`);

  let parallelList = PARALLEL_SUITES;
  let sequentialList = SEQUENTIAL_SUITES;

  if (filter) {
    parallelList = parallelList.filter((s) => s.name.toLowerCase().includes(filter));
    sequentialList = sequentialList.filter((s) => s.name.toLowerCase().includes(filter));
    console.log(`[filter] Running suites matching: "${filter}"\n`);
  }

  const passed = [];
  const failed = [];

  if (parallelList.length > 0) {
    console.log(
      `--- [Isolated Suites] Executing ${parallelList.length} Independent Suites in Parallel ---`,
    );
    await runAsyncPool(parallelList, concurrency, async (suite) => {
      const res = await executeSuite(suite);
      recordResult(suite, res, passed, failed);
      return res;
    });
  }

  const canRunSequential = sequentialList.length > 0 && (!bail || failed.length === 0);
  if (canRunSequential) {
    console.log(
      `\n--- [Serial Suites] Executing ${sequentialList.length} Stateful/Daemon Suites Sequentially ---`,
    );
    await runSequentialSuites(sequentialList, bail, passed, failed);
  }

  const totalTime = ((Date.now() - overallStart) / 1000).toFixed(2);
  const total = passed.length + failed.length;

  console.log(`\n================================================================`);
  if (failed.length === 0) {
    console.log(`🎉 ALL ${total}/${total} TEST SUITES PASSED in ${totalTime}s!`);
    console.log(`================================================================\n`);
    process.exit(0);
  }
  console.log(
    `❌ TEST RUN FAILED: ${passed.length} passed, ${failed.length} failed in ${totalTime}s`,
  );
  console.log(`================================================================\n`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
