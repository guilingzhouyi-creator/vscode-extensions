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
  'read -r -t 10 name',
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

/**
 * Shell engineering issues fixture
 * (SH-DOC-001, SH-EOL-001, SH-EXIT-001, SH-SAFE-001, SH-SEC-001, SH-TRAP-001).
 */
const SHELL_ENG_BAD = [
  '#!/usr/bin/env bash\r',
  'set -euo pipefail\r',
  '# Over 30 lines without module metadata header\r',
  'TEMP_DIR=$(mktemp -d)\r',
  'eval "$EXTERNAL_SCRIPT"\r',
  'read interactive_name\r',
  'git diff --quiet\r',
  'line8=1\r',
  'line9=1\r',
  'line10=1\r',
  'line11=1\r',
  'line12=1\r',
  'line13=1\r',
  'line14=1\r',
  'line15=1\r',
  'line16=1\r',
  'line17=1\r',
  'line18=1\r',
  'line19=1\r',
  'line20=1\r',
  'line21=1\r',
  'line22=1\r',
  'line23=1\r',
  'line24=1\r',
  'line25=1\r',
  'line26=1\r',
  'line27=1\r',
  'line28=1\r',
  'line29=1\r',
  'line30=1\r',
  'line31=1\r',
  'echo "done"\r',
].join('\n');

/** Shell engineering clean fixture. */
const SHELL_ENG_GOOD = [
  '#!/usr/bin/env bash',
  '# Module: clean-runner',
  '# Description: Clean shell engineering fixture',
  '# Usage: ./clean-runner.sh',
  'set -euo pipefail',
  '',
  'TEMP_DIR=$(mktemp -d)',
  'trap \'rm -rf "$TEMP_DIR"\' EXIT',
  '',
  'STATUS=0; git diff --quiet || STATUS=$?',
  'read -r -t 5 safe_input',
  'CMD=("echo" "safe")',
  '"${CMD[@]}"',
  '',
].join('\n');

/** PowerShell engineering issues fixture (PS-DOC-001, PS-SAFE-001, PS-SEC-001, PS-TRAP-001). */
const PS_ENG_BAD = [
  '$ErrorActionPreference = "Stop"',
  '# Over 30 lines without help or module block',
  '$stream = [System.IO.FileStream]::new("data.bin", [System.IO.FileMode]::Open)',
  'iex "$dynamicCommand"',
  'Read-Host "Enter confirmation"',
  '$l6=1',
  '$l7=1',
  '$l8=1',
  '$l9=1',
  '$l10=1',
  '$l11=1',
  '$l12=1',
  '$l13=1',
  '$l14=1',
  '$l15=1',
  '$l16=1',
  '$l17=1',
  '$l18=1',
  '$l19=1',
  '$l20=1',
  '$l21=1',
  '$l22=1',
  '$l23=1',
  '$l24=1',
  '$l25=1',
  '$l26=1',
  '$l27=1',
  '$l28=1',
  '$l29=1',
  '$l30=1',
  '$l31=1',
  'Write-Output "done"',
].join('\r\n');

