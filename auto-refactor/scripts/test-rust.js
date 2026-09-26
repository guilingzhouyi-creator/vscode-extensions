#!/usr/bin/env node
/**
 * Module: Verification Harness — Rust Native Operators Unit Test Runner
 * File Path: scripts/test-rust.js
 * Architecture Role: Cross-platform runner for the pure-Rust operator crates in crates/
 *   guaranteeing correct MinGW toolchain linkage on Windows and standard Cargo on POSIX.
 * Dependencies & Triggers: `npm run test:rust`, `npm run gate:rust`.
 * Responsibilities:
 *   1. Execute `cargo test --workspace --exclude auto-refactor-core` in crates/;
 *   2. Enforce x86_64-pc-windows-gnu toolchain on Windows platforms;
 *   3. Propagate exit code to CI / test harnesses.
 * Exit Semantics & Design Rationale: Exits 0 on all tests passing, exits 1 on test failure.
 */

'use strict';

const path = require('path');
const { execSync } = require('child_process');

const CRATES_DIR = path.resolve(__dirname, '..', 'crates');

function runRustTests() {
  console.log('=== [Rust Native Operators] Running Pure-Rust Unit Tests ===');
  console.log(`Directory: ${CRATES_DIR}`);

  const command =
    process.platform === 'win32'
      ? 'cargo +stable-x86_64-pc-windows-gnu test --workspace --exclude auto-refactor-core'
      : 'cargo test --workspace --exclude auto-refactor-core';

  console.log(`Executing: ${command}`);
  try {
    execSync(command, {
      cwd: CRATES_DIR,
      stdio: 'inherit',
    });
    console.log('✓ All pure-Rust operator unit tests passed successfully.');
  } catch (_err) {
    console.error('❌ Rust native unit tests failed.');
    process.exit(1);
  }
}

runRustTests();
