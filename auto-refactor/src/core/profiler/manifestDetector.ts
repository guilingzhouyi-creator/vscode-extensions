/**
 * Module: Core Profiler — Polyglot Manifest Detection
 * File Path: src/core/profiler/manifestDetector.ts
 * Architecture Role: Manifest inspection helper for project profiling; extracts build systems
 *   and frameworks across Node, Rust, Godot, Python, Go, JVM, .NET, Dart, and C/C++.
 * Dependencies & Triggers: Node fs and path; called by projectProfiler during discovery.
 * Responsibilities: Detect build tools and framework markers from files such as package.json,
 *   Cargo.toml, project.godot, pyproject.toml, go.mod, pom.xml, build.gradle, and CMakeLists.txt.
 * Exit Semantics & Design Rationale: One `readdir` per directory answers every "does this
 *   manifest exist?" question from memory instead of one blocking stat per candidate, and I/O or
 *   parse errors are swallowed so discovery degrades safely instead of throwing.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Node manifest file. */
const MANIFEST_PACKAGE_JSON = 'package.json';
/** Node workspace/lockfiles used to pick the package manager. */
const LOCKFILE_PNPM_WORKSPACE = 'pnpm-workspace.yaml';
const LOCKFILE_PNPM = 'pnpm-lock.yaml';
const LOCKFILE_YARN = 'yarn.lock';
const LOCKFILE_BUN = 'bun.lockb';
/** Rust, Python, and polyglot manifests. */
const MANIFEST_CARGO_TOML = 'Cargo.toml';
const MANIFEST_PYPROJECT = 'pyproject.toml';
const MANIFEST_SETUP_PY = 'setup.py';
const MANIFEST_REQUIREMENTS = 'requirements.txt';
const MANIFEST_GODOT = 'project.godot';
const MANIFEST_GO_MOD = 'go.mod';
const MANIFEST_POM = 'pom.xml';
const MANIFEST_GRADLE = 'build.gradle';
const MANIFEST_GRADLE_KTS = 'build.gradle.kts';
const MANIFEST_DOTNET_PROPS = 'Directory.Build.props';
const MANIFEST_DOTNET_GLOBAL = 'global.json';
const MANIFEST_PUBSPEC = 'pubspec.yaml';
const MANIFEST_CMAKE = 'CMakeLists.txt';
const MANIFEST_MAKEFILE = 'Makefile';
/** Build-system ids reported back to the profiler. */
const BUILD_NPM = 'npm';
const BUILD_PNPM = 'pnpm';
const BUILD_YARN = 'yarn';
const BUILD_BUN = 'bun';
const BUILD_CARGO = 'cargo';
const BUILD_PYTHON = 'python';
const BUILD_GODOT = 'godot';
const BUILD_GO = 'go';
const BUILD_MAVEN = 'maven';
const BUILD_GRADLE = 'gradle';
const BUILD_DOTNET = 'dotnet';
const BUILD_PUB = 'pub';
const BUILD_CMAKE = 'cmake';
const BUILD_MAKE = 'make';
/** Framework ids appended to the profile's framework list. */
const FRAMEWORK_REACT = 'react';
const FRAMEWORK_REACT_DOM = 'react-dom';
const FRAMEWORK_VUE = 'vue';
const FRAMEWORK_NEXT = 'next.js';
const FRAMEWORK_EXPRESS = 'express';
const FRAMEWORK_NESTJS = '@nestjs/core';
const FRAMEWORK_FASTIFY = 'fastify';
const FRAMEWORK_VSCODE = 'vscode-extension';
const FRAMEWORK_VSCODE_API = 'vscode';
const FRAMEWORK_VSCODE_TYPES = '@types/vscode';
const FRAMEWORK_ACTIX = 'actix-web';
const FRAMEWORK_AXUM = 'axum';
const FRAMEWORK_TOKIO = 'tokio';
const FRAMEWORK_TAURI = 'tauri';
const FRAMEWORK_DJANGO = 'django';
const FRAMEWORK_FASTAPI = 'fastapi';
const FRAMEWORK_FLASK = 'flask';
const FRAMEWORK_PYTEST = 'pytest';
const FRAMEWORK_GODOT = 'godot-engine';
const FRAMEWORK_FLUTTER = 'flutter';

/** Result of manifest stack inspection. */
export interface DirectoryStack {
    buildSystem?: string;
    frameworks: string[];
}

