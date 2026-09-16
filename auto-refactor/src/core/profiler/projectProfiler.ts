/**
 * Module: Core Profiler — Polyglot Project Discovery & Maturity Classification
 * File Path: src/core/profiler/projectProfiler.ts
 * Architecture Role: Read-only project profiling adapter for the core engine; converts a root
 *   directory into the ProjectProfile that config resolution uses for scale/maturity tuning.
 * Dependencies & Triggers: Node `fs`/`path` plus ProjectProfile, ProjectPartition,
 *   ArchitectureLayer, and MaturityTier from ../types; called by config resolution before
 *   analyzers run and by any caller that needs language/framework/build-system detection.
 * Responsibilities: Detect build systems (npm/pnpm/yarn/bun, cargo, godot, python, go, maven,
 *   gradle, dotnet, pub, cmake, make) and frameworks from manifests; map directory segments to
 *   domain/application/infrastructure/interface/test/tooling/shared layers; sample up to 500
 *   files within four directory levels to count languages and pick a primary; register
 *   monorepo partitions; and classify maturity as demo/prototype/production/industrial.
 * Exit Semantics & Design Rationale: Never throws on unreadable or malformed manifests - each
 *   readdir/readFile/JSON.parse failure is swallowed so profiling degrades to partial data
 *   instead of blocking a scan; the 500-file/depth-4 cap bounds discovery cost on huge trees;
 *   an unknown language mix falls back to 'typescript' and unknown maturity to 'production'.
 */
import * as fs from 'fs';
import * as path from 'path';
import type {
    ProjectProfile,
    ProjectPartition,
    ArchitectureLayer,
    MaturityTier,
    ProjectArchetype,
} from '../types';
export { ProjectArchetype };

/** Language id reported for TypeScript files; also the no-language fallback. */
const TYPESCRIPT_LANGUAGE_ID = 'typescript';

/** Language id reported for JavaScript files in the extension-to-language map. */
const JAVASCRIPT_LANGUAGE_ID = 'javascript';

/**
 * File extension to language id mapping.
 */
const EXT_TO_LANG: Record<string, string> = {
    '.ts': TYPESCRIPT_LANGUAGE_ID,
    '.tsx': TYPESCRIPT_LANGUAGE_ID,
    '.mts': TYPESCRIPT_LANGUAGE_ID,
    '.cts': TYPESCRIPT_LANGUAGE_ID,
    '.js': JAVASCRIPT_LANGUAGE_ID,
    '.jsx': JAVASCRIPT_LANGUAGE_ID,
    '.mjs': JAVASCRIPT_LANGUAGE_ID,
    '.cjs': JAVASCRIPT_LANGUAGE_ID,
    '.gd': 'gdscript',
    '.rs': 'rust',
    '.py': 'python',
    '.sh': 'shell',
    '.bash': 'shell',
    '.ps1': 'powershell',
    '.go': 'go',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.java': 'java',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.cs': 'csharp',
    '.dart': 'dart',
    '.swift': 'swift',
    '.lua': 'lua',
    '.rb': 'ruby',
};

const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    '.auto-refactor-cache',
    'dist',
    'build',
    'target',
    '__pycache__',
    '.venv',
    'venv',
    '.godot',
    '.import',
]);

/**
 * Maximum number of files sampled when counting language distribution; bounds discovery cost on
 * very large trees.
 */
const LANGUAGE_SAMPLE_MAX_FILES = 500;

/**
 * Maximum directory depth descended by the language sampling walk, relative to the project root
 * (the root itself is depth 0).
 */
const LANGUAGE_SAMPLE_MAX_DEPTH = 4;

/**
 * Infer the architectural layer that a directory path belongs to.
 *
 * Segments are inspected right-to-left and the first one matching a layer vocabulary wins, so
 * the closest enclosing convention (for example `domain`) overrides a broader ancestor.
 *
 * @param dirPath - Directory or file path to classify; `/` and `\` separators are both accepted.
 * @returns The matching ArchitectureLayer, or 'shared' when no segment matches a known layer.
 */
export function inferDirectorySemantic(dirPath: string): ArchitectureLayer {
    const norm = dirPath.replace(/\\/g, '/').toLowerCase();
    const segments = norm.split('/').filter(Boolean);

    for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i];
        if (/^(domain|domains|entities|models|core|domain_model)$/i.test(s)) return 'domain';
        if (
            /^(app|application|applications|usecases|services|workflows|commands|queries)$/i.test(s)
        )
            return 'application';
        if (
            /^(infra|infrastructure|infrastructures|persistence|repo|repositories|database|adapters|gateway)$/i.test(
                s,
            )
        )
            return 'infrastructure';
        if (
            /^(interface|interfaces|presentation|api|controllers|frontend|ui|views|routes)$/i.test(
                s,
            )
        )
            return 'interface';
        if (/^(test|tests|spec|specs|fixtures|guards|unit|integration)$/i.test(s)) return 'test';
        if (/^(scripts|tools|tooling|build|ci|deploy)$/i.test(s)) return 'tooling';
        if (/^(shared|common|utils|support|types)$/i.test(s)) return 'shared';
    }

    return 'shared';
}

