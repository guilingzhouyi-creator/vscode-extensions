#!/usr/bin/env node
/**
 * Module: Verification Harness — Python Outer-Scope Shadowing Rule (PYM-SHADOW-001)
 * File Path: scripts/validate-shadowing.js
 * Architecture Role: Integration suite for the `python-modern` analyzer's outer-scope
 *     variable shadowing detection rule
 * Dependencies & Triggers: `npm run validate-shadowing`; imports ../dist/api (scan)
 *     plus node's assert/fs/os/path
 * Responsibilities: Assert PYM-SHADOW-001 fires on genuine shadowing scenarios and
 *     stays silent on non-shadowing patterns: function params shadowing outer locals,
 *     for-loop variables leaking (Python has no block scope), class methods vs class
 *     attributes, module-level names shadowed by function locals, ignore-list names,
 *     and same-scope reassignments.
 * Exit Semantics & Design Rationale: Rejects on the first failed assertion and exits 1
 *     so CI fails loudly.  Each scenario is a separate fixture file to keep the
 *     assertions easy to debug.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan } = require('../dist/api');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 1. Function parameter shadows an outer-function local variable → should report. */
const SHADOW_PARAM = [
    'def outer():',
    '    value = 42',
    '    def inner(value):',
    '        return value * 2',
    '    return inner(10)',
    '',
].join('\n');

/** 2. for-loop variable shadows a module-level / outer-function variable → should report.
 *  (Python has no block scope, so the for-var leaks into the enclosing function scope,
 *   but it still shadows names from *outer* scopes.)
 */
const SHADOW_FOR_LOOP = [
    'item = "module_level"',
    '',
    'def process(items):',
    '    result = []',
    '    for item in items:',
    '        result.append(item)',
    '    return result',
    '',
].join('\n');

/** 3. Class method parameter shadows a class-level attribute → should report. */
const SHADOW_CLASS_METHOD = [
    'class Counter:',
    '    count = 0',
    '    name = "counter"',
    '',
    '    def update(self, name):',
    '        self.count += 1',
    '        return name',
    '',
].join('\n');

/** 4. Module-level variable shadowed by a function-local variable → should report. */
const SHADOW_MODULE_VAR = [
    'config = {"debug": True}',
    '',
    'def load_config(path):',
    '    config = {}',
    '    with open(path) as fh:',
    '        config = eval(fh.read())',
    '    return config',
    '',
].join('\n');

/** 5. If-block assignment does NOT create a new scope → no report (same-scope reassignment). */
const NO_SHADOW_IF_BLOCK = [
    'def check(flag):',
    '    result = "default"',
    '    if flag:',
    '        result = "enabled"',
    '    return result',
    '',
].join('\n');

/** 6. Whitelisted names (self, _, i, e, f, etc.) → no report. */
const NO_SHADOW_WHITELIST = [
    'def outer():',
    '    self = "something"',
    '    _ = "discard"',
    '    i = 0',
    '    e = None',
    '    f = "file"',
    '    def inner(self, _, i, e, f):',
    '        return self, _, i, e, f',
    '    return inner',
    '',
].join('\n');

/** 7. Same-scope reassignment → no report (not shadowing). */
const NO_SHADOW_REASSIGN = [
    'def compute():',
    '    total = 0',
    '    total = total + 1',
    '    total += 1',
    '    return total',
    '',
].join('\n');

/** 8. with ... as target in a nested function shadows an outer variable → should report. */
const SHADOW_WITH_AS = [
    'handle = "outer_handle"',
    '',
    'def read_files(paths):',
    '    results = []',
    '    for p in paths:',
    '        with open(p) as handle:',
    '            results.append(handle.read())',
    '    return results',
    '',
].join('\n');

/** 9. except ... as target in a nested function shadows an outer variable → should report. */
const SHADOW_EXCEPT_AS = [
    'error = "module_error"',
    '',
    'def safe_div(a, b):',
    '    try:',
    '        return a / b',
    '    except ZeroDivisionError as error:',
    '        return str(error)',
    '',
].join('\n');

/** 10. Nested function name shadows a module-level variable → should report. */
const SHADOW_NESTED_FUNC = [
    'helper = "module_level"',
    '',
    'def outer():',
    '    def helper():',
    '        return 42',
    '    return helper()',
    '',
].join('\n');

/** 11. Import shadowed by a local variable → should report. */
const SHADOW_IMPORT_LOCAL = [
    'import json',
    '',
    'def parse(data):',
    '    json = "not the module"',
    '    return json',
    '',
].join('\n');

/** 12. Function at module level: no outer scope to shadow → no report. */
const NO_SHADOW_TOP_LEVEL = [
    'def greet(name):',
    '    message = f"Hello, {name}"',
    '    return message',
    '',
].join('\n');