/** Membership probe over one directory's already-read entry names. */
export interface DirectoryIndex {
    /**
     * Report whether the directory contains an entry with this name.
     *
     * @param name - Entry name to look up.
     * @returns True when the entry is present.
     */
    has(name: string): boolean;
}

/**
 * Read one directory's entry names, so callers can answer many manifest questions from memory.
 *
 * @param dir - Directory path to list.
 * @returns A membership probe; an unreadable directory answers false for every name.
 */
function listDirectory(dir: string): DirectoryIndex {
    let names: Set<string>;
    try {
        names = new Set(fs.readdirSync(dir));
    } catch {
        names = new Set<string>();
    }
    return { has: (name: string) => names.has(name) };
}

/**
 * Pick the Node package manager from the workspace/lockfile markers present in the directory.
 *
 * @param index - Directory entry probe.
 * @returns The build-system id; 'npm' when no lockfile marker is present.
 */
function nodeBuildSystem(index: DirectoryIndex): string {
    if (index.has(LOCKFILE_PNPM_WORKSPACE) || index.has(LOCKFILE_PNPM)) return BUILD_PNPM;
    if (index.has(LOCKFILE_YARN)) return BUILD_YARN;
    if (index.has(LOCKFILE_BUN)) return BUILD_BUN;
    return BUILD_NPM;
}

/**
 * Append the Node frameworks declared by a parsed package.json dependency map.
 *
 * @param deps - Merged dependency map of package.json.
 * @param frameworks - Array to append discovered frameworks to.
 */
function collectNodeFrameworks(deps: Record<string, unknown>, frameworks: string[]): void {
    if (deps[FRAMEWORK_REACT] || deps[FRAMEWORK_REACT_DOM]) frameworks.push(FRAMEWORK_REACT);
    if (deps[FRAMEWORK_VUE]) frameworks.push(FRAMEWORK_VUE);
    if (deps[FRAMEWORK_NEXT]) frameworks.push(FRAMEWORK_NEXT);
    if (deps[FRAMEWORK_EXPRESS]) frameworks.push(FRAMEWORK_EXPRESS);
    if (deps[FRAMEWORK_NESTJS]) frameworks.push(FRAMEWORK_NESTJS);
    if (deps[FRAMEWORK_FASTIFY]) frameworks.push(FRAMEWORK_FASTIFY);
    if (deps[FRAMEWORK_VSCODE_API] || deps[FRAMEWORK_VSCODE_TYPES]) {
        frameworks.push(FRAMEWORK_VSCODE);
    }
}

/**
 * Detect Node ecosystem build system and frameworks from package.json.
 *
 * @param dir - Directory path to inspect.
 * @param frameworks - Array to append discovered frameworks to.
 * @param index - Optional pre-read directory index; built from `dir` when omitted.
 * @returns Discovered build system, or undefined if not a Node project.
 */
export function detectNodeStack(
    dir: string,
    frameworks: string[],
    index: DirectoryIndex = listDirectory(dir),
): string | undefined {
    if (!index.has(MANIFEST_PACKAGE_JSON)) return undefined;
    const buildSystem = nodeBuildSystem(index);
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_PACKAGE_JSON), 'utf8'));
        collectNodeFrameworks(
            {
                ...(pkg.dependencies || {}),
                ...(pkg.devDependencies || {}),
                ...(pkg.peerDependencies || {}),
            },
            frameworks,
        );
    } catch {
        // Ignored if invalid json
    }
    return buildSystem;
}

/**
 * Detect Rust ecosystem build system and frameworks from Cargo.toml.
 *
 * @param dir - Directory path to inspect.
 * @param frameworks - Array to append discovered frameworks to.
 * @param index - Optional pre-read directory index; built from `dir` when omitted.
 * @returns 'cargo' if Cargo.toml exists, or undefined.
 */
export function detectRustStack(
    dir: string,
    frameworks: string[],
    index: DirectoryIndex = listDirectory(dir),
): string | undefined {
    if (!index.has(MANIFEST_CARGO_TOML)) return undefined;
    try {
        const content = fs.readFileSync(path.join(dir, MANIFEST_CARGO_TOML), 'utf8');
        if (content.includes(FRAMEWORK_ACTIX)) frameworks.push(FRAMEWORK_ACTIX);
        if (content.includes(FRAMEWORK_AXUM)) frameworks.push(FRAMEWORK_AXUM);
        if (content.includes(FRAMEWORK_TOKIO)) frameworks.push(FRAMEWORK_TOKIO);
        if (content.includes(FRAMEWORK_TAURI)) frameworks.push(FRAMEWORK_TAURI);
    } catch {
        // ignore
    }
    return BUILD_CARGO;
}

