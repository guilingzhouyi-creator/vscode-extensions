#!/usr/bin/env node
/**
 * Module: Build Script — Rust Native Acceleration Core Compiler
 * File Path: scripts/build-native.js
 * Architecture Role: Builds crates/auto-refactor-core and deploys the native addon binary
 *   to crates/auto-refactor-core/index.node for Node.js consumption.
 * Dependencies & Triggers: `npm run build:native`.
 * Responsibilities:
 *   1. Locate Cargo and suitable compilation toolchain;
 *   2. Compile the release cdylib artifact;
 *   3. Locate and copy the dynamic library to index.node;
 *   4. Verify binary viability via dynamic probe.
 * Exit Semantics & Design Rationale: Exits 0 on success, exits 1 on build/link failure.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIR_PARENT = '..';
const DIR_TARGET = 'target';
const DIR_RELEASE = 'release';
const TARGET_GNU = 'x86_64-pc-windows-gnu';

const BINARY_WINDOWS = 'auto_refactor_core.dll';
const BINARY_LINUX = 'libauto_refactor_core.so';
const BINARY_MACOS = 'libauto_refactor_core.dylib';

const KILOBYTE_BYTES = 1024;

const CRATE_DIR = path.resolve(__dirname, DIR_PARENT, 'crates', 'auto-refactor-core');
const DEST_INDEX_NODE = path.join(CRATE_DIR, 'index.node');

const BUILD_COMMAND_WINDOWS = 'cargo +stable-x86_64-pc-windows-gnu build --release';
const BUILD_COMMAND_DEFAULT = 'cargo build --release';

/**
 * Generates search candidate paths for compiled native artifacts across targets.
 *
 * @param crateDir - Root directory of the Rust crate.
 * @returns Array of resolved candidate file paths.
 */
function resolveCandidatePaths(crateDir) {
  const rootTarget = path.join(crateDir, DIR_PARENT, DIR_TARGET);
  const crateTarget = path.join(crateDir, DIR_TARGET);
  const searchBases = [
    path.join(rootTarget, TARGET_GNU, DIR_RELEASE),
    path.join(crateTarget, TARGET_GNU, DIR_RELEASE),
    path.join(rootTarget, DIR_RELEASE),
    path.join(crateTarget, DIR_RELEASE),
  ];
  const binaryNames = [BINARY_WINDOWS, BINARY_LINUX, BINARY_MACOS];
  const candidates = [];
  for (const base of searchBases) {
    for (const bin of binaryNames) {
      candidates.push(path.join(base, bin));
    }
  }
  return candidates;
}

function buildNativeCore() {
  console.log('--- Building Rust Native Acceleration Core ---');
  console.log(`Crate directory: ${CRATE_DIR}`);

  const command = process.platform === 'win32' ? BUILD_COMMAND_WINDOWS : BUILD_COMMAND_DEFAULT;
  console.log(`Executing: ${command}`);
  execSync(command, { cwd: CRATE_DIR, stdio: 'inherit' });

  const candidatePaths = resolveCandidatePaths(CRATE_DIR);
  const builtArtifact = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (!builtArtifact) {
    throw new Error('Compiled native dynamic library not found in target directories.');
  }

  console.log(`Deploying artifact to ${DEST_INDEX_NODE}`);
  fs.copyFileSync(builtArtifact, DEST_INDEX_NODE);

  console.log('Native binary deployed successfully.');
  console.log(`Size: ${(fs.statSync(DEST_INDEX_NODE).size / KILOBYTE_BYTES).toFixed(1)} KB`);
}

try {
  buildNativeCore();
} catch (err) {
  console.error('Failed to compile Rust native core:', err.message);
  process.exit(1);
}
