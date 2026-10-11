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
 *   4. Record declared version constraints and identify floating/wildcard versions (isUnpinnedVersion);
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
const INVENTORY_CACHE = new Map<string, ProjectManifestInventory>();

/**
 * Extract external package dependencies declared in package.json with fine-grained scopes.
 */
function parsePackageJson(manifestPath: string, inventory: ProjectManifestInventory): void {
    try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const json = JSON.parse(raw);
        for (const [dep, ver] of Object.entries(json.dependencies || {})) {
            inventory.prodDependencies.add(dep);
            inventory.allDependencies.add(dep);
            if (typeof ver === 'string') inventory.versionSpecs.set(dep, ver);
        }
        for (const [dep, ver] of Object.entries(json.peerDependencies || {})) {
            inventory.peerDependencies.add(dep);
            inventory.prodDependencies.add(dep);
            inventory.allDependencies.add(dep);
            if (typeof ver === 'string') inventory.versionSpecs.set(dep, ver);
        }
        for (const [dep, ver] of Object.entries(json.optionalDependencies || {})) {
            inventory.prodDependencies.add(dep);
            inventory.allDependencies.add(dep);
            if (typeof ver === 'string') inventory.versionSpecs.set(dep, ver);
        }
        for (const [dep, ver] of Object.entries(json.devDependencies || {})) {
            inventory.devDependencies.add(dep);
            inventory.allDependencies.add(dep);
            if (typeof ver === 'string') inventory.versionSpecs.set(dep, ver);
        }
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
        if (!fs.existsSync(filePath)) return null;
        return fs.readFileSync(filePath, 'utf8');
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
    const pyproject = tryReadUtf8Text(path.join(rootDir, 'pyproject.toml'));
    if (pyproject) {
        parsePyprojectDeps(pyproject, target);
    }
    const reqTxt = tryReadUtf8Text(path.join(rootDir, 'requirements.txt'));
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
            if (trimmed.startsWith('require (')) {
                inRequire = true;
                continue;
            }
            if (inRequire && trimmed === ')') {
                inRequire = false;
                continue;
            }
            if ((inRequire || trimmed.startsWith('require ')) && trimmed) {
                const parts = trimmed.replace(/^require\s+/, '').split(/\s+/);
                if (parts[0]) target.add(parts[0]);
            }
        }
    } catch {
        // best-effort fallback: ignored when manifest is corrupt or unreadable
    }
}

function extractAliasesFromFile(
    filePath: string,
    target: Set<string>,
    visited = new Set<string>(),
): void {
    const absPath = path.resolve(filePath);
    if (visited.has(absPath) || visited.size > 8 || !fs.existsSync(absPath)) return;
    visited.add(absPath);

    try {
        const raw = fs.readFileSync(absPath, 'utf8');
        const clean = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
        const parsed = JSON.parse(clean);

        if (typeof parsed.extends === 'string') {
            const dir = path.dirname(absPath);
            let extPath = path.resolve(dir, parsed.extends);
            if (!extPath.endsWith('.json') && !fs.existsSync(extPath)) {
                if (fs.existsSync(extPath + '.json')) extPath += '.json';
            }
            extractAliasesFromFile(extPath, target, visited);
        }

        const paths = parsed.compilerOptions?.paths;
        if (!paths || typeof paths !== 'object') return;
        for (const key of Object.keys(paths)) {
            const prefix = key.replace(/\/\*$/, '').replace(/\*$/, '');
            if (prefix) target.add(prefix);
        }
    } catch {
        // best-effort fallback
    }
}

/**
 * Discover and parse tsconfig/jsconfig compilerOptions.paths to prevent internal
 * aliases (e.g. '@core/*', '@shared/*') from being misclassified as external SDKs.
 */
function parsePathAliases(rootDir: string, target: Set<string>): void {
    const candidates = ['tsconfig.json', 'jsconfig.json', 'tsconfig.base.json'];
    for (const fileName of candidates) {
        extractAliasesFromFile(path.join(rootDir, fileName), target);
    }
}

/**
 * Tests whether a dependency version specification is floating or unpinned (wildcard or open range).
 *
 * @param spec - Declared version requirement string
 * @returns True when version is unpinned, wildcard, or open-ended
 */
export function isUnpinnedVersion(spec: string): boolean {
    if (!spec) return false;
    const trimmed = spec.trim().toLowerCase();
    if (trimmed === '*' || trimmed === 'latest' || trimmed === 'x' || trimmed === '*.*') {
        return true;
    }
    if (/^[><]=?\s*\d+/.test(trimmed) && !trimmed.includes('<=') && !trimmed.includes('<')) {
        return true;
    }
    if (/\b(?:x|\*)\b/.test(trimmed)) {
        return true;
    }
    return false;
}

