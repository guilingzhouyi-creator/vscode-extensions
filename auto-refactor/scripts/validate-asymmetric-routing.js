/**
 * Module: Verification Harness — Asymmetric Audit Scanning Engine Validation
 * File Path: scripts/validate-asymmetric-routing.js
 * Architecture Role: Integration-level assertion suite covering the dual-track path
 *   from diff classification through routing and FastTrack/DeepTrack to escalation,
 *   with review-memory state checked at the end.
 * Dependencies & Triggers: ../dist/api classifyDiff, routeDiffToAnalyzers, Scanner,
 *   executeDualTrack, EscalationChannel, LoadGovernor, and the dependency-graph
 *   helpers; triggered by `npm run validate-asymmetric` inside the npm test chain,
 *   using process.cwd() as the Scanner root.
 * Responsibilities: Assert LITERAL_ONLY / CONTROL_FLOW / IMPORT_EXPORT /
 *   COMMENT_DOC_ONLY classification and router activation caps; verify a speculative
 *   FastTrack pass with APPROVED review memory; verify DeepTrack escalates a
 *   modA <-> modB cycle and downgrades memory to REJECTED; check LoadGovernor scale
 *   grades and per-grade deep-concurrency policy.
 * Exit Semantics & Design Rationale: Exits 0 only when all five groups assert clean;
 *   a failed assertion aborts via main().catch('Validation failed:') with exit 1.
 *   Explicit assertions are the oracle because routing can regress while still
 *   returning plausible-looking scores and statuses.
 */

const assert = require('assert');
const path = require('path');
const {
  createTempTestDir,
  cleanupTempDir,
  deployFixtures,
} = require('./common/test-runner-harness');

const {
  scan,
  classifyDiff,
  routeDiffToAnalyzers,
  detectProjectArchetype,
  routeArchetypeToAnalyzers,
  ARCHETYPE_ANALYZER_MATRIX,
  Scanner,
  executeDualTrack,
  EscalationChannel,
  LoadGovernor,
  detectDependencyCycles,
  detectDependencyCyclesAsync,
  SHARED_EXPERTS,
  LANGUAGE_EXCLUSIVE_ANALYZERS,
  ALL_LANGUAGE_SPECIFIC_ANALYZERS,
  ModuleDependencyGraph,
  handleAsymmetricScan,
  handleSliceAudit,
  createDaemonContext,
  WorkerPoolManager,
} = require('../dist/api');

