/**
 * Module: Core Engine — Dependency Provenance & Code Autonomy Classifier
 * File Path: src/core/intelligence/dependency-provenance.ts
 * Architecture Role: Resolves code origins and dependency classifications (stdlib vs internal
 *   vs in-tree vendor vs external SDK) to support self-development ratio (CAI) quantification.
 * Dependencies & Triggers: Consumes node:fs, node:path, python-stdlib; invoked by AutonomyAnalyzer
 *   and AutonomyScorer.
 * Responsibilities:
 *   1. Discover and parse package manifests (package.json, pyproject.toml, requirements.txt,
 *      Cargo.toml, go.mod);
 *   2. Classify import specifiers into stdlib, internal, in-tree vendor, or external SDK;
 *   3. Classify file provenance into proprietary, in-tree vendor, generated, or test fixture;
 *   4. Record declared version constraints and identify floating/wildcard
 *      versions (isUnpinnedVersion);
 *   5. Support nearest manifest inventory resolution and composite aggregation for Monorepos;
 *   6. Recursively resolve compiler path aliases across tsconfig extends inheritance chains.
 * Exit Semantics & Design Rationale: Never throws; deterministic cache-backed lookups with safe
 *   fallbacks for missing or unreadable manifest files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PYTHON_STDLIB_MODULES } from './python-stdlib';

/** Provenance classification for imported symbols and module references */
export type ImportProvenanceKind =
    'stdlib' | 'internal' | 'in_tree_vendor' | 'external_sdk' | 'unknown';

/** File origin provenance classification */
export type FileProvenanceKind = 'proprietary' | 'in_tree_vendor' | 'generated' | 'test_fixture';

/** Node.js core standard library module names */
export const NODE_CORE_MODULES: ReadonlySet<string> = new Set([
    'assert',
    'async_hooks',
    'buffer',
    'child_process',
    'cluster',
    'console',
    'constants',
    'crypto',
    'dgram',
    'diagnostics_channel',
    'dns',
    'domain',
    'events',
    'fs',
    'http',
    'http2',
    'https',
    'inspector',
    'module',
    'net',
    'os',
    'path',
    'perf_hooks',
    'process',
    'punycode',
    'querystring',
    'readline',
    'repl',
    'stream',
    'string_decoder',
    'sys',
    'test',
    'timers',
    'tls',
    'trace_events',
    'tty',
    'url',
    'util',
    'v8',
    'vm',
    'wasi',
    'worker_threads',
    'zlib',
]);

/** Rust standard and core library roots */
export const RUST_CORE_CRATES: ReadonlySet<string> = new Set([
    'std',
    'core',
    'alloc',
    'proc_macro',
]);

/** Go standard library package root prefixes */
export const GO_CORE_PACKAGES: ReadonlySet<string> = new Set([
    'archive',
    'bufio',
    'bytes',
    'compress',
    'container',
    'context',
    'crypto',
    'database',
    'debug',
    'embed',
    'encoding',
    'errors',
    'expvar',
    'flag',
    'fmt',
    'go',
    'hash',
    'html',
    'image',
    'index',
    'io',
    'log',
    'math',
    'mime',
    'net',
    'os',
    'path',
    'plugin',
    'reflect',
    'regexp',
    'runtime',
    'sort',
    'strconv',
    'strings',
    'sync',
    'syscall',
    'testing',
    'text',
    'time',
    'unicode',
    'unsafe',
]);

// ---------------------------------------------------------------------------
// Manifest and Configuration File Names
// ---------------------------------------------------------------------------

const MANIFEST_PKG_JSON = 'package.json';
const MANIFEST_CARGO_TOML = 'Cargo.toml';
const MANIFEST_PYPROJECT_TOML = 'pyproject.toml';
const MANIFEST_REQUIREMENTS_TXT = 'requirements.txt';
const MANIFEST_GO_MOD = 'go.mod';

const CONFIG_TSCONFIG_JSON = 'tsconfig.json';
const CONFIG_JSCONFIG_JSON = 'jsconfig.json';
const CONFIG_TSCONFIG_BASE_JSON = 'tsconfig.base.json';
const TSCONFIG_CANDIDATE_NAMES: readonly string[] = [
    CONFIG_TSCONFIG_JSON,
    CONFIG_JSCONFIG_JSON,
    CONFIG_TSCONFIG_BASE_JSON,
];

// ---------------------------------------------------------------------------
// Lockfile Names and Types
// ---------------------------------------------------------------------------

