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
const GDSCRIPT_LANGUAGE_ID = 'gdscript';
const RUST_LANGUAGE_ID = 'rust';
const PYTHON_LANGUAGE_ID = 'python';
const SHELL_LANGUAGE_ID = 'shell';
const POWERSHELL_LANGUAGE_ID = 'powershell';
const GO_LANGUAGE_ID = 'go';
const C_LANGUAGE_ID = 'c';
const CPP_LANGUAGE_ID = 'cpp';
const JAVA_LANGUAGE_ID = 'java';
const KOTLIN_LANGUAGE_ID = 'kotlin';
const CSHARP_LANGUAGE_ID = 'csharp';
const DART_LANGUAGE_ID = 'dart';
const SWIFT_LANGUAGE_ID = 'swift';
const LUA_LANGUAGE_ID = 'lua';
const RUBY_LANGUAGE_ID = 'ruby';

const FILE_PACKAGE_JSON = 'package.json';
const FILE_PROJECT_GODOT = 'project.godot';
const FILE_CARGO_TOML = 'Cargo.toml';
const FILE_LIB_RS = 'lib.rs';
const FILE_MAIN_RS = 'main.rs';
const FILE_PYTHON_H = 'Python.h';
const FILE_OS_PY = 'os.py';
const FILE_SYS_PY = 'sys.py';
const FILE_NODE_H = 'node.h';
const FILE_FS_JS = 'fs.js';

const DIR_SRC = 'src';
const DIR_LIB = 'lib';
const DIR_INTERNAL = 'internal';
const DIR_RUNTIME = 'runtime';
const DIR_SYNC = 'sync';
const DIR_CMD = 'cmd';
const DIR_NET = 'net';
const DIR_INCLUDE = 'Include';
const DIR_LIB_TITLE = 'Lib';
const DIR_LIBRARY = 'library';
const DIR_CORE = 'core';
const DIR_STD = 'std';
const DIR_ALLOC = 'alloc';
const DIR_KERNEL = 'kernel';

const KERNEL_PATH_SEGMENT = '/kernel';
const RUNTIME_PATH_SEGMENT = '/runtime';
const BARE_METAL_PATH_SEGMENT = '/bare-metal';
const FREESTANDING_PATH_SEGMENT = '/freestanding';
const CORE_LIBRARY_PATH_SEGMENT = '/library/core';
const STD_LIBRARY_PATH_SEGMENT = '/library/std';
const ALLOC_LIBRARY_PATH_SEGMENT = '/library/alloc';

const MAX_PARTITION_SAMPLE_CAP = 2500;
const SAMPLES_PER_PARTITION = 150;

const HEADER_PREVIEW_SLICE_LIMIT = 1000;
const VERSION_ZERO = '0.0.0';

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
    '.gd': GDSCRIPT_LANGUAGE_ID,
    '.rs': RUST_LANGUAGE_ID,
    '.py': PYTHON_LANGUAGE_ID,
    '.sh': SHELL_LANGUAGE_ID,
    '.bash': SHELL_LANGUAGE_ID,
    '.ps1': POWERSHELL_LANGUAGE_ID,
    '.go': GO_LANGUAGE_ID,
    '.c': C_LANGUAGE_ID,
    '.cpp': CPP_LANGUAGE_ID,
    '.h': C_LANGUAGE_ID,
    '.hpp': CPP_LANGUAGE_ID,
    '.java': JAVA_LANGUAGE_ID,
    '.kt': KOTLIN_LANGUAGE_ID,
    '.kts': KOTLIN_LANGUAGE_ID,
    '.cs': CSHARP_LANGUAGE_ID,
    '.dart': DART_LANGUAGE_ID,
    '.swift': SWIFT_LANGUAGE_ID,
    '.lua': LUA_LANGUAGE_ID,
    '.rb': RUBY_LANGUAGE_ID,
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

interface PartitionInspectionContext {
    readonly rootResolved: string;
    readonly buildSystems: Set<string>;
    readonly frameworks: Set<string>;
    readonly partitions: ProjectPartition[];
    readonly directorySemantics: Record<string, ArchitectureLayer>;
}

