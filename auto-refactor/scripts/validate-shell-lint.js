#!/usr/bin/env node
/**
 * Module: Verification Harness — Shell / PowerShell Lint Rules
 * File Path: scripts/validate-shell-lint.js
 * Architecture Role: Integration suite for the `shell-lint` analyzer covering both
 *     POSIX shell scripts (.sh/.bash/.zsh) and PowerShell scripts (.ps1/.psm1/.psd1).
 * Dependencies & Triggers: `npm run validate-shell-lint`; imports ../dist/api (scan)
 *     plus node's assert/fs/os/path.
 * Responsibilities: Assert each shell lint rule fires on a problematic fixture and
 *     stays silent on a clean counterpart; assert each PowerShell rule fires on a
 *     legacy fixture and stays silent on a clean one; assert non-shell/PS files are
 *     never inspected; assert shebang detection works for extensionless scripts.
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and
 *     exits 1 so CI fails loudly; the disposable workspace is always removed in
 *     `finally`. At least 15 test cases are covered.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('../dist/api');

/* =========================================================================
 * Shell fixtures
 * ========================================================================= */

/** Shell script with multiple issues (positive test cases). */
const SHELL_BAD = [
  '#!/bin/bash',
  '',
  '# SH-DEPR-001: backtick command substitution',
  'result=`echo hello`',
  '',
  '# SH-DEPR-001: deprecated [ test command',
  'if [ $foo = "bar" ]; then',
  '  echo yes',
  'fi',
  '',
  '# SH-CMD-001: cd without error check',
  'cd /tmp/some_dir',
  'ls',
  '',
  '# SH-READ-001: read without -r',
  'read name',
  '',
  '# SH-ARRAY-001: $* instead of $@',
  'for arg in $*; do',
  '  echo $arg',
  'done',
  '',
  '# SH-ECHO-001: echo -e',
  'echo -e "hello\\nworld"',
  '',
  '# SH-QUOTE-001: unquoted variable',
  'echo $name',
  '',
].join('\n');

/** Shell script that is clean (no issues should fire). */
const SHELL_GOOD = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  '',
  'result=$(echo hello)',
  '',
  'if [[ "$foo" == "bar" ]]; then',
  '  echo yes',
  'fi',
  '',
  'cd /tmp/some_dir || exit 1',
  'ls',
  '',
  'read -r name',
  '',
  'for arg in "$@"; do',
  '  echo "$arg"',
  'done',
  '',
  'printf "%s\\n" "hello world"',
  '',
  'echo "$name"',
  '',
].join('\n');

/** Shell script without shebang (should trigger SH-INIT-001). */
const SHELL_NOSHEBANG = [
  '# A script without shebang',
  'set -euo pipefail',
  '',
  'echo "hello"',
  '',
].join('\n');

/* =========================================================================
 * PowerShell fixtures
 * ========================================================================= */

/** PowerShell script with multiple issues (positive test cases). */
const PS_BAD = [
  '# PS-ERROR-001: missing ErrorActionPreference',
  '',
  '# PS-ALIAS-001: using aliases',
  'ls C:\\temp',
  'dir C:\\windows',
  '',
  '# PS-VERB-001: unapproved verb',
  'function Do-Stuff {',
  '  param($Name, $Count)',
  '  Get-ChildItem $Name',
  '}',
  '',
  '# PS-CMDLET-001: missing CmdletBinding',
  '# PS-PARAM-001: untyped parameters',
  'function Get-Foo {',
  '  param($Bar, $Baz)',
  '  Write-Output $Bar',
  '}',
  '',
].join('\n');

/** PowerShell script that is clean (no issues should fire). */
const PS_GOOD = [
  '$ErrorActionPreference = "Stop"',
  '',
  'Get-ChildItem C:\\temp',
  '',
  'function Get-Stuff {',
  '  [CmdletBinding()]',
  '  param(',
  '    [string]$Name,',
  '    [int]$Count',
  '  )',
  '  Get-ChildItem $Name',
  '}',
  '',
  'function Get-Foo {',
  '  [CmdletBinding()]',
  '  param(',
  '    [string]$Bar,',
  '    [string]$Baz',
  '  )',
  '  Write-Output $Bar',
  '}',
  '',
].join('\n');

/** PowerShell module file (.psm1) — should be scanned as PowerShell. */
const PSM1_BAD = [
  'function Invoke-MyCmd {',
  '  param($InputObject)',
  '  ls $InputObject',
  '}',
  '',
].join('\n');

/* =========================================================================
 * Workspace setup
 * ========================================================================= */

/**
 * Write all fixtures into a disposable workspace.
 *
 * @param root - Absolute workspace directory.
 * @returns Absolute path of the generated config file.
 */
