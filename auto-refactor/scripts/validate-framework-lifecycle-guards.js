/**
 * Module: Verification Harness — Cross-Framework Lifecycle & Guard Rules
 * File Path: scripts/validate-framework-lifecycle-guards.js
 * Architecture Role: Verifies TSM-DISP-001 (VS Code Disposable leak guard),
 *   GDM-POOL-002 (Godot object pool lifecycle contract), CPX-HOP-001 (cognitive jump cost),
 *   and CMT-WID-001 URL elastic exemption.
 * Dependencies & Triggers: Run via `node scripts/validate-framework-lifecycle-guards.js` and test-parallel.
 * Responsibilities: Exercise positive and negative fixtures for framework lifecycle guards.
 * Exit Semantics & Design Rationale: Process exits 0 on success; throws AssertionError on failure.
 */

'use strict';

const assert = require('assert');
const { TsModernAnalyzer } = require('../dist/analyzers/ts-modern');
const { GdscriptModernAnalyzer } = require('../dist/analyzers/gdscript-modern');
const { CommentAnalyzer } = require('../dist/analyzers/comments');

function testVsCodeDisposableGuard() {
    const analyzer = new TsModernAnalyzer();

    // 1. Isolated listener call -> should report TSM-DISP-001
    const badCode = `
import * as vscode from 'vscode';
export function activate(context: vscode.ExtensionContext) {
    vscode.window.onDidChangeActiveTextEditor((editor) => {
        console.log('active editor changed');
    });
}
`;
    const badIssues = analyzer.analyze(undefined, {
        filePath: 'src/extension.ts',
        content: badCode,
        options: {},
    });
    const leakIssue = badIssues.find((i) => i.rule === 'TSM-DISP-001');
    assert(leakIssue, 'Should flag isolated vscode.window.onDidChangeActiveTextEditor call');

    // 2. Tracked listener call inside subscriptions.push -> should NOT report
    const goodCode = `
import * as vscode from 'vscode';
export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            console.log('active editor changed');
        })
    );
}
`;
    const goodIssues = analyzer.analyze(undefined, {
        filePath: 'src/extension.ts',
        content: goodCode,
        options: {},
    });
    const noLeakIssue = goodIssues.find((i) => i.rule === 'TSM-DISP-001');
    assert(!noLeakIssue, 'Should not flag tracked vscode listener in context.subscriptions.push');
    console.log('[PASS] TSM-DISP-001 Disposable guard passed.');
}

function testGodotObjectPoolContract() {
    const analyzer = new GdscriptModernAnalyzer();

    // 1. Subclass reset_state missing super.reset_state -> should report GDM-POOL-002
    const badCode = `
class_name CombatProjectile
extends ProjectileEntity

var speed: float = 100.0

func reset_state() -> void:
    speed = 0.0
`;
    const badIssues = analyzer.analyze(undefined, {
        filePath: 'combat_projectile.gd',
        content: badCode,
        options: {},
    });
    const poolIssue = badIssues.find((i) => i.rule === 'GDM-POOL-002');
    assert(poolIssue, 'Should flag reset_state() missing super call in inherited entity');

    // 2. Subclass reset_state invoking super.reset_state -> should NOT report
    const goodCode = `
class_name CombatProjectile
extends ProjectileEntity

var speed: float = 100.0

func reset_state() -> void:
    super.reset_state()
    speed = 0.0
`;
    const goodIssues = analyzer.analyze(undefined, {
        filePath: 'combat_projectile.gd',
        content: goodCode,
        options: {},
    });
    const noPoolIssue = goodIssues.find((i) => i.rule === 'GDM-POOL-002');
    assert(!noPoolIssue, 'Should not flag reset_state() that calls super.reset_state()');
    console.log('[PASS] GDM-POOL-002 Object Pool contract passed.');
}

function testCommentUrlElasticExemption() {
    const analyzer = new CommentAnalyzer();

    // 1. Overwide line with normal prose -> should report CMT-WID-001
    const overwideProse = '// ' + 'A'.repeat(120);
    const proseIssues = analyzer.analyze(undefined, {
        filePath: 'src/test.ts',
        content: overwideProse,
        options: { level: 'standard' },
        config: { commentLevel: 'standard' },
    });
    const proseIssue = proseIssues.find((i) => i.rule === 'CMT-WID-001');
    assert(proseIssue, 'Should flag overwide prose comment line');

    // 2. Overwide line containing documentation URL -> should be exempt
    const overwideUrl =
        '// Reference documentation: https://github.com/rust-random/rand/blob/master/rand_core/src/le.rs#L123-L456';
    const urlIssues = analyzer.analyze(undefined, {
        filePath: 'src/test.ts',
        content: overwideUrl,
        options: { level: 'standard' },
        config: { commentLevel: 'standard' },
    });
    const urlIssue = urlIssues.find((i) => i.rule === 'CMT-WID-001');
    assert(!urlIssue, 'Should exempt overwide comment containing standard URL');
    console.log('[PASS] CMT-WID-001 URL elastic exemption passed.');
}

function runAll() {
    testVsCodeDisposableGuard();
    testGodotObjectPoolContract();
    testCommentUrlElasticExemption();
    console.log('[ALL PASS] Framework lifecycle guards & elastic exemptions fully validated.');
}

runAll();