const LOCKFILE_PKG_LOCK_JSON = 'package-lock.json';
const LOCKFILE_CARGO_LOCK = 'Cargo.lock';
const LOCKFILE_GO_SUM = 'go.sum';
const LOCKFILE_POETRY_LOCK = 'poetry.lock';

const NPM_LOCK_FORMAT = 'npm';
const CARGO_LOCK_FORMAT = 'cargo';
const GO_LOCK_FORMAT = 'go';
const POETRY_LOCK_FORMAT = 'poetry';
const UNKNOWN_LOCK_FORMAT = 'none';

// ---------------------------------------------------------------------------
// Provenance Classification Tokens
// ---------------------------------------------------------------------------

const VENDOR_FILE_KIND: FileProvenanceKind = 'in_tree_vendor';
const GENERATED_FILE_KIND: FileProvenanceKind = 'generated';
const FIXTURE_FILE_KIND: FileProvenanceKind = 'test_fixture';
const PROPRIETARY_FILE_KIND: FileProvenanceKind = 'proprietary';

const STDLIB_IMPORT_ORIGIN: ImportProvenanceKind = 'stdlib';
const INTERNAL_IMPORT_ORIGIN: ImportProvenanceKind = 'internal';
const VENDOR_IMPORT_ORIGIN: ImportProvenanceKind = 'in_tree_vendor';
const SDK_IMPORT_ORIGIN: ImportProvenanceKind = 'external_sdk';
const UNKNOWN_IMPORT_ORIGIN: ImportProvenanceKind = 'unknown';

// ---------------------------------------------------------------------------
// Protocol, Runtime, and Engine Tokens
// ---------------------------------------------------------------------------

const NODE_CORE_PREFIX = 'node:';
const GODOT_GLOBAL_SCOPE_PREFIX = '@GlobalScope';
const GODOT_ENGINE_IDENTIFIER = 'Engine';
const GODOT_RESOURCE_LOADER_IDENTIFIER = 'ResourceLoader';

const UNPINNED_WILDCARD = '*';
const UNPINNED_LATEST = 'latest';
const UNPINNED_X = 'x';
const UNPINNED_STAR_STAR = '*.*';

const GO_REQUIRE_PREFIX = 'require ';
const GO_REQUIRE_GROUP_START = 'require (';

// ---------------------------------------------------------------------------
// Numerical & Depth Boundaries
// ---------------------------------------------------------------------------

const MAX_TSCONFIG_EXTENDS_DEPTH = 8;
const CHAR_CODE_DOT = 46;
const CHAR_CODE_SLASH = 47;
const CHAR_CODE_HASH = 35;

const SHALLOW_DEPTH_RANK = 1;
const MODERATE_DEPTH_RANK = 2;
const DEEP_DEPTH_RANK = 3;
const EXTENSIVE_DEPTH_RANK = 4;

const COMPACT_DEPTH_RATIO = 4;
const BALANCED_DEPTH_RATIO = 5;
const EXPANSIVE_CARGO_RATIO = 15;
const EXPANSIVE_NPM_RATIO = 20;

const DEFAULT_TRANSITIVE_MULTIPLIER = 3;
const DEFAULT_TOTAL_MULTIPLIER = 4;

/** In-tree vendor directory path patterns */
const IN_TREE_VENDOR_PATTERN =
    /(?:^|[\\/])(?:vendor|third_party|third-party|extern|external|submodules|embedded)[\\/]/i;

/** Auto-generated code file patterns */
const GENERATED_FILE_PATTERN =
    /(?:^|[\\/])(?:generated|gen|proto_gen|\.cache|dist|out)[\\/]|[\\/][a-z0-9_.-]+(?:\.pb|\.min|\.generated|\.d)\.[a-z0-9]+$/i;

/** Test fixture file patterns */
const TEST_FIXTURE_PATTERN =
    /(?:^|[\\/])(?:fixtures?|mocks?|testdata|samples?)[\\/]|[\\/][a-z0-9_.-]+(?:\.mock|\.fixture)\.[a-z0-9]+$/i;

