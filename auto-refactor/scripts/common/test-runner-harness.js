/**
 * Module: Verification Harness — Reusable Test Runner & Sandbox Harness
 * File Path: scripts/common/test-runner-harness.js
 * Architecture Role: Shared verification infrastructure providing isolated temporary
 *     workspaces, synthetic fixture deployment, deterministic timer measurement,
 *     and standardized assertion runners across all validator scripts.
 * Dependencies & Triggers: Node.js standard libraries (fs, path, os, assert);
 *     imported by scripts/validate-*.js test suites.
 * Responsibilities: Provide clean temporary workspaces for scanner tests; automate
 *     fixture creation and teardown; eliminate boilerplate clone smells (HYG-CLN-001);
 *     standardize test execution reporting and exit status codes.
 * Exit Semantics & Design Rationale: Exits process with 1 on unhandled rejection or assertion
 *     failure; always executes directory cleanup in finally blocks to avoid disk clutter;
 *     keeps zero external runtime dependencies.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Creates an isolated temporary directory for testing.
 *
 * @param {string} prefix - Descriptive folder name prefix.
 * @returns {string} Absolute path to created temporary directory.
 */
function createTempTestDir(prefix = 'ar-test') {
    const sanitizedPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '-');
    return fs.mkdtempSync(path.join(os.tmpdir(), `${sanitizedPrefix}-`));
}

/**
 * Safely removes a temporary directory and its contents.
 *
 * @param {string} dirPath - Directory path to remove.
 */
function cleanupTempDir(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath)) {
        return;
    }
    try {
        fs.rmSync(dirPath, { recursive: true, force: true });
    } catch {
        // Suppress transient Windows file lock errors during teardown
    }
}

/**
 * Deploys multiple fixture files into a target directory.
 *
 * @param {string} targetDir - Destination base directory.
 * @param {Record<string, string | string[]>} fixtures - Map of relative path to file content.
 */
function deployFixtures(targetDir, fixtures) {
    for (const [relPath, content] of Object.entries(fixtures)) {
        const fullPath = path.join(targetDir, relPath);
        const parentDir = path.dirname(fullPath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
        const textContent = Array.isArray(content) ? content.join('\n') : String(content);
        fs.writeFileSync(fullPath, textContent, 'utf8');
    }
}

/**
 * Executes a validation suite in an isolated sandbox environment.
 *
 * @param {object} options - Suite configuration.
 * @param {string} options.name - Human-readable test suite name.
 * @param {Record<string, string | string[]>} [options.fixtures] - Optional synthetic files to write.
 * @param {(context: { tempDir: string, deploy: (f: Record<string, string | string[]>) => void }) => Promise<void> | void} options.run - Verification logic.
 * @returns {Promise<void>}
 */
async function runValidationSuite(options) {
    const { name, fixtures = {}, run } = options;
    if (typeof run !== 'function') {
        throw new TypeError(`runValidationSuite: options.run must be a function, got ${typeof run}`);
    }

    const startTimestampMs = Date.now();
    const tempDir = createTempTestDir(`suite-${name}`);

    try {
        if (Object.keys(fixtures).length > 0) {
            deployFixtures(tempDir, fixtures);
        }

        const executionContext = {
            tempDir,
            deploy: (extraFixtures) => deployFixtures(tempDir, extraFixtures),
        };

        await run(executionContext);

        const durationMs = Date.now() - startTimestampMs;
        console.log(`[PASS] ${name} (${durationMs}ms)`);
    } finally {
        cleanupTempDir(tempDir);
    }
}

module.exports = {
    createTempTestDir,
    cleanupTempDir,
    deployFixtures,
    runValidationSuite,
};
