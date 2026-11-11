/**
 * Module: Verification Harness — Reusable Test Runner & Sandbox Harness
 * File Path: scripts/common/test-runner-harness.js
 * Architecture Role: Shared verification infrastructure providing isolated temporary
 *     workspaces, synthetic fixture deployment, deterministic timer measurement,
 *     and standardized assertion runners across all validator scripts.
 * Dependencies & Triggers: Node.js standard libraries (fs, path, os);
 *     imported by scripts/validate-*.js test suites.
 * Responsibilities: Provide clean temporary workspaces for scanner tests; automate
 *     fixture creation and teardown; eliminate boilerplate clone smells (HYG-CLN-001);
 *     standardize test execution reporting and exit status codes.
 * Exit Semantics & Design Rationale: Exits process with 1 on unhandled rejection or assertion
 *     failure; always executes directory cleanup in finally blocks to avoid disk clutter;
 *     keeps zero external runtime dependencies.
 */
'use strict';

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
    // best-effort: ignore transient Windows file lock errors during teardown
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
    console.log(`✔ ${name} (${durationMs}ms)`);
  } finally {
    cleanupTempDir(tempDir);
  }
}

/**
 * Builds the failure handler shared by every verification entry point.
 *
 * Callers that keep their own success path — a `.then()` banner, or an inline async body — still
 * need the same failure semantics. Returning the handler lets them attach it to their existing chain
 * instead of restating the banner and the exit code, so the contract stays in one place.
 *
 * An optional cleanup runs before the exit. It is guarded, because a failing suite must still exit
 * with the failure verdict even when its own cleanup throws: reporting a teardown problem instead of
 * the real assertion would hide the reason the suite failed.
 * @param name - Suite name used in the failure banner.
 * @param cleanup - Optional teardown to attempt before terminating.
 * @returns Handler that reports the error with the suite name and exits 1.
 */
function reportFailure(name, cleanup) {
  return (error) => {
    console.error(`✖ ${name} failed`);
    console.error(error && error.stack ? error.stack : error);
    if (cleanup) {
      try {
        cleanup();
      } catch {
        // Teardown is best-effort; the failure verdict above is what matters.
      }
    }
    process.exit(1);
  };
}

/**
 * Runs a bare entry function and terminates the process with the verdict.
 *
 * `runValidationSuite` rethrows failure, so every caller had to write its own catch plus exit — the
 * boilerplate that kept validators from adopting this harness. Suite name and stack are both
 * reported, since a failure from a shared helper otherwise arrives without naming the suite.
 * @param name - Suite name used in the failure banner.
 * @param entry - Zero-argument async function performing the verification.
 * @returns Promise that resolves only on a clean pass; the process exits 1 on failure.
 */
async function runEntry(name, entry) {
  try {
    await entry();
  } catch (error) {
    reportFailure(name)(error);
  }
}

module.exports = {
  createTempTestDir,
  cleanupTempDir,
  deployFixtures,
  runValidationSuite,
  reportFailure,
  runEntry,
};
