#!/usr/bin/env node
/**
 * Module: Verification Harness — Native Operator & Dual-Track Equivalence
 * File Path: scripts/validate-native-operator.js
 * Architecture Role: Verifies the integrity of the Rust native operator kernel (auto-refactor-ops)
 *   and asserts 100% byte and algorithmic equivalence between Rust SIMD operators and the
 *   pure JavaScript fallback shim across multilingual source code matrices.
 * Dependencies & Triggers: Consumes src/core/native, src/core/policy/source-mask;
 *   executed by scripts/test-parallel.js or `node scripts/validate-native-operator.js`.
 * Responsibilities:
 *   1. Validate native acceleration status, capabilities, and version metadata;
 *   2. Assert 100% byte equivalence between Rust SIMD masking and JS fallback across
 *      TypeScript, JavaScript, Python, Rust, GDScript, Go, Shell, and PowerShell;
 *   3. Assert UTF-16 column alignment and character counts on Unicode/multilingual comments;
 *   4. Verify parity across diff hunks, Tarjan SCC cycle detection, and pattern matching;
 *   5. Perform real-file regression scans across repository sources.
 * Exit Semantics & Design Rationale: Exits 0 on all tests passing, exits 1 on any parity drift.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  getNativeCoreStatus,
  nativeCore,
  PureJsNativeShim,
} = require('../dist/core/native');
const {
  SOURCE_MASK_PRESETS,
  MASK_LANGUAGE_TYPESCRIPT,
  MASK_LANGUAGE_JAVASCRIPT,
  MASK_LANGUAGE_PYTHON,
  MASK_LANGUAGE_GDSCRIPT,
  MASK_LANGUAGE_RUST,
  MASK_LANGUAGE_GO,
  MASK_LANGUAGE_SHELL,
  MASK_LANGUAGE_POWERSHELL,
} = require('../dist/core/policy/source-mask');

const shim = new PureJsNativeShim();

function toNativeConfig(preset) {
  return {
    lineComment: preset.lineComment,
    blockCommentOpen: preset.blockComment ? preset.blockComment.open : undefined,
    blockCommentClose: preset.blockComment ? preset.blockComment.close : undefined,
    quoteChars: preset.quoteChars,
    multilineTemplates: preset.multilineTemplates,
    regexLiterals: preset.regexLiterals,
  };
}

const TEST_CORPUS = [
  {
    language: MASK_LANGUAGE_TYPESCRIPT,
    source: [
      'import { foo } from "./foo"; // import statement',
      'const regex = /pattern[a-z]\\//gi; /* block comment */ const x = 10 / 2;',
      'const template = `line 1',
      'line 2 ${foo}',
      'line 3`; const y = \'single\\\'quoted\';',
      '// trailing line comment',
    ].join('\n'),
  },
  {
    language: MASK_LANGUAGE_JAVASCRIPT,
    source: [
      'function test() {',
      '  const str = "hello \\"world\\""; // string escape',
      '  const div = a / b / c; // division, not regex',
      '  const re = /(?:foo|bar)/m; // regex literal',
      '}',
    ].join('\r\n'),
  },
  {
    language: MASK_LANGUAGE_PYTHON,
    source: [
      '# Python file header',
      'def compute(x):',
      '    """Multi-line docstring here"""',
      '    msg = \'Single quotes with # hash symbol inside\'',
      '    return x * 2  # inline comment',
    ].join('\n'),
  },
  {
    language: MASK_LANGUAGE_GDSCRIPT,
    source: [
      'extends Node2D',
      '# Godot GDScript node',
      '@export var speed: float = 100.0 # movement speed',
      'var label: String = "Score: %d" # format string',
      'func _ready() -> void:',
      '\tpass',
    ].join('\n'),
  },
  {
    language: MASK_LANGUAGE_RUST,
    source: [
      '// Rust source module',
      'fn calculate<\'a>(slice: &\'a [u8]) -> usize {',
      '    /* lifetime \'a should not be treated as quote */',
      '    let message = "hello \\"world\\"";',
      '    slice.len()',
      '}',
    ].join('\n'),
  },
  {
    language: MASK_LANGUAGE_GO,
    source: [
      'package main',
      '// Go package comment',
      'const raw = `multiline',
      'raw string in go`;',
      '/* block comment',
      '   spanning lines */',
      'func main() {}',
    ].join('\n'),
  },
  {
    language: MASK_LANGUAGE_SHELL,
    source: [
      '#!/bin/bash',
      '# Shell script test',
      'NAME="World"',
      'echo "Hello, $NAME" # greeting message',
    ].join('\n'),
  },
  {
    language: MASK_LANGUAGE_POWERSHELL,
    source: [
      '# PowerShell script',
      '<# Multi-line block',
      '   comment in PowerShell #>',
      'Write-Host "Running diagnostics..."',
    ].join('\n'),
  },
  {
    language: MASK_LANGUAGE_TYPESCRIPT,
    source: [
      '// 中文注释与国际化字符测试',
      'const greeting = "你好，世界！"; // 这是行末注释',
      '/* 这是一个跨行的',
      '   中文块注释 */',
      'const emoji = "🚀 Antigravity 2.0 ✨";',
    ].join('\n'),
  },
  {
    language: MASK_LANGUAGE_TYPESCRIPT,
    source: '',
  },
  {
    language: MASK_LANGUAGE_TYPESCRIPT,
    source: '// Single comment line only\n',
  },
];

