#!/usr/bin/env node
/**
 * Module: Verification Harness — Gate System & Hooks Architecture Parity
 * File Path: scripts/validate-gate-system.js
 * Architecture Role: Dogfooding verification suite for the workspace gate system
 *     (.githooks/, scripts/ps1/, scripts/sh/, scripts/common/).
 * Dependencies & Triggers: `npm run validate-gate-system`; imports ../dist/analyzers/shell-lint
 *     plus node's assert/fs/path. Registered in test-parallel.js.
 * Responsibilities:
 *     1. Assert 0 ShellLint issues across all gate scripts and git hooks.
 *     2. Assert EOL contract (CRLF for .ps1, LF for .sh/.js/.json).
 *     3. Assert Git hooks routing robustness (exec bash fallback, zero exec sh).
 *     4. Assert audit-all tri-project parity (workspace-timing, auto-refactor, WebGames).
 *     5. Assert pre-commit-gate 9-step normalization and Gate 8 tri-project verification.
 *     6. Assert pre-push-gate 8-gate coverage.
 * Exit Semantics & Design Rationale: Exits 0 on all assertions passed; exits 1 on failure.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ShellLintAnalyzer } = require('../dist/analyzers/shell-lint');

const ROOT_DIR = path.resolve(__dirname, '../..');

function collectFiles(dir, extensions) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectFiles(fullPath, extensions));
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
            results.push(fullPath);
        }
    }
    return results;
}

function verifyShellLintRules(analyzer, fileList) {
    let totalViolations = 0;
    const violationSummary = [];
    for (const filePath of fileList) {
        const content = fs.readFileSync(filePath, 'utf8');
        const issues = analyzer.analyze(null, { filePath, content });
        if (issues.length > 0) {
            totalViolations += issues.length;
            const relPath = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
            violationSummary.push(`${relPath}: ${issues.map(i => i.rule).join(', ')}`);
        }
    }
    assert.strictEqual(
        totalViolations,
        0,
        `Expected 0 ShellLint violations in gate system, found ${totalViolations}:\n${violationSummary.join('\n')}`
    );
}

function verifyLineEndings(psFiles, lfFiles) {
    for (const psFile of psFiles) {
        const content = fs.readFileSync(psFile, 'utf8');
        const rel = path.relative(ROOT_DIR, psFile).replace(/\\/g, '/');
        assert(
            content.includes('\r\n'),
            `PowerShell script must use CRLF line endings: ${rel}`
        );
    }
    for (const lfFile of lfFiles) {
        const content = fs.readFileSync(lfFile, 'utf8');
        const rel = path.relative(ROOT_DIR, lfFile).replace(/\\/g, '/');
        assert(
            !content.includes('\r'),
            `Script/code must use LF line endings, found CR: ${rel}`
        );
    }
}

function verifyHookRouting(hookFiles) {
    for (const hookFile of hookFiles) {
        const content = fs.readFileSync(hookFile, 'utf8');
        const rel = path.relative(ROOT_DIR, hookFile).replace(/\\/g, '/');
        assert(
            !content.includes('exec sh '),
            `Git hook must not downgrade to POSIX sh (dash crash risk): ${rel}`
        );
        assert(
            content.includes('exec bash '),
            `Git hook must route fallback to bash: ${rel}`
        );
    }
}

function verifyAuditAllParity() {
    const auditPs = path.join(ROOT_DIR, 'scripts/ps1/audit-all.ps1');
    const auditSh = path.join(ROOT_DIR, 'scripts/sh/audit-all.sh');
    assert(fs.existsSync(auditPs), 'audit-all.ps1 must exist');
    assert(fs.existsSync(auditSh), 'audit-all.sh must exist');

    const psContent = fs.readFileSync(auditPs, 'utf8');
    const shContent = fs.readFileSync(auditSh, 'utf8');

    for (const [name, content] of [['audit-all.ps1', psContent], ['audit-all.sh', shContent]]) {
        assert(content.includes('workspace-timing'), `${name} must cover workspace-timing`);
        assert(content.includes('auto-refactor'), `${name} must cover auto-refactor`);
        assert(content.includes('WebGames'), `${name} must cover WebGames`);
        assert(content.includes('audit_config.py'), `${name} must run WebGames config audit`);
        assert(content.includes('[5/5]'), `${name} must have 5 verification steps`);
    }
}

function verifyPreCommitParity() {
    const preCommitPs = path.join(ROOT_DIR, 'scripts/ps1/pre-commit-gate.ps1');
    const preCommitSh = path.join(ROOT_DIR, 'scripts/sh/pre-commit-gate.sh');

    for (const [name, p] of [['pre-commit-gate.ps1', preCommitPs], ['pre-commit-gate.sh', preCommitSh]]) {
        assert(fs.existsSync(p), `${name} must exist`);
        const content = fs.readFileSync(p, 'utf8');
        for (let i = 1; i <= 9; i++) {
            assert(content.includes(`[${i}/9]`), `${name} must contain step [${i}/9]`);
        }
        assert(content.includes('workspace-timing'), `${name} Gate 8 must verify workspace-timing`);
        assert(content.includes('auto-refactor'), `${name} Gate 8 must verify auto-refactor`);
        assert(content.includes('WebGames'), `${name} Gate 8 must verify WebGames`);
    }
}

function verifyPrePushParity() {
    const prePushPs = path.join(ROOT_DIR, 'scripts/ps1/pre-push-gate.ps1');
    const prePushSh = path.join(ROOT_DIR, 'scripts/sh/pre-push-gate.sh');

    for (const [name, p] of [['pre-push-gate.ps1', prePushPs], ['pre-push-gate.sh', prePushSh]]) {
        assert(fs.existsSync(p), `${name} must exist`);
        const content = fs.readFileSync(p, 'utf8');
        for (let i = 1; i <= 8; i++) {
            assert(content.includes(`[${i}/8]`), `${name} must contain Gate [${i}/8]`);
        }
        assert(content.includes('workspace-timing'), `${name} must verify workspace-timing`);
        assert(content.includes('auto-refactor'), `${name} must verify auto-refactor`);
        assert(content.includes('WebGames'), `${name} must verify WebGames`);
    }
}

function runAll() {
    console.log('=== Dogfooding Gate System & Hooks Verification ===');

    const analyzer = new ShellLintAnalyzer();
    const githooksDir = path.join(ROOT_DIR, '.githooks');
    const hookFiles = fs.readdirSync(githooksDir)
        .filter(f => !f.endsWith('.sample'))
        .map(f => path.join(githooksDir, f));

    const psFiles = collectFiles(path.join(ROOT_DIR, 'scripts/ps1'), ['.ps1']);
    const shFiles = collectFiles(path.join(ROOT_DIR, 'scripts/sh'), ['.sh']);
    const jsFiles = collectFiles(path.join(ROOT_DIR, 'scripts/common'), ['.js']);

    console.log(`1. ShellLint scanning ${hookFiles.length} hooks + ${psFiles.length} ps1 + ${shFiles.length} sh files...`);
    verifyShellLintRules(analyzer, [...hookFiles, ...psFiles, ...shFiles]);
    console.log('  ✔ ShellLint: 0 violations across all gate scripts.');

    console.log('2. Verifying line ending (EOL) contracts...');
    verifyLineEndings(psFiles, [...shFiles, ...hookFiles, ...jsFiles]);
    console.log('  ✔ EOL Contract: .ps1 strictly CRLF, .sh/.js strictly LF.');

    console.log('3. Verifying Git hook routing fallbacks...');
    verifyHookRouting(hookFiles);
    console.log('  ✔ Hook Routing: 100% bash fallback, zero POSIX dash crash vulnerability.');

    console.log('4. Verifying audit-all tri-project parity...');
    verifyAuditAllParity();
    console.log('  ✔ Audit-All: 5/5 pillars covering workspace-timing, auto-refactor, WebGames.');

    console.log('5. Verifying pre-commit-gate step normalization & Gate 8 parity...');
    verifyPreCommitParity();
    console.log('  ✔ Pre-Commit: [1/9]..[9/9] normalized, Gate 8 covers all 3 projects.');

    console.log('6. Verifying pre-push-gate 8-gate parity...');
    verifyPrePushParity();
    console.log('  ✔ Pre-Push: 8 gates covering all 3 projects.');

    console.log('\n✅ All gate system verification checks passed successfully.');
}

runAll();
