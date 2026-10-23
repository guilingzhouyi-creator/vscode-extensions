/**
 * Module: Toolchain Discovery — Locates the cargo Executable Without Relying on PATH
 * File Path: fractal-git/scripts/common/resolve-cargo.js
 * Architecture Role: Single source of truth for cargo resolution on the Node side of the gate
 *   suite. Mirrors `Resolve-GateCargoCommand` in `scripts/ps1/lib/gate-runtime.ps1` so the two
 *   runtimes cannot disagree about whether a toolchain exists.
 * Dependencies & Triggers: Node.js standard libraries only; imported by
 *   `validate-perf-baseline.js`; also runnable as a CLI for diagnostics.
 * Responsibilities:
 *   1. Resolve cargo through explicit override, rustup shim, rustup toolchain root, then PATH;
 *   2. Pin RUSTC when the resolved cargo is a raw toolchain binary, because a raw binary has no
 *      sibling `rustc` on PATH and build scripts would otherwise fail with "could not execute
 *      rustc";
 *   3. Report the resolution so a failing gate can state which candidate it used.
 * Exit Semantics & Design Rationale: `resolveCargo()` returns `{ command, source }` or `null`; it
 *   never throws, because the caller decides whether absence is fatal.
 *
 *   A gate that hardcodes `cargo.exe` reports "toolchain missing" whenever the rustup shim
 *   directory is absent from PATH, even on a machine with a complete toolchain under
 *   `.rustup/toolchains/<host>/bin`. That message is indistinguishable from a genuinely bare host,
 *   so a broken PATH gets diagnosed as a missing install and the wrong repair is attempted.
 *   Probing the toolchain root directly fixes the report and happens to be the safer order: a
 *   `cargo.exe` sitting in the working directory is never selected over the installed toolchain.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Environment variable that overrides discovery, for hosts with an unusual install root. */
const OVERRIDE_VARIABLE = 'TAXIS_CARGO_BIN';

/**
 * Reports whether a path names an existing regular file.
 *
 * @param {string} candidate - Absolute path.
 * @returns {boolean} True when the file exists.
 */
function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Lists toolchain directories, preferring stable releases.
 *
 * A host may carry several toolchains at once. Only the stable one is promised to reproduce the
 * gate's baselines, so it is tried first rather than whichever name sorts first.
 *
 * @param {string} toolchainsRoot - `<home>/.rustup/toolchains`.
 * @returns {string[]} Absolute toolchain directories, stable first.
 */
function toolchainDirectories(toolchainsRoot) {
  let entries;
  try {
    entries = fs.readdirSync(toolchainsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const stable = names.filter((name) => name.startsWith('stable-'));
  const others = names.filter((name) => !name.startsWith('stable-'));
  return [...stable, ...others].map((name) => path.join(toolchainsRoot, name));
}

/**
 * Resolves the cargo executable.
 *
 * @returns {{ command: string, source: string } | null} Resolution, or null when nothing was found.
 */
function resolveCargo() {
  const override = process.env[OVERRIDE_VARIABLE];
  if (override && isFile(override)) {
    return { command: override, source: OVERRIDE_VARIABLE };
  }

  const homeRoot = os.homedir();
  const executableName = process.platform === 'win32' ? 'cargo.exe' : 'cargo';

  const shim = path.join(homeRoot, '.cargo', 'bin', executableName);
  if (isFile(shim)) {
    return { command: shim, source: 'rustup-shim' };
  }

  for (const directory of toolchainDirectories(path.join(homeRoot, '.rustup', 'toolchains'))) {
    const candidate = path.join(directory, 'bin', executableName);
    if (isFile(candidate)) {
      return { command: candidate, source: 'rustup-toolchain' };
    }
  }

  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, executableName);
    if (isFile(candidate)) {
      return { command: candidate, source: 'path' };
    }
  }

  return null;
}

/**
 * Points RUSTC at the toolchain that owns the resolved cargo, when that can be determined.
 *
 * A rustup shim locates rustc by itself, so it needs no help. A raw toolchain binary has no
 * sibling on PATH, and dependency build scripts fail with "could not execute rustc" without this.
 *
 * @param {{ command: string, source: string } | null} resolution - Result of `resolveCargo()`.
 * @returns {string|null} The RUSTC value that was set, or null when the environment was untouched.
 */
function pinRustc(resolution) {
  if (!resolution || resolution.source !== 'rustup-toolchain') return null;
  const rustcName = process.platform === 'win32' ? 'rustc.exe' : 'rustc';
  const rustcPath = path.join(path.dirname(resolution.command), rustcName);
  if (!isFile(rustcPath)) return null;
  process.env.RUSTC = rustcPath;
  // Build scripts spawn `rustc` by name, so the toolchain directory must also be searchable.
  const toolchainBin = path.dirname(resolution.command);
  const currentPath = process.env.PATH || '';
  if (!currentPath.split(path.delimiter).includes(toolchainBin)) {
    process.env.PATH = `${toolchainBin}${path.delimiter}${currentPath}`;
  }
  return rustcPath;
}

/**
 * Resolves cargo and prepares the environment for it.
 *
 * @returns {{ command: string, source: string } | null} Resolution, or null when nothing was found.
 */
function prepareCargo() {
  const resolution = resolveCargo();
  pinRustc(resolution);
  if (process.platform === 'win32') {
    const homeRoot = os.homedir();
    const mingwBin = path.join(homeRoot, 'DevTools', 'mingw64', 'bin');
    if (fs.existsSync(mingwBin)) {
      const curPath = process.env.PATH || '';
      if (!curPath.split(path.delimiter).includes(mingwBin)) {
        process.env.PATH = `${mingwBin}${path.delimiter}${curPath}`;
      }
    }
    if (!process.env.CARGO_TARGET_DIR) {
      const defaultTarget = path.join(os.tmpdir(), 'taxis-cargo-target');
      if (!fs.existsSync(defaultTarget)) {
        try { fs.mkdirSync(defaultTarget, { recursive: true }); } catch {}
      }
      process.env.CARGO_TARGET_DIR = defaultTarget;
    }
  }
  return resolution;
}

/**
 * Command line entry point.
 *
 * @returns {void}
 */
function main() {
  const resolution = prepareCargo();
  if (!resolution) {
    console.error(
      `cargo was not found through ${OVERRIDE_VARIABLE}, ~/.cargo/bin, the rustup toolchain root, or PATH.`,
    );
    process.exit(1);
  }
  console.log(`cargo: ${resolution.command}`);
  console.log(`source: ${resolution.source}`);
  if (process.env.RUSTC) console.log(`rustc: ${process.env.RUSTC}`);
}

if (require.main === module) {
  main();
}

module.exports = Object.freeze({
  OVERRIDE_VARIABLE,
  resolveCargo,
  pinRustc,
  prepareCargo,
});
