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

/** Architecture layer constant for domain models and business logic. */
export const LAYER_DOMAIN: ArchitectureLayer = 'domain';

/** Architecture layer constant for application use cases and orchestrators. */
export const LAYER_APPLICATION: ArchitectureLayer = 'application';

/** Architecture layer constant for infrastructure, persistence, and external adapters. */
export const LAYER_INFRASTRUCTURE: ArchitectureLayer = 'infrastructure';

/** Architecture layer constant for presentation, API routes, and user interfaces. */
export const LAYER_INTERFACE: ArchitectureLayer = 'interface';

/** Architecture layer constant for automated test suites and test fixtures. */
export const LAYER_TEST: ArchitectureLayer = 'test';

/** Architecture layer constant for build scripts, developer tools, and deployment. */
export const LAYER_TOOLING: ArchitectureLayer = 'tooling';

/** Architecture layer constant for cross-cutting shared utilities and common types. */
export const LAYER_SHARED: ArchitectureLayer = 'shared';

/** Project archetype constant for tutorial, sample, or starter projects. */
export const ARCHETYPE_DEMO: ProjectArchetype = 'demo';

/** Project archetype constant for game engine and graphics applications. */
export const ARCHETYPE_GAME: ProjectArchetype = 'game';

/** Project archetype constant for web frontend and server applications. */
export const ARCHETYPE_WEB: ProjectArchetype = 'web';

/** Project archetype constant for standalone shared libraries and packages. */
export const ARCHETYPE_LIBRARY: ProjectArchetype = 'library';

/**
 * Project archetype constant for language standard libraries
 * (Rust core/std, CPython Lib, Go stdlib).
 */
export const ARCHETYPE_STDLIB: ProjectArchetype = 'stdlib';

/**
 * Project archetype constant for low-level systems runtimes,
 * microkernels, bare-metal or drivers.
 */
export const ARCHETYPE_SYSTEMS_RUNTIME: ProjectArchetype = 'systems_runtime';

interface LayerRule {
    readonly pattern: RegExp;
    readonly layer: ArchitectureLayer;
}

const LAYER_RULES: readonly LayerRule[] = [
    { pattern: /^(domain|domains|entities|models|core|domain_model)$/i, layer: LAYER_DOMAIN },
    {
        pattern: /^(app|application|applications|usecases|services|workflows|commands|queries)$/i,
        layer: LAYER_APPLICATION,
    },
    {
        pattern:
            /^(infra|infrastructure|infrastructures|persistence|repo|repositories|database|adapters|gateway)$/i,
        layer: LAYER_INFRASTRUCTURE,
    },
    {
        pattern: /^(interface|interfaces|presentation|api|controllers|frontend|ui|views|routes)$/i,
        layer: LAYER_INTERFACE,
    },
    { pattern: /^(test|tests|spec|specs|fixtures|guards|unit|integration)$/i, layer: LAYER_TEST },
    { pattern: /^(scripts|tools|tooling|build|ci|deploy)$/i, layer: LAYER_TOOLING },
    { pattern: /^(shared|common|utils|support|types)$/i, layer: LAYER_SHARED },
];

/**
 * Match a single path segment against architecture layer rules.
 *
 * @param segment - Individual path segment string.
 * @returns Matching ArchitectureLayer or undefined when no rule matches.
 */
function matchSegmentLayer(segment: string): ArchitectureLayer | undefined {
    for (const rule of LAYER_RULES) {
        if (rule.pattern.test(segment)) {
            return rule.layer;
        }
    }
    return undefined;
}

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
        const layer = matchSegmentLayer(segments[i]);
        if (layer) return layer;
    }

    return LAYER_SHARED;
}

/**
 * Inspect a directory entry to identify and record a subproject partition.
 *
 * @param ent - Directory entry from root readdir.
 * @param rootResolved - Absolute path of project root directory.
 * @param buildSystems - Set to accumulate discovered build systems.
 * @param frameworks - Set to accumulate discovered frameworks.
 * @param partitions - Array to append discovered partitions to.
 * @param directorySemantics - Map to record directory semantics into.
 */
