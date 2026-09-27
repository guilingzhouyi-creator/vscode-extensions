#!/usr/bin/env node
/**
 * Module: Verification Harness — Domain Adapters Guard
 * File Path: scripts/validate-domain-adapters.js
 * Architecture Role: Verifies the behavior of domain adapters built on generalized patterns:
 *   VscodeExtensionAnalyzer (VSC-MEM/PERF/I18N) and GdscriptGameAnalyzer (GDM-PRF/POL/SIG/ISO).
 * Dependencies & Triggers: Run via `npm test` or `node scripts/validate-domain-adapters.js`.
 * Responsibilities:
 *   1. Validate VS Code extension rules and contract enforcement.
 *   2. Validate Godot GDScript game rules and contract enforcement.
 *   3. Enforce path exemptions and default-off behavior.
 * Exit Semantics & Design Rationale: Exits 0 on verification pass, 1 on failure.
 */
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { VscodeExtensionAnalyzer } = require(
  path.join(ROOT, 'dist', 'analyzers', 'vscode-extension'),
);
const { GdscriptGameAnalyzer } = require(path.join(ROOT, 'dist', 'analyzers', 'gdscript-game'));
const { resolveConfig } = require(path.join(ROOT, 'dist', 'core', 'config', 'config'));

console.log('=== Validating Domain Adapters (VS Code Extension & GDScript Game) ===');

// --- Section 1: VS Code Extension Analyzer ---
{
  const analyzer = new VscodeExtensionAnalyzer();

  // 1. Positive test
  const nonCompliantContent = [
    'import * as vscode from "vscode";',
    'import * as fs from "fs";',
    'export function activate(context: vscode.ExtensionContext) {',
    '    vscode.commands.registerCommand("myExt.sayHello", () => {',
    '        vscode.window.showInformationMessage("Hello World from Extension!");',
    '    });',
    '    const config = fs.readFileSync("/path/to/config.json", "utf-8");',
    '}',
  ].join('\n');

  const issues = analyzer.analyze(undefined, {
    filePath: 'src/extension.ts',
    content: nonCompliantContent,
    options: {},
  });

  const ruleIds = issues.map((i) => i.rule);
  assert(ruleIds.includes('VSC-MEM-001'), 'Expected VSC-MEM-001 (Disposable leak)');
  assert(ruleIds.includes('VSC-PERF-001'), 'Expected VSC-PERF-001 (Blocking fs)');
  assert(ruleIds.includes('VSC-I18N-001'), 'Expected VSC-I18N-001 (Bare notification string)');
  console.log('  [PASS] all 3 vscode-extension rules fire on positive fixture');

  // 2. Compliant test
  const compliantContent = [
    'import * as vscode from "vscode";',
    'import * as fs from "fs/promises";',
    'export function activate(context: vscode.ExtensionContext) {',
    '    context.subscriptions.push(',
    '        vscode.commands.registerCommand("myExt.sayHello", () => {',
    '            vscode.window.showInformationMessage(vscode.l10n.t("Hello World from Extension!"));',
    '        })',
    '    );',
    '    fs.readFile("/path/to/config.json", "utf-8");',
    '}',
  ].join('\n');

  const compliantIssues = analyzer.analyze(undefined, {
    filePath: 'src/extension.ts',
    content: compliantContent,
    options: {},
  });
  assert.strictEqual(compliantIssues.length, 0, 'Expected 0 issues for compliant extension');
  console.log('  [PASS] compliant VS Code extension forms stay completely silent');
}

// --- Section 2: GDScript Game Analyzer ---
{
  const analyzer = new GdscriptGameAnalyzer();

  // 1. Positive test
  const nonCompliantContent = [
    '# @domain combat logic',
    'extends RefCounted',
    'func initialize_view():',
    '    var view = EventBus.get_view()',
    '    var node = get_node("Sprite")',
    'func _process(delta):',
    '    for i in range(100):',
    '        var bullet = Bullet.new()',
    '        var clone = bullet.duplicate(true)',
    'func setup_signals():',
    '    sig_a.connect(_on_a)',
    '    sig_b.connect(_on_b)',
    '    sig_c.connect(_on_c)',
    'func acquire():',
    '    return {}',
  ].join('\n');

  const issues = analyzer.analyze(undefined, {
    filePath: 'src/domain/combat_pool.gd',
    content: nonCompliantContent,
    options: {},
  });

  const ruleIds = issues.map((i) => i.rule);
  assert(ruleIds.includes('GDM-PRF-001'), 'Expected GDM-PRF-001 (Loop allocation)');
  assert(ruleIds.includes('GDM-POL-001'), 'Expected GDM-POL-001 (Pool contract)');
  assert(ruleIds.includes('GDM-SIG-001'), 'Expected GDM-SIG-001 (Signal leak)');
  assert(ruleIds.includes('GDM-ISO-001'), 'Expected GDM-ISO-001 (Domain decoupling)');
  console.log('  [PASS] all 4 gdscript-game rules fire on positive fixture');

  // 2. Compliant test
  const compliantContent = [
    '# @domain pure combat calculator',
    'extends RefCounted',
    'func calculate_damage(base: int, armor: int) -> int:',
    '    return maxi(1, base - armor)',
  ].join('\n');

  const compliantIssues = analyzer.analyze(undefined, {
    filePath: 'src/domain/damage_calculator.gd',
    content: compliantContent,
    options: {},
  });
  assert.strictEqual(compliantIssues.length, 0, 'Expected 0 issues for compliant domain code');
  console.log('  [PASS] compliant GDScript domain forms stay completely silent');
}

// --- Section 3: Default-off configurations ---
{
  const config = resolveConfig({});
  assert.strictEqual(config.analyzers['vscode-extension']?.enabled, false);
  assert.strictEqual(config.analyzers['gdscript-game']?.enabled, false);
  console.log('  [PASS] domain adapters remain default-off in generic configuration');
}

console.log('\n ALL DOMAIN ADAPTER CHECKS PASSED SUCCESSFULLY!');
process.exit(0);