function runValidation() {
  console.log('=== [Native Operator Validation] Testing Rust Kernel & Dual-Track Parity ===');

  // 1. Verify Status and Capabilities
  const status = getNativeCoreStatus();
  console.log(`[Status] Active Engine: ${status.activeEngine} (version: ${status.version})`);
  console.log(`[Status] Capabilities: ${status.capabilities.join(', ')}`);
  assert.ok(status.capabilities.includes('simd-source-mask'), 'Capability simd-source-mask missing');
  assert.ok(status.capabilities.includes('histogram-diff'), 'Capability histogram-diff missing');
  assert.ok(status.capabilities.includes('tarjan-scc'), 'Capability tarjan-scc missing');
  assert.ok(status.capabilities.includes('dominator-tree'), 'Capability dominator-tree missing');
  assert.ok(status.capabilities.includes('dataflow-solver'), 'Capability dataflow-solver missing');

  // 2. Multilingual Matrix Dual-Track Equivalence
  console.log(`[Matrix] Validating ${TEST_CORPUS.length} multilingual test cases...`);
  for (let idx = 0; idx < TEST_CORPUS.length; idx++) {
    const testCase = TEST_CORPUS[idx];
    const preset = SOURCE_MASK_PRESETS[testCase.language];
    const config = toNativeConfig(preset);

    const rustRes = nativeCore.maskSourceCode(testCase.source, config);
    const shimRes = shim.maskSourceCode(testCase.source, config);

    // Byte-for-byte raw lines equivalence
    assert.strictEqual(
      rustRes.raw.length,
      shimRes.raw.length,
      `Case ${idx} (${testCase.language}): raw lines length mismatch`,
    );
    for (let i = 0; i < rustRes.raw.length; i++) {
      assert.strictEqual(
        rustRes.raw[i],
        shimRes.raw[i],
        `Case ${idx} (${testCase.language}) line ${i}: raw line mismatch`,
      );
    }

    // Byte-for-byte masked lines equivalence
    assert.strictEqual(
      rustRes.masked.length,
      shimRes.masked.length,
      `Case ${idx} (${testCase.language}): masked lines length mismatch`,
    );
    for (let i = 0; i < rustRes.masked.length; i++) {
      assert.strictEqual(
        rustRes.masked[i],
        shimRes.masked[i],
        `Case ${idx} (${testCase.language}) line ${i}: masked line content mismatch:\nRust: "${rustRes.masked[i]}"\nShim: "${shimRes.masked[i]}"`,
      );
    }

    // Line counts equivalence
    assert.strictEqual(
      rustRes.lines,
      shimRes.lines,
      `Case ${idx} (${testCase.language}): total lines count mismatch`,
    );
    assert.strictEqual(
      rustRes.nonBlankLines,
      shimRes.nonBlankLines,
      `Case ${idx} (${testCase.language}): non-blank lines count mismatch`,
    );
  }
  console.log('✓ All multilingual corpus test cases achieved 100% byte equivalence.');

  // 3. Real Repository Files Regression Test
  const realFiles = [
    path.resolve(__dirname, '..', 'src', 'core', 'policy', 'source-mask.ts'),
    path.resolve(__dirname, '..', 'src', 'core', 'native', 'native-bridge.ts'),
    path.resolve(__dirname, '..', 'src', 'core', 'scoring', 'risk-fusion-engine.ts'),
  ];

  console.log(`[Real Files] Verifying against ${realFiles.length} actual codebase files...`);
  for (const filePath of realFiles) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    const config = toNativeConfig(SOURCE_MASK_PRESETS[MASK_LANGUAGE_TYPESCRIPT]);

    const rustRes = nativeCore.maskSourceCode(content, config);
    const shimRes = shim.maskSourceCode(content, config);

    assert.strictEqual(rustRes.raw.length, shimRes.raw.length);
    assert.strictEqual(rustRes.masked.length, shimRes.masked.length);
    assert.strictEqual(rustRes.lines, shimRes.lines);
    assert.strictEqual(rustRes.nonBlankLines, shimRes.nonBlankLines);

    for (let i = 0; i < rustRes.masked.length; i++) {
      if (rustRes.masked[i] !== shimRes.masked[i]) {
        assert.fail(`Mismatch in ${path.basename(filePath)} at line ${i + 1}`);
      }
    }
    console.log(`  ✓ ${path.basename(filePath)}: ${rustRes.lines} lines, 100% byte-matched.`);
  }

  // 4. Parity of Graph and Diff Operators
  console.log('[Diff & Graph] Verifying graph analysis and diff hunk parity...');
  const edges = [
    ['moduleA', 'moduleB'],
    ['moduleB', 'moduleC'],
    ['moduleC', 'moduleA'],
    ['moduleD', 'moduleE'],
  ];
  const graphRust = nativeCore.analyzeDependencyGraph(edges);
  const graphShim = shim.analyzeDependencyGraph(edges);
  assert.strictEqual(graphRust.isAcyclic, graphShim.isAcyclic);
  assert.strictEqual(graphRust.cycles.length, graphShim.cycles.length);
  assert.strictEqual(
    graphRust.stronglyConnectedComponents.length,
    graphShim.stronglyConnectedComponents.length,
  );

  const oldText = 'line 1\nline 2\nline 3\nline 4';
  const newText = 'line 1\nline 2 MODIFIED\nline 3\nline 4';
  const diffRust = nativeCore.computeHistogramDiff(oldText, newText);
  const diffShim = shim.computeHistogramDiff(oldText, newText);
  assert.strictEqual(diffRust.length, diffShim.length);
  for (let i = 0; i < diffRust.length; i++) {
    assert.strictEqual(diffRust[i].lines.length, diffShim[i].lines.length);
  }
  console.log('✓ Diff and Graph operators parity verified.');

  // 5. Parity of Clone and Duplication Operators
  console.log('[Clone & Duplication] Verifying duplicate lines and clone detection parity...');
  const dupSamples = [
    'line 1\nline 2\nline 1\n\nline 1\n',
    'const a = 1;\r\nconst b = 2;\r\nconst a = 1;\r\n',
    'function foo() {\n  return 42;\n}\n\nfunction foo() {\n  return 42;\n}\n',
    '// 注释1\nconst x = "你好世界";\nconst x = "你好世界";\n',
  ];
  for (const sample of dupSamples) {
    const dupRust = nativeCore.countDuplicateLines(sample);
    const dupShim = shim.countDuplicateLines(sample);
    assert.strictEqual(dupRust, dupShim, `Duplicate line count mismatch for sample: ${sample}`);
  }
  console.log('  ✓ Duplicate line counting 100% equivalent across all samples.');

  // Clone block detection
  const cloneLines = [];
  for (let i = 0; i < 7; i++) {
    cloneLines.push(`    const value_${i} = computeNumber(${i});`);
  }
  cloneLines.push('    callIntermediateLogging();');
  for (let i = 0; i < 7; i++) {
    cloneLines.push(`    const value_${i} = computeNumber(${i});`);
  }
  const cloneCode = cloneLines.join('\n');
  const cloneBlocksRust = nativeCore.detectCloneBlocks(cloneCode, 6);
  const cloneBlocksShim = shim.detectCloneBlocks(cloneCode, 6);
  assert.strictEqual(cloneBlocksRust.length, cloneBlocksShim.length);
  for (let i = 0; i < cloneBlocksRust.length; i++) {
    assert.strictEqual(cloneBlocksRust[i].startLine, cloneBlocksShim[i].startLine);
    assert.strictEqual(cloneBlocksRust[i].originalLine, cloneBlocksShim[i].originalLine);
    assert.strictEqual(cloneBlocksRust[i].lineSpan, cloneBlocksShim[i].lineSpan);
  }
  console.log('  ✓ Intra-file clone block detection 100% equivalent.');

  // MinHash signature & LSH similarity pair detection
  const fileA = 'function calcA() {\n  const x = 10;\n  const y = 20;\n  return x + y;\n}\n';
  const fileB = 'function calcA() {\n  const x = 10;\n  const y = 20;\n  return x + y;\n}\n';
  const fileC = 'function unrelatedService() {\n  const name = "user";\n  console.log(name);\n}\n';

  const sigRustA = nativeCore.computeMinHash(fileA, 64);
  const sigShimA = shim.computeMinHash(fileA, 64);
  assert.strictEqual(sigRustA.length, 64);
  assert.strictEqual(sigShimA.length, 64);
  for (let i = 0; i < 64; i++) {
    assert.strictEqual(sigRustA[i], sigShimA[i], `MinHash signature mismatch at index ${i}`);
  }

  const sigRustB = nativeCore.computeMinHash(fileB, 64);
  const sigRustC = nativeCore.computeMinHash(fileC, 64);
  const sigShimB = shim.computeMinHash(fileB, 64);
  const sigShimC = shim.computeMinHash(fileC, 64);

  const pairsRust = nativeCore.findClonePairs([sigRustA, sigRustB, sigRustC], 0.7);
  const pairsShim = shim.findClonePairs([sigShimA, sigShimB, sigShimC], 0.7);
  assert.strictEqual(pairsRust.length, pairsShim.length);
  for (let i = 0; i < pairsRust.length; i++) {
    assert.strictEqual(pairsRust[i].fileA, pairsShim[i].fileA);
    assert.strictEqual(pairsRust[i].fileB, pairsShim[i].fileB);
    assert.strictEqual(pairsRust[i].similarity, pairsShim[i].similarity);
  }
  console.log('  ✓ MinHash signature generation & LSH clone pair detection 100% equivalent.');

  // 6. Parity of Dominator Tree and Dataflow Fixed-Point Solver
  console.log('[Dominator & Dataflow] Verifying dominator tree and dataflow solver parity...');

  // Diamond CFG
  const diamondEdges = [
    ['Entry', 'A'],
    ['Entry', 'B'],
    ['A', 'Merge'],
    ['B', 'Merge'],
  ];
  const domDiamondRust = nativeCore.computeDominatorTree('Entry', [], diamondEdges);
  const domDiamondShim = shim.computeDominatorTree('Entry', [], diamondEdges);
  assert.deepStrictEqual(domDiamondRust.idom, domDiamondShim.idom, 'Diamond idom parity');
  assert.deepStrictEqual(
    domDiamondRust.dominanceFrontiers,
    domDiamondShim.dominanceFrontiers,
    'Diamond DF parity',
  );
  assert.deepStrictEqual(domDiamondRust.loopHeaders, domDiamondShim.loopHeaders);
  assert.deepStrictEqual(domDiamondRust.backEdges, domDiamondShim.backEdges);

  // Loop CFG with back-edges
  const loopEdges = [
    ['Header', 'Body'],
    ['Body', 'Latch'],
    ['Latch', 'Header'],
    ['Latch', 'Exit'],
  ];
  const domLoopRust = nativeCore.computeDominatorTree('Header', [], loopEdges);
  const domLoopShim = shim.computeDominatorTree('Header', [], loopEdges);
  assert.deepStrictEqual(domLoopRust.idom, domLoopShim.idom, 'Loop idom parity');
  assert.deepStrictEqual(domLoopRust.dominanceFrontiers, domLoopShim.dominanceFrontiers, 'Loop DF parity');
  assert.deepStrictEqual(domLoopRust.loopHeaders, domLoopShim.loopHeaders, 'Loop headers parity');
  assert.deepStrictEqual(domLoopRust.backEdges, domLoopShim.backEdges, 'Back edges parity');
  assert.strictEqual(domLoopRust.loopHeaders.includes('Header'), true);

  // Dataflow fixed point solver parity
  const flowEdges = [
    ['N0', 'N1'],
    ['N1', 'N2'],
    ['N2', 'N3'],
  ];
  const genMap = {
    N0: ['def_a'],
    N1: ['def_b'],
    N2: ['def_c'],
  };
  const killMap = {
    N2: ['def_a'],
  };
  const flowRust = nativeCore.solveDataflow({
    entry: 'N0',
    edges: flowEdges,
    forward: true,
    gen: genMap,
    kill: killMap,
  });
  const flowShim = shim.solveDataflow({
    entry: 'N0',
    edges: flowEdges,
    forward: true,
    gen: genMap,
    kill: killMap,
  });
  assert.deepStrictEqual(flowRust.inSets, flowShim.inSets, 'Dataflow In-sets parity');
  assert.deepStrictEqual(flowRust.outSets, flowShim.outSets, 'Dataflow Out-sets parity');
  console.log('  ✓ Dominator tree and Dataflow solver 100% equivalent.');

  // 7. Parity of Multi-Pattern Match Operator
  console.log('[Pattern Match] Verifying fast multi-pattern matching parity...');
  const patternCorpus = [
    'const API_KEY = "sk-1234567890abcdef"; // secret key',
    'let token = "TOKEN_XYZ"; // another secret token',
    'function authenticate(apiKey, tokenVal) {',
    '  if (apiKey === API_KEY) return true;',
    '  return tokenVal === token;',
    '}',
  ].join('\n');
  const searchPatterns = ['API_KEY', 'token', 'secret', 'authenticate', 'not_found'];
  const matchesRust = nativeCore.fastPatternMatch(patternCorpus, searchPatterns);
  const matchesShim = shim.fastPatternMatch(patternCorpus, searchPatterns);
  assert.strictEqual(matchesRust.length, matchesShim.length, 'Pattern matches count mismatch');
  for (let i = 0; i < matchesRust.length; i++) {
    assert.strictEqual(matchesRust[i].pattern, matchesShim[i].pattern);
    assert.strictEqual(matchesRust[i].line, matchesShim[i].line);
    assert.strictEqual(matchesRust[i].column, matchesShim[i].column);
    assert.strictEqual(matchesRust[i].matchText, matchesShim[i].matchText);
  }
  console.log('  ✓ Multi-pattern matching 100% equivalent.');

  // 8. Fuzzing & Mutation Stream Stress Parity
  console.log('[Fuzzing & Mutation] Running 40 deterministic mutation fuzzing rounds...');
  let seed = 123456789;
  function pseudoRandom() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  const fuzzTokens = [
    '// line comment',
    '/* block comment */',
    '/* unclosed block',
    '# python/ps comment',
    '<# ps block #>',
    '\"double quote string with \\\"escaped\\\"\"',
    '\'single quote with \\\'escaped\\\'\'',
    '`template ${val} literal`',
    '/regex_pattern[0-9]+/gi',
    ' / not_regex / 2;',
    '你好，世界！',
    '🚀 Antigravity ✨',
    'const x = 100;',
    'function f() { return 1; }',
    '\n',
    '\r\n',
    '\t',
    '    ',
  ];

  const presetsToTest = [
    SOURCE_MASK_PRESETS[MASK_LANGUAGE_TYPESCRIPT],
    SOURCE_MASK_PRESETS[MASK_LANGUAGE_PYTHON],
    SOURCE_MASK_PRESETS[MASK_LANGUAGE_GDSCRIPT],
    SOURCE_MASK_PRESETS[MASK_LANGUAGE_RUST],
    SOURCE_MASK_PRESETS[MASK_LANGUAGE_POWERSHELL],
  ];

  for (let round = 0; round < 40; round++) {
    const numTokens = 5 + Math.floor(pseudoRandom() * 15);
    const chosenTokens = [];
    for (let t = 0; t < numTokens; t++) {
      const idx = Math.floor(pseudoRandom() * fuzzTokens.length);
      chosenTokens.push(fuzzTokens[idx]);
    }
    const fuzzSource = chosenTokens.join(pseudoRandom() > 0.5 ? '\n' : ' ');
    const preset = presetsToTest[round % presetsToTest.length];
    const config = toNativeConfig(preset);

    const fRust = nativeCore.maskSourceCode(fuzzSource, config);
    const fShim = shim.maskSourceCode(fuzzSource, config);

    assert.strictEqual(fRust.lines, fShim.lines, `Fuzz round ${round} lines mismatch`);
    assert.strictEqual(fRust.nonBlankLines, fShim.nonBlankLines, `Fuzz round ${round} nonBlankLines mismatch`);
    assert.strictEqual(fRust.masked.length, fShim.masked.length, `Fuzz round ${round} masked length mismatch`);
    for (let li = 0; li < fRust.masked.length; li++) {
      if (fRust.masked[li] !== fShim.masked[li]) {
        assert.fail(
          `Fuzz round ${round} line ${li} drift:\nRust: "${fRust.masked[li]}"\nShim: "${fShim.masked[li]}"`,
        );
      }
    }
  }
  console.log('  ✓ 40 rounds of deterministic mutation fuzzing achieved 100% byte equivalence.');

  // 9. Random Directed Graph Equivalence
  console.log('[Random Graph] Verifying random DAG and cyclic graph SCC parity...');
  for (let g = 0; g < 5; g++) {
    const nodeCount = 10 + g * 2;
    const randomEdges = [];
    for (let e = 0; e < nodeCount * 2; e++) {
      const u = `Node_${Math.floor(pseudoRandom() * nodeCount)}`;
      const v = `Node_${Math.floor(pseudoRandom() * nodeCount)}`;
      randomEdges.push([u, v]);
    }
    const rG_Rust = nativeCore.analyzeDependencyGraph(randomEdges);
    const rG_Shim = shim.analyzeDependencyGraph(randomEdges);
    assert.strictEqual(rG_Rust.isAcyclic, rG_Shim.isAcyclic, `Graph ${g} isAcyclic parity`);
    assert.strictEqual(
      rG_Rust.stronglyConnectedComponents.length,
      rG_Shim.stronglyConnectedComponents.length,
      `Graph ${g} SCC count parity`,
    );
  }
  console.log('  ✓ Random graph topology analysis parity verified.');

  console.log('=== [Native Operator Validation] SUCCESS: All assertions passed. ===');
}

try {
  runValidation();
} catch (err) {
  console.error('[Native Operator Validation FAILED]:', err);
  process.exit(1);
}
