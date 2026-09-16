#!/usr/bin/env node
/**
 * Module: Verification Harness — Unsupported-Language Fail-Closed Contract
 * File Path: scripts/validate-language-support.js
 * Architecture Role: Integration suite over the built scanner stack that locks the
 *     LANG-UNSUPPORTED guard for extensions no language adapter can parse
 * Dependencies & Triggers: `npm run validate-language-support` (part of `npm test`); imports
 *     ../dist/api (scan, resolveConfig) plus node's assert/fs/os/path
 * Responsibilities: Assert the engine defaults to fail-closed; assert 'warning'/'off' cascade
 *     through both resolveConfig and scan; assert the diagnostic reaches the report in
 *     in-process and worker modes; assert supported extensions stay untouched; assert cache
 *     keys invalidate when the severity changes; assert both execution paths stay wired
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1 so CI
 *     fails loudly; the disposable temp workspace is always removed in `finally`. The guard is
 *     asserted in both execution modes because a fail-open regression on the worker path alone
 *     would still silently understate results — the exact defect this rule exists to prevent.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan, resolveConfig } = require('../dist/api');
const { EXTENSION_ADAPTER_IDS } = require('../dist/core/adapters');
const { TypeScriptAdapter } = require('../dist/core/typescriptAdapter');
const { RustAdapter } = require('../dist/core/rustAdapter');
const { OxcAdapter } = require('../dist/core/oxcAdapter');
const { GDScriptAdapter } = require('../dist/core/gdscriptAdapter');
const { PythonAdapter } = require('../dist/core/pythonAdapter');
const { MarkdownAdapter } = require('../dist/core/markdownAdapter');

const RULE = 'LANG-UNSUPPORTED';

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
 * Filter a scan report down to the fail-closed guard diagnostics.
 *
 * @param report - Report returned by `scan`.
 * @returns The LANG-UNSUPPORTED issues, in report order.
 */
function guardIssues(report) {
  return report.issues.filter((issue) => issue.rule === RULE);
}

/**
 * Adapter classes by registry id, used to assert the extension index against the adapters
 * themselves: the index is what keeps a scan from constructing every adapter (and loading every
 * parser) just to resolve one extension, so drift between the two would silently mis-resolve a
 * language.
 */
const ADAPTER_CLASSES = {
  typescript: TypeScriptAdapter,
  rust: RustAdapter,
  oxc: OxcAdapter,
  gdscript: GDScriptAdapter,
  python: PythonAdapter,
  markdown: MarkdownAdapter,
};

/**
 * Assert that the extension index and the adapters' declared extensions describe one mapping.
 *
 * @returns Nothing; throws when an extension is missing from the index, mapped to the wrong
 *   adapter, or listed for an adapter that does not claim it.
 */
function assertExtensionIndexMatchesAdapters() {
  for (const [id, AdapterClass] of Object.entries(ADAPTER_CLASSES)) {
    for (const extension of new AdapterClass().extensions) {
      // Every declared extension must be indexed, and the indexed adapter must claim it. The
      // TS/JS family intentionally resolves to `typescript` even though the oxc adapter declares
      // the same six extensions: that is the historical default-parser behaviour, and `parser:
      // 'oxc'` overrides it before the index is consulted.
      const indexed = EXTENSION_ADAPTER_IDS[extension];
      assert.ok(indexed, `every declared extension must be indexed: ${extension} (${id})`);
      assert.ok(
        new ADAPTER_CLASSES[indexed]().extensions.includes(extension),
        `extension index maps ${extension} to ${indexed}, which must declare it`,
      );
    }
  }
  for (const [extension, id] of Object.entries(EXTENSION_ADAPTER_IDS)) {
    assert.ok(ADAPTER_CLASSES[id], `extension index names an unknown adapter id: ${id}`);
    assert.ok(
      new ADAPTER_CLASSES[id]().extensions.includes(extension),
      `${id} must declare the indexed extension ${extension}`,
    );
  }
  console.log('  [PASS] extension index matches every adapter declared extensions');
}