/** 13. Async function parameter shadowing → should report. */
const SHADOW_ASYNC_PARAM = [
    'async def fetch(session):',
    '    url = "https://api.example.com"',
    '    async def inner(url):',
    '        return await session.get(url)',
    '    return await inner(url)',
    '',
].join('\n');

// ---------------------------------------------------------------------------
// Workspace setup
// ---------------------------------------------------------------------------

const FIXTURES = {
    'shadow_param.py': SHADOW_PARAM,
    'shadow_for_loop.py': SHADOW_FOR_LOOP,
    'shadow_class_method.py': SHADOW_CLASS_METHOD,
    'shadow_module_var.py': SHADOW_MODULE_VAR,
    'no_shadow_if_block.py': NO_SHADOW_IF_BLOCK,
    'no_shadow_whitelist.py': NO_SHADOW_WHITELIST,
    'no_shadow_reassign.py': NO_SHADOW_REASSIGN,
    'shadow_with_as.py': SHADOW_WITH_AS,
    'shadow_except_as.py': SHADOW_EXCEPT_AS,
    'shadow_nested_func.py': SHADOW_NESTED_FUNC,
    'shadow_import_local.py': SHADOW_IMPORT_LOCAL,
    'no_shadow_top_level.py': NO_SHADOW_TOP_LEVEL,
    'shadow_async_param.py': SHADOW_ASYNC_PARAM,
};

