/**
 * Module: Core Profiler — Polyglot Project Discovery & Maturity Classification
 * File Path: src/core/profiler/projectProfiler.ts
 * Architecture Role: Read-only project profiling adapter for the core engine; converts a root
 *   directory into the ProjectProfile that config resolution uses for scale/maturity tuning.
 * Dependencies & Triggers: Node fs/path, manifestDetector, maturityClassifier, types;
 *   called by config resolution before analyzers run and callers needing project detection.
 * Responsibilities: Coordinate build system and framework discovery, directory semantics
 *   mapping, language distribution sampling, partition registration, and archetype detection.
 * Exit Semantics & Design Rationale: Never throws on unreadable manifests; sampling depth and
 *   file limits prevent unbounded directory traversals on large repositories.
 */
import * as fs from 'fs';
import * as path from 'path';
import type {
    ProjectProfile,
    ProjectPartition,
    ArchitectureLayer,
    ProjectArchetype,
} from '../types';
import type { DirectoryStack } from './manifestDetector';
import { inspectDirectoryStack } from './manifestDetector';
import { detectMaturityTier } from './maturityClassifier';

export { ProjectArchetype, detectMaturityTier };

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
 * Collect partitions and directory semantics for direct subdirectories of the project root.
 *
 * @param rootResolved - Absolute project root directory path.
 * @param rootStack - Discovered stack for the project root itself.
 * @param directorySemantics - Map to record directory semantics into.
 * @returns Object containing discovered partitions, buildSystems, and frameworks.
 */
function collectPartitions(
    rootResolved: string,
    rootStack: DirectoryStack,
    directorySemantics: Record<string, ArchitectureLayer>,
): {
    partitions: ProjectPartition[];
    buildSystems: Set<string>;
    frameworks: Set<string>;
} {
    const buildSystems = new Set<string>();
    if (rootStack.buildSystem) buildSystems.add(rootStack.buildSystem);

    const frameworks = new Set<string>(rootStack.frameworks);
    const partitions: ProjectPartition[] = [];

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

            directorySemantics[ent.name] = inferDirectorySemantic(ent.name);
        }
    } catch {
        // Best-effort: if readdir fails, proceed with rootStack
    }

    if (partitions.length === 0 && rootStack.buildSystem) {
        partitions.push({
            name: path.basename(rootResolved),
            path: '.',
            buildSystem: rootStack.buildSystem,
            frameworks: rootStack.frameworks,
        });
    }

    return { partitions, buildSystems, frameworks };
}

/**
 * Iteratively sample directory files to determine language distribution.
 *
 * @param rootResolved - Absolute project root directory path.
 * @param directorySemantics - Map to record directory semantics for discovered subdirectories.
 * @returns Map of language identifier to observed file count.
 */
function sampleDirectoryLanguages(
    rootResolved: string,
    directorySemantics: Record<string, ArchitectureLayer>,
): Record<string, number> {
    const languages: Record<string, number> = {};
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

    return languages;
}

/**
 * Determine the dominant language from sampled language counts.
 *
 * @param languages - Map of language identifier to file count.
 * @returns Dominant language id, defaulting to 'typescript'.
 */
function resolvePrimaryLanguage(languages: Record<string, number>): string {
    let maxCount = 0;
    let primaryLanguage = TYPESCRIPT_LANGUAGE_ID;
    for (const [lang, count] of Object.entries(languages)) {
        if (count > maxCount) {
            maxCount = count;
            primaryLanguage = lang;
        }
    }
    return primaryLanguage;
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
    const directorySemantics: Record<string, ArchitectureLayer> = {};

    const { partitions, buildSystems, frameworks } = collectPartitions(
        rootResolved,
        rootStack,
        directorySemantics,
    );

    const languages = sampleDirectoryLanguages(rootResolved, directorySemantics);
    const primaryLanguage = resolvePrimaryLanguage(languages);

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
