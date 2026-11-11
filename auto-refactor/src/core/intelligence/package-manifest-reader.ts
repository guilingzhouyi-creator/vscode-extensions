/**
 * Module: Core Intelligence — Package Manifest & License Reader
 * File Path: src/core/intelligence/package-manifest-reader.ts
 * Architecture Role: Safe filesystem crawler and JSON parser extracting npm package manifests
 *   and normalized license identifiers for third-party dependency provenance checks.
 * Dependencies & Triggers: Consumed by dependency-layout-helpers and provenance auditors.
 * Responsibilities:
 *   1. Read and parse package.json files safely with zero unhandled throw paths;
 *   2. Crawl ancestor directories to locate installed package manifests (depth <= 3);
 *   3. Extract canonical license descriptor strings from flexible manifest shapes.
 * Exit Semantics & Design Rationale: CC <= 15; pure fallbacks returning null on missing files.
 */

import * as fs from 'fs';
import * as path from 'path';

const MAX_ANCESTOR_SEARCH_DEPTH = 3;
const FILE_NAME_PACKAGE_JSON = 'package.json';
const DIR_NAME_NODE_MODULES = 'node_modules';

/**
 * Structural shape of a package.json manifest parsed from disk.
 */
export interface RawPackageManifest {
    name?: string;
    version?: string;
    license?: string | { type?: string };
    licenses?: Array<{ type?: string }>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    [key: string]: unknown;
}

/**
 * Safely reads and parses a JSON file, returning null if unreadable or invalid.
 *
 * @param filePath - Absolute or relative path to the JSON file.
 * @returns Parsed JSON object, or null if reading or parsing failed.
 */
export function readJsonSafely(filePath: string): RawPackageManifest | null {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as RawPackageManifest;
    } catch {
        return null;
    }
}

/**
 * Traverses parent directories to locate package.json for an installed package.
 *
 * @param rootDir - Starting directory for ancestor traversal.
 * @param packageName - Target npm package name to resolve.
 * @returns Parsed package.json manifest, or null if not found.
 */
export function findAncestorPackageManifest(
    rootDir: string,
    packageName: string,
): RawPackageManifest | null {
    let currentDir = rootDir;
    for (let depth = 0; depth < MAX_ANCESTOR_SEARCH_DEPTH; depth++) {
        const manifest = readJsonSafely(
            path.join(currentDir, DIR_NAME_NODE_MODULES, packageName, FILE_NAME_PACKAGE_JSON),
        );
        if (manifest) {
            return manifest;
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            break;
        }
        currentDir = parentDir;
    }
    return null;
}

/**
 * Extracts normalized license identifier from a package.json manifest.
 *
 * @param manifest - Parsed package.json object or raw metadata.
 * @returns Normalized license string, or null if absent.
 */
export function extractLicenseFromManifest(
    manifest: RawPackageManifest | null | undefined,
): string | null {
    if (!manifest) return null;
    const directLicense =
        typeof manifest.license === 'string' ? manifest.license : manifest.license?.type;
    if (typeof directLicense === 'string') return directLicense;
    if (Array.isArray(manifest.licenses) && manifest.licenses[0]?.type) {
        return manifest.licenses[0].type;
    }
    return null;
}