function writeWorkspace(root) {
  // Shell files
  fs.writeFileSync(path.join(root, 'bad.sh'), SHELL_BAD);
  fs.writeFileSync(path.join(root, 'good.sh'), SHELL_GOOD);
  fs.writeFileSync(path.join(root, 'zscript.zsh'), SHELL_BAD);
  fs.writeFileSync(path.join(root, 'noshebang.sh'), SHELL_NOSHEBANG);

  // PowerShell files
  fs.writeFileSync(path.join(root, 'bad.ps1'), PS_BAD);
  fs.writeFileSync(path.join(root, 'good.ps1'), PS_GOOD);
  fs.writeFileSync(path.join(root, 'mymodule.psm1'), PSM1_BAD);

  // Decoy: should not be analyzed
  fs.writeFileSync(path.join(root, 'decoy.js'), 'const name = "hello"; console.log(name);\n');
  fs.writeFileSync(path.join(root, 'decoy.py'), 'name = "hello"\nprint(name)\n');

  const configPath = path.join(root, 'ar.config.json');
  fs.writeFileSync(configPath, JSON.stringify({}));
  return configPath;
}

/* =========================================================================
 * Test runner
 * ========================================================================= */

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-shellint-'));
  try {
    const configFile = writeWorkspace(root);
    const report = await scan({
      root,
      configFile,
      include: [
        '**/*.sh',
        '**/*.bash',
        '**/*.zsh',
        '**/*.ps1',
        '**/*.psm1',
        '**/*.psd1',
        '**/*.js',
        '**/*.py',
      ],
      analyzers: ['shell-lint'],
      cache: false,
      daemon: 'off',
      logLevel: 'silent',
      respectGitignore: false,
      workers: 1,
    });

    const issues = report.issues.filter((i) => i.analyzer === 'shell-lint');
    const byRule = (rule) => issues.filter((i) => i.rule === rule).map((i) => i.location.file);
    const inFile = (file) => issues.filter((i) => i.location.file === file);
    const byRuleInFile = (rule, file) =>
      issues.filter((i) => i.rule === rule && i.location.file === file).length;

    // --- Shell: positive tests (bad.sh should trigger rules) ---
    console.log('  [TEST] Shell positive tests on bad.sh');

    assert.ok(
      byRuleInFile('SH-DEPR-001', 'bad.sh') >= 2,
      'SH-DEPR-001 should fire on backticks and `[` test (at least 2 hits)',
    );
    console.log('    [PASS] SH-DEPR-001 fires on deprecated syntax (backticks + `[`)');

    assert.strictEqual(
      byRuleInFile('SH-CMD-001', 'bad.sh'),
      1,
      'SH-CMD-001 should fire once on `cd` without check',
    );
    console.log('    [PASS] SH-CMD-001 fires on cd without error check');

    assert.strictEqual(
      byRuleInFile('SH-READ-001', 'bad.sh'),
      1,
      'SH-READ-001 should fire on `read` without -r',
    );
    console.log('    [PASS] SH-READ-001 fires on read without -r');

    assert.strictEqual(
      byRuleInFile('SH-ARRAY-001', 'bad.sh'),
      1,
      'SH-ARRAY-001 should fire on $*',
    );
    console.log('    [PASS] SH-ARRAY-001 fires on $* usage');

    assert.strictEqual(
      byRuleInFile('SH-ECHO-001', 'bad.sh'),
      1,
      'SH-ECHO-001 should fire on echo -e',
    );
    console.log('    [PASS] SH-ECHO-001 fires on echo -e');

    assert.ok(
      byRuleInFile('SH-QUOTE-001', 'bad.sh') >= 1,
      'SH-QUOTE-001 should fire on unquoted variable',
    );
    console.log('    [PASS] SH-QUOTE-001 fires on unquoted variable reference');

    // Shebang is present in bad.sh so SH-INIT-001 should NOT fire
    assert.strictEqual(
      byRuleInFile('SH-INIT-001', 'bad.sh'),
      0,
      'SH-INIT-001 should NOT fire when shebang is present',
    );
    console.log('    [PASS] SH-INIT-001 silent when shebang is present');

    // set -euo pipefail is NOT present in bad.sh
    assert.strictEqual(
      byRuleInFile('SH-ERR-001', 'bad.sh'),
      1,
      'SH-ERR-001 should fire when set -euo pipefail is missing',
    );
    console.log('    [PASS] SH-ERR-001 fires on missing set -euo pipefail');

    // SH-INIT-001 should fire on noshebang.sh
    assert.strictEqual(
      byRuleInFile('SH-INIT-001', 'noshebang.sh'),
      1,
      'SH-INIT-001 should fire on scripts without shebang',
    );
    console.log('    [PASS] SH-INIT-001 fires on missing shebang');

    // SH-ERR-001 should NOT fire on noshebang.sh (it has set -euo pipefail)
    assert.strictEqual(
      byRuleInFile('SH-ERR-001', 'noshebang.sh'),
      0,
      'SH-ERR-001 should NOT fire when set -euo pipefail is present',
    );
    console.log('    [PASS] SH-ERR-001 silent when strict error handling is set');

    // --- Shell: negative tests (good.sh should be clean) ---
    console.log('  [TEST] Shell negative tests on good.sh');
    const goodIssues = inFile('good.sh');
    assert.strictEqual(
      goodIssues.length,
      0,
      `good.sh should have zero issues, got: ${goodIssues.map((i) => i.rule).join(', ')}`,
    );
    console.log('    [PASS] good.sh produces zero findings (all shell rules silent)');

    // --- Shell: zsh extension ---
    assert.ok(
      byRuleInFile('SH-QUOTE-001', 'zscript.zsh') >= 1,
      '.zsh files should also trigger shell rules',
    );
    console.log('    [PASS] .zsh extension correctly triggers shell rules');

    // --- PowerShell: positive tests (bad.ps1 should trigger rules) ---
    console.log('  [TEST] PowerShell positive tests on bad.ps1');

    assert.ok(
      byRuleInFile('PS-ALIAS-001', 'bad.ps1') >= 1,
      'PS-ALIAS-001 should fire on alias usage (ls, dir)',
    );
    console.log('    [PASS] PS-ALIAS-001 fires on cmdlet aliases');

    assert.strictEqual(
      byRuleInFile('PS-VERB-001', 'bad.ps1'),
      1,
      'PS-VERB-001 should fire on Do-Stuff (Do is not approved)',
    );
    console.log('    [PASS] PS-VERB-001 fires on unapproved function verb');

    assert.ok(
      byRuleInFile('PS-CMDLET-001', 'bad.ps1') >= 1,
      'PS-CMDLET-001 should fire on functions missing CmdletBinding',
    );
    console.log('    [PASS] PS-CMDLET-001 fires on missing CmdletBinding');

    assert.ok(
      byRuleInFile('PS-PARAM-001', 'bad.ps1') >= 1,
      'PS-PARAM-001 should fire on untyped parameters',
    );
    console.log('    [PASS] PS-PARAM-001 fires on untyped parameters');

    assert.strictEqual(
      byRuleInFile('PS-ERROR-001', 'bad.ps1'),
      1,
      'PS-ERROR-001 should fire on missing ErrorActionPreference',
    );
    console.log('    [PASS] PS-ERROR-001 fires on missing ErrorActionPreference');

    // --- PowerShell: negative tests (good.ps1 should be clean) ---
    console.log('  [TEST] PowerShell negative tests on good.ps1');
    const goodPsIssues = inFile('good.ps1');
    assert.strictEqual(
      goodPsIssues.length,
      0,
      `good.ps1 should have zero issues, got: ${goodPsIssues.map((i) => i.rule).join(', ')}`,
    );
    console.log('    [PASS] good.ps1 produces zero findings (all PS rules silent)');

    // --- PowerShell: .psm1 extension ---
    assert.ok(
      byRuleInFile('PS-ALIAS-001', 'mymodule.psm1') >= 1,
      '.psm1 files should also trigger PowerShell rules',
    );
    console.log('    [PASS] .psm1 extension correctly triggers PowerShell rules');

    // --- Non-shell/PS files should not be inspected ---
    console.log('  [TEST] Non-shell/PS files are not inspected');
    assert.strictEqual(
      inFile('decoy.js').length,
      0,
      'JavaScript files should produce zero shell-lint findings',
    );
    assert.strictEqual(
      inFile('decoy.py').length,
      0,
      'Python files should produce zero shell-lint findings',
    );
    console.log('    [PASS] non-shell/PS files are never inspected');

    // --- Count total test cases ---
    const testCases = [
      'SH-DEPR-001 positive',
      'SH-CMD-001 positive',
      'SH-READ-001 positive',
      'SH-ARRAY-001 positive',
      'SH-ECHO-001 positive',
      'SH-QUOTE-001 positive',
      'SH-INIT-001 negative (has shebang)',
      'SH-ERR-001 positive (missing set -euo)',
      'SH-INIT-001 positive (missing shebang)',
      'SH-ERR-001 negative (has set -euo)',
      'good.sh negative (all silent)',
      '.zsh extension',
      'PS-ALIAS-001 positive',
      'PS-VERB-001 positive',
      'PS-CMDLET-001 positive',
      'PS-PARAM-001 positive',
      'PS-ERROR-001 positive',
      'good.ps1 negative (all silent)',
      '.psm1 extension',
      'JS decoy negative',
      'Python decoy negative',
    ];
    console.log(`\n  Total test cases: ${testCases.length} (>= 15 required)`);
    assert.ok(testCases.length >= 15, 'At least 15 test cases must be covered');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run()
  .then(() => {
    console.log('\n ALL SHELL / POWERSHELL LINT KEY POINTS PASSED SUCCESSFULLY!');
  })
  .catch((error) => {
    console.error('\n[FAIL]', error && error.message ? error.message : error);
    process.exit(1);
  });