/** Fine-grained inventory of declared project dependencies and path aliases */
export interface ProjectManifestInventory {
    /** Union of all declared dependencies across production and development */
    allDependencies: Set<string>;
    /** Production runtime dependencies declared in dependencies */
    prodDependencies: Set<string>;
    /** Development-only dependencies declared in devDependencies */
    devDependencies: Set<string>;
    /** Peer dependencies declared in peerDependencies */
    peerDependencies: Set<string>;
    /** Internal path aliases discovered from tsconfig/jsconfig paths */
    pathAliases: Set<string>;
    /** Declared version constraint strings per package identifier */
    versionSpecs: Map<string, string>;
}

/** Manifest inventory cache keyed by absolute root directory path */
const ROOT_PATH_TO_INVENTORY_MAP = new Map<string, ProjectManifestInventory>();

function ingestDependencyMap(
    rawRecord: unknown,
    primarySet: Set<string>,
    inventory: ProjectManifestInventory,
    isProd = false,
): void {
    if (!rawRecord || typeof rawRecord !== 'object') return;
    for (const [dep, ver] of Object.entries(rawRecord as Record<string, unknown>)) {
        primarySet.add(dep);
        inventory.allDependencies.add(dep);
        if (isProd) inventory.prodDependencies.add(dep);
        if (typeof ver === 'string') inventory.versionSpecs.set(dep, ver);
    }
}

/**
 * Extract external package dependencies declared in package.json with fine-grained scopes.
 */
function parsePackageJson(manifestPath: string, inventory: ProjectManifestInventory): void {
    try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const json = JSON.parse(raw);
        ingestDependencyMap(json.dependencies, inventory.prodDependencies, inventory, true);
        ingestDependencyMap(json.peerDependencies, inventory.peerDependencies, inventory, true);
        ingestDependencyMap(json.optionalDependencies, inventory.prodDependencies, inventory, true);
        ingestDependencyMap(json.devDependencies, inventory.devDependencies, inventory, false);
    } catch {
        // best-effort fallback: ignored when manifest is corrupt or unreadable
    }
}

/**
 * Extract external package dependencies declared in Cargo.toml.
 */
function parseCargoToml(manifestPath: string, target: Set<string>): void {
    try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        let inDependencies = false;
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('[')) {
                inDependencies = /^\[(?:dependencies|dev-dependencies|build-dependencies)\]/i.test(
                    trimmed,
                );
                continue;
            }
            if (inDependencies && trimmed && !trimmed.startsWith('#')) {
                const match = /^([a-zA-Z0-9_-]+)\s*=/.exec(trimmed);
                if (match) target.add(match[1].replace(/-/g, '_'));
            }
        }
    } catch {
        // best-effort fallback: ignored when manifest is corrupt or unreadable
    }
}

/** Safely read UTF-8 text from disk, returning null on error or non-existence. */
function tryReadUtf8Text(filePath: string): string | null {
    try {
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    } catch {
        return null;
    }
}

/** Parse dependency names from pyproject.toml contents. */
function parsePyprojectDeps(raw: string, target: Set<string>): void {
    let inDeps = false;
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[')) {
            inDeps = /(?:dependencies|requires)/i.test(trimmed);
            continue;
        }
        if (inDeps && trimmed && !trimmed.startsWith('#')) {
            const match = /["']([a-zA-Z0-9_.-]+)(?:[><=~;]|$)/.exec(trimmed);
            if (match) target.add(match[1].toLowerCase().replace(/[-.]/g, '_'));
        }
    }
}

/** Parse dependency names from requirements.txt contents. */
function parseRequirementsDeps(raw: string, target: Set<string>): void {
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = /^([a-zA-Z0-9_.-]+)/.exec(trimmed);
        if (match) target.add(match[1].toLowerCase().replace(/[-.]/g, '_'));
    }
}

/**
 * Extract external package dependencies declared in pyproject.toml and requirements.txt.
 */
function parsePythonManifests(rootDir: string, target: Set<string>): void {
    const pyproject = tryReadUtf8Text(path.join(rootDir, MANIFEST_PYPROJECT_TOML));
    if (pyproject) {
        parsePyprojectDeps(pyproject, target);
    }
    const reqTxt = tryReadUtf8Text(path.join(rootDir, MANIFEST_REQUIREMENTS_TXT));
    if (reqTxt) {
        parseRequirementsDeps(reqTxt, target);
    }
}

/**
 * Extract external dependencies declared in go.mod.
 */