const NEAREST_DIR_CACHE = new Map<string, string | null>();

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
    let current = path.isAbsolute(startPath)
        ? path.normalize(startPath)
        : path.resolve(absBoundary, startPath);

    try {
        if (fs.existsSync(current) && !fs.statSync(current).isDirectory()) {
            current = path.dirname(current);
        }
    } catch {
        current = path.dirname(current);
    }

    while (current.length >= absBoundary.length) {
        if (NEAREST_DIR_CACHE.has(current)) {
            return NEAREST_DIR_CACHE.get(current)!;
        }

        const hasManifest =
            fs.existsSync(path.join(current, 'package.json')) ||
            fs.existsSync(path.join(current, 'Cargo.toml')) ||
            fs.existsSync(path.join(current, 'pyproject.toml')) ||
            fs.existsSync(path.join(current, 'go.mod'));

        if (hasManifest) {
            NEAREST_DIR_CACHE.set(current, current);
            return current;
        }

        if (current === absBoundary) break;
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    NEAREST_DIR_CACHE.set(current, null);
    return null;
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

    const localInv = loadProjectManifestInventory(nearestDir);
    const rootInv = loadProjectManifestInventory(absRoot);

    return {
        allDependencies: new Set([...rootInv.allDependencies, ...localInv.allDependencies]),
        prodDependencies: new Set([...rootInv.prodDependencies, ...localInv.prodDependencies]),
        devDependencies: new Set([...rootInv.devDependencies, ...localInv.devDependencies]),
        peerDependencies: new Set([...rootInv.peerDependencies, ...localInv.peerDependencies]),
        pathAliases: new Set([...rootInv.pathAliases, ...localInv.pathAliases]),
        versionSpecs: new Map([...rootInv.versionSpecs, ...localInv.versionSpecs]),
    };
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
    const cached = INVENTORY_CACHE.get(absRoot);
    if (cached) return cached;

    const inventory: ProjectManifestInventory = {
        allDependencies: new Set<string>(),
        prodDependencies: new Set<string>(),
        devDependencies: new Set<string>(),
        peerDependencies: new Set<string>(),
        pathAliases: new Set<string>(),
        versionSpecs: new Map<string, string>(),
    };

    const pkgJson = path.join(absRoot, 'package.json');
    if (fs.existsSync(pkgJson)) parsePackageJson(pkgJson, inventory);

    const cargoToml = path.join(absRoot, 'Cargo.toml');
    if (fs.existsSync(cargoToml)) parseCargoToml(cargoToml, inventory.allDependencies);

    parsePythonManifests(absRoot, inventory.allDependencies);

    const goMod = path.join(absRoot, 'go.mod');
    if (fs.existsSync(goMod)) parseGoMod(goMod, inventory.allDependencies);

    parsePathAliases(absRoot, inventory.pathAliases);

    INVENTORY_CACHE.set(absRoot, inventory);
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
        return 'in_tree_vendor';
    }

    if (
        GENERATED_FILE_PATTERN.test(norm) ||
        (headerClues && /(?:@generated|Code generated by|DO NOT EDIT)/i.test(headerClues))
    ) {
        return 'generated';
    }

    if (TEST_FIXTURE_PATTERN.test(norm)) {
        return 'test_fixture';
    }

    return 'proprietary';
}

function isStandardLibraryImport(firstSegment: string, trimmed: string): boolean {
    if (trimmed.startsWith('node:')) return true;
    if (NODE_CORE_MODULES.has(firstSegment) || NODE_CORE_MODULES.has(trimmed)) return true;
    if (PYTHON_STDLIB_MODULES.has(firstSegment) || PYTHON_STDLIB_MODULES.has(trimmed)) return true;
    if (RUST_CORE_CRATES.has(firstSegment) || GO_CORE_PACKAGES.has(firstSegment)) return true;
    return (
        trimmed.startsWith('@GlobalScope') || trimmed === 'Engine' || trimmed === 'ResourceLoader'
    );
}

function isDeclaredDependency(firstSegment: string, manifestDeps?: Set<string>): boolean {
    if (!manifestDeps) return false;
    const normalized = firstSegment.replace(/[-.]/g, '_');
    return manifestDeps.has(firstSegment) || manifestDeps.has(normalized);
}

