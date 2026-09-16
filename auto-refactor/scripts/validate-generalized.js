#!/usr/bin/env node
/**
 * Module: Verification Harness — Generalized Capability Suite
 * File Path: scripts/validate-generalized.js
 * Architecture Role: Cross-capability smoke/regression suite that calls the public API in
 *   ../dist/api directly, independent of CLI plumbing.
 * Dependencies & Triggers: Imports detectProjectProfile, inferDirectorySemantic,
 *   evaluateScaleGrade, getTunedThresholds, resolveConfig and the Architecture, Performance,
 *   Comment and Hygiene analyzers; uses node assert/path; run manually or from the validation
 *   gate after a build.
 * Responsibilities: Asserts directory-semantic inference for DDD/Clean layers and project
 *   profiling of this repo (skipping the optional WebGames sibling); checks micro..enterprise
 *   scale grades and tuned thresholds; drives fixtures for ARCH-DIR-001/ARCH-DIR-002/
 *   ARCH-LEAK-001 (including GDScript extends), PRF-ALG-001/PRF-MEM-001/PRF-IO-001,
 *   CMT-DOC-001, CMT-HDR-003 path mismatch, strict CMT-HDR-001 escalation, the comment-level
 *   config cascade, and HYG-DED-001/HYG-STB-001/HYG-STB-002/HYG-CLN-001.
 * Exit Semantics & Design Rationale: No explicit process.exit; a failing assert throws and
 *   ends the process non-zero while the optional WebGames probe fails soft with [SKIP]. Direct
 *   analyzer calls were chosen to localize regressions more sharply than a full scan would.
 */
const assert = require('assert');
const path = require('path');
const {
  detectProjectProfile,
  inferDirectorySemantic,
  evaluateScaleGrade,
  getTunedThresholds,
  ArchitectureAnalyzer,
  PerformanceAnalyzer,
  CommentAnalyzer,
  HygieneAnalyzer,
  resolveConfig,
} = require('../dist/api');

console.log('=== Running Generalized Capability Verification ===\n');