/**
 * Inspect direct subdirectory of project root for manifest signals and architecture semantics.
 *
 * @param ent - Directory entry to inspect.
 * @param context - Inspection context with accumulation collections.
 */
function inspectPartitionEntry(ent: fs.Dirent, context: PartitionInspectionContext): void {
    if (!ent.isDirectory() || IGNORED_DIRS.has(ent.name) || ent.name.startsWith('.')) {
        return;
    }

    const subPath = path.join(context.rootResolved, ent.name);
    const subStack = inspectDirectoryStack(subPath);

    if (subStack.buildSystem || subStack.frameworks.length > 0) {
        if (subStack.buildSystem) context.buildSystems.add(subStack.buildSystem);
        for (const framework of subStack.frameworks) context.frameworks.add(framework);

        context.partitions.push({
            name: ent.name,
            path: ent.name,
            buildSystem: subStack.buildSystem,
            frameworks: subStack.frameworks,
        });
    }

    context.directorySemantics[ent.name] = inferDirectorySemantic(ent.name);
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
    const partitionContext: PartitionInspectionContext = {
        rootResolved,
        buildSystems,
        frameworks,
        partitions,
        directorySemantics,
    };

    try {
        const entries = fs.readdirSync(rootResolved, { withFileTypes: true });
        for (const ent of entries) {
            inspectPartitionEntry(ent, partitionContext);
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

interface DirectorySamplingContext {
    readonly rootResolved: string;
    readonly directorySemantics: Record<string, ArchitectureLayer>;
    readonly dirQueue: DirectoryQueueItem[];
    readonly languages: Record<string, number>;
}

interface DirectorySampleBudget {
    readonly currentSampled: number;
    readonly maxSampleFiles: number;
}

/**
 * Queue a discovered subdirectory for recursive sampling traversal.
 *
 * @param dirEntry - Dirent representing a subdirectory.
 * @param current - Current directory queue item.
 * @param context - Directory sampling context.
 */
function queueSampledDirectory(
    dirEntry: fs.Dirent,
    current: DirectoryQueueItem,
    context: DirectorySamplingContext,
): void {
    if (IGNORED_DIRS.has(dirEntry.name) || dirEntry.name.startsWith('.')) {
        return;
    }
    const subDir = path.join(current.dir, dirEntry.name);
    const relDir = path.relative(context.rootResolved, subDir);
    if (!context.directorySemantics[relDir]) {
        context.directorySemantics[relDir] = inferDirectorySemantic(relDir);
    }
    if (current.depth + 1 <= LANGUAGE_SAMPLE_MAX_DEPTH) {
        context.dirQueue.push({ dir: subDir, depth: current.depth + 1 });
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

/** Result of stratified directory language sampling. */
interface SampleLanguagesResult {
    languages: Record<string, number>;
    totalDiscoveredFiles: number;
}

/**
 * Sample items within a single directory during language discovery.
 *
 * @param current - Current directory queue item.
 * @param context - Shared sampling context.
 * @param budget - Sampling counters and capacity limits.
 * @returns Tuple of [newlySampledCount, newlyDiscoveredCodeFilesCount].
 */
function sampleItemsInDirectory(
    current: DirectoryQueueItem,
    context: DirectorySamplingContext,
    budget: DirectorySampleBudget,
): [number, number] {
    let newlySampled = 0;
    let newlyDiscovered = 0;
    const dirEntries = readDirectoryEntries(current.dir);
    for (let i = 0; i < dirEntries.length; i++) {
        const dirEntry = dirEntries[i];
        if (dirEntry.isDirectory()) {
            queueSampledDirectory(dirEntry, current, context);
            continue;
        }
        if (!dirEntry.isFile()) {
            continue;
        }
        const ext = path.extname(dirEntry.name).toLowerCase();
        const lang = EXT_TO_LANG[ext];
        if (!lang) {
            continue;
        }
        newlyDiscovered++;
        if (budget.currentSampled + newlySampled < budget.maxSampleFiles) {
            context.languages[lang] = (context.languages[lang] || 0) + 1;
            newlySampled++;
        }
    }
    return [newlySampled, newlyDiscovered];
}

/**
 * Iteratively sample directory files using BFS stratified sampling to determine language
 * distribution and discover total code file volume without LIFO truncation blind spots.
 *
 * @param rootResolved - Absolute project root directory path.
 * @param directorySemantics - Map to record directory semantics for discovered subdirectories.
 * @param partitions - Optional detected partitions ensuring fair multi-stratum representation.
 * @returns Map of language identifier to observed file count and total discovered code files.
 */
function sampleDirectoryLanguages(
    rootResolved: string,
    directorySemantics: Record<string, ArchitectureLayer>,
    partitions: ProjectPartition[] = [],
): SampleLanguagesResult {
    const languages: Record<string, number> = {};
    let sampled = 0;
    let totalDiscoveredFiles = 0;
    const maxSampleBudget = Math.max(
        LANGUAGE_SAMPLE_MAX_FILES,
        Math.min(MAX_PARTITION_SAMPLE_CAP, partitions.length * SAMPLES_PER_PARTITION),
    );

    const dirQueue: DirectoryQueueItem[] = [{ dir: rootResolved, depth: 0 }];
    const seenDirs = new Set<string>([rootResolved]);
    const samplingContext: DirectorySamplingContext = {
        rootResolved,
        directorySemantics,
        dirQueue,
        languages,
    };

    // Seed partition roots for fair multi-stratum discovery
    for (let i = 0; i < partitions.length; i++) {
        const partitionDir = path.resolve(rootResolved, partitions[i].path);
        if (!seenDirs.has(partitionDir) && fs.existsSync(partitionDir)) {
            dirQueue.push({ dir: partitionDir, depth: 1 });
            seenDirs.add(partitionDir);
        }
    }

    let queueHead = 0;
    while (queueHead < dirQueue.length) {
        const current = dirQueue[queueHead++];
        if (current.depth > LANGUAGE_SAMPLE_MAX_DEPTH) continue;

        const [newSampled, newDiscovered] = sampleItemsInDirectory(current, samplingContext, {
            currentSampled: sampled,
            maxSampleFiles: maxSampleBudget,
        });
        sampled += newSampled;
        totalDiscoveredFiles += newDiscovered;
    }

    return {
        languages,
        totalDiscoveredFiles: Math.max(totalDiscoveredFiles, sampled),
    };
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

    const { languages, totalDiscoveredFiles } = sampleDirectoryLanguages(
        rootResolved,
        directorySemantics,
        partitions,
    );
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
        totalDiscoveredFiles,
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
    const pkgPath = path.join(root, FILE_PACKAGE_JSON);
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
    return /(?:demo|samples?|examples?|tutorial)/i.test(name) || version === VERSION_ZERO;
}

function isGameArchetype(root: string, profile?: Partial<ProjectProfile>): boolean {
    if (profile?.primaryLanguage === GDSCRIPT_LANGUAGE_ID) return true;
    if ((profile?.languages?.[GDSCRIPT_LANGUAGE_ID] ?? 0) > 0) return true;
    if (fs.existsSync(path.join(root, FILE_PROJECT_GODOT))) return true;
    for (const framework of profile?.frameworks ?? []) {
        if (GAME_FRAMEWORKS.has(framework.toLowerCase())) return true;
    }
    return false;
}

function isWebArchetype(
    profile?: Partial<ProjectProfile>,
    packageData?: Record<string, any> | null,
): boolean {
    for (const framework of profile?.frameworks ?? []) {
        if (WEB_FRAMEWORKS.has(framework.toLowerCase())) return true;
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

function isRustStdlib(root: string, normRoot: string): boolean {
    const cargoToml = path.join(root, FILE_CARGO_TOML);
    if (fs.existsSync(cargoToml)) {
        try {
            const raw = fs.readFileSync(cargoToml, 'utf8');
            if (/name\s*=\s*["'](?:.*-)?(?:core|alloc|std)(?:-.*)?["']/i.test(raw)) return true;
        } catch {
            /* best-effort fallback */
        }
    }
    return (
        normRoot.includes(CORE_LIBRARY_PATH_SEGMENT) ||
        normRoot.includes(STD_LIBRARY_PATH_SEGMENT) ||
        normRoot.includes(ALLOC_LIBRARY_PATH_SEGMENT) ||
        fs.existsSync(path.join(root, DIR_LIBRARY, DIR_CORE)) ||
        fs.existsSync(path.join(root, DIR_LIBRARY, DIR_STD))
    );
}

function isPythonStdlib(root: string, profile?: Partial<ProjectProfile>): boolean {
    const isPythonTree = Boolean(profile?.languages?.[PYTHON_LANGUAGE_ID]);
    return (
        (isPythonTree || fs.existsSync(path.join(root, DIR_LIB_TITLE))) &&
        (fs.existsSync(path.join(root, DIR_INCLUDE, FILE_PYTHON_H)) ||
            (fs.existsSync(path.join(root, DIR_LIB_TITLE, FILE_OS_PY)) &&
                fs.existsSync(path.join(root, DIR_LIB_TITLE, FILE_SYS_PY))))
    );
}

function isGoStdlib(root: string): boolean {
    return (
        fs.existsSync(path.join(root, DIR_SRC, DIR_RUNTIME)) &&
        fs.existsSync(path.join(root, DIR_SRC, DIR_SYNC)) &&
        (fs.existsSync(path.join(root, DIR_SRC, DIR_CMD, 'go')) ||
            fs.existsSync(path.join(root, DIR_SRC, DIR_NET)))
    );
}

function isNodeRuntime(root: string): boolean {
    return (
        fs.existsSync(path.join(root, DIR_LIB, DIR_INTERNAL)) &&
        (fs.existsSync(path.join(root, DIR_SRC, FILE_NODE_H)) ||
            fs.existsSync(path.join(root, DIR_LIB, FILE_FS_JS)))
    );
}

function isStdlibArchetype(root: string, profile?: Partial<ProjectProfile>): boolean {
    const normRoot = root.replace(/\\/g, '/');
    return (
        isRustStdlib(root, normRoot) ||
        isPythonStdlib(root, profile) ||
        isGoStdlib(root) ||
        isNodeRuntime(root)
    );
}

function hasNoStdHeader(filePath: string): boolean {
    if (!fs.existsSync(filePath)) return false;
    try {
        const header = fs.readFileSync(filePath, 'utf8').slice(0, HEADER_PREVIEW_SLICE_LIMIT);
        return header.includes('#![no_std]') || header.includes('#![no_core]');
    } catch {
        return false;
    }
}

function hasSystemsCargoName(root: string): boolean {
    const cargoToml = path.join(root, FILE_CARGO_TOML);
    if (!fs.existsSync(cargoToml)) return false;
    try {
        const raw = fs.readFileSync(cargoToml, 'utf8');
        return /name\s*=\s*["'](?:sys-core|.*-kernel|.*-baremetal|.*-sys|.*-runtime)["']/i.test(
            raw,
        );
    } catch {
        return false;
    }
}

const SYSTEMS_CANDIDATE_PATHS = [
    [DIR_SRC, FILE_LIB_RS],
    [DIR_SRC, FILE_MAIN_RS],
    [DIR_CORE, DIR_SRC, FILE_LIB_RS],
    [DIR_KERNEL, DIR_SRC, FILE_LIB_RS],
    [DIR_RUNTIME, DIR_SRC, FILE_LIB_RS],
];

function isSystemsRuntimeArchetype(root: string, profile?: Partial<ProjectProfile>): boolean {
    void profile;
    const normRoot = root.replace(/\\/g, '/');
    for (const parts of SYSTEMS_CANDIDATE_PATHS) {
        if (hasNoStdHeader(path.join(root, ...parts))) return true;
    }
    if (hasSystemsCargoName(root)) return true;
    return (
        normRoot.includes(KERNEL_PATH_SEGMENT) ||
        normRoot.includes(RUNTIME_PATH_SEGMENT) ||
        normRoot.includes(BARE_METAL_PATH_SEGMENT) ||
        normRoot.includes(FREESTANDING_PATH_SEGMENT)
    );
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
    return isWebArchetype(profile, packageData) ? ARCHETYPE_WEB : ARCHETYPE_LIBRARY;
}
