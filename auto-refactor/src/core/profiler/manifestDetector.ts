/**
 * Module: Core Profiler — Polyglot Manifest Detection
 * File Path: src/core/profiler/manifestDetector.ts
 * Architecture Role: Manifest inspection helper for project profiling; extracts build systems
 *   and frameworks across Node, Rust, Godot, Python, Go, JVM, .NET, Dart, and C/C++.
 * Dependencies & Triggers: Node fs and path; called by projectProfiler during discovery.
 * Responsibilities: Detect build tools and framework markers from files such as package.json,
 *   Cargo.toml, project.godot, pyproject.toml, go.mod, pom.xml, build.gradle, and CMakeLists.txt.
 * Exit Semantics & Design Rationale: Never throws on missing or malformed files; swallows I/O
 *   and parse errors gracefully so discovery degrades safely.
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Result of manifest stack inspection.
 */
export interface DirectoryStack {
    buildSystem?: string;
    frameworks: string[];
}

/**
 * Detect Node ecosystem build system and frameworks from package.json.
 *
 * @param dir - Directory path to inspect.
 * @param frameworks - Array to append discovered frameworks to.
 * @returns Discovered build system, or undefined if not a Node project.
 */
export function detectNodeStack(dir: string, frameworks: string[]): string | undefined {
    const pkgJsonPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return undefined;

    let buildSystem = 'npm';
    if (
        fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
        fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))
    ) {
        buildSystem = 'pnpm';
    } else if (fs.existsSync(path.join(dir, 'yarn.lock'))) {
        buildSystem = 'yarn';
    } else if (fs.existsSync(path.join(dir, 'bun.lockb'))) {
        buildSystem = 'bun';
    }

    try {
        const content = fs.readFileSync(pkgJsonPath, 'utf8');
        const pkg = JSON.parse(content);
        const allDeps = {
            ...(pkg.dependencies || {}),
            ...(pkg.devDependencies || {}),
            ...(pkg.peerDependencies || {}),
        };

        if (allDeps.react || allDeps['react-dom']) frameworks.push('react');
        if (allDeps.vue) frameworks.push('vue');
        if (allDeps.next) frameworks.push('next.js');
        if (allDeps.express) frameworks.push('express');
        if (allDeps['@nestjs/core']) frameworks.push('nestjs');
        if (allDeps.fastify) frameworks.push('fastify');
        if (allDeps.vscode || allDeps['@types/vscode']) frameworks.push('vscode-extension');
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
 * @returns 'cargo' if Cargo.toml exists, or undefined.
 */
export function detectRustStack(dir: string, frameworks: string[]): string | undefined {
    const cargoPath = path.join(dir, 'Cargo.toml');
    if (!fs.existsSync(cargoPath)) return undefined;

    try {
        const content = fs.readFileSync(cargoPath, 'utf8');
        if (content.includes('actix-web')) frameworks.push('actix-web');
        if (content.includes('axum')) frameworks.push('axum');
        if (content.includes('tokio')) frameworks.push('tokio');
        if (content.includes('tauri')) frameworks.push('tauri');
    } catch {
        // ignore
    }
    return 'cargo';
}

/**
 * Detect Python ecosystem build system and frameworks from pyproject/setup/requirements.
 *
 * @param dir - Directory path to inspect.
 * @param frameworks - Array to append discovered frameworks to.
 * @returns 'python' if Python manifests exist, or undefined.
 */
export function detectPythonStack(dir: string, frameworks: string[]): string | undefined {
    const pyprojectPath = path.join(dir, 'pyproject.toml');
    const setupPyPath = path.join(dir, 'setup.py');
    const reqsPath = path.join(dir, 'requirements.txt');

    if (!fs.existsSync(pyprojectPath) && !fs.existsSync(setupPyPath) && !fs.existsSync(reqsPath)) {
        return undefined;
    }

    try {
        const pyproject = fs.existsSync(pyprojectPath)
            ? fs.readFileSync(pyprojectPath, 'utf8')
            : '';
        const reqs = fs.existsSync(reqsPath) ? fs.readFileSync(reqsPath, 'utf8') : '';
        const combined = pyproject + '\n' + reqs;
        if (/django/i.test(combined)) frameworks.push('django');
        if (/fastapi/i.test(combined)) frameworks.push('fastapi');
        if (/flask/i.test(combined)) frameworks.push('flask');
        if (/pytest/i.test(combined)) frameworks.push('pytest');
    } catch {
        // ignore
    }
    return 'python';
}

/**
 * Detect Godot, Go, JVM, .NET, Dart, and C/C++ build systems and frameworks.
 *
 * @param dir - Directory path to inspect.
 * @param frameworks - Array to append discovered frameworks to.
 * @returns Discovered build system, or undefined.
 */
export function detectOtherBuildSystems(dir: string, frameworks: string[]): string | undefined {
    if (fs.existsSync(path.join(dir, 'project.godot'))) {
        frameworks.push('godot-engine');
        return 'godot';
    }
    if (fs.existsSync(path.join(dir, 'go.mod'))) {
        return 'go';
    }
    if (fs.existsSync(path.join(dir, 'pom.xml'))) {
        return 'maven';
    }
    if (
        fs.existsSync(path.join(dir, 'build.gradle')) ||
        fs.existsSync(path.join(dir, 'build.gradle.kts'))
    ) {
        return 'gradle';
    }
    if (
        fs.existsSync(path.join(dir, 'Directory.Build.props')) ||
        fs.existsSync(path.join(dir, 'global.json'))
    ) {
        return 'dotnet';
    }
    if (fs.existsSync(path.join(dir, 'pubspec.yaml'))) {
        frameworks.push('flutter');
        return 'pub';
    }
    if (fs.existsSync(path.join(dir, 'CMakeLists.txt'))) {
        return 'cmake';
    }
    if (fs.existsSync(path.join(dir, 'Makefile'))) {
        return 'make';
    }
    return undefined;
}

/**
 * Inspect a directory to extract package/build info and frameworks.
 *
 * @param dir - Directory path to inspect.
 * @returns Discovered build system and frameworks.
 */
export function inspectDirectoryStack(dir: string): DirectoryStack {
    const frameworks: string[] = [];
    const nodeBuild = detectNodeStack(dir, frameworks);
    const rustBuild = detectRustStack(dir, frameworks);
    const pythonBuild = detectPythonStack(dir, frameworks);
    const otherBuild = detectOtherBuildSystems(dir, frameworks);

    const buildSystem = nodeBuild || rustBuild || pythonBuild || otherBuild;
    return { buildSystem, frameworks };
}