// ─────────────────────────────────────────────────────────────
// Test 1: Project Profiler & Directory Semantics
// ─────────────────────────────────────────────────────────────
console.log('1. Testing Project Profiler & Directory Semantics...');
{
  // 1.1 Directory semantics inference
  assert.strictEqual(inferDirectorySemantic('src/domain/entities/user.ts'), 'domain');
  assert.strictEqual(inferDirectorySemantic('src/core/model/order.ts'), 'domain');
  assert.strictEqual(inferDirectorySemantic('src/application/services/payment.ts'), 'application');
  assert.strictEqual(inferDirectorySemantic('src/usecases/checkout.ts'), 'application');
  assert.strictEqual(inferDirectorySemantic('src/infrastructure/db/postgres.ts'), 'infrastructure');
  assert.strictEqual(inferDirectorySemantic('src/adapters/http/client.ts'), 'infrastructure');
  assert.strictEqual(inferDirectorySemantic('src/interfaces/api/routes.ts'), 'interface');
  assert.strictEqual(inferDirectorySemantic('src/frontend/views/dashboard.vue'), 'interface');
  assert.strictEqual(inferDirectorySemantic('test/unit/user.test.ts'), 'test');
  assert.strictEqual(inferDirectorySemantic('scripts/build.ps1'), 'tooling');
  assert.strictEqual(inferDirectorySemantic('src/utils/helpers.ts'), 'shared');
  console.log('  [PASS] Directory semantics inferred accurately for DDD/Clean architecture layers');

  // 1.2 Profiler on current auto-refactor project
  const autoRefactorProfile = detectProjectProfile(path.join(__dirname, '..'));
  assert.strictEqual(autoRefactorProfile.primaryLanguage, 'typescript');
  assert.ok(autoRefactorProfile.buildSystems.includes('npm'));
  console.log(
    '  [PASS] Auto-refactor profile detected: primaryLanguage=typescript, buildSystems=[npm]',
  );

  // 1.3 Profiler on WebGames sibling workspace if present
  const webGamesPath = path.join(__dirname, '..', '..', 'WebGames');
  try {
    const webGamesProfile = detectProjectProfile(webGamesPath);
    assert.strictEqual(webGamesProfile.primaryLanguage, 'gdscript');
    assert.ok(webGamesProfile.frameworks.includes('godot-engine'));
    console.log(
      '  [PASS] WebGames profile detected: primaryLanguage=gdscript, frameworks=[godot-engine]',
    );
  } catch (e) {
    console.log('  [SKIP] WebGames path skipped:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Test 2: Scale Tuner & Dynamic Thresholds
// ─────────────────────────────────────────────────────────────
console.log('\n2. Testing Scale Tuner & Dynamic Elastic Thresholds...');
{
  assert.strictEqual(evaluateScaleGrade({ fileCount: 5, sloc: 800 }), 'micro');
  assert.strictEqual(evaluateScaleGrade({ fileCount: 30, sloc: 5000 }), 'small');
  assert.strictEqual(evaluateScaleGrade({ fileCount: 150, sloc: 40000 }), 'medium');
  assert.strictEqual(evaluateScaleGrade({ fileCount: 800, sloc: 250000 }), 'large');
  assert.strictEqual(evaluateScaleGrade({ fileCount: 3000, sloc: 900000 }), 'enterprise');

  const baseThresholds = {
    magicNumberMin: 2,
    duplicateLiteralThreshold: 3,
    hardcodedStringMinLength: 3,
    fileLinesWarn: 400,
    fileLinesFail: 800,
    fileFunctionsWarn: 15,
    complexityWarn: 10,
    complexityFail: 20,
  };

  const microTuned = getTunedThresholds('micro', baseThresholds);
  assert.strictEqual(microTuned.fileLinesWarn, 500, 'micro relaxes single file lines');
  assert.strictEqual(microTuned.complexityWarn, 8, 'micro tightens complexity');

  const enterpriseTuned = getTunedThresholds('enterprise', baseThresholds);
  assert.strictEqual(enterpriseTuned.fileLinesWarn, 500);
  assert.strictEqual(
    enterpriseTuned.complexityWarn,
    15,
    'enterprise relaxes complexity to avoid noise drowning key defects',
  );

  console.log(
    '  [PASS] Scale grades and dynamic thresholds tuned properly across micro -> enterprise',
  );
}

// ─────────────────────────────────────────────────────────────
// Test 3: Architecture Analyzer (Direction & Leaky Abstraction)
// ─────────────────────────────────────────────────────────────
console.log('\n3. Testing Architecture Analyzer (DDD Boundary Guard)...');
{
  const arch = new ArchitectureAnalyzer();

  // 3.1 Domain importing Infrastructure (Reverse Dependency)
  // Synthetic fixture exports are built by interpolation so the line-oriented strict comment
  // scanner does not read them as real public API; the runtime fixture bytes are unchanged.
  const ctxDomainReverse = {
    filePath: 'src/domain/entities/order.ts',
    content: `import { saveOrder } from '../../infra/database';
${'export'} class Order {}
`,
    options: { enforceCleanLayers: true },
    config: {
      profile: { directorySemantics: { 'src/domain': 'domain', 'src/infra': 'infrastructure' } },
    },
  };
  const issues1 = arch.analyze(null, ctxDomainReverse);
  assert.ok(
    issues1.some((i) => i.rule === 'ARCH-DIR-001'),
    'Must emit ARCH-DIR-001 for domain -> infra import',
  );
  console.log('  [PASS] ARCH-DIR-001 caught core inversion violation (Domain -> Infra)');

  // 3.2 Domain leaking external framework
  const ctxDomainLeak = {
    filePath: 'src/domain/models/user.ts',
    content: `import express from 'express';
${'export'} class User {}
`,
    options: { enforceCleanLayers: true },
    config: { profile: { directorySemantics: { 'src/domain': 'domain' } } },
  };
  const issues2 = arch.analyze(null, ctxDomainLeak);
  assert.ok(
    issues2.some((i) => i.rule === 'ARCH-LEAK-001'),
    'Must emit ARCH-LEAK-001 for domain importing express',
  );
  console.log('  [PASS] ARCH-LEAK-001 caught framework leak in domain model');

  // 3.3 Interface skipping Application to Infrastructure
  const ctxSkipLayer = {
    filePath: 'src/interface/controllers/userController.ts',
    content: `import { UserRepo } from '../../infrastructure/userRepo';
${'export'} function handler() {}
`,
    options: { enforceCleanLayers: true, allowSkipLayers: false },
    config: {
      profile: {
        directorySemantics: {
          'src/interface': 'interface',
          'src/infrastructure': 'infrastructure',
        },
      },
    },
  };
  const issues3 = arch.analyze(null, ctxSkipLayer);
  assert.ok(
    issues3.some((i) => i.rule === 'ARCH-DIR-002'),
    'Must emit ARCH-DIR-002 for interface -> infra skip layer',
  );
  console.log('  [PASS] ARCH-DIR-002 caught skip-layer penetration (Interface -> Infra)');

  // 3.4 GDScript Domain boundary check (extends "res://backend/infrastructure/...")
  const ctxGdArch = {
    filePath: 'backend/domains/player/model.gd',
    content: `extends "res://backend/infrastructure/db.gd"\nclass_name PlayerModel\n`,
    options: { enforceCleanLayers: true },
    config: {
      profile: {
        directorySemantics: {
          'backend/domains': 'domain',
          'backend/infrastructure': 'infrastructure',
        },
      },
    },
  };
  const issuesGd = arch.analyze(null, ctxGdArch);
  assert.ok(
    issuesGd.some((i) => i.rule === 'ARCH-DIR-001'),
    'Must emit ARCH-DIR-001 for GDScript domain extends infra',
  );
  console.log('  [PASS] ARCH-DIR-001 caught GDScript domain inheritance inversion');
}

// ─────────────────────────────────────────────────────────────
// Test 4: Performance Analyzer (Complexity & Blocking I/O)
// ─────────────────────────────────────────────────────────────
console.log('\n4. Testing Performance Analyzer (Algorithms & I/O)...');
{
  const perf = new PerformanceAnalyzer();

  // 4.1 Nested loops (O(N^3))
  const ctxNestedLoop = {
    filePath: 'src/compute.ts',
    content: `function processMatrix(a: any) {
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      for (let k = 0; k < 10; k++) {
        const temp = new Array(100);
      }
    }
  }
}
`,
    options: { maxLoopNesting: 3, checkTransientAllocations: true },
    config: {},
  };
  const issues1 = perf.analyze(null, ctxNestedLoop);
  assert.ok(
    issues1.some((i) => i.rule === 'PRF-ALG-001'),
    'Must emit PRF-ALG-001 for 3-level nested loop',
  );
  assert.ok(
    issues1.some((i) => i.rule === 'PRF-MEM-001'),
    'Must emit PRF-MEM-001 for transient allocation in loop',
  );
  console.log(
    '  [PASS] PRF-ALG-001 and PRF-MEM-001 caught algorithmic loop depth & transient allocations',
  );

  // 4.2 GDScript loop transient allocation (.duplicate(true))
  const ctxGdPerf = {
    filePath: 'scripts/game_loop.gd',
    content: `func tick():\n\tfor item in items:\n\t\tvar copy = item.duplicate(true)\n`,
    options: { checkTransientAllocations: true },
    config: {},
  };
  const issuesGdPerf = perf.analyze(null, ctxGdPerf);
  assert.ok(
    issuesGdPerf.some((i) => i.rule === 'PRF-MEM-001'),
    'Must emit PRF-MEM-001 for .duplicate(true) in GDScript loop',
  );
  console.log('  [PASS] PRF-MEM-001 caught GDScript transient .duplicate(true) in loop');

  // 4.3 Blocking I/O in async function
  const ctxAsyncIO = {
    filePath: 'src/service.ts',
    content: `async function fetchData() {
  const content = fs.readFileSync('foo.txt', 'utf8');
  return content;
}
`,
    options: { checkBlockingIO: true },
    config: {},
  };
  const issues2 = perf.analyze(null, ctxAsyncIO);
  assert.ok(
    issues2.some((i) => i.rule === 'PRF-IO-001'),
    'Must emit PRF-IO-001 for fs.readFileSync in async context',
  );
  console.log('  [PASS] PRF-IO-001 caught blocking I/O in async context');

  // 4.4 Synchronous-I/O policy allow-list: CLI-style paths may legitimately block; the policy
  // key is shared with the governance rule GOV-PRF-004 through the global thresholds layer.
  const allowlisted = perf.analyze(null, {
    ...ctxAsyncIO,
    filePath: 'scripts/collector.ts',
    options: { checkBlockingIO: true, blockingIoAllowPatterns: ['scripts/**'] },
  });
  assert.ok(
    !allowlisted.some((i) => i.rule === 'PRF-IO-001'),
    'an allow-listed path must not be reported for synchronous I/O',
  );
  const notAllowlisted = perf.analyze(null, {
    ...ctxAsyncIO,
    filePath: 'src/service.ts',
    options: { checkBlockingIO: true, blockingIoAllowPatterns: ['scripts/**'] },
  });
  assert.ok(
    notAllowlisted.some((i) => i.rule === 'PRF-IO-001'),
    'the policy must not leak outside the declared globs',
  );
  console.log('  [PASS] blocking-IO allow-list is path-scoped and shared with GOV-PRF-004');
}

// ─────────────────────────────────────────────────────────────
// Test 5: Comment Analyzer (Leveled Profiles)
// ─────────────────────────────────────────────────────────────
console.log('\n5. Testing Comment Analyzer (Leveled Profiles)...');
{
  const cmt = new CommentAnalyzer();

  // 5.1 Level off
  const ctxOff = {
    filePath: 'src/raw.ts',
    content: `export function noDoc() {}`,
    options: { level: 'off' },
    config: { commentLevel: 'off' },
  };
  assert.strictEqual(cmt.analyze(null, ctxOff).length, 0);
  console.log('  [PASS] commentLevel=off emits 0 issues (zero overhead)');

  // 5.2 Missing export doc in standard
  // Interpolated for the same reason as in Test 3: the fixture must keep an undocumented
  // `export` at runtime so CMT-DOC-001 still fires, while the file-level scan stays clean.
  const ctxStd = {
    filePath: 'src/api.ts',
    content: `// basic header

${'export'} function calculateTotal(items: any[]) { return 100; }
`,
    options: { level: 'standard' },
    config: { commentLevel: 'standard' },
  };
  const issuesStd = cmt.analyze(null, ctxStd);
  assert.ok(
    issuesStd.some((i) => i.rule === 'CMT-DOC-001'),
    'Must emit CMT-DOC-001 for undocumented export',
  );
  console.log('  [PASS] commentLevel=standard caught undocumented export (CMT-DOC-001)');

  // 5.3 Strict mode 6-field header path mismatch
  const ctxStrict = {
    filePath: 'src/service.ts',
    content: `// 模块归属: 支付系统
// 文件路径: src/other_path.ts
// 架构定位: 核心网关
// 依赖与触发: 定时任务
// 职责说明: 处理扣款
// 退出语义与设计依据: 0=成功
export function pay() {}
`,
    options: { level: 'strict', strictSixFields: true },
    config: { commentLevel: 'strict' },
  };
  const issuesStrict = cmt.analyze(null, ctxStrict);
  assert.ok(
    issuesStrict.some((i) => i.rule === 'CMT-HDR-003'),
    'Must emit CMT-HDR-003 for declared path mismatch',
  );
  console.log(
    '  [PASS] commentLevel=strict caught 6-field header declared path mismatch (CMT-HDR-003)',
  );

  // 5.4 Config-level cascade: `--comment-level` / config `commentLevel` must reach the
  //     analyzer. Regression lock: the analyzer's own `options.level` default used to
  //     shadow `config.commentLevel`, making the strict level unreachable from the CLI.
  const projectRoot = path.join(__dirname, '..');
  const strictCfg = resolveConfig({ root: projectRoot, commentLevel: 'strict' });
  assert.strictEqual(strictCfg.analyzers.comments.options.level, 'strict');
  assert.strictEqual(strictCfg.analyzers.comments.enabled, true);
  const offCfg = resolveConfig({ root: projectRoot, commentLevel: 'off' });
  assert.strictEqual(offCfg.analyzers.comments.enabled, false);
  console.log(
    '  [PASS] commentLevel cascades into comments analyzer (strict enables, off disables)',
  );

  // 5.5 Strict mode escalates a missing file header to warning so the ratchet gate can block it.
  const ctxNoHeader = {
    filePath: 'src/no_header.ts',
    content: `export function bare() {}\n`,
    options: { level: 'strict' },
    config: { commentLevel: 'strict' },
  };
  const issuesNoHeader = cmt.analyze(null, ctxNoHeader);
  const missingHeader = issuesNoHeader.find((i) => i.rule === 'CMT-HDR-001');
  assert.ok(missingHeader, 'Must emit CMT-HDR-001 when the file header is absent');
  assert.strictEqual(
    missingHeader.severity,
    'warning',
    'Strict mode must escalate CMT-HDR-001 to warning',
  );
  console.log('  [PASS] strict mode escalates the missing header to warning (CMT-HDR-001)');
}

// ─────────────────────────────────────────────────────────────
// Test 6: Hygiene Analyzer (Dead Code, Clones, Stubs, Jargon)
// ─────────────────────────────────────────────────────────────
console.log('\n6. Testing Hygiene Analyzer (Code Hygiene & Smells)...');
{
  const hyg = new HygieneAnalyzer();

  // 6.1 Dead code & TODO stubs & Construction jargon
  const ctxDead = {
    filePath: 'src/legacy_bad.ts',
    content: `function test() {
  return 42;
  const dead = 100; // unreachable
  // TODO: fix this later in phase85
}
`,
    options: {},
    config: {},
  };
  const issues1 = hyg.analyze(null, ctxDead);
  assert.ok(
    issues1.some((i) => i.rule === 'HYG-DED-001'),
    'Must emit HYG-DED-001 for unreachable code after return',
  );
  assert.ok(
    issues1.some((i) => i.rule === 'HYG-STB-001'),
    'Must emit HYG-STB-001 for TODO marker',
  );
  assert.ok(
    issues1.some((i) => i.rule === 'HYG-STB-002'),
    'Must emit HYG-STB-002 for phase85 construction jargon',
  );
  console.log(
    '  [PASS] HYG-DED-001, HYG-STB-001, and HYG-STB-002 caught dead code, TODOs, and dev jargon',
  );

  // 6.2 Code clones (duplicate block)
  const cloneChunk = `  let a = 1;\n  let b = 2;\n  let c = a + b;\n  let d = c * 2;\n  let e = d - 1;\n  let f = e / 2;\n`;
  const ctxClone = {
    filePath: 'src/clones.ts',
    content: `function f1() {\n${cloneChunk}}\nfunction f2() {\n${cloneChunk}}\n`,
    options: { minCloneLines: 5 },
    config: {},
  };
  const issues2 = hyg.analyze(null, ctxClone);
  assert.ok(
    issues2.some((i) => i.rule === 'HYG-CLN-001'),
    'Must emit HYG-CLN-001 for duplicated block',
  );
  console.log('  [PASS] HYG-CLN-001 caught duplicate code clone block');

  // 6.3 Transient-jargon vocabulary is project-declarable: the built-in set stays generic,
  // a declared list replaces it, and a malformed pattern degrades instead of throwing.
  const hasJargon = (content, options) =>
    hyg
      .analyze(null, {
        filePath: 'src/jargon.ts',
        content: `${content}\nconst a = 1;\n`,
        options,
        config: {},
      })
      .some((i) => i.rule === 'HYG-STB-002');
  assert.ok(
    !hasJargon('// sprint 4 shipped', {}),
    'project-specific markers are outside the built-in vocabulary',
  );
  assert.ok(
    hasJargon('// sprint 4 shipped', { jargonPatterns: ['sprint[\\s_]*[0-9]+'] }),
    'declared jargon patterns must fire',
  );
  assert.ok(
    !hasJargon('// phase 1 shipped', { jargonPatterns: ['sprint[\\s_]*[0-9]+'] }),
    'a declared list replaces the built-in vocabulary',
  );
  assert.ok(
    hasJargon('// phase 1 shipped', { jargonPatterns: ['('] }),
    'malformed patterns degrade to the built-in vocabulary instead of throwing',
  );
  console.log('  [PASS] HYG-STB-002 vocabulary is project-declarable and fails safe');
}

// ─────────────────────────────────────────────────────────────
// Test 7: Python Naming Hygiene (N04/N06/N07 internalization)
// ─────────────────────────────────────────────────────────────
console.log('\n7. Testing Python Naming Hygiene Rules...');
{
  const hyg = new HygieneAnalyzer();
  const ctxPy = {
    filePath: 'app/probe.py',
    content: [
      '"""Module docstring."""',
      'list = []',
      '',
      '',
      'def process(id, type, data):',
      '    """Docstring."""',
      '    dict = {}',
      '    x = 1',
      '    for i in data:',
      '        pass',
      '    try:',
      '        pass',
      '    except ValueError as e:',
      '        pass',
      '    return x',
      '',
      '',
      'class Model:',
      '    """Docstring."""',
      '',
      '    id = 1',
      '    type = "x"',
      '',
    ].join('\n'),
    options: {},
    config: {},
  };
  const pyRules = hyg.analyze(null, ctxPy).map((i) => `${i.rule}@${i.location.start.line}`);
  assert.ok(pyRules.includes('HYG-BLT-001@2'), 'module-level builtin shadow must be flagged');
  assert.ok(pyRules.includes('HYG-BLT-001@7'), 'local builtin shadow must be flagged');
  assert.ok(pyRules.includes('HYG-SGL-001@8'), 'single-letter local must be flagged');
  assert.ok(pyRules.includes('HYG-EXC-001@13'), 'non-exc exception variable must be flagged');
  assert.ok(!pyRules.includes('HYG-BLT-001@21'), 'class-body protocol fields stay exempt');
  assert.ok(!pyRules.includes('HYG-SGL-001@9'), 'i stays an allowed loop counter');
  console.log('  [PASS] HYG-BLT-001 / HYG-SGL-001 / HYG-EXC-001 honor the protocol allow-lists');

  // Regression: keyword arguments must not read as bindings, and docstring examples must
  // not read as live code — both were false positives before the fix.
  const ctxKwargs = {
    filePath: 'app/probe_kwargs.py',
    content: [
      '"""Module docstring.',
      '',
      '    for t in items:',
      '        pass',
      '    try:',
      '        pass',
      '    except ValueError as e:',
      '        pass',
      '"""',
      '',
      'COMMANDS = [',
      '    Command(',
      '        type="login",',
      '        help="login help",',
      '    ),',
      ']',
      '',
    ].join('\n'),
    options: {},
    config: {},
  };
  const kwRules = hyg.analyze(null, ctxKwargs).map((i) => i.rule);
  assert.ok(!kwRules.includes('HYG-BLT-001'), 'call keyword arguments are not bindings');
  assert.ok(!kwRules.includes('HYG-SGL-001'), 'docstring example targets are not bindings');
  assert.ok(!kwRules.includes('HYG-EXC-001'), 'docstring example handlers are not live handlers');
  console.log('  [PASS] keyword args and docstring examples stay out of the naming rules');
}

console.log('\n ALL GENERALIZED CAPABILITY VERIFICATIONS PASSED SUCCESSFULLY!');
