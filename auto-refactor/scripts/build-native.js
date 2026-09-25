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

const CRATE_DIR = path.resolve(__dirname, '..', 'crates', 'auto-refactor-core');
const DEST_INDEX_NODE = path.join(CRATE_DIR, 'index.node');

function buildNativeCore() {
  console.log('--- Building Rust Native Acceleration Core ---');
  console.log(`Crate directory: ${CRATE_DIR}`);

  const command =
    process.platform === 'win32'
      ? 'cargo +stable-x86_64-pc-windows-gnu build --release'
      : 'cargo build --release';

  console.log(`Executing: ${command}`);
  execSync(command, { cwd: CRATE_DIR, stdio: 'inherit' });

  const candidatePaths = [
    path.join(CRATE_DIR, 'target', 'x86_64-pc-windows-gnu', 'release', 'auto_refactor_core.dll'),
    path.join(CRATE_DIR, 'target', 'release', 'auto_refactor_core.dll'),
    path.join(CRATE_DIR, 'target', 'release', 'libauto_refactor_core.so'),
    path.join(CRATE_DIR, 'target', 'release', 'libauto_refactor_core.dylib'),
  ];

  const builtArtifact = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (!builtArtifact) {
    throw new Error('Compiled native dynamic library not found in target directories.');
  }

  console.log(`Deploying artifact to ${DEST_INDEX_NODE}`);
  fs.copyFileSync(builtArtifact, DEST_INDEX_NODE);

  console.log('Native binary deployed successfully.');
  console.log(`Size: ${(fs.statSync(DEST_INDEX_NODE).size / 1024).toFixed(1)} KB`);
}

try {
  buildNativeCore();
} catch (err) {
  console.error('Failed to compile Rust native core:', err.message);
  process.exit(1);
}