function inspectPartitionEntry(
    ent: fs.Dirent,
    rootResolved: string,
    buildSystems: Set<string>,
    frameworks: Set<string>,
    partitions: ProjectPartition[],
    directorySemantics: Record<string, ArchitectureLayer>,
): void {
    if (!ent.isDirectory() || IGNORED_DIRS.has(ent.name) || ent.name.startsWith('.')) {
        return;
    }

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
            inspectPartitionEntry(
                ent,
                rootResolved,
                buildSystems,
                frameworks,
                partitions,
                directorySemantics,
            );
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
 * Queue a discovered subdirectory for recursive sampling traversal.
 *
 * @param item - Dirent representing a subdirectory.
 * @param currentDir - Absolute path of current directory.
 * @param currentDepth - Current depth in directory hierarchy.
 * @param rootResolved - Absolute path of project root.
 * @param directorySemantics - Map to record inferred semantics into.
 * @param dirQueue - Queue of directories scheduled for inspection.
 */
function queueSampledDirectory(
    item: fs.Dirent,
    currentDir: string,
    currentDepth: number,
    rootResolved: string,
    directorySemantics: Record<string, ArchitectureLayer>,
    dirQueue: Array<{ dir: string; depth: number }>,
): void {
    if (IGNORED_DIRS.has(item.name) || item.name.startsWith('.')) {
        return;
    }
    const subDir = path.join(currentDir, item.name);
    const relDir = path.relative(rootResolved, subDir);
    if (!directorySemantics[relDir]) {
        directorySemantics[relDir] = inferDirectorySemantic(relDir);
    }
    if (currentDepth + 1 <= LANGUAGE_SAMPLE_MAX_DEPTH) {
        dirQueue.push({ dir: subDir, depth: currentDepth + 1 });
    }
}

/**
 * Record observed file extension for language distribution sampling.
 *
 * @param fileName - Inspected file name.
 * @param languages - Map of language identifier to file count.
 * @returns 1 if extension matches a recognized language, 0 otherwise.
 */
function recordSampledFile(fileName: string, languages: Record<string, number>): number {
    const ext = path.extname(fileName).toLowerCase();
    const lang = EXT_TO_LANG[ext];
    if (lang) {
        languages[lang] = (languages[lang] || 0) + 1;
        return 1;
    }
    return 0;
}

/**
 * Read directory entries safely with file types, returning an empty array on error.
 *
 * @param dir - Directory path to list.
 * @returns Array of dirent items or empty array.
 */
function readDirectoryEntries(dir: string): fs.Dirent[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

/** Queue item for directory traversal during language sampling. */
interface DirectoryQueueItem {
    dir: string;
    depth: number;
}

/**
 * Process a single sampled dirent item (directory or file).
 *
 * @param item - Dirent to evaluate.
 * @param current - Current directory queue item.
 * @param rootResolved - Project root path.
 * @param directorySemantics - Directory semantics mapping.
 * @param dirQueue - Directory queue.
 * @param languages - Language count record.
 * @returns 1 if a language file was sampled, 0 otherwise.
 */
function processSampledItem(
    item: fs.Dirent,
    current: DirectoryQueueItem,
    rootResolved: string,
    directorySemantics: Record<string, ArchitectureLayer>,
    dirQueue: DirectoryQueueItem[],
    languages: Record<string, number>,
): number {
    if (item.isDirectory()) {
        queueSampledDirectory(
            item,
            current.dir,
            current.depth,
            rootResolved,
            directorySemantics,
            dirQueue,
        );
        return 0;
    }
    if (item.isFile()) {
        return recordSampledFile(item.name, languages);
    }
    return 0;
}

/**
 * Sample items within a single directory during language discovery.
 *
 * @param current - Current directory queue item.
 * @param rootResolved - Absolute path of project root directory.
 * @param directorySemantics - Map to record directory semantics into.
 * @param dirQueue - Queue of directories scheduled for inspection.
 * @param languages - Map of language identifier to observed count.
 * @param currentSampled - Number of files sampled prior to this directory.
 * @returns Number of new files sampled from this directory.
 */
function sampleItemsInDirectory(
    current: DirectoryQueueItem,
    rootResolved: string,
    directorySemantics: Record<string, ArchitectureLayer>,
    dirQueue: DirectoryQueueItem[],
    languages: Record<string, number>,
    currentSampled: number,
): number {
    let newlySampled = 0;
    const items = readDirectoryEntries(current.dir);
    for (const item of items) {
        if (currentSampled + newlySampled >= LANGUAGE_SAMPLE_MAX_FILES) break;
        newlySampled += processSampledItem(
            item,
            current,
            rootResolved,
            directorySemantics,
            dirQueue,
            languages,
        );
    }
    return newlySampled;
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
    const dirQueue: DirectoryQueueItem[] = [{ dir: rootResolved, depth: 0 }];

    while (dirQueue.length > 0 && sampled < LANGUAGE_SAMPLE_MAX_FILES) {
        const current = dirQueue.pop()!;
        if (current.depth > LANGUAGE_SAMPLE_MAX_DEPTH) continue;

        sampled += sampleItemsInDirectory(
            current,
            rootResolved,
            directorySemantics,
            dirQueue,
            languages,
            sampled,
        );
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

function isStdlibArchetype(root: string, profile?: Partial<ProjectProfile>): boolean {
    const normRoot = root.replace(/\\/g, '/');

    // 1. Rust standard library / core detection
    const cargoToml = path.join(root, 'Cargo.toml');
    if (fs.existsSync(cargoToml)) {
        try {
            const raw = fs.readFileSync(cargoToml, 'utf8');
            if (
                /name\s*=\s*["'](?:.*-)?(?:core|alloc|std)(?:-.*)?["']/i.test(raw) ||
                normRoot.includes('/library/core') ||
                normRoot.includes('/library/std') ||
                normRoot.includes('/library/alloc') ||
                fs.existsSync(path.join(root, 'library', 'core')) ||
                fs.existsSync(path.join(root, 'library', 'std'))
            ) {
                return true;
            }
        } catch {
            // best-effort fallback: ignored when file is unreadable
        }
    }

    // 2. Python standard library detection
    const isPythonTree = Boolean(profile?.languages?.['python']);
    if (
        (isPythonTree || fs.existsSync(path.join(root, 'Lib'))) &&
        (fs.existsSync(path.join(root, 'Include', 'Python.h')) ||
            (fs.existsSync(path.join(root, 'Lib', 'os.py')) &&
                fs.existsSync(path.join(root, 'Lib', 'sys.py'))))
    ) {
        return true;
    }

    // 3. Go standard library detection
    if (
        fs.existsSync(path.join(root, 'src', 'runtime')) &&
        fs.existsSync(path.join(root, 'src', 'sync')) &&
        (fs.existsSync(path.join(root, 'src', 'cmd', 'go')) ||
            fs.existsSync(path.join(root, 'src', 'net')))
    ) {
        return true;
    }

    // 4. Node.js built-in runtime detection
    if (
        fs.existsSync(path.join(root, 'lib', 'internal')) &&
        (fs.existsSync(path.join(root, 'src', 'node.h')) ||
            fs.existsSync(path.join(root, 'lib', 'fs.js')))
    ) {
        return true;
    }

    return false;
}

function isSystemsRuntimeArchetype(root: string, profile?: Partial<ProjectProfile>): boolean {
    void profile;
    const normRoot = root.replace(/\\/g, '/');

    // Check no_std marker in Rust root lib.rs/main.rs,
    // or immediate subdirectories (e.g. core/src/lib.rs)
    const candidateFiles = [
        path.join(root, 'src', 'lib.rs'),
        path.join(root, 'src', 'main.rs'),
        path.join(root, 'core', 'src', 'lib.rs'),
        path.join(root, 'kernel', 'src', 'lib.rs'),
        path.join(root, 'runtime', 'src', 'lib.rs'),
    ];

    for (const f of candidateFiles) {
        if (fs.existsSync(f)) {
            try {
                const header = fs.readFileSync(f, 'utf8').slice(0, 1000);
                if (header.includes('#![no_std]') || header.includes('#![no_core]')) {
                    return true;
                }
            } catch {
                // best-effort fallback: ignored when file is unreadable
            }
        }
    }

    const cargoToml = path.join(root, 'Cargo.toml');
    if (fs.existsSync(cargoToml)) {
        try {
            const raw = fs.readFileSync(cargoToml, 'utf8');
            if (
                /name\s*=\s*["'](?:sys-core|.*-kernel|.*-baremetal|.*-sys|.*-runtime)["']/i.test(
                    raw,
                )
            ) {
                return true;
            }
        } catch {
            // best-effort fallback
        }
    }

    if (
        normRoot.includes('/kernel') ||
        normRoot.includes('/runtime') ||
        normRoot.includes('/bare-metal') ||
        normRoot.includes('/freestanding')
    ) {
        return true;
    }

    return false;
}

/**
 * Classify project archetype (demo, web, game, library, stdlib, systems_runtime).
 *
 * @param root - Project root directory path.
 * @param profile - Optional ProjectProfile or partial profile indicators.
 * @param pkg - Optional parsed package.json object.
 * @returns Detected archetype.
 */
export function detectProjectArchetype(
    root: string,
    profile?: Partial<ProjectProfile>,
    pkg?: Record<string, any>,
): ProjectArchetype {
    if (profile?.archetype) return profile.archetype;
    const packageData = readPackageData(root, pkg);
    if (isStdlibArchetype(root, profile)) return ARCHETYPE_STDLIB;
    if (isSystemsRuntimeArchetype(root, profile)) return ARCHETYPE_SYSTEMS_RUNTIME;
    if (isDemoArchetype(root, packageData)) return ARCHETYPE_DEMO;
    if (isGameArchetype(root, profile)) return ARCHETYPE_GAME;
    if (isWebArchetype(profile, packageData)) return ARCHETYPE_WEB;
    return ARCHETYPE_LIBRARY;
}
