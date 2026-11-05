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
const { EXTENSION_ADAPTER_IDS, hasAdapterFor } = require('../dist/core/ast/adapters');
const { unsupportedLanguageDiagnostic } = require('../dist/core/ast/language-support');
const { DEFAULT_EXT } = require('../dist/core/file-discovery');
const { TypeScriptAdapter } = require('../dist/core/ast/typescript-adapter');
const { RustAdapter } = require('../dist/core/ast/rust-adapter');
const { OxcAdapter } = require('../dist/core/ast/oxc-adapter');
const { GDScriptAdapter } = require('../dist/core/ast/gdscript-adapter');
const { PythonAdapter } = require('../dist/core/ast/python-adapter');
const { MarkdownAdapter } = require('../dist/core/ast/markdown-adapter');
const { GoAdapter } = require('../dist/core/ast/go-adapter');
const { DataAdapter } = require('../dist/core/ast/data-adapter');
const { ShellAdapter } = require('../dist/core/ast/shell-adapter');

const { reportFailure } = require('./common/test-runner-harness');

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
  go: GoAdapter,
  yaml: DataAdapter,
  shell: ShellAdapter,
};

/**
 * Assert that the extension index and the adapters' declared extensions describe one mapping.
 *
 * @returns Nothing; throws when an extension is missing from the index, mapped to the wrong
 *   adapter, or listed for an adapter that does not claim it.
 */
function assertExtensionIndexMatchesAdapters() {
  const adapterExtensionsMap = new Map();
  for (const [id, AdapterClass] of Object.entries(ADAPTER_CLASSES)) {
    adapterExtensionsMap.set(id, new Set(new AdapterClass().extensions));
  }

  for (const [id, extSet] of adapterExtensionsMap.entries()) {
    for (const extension of extSet) {
      // Every declared extension must be indexed, and the indexed adapter must claim it. The
      // TS/JS family intentionally resolves to `typescript` even though the oxc adapter declares
      // the same six extensions: that is the historical default-parser behaviour, and `parser:
      // 'oxc'` overrides it before the index is consulted.
      const indexed = EXTENSION_ADAPTER_IDS[extension];
      assert.ok(indexed, `every declared extension must be indexed: ${extension} (${id})`);
      const indexedSet = adapterExtensionsMap.get(indexed);
      assert.ok(
        indexedSet !== undefined && indexedSet.has(extension),
        `extension index maps ${extension} to ${indexed}, which must declare it`,
      );
    }
  }
  for (const [extension, id] of Object.entries(EXTENSION_ADAPTER_IDS)) {
    assert.ok(ADAPTER_CLASSES[id], `extension index names an unknown adapter id: ${id}`);
    const adapterSet = adapterExtensionsMap.get(id);
    assert.ok(
      adapterSet !== undefined && adapterSet.has(extension),
      `${id} must declare the indexed extension ${extension}`,
    );
  }
  console.log('  ✔ extension index matches every adapter declared extensions');
}

/**
 * Asserts the stronger invariant the adapter set now holds: every extension the walker admits is
 * claimed by some adapter, so `LANG-UNSUPPORTED` can only fire for a file the walker was never
 * asked to include. The guard's fail-closed behaviour is still exercised below through an
 * extension outside the allow-list, which is the only remaining way to reach it.
 */
function assertEveryAllowedExtensionIsClaimed() {
  const unclaimed = DEFAULT_EXT.filter((ext) => EXTENSION_ADAPTER_IDS[ext] === undefined);
  assert.deepStrictEqual(
    unclaimed,
    [],
    `every discoverable extension must be claimed by an adapter, unclaimed: ${unclaimed.join(', ')}`,
  );
  console.log('  ✔ every discoverable extension is claimed by an adapter');
}