async function run() {
  assertExtensionIndexMatchesAdapters();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-lang-'));
  const cacheDir = path.join(root, '.cache');
  try {
    writeFiles(root, {
      'a.ps1': 'Write-Output "hello"\n',
      'probe.py': 'print("hello")\n',
      'b.ts': 'export const value: number = 1;\n',
      'c.gd': 'extends RefCounted\n',
      'w1.ps1': 'Write-Output "w1"\n',
      'w2.ps1': 'Write-Output "w2"\n',
      'w3.ps1': 'Write-Output "w3"\n',
      'w4.ps1': 'Write-Output "w4"\n',
      'probe-enable-python-modern.json': JSON.stringify({
        analyzers: { 'python-modern': { enabled: true } },
      }),
    });

    const defaults = resolveConfig({ root });
    assert.strictEqual(
      defaults.unsupportedLanguage,
      'error',
      'default must be fail-closed (error)',
    );
    console.log('  [PASS] default severity is error (fail-closed)');

    const base = {
      root,
      cache: false,
      daemon: 'off',
      logLevel: 'silent',
      respectGitignore: false,
    };

    const inProcess = await scan({
      ...base,
      include: ['a.ps1', 'probe.py', 'b.ts', 'c.gd'],
      workers: 1,
    });
    const first = guardIssues(inProcess);
    assert.strictEqual(first.length, 1, 'exactly one unsupported file must be reported');
    assert.strictEqual(first[0].location.file, 'a.ps1');
    assert.strictEqual(first[0].severity, 'error');
    assert.strictEqual(first[0].analyzer, 'language');
    assert.ok(
      !guardIssues(inProcess).some((i) => /\.(py|ts|gd)$/.test(i.location.file)),
      'adapter-claimed extensions (.py/.ts/.gd) must never raise the guard',
    );
    console.log('  [PASS] in-process scan flags .ps1 and leaves .py/.ts/.gd untouched');

    const warned = await scan({
      ...base,
      include: ['a.ps1'],
      workers: 1,
      unsupportedLanguage: 'warning',
    });
    assert.deepStrictEqual(
      guardIssues(warned).map((i) => i.severity),
      ['warning'],
    );
    console.log("  [PASS] unsupportedLanguage='warning' lowers the severity");

    const disabled = await scan({
      ...base,
      include: ['a.ps1'],
      workers: 1,
      unsupportedLanguage: 'off',
    });
    assert.strictEqual(guardIssues(disabled).length, 0);
    console.log("  [PASS] unsupportedLanguage='off' restores the silent fallback");

    const workerMode = await scan({
      ...base,
      include: ['**/w*.ps1'],
      workers: 2,
    });
    assert.strictEqual(
      guardIssues(workerMode).length,
      4,
      'worker mode must report every unsupported file',
    );
    console.log('  [PASS] worker mode reports all four unsupported files');

    const cachedOn = await scan({
      ...base,
      include: ['**/a.ps1'],
      workers: 1,
      cache: true,
      cacheDir,
    });
    assert.strictEqual(guardIssues(cachedOn).length, 1, 'cold cache must still flag the file');
    const cachedOff = await scan({
      ...base,
      include: ['**/a.ps1'],
      workers: 1,
      cache: true,
      cacheDir,
      unsupportedLanguage: 'off',
    });
    assert.strictEqual(
      guardIssues(cachedOff).length,
      0,
      'severity change must invalidate the cached guard issue',
    );
    console.log('  [PASS] cache fingerprint invalidates when the severity changes');

    for (const modulePath of ['../dist/core/analyzer.js', '../dist/core/worker.js']) {
      const source = fs.readFileSync(path.join(__dirname, modulePath), 'utf8');
      assert.ok(
        source.includes('unsupportedLanguageDiagnostic'),
        modulePath + ' must stay wired to the fail-closed guard',
      );
    }
    console.log('  [PASS] both execution paths remain wired to the guard');

    // Coverage diagnostics: a specialized analyzer that never ran must not look like a clean
    // result. A Python-scoped scan with the Python pack off must name the skipped analyzer and
    // explain the gap; enabling the pack clears both signals.
    const defaultPy = await scan({
      root,
      cacheDir,
      include: ['**/*.py'],
      logLevel: 'silent',
    });
    assert.ok(
      (defaultPy.summary.disabledAnalyzers || []).includes('python-modern'),
      'a disabled built-in analyzer must be listed in the summary',
    );
    assert.ok(
      (defaultPy.summary.warnings || []).some((w) => w.includes('python-modern')),
      'scanning Python with the Python pack disabled must raise a coverage note',
    );
    const enabledPy = await scan({
      root,
      cacheDir,
      include: ['**/*.py'],
      configFile: path.join(root, 'probe-enable-python-modern.json'),
      logLevel: 'silent',
    });
    assert.ok(
      !(enabledPy.summary.disabledAnalyzers || []).includes('python-modern'),
      'enabling the analyzer removes it from the disabled list',
    );
    assert.ok(
      !(enabledPy.summary.warnings || []).some((w) => w.includes('python-modern')),
      'the coverage note disappears once the pack runs',
    );
    console.log('  [PASS] disabled analyzers are reported, never silently skipped');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run()
  .then(() => {
    console.log('\n ALL UNSUPPORTED-LANGUAGE FAIL-CLOSED CHECKS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