function parseGoMod(manifestPath: string, target: Set<string>): void {
    try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        let inRequire = false;
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith(GO_REQUIRE_GROUP_START)) {
                inRequire = true;
                continue;
            }
            if (inRequire && trimmed === ')') {
                inRequire = false;
                continue;
            }
            if ((inRequire || trimmed.startsWith(GO_REQUIRE_PREFIX)) && trimmed) {
                const parts = trimmed.replace(/^require\s+/, '').split(/\s+/);
                if (parts[0]) target.add(parts[0]);
            }
        }
    } catch {
        // best-effort fallback: ignored when manifest is corrupt or unreadable
    }
}

function resolveExtendsPath(dir: string, extendsTarget: string): string {
    let extPath = path.resolve(dir, extendsTarget);
    if (!extPath.endsWith('.json') && !fs.existsSync(extPath) && fs.existsSync(extPath + '.json')) {
        extPath += '.json';
    }
    return extPath;
}

function ingestCompilerPaths(pathsRecord: unknown, target: Set<string>): void {
    if (!pathsRecord || typeof pathsRecord !== 'object') return;
    for (const key of Object.keys(pathsRecord as Record<string, unknown>)) {
        const prefix = key.replace(/\/\*$/, '').replace(/\*$/, '');
        if (prefix) target.add(prefix);
    }
}

function extractAliasesFromFile(
    filePath: string,
    target: Set<string>,
    visited = new Set<string>(),
): void {
    const absPath = path.resolve(filePath);
    if (
        visited.has(absPath) ||
        visited.size > MAX_TSCONFIG_EXTENDS_DEPTH ||
        !fs.existsSync(absPath)
    ) {
        return;
    }
    visited.add(absPath);

    try {
        const raw = fs.readFileSync(absPath, 'utf8');
        const clean = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
        const parsed = JSON.parse(clean);

        if (typeof parsed.extends === 'string') {
            const extPath = resolveExtendsPath(path.dirname(absPath), parsed.extends);
            extractAliasesFromFile(extPath, target, visited);
        }

        ingestCompilerPaths(parsed.compilerOptions?.paths, target);
    } catch {
        // best-effort fallback
    }
}

/**
 * Discover and parse tsconfig/jsconfig compilerOptions.paths to prevent internal
 * aliases (e.g. '@core/*', '@shared/*') from being misclassified as external SDKs.
 */
function parsePathAliases(rootDir: string, target: Set<string>): void {
    for (const fileName of TSCONFIG_CANDIDATE_NAMES) {
        extractAliasesFromFile(path.join(rootDir, fileName), target);
    }
}

/**
 * Tests whether a dependency version specification is floating or unpinned
 * (wildcard or open range).
 *
 * @param spec - Declared version requirement string
 * @returns True when version is unpinned, wildcard, or open-ended
 */
export function isUnpinnedVersion(spec: string): boolean {
    if (!spec) return false;
    const trimmed = spec.trim().toLowerCase();
    if (
        trimmed === UNPINNED_WILDCARD ||
        trimmed === UNPINNED_LATEST ||
        trimmed === UNPINNED_X ||
        trimmed === UNPINNED_STAR_STAR
    ) {
        return true;
    }
    if (/^[><]=?\s*\d+/.test(trimmed) && !trimmed.includes('<=') && !trimmed.includes('<')) {
        return true;
    }
    return /\b(?:x|\*)\b/.test(trimmed);
}

const PATH_TO_NEAREST_DIR_MAP = new Map<string, string | null>();
const DIR_TO_MERGED_INVENTORY_MAP = new Map<string, ProjectManifestInventory>();
const KNOWN_FILE_EXT_PATTERN =
    /\.(?:[cm]?[jt]sx?|py|rs|go|gd|json|ya?ml|toml|md|sh|ps1|c|h|cpp|hpp|java|cs|rb|php|swift|kt|lock|sum|txt)$/i;
const CACHE_KEY_SEP = '\0';

function resolveStartDirectory(startPath: string, absBoundary: string): string {
    const resolved = path.isAbsolute(startPath)
        ? path.normalize(startPath)
        : path.resolve(absBoundary, startPath);
    if (KNOWN_FILE_EXT_PATTERN.test(resolved)) {
        return path.dirname(resolved);
    }
    try {
        return fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
    } catch {
        return path.dirname(resolved);
    }
}

function checkDirectoryManifestExists(dirPath: string): boolean {
    return (
        fs.existsSync(path.join(dirPath, MANIFEST_PKG_JSON)) ||
        fs.existsSync(path.join(dirPath, MANIFEST_CARGO_TOML)) ||
        fs.existsSync(path.join(dirPath, MANIFEST_PYPROJECT_TOML)) ||
        fs.existsSync(path.join(dirPath, MANIFEST_GO_MOD))
    );
}

