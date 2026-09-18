/**
 * Module: Core Profiler — Maturity Tier Classification
 * File Path: src/core/profiler/maturityClassifier.ts
 * Architecture Role: Evaluates project maturity tier based on paths, manifests, and test gates.
 * Dependencies & Triggers: Node fs and path, MaturityTier from ../types; called by profiler.
 * Responsibilities: Classify maturity as demo, prototype, industrial, or production based on
 *   path keywords, version strings, test/lint gate scripts, CI configs, and workspace manifests.
 * Exit Semantics & Design Rationale: Gracefully falls back to 'production' on unreadable files;
 *   never throws on missing manifests or syntax errors.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { MaturityTier } from '../types';

/** Maturity tier identifier for demo projects. */
export const TIER_DEMO: MaturityTier = 'demo';

/** Maturity tier identifier for prototype projects. */
export const TIER_PROTOTYPE: MaturityTier = 'prototype';

/** Maturity tier identifier for industrial projects. */
export const TIER_INDUSTRIAL: MaturityTier = 'industrial';

/** Maturity tier identifier for production projects. */
export const TIER_PRODUCTION: MaturityTier = 'production';

/** Manifest and CI file paths. */
const MANIFEST_PACKAGE_JSON = 'package.json';
const MANIFEST_CARGO_TOML = 'Cargo.toml';
const CI_WORKFLOWS_DIR = path.join('.github', 'workflows');
const CI_GITLAB_FILE = '.gitlab-ci.yml';

/** Version and marker strings. */
const VERSION_ZERO = '0.0.0';
const VERSION_PREFIX_PROTO = '0.0.';
const VERSION_PREFIX_V1 = '1.';
const VERSION_PREFIX_V2 = '2.';
const SCRIPT_KEY_TEST = 'test';
const SCRIPT_KEY_TEST_UNIT = 'test:unit';
const SCRIPT_KEY_LINT = 'lint';
const SCRIPT_KEY_AUDIT = 'audit';
const SCRIPT_KEY_CHECK = 'check';
const CARGO_PROTO_MARKER = 'version = "0.0.';
const CARGO_WORKSPACE_MARKER = '[workspace]';

const DEMO_PATH_PATTERN = /(?:demo|samples?|examples?|tutorial|starter|playground)/i;
const DEMO_NAME_PATTERN = /(?:demo|samples?|examples?|tutorial)/i;

/**
 * Check whether package name or version matches demo heuristics.
 *
 * @param name - Package name string.
 * @param version - Package version string.
 * @returns True when demo pattern or zero-version matches.
 */
function isDemoPackage(name: string, version: string): boolean {
    return DEMO_NAME_PATTERN.test(name) || version === VERSION_ZERO;
}

/**
 * Check whether package scripts define automated test gates.
 *
 * @param scripts - Parsed scripts map from package.json.
 * @returns True if test or test:unit script exists.
 */
function hasTestGates(scripts: Record<string, unknown>): boolean {
    return Boolean(scripts[SCRIPT_KEY_TEST] || scripts[SCRIPT_KEY_TEST_UNIT]);
}

/**
 * Check whether package scripts define lint or audit gates.
 *
 * @param scripts - Parsed scripts map from package.json.
 * @returns True if lint, audit, or check script exists.
 */
function hasAuditGates(scripts: Record<string, unknown>): boolean {
    return Boolean(
        scripts[SCRIPT_KEY_LINT] || scripts[SCRIPT_KEY_AUDIT] || scripts[SCRIPT_KEY_CHECK],
    );
}

/**
 * Check whether the project repository configures Continuous Integration pipelines.
 *
 * @param root - Project root directory path.
 * @returns True if .github/workflows or .gitlab-ci.yml exists.
 */
function hasContinuousIntegration(root: string): boolean {
    return (
        fs.existsSync(path.join(root, CI_WORKFLOWS_DIR)) ||
        fs.existsSync(path.join(root, CI_GITLAB_FILE))
    );
}

/**
 * Check whether versioning and package visibility qualify for industrial maturity.
 *
 * @param version - Package version string.
 * @param isPrivate - Optional package private flag.
 * @returns True when version >= 1.0 or non-private package.
 */
function isIndustrialQualified(version: string, isPrivate: boolean | undefined): boolean {
    return (
        version.startsWith(VERSION_PREFIX_V1) ||
        version.startsWith(VERSION_PREFIX_V2) ||
        isPrivate === false
    );
}

/**
 * Evaluate maturity tier from parsed package.json data and root directory.
 *
 * @param root - Project root directory path.
 * @param packageData - Parsed package.json object.
 * @returns Matching MaturityTier or undefined if not determinable from package.json.
 */
export function evaluatePackageMaturity(
    root: string,
    packageData: Record<string, any>,
): MaturityTier | undefined {
    const name = String(packageData.name || '');
    const version = String(packageData.version || '');
    if (isDemoPackage(name, version)) {
        return TIER_DEMO;
    }

    const scripts = (packageData.scripts || {}) as Record<string, unknown>;
    const hasTests = hasTestGates(scripts);
    const hasLintOrAudit = hasAuditGates(scripts);
    const hasCi = hasContinuousIntegration(root);

    if (
        hasCi &&
        hasTests &&
        hasLintOrAudit &&
        isIndustrialQualified(version, packageData.private)
    ) {
        return TIER_INDUSTRIAL;
    }

    if (version.startsWith(VERSION_PREFIX_PROTO) || !hasTests) {
        return TIER_PROTOTYPE;
    }

    return TIER_PRODUCTION;
}

/**
 * Evaluate maturity tier from Rust Cargo.toml if present.
 *
 * @param root - Project root directory path.
 * @returns Matching MaturityTier or undefined if Cargo.toml is absent or uninformative.
 */
export function evaluateCargoMaturity(root: string): MaturityTier | undefined {
    const cargoPath = path.join(root, MANIFEST_CARGO_TOML);
    if (!fs.existsSync(cargoPath)) return undefined;

    try {
        const content = fs.readFileSync(cargoPath, 'utf8');
        if (content.includes(CARGO_PROTO_MARKER)) return TIER_PROTOTYPE;
        if (content.includes(CARGO_WORKSPACE_MARKER)) return TIER_INDUSTRIAL;
    } catch {
        // ignore
    }
    return undefined;
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
    if (DEMO_PATH_PATTERN.test(normRoot)) {
        return TIER_DEMO;
    }

    let packageData = pkg;
    if (!packageData) {
        const pkgPath = path.join(root, MANIFEST_PACKAGE_JSON);
        if (fs.existsSync(pkgPath)) {
            try {
                packageData = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            } catch {
                // ignore
            }
        }
    }

    if (packageData) {
        const tier = evaluatePackageMaturity(root, packageData);
        if (tier) return tier;
    }

    const cargoTier = evaluateCargoMaturity(root);
    if (cargoTier) return cargoTier;

    return TIER_PRODUCTION;
}
