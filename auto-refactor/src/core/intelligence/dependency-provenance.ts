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
 *   3. Classify file provenance into proprietary, in-tree vendor, generated, or test fixture.
 * Exit Semantics & Design Rationale: Never throws; deterministic cache-backed lookups with safe
 *   fallbacks for missing or unreadable manifest files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PYTHON_STDLIB_MODULES } from './python-stdlib';

/** Provenance classification for imported symbols and module references */
export type ImportProvenanceKind =
    | 'stdlib'
    | 'internal'
    | 'in_tree_vendor'
    | 'external_sdk'
    | 'unknown';

/** File origin provenance classification */
export type FileProvenanceKind =
    | 'proprietary'
    | 'in_tree_vendor'
    | 'generated'
    | 'test_fixture';

/** Node.js core standard library module names */
const NODE_CORE_MODULES: ReadonlySet<string> = new Set([
    'assert',
    'async_hooks',
    'buffer',
    'child_process',
    'cluster',
    'crypto',
    'dgram',
    'diagnostics_channel',
    'dns',
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
    'stream',
    'string_decoder',
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
const RUST_CORE_CRATES: ReadonlySet<string> = new Set(['std', 'core', 'alloc']);

/** Go standard library package root prefixes */
const GO_CORE_PACKAGES: ReadonlySet<string> = new Set([
    'archive', 'bufio', 'bytes', 'compress', 'container', 'context', 'crypto',
    'database', 'debug', 'embed', 'encoding', 'errors', 'expvar', 'flag', 'fmt',
    'go', 'hash', 'html', 'image', 'index', 'io', 'log', 'math', 'mime', 'net',
    'os', 'path', 'plugin', 'reflect', 'regexp', 'runtime', 'sort', 'strconv',
    'strings', 'sync', 'syscall', 'testing', 'text', 'time', 'unicode', 'unsafe',
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

/** Manifest dependencies cache keyed by absolute root directory path */
const MANIFEST_CACHE = new Map<string, Set<string>>();

/**
 * Extract external package dependencies declared in package.json.
 */
function parsePackageJson(manifestPath: string, target: Set<string>): void {
    try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const json = JSON.parse(raw);
        for (const dep of Object.keys(json.dependencies || {})) target.add(dep);
        for (const dep of Object.keys(json.devDependencies || {})) target.add(dep);
        for (const dep of Object.keys(json.peerDependencies || {})) target.add(dep);
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

/**
 * Extract external package dependencies declared in pyproject.toml and requirements.txt.
 */
function parsePythonManifests(rootDir: string, target: Set<string>): void {
    const pyproject = path.join(rootDir, 'pyproject.toml');
    if (fs.existsSync(pyproject)) {
        try {
            const raw = fs.readFileSync(pyproject, 'utf8');
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
        } catch {
            // best-effort fallback: ignored when manifest is corrupt or unreadable
        }
    }

    const reqTxt = path.join(rootDir, 'requirements.txt');
    if (fs.existsSync(reqTxt)) {
        try {
            const raw = fs.readFileSync(reqTxt, 'utf8');
            for (const line of raw.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const match = /^([a-zA-Z0-9_.-]+)/.exec(trimmed);
                if (match) target.add(match[1].toLowerCase().replace(/[-.]/g, '_'));
            }
        } catch {
            // best-effort fallback: ignored when manifest is corrupt or unreadable
        }
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

/**
 * Load and cache all declared external package dependencies for a given project root.
 *
 * @param rootDir - Scan root directory
 * @returns Set of lowercase package identifiers
 */
export function loadProjectManifestDependencies(rootDir: string): Set<string> {
    const absRoot = path.resolve(rootDir);
    const cached = MANIFEST_CACHE.get(absRoot);
    if (cached) return cached;

    const declared = new Set<string>();

    const pkgJson = path.join(absRoot, 'package.json');
    if (fs.existsSync(pkgJson)) parsePackageJson(pkgJson, declared);

    const cargoToml = path.join(absRoot, 'Cargo.toml');
    if (fs.existsSync(cargoToml)) parseCargoToml(cargoToml, declared);

    parsePythonManifests(absRoot, declared);

    const goMod = path.join(absRoot, 'go.mod');
    if (fs.existsSync(goMod)) parseGoMod(goMod, declared);

    MANIFEST_CACHE.set(absRoot, declared);
    return declared;
}

/**
 * Classify file origin provenance.
 *
 * @param filePath - Path to source file
 * @param headerClues - Optional source header lines
 * @returns FileProvenanceKind
 */
export function classifyFileProvenance(
    filePath: string,
    headerClues?: string,
): FileProvenanceKind {
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
    return trimmed.startsWith('@GlobalScope') || trimmed === 'Engine' || trimmed === 'ResourceLoader';
}

function isDeclaredDependency(firstSegment: string, manifestDeps?: Set<string>): boolean {
    if (!manifestDeps) return false;
    const normalized = firstSegment.replace(/[-.]/g, '_');
    return manifestDeps.has(firstSegment) || manifestDeps.has(normalized);
}

/**
 * Classify the provenance of an imported module specifier.
 *
 * @param specifier - Raw module specifier from import statement
 * @param currentFile - Normalized path of current importing file
 * @param manifestDeps - Set of declared external package dependencies
 * @returns ImportProvenanceKind
 */
export function classifyImportProvenance(
    specifier: string,
    currentFile: string,
    manifestDeps?: Set<string>,
): ImportProvenanceKind {
    const trimmed = specifier.trim().replace(/^['"]|['"]$/g, '');
    if (!trimmed) return 'unknown';
    if (IN_TREE_VENDOR_PATTERN.test(trimmed)) return 'in_tree_vendor';
    if (trimmed.startsWith('.') || trimmed.startsWith('/')) return 'internal';

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
        directCount !== undefined
            ? directCount
            : loadProjectManifestDependencies(absRoot).size;

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