/**
 * Locate the nearest directory containing a package manifest (package.json, Cargo.toml, etc.)
 * searching upwards from the specified file path, bounded by boundaryDir.
 *
 * @param startPath - File or folder path to start searching from
 * @param boundaryDir - Top-level root directory boundary
 * @returns Directory path containing manifest, or null if none found
 */
export function findNearestManifestDir(startPath: string, boundaryDir: string): string | null {
    const absBoundary = path.resolve(boundaryDir);
    let current = resolveStartDirectory(startPath, absBoundary);
    const visitedKeys: string[] = [];
    let foundDir: string | null = null;

    while (current.length >= absBoundary.length) {
        const cacheKey = absBoundary + CACHE_KEY_SEP + current;
        const cachedDir = PATH_TO_NEAREST_DIR_MAP.get(cacheKey);
        if (cachedDir !== undefined) {
            foundDir = cachedDir;
            break;
        }
        visitedKeys.push(cacheKey);

        if (checkDirectoryManifestExists(current)) {
            foundDir = current;
            break;
        }

        if (current === absBoundary) break;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    for (const key of visitedKeys) {
        PATH_TO_NEAREST_DIR_MAP.set(key, foundDir);
    }
    return foundDir;
}

const DIR_PATH_TO_VERSION_MAP = new Map<string, string | undefined>();

/**
 * Discovers and caches declared semver version from nearest package.json manifest.
 *
 * @param filePath - Source file path being analyzed.
 * @param boundaryDir - Optional root boundary directory (defaults to process.cwd()).
 * @returns Discovered semver string or undefined.
 */
export function resolveProjectVersion(
    filePath: string,
    boundaryDir = process.cwd(),
): string | undefined {
    const nearestDir = findNearestManifestDir(filePath, boundaryDir);
    if (!nearestDir) return undefined;
    if (DIR_PATH_TO_VERSION_MAP.has(nearestDir)) {
        return DIR_PATH_TO_VERSION_MAP.get(nearestDir);
    }

    const pkgPath = path.join(nearestDir, MANIFEST_PKG_JSON);
    let version: string | undefined;
    try {
        if (fs.existsSync(pkgPath)) {
            const raw = fs.readFileSync(pkgPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (typeof parsed.version === 'string') {
                version = parsed.version;
            }
        }
    } catch (err) {
        // Safe fallback on read or JSON parse failure
        void err;
    }

    DIR_PATH_TO_VERSION_MAP.set(nearestDir, version);
    return version;
}

/**
 * Load manifest inventory for the nearest subproject enclosing the file,
 * automatically merged with the root workspace inventory to prevent Monorepo false positives.
 *
 * @param filePath - Path to source file being analyzed
 * @param rootDir - Scan root directory
 * @returns Merged ProjectManifestInventory
 */
export function findNearestManifestInventory(
    filePath: string,
    rootDir: string,
): ProjectManifestInventory {
    const absRoot = path.resolve(rootDir);
    const nearestDir = findNearestManifestDir(filePath, absRoot);
    if (!nearestDir || nearestDir === absRoot) {
        return loadProjectManifestInventory(absRoot);
    }

    const mergeKey = absRoot + CACHE_KEY_SEP + nearestDir;
    const cachedMerged = DIR_TO_MERGED_INVENTORY_MAP.get(mergeKey);
    if (cachedMerged) return cachedMerged;

    const localInv = loadProjectManifestInventory(nearestDir);
    const rootInv = loadProjectManifestInventory(absRoot);

    const merged: ProjectManifestInventory = {
        allDependencies: new Set([...rootInv.allDependencies, ...localInv.allDependencies]),
        prodDependencies: new Set([...rootInv.prodDependencies, ...localInv.prodDependencies]),
        devDependencies: new Set([...rootInv.devDependencies, ...localInv.devDependencies]),
        peerDependencies: new Set([...rootInv.peerDependencies, ...localInv.peerDependencies]),
        pathAliases: new Set([...rootInv.pathAliases, ...localInv.pathAliases]),
        versionSpecs: new Map([...rootInv.versionSpecs, ...localInv.versionSpecs]),
    };
    DIR_TO_MERGED_INVENTORY_MAP.set(mergeKey, merged);
    return merged;
}

/**
 * Load and cache fine-grained inventory of project dependencies across production
 * and development scopes, alongside internal compiler path aliases.
 *
 * @param rootDir - Scan root directory
 * @returns ProjectManifestInventory record
 */
export function loadProjectManifestInventory(rootDir: string): ProjectManifestInventory {
    const absRoot = path.resolve(rootDir);
    const cached = ROOT_PATH_TO_INVENTORY_MAP.get(absRoot);
    if (cached) return cached;

    const inventory: ProjectManifestInventory = {
        allDependencies: new Set<string>(),
        prodDependencies: new Set<string>(),
        devDependencies: new Set<string>(),
        peerDependencies: new Set<string>(),
        pathAliases: new Set<string>(),
        versionSpecs: new Map<string, string>(),
    };

    const pkgJson = path.join(absRoot, MANIFEST_PKG_JSON);
    if (fs.existsSync(pkgJson)) parsePackageJson(pkgJson, inventory);

    const cargoToml = path.join(absRoot, MANIFEST_CARGO_TOML);
    if (fs.existsSync(cargoToml)) parseCargoToml(cargoToml, inventory.allDependencies);

    parsePythonManifests(absRoot, inventory.allDependencies);

    const goMod = path.join(absRoot, MANIFEST_GO_MOD);
    if (fs.existsSync(goMod)) parseGoMod(goMod, inventory.allDependencies);

    parsePathAliases(absRoot, inventory.pathAliases);

    ROOT_PATH_TO_INVENTORY_MAP.set(absRoot, inventory);
    return inventory;
}

/**
 * Tests whether a package is strictly a development-only dependency (declared in devDependencies
 * but absent from production dependencies and peerDependencies).
 *
 * @param packageName - Package identifier to test
 * @param inventory - Declared project manifest inventory
 * @returns True when package is declared strictly in devDependencies
 */
export function isDevOnlyDependency(
    packageName: string,
    inventory: ProjectManifestInventory,
): boolean {
    const norm = packageName.toLowerCase();
    const isDeclaredInDev =
        inventory.devDependencies.has(norm) || inventory.devDependencies.has(packageName);
    if (!isDeclaredInDev) {
        return false;
    }
    const inProd =
        inventory.prodDependencies.has(norm) ||
        inventory.prodDependencies.has(packageName) ||
        inventory.peerDependencies.has(norm) ||
        inventory.peerDependencies.has(packageName);
    return !inProd;
}

/**
 * Load and cache all declared external package dependencies for a given project root.
 *
 * @param rootDir - Scan root directory
 * @returns Set of lowercase package identifiers
 */
export function loadProjectManifestDependencies(rootDir: string): Set<string> {
    const inventory = loadProjectManifestInventory(rootDir);
    return inventory.allDependencies;
}

/**
 * Classify file origin provenance.
 *
 * @param filePath - Path to source file
 * @param headerClues - Optional source header lines
 * @returns FileProvenanceKind
 */
export function classifyFileProvenance(filePath: string, headerClues?: string): FileProvenanceKind {
    const norm = filePath.replace(/\\/g, '/');

    if (IN_TREE_VENDOR_PATTERN.test(norm)) {
        return VENDOR_FILE_KIND;
    }

    if (
        GENERATED_FILE_PATTERN.test(norm) ||
        (headerClues && /(?:@generated|Code generated by|DO NOT EDIT)/i.test(headerClues))
    ) {
        return GENERATED_FILE_KIND;
    }

    if (TEST_FIXTURE_PATTERN.test(norm)) {
        return FIXTURE_FILE_KIND;
    }

    return PROPRIETARY_FILE_KIND;
}

function isStandardLibraryImport(firstSegment: string, trimmed: string): boolean {
    if (trimmed.startsWith(NODE_CORE_PREFIX)) return true;
    if (NODE_CORE_MODULES.has(firstSegment) || NODE_CORE_MODULES.has(trimmed)) return true;
    if (PYTHON_STDLIB_MODULES.has(firstSegment) || PYTHON_STDLIB_MODULES.has(trimmed)) return true;
    if (RUST_CORE_CRATES.has(firstSegment) || GO_CORE_PACKAGES.has(firstSegment)) return true;
    return (
        trimmed.startsWith(GODOT_GLOBAL_SCOPE_PREFIX) ||
        trimmed === GODOT_ENGINE_IDENTIFIER ||
        trimmed === GODOT_RESOURCE_LOADER_IDENTIFIER
    );
}

function isDeclaredDependency(firstSegment: string, manifestDeps?: Set<string>): boolean {
    if (!manifestDeps) return false;
    const normalized = firstSegment.replace(/[-.]/g, '_');
    return manifestDeps.has(firstSegment) || manifestDeps.has(normalized);
}

function isRelativeOrInternalPrefix(trimmed: string): boolean {
    const firstChar = trimmed.charCodeAt(0);
    if (
        firstChar === CHAR_CODE_DOT ||
        firstChar === CHAR_CODE_SLASH ||
        firstChar === CHAR_CODE_HASH
    ) {
        return true;
    }
    return trimmed.startsWith('@/') || trimmed.startsWith('~/');
}

function matchesPathAlias(trimmed: string, pathAliases?: Set<string>): boolean {
    if (!pathAliases || pathAliases.size === 0) return false;
    for (const alias of pathAliases) {
        if (trimmed === alias || trimmed.startsWith(alias + '/')) {
            return true;
        }
    }
    return false;
}

/**
 * Classify the provenance of an imported module specifier.
 *
 * @param specifier - Raw module specifier from import statement
 * @param currentFile - Normalized path of current importing file
 * @param manifestDeps - Set of declared external package dependencies
 * @param pathAliases - Optional set of compiler path aliases (e.g. '@core', '@/')
 * @returns ImportProvenanceKind
 */
export function classifyImportProvenance(
    specifier: string,
    currentFile: string,
    manifestDeps?: Set<string>,
    pathAliases?: Set<string>,
): ImportProvenanceKind {
    const trimmed = specifier.trim().replace(/^['"]|['"]$/g, '');
    if (!trimmed) return UNKNOWN_IMPORT_ORIGIN;
    if (IN_TREE_VENDOR_PATTERN.test(trimmed)) return VENDOR_IMPORT_ORIGIN;
    if (isRelativeOrInternalPrefix(trimmed) || matchesPathAlias(trimmed, pathAliases)) {
        return INTERNAL_IMPORT_ORIGIN;
    }

    const firstSegment = trimmed.split('/')[0].split('.')[0].toLowerCase();
    if (isStandardLibraryImport(firstSegment, trimmed)) return STDLIB_IMPORT_ORIGIN;
    if (isDeclaredDependency(firstSegment, manifestDeps)) return SDK_IMPORT_ORIGIN;
    if (trimmed.startsWith('@')) return SDK_IMPORT_ORIGIN;

    const currentSegments = currentFile.replace(/\\/g, '/').split('/');
    if (currentSegments.length > 1 && currentSegments[0] === firstSegment) {
        return INTERNAL_IMPORT_ORIGIN;
    }

    return SDK_IMPORT_ORIGIN;
}

/** Supply chain dependency profile derived from manifest and lockfile analysis */
export interface SupplyChainProfile {
    hasLockfile: boolean;
    lockfileType: 'npm' | 'cargo' | 'go' | 'poetry' | 'pnpm' | 'none';
    directDependencyCount: number;
    transitiveDependencyCount: number;
    totalLockfilePackages: number;
    estimatedDepth: number;
}

interface BuildProfileParams {
    lockType: 'npm' | 'cargo' | 'go' | 'poetry' | 'pnpm' | 'none';
    direct: number;
    total: number;
    thresholds: readonly [number, number];
}

function buildSupplyChainProfile(params: BuildProfileParams): SupplyChainProfile {
    const { lockType, direct, total, thresholds } = params;
    const transitive = Math.max(0, total - direct);
    let depth = EXTENSIVE_DEPTH_RANK;
    if (total <= direct) {
        depth = SHALLOW_DEPTH_RANK;
    } else if (total <= direct * thresholds[0]) {
        depth = MODERATE_DEPTH_RANK;
    } else if (total <= direct * thresholds[1]) {
        depth = DEEP_DEPTH_RANK;
    }
    return {
        hasLockfile: true,
        lockfileType: lockType,
        directDependencyCount: direct,
        transitiveDependencyCount: transitive,
        totalLockfilePackages: total,
        estimatedDepth: depth,
    };
}

function parseNodeLockfile(absRoot: string, direct: number): SupplyChainProfile | null {
    const pkgLock = path.join(absRoot, LOCKFILE_PKG_LOCK_JSON);
    if (!fs.existsSync(pkgLock)) return null;

    try {
        const raw = fs.readFileSync(pkgLock, 'utf8');
        const parsedLock = JSON.parse(raw);
        let discoveredCount = 0;
        if (parsedLock.packages && typeof parsedLock.packages === 'object') {
            discoveredCount = Math.max(
                0,
                Object.keys(parsedLock.packages).filter((k) => k !== '').length,
            );
        } else if (parsedLock.dependencies && typeof parsedLock.dependencies === 'object') {
            discoveredCount = Object.keys(parsedLock.dependencies).length;
        }
        return buildSupplyChainProfile({
            lockType: NPM_LOCK_FORMAT,
            direct,
            total: discoveredCount,
            thresholds: [BALANCED_DEPTH_RATIO, EXPANSIVE_NPM_RATIO],
        });
    } catch {
        // best-effort: ignored package-lock.json parsing failures fall back to next loader
        return null;
    }
}

function parseCargoLockfile(absRoot: string, direct: number): SupplyChainProfile | null {
    const cargoLock = path.join(absRoot, LOCKFILE_CARGO_LOCK);
    if (!fs.existsSync(cargoLock)) return null;

    try {
        const raw = fs.readFileSync(cargoLock, 'utf8');
        const matches = raw.match(/\[\[package\]\]/g);
        const discoveredCount = matches ? matches.length : 0;
        return buildSupplyChainProfile({
            lockType: CARGO_LOCK_FORMAT,
            direct,
            total: discoveredCount,
            thresholds: [COMPACT_DEPTH_RATIO, EXPANSIVE_CARGO_RATIO],
        });
    } catch {
        // best-effort: ignored Cargo.lock parsing failures fall back to next loader
        return null;
    }
}

function parseGoSumLockfile(absRoot: string, direct: number): SupplyChainProfile | null {
    const goSum = path.join(absRoot, LOCKFILE_GO_SUM);
    if (!fs.existsSync(goSum)) return null;

    try {
        const raw = fs.readFileSync(goSum, 'utf8');
        const modules = new Set<string>();
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const mod = trimmed.split(/\s+/)[0];
            if (mod) modules.add(mod);
        }
        return buildSupplyChainProfile({
            lockType: GO_LOCK_FORMAT,
            direct,
            total: modules.size,
            thresholds: [COMPACT_DEPTH_RATIO, BALANCED_DEPTH_RATIO],
        });
    } catch {
        // best-effort: ignored go.sum parsing failures fall back to next loader
        return null;
    }
}

function parsePoetryLockfile(absRoot: string, direct: number): SupplyChainProfile | null {
    const poetryLock = path.join(absRoot, LOCKFILE_POETRY_LOCK);
    if (!fs.existsSync(poetryLock)) return null;

    try {
        const raw = fs.readFileSync(poetryLock, 'utf8');
        const matches = raw.match(/\[\[package\]\]/g);
        const discoveredCount = matches ? matches.length : 0;
        return buildSupplyChainProfile({
            lockType: POETRY_LOCK_FORMAT,
            direct,
            total: discoveredCount,
            thresholds: [COMPACT_DEPTH_RATIO, BALANCED_DEPTH_RATIO],
        });
    } catch {
        // best-effort: ignored poetry.lock parsing failures fall back to next loader
        return null;
    }
}

/**
 * Inspect lockfiles in the project root to quantify transitive dependency explosion.
 *
 * @param rootDir - Scan root directory
 * @param directCount - Known direct dependency count (optional)
 * @returns SupplyChainProfile
 */
export function loadProjectSupplyChainProfile(
    rootDir: string,
    directCount?: number,
): SupplyChainProfile {
    const absRoot = path.resolve(rootDir);
    const direct =
        directCount !== undefined ? directCount : loadProjectManifestDependencies(absRoot).size;

    return (
        parseNodeLockfile(absRoot, direct) ??
        parseCargoLockfile(absRoot, direct) ??
        parseGoSumLockfile(absRoot, direct) ??
        parsePoetryLockfile(absRoot, direct) ?? {
            hasLockfile: false,
            lockfileType: UNKNOWN_LOCK_FORMAT,
            directDependencyCount: direct,
            transitiveDependencyCount: direct > 0 ? direct * DEFAULT_TRANSITIVE_MULTIPLIER : 0,
            totalLockfilePackages: direct > 0 ? direct * DEFAULT_TOTAL_MULTIPLIER : 0,
            estimatedDepth: direct > 0 ? DEEP_DEPTH_RANK : SHALLOW_DEPTH_RANK,
        }
    );
}