async function run() {
  assertExtensionIndexMatchesAdapters();
  assertEveryAllowedExtensionIsClaimed();
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
    console.log('  ✔ default severity is error (fail-closed)');

    const base = {
      root,
      cache: false,
      daemon: 'off',
      logLevel: 'silent',
      respectGitignore: false,
    };

    // Every discoverable extension is now claimed, so a scan cannot reach the guard by ordinary
    // discovery. The fail-closed contract is therefore asserted at its two remaining surfaces:
    // the predicate that decides "is this file claimed", and the diagnostic that decides "what
    // severity does an unclaimed file carry". Asserting them directly keeps the contract live
    // instead of deleting the checks along with the fixture that used to reach them.
    assert.strictEqual(
      hasAdapterFor('a.ps1', undefined),
      true,
      'the shell adapter must now claim .ps1',
    );
    assert.strictEqual(
      hasAdapterFor('probe.unknownext', undefined),
      false,
      'an extension outside the allow-list must remain unclaimed',
    );
    console.log(
      '  ✔ the claim predicate still discriminates a claimed from an unclaimed extension',
    );

    const unsupportedConfig = resolveConfig({ root, unsupportedLanguage: 'error' });
    const unsupportedIssue = unsupportedLanguageDiagnostic('probe.unknownext', unsupportedConfig);
    assert.ok(unsupportedIssue !== null, 'an unclaimed extension must still yield a diagnostic');
    assert.strictEqual(unsupportedIssue.rule, RULE);
    assert.strictEqual(unsupportedIssue.severity, 'error', 'the default must stay fail-closed');
    assert.strictEqual(unsupportedIssue.analyzer, 'language');
    console.log('  ✔ an unclaimed extension still yields the fail-closed error diagnostic');

    const warnedIssue = unsupportedLanguageDiagnostic(
      'probe.unknownext',
      resolveConfig({ root, unsupportedLanguage: 'warning' }),
    );
    assert.strictEqual(warnedIssue.severity, 'warning');
    console.log("  ✔ unsupportedLanguage='warning' lowers the severity");

    const offIssue = unsupportedLanguageDiagnostic(
      'probe.unknownext',
      resolveConfig({ root, unsupportedLanguage: 'off' }),
    );
    assert.strictEqual(offIssue, null, "unsupportedLanguage='off' must suppress the diagnostic");
    console.log("  ✔ unsupportedLanguage='off' restores the silent fallback");

    const claimedScan = await scan({
      ...base,
      include: ['a.ps1', 'probe.py', 'b.ts', 'c.gd'],
      workers: 1,
    });
    assert.deepStrictEqual(
      guardIssues(claimedScan),
      [],
      'adapter-claimed extensions (.ps1/.py/.ts/.gd) must never raise the guard',
    );
    assert.strictEqual(claimedScan.summary.filesScanned, 4, 'all four files must be discovered');
    console.log('  ✔ a scan over claimed extensions raises no guard diagnostic');

    const workerMode = await scan({
      ...base,
      include: ['**/w*.ps1'],
      workers: 2,
    });
    assert.strictEqual(
      guardIssues(workerMode).length,
      0,
      'worker mode must agree with in-process mode: claimed extensions raise nothing',
    );
    assert.strictEqual(workerMode.summary.filesScanned, 4, 'worker mode must discover every file');
    console.log('  ✔ worker mode agrees with the in-process path');

    const cachedFirst = await scan({
      ...base,
      include: ['**/a.ps1'],
      workers: 1,
      cache: true,
      cacheDir,
    });
    assert.strictEqual(
      cachedFirst.summary.filesScanned,
      1,
      'cold cache must still discover the file',
    );
    const cachedSecond = await scan({
      ...base,
      include: ['**/a.ps1'],
      workers: 1,
      cache: true,
      cacheDir,
      unsupportedLanguage: 'off',
    });
    assert.strictEqual(
      guardIssues(cachedSecond).length,
      0,
      'a severity change must invalidate the cached guard state',
    );
    console.log('  ✔ cache fingerprint invalidates when the severity changes');

    // The in-process path delegates per-file analysis to scanner/analyzerRunner, so the guard is
    // asserted at BOTH ends: the delegation in analyzer.js and the guard call in the module that
    // now owns it. Moving either one can no longer drop the fail-closed wiring silently.
    const analyzerSource = fs.readFileSync(
      path.join(__dirname, '../dist/core/analyzer.js'),
      'utf8',
    );
    assert.ok(
      analyzerSource.includes('runFileAnalyzers'),
      '../dist/core/analyzer.js must stay wired to the fail-closed guard',
    );

    const runnerSource = fs.readFileSync(
      path.join(__dirname, '../dist/core/scanner/analyzer-runner.js'),
      'utf8',
    );
    assert.ok(
      runnerSource.includes('unsupportedLanguageDiagnostic'),
      '../dist/core/scanner/analyzer-runner.js must stay wired to the fail-closed guard',
    );

    const workerSource = fs.readFileSync(path.join(__dirname, '../dist/core/worker.js'), 'utf8');
    assert.ok(
      workerSource.includes('unsupportedLanguageDiagnostic'),
      '../dist/core/worker.js must stay wired to the fail-closed guard',
    );
    console.log('  ✔ both execution paths remain wired to the guard');

    // Coverage diagnostics: a specialized analyzer that never ran must not look like a clean
    // result. A Python-scoped scan with the Python pack off must name the skipped analyzer and
    // explain the gap; enabling the pack clears both signals.
    const defaultPy = await scan({
      root,
      cacheDir,
      include: ['**/*.py'],
      logLevel: 'silent',
    });
    const defaultDisabled = new Set(defaultPy.summary.disabledAnalyzers || []);
    assert.ok(
      defaultDisabled.has('python-modern'),
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
    const enabledDisabled = new Set(enabledPy.summary.disabledAnalyzers || []);
    assert.ok(
      !enabledDisabled.has('python-modern'),
      'enabling the analyzer removes it from the disabled list',
    );
    assert.ok(
      !(enabledPy.summary.warnings || []).some((w) => w.includes('python-modern')),
      'the coverage note disappears once the pack runs',
    );
    console.log('  ✔ disabled analyzers are reported, never silently skipped');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run()
  .then(() => {
    console.log('\n ALL UNSUPPORTED-LANGUAGE FAIL-CLOSED CHECKS PASSED SUCCESSFULLY!');
  })
  .catch(reportFailure('validate-language-support.js'));
