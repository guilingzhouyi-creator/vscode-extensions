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
const fs = require('fs');
const path = require('path');
const os = require('os');

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
  ModuleDependencyGraph,
} = require('../dist/api');

async function main() {
  console.log('=== [1/5] Testing Diff Semantic Classifier ===');

  // 1. Literal only change
  const litClass = classifyDiff('const TIMEOUT = 1000;', 'const TIMEOUT = 5000;');
  console.log('Literal only categories:', Array.from(litClass.categories));
  assert(litClass.categories.has('LITERAL_ONLY'), 'Should classify as LITERAL_ONLY');
  assert(!litClass.isDocOnly, 'Should not be doc only');

  // 2. Control flow change
  const cfClass = classifyDiff(
    'function run() { doWork(); }',
    'function run() { if (ready) doWork(); else throw new Error(); }',
  );
  console.log('Control flow categories:', Array.from(cfClass.categories));
  assert(cfClass.categories.has('CONTROL_FLOW'), 'Should classify as CONTROL_FLOW');

  // 3. Import / export change
  const impClass = classifyDiff(
    'import { a } from "./a";',
    'import { a } from "./a";\nimport { b } from "./b";',
  );
  console.log('Import/export categories:', Array.from(impClass.categories));
  assert(impClass.categories.has('IMPORT_EXPORT'), 'Should classify as IMPORT_EXPORT');

  // 4. Comment / doc only change
  const docClass = classifyDiff(
    '// old doc\nfunction a() {}',
    '// updated documentation explanation\nfunction a() {}',
  );
  console.log('Doc only categories:', Array.from(docClass.categories));
  assert(docClass.isDocOnly, 'Should classify as isDocOnly');
  assert(docClass.categories.has('COMMENT_DOC_ONLY'), 'Should contain COMMENT_DOC_ONLY');

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
      changedLines: ['  return a * 100;'],
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

  // Verify ReviewMemory was downgraded due to escalation
  const modARecord = scanner.getReviewMemory().get('src/modA.ts');
  assert(modARecord, 'Record for modA must exist');
  assert.strictEqual(modARecord.status, 'REJECTED', 'Memory record must be downgraded to REJECTED');

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

  assert(demoRoute.activeAnalyzers.has('constants'), 'Demo must activate constants');
  assert(!demoRoute.activeAnalyzers.has('architecture'), 'Demo must skip architecture');
  assert(webRoute.activeAnalyzers.has('security'), 'Web must activate security');
  assert(gameRoute.activeAnalyzers.has('gdscript-modern'), 'Game must activate gdscript-modern');
  assert(libRoute.activeAnalyzers.has('architecture'), 'Library must activate architecture');
  assert(
    libRoute.activeAnalyzers.has('dependency-graph'),
    'Library must activate dependency-graph',
  );

  // All 4 active sets must be distinct
  const demoSet = Array.from(demoRoute.activeAnalyzers).sort().join(',');
  const webSet = Array.from(webRoute.activeAnalyzers).sort().join(',');
  const gameSet = Array.from(gameRoute.activeAnalyzers).sort().join(',');
  const libSet = Array.from(libRoute.activeAnalyzers).sort().join(',');
  assert.notStrictEqual(demoSet, webSet, 'Demo and Web must have distinct active sets');
  assert.notStrictEqual(webSet, gameSet, 'Web and Game must have distinct active sets');
  assert.notStrictEqual(gameSet, libSet, 'Game and Library must have distinct active sets');

  // Real data on main scan path: create temp test projects
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archetype-scan-'));

  try {
    // 1. Demo workspace (path contains sample_demo_project)
    const demoDir = path.join(tmpRoot, 'sample_demo_project');
    fs.mkdirSync(path.join(demoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(demoDir, 'src', 'index.ts'), 'export const DEMO = 1;\n');
    const demoReport = await scan({ root: demoDir, cache: false, workers: 1 });
    assert(demoReport.summary.activatedReviewers, 'Demo report must publish activatedReviewers');
    assert.strictEqual(demoReport.summary.activatedReviewers.archetype, 'demo');
    assert(demoReport.summary.activatedReviewers.active.includes('constants'));
    assert(!demoReport.summary.activatedReviewers.active.includes('architecture'));

    // 2. Web workspace (package.json has express)
    const webDir = path.join(tmpRoot, 'web_app');
    fs.mkdirSync(path.join(webDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(webDir, 'package.json'),
      JSON.stringify({ name: 'web-app', dependencies: { express: '^4.18.0' } }),
    );
    fs.writeFileSync(path.join(webDir, 'src', 'server.ts'), 'export function app() {}\n');
    const webReport = await scan({ root: webDir, cache: false, workers: 1 });
    assert(webReport.summary.activatedReviewers, 'Web report must publish activatedReviewers');
    assert.strictEqual(webReport.summary.activatedReviewers.archetype, 'web');
    assert(webReport.summary.activatedReviewers.active.includes('security'));

    // 3. Game workspace (project.godot exists)
    const gameDir = path.join(tmpRoot, 'game_project');
    fs.mkdirSync(path.join(gameDir, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'project.godot'), 'config_version=5\n');
    fs.writeFileSync(
      path.join(gameDir, 'scripts', 'player.gd'),
      'extends Node\nfunc _ready():\n\tpass\n',
    );
    const gameReport = await scan({ root: gameDir, cache: false, workers: 1 });
    assert(gameReport.summary.activatedReviewers, 'Game report must publish activatedReviewers');
    assert.strictEqual(gameReport.summary.activatedReviewers.archetype, 'game');
    assert(gameReport.summary.activatedReviewers.active.includes('gdscript-modern'));

    // 4. Library workspace (package.json has main/module)
    const libDir = path.join(tmpRoot, 'my_lib');
    fs.mkdirSync(path.join(libDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(libDir, 'package.json'),
      JSON.stringify({ name: 'my-lib', main: 'dist/index.js' }),
    );
    fs.writeFileSync(path.join(libDir, 'src', 'index.ts'), 'export function lib() {}\n');
    const libReport = await scan({ root: libDir, cache: false, workers: 1 });
    assert(libReport.summary.activatedReviewers, 'Lib report must publish activatedReviewers');
    assert.strictEqual(libReport.summary.activatedReviewers.archetype, 'library');
    assert(libReport.summary.activatedReviewers.active.includes('architecture'));
    assert(libReport.summary.activatedReviewers.active.includes('dependency-graph'));

    // 5. Test sparseRouting=true filtering
    const sparseDemoReport = await scan({
      root: demoDir,
      sparseRouting: true,
      cache: false,
      workers: 1,
    });
    assert(
      sparseDemoReport.summary.activatedReviewers,
      'Sparse report must have activatedReviewers',
    );
    assert.strictEqual(sparseDemoReport.summary.activatedReviewers.archetype, 'demo');

    console.log('Archetype activations verified across demo, web, game, library.');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log('✔ Archetype Sparse Reviewer Activation on Main Scan Path verified.\n');

  console.log('================================================================');
  console.log('🎉 ALL ASYMMETRIC AUDIT SCANNING ENGINE CHECKS PASSED (6/6)!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
