/**
 * Module: Gate — Rust Workspace
 * File Path: scripts/gate-rust.js
 * Architecture Role: Runs clippy, rustfmt and the unit tests over the Rust workspace in one
 *   place, so the toolchain is chosen once. Previously `gate:rust` chained three commands
 *   inline, and the toolchain was inconsistent: `cargo clippy` used the default toolchain
 *   while the tests used the gnu toolchain on Windows. On a machine without the MSVC linker
 *   on PATH, clippy failed to build and the `&&` chain stopped before a single test ran, so
 *   `npm run gate` reported a Rust failure that was really a missing `link.exe`, and the tests
 *   that would have passed never executed.
 *
 *   `auto-refactor-core` is deliberately included: it is the N-API boundary, the only place
 *   the Rust/JavaScript argument shapes are defined, and excluding it left that layer with no
 *   lint and no coverage. A dropped argument there reached production once already.
 * Dependencies & Triggers: cargo (clippy, fmt, test) over crates/Cargo.toml; invoked by the
 *   gate chain as `gate:rust`.
 * Responsibilities: choose the toolchain once for all three stages, run them in order, and
 *   name the failing stage instead of letting a bare `&&` chain stop silently.
 * Exit Semantics & Design Rationale: Exits non-zero on the first failing stage; performs no
 *   writes beyond cargo's own build directory.
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const CRATES_DIR = path.resolve(__dirname, '..', 'crates');
const MANIFEST = path.join(CRATES_DIR, 'Cargo.toml');

/**
 * Toolchain prefix matching the one the unit tests build with.
 *
 * The gnu toolchain is pinned on Windows so clippy and the tests compile with the same
 * linker; a bare `cargo clippy` would pick the host default and could fail for reasons that
 * have nothing to do with the code.
 *
 * @returns Arguments to prepend to a cargo invocation.
 */
function toolchainArgs() {
  return process.platform === 'win32' ? ['+stable-x86_64-pc-windows-gnu'] : [];
}

/**
 * Run one cargo stage, reporting which stage failed.
 *
 * @param label - Human name of the stage.
 * @param args - Cargo arguments.
 * @param extra - Extra arguments after the manifest path.
 * @returns Nothing; exits the process on failure.
 */
function runStage(label, args, extra = []) {
  console.log(`\n=== [gate:rust] ${label} ===`);
  const command = ['cargo', ...toolchainArgs(), ...args, '--manifest-path', MANIFEST, ...extra];
  console.log(`> ${command.join(' ')}`);
  try {
    execFileSync(command[0], command.slice(1), { cwd: CRATES_DIR, stdio: 'inherit' });
    console.log(`[PASS] ${label}`);
  } catch (_err) {
    console.error(`[FAIL] ${label} — see the output above.`);
    process.exit(1);
  }
}

runStage(
  'clippy (-D warnings)',
  ['clippy', '--workspace', '--all-targets'],
  ['--', '-D', 'warnings'],
);
runStage('rustfmt --check', ['fmt', '--all'], ['--', '--check']);
runStage('unit tests', ['test', '--workspace']);
console.log('\nALL RUST GATE STAGES PASSED SUCCESSFULLY!');