function isRelativeOrInternalPrefix(trimmed: string): boolean {
    const firstChar = trimmed.charCodeAt(0);
    if (firstChar === 46 || firstChar === 47 || firstChar === 35) return true; // '.', '/', '#'
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
    if (!trimmed) return 'unknown';
    if (IN_TREE_VENDOR_PATTERN.test(trimmed)) return 'in_tree_vendor';
    if (isRelativeOrInternalPrefix(trimmed) || matchesPathAlias(trimmed, pathAliases)) {
        return 'internal';
    }

    const firstSegment = trimmed.split('/')[0].split('.')[0].toLowerCase();
    if (isStandardLibraryImport(firstSegment, trimmed)) return 'stdlib';
    if (isDeclaredDependency(firstSegment, manifestDeps)) return 'external_sdk';
    if (trimmed.startsWith('@')) return 'external_sdk';

    const currentSegments = currentFile.replace(/\\/g, '/').split('/');
    if (currentSegments.length > 1 && currentSegments[0] === firstSegment) {
        return 'internal';
    }

    return 'external_sdk';
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

function tryLoadNpmLock(absRoot: string, direct: number): SupplyChainProfile | null {
    const pkgLock = path.join(absRoot, 'package-lock.json');
    if (!fs.existsSync(pkgLock)) return null;

    try {
        const raw = fs.readFileSync(pkgLock, 'utf8');
        const data = JSON.parse(raw);
        let totalPackages = 0;
        if (data.packages && typeof data.packages === 'object') {
            totalPackages = Math.max(0, Object.keys(data.packages).filter((k) => k !== '').length);
        } else if (data.dependencies && typeof data.dependencies === 'object') {
            totalPackages = Object.keys(data.dependencies).length;
        }
        const transitive = Math.max(0, totalPackages - direct);
        const depth =
            totalPackages <= direct
                ? 1
                : totalPackages <= direct * 5
                  ? 2
                  : totalPackages <= direct * 20
                    ? 3
                    : 4;
        return {
            hasLockfile: true,
            lockfileType: 'npm',
            directDependencyCount: direct,
            transitiveDependencyCount: transitive,
            totalLockfilePackages: totalPackages,
            estimatedDepth: depth,
        };
    } catch {
        // best-effort: ignored package-lock.json parsing failures fall back to next loader
        return null;
    }
}

function tryLoadCargoLock(absRoot: string, direct: number): SupplyChainProfile | null {
    const cargoLock = path.join(absRoot, 'Cargo.lock');
    if (!fs.existsSync(cargoLock)) return null;

    try {
        const raw = fs.readFileSync(cargoLock, 'utf8');
        const matches = raw.match(/\[\[package\]\]/g);
        const totalPackages = matches ? matches.length : 0;
        const transitive = Math.max(0, totalPackages - direct);
        const depth =
            totalPackages <= direct
                ? 1
                : totalPackages <= direct * 4
                  ? 2
                  : totalPackages <= direct * 15
                    ? 3
                    : 4;
        return {
            hasLockfile: true,
            lockfileType: 'cargo',
            directDependencyCount: direct,
            transitiveDependencyCount: transitive,
            totalLockfilePackages: totalPackages,
            estimatedDepth: depth,
        };
    } catch {
        // best-effort: ignored Cargo.lock parsing failures fall back to next loader
        return null;
    }
}

function tryLoadGoSum(absRoot: string, direct: number): SupplyChainProfile | null {
    const goSum = path.join(absRoot, 'go.sum');
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
        const totalPackages = modules.size;
        const transitive = Math.max(0, totalPackages - direct);
        const depth = totalPackages <= direct ? 1 : totalPackages <= direct * 4 ? 2 : 3;
        return {
            hasLockfile: true,
            lockfileType: 'go',
            directDependencyCount: direct,
            transitiveDependencyCount: transitive,
            totalLockfilePackages: totalPackages,
            estimatedDepth: depth,
        };
    } catch {
        // best-effort: ignored go.sum parsing failures fall back to next loader
        return null;
    }
}

function tryLoadPoetryLock(absRoot: string, direct: number): SupplyChainProfile | null {
    const poetryLock = path.join(absRoot, 'poetry.lock');
    if (!fs.existsSync(poetryLock)) return null;

    try {
        const raw = fs.readFileSync(poetryLock, 'utf8');
        const matches = raw.match(/\[\[package\]\]/g);
        const totalPackages = matches ? matches.length : 0;
        const transitive = Math.max(0, totalPackages - direct);
        const depth = totalPackages <= direct ? 1 : totalPackages <= direct * 4 ? 2 : 3;
        return {
            hasLockfile: true,
            lockfileType: 'poetry',
            directDependencyCount: direct,
            transitiveDependencyCount: transitive,
            totalLockfilePackages: totalPackages,
            estimatedDepth: depth,
        };
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
        tryLoadNpmLock(absRoot, direct) ??
        tryLoadCargoLock(absRoot, direct) ??
        tryLoadGoSum(absRoot, direct) ??
        tryLoadPoetryLock(absRoot, direct) ?? {
            hasLockfile: false,
            lockfileType: 'none',
            directDependencyCount: direct,
            transitiveDependencyCount: direct > 0 ? direct * 3 : 0,
            totalLockfilePackages: direct > 0 ? direct * 4 : 0,
            estimatedDepth: direct > 0 ? 3 : 1,
        }
    );
}