/**
 * Read a manifest when present, returning an empty string when it is missing or unreadable.
 *
 * @param dir - Directory holding the manifest.
 * @param name - Manifest file name.
 * @param index - Directory entry probe.
 * @returns The file content, or an empty string.
 */
function readManifestIfPresent(dir: string, name: string, index: DirectoryIndex): string {
    if (!index.has(name)) return '';
    try {
        return fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
        return '';
    }
}

/**
 * Detect Python ecosystem build system and frameworks from pyproject/setup/requirements.
 *
 * @param dir - Directory path to inspect.
 * @param frameworks - Array to append discovered frameworks to.
 * @param index - Optional pre-read directory index; built from `dir` when omitted.
 * @returns 'python' if Python manifests exist, or undefined.
 */
export function detectPythonStack(
    dir: string,
    frameworks: string[],
    index: DirectoryIndex = listDirectory(dir),
): string | undefined {
    const hasPythonManifest =
        index.has(MANIFEST_PYPROJECT) ||
        index.has(MANIFEST_SETUP_PY) ||
        index.has(MANIFEST_REQUIREMENTS);
    if (!hasPythonManifest) return undefined;

    const combined =
        readManifestIfPresent(dir, MANIFEST_PYPROJECT, index) +
        '\n' +
        readManifestIfPresent(dir, MANIFEST_REQUIREMENTS, index);
    if (/django/i.test(combined)) frameworks.push(FRAMEWORK_DJANGO);
    if (/fastapi/i.test(combined)) frameworks.push(FRAMEWORK_FASTAPI);
    if (/flask/i.test(combined)) frameworks.push(FRAMEWORK_FLASK);
    if (/pytest/i.test(combined)) frameworks.push(FRAMEWORK_PYTEST);
    return BUILD_PYTHON;
}

/**
 * Detect Godot, Go, JVM, .NET, Dart, and C/C++ build systems and frameworks.
 *
 * @param dir - Directory path to inspect.
 * @param frameworks - Array to append discovered frameworks to.
 * @param index - Optional pre-read directory index; built from `dir` when omitted.
 * @returns Discovered build system, or undefined.
 */
export function detectOtherBuildSystems(
    dir: string,
    frameworks: string[],
    index: DirectoryIndex = listDirectory(dir),
): string | undefined {
    if (index.has(MANIFEST_GODOT)) {
        frameworks.push(FRAMEWORK_GODOT);
        return BUILD_GODOT;
    }
    if (index.has(MANIFEST_GO_MOD)) return BUILD_GO;
    if (index.has(MANIFEST_POM)) return BUILD_MAVEN;
    if (index.has(MANIFEST_GRADLE) || index.has(MANIFEST_GRADLE_KTS)) return BUILD_GRADLE;
    if (index.has(MANIFEST_DOTNET_PROPS) || index.has(MANIFEST_DOTNET_GLOBAL)) return BUILD_DOTNET;
    if (index.has(MANIFEST_PUBSPEC)) {
        frameworks.push(FRAMEWORK_FLUTTER);
        return BUILD_PUB;
    }
    if (index.has(MANIFEST_CMAKE)) return BUILD_CMAKE;
    if (index.has(MANIFEST_MAKEFILE)) return BUILD_MAKE;
    return undefined;
}

/**
 * Inspect a directory to extract package/build info and frameworks.
 *
 * The directory listing is read ONCE and shared by every detector, so a polyglot directory costs
 * one readdir plus at most one read per present manifest.
 *
 * @param dir - Directory path to inspect.
 * @returns Discovered build system and frameworks.
 */
export function inspectDirectoryStack(dir: string): DirectoryStack {
    const frameworks: string[] = [];
    const index = listDirectory(dir);
    const nodeBuild = detectNodeStack(dir, frameworks, index);
    const rustBuild = detectRustStack(dir, frameworks, index);
    const pythonBuild = detectPythonStack(dir, frameworks, index);
    const otherBuild = detectOtherBuildSystems(dir, frameworks, index);

    const buildSystem = nodeBuild || rustBuild || pythonBuild || otherBuild;
    return { buildSystem, frameworks };
}