/**
 * Inspect a directory to extract package/build info and frameworks.
 */
function inspectDirectoryStack(dir: string): {
    buildSystem?: string;
    frameworks: string[];
} {
    const frameworks: string[] = [];
    let buildSystem: string | undefined;

    // Node ecosystem
    const pkgJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
        buildSystem = 'npm';
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
    }

    // Rust ecosystem
    const cargoPath = path.join(dir, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
        buildSystem ||= 'cargo';
        try {
            const content = fs.readFileSync(cargoPath, 'utf8');
            if (content.includes('actix-web')) frameworks.push('actix-web');
            if (content.includes('axum')) frameworks.push('axum');
            if (content.includes('tokio')) frameworks.push('tokio');
            if (content.includes('tauri')) frameworks.push('tauri');
        } catch {
            // ignore
        }
    }

    // Godot Engine
    const godotPath = path.join(dir, 'project.godot');
    if (fs.existsSync(godotPath)) {
        buildSystem ||= 'godot';
        frameworks.push('godot-engine');
    }

    // Python ecosystem
    if (
        fs.existsSync(path.join(dir, 'pyproject.toml')) ||
        fs.existsSync(path.join(dir, 'setup.py')) ||
        fs.existsSync(path.join(dir, 'requirements.txt'))
    ) {
        buildSystem ||= 'python';
        try {
            const pyproject = fs.existsSync(path.join(dir, 'pyproject.toml'))
                ? fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8')
                : '';
            const reqs = fs.existsSync(path.join(dir, 'requirements.txt'))
                ? fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8')
                : '';
            const combined = pyproject + '\n' + reqs;
            if (/django/i.test(combined)) frameworks.push('django');
            if (/fastapi/i.test(combined)) frameworks.push('fastapi');
            if (/flask/i.test(combined)) frameworks.push('flask');
            if (/pytest/i.test(combined)) frameworks.push('pytest');
        } catch {
            // ignore
        }
    }

    // Go ecosystem
    if (fs.existsSync(path.join(dir, 'go.mod'))) {
        buildSystem ||= 'go';
    }

    // Java / Kotlin ecosystem
    if (fs.existsSync(path.join(dir, 'pom.xml'))) {
        buildSystem ||= 'maven';
    } else if (
        fs.existsSync(path.join(dir, 'build.gradle')) ||
        fs.existsSync(path.join(dir, 'build.gradle.kts'))
    ) {
        buildSystem ||= 'gradle';
    }

    // C# / .NET ecosystem
    if (
        fs.existsSync(path.join(dir, 'Directory.Build.props')) ||
        fs.existsSync(path.join(dir, 'global.json'))
    ) {
        buildSystem ||= 'dotnet';
    }

    // Dart / Flutter
    if (fs.existsSync(path.join(dir, 'pubspec.yaml'))) {
        buildSystem ||= 'pub';
        frameworks.push('flutter');
    }

    // C/C++ / CMake / Make
    if (fs.existsSync(path.join(dir, 'CMakeLists.txt'))) {
        buildSystem ||= 'cmake';
    } else if (fs.existsSync(path.join(dir, 'Makefile'))) {
        buildSystem ||= 'make';
    }

    return { buildSystem, frameworks };
}

/**
 * Profile a project root into the ProjectProfile consumed by config scale/maturity tuning.
 *
 * Reads manifests to discover build systems and frameworks, maps direct subdirectories to
 * architecture layers, samples at most 500 files within four levels to count languages, records
 * monorepo partitions, and derives whether the project is polyglot.
 *
 * @param root - Project root directory to inspect; relative values resolve against the cwd.
 * @returns A profile with build systems, frameworks, language counts, the dominant language
 *          (fallback 'typescript'), directory semantics, partitions and the polyglot flag.
 */