async function main() {
  console.log('=== [1/5] Testing Diff Semantic Classifier ===');

  // 1. Literal only change
  const litClass = classifyDiff('const TIMEOUT = 1000;', 'const TIMEOUT = 5000;', 'src/config.ts');
  console.log('Literal only categories:', Array.from(litClass.categories));
  assert(litClass.categories.has('LITERAL_ONLY'), 'Should classify as LITERAL_ONLY');
  assert(!litClass.isDocOnly, 'Should not be doc only');

  // 2. Control flow change
  const cfClass = classifyDiff(
    'function run() { doWork(); }',
    'function run() { if (ready) doWork(); else throw new Error(); }',
    'src/worker.ts',
  );
  console.log('Control flow categories:', Array.from(cfClass.categories));
  assert(cfClass.categories.has('CONTROL_FLOW'), 'Should classify as CONTROL_FLOW');

  // 3. Import / export change
  const impClass = classifyDiff(
    'import { a } from "./a";',
    'import { a } from "./a";\nimport { b } from "./b";',
    'src/module.ts',
  );
  console.log('Import/export categories:', Array.from(impClass.categories));
  assert(impClass.categories.has('IMPORT_EXPORT'), 'Should classify as IMPORT_EXPORT');

  // 4. Comment / doc only change
  const docClass = classifyDiff(
    '// old doc\nfunction a() {}',
    '// updated documentation explanation\nfunction a() {}',
    'src/doc.ts',
  );
  console.log('Doc only categories:', Array.from(docClass.categories));
  assert(docClass.isDocOnly, 'Should classify as isDocOnly');
  assert(docClass.categories.has('COMMENT_DOC_ONLY'), 'Should contain COMMENT_DOC_ONLY');

  // 5. Language inference and DSpark confidence tier
  const tsClass = classifyDiff('const A = 1;', 'const A = 2;', 'src/index.ts');
  assert.strictEqual(tsClass.language, 'typescript', 'Should infer typescript from .ts');
  assert.strictEqual(tsClass.confidenceTier, 'HIGH', 'Literal change should be HIGH confidence');

  const pyClass = classifyDiff('x = 1', 'import os\nx = 2', 'app/main.py');
  assert.strictEqual(pyClass.language, 'python', 'Should infer python from .py');
  assert.strictEqual(pyClass.confidenceTier, 'LOW', 'Import change should be LOW confidence');

  // 6. True Diff Deletion & Doc-only Safety (F1 & D1 Guard)
  const delClass = classifyDiff('if (!auth) throw new Error();', '', 'src/auth.ts');
  assert(delClass.hasDeletion, 'Pure deletion must flag hasDeletion = true');
  assert(delClass.signals.has('DELETION'), 'Pure deletion must emit DELETION signal');
  assert(!delClass.isDocOnly, 'Code deletion must NOT be doc-only');
  assert(delClass.categories.has('CONTROL_FLOW'), 'Deleted control flow must retain CONTROL_FLOW');
  assert.strictEqual(
    delClass.confidenceTier,
    'LOW',
    'Deleted control flow must yield LOW confidence',
  );

  console.log('✔ Diff Semantic Classifier verified.\n');

  console.log('=== [2/5] Testing Sparse Rule MoE Router ===');
  const routeLit = routeDiffToAnalyzers(litClass);
  console.log(
    `Literal diff active analyzers: [${Array.from(routeLit.activeAnalyzers).join(', ')}] (Ratio: ${routeLit.activationRatio})`,
  );
  assert(
    routeLit.activeAnalyzers.has('constants'),
    'Constants analyzer must be active for literals',
  );
  assert(routeLit.activeAnalyzers.has('secrets'), 'Secrets analyzer must be active for literals');
  assert(
    !routeLit.activeAnalyzers.has('complexity'),
    'Complexity analyzer should be skipped for literals',
  );
  assert(
    !routeLit.activeAnalyzers.has('architecture'),
    'Architecture analyzer should be skipped for literals',
  );
  assert(
    routeLit.activationRatio <= 0.25,
    `Literal activation ratio should be <= 25%, got ${routeLit.activationRatio}`,
  );

  // DeepSeek MoE Shared Experts assertions
  assert(SHARED_EXPERTS.includes('hygiene'), 'SHARED_EXPERTS must include hygiene');
  assert(SHARED_EXPERTS.includes('constants'), 'SHARED_EXPERTS must include constants');
  assert(
    routeLit.activeAnalyzers.has('hygiene'),
    'Shared hygiene expert must be active on code mutation',
  );

  // DeepSeek MoE Language Gating Filter assertions
  assert(
    LANGUAGE_EXCLUSIVE_ANALYZERS.typescript.includes('ts-modern'),
    'LANGUAGE_EXCLUSIVE_ANALYZERS must map typescript',
  );
  assert(
    ALL_LANGUAGE_SPECIFIC_ANALYZERS.length >= 4,
    'ALL_LANGUAGE_SPECIFIC_ANALYZERS must declare at least 4 modernizers',
  );
  const routeTs = routeDiffToAnalyzers(tsClass);
  assert(!routeTs.activeAnalyzers.has('python-modern'), 'Prune python-modern for TS');
  assert(!routeTs.activeAnalyzers.has('rust-modern'), 'Prune rust-modern for TS');
  assert(!routeTs.activeAnalyzers.has('gdscript-modern'), 'Prune gdscript-modern for TS');

  const routePy = routeDiffToAnalyzers(pyClass);
  assert(!routePy.activeAnalyzers.has('typescript-modern'), 'Prune ts-modern for Python');
  assert(!routePy.activeAnalyzers.has('rust-modern'), 'Prune rust-modern for Python');
  assert(!routePy.activeAnalyzers.has('gdscript-modern'), 'Prune gdscript-modern for Python');

  const routeDoc = routeDiffToAnalyzers(docClass);
  console.log(
    `Doc diff active analyzers: [${Array.from(routeDoc.activeAnalyzers).join(', ')}] (Ratio: ${routeDoc.activationRatio})`,
  );
  assert(
    routeDoc.activeAnalyzers.has('comments'),
    'Comments analyzer must be active for doc changes',
  );
  assert(
    routeDoc.activationRatio <= 0.15,
    `Doc activation ratio should be <= 15%, got ${routeDoc.activationRatio}`,
  );

  // DeepSeekMoE Top-k Capacity Capping & Overflow Offloading Verification
  const multiDiff = classifyDiff(
    'import { oldFunc } from "./old";\nexport function run(x: number): number {\n  return x * 2;\n}',
    'import { newFunc, helper } from "./new";\n// updated doc comments\nexport function run(x: number, flag?: boolean): number {\n  if (flag) return helper(x);\n  return x * 2 + 100;\n}',
    'src/multi.ts',
  );
  const routeMulti = routeDiffToAnalyzers(multiDiff);
  console.log(
    `Multi-category active analyzers: [${Array.from(routeMulti.activeAnalyzers).join(', ')}] (Ratio: ${routeMulti.activationRatio})`,
  );
  assert(
    routeMulti.activeAnalyzers.size <= 8,
    `Active analyzers must strictly cap at <= 8 (<= 25% capacity), got ${routeMulti.activeAnalyzers.size}`,
  );
  assert(
    routeMulti.activationRatio <= 0.25,
    `Multi-category activation ratio must strictly cap at <= 0.25, got ${routeMulti.activationRatio}`,
  );
  assert(routeMulti.overflowAnalyzers instanceof Set, 'overflowAnalyzers must be emitted as a Set');
  console.log(
    `Multi-category overflow analyzers: [${Array.from(routeMulti.overflowAnalyzers).join(', ')}]`,
  );
  assert(
    routeMulti.overflowAnalyzers.size > 0,
    'Overflow analyzers must contain candidates that exceeded the top-k capacity',
  );

  console.log('✔ Sparse Rule MoE Router verified.\n');

  console.log('=== [3/5] Testing FastTrack Foreground Speculative Audit ===');
  const scanner = new Scanner({
    root: process.cwd(),
    include: ['src/**/*.ts'],
    exclude: ['**/node_modules/**'],
    analyzers: {
      constants: { enabled: true },
      complexity: { enabled: true },
      comments: { enabled: true },
      secrets: { enabled: true },
      architecture: { enabled: true },
      'dependency-graph': { enabled: true },
    },
  });

  const testFile = 'src/test_sample.ts';
  const initialContent = 'export function calculate(a: number): number {\n  return a * 2;\n}\n';
  const updatedContent =
    'export function calculate(a: number): number {\n  // updated logic\n  return a * 100;\n}\n';

  const t0 = Date.now();
  const dualTrackExec = await executeDualTrack(scanner, [
    {
      filePath: testFile,
      oldContent: initialContent,
      newContent: updatedContent,
    },
  ]);

  const fastVerdict = dualTrackExec.fastVerdict;
  const elapsedMs = Date.now() - t0;
  console.log(
    `FastTrack completed in ${elapsedMs}ms (reported latency: ${fastVerdict.latencyMs}ms)`,
  );
  console.log(`FastTrack status: ${fastVerdict.status}`);
  console.log(
    `Speculative Composite Score: ${fastVerdict.score.compositeScore} (${fastVerdict.score.grade})`,
  );
  console.log(`Active analyzers:`, fastVerdict.sparseRouting[testFile]?.activeAnalyzers);

  assert(fastVerdict.status === 'SPECULATIVE_PASSED', 'Expected clean edit to speculatively pass');
  assert(fastVerdict.score.compositeScore > 70, 'Quality score should remain high');
  assert(fastVerdict.agentGuidancePrompt, 'Agent prompt should be generated');

  // Verify Review Memory was populated
  const memRecord = scanner.getReviewMemory().get(testFile);
  assert(memRecord, 'Review memory must record file');
  assert.strictEqual(memRecord.status, 'APPROVED', 'Memory status should be APPROVED');

  // Verify replayBoundedFastTrack gated opt-in (P2-2)
  const boundedExec = await executeDualTrack(
    scanner,
    [
      {
        filePath: testFile,
        oldContent: initialContent,
        newContent: updatedContent,
      },
    ],
    { replayBoundedFastTrack: true },
  );
  assert.strictEqual(
    boundedExec.fastVerdict.status,
    'SPECULATIVE_PASSED',
    'Replay-bounded FastTrack must pass on clean localized edit',
  );
  console.log('  ✔ replayBoundedFastTrack gated opt-in successfully bounds and audits change (P2-2)');

  console.log('✔ FastTrack foreground audit verified.\n');

  console.log('=== [4/5] Testing DeepTrack Asynchronous Cycle & Escalation ===');
  const channel = new EscalationChannel();
  let escalationReceived = false;

  channel.subscribe((event) => {
    console.log(`[ESCALATION EVENT RECEIVED] Type: ${event.type}, Message: ${event.message}`);
    escalationReceived = true;
  });

  // Construct cyclic dependency between two files: modA.ts <-> modB.ts
  const graph = new ModuleDependencyGraph();
  graph.registerFromContent('src/modA.ts', 'import { b } from "./modB"; export const a = 1;');
  graph.registerFromContent('src/modB.ts', 'import { a } from "./modA"; export const b = 2;');

  const cycles = detectDependencyCycles(graph);
  console.log('Cycles detected directly:', cycles);
  assert(cycles.length > 0, 'Cycle detector must detect modA <-> modB cycle');

  // Run dual track with cycle introduction
  const cycleExec = await executeDualTrack(
    scanner,
    [
      {
        filePath: 'src/modA.ts',
        oldContent: 'export const a = 1;',
        newContent: 'import { b } from "./modB"; export const a = 1;',
      },
    ],
    {
      escalationChannel: channel,
      graph,
    },
  );

  const deepVerdict = await cycleExec.deepPromise;
  console.log('DeepTrack status:', deepVerdict.status);
  console.log('Deep issues:', deepVerdict.deepIssues.length);
  console.log('Escalation events count:', deepVerdict.escalationEvents.length);

  assert(deepVerdict.status === 'ESCALATED', 'DeepTrack must escalate on circular dependency');
  assert(escalationReceived, 'EscalationChannel listener must be invoked');
  assert(channel.hasBreaches(), 'EscalationChannel must report breaches');

  // Verify detectDependencyCyclesAsync works identically to synchronous version
  const asyncCycles = await detectDependencyCyclesAsync(graph, ['src/modA.ts']);
  assert.strictEqual(
    asyncCycles.length,
    cycles.length,
    'detectDependencyCyclesAsync must match sync detectDependencyCycles',
  );

  // Verify ReviewMemory was downgraded due to escalation and recorded contaminationReason
  const modARecord = scanner.getReviewMemory().get('src/modA.ts');
  assert(modARecord, 'Record for modA must exist');
  assert.strictEqual(modARecord.status, 'REJECTED', 'Memory record must be downgraded to REJECTED');
  assert(modARecord.contaminationReason, 'Memory record must record contaminationReason');

  console.log('✔ DeepTrack cycle detection and escalation verified.\n');

  console.log('=== [5/5] Testing Load Governor & Scale Steering ===');
  const governor = new LoadGovernor(500, 400);
  assert.strictEqual(governor.getScaleGrade(20), 'MICRO');
  assert.strictEqual(governor.getScaleGrade(200), 'STANDARD');
  assert.strictEqual(governor.getScaleGrade(2500), 'ENTERPRISE');
  assert.strictEqual(governor.getScaleGrade(10000), 'MASSIVE');

  const microPolicy = governor.evaluatePolicy(20);
  assert.strictEqual(microPolicy.scaleGrade, 'MICRO');
  assert.strictEqual(microPolicy.maxDeepConcurrency, 1);

  const entPolicy = governor.evaluatePolicy(3000);
  assert.strictEqual(entPolicy.scaleGrade, 'ENTERPRISE');
  console.log(
    `Enterprise scale policy: concurrency=${entPolicy.maxDeepConcurrency}, reason="${entPolicy.reason}"`,
  );

  console.log('✔ Load Governor scale steering verified.\n');

  console.log('=== [6/6] Testing Archetype Sparse Reviewer Activation on Main Scan Path ===');

  // Matrix and routeArchetypeToAnalyzers unit assertions
  assert.strictEqual(typeof detectProjectArchetype, 'function');
  assert(ARCHETYPE_ANALYZER_MATRIX.demo.includes('constants'));

  const demoRoute = routeArchetypeToAnalyzers('demo');
  const webRoute = routeArchetypeToAnalyzers('web');
  const gameRoute = routeArchetypeToAnalyzers('game');
  const libRoute = routeArchetypeToAnalyzers('library');

  assert(
    demoRoute.activeAnalyzers.has('constants') && !demoRoute.activeAnalyzers.has('architecture'),
  );
  assert(webRoute.activeAnalyzers.has('security'));
  assert(gameRoute.activeAnalyzers.has('gdscript-modern'));
  assert(
    libRoute.activeAnalyzers.has('architecture') &&
      libRoute.activeAnalyzers.has('dependency-graph'),
  );

  // All 4 active sets must be distinct
  const toKey = (r) => Array.from(r.activeAnalyzers).sort().join(',');
  assert.notStrictEqual(toKey(demoRoute), toKey(webRoute));
  assert.notStrictEqual(toKey(webRoute), toKey(gameRoute));
  assert.notStrictEqual(toKey(gameRoute), toKey(libRoute));

  const tmpRoot = createTempTestDir('archetype-scan-');
  // Helper to create and scan archetype test fixtures
  const setupWs = (dirName, files) => {
    const wsDir = path.join(tmpRoot, dirName);
    deployFixtures(wsDir, files);
    return wsDir;
  };

  try {
    // 1. Demo workspace (path contains sample_demo_project)
    const demoDir = setupWs('sample_demo_project', { 'src/index.ts': 'export const DEMO = 1;\n' });
    const demoRep = await scan({ root: demoDir, cache: false, workers: 1 });
    assert.strictEqual(demoRep.summary.activatedReviewers?.archetype, 'demo');
    assert(demoRep.summary.activatedReviewers.active.includes('constants'));
    assert(!demoRep.summary.activatedReviewers.active.includes('architecture'));

    // 2. Web workspace (package.json has express)
    const webPkg = JSON.stringify({ name: 'web', dependencies: { express: '^4.18.0' } });
    const webDir = setupWs('web_app', {
      'package.json': webPkg,
      'src/server.ts': 'export function app() {}\n',
    });
    const webRep = await scan({ root: webDir, cache: false, workers: 1 });
    assert.strictEqual(webRep.summary.activatedReviewers?.archetype, 'web');
    assert(webRep.summary.activatedReviewers.active.includes('security'));

    // 3. Game workspace (project.godot exists)
    const gameFiles = {
      'project.godot': 'config_version=5\n',
      'scripts/player.gd': 'extends Node\nfunc _ready():\n\tpass\n',
    };
    const gameDir = setupWs('game_project', gameFiles);
    const gameRep = await scan({ root: gameDir, cache: false, workers: 1 });
    assert.strictEqual(gameRep.summary.activatedReviewers?.archetype, 'game');
    assert(gameRep.summary.activatedReviewers.active.includes('gdscript-modern'));

    // 4. Library workspace (package.json has main/module)
    const libPkg = JSON.stringify({ name: 'my-lib', main: 'dist/index.js' });
    const libDir = setupWs('my_lib', {
      'package.json': libPkg,
      'src/index.ts': 'export function lib() {}\n',
    });
    const libRep = await scan({ root: libDir, cache: false, workers: 1 });
    assert.strictEqual(libRep.summary.activatedReviewers?.archetype, 'library');
    assert(libRep.summary.activatedReviewers.active.includes('architecture'));
    assert(libRep.summary.activatedReviewers.active.includes('dependency-graph'));

    // 5. Test sparseRouting=true filtering
    const sparseRep = await scan({ root: demoDir, sparseRouting: true, cache: false, workers: 1 });
    assert.strictEqual(sparseRep.summary.activatedReviewers?.archetype, 'demo');

    console.log('Archetype activations verified across demo, web, game, library.');
  } finally {
    cleanupTempDir(tmpRoot);
  }

  console.log('✔ Archetype Sparse Reviewer Activation on Main Scan Path verified.\n');

  console.log('=== [7/7] Testing DeepInfer Disaggregated Serving & Tiered Offloading ===');
  // 1. Localized slice audit serving
  const sliceAuditRes = await handleSliceAudit(
    'src/math.ts',
    'export function add(a: number, b: number): number { return a + b; }',
    'export function add(a: number, b: number, c?: number): number { return a + b + (c || 0); }',
    [1],
  );
  assert(sliceAuditRes.slices.length > 0, 'Slice audit must extract affected AST slices');
  assert.strictEqual(sliceAuditRes.slices[0].symbolName, 'add', 'Symbol name must match');
  console.log(
    `Slice audit extracted ${sliceAuditRes.slices.length} slice(s) in ${sliceAuditRes.durationMs}ms`,
  );

  // 2. Disaggregated Prefill-Decode serving via daemon context
  const daemonCtx = createDaemonContext();
  const daemonConfig = {
    root: process.cwd(),
    include: ['src/**/*.ts'],
    analyzers: {
      constants: { enabled: true },
      hygiene: { enabled: true },
    },
  };
  const daemonInputs = [
    {
      filePath: 'src/demo.ts',
      oldContent: 'const MSG = "hello";\n',
      newContent: 'const MSG = "world";\n',
      lineBounds: [1, 2],
    },
  ];

  // Prefill only (FastTrack foreground audit without blocking on DeepTrack)
  const prefillRes = await handleAsymmetricScan(daemonCtx, daemonConfig, daemonInputs, {
    prefillOnly: true,
  });
  assert.strictEqual(prefillRes.fastVerdict.status, 'SPECULATIVE_PASSED');
  assert.strictEqual(prefillRes.deepStatus, 'SKIPPED');
  console.log(`Disaggregated Prefill-only completed in ${prefillRes.durationMs}ms`);

  // Full Prefill + Decode disaggregation
  const fullRes = await handleAsymmetricScan(daemonCtx, daemonConfig, daemonInputs, {
    prefillOnly: false,
  });
  assert.strictEqual(fullRes.fastVerdict.status, 'SPECULATIVE_PASSED');
  assert.strictEqual(fullRes.deepStatus, 'CONFIRMED');
  console.log(`Full Disaggregated Prefill+Decode completed in ${fullRes.durationMs}ms`);

  // 3. KTransformers-style tiered analyzer pool offloading
  const pool = new WorkerPoolManager({ maxConcurrency: 2 });
  const hotObj = { kind: 'hot-constants' };
  pool.releaseTieredAnalyzer('constants', hotObj, true);
  const acquiredHot = pool.acquireTieredAnalyzer('constants', true, () => ({ kind: 'fresh' }));
  assert.strictEqual(acquiredHot, hotObj, 'Hot resident analyzer must be pooled and reused');

  const coldObj = { kind: 'cold-concurrency' };
  pool.releaseTieredAnalyzer('concurrency', coldObj, false);
  const acquiredCold = pool.acquireTieredAnalyzer('concurrency', false, () => ({
    kind: 'fresh-cold',
  }));
  assert.strictEqual(
    acquiredCold.kind,
    'fresh-cold',
    'Cold offloaded analyzer must be evicted and re-instantiated on demand',
  );
  console.log('Tiered residency (hot pooled vs cold evicted) verified.');

  console.log('✔ DeepInfer Disaggregated Serving & Tiered Offloading verified.\n');

  console.log('🎉 ALL ASYMMETRIC AUDIT SCANNING ENGINE CHECKS PASSED (7/7)!');
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