/** PowerShell engineering clean fixture. */
const PS_ENG_GOOD = [
  '<#',
  '.SYNOPSIS',
  'Clean PowerShell fixture.',
  '.DESCRIPTION',
  'Validates that engineering rules pass cleanly.',
  '#>',
  '$ErrorActionPreference = "Stop"',
  '',
  'try {',
  '  $stream = [System.IO.FileStream]::new("data.bin", [System.IO.FileMode]::Open)',
  '} finally {',
  '  if ($stream) { $stream.Dispose() }',
  '}',
  '',
  'if ([Environment]::UserInteractive -and -not [Console]::IsOutputRedirected) {',
  '  $key = Read-Host "Safe prompt"',
  '}',
  '',
  '& $cmd @params',
].join('\r\n');

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
  fs.writeFileSync(path.join(root, 'eng_bad.sh'), SHELL_ENG_BAD);
  fs.writeFileSync(path.join(root, 'eng_good.sh'), SHELL_ENG_GOOD);

  // PowerShell files
  fs.writeFileSync(path.join(root, 'bad.ps1'), PS_BAD);
  fs.writeFileSync(path.join(root, 'good.ps1'), PS_GOOD);
  fs.writeFileSync(path.join(root, 'mymodule.psm1'), PSM1_BAD);
  fs.writeFileSync(path.join(root, 'eng_bad.ps1'), PS_ENG_BAD);
  fs.writeFileSync(path.join(root, 'eng_good.ps1'), PS_ENG_GOOD);

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

    assert.strictEqual(byRuleInFile('SH-ARRAY-001', 'bad.sh'), 1, 'SH-ARRAY-001 should fire on $*');
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

    // --- Shell: Engineering rules positive tests on eng_bad.sh ---
    console.log('  [TEST] Shell engineering rules positive tests on eng_bad.sh');

    assert.strictEqual(
      byRuleInFile('SH-EOL-001', 'eng_bad.sh'),
      1,
      'SH-EOL-001 should fire on CRLF in shell script',
    );
    console.log('    [PASS] SH-EOL-001 fires on CRLF in shell script');

    assert.strictEqual(
      byRuleInFile('SH-DOC-001', 'eng_bad.sh'),
      1,
      'SH-DOC-001 should fire on script > 30 lines without module doc header',
    );
    console.log('    [PASS] SH-DOC-001 fires on missing module doc header');

    assert.strictEqual(
      byRuleInFile('SH-TRAP-001', 'eng_bad.sh'),
      1,
      'SH-TRAP-001 should fire on mktemp without EXIT trap',
    );
    console.log('    [PASS] SH-TRAP-001 fires on missing EXIT trap for mktemp');

    assert.strictEqual(
      byRuleInFile('SH-SEC-001', 'eng_bad.sh'),
      1,
      'SH-SEC-001 should fire on dynamic eval with variable expansion',
    );
    console.log('    [PASS] SH-SEC-001 fires on dynamic eval with variable');

    assert.strictEqual(
      byRuleInFile('SH-SAFE-001', 'eng_bad.sh'),
      1,
      'SH-SAFE-001 should fire on interactive read without timeout or tty guard',
    );
    console.log('    [PASS] SH-SAFE-001 fires on read without timeout or tty guard');

    assert.strictEqual(
      byRuleInFile('SH-EXIT-001', 'eng_bad.sh'),
      1,
      'SH-EXIT-001 should fire on bare git diff --quiet under set -e',
    );
    console.log('    [PASS] SH-EXIT-001 fires on bare predicate command under set -e');

    // --- Shell: Engineering rules negative tests on eng_good.sh ---
    console.log('  [TEST] Shell engineering rules negative tests on eng_good.sh');
    const engGoodShIssues = inFile('eng_good.sh');
    assert.strictEqual(
      engGoodShIssues.length,
      0,
      `eng_good.sh should have zero issues, got: ${engGoodShIssues.map((i) => i.rule).join(', ')}`,
    );
    console.log('    [PASS] eng_good.sh produces zero findings');

    // --- PowerShell: Engineering rules positive tests on eng_bad.ps1 ---
    console.log('  [TEST] PowerShell engineering rules positive tests on eng_bad.ps1');

    assert.strictEqual(
      byRuleInFile('PS-DOC-001', 'eng_bad.ps1'),
      1,
      'PS-DOC-001 should fire on script > 30 lines without doc header',
    );
    console.log('    [PASS] PS-DOC-001 fires on missing PowerShell doc header');

    assert.strictEqual(
      byRuleInFile('PS-TRAP-001', 'eng_bad.ps1'),
      1,
      'PS-TRAP-001 should fire on FileStream creation without finally disposal',
    );
    console.log('    [PASS] PS-TRAP-001 fires on missing finally for FileStream');

    assert.strictEqual(
      byRuleInFile('PS-SEC-001', 'eng_bad.ps1'),
      1,
      'PS-SEC-001 should fire on iex with variable input',
    );
    console.log('    [PASS] PS-SEC-001 fires on dynamic iex with variable input');

    assert.strictEqual(
      byRuleInFile('PS-SAFE-001', 'eng_bad.ps1'),
      1,
      'PS-SAFE-001 should fire on Read-Host without interactive guard',
    );
    console.log('    [PASS] PS-SAFE-001 fires on unguarded Read-Host');

    // --- PowerShell: Engineering rules negative tests on eng_good.ps1 ---
    console.log('  [TEST] PowerShell engineering rules negative tests on eng_good.ps1');
    const engGoodPsIssues = inFile('eng_good.ps1');
    assert.strictEqual(
      engGoodPsIssues.length,
      0,
      `eng_good.ps1 should have zero issues, got: ${engGoodPsIssues.map((i) => i.rule).join(', ')}`,
    );
    console.log('    [PASS] eng_good.ps1 produces zero findings');

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
      'SH-EOL-001 positive',
      'SH-DOC-001 positive',
      'SH-TRAP-001 positive',
      'SH-SEC-001 positive',
      'SH-SAFE-001 positive',
      'SH-EXIT-001 positive',
      'eng_good.sh negative (all silent)',
      'PS-DOC-001 positive',
      'PS-TRAP-001 positive',
      'PS-SEC-001 positive',
      'PS-SAFE-001 positive',
      'eng_good.ps1 negative (all silent)',
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