function writeWorkspace(root) {
    for (const [name, content] of Object.entries(FIXTURES)) {
        fs.writeFileSync(path.join(root, name), content);
    }
    const configPath = path.join(root, 'ar.config.json');
    fs.writeFileSync(configPath, JSON.stringify({}));
    return configPath;
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-shadow-'));
    try {
        const configFile = writeWorkspace(root);
        const report = await scan({
            root,
            configFile,
            include: ['**/*.py'],
            analyzers: ['python-modern'],
            cache: false,
            daemon: 'off',
            logLevel: 'silent',
            respectGitignore: false,
            workers: 1,
        });

        const shadowIn = (file) =>
            report.issues.filter(
                (i) => i.rule === 'PYM-SHADOW-001' && i.location.file === file,
            );

        // --- Should report -----------------------------------------------------------

        // 1. Function parameter shadows outer-function local
        const paramHits = shadowIn('shadow_param.py');
        assert.ok(
            paramHits.length >= 1,
            `function param shadowing outer local must be flagged, got ${paramHits.length}`,
        );
        assert.ok(
            paramHits.some((h) => h.detail.name === 'value'),
            `shadowed name should be 'value', got ${JSON.stringify(paramHits.map((h) => h.detail.name))}`,
        );
        assert.ok(
            paramHits[0].detail.outerLine === 2,
            `outerLine should point to line 2, got ${paramHits[0].detail.outerLine}`,
        );
        console.log('  [PASS] function parameter shadows outer-function variable');

        // 2. for-loop variable shadows outer
        const forHits = shadowIn('shadow_for_loop.py');
        assert.ok(
            forHits.length >= 1,
            `for-loop var shadowing outer must be flagged, got ${forHits.length}`,
        );
        assert.ok(
            forHits.some((h) => h.detail.name === 'item'),
            `shadowed name should include 'item', got ${JSON.stringify(forHits.map((h) => h.detail.name))}`,
        );
        console.log('  [PASS] for-loop variable shadows outer-scope variable');

        // 3. Class method parameter shadows class attribute
        const classHits = shadowIn('shadow_class_method.py');
        assert.ok(
            classHits.length >= 1,
            `class method param shadowing class attr must be flagged, got ${classHits.length}`,
        );
        assert.ok(
            classHits.some((h) => h.detail.name === 'name'),
            `shadowed name should include 'name', got ${JSON.stringify(classHits.map((h) => h.detail.name))}`,
        );
        console.log('  [PASS] class method parameter shadows class-level variable');

        // 4. Module-level variable shadowed by function-local
        const modHits = shadowIn('shadow_module_var.py');
        assert.ok(
            modHits.length >= 1,
            `module var shadowed by local must be flagged, got ${modHits.length}`,
        );
        assert.ok(
            modHits.some((h) => h.detail.name === 'config'),
            `shadowed name should include 'config', got ${JSON.stringify(modHits.map((h) => h.detail.name))}`,
        );
        console.log('  [PASS] module-level variable shadowed by function-local assignment');

        // 8. with ... as target shadows outer
        const withHits = shadowIn('shadow_with_as.py');
        assert.ok(
            withHits.length >= 1,
            `with-as target shadowing outer must be flagged, got ${withHits.length}`,
        );
        assert.ok(
            withHits.some((h) => h.detail.name === 'handle'),
            `shadowed name should include 'handle', got ${JSON.stringify(withHits.map((h) => h.detail.name))}`,
        );
        console.log('  [PASS] with ... as target shadows outer-scope variable');

        // 9. except ... as target shadows outer
        const exceptHits = shadowIn('shadow_except_as.py');
        assert.ok(
            exceptHits.length >= 1,
            `except-as target shadowing outer must be flagged, got ${exceptHits.length}`,
        );
        assert.ok(
            exceptHits.some((h) => h.detail.name === 'error'),
            `shadowed name should include 'error', got ${JSON.stringify(exceptHits.map((h) => h.detail.name))}`,
        );
        console.log('  [PASS] except ... as target shadows outer-scope variable');

        // 10. Nested function name shadows outer variable
        const nestedHits = shadowIn('shadow_nested_func.py');
        assert.ok(
            nestedHits.length >= 1,
            `nested func name shadowing outer must be flagged, got ${nestedHits.length}`,
        );
        assert.ok(
            nestedHits.some((h) => h.detail.name === 'helper'),
            `shadowed name should include 'helper', got ${JSON.stringify(nestedHits.map((h) => h.detail.name))}`,
        );
        console.log('  [PASS] nested function name shadows outer-scope variable');

        // 11. Import shadowed by local variable
        const importHits = shadowIn('shadow_import_local.py');
        assert.ok(
            importHits.length >= 1,
            `import shadowed by local must be flagged, got ${importHits.length}`,
        );
        assert.ok(
            importHits.some((h) => h.detail.name === 'json'),
            `shadowed name should include 'json', got ${JSON.stringify(importHits.map((h) => h.detail.name))}`,
        );
        console.log('  [PASS] module import shadowed by function-local variable');

        // 13. Async function parameter shadowing
        const asyncHits = shadowIn('shadow_async_param.py');
        assert.ok(
            asyncHits.length >= 1,
            `async inner func param shadowing must be flagged, got ${asyncHits.length}`,
        );
        assert.ok(
            asyncHits.some((h) => h.detail.name === 'url'),
            `shadowed name should include 'url', got ${JSON.stringify(asyncHits.map((h) => h.detail.name))}`,
        );
        console.log('  [PASS] async function parameter shadows outer-scope variable');

        // --- Should NOT report -------------------------------------------------------

        // 5. If-block assignment (no block scope in Python → same-scope reassignment)
        const ifHits = shadowIn('no_shadow_if_block.py');
        assert.strictEqual(
            ifHits.length,
            0,
            `if-block assignment must NOT be flagged (no block scope in Python), got ${ifHits.length}`,
        );
        console.log('  [PASS] if-block assignment: same scope, no shadowing reported');

        // 6. Whitelisted names
        const wlHits = shadowIn('no_shadow_whitelist.py');
        assert.strictEqual(
            wlHits.length,
            0,
            `whitelisted names (self, _, i, e, f, ...) must NOT be flagged, got ${wlHits.length}: ${wlHits.map((h) => h.detail.name).join(', ')}`,
        );
        console.log('  [PASS] whitelisted idiomatic names are suppressed');

        // 7. Same-scope reassignment
        const reassignHits = shadowIn('no_shadow_reassign.py');
        assert.strictEqual(
            reassignHits.length,
            0,
            `same-scope reassignment must NOT be flagged, got ${reassignHits.length}`,
        );
        console.log('  [PASS] same-scope reassignment is not shadowing');

        // 12. Top-level function (no outer scope to shadow)
        const topHits = shadowIn('no_shadow_top_level.py');
        assert.strictEqual(
            topHits.length,
            0,
            `top-level function must have no shadow reports, got ${topHits.length}`,
        );
        console.log('  [PASS] top-level function with no outer scope stays silent');

        // --- Severity & message format check -----------------------------------------

        const allShadow = report.issues.filter((i) => i.rule === 'PYM-SHADOW-001');
        if (allShadow.length > 0) {
            assert.strictEqual(
                allShadow[0].severity,
                'warning',
                'PYM-SHADOW-001 severity must be warning',
            );
            assert.ok(
                allShadow[0].message.includes('may shadow'),
                `message should use 'may shadow' wording, got: ${allShadow[0].message}`,
            );
            assert.ok(
                allShadow[0].message.includes('line'),
                `message should reference outer line number, got: ${allShadow[0].message}`,
            );
            assert.ok(
                typeof allShadow[0].detail.outerLine === 'number' && allShadow[0].detail.outerLine > 0,
                `detail.outerLine must be a positive number, got: ${allShadow[0].detail.outerLine}`,
            );
            console.log('  [PASS] severity=warning, message format includes outer line reference');
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

run()
    .then(() => {
        console.log('\n ALL SHADOWING DETECTION TESTS PASSED SUCCESSFULLY!');
    })
    .catch((error) => {
        console.error('\n[FAIL]', error && error.message ? error.message : error);
        process.exit(1);
    });
