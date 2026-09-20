/**
 * Module: Verification Harness — Python Import Extraction & Circular-Import Detection
 * File Path: scripts/validate-python-imports.js
 * Architecture Role: Key-point suite for the dependency-graph's Python branch: module-level
 *     `import a.b` / `from .pkg import name` statements become graph edges so the cycle pass
 *     covers Python packages the same way it covers TS/JS modules
 * Dependencies & Triggers: `npm run validate-python-imports` (part of `npm test`); imports
 *     ../dist/api (scanAndRender) and ../dist/core/dependencyGraph (ModuleDependencyGraph,
 *     runCyclePass)
 * Responsibilities: Assert absolute/relative/package resolution, assert third-party imports and
 *     function-local lazy imports stay out of the graph, assert docstring code samples never
 *     become edges, assert an end-to-end Python cycle is reported as import-cycle, and assert
 *     the TS/JS unused-export pass intentionally leaves Python alone
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so CI
 *     fails loudly. The lazy-import exclusion is asserted explicitly because counting indented
 *     imports would fabricate cycles that Python never has — the one regression that would make
 *     this feature actively harmful on real codebases.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanAndRender } = require('../dist/api');
const { ModuleDependencyGraph, runCyclePass } = require('../dist/core/dependency-graph');

/**
 * Write a set of fixture files into a directory tree.
 *
 * @param root - Absolute directory that receives the files.
 * @param files - Map of relative path to UTF-8 content.
 */
function writeFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const abs = path.join(root, name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/**
 * Resolve one file's import edges through the public graph API.
 *
 * @param file - Root-relative fixture path.
 * @param content - Fixture source text.
 * @returns The normalized modules that file imports.
 */
function edgesOf(file, content) {
  const graph = new ModuleDependencyGraph();
  graph.registerFromContent(file, content);
  const entry = graph.getModules().find((module) => module.file === file);
  return new Set(entry ? entry.importedModules : []);
}

/**
 * Build one Python fixture module body.
 *
 * @param symbol - Function name to declare.
 * @param importLine - Optional module-level import line placed above the function.
 * @returns Fixture source text.
 */
function moduleSource(symbol, importLine = '') {
  const head = importLine ? `${importLine}\n\n` : '';
  return `${head}def ${symbol}():\n    return 1\n`;
}

async function main() {
  // ── 1. Specifier resolution ──
  const absolute = edgesOf('app/routes/x.py', 'import app.services.bar\n');
  assert.ok(
    absolute.has('app/services/bar.py'),
    'absolute dotted import must resolve to a module file',
  );
  assert.ok(
    absolute.has('app/services/bar/__init__.py'),
    'absolute dotted import must also offer the package initializer',
  );

  const relative = edgesOf('app/routes/x.py', 'from . import local\nfrom ..utils import helper\n');
  assert.ok(relative.has('app/routes/local.py'), 'single-dot import resolves inside the package');
  assert.ok(relative.has('app/utils.py'), 'double-dot import walks up one package');
  assert.ok(
    relative.has('app/utils/helper.py'),
    'from pkg import name also offers the submodule interpretation',
  );

  const packageInit = edgesOf('app/services/__init__.py', 'from app.services import bar\n');
  assert.ok(
    packageInit.has('app/services/bar.py'),
    'package initializer import must reach the submodule file',
  );

  const external = edgesOf('app/routes/x.py', 'import os, sys\nfrom flask import Flask\n');
  assert.strictEqual(external.size, 0, 'stdlib/third-party imports never become repo edges');
  console.log('  [PASS] Python import specifiers resolve to module files and packages');

  // ── 2. Edges that must NOT exist ──
  const lazy = edgesOf(
    'app/lazy.py',
    'def handler():\n    import app.routes.x\n    from app import utils\n    return app.routes.x\n',
  );
  assert.strictEqual(lazy.size, 0, 'function-local lazy imports must not create real cycles');

  const docstring = edgesOf(
    'app/doc.py',
    '"""Example:\n\nimport app.routes.x\nfrom .legacy import thing\n"""\n\nVALUE = 1\n',
  );
  assert.strictEqual(docstring.size, 0, 'imports inside docstrings are examples, not dependencies');
  console.log('  [PASS] lazy imports and docstring samples stay out of the graph');

  // ── 3. Cycle detection through the real CLI pipeline (`scanAndRender`); the library `scan()`
  // returns raw analysis without the post-scan pipeline and is deliberately not the oracle.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-pyimports-'));
  const configPath = path.join(root, 'auto-refactor.config.json');
  const reportPath = path.join(root, 'report.json');
  const scanCli = async () => {
    const code = await scanAndRender({
      root,
      configFile: configPath,
      format: 'json',
      out: reportPath,
      logLevel: 'silent',
      cache: false,
    });
    assert.strictEqual(code, 0, `scanAndRender must succeed, exit=${code}`);
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  };
  const cyclicConfig = {
    include: ['**/*.py'],
    analyzers: {
      'dependency-graph': { enabled: true, options: { detectCycles: true } },
      comments: { enabled: false },
      governance: { enabled: false },
    },
  };
  try {
    writeFiles(root, {
      'auto-refactor.config.json': JSON.stringify(cyclicConfig, null, 2),
      'app/routes/x.py': moduleSource('route_handler', 'from app.utils import helper'),
      'app/utils.py': moduleSource('helper', 'from app.routes.x import route_handler'),
    });
    const cyclic = await scanCli();
    const cycles = cyclic.issues.filter((issue) => issue.rule === 'import-cycle');
    assert.strictEqual(cycles.length, 1, `exactly one Python cycle expected, got ${cycles.length}`);
    assert.ok(
      cycles[0].message.includes('app/routes/x.py') && cycles[0].message.includes('app/utils.py'),
      'cycle message must name both modules',
    );

    // A lazy (function-local) back-import must not fabricate a cycle.
    writeFiles(root, {
      'app/utils.py':
        'def helper():\n    from app.routes.x import route_handler\n    return route_handler\n',
    });
    const lazyReport = await scanCli();
    assert.strictEqual(
      lazyReport.issues.filter((issue) => issue.rule === 'import-cycle').length,
      0,
      'lazy imports must not create a cycle',
    );

    writeFiles(root, { 'app/utils.py': moduleSource('helper') });
    const acyclic = await scanCli();
    assert.strictEqual(
      acyclic.issues.filter((issue) => issue.rule === 'import-cycle').length,
      0,
      'an acyclic tree must stay silent',
    );
    console.log(
      '  [PASS] Python circular imports are detected end-to-end, acyclic trees stay silent',
    );

    // ── 4. Documented boundary: no unused-export pass for Python ──
    writeFiles(root, { 'app/orphan.py': moduleSource('never_imported') });
    const unusedPass = await runCyclePass(
      { fileMetrics: [{ file: 'app/orphan.py' }, { file: 'app/utils.py' }] },
      {
        root,
        analyzers: {
          'dependency-graph': {
            enabled: true,
            options: { detectCycles: true, detectUnusedExports: true },
          },
        },
      },
      { info: () => {} },
    );
    assert.strictEqual(
      unusedPass.issues.filter(
        (issue) => issue.rule === 'unused-export' || issue.rule === 'unused-module',
      ).length,
      0,
      'Python has no export keyword; the unused pass must stay TS/JS-only',
    );
    console.log('  [PASS] unused-export detection remains TS/JS-only (documented boundary)');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log('\n ALL PYTHON IMPORT EXTRACTION CHECKS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