export function detectProjectProfile(root: string): ProjectProfile {
    const rootResolved = path.resolve(root);
    const rootStack = inspectDirectoryStack(rootResolved);

    const buildSystems = new Set<string>();
    if (rootStack.buildSystem) buildSystems.add(rootStack.buildSystem);

    const frameworks = new Set<string>(rootStack.frameworks);
    const languages: Record<string, number> = {};
    const directorySemantics: Record<string, ArchitectureLayer> = {};
    const partitions: ProjectPartition[] = [];

    // Inspect subdirectories for monorepo partitions and language distributions
    try {
        const entries = fs.readdirSync(rootResolved, { withFileTypes: true });

        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            if (IGNORED_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;

            const subPath = path.join(rootResolved, ent.name);
            const subStack = inspectDirectoryStack(subPath);

            if (subStack.buildSystem || subStack.frameworks.length > 0) {
                if (subStack.buildSystem) buildSystems.add(subStack.buildSystem);
                for (const fw of subStack.frameworks) frameworks.add(fw);

                partitions.push({
                    name: ent.name,
                    path: ent.name,
                    buildSystem: subStack.buildSystem,
                    frameworks: subStack.frameworks,
                });
            }

            // Record directory semantic
            directorySemantics[ent.name] = inferDirectorySemantic(ent.name);
        }
    } catch {
        // Best-effort: if readdir fails, proceed with rootStack
    }

    // If root itself has no partitions, register root as partition
    if (partitions.length === 0 && rootStack.buildSystem) {
        partitions.push({
            name: path.basename(rootResolved),
            path: '.',
            buildSystem: rootStack.buildSystem,
            frameworks: rootStack.frameworks,
        });
    }

    // Fast iterative sample for languages (max 500 files to avoid unbounded walk)
    let sampled = 0;
    const dirQueue: Array<{ dir: string; depth: number }> = [{ dir: rootResolved, depth: 0 }];

    while (dirQueue.length > 0 && sampled < LANGUAGE_SAMPLE_MAX_FILES) {
        const current = dirQueue.pop()!;
        if (current.depth > LANGUAGE_SAMPLE_MAX_DEPTH) continue;

        try {
            const items = fs.readdirSync(current.dir, { withFileTypes: true });
            for (const item of items) {
                if (sampled >= LANGUAGE_SAMPLE_MAX_FILES) break;
                if (item.isDirectory()) {
                    if (!IGNORED_DIRS.has(item.name) && !item.name.startsWith('.')) {
                        const subDir = path.join(current.dir, item.name);
                        const relDir = path.relative(rootResolved, subDir);
                        if (!directorySemantics[relDir]) {
                            directorySemantics[relDir] = inferDirectorySemantic(relDir);
                        }
                        if (current.depth + 1 <= LANGUAGE_SAMPLE_MAX_DEPTH) {
                            dirQueue.push({ dir: subDir, depth: current.depth + 1 });
                        }
                    }
                } else if (item.isFile()) {
                    const ext = path.extname(item.name).toLowerCase();
                    const lang = EXT_TO_LANG[ext];
                    if (lang) {
                        languages[lang] = (languages[lang] || 0) + 1;
                        sampled++;
                    }
                }
            }
        } catch {
            // ignore
        }
    }

    // Determine primary language
    let maxCount = 0;
    let primaryLanguage = TYPESCRIPT_LANGUAGE_ID;
    for (const [lang, count] of Object.entries(languages)) {
        if (count > maxCount) {
            maxCount = count;
            primaryLanguage = lang;
        }
    }

    const distinctLanguages = Object.keys(languages);
    const isPolyglot = distinctLanguages.length > 1 || partitions.length > 1;
    const partialProfile = {
        buildSystems: Array.from(buildSystems),
        languages,
        primaryLanguage,
        frameworks: Array.from(frameworks),
        directorySemantics,
        isPolyglot,
        partitions,
    };
    const archetype = detectProjectArchetype(root, partialProfile);

    return {
        ...partialProfile,
        archetype,
    };
}

/**
 * Classify the project maturity tier from its path, package manifest, and build files.
 *
 * Demo paths, demo-like package names, and version '0.0.0' map to 'demo'; missing tests or a
 * '0.0.x' version map to 'prototype'; CI plus tests plus lint/audit gates with a 1.x/2.x or
 * public version map to 'industrial'; every other manifest falls back to 'production'.
 *
 * @param root - Project root directory whose path and manifests are inspected.
 * @param pkg - Parsed package.json; when omitted it is read from `root` when present.
 * @returns The best matching MaturityTier; unreadable manifests leave the default 'production'.
 */
export function detectMaturityTier(root: string, pkg?: Record<string, any>): MaturityTier {
    const normRoot = root.replace(/\\/g, '/');
    if (/(?:demo|samples?|examples?|tutorial|starter|playground)/i.test(normRoot)) {
        return 'demo';
    }

    // Check package.json if present
    let packageData = pkg;
    if (!packageData) {
        const pkgPath = path.join(root, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                packageData = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            } catch {
                // ignore
            }
        }
    }

    if (packageData) {
        const name = String(packageData.name || '');
        const version = String(packageData.version || '');
        if (/(?:demo|samples?|examples?|tutorial)/i.test(name) || version === '0.0.0') {
            return 'demo';
        }

        const scripts = packageData.scripts || {};
        const hasTests = !!(scripts.test || scripts['test:unit']);
        const hasLintOrAudit = !!(scripts.lint || scripts.audit || scripts.check);
        const hasCi =
            fs.existsSync(path.join(root, '.github', 'workflows')) ||
            fs.existsSync(path.join(root, '.gitlab-ci.yml'));

        // Industrial: version >= 1.0.0 or 0.x with comprehensive CI, audit, and strict test gates
        if (
            hasCi &&
            hasTests &&
            hasLintOrAudit &&
            (version.startsWith('1.') || version.startsWith('2.') || packageData.private === false)
        ) {
            return 'industrial';
        }

        // Prototype: 0.0.x or no tests
        if (version.startsWith('0.0.') || !hasTests) {
            return 'prototype';
        }

        return 'production';
    }

    // Rust Cargo.toml check
    const cargoPath = path.join(root, 'Cargo.toml');
    if (fs.existsSync(cargoPath)) {
        try {
            const content = fs.readFileSync(cargoPath, 'utf8');
            if (content.includes('version = "0.0.')) return 'prototype';
            if (content.includes('[workspace]')) return 'industrial';
        } catch {
            // ignore
        }
    }

    return 'production';
}

const GAME_FRAMEWORKS = new Set(['godot-engine', 'unity', 'unreal', 'phaser', 'pixi']);

const WEB_FRAMEWORKS = new Set([
    'react',
    'vue',
    'angular',
    'svelte',
    'next',
    'nuxt',
    'express',
    'fastify',
    'nest',
    'koa',
    'fastapi',
    'django',
    'flask',
    'axum',
    'actix-web',
    'flutter',
]);

function readPackageData(root: string, pkg?: Record<string, any>): Record<string, any> | null {
    if (pkg) return pkg;
    const pkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
        return null;
    }
}

function isDemoArchetype(root: string, packageData: Record<string, any> | null): boolean {
    const normRoot = root.replace(/\\/g, '/').toLowerCase();
    if (/(?:demo|samples?|examples?|tutorial|starter|playground)/i.test(normRoot)) {
        return true;
    }
    if (!packageData) return false;
    const name = String(packageData.name || '');
    const version = String(packageData.version || '');
    return /(?:demo|samples?|examples?|tutorial)/i.test(name) || version === '0.0.0';
}

function isGameArchetype(root: string, profile?: Partial<ProjectProfile>): boolean {
    if (profile?.primaryLanguage === 'gdscript') return true;
    if ((profile?.languages?.['gdscript'] ?? 0) > 0) return true;
    if (fs.existsSync(path.join(root, 'project.godot'))) return true;
    for (const f of profile?.frameworks ?? []) {
        if (GAME_FRAMEWORKS.has(f.toLowerCase())) return true;
    }
    return false;
}

function isWebArchetype(
    profile?: Partial<ProjectProfile>,
    packageData?: Record<string, any> | null,
): boolean {
    for (const f of profile?.frameworks ?? []) {
        if (WEB_FRAMEWORKS.has(f.toLowerCase())) return true;
    }
    if (!packageData) return false;
    const allDeps = {
        ...packageData.dependencies,
        ...packageData.devDependencies,
        ...packageData.peerDependencies,
    };
    for (const key of Object.keys(allDeps)) {
        if (WEB_FRAMEWORKS.has(key) || key === '@angular/core' || key === '@nestjs/core') {
            return true;
        }
    }
    return false;
}

/**
 * Classify project archetype (demo, web, game, library) to drive sparse reviewer routing.
 *
 * @param root - Project root directory path.
 * @param profile - Optional ProjectProfile or partial profile indicators.
 * @param pkg - Optional parsed package.json object.
 * @returns Detected archetype ('demo' | 'web' | 'game' | 'library').
 */
export function detectProjectArchetype(
    root: string,
    profile?: Partial<ProjectProfile>,
    pkg?: Record<string, any>,
): ProjectArchetype {
    if (profile?.archetype) return profile.archetype;
    const packageData = readPackageData(root, pkg);
    if (isDemoArchetype(root, packageData)) return 'demo';
    if (isGameArchetype(root, profile)) return 'game';
    if (isWebArchetype(profile, packageData)) return 'web';
    return 'library';
}
